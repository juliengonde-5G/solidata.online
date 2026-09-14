// ═══════════════════════════════════════════════════════════════════════════
// PR D lot 6 — REPORTING AUTORITÉ, SUR POSTGRESQL RÉEL
//
// Ce que cette suite prouve, et que le `pg` simulé ne pouvait pas prouver :
//   · le SQL neuf s'exécute (deux LEFT JOIN LATERAL, generate_series ×
//     make_date, ROW_NUMBER() OVER) — une requête fautive est AVALÉE par le
//     `soft` du service et rend un bloc `null` SANS que rien ne le dise ;
//   · le dénominateur B est celui des PERSONNES parties, pas des bilans, et
//     les deux méthodes se lisent côte à côte sur des chiffres qui diffèrent ;
//   · les quatre surfaces qui publient ce taux disent la MÊME chose ;
//   · le k-anonymat coupe réellement à 4 et laisse passer à 5, sur des
//     agrégats calculés par PostgreSQL et non par un mock ;
//   · le journal de génération est dans la MÊME transaction que le snapshot ;
//   · les dates civiles ne glissent pas d'un fuseau à l'autre.
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const {
  RUN, pool, creerComptes, purgerPrD, creerSalarie, cohorteHorsPerimetre,
  journalParAction, dernierIdJournal, parChemin, toutesLesCles, etatPool, signerChauffeur, signer,
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
app.use('/api/performance', require('../../src/routes/performance'));

jest.setTimeout(300000);

const PREFIXE = 'jest_prD_rep';
const AN = 2026;          // année de la double méthode (réglage par défaut)
const AN_VIDE = 2019;     // année sans aucune donnée → EXPORT_VIDE
const AN_AUTRE = 2025;    // année ≠ double méthode → methode_a doit être null

// 12 dossiers, chacun construit pour un cas précis.
const M = {
  f1: 'PRDR_F1', f2: 'PRDR_F2', f3: 'PRDR_F3',   // fins de parcours documentées
  f4: 'PRDR_F4', f5: 'PRDR_F5',                   // fins NON documentées
  b6: 'PRDR_B6',                                  // bilan classé SANS fin de parcours
  p1: 'PRDR_P1', p2: 'PRDR_P2', p3: 'PRDR_P3',
  p4: 'PRDR_P4', p5: 'PRDR_P5', p6: 'PRDR_P6',
};
const MATS = Object.values(M);

let U; const E = {}; let chauffeur; let jalon0;

const auth = (r, role) => r.set('Authorization', `Bearer ${U[role].token}`);

/** Insertion générique — évite douze requêtes recopiées. */
async function ins(table, obj) {
  const cols = Object.keys(obj);
  const r = await pool.query(
    `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
    cols.map((c) => obj[c])
  );
  return r.rows[0] && r.rows[0].id;
}

/** Diagnostic d'accueil portant les niveaux d'ENTRÉE des freins. */
function diag(employeeId, freins) {
  return ins('insertion_diagnostics', {
    employee_id: employeeId, parcours_num: 1, niveau_formation: 'CAP', ...freins,
  });
}

/** Entretien réalisé portant les niveaux ACTUELS (dernière évaluation). */
function bilan(employeeId, dateIso, freins, extra = {}) {
  return ins('insertion_milestones', {
    employee_id: employeeId, parcours_num: 1, milestone_type: 'bilan_intermediaire',
    due_date: dateIso, completed_date: dateIso, status: 'realise', ...freins, ...extra,
  });
}

(RUN ? describe : describe.skip)('PR D lot 6 — reporting autorité (PostgreSQL réel)', () => {
  beforeAll(async () => {
    await purgerPrD(pool, { matricules: MATS, usernamePrefix: PREFIXE, annees: [AN, AN_AUTRE, AN_VIDE] });
    U = await creerComptes(pool, PREFIXE, ['ADMIN', 'RH', 'MANAGER']);
    U.QHSE = { token: signer({ id: 0, username: `${PREFIXE}_qhse`, role: 'QHSE' }), role: 'QHSE' };
    U.COMMUNICATION = { token: signer({ id: 0, username: `${PREFIXE}_com`, role: 'COMMUNICATION' }), role: 'COMMUNICATION' };
    U.AUTORITE = { token: signer({ id: 0, username: `${PREFIXE}_aut`, role: 'AUTORITE' }), role: 'AUTORITE' };
    chauffeur = signerChauffeur(77);

    // ── Les cinq fins de parcours de l'année ─────────────────────────────
    // Trois documentées (bilan de sortie CLASSÉ), deux non documentées.
    E.f1 = await creerSalarie(pool, M.f1, {
      first_name: 'Fatou', last_name: 'Aa', insertion_status: 'termine',
      insertion_start_date: '2025-02-01', insertion_end_date: `${AN}-03-15`,
      referent_unique_type: 'cms', brsa: true, brsa_date_constat: `${AN}-01-05`,
      ft_categorie: 'A', gender: 'F', birth_date: '1990-06-15', nationality: 'Française',
      city: 'Rouen', weekly_hours: 26, cip_referent_user_id: U.RH.id,
    });
    E.f2 = await creerSalarie(pool, M.f2, {
      first_name: 'Bruno', last_name: 'Bb', insertion_status: 'termine',
      insertion_start_date: '2025-03-01', insertion_end_date: `${AN}-04-20`,
      referent_unique_type: 'cms', brsa: true, ft_categorie: 'A', gender: 'M',
      birth_date: '1985-01-20', weekly_hours: 26, cip_referent_user_id: U.RH.id,
    });
    E.f3 = await creerSalarie(pool, M.f3, {
      first_name: 'Chloé', last_name: 'Cc', insertion_status: 'termine',
      insertion_start_date: '2025-04-01', insertion_end_date: `${AN}-05-10`,
      referent_unique_type: 'cms', brsa: true, ft_categorie: 'A', gender: 'F',
      birth_date: '1998-11-02', weekly_hours: 26, cip_referent_user_id: U.RH.id,
    });
    E.f4 = await creerSalarie(pool, M.f4, {
      first_name: 'Driss', last_name: 'Dd', insertion_status: 'termine',
      insertion_start_date: '2025-05-01', insertion_end_date: `${AN}-06-01`,
      referent_unique_type: 'cms', brsa: true, ft_categorie: 'A', gender: 'M',
      birth_date: '1975-03-03', weekly_hours: 26, cip_referent_user_id: U.RH.id,
    });
    // Fin de parcours le 31/12 : la borne de l'année, et le cas du fuseau.
    E.f5 = await creerSalarie(pool, M.f5, {
      first_name: 'Elsa', last_name: 'Ee', insertion_status: 'termine',
      insertion_start_date: '2025-06-01', insertion_end_date: `${AN}-12-31`,
      referent_unique_type: 'cms', brsa: true, ft_categorie: 'G', gender: 'F',
      birth_date: '1969-12-31', weekly_hours: 26, cip_referent_user_id: U.RH.id,
    });
    // Bilan classé SANS date de fin de parcours : compte en A, pas en B.
    E.b6 = await creerSalarie(pool, M.b6, {
      first_name: 'Farid', last_name: 'Ff', insertion_status: 'en_parcours',
      insertion_start_date: '2025-07-01', referent_unique_type: 'france_travail',
      gender: 'M', birth_date: '1992-02-02', weekly_hours: 26, cip_referent_user_id: U.RH.id,
    });

    // ── Six dossiers encore en parcours ──────────────────────────────────
    const enParcours = [
      ['p1', 'Gaëlle', 'Gg', 'france_travail', 'F', '2000-05-05'],
      ['p2', 'Hugo', 'Hh', 'france_travail', 'M', '1988-08-08'],
      ['p3', 'Inès', 'Ii', 'france_travail', 'F', '1996-09-09'],
      ['p4', 'Jonas', 'Jj', 'structure', 'M', '1979-10-10'],
      ['p5', 'Karim', 'Kk', 'autre', 'M', '1983-11-11'],
      ['p6', 'Lucie', 'Ll', null, 'F', '2002-12-12'],
    ];
    for (const [cle, prenom, nom, ref, sexe, naissance] of enParcours) {
      const champs = {
        first_name: prenom, last_name: nom, insertion_status: 'en_parcours',
        insertion_start_date: `${AN}-01-15`, gender: sexe, birth_date: naissance,
        weekly_hours: 26, cip_referent_user_id: U.RH.id,
      };
      if (ref) champs.referent_unique_type = ref;
      E[cle] = await creerSalarie(pool, M[cle], champs);
    }

    // ── Critères d'éligibilité ───────────────────────────────────────────
    // « brsa » sur 5 personnes → au-dessus du seuil, rendu.
    for (const c of ['f1', 'f2', 'f3', 'f4', 'f5']) {
      await ins('employee_eligibilite', { employee_id: E[c], critere_code: 'brsa', date_constat: `${AN}-01-05` });
    }
    // « rqth » sur 3 → sous le seuil, retiré et listé.
    for (const c of ['p1', 'p2', 'p3']) {
      await ins('employee_eligibilite', { employee_id: E[c], critere_code: 'rqth' });
    }
    // Critère art. 10 sur 2 personnes : il ne doit JAMAIS apparaître, ni
    // masqué, ni listé dans `sous_seuil` (mentionner une exclusion, c'est
    // encore désigner).
    for (const c of ['p4', 'p5']) {
      await ins('employee_eligibilite', { employee_id: E[c], critere_code: 'sortant_detention' });
    }

    // ── Contrats CDDI (effectif pondéré du bloc 1) ───────────────────────
    for (const cle of Object.keys(E)) {
      await ins('employee_contracts', {
        employee_id: E[cle], contract_type: 'CDDI', weekly_hours: 26,
        start_date: `${AN}-01-01`, end_date: `${AN}-12-31`, is_current: true,
      });
    }

    // ── Freins : entrée (diagnostic) → dernière évaluation (entretien) ───
    // Axe MOBILITÉ construit pour donner exactement 5 levés (rendu) et des
    // comptes sous le seuil ailleurs.
    const plan = {
      f1: [4, 2], f2: [4, 2], f3: [4, 2], f4: [4, 2], f5: [4, 2],   // 5 levés
      b6: [3, 4],                                                    // 1 aggravé
      p1: [3, 3], p2: [3, 3], p3: [3, 3], p4: [3, 3],                // 4 stables
      p5: [3, null], p6: [null, null],                               // 2 non évalués
    };
    for (const [cle, [entree, actuel]] of Object.entries(plan)) {
      await diag(E[cle], {
        frein_mobilite: entree, frein_sante: entree, frein_logement: entree,
        frein_linguistique: entree, frein_administratif: entree, frein_finances: entree,
        // Le judiciaire est RENSEIGNÉ en base : son absence du document doit
        // venir du code, pas de l'absence de donnée.
        frein_judiciaire: 4,
      });
      if (actuel != null) {
        await bilan(E[cle], `${AN}-08-01`, {
          frein_mobilite: actuel, frein_sante: actuel, frein_logement: actuel,
          frein_judiciaire: 1,
        }, { duree_minutes: 60, presence: 'present' });
      }
    }

    // ── Bilans de sortie ─────────────────────────────────────────────────
    await bilan(E.f1, `${AN}-03-14`, {}, {
      milestone_type: 'bilan_sortie', sortie_classification: 'emploi_durable', sortie_type: 'cdi',
    });
    await bilan(E.f2, `${AN}-04-19`, {}, {
      milestone_type: 'bilan_sortie', sortie_classification: 'emploi_transition', sortie_type: 'cdd_6m',
    });
    await bilan(E.f3, `${AN}-05-09`, {}, {
      milestone_type: 'bilan_sortie', sortie_classification: 'sortie_positive', sortie_type: 'formation',
    });
    jalon0 = await bilan(E.b6, `${AN}-09-01`, {}, {
      milestone_type: 'bilan_sortie', sortie_classification: 'autre', sortie_type: 'autre',
    });

    // ── Points d'étape, conciliations, absences motivées (bloc 8) ────────
    for (const c of ['p1', 'p2', 'p3']) {
      await bilan(E[c], `${AN}-06-10`, {}, { milestone_type: 'point_etape_referent', referent_modalite: 'bilaterale' });
    }
    await bilan(E.p4, `${AN}-06-11`, {}, {
      milestone_type: 'conciliation', conciliation_motifs: JSON.stringify(['sante']), conciliation_issue: 'maintien',
    });
    await bilan(E.p5, `${AN}-06-12`, {}, { presence: 'absent', absence_motif: 'transport' });

    // ── PMSMP : six conventions, débouchés variés ────────────────────────
    const immersions = [
      ['f1', 'Entreprise Alpha', 'embauche_accueillant'],
      ['f2', 'Entreprise Beta', 'embauche_accueillant'],
      ['f3', 'Entreprise Gamma', 'embauche_autre'],
      ['p1', 'Entreprise Delta', 'formation'],
      ['p2', 'Entreprise Epsilon', 'aucun'],
      ['p3', 'Entreprise Zeta', null],
    ];
    for (const [cle, entreprise, debouche] of immersions) {
      await ins('insertion_pmsmp', {
        employee_id: E[cle], entreprise, objet: 'decouvrir_metier',
        date_debut: `${AN}-02-01`, date_fin: `${AN}-02-10`,
        debouche, debouche_date: debouche ? `${AN}-02-15` : null,
        embauche_accueillant: debouche === 'embauche_accueillant' ? true : (debouche ? false : null),
        saisie_outil_officiel: true,
      });
    }

    // ── Actions CIP : DORA, aides, partenaires, catégories nouvelles ─────
    const partenaire = await pool.query(
      "SELECT id FROM insertion_partenaires WHERE categorie = 'cms' ORDER BY id LIMIT 1"
    );
    const partId = partenaire.rows[0] && partenaire.rows[0].id;
    const actions = [
      ['f1', 'mobilite', 'job_dating', 'Rencontre employeurs', 'https://dora.inclusion.beta.gouv.fr/s/1', 'oriente', 'mobilite', 120],
      ['f2', 'mobilite', 'formation_fle', 'Atelier FLE', 'https://dora.inclusion.beta.gouv.fr/s/2', 'pris_en_charge', 'formation', null],
      ['f3', 'mobilite', 'frein', 'Permis', null, null, 'mobilite', 300.5],
      ['p1', 'sante', 'frein', 'Bilan santé', 'https://dora.inclusion.beta.gouv.fr/s/3', 'refuse', 'sante', null],
      ['p2', 'logement', 'insertion', 'Dossier logement', null, 'sans_suite', 'logement', 0],
    ];
    for (const [cle, axe, categorie, libelle, url, resultat, aide, montant] of actions) {
      await ins('cip_action_plans', {
        employee_id: E[cle], action_label: libelle, category: categorie, frein_type: axe,
        date_realisation: `${AN}-05-05`, partenaire_id: partId,
        dora_service: url ? 'Service DORA' : null, dora_url: url, dora_resultat: resultat,
        aide_nature: aide, aide_organisme: 'Département 76', aide_montant: montant,
      });
    }

    // ── ETP ASP : six mois validés, dont le nb de BRSA ───────────────────
    for (let m = 1; m <= 6; m++) {
      await ins('etp_asp_mensuel', {
        annee: AN, mois: m, etp_asp: 24.5 + m / 10, nb_brsa: 10 + m, source: 'import_pdf',
      });
    }
    // Sorties déclarées à l'ASP (rapprochement du bloc 6) : 4 pour 5 constatées.
    for (const [i, cle] of ['f1', 'f2', 'f3', 'f4'].entries()) {
      await ins('etp_asp_salaries', {
        annee: AN, mois: 3 + i, nom_asp: `ASP ${i}`, date_sortie: `${AN}-0${3 + i}-15`, employee_id: E[cle],
      });
    }

    // ── Suivi à +6 mois (bloc 7) et satisfaction ─────────────────────────
    for (const [cle, situation] of [['f1', 'emploi_durable'], ['f2', 'emploi_transition'], ['f3', 'injoignable']]) {
      await ins('insertion_fse_sorties', {
        employee_id: E[cle], parcours_num: 1, source: 'bilan',
        date_sortie: `${AN}-03-20`, situation_sortie: 'emploi_durable',
        situation_6mois: situation, date_releve_6mois: `${AN}-09-20`,
      });
    }

    // ── Alimentations du référent, actualisations France Travail ─────────
    for (const c of ['f1', 'f2', 'p1']) {
      await ins('insertion_alimentations_referent', {
        employee_id: E[c], parcours_num: 1, moment: 'renouvellement',
        periode_debut: `${AN}-01-01`, periode_fin: `${AN}-06-30`,
        destinataire_type: 'cms', contenu: JSON.stringify({ rubriques: [] }),
        remis_referent_le: `${AN}-07-01`, remis_referent_mode: 'main_propre',
      });
    }
    for (const c of ['f1', 'f2', 'p1', 'p2']) {
      await ins('insertion_actualisations_ft', {
        employee_id: E[c], mois: `${AN}-06-01`, rappel_le: `${AN}-06-25`, honoree: null,
      });
    }

    // ── Participants ASI (bloc 8, complétude FSE+) ───────────────────────
    const asi = await pool.query("SELECT id FROM insertion_projets WHERE type = 'asi' ORDER BY id LIMIT 1");
    if (asi.rows[0]) {
      for (const c of ['f1', 'f2', 'p1']) {
        await ins('insertion_projet_participants', {
          projet_id: asi.rows[0].id, employee_id: E[c], date_entree: `${AN}-01-20`,
        });
      }
    }

    // ── Semaines relevées sous le plancher (bloc 8) ──────────────────────
    for (const c of ['p1', 'p2']) {
      for (const s of [10, 11, 12]) {
        await ins('employee_week_hours', {
          employee_id: E[c], iso_year: AN, iso_week: s,
          week_start: `${AN}-03-02`, week_end: `${AN}-03-08`,
          hours_worked: 8, hours_contract: 26, statut: 'valide', source: 'import',
        }).catch(() => {});
      }
    }
  });

  afterAll(async () => {
    await purgerPrD(pool, { matricules: MATS, usernamePrefix: PREFIXE, annees: [AN, AN_AUTRE, AN_VIDE] });
    await pool.end();
  });

  // ═════════════════════════════════════════════════════════════════════
  // 0. Le jeu d'essai est bien SEUL dans la base
  // ═════════════════════════════════════════════════════════════════════
  test('V-00 — aucune autre personne en parcours dans la base (les agrégats sont mesurables)', async () => {
    expect(await cohorteHorsPerimetre(pool, MATS)).toBe(0);
  });

  // ═════════════════════════════════════════════════════════════════════
  // 1. Le SQL neuf s'exécute pour de vrai
  // ═════════════════════════════════════════════════════════════════════
  describe('SQL neuf (le `soft` avale les erreurs — il faut vérifier les RÉSULTATS)', () => {
    let synthese;
    beforeAll(async () => {
      const r = await auth(request(app).get(`/api/insertion/reporting/dialogue-gestion?annee=${AN}`), 'ADMIN');
      expect(r.status).toBe(200);
      synthese = r.body;
    });

    test('V-01 — bloc 1 : generate_series × make_date rend les 12 mois et un effectif pondéré non nul', () => {
      const b = synthese.blocs['1_effectifs_etp'];
      expect(b.mois).toHaveLength(12);
      expect(b.mois[0].mois).toBe(`${AN}-01`);
      expect(b.mois[11].mois).toBe(`${AN}-12`);
      // 12 contrats CDDI à 26 h → 12 × 26/35 = 8,91
      expect(b.mois[5].effectif_pondere).toBeCloseTo(8.91, 2);
      expect(b.base_heures).toBe(1820);
    });

    test('V-02 — bloc 1 : ETP ASP lu, moyenne sur les seuls mois validés', () => {
      const b = synthese.blocs['1_effectifs_etp'];
      expect(b.nb_mois_asp_valides).toBe(6);
      expect(b.mois[0].etp_asp).toBeCloseTo(24.6, 2);
      expect(b.mois[6].etp_asp).toBeNull();
      expect(b.etp_asp_moyen).toBeCloseTo(24.85, 2);
    });

    test('V-03 — bloc 3 : ROW_NUMBER() OVER rend un partenaire principal par axe', async () => {
      // Le SQL se vérifie sur l'ÉCRAN INTERNE (`/audit`), qui n'applique aucune
      // suppression. Sur le DOCUMENT, le partenaire principal d'un axe portant
      // moins de 5 actions est retiré depuis le correctif B-01/D-07 : un
      // partenaire unique sur un axe à une action désigne le dossier.
      const audit = (await auth(request(app).get(`/api/insertion/audit?year=${AN}`), 'ADMIN')).body;
      const interne = (audit.freins_evolution.par_axe || []).find((a) => a.axe === 'mobilite');
      expect(interne.partenaire_principal).toMatch(/CMS/i);
      const axe = synthese.blocs['3_freins'].par_axe.find((a) => a.axe === 'mobilite');
      expect(axe.partenaire_principal).toBeNull();
    });

    test('V-04 — bloc 3 : le LATERAL de dernière évaluation compte 5 levés (rendus) sur mobilité', () => {
      const axe = synthese.blocs['3_freins'].par_axe.find((a) => a.axe === 'mobilite');
      expect(axe.leves).toBe(5);
      expect(synthese.blocs['3_freins'].nb_dossiers).toBe(12);
    });

    test('V-05 — bloc 8 : aucun bloc indisponible, la complétude FSE+ est composée', async () => {
      const b = synthese.blocs['8_conformite'];
      expect(Array.isArray(b.completude_fse_par_projet)).toBe(true);
      // Les chiffres eux-mêmes se vérifient sur l'écran interne : sur le
      // document, ces quatre compteurs portent chacun sur moins de 5 personnes
      // et sont retirés depuis le correctif B-01 (« 1 entretien de conciliation »
      // dit qu'UNE personne a fait l'objet d'une procédure contradictoire).
      const audit = (await auth(request(app).get(`/api/insertion/audit?year=${AN}`), 'ADMIN')).body;
      const i = audit.conformite;
      expect(i.points_etape_referent).toBe(3);
      expect(i.fiches_referent_transmises).toBe(3);
      expect(i.actualisations_ft_rappelees).toBe(4);
      expect(i.conciliations).toBe(1);
      for (const cle of ['points_etape_referent', 'fiches_referent_transmises',
        'actualisations_ft_rappelees', 'conciliations']) {
        expect([cle, b[cle]]).toEqual([cle, null]);
      }
    });

    // ── DÉFAUT D-04 : un mois sans aucun contrat CDDI vaut 1,00 ETP ──────
    test("V-05b — DÉFAUT D-04 · un mois sans le moindre contrat CDDI ne doit pas valoir 1,00 ETP", async () => {
      // 2025 : la cohorte n'a AUCUN contrat (ils commencent au 01/01/2026).
      const r = await auth(request(app).get(`/api/insertion/reporting/dialogue-gestion?annee=${AN_AUTRE}`), 'ADMIN');
      expect(r.status).toBe(200);
      const mois = r.body.blocs['1_effectifs_etp'].mois;
      // Attendu : 0 ETP (« il n'y a personne »), et non 1,00 ETP sorti de rien.
      expect(mois.map((m) => m.effectif_pondere)).toEqual(new Array(12).fill(0));
    });

    // ── DÉFAUT D-04, constat connexe : deux avenants ouverts = deux ETP ──
    test("V-05c — CORRECTIF D-04 · deux avenants d'un même salarié laissés ouverts ne pèsent pas deux ETP", async () => {
      // Une reprise manuelle peut laisser deux lignes `employee_contracts` sans
      // date de fin pour la même personne. Le LEFT JOIN les comptait toutes les
      // deux : une seule personne pesait 1,49 ETP.
      const avant = (await auth(request(app).get(`/api/insertion/reporting/dialogue-gestion?annee=${AN}`), 'ADMIN'))
        .body.blocs['1_effectifs_etp'].mois[5].effectif_pondere;
      const r = await pool.query(
        `INSERT INTO employee_contracts (employee_id, contract_type, weekly_hours, start_date, end_date, is_current)
         VALUES ($1, 'CDDI', 26, $2, NULL, false) RETURNING id`,
        [E.f1, `${AN}-02-01`]
      );
      try {
        const apres = (await auth(request(app).get(`/api/insertion/reporting/dialogue-gestion?annee=${AN}`), 'ADMIN'))
          .body.blocs['1_effectifs_etp'].mois[5].effectif_pondere;
        expect(apres).toBeCloseTo(avant, 2);
      } finally {
        await pool.query('DELETE FROM employee_contracts WHERE id = $1', [r.rows[0].id]);
      }
    });

    test('V-06 — aucun bloc ne porte `indisponible` (une requête fautive dégraderait en silence)', () => {
      for (const [nom, bloc] of Object.entries(synthese.blocs)) {
        if (bloc && typeof bloc === 'object' && !Array.isArray(bloc)) {
          expect([nom, bloc.indisponible]).toEqual([nom, undefined]);
        }
      }
    });
  });

  // ═════════════════════════════════════════════════════════════════════
  // 2. Le dénominateur des sorties
  // ═════════════════════════════════════════════════════════════════════
  describe('sorties-engine sur base réelle', () => {
    let audit; let synthese;
    beforeAll(async () => {
      audit = (await auth(request(app).get(`/api/insertion/audit?year=${AN}`), 'ADMIN')).body;
      synthese = (await auth(request(app).get(`/api/insertion/reporting/dialogue-gestion?annee=${AN}`), 'ADMIN')).body;
    });

    test('V-07 — méthode B : 5 fins de parcours, 3 documentées, 2 non documentées', () => {
      const mb = audit.sorties.methode_b;
      expect(mb.denominateur).toBe(5);
      expect(mb.documentees).toBe(3);
      expect(mb.non_documentees).toBe(2);
      expect(mb.par_classification).toEqual({
        emploi_durable: 1, emploi_transition: 1, sortie_positive: 1, autre: 0, non_documentee: 2,
      });
      expect(mb.taux_pct.dynamiques).toBe(60);
    });

    test('V-08 — le bilan classé sans fin de parcours est NOMMÉ et explique l\'écart des deux dénominateurs', () => {
      const mb = audit.sorties.methode_b;
      expect(mb.bilans_sans_fin_parcours).toBe(1);
      expect(audit.sorties.methode_a_imprimee.denominateur).toBe(4);
      expect(audit.sorties.methode_a_imprimee.taux_pct.dynamiques).toBe(75);
    });

    test('V-09 — méthode A imprimée en 2026, `null` en 2025 (année ≠ double méthode)', async () => {
      expect(synthese.blocs['6_sorties'].methode_a).not.toBeNull();
      const autre = (await auth(request(app).get(`/api/insertion/audit?year=${AN_AUTRE}`), 'ADMIN')).body;
      expect(autre.sorties.methode_a_imprimee).toBeNull();
      expect(autre.sorties.methode_b.denominateur).toBe(0);
      expect(autre.sorties.methode_b.taux_pct.dynamiques).toBeNull(); // jamais 0 %
    });

    test('V-10 — les clés HISTORIQUES de `sorties` sont conservées ET portent la méthode A', () => {
      for (const cle of ['total', 'dynamiques', 'autres', 'taux_dynamiques',
        'par_classification', 'taux_par_classification', 'par_type']) {
        expect(audit.sorties).toHaveProperty(cle);
      }
      // Elles restent celles de la méthode historique : 4 bilans classés,
      // 3 dynamiques, 75 %. La série publiée depuis 2026-07 ne bouge pas.
      expect(audit.sorties.total).toBe(4);
      expect(audit.sorties.dynamiques).toBe(3);
      expect(audit.sorties.autres).toBe(1);
      expect(audit.sorties.taux_dynamiques).toBe(75);
    });

    test('V-11 — rapprochement ASP : 5 constatées, 4 déclarées, écart 1', () => {
      expect(audit.sorties.rapprochement_asp.sorties_asp).toBe(4);
      expect(audit.sorties.rapprochement_asp.ecart).toBe(1);
    });

    test('V-12 — les règles sont imprimées en toutes lettres, dont « objectif non paramétré »', () => {
      const regles = synthese.blocs['6_sorties'].regles.join(' | ');
      expect(regles).toMatch(/Méthode B/);
      expect(regles).toMatch(/Méthode A/);
      expect(regles).toMatch(/non documentée/i);
      expect(regles).toMatch(/objectif non paramétré/i);
    });

    test('V-13 — COHÉRENCE des quatre surfaces : /audit, synthèse, CSV et /performance', async () => {
      const perf = await auth(request(app).get('/api/performance/industrial-kpis'), 'ADMIN');
      const syntheseJson = (await auth(request(app).get(`/api/exports/insertion-synthese?year=${AN}`), 'ADMIN')).body;
      const mbAudit = audit.sorties.methode_b;
      const mbDoc = synthese.blocs['6_sorties'].methode_b;

      expect(mbDoc.denominateur).toBe(mbAudit.denominateur);
      expect(mbDoc.documentees).toBe(mbAudit.documentees);
      expect(mbDoc.non_documentees).toBe(mbAudit.non_documentees);
      // Depuis le correctif B-01, le DOCUMENT en dit moins que l'écran : les
      // taux dont la case de comptage est retirée le sont aussi, sans quoi un
      // taux multiplié par un dénominateur publié rendrait le numérateur. La
      // cohérence exigible n'est donc pas l'égalité terme à terme mais celle-ci :
      // le document ne dit jamais AUTRE CHOSE que l'écran, il dit moins.
      for (const [cle, v] of Object.entries(mbDoc.taux_pct)) {
        if (v !== null) expect([cle, v]).toEqual([cle, mbAudit.taux_pct[cle]]);
      }
      expect(mbDoc.taux_pct.dynamiques).toBe(mbAudit.taux_pct.dynamiques);
      expect(syntheseJson.sorties.methode_b.denominateur).toBe(mbAudit.denominateur);

      expect(perf.status).toBe(200);
      // /performance calcule sur l'année CIVILE en cours — identique tant que
      // l'on est en 2026, ce qui est le cas du jeu d'essai.
      if (new Date().getFullYear() === AN) {
        expect(perf.body.insertion.fins_parcours_annee).toBe(mbAudit.denominateur);
        expect(perf.body.insertion.sorties.non_documentees).toBe(mbAudit.non_documentees);
        expect(perf.body.insertion.sorties.taux_dynamiques_pct).toBe(mbAudit.taux_pct.dynamiques);
      }
    });

    test('V-14 — /performance : aucun pourcentage sans dénominateur', async () => {
      const perf = (await auth(request(app).get('/api/performance/industrial-kpis'), 'ADMIN')).body;
      const s = perf.insertion.sorties;
      if (s && s.taux_dynamiques_pct !== null) expect(perf.insertion.fins_parcours_annee).toBeGreaterThan(0);
      expect(perf.insertion).toHaveProperty('en_parcours');
      expect(perf.insertion).toHaveProperty('methode');
    });
  });

  // ═════════════════════════════════════════════════════════════════════
  // 3. k-anonymat, non nominativité, judiciaire
  // ═════════════════════════════════════════════════════════════════════
  describe('confidentialité du document', () => {
    let s;
    beforeAll(async () => {
      s = (await auth(request(app).get(`/api/insertion/reporting/dialogue-gestion?annee=${AN}`), 'ADMIN')).body;
    });

    test('V-15 — un agrégat à 4 est retiré et COMPTÉ ; à 5 il est rendu', () => {
      const refs = s.blocs['2_publics_entree'].par_referent_unique;
      expect(refs.cms).toBe(5);                    // 5 → rendu
      expect(refs.france_travail).toBeNull();      // 4 → retiré
      // CORRECTIF B-01 — `sous_seuil` compte par BLOC et ne nomme plus le
      // chemin de la case retirée : sur une ventilation qui somme à un effectif
      // publié, ce chemin désignait la case à reconstituer par soustraction.
      const bloc2 = s.sous_seuil.find((x) => x.bloc === '2_publics_entree');
      expect(bloc2).toBeDefined();
      expect(bloc2.nb).toBeGreaterThan(0);
      expect(bloc2.libelle).toMatch(/Publics/);
      expect(s.sous_seuil_total).toBeGreaterThanOrEqual(bloc2.nb);
      expect(JSON.stringify(s.sous_seuil)).not.toMatch(/france_travail|par_referent_unique/);
    });

    test('V-15b — SUPPRESSION COMPLÉMENTAIRE : une seule case retirée se retrouverait par soustraction', () => {
      // Référents : structure 1, cms 5, france_travail 4, autre 1, non_determine 1.
      // Quatre cases sous le seuil → aucune reconstitution possible ; mais la
      // règle est vérifiée là où elle mord : le nombre de cases RETIRÉES d'une
      // ventilation qui somme à l'effectif publié n'est JAMAIS égal à 1.
      const b2 = s.blocs['2_publics_entree'];
      for (const cle of ['par_categorie_ft', 'par_referent_unique', 'sexe', 'tranches_age', 'niveaux_formation']) {
        const retirees = Object.values(b2[cle] || {}).filter((v) => v === null).length;
        expect([cle, retirees === 1]).toEqual([cle, false]);
      }
    });

    test('V-16 — zéro reste zéro (il ne désigne personne)', () => {
      const ft = s.blocs['2_publics_entree'].par_categorie_ft;
      expect(ft.B).toBe(0);
      // Le zéro n'est pas compté parmi les agrégats retirés : le total des
      // retraits du bloc 2 égale le nombre de cases réellement nulles.
      const nulles = [
        ...Object.values(ft), ...Object.values(s.blocs['2_publics_entree'].par_referent_unique),
        ...Object.values(s.blocs['2_publics_entree'].sexe),
        ...Object.values(s.blocs['2_publics_entree'].tranches_age),
        ...Object.values(s.blocs['2_publics_entree'].niveaux_formation),
      ].filter((v) => v === null).length;
      expect(nulles).toBeGreaterThan(0);
    });

    test('V-17 — les effectifs bruts globaux échappent au seuil', () => {
      expect(s.blocs['2_publics_entree'].effectif).toBe(12);
      expect(s.blocs['5_immersions'].conventions).toBe(6);
      expect(s.blocs['6_sorties'].methode_b.denominateur).toBe(5);
      expect(s.blocs['6_sorties'].methode_b.non_documentees).toBe(2); // indicateur n° 15
    });

    test('V-18 — le critère art. 10 est ABSENT, et son exclusion n\'est pas mentionnée', () => {
      const codes = s.blocs['2_publics_entree'].par_critere_eligibilite.map((c) => c.code);
      expect(codes).toContain('brsa');
      expect(codes).not.toContain('sortant_detention');
      const brut = JSON.stringify(s);
      expect(brut).not.toMatch(/sortant_detention/);
      expect(brut).not.toMatch(/détention/i);
    });

    test('V-19 — le frein judiciaire est absent du bloc 3 et de tout le document', () => {
      const axes = s.blocs['3_freins'].par_axe.map((a) => a.axe);
      expect(axes).toContain('mobilite');
      expect(axes).not.toContain('judiciaire');
      expect(JSON.stringify(s)).not.toMatch(/judiciaire/i);
    });

    test('V-20 — aucune clé nominative dans la sérialisation complète', () => {
      const cles = toutesLesCles(s);
      for (const interdite of ['nom', 'prenom', 'employee_id', 'first_name', 'last_name',
        'birth_date', 'email', 'phone', 'matricule', 'malibou_id', 'id']) {
        expect([interdite, cles.has(interdite)]).toEqual([interdite, false]);
      }
      // Et aucun patronyme du jeu d'essai dans le texte du document.
      const brut = JSON.stringify(s);
      for (const p of ['Fatou', 'Bruno', 'Chloé', 'Driss', 'Elsa', 'Gaëlle', 'PRDR_']) {
        expect([p, brut.includes(p)]).toEqual([p, false]);
      }
    });

    test('V-21 — `n_asp` du BRSA vient du DERNIER mois validé', () => {
      expect(s.blocs['2_publics_entree'].brsa.n_asp).toBe(16); // mois 6 → 10 + 6
      expect(s.blocs['2_publics_entree'].brsa.n).toBe(5);
    });

    test('V-22 — base 1 820 h : réglage par défaut, puis convention de l\'annexe financière', async () => {
      expect(s.blocs['1_effectifs_etp'].base_heures).toBe(1820);
      expect(s.blocs['1_effectifs_etp'].etp_conventionnes).toBeNull();
      expect(s.blocs['1_effectifs_etp'].source_convention).toBe('non_parametre');

      await pool.query(
        `INSERT INTO settings (key, value) VALUES ($1, $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [`effectifs.convention_${AN}`, JSON.stringify({ etp_conventionnes: 25.17, heures_annuelles_etp: 1607 })]
      );
      const avec = (await auth(request(app).get(`/api/insertion/reporting/dialogue-gestion?annee=${AN}`), 'ADMIN')).body;
      expect(avec.blocs['1_effectifs_etp'].base_heures).toBe(1607);
      expect(avec.blocs['1_effectifs_etp'].etp_conventionnes).toBe(25.17);
      expect(avec.blocs['1_effectifs_etp'].source_convention).toBe('annexe_financiere');
      expect(avec.blocs['1_effectifs_etp'].taux_realisation_pct).toBeGreaterThan(0);
      await pool.query('DELETE FROM settings WHERE key = $1', [`effectifs.convention_${AN}`]);
    });
  });

  // ═════════════════════════════════════════════════════════════════════
  // 4. Les quatre gestes de la route
  // ═════════════════════════════════════════════════════════════════════
  describe('génération, snapshot, historique, CSV', () => {
    test('V-23 — GET journalise un APERÇU et ne crée aucune ligne', async () => {
      const avant = await dernierIdJournal(pool);
      const nbAvant = (await pool.query('SELECT COUNT(*)::int AS n FROM insertion_dialogues_gestion')).rows[0].n;
      const r = await auth(request(app).get(`/api/insertion/reporting/dialogue-gestion?annee=${AN}`), 'RH');
      expect(r.status).toBe(200);
      const nbApres = (await pool.query('SELECT COUNT(*)::int AS n FROM insertion_dialogues_gestion')).rows[0].n;
      expect(nbApres).toBe(nbAvant);
      const traces = await journalParAction(pool, 'INSERTION_DIALOGUE_GESTION_APERCU', avant);
      expect(traces).toHaveLength(1);
      expect(traces[0].details).toMatchObject({ annee: AN });
      expect(JSON.stringify(traces[0].details)).not.toMatch(/PRDR_|Fatou/);
    });

    test('V-24 — POST crée le snapshot ET sa trace dans la MÊME transaction', async () => {
      const avant = await dernierIdJournal(pool);
      const r = await auth(request(app).post('/api/insertion/reporting/dialogue-gestion'), 'ADMIN').send({ annee: AN });
      expect(r.status).toBe(201);
      expect(r.body.id).toBeGreaterThan(0);
      const ligne = await pool.query('SELECT * FROM insertion_dialogues_gestion WHERE id = $1', [r.body.id]);
      expect(ligne.rows).toHaveLength(1);
      expect(ligne.rows[0].annee).toBe(AN);
      expect(ligne.rows[0].trimestre).toBeNull();
      expect(ligne.rows[0].genere_par).toBe(U.ADMIN.id);
      // Le JSONB STOCKÉ ne porte aucune clé nominative (ce n'est pas la
      // projection de la route qui est éprouvée, c'est ce qui dort en base).
      const stocke = JSON.stringify(ligne.rows[0].contenu);
      expect(stocke).not.toMatch(/PRDR_|Fatou|judiciaire|sortant_detention/i);
      const traces = await journalParAction(pool, 'INSERTION_DIALOGUE_GESTION_GENERATION', avant);
      expect(traces).toHaveLength(1);
      expect(traces[0].details.snapshot_id).toBe(r.body.id);
    });

    test('V-25 — journal en échec → AUCUN snapshot (la transaction tombe entière)', async () => {
      const nbAvant = (await pool.query('SELECT COUNT(*)::int AS n FROM insertion_dialogues_gestion')).rows[0].n;
      // Contrainte temporaire qui fait échouer l'INSERT du journal.
      await pool.query(`ALTER TABLE rgpd_audit_log ADD CONSTRAINT jest_prd_bloque
        CHECK (action <> 'INSERTION_DIALOGUE_GESTION_GENERATION') NOT VALID`);
      try {
        const r = await auth(request(app).post('/api/insertion/reporting/dialogue-gestion'), 'ADMIN').send({ annee: AN });
        expect(r.status).toBe(500);
        const nbApres = (await pool.query('SELECT COUNT(*)::int AS n FROM insertion_dialogues_gestion')).rows[0].n;
        expect(nbApres).toBe(nbAvant);
      } finally {
        await pool.query('ALTER TABLE rgpd_audit_log DROP CONSTRAINT jest_prd_bloque');
      }
    });

    test('V-26 — historique puis rejeu d\'un snapshot (journal CONSULTATION)', async () => {
      const h = await auth(request(app).get(`/api/insertion/reporting/dialogue-gestion/historique?annee=${AN}`), 'MANAGER');
      expect(h.status).toBe(200);
      expect(h.body.length).toBeGreaterThanOrEqual(1);
      expect(h.body[0]).toHaveProperty('genere_par_role');
      expect(h.body[0].type).toBe('annuelle');
      // Le nom complet du générateur n'est jamais rendu : prénom + initiale.
      expect(String(h.body[0].genere_par || '')).not.toMatch(/ADMIN$/);

      const avant = await dernierIdJournal(pool);
      const rejeu = await auth(request(app).get(`/api/insertion/reporting/dialogue-gestion/${h.body[0].id}`), 'ADMIN');
      expect(rejeu.status).toBe(200);
      expect(rejeu.body.blocs['6_sorties'].methode_b.denominateur).toBe(5);
      const traces = await journalParAction(pool, 'INSERTION_DIALOGUE_GESTION_CONSULTATION', avant);
      expect(traces).toHaveLength(1);
    });

    test('V-27 — un snapshot rejoue CE QUI EST PARTI, pas ce que le dossier dit aujourd\'hui', async () => {
      const ins2 = await pool.query(
        `INSERT INTO insertion_dialogues_gestion (annee, trimestre, contenu, genere_par)
         VALUES ($1, NULL, $2, $3) RETURNING id`,
        [AN, JSON.stringify({ en_tete: { annee: AN }, blocs: { '2_publics_entree': { effectif: 44 } }, sous_seuil: [] }), U.ADMIN.id]
      );
      const r = await auth(request(app).get(`/api/insertion/reporting/dialogue-gestion/${ins2.rows[0].id}`), 'ADMIN');
      expect(r.body.blocs['2_publics_entree'].effectif).toBe(44);
      await pool.query('DELETE FROM insertion_dialogues_gestion WHERE id = $1', [ins2.rows[0].id]);
    });

    test('V-28 — CSV : BOM, séparateur `;`, en-tête de traçabilité, journal bloquant', async () => {
      const avant = await dernierIdJournal(pool);
      const r = await auth(request(app).get(`/api/insertion/reporting/dialogue-gestion?annee=${AN}&format=csv`), 'ADMIN');
      expect(r.status).toBe(200);
      expect(r.headers['content-type']).toMatch(/text\/csv/);
      expect(r.text.charCodeAt(0)).toBe(0xFEFF);
      expect(r.text).toMatch(/# Export;Synthèse de dialogue de gestion/);
      expect(r.text).toMatch(/Généré par \(rôle\);ADMIN/);
      expect(r.text).toMatch(/\nBloc;Indicateur;Valeur\n/);
      expect(r.text).toMatch(/9\. Méthode/);
      const traces = await journalParAction(pool, 'EXPORT_DIALOGUE_GESTION', avant);
      expect(traces).toHaveLength(1);
    });

    test('V-29 — CSV : les formules sont neutralisées (raison sociale `=1+1`, service DORA `@cmd`)', async () => {
      await pool.query("UPDATE insertion_pmsmp SET entreprise = '=1+1' WHERE employee_id = $1", [E.p3]);
      await pool.query("UPDATE insertion_partenaires SET nom = '@cmd|calc' WHERE id = (SELECT partenaire_id FROM cip_action_plans WHERE employee_id = $1 LIMIT 1)", [E.f1]);
      try {
        const r = await auth(request(app).get(`/api/insertion/reporting/dialogue-gestion?annee=${AN}&format=csv`), 'ADMIN');
        expect(r.status).toBe(200);
        // Aucune cellule ne commence par =, +, - ou @ après le point-virgule.
        const cellulesDangereuses = r.text.split('\n')
          .filter((l) => !l.startsWith('#'))
          .flatMap((l) => l.split(';'))
          .filter((c) => /^"?[=+@]/.test(c));
        expect(cellulesDangereuses).toEqual([]);
        expect(r.text).toMatch(/1\+1/);   // la valeur est bien là, seulement désamorcée
      } finally {
        await pool.query("UPDATE insertion_pmsmp SET entreprise = 'Entreprise Zeta' WHERE employee_id = $1", [E.p3]);
        await pool.query("UPDATE insertion_partenaires SET nom = 'Centre médico-social (CMS) — Département 76' WHERE nom = '@cmd|calc'");
      }
    });

    // ── DÉFAUT D-06 : le CSV écrit un seuil en dur ────────────────────────
    // Le seuil d'essai est 8 et non 3 : depuis le correctif m-02, un réglage
    // SOUS 5 est refusé (plancher), un seuil de confidentialité ne se baissant
    // pas par un champ de réglage. C'est au-dessus qu'il se règle.
    test("V-29b — DÉFAUT D-06 · le CSV doit nommer le seuil RÉEL, pas « moins de 5 » en dur", async () => {
      await pool.query(
        `INSERT INTO settings (key, value) VALUES ('insertion.k_anonymat_min', '8')
         ON CONFLICT (key) DO UPDATE SET value = '8'`
      );
      try {
        const r = await auth(request(app).get(`/api/insertion/reporting/dialogue-gestion?annee=${AN}&format=csv`), 'ADMIN');
        expect(r.status).toBe(200);
        // Le bloc 9 du MÊME fichier dit « entre 1 et 7 personnes ».
        expect(r.text).toMatch(/entre 1 et 7 personnes/);
        // Et les lignes de la liste ne peuvent plus annoncer « moins de 5 ».
        expect(r.text).not.toMatch(/moins de 5 personnes/);
        expect(r.text).toMatch(/moins de 8 personnes/);
      } finally {
        await pool.query("DELETE FROM settings WHERE key = 'insertion.k_anonymat_min'");
      }
    });

    test("V-29d — CORRECTIF m-02 · un seuil réglé SOUS 5 ne désactive rien : le plancher tient", async () => {
      await pool.query(
        `INSERT INTO settings (key, value) VALUES ('insertion.k_anonymat_min', '1')
         ON CONFLICT (key) DO UPDATE SET value = '1'`
      );
      try {
        const r = await auth(request(app).get(`/api/insertion/reporting/dialogue-gestion?annee=${AN}`), 'ADMIN');
        expect(r.body.en_tete.k_anonymat).toBe(5);
        // 4 référents France Travail : le réglage à 1 ne les fait pas ressortir.
        expect(r.body.blocs['2_publics_entree'].par_referent_unique.france_travail).toBeNull();
      } finally {
        await pool.query("DELETE FROM settings WHERE key = 'insertion.k_anonymat_min'");
      }
    });

    test("V-29c — un seuil RELEVÉ est bien appliqué (le réglage ne sert qu'à durcir)", async () => {
      await pool.query(
        `INSERT INTO settings (key, value) VALUES ('insertion.k_anonymat_min', '8')
         ON CONFLICT (key) DO UPDATE SET value = '8'`
      );
      try {
        const r = await auth(request(app).get(`/api/insertion/reporting/dialogue-gestion?annee=${AN}`), 'ADMIN');
        expect(r.body.en_tete.k_anonymat).toBe(8);
        // 5 référents CMS : rendus à k = 5, retirés à k = 8.
        expect(r.body.blocs['2_publics_entree'].par_referent_unique.cms).toBeNull();
      } finally {
        await pool.query("DELETE FROM settings WHERE key = 'insertion.k_anonymat_min'");
      }
    });

    test('V-30 — trimestre : seuls les blocs 2 et 8 (+ en-tête + méthode)', async () => {
      const r = await auth(request(app).get(`/api/insertion/reporting/dialogue-gestion?annee=${AN}&trimestre=2`), 'ADMIN');
      expect(r.status).toBe(200);
      expect(Object.keys(r.body.blocs).sort()).toEqual(['2_publics_entree', '8_conformite', '9_methode']);
      expect(r.body.en_tete.type).toBe('trimestrielle_allegee');
      expect(r.body.en_tete.periode_debut).toBe(`${AN}-04-01`);
      expect(r.body.en_tete.periode_fin).toBe(`${AN}-06-30`);
    });

    test('V-30b — le trimestriel d\'une année vide est refusé lui aussi', async () => {
      const r = await auth(request(app).get(`/api/insertion/reporting/dialogue-gestion?annee=${AN_VIDE}&trimestre=1&format=csv`), 'ADMIN');
      expect(r.status).toBe(409);
      expect(r.body.code).toBe('EXPORT_VIDE');
    });

    test('V-31 — 409 EXPORT_VIDE sur une année sans fin de parcours ni cohorte', async () => {
      const csv = await auth(request(app).get(`/api/insertion/reporting/dialogue-gestion?annee=${AN_VIDE}&format=csv`), 'ADMIN');
      expect(csv.status).toBe(409);
      expect(csv.body.code).toBe('EXPORT_VIDE');
      const post = await auth(request(app).post('/api/insertion/reporting/dialogue-gestion'), 'ADMIN').send({ annee: AN_VIDE });
      expect(post.status).toBe(409);
      expect(post.body.code).toBe('EXPORT_VIDE');
      const n = (await pool.query('SELECT COUNT(*)::int AS n FROM insertion_dialogues_gestion WHERE annee = $1', [AN_VIDE])).rows[0].n;
      expect(n).toBe(0);
      // Et l'export de synthèse comité refuse de la même façon.
      const syn = await auth(request(app).get(`/api/exports/insertion-synthese?year=${AN_VIDE}&format=csv`), 'ADMIN');
      expect(syn.status).toBe(409);
      expect(syn.body.code).toBe('EXPORT_VIDE');
    });
  });

  // ═════════════════════════════════════════════════════════════════════
  // 5. Habilitations et fuites de pool
  // ═════════════════════════════════════════════════════════════════════
  describe('habilitations', () => {
    test('V-32 — MANAGER lit (200) et n\'enregistre pas (403) — refus AVANT toute requête', async () => {
      const lecture = await auth(request(app).get(`/api/insertion/reporting/dialogue-gestion?annee=${AN}`), 'MANAGER');
      expect(lecture.status).toBe(200);

      const espion = jest.spyOn(pool, 'query');
      const ecriture = await auth(request(app).post('/api/insertion/reporting/dialogue-gestion'), 'MANAGER').send({ annee: AN });
      expect(ecriture.status).toBe(403);
      expect(espion).not.toHaveBeenCalled();
      espion.mockRestore();
    });

    test('V-33 — COMMUNICATION, AUTORITE, QHSE et le jeton chauffeur : 403 avant toute requête', async () => {
      for (const role of ['COMMUNICATION', 'AUTORITE', 'QHSE']) {
        const espion = jest.spyOn(pool, 'query');
        const r = await request(app)
          .get(`/api/insertion/reporting/dialogue-gestion?annee=${AN}`)
          .set('Authorization', `Bearer ${U[role].token}`);
        expect([role, r.status]).toEqual([role, 403]);
        expect([role, espion.mock.calls.length]).toEqual([role, 0]);
        espion.mockRestore();
      }
      const espionC = jest.spyOn(pool, 'query');
      const c = await request(app)
        .get(`/api/insertion/reporting/dialogue-gestion?annee=${AN}`)
        .set('Authorization', `Bearer ${chauffeur}`);
      expect(c.status).toBe(403);
      expect(espionC).not.toHaveBeenCalled();
      espionC.mockRestore();
    });

    test('V-34 — aucune fuite de connexion sur les refus ni sur les 409', async () => {
      const avant = etatPool(pool);
      for (let i = 0; i < 6; i++) {
        await auth(request(app).post('/api/insertion/reporting/dialogue-gestion'), 'MANAGER').send({ annee: AN });
        await auth(request(app).post('/api/insertion/reporting/dialogue-gestion'), 'ADMIN').send({ annee: AN_VIDE });
        await auth(request(app).get('/api/insertion/reporting/dialogue-gestion?annee=1999'), 'ADMIN');
        await auth(request(app).get('/api/insertion/reporting/dialogue-gestion/999999'), 'ADMIN');
      }
      await new Promise((r) => setTimeout(r, 200));
      const apres = etatPool(pool);
      expect(apres.waiting).toBe(0);
      expect(apres.total - apres.idle).toBeLessThanOrEqual(Math.max(1, avant.total - avant.idle));
    });

    test('V-35 — validation : année et trimestre hors bornes → 400, jamais 500', async () => {
      expect((await auth(request(app).get('/api/insertion/reporting/dialogue-gestion?annee=abc'), 'ADMIN')).status).toBe(400);
      expect((await auth(request(app).get(`/api/insertion/reporting/dialogue-gestion?annee=${AN}&trimestre=9`), 'ADMIN')).status).toBe(400);
      expect((await auth(request(app).get('/api/insertion/reporting/dialogue-gestion/abc'), 'ADMIN')).status).toBe(400);
      expect((await auth(request(app).get('/api/insertion/reporting/dialogue-gestion/999999'), 'ADMIN')).status).toBe(404);
    });
  });

  // ═════════════════════════════════════════════════════════════════════
  // 5 bis. Écran interne : ce que le MANAGER reçoit
  // ═════════════════════════════════════════════════════════════════════
  describe('écran interne /audit', () => {
    // ── CORRECTIF B-02 (bloquant) ─────────────────────────────────────────
    test("V-35d — CORRECTIF B-02 · un MANAGER ne reçoit AUCUN statut social, sur les deux routes", async () => {
      for (const url of [`/api/insertion/audit?year=${AN}`, `/api/exports/insertion-synthese?year=${AN}&format=json`]) {
        const r = await auth(request(app).get(url), 'MANAGER');
        expect([url, r.status]).toEqual([url, 200]);
        expect([url, 'publics_entree' in r.body]).toEqual([url, false]);
        const { projection_role: _n, ...donnees } = r.body;
        const brut = JSON.stringify(donnees);
        // La cohorte de recette porte 5 BRSA, 3 RQTH et des catégories FT.
        expect([url, /"brsa"/.test(brut)]).toEqual([url, false]);
        expect([url, /Travailleur handicapé|par_categorie_ft|par_referent_unique/i.test(brut)]).toEqual([url, false]);
        expect([url, 'rqth' in r.body.typologies]).toEqual([url, false]);
        expect([url, 'ressources' in r.body.typologies]).toEqual([url, false]);
        expect([url, r.body.projection_role.applique]).toEqual([url, true]);
      }
    });

    test("V-35e — CORRECTIF B-02 · un ADMIN les reçoit toujours (la CIP n'est pas appauvrie)", async () => {
      const r = await auth(request(app).get(`/api/insertion/audit?year=${AN}`), 'ADMIN');
      expect(r.body.publics_entree).toBeTruthy();
      expect(r.body.publics_entree.brsa.n).toBe(5);
      expect(r.body.projection_role).toBeUndefined();
    });

    test('V-35b — MANAGER : /audit répond 200 et ne porte AUCUNE ventilation par salarié', async () => {
      const r = await auth(request(app).get(`/api/insertion/audit?year=${AN}`), 'MANAGER');
      expect(r.status).toBe(200);
      expect(r.body.heures_accompagnement).not.toHaveProperty('par_salarie');
      const cles = toutesLesCles({
        freins_evolution: r.body.freins_evolution, publics_entree: r.body.publics_entree,
        immersions: r.body.immersions, conformite: r.body.conformite,
        accompagnement: r.body.accompagnement, etp_asp: r.body.etp_asp,
        dora: r.body.dora, aides_mobilisees: r.body.aides_mobilisees,
        ruptures_droits_evitees: r.body.ruptures_droits_evitees,
      });
      for (const interdite of ['par_salarie', 'employee_id', 'nom', 'prenom', 'first_name', 'last_name']) {
        expect([interdite, cles.has(interdite)]).toEqual([interdite, false]);
      }
    });

    test('V-35c — les nouveaux blocs de /audit ne sont PAS masqués (écran interne)', async () => {
      const r = await auth(request(app).get(`/api/insertion/audit?year=${AN}`), 'ADMIN');
      // 4 référents « France Travail » : retirés du document, rendus à l'écran.
      expect(r.body.publics_entree.par_referent_unique.france_travail).toBe(4);
      expect(r.body.immersions.embauches_chez_accueillant).toBe(2);
      expect(r.body.pmsmp.par_debouche.embauche_accueillant).toBe(2);
    });

    test('V-35d — coût mesuré de /audit sur PostgreSQL réel (limite § 6.2 du lot)', async () => {
      const t0 = Date.now();
      const r = await auth(request(app).get(`/api/insertion/audit?year=${AN}`), 'ADMIN');
      const ms = Date.now() - t0;
      expect(r.status).toBe(200);
      // Repère, pas verrou : la cohorte de recette est de 12 dossiers.
      expect(ms).toBeLessThan(20000);
      console.log(`[MESURE] GET /insertion/audit sur 12 dossiers : ${ms} ms`);
    });
  });

  // ═════════════════════════════════════════════════════════════════════
  // 6. Dates civiles — les deux fuseaux
  // ═════════════════════════════════════════════════════════════════════
  describe('dates', () => {
    test('V-36 — un parcours terminé le 31/12 est compté dans SON année, quel que soit le fuseau', async () => {
      const a = (await auth(request(app).get(`/api/insertion/audit?year=${AN}`), 'ADMIN')).body;
      expect(a.sorties.methode_b.denominateur).toBe(5);   // la fin du 31/12 y est
      const suivante = (await auth(request(app).get(`/api/insertion/audit?year=${AN + 1}`), 'ADMIN')).body;
      expect(suivante.sorties.methode_b.denominateur).toBe(0);
      const ligne = await pool.query('SELECT insertion_end_date FROM employees WHERE id = $1', [E.f5]);
      // Le pilote rend un objet Date construit à minuit LOCAL : l'assertion
      // passe par le helper de production, jamais par toISOString().
      const { isoDate } = require('../../src/utils/date-iso');
      expect(isoDate(ligne.rows[0].insertion_end_date)).toBe(`${AN}-12-31`);
    });

    test('V-37 — les bornes de trimestre sont les bonnes dans les deux fuseaux', async () => {
      for (const [t, debut, fin] of [[1, '01-01', '03-31'], [2, '04-01', '06-30'], [3, '07-01', '09-30'], [4, '10-01', '12-31']]) {
        const r = await auth(request(app).get(`/api/insertion/reporting/dialogue-gestion?annee=${AN}&trimestre=${t}`), 'ADMIN');
        expect([t, r.body.en_tete.periode_debut]).toEqual([t, `${AN}-${debut}`]);
        expect([t, r.body.en_tete.periode_fin]).toEqual([t, `${AN}-${fin}`]);
      }
    });

    test('V-38 — la sortie ASP du 15/03 tombe dans le T1 et pas dans le T2', async () => {
      const { composerDialogueGestion } = require('../../src/services/dialogue-gestion');
      const t1 = await composerDialogueGestion({ annee: AN, trimestre: null });
      expect(t1.blocs['6_sorties'].rapprochement_asp.sorties_asp).toBe(4);
    });
  });
});
