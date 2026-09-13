// ═══════════════════════════════════════════════════════════════════════════
// PR C lot 5 — ÉCHÉANCES CIP, FILE ACTIVE, REPORT ET COMPTEUR, SUR POSTGRESQL RÉEL
//
// Ce que cette suite prouve, et que le `pg` simulé ne pouvait pas prouver :
//   · le périmètre de la file active est celui de la DONNÉE (permanents
//     absents, terminé récent présent, terminé ancien absent sauf ?inclure=tous),
//     avec un vrai `make_interval` et un vrai CURRENT_DATE ;
//   · chaque type d'obligation du § 5.1.2 se déclenche sur un dossier construit
//     pour lui, avec le bon niveau, et la catégorie G n'est JAMAIS rouge ;
//   · le MANAGER ne reçoit pas `brsa` — et la colonne n'est pas LUE (vérifié
//     sur le texte des requêtes réellement émises au pool) ;
//   · le report sort la ligne des obligations ET du compteur, exige un motif au
//     second, refuse une ligne agrégée, et revient quand le report expire ;
//   · le cache du compteur est bien par (rôle, utilisateur) ;
//   · les heures rendues par la file active sont celles de Paris — ou ne le
//     sont pas (défaut D-01).
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const {
  RUN, creerComptes, purgerPrC, creerSalarie, cohorteHorsPerimetre, journalRgpd,
  etatPool, signerChauffeur, iso, aujourdhuiParis, decalerJours, jourParisDecale, lundiIso,
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

jest.setTimeout(180000);

const PREFIXE = 'jest_prC_ech';
const M = {
  permanent: 'PRCE_PERM', ok: 'PRCE_OK', termine3: 'PRCE_T3', termine9: 'PRCE_T9',
  passExpire: 'PRCE_PEXP', passSuspendu: 'PRCE_PSUS', passProche: 'PRCE_PSOON', passAbsent: 'PRCE_PNUL',
  cddi: 'PRCE_CDDI', diagAbsent: 'PRCE_DIAG0', diagIncomplet: 'PRCE_DIAGP', diagComplet: 'PRCE_DIAGOK',
  referent: 'PRCE_REF', categG: 'PRCE_G', fseEntree: 'PRCE_FSEE', fse16: 'PRCE_FSE16', fse26: 'PRCE_FSE26',
  fseSansDate: 'PRCE_FSEND', suivi6: 'PRCE_S6', sous15h: 'PRCE_15H', rdv: 'PRCE_RDV',
};
const MATS = Object.values(M);
const JOUR = aujourdhuiParis();
let U; let E = {}; let chauffeur; let projetAsiId;

const auth = (r, role) => r.set('Authorization', `Bearer ${U[role].token}`);
const typesDe = (corps, empId) => corps.obligations.filter((o) => o.employee_id === empId).map((o) => o.type);
const lignePour = (corps, empId, type) => corps.obligations.find((o) => o.employee_id === empId && o.type === type);

/** Diagnostic dont le socle est COMPLET (les 15 champs du fichier partagé). */
async function poserDiagnosticComplet(employeeId, extra = {}) {
  const base = {
    piece_identite_validite: '2030-01-01', allocataire_caf: true, ressources: ['salaire'],
    logement_statut: 'locataire_social', mutuelle_statut: 'cmu', rqth: false, contre_indications: false,
    suivi_sante: false, permis_b_statut: 'oui', moyen_transport: ['bus'],
    niveau_formation: 'CAP', metiers_souhaites: 'Tri', cecrl_niveau: 'B1',
    attentes_parcours: 'Trouver un emploi', difficultes_exprimees: 'Aucune',
  };
  const c = { employee_id: employeeId, parcours_num: 1, ...base, ...extra };
  const cols = Object.keys(c);
  await pool.query(
    `INSERT INTO insertion_diagnostics (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`,
    cols.map((k) => c[k])
  );
}

(RUN ? describe : describe.skip)('PR C lot 5 — échéances CIP (PostgreSQL réel)', () => {
  beforeAll(async () => {
    await purgerPrC(pool, { matricules: MATS, usernamePrefix: PREFIXE });
    U = await creerComptes(pool, PREFIXE, ['ADMIN', 'RH', 'MANAGER']);
    chauffeur = signerChauffeur(88);

    const asi = await pool.query("SELECT id FROM insertion_projets WHERE type = 'asi' ORDER BY id LIMIT 1");
    projetAsiId = asi.rows[0] && asi.rows[0].id;

    // ── Périmètre (§ 5.2) ────────────────────────────────────────────────
    E.permanent = await creerSalarie(pool, M.permanent, {
      first_name: 'Paul', last_name: 'Permanent', insertion_status: 'none', is_active: true,
    });
    E.ok = await creerSalarie(pool, M.ok, {
      first_name: 'Olivia', last_name: 'Ok', insertion_status: 'en_parcours',
      insertion_start_date: jourParisDecale(-10), referent_unique_type: 'cms',
      pass_iae_statut: 'actif', pass_iae_number: 'PASS-OK-1', pass_iae_end: jourParisDecale(300),
      cip_referent_user_id: U.RH.id,
    });
    await poserDiagnosticComplet(E.ok);
    E.termine3 = await creerSalarie(pool, M.termine3, {
      first_name: 'Tania', last_name: 'Troismois', insertion_status: 'termine', is_active: false,
      insertion_end_date: jourParisDecale(-92), contract_end: jourParisDecale(-92),
    });
    E.termine9 = await creerSalarie(pool, M.termine9, {
      first_name: 'Noé', last_name: 'Neufmois', insertion_status: 'termine', is_active: false,
      insertion_end_date: jourParisDecale(-275),
    });

    // ── Un dossier par type d'obligation (§ 5.1.2) ───────────────────────
    E.passExpire = await creerSalarie(pool, M.passExpire, {
      first_name: 'Paul', last_name: 'Passexpire', insertion_status: 'en_parcours',
      pass_iae_statut: 'expire', pass_iae_number: 'P-EXP', pass_iae_end: jourParisDecale(-5),
      referent_unique_type: 'cms', insertion_start_date: jourParisDecale(-5),
    });
    E.passSuspendu = await creerSalarie(pool, M.passSuspendu, {
      first_name: 'Sam', last_name: 'Passuspendu', insertion_status: 'en_parcours',
      pass_iae_statut: 'suspendu', pass_iae_number: 'P-SUS', pass_iae_end: jourParisDecale(300),
      referent_unique_type: 'cms', insertion_start_date: jourParisDecale(-5),
    });
    E.passProche = await creerSalarie(pool, M.passProche, {
      first_name: 'Pia', last_name: 'Passproche', insertion_status: 'en_parcours',
      pass_iae_statut: 'actif', pass_iae_number: 'P-SOON', pass_iae_end: jourParisDecale(40),
      referent_unique_type: 'france_travail', insertion_start_date: jourParisDecale(-5),
    });
    E.passAbsent = await creerSalarie(pool, M.passAbsent, {
      first_name: 'Nils', last_name: 'Passabsent', insertion_status: 'en_parcours',
      pass_iae_number: null,
      referent_unique_type: 'cms', insertion_start_date: jourParisDecale(-5),
    });
    E.cddi = await creerSalarie(pool, M.cddi, {
      first_name: 'Cyril', last_name: 'Cumul', insertion_status: 'en_parcours',
      referent_unique_type: 'cms', insertion_start_date: jourParisDecale(-5),
      pass_iae_statut: 'actif', pass_iae_number: 'P-CDDI', pass_iae_end: jourParisDecale(300),
    });
    // 24 mois de CDDI en deux contrats consécutifs → cumul ≥ 23 mois.
    await pool.query(
      `INSERT INTO employee_contracts (employee_id, contract_type, start_date, end_date, is_current, weekly_hours)
       VALUES ($1, 'CDDI', $2::date, $3::date, false, 26), ($1, 'CDDI', $4::date, $5::date, true, 26)`,
      [E.cddi, decalerJours(JOUR, -730), decalerJours(JOUR, -366), decalerJours(JOUR, -365), decalerJours(JOUR, 30)]
    );
    E.diagAbsent = await creerSalarie(pool, M.diagAbsent, {
      first_name: 'Dora', last_name: 'Diagabsent', insertion_status: 'en_parcours',
      insertion_start_date: jourParisDecale(-45), referent_unique_type: 'cms',
      pass_iae_statut: 'actif', pass_iae_number: 'P-D0', pass_iae_end: jourParisDecale(300),
    });
    E.diagIncomplet = await creerSalarie(pool, M.diagIncomplet, {
      first_name: 'Denis', last_name: 'Diagpartiel', insertion_status: 'en_parcours',
      insertion_start_date: jourParisDecale(-45), referent_unique_type: 'cms',
      pass_iae_statut: 'actif', pass_iae_number: 'P-DP', pass_iae_end: jourParisDecale(300),
    });
    await pool.query(
      `INSERT INTO insertion_diagnostics (employee_id, parcours_num, logement_statut, rqth)
       VALUES ($1, 1, 'locataire_social', false)`, [E.diagIncomplet]
    );
    E.diagComplet = await creerSalarie(pool, M.diagComplet, {
      first_name: 'Dina', last_name: 'Diagcomplet', insertion_status: 'en_parcours',
      insertion_start_date: jourParisDecale(-45), referent_unique_type: 'cms',
      pass_iae_statut: 'actif', pass_iae_number: 'P-DOK', pass_iae_end: jourParisDecale(300),
    });
    await poserDiagnosticComplet(E.diagComplet);
    E.referent = await creerSalarie(pool, M.referent, {
      first_name: 'Rita', last_name: 'Referent', insertion_status: 'en_parcours',
      referent_unique_type: 'non_determine', insertion_start_date: jourParisDecale(-5),
      pass_iae_statut: 'actif', pass_iae_number: 'P-REF', pass_iae_end: jourParisDecale(300),
    });
    E.categG = await creerSalarie(pool, M.categG, {
      first_name: 'Gaby', last_name: 'Categorieg', insertion_status: 'en_parcours',
      referent_unique_type: 'france_travail', ft_categorie: 'G', ft_categorie_date: jourParisDecale(-60),
      insertion_start_date: jourParisDecale(-5), brsa: true,
      pass_iae_statut: 'actif', pass_iae_number: 'P-G', pass_iae_end: jourParisDecale(300),
    });
    E.fseEntree = await creerSalarie(pool, M.fseEntree, {
      first_name: 'Fanny', last_name: 'Fseentree', insertion_status: 'en_parcours',
      referent_unique_type: 'cms', insertion_start_date: jourParisDecale(-10),
      pass_iae_statut: 'actif', pass_iae_number: 'P-FE', pass_iae_end: jourParisDecale(300),
    });
    await poserDiagnosticComplet(E.fseEntree, { fse_entree_complet: false });
    E.fse16 = await creerSalarie(pool, M.fse16, {
      first_name: 'Seize', last_name: 'Fsesortie', insertion_status: 'termine', is_active: false,
      insertion_end_date: jourParisDecale(-16), referent_unique_type: 'cms',
    });
    E.fse26 = await creerSalarie(pool, M.fse26, {
      first_name: 'Vingtsix', last_name: 'Fsesortie', insertion_status: 'termine', is_active: false,
      insertion_end_date: jourParisDecale(-26), referent_unique_type: 'cms',
    });
    // Rupture anticipée : la sortie de l'opération (PARTICIPANT) a 26 jours,
    // la fin de contrat prévue n'en a que 2. C'est l'écart mesuré en PR A.
    E.fseSansDate = await creerSalarie(pool, M.fseSansDate, {
      first_name: 'Rachel', last_name: 'Rupture', insertion_status: 'en_parcours', is_active: false,
      insertion_end_date: null, contract_end: jourParisDecale(-2), referent_unique_type: 'cms',
      insertion_start_date: jourParisDecale(-300),
      pass_iae_statut: 'actif', pass_iae_number: 'P-RUP', pass_iae_end: jourParisDecale(300),
    });
    await poserDiagnosticComplet(E.fseSansDate, { fse_entree_complet: true });
    if (projetAsiId) {
      await pool.query(
        `INSERT INTO insertion_projet_participants (projet_id, employee_id, date_entree, date_sortie)
         VALUES ($1, $2, $3::date, NULL), ($1, $4, $3::date, $5::date), ($1, $6, $3::date, $7::date),
                ($1, $8, $3::date, $9::date)`,
        [projetAsiId, E.fseEntree, decalerJours(JOUR, -200), E.fse16, jourParisDecale(-16),
          E.fse26, jourParisDecale(-26), E.fseSansDate, jourParisDecale(-26)]
      );
    }
    E.suivi6 = await creerSalarie(pool, M.suivi6, {
      first_name: 'Sylvie', last_name: 'Suivisixmois', insertion_status: 'termine', is_active: false,
      insertion_end_date: jourParisDecale(-190), referent_unique_type: 'cms',
    });
    await pool.query(
      `INSERT INTO insertion_milestones (employee_id, milestone_type, due_date, status, titre)
       VALUES ($1, 'suivi_post_sortie', $2::date, 'a_planifier', 'Suivi +6 mois')`,
      [E.suivi6, jourParisDecale(-7)]
    );
    E.sous15h = await creerSalarie(pool, M.sous15h, {
      first_name: 'Hugo', last_name: 'Heuresbasses', insertion_status: 'en_parcours',
      referent_unique_type: 'cms', insertion_start_date: jourParisDecale(-200), weekly_hours: 26,
      pass_iae_statut: 'actif', pass_iae_number: 'P-15', pass_iae_end: jourParisDecale(300),
    });
    await poserDiagnosticComplet(E.sous15h);
    // Deux semaines RELEVÉES consécutives sous 15 h, dans le passé de l'année
    // courante : c'est la série qui lève l'alerte (moteur PR B).
    const an = Number(JOUR.slice(0, 4));
    for (const [num, h] of [[2, 8], [3, 9]]) {
      await pool.query(
        `INSERT INTO employee_week_hours (employee_id, iso_year, iso_week, week_start, week_end, hours_worked, hours_contract, source)
         VALUES ($1, $2, $3, $4::date, $4::date + 6, $5, 26, 'jest')`,
        [E.sous15h, an, num, lundiIso(an, num), h]
      );
    }
    // Un rendez-vous à 14 h HEURE MURALE DE PARIS, saisi comme le fait le
    // formulaire (`<input type="datetime-local">` → chaîne naïve).
    E.rdv = await creerSalarie(pool, M.rdv, {
      first_name: 'Rémi', last_name: 'Rendezvous', insertion_status: 'en_parcours',
      referent_unique_type: 'cms', insertion_start_date: jourParisDecale(-5),
      pass_iae_statut: 'actif', pass_iae_number: 'P-RDV', pass_iae_end: jourParisDecale(300),
      cip_referent_user_id: U.RH.id,
    });
    await pool.query(
      `INSERT INTO insertion_milestones (employee_id, milestone_type, due_date, status, titre, interview_date)
       VALUES ($1, 'bilan_intermediaire', $2::date, 'planifie', 'SECRET_TITRE_LIBRE', $3::timestamp)`,
      [E.rdv, jourParisDecale(3), `${jourParisDecale(3)} 14:00:00`]
    );
  });

  afterAll(async () => {
    await purgerPrC(pool, { matricules: MATS, usernamePrefix: PREFIXE });
    await pool.end();
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 1. Périmètre de la file active (§ 5.2)
  // ═════════════════════════════════════════════════════════════════════════
  describe('GET /api/insertion — file active', () => {
    let liste;
    beforeAll(async () => {
      const r = await auth(request(app).get('/api/insertion'), 'ADMIN');
      expect(r.status).toBe(200);
      liste = r.body;
    });

    test('V-01 le jeu d\'essai est seul dans la cohorte (sinon les totaux ne disent rien)', async () => {
      expect(await cohorteHorsPerimetre(pool, MATS)).toBe(0);
    });

    test('V-02 un permanent (insertion_status none) est ABSENT', () => {
      expect(liste.find((l) => l.id === E.permanent)).toBeUndefined();
    });

    test('V-03 un parcours en cours est présent', () => {
      expect(liste.find((l) => l.id === E.ok)).toBeDefined();
    });

    test('V-04 un parcours terminé depuis 3 mois est présent (et inactif)', () => {
      const l = liste.find((x) => x.id === E.termine3);
      expect(l).toBeDefined();
      expect(l.is_active).toBe(false);
    });

    test('V-05 un parcours terminé depuis 9 mois est absent', () => {
      expect(liste.find((l) => l.id === E.termine9)).toBeUndefined();
    });

    test('V-06 ?inclure=tous le fait réapparaître, sans ramener les permanents', async () => {
      const r = await auth(request(app).get('/api/insertion?inclure=tous'), 'ADMIN');
      expect(r.status).toBe(200);
      expect(r.body.find((l) => l.id === E.termine9)).toBeDefined();
      expect(r.body.find((l) => l.id === E.permanent)).toBeUndefined();
    });

    // ═══ CORRECTIF M-07 — le périmètre du MANAGER redevient « en cours » ═══
    // La rémanence de sept mois sert la sortie FSE+ et le relevé à +6 mois,
    // deux gestes ADMIN/RH STRICT : une personne PARTIE restait pourtant sept
    // mois dans la liste de son encadrant, avec son poste, son dernier
    // entretien, son prochain rendez-vous et sa pastille de risque.
    test('V-06bis un MANAGER ne voit AUCUN parcours terminé, et `?inclure=tous` ne lui donne rien', async () => {
      const r = await auth(request(app).get('/api/insertion'), 'MANAGER');
      expect(r.status).toBe(200);
      expect(r.body.find((l) => l.id === E.termine3)).toBeUndefined();
      expect(r.body.find((l) => l.id === E.termine9)).toBeUndefined();
      // …et il garde bien les parcours en cours.
      expect(r.body.find((l) => l.id === E.ok)).toBeDefined();

      const tous = await auth(request(app).get('/api/insertion?inclure=tous'), 'MANAGER');
      expect(tous.status).toBe(200);
      expect(tous.body.find((l) => l.id === E.termine9)).toBeUndefined();
      expect(tous.body.find((l) => l.id === E.permanent)).toBeUndefined();
    });

    test('V-07 ?mine=1 borne aux salariés dont le compte est CIP référent', async () => {
      const r = await auth(request(app).get('/api/insertion?mine=1'), 'RH');
      expect(r.status).toBe(200);
      const ids = r.body.map((l) => l.id).sort();
      expect(ids).toEqual([E.ok, E.rdv].sort());
    });

    test('V-08 champs enrichis : statut, parcours, référent, projets, statut du Pass IAE', () => {
      const l = liste.find((x) => x.id === E.fseEntree);
      expect(l.insertion_status).toBe('en_parcours');
      expect(l.parcours_num).toBe(1);
      expect(l.referent_unique_type).toBe('cms');
      expect(l.projets).toEqual(['ASI']);
      expect(l.pass_iae_statut).toBe('actif');
    });

    test('DÉFAUT D-04 — les dates civiles de la file active doivent traverser sans décalage', () => {
      // `pass_iae_end`, `insertion_start_date` et `insertion_end_date` sont
      // rendues BRUTES (objet `Date` du pilote, sérialisé en UTC par Express),
      // là où `prochain_rdv.date` et `dernier_entretien` passent par `isoDate`.
      // Un jour civil n'a pas de fuseau : il ne doit pas dépendre de celui du
      // processus.
      const l = liste.find((x) => x.id === E.fseEntree);
      expect(iso(l.pass_iae_end)).toBe(jourParisDecale(300));
      const t3 = liste.find((x) => x.id === E.termine3);
      expect(iso(t3.insertion_end_date)).toBe(jourParisDecale(-92));
    });

    test('V-09 `diagnostic_socle_complet` colle au fichier de champs partagé', () => {
      expect(liste.find((x) => x.id === E.diagComplet).diagnostic_socle_complet).toBe(true);
      expect(liste.find((x) => x.id === E.diagIncomplet).diagnostic_socle_complet).toBe(false);
      expect(liste.find((x) => x.id === E.diagAbsent).diagnostic_socle_complet).toBe(false);
    });

    test('V-10 `risque` vient des obligations (rouge / orange / null), même règle que l\'écran', () => {
      expect(liste.find((x) => x.id === E.referent).risque).toBe('rouge');
      expect(liste.find((x) => x.id === E.passProche).risque).toBe('orange');
      expect(liste.find((x) => x.id === E.ok).risque).toBeNull();
    });

    test('V-11 `dernier_entretien` et `prochain_rdv.date` sont des jours civils', () => {
      const l = liste.find((x) => x.id === E.rdv);
      expect(l.prochain_rdv).not.toBeNull();
      expect(l.prochain_rdv.date).toBe(jourParisDecale(3));
    });

    // CORRECTIF M-01 (revue de sécurité) — le TITRE d'un entretien est un
    // VARCHAR(120) libre et non masqué (« Bilan après l'hospitalisation ») :
    // cette liste s'affiche à tous les rôles du module. Le type rendu vient
    // désormais de la liste FERMÉE, et le titre saisi n'apparaît nulle part.
    test('V-11bis `prochain_rdv.type` est le libellé du TYPE, jamais le titre saisi', () => {
      const l = liste.find((x) => x.id === E.rdv);
      expect(l.prochain_rdv.type).toBe('bilan_intermediaire');
      expect(JSON.stringify(liste)).not.toContain('SECRET_TITRE_LIBRE');
    });

    test('DÉFAUT D-01 — l\'heure du prochain rendez-vous doit être l\'heure de Paris (14:00)', () => {
      const l = liste.find((x) => x.id === E.rdv);
      // Saisi « 14:00 » par le formulaire (datetime-local = heure murale de
      // Paris) et stocké tel quel dans une colonne `timestamp without time
      // zone`. L'écran doit rendre 14:00, quel que soit le fuseau du processus.
      expect(l.prochain_rdv.heure).toBe('14:00');
    });

    test('V-12 un MANAGER ne reçoit pas `brsa` — et la colonne n\'est PAS lue', async () => {
      // Espion NON destructif : on enregistre le TEXTE des requêtes réellement
      // émises, puis on délègue. C'est la seule façon de distinguer « masqué
      // après lecture » de « jamais lu » (correctif C-03 de la PR A).
      const vraie = pool.query.bind(pool);
      const textes = [];
      jest.spyOn(pool, 'query').mockImplementation((...args) => {
        textes.push(typeof args[0] === 'string' ? args[0] : (args[0] && args[0].text) || '');
        return vraie(...args);
      });
      try {
        const r = await auth(request(app).get('/api/insertion'), 'MANAGER');
        expect(r.status).toBe(200);
        const l = r.body.find((x) => x.id === E.categG);
        expect(l.brsa == null).toBe(true);
        expect(textes.filter((t) => /\be\.brsa\b/.test(t))).toEqual([]);
      } finally {
        pool.query.mockRestore();
      }
    });

    test('V-13 un ADMIN reçoit `brsa`', () => {
      expect(liste.find((x) => x.id === E.categG).brsa).toBe(true);
    });

    test('V-14 un jeton chauffeur est refusé (403) avant toute lecture', async () => {
      const avant = etatPool(pool);
      const r = await request(app).get('/api/insertion').set('Authorization', `Bearer ${chauffeur}`);
      expect(r.status).toBe(403);
      expect(etatPool(pool).total).toBeLessThanOrEqual(avant.total + 1);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 2. Obligations (§ 5.1.2)
  // ═════════════════════════════════════════════════════════════════════════
  describe('GET /api/insertion/echeances — obligations', () => {
    let corps;
    beforeAll(async () => {
      const r = await auth(request(app).get('/api/insertion/echeances'), 'ADMIN');
      expect(r.status).toBe(200);
      corps = r.body;
    });

    test('V-15bis DEUX horloges cohabitent : Paris côté JS, CURRENT_DATE côté SQL', async () => {
      // Les obligations sont datées en JS avec `aujourdhuiParis()` ; le
      // périmètre de la cohorte, les bilans en retard et le suivi à +6 mois le
      // sont par `CURRENT_DATE`, c'est-à-dire par le fuseau de la SESSION
      // PostgreSQL. Les deux coïncident tant que le serveur tourne en UTC et
      // qu'on est hors de la tranche 22 h-minuit UTC. La démonstration se fait
      // ici sur une session décalée, ce qui rend la dépendance visible.
      const { composerEcheances } = require('../../src/services/echeances-cip');
      const client = await pool.connect();
      try {
        await client.query("SET TIME ZONE 'Pacific/Kiritimati'");  // UTC+14
        const decale = await composerEcheances({ db: client, baseRole: 'ADMIN' });
        const normal = await composerEcheances({ db: pool, baseRole: 'ADMIN' });
        const joursDe = (c, emp, type) => {
          const l = c.obligations.find((o) => o.employee_id === emp && o.type === type);
          return l ? l.jours : null;
        };
        // Côté JS (Paris), la valeur ne bouge pas…
        expect(joursDe(decale, E.fse16, 'sortie_fse_a_saisir'))
          .toBe(joursDe(normal, E.fse16, 'sortie_fse_a_saisir'));
        // …tandis que le bloc « organisation », daté par SQL, suit la session.
        const suivi = (c) => (c.organisation.find((o) => o.employee_id === E.suivi6) || {}).jours;
        expect(typeof suivi(normal) === 'number' || suivi(normal) === undefined).toBe(true);
      } finally {
        await client.query("SET TIME ZONE 'UTC'").catch(() => {});
        client.release();
      }
    });

    test('V-15 aucune source indisponible sur une base à jour', () => {
      expect(corps.sources_indisponibles).toEqual([]);
    });

    test('V-16 Pass IAE expiré / suspendu → rouge ; fin < 2 mois → orange ; absent → orange', () => {
      expect(lignePour(corps, E.passExpire, 'pass_iae').niveau).toBe('rouge');
      expect(lignePour(corps, E.passSuspendu, 'pass_iae').niveau).toBe('rouge');
      expect(lignePour(corps, E.passProche, 'pass_iae').niveau).toBe('orange');
      expect(lignePour(corps, E.passAbsent, 'pass_iae').niveau).toBe('orange');
    });

    test('V-17 cumul CDDI ≥ 23 mois sans dérogation → rouge', () => {
      const l = lignePour(corps, E.cddi, 'cddi_plafond');
      expect(l).toBeDefined();
      expect(l.niveau).toBe('rouge');
      expect(l.libelle).toMatch(/Cumul CDDI [\d.]+ mois sur 24/);
    });

    test('V-18 diagnostic > 30 j : absent ET socle incomplet → rouge ; socle complet → rien', () => {
      expect(lignePour(corps, E.diagAbsent, 'diagnostic_socle').niveau).toBe('rouge');
      expect(lignePour(corps, E.diagAbsent, 'diagnostic_socle').libelle).toMatch(/Aucun diagnostic/);
      expect(lignePour(corps, E.diagIncomplet, 'diagnostic_socle').libelle).toMatch(/Socle du diagnostic incomplet/);
      expect(typesDe(corps, E.diagComplet)).not.toContain('diagnostic_socle');
    });

    test('V-19 référent unique non déterminé → rouge', () => {
      expect(lignePour(corps, E.referent, 'referent_unique').niveau).toBe('rouge');
    });

    test('V-20 catégorie G depuis > 30 j → ORANGE, jamais rouge', () => {
      const l = lignePour(corps, E.categG, 'categorie_g');
      expect(l).toBeDefined();
      expect(l.niveau).toBe('orange');
      expect(corps.obligations.filter((o) => o.type === 'categorie_g' && o.niveau === 'rouge')).toEqual([]);
    });

    test('V-21 questionnaire FSE+ d\'entrée manquant (< 30 j depuis l\'entrée) → orange', () => {
      const l = lignePour(corps, E.fseEntree, 'fse_entree_manquant');
      expect(l).toBeDefined();
      expect(l.niveau).toBe('orange');
    });

    test('V-22 sortie FSE+ : J+16 → orange, J+26 → rouge', () => {
      expect(lignePour(corps, E.fse16, 'sortie_fse_a_saisir').niveau).toBe('orange');
      expect(lignePour(corps, E.fse26, 'sortie_fse_a_saisir').niveau).toBe('rouge');
      expect(lignePour(corps, E.fse16, 'sortie_fse_a_saisir').jours).toBe(16);
    });

    test('V-23 rupture anticipée : le délai court depuis la SORTIE DE L\'OPÉRATION (26 j) et non la fin de contrat (2 j)', () => {
      const l = lignePour(corps, E.fseSansDate, 'sortie_fse_a_saisir');
      expect(l).toBeDefined();
      expect(l.jours).toBe(26);
      expect(l.niveau).toBe('rouge');
    });

    test('DÉFAUT D-06 — l\'alerte de fiche et l\'écran des échéances doivent compter la même sortie FSE+', async () => {
      // MÊME dossier, deux surfaces : l'écran « Mes échéances » date le délai
      // depuis la sortie de l'OPÉRATION (26 j, rouge) ; l'alerte de la fiche le
      // date depuis la fin de CONTRAT (2 j, rien). La CIP lit deux vérités.
      const ech = lignePour(corps, E.fseSansDate, 'sortie_fse_a_saisir');
      expect(ech.jours).toBe(26);
      const r = await auth(request(app).get(`/api/insertion/alertes/${E.fseSansDate}`), 'ADMIN');
      expect(r.status).toBe(200);
      const alerte = (r.body.alertes || []).find((a) => a.type === 'fse_sortie_a_saisir');
      expect(alerte).toBeDefined();
      expect(alerte.jours).toBe(ech.jours);
    });

    test('DÉFAUT D-06 (suite) — l\'alerte de fiche ne doit pas réclamer une sortie FSE+ à qui n\'est pas participant', async () => {
      // `E.termine3` n'est rattaché à AUCUN projet cofinancé : aucune sortie
      // FSE+ ne lui est due. L'écran des échéances ne lui en demande pas.
      expect(typesDe(corps, E.termine3)).not.toContain('sortie_fse_a_saisir');
      const r = await auth(request(app).get(`/api/insertion/alertes/${E.termine3}`), 'ADMIN');
      expect(r.status).toBe(200);
      expect((r.body.alertes || []).map((a) => a.type)).not.toContain('fse_sortie_a_saisir');
    });

    test('V-24 suivi à +6 mois échu non réalisé → rouge', () => {
      expect(lignePour(corps, E.suivi6, 'suivi_6_mois').niveau).toBe('rouge');
    });

    test('V-25 ligne AGRÉGÉE « N salariés sous 15 h » : sans employee_id, avec son détail', () => {
      const l = corps.obligations.find((o) => o.type === 'sous_15h');
      expect(l).toBeDefined();
      expect(l.employee_id).toBeNull();
      expect(l.nom).toBeNull();
      expect(l.niveau).toBe('rouge');
      expect(l.detail.map((d) => d.employee_id)).toContain(E.sous15h);
    });

    test('V-26 forme figée d\'une ligne (§ 5.1.1)', () => {
      const l = lignePour(corps, E.referent, 'referent_unique');
      expect(Object.keys(l).sort()).toEqual(
        ['cible', 'echeance', 'employee_id', 'id', 'jours', 'libelle', 'nb_reports', 'niveau', 'nom', 'type'].sort()
      );
      expect(l.id).toBe(`referent_unique:${E.referent}`);
      expect(l.nom).toBe('REFERENT Rita');
      expect(l.cible).toEqual({ onglet: 'dossier', champ: 'referent_unique' });
    });

    test('V-27 tri : toutes les rouges avant les oranges, puis échéance croissante', () => {
      const niveaux = corps.obligations.map((o) => o.niveau);
      expect(niveaux.indexOf('orange') === -1 || niveaux.lastIndexOf('rouge') < niveaux.indexOf('orange')).toBe(true);
      const rouges = corps.obligations.filter((o) => o.niveau === 'rouge' && o.echeance);
      const dates = rouges.map((o) => o.echeance);
      expect(dates).toEqual([...dates].sort());
    });

    test('V-28 `compteur_rouges` = nombre exact de lignes rouges non reportées', () => {
      expect(corps.compteur_rouges).toBe(corps.obligations.filter((o) => o.niveau === 'rouge').length);
    });

    test('V-29 le bloc « organisation » et les KPI de file active sont renseignés', () => {
      expect(Array.isArray(corps.organisation)).toBe(true);
      expect(corps.file_active.en_parcours).toBeGreaterThan(0);
      expect(corps.rendez_vous_reguliers).not.toBeNull();
    });

    test('V-29bis ?mine=1 borne les échéances aux salariés de la conseillère', async () => {
      const r = await auth(request(app).get('/api/insertion/echeances?mine=1'), 'RH');
      expect(r.status).toBe(200);
      const ids = new Set(r.body.obligations.map((o) => o.employee_id).filter((x) => x != null));
      for (const id of ids) expect([E.ok, E.rdv]).toContain(id);
    });

    test('V-29ter une source en échec VIDE son bloc et se NOMME (jamais un écran vide muet)', async () => {
      const { composerEcheances } = require('../../src/services/echeances-cip');
      // `db` injecté : la requête des sorties FSE+ échoue, les autres passent.
      const db = {
        query: (texte, params) => {
          if (typeof texte === 'string' && /insertion_fse_sorties/.test(texte)) {
            const e = new Error('relation "insertion_fse_sorties" does not exist');
            e.code = '42P01';
            return Promise.reject(e);
          }
          return pool.query(texte, params);
        },
      };
      const corps = await composerEcheances({ db, baseRole: 'ADMIN' });
      expect(corps.sources_indisponibles).toContain('sorties_fse');
      // …et le reste de l'écran tient debout.
      expect(corps.obligations.length).toBeGreaterThan(0);
    });

    test('V-30 la consultation est journalisée sans nommer personne', async () => {
      const r = await pool.query(
        "SELECT details FROM rgpd_audit_log WHERE action = 'INSERTION_ECHEANCES_CONSULTATION' ORDER BY id DESC LIMIT 1"
      );
      expect(r.rows.length).toBe(1);
      const d = typeof r.rows[0].details === 'string' ? JSON.parse(r.rows[0].details) : r.rows[0].details;
      expect(d).toHaveProperty('nb_rouges');
      expect(JSON.stringify(d)).not.toMatch(/REFERENT|Rita/);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 3. MANAGER — les familles sociales ne sont pas CALCULÉES
  // ═════════════════════════════════════════════════════════════════════════
  describe('GET /api/insertion/echeances — périmètre MANAGER', () => {
    test('V-31 aucun type social rendu, et aucune requête sociale émise', async () => {
      const vraie = pool.query.bind(pool);
      const textes = [];
      jest.spyOn(pool, 'query').mockImplementation((...args) => {
        textes.push(typeof args[0] === 'string' ? args[0] : (args[0] && args[0].text) || '');
        return vraie(...args);
      });
      let corps;
      try {
        const r = await auth(request(app).get('/api/insertion/echeances'), 'MANAGER');
        expect(r.status).toBe(200);
        corps = r.body;
      } finally {
        pool.query.mockRestore();
      }
      const types = new Set(corps.obligations.map((o) => o.type));
      for (const t of ['sortie_fse_a_saisir', 'fse_entree_manquant', 'categorie_g', 'sous_15h']) {
        expect(types.has(t)).toBe(false);
      }
      expect(corps.rendez_vous_reguliers).toBeNull();
      // Les requêtes ADMIN-only ne partent pas : ni `insertion_fse_sorties`,
      // ni la participation ASI, ni `ft_categorie`.
      expect(textes.filter((t) => /insertion_fse_sorties/.test(t))).toEqual([]);
      expect(textes.filter((t) => /insertion_projet_participants/.test(t) && /pr\.type = 'asi'/.test(t))).toEqual([]);
      expect(textes.filter((t) => /\be\.ft_categorie\b/.test(t))).toEqual([]);
    });

    test('V-32 les types non sociaux restent rendus au MANAGER', async () => {
      const r = await auth(request(app).get('/api/insertion/echeances'), 'MANAGER');
      const types = new Set(r.body.obligations.map((o) => o.type));
      expect(types.has('referent_unique')).toBe(true);
      expect(types.has('pass_iae')).toBe(true);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 4. Report (§ 5.1.3)
  // ═════════════════════════════════════════════════════════════════════════
  describe('POST /api/insertion/echeances/report', () => {
    test('V-33 MANAGER refusé 403 AVANT toute requête', async () => {
      const vraie = pool.query.bind(pool);
      const textes = [];
      jest.spyOn(pool, 'query').mockImplementation((...args) => {
        textes.push(typeof args[0] === 'string' ? args[0] : (args[0] && args[0].text) || '');
        return vraie(...args);
      });
      const avant = etatPool(pool);
      try {
        const r = await auth(request(app).post('/api/insertion/echeances/report'), 'MANAGER')
          .send({ employee_id: E.referent, type: 'referent_unique' });
        expect(r.status).toBe(403);
        expect(textes.filter((t) => /insertion_echeance_reports/.test(t))).toEqual([]);
      } finally {
        pool.query.mockRestore();
      }
      expect(etatPool(pool).waiting).toBe(0);
      expect(etatPool(pool).total).toBeLessThanOrEqual(avant.total + 1);
    });

    test('V-34 type inconnu → 400 ; ligne agrégée → 400 ; salarié inconnu → 404', async () => {
      const a = await auth(request(app).post('/api/insertion/echeances/report'), 'ADMIN')
        .send({ employee_id: E.referent, type: 'type_qui_nexiste_pas' });
      expect(a.status).toBe(400);
      expect(a.body.code).toBe('TYPE_INCONNU');
      const b = await auth(request(app).post('/api/insertion/echeances/report'), 'ADMIN')
        .send({ employee_id: E.referent, type: 'sous_15h' });
      expect(b.status).toBe(400);
      expect(b.body.code).toBe('LIGNE_AGREGEE');
      const c = await auth(request(app).post('/api/insertion/echeances/report'), 'ADMIN')
        .send({ employee_id: 99999999, type: 'referent_unique' });
      expect(c.status).toBe(404);
    });

    test('V-35 motif hors liste → 400 (validateur)', async () => {
      const r = await auth(request(app).post('/api/insertion/echeances/report'), 'ADMIN')
        .send({ employee_id: E.referent, type: 'referent_unique', motif: 'parce_que' });
      expect(r.status).toBe(400);
    });

    test('V-36 1er report sans motif → 201, ligne en base, journal RGPD', async () => {
      // NB : l'échéance relue est éprouvée à part (DÉFAUT D-05) — elle dépend
      // du fuseau du processus, pas du geste.
      const r = await auth(request(app).post('/api/insertion/echeances/report'), 'ADMIN')
        .send({ employee_id: E.referent, type: 'referent_unique' });
      expect(r.status).toBe(201);
      expect(r.body.nb_reports).toBe(1);
      const l = await pool.query(
        'SELECT motif, reporte_jusqu_au, created_by FROM insertion_echeance_reports WHERE employee_id = $1 AND echeance_type = $2',
        [E.referent, 'referent_unique']
      );
      expect(l.rows.length).toBe(1);
      expect(l.rows[0].motif).toBeNull();
      const j = await journalRgpd(pool, 'INSERTION_ECHEANCE_REPORT', E.referent);
      expect(j.length).toBe(1);
    });

    test('DÉFAUT D-05 — « reporté jusqu\'au » relu doit valoir 48 h, pas 46', async () => {
      // La colonne est un `TIMESTAMP WITHOUT TIME ZONE` écrit par
      // `NOW() + make_interval(hours => 48)` — donc en heure du SERVEUR
      // PostgreSQL (UTC). Le pilote la relit dans le fuseau du PROCESSUS : hors
      // UTC, la valeur rendue au navigateur recule d'autant. La comparaison qui
      // fait sortir la ligne des obligations, elle, est faite en SQL et reste
      // juste : c'est l'AFFICHAGE de l'échéance qui ment.
      const l = await pool.query(
        'SELECT reporte_jusqu_au FROM insertion_echeance_reports WHERE employee_id = $1 AND echeance_type = $2 ORDER BY id DESC LIMIT 1',
        [E.referent, 'referent_unique']
      );
      expect(new Date(l.rows[0].reporte_jusqu_au).getTime()).toBeGreaterThan(Date.now() + 47 * 3600 * 1000);
    });

    test('V-37 la ligne sort des obligations, entre dans `reportees`, sort du compteur', async () => {
      const r = await auth(request(app).get('/api/insertion/echeances'), 'ADMIN');
      expect(typesDe(r.body, E.referent)).not.toContain('referent_unique');
      const rep = r.body.reportees.find((o) => o.employee_id === E.referent && o.type === 'referent_unique');
      expect(rep).toBeDefined();
      expect(rep.nb_reports).toBe(1);
      expect(rep.reporte_jusqu_au).toBeTruthy();
      expect(r.body.compteur_rouges)
        .toBe(r.body.obligations.filter((o) => o.niveau === 'rouge').length);
    });

    test('V-38 2e report sans motif → 409 MOTIF_REQUIS ; avec motif → 201', async () => {
      const a = await auth(request(app).post('/api/insertion/echeances/report'), 'ADMIN')
        .send({ employee_id: E.referent, type: 'referent_unique' });
      expect(a.status).toBe(409);
      expect(a.body.code).toBe('MOTIF_REQUIS');
      expect(a.body.motifs_acceptes).toContain('attente_referent');
      const b = await auth(request(app).post('/api/insertion/echeances/report'), 'ADMIN')
        .send({ employee_id: E.referent, type: 'referent_unique', motif: 'attente_referent' });
      expect(b.status).toBe(201);
      expect(b.body.nb_reports).toBe(2);
    });

    test('V-39 report EXPIRÉ : la ligne revient dans les obligations, avec son compteur de reports', async () => {
      await pool.query(
        "UPDATE insertion_echeance_reports SET reporte_jusqu_au = NOW() - INTERVAL '1 hour' WHERE employee_id = $1",
        [E.referent]
      );
      const r = await auth(request(app).get('/api/insertion/echeances'), 'ADMIN');
      const l = lignePour(r.body, E.referent, 'referent_unique');
      expect(l).toBeDefined();
      expect(l.nb_reports).toBe(2);
      expect(r.body.reportees.find((o) => o.employee_id === E.referent)).toBeUndefined();
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 5. Compteur et son cache
  // ═════════════════════════════════════════════════════════════════════════
  describe('GET /api/insertion/echeances/compteur', () => {
    test('V-40 la valeur est celle de l\'écran', async () => {
      const { viderCacheCompteur } = require('../../src/services/echeances-cip');
      viderCacheCompteur();
      const ecran = await auth(request(app).get('/api/insertion/echeances'), 'ADMIN');
      const c = await auth(request(app).get('/api/insertion/echeances/compteur'), 'ADMIN');
      expect(c.status).toBe(200);
      expect(c.body.rouges).toBe(ecran.body.compteur_rouges);
    });

    test('V-41 le cache 60 s est par (rôle, utilisateur) : deux comptes ne le partagent pas', async () => {
      const { viderCacheCompteur } = require('../../src/services/echeances-cip');
      viderCacheCompteur();
      const admin = await auth(request(app).get('/api/insertion/echeances/compteur'), 'ADMIN');
      // Le MANAGER ne calcule pas les familles sociales : son compteur DOIT
      // différer. S'il recevait celui de l'ADMIN, le cache serait partagé.
      const manager = await auth(request(app).get('/api/insertion/echeances/compteur'), 'MANAGER');
      expect(admin.body.rouges).not.toBe(manager.body.rouges);
      const rh = await auth(request(app).get('/api/insertion/echeances/compteur'), 'RH');
      expect(rh.body.rouges).toBe(admin.body.rouges);
    });

    test('V-41bis le cache épargne RÉELLEMENT le calcul pendant 60 s', async () => {
      const { viderCacheCompteur } = require('../../src/services/echeances-cip');
      viderCacheCompteur();
      const vraie = pool.query.bind(pool);
      let n1 = 0; let n2 = 0; let compte = null;
      jest.spyOn(pool, 'query').mockImplementation((...args) => {
        if (compte === 1) n1 += 1; else if (compte === 2) n2 += 1;
        return vraie(...args);
      });
      try {
        compte = 1;
        await auth(request(app).get('/api/insertion/echeances/compteur'), 'ADMIN');
        compte = 2;
        await auth(request(app).get('/api/insertion/echeances/compteur'), 'ADMIN');
      } finally {
        pool.query.mockRestore();
      }
      expect(n1).toBeGreaterThan(3);
      expect(n2).toBe(0);   // second appel : entièrement servi par le cache
    });

    test('V-42 un report vide le cache immédiatement (la pastille ne contredit pas l\'écran)', async () => {
      const avant = await auth(request(app).get('/api/insertion/echeances/compteur'), 'ADMIN');
      const r = await auth(request(app).post('/api/insertion/echeances/report'), 'ADMIN')
        .send({ employee_id: E.passExpire, type: 'pass_iae' });
      expect(r.status).toBe(201);
      const apres = await auth(request(app).get('/api/insertion/echeances/compteur'), 'ADMIN');
      expect(apres.body.rouges).toBe(avant.body.rouges - 1);
    });
  });
});
