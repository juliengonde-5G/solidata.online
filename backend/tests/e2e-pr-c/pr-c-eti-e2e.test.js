// ═══════════════════════════════════════════════════════════════════════════
// PR C lot 5 — ÉCRAN ETI À JETON PUBLIC, SUR POSTGRESQL RÉEL
//
// Ce que cette suite prouve, et que le `pg` simulé ne pouvait pas prouver :
//   · le jeton est réellement unique en base (index partiel), réellement
//     remplacé à la régénération (l'ancien lien MEURT), réellement expiré à la
//     date posée par `make_interval` ;
//   · la charge publique ne porte QUE les clés du § 5.3 — vérifié sur
//     `Object.keys` de la réponse, pas sur l'intention du code ;
//   · l'écriture par jeton pose `validations = {role:'eti', mode:'jeton'}` et
//     HISTORISE l'entretien réalisé dans `insertion_milestones_history` ;
//   · le journal RGPD porte `user_id` NULL (personne n'est connecté) ;
//   · `eti_token` ne sort d'AUCUNE surface authentifiée (fiche, entretien,
//     renouvellements), et l'anonymisation le retire.
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const {
  RUN, creerComptes, purgerPrC, creerSalarie, journalRgpd, etatPool, jourParisDecale, decalerJours, aujourdhuiParis,
} = require('./_helpers');

jest.mock('../../src/middleware/activity-logger', () => ({
  autoLogActivity: () => (req, res, next) => next(),
  logActivity: () => {},
}));

const express = require('express');
const request = require('supertest');
const pool = require('../../src/config/database');

const app = express();
app.use(express.json());
app.use('/api/insertion', require('../../src/routes/insertion'));
// Monté EXACTEMENT comme dans `src/index.js` : hors `authenticate`.
app.use('/api/eti', require('../../src/routes/insertion/eti-public'));

jest.setTimeout(180000);

const PREFIXE = 'jest_prC_eti';
const M = { a: 'PRCETI_A', b: 'PRCETI_B', anon: 'PRCETI_ANON' };
const MATS = Object.values(M);
let U; let empA; let empB; let empAnon;
let msA; let msB; let msRealise; let msDiag; let msAnon;

const auth = (r, role) => r.set('Authorization', `Bearer ${U[role].token}`);

