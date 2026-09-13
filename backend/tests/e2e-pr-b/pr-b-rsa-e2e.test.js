// ═══════════════════════════════════════════════════════════════════════════
// PR B lot 3 — CADRE RSA SUR POSTGRESQL RÉEL
//
// Ce que cette suite prouve, et que le `pg` simulé ne pouvait pas prouver :
//   · le CHECK `milestone_type` accepte réellement les deux types du cadre RSA
//     et refuse tout le reste (un validateur applicatif d'accord avec lui-même
//     ne dit rien de la contrainte posée en base) ;
//   · `date_realisation` est POSÉE par PostgreSQL au passage à « réalisé », et
//     ne bouge pas quand on repasse par « réalisé » ;
//   · le compteur d'activité lit de VRAIES lignes `employee_week_hours` : une
//     semaine sans relevé y est `null` et non 0, un arrêt déclaré neutralise
//     l'alerte sans disparaître du compte, et deux semaines consécutives la
//     lèvent ;
//   · le snapshot ÉCRIT dans `insertion_alimentations_referent` ne porte aucune
//     clé de santé ni de judiciaire — vérifié sur le JSONB relu en base, pas
//     sur l'objet rendu par la fonction ;
//   · l'anonymisation vide réellement les deux tables.
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const {
  RUN, creerComptes, purger, creerSalarie, jourDecale, lundiIso, plusJours, etatPool, signerChauffeur, iso,
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

const PREFIXE = 'jest_prB_rsa';
const MAT = ['PRBRSA1', 'PRBRSA2', 'PRBRSA3'];
const ANNEE = 2025;                       // année close : aucune semaine « à venir »
let U; let salarie; let sansReferent; let aAnonymiser;
let chauffeur;

const auth = (r, role) => r.set('Authorization', `Bearer ${U[role].token}`);

/** Insère un relevé hebdomadaire de paie réel. */
async function poserSemaine(employeeId, num, heuresTravaillees, heuresContrat = 26) {
  const lundi = lundiIso(ANNEE, num);
  await pool.query(
    `INSERT INTO employee_week_hours (employee_id, iso_year, iso_week, week_start, week_end, hours_worked, hours_contract, source)
     VALUES ($1, $2, $3, $4::date, $4::date + 6, $5, $6, 'jest')`,
    [employeeId, ANNEE, num, lundi, heuresTravaillees, heuresContrat]
  );
}

(RUN ? describe : describe.skip)('PR B lot 3 — cadre RSA (PostgreSQL réel)', () => {
  beforeAll(async () => {
    await purger(pool, { matricules: MAT, usernamePrefix: PREFIXE });
    U = await creerComptes(pool, PREFIXE, ['ADMIN', 'RH', 'MANAGER']);
    chauffeur = signerChauffeur(77);

    salarie = await creerSalarie(pool, MAT[0], {
      first_name: 'Amel', last_name: 'Durand', insertion_status: 'en_parcours',
      insertion_start_date: `${ANNEE}-01-06`, weekly_hours: 26,
      referent_unique_type: 'cms', referent_unique_nom: 'Mme Yvonne PREVOST',
      referent_unique_contact: 'y.prevost@cd76.fr',
      actualisation_ft_requise: false,
    });
    sansReferent = await creerSalarie(pool, MAT[1], {
      first_name: 'Karim', last_name: 'Benali', insertion_status: 'en_parcours',
      referent_unique_type: 'non_determine',
    });
    aAnonymiser = await creerSalarie(pool, MAT[2], {
      first_name: 'Sonia', last_name: 'Martel', insertion_status: 'en_parcours',
      referent_unique_type: 'france_travail', referent_unique_nom: 'M. LEROY',
      actualisation_ft_requise: true, birth_date: '1979-03-04',
    });

    // ── Relevés de paie de l'année de preuve ────────────────────────────────
    // S2 et S3 : 8 h puis 9 h → DEUX semaines consécutives sous 15 h, sans
    // arrêt : c'est la série qui doit lever l'alerte.
    await poserSemaine(salarie, 2, 8);
    await poserSemaine(salarie, 3, 9);
    // S5 : 10 h MAIS arrêt de travail déclaré → sous le plancher (donc comptée
    // dans l'indicateur) et pourtant hors alerte.
    await poserSemaine(salarie, 5, 10);
    await pool.query(
      `INSERT INTO employee_leaves (employee_id, leave_type, type_category, start_date, end_date, statut, source)
       VALUES ($1, 'Arrêt maladie — affection longue durée', 'sick', $2::date, $3::date, 'valide', 'jest')`,
      [salarie, lundiIso(ANNEE, 5), plusJours(lundiIso(ANNEE, 5), 4)]
    );
    // S8 : 26 h, au-dessus du plancher.
    await poserSemaine(salarie, 8, 26);
    // S4, S6, S7 et toutes les autres : AUCUNE ligne → « sans relevé ».
  });

  afterAll(async () => {
    await purger(pool, {
      matricules: MAT, employeeIds: [salarie, sansReferent, aAnonymiser], usernamePrefix: PREFIXE,
    });
    await pool.end();
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 1. Types d'entretien : ce que la BASE accepte
  // ═════════════════════════════════════════════════════════════════════════
  describe('types d\'entretien du cadre RSA', () => {
    test('le CHECK accepte « point_etape_referent » et « conciliation » et refuse le reste', async () => {
      for (const type of ['point_etape_referent', 'conciliation']) {
        const r = await pool.query(
          `INSERT INTO insertion_milestones (employee_id, milestone_type, titre, due_date, status)
           VALUES ($1, $2, 'sonde', $3::date, 'planifie') RETURNING id`,
          [salarie, type, `${ANNEE}-06-01`]
        );
        expect(r.rows[0].id).toBeGreaterThan(0);
        await pool.query('DELETE FROM insertion_milestones WHERE id = $1', [r.rows[0].id]);
      }
      // Un type hors liste doit être refusé par la CONTRAINTE, pas seulement
      // par le validateur : c'est la base qui est le dernier rempart.
      await expect(pool.query(
        `INSERT INTO insertion_milestones (employee_id, milestone_type, titre, due_date, status)
         VALUES ($1, 'sanction', 'sonde', $2::date, 'planifie')`,
        [salarie, `${ANNEE}-06-01`]
      )).rejects.toMatchObject({ code: '23514' });
    });

    test('création par l\'API : les deux types passent, un type inventé est refusé en 400', async () => {
      const ok = await auth(request(app).post('/api/insertion/milestones'), 'ADMIN')
        .send({ employee_id: salarie, milestone_type: 'point_etape_referent', due_date: `${ANNEE}-03-10` });
      expect(ok.status).toBe(201);
      expect(ok.body.milestone_type).toBe('point_etape_referent');

      const conc = await auth(request(app).post('/api/insertion/milestones'), 'ADMIN')
        .send({ employee_id: salarie, milestone_type: 'conciliation', due_date: `${ANNEE}-03-12` });
      expect(conc.status).toBe(201);

      const ko = await auth(request(app).post('/api/insertion/milestones'), 'ADMIN')
        .send({ employee_id: salarie, milestone_type: 'sanction', due_date: `${ANNEE}-03-12` });
      expect(ko.status).toBe(400);

      // Modalité et motifs écrits puis RELUS EN BASE (le JSONB doit être un
      // tableau, pas une chaîne — c'est le piège d'un `JSON.stringify` de trop).
      const maj = await auth(request(app).put(`/api/insertion/milestones/${conc.body.id}`), 'ADMIN')
        .send({ conciliation_motifs: ['garde_enfant', 'transport'], conciliation_issue: 'maintien' });
      expect(maj.status).toBe(200);
      const relu = await pool.query(
        'SELECT conciliation_motifs, conciliation_issue FROM insertion_milestones WHERE id = $1', [conc.body.id]);
      expect(Array.isArray(relu.rows[0].conciliation_motifs)).toBe(true);
      expect(relu.rows[0].conciliation_motifs).toEqual(['garde_enfant', 'transport']);
      expect(relu.rows[0].conciliation_issue).toBe('maintien');

      const mod = await auth(request(app).put(`/api/insertion/milestones/${ok.body.id}`), 'ADMIN')
        .send({ referent_modalite: 'tripartite' });
      expect(mod.status).toBe(200);
      const relu2 = await pool.query('SELECT referent_modalite FROM insertion_milestones WHERE id = $1', [ok.body.id]);
      expect(relu2.rows[0].referent_modalite).toBe('tripartite');
    });

    test('un motif de conciliation hors liste est refusé en 400, SANS écriture', async () => {
      const m = await auth(request(app).post('/api/insertion/milestones'), 'ADMIN')
        .send({ employee_id: salarie, milestone_type: 'conciliation', due_date: `${ANNEE}-04-02` });
      const r = await auth(request(app).put(`/api/insertion/milestones/${m.body.id}`), 'ADMIN')
        .send({ conciliation_motifs: ['sante', 'refus_de_travailler'] });
      expect(r.status).toBe(400);
      const relu = await pool.query('SELECT conciliation_motifs FROM insertion_milestones WHERE id = $1', [m.body.id]);
      expect(relu.rows[0].conciliation_motifs).toBeNull();
    });

    test('une modalité hors liste est refusée par le CHECK de la base', async () => {
      await expect(pool.query(
        `UPDATE insertion_milestones SET referent_modalite = 'bipartite'
          WHERE employee_id = $1 AND milestone_type = 'point_etape_referent'`, [salarie]
      )).rejects.toMatchObject({ code: '23514' });
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 2. `date_realisation` posée par la base au passage à « réalisé »
  // ═════════════════════════════════════════════════════════════════════════
  describe('date de réalisation des actions CIP', () => {
    let actionId;

    test('le passage à « realise » pose CURRENT_DATE si la colonne est vide', async () => {
      const c = await auth(request(app).post('/api/insertion/action-plans'), 'ADMIN')
        .send({ employee_id: salarie, action_label: 'Rendez-vous CAF', category: 'insertion' });
      expect([200, 201]).toContain(c.status);
      actionId = c.body.id;
      expect(c.body.date_realisation).toBeNull();

      const r = await auth(request(app).put(`/api/insertion/action-plans/${actionId}`), 'ADMIN')
        .send({ status: 'realise' });
      expect(r.status).toBe(200);
      const relu = await pool.query('SELECT date_realisation FROM cip_action_plans WHERE id = $1', [actionId]);
      const auj = (await pool.query('SELECT CURRENT_DATE AS d')).rows[0].d;
      expect(iso(relu.rows[0].date_realisation)).toBe(iso(auj));
    });

    test('repasser par « realise » NE DÉPLACE PAS la date déjà posée', async () => {
      // C'est la règle qui évite qu'une action corrigée en octobre change de
      // semaine dans le compteur d'activité.
      await pool.query('UPDATE cip_action_plans SET date_realisation = $2::date WHERE id = $1',
        [actionId, `${ANNEE}-02-11`]);
      const r = await auth(request(app).put(`/api/insertion/action-plans/${actionId}`), 'ADMIN')
        .send({ status: 'realise', notes: 'compte rendu' });
      expect(r.status).toBe(200);
      const relu = await pool.query('SELECT date_realisation FROM cip_action_plans WHERE id = $1', [actionId]);
      expect(iso(relu.rows[0].date_realisation)).toBe(`${ANNEE}-02-11`);
    });

    test('une date explicite est écrite telle quelle', async () => {
      const r = await auth(request(app).put(`/api/insertion/action-plans/${actionId}`), 'ADMIN')
        .send({ date_realisation: `${ANNEE}-01-09` });
      expect(r.status).toBe(200);
      const relu = await pool.query('SELECT date_realisation FROM cip_action_plans WHERE id = $1', [actionId]);
      expect(iso(relu.rows[0].date_realisation)).toBe(`${ANNEE}-01-09`);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 3. Compteur d'activité hebdomadaire
  // ═════════════════════════════════════════════════════════════════════════
  describe('compteur d\'activité hebdomadaire', () => {
    let corps;

    beforeAll(async () => {
      const r = await auth(request(app).get(`/api/insertion/rsa/${salarie}/activite?annee=${ANNEE}`), 'ADMIN');
      expect(r.status).toBe(200);
      corps = r.body;
    });

    test('52 ou 53 semaines ISO, seuils lus dans les réglages', () => {
      expect(corps.semaines.length).toBeGreaterThanOrEqual(52);
      expect(corps.seuil_min).toBe(15);
      expect(corps.seuil_max).toBe(20);
    });

    test('une semaine SANS relevé rend null partout — jamais 0', () => {
      const s4 = corps.semaines.find((s) => s.iso_week === 4);
      expect(s4.sans_releve).toBe(true);
      expect(s4.heures_travail).toBeNull();
      expect(s4.total_heures).toBeNull();
      // `false` dirait « au-dessus du plancher », ce qu'on ne sait pas.
      expect(s4.sous_seuil).toBeNull();
    });

    test('une semaine relevée sous le plancher est dite telle quelle', () => {
      const s2 = corps.semaines.find((s) => s.iso_week === 2);
      expect(s2.sans_releve).toBe(false);
      expect(s2.heures_travail).toBe(8);
      expect(s2.sous_seuil).toBe(true);
      expect(s2.arret_declare).toBe(false);
    });

    test('un arrêt déclaré neutralise l\'alerte mais COMPTE dans l\'indicateur', () => {
      const s5 = corps.semaines.find((s) => s.iso_week === 5);
      expect(s5.arret_declare).toBe(true);
      expect(s5.sous_seuil).toBe(true);
      // L'autorité demande un volume constaté : la semaine d'arrêt y figure.
      expect(corps.nb_semaines_sous_seuil).toBe(3); // S2, S3, S5
      expect(corps.raisons.find((r) => r.iso_week === 5).categorie).toBe('arret');
    });

    test('l\'alerte se lève à DEUX semaines consécutives, et pointe la première', () => {
      expect(corps.alerte.active).toBe(true);
      expect(corps.alerte.depuis_semaine).toBe(2);
    });

    test('une semaine au-dessus du plancher n\'est ni comptée ni alertée', () => {
      const s8 = corps.semaines.find((s) => s.iso_week === 8);
      expect(s8.sous_seuil).toBe(false);
      expect(corps.nb_semaines_relevees).toBe(4); // S2, S3, S5, S8
    });

    test('la consultation est journalisée au registre RGPD', async () => {
      const r = await pool.query(
        `SELECT details FROM rgpd_audit_log
          WHERE action = 'INSERTION_ACTIVITE_CONSULTATION' AND entity_id = $1
          ORDER BY id DESC LIMIT 1`, [salarie]);
      expect(r.rows.length).toBe(1);
      expect(r.rows[0].details.annee).toBe(ANNEE);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 4. Relevé d'assiduité
  // ═════════════════════════════════════════════════════════════════════════
  describe('relevé d\'assiduité', () => {
    beforeAll(async () => {
      // Trois entretiens : présent, absent AVEC motif + pièce, absent SANS motif.
      const poser = async (type, date, presence, motif, piece) => {
        const r = await pool.query(
          `INSERT INTO insertion_milestones
             (employee_id, milestone_type, titre, due_date, completed_date, status, presence, absence_motif, absence_piece_ref, duree_minutes)
           VALUES ($1, $2, $3, $4::date, $4::date, 'realise', $5, $6, $7, 45) RETURNING id`,
          [salarie, type, `Assiduité ${date}`, date, presence, motif, piece]);
        return r.rows[0].id;
      };
      await poser('bilan_intermediaire', `${ANNEE}-05-05`, 'present', null, null);
      await poser('point_etape_referent', `${ANNEE}-05-12`, 'absent', 'transport', 'Attestation SNCF n° 4412');
      await poser('bilan_intermediaire', `${ANNEE}-05-19`, 'absent', null, null);
    });

    test('variante tiers : ni pièce justificative, ni libellé de paie', async () => {
      const r = await auth(request(app)
        .get(`/api/insertion/rsa/${salarie}/assiduite?du=${ANNEE}-05-01&au=${ANNEE}-05-31`), 'ADMIN');
      expect(r.status).toBe(200);
      expect(r.body.variante).toBe('tiers');
      expect(r.body.entretiens.length).toBe(3);
      for (const e of r.body.entretiens) {
        expect(Object.keys(e)).not.toContain('absence_piece_ref');
      }
      const brut = JSON.stringify(r.body);
      // `leave_type` porte « affection longue durée » : il ne doit apparaître
      // nulle part, même en dehors du bloc des congés.
      expect(brut).not.toMatch(/affection longue/i);
      expect(brut).not.toMatch(/injustifi/i);
      expect(brut).not.toMatch(/Attestation SNCF/);
    });

    test('les absences de paie ne sortent que par leur CATÉGORIE', async () => {
      const r = await auth(request(app)
        .get(`/api/insertion/rsa/${salarie}/assiduite?du=${ANNEE}-01-01&au=${ANNEE}-12-31`), 'ADMIN');
      expect(r.status).toBe(200);
      expect(r.body.absences_paie.length).toBeGreaterThanOrEqual(1);
      for (const a of r.body.absences_paie) {
        expect(Object.keys(a).sort()).toEqual(['au', 'categorie', 'du']);
        expect(a.categorie).toBe('sick');
      }
    });

    test('les totaux distinguent honorés, absents et « sans motif »', async () => {
      const r = await auth(request(app)
        .get(`/api/insertion/rsa/${salarie}/assiduite?du=${ANNEE}-05-01&au=${ANNEE}-05-31`), 'ADMIN');
      expect(r.body.totaux.rdv_proposes).toBe(3);
      expect(r.body.totaux.rdv_honores).toBe(1);
      expect(r.body.totaux.absents).toBe(2);
      expect(r.body.totaux.sans_motif).toBe(1);
    });

    test('variante dossier : la référence de pièce réapparaît, sur demande explicite', async () => {
      const r = await auth(request(app)
        .get(`/api/insertion/rsa/${salarie}/assiduite?du=${ANNEE}-05-01&au=${ANNEE}-05-31&variante=dossier`), 'ADMIN');
      expect(r.status).toBe(200);
      expect(r.body.variante).toBe('dossier');
      expect(JSON.stringify(r.body)).toMatch(/Attestation SNCF/);
    });

    test('la consultation est journalisée', async () => {
      const r = await pool.query(
        `SELECT count(*)::int n FROM rgpd_audit_log
          WHERE action = 'INSERTION_ASSIDUITE_CONSULTATION' AND entity_id = $1`, [salarie]);
      expect(r.rows[0].n).toBeGreaterThanOrEqual(1);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 5. Fiche pour le référent — liste blanche prouvée sur le JSONB EN BASE
  // ═════════════════════════════════════════════════════════════════════════
  describe('fiche pour le référent', () => {
    let ficheId;

    beforeAll(async () => {
      // Un frein SANTÉ et un frein JUDICIAIRE renseignés, plus une action
      // rattachée au judiciaire : c'est ce qui ne doit pas sortir.
      await pool.query(
        `UPDATE insertion_milestones
            SET frein_sante = 5, frein_judiciaire = 4, frein_mobilite = 3, frein_logement = 2
          WHERE employee_id = $1 AND completed_date = $2::date`, [salarie, `${ANNEE}-05-05`]);
      const p = await pool.query(
        `INSERT INTO insertion_partenaires (nom, categorie, actif) VALUES ('SPIP de Rouen', 'justice', true)
         ON CONFLICT DO NOTHING RETURNING id`);
      const partenaireId = p.rows[0] ? p.rows[0].id
        : (await pool.query(`SELECT id FROM insertion_partenaires WHERE nom = 'SPIP de Rouen'`)).rows[0].id;
      await pool.query(
        `INSERT INTO cip_action_plans (employee_id, action_label, category, frein_type, status, date_realisation, partenaire_id, resultat)
         VALUES ($1, 'Accompagnement aménagement de peine', 'frein', 'judiciaire', 'realise', $2::date, $3, 'MARQUEUR-JUDICIAIRE')`,
        [salarie, `${ANNEE}-05-14`, partenaireId]);
      await pool.query(
        `INSERT INTO cip_action_plans (employee_id, action_label, category, frein_type, status, date_realisation, resultat)
         VALUES ($1, 'Bilan medical programme', 'frein', 'sante', 'realise', $2::date, 'MARQUEUR-SANTE')`,
        [salarie, `${ANNEE}-05-15`]);
      await pool.query(
        `INSERT INTO cip_action_plans (employee_id, action_label, category, frein_type, status, date_realisation, resultat)
         VALUES ($1, 'Dossier permis de conduire', 'frein', 'mobilite', 'realise', $2::date, 'MARQUEUR-MOBILITE')`,
        [salarie, `${ANNEE}-05-16`]);
    });

    test('409 REFERENT_NON_DETERMINE à l\'aperçu, SANS aucune écriture', async () => {
      const avant = await pool.query(
        'SELECT count(*)::int n FROM insertion_alimentations_referent WHERE employee_id = $1', [sansReferent]);
      const r = await auth(request(app).get(`/api/insertion/rsa/${sansReferent}/fiche-referent`), 'ADMIN');
      expect(r.status).toBe(409);
      expect(r.body.code).toBe('REFERENT_NON_DETERMINE');
      const apres = await pool.query(
        'SELECT count(*)::int n FROM insertion_alimentations_referent WHERE employee_id = $1', [sansReferent]);
      expect(apres.rows[0].n).toBe(avant.rows[0].n);
    });

    test('409 REFERENT_NON_DETERMINE à la génération aussi', async () => {
      const r = await auth(request(app).post(`/api/insertion/rsa/${sansReferent}/fiche-referent`), 'ADMIN')
        .send({ moment: 'entree', du: `${ANNEE}-01-01`, au: `${ANNEE}-12-31` });
      expect(r.status).toBe(409);
      expect(r.body.code).toBe('REFERENT_NON_DETERMINE');
      const n = await pool.query(
        'SELECT count(*)::int n FROM insertion_alimentations_referent WHERE employee_id = $1', [sansReferent]);
      expect(n.rows[0].n).toBe(0);
    });

    test('aperçu : 9 rubriques exactement, aucune écriture', async () => {
      const avant = await pool.query('SELECT count(*)::int n FROM insertion_alimentations_referent');
      const r = await auth(request(app)
        .get(`/api/insertion/rsa/${salarie}/fiche-referent?du=${ANNEE}-01-01&au=${ANNEE}-12-31`), 'ADMIN');
      expect(r.status).toBe(200);
      expect(r.body.apercu).toBe(true);
      expect(Object.keys(r.body.contenu).sort()).toEqual([
        'actions', 'activite', 'assiduite', 'freins', 'identite',
        'mentions', 'objectifs', 'prochaines_echeances', 'situation_emploi',
      ]);
      const apres = await pool.query('SELECT count(*)::int n FROM insertion_alimentations_referent');
      expect(apres.rows[0].n).toBe(avant.rows[0].n);
    });

    test('génération : snapshot écrit en base, liste blanche vérifiée SUR LE JSONB STOCKÉ', async () => {
      const r = await auth(request(app).post(`/api/insertion/rsa/${salarie}/fiche-referent`), 'ADMIN')
        .send({ moment: 'renouvellement', du: `${ANNEE}-01-01`, au: `${ANNEE}-12-31` });
      expect(r.status).toBe(201);
      ficheId = r.body.id;

      const ligne = await pool.query(
        'SELECT contenu, destinataire_type, destinataire_nom, parcours_num, moment FROM insertion_alimentations_referent WHERE id = $1',
        [ficheId]);
      const c = ligne.rows[0].contenu;
      // Le destinataire est RECOPIÉ, il ne se relit pas dans employees.
      expect(ligne.rows[0].destinataire_type).toBe('cms');
      expect(ligne.rows[0].destinataire_nom).toBe('Mme Yvonne PREVOST');
      expect(ligne.rows[0].moment).toBe('renouvellement');

      // (a) Les 9 clés, et pas une de plus.
      expect(Object.keys(c).sort()).toEqual([
        'actions', 'activite', 'assiduite', 'freins', 'identite',
        'mentions', 'objectifs', 'prochaines_echeances', 'situation_emploi',
      ]);

      // (b) Les 7 axes transmissibles — santé et judiciaire ABSENTS.
      const axes = c.freins.map((f) => f.axe).sort();
      expect(axes).toEqual(['administratif', 'famille', 'finances', 'linguistique', 'logement', 'mobilite', 'numerique']);
      expect(axes).not.toContain('sante');
      expect(axes).not.toContain('judiciaire');

      // (c) Le mot lui-même n'apparaît nulle part dans le document stocké :
      // ni comme clé, ni dans une mention « rubrique retirée ».
      const brut = JSON.stringify(c).toLowerCase();
      expect(brut).not.toContain('frein_sante');
      expect(brut).not.toContain('frein_judiciaire');
      expect(brut).not.toContain('judiciaire');

      // (d) Les actions à frein sensible sont retirées LIGNE ENTIÈRE : ni le
      // libellé, ni la date, ni le partenaire.
      expect(brut).not.toContain('marqueur-judiciaire');
      expect(brut).not.toContain('marqueur-sante');
      expect(brut).not.toContain('spip');
      // …mais l'action ORDINAIRE, elle, est bien transmise : la liste blanche
      // retire, elle n'ampute pas.
      expect(c.actions.some((a) => a.resultat === 'MARQUEUR-MOBILITE')).toBe(true);
    });

    test('la liste des fiches ne renvoie JAMAIS le contenu', async () => {
      const r = await auth(request(app).get(`/api/insertion/rsa/${salarie}/alimentations`), 'ADMIN');
      expect(r.status).toBe(200);
      expect(r.body.length).toBeGreaterThanOrEqual(1);
      for (const f of r.body) expect(Object.keys(f)).not.toContain('contenu');
    });

    test('réimpression : la fiche enregistrée se relit avec son contenu, et c\'est journalisé', async () => {
      const r = await auth(request(app).get(`/api/insertion/rsa/${salarie}/alimentations/${ficheId}`), 'ADMIN');
      expect(r.status).toBe(200);
      expect(Object.keys(r.body.contenu).length).toBe(9);
      const j = await pool.query(
        `SELECT details FROM rgpd_audit_log WHERE action = 'INSERTION_FICHE_REFERENT_CONSULTATION'
          AND entity_id = $1 ORDER BY id DESC LIMIT 1`, [salarie]);
      expect(j.rows[0].details.alimentation_id).toBe(ficheId);
      // La trace dit le QUOI, jamais le contenu.
      expect(JSON.stringify(j.rows[0].details)).not.toMatch(/PREVOST|mobilite/);
    });

    test('une date de remise FUTURE est refusée en 400, sans UPDATE', async () => {
      const r = await auth(request(app).put(`/api/insertion/rsa/${salarie}/alimentations/${ficheId}/remise`), 'ADMIN')
        .send({ remis_referent_le: jourDecale(3), remis_referent_mode: 'mail' });
      expect(r.status).toBe(400);
      expect(r.body.error).toMatch(/future/i);
      const relu = await pool.query(
        'SELECT remis_referent_le, remis_referent_mode FROM insertion_alimentations_referent WHERE id = $1', [ficheId]);
      expect(relu.rows[0].remis_referent_le).toBeNull();
      expect(relu.rows[0].remis_referent_mode).toBeNull();
    });

    test('la remise est tracée, référent et personne indépendamment', async () => {
      const r1 = await auth(request(app).put(`/api/insertion/rsa/${salarie}/alimentations/${ficheId}/remise`), 'ADMIN')
        .send({ remis_referent_le: jourDecale(-2), remis_referent_mode: 'mail' });
      expect(r1.status).toBe(200);
      const r2 = await auth(request(app).put(`/api/insertion/rsa/${salarie}/alimentations/${ficheId}/remise`), 'RH')
        .send({ remis_salarie_le: jourDecale(-1) });
      expect(r2.status).toBe(200);
      const relu = await pool.query(
        'SELECT remis_referent_le, remis_referent_mode, remis_salarie_le, remise_par FROM insertion_alimentations_referent WHERE id = $1',
        [ficheId]);
      // La seconde écriture n'a pas effacé la première.
      expect(iso(relu.rows[0].remis_referent_le)).toBe(jourDecale(-2));
      expect(relu.rows[0].remis_referent_mode).toBe('mail');
      expect(iso(relu.rows[0].remis_salarie_le)).toBe(jourDecale(-1));
      expect(relu.rows[0].remise_par).toBe(U.RH.id);
    });

    test('un mode de remise hors liste est refusé en 400', async () => {
      const r = await auth(request(app).put(`/api/insertion/rsa/${salarie}/alimentations/${ficheId}/remise`), 'ADMIN')
        .send({ remis_referent_mode: 'pigeon' });
      expect(r.status).toBe(400);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 6. Actualisation France Travail
  // ═════════════════════════════════════════════════════════════════════════
  describe('registre d\'actualisation France Travail', () => {
    test('409 ACTUALISATION_FT_NON_REQUISE, sans écriture', async () => {
      const r = await auth(request(app).put(`/api/insertion/rsa/${salarie}/actualisations-ft/${ANNEE}-03`), 'ADMIN')
        .send({ honoree: true });
      expect(r.status).toBe(409);
      expect(r.body.code).toBe('ACTUALISATION_FT_NON_REQUISE');
      const n = await pool.query(
        'SELECT count(*)::int n FROM insertion_actualisations_ft WHERE employee_id = $1', [salarie]);
      expect(n.rows[0].n).toBe(0);
    });

    test('12 mois rendus, les mois sans ligne à null PARTOUT', async () => {
      const r = await auth(request(app)
        .get(`/api/insertion/rsa/${aAnonymiser}/actualisations-ft?annee=${ANNEE}`), 'ADMIN');
      expect(r.status).toBe(200);
      expect(r.body.mois.length).toBe(12);
      for (const m of r.body.mois) {
        expect(m.rappel_le).toBeNull();
        expect(m.honoree).toBeNull();   // jamais `false` : rien n'a été constaté
        expect(m.constat_le).toBeNull();
      }
    });

    test('upsert : rappel puis constat, à des moments différents, sans s\'effacer', async () => {
      const r1 = await auth(request(app).put(`/api/insertion/rsa/${aAnonymiser}/actualisations-ft/${ANNEE}-03`), 'ADMIN')
        .send({ rappel_le: `${ANNEE}-03-02` });
      expect(r1.status).toBe(200);
      expect(r1.body.honoree).toBeNull();

      const r2 = await auth(request(app).put(`/api/insertion/rsa/${aAnonymiser}/actualisations-ft/${ANNEE}-03`), 'ADMIN')
        .send({ honoree: false, constat_le: `${ANNEE}-03-20` });
      expect(r2.status).toBe(200);
      // ⚠ Même défaut D-02 : la valeur est bien CONSERVÉE en base (vérifié
      // ci-dessous), mais la réponse la rend au mauvais format.
      const relu = await pool.query(
        `SELECT rappel_le FROM insertion_actualisations_ft WHERE employee_id = $1 AND mois = $2::date`,
        [aAnonymiser, `${ANNEE}-03-01`]);
      expect(iso(relu.rows[0].rappel_le)).toBe(`${ANNEE}-03-02`);      // la base est juste
      expect(r2.body.rappel_le).toBe(`${ANNEE}-03-02`);                // la réponse ne l'est pas
      expect(r2.body.honoree).toBe(false);

      const n = await pool.query(
        'SELECT count(*)::int n FROM insertion_actualisations_ft WHERE employee_id = $1 AND mois = $2::date',
        [aAnonymiser, `${ANNEE}-03-01`]);
      expect(n.rows[0].n).toBe(1); // UNIQUE(employee_id, mois) tenu
    });

    test('les deux colonnes de synthèse d\'employees sont RECALCULÉES', async () => {
      await auth(request(app).put(`/api/insertion/rsa/${aAnonymiser}/actualisations-ft/${ANNEE}-04`), 'ADMIN')
        .send({ honoree: true, constat_le: `${ANNEE}-04-18` });
      let e = await pool.query(
        'SELECT actualisation_ft_derniere_date, actualisation_ft_rappels_non_honores FROM employees WHERE id = $1',
        [aAnonymiser]);
      expect(iso(e.rows[0].actualisation_ft_derniere_date)).toBe(`${ANNEE}-04-01`);
      expect(e.rows[0].actualisation_ft_rappels_non_honores).toBe(1); // mars

      // Reposer mars à « je ne sais pas » doit RETIRER le manquement : le
      // compteur est un cache de la table, pas un incrément.
      const r = await auth(request(app).put(`/api/insertion/rsa/${aAnonymiser}/actualisations-ft/${ANNEE}-03`), 'ADMIN')
        .send({ honoree: null });
      expect(r.status).toBe(200);
      expect(r.body.honoree).toBeNull();
      e = await pool.query('SELECT actualisation_ft_rappels_non_honores FROM employees WHERE id = $1', [aAnonymiser]);
      expect(e.rows[0].actualisation_ft_rappels_non_honores).toBe(0);
    });

    // ⚠ REPRODUCTION D'UN DÉFAUT (D-01, rapport 18) — attendu ROUGE tant que le
    // correctif n'est pas passé. `GET /actualisations-ft` range les lignes lues
    // par `Number(String(l.mois).slice(5, 7))` : `l.mois` est un objet `Date`
    // (colonne DATE), `String(...)` rend « Sat Mar 01 2025 … » et `slice(5, 7)`
    // rend « ar » → `Number('ar')` vaut NaN. La Map est donc indexée par NaN et
    // AUCUN des douze mois ne retrouve sa ligne : l'écran affiche douze mois
    // vides quoi qu'on ait enregistré.
    test('DÉFAUT D-01 — les mois RENSEIGNÉS doivent être rendus, pas douze null', async () => {
      const r = await auth(request(app)
        .get(`/api/insertion/rsa/${aAnonymiser}/actualisations-ft?annee=${ANNEE}`), 'ADMIN');
      expect(r.status).toBe(200);
      const avril = r.body.mois.find((m) => m.mois === `${ANNEE}-04`);
      // La base porte bien la ligne : le défaut est dans la restitution.
      const enBase = await pool.query(
        `SELECT honoree, constat_le FROM insertion_actualisations_ft
          WHERE employee_id = $1 AND mois = $2::date`, [aAnonymiser, `${ANNEE}-04-01`]);
      expect(enBase.rows[0].honoree).toBe(true);
      expect(avril.honoree).toBe(true);
      expect(avril.constat_le).toBe(`${ANNEE}-04-18`);
    });

    // ⚠ REPRODUCTION D'UN DÉFAUT (D-02, rapport 18). Le PUT rend la date au
    // format « Sun Mar 02 » (même raccourci `String(Date).slice(0, 10)`), là où
    // l'écran attend « AAAA-MM-JJ » — et où le reste de l'API le sert ainsi.
    test('DÉFAUT D-02 — le PUT doit rendre la date au format AAAA-MM-JJ', async () => {
      const r = await auth(request(app).put(`/api/insertion/rsa/${aAnonymiser}/actualisations-ft/${ANNEE}-04`), 'ADMIN')
        .send({ rappel_le: `${ANNEE}-04-02` });
      expect(r.status).toBe(200);
      expect(r.body.rappel_le).toBe(`${ANNEE}-04-02`);
      expect(r.body.constat_le).toBe(`${ANNEE}-04-18`);
    });

    test('un mois mal formé est refusé en 400', async () => {
      const r = await auth(request(app).put(`/api/insertion/rsa/${aAnonymiser}/actualisations-ft/2025-3`), 'ADMIN')
        .send({ honoree: true });
      expect(r.status).toBe(400);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 7. Échéances périodiques
  // ═════════════════════════════════════════════════════════════════════════
  describe('échéances périodiques', () => {
    test('l\'agrégat rend les cinq blocs et retrouve nos dossiers', async () => {
      const r = await auth(request(app).get('/api/insertion/rsa/echeances-periodiques'), 'ADMIN');
      expect(r.status).toBe(200);
      expect(Object.keys(r.body).sort()).toEqual([
        'actualisations_ft_du_mois', 'dtr', 'periodicite_point_referent_mois',
        'points_referent_dus', 'referents_non_determines', 'semaines_sous_seuil',
      ]);
      // Karim BENALI n'a pas de référent : il est nommé en rouge.
      expect(r.body.referents_non_determines.some((x) => x.employee_id === sansReferent)).toBe(true);
      // Sonia MARTEL est soumise à l'actualisation : elle est dans la liste du mois.
      expect(r.body.actualisations_ft_du_mois.some((x) => x.employee_id === aAnonymiser)).toBe(true);
      expect(r.body.dtr.trimestre).toMatch(/^T[1-4] \d{4}$/);
    });

    // ⚠ REPRODUCTION D'UN DÉFAUT (D-03, rapport 18). Le code SE PROPOSE de
    // rendre `null` (son commentaire le dit) mais compare
    // `String(uneDate).slice(0, 10)` — soit « Mon Jan 01 » — à '1900-01-01' :
    // en ASCII les lettres passent après les chiffres, la sentinelle est donc
    // prise pour une vraie date et ressort telle quelle.
    // ⚠ MÊME FAMILLE QUE D-02 : la date de rappel du mois courant est rendue au
    // format « Sun Mar 02 » dans le bloc de tableau de bord.
    test('DÉFAUT D-02 bis — la date de rappel du tableau de bord doit être AAAA-MM-JJ', async () => {
      const mois = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
      const p = await auth(request(app).put(`/api/insertion/rsa/${aAnonymiser}/actualisations-ft/${mois}`), 'ADMIN')
        .send({ rappel_le: jourDecale(-1) });
      expect(p.status).toBe(200);
      const r = await auth(request(app).get('/api/insertion/rsa/echeances-periodiques'), 'ADMIN');
      const ligne = r.body.actualisations_ft_du_mois.find((x) => x.employee_id === aAnonymiser);
      expect(ligne.rappel_le).toBe(jourDecale(-1));
    });

    test('DÉFAUT D-03 — un dossier SANS aucun contact rend dernier_le null', async () => {
      const r = await auth(request(app).get('/api/insertion/rsa/echeances-periodiques'), 'ADMIN');
      const karim = r.body.points_referent_dus.find((p) => p.employee_id === sansReferent);
      expect(karim).toBeTruthy();
      expect(karim.dernier_le).toBeNull();
      expect(karim.du_depuis_jours).toBeNull();
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 7 bis. Journal RGPD — les sept codes du contrat § 7
  // ═════════════════════════════════════════════════════════════════════════
  describe('journal RGPD', () => {
    test('les sept codes du cadre RSA sont réellement écrits', async () => {
      const r = await pool.query(
        `SELECT DISTINCT action FROM rgpd_audit_log WHERE entity_type = 'insertion_rsa' ORDER BY action`);
      const vus = r.rows.map((x) => x.action);
      for (const code of [
        'INSERTION_ACTIVITE_CONSULTATION', 'INSERTION_ASSIDUITE_CONSULTATION',
        'INSERTION_FICHE_REFERENT_APERCU', 'INSERTION_FICHE_REFERENT_GENERATION',
        'INSERTION_FICHE_REFERENT_CONSULTATION', 'INSERTION_FICHE_REFERENT_REMISE',
        'INSERTION_ACTUALISATION_FT_MAJ',
      ]) {
        expect({ code, vu: vus.includes(code) }).toEqual({ code, vu: true });
      }
    });

    // ⚠ REPRODUCTION D'UN DÉFAUT (D-06, rapport 18). La fiche pour le référent
    // est un document qui SORT vers un tiers : sa trace n'est pas un confort
    // d'exploitation, c'est la preuve de la transmission. `journaliser()` de
    // `rsa.js` avale pourtant toute erreur d'écriture — le document part, la
    // trace manque, et rien ne le dit à l'utilisateur. Le lot 4 tient la règle
    // inverse sur son export (le journal échoue → l'export échoue) : les deux
    // surfaces de la même PR ne se comportent pas pareil devant le même risque.
    //
    // Panne injectée en BASE (et non dans le code) : un CHECK temporaire qui
    // refuse cette seule action.
    test('DÉFAUT D-06 — une fiche transmise sans sa trace ne doit pas partir en 201', async () => {
      await pool.query(`ALTER TABLE rgpd_audit_log ADD CONSTRAINT probe_ko_rsa CHECK
        (action <> 'INSERTION_FICHE_REFERENT_GENERATION')`);
      try {
        const r = await auth(request(app).post(`/api/insertion/rsa/${salarie}/fiche-referent`), 'ADMIN')
          .send({ moment: 'demande', du: `${ANNEE}-01-01`, au: `${ANNEE}-12-31` });
        const trace = await pool.query(
          `SELECT count(*)::int n FROM rgpd_audit_log
            WHERE action = 'INSERTION_FICHE_REFERENT_GENERATION' AND entity_id = $1`, [salarie]);
        // Ce qui est constaté aujourd'hui : 201 rendu, fiche écrite, trace nulle.
        // Ce qui est attendu : soit l'acte échoue, soit la trace existe.
        expect({ statut: r.status, trace: trace.rows[0].n }).not.toEqual({ statut: 201, trace: 0 });
      } finally {
        await pool.query('ALTER TABLE rgpd_audit_log DROP CONSTRAINT IF EXISTS probe_ko_rsa');
      }
    });

    test('aucune trace ne recopie le CONTENU du document transmis', async () => {
      const r = await pool.query(
        `SELECT details::text AS d FROM rgpd_audit_log WHERE entity_type = 'insertion_rsa'`);
      for (const l of r.rows) {
        expect(l.d).not.toMatch(/PREVOST|Durand|Amel|MARQUEUR|mentions|niveau_debut/);
      }
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 8. Habilitations — refus AVANT toute requête
  // ═════════════════════════════════════════════════════════════════════════
  describe('habilitations', () => {
    /** Toutes les routes du routeur RSA, avec leur verbe. */
    const ROUTES = (id) => [
      ['get', '/api/insertion/rsa/echeances-periodiques'],
      ['get', `/api/insertion/rsa/${id}/activite`],
      ['get', `/api/insertion/rsa/${id}/assiduite`],
      ['get', `/api/insertion/rsa/${id}/fiche-referent`],
      ['post', `/api/insertion/rsa/${id}/fiche-referent`],
      ['get', `/api/insertion/rsa/${id}/alimentations`],
      ['get', `/api/insertion/rsa/${id}/alimentations/1`],
      ['put', `/api/insertion/rsa/${id}/alimentations/1/remise`],
      ['get', `/api/insertion/rsa/${id}/actualisations-ft`],
      ['put', `/api/insertion/rsa/${id}/actualisations-ft/2025-01`],
    ];

    test('MANAGER est refusé en 403 sur les 10 routes', async () => {
      for (const [verbe, url] of ROUTES(salarie)) {
        const r = await auth(request(app)[verbe](url), 'MANAGER').send({});
        expect({ url, status: r.status }).toEqual({ url, status: 403 });
      }
    });

    test('un jeton CHAUFFEUR est refusé avant d\'atteindre le routeur RSA', async () => {
      for (const [verbe, url] of ROUTES(salarie).slice(0, 4)) {
        const r = await request(app)[verbe](url).set('Authorization', `Bearer ${chauffeur}`).send({});
        expect({ url, status: r.status }).toEqual({ url, status: 403 });
      }
    });

    test('un rôle COMMUNICATION est refusé lui aussi', async () => {
      const com = await creerComptes(pool, `${PREFIXE}_x`, ['COMMUNICATION']);
      const r = await request(app)
        .get(`/api/insertion/rsa/${salarie}/activite`)
        .set('Authorization', `Bearer ${com.COMMUNICATION.token}`);
      expect(r.status).toBe(403);
      await pool.query('DELETE FROM users WHERE username LIKE $1', [`${PREFIXE}_x%`]);
    });

    test('le refus est posé AVANT toute lecture : aucune trace de consultation', async () => {
      const avant = await pool.query(
        `SELECT count(*)::int n FROM rgpd_audit_log WHERE entity_type = 'insertion_rsa' AND user_id = $1`,
        [U.MANAGER.id]);
      for (const [verbe, url] of ROUTES(salarie)) {
        await auth(request(app)[verbe](url), 'MANAGER').send({});
      }
      const apres = await pool.query(
        `SELECT count(*)::int n FROM rgpd_audit_log WHERE entity_type = 'insertion_rsa' AND user_id = $1`,
        [U.MANAGER.id]);
      expect(apres.rows[0].n).toBe(avant.rows[0].n);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 9. Fuites du pool sur les refus
  // ═════════════════════════════════════════════════════════════════════════
  describe('gestion des connexions', () => {
    test('une rafale de 20 refus 4xx ne retient aucune connexion', async () => {
      // Préchauffage : le cache MFA et le pool doivent être en régime établi,
      // sans quoi on mesurerait leur montée en charge et non une fuite.
      await auth(request(app).get(`/api/insertion/rsa/${salarie}/activite?annee=${ANNEE}`), 'ADMIN');
      await new Promise((r) => setTimeout(r, 150));
      const avant = etatPool(pool);

      for (let i = 0; i < 20; i += 1) {
        // Alternance de trois familles de refus : 403 (habilitation),
        // 409 (référent non déterminé) et 400 (mois mal formé).
        await auth(request(app).get(`/api/insertion/rsa/${salarie}/activite`), 'MANAGER');
        await auth(request(app).get(`/api/insertion/rsa/${sansReferent}/fiche-referent`), 'ADMIN');
        await auth(request(app).put(`/api/insertion/rsa/${aAnonymiser}/actualisations-ft/bidon`), 'ADMIN').send({ honoree: true });
      }
      await new Promise((r) => setTimeout(r, 250));
      const apres = etatPool(pool);
      expect(apres.waiting).toBe(0);
      // Toutes les connexions ouvertes doivent être RENDUES : une connexion
      // gardée par un handler qui sort par un `return res.status(...)` sans
      // `release()` se lirait ici comme un écart total/idle qui grandit.
      expect(apres.total - apres.idle).toBeLessThanOrEqual(Math.max(0, avant.total - avant.idle));
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 10. Anonymisation
  // ═════════════════════════════════════════════════════════════════════════
  describe('anonymisation', () => {
    test('les deux tables du cadre RSA sont purgées', async () => {
      // On fabrique une fiche et un registre pour la salariée à anonymiser.
      const f = await auth(request(app).post(`/api/insertion/rsa/${aAnonymiser}/fiche-referent`), 'ADMIN')
        .send({ moment: 'sortie', du: `${ANNEE}-01-01`, au: `${ANNEE}-12-31` });
      expect(f.status).toBe(201);

      const avant = await pool.query(
        `SELECT (SELECT count(*)::int FROM insertion_alimentations_referent WHERE employee_id = $1) AS fiches,
                (SELECT count(*)::int FROM insertion_actualisations_ft WHERE employee_id = $1) AS actus`,
        [aAnonymiser]);
      expect(avant.rows[0].fiches).toBeGreaterThanOrEqual(1);
      expect(avant.rows[0].actus).toBeGreaterThanOrEqual(1);

      const { anonymizeEmployee } = require('../../src/services/anonymization');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await anonymizeEmployee(client, aAnonymiser);
        await client.query('COMMIT');
      } finally { client.release(); }

      const apres = await pool.query(
        `SELECT (SELECT count(*)::int FROM insertion_alimentations_referent WHERE employee_id = $1) AS fiches,
                (SELECT count(*)::int FROM insertion_actualisations_ft WHERE employee_id = $1) AS actus`,
        [aAnonymiser]);
      expect(apres.rows[0].fiches).toBe(0);
      expect(apres.rows[0].actus).toBe(0);
    });
  });
});
