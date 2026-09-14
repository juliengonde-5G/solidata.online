// ═══════════════════════════════════════════════════════════════════════════
// PR D lot 6 — TABLEAU DES FREINS ENRICHI (export (d)) ET LES TROIS SAISIES,
// SUR POSTGRESQL RÉEL.
//
// Ce que cette suite prouve, et que le `pg` simulé ne pouvait pas prouver :
//   · les deux `LEFT JOIN LATERAL` à `ARRAY_AGG` de `fetchFreinsRows`
//     s'exécutent et rendent des TABLEAUX que le formateur sait joindre ;
//   · les 45 colonnes sortent dans l'ordre, les 23 premières inchangées ;
//   · les dates de l'export ne glissent pas d'un jour selon le fuseau du
//     processus — le défaut de famille corrigé en PR B sur l'export FSE+ ;
//   · les CHECK de la migration refusent bien ce que les validateurs refusent
//     (et l'inverse : ce qu'ils acceptent, la base l'accepte) ;
//   · `embauche_accueillant` est DÉDUIT et écrit en base, jamais saisi.
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const {
  RUN, pool, creerComptes, purgerPrD, creerSalarie, journalParAction, dernierIdJournal,
  etatPool, signer,
} = require('./_helpers');

jest.mock('../../src/middleware/activity-logger', () => ({
  autoLogActivity: () => (req, res, next) => next(),
  logActivity: () => {},
}));

const express = require('express');
const request = require('supertest');

const app = express();
app.use(express.json());
app.use('/api/insertion', require('../../src/routes/insertion'));
app.use('/api/exports', require('../../src/routes/exports'));

jest.setTimeout(300000);

const PREFIXE = 'jest_prD_exp';
const AN = 2026;
const M = { a: 'PRDE_A', b: 'PRDE_B', c: 'PRDE_C' };
const MATS = Object.values(M);

let U; const E = {}; let CIP_ID; let CIP_VIDE = 987654;
const auth = (r, role) => r.set('Authorization', `Bearer ${U[role].token}`);

/** Découpe une ligne CSV en respectant les guillemets (une cellule agrégée
 * « RQTH ; RSA » contient le séparateur : un split naïf décale TOUTES les
 * colonnes suivantes, et l'assertion mesurerait alors le harnais). */
