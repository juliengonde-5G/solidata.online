// ═══════════════════════════════════════════════════════════════════════════
// PR A — EXPORTS SUR POSTGRESQL RÉEL
// (a) FSE+ participants : les 29 colonnes DICTÉES par l'autorité (09 § 2 (a)),
//     le délai de saisie, le refus explicite d'un fichier vide, le journal
//     écrit AVANT l'envoi ; (b) bilan d'exécution ; (c) export Insertion complet.
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const { RUN, creerComptes, purger, creerSalarie, jourDecale } = require('./_helpers');

jest.mock('../../src/middleware/activity-logger', () => ({
  autoLogActivity: () => (req, res, next) => next(),
  logActivity: () => {},
}));

const express = require('express');
const request = require('supertest');
const pool = require('../../src/config/database');

jest.setTimeout(120000);

const app = express();
app.use(express.json());
app.use('/api/exports', require('../../src/routes/exports-fse'));
app.use('/api/exports', require('../../src/routes/exports'));
app.use('/api/insertion', require('../../src/routes/insertion'));

const PREFIXE = 'jest_prA_exp';
const MAT = ['PRAEXP1', 'PRAEXP2', 'PRAEXP3'];
const CODE_PROJET = 'JEST-ASI-EXPORT';
const CODE_PROJET_VIDE = 'JEST-ASI-VIDE';
let U; let projetId; let projetVideId;
let sortie; let enCours; let sortieAnticipee;

const auth = (r, role) => r.set('Authorization', `Bearer ${U[role].token}`);

/**
 * Les 29 intitulés, recopiés MOT POUR MOT de 09 § 2 (a) — c'est la liste de
 * l'autorité qui fait foi, pas celle du code. Le test compare colonne par
 * colonne : un intitulé reformulé casse le rapprochement fait à la main par
 * l'instructeur, qui travaille avec le tableau de sa note.
 */
const COLONNES_AUTORITE = [
  'Identifiant interne',
  'NOM',
  'Prénom',
  'Date de naissance',
  'Sexe',
  'Commune de résidence',
  'Projet',
  "Date d'entrée dans le projet",
  'Date de sortie du projet',
  "Critères d'éligibilité IAE",
  'BRSA',
  'Catégorie France Travail',
  'Référent unique (type)',
  "Date d'entrée en parcours",
  'Date de fin de contrat',
  "Situation avant l'entrée",
  'Durée sans emploi',
  "Niveau d'instruction",
  'Foyer monoparental',
  'Sans domicile stable',
  "Date de recueil du questionnaire d'entrée",
  "Complétude du questionnaire d'entrée (%)",
  "Date de sortie de l'opération",
  'Situation à la sortie',
  'Date de saisie de la sortie',
  'Délai de saisie (jours)',
  'Situation à +6 mois',
  'Date du relevé à +6 mois',
  'Complétude du dossier participant (%)',
];

