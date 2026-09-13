// ═══════════════════════════════════════════════════════════════════════════
// PR A lot 2 — CONFORMITÉ FSE+ SUR POSTGRESQL RÉEL
// Questionnaires typés, sortie (bilan / sans bilan / unicité), relevé +6 mois,
// dossier de conformité (9 pièces), alertes, jobs planifiés, anonymisation.
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
const fseParticipants = require('../../src/services/fse-participants');
const scheduler = require('../../src/services/scheduler');

jest.setTimeout(120000);

const app = express();
app.use(express.json());
app.use('/api/insertion', require('../../src/routes/insertion'));

const PREFIXE = 'jest_prA_fse';
const MAT = ['PRAFSE1', 'PRAFSE2', 'PRAFSE3', 'PRAFSE4'];
const CODE_PROJET = 'JEST-ASI-FSE';
let U; let projetId;
let avecBilan; let sansBilan; let dossierVide; let sansSortie;

const auth = (r, role) => r.set('Authorization', `Bearer ${U[role].token}`);

(RUN ? describe : describe.skip)('PR A lot 2 — conformité FSE+ (PostgreSQL réel)', () => {
  beforeAll(async () => {
    await purger(pool, { matricules: MAT, usernamePrefix: PREFIXE, projetCodes: [CODE_PROJET] });
    U = await creerComptes(pool, PREFIXE);

    const p = await pool.query(
      `INSERT INTO insertion_projets (code, nom, type, financeur, date_debut, date_fin, cofinancement_ue_pct, actif)
       VALUES ($1, 'Projet de recette ASI', 'asi', 'FSE+ / Jest', '2026-01-01', '2027-12-31', 60, true) RETURNING id`,
      [CODE_PROJET]
    );
    projetId = p.rows[0].id;

    avecBilan = await creerSalarie(pool, MAT[0], {
      first_name: 'Nadia', last_name: 'Kermiche', insertion_status: 'en_parcours',
      insertion_start_date: jourDecale(-400), contract_end: jourDecale(-3),
      gender: 'F', city: 'Rouen', birth_date: '1988-04-12', brsa: true,
    });
    sansBilan = await creerSalarie(pool, MAT[1], {
      first_name: 'Marc', last_name: 'Lefebvre', insertion_status: 'en_parcours',
      insertion_start_date: jourDecale(-420), contract_end: jourDecale(-40),
      gender: 'M', city: 'Elbeuf', birth_date: '1975-09-02',
    });
    dossierVide = await creerSalarie(pool, MAT[2], {
      first_name: 'Zoe', last_name: 'Martin', insertion_status: 'en_parcours',
      insertion_start_date: jourDecale(-200), contract_end: jourDecale(180),
    });
    sansSortie = await creerSalarie(pool, MAT[3], {
      first_name: 'Ali', last_name: 'Traore', insertion_status: 'en_parcours',
      insertion_start_date: jourDecale(-300), contract_end: jourDecale(-20),
    });

    for (const id of [avecBilan, sansBilan, dossierVide, sansSortie]) {
      await pool.query(
        `INSERT INTO insertion_projet_participants (projet_id, employee_id, date_entree) VALUES ($1, $2, $3)`,
        [projetId, id, jourDecale(-190)]
      );
    }
  });

  afterAll(async () => {
    await purger(pool, {
      matricules: MAT, employeeIds: [avecBilan, sansBilan, dossierVide, sansSortie],
      usernamePrefix: PREFIXE, projetCodes: [CODE_PROJET],
    });
    await pool.end();
  });

  // ── Projets cofinancés ───────────────────────────────────────────────────
  describe('projets cofinancés', () => {
    let pid;

    test('les deux opérations seedées sont présentes, avec leur nombre de participants', async () => {
      const r = await auth(request(app).get('/api/insertion/projets'), 'MANAGER');
      expect(r.status).toBe(200);
      const codes = r.body.map((p) => p.code);
      expect(codes).toEqual(expect.arrayContaining(['ASI-2026-2027', 'OCS-CIP-2026-2027']));
      const mien = r.body.find((p) => p.code === CODE_PROJET);
      expect(mien.nb_participants).toBe(4);
      expect(mien.type).toBe('asi');
    });

    test('un code dupliqué est refusé en 409', async () => {
      const r = await auth(request(app).post('/api/insertion/projets'), 'ADMIN')
        .send({ code: CODE_PROJET, nom: 'Doublon', type: 'asi' });
      expect(r.status).toBe(409);
      expect(r.body.code).toBe('CODE_DUPLIQUE');
    });

    test('le MANAGER ne crée ni ne modifie un projet (403)', async () => {
      const a = await auth(request(app).post('/api/insertion/projets'), 'MANAGER')
        .send({ code: 'JEST-M', nom: 'x', type: 'asi' });
      const b = await auth(request(app).put(`/api/insertion/projets/${projetId}`), 'MANAGER').send({ nom: 'y' });
      expect([a.status, b.status]).toEqual([403, 403]);
    });

    test('rattachement d\'un participant : création, journal, refus du doublon', async () => {
      const nouveau = await creerSalarie(pool, 'PRAFSE5', { first_name: 'Lea', last_name: 'Dubois' });
      MAT.push('PRAFSE5');
      const r = await auth(request(app).post(`/api/insertion/projets/${projetId}/participants`), 'ADMIN')
        .send({ employee_id: nouveau, date_entree: jourDecale(-30) });
      expect(r.status).toBe(201);
      pid = r.body.id;
      const j = await pool.query(
        "SELECT count(*)::int n FROM rgpd_audit_log WHERE action = 'INSERTION_PROJET_PARTICIPANT' AND entity_id = $1", [nouveau]);
      expect(j.rows[0].n).toBe(1);

      const doublon = await auth(request(app).post(`/api/insertion/projets/${projetId}/participants`), 'ADMIN')
        .send({ employee_id: nouveau, date_entree: jourDecale(-30) });
      expect(doublon.status).toBe(409);
      expect(doublon.body.code).toBe('RATTACHEMENT_DUPLIQUE');
    });

    test('date de sortie du projet posée puis rattachement retiré', async () => {
      const u = await auth(request(app).put(`/api/insertion/projets/${projetId}/participants/${pid}`), 'ADMIN')
        .send({ date_sortie: jourDecale(-1) });
      expect(u.status).toBe(200);
      const v = await pool.query('SELECT date_sortie FROM insertion_projet_participants WHERE id = $1', [pid]);
      expect(v.rows[0].date_sortie).not.toBeNull();

      const d = await auth(request(app).delete(`/api/insertion/projets/${projetId}/participants/${pid}`), 'ADMIN');
      expect(d.status).toBe(200);
      const w = await pool.query('SELECT count(*)::int n FROM insertion_projet_participants WHERE id = $1', [pid]);
      expect(w.rows[0].n).toBe(0);
    });

    test('postes et quotités : remplacement complet, quotité hors bornes refusée', async () => {
      const r = await auth(request(app).put(`/api/insertion/projets/${projetId}/postes`), 'ADMIN')
        .send([{ user_id: U.RH.id, quotite_pct: 40, date_debut: '2026-01-01' }]);
      expect(r.status).toBe(200);
      let g = await auth(request(app).get(`/api/insertion/projets/${projetId}/postes`), 'ADMIN');
      expect(g.body).toHaveLength(1);
      expect(Number(g.body[0].quotite_pct)).toBe(40);

      // Remplacement COMPLET : la liste envoyée fait foi.
      await auth(request(app).put(`/api/insertion/projets/${projetId}/postes`), 'ADMIN')
        .send([{ user_id: U.ADMIN.id, quotite_pct: 100 }]);
      g = await auth(request(app).get(`/api/insertion/projets/${projetId}/postes`), 'ADMIN');
      expect(g.body).toHaveLength(1);
      expect(g.body[0].user_id).toBe(U.ADMIN.id);

      const ko = await auth(request(app).put(`/api/insertion/projets/${projetId}/postes`), 'ADMIN')
        .send([{ user_id: U.RH.id, quotite_pct: 120 }]);
      expect(ko.status).toBe(400);
      // La liste précédente n'a pas été détruite par un remplacement refusé.
      g = await auth(request(app).get(`/api/insertion/projets/${projetId}/postes`), 'ADMIN');
      expect(g.body).toHaveLength(1);
    });
  });

  // ── Questionnaire d'entrée ───────────────────────────────────────────────
  describe("questionnaire FSE+ d'entrée (PUT /diagnostic)", () => {
    test('un questionnaire hors schéma est refusé en 400 en NOMMANT l\'item', async () => {
      const r = await auth(request(app).put(`/api/insertion/diagnostic/${avecBilan}`), 'ADMIN')
        .send({ fse_entree: { statut_avant_entree: 'martien', cle_inconnue: 1 } });
      expect(r.status).toBe(400);
      const cles = r.body.erreurs.map((e) => e.cle);
      expect(cles).toEqual(expect.arrayContaining(['statut_avant_entree', 'cle_inconnue']));
      const v = await pool.query('SELECT count(*)::int n FROM insertion_diagnostics WHERE employee_id = $1', [avecBilan]);
      expect(v.rows[0].n).toBe(0); // rien n'a été créé
    });

    test('un questionnaire complet passe, fse_entree_complet et la date de saisie sont posés par le SERVEUR', async () => {
      const r = await auth(request(app).put(`/api/insertion/diagnostic/${avecBilan}`), 'ADMIN').send({
        statut_saisie: 'complet',
        logement_statut: 'heberge',
        situation_familiale: 'celibataire',
        enfants_a_charge: true,
        niveau_formation: 'niv3',
        // Valeur HÉRITÉE de l'ancien formulaire libre : convertie, pas refusée.
        fse_entree: {
          statut_avant_entree: 'demandeur_emploi', duree_sans_emploi: 'plus_24_mois',
          foyer_monoparental: true, sans_domicile_stable: true, ressources_principales: 'rsa',
        },
        // Le client ne peut PAS dicter la complétude.
        fse_entree_complet: false,
      });
      expect(r.status).toBe(200);
      const v = await pool.query(
        'SELECT fse_entree, fse_entree_complet, fse_entree_saisie_at FROM insertion_diagnostics WHERE employee_id = $1', [avecBilan]);
      expect(v.rows[0].fse_entree_complet).toBe(true);
      expect(v.rows[0].fse_entree.duree_sans_emploi).toBe('gt_24m'); // alias normalisé
      expect(v.rows[0].fse_entree_saisie_at).not.toBeNull();
    });

    test('la date de première saisie NE BOUGE PAS lors d\'une correction ultérieure', async () => {
      const a = await pool.query('SELECT fse_entree_saisie_at FROM insertion_diagnostics WHERE employee_id = $1', [avecBilan]);
      await auth(request(app).put(`/api/insertion/diagnostic/${avecBilan}`), 'ADMIN')
        .send({ fse_entree: { statut_avant_entree: 'inactif', duree_sans_emploi: 'gt_24m', foyer_monoparental: true, sans_domicile_stable: true, ressources_principales: 'rsa' } });
      const b = await pool.query('SELECT fse_entree_saisie_at FROM insertion_diagnostics WHERE employee_id = $1', [avecBilan]);
      expect(b.rows[0].fse_entree_saisie_at.getTime()).toBe(a.rows[0].fse_entree_saisie_at.getTime());
    });

    test('GET /fse : suggestions COHÉRENTES avec le diagnostic saisi, chacune avec sa source', async () => {
      const r = await auth(request(app).get(`/api/insertion/fse/${avecBilan}`), 'ADMIN');
      expect(r.status).toBe(200);
      const s = r.body.entree.suggestions;
      expect(s.sans_domicile_stable).toEqual({ valeur: true, source: expect.stringMatching(/hébergé/i) });
      expect(s.foyer_monoparental.valeur).toBe(true);
      expect(s.ressources_principales).toEqual({ valeur: 'rsa', source: expect.stringMatching(/RSA/) });
      // Aucune suggestion pour la durée sans emploi : rien ne permet de la déduire.
      expect(s.duree_sans_emploi).toBeUndefined();
      // Chaque suggestion porte une source lisible.
      for (const v of Object.values(s)) expect(typeof v.source).toBe('string');
      expect(r.body.entree.completude).toMatchObject({ total: 5, renseignes: 5, complet: true });
      expect(r.body.participant_asi).toBe(true);
    });

    test('un questionnaire PARTIEL n\'est pas déclaré complet', async () => {
      const r = await auth(request(app).put(`/api/insertion/diagnostic/${sansBilan}`), 'ADMIN')
        .send({ statut_saisie: 'en_cours', fse_entree: { statut_avant_entree: 'demandeur_emploi', foyer_monoparental: false } });
      expect(r.status).toBe(200);
      const v = await pool.query('SELECT fse_entree_complet FROM insertion_diagnostics WHERE employee_id = $1', [sansBilan]);
      expect(v.rows[0].fse_entree_complet).toBe(false);
    });

    test('GET /fse est refusé au MANAGER (statuts sociaux)', async () => {
      const r = await auth(request(app).get(`/api/insertion/fse/${avecBilan}`), 'MANAGER');
      expect(r.status).toBe(403);
    });
  });

  // ── Sortie : bilan, sans bilan, unicité ──────────────────────────────────
  describe('sortie FSE+', () => {
    let milestoneId;

    test('saisie SANS bilan : une ligne source « sans_bilan », journalisée', async () => {
      const r = await auth(request(app).post(`/api/insertion/fse/${sansBilan}/sortie`), 'ADMIN').send({
        date_sortie: jourDecale(-40),
        situation_sortie: 'emploi_transition',
        fse_sortie: { situation_sortie: 'emploi_transition', type_contrat: 'cdd_moins_6m' },
      });
      expect(r.status).toBe(201);
      expect(r.body.source).toBe('sans_bilan');
      const v = await pool.query('SELECT * FROM insertion_fse_sorties WHERE employee_id = $1', [sansBilan]);
      expect(v.rows).toHaveLength(1);
      expect(v.rows[0].projet_id).toBe(projetId); // rattaché au projet ASI ouvert
      const j = await pool.query(
        `SELECT count(*)::int n FROM rgpd_audit_log WHERE action = 'INSERTION_FSE_SORTIE_SAISIE' AND entity_id = $1`, [sansBilan]);
      expect(j.rows[0].n).toBe(1);
    });

    test('un questionnaire de sortie hors schéma est refusé en 400', async () => {
      const r = await auth(request(app).post(`/api/insertion/fse/${sansSortie}/sortie`), 'ADMIN')
        .send({ date_sortie: jourDecale(-20), situation_sortie: 'emploi_durable', fse_sortie: { type_contrat: 'perpetuel' } });
      expect(r.status).toBe(400);
      expect(r.body.erreurs[0].cle).toBe('type_contrat');
      const v = await pool.query('SELECT count(*)::int n FROM insertion_fse_sorties WHERE employee_id = $1', [sansSortie]);
      expect(v.rows[0].n).toBe(0);
    });

    test('clôture d\'un bilan_sortie : UNE ligne source « bilan », locked_at posé, durée et présence écrites', async () => {
      const m = await pool.query(
        `INSERT INTO insertion_milestones
           (employee_id, parcours_num, milestone_type, titre, due_date, status,
            sortie_classification, sortie_type, sortie_documents, fse_sortie)
         VALUES ($1, 1, 'bilan_sortie', 'Bilan de sortie', $2, 'planifie',
                 'emploi_durable', 'cdi', '{"stc":true}'::jsonb, '{"situation_sortie":"emploi_durable","type_contrat":"cdi"}'::jsonb)
         RETURNING id`,
        [avecBilan, jourDecale(-3)]
      );
      milestoneId = m.rows[0].id;

      const r = await auth(request(app).post(`/api/insertion/milestones/${milestoneId}/close`), 'ADMIN').send({
        assume_freins_non_evalues: true,
        completed_date: jourDecale(-2),
        duree_minutes: 60,
        presence: 'present',
      });
      expect(r.status).toBe(200);
      expect(r.body.sortie_fse).toBeTruthy();

      const ms = await pool.query('SELECT locked_at, duree_minutes, presence FROM insertion_milestones WHERE id = $1', [milestoneId]);
      expect(ms.rows[0].locked_at).not.toBeNull();
      expect(ms.rows[0].duree_minutes).toBe(60);
      expect(ms.rows[0].presence).toBe('present');

      const v = await pool.query('SELECT * FROM insertion_fse_sorties WHERE employee_id = $1', [avecBilan]);
      expect(v.rows).toHaveLength(1);
      expect(v.rows[0].source).toBe('bilan');
      expect(v.rows[0].situation_sortie).toBe('emploi_durable');
      expect(v.rows[0].milestone_id).toBe(milestoneId);
    });

    test('sortie SANS bilan puis clôture d\'un bilan : TOUJOURS une seule ligne, saisie_at conservée', async () => {
      const avant = await pool.query('SELECT id, saisie_at, source FROM insertion_fse_sorties WHERE employee_id = $1', [sansBilan]);
      expect(avant.rows).toHaveLength(1);

      const m = await pool.query(
        `INSERT INTO insertion_milestones
           (employee_id, parcours_num, milestone_type, titre, due_date, status,
            sortie_classification, sortie_type, sortie_documents)
         VALUES ($1, 1, 'bilan_sortie', 'Bilan de sortie tardif', $2, 'planifie',
                 'emploi_transition', 'cdd', '{"stc":true}'::jsonb) RETURNING id`,
        [sansBilan, jourDecale(-1)]
      );
      // `previous_review` est exigée dès qu'un entretien réalisé antérieur
      // existe : on la pose sur le jalon avant de clôturer, comme le fait
      // l'écran.
      await pool.query(
        `UPDATE insertion_milestones SET previous_review = '[{"constat":"RAS"}]'::jsonb WHERE id = $1`, [m.rows[0].id]);
      const r = await auth(request(app).post(`/api/insertion/milestones/${m.rows[0].id}/close`), 'ADMIN')
        .send({ assume_freins_non_evalues: true, completed_date: jourDecale(-1) });
      expect(r.status).toBe(200);
      expect(r.body.sortie_fse).toBeTruthy();

      const apres = await pool.query('SELECT id, saisie_at, source FROM insertion_fse_sorties WHERE employee_id = $1', [sansBilan]);
      expect(apres.rows).toHaveLength(1); // ← l'unicité par parcours tient
      expect(apres.rows[0].id).toBe(avant.rows[0].id);
      // `saisie_at` ne recule ni n'avance : le délai de saisie ne s'aggrave pas
      // rétroactivement parce que le bilan a été clôturé plus tard.
      expect(apres.rows[0].saisie_at.getTime()).toBe(avant.rows[0].saisie_at.getTime());
    });
  });

  // ── Relevé à +6 mois ─────────────────────────────────────────────────────
  describe('relevé de situation à +6 mois', () => {
    test('sans sortie enregistrée → 409 SORTIE_ABSENTE (aucune ligne fabriquée)', async () => {
      const r = await auth(request(app).post(`/api/insertion/fse/${dossierVide}/six-mois`), 'ADMIN')
        .send({ situation_6mois: 'emploi_durable' });
      expect(r.status).toBe(409);
      expect(r.body.code).toBe('SORTIE_ABSENTE');
    });

    test('« injoignable » est une réponse VALIDE et distincte de « non relevée »', async () => {
      const r = await auth(request(app).post(`/api/insertion/fse/${sansBilan}/six-mois`), 'ADMIN')
        .send({ situation_6mois: 'injoignable', date_releve_6mois: jourDecale(-1) });
      expect(r.status).toBe(200);
      const v = await pool.query('SELECT situation_6mois, date_releve_6mois FROM insertion_fse_sorties WHERE employee_id = $1', [sansBilan]);
      expect(v.rows[0].situation_6mois).toBe('injoignable');
      const j = await pool.query(
        `SELECT count(*)::int n FROM rgpd_audit_log WHERE action = 'INSERTION_FSE_SIX_MOIS_SAISIE' AND entity_id = $1`, [sansBilan]);
      expect(j.rows[0].n).toBe(1);
    });

    test('une situation hors liste est refusée en 400', async () => {
      const r = await auth(request(app).post(`/api/insertion/fse/${sansBilan}/six-mois`), 'ADMIN')
        .send({ situation_6mois: 'parti_a_letranger' });
      expect(r.status).toBe(400);
    });
  });

  // ── Dossier de conformité ────────────────────────────────────────────────
  describe('dossier de conformité (9 pièces)', () => {
    test('les 9 pièces sont servies dans l\'ordre du contrat', async () => {
      const r = await auth(request(app).get(`/api/insertion/conformite/${avecBilan}`), 'ADMIN');
      expect(r.status).toBe(200);
      expect(r.body.pieces.map((p) => p.cle)).toEqual([
        'eligibilite', 'pass_iae', 'referent_unique', 'fse_entree', 'diagnostic_socle',
        'fse_sortie', 'sortie_delai', 'six_mois', 'remise_documents',
      ]);
      for (const p of r.body.pieces) {
        expect(['complet', 'partiel', 'a_faire', 'sans_objet']).toContain(p.etat);
      }
    });

    test('dossier renseigné : entrée et sortie complètes', async () => {
      const r = await auth(request(app).get(`/api/insertion/conformite/${avecBilan}`), 'ADMIN');
      const etats = Object.fromEntries(r.body.pieces.map((p) => [p.cle, p.etat]));
      expect(etats.fse_entree).toBe('complet');
      expect(etats.diagnostic_socle).toBe('complet');
      expect(etats.fse_sortie).toBe('complet');
      expect(etats.sortie_delai).toBe('complet'); // saisie le jour même de la fin de contrat
    });

    test('dossier vide et parcours EN COURS : les pièces de sortie sont « sans objet », jamais « à faire »', async () => {
      const r = await auth(request(app).get(`/api/insertion/conformite/${dossierVide}`), 'ADMIN');
      const etats = Object.fromEntries(r.body.pieces.map((p) => [p.cle, p.etat]));
      expect(etats.fse_sortie).toBe('sans_objet');
      expect(etats.sortie_delai).toBe('sans_objet');
      expect(etats.six_mois).toBe('sans_objet');
      expect(etats.eligibilite).toBe('a_faire');
      expect(etats.pass_iae).toBe('a_faire');
      expect(etats.referent_unique).toBe('a_faire');
      expect(etats.fse_entree).toBe('a_faire');
      expect(r.body.complet).toBe(false);
      expect(r.body.nb_a_faire).toBeGreaterThanOrEqual(5);
    });

    test('contrat TERMINÉ sans sortie : la pièce de sortie devient « à faire »', async () => {
      const r = await auth(request(app).get(`/api/insertion/conformite/${sansSortie}`), 'ADMIN');
      const etats = Object.fromEntries(r.body.pieces.map((p) => [p.cle, p.etat]));
      expect(etats.fse_sortie).toBe('a_faire');
      expect(etats.sortie_delai).toBe('a_faire');
    });

    test('vue transversale par projet : taux de complétude et liste des restes à faire', async () => {
      const r = await auth(request(app).get(`/api/insertion/conformite?projet=${projetId}`), 'ADMIN');
      expect(r.status).toBe(200);
      expect(r.body.nb_total).toBe(4);
      expect(typeof r.body.taux_completude).toBe('number');
      const zoe = r.body.participants.find((p) => p.nom === 'Martin');
      expect(zoe.a_faire.length).toBeGreaterThan(0);
      expect(Object.keys(zoe.pieces)).toHaveLength(9);
    });

    test('sans paramètre « projet », refus motivé plutôt qu\'un écran vide', async () => {
      const r = await auth(request(app).get('/api/insertion/conformite'), 'ADMIN');
      expect(r.status).toBe(400);
      expect(r.body.code).toBe('PROJET_REQUIS');
    });

    test('le MANAGER n\'accède pas au dossier de conformité', async () => {
      const r = await auth(request(app).get(`/api/insertion/conformite/${avecBilan}`), 'MANAGER');
      expect(r.status).toBe(403);
    });
  });

  // ── Alertes de fiche ─────────────────────────────────────────────────────
  describe('alertes de fiche (GET /alertes/:id)', () => {
    test('fse_entree_manquante pour un participant ASI au questionnaire incomplet', async () => {
      const r = await auth(request(app).get(`/api/insertion/alertes/${dossierVide}`), 'ADMIN');
      expect(r.status).toBe(200);
      const types = r.body.alertes.map((a) => a.type);
      expect(types).toContain('fse_entree_manquante');
    });

    test('fse_sortie_a_saisir au-delà du premier seuil, absente avant', async () => {
      const tardif = await auth(request(app).get(`/api/insertion/alertes/${sansSortie}`), 'ADMIN');
      expect(tardif.body.alertes.map((a) => a.type)).toContain('fse_sortie_a_saisir');
      // `avecBilan` a une sortie enregistrée : pas d'alerte.
      const ok = await auth(request(app).get(`/api/insertion/alertes/${avecBilan}`), 'ADMIN');
      expect(ok.body.alertes.map((a) => a.type)).not.toContain('fse_sortie_a_saisir');
    });

    test('referent_non_determine pour un BRSA sans référent désigné', async () => {
      const r = await auth(request(app).get(`/api/insertion/alertes/${avecBilan}`), 'ADMIN');
      expect(r.body.alertes.map((a) => a.type)).toContain('referent_non_determine');
      // Une fois le référent désigné, l'alerte disparaît.
      await auth(request(app).put(`/api/insertion/cadre/${avecBilan}`), 'ADMIN')
        .send({ orientation: { referent_unique: { type: 'cms', nom: 'Mme Y' } } });
      const r2 = await auth(request(app).get(`/api/insertion/alertes/${avecBilan}`), 'ADMIN');
      expect(r2.body.alertes.map((a) => a.type)).not.toContain('referent_non_determine');
    });

    test('suivi_6mois_echu quand l\'échéance est passée et la situation non relevée', async () => {
      await pool.query(
        `UPDATE insertion_fse_sorties SET date_sortie = $2, situation_6mois = NULL, date_releve_6mois = NULL
         WHERE employee_id = $1`, [avecBilan, jourDecale(-400)]);
      const r = await auth(request(app).get(`/api/insertion/alertes/${avecBilan}`), 'ADMIN');
      expect(r.body.alertes.map((a) => a.type)).toContain('suivi_6mois_echu');
      await pool.query('UPDATE insertion_fse_sorties SET date_sortie = $2 WHERE employee_id = $1', [avecBilan, jourDecale(-3)]);
    });
  });

  // ── Jobs planifiés ───────────────────────────────────────────────────────
  describe('jobs planifiés', () => {
    test('checkFseSortiesNonRenseignees : J+15 puis J+25, anti-doublon', async () => {
      await pool.query("DELETE FROM insertion_interview_alerts WHERE employee_id = $1 AND milestone_type = 'fse_sortie'", [sansSortie]);

      // Fin de contrat à J-20 : premier seuil franchi, second non.
      await pool.query('UPDATE employees SET contract_end = $2 WHERE id = $1', [sansSortie, jourDecale(-20)]);
      const a = await fseParticipants.checkFseSortiesNonRenseignees();
      expect(a.crees).toBeGreaterThanOrEqual(1);
      let al = await pool.query(
        "SELECT alert_type FROM insertion_interview_alerts WHERE employee_id = $1 AND milestone_type = 'fse_sortie'", [sansSortie]);
      expect(al.rows.map((r) => r.alert_type)).toEqual(['fse_sortie_j15']);

      // Rejeu le même jour : aucune alerte de plus.
      await fseParticipants.checkFseSortiesNonRenseignees();
      al = await pool.query(
        "SELECT alert_type FROM insertion_interview_alerts WHERE employee_id = $1 AND milestone_type = 'fse_sortie'", [sansSortie]);
      expect(al.rows).toHaveLength(1);

      // Fin de contrat à J-26 : second seuil franchi → UNE seconde alerte.
      await pool.query('UPDATE employees SET contract_end = $2 WHERE id = $1', [sansSortie, jourDecale(-26)]);
      await fseParticipants.checkFseSortiesNonRenseignees();
      al = await pool.query(
        "SELECT alert_type FROM insertion_interview_alerts WHERE employee_id = $1 AND milestone_type = 'fse_sortie' ORDER BY alert_type", [sansSortie]);
      expect(al.rows.map((r) => r.alert_type)).toEqual(['fse_sortie_j15', 'fse_sortie_j25']);
    });

    test('le seuil J+15 se déclenche EXACTEMENT à 15 jours révolus', async () => {
      await pool.query("DELETE FROM insertion_interview_alerts WHERE employee_id = $1 AND milestone_type = 'fse_sortie'", [sansSortie]);
      await pool.query('UPDATE employees SET contract_end = $2 WHERE id = $1', [sansSortie, jourDecale(-14)]);
      await fseParticipants.checkFseSortiesNonRenseignees();
      let al = await pool.query(
        "SELECT count(*)::int n FROM insertion_interview_alerts WHERE employee_id = $1 AND milestone_type = 'fse_sortie'", [sansSortie]);
      expect(al.rows[0].n).toBe(0); // 14 jours : pas encore

      await pool.query('UPDATE employees SET contract_end = $2 WHERE id = $1', [sansSortie, jourDecale(-15)]);
      await fseParticipants.checkFseSortiesNonRenseignees();
      al = await pool.query(
        "SELECT alert_type FROM insertion_interview_alerts WHERE employee_id = $1 AND milestone_type = 'fse_sortie'", [sansSortie]);
      expect(al.rows.map((r) => r.alert_type)).toEqual(['fse_sortie_j15']); // 15 jours : alerte
    });

    test('createPostSortieFollowups : jalon à +6 mois, idempotent', async () => {
      // Un bilan de sortie réalisé il y a 5 mois et 20 jours tombe dans la fenêtre.
      const d = new Date(); d.setMonth(d.getMonth() - 5); d.setDate(d.getDate() - 20);
      const dIso = d.toISOString().slice(0, 10);
      await pool.query(
        `INSERT INTO insertion_milestones (employee_id, parcours_num, milestone_type, titre, due_date, completed_date, status, sortie_classification)
         VALUES ($1, 1, 'bilan_sortie', 'Bilan de sortie (job)', $2, $2, 'realise', 'emploi_durable')`,
        [dossierVide, dIso]
      );
      const r1 = await scheduler.createPostSortieFollowups();
      const n1 = await pool.query(
        "SELECT count(*)::int n, MIN(due_date) d FROM insertion_milestones WHERE employee_id = $1 AND milestone_type = 'suivi_post_sortie'", [dossierVide]);
      expect(n1.rows[0].n).toBe(1);
      expect(r1.crees).toBeGreaterThanOrEqual(1);
      // Échéance = sortie + 6 mois (réglage par défaut).
      const attendu = new Date(dIso); attendu.setMonth(attendu.getMonth() + 6);
      expect(n1.rows[0].d.toISOString().slice(0, 10)).toBe(attendu.toISOString().slice(0, 10));

      const r2 = await scheduler.createPostSortieFollowups();
      const n2 = await pool.query(
        "SELECT count(*)::int n FROM insertion_milestones WHERE employee_id = $1 AND milestone_type = 'suivi_post_sortie'", [dossierVide]);
      expect(n2.rows[0].n).toBe(1); // idempotent
      expect(r2.crees).toBe(0);
    });
  });

  // ── RGPD ─────────────────────────────────────────────────────────────────
  describe('anonymisation (services/anonymization.js)', () => {
    test('les tables du dossier sont purgées, la piste d\'audit FSE+ est CONSERVÉE', async () => {
      const cible = sansBilan;
      // Dossier complet à purger : critères, événement de Pass, pièce.
      await pool.query(
        `INSERT INTO employee_eligibilite (employee_id, critere_code) VALUES ($1, 'brsa')
         ON CONFLICT DO NOTHING`, [cible]);
      await pool.query(
        `INSERT INTO insertion_pass_iae_evenements (employee_id, type, date_debut, motif)
         VALUES ($1, 'suspension', $2, 'arrêt de travail')`, [cible, jourDecale(-30)]);
      await pool.query(
        `INSERT INTO insertion_pieces (employee_id, type, nom_fichier, mime, taille, contenu, sha256)
         VALUES ($1, 'entretien_signe', 'e.pdf', 'application/pdf', 9, $2, repeat('a', 64))`,
        [cible, Buffer.from('%PDF-1.4\n')]);
      await pool.query(
        `UPDATE employees SET orienteur_nom = 'CMS Rouen', referent_unique_nom = 'Mme Z',
           referent_unique_contact = 'z@cd76.fr', brsa = true, brsa_date_constat = $2,
           ft_categorie = 'A', ft_categorie_date = $2 WHERE id = $1`, [cible, jourDecale(-100)]);

      const { anonymizeEmployee } = require('../../src/services/anonymization');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await anonymizeEmployee(client, cible);
        await client.query('COMMIT');
      } finally { client.release(); }

      const q = async (sql, p = [cible]) => (await pool.query(sql, p)).rows;
      expect(await q('SELECT 1 FROM employee_eligibilite WHERE employee_id = $1')).toHaveLength(0);
      expect(await q('SELECT 1 FROM insertion_pass_iae_evenements WHERE employee_id = $1')).toHaveLength(0);
      expect(await q('SELECT 1 FROM insertion_pieces WHERE employee_id = $1')).toHaveLength(0);

      const e = (await pool.query(
        `SELECT orienteur_nom, referent_unique_nom, referent_unique_contact, brsa_date_constat,
                ft_categorie_date, brsa, ft_categorie, referent_unique_type
         FROM employees WHERE id = $1`, [cible])).rows[0];
      expect(e.orienteur_nom).toBeNull();
      expect(e.referent_unique_nom).toBeNull();
      expect(e.referent_unique_contact).toBeNull();
      expect(e.brsa_date_constat).toBeNull();
      expect(e.ft_categorie_date).toBeNull();
      // Catégoriels non nominatifs conservés (typologies de cohorte).
      expect(e.brsa).toBe(true);
      expect(e.ft_categorie).toBe('A');

      // Piste d'audit FSE+ ≥ 5 ans : conservée, c'est écrit au registre.
      expect(await q('SELECT 1 FROM insertion_fse_sorties WHERE employee_id = $1')).toHaveLength(1);
      expect(await q('SELECT 1 FROM insertion_projet_participants WHERE employee_id = $1')).toHaveLength(1);
    });
  });
});