function cellules(ligne) {
  const out = []; let cur = ''; let dansGuillemets = false;
  for (let i = 0; i < ligne.length; i++) {
    const c = ligne[i];
    if (c === '"') {
      if (dansGuillemets && ligne[i + 1] === '"') { cur += '"'; i++; } else dansGuillemets = !dansGuillemets;
    } else if (c === ';' && !dansGuillemets) { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out;
}

async function ins(table, obj) {
  const cols = Object.keys(obj);
  const r = await pool.query(
    `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
    cols.map((c) => obj[c])
  );
  return r.rows[0] && r.rows[0].id;
}

(RUN ? describe : describe.skip)('PR D lot 6 — exports et saisies (PostgreSQL réel)', () => {
  beforeAll(async () => {
    await purgerPrD(pool, { matricules: MATS, usernamePrefix: PREFIXE, annees: [AN] });
    U = await creerComptes(pool, PREFIXE, ['ADMIN', 'RH', 'MANAGER']);
    CIP_ID = U.RH.id;
    U.QHSE = { token: signer({ id: 0, username: `${PREFIXE}_qhse`, role: 'QHSE' }), role: 'QHSE' };

    // A — dossier complet : freins en évolution, éligibilité (dont art. 10),
    // BRSA, catégorie FT, référent, projet cofinancé, PMSMP.
    E.a = await creerSalarie(pool, M.a, {
      first_name: 'Amine', last_name: 'Zza', insertion_status: 'en_parcours',
      insertion_start_date: `${AN}-01-10`, cip_referent_user_id: CIP_ID,
      birth_date: '1990-06-15', nationality: 'Française', gender: 'M', city: 'Rouen',
      weekly_hours: 26, brsa: true, brsa_date_constat: `${AN}-01-05`, ft_categorie: 'G',
      referent_unique_type: 'cms', referent_unique_nom: 'CMS Rouen Ouest',
      pass_iae_statut: 'actif', pass_iae_end: `${AN}-11-30`, eligibilite_source: 'prescripteur_habilite',
      disability_status: 'RQTH en cours',
    });
    // B — aucun entretien : évolution « non évalué ».
    E.b = await creerSalarie(pool, M.b, {
      first_name: 'Bea', last_name: 'Zzb', insertion_status: 'en_parcours',
      insertion_start_date: `${AN}-02-10`, cip_referent_user_id: CIP_ID,
      birth_date: '1988-02-02', gender: 'F', weekly_hours: 20,
    });
    // C — frein aggravé.
    E.c = await creerSalarie(pool, M.c, {
      first_name: 'Cédric', last_name: 'Zzc', insertion_status: 'en_parcours',
      insertion_start_date: `${AN}-03-10`, cip_referent_user_id: CIP_ID,
      birth_date: '1977-07-07', gender: 'M', weekly_hours: 26,
    });

    for (const [cle, mob] of [['a', 4], ['b', 3], ['c', 2]]) {
      await ins('insertion_diagnostics', {
        employee_id: E[cle], parcours_num: 1, niveau_formation: 'CAP',
        frein_mobilite: mob, frein_sante: mob, frein_logement: mob, frein_linguistique: mob,
        frein_administratif: mob, frein_finances: mob, frein_judiciaire: 5,
        ressources: ['rsa'], logement_statut: 'heberge', situation_familiale: 'celibataire',
        projet_formation: 'CACES', emploi_vise: 'Agent de tri', rqth: true,
      });
    }
    // A : levé (4 → 2). C : aggravé (2 → 4). B : aucune évaluation.
    await ins('insertion_milestones', {
      employee_id: E.a, parcours_num: 1, milestone_type: 'bilan_intermediaire',
      due_date: `${AN}-06-01`, completed_date: `${AN}-06-01`, status: 'realise',
      frein_mobilite: 2, frein_sante: 2, frein_judiciaire: 1,
    });
    await ins('insertion_milestones', {
      employee_id: E.c, parcours_num: 1, milestone_type: 'bilan_intermediaire',
      due_date: `${AN}-06-01`, completed_date: `${AN}-06-01`, status: 'realise',
      frein_mobilite: 4, frein_sante: 4,
    });

    await ins('employee_eligibilite', { employee_id: E.a, critere_code: 'brsa' });
    await ins('employee_eligibilite', { employee_id: E.a, critere_code: 'rqth' });
    await ins('employee_eligibilite', { employee_id: E.a, critere_code: 'sortant_detention' });

    await ins('employee_contracts', {
      employee_id: E.a, contract_type: 'CDDI', weekly_hours: 28,
      start_date: `${AN}-01-10`, end_date: `${AN}-12-31`, is_current: true,
    });

    const asi = await pool.query("SELECT id FROM insertion_projets WHERE type = 'asi' ORDER BY id LIMIT 1");
    if (asi.rows[0]) {
      await ins('insertion_projet_participants', {
        projet_id: asi.rows[0].id, employee_id: E.a, date_entree: `${AN}-01-20`,
      });
    }
    await ins('insertion_pmsmp', {
      employee_id: E.a, entreprise: 'Alpha SAS', objet: 'decouvrir_metier',
      date_debut: `${AN}-04-01`, date_fin: `${AN}-04-15`, saisie_outil_officiel: true,
    });
  });

  afterAll(async () => {
    await purgerPrD(pool, { matricules: MATS, usernamePrefix: PREFIXE, annees: [AN] });
    await pool.end();
  });

  // ═════════════════════════════════════════════════════════════════════
  // 1. Le tableau des freins enrichi
  // ═════════════════════════════════════════════════════════════════════
  describe('export (d) — tableau des freins', () => {
    let entetes; let lignes;
    beforeAll(async () => {
      const r = await auth(request(app).get(`/api/exports/insertion-freins?format=csv&cip=${CIP_ID}`), 'ADMIN');
      expect(r.status).toBe(200);
      const brut = r.text.replace(/^﻿/, '').trim().split('\n');
      entetes = cellules(brut[0]);
      lignes = brut.slice(1).map(cellules);
    });

    test('V-39 — 45 colonnes, et les 23 premières restent celles du CDC', () => {
      expect(entetes).toHaveLength(45);
      expect(entetes.slice(0, 23)).toEqual([
        'NOM', 'Prénom', 'Nationalité', "Date d'entrée ACI", 'Fin PASS IAE',
        'Heures par semaine (quotité contractuelle)', 'Genre', 'Date de naissance', 'RQTH',
        'Niveau de formation', 'Ressources', 'Logement', 'Commune de résidence',
        'Situation familiale',
        'Frein linguistique', 'Frein santé', 'Frein logement', 'Frein administratif',
        'Frein financier', 'Frein mobilité', 'PMSMP', 'Projet de formation', 'Emploi visé',
      ]);
    });

    test('V-40 — les 10 colonnes du cadre 2026 puis les 6 couples entrée/évolution', () => {
      expect(entetes.slice(23, 33)).toEqual([
        'BRSA', 'Date de constat BRSA', 'Catégorie France Travail', "Critères d'éligibilité IAE",
        'Statut du Pass IAE', 'Référent unique (type)', 'Référent unique (nom)',
        'Projet cofinancé', 'Prescripteur habilité', 'Semaines sous 15 h (année)',
      ]);
      expect(entetes.slice(33)).toEqual([
        'Frein linguistique — entrée', 'Frein linguistique — évolution',
        'Frein santé — entrée', 'Frein santé — évolution',
        'Frein logement — entrée', 'Frein logement — évolution',
        'Frein administratif — entrée', 'Frein administratif — évolution',
        'Frein financier — entrée', 'Frein financier — évolution',
        'Frein mobilité — entrée', 'Frein mobilité — évolution',
      ]);
    });

    test('V-41 — les LATERAL ARRAY_AGG rendent bien un tableau joint « ; »', () => {
      const a = lignes.find((l) => l[0] === 'Zza');
      expect(a).toBeDefined();
      // Les critères d'éligibilité sont agrégés — la cellule est guillemetée
      // parce qu'elle contient le séparateur, donc on relit la ligne entière.
      const idxCrit = entetes.indexOf("Critères d'éligibilité IAE");
      const idxProj = entetes.indexOf('Projet cofinancé');
      expect(a[idxCrit]).toMatch(/ ; /);                    // ARRAY_AGG joint
      expect(a[idxCrit]).toMatch(/RQTH|RSA/i);
      expect(a[idxProj]).toBe('ASI-2026-2027');
    });

    test('V-42 — le critère art. 10 n\'est dans AUCUNE ligne', async () => {
      const r = await auth(request(app).get(`/api/exports/insertion-freins?format=csv&cip=${CIP_ID}`), 'ADMIN');
      expect(r.text).not.toMatch(/détention/i);
      const sens = await auth(request(app).get(`/api/exports/insertion-freins?format=csv&sensibles=1&cip=${CIP_ID}`), 'ADMIN');
      expect(sens.text).not.toMatch(/détention/i); // art. 10 : même dans la variante réservée
    });

    test('V-43 — évolution : levé et aggravé sont bien calculés', () => {
      const idx = entetes.indexOf('Frein mobilité — évolution');
      const idxEntree = entetes.indexOf('Frein mobilité — entrée');
      const par = Object.fromEntries(lignes.map((l) => [l[0], l]));
      expect(par.Zza[idxEntree]).toBe('4');
      expect(par.Zza[idx]).toBe('levé');
      expect(par.Zzc[idx]).toBe('aggravé');
    });

    // ── DÉFAUT D-02 : « stable » là où la synthèse dit « non évalué » ─────
    test("V-43b — DÉFAUT D-02 · une personne JAMAIS réévaluée doit sortir « non évalué », pas « stable »", async () => {
      const idx = entetes.indexOf('Frein mobilité — évolution');
      const par = Object.fromEntries(lignes.map((l) => [l[0], l]));
      // Zzb a un diagnostic (mobilité 3) et AUCUN entretien réalisé : rien n'a
      // été mesuré une seconde fois.
      expect(par.Zzb[idx]).toBe('non évalué');
    });

    test("V-43c — DÉFAUT D-02 · et les deux documents transmis à l'autorité se contredisent", async () => {
      const { composerDialogueGestion } = require('../../src/services/dialogue-gestion');
      const s = await composerDialogueGestion({ annee: AN, trimestre: null });
      const axe = s.blocs['3_freins'].par_axe.find((a) => a.axe === 'mobilite');
      const idx = entetes.indexOf('Frein mobilité — évolution');
      const par = Object.fromEntries(lignes.map((l) => [l[0], l]));
      // La synthèse compte Zzb en « non évalué » (elle lit la dernière
      // évaluation SANS repli sur le diagnostic) ; l'export (d) écrit
      // « stable » pour la même personne, la même année.
      expect(axe.non_evalues).toBeGreaterThanOrEqual(1);
      expect(par.Zzb[idx]).toBe('non évalué');
    });

    test('V-44 — le judiciaire n\'existe qu\'en variante réservée (48 colonnes)', async () => {
      expect(entetes.filter((h) => /judiciaire/i.test(h))).toHaveLength(0);
      const r = await auth(request(app).get(`/api/exports/insertion-freins?format=csv&sensibles=1&cip=${CIP_ID}`), 'ADMIN');
      const h = cellules(r.text.replace(/^﻿/, '').split('\n')[0]);
      expect(h).toHaveLength(48);
      expect(h.filter((x) => /judiciaire/i.test(x))).toHaveLength(3); // valeur + entrée + évolution
    });

    test('V-45 — quotité contractuelle : le contrat en cours prime sur la fiche', () => {
      const idx = entetes.indexOf('Heures par semaine (quotité contractuelle)');
      const par = Object.fromEntries(lignes.map((l) => [l[0], l]));
      expect(par.Zza[idx]).toBe('28');   // contrat 28 h, fiche 26 h
      expect(par.Zzb[idx]).toBe('20');   // aucun contrat → fiche
    });

    // ── DÉFAUT D-03 : « 0 » pour une personne dont RIEN n'a été relevé ────
    test("V-46 — DÉFAUT D-03 · « Semaines sous 15 h » doit rester VIDE quand aucune semaine n'est relevée", async () => {
      const idx = entetes.indexOf('Semaines sous 15 h (année)');
      const { activiteHebdoCohorte } = require('../../src/services/activite-hebdo');
      const m = await activiteHebdoCohorte({ employeeIds: [E.a], annee: AN });
      // Le moteur SAIT que rien n'a été relevé — il rend l'information.
      expect(m.get(E.a).nb_semaines_relevees).toBe(0);
      // L'export, lui, imprime « 0 », qui se lit « jamais sous le plancher ».
      const par = Object.fromEntries(lignes.map((l) => [l[0], l]));
      expect(par.Zza[idx]).toBe('');
    });

    test('V-47 — journal sous le code ENRICHI, distinct du code SENSIBLE', async () => {
      const avant = await dernierIdJournal(pool);
      await auth(request(app).get(`/api/exports/insertion-freins?format=csv&cip=${CIP_ID}`), 'ADMIN');
      const t = await journalParAction(pool, 'EXPORT_INSERTION_FREINS_ENRICHI', avant);
      expect(t).toHaveLength(1);
      expect(t[0].details).toMatchObject({ sensibles: false, lignes: 3 });

      const avant2 = await dernierIdJournal(pool);
      await auth(request(app).get(`/api/exports/insertion-freins?format=csv&sensibles=1&cip=${CIP_ID}`), 'ADMIN');
      expect(await journalParAction(pool, 'EXPORT_INSERTION_FREINS_SENSIBLE', avant2)).toHaveLength(1);
      expect(await journalParAction(pool, 'EXPORT_INSERTION_FREINS_ENRICHI', avant2)).toHaveLength(0);
    });

    test('V-48 — 409 EXPORT_VIDE sur un périmètre sans personne, aucun journal écrit', async () => {
      const avant = await dernierIdJournal(pool);
      const r = await auth(request(app).get(`/api/exports/insertion-freins?cip=${CIP_VIDE}`), 'ADMIN');
      expect(r.status).toBe(409);
      expect(r.body.code).toBe('EXPORT_VIDE');
      expect(await journalParAction(pool, 'EXPORT_INSERTION_FREINS_ENRICHI', avant)).toHaveLength(0);
    });

    test('V-49 — la complétude porte sur les 45 colonnes et « non évalué » n\'y compte pas', async () => {
      const r = await auth(request(app).get(`/api/exports/insertion-freins/completude?cip=${CIP_ID}`), 'ADMIN');
      expect(r.status).toBe(200);
      expect(r.body.total).toBe(3);
      expect(r.body.colonnes).toHaveLength(45);
      const evo = r.body.colonnes.find((c) => c.colonne === 'Frein mobilité — évolution');
      // DÉFAUT D-02 : « non évalué » ne compte pas comme renseigné — encore
      // faut-il que la colonne le produise. Zzb n'a jamais été réévaluée.
      expect(evo.renseigne).toBe(2);
      expect(evo.pct).toBe(67);
      const sem = r.body.colonnes.find((c) => c.colonne === 'Semaines sous 15 h (année)');
      // DÉFAUT D-03 : la colonne est comptée « renseignée » à 100 % alors
      // qu'aucune semaine n'a été relevée pour personne.
      expect(sem.pct).toBe(0);
    });

    test('V-50 — l\'export XLSX se génère réellement (exceljs + les colonnes du cadre)', async () => {
      const r = await auth(request(app).get(`/api/exports/insertion-freins?format=xlsx&cip=${CIP_ID}`), 'ADMIN')
        .buffer().parse((res, cb) => {
          const chunks = []; res.on('data', (c) => chunks.push(c));
          res.on('end', () => cb(null, Buffer.concat(chunks)));
        });
      expect(r.status).toBe(200);
      expect(r.body.length).toBeGreaterThan(5000);
      expect(r.body.slice(0, 2).toString()).toBe('PK'); // archive ZIP → xlsx réel
    });

    test('V-51 — MANAGER et QHSE refusés sur l\'export nominatif', async () => {
      expect((await auth(request(app).get(`/api/exports/insertion-freins?cip=${CIP_ID}`), 'MANAGER')).status).toBe(403);
      const q = await request(app).get(`/api/exports/insertion-freins?cip=${CIP_ID}`)
        .set('Authorization', `Bearer ${U.QHSE.token}`);
      expect(q.status).toBe(403);
    });

    // ── DÉFAUT D-01 : les dates glissent d'un jour hors UTC ────────────────
    test('V-52 — DÉFAUT D-01 · les dates de l\'export suivent le fuseau du processus', () => {
      const idxN = entetes.indexOf('Date de naissance');
      const idxB = entetes.indexOf('Date de constat BRSA');
      const par = Object.fromEntries(lignes.map((l) => [l[0], l]));
      // Valeurs SAISIES : naissance 1990-06-15, constat BRSA 2026-01-05.
      expect(par.Zza[idxN]).toBe('1990-06-15');
      expect(par.Zza[idxB]).toBe(`${AN}-01-05`);
    });
  });

  // ═════════════════════════════════════════════════════════════════════
  // 2. Les trois saisies (DORA, aide, débouché)
  // ═════════════════════════════════════════════════════════════════════
  describe('saisies DORA / aide / débouché', () => {
    let actionId; let pmsmpId;

    test('V-53 — POST action : DORA https accepté, écrit en base', async () => {
      const r = await auth(request(app).post('/api/insertion/action-plans'), 'ADMIN').send({
        employee_id: E.a, action_label: 'Orientation mobilité', category: 'job_dating',
        frein_type: 'mobilite', dora_service: 'Plateforme mobilité',
        dora_url: 'https://dora.inclusion.beta.gouv.fr/s/42', dora_resultat: 'pris_en_charge',
        aide_nature: 'mobilite', aide_organisme: 'Département 76', aide_montant: 150.5,
      });
      expect(r.status).toBe(201);
      actionId = r.body.id;
      const l = await pool.query('SELECT * FROM cip_action_plans WHERE id = $1', [actionId]);
      expect(l.rows[0].dora_url).toBe('https://dora.inclusion.beta.gouv.fr/s/42');
      expect(l.rows[0].dora_resultat).toBe('pris_en_charge');
      expect(Number(l.rows[0].aide_montant)).toBe(150.5);
      expect(l.rows[0].category).toBe('job_dating');
    });

    // ── DÉFAUT D-07 : les compteurs d'actions échappent au k-anonymat ─────
    test("V-53b — DÉFAUT D-07 · sur un axe dont les PERSONNES sont masquées, les actions, l'orientation DORA et le montant d'aide sortent en clair", async () => {
      const { composerDialogueGestion } = require('../../src/services/dialogue-gestion');
      const s = await composerDialogueGestion({ annee: AN, trimestre: null });
      const axe = s.blocs['3_freins'].par_axe.find((a) => a.axe === 'mobilite');
      // La cohorte de cette suite compte 3 personnes : le nombre de personnes
      // concernées par l'axe est donc SUPPRIMÉ…
      expect(axe.concernes_entree).toBeNull();
      // …et les compteurs du MÊME axe, qui comptent au moins une personne
      // chacun, devraient l'être aussi.
      expect(axe.actions_engagees).toBeNull();
      expect(axe.orientations_dora).toBeNull();
      expect(axe.dora_resultats.pris_en_charge).toBeNull();
    });

    test("V-53c — DÉFAUT D-07 · le montant d'une aide portée par une seule personne est publié tel quel", async () => {
      const { composerDialogueGestion } = require('../../src/services/dialogue-gestion');
      const s = await composerDialogueGestion({ annee: AN, trimestre: null });
      const aide = (s.blocs['4_accompagnement'].aides_mobilisees || []).find((a) => a.nature === 'mobilite');
      expect(aide).toBeDefined();
      // 1 aide, 150,50 € : sur une cohorte de 3, la ligne désigne une personne.
      expect(aide.n).toBeNull();
      expect(aide.montant_total).toBeNull();
    });

    test('V-54 — http et javascript: refusés (400), rien n\'est écrit', async () => {
      for (const url of ['http://dora.inclusion.beta.gouv.fr/s/1', 'javascript:alert(1)', 'data:text/html,x']) {
        const r = await auth(request(app).post('/api/insertion/action-plans'), 'ADMIN').send({
          employee_id: E.a, action_label: 'X', category: 'frein', dora_url: url,
        });
        expect([url, r.status]).toEqual([url, 400]);
      }
      const n = (await pool.query("SELECT COUNT(*)::int AS n FROM cip_action_plans WHERE action_label = 'X'")).rows[0].n;
      expect(n).toBe(0);
    });

    test('V-55 — montant négatif refusé (400) ; null accepté ; 0 accepté', async () => {
      const neg = await auth(request(app).post('/api/insertion/action-plans'), 'ADMIN').send({
        employee_id: E.a, action_label: 'Neg', category: 'frein', aide_nature: 'sante', aide_montant: -5,
      });
      expect(neg.status).toBe(400);
      const nul = await auth(request(app).post('/api/insertion/action-plans'), 'ADMIN').send({
        employee_id: E.a, action_label: 'Nul', category: 'frein', aide_nature: 'sante', aide_montant: null,
      });
      expect(nul.status).toBe(201);
      expect(nul.body.aide_montant).toBeNull();
      const zero = await auth(request(app).post('/api/insertion/action-plans'), 'ADMIN').send({
        employee_id: E.a, action_label: 'Zero', category: 'frein', aide_nature: 'sante', aide_montant: 0,
      });
      expect(zero.status).toBe(201);
    });

    // ── DÉFAUT D-05 : un montant démesuré tombe en 500 ────────────────────
    test("V-55b — DÉFAUT D-05 · un montant hors capacité de la colonne doit être refusé en 400, pas en 500", async () => {
      const r = await auth(request(app).post('/api/insertion/action-plans'), 'ADMIN').send({
        employee_id: E.a, action_label: 'Demesure', category: 'frein',
        aide_nature: 'financiere_urgence', aide_montant: 999999999999,
      });
      // NUMERIC(9,2) déborde (22003) : le validateur borne le minimum, pas le
      // maximum — la saisie rend « Erreur serveur » sans dire quoi corriger.
      expect(r.status).toBe(400);
    });

    test('V-56 — catégorie hors liste refusée AVANT la base ; formation_fle acceptée', async () => {
      const ko = await auth(request(app).post('/api/insertion/action-plans'), 'ADMIN').send({
        employee_id: E.a, action_label: 'Y', category: 'inconnue',
      });
      expect(ko.status).toBe(400);
      const ok = await auth(request(app).post('/api/insertion/action-plans'), 'ADMIN').send({
        employee_id: E.a, action_label: 'FLE', category: 'formation_fle',
      });
      expect(ok.status).toBe(201);
    });

    test('V-57 — PUT : nature d\'aide hors liste refusée, résultat DORA hors liste refusé', async () => {
      expect((await auth(request(app).put(`/api/insertion/action-plans/${actionId}`), 'ADMIN')
        .send({ aide_nature: 'nimporte' })).status).toBe(400);
      expect((await auth(request(app).put(`/api/insertion/action-plans/${actionId}`), 'ADMIN')
        .send({ dora_resultat: 'nimporte' })).status).toBe(400);
      const ok = await auth(request(app).put(`/api/insertion/action-plans/${actionId}`), 'ADMIN')
        .send({ dora_resultat: 'sans_suite', aide_montant: 12 });
      expect(ok.status).toBe(200);
      expect(ok.body.dora_resultat).toBe('sans_suite');
    });

    test('V-58 — PMSMP : débouché hors liste refusé ; embauche_accueillant DÉDUIT', async () => {
      const ko = await auth(request(app).post('/api/insertion/pmsmp'), 'ADMIN').send({
        employee_id: E.b, entreprise: 'Beta', objet: 'decouvrir_metier',
        date_debut: `${AN}-05-01`, date_fin: `${AN}-05-10`, debouche: 'hors_liste',
      });
      expect(ko.status).toBe(400);

      const ok = await auth(request(app).post('/api/insertion/pmsmp'), 'ADMIN').send({
        employee_id: E.b, entreprise: 'Beta', objet: 'decouvrir_metier',
        date_debut: `${AN}-05-01`, date_fin: `${AN}-05-10`,
        debouche: 'embauche_accueillant', debouche_date: `${AN}-05-20`,
      });
      expect(ok.status).toBe(201);
      pmsmpId = ok.body.id;
      const l = await pool.query('SELECT * FROM insertion_pmsmp WHERE id = $1', [pmsmpId]);
      expect(l.rows[0].embauche_accueillant).toBe(true);

      const autre = await auth(request(app).put(`/api/insertion/pmsmp/${pmsmpId}`), 'ADMIN')
        .send({ debouche: 'formation' });
      expect(autre.status).toBe(200);
      const l2 = await pool.query('SELECT * FROM insertion_pmsmp WHERE id = $1', [pmsmpId]);
      expect(l2.rows[0].embauche_accueillant).toBe(false);

      const inconnu = await auth(request(app).put(`/api/insertion/pmsmp/${pmsmpId}`), 'ADMIN')
        .send({ debouche: 'inconnu' });
      expect(inconnu.status).toBe(200);
      const l3 = await pool.query('SELECT * FROM insertion_pmsmp WHERE id = $1', [pmsmpId]);
      expect(l3.rows[0].embauche_accueillant).toBeNull();   // « on ne sait pas » ≠ « non »
    });

    test('V-59 — GET /insertion/:id rend le débouché et l\'orientation DORA', async () => {
      const r = await auth(request(app).get(`/api/insertion/${E.a}`), 'ADMIN');
      expect(r.status).toBe(200);
      const act = (r.body.action_plans || []).find((a) => a.id === actionId);
      expect(act).toBeDefined();
      expect(act.dora_service).toBe('Plateforme mobilité');
      expect(act.dora_resultat).toBe('sans_suite');
      const pm = (r.body.pmsmp || [])[0];
      expect(pm).toBeDefined();
      expect(pm).toHaveProperty('debouche');
    });

    test('V-60 — MANAGER : le masquage existant est inchangé sur les actions DORA', async () => {
      const r = await auth(request(app).get(`/api/insertion/${E.a}`), 'MANAGER');
      expect(r.status).toBe(200);
      const brut = JSON.stringify(r.body);
      expect(brut).not.toMatch(/frein_judiciaire["']?\s*:\s*[1-5]/);
    });

    test('V-61 — aucune fuite de connexion sur les refus 400 répétés', async () => {
      const avant = etatPool(pool);
      for (let i = 0; i < 8; i++) {
        await auth(request(app).post('/api/insertion/action-plans'), 'ADMIN')
          .send({ employee_id: E.a, action_label: 'Z', category: 'inconnue' });
        await auth(request(app).get(`/api/exports/insertion-freins?cip=${CIP_VIDE}`), 'ADMIN');
      }
      await new Promise((r) => setTimeout(r, 200));
      const apres = etatPool(pool);
      expect(apres.waiting).toBe(0);
      expect(apres.total - apres.idle).toBeLessThanOrEqual(Math.max(1, avant.total - avant.idle));
    });
  });
});