/** Découpe une ligne CSV `;` en respectant les guillemets. */
function cellules(ligne) {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < ligne.length; i += 1) {
    const c = ligne[i];
    if (q) {
      if (c === '"' && ligne[i + 1] === '"') { cur += '"'; i += 1; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ';') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

/** Sépare l'en-tête `#` de traçabilité du tableau proprement dit. */
function decouper(csv) {
  const brut = csv.replace(/^﻿/, '').split('\n');
  const meta = brut.filter((l) => l.startsWith('#'));
  const table = brut.filter((l) => !l.startsWith('#') && l.trim() !== '');
  return { meta, entete: cellules(table[0]), lignes: table.slice(1).map(cellules), bom: csv.charCodeAt(0) === 0xfeff };
}

(RUN ? describe : describe.skip)('PR A — exports FSE+ et Insertion (PostgreSQL réel)', () => {
  beforeAll(async () => {
    await purger(pool, { matricules: MAT, usernamePrefix: PREFIXE, projetCodes: [CODE_PROJET, CODE_PROJET_VIDE] });
    U = await creerComptes(pool, PREFIXE);

    projetId = (await pool.query(
      `INSERT INTO insertion_projets (code, nom, type, financeur, date_debut, date_fin, cofinancement_ue_pct, actif)
       VALUES ($1, 'ASI de recette export', 'asi', 'FSE+ / Jest', '2026-01-01', '2027-12-31', 60, true) RETURNING id`,
      [CODE_PROJET]
    )).rows[0].id;
    projetVideId = (await pool.query(
      `INSERT INTO insertion_projets (code, nom, type, actif) VALUES ($1, 'ASI sans participant', 'asi', true) RETURNING id`,
      [CODE_PROJET_VIDE]
    )).rows[0].id;

    // Un participant SORTI, dossier renseigné de bout en bout.
    sortie = await creerSalarie(pool, MAT[0], {
      first_name: 'Nadia', last_name: 'kermiche', gender: 'F', city: 'Rouen',
      birth_date: '1988-04-12', insertion_status: 'termine',
      insertion_start_date: '2026-02-01', contract_end: '2026-05-31',
      brsa: true, ft_categorie: 'B', referent_unique_type: 'cms',
    });
    // Un participant ENCORE EN PARCOURS : ses colonnes de sortie restent VIDES.
    enCours = await creerSalarie(pool, MAT[1], {
      first_name: 'Ali', last_name: 'Traore', gender: 'M', city: 'Elbeuf',
      birth_date: '1993-01-20', insertion_status: 'en_parcours',
      insertion_start_date: '2026-03-01', contract_end: jourDecale(200),
    });

    // Un participant dont la SORTIE DE L'OPÉRATION ne coïncide pas avec la fin
    // de contrat (rupture anticipée) : c'est le seul cas où la colonne 26
    // « Délai de saisie » distingue les deux bases de calcul possibles.
    sortieAnticipee = await creerSalarie(pool, MAT[2], {
      first_name: 'Sonia', last_name: 'Berger', gender: 'F', city: 'Sotteville',
      birth_date: '1990-06-08', insertion_status: 'termine',
      insertion_start_date: '2026-01-15', contract_end: '2026-05-31',
    });

    await pool.query(
      `INSERT INTO employee_contracts (employee_id, contract_type, start_date, end_date, is_current)
       VALUES ($1, 'CDDI', '2026-02-01', '2026-05-31', false)`, [sortie]
    );
    for (const [id, entree] of [[sortie, '2026-02-01'], [enCours, '2026-03-01'], [sortieAnticipee, '2026-01-15']]) {
      await pool.query(
        'INSERT INTO insertion_projet_participants (projet_id, employee_id, date_entree) VALUES ($1, $2, $3)',
        [projetId, id, entree]
      );
    }
    await pool.query(
      `INSERT INTO employee_eligibilite (employee_id, critere_code) VALUES ($1, 'brsa'), ($1, 'detld')`, [sortie]
    );
    await pool.query(
      `INSERT INTO insertion_diagnostics (employee_id, parcours_num, statut_saisie, niveau_formation,
         fse_entree, fse_entree_complet, fse_entree_saisie_at)
       VALUES ($1, 1, 'complet', 'niv3',
         '{"statut_avant_entree":"demandeur_emploi","duree_sans_emploi":"gt_24m","foyer_monoparental":true,"sans_domicile_stable":false,"ressources_principales":"rsa"}'::jsonb,
         true, '2026-02-10 09:00:00')`, [sortie]
    );
    // Sortie enregistrée 12 jours après la sortie de l'opération.
    await pool.query(
      `INSERT INTO insertion_fse_sorties (employee_id, parcours_num, projet_id, source, date_sortie,
         situation_sortie, fse_sortie, saisie_at, situation_6mois, date_releve_6mois)
       VALUES ($1, 1, $2, 'sans_bilan', '2026-05-31', 'emploi_durable',
         '{"situation_sortie":"emploi_durable","type_contrat":"cdi"}'::jsonb,
         '2026-06-12 10:00:00', 'injoignable', '2026-12-05')`, [sortie, projetId]
    );
    // Sortie de l'opération le 30/04, saisie le 12/06 : 43 jours selon la règle
    // dictée (colonne 25 − colonne 23), 12 seulement si l'on comptait depuis la
    // fin de contrat.
    await pool.query(
      `INSERT INTO insertion_fse_sorties (employee_id, parcours_num, projet_id, source, date_sortie,
         situation_sortie, saisie_at)
       VALUES ($1, 1, $2, 'sans_bilan', '2026-04-30', 'chomage', '2026-06-12 10:00:00')`,
      [sortieAnticipee, projetId]
    );
  });

  afterAll(async () => {
    await purger(pool, {
      matricules: MAT, employeeIds: [sortie, enCours, sortieAnticipee],
      usernamePrefix: PREFIXE, projetCodes: [CODE_PROJET, CODE_PROJET_VIDE],
    });
    await pool.end();
  });

  // ── (a) Export participants ──────────────────────────────────────────────
  describe('(a) GET /api/exports/fse-plus', () => {
    let csv;

    beforeAll(async () => {
      const r = await auth(request(app).get(`/api/exports/fse-plus?projet=${projetId}&annee=2026&trimestre=2`), 'ADMIN');
      expect(r.status).toBe(200);
      csv = decouper(r.text);
    });

    test('les 29 colonnes, dans l\'ORDRE dicté, intitulé par intitulé', () => {
      expect(csv.entete).toHaveLength(29);
      for (let i = 0; i < 29; i += 1) {
        expect([i + 1, csv.entete[i]]).toEqual([i + 1, COLONNES_AUTORITE[i]]);
      }
    });

    test('en-tête de traçabilité (5 lignes), BOM, séparateur point-virgule, une seule ligne de colonnes', () => {
      expect(csv.bom).toBe(true);
      expect(csv.meta).toHaveLength(5);
      expect(csv.meta.join('\n')).toMatch(/Généré le/);
      expect(csv.meta.join('\n')).toMatch(/Généré par/);
      expect(csv.meta.join('\n')).toMatch(/Périmètre/);
      expect(csv.meta.join('\n')).toMatch(/Nombre de lignes;3/);
      expect(csv.meta.join('\n')).toMatch(/font foi/);
    });

    test('le nom du fichier porte le code du projet et la période', async () => {
      const r = await auth(request(app).get(`/api/exports/fse-plus?projet=${projetId}&annee=2026&trimestre=2`), 'ADMIN');
      expect(r.headers['content-disposition']).toContain(`fse-participants_${CODE_PROJET}_2026_T2.csv`);
    });

    test('la ligne du participant sorti est juste, colonne par colonne', () => {
      const l = csv.lignes.find((c) => c[1] === 'KERMICHE');
      expect(l).toBeTruthy();
      expect(l[1]).toBe('KERMICHE');            // NOM en majuscules
      expect(l[2]).toBe('Nadia');
      expect(l[3]).toBe('1988-04-12');
      expect(l[4]).toBe('F');
      expect(l[5]).toBe('Rouen');
      expect(l[6]).toBe('ASI de recette export');
      expect(l[7]).toBe('2026-02-01');
      expect(l[9]).toBe('brsa, detld');
      expect(l[10]).toBe('Oui');
      expect(l[11]).toBe('B');
      expect(l[12]).toBe('CMS');
      expect(l[13]).toBe('2026-02-01');          // 1er CDDI
      expect(l[14]).toBe('2026-05-31');
      expect(l[15]).toBe("Demandeur d'emploi");  // libellé français, jamais le code
      expect(l[16]).toBe('Plus de 24 mois');
      expect(l[17]).toBe('Niveau 3 (CAP/BEP)');
      expect(l[18]).toBe('Oui');
      expect(l[19]).toBe('Non');
      expect(l[20]).toBe('2026-02-10');
      expect(l[21]).toBe('100');
      expect(l[22]).toBe('2026-05-31');
      expect(l[23]).toBe('Emploi durable');
      expect(l[24]).toBe('2026-06-12');
      expect(l[26]).toBe('Injoignable');         // ≠ « Non relevée »
      expect(l[27]).toBe('2026-12-05');
    });

    test('AUCUNE cellule ne contient de JSON (exigence de l\'autorité)', () => {
      for (const l of csv.lignes) {
        for (const c of l) expect(c).not.toMatch(/[{}]|":/);
      }
    });

    // RÈGLE DICTÉE (09 § 2 (a), colonne 26) : « Colonne 25 − colonne 23 ».
    // C'est une arithmétique que l'instructeur refait à la main sur le fichier :
    // toute autre base de calcul lui donne un écart inexplicable.
    test('colonne 26 « Délai de saisie » = colonne 25 − colonne 23, à la journée près', () => {
      for (const l of csv.lignes) {
        if (!l[24]) { expect(l[25]).toBe(''); continue; }
        const attendu = Math.round((new Date(l[24]) - new Date(l[22])) / 86400000);
        expect([l[1], Number(l[25])]).toEqual([l[1], attendu]);
      }
    });

    test('une sortie ANTICIPÉE (sortie ≠ fin de contrat) suit la même règle', () => {
      const l = csv.lignes.find((c) => c[1] === 'BERGER');
      expect(l[22]).toBe('2026-04-30');   // colonne 23 — sortie de l'opération
      expect(l[24]).toBe('2026-06-12');   // colonne 25 — saisie
      expect(Number(l[25])).toBe(43);     // colonne 26 — et non 12 (fin de contrat)
    });

    test('un participant en parcours : colonnes de sortie VIDES, jamais un zéro', () => {
      const l = csv.lignes.find((c) => c[1] === 'TRAORE');
      expect(l[22]).toBe(''); // date de sortie de l'opération
      expect(l[23]).toBe(''); // situation à la sortie
      expect(l[24]).toBe(''); // date de saisie
      expect(l[25]).toBe(''); // délai
      expect(l[26]).toBe(''); // « Non relevée » n'a de sens qu'après une sortie
      expect(l[10]).toBe('Non renseigné'); // seule exception dictée
    });

    test('0 ligne → 409 EXPORT_VIDE, aucun fichier produit', async () => {
      const r = await auth(request(app).get(`/api/exports/fse-plus?projet=${projetVideId}&annee=2026&trimestre=2`), 'ADMIN');
      expect(r.status).toBe(409);
      expect(r.body.code).toBe('EXPORT_VIDE');
      expect(r.headers['content-type']).toMatch(/json/);
    });

    test('le journal EXPORT_FSE_PLUS est écrit, et pas sur un export refusé', async () => {
      const n = async () => (await pool.query(
        "SELECT count(*)::int c FROM rgpd_audit_log WHERE action = 'EXPORT_FSE_PLUS' AND user_id = $1", [U.ADMIN.id])).rows[0].c;
      const avant = await n();
      await auth(request(app).get(`/api/exports/fse-plus?projet=${projetId}&annee=2026&trimestre=2`), 'ADMIN');
      expect(await n()).toBe(avant + 1);
      await auth(request(app).get(`/api/exports/fse-plus?projet=${projetVideId}`), 'ADMIN');
      expect(await n()).toBe(avant + 1); // un refus ne trace rien : rien n'est sorti
    });

    test('si le journal ne peut pas être écrit, l\'export ÉCHOUE (aucun fichier non tracé)', async () => {
      // Le journal est rendu inopérant au niveau de la BASE, pas du code : c'est
      // bien la chaîne réelle qui est éprouvée.
      // NOT VALID : la contrainte s'applique aux écritures À VENIR sans
      // exiger que l'historique déjà journalisé la respecte.
      await pool.query("ALTER TABLE rgpd_audit_log ADD CONSTRAINT jest_bloc_export CHECK (action <> 'EXPORT_FSE_PLUS') NOT VALID");
      try {
        const r = await auth(request(app).get(`/api/exports/fse-plus?projet=${projetId}&annee=2026&trimestre=2`), 'ADMIN');
        expect(r.status).toBe(500);
        expect(r.headers['content-type']).toMatch(/json/);
        expect(r.text).not.toMatch(/KERMICHE/); // aucune donnée nominative n'est sortie
      } finally {
        await pool.query('ALTER TABLE rgpd_audit_log DROP CONSTRAINT jest_bloc_export');
      }
      // La chaîne fonctionne de nouveau une fois la contrainte levée.
      const ok = await auth(request(app).get(`/api/exports/fse-plus?projet=${projetId}&annee=2026&trimestre=2`), 'ADMIN');
      expect(ok.status).toBe(200);
    });

    test('MANAGER refusé (403) : l\'export est nominatif', async () => {
      const r = await auth(request(app).get(`/api/exports/fse-plus?projet=${projetId}`), 'MANAGER');
      expect(r.status).toBe(403);
    });

    // Exclusions absolues de 09 § 2 (règles communes). La RQTH n'en fait PAS
    // partie : l'autorité l'admet explicitement en colonne 10 comme CODE
    // d'éligibilité — jamais comme information médicale. Le test porte donc sur
    // le vocabulaire de santé et de justice, pas sur ce code.
    test('aucune donnée de frein, de santé ni de judiciaire ne figure dans le fichier', () => {
      const texte = csv.lignes.flat().join(' ').toLowerCase();
      for (const interdit of ['frein', 'santé', 'sante', 'judiciaire', 'handicap', 'médic', 'medic']) {
        expect(texte).not.toContain(interdit);
      }
      // Et l'en-tête ne promet aucune colonne de frein.
      expect(csv.entete.join(' ').toLowerCase()).not.toMatch(/frein|santé|judiciaire/);
    });
  });

  // ── (b) Bilan d'exécution ────────────────────────────────────────────────
  describe('(b) GET /api/exports/fse-plus/bilan', () => {
    test('agrégat non nominatif, sections attendues', async () => {
      const r = await auth(request(app).get(`/api/exports/fse-plus/bilan?projet=${projetId}&annee=2026`), 'ADMIN');
      expect(r.status).toBe(200);
      const brut = JSON.stringify(r.body);
      expect(brut).not.toMatch(/KERMICHE|Kermiche|Nadia|Traore/);
      expect(r.body.identification).toHaveProperty('projet');
      expect(r.body.identification.nominatif).toBe(false);
      expect(brut).toMatch(/completude|complétude/i);
      expect(brut).toMatch(/sortie/i);
    });

    test('MANAGER refusé', async () => {
      const r = await auth(request(app).get(`/api/exports/fse-plus/bilan?projet=${projetId}`), 'MANAGER');
      expect(r.status).toBe(403);
    });
  });

  // ── (c) Export Insertion complet ─────────────────────────────────────────
  describe('(c) GET /api/exports/insertion', () => {
    test('génération Excel journalisée EXPORT_INSERTION_COMPLET', async () => {
      const n = async () => (await pool.query(
        "SELECT count(*)::int c FROM rgpd_audit_log WHERE action = 'EXPORT_INSERTION_COMPLET' AND user_id = $1", [U.ADMIN.id])).rows[0].c;
      const avant = await n();
      const r = await auth(request(app).get('/api/exports/insertion'), 'ADMIN');
      expect(r.status).toBe(200);
      expect(r.headers['content-type']).toMatch(/spreadsheetml|octet-stream/);
      expect(await n()).toBe(avant + 1);
    });

    test('jeu de données CSV : en-tête de traçabilité et journal', async () => {
      const r = await auth(request(app).get('/api/exports/insertion?format=csv&dataset=salaries'), 'ADMIN');
      expect(r.status).toBe(200);
      expect(r.text.replace(/^﻿/, '')).toMatch(/^#/);
      const j = await pool.query(
        "SELECT details FROM rgpd_audit_log WHERE action = 'EXPORT_INSERTION_COMPLET' ORDER BY id DESC LIMIT 1");
      const d = typeof j.rows[0].details === 'string' ? JSON.parse(j.rows[0].details) : j.rows[0].details;
      expect(d.format).toBe('csv');
      expect(d.dataset).toBe('salaries');
    });

    test('MANAGER refusé', async () => {
      const r = await auth(request(app).get('/api/exports/insertion'), 'MANAGER');
      expect(r.status).toBe(403);
    });

    // Placé en DERNIER : il vide le périmètre d'insertion de la base de test.
    // Double garde — le drapeau `PR_A_E2E_DB` et le NOM de la base, qui doit
    // contenir « test » : ce test ne doit jamais pouvoir tourner ailleurs.
    test('aucun salarié dans le périmètre → 409 EXPORT_VIDE (jamais un classeur vide)', async () => {
      expect(process.env.DB_NAME || '').toMatch(/test/);
      const statuts = (await pool.query(
        "SELECT id, insertion_status FROM employees WHERE insertion_status IS DISTINCT FROM 'none'")).rows;
      await pool.query("UPDATE employees SET insertion_status = 'none'");
      await pool.query('DELETE FROM insertion_milestones');
      await pool.query('DELETE FROM insertion_diagnostics');
      try {
        const r = await auth(request(app).get('/api/exports/insertion'), 'ADMIN');
        expect(r.status).toBe(409);
        expect(r.body.code).toBe('EXPORT_VIDE');
        expect(r.headers['content-type']).toMatch(/json/);
        // Un refus ne produit aucun fichier : il n'y a donc rien à journaliser.
        const csv = await auth(request(app).get('/api/exports/insertion?format=csv&dataset=salaries'), 'ADMIN');
        expect(csv.status).toBe(409);
      } finally {
        for (const s of statuts) {
          await pool.query('UPDATE employees SET insertion_status = $2 WHERE id = $1', [s.id, s.insertion_status]);
        }
      }
    });

  });
});