async function creerEntretien(employeeId, champs = {}) {
  const base = { milestone_type: 'renouvellement', due_date: jourParisDecale(20), status: 'planifie', titre: 'Renouvellement' };
  const c = { employee_id: employeeId, ...base, ...champs };
  const cols = Object.keys(c);
  const r = await pool.query(
    `INSERT INTO insertion_milestones (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
    cols.map((k) => c[k])
  );
  return r.rows[0].id;
}

const tokenDe = async (id) => (await pool.query('SELECT eti_token, eti_token_expires_at FROM insertion_milestones WHERE id = $1', [id])).rows[0];

(RUN ? describe : describe.skip)('PR C lot 5 — écran ETI à jeton (PostgreSQL réel)', () => {
  beforeAll(async () => {
    await purgerPrC(pool, { matricules: MATS, usernamePrefix: PREFIXE });
    U = await creerComptes(pool, PREFIXE, ['ADMIN', 'RH', 'MANAGER']);
    empA = await creerSalarie(pool, M.a, {
      first_name: 'Yann', last_name: 'Encadre', insertion_status: 'en_parcours',
      position: 'Agent de tri', contract_end: jourParisDecale(30), referent_unique_type: 'cms',
      manager_id: null,
    });
    empB = await creerSalarie(pool, M.b, {
      first_name: 'Bea', last_name: 'Autre', insertion_status: 'en_parcours', position: 'Agent de collecte',
    });
    empAnon = await creerSalarie(pool, M.anon, {
      first_name: 'Ana', last_name: 'Anonyme', insertion_status: 'en_parcours', birth_date: '1980-02-02',
    });
    msA = await creerEntretien(empA);
    msB = await creerEntretien(empB);
    msRealise = await creerEntretien(empA, { status: 'realise', completed_date: jourParisDecale(-1), titre: 'Renouvellement réalisé' });
    msDiag = await creerEntretien(empA, { milestone_type: 'diagnostic_accueil', titre: 'Diagnostic' });
    msAnon = await creerEntretien(empAnon);
  });

  afterAll(async () => {
    await purgerPrC(pool, { matricules: MATS, employeeIds: [empAnon], usernamePrefix: PREFIXE });
    await pool.end();
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 1. Génération du lien (authentifiée)
  // ═════════════════════════════════════════════════════════════════════════
  describe('POST /api/insertion/renouvellements/:id/lien-eti', () => {
    test('V-43 ADMIN : 201, jeton hex 32 et échéance à +60 jours (heure de Paris)', async () => {
      const r = await auth(request(app).post(`/api/insertion/renouvellements/${msA}/lien-eti`), 'ADMIN');
      expect(r.status).toBe(201);
      expect(r.body.lien).toMatch(/\/eti\/renouvellement\/[0-9a-f]{32}$/);
      const t = await tokenDe(msA);
      expect(t.eti_token).toMatch(/^[0-9a-f]{32}$/);
      const attendu = decalerJours(aujourdhuiParis(), 60);
      const pose = new Date(t.eti_token_expires_at);
      // ± 1 jour : la borne est posée par `NOW() + make_interval(days => 60)`,
      // et le jour civil se lit à Paris.
      expect(Math.abs(new Date(`${attendu}T12:00:00Z`) - pose)).toBeLessThan(36 * 3600 * 1000);
      expect(r.body.expire_le).toBeTruthy();
    });

    test('V-44 la génération est journalisée, avec le PRÉFIXE du jeton et jamais le jeton', async () => {
      const j = await journalRgpd(pool, 'INSERTION_ETI_LIEN_GENERATION', empA);
      expect(j.length).toBeGreaterThanOrEqual(1);
      const d = typeof j[0].details === 'string' ? JSON.parse(j[0].details) : j[0].details;
      expect(d.token_prefix).toHaveLength(6);
      const t = await tokenDe(msA);
      expect(JSON.stringify(d)).not.toContain(t.eti_token);
      expect(d.validite_jours).toBe(60);
    });

    test('V-45 régénérer REMPLACE : l\'ancien jeton ne répond plus (404)', async () => {
      const ancien = (await tokenDe(msA)).eti_token;
      const r = await auth(request(app).post(`/api/insertion/renouvellements/${msA}/lien-eti`), 'ADMIN');
      expect(r.status).toBe(201);
      const nouveau = (await tokenDe(msA)).eti_token;
      expect(nouveau).not.toBe(ancien);
      const old = await request(app).get(`/api/eti/renouvellement/${ancien}`);
      expect(old.status).toBe(404);
      expect(old.body.code).toBe('LIEN_INCONNU');
    });

    test('V-46 un entretien qui n\'est pas un renouvellement → 400 TYPE_INVALIDE', async () => {
      const r = await auth(request(app).post(`/api/insertion/renouvellements/${msDiag}/lien-eti`), 'ADMIN');
      expect(r.status).toBe(400);
      expect(r.body.code).toBe('TYPE_INVALIDE');
      expect((await tokenDe(msDiag)).eti_token).toBeNull();
    });

    test('V-47 un entretien VERROUILLÉ → 409, aucun jeton posé', async () => {
      const verrouille = await creerEntretien(empA, { status: 'realise', locked_at: new Date().toISOString() });
      const r = await auth(request(app).post(`/api/insertion/renouvellements/${verrouille}/lien-eti`), 'ADMIN');
      expect(r.status).toBe(409);
      expect((await tokenDe(verrouille)).eti_token).toBeNull();
    });

    test('V-48 entretien inexistant → 404', async () => {
      const r = await auth(request(app).post('/api/insertion/renouvellements/99999999/lien-eti'), 'ADMIN');
      expect(r.status).toBe(404);
    });

    test('V-49 MANAGER non encadrant → 403 ; encadrant du salarié → 201', async () => {
      const refus = await auth(request(app).post(`/api/insertion/renouvellements/${msB}/lien-eti`), 'MANAGER');
      expect(refus.status).toBe(403);
      expect(refus.body.code).toBe('renouvellement_non_autorise');
      expect((await tokenDe(msB)).eti_token).toBeNull();

      // `managerOwnsEmployee` : le compte MANAGER est rattaché à la fiche
      // encadrant du salarié.
      const fiche = await pool.query(
        `INSERT INTO employees (malibou_id, first_name, last_name, user_id, is_active)
         VALUES ('PRCETI_MGR', 'Manu', 'Encadrant', $1, true) RETURNING id`, [U.MANAGER.id]
      );
      await pool.query('UPDATE employees SET manager_id = $1 WHERE id = $2', [fiche.rows[0].id, empB]);
      const ok = await auth(request(app).post(`/api/insertion/renouvellements/${msB}/lien-eti`), 'MANAGER');
      expect(ok.status).toBe(201);
      await pool.query('DELETE FROM employees WHERE malibou_id = $1', ['PRCETI_MGR']);
    });

    test('V-50 l\'index UNIQUE partiel n\'empêche pas des dizaines d\'entretiens SANS jeton', async () => {
      const r = await pool.query('SELECT COUNT(*)::int AS n FROM insertion_milestones WHERE eti_token IS NULL');
      expect(r.rows[0].n).toBeGreaterThan(1);
      // …et il empêche bien deux entretiens de porter le MÊME jeton.
      const t = (await tokenDe(msA)).eti_token;
      await expect(pool.query('UPDATE insertion_milestones SET eti_token = $1 WHERE id = $2', [t, msDiag]))
        .rejects.toMatchObject({ code: '23505' });
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 2. Lecture publique
  // ═════════════════════════════════════════════════════════════════════════
  describe('GET /api/eti/renouvellement/:token', () => {
    test('V-51 200 avec EXACTEMENT les clés du § 5.3 — et jamais employee_id', async () => {
      const t = (await tokenDe(msA)).eti_token;
      const r = await request(app).get(`/api/eti/renouvellement/${t}`);
      expect(r.status).toBe(200);
      expect(Object.keys(r.body).sort()).toEqual(
        ['avis', 'contract_end', 'duree_mois', 'expire_le', 'formulaire', 'lecture_seule', 'nom', 'poste', 'prenom'].sort()
      );
      expect(r.body.prenom).toBe('Yann');
      expect(r.body.poste).toBe('Agent de tri');
      const brut = JSON.stringify(r.body);
      for (const interdit of ['employee_id', 'frein', 'referent', 'brsa', 'insertion_status', 'milestone', 'id']) {
        expect(brut.toLowerCase()).not.toContain(`"${interdit}`);
      }
    });

    test('V-52 jeton inconnu ou malformé → 404 UNIFORME (aucun oracle d\'existence)', async () => {
      const a = await request(app).get('/api/eti/renouvellement/ffffffffffffffffffffffffffffffff');
      const b = await request(app).get('/api/eti/renouvellement/pas-un-jeton');
      expect(a.status).toBe(404);
      expect(b.status).toBe(404);
      expect(a.body).toEqual(b.body);
    });

    test('V-53 jeton EXPIRÉ → 410 LIEN_EXPIRE', async () => {
      const t = (await tokenDe(msA)).eti_token;
      await pool.query("UPDATE insertion_milestones SET eti_token_expires_at = NOW() - INTERVAL '1 day' WHERE id = $1", [msA]);
      const r = await request(app).get(`/api/eti/renouvellement/${t}`);
      expect(r.status).toBe(410);
      expect(r.body.code).toBe('LIEN_EXPIRE');
      await pool.query("UPDATE insertion_milestones SET eti_token_expires_at = NOW() + INTERVAL '30 days' WHERE id = $1", [msA]);
    });

    test('V-54 entretien CLÔTURÉ (locked_at) → 410 ENTRETIEN_CLOTURE', async () => {
      await pool.query('UPDATE insertion_milestones SET eti_token = $1, eti_token_expires_at = NOW() + INTERVAL \'30 days\', locked_at = NOW() WHERE id = $2',
        ['a'.repeat(32), msRealise]);
      const r = await request(app).get(`/api/eti/renouvellement/${'a'.repeat(32)}`);
      expect(r.status).toBe(410);
      expect(r.body.code).toBe('ENTRETIEN_CLOTURE');
      await pool.query('UPDATE insertion_milestones SET locked_at = NULL WHERE id = $1', [msRealise]);
    });

    test('V-55 toute autre adresse sous /api/eti → 404 uniforme', async () => {
      const r = await request(app).get('/api/eti/salaries');
      expect(r.status).toBe(404);
      expect(r.body.code).toBe('LIEN_INCONNU');
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 3. Écriture publique
  // ═════════════════════════════════════════════════════════════════════════
  describe('PUT /api/eti/renouvellement/:token', () => {
    test('V-56 un 4e champ est refusé (400 champs_refuses) sans rien écrire', async () => {
      const t = (await tokenDe(msA)).eti_token;
      const r = await request(app).put(`/api/eti/renouvellement/${t}`)
        .send({ renouvellement_avis: 'favorable', status: 'realise', observations: 'x' });
      expect(r.status).toBe(400);
      expect(r.body.champs_refuses.sort()).toEqual(['observations', 'status']);
      const ms = await pool.query('SELECT renouvellement_avis, status FROM insertion_milestones WHERE id = $1', [msA]);
      expect(ms.rows[0].renouvellement_avis).toBeNull();
      expect(ms.rows[0].status).toBe('planifie');
    });

    test('V-57 les 3 champs sont écrits et `validations` porte {role:eti, mode:jeton}', async () => {
      const t = (await tokenDe(msA)).eti_token;
      const r = await request(app).put(`/api/eti/renouvellement/${t}`).send({
        renouvellement_form: { assiduite: 4, motivation: 5, autonomie: 3 },
        renouvellement_avis: 'favorable_reserves',
        renouvellement_duree_mois: 4,
      });
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ ok: true });   // jamais la ligne
      const ms = await pool.query(
        'SELECT renouvellement_form, renouvellement_avis, renouvellement_duree_mois, validations FROM insertion_milestones WHERE id = $1', [msA]
      );
      // `rempli_par: 'eti'` est posé PAR LE SERVEUR (correctif B-02) : c'est
      // lui qui autorise la relecture publique de ces réponses, et il ne doit
      // pas dépendre de ce que le client envoie.
      expect(ms.rows[0].renouvellement_form).toEqual({ assiduite: 4, motivation: 5, autonomie: 3, rempli_par: 'eti' });
      expect(ms.rows[0].renouvellement_avis).toBe('favorable_reserves');
      expect(ms.rows[0].renouvellement_duree_mois).toBe(4);
      const v = ms.rows[0].validations;
      const eti = (Array.isArray(v) ? v : []).find((x) => x.role === 'eti');
      expect(eti).toMatchObject({ role: 'eti', mode: 'jeton' });
      expect(eti.token_prefix).toBe(t.slice(0, 6));
    });

    test('V-58 le journal RGPD porte user_id NULL et le préfixe du jeton', async () => {
      const j = await journalRgpd(pool, 'INSERTION_ETI_FORMULAIRE_JETON', empA);
      expect(j.length).toBeGreaterThanOrEqual(1);
      expect(j[0].user_id).toBeNull();
      const d = typeof j[0].details === 'string' ? JSON.parse(j[0].details) : j[0].details;
      expect(d.milestone_id).toBe(msA);
      expect(d.token_prefix).toHaveLength(6);
    });

    test('V-59 avis hors liste et durée hors bornes → 400', async () => {
      const t = (await tokenDe(msA)).eti_token;
      const a = await request(app).put(`/api/eti/renouvellement/${t}`).send({ renouvellement_avis: 'excellent' });
      expect(a.status).toBe(400);
      const b = await request(app).put(`/api/eti/renouvellement/${t}`).send({ renouvellement_duree_mois: 99 });
      expect(b.status).toBe(400);
    });

    test('V-60 un entretien RÉALISÉ est HISTORISÉ avant modification (snapshot partagé)', async () => {
      const t = 'b'.repeat(32);
      await pool.query(
        `UPDATE insertion_milestones SET eti_token = $1, eti_token_expires_at = NOW() + INTERVAL '30 days',
                status = 'realise', locked_at = NULL WHERE id = $2`, [t, msRealise]
      );
      const avant = await pool.query('SELECT COUNT(*)::int AS n FROM insertion_milestones_history WHERE milestone_id = $1', [msRealise]);
      const r = await request(app).put(`/api/eti/renouvellement/${t}`).send({ renouvellement_avis: 'defavorable' });
      expect(r.status).toBe(200);
      const apres = await pool.query(
        'SELECT action, changed_by, snapshot FROM insertion_milestones_history WHERE milestone_id = $1 ORDER BY id DESC', [msRealise]
      );
      expect(apres.rows.length).toBe(avant.rows[0].n + 1);
      expect(apres.rows[0].action).toBe('update');
      expect(apres.rows[0].changed_by).toBeNull();
    });

    test('V-61 jeton expiré → 410 sans écriture ; inconnu → 404', async () => {
      await pool.query("UPDATE insertion_milestones SET eti_token_expires_at = NOW() - INTERVAL '1 day' WHERE id = $1", [msA]);
      const t = (await tokenDe(msA)).eti_token;
      const r = await request(app).put(`/api/eti/renouvellement/${t}`).send({ renouvellement_avis: 'favorable' });
      expect(r.status).toBe(410);
      const ms = await pool.query('SELECT renouvellement_avis FROM insertion_milestones WHERE id = $1', [msA]);
      expect(ms.rows[0].renouvellement_avis).toBe('favorable_reserves'); // valeur de V-57, intacte
      const inconnu = await request(app).put('/api/eti/renouvellement/ffffffffffffffffffffffffffffffff').send({ renouvellement_avis: 'favorable' });
      expect(inconnu.status).toBe(404);
      await pool.query("UPDATE insertion_milestones SET eti_token_expires_at = NOW() + INTERVAL '30 days' WHERE id = $1", [msA]);
    });

    test('V-62 aucune fuite de connexion du pool sur la série de refus', async () => {
      const avant = etatPool(pool);
      for (let i = 0; i < 8; i += 1) {
        await request(app).get('/api/eti/renouvellement/ffffffffffffffffffffffffffffffff');
        await request(app).put('/api/eti/renouvellement/pas-un-jeton').send({ renouvellement_avis: 'favorable' });
      }
      const apres = etatPool(pool);
      expect(apres.waiting).toBe(0);
      expect(apres.total - avant.total).toBeLessThanOrEqual(2);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 4. Le jeton ne sort d'aucune surface authentifiée ; anonymisation
  // ═════════════════════════════════════════════════════════════════════════
  describe('Confidentialité du jeton', () => {
    test('DÉFAUT D-02 — `eti_token` ne doit sortir d\'AUCUNE surface authentifiée', async () => {
      // Le jeton est un IDENTIFIANT DE CONNEXION : il ouvre, sans compte et
      // pendant 60 jours, un formulaire qui engage un renouvellement de
      // contrat. `GET /renouvellements` prend soin de n'exposer que le lien
      // DÉRIVÉ et de le taire quand il est expiré ; les surfaces qui rendent
      // l'entretien entier, elles, le servent en clair.
      const fiche = await auth(request(app).get(`/api/insertion/${empA}`), 'ADMIN');
      expect(fiche.status).toBe(200);
      expect(JSON.stringify(fiche.body)).not.toContain('"eti_token":"');

      const liste = await auth(request(app).get(`/api/insertion/milestones/${empA}`), 'ADMIN');
      expect(liste.status).toBe(200);
      expect(JSON.stringify(liste.body)).not.toContain('"eti_token":"');

      const fileActive = await auth(request(app).get('/api/insertion'), 'ADMIN');
      expect(JSON.stringify(fileActive.body)).not.toContain('eti_token');

      // Troisième porte : la réponse d'une modification d'entretien
      // (`RETURNING *`), qui rend la ligne entière à l'auteur du geste.
      const maj = await auth(request(app).put(`/api/insertion/milestones/${msA}`), 'ADMIN')
        .send({ titre: 'Renouvellement (titre à jour)' });
      expect(maj.status).toBe(200);
      expect(JSON.stringify(maj.body)).not.toContain('"eti_token":"');
    });

    test('DÉFAUT D-02 (suite) — un MANAGER reçoit lui aussi le jeton en clair', async () => {
      const liste = await auth(request(app).get(`/api/insertion/milestones/${empA}`), 'MANAGER');
      expect(liste.status).toBe(200);
      // `maskInsertionRow` retire le judiciaire, la santé et les questionnaires
      // FSE+ — pas le jeton.
      expect(JSON.stringify(liste.body)).not.toContain('"eti_token":"');
    });

    test('V-64 GET /renouvellements expose `lien_eti` DÉRIVÉ, jamais le jeton brut', async () => {
      await pool.query('UPDATE employee_contracts SET is_current = false WHERE employee_id = $1', [empA]).catch(() => {});
      await pool.query(
        `INSERT INTO employee_contracts (employee_id, contract_type, start_date, end_date, is_current, weekly_hours)
         VALUES ($1, 'CDDI', $2::date, $3::date, true, 26)`,
        [empA, jourParisDecale(-300), jourParisDecale(20)]
      );
      const r = await auth(request(app).get('/api/insertion/renouvellements'), 'ADMIN');
      expect(r.status).toBe(200);
      const ligne = r.body.renouvellements.find((x) => x.employee_id === empA);
      expect(ligne).toBeDefined();
      expect(ligne.entretien.lien_eti).toMatch(/\/eti\/renouvellement\/[0-9a-f]{32}$/);
      expect(ligne.entretien).not.toHaveProperty('eti_token');
      expect(ligne.entretien.eti_expire_le).toBeTruthy();
    });

    // ═══ CORRECTIF B-01 (vecteur 2) ═════════════════════════════════════════
    // Le lien n'est pas une donnée de la ligne : c'est un accès SANS COMPTE au
    // formulaire, donc une écriture NON ATTRIBUABLE. Servi à tout rôle du
    // module, il contournait `managerOwnsEmployee` — la garde posée en P1 après
    // la revue Codex PR#74 et dont le commentaire dit « sinon tout encadrant
    // pourrait écrire le renouvellement d'autrui ».
    test('V-64bis un MANAGER NON encadrant ne reçoit PAS le lien (ni par /renouvellements, ni par /echeances)', async () => {
      const r = await auth(request(app).get('/api/insertion/renouvellements'), 'MANAGER');
      expect(r.status).toBe(200);
      const ligne = r.body.renouvellements.find((x) => x.employee_id === empA);
      expect(ligne).toBeDefined();          // il voit la ligne : c'est son écran de travail
      expect(ligne.entretien.lien_eti).toBeNull();   // mais pas la clé
      expect(JSON.stringify(r.body)).not.toContain('/eti/renouvellement/');

      const e = await auth(request(app).get('/api/insertion/echeances'), 'MANAGER');
      expect(e.status).toBe(200);
      expect(JSON.stringify(e.body)).not.toContain('/eti/renouvellement/');
    });

    test('V-64ter l\'encadrant RÉFÉRENT, lui, reçoit le lien (il a le droit d\'écrire ce formulaire)', async () => {
      // `managerOwnsEmployee` reconnaît le CIP référent ET l'encadrant : on
      // rend le compte MANAGER référent de ce salarié, comme en production.
      await pool.query('UPDATE employees SET cip_referent_user_id = $1 WHERE id = $2', [U.MANAGER.id, empA]);
      try {
        const r = await auth(request(app).get('/api/insertion/renouvellements'), 'MANAGER');
        const ligne = r.body.renouvellements.find((x) => x.employee_id === empA);
        expect(ligne.entretien.lien_eti).toMatch(/\/eti\/renouvellement\/[0-9a-f]{32}$/);
      } finally {
        await pool.query('UPDATE employees SET cip_referent_user_id = NULL WHERE id = $1', [empA]);
      }
    });

    test('V-65 un lien EXPIRÉ n\'est plus proposé (ni lien, ni échéance)', async () => {
      await pool.query("UPDATE insertion_milestones SET eti_token_expires_at = NOW() - INTERVAL '1 day' WHERE id = $1", [msA]);
      const r = await auth(request(app).get('/api/insertion/renouvellements'), 'ADMIN');
      const ligne = r.body.renouvellements.find((x) => x.employee_id === empA);
      expect(ligne.entretien.lien_eti).toBeNull();
      expect(ligne.entretien.eti_expire_le).toBeNull();
      await pool.query("UPDATE insertion_milestones SET eti_token_expires_at = NOW() + INTERVAL '30 days' WHERE id = $1", [msA]);
    });

    test('V-66 l\'anonymisation retire le jeton (le lien public meurt avec le dossier)', async () => {
      await auth(request(app).post(`/api/insertion/renouvellements/${msAnon}/lien-eti`), 'ADMIN');
      expect((await tokenDe(msAnon)).eti_token).toMatch(/^[0-9a-f]{32}$/);
      const { anonymizeEmployee } = require('../../src/services/anonymization');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await anonymizeEmployee(client, empAnon);
        await client.query('COMMIT');
      } finally { client.release(); }
      expect((await tokenDe(msAnon)).eti_token).toBeNull();
    });
  });
});
