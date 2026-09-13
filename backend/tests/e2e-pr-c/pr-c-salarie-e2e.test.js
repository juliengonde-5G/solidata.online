// ═══════════════════════════════════════════════════════════════════════════
// PR C lot 7 — DOCUMENTS DU SALARIÉ, CONSENTEMENT ET RAPPELS, SUR POSTGRESQL RÉEL
//
// Ce que cette suite prouve, et que le `pg` simulé ne pouvait pas prouver :
//   · la LISTE BLANCHE tient sur le JSONB RÉELLEMENT STOCKÉ — le dossier
//     d'essai porte de la santé, du judiciaire, un statut BRSA, une catégorie
//     France Travail, des notes de suivi, une note de profil et des textes
//     libres, et rien de tout cela ne doit se retrouver dans le document ;
//   · le journal de génération est BLOQUANT : quand il échoue (contrainte de
//     sonde posée en base), AUCUN document n'est créé ;
//   · les heures de la semaine viennent d'un vrai relevé de paie, et valent
//     `null` — jamais zéro — quand il n'y en a aucun ;
//   · la sélection des rappels se fait au JOUR CIVIL DE PARIS, le message part
//     en `dry_run` sans clé Brevo, la trace masque le destinataire, et
//     l'UNIQUE(milestone_id) interdit le doublon ;
//   · la purge et l'anonymisation vident réellement les tables.
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const {
  RUN, creerComptes, purgerPrC, creerSalarie, journalRgpd, etatPool,
  jourParisDecale, aujourdhuiParis, decalerJours, lundiIso, iso,
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
app.use('/api/rgpd', require('../../src/routes/rgpd'));

jest.setTimeout(240000);

const PREFIXE = 'jest_prC_sal';
const M = { riche: 'PRCS_RICHE', nu: 'PRCS_NU', rdv: 'PRCS_RDV', sansConsent: 'PRCS_NOCONS', anon: 'PRCS_ANON', m03: 'PRCS_M03', perm: 'PRCS_PERM' };
const MATS = Object.values(M);
const JOUR = aujourdhuiParis();
const DEMAIN = decalerJours(JOUR, 1);
let U; let riche; let nu; let empRdv; let sansConsent; let anon; let msRdv; let m03; let permId;

const auth = (r, role) => r.set('Authorization', `Bearer ${U[role].token}`);

/** Texte de toutes les valeurs d'un objet, pour chercher une fuite « en clair ». */
const brut = (o) => JSON.stringify(o);

(RUN ? describe : describe.skip)('PR C lot 7 — documents du salarié et rappels (PostgreSQL réel)', () => {
  beforeAll(async () => {
    await purgerPrC(pool, { matricules: MATS, usernamePrefix: PREFIXE });
    U = await creerComptes(pool, PREFIXE, ['ADMIN', 'RH', 'MANAGER']);

    // ── Un dossier VOLONTAIREMENT chargé de tout ce qui ne doit pas sortir ──
    riche = await creerSalarie(pool, M.riche, {
      first_name: 'Nadia', last_name: 'Complet', insertion_status: 'en_parcours',
      insertion_start_date: jourParisDecale(-300), position: 'Agent de tri',
      referent_unique_type: 'france_travail', referent_unique_nom: 'M. LEROY',
      referent_unique_contact: 'leroy@francetravail.fr',
      brsa: true, ft_categorie: 'G', ft_categorie_date: jourParisDecale(-60),
      cip_referent_user_id: U.RH.id, weekly_hours: 26,
      phone: '0612345678', email: 'nadia.complet@st.fr', personal_email: 'nadia@perso.fr',
      birth_date: '1985-04-12',
    });
    nu = await creerSalarie(pool, M.nu, {
      first_name: 'Vide', last_name: 'Nu', insertion_status: 'en_parcours',
      referent_unique_type: 'non_determine',
    });

    // Diagnostic avec santé, judiciaire et freins.
    await pool.query(
      `INSERT INTO insertion_diagnostics
         (employee_id, parcours_num, logement_statut, rqth, contre_indications, suivi_sante,
          frein_sante, frein_judiciaire, frein_logement, commentaire_sante, situation_familiale)
       VALUES ($1, 1, 'heberge', true, true, true, 5, 4, 3, 'SECRET_SANTE_HEPATITE', 'celibataire')`,
      [riche]
    );
    // Entretiens : un titre libre qui NOMME une situation médicale (le défaut
    // exact trouvé par la revue de sécurité de la PR B sur le relevé au CMS).
    await pool.query(
      `INSERT INTO insertion_milestones
         (employee_id, milestone_type, titre, due_date, completed_date, status, observations, avis_global)
       VALUES
         ($1, 'bilan_intermediaire', 'Bilan après SECRET_HOSPITALISATION', $2::date, $2::date, 'realise', 'SECRET_OBSERVATION', 'positif'),
         ($1, 'conciliation', 'Conciliation', $3::date, $3::date, 'realise', NULL, NULL)`,
      [riche, jourParisDecale(-120), jourParisDecale(-60)]
    );
    // Objectifs : ceux de la personne (origine salarié) et ceux de la CIP.
    await pool.query(
      `INSERT INTO insertion_objectifs (employee_id, titre, origine, statut, echeance)
       VALUES ($1, 'Passer le code de la route', 'salarie', 'en_cours', $2::date),
              ($1, 'SECRET_OBJECTIF_CIP', 'cip', 'en_cours', $2::date),
              ($1, 'Ouvrir un compte bancaire', 'salarie', 'atteint', NULL)`,
      [riche, jourParisDecale(40)]
    );
    // Actions : une ordinaire (avec partenaire), une rattachée au frein SANTÉ
    // (doit disparaître LIGNE ENTIÈRE), une rattachée au judiciaire.
    const part = await pool.query(
      `INSERT INTO insertion_partenaires (nom, categorie, actif) VALUES ('Mission locale test', 'autre', true)
       ON CONFLICT DO NOTHING RETURNING id`
    );
    const partId = part.rows[0]
      ? part.rows[0].id
      : (await pool.query("SELECT id FROM insertion_partenaires WHERE nom = 'Mission locale test'")).rows[0].id;
    await pool.query(
      `INSERT INTO cip_action_plans (employee_id, action_label, category, frein_type, status, echeance, partenaire_id, date_realisation)
       VALUES ($1, 'SECRET_LIBELLE_ACTION', 'insertion', NULL, 'a_faire', $2::date, $3, NULL),
              ($1, 'SECRET_RDV_PSY', 'frein', 'sante', 'a_faire', $2::date, $3, NULL),
              ($1, 'SECRET_SPIP', 'frein', 'judiciaire', 'realise', $4::date, $3, $4::date),
              ($1, 'Atelier CV', 'competence', NULL, 'realise', $4::date, $3, $4::date)`,
      [riche, jourParisDecale(20), partId, jourParisDecale(-30)]
    );
    // PMSMP, contrat, évaluation de compétences.
    await pool.query(
      `INSERT INTO insertion_pmsmp (employee_id, entreprise, objet, date_debut, date_fin, bilan)
       VALUES ($1, 'Entreprise Martin', 'decouvrir_metier', $2::date, $3::date, 'SECRET_BILAN_PMSMP')`,
      [riche, jourParisDecale(-90), jourParisDecale(-85)]
    );
    await pool.query(
      `INSERT INTO employee_contracts (employee_id, contract_type, start_date, end_date, is_current, weekly_hours, position_title)
       VALUES ($1, 'CDDI', $2::date, $3::date, true, 26, 'Agent de tri')`,
      [riche, jourParisDecale(-300), jourParisDecale(60)]
    );
    const ev = await pool.query(
      `INSERT INTO insertion_competence_evaluations (employee_id, filiere, date_evaluation, statut, synthese)
       VALUES ($1, 'tri', $2::date, 'valide', 'SECRET_SYNTHESE') RETURNING id`,
      [riche, jourParisDecale(-40)]
    );
    await pool.query(
      `INSERT INTO insertion_competence_scores (evaluation_id, rubrique, item, note, non_evalue, observation)
       VALUES ($1, 'Comportement', 'Ponctualité', 8, false, 'SECRET_OBSERVATION_ITEM'),
              ($1, 'Comportement', 'Communication', 4, false, NULL),
              ($1, 'Comportement', 'Autonomie', NULL, true, NULL)`,
      [ev.rows[0].id]
    );
    // Notes de suivi et note de profil (chiffrées, ADMIN/RH strict).
    await pool.query(
      `INSERT INTO insertion_notes_suivi (employee_id, date_note, categorie, contenu_chiffre, created_by)
       VALUES ($1, $2::date, 'echange', 'SECRET_NOTE_SUIVI', $3)`,
      [riche, jourParisDecale(-10), U.ADMIN.id]
    ).catch(() => {});
    // Pièce remise et fiche remise à la personne.
    await pool.query(
      `INSERT INTO insertion_pieces (employee_id, type, nom_fichier, mime, taille, contenu, sha256)
       VALUES ($1, 'entretien_signe', 'cr.pdf', 'application/pdf', 3, '\\x414243'::bytea, $2)`,
      [riche, 'a'.repeat(64)]
    );
    await pool.query(
      `INSERT INTO insertion_alimentations_referent
         (employee_id, moment, destinataire_type, periode_debut, periode_fin, contenu, remis_salarie_le)
       VALUES ($1, 'renouvellement', 'france_travail', $3::date, $2::date, '{"x":1}'::jsonb, $2::date)`,
      [riche, jourParisDecale(-15), jourParisDecale(-45)]
    );
    // Relevés de paie : la DERNIÈRE semaine relevée est celle qui doit sortir.
    const an = Number(JOUR.slice(0, 4));
    for (const [num, h] of [[2, 20], [3, 26.5]]) {
      await pool.query(
        `INSERT INTO employee_week_hours (employee_id, iso_year, iso_week, week_start, week_end, hours_worked, hours_contract, source)
         VALUES ($1, $2, $3, $4::date, $4::date + 6, $5, 26, 'jest')`,
        [riche, an, num, lundiIso(an, num), h]
      );
    }
    // Sortie (bilan de sortie réalisé) — pour « Mon Récap ».
    await pool.query(
      `INSERT INTO insertion_milestones
         (employee_id, milestone_type, titre, due_date, completed_date, status, sortie_classification, sortie_type, sortie_commentaires)
       VALUES ($1, 'bilan_sortie', 'Bilan de sortie', $2::date, $2::date, 'realise', 'emploi_durable', 'CDI', 'SECRET_COMMENTAIRE_SORTIE')`,
      [riche, jourParisDecale(-5)]
    );
    // Rendez-vous à venir : 14 h HEURE MURALE DE PARIS (ce que produit le
    // formulaire `<input type="datetime-local">`).
    await pool.query(
      `INSERT INTO insertion_milestones (employee_id, milestone_type, titre, due_date, status, interview_date, interviewer_id)
       VALUES ($1, 'bilan_intermediaire', 'Bilan à venir', $2::date, 'planifie', $3::timestamp, $4)`,
      [riche, jourParisDecale(6), `${jourParisDecale(6)} 14:00:00`, U.RH.id]
    );

    // ── Rappels de rendez-vous : DEMAIN à 14 h, consentement donné ──────────
    empRdv = await creerSalarie(pool, M.rdv, {
      first_name: 'Rémi', last_name: 'Rappel', insertion_status: 'en_parcours',
      cip_referent_user_id: U.RH.id, is_active: true,
    });
    sansConsent = await creerSalarie(pool, M.sansConsent, {
      first_name: 'Sofia', last_name: 'Sansaccord', insertion_status: 'en_parcours', is_active: true,
    });
    anon = await creerSalarie(pool, M.anon, {
      first_name: 'Alex', last_name: 'Aeffacer', insertion_status: 'en_parcours',
      birth_date: '1990-01-01', is_active: true,
    });
    const ms = await pool.query(
      `INSERT INTO insertion_milestones (employee_id, milestone_type, titre, due_date, status, interview_date, interviewer_id)
       VALUES ($1, 'conciliation', 'Entretien de conciliation', $2::date, 'planifie', $3::timestamp, $4) RETURNING id`,
      [empRdv, DEMAIN, `${DEMAIN} 14:00:00`, U.RH.id]
    );
    msRdv = ms.rows[0].id;
    await pool.query(
      `INSERT INTO insertion_milestones (employee_id, milestone_type, titre, due_date, status, interview_date)
       VALUES ($1, 'bilan_intermediaire', 'Sans accord', $2::date, 'planifie', $3::timestamp)`,
      [sansConsent, DEMAIN, `${DEMAIN} 10:00:00`]
    );
  });

  afterAll(async () => {
    // `m03` est ANONYMISÉ par sa propre vérification : son matricule a été
    // effacé, la purge par matricule ne le retrouverait plus et il resterait
    // dans la cohorte que la suite voisine croit seule (V-01).
    await purgerPrC(pool, { matricules: MATS, employeeIds: [anon, m03, permId].filter(Boolean), usernamePrefix: PREFIXE });
    await pool.query("DELETE FROM insertion_partenaires WHERE nom = 'Mission locale test'").catch(() => {});
    await pool.end();
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 1. Habilitations — ADMIN/RH strict
  // ═════════════════════════════════════════════════════════════════════════
  describe('Habilitations', () => {
    const ROUTES = (id) => ([
      ['get', `/api/insertion/salarie/${id}/mon-parcours`],
      ['post', `/api/insertion/salarie/${id}/mon-parcours`],
      ['get', `/api/insertion/salarie/${id}/mon-recap`],
      ['post', `/api/insertion/salarie/${id}/mon-recap`],
      ['get', `/api/insertion/salarie/${id}/documents`],
      ['get', `/api/insertion/salarie/${id}/documents/1`],
      ['put', `/api/insertion/salarie/${id}/documents/1/remise`],
      ['get', `/api/insertion/salarie/${id}/rappels-consentement`],
      ['put', `/api/insertion/salarie/${id}/rappels-consentement`],
      ['get', `/api/insertion/salarie/${id}/rappels`],
    ]);

    test('V-67 les 10 routes refusent un MANAGER en 403, AVANT toute requête', async () => {
      const vraie = pool.query.bind(pool);
      const textes = [];
      jest.spyOn(pool, 'query').mockImplementation((...args) => {
        textes.push(typeof args[0] === 'string' ? args[0] : (args[0] && args[0].text) || '');
        return vraie(...args);
      });
      const avant = etatPool(pool);
      try {
        for (const [verbe, url] of ROUTES(riche)) {
          const r = await auth(request(app)[verbe](url), 'MANAGER').send({});
          expect([verbe, url, r.status]).toEqual([verbe, url, 403]);
        }
        expect(textes.filter((t) => /insertion_documents_salarie|rappel_rdv/.test(t))).toEqual([]);
      } finally {
        pool.query.mockRestore();
      }
      expect(etatPool(pool).waiting).toBe(0);
      expect(etatPool(pool).total - avant.total).toBeLessThanOrEqual(1);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 2. « Mon parcours en une page »
  // ═════════════════════════════════════════════════════════════════════════
  describe('Mon parcours en une page', () => {
    let apercu;

    test('V-68 l\'aperçu compose le document et ne crée RIEN', async () => {
      const avant = await pool.query('SELECT COUNT(*)::int AS n FROM insertion_documents_salarie WHERE employee_id = $1', [riche]);
      const r = await auth(request(app).get(`/api/insertion/salarie/${riche}/mon-parcours`), 'ADMIN');
      expect(r.status).toBe(200);
      expect(r.body.apercu).toBe(true);
      apercu = r.body.contenu;
      const apres = await pool.query('SELECT COUNT(*)::int AS n FROM insertion_documents_salarie WHERE employee_id = $1', [riche]);
      expect(apres.rows[0].n).toBe(avant.rows[0].n);
      const j = await journalRgpd(pool, 'INSERTION_DOC_SALARIE_APERCU', riche);
      expect(j.length).toBeGreaterThanOrEqual(1);
    });

    test('V-69 les clés de premier niveau sont EXACTEMENT celles du § 5.6.1', () => {
      expect(Object.keys(apercu).sort()).toEqual([
        'engagements_structure', 'genere_le', 'mes_documents_remis', 'mes_engagements',
        'mes_heures_semaine', 'mon_referent', 'personne', 'prochain_rdv', 'structure',
      ]);
    });

    test('V-70 les engagements sont ceux de la PERSONNE (origine salarié), en cours', () => {
      expect(apercu.mes_engagements.map((e) => e.titre)).toEqual(['Passer le code de la route']);
      expect(brut(apercu)).not.toContain('SECRET_OBJECTIF_CIP');
    });

    test('V-71 les engagements de la structure portent la CATÉGORIE et le partenaire, jamais le libellé libre', () => {
      expect(apercu.engagements_structure.length).toBe(1);
      expect(apercu.engagements_structure[0]).toEqual({
        categorie_libelle: "Recherche d'emploi et insertion",
        partenaire_nom: 'Mission locale test',
        echeance: jourParisDecale(20),
      });
    });

    test('V-72 une action rattachée à un frein SANTÉ ou JUDICIAIRE disparaît LIGNE ENTIÈRE', () => {
      expect(brut(apercu)).not.toContain('SECRET_RDV_PSY');
      expect(brut(apercu)).not.toContain('SECRET_SPIP');
      expect(apercu.engagements_structure.filter((a) => a.categorie_libelle === "Levée d'une difficulté")).toEqual([]);
    });

    test('V-73 les heures sont celles de la DERNIÈRE semaine relevée — sans cible ni seuil', () => {
      const an = Number(JOUR.slice(0, 4));
      expect(apercu.mes_heures_semaine).toMatchObject({ semaine: `${an}-W03`, travail_h: 26.5 });
      expect(apercu.mes_heures_semaine.total_h).toBeGreaterThanOrEqual(26.5);
      const texte = brut(apercu).toLowerCase();
      for (const mot of ['seuil', '15 h', 'alerte', 'plancher', 'objectif']) {
        expect(texte).not.toContain(mot);
      }
    });

    test('V-74 aucun relevé → `null`, jamais zéro heure', async () => {
      const r = await auth(request(app).get(`/api/insertion/salarie/${nu}/mon-parcours`), 'ADMIN');
      expect(r.status).toBe(200);
      expect(r.body.contenu.mes_heures_semaine).toBeNull();
    });

    test('V-75 le prochain rendez-vous ne nomme JAMAIS le type d\'entretien', () => {
      expect(apercu.prochain_rdv).not.toBeNull();
      expect(Object.keys(apercu.prochain_rdv).sort()).toEqual(['avec', 'date', 'heure']);
      expect(apercu.prochain_rdv.date).toBe(jourParisDecale(6));
      expect(brut(apercu.prochain_rdv)).not.toMatch(/bilan|conciliation|sortie/i);
    });

    test('DÉFAUT D-01 — l\'heure du rendez-vous doit être celle que la conseillère a saisie (14:00)', () => {
      expect(apercu.prochain_rdv.heure).toBe('14:00');
    });

    test('V-76 le référent « non déterminé » rend `null` (et non une phrase inventée)', async () => {
      const r = await auth(request(app).get(`/api/insertion/salarie/${nu}/mon-parcours`), 'ADMIN');
      expect(r.body.contenu.mon_referent).toBeNull();
      expect(apercu.mon_referent).toEqual({
        type_libelle: 'France Travail', nom: 'M. LEROY', contact: 'leroy@francetravail.fr',
      });
    });

    test('V-77 la conseillère est nommée « Prénom N. », jamais en entier', () => {
      expect(apercu.structure.cip_nom).toBe('Jest R.');
      expect(apercu.prochain_rdv.avec).toBe('Jest R.');
    });

    test('V-78 les documents remis reprennent les pièces, les fiches et les documents tracés', () => {
      const libelles = apercu.mes_documents_remis.map((d) => d.libelle);
      expect(libelles).toContain("Compte rendu d'entretien signé");
      expect(libelles).toContain('Point de situation transmis à votre référent');
    });

    test('DÉFAUT D-07 — toute catégorie d\'action acceptée par la base doit avoir un libellé', async () => {
      // Le dictionnaire de « Mon parcours » en couvre quatre ; le CHECK de
      // `cip_action_plans.category` en accepte six. Une action « formation » ou
      // « job dating » est donc filtrée SILENCIEUSEMENT de ce que la structure
      // s'engage à faire — la personne ne voit pas un engagement qui la
      // concerne, et rien ne le dit.
      const { CATEGORIE_ACTION_LABELS } = require('../../src/services/mon-parcours');
      const r = await pool.query(
        "SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'cip_action_plans_category_check'"
      );
      const acceptees = [...r.rows[0].def.matchAll(/'([a-z_]+)'::character varying/g)].map((m) => m[1]);
      expect(acceptees.length).toBeGreaterThan(0);
      expect(acceptees.filter((c) => !(c in CATEGORIE_ACTION_LABELS))).toEqual([]);
    });

    test('V-79 salarié inexistant → 404', async () => {
      const r = await auth(request(app).get('/api/insertion/salarie/99999999/mon-parcours'), 'ADMIN');
      expect(r.status).toBe(404);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 3. « Mon Récap »
  // ═════════════════════════════════════════════════════════════════════════
  describe('Mon Récap', () => {
    let recap;
    beforeAll(async () => {
      const r = await auth(request(app).get(`/api/insertion/salarie/${riche}/mon-recap`), 'ADMIN');
      expect(r.status).toBe(200);
      recap = r.body.contenu;
    });

    test('V-80 les clés de premier niveau sont EXACTEMENT celles du § 5.6.2', () => {
      expect(Object.keys(recap).sort()).toEqual(
        ['contrats', 'etapes', 'genere_le', 'objectifs', 'personne', 'sortie', 'structure'].sort()
      );
    });

    test('V-81 une étape porte le LIBELLÉ DE SON TYPE, jamais le titre saisi', () => {
      expect(brut(recap)).not.toContain('SECRET_HOSPITALISATION');
      expect(recap.etapes.map((e) => e.libelle)).toContain('Bilan intermédiaire');
    });

    // CORRECTIF M-10 / O-02 — « Entretien de conciliation (protection des
    // droits) » désigne la procédure contradictoire qui précède une décision
    // RSA défavorable, et « Point avec le référent » suppose un référent
    // unique : sur un récapitulatif que la personne peut remettre à un
    // employeur, les deux disent quelque chose de sa situation sociale, que ce
    // document promet par ailleurs de ne pas contenir. Ils sont regroupés sous
    // un libellé générique ; le détail reste dans « Mon parcours », qui ne
    // circule pas. Réversible par `insertion.recap_neutralise`.
    test('V-81bis le Récap ne nomme NI la conciliation NI le point avec le référent', () => {
      const libelles = recap.etapes.map((e) => e.libelle);
      expect(brut(recap)).not.toContain('conciliation');
      expect(brut(recap)).not.toContain('Point avec le référent');
      expect(libelles).toContain("Entretien d'accompagnement");
    });

    test('V-82 les étapes sont datées et triées', () => {
      const dates = recap.etapes.map((e) => e.date);
      expect(dates).toEqual([...dates].sort());
      expect(recap.etapes.every((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.date))).toBe(true);
    });

    test('V-83 l\'évaluation de compétences porte une MOYENNE (N/E exclus), jamais les items', () => {
      const e = recap.etapes.find((x) => x.type === 'evaluation');
      expect(e.libelle).toBe('Évaluation des compétences — Tri — moyenne 6.0/10');
      expect(brut(recap)).not.toContain('Ponctualité');
      expect(brut(recap)).not.toContain('SECRET_OBSERVATION_ITEM');
    });

    // CORRECTIF M-10 — la raison sociale de l'entreprise d'accueil est un champ
    // LIBRE : le nom d'un ESAT, d'une entreprise adaptée ou d'un établissement
    // de soins révèle par ricochet ce que ce document exclut. Elle n'est plus
    // imprimée ; l'objet et les dates, eux, restent (c'est ce qui vaut d'être
    // montré à un employeur).
    test('V-84 la PMSMP est décrite par son objet et ses dates, SANS raison sociale', () => {
      const p = recap.etapes.find((x) => x.type === 'pmsmp');
      expect(p.libelle).toContain('Stage en entreprise');
      expect(p.libelle).toContain("Découverte d'un métier");
      expect(brut(recap)).not.toContain('Entreprise Martin');
      expect(brut(recap)).not.toContain('SECRET_BILAN_PMSMP');
    });

    test('V-85 les objectifs sont COMPTÉS, jamais commentés', () => {
      expect(recap.objectifs).toEqual({ atteints: 1, en_cours: 2 });
    });

    test('V-86 la sortie est traduite par un dictionnaire fermé, sans commentaire', () => {
      expect(recap.sortie).toEqual({
        date: jourParisDecale(-5), classification_libelle: 'Emploi durable', type_libelle: 'CDI',
      });
      expect(brut(recap)).not.toContain('SECRET_COMMENTAIRE_SORTIE');
    });

    test('V-87 un `sortie_type` hors dictionnaire devient `null` (jamais recopié)', async () => {
      await pool.query(
        "UPDATE insertion_milestones SET sortie_type = 'bidule_libre' WHERE employee_id = $1 AND milestone_type = 'bilan_sortie'", [riche]
      );
      const r = await auth(request(app).get(`/api/insertion/salarie/${riche}/mon-recap`), 'ADMIN');
      expect(r.body.contenu.sortie.type_libelle).toBeNull();
      await pool.query(
        "UPDATE insertion_milestones SET sortie_type = 'CDI' WHERE employee_id = $1 AND milestone_type = 'bilan_sortie'", [riche]
      );
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 4. Génération enregistrée — le SNAPSHOT est la preuve
  // ═════════════════════════════════════════════════════════════════════════
  describe('Génération, absence prouvée sur le JSONB stocké, remise', () => {
    let docParcours; let docRecap;

    test('V-88 POST crée la ligne, journalise, et rend le contenu', async () => {
      const a = await auth(request(app).post(`/api/insertion/salarie/${riche}/mon-parcours`), 'ADMIN');
      expect(a.status).toBe(201);
      docParcours = a.body.id;
      const b = await auth(request(app).post(`/api/insertion/salarie/${riche}/mon-recap`), 'ADMIN');
      expect(b.status).toBe(201);
      docRecap = b.body.id;
      const j = await journalRgpd(pool, 'INSERTION_DOC_SALARIE_GENERATION', riche);
      expect(j.length).toBe(2);
    });

    test('V-89 ABSENCE PROUVÉE sur le JSONB STOCKÉ : aucune clé ni valeur interdite', async () => {
      const r = await pool.query('SELECT type, contenu FROM insertion_documents_salarie WHERE employee_id = $1', [riche]);
      expect(r.rows.length).toBe(2);
      const INTERDITS = [
        'frein_', 'sante', 'judiciaire', 'brsa', 'ft_categorie', 'observations',
        'commentaire', 'presence', 'absence', 'bilan_', 'avis_', 'description',
      ];
      for (const row of r.rows) {
        const texte = JSON.stringify(row.contenu);
        for (const mot of INTERDITS) {
          expect([row.type, mot, texte.toLowerCase().includes(mot)]).toEqual([row.type, mot, false]);
        }
        // …et aucune des valeurs sensibles semées dans le dossier.
        for (const secret of ['SECRET_SANTE_HEPATITE', 'SECRET_OBSERVATION', 'SECRET_HOSPITALISATION',
          'SECRET_NOTE_SUIVI', 'SECRET_RDV_PSY', 'SECRET_SPIP', 'SECRET_LIBELLE_ACTION',
          'SECRET_BILAN_PMSMP', 'SECRET_SYNTHESE', 'SECRET_COMMENTAIRE_SORTIE', 'SECRET_OBJECTIF_CIP']) {
          expect([row.type, secret, texte.includes(secret)]).toEqual([row.type, secret, false]);
        }
      }
    });

    test('V-90 le journal est BLOQUANT : s\'il échoue, AUCUN document n\'est créé', async () => {
      // Sonde : une contrainte qui refuse précisément l'action de génération.
      // `NOT VALID` : la contrainte ne vaut que pour les lignes À VENIR — les
      // générations déjà journalisées par V-88 ne doivent pas empêcher la sonde.
      await pool.query(`ALTER TABLE rgpd_audit_log ADD CONSTRAINT probe_ko_docsal
        CHECK (action <> 'INSERTION_DOC_SALARIE_GENERATION') NOT VALID`);
      try {
        const avant = await pool.query('SELECT COUNT(*)::int AS n FROM insertion_documents_salarie WHERE employee_id = $1', [riche]);
        const r = await auth(request(app).post(`/api/insertion/salarie/${riche}/mon-parcours`), 'ADMIN');
        expect(r.status).toBe(500);
        const apres = await pool.query('SELECT COUNT(*)::int AS n FROM insertion_documents_salarie WHERE employee_id = $1', [riche]);
        expect(apres.rows[0].n).toBe(avant.rows[0].n);
      } finally {
        await pool.query('ALTER TABLE rgpd_audit_log DROP CONSTRAINT probe_ko_docsal');
      }
    });

    test('V-91 la liste des documents ne porte pas le contenu', async () => {
      const r = await auth(request(app).get(`/api/insertion/salarie/${riche}/documents`), 'ADMIN');
      expect(r.status).toBe(200);
      expect(r.body.length).toBe(2);
      expect(r.body[0]).not.toHaveProperty('contenu');
      expect(r.body[0].genere_par_nom).toBe('Jest ADMIN');
    });

    test('V-92 le document d\'un AUTRE salarié → 404 (jamais celui d\'à côté)', async () => {
      const r = await auth(request(app).get(`/api/insertion/salarie/${nu}/documents/${docParcours}`), 'ADMIN');
      expect(r.status).toBe(404);
      const ok = await auth(request(app).get(`/api/insertion/salarie/${riche}/documents/${docParcours}`), 'ADMIN');
      expect(ok.status).toBe(200);
      const j = await journalRgpd(pool, 'INSERTION_DOC_SALARIE_CONSULTATION', riche);
      expect(j.length).toBeGreaterThanOrEqual(1);
    });

    test('V-93 remise tracée : 200, journal, puis 409 à la seconde', async () => {
      const a = await auth(request(app).put(`/api/insertion/salarie/${riche}/documents/${docRecap}/remise`), 'ADMIN')
        .send({ remis_le: JOUR, remis_mode: 'main_propre' });
      expect(a.status).toBe(200);
      expect(a.body.remis_le).toBe(JOUR);
      const j = await journalRgpd(pool, 'INSERTION_DOC_SALARIE_REMISE', riche);
      expect(j.length).toBe(1);
      const b = await auth(request(app).put(`/api/insertion/salarie/${riche}/documents/${docRecap}/remise`), 'ADMIN')
        .send({ remis_le: JOUR, remis_mode: 'email' });
      expect(b.status).toBe(409);
      expect(b.body.code).toBe('REMISE_DEJA_TRACEE');
    });

    test('V-94 une date FUTURE et un mode inconnu sont refusés en 400', async () => {
      const a = await auth(request(app).put(`/api/insertion/salarie/${riche}/documents/${docParcours}/remise`), 'ADMIN')
        .send({ remis_le: jourParisDecale(1), remis_mode: 'main_propre' });
      expect(a.status).toBe(400);
      const b = await auth(request(app).put(`/api/insertion/salarie/${riche}/documents/${docParcours}/remise`), 'ADMIN')
        .send({ remis_le: JOUR, remis_mode: 'pigeon' });
      expect(b.status).toBe(400);
      // …et le jour même reste accepté (la garde est « demain », à Paris).
      const c = await auth(request(app).put(`/api/insertion/salarie/${riche}/documents/${docParcours}/remise`), 'ADMIN')
        .send({ remis_le: JOUR, remis_mode: 'courrier' });
      expect(c.status).toBe(200);
    });

    // CORRECTIF m-05 — la date était bornée dans le futur, jamais dans le
    // passé : « remis le 12/03/1950 » était accepté sur un document composé la
    // semaine dernière.
    test('V-94bis une remise ANTÉRIEURE à la génération est refusée', async () => {
      const doc = await auth(request(app).post(`/api/insertion/salarie/${riche}/mon-recap`), 'ADMIN');
      expect(doc.status).toBe(201);
      const r = await auth(request(app).put(`/api/insertion/salarie/${riche}/documents/${doc.body.id}/remise`), 'ADMIN')
        .send({ remis_le: '1950-03-12', remis_mode: 'main_propre' });
      expect(r.status).toBe(400);
      expect(r.body.code).toBe('REMISE_ANTERIEURE_GENERATION');
      const l = await pool.query('SELECT remis_le FROM insertion_documents_salarie WHERE id = $1', [doc.body.id]);
      expect(l.rows[0].remis_le).toBeNull();
    });

    test('V-95 aucune fuite de connexion sur la série de refus', async () => {
      const avant = etatPool(pool);
      for (let i = 0; i < 6; i += 1) {
        await auth(request(app).get('/api/insertion/salarie/99999999/mon-recap'), 'ADMIN');
        await auth(request(app).put(`/api/insertion/salarie/${riche}/documents/99999999/remise`), 'ADMIN')
          .send({ remis_le: JOUR, remis_mode: 'email' });
      }
      const apres = etatPool(pool);
      expect(apres.waiting).toBe(0);
      expect(apres.total - avant.total).toBeLessThanOrEqual(2);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 5. Consentement aux rappels
  // ═════════════════════════════════════════════════════════════════════════
  describe('Consentement aux rappels', () => {
    test('V-96 état initial : « jamais demandé » (null), contacts MASQUÉS', async () => {
      const r = await auth(request(app).get(`/api/insertion/salarie/${riche}/rappels-consentement`), 'ADMIN');
      expect(r.status).toBe(200);
      expect(r.body.consent).toBeNull();
      expect(r.body.contacts_disponibles.phone_masque).toBe('06 ** ** ** 78');
      expect(r.body.contacts_disponibles.email_masque).toBe('n***@st.fr');
      expect(brut(r.body)).not.toContain('0612345678');
      expect(brut(r.body)).not.toContain('nadia.complet@st.fr');
    });

    test('V-97 un numéro invalide → 400, rien n\'est écrit', async () => {
      const r = await auth(request(app).put(`/api/insertion/salarie/${riche}/rappels-consentement`), 'ADMIN')
        .send({ consent: true, canal: 'sms', destinataire: '12' });
      expect(r.status).toBe(400);
      const l = await pool.query('SELECT rappel_rdv_consent FROM employees WHERE id = $1', [riche]);
      expect(l.rows[0].rappel_rdv_consent).toBeNull();
    });

    test('V-98 accord par SMS : colonnes + rgpd_consents + journal, dans la même transaction', async () => {
      const r = await auth(request(app).put(`/api/insertion/salarie/${empRdv}/rappels-consentement`), 'ADMIN')
        .send({ consent: true, canal: 'sms', destinataire: '06 12 34 56 78' });
      expect(r.status).toBe(200);
      expect(r.body.destinataire_masque).toBe('06 ** ** ** 78');
      const l = await pool.query(
        'SELECT rappel_rdv_consent, rappel_rdv_canal, rappel_rdv_destinataire, rappel_rdv_consent_at, rappel_rdv_consent_by FROM employees WHERE id = $1',
        [empRdv]
      );
      expect(l.rows[0].rappel_rdv_consent).toBe(true);
      expect(l.rows[0].rappel_rdv_canal).toBe('sms');
      // CORRECTIF M-04 — le numéro est NORMALISÉ en E.164 à l'écriture : « +336
      // 12 34 56 78 », que produisait `notification.js`, était refusé par Brevo
      // (« recipient is invalid ») et l'échec était inscrit « envoyé ».
      expect(l.rows[0].rappel_rdv_destinataire).toBe('+33612345678');
      expect(l.rows[0].rappel_rdv_consent_at).toBeTruthy();
      const c = await pool.query(
        "SELECT granted FROM rgpd_consents WHERE entity_type = 'employee' AND entity_id = $1 AND consent_type = 'rappel_rdv'", [empRdv]
      );
      expect(c.rows[0].granted).toBe(true);
      const j = await journalRgpd(pool, 'INSERTION_RAPPEL_CONSENTEMENT', empRdv);
      expect(j.length).toBe(1);
      const d = typeof j[0].details === 'string' ? JSON.parse(j[0].details) : j[0].details;
      expect(d.destinataire_masque).toBe('06 ** ** ** 78');
      expect(JSON.stringify(d)).not.toContain('0612345678');
    });

    // CORRECTIF m-06 — le registre art. 30 déclare des personnes « suivies au
    // titre d'un parcours d'insertion » ; le code acceptait un PERMANENT.
    test('V-98bis un permanent ne peut pas consentir (409), et rien n\'est écrit', async () => {
      const permanent = await creerSalarie(pool, M.perm, {
        first_name: 'Paul', last_name: 'Permanent', insertion_status: 'none',
      });
      permId = permanent;
      const r = await auth(request(app).put(`/api/insertion/salarie/${permanent}/rappels-consentement`), 'ADMIN')
        .send({ consent: true, canal: 'sms', destinataire: '0612345678' });
      expect(r.status).toBe(409);
      expect(r.body.code).toBe('HORS_PARCOURS');
      const l = await pool.query('SELECT rappel_rdv_consent FROM employees WHERE id = $1', [permanent]);
      expect(l.rows[0].rappel_rdv_consent).toBeNull();
      // Le RETRAIT, lui, reste toujours possible (art. 7-3).
      const retrait = await auth(request(app).put(`/api/insertion/salarie/${permanent}/rappels-consentement`), 'ADMIN')
        .send({ consent: false });
      expect(retrait.status).toBe(200);
    });

    test('V-99 le RETRAIT efface le contact et trace le refus', async () => {
      await auth(request(app).put(`/api/insertion/salarie/${riche}/rappels-consentement`), 'ADMIN')
        .send({ consent: true, canal: 'email', destinataire: 'nadia@perso.fr' });
      const r = await auth(request(app).put(`/api/insertion/salarie/${riche}/rappels-consentement`), 'ADMIN')
        .send({ consent: false });
      expect(r.status).toBe(200);
      const l = await pool.query('SELECT rappel_rdv_consent, rappel_rdv_destinataire FROM employees WHERE id = $1', [riche]);
      expect(l.rows[0].rappel_rdv_consent).toBe(false);
      expect(l.rows[0].rappel_rdv_destinataire).toBeNull();
      const c = await pool.query(
        "SELECT granted FROM rgpd_consents WHERE entity_type = 'employee' AND entity_id = $1 AND consent_type = 'rappel_rdv'", [riche]
      );
      expect(c.rows[0].granted).toBe(false);
    });

    test('V-100 un CHECK de base refuse un canal hors liste (la garde n\'est pas qu\'applicative)', async () => {
      // 4 caractères : la valeur tient dans VARCHAR(5), c'est bien le CHECK qui
      // la refuse (et non la longueur de la colonne).
      await expect(pool.query('UPDATE employees SET rappel_rdv_canal = $1 WHERE id = $2', ['push', riche]))
        .rejects.toMatchObject({ code: '23514' });
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 6. Job de rappels J-1
  // ═════════════════════════════════════════════════════════════════════════
  describe('Rappels de rendez-vous J-1', () => {
    const { envoyerRappelsRdvSalaries, doitEnvoyerRappels, lireHeureEnvoi, masquerDestinataire } = require('../../src/services/rappels-rdv');

    test('V-101 heure d\'envoi : réglage absent → 18 h (et surtout pas 0)', async () => {
      await pool.query("DELETE FROM settings WHERE key = 'insertion.rappel_rdv_heure_envoi'");
      expect(await lireHeureEnvoi()).toBe(18);
      await pool.query(
        "INSERT INTO settings (key, value) VALUES ('insertion.rappel_rdv_heure_envoi', '99') ON CONFLICT (key) DO UPDATE SET value = '99'"
      );
      expect(await lireHeureEnvoi()).toBe(18);
      await pool.query("DELETE FROM settings WHERE key = 'insertion.rappel_rdv_heure_envoi'");
    });

    test('V-102 le déclenchement se fait à l\'heure MURALE de Paris (été et hiver)', () => {
      // 18 h de Paris = 16 h UTC en été, 17 h UTC en hiver.
      expect(doitEnvoyerRappels(new Date('2026-07-15T16:00:00Z'), 18)).toBe(true);
      expect(doitEnvoyerRappels(new Date('2026-07-15T17:00:00Z'), 18)).toBe(false);
      expect(doitEnvoyerRappels(new Date('2026-01-15T17:00:00Z'), 18)).toBe(true);
      expect(doitEnvoyerRappels(new Date('2026-01-15T16:00:00Z'), 18)).toBe(false);
    });

    test('V-103 le job part en `dry_run` sans clé Brevo, et trace un destinataire MASQUÉ', async () => {
      expect(process.env.BREVO_API_KEY).toBeFalsy();
      const bilan = await envoyerRappelsRdvSalaries();
      expect(bilan.candidats).toBe(1);         // le salarié SANS consentement n'est pas candidat
      expect(bilan.dry_run).toBe(1);
      const t = await pool.query('SELECT * FROM insertion_rappels_rdv WHERE employee_id = $1', [empRdv]);
      expect(t.rows.length).toBe(1);
      expect(t.rows[0].statut).toBe('dry_run');
      expect(t.rows[0].canal).toBe('sms');
      expect(t.rows[0].destinataire_masque).toBe('06 ** ** ** 78');
      const brutTrace = JSON.stringify(t.rows[0]);
      expect(brutTrace).not.toContain('0612345678');
      expect(brutTrace).not.toContain('06 12 34 56 78');
    });

    test('V-104 l\'envoi est journalisé, sans le contact et sans le type d\'entretien', async () => {
      const j = await journalRgpd(pool, 'INSERTION_RAPPEL_ENVOI', empRdv);
      expect(j.length).toBe(1);
      const d = typeof j[0].details === 'string' ? JSON.parse(j[0].details) : j[0].details;
      expect(d.destinataire_masque).toBe('06 ** ** ** 78');
      expect(JSON.stringify(d).toLowerCase()).not.toContain('conciliation');
      expect(JSON.stringify(d)).not.toContain('06 12 34 56 78');
    });

    test('V-105 aucun doublon au second passage (UNIQUE(milestone_id))', async () => {
      const bilan = await envoyerRappelsRdvSalaries();
      expect(bilan.candidats).toBe(0);
      const t = await pool.query('SELECT COUNT(*)::int AS n FROM insertion_rappels_rdv WHERE employee_id = $1', [empRdv]);
      expect(t.rows[0].n).toBe(1);
      await expect(pool.query(
        `INSERT INTO insertion_rappels_rdv (milestone_id, employee_id, canal, destinataire_masque, statut)
         VALUES ($1, $2, 'sms', 'x', 'envoye')`, [msRdv, empRdv]
      )).rejects.toMatchObject({ code: '23505' });
    });

    test('V-106 un entretien ANNULÉ ou RÉALISÉ ne déclenche rien', async () => {
      await pool.query('DELETE FROM insertion_rappels_rdv WHERE employee_id = $1', [empRdv]);
      await pool.query("UPDATE insertion_milestones SET status = 'realise' WHERE id = $1", [msRdv]);
      expect((await envoyerRappelsRdvSalaries()).candidats).toBe(0);
      await pool.query("UPDATE insertion_milestones SET status = 'planifie' WHERE id = $1", [msRdv]);
    });

    test('V-107 sans consentement, la personne n\'est pas même chargée (garde en SQL)', async () => {
      await pool.query('UPDATE employees SET rappel_rdv_consent = false WHERE id = $1', [empRdv]);
      expect((await envoyerRappelsRdvSalaries()).candidats).toBe(0);
      await pool.query('UPDATE employees SET rappel_rdv_consent = true WHERE id = $1', [empRdv]);
    });

    test('DÉFAUT D-03 — un rendez-vous de fin de soirée doit être rappelé la veille', async () => {
      await pool.query('DELETE FROM insertion_rappels_rdv WHERE employee_id = $1', [empRdv]);
      await pool.query('UPDATE insertion_milestones SET interview_date = $1::timestamp WHERE id = $2',
        [`${DEMAIN} 23:30:00`, msRdv]);
      let bilan;
      try {
        bilan = await envoyerRappelsRdvSalaries();
      } finally {
        // Nettoyage INCONDITIONNEL : un test rouge ne doit pas laisser le jeu
        // d'essai dans un état qui ferait tomber les suivants par ricochet.
        await pool.query('DELETE FROM insertion_rappels_rdv WHERE employee_id = $1', [empRdv]);
        await pool.query('UPDATE insertion_milestones SET interview_date = $1::timestamp WHERE id = $2',
          [`${DEMAIN} 14:00:00`, msRdv]);
      }
      // Le rendez-vous est DEMAIN à 23 h 30 (heure murale de Paris, telle que
      // la conseillère l'a saisie) : il doit être rappelé aujourd'hui, comme
      // n'importe quel rendez-vous de demain.
      expect(bilan.candidats).toBe(1);
    });

    test('DÉFAUT D-01 (suite) — le message annonce l\'heure SAISIE (14:00), pas un décalage', async () => {
      await pool.query('DELETE FROM insertion_rappels_rdv WHERE employee_id = $1', [empRdv]);
      const lignes = [];
      const espion = jest.spyOn(console, 'log').mockImplementation((...a) => { lignes.push(a.join(' ')); });
      try {
        await envoyerRappelsRdvSalaries();
      } finally {
        espion.mockRestore();
      }
      const message = lignes.find((l) => l.includes('[DRY-RUN]'));
      expect(message).toBeTruthy();
      expect(message).toContain('14:00');
    });

    test('V-109 le gabarit ne nomme jamais le type de rendez-vous', async () => {
      const r = await pool.query("SELECT type, subject, body FROM message_templates WHERE category = 'insertion_rappel_rdv'");
      expect(r.rows.length).toBe(2);
      for (const g of r.rows) {
        const texte = `${g.subject || ''} ${g.body}`.toLowerCase();
        for (const mot of ['bilan', 'conciliation', 'sortie', 'renouvellement', 'diagnostic', 'référent', 'rsa']) {
          expect([g.type, mot, texte.includes(mot)]).toEqual([g.type, mot, false]);
        }
        // CORRECTIF M-05 — le prénom a quitté le gabarit : une erreur de saisie
        // d'un chiffre faisait partir un message NOMINATIF chez un inconnu.
        expect(g.body).not.toContain('{prenom}');
        expect(g.body).toContain('{heure}');
      }
    });

    test('V-110 l\'historique des rappels est rendu masqué', async () => {
      const r = await auth(request(app).get(`/api/insertion/salarie/${empRdv}/rappels`), 'ADMIN');
      expect(r.status).toBe(200);
      expect(r.body.length).toBeGreaterThanOrEqual(1);
      expect(r.body[0].destinataire_masque).toBe('06 ** ** ** 78');
      expect(brut(r.body)).not.toContain('06 12 34 56 78');
    });

    test('V-111 masquage d\'une adresse e-mail', () => {
      expect(masquerDestinataire('email', 'jean.dupont@gmail.com')).toBe('j***@gmail.com');
      // Le numéro stocké est en E.164 ; il est REPRÉSENTÉ en forme française —
      // la conseillère vérifie de vive voix (« c'est bien le 06 qui finit par
      // 78 ? »).
      expect(masquerDestinataire('sms', '+33612345678')).toBe('06 ** ** ** 78');
      // CORRECTIF m-09 — un local-part d'une lettre était révélé entièrement.
      expect(masquerDestinataire('email', 'a@x.fr')).toBe('***@x.fr');
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 7. Purge RGPD
  // ═════════════════════════════════════════════════════════════════════════
  describe('Purge des rappels (10ᵉ purge)', () => {
    const { purgeRappelsRdv, PURGES_RGPD } = require('../../src/services/rgpd-purges');

    test('V-112 une trace de plus d\'un an est supprimée, une récente conservée', async () => {
      await pool.query('DELETE FROM insertion_rappels_rdv WHERE employee_id = $1', [empRdv]);
      await pool.query(
        `INSERT INTO insertion_rappels_rdv (milestone_id, employee_id, canal, destinataire_masque, statut, envoye_le)
         VALUES ($1, $2, 'sms', '06 ** ** ** 78', 'envoye', NOW() - INTERVAL '400 days')`, [msRdv, empRdv]
      );
      const r = await purgeRappelsRdv({ trigger: 'auto' });
      expect(r.ok).toBe(true);
      const reste = await pool.query('SELECT COUNT(*)::int AS n FROM insertion_rappels_rdv WHERE employee_id = $1', [empRdv]);
      expect(reste.rows[0].n).toBe(0);

      await pool.query(
        `INSERT INTO insertion_rappels_rdv (milestone_id, employee_id, canal, destinataire_masque, statut, envoye_le)
         VALUES ($1, $2, 'sms', '06 ** ** ** 78', 'envoye', NOW() - INTERVAL '10 days')`, [msRdv, empRdv]
      );
      await purgeRappelsRdv({ trigger: 'auto' });
      const reste2 = await pool.query('SELECT COUNT(*)::int AS n FROM insertion_rappels_rdv WHERE employee_id = $1', [empRdv]);
      expect(reste2.rows[0].n).toBe(1);
    });

    test('V-113 un déclenchement MANUEL est tracé MÊME à zéro ligne supprimée', async () => {
      await pool.query("DELETE FROM rgpd_audit_log WHERE action = 'PURGE_RAPPELS_RDV'");
      const r = await purgeRappelsRdv({ trigger: 'manual', userId: U.ADMIN.id });
      expect(r.rappels_supprimes).toBe(0);
      const j = await pool.query("SELECT details FROM rgpd_audit_log WHERE action = 'PURGE_RAPPELS_RDV'");
      expect(j.rows.length).toBe(1);
    });

    test('V-114 le registre expose 10 purges, dont celle des rappels', async () => {
      expect(PURGES_RGPD.map((p) => p.cle)).toContain('rappels_rdv');
      const r = await auth(request(app).get('/api/rgpd/purges'), 'ADMIN');
      expect(r.status).toBe(200);
      const liste = Array.isArray(r.body) ? r.body : r.body.purges;
      expect(liste.length).toBe(10);
      const p = liste.find((x) => x.cle === 'rappels_rdv');
      expect(p).toBeDefined();
      expect(p.retention.valeur).toBe(365);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  // 8. Anonymisation
  // ═════════════════════════════════════════════════════════════════════════
  describe('Anonymisation d\'un dossier complet', () => {
    test('V-115 documents, rappels, reports, consentement et jeton sont purgés', async () => {
      // On charge le dossier à anonymiser de tout ce que la PR C produit.
      const msAnon = await pool.query(
        `INSERT INTO insertion_milestones (employee_id, milestone_type, titre, due_date, status, interview_date, eti_token, eti_token_expires_at)
         VALUES ($1, 'renouvellement', 'R', $2::date, 'planifie', $3::timestamp, $4, NOW() + INTERVAL '30 days') RETURNING id`,
        [anon, DEMAIN, `${DEMAIN} 09:00:00`, 'c'.repeat(32)]
      );
      await pool.query(
        `INSERT INTO insertion_documents_salarie (employee_id, type, contenu) VALUES ($1, 'mon_parcours', '{"x":1}'::jsonb)`, [anon]
      );
      await pool.query(
        `INSERT INTO insertion_rappels_rdv (milestone_id, employee_id, canal, destinataire_masque, statut)
         VALUES ($1, $2, 'sms', '06 ** ** ** 11', 'envoye')`, [msAnon.rows[0].id, anon]
      );
      await pool.query(
        `INSERT INTO insertion_echeance_reports (employee_id, echeance_type, reporte_jusqu_au, motif)
         VALUES ($1, 'referent_unique', NOW() + INTERVAL '2 days', 'autre')`, [anon]
      );
      await auth(request(app).put(`/api/insertion/salarie/${anon}/rappels-consentement`), 'ADMIN')
        .send({ consent: true, canal: 'sms', destinataire: '0611111111' });

      const { anonymizeEmployee } = require('../../src/services/anonymization');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await anonymizeEmployee(client, anon);
        await client.query('COMMIT');
      } finally { client.release(); }

      const compte = async (t) => (await pool.query(`SELECT COUNT(*)::int AS n FROM ${t} WHERE employee_id = $1`, [anon])).rows[0].n;
      expect(await compte('insertion_documents_salarie')).toBe(0);
      expect(await compte('insertion_rappels_rdv')).toBe(0);
      expect(await compte('insertion_echeance_reports')).toBe(0);
      const e = await pool.query(
        'SELECT rappel_rdv_consent, rappel_rdv_destinataire, rappel_rdv_canal FROM employees WHERE id = $1', [anon]
      );
      expect(e.rows[0].rappel_rdv_consent).toBeNull();
      expect(e.rows[0].rappel_rdv_destinataire).toBeNull();
      expect(e.rows[0].rappel_rdv_canal).toBeNull();
      const c = await pool.query(
        "SELECT COUNT(*)::int AS n FROM rgpd_consents WHERE entity_type = 'employee' AND entity_id = $1 AND consent_type = 'rappel_rdv'", [anon]
      );
      expect(c.rows[0].n).toBe(0);
      const ms = await pool.query('SELECT eti_token FROM insertion_milestones WHERE id = $1', [msAnon.rows[0].id]);
      expect(ms.rows[0].eti_token).toBeNull();
    });

    // ═══ CORRECTIF M-03 — base NON MIGRÉE, effacement quand même ═══════════
    // La garde était un `try { … } catch (42703)` dont le commentaire promettait
    // « l'anonymisation ne doit pas échouer pour autant ». Dans PostgreSQL, une
    // instruction en erreur AVORTE la transaction : toutes les suivantes
    // tombaient en 25P02 et le droit à l'effacement n'était pas exercé. On
    // reproduit une base où la migration PR C n'est pas passée (déploiement
    // interrompu, base de recette, restauration partielle) en retirant la
    // colonne, puis on la rétablit.
    test('V-129 une colonne PR C absente n\'empêche PAS l\'anonymisation (SAVEPOINT / catalogue)', async () => {
      const cible = await creerSalarie(pool, M.m03, {
        first_name: 'Nadia', last_name: 'Nonmigree', insertion_status: 'en_parcours',
      });
      m03 = cible;
      await pool.query('ALTER TABLE insertion_milestones DROP COLUMN IF EXISTS eti_token');
      let erreur = null;
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const { anonymizeEmployee } = require('../../src/services/anonymization');
        await anonymizeEmployee(client, cible);
        await client.query('COMMIT');
      } catch (e) {
        erreur = e;
        await client.query('ROLLBACK').catch(() => {});
      } finally {
        client.release();
        // Colonne rétablie exactement comme la migration la pose.
        await pool.query('ALTER TABLE insertion_milestones ADD COLUMN IF NOT EXISTS eti_token VARCHAR(32)');
        await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_insertion_milestones_eti_token
                            ON insertion_milestones(eti_token) WHERE eti_token IS NOT NULL`);
      }
      expect(erreur).toBeNull();
      const e = await pool.query('SELECT first_name, malibou_id FROM employees WHERE id = $1', [cible]);
      // Le dossier EST anonymisé : avant le correctif, le ROLLBACK le laissait
      // intact (« Marie » dans la reproduction de la revue de sécurité).
      expect(e.rows[0].first_name).not.toBe('Nadia');
    });
  });
});
