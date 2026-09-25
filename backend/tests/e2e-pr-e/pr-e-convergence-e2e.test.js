// ═══════════════════════════════════════════════════════════════════════════
// Lot 2.60.0 — REPORTING CONVERGENCE (programme CVG), SUR POSTGRESQL RÉEL
//
// Ce que cette suite prouve, et que le `pg` simulé du lot ne pouvait pas :
//   · la cohorte du formulaire scanné, RECONSTITUÉE EN BASE (46 accueillis,
//     9 sortis…), ressort de `GET /convergence/apercu` cellule par cellule —
//     à travers le vrai SQL (LATERAL de dernière évaluation, EXISTS des
//     contrats à la date de fin, critères d'éligibilité, transcodages) ;
//   · les dates civiles ne glissent pas d'un fuseau à l'autre (la suite est
//     jouée sous `TZ=UTC` ET `TZ=Europe/Paris`) ;
//   · chaque geste écrit sa ligne au journal RGPD, et un journal indisponible
//     empêche le document de sortir ;
//   · l'instantané `type='cvg'` ne se mélange pas à la synthèse de dialogue de
//     gestion, dans un sens comme dans l'autre ;
//   · la situation de sortie s'écrit en upsert sur le vrai UNIQUE ;
//   · le registre des moyens humains, la comparaison et l'anonymisation.
// ═══════════════════════════════════════════════════════════════════════════
'use strict';

const {
  RUN, pool, creerComptes, purgerPrE, creerSalarie, cohorteHorsPerimetre, journalParAction,
  dernierIdJournal, signerChauffeur, signer, ins, iso, decalerJours,
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

jest.setTimeout(300000);

const PREFIXE = 'jest_prE_cvg';
const RESS = 'JEST_CVG ';
const DEBUT = '2026-04-01';
const FIN = '2026-09-30';
const PERIODE = `debut=${DEBUT}&fin=${FIN}`;
const N = 46;
const MAT = (i) => `PRECVG_${String(i).padStart(2, '0')}`;
const MATS_COHORTE = Array.from({ length: N }, (_, k) => MAT(k + 1));
const MATS_PIEGES = ['PRECVG_AVANT', 'PRECVG_APRES', 'PRECVG_PERM'];
const MATS_EXTRA = ['PRECVG_B1', 'PRECVG_B2', 'PRECVG_3009', 'PRECVG_1001'];
const MATS = [...MATS_COHORTE, ...MATS_PIEGES, ...MATS_EXTRA];

// Neuf sortants : fin de parcours et durée (jours). Durée moyenne 283 j = 9,30 mois.
const FINS_SORTANTS = ['2026-04-01', '2026-04-20', '2026-05-10', '2026-05-31', '2026-06-15',
  '2026-07-01', '2026-07-20', '2026-08-10', '2026-09-29'];
const DUREES_SORTANTS = [200, 250, 283, 300, 320, 283, 283, 283, 345];

let U; const E = {}; const tousIds = [];
const auth = (r, role) => r.set('Authorization', `Bearer ${U[role].token}`);
const apercu = (q = PERIODE) => auth(request(app).get(`/api/insertion/convergence/apercu?${q}`), 'RH');

/** Profil d'entrée de la personne n° i — la cohorte du scan, ligne par ligne. */
function profil(i) {
  const e = {
    first_name: `Cvg${i}`, last_name: `Personne${i}`,
    insertion_status: i <= 9 ? 'termine' : 'en_parcours',
    is_active: i > 9, parcours_num: 1,
  };
  // Sexe : 18 H / 28 F — la fiche fait foi, la civilité en repli.
  if (i <= 16) e.gender = 'M';
  else if (i === 17) e.civility = 'M.';
  else if (i === 18) e.civility = 'Monsieur';
  else if (i <= 44) e.gender = 'F';
  else if (i === 45) e.civility = 'Mme';
  else e.civility = 'Madame';
  // Âge au 30/09/2026 : 4 / 31 / 11, avec les deux bornes du formulaire.
  if (i === 1) e.birth_date = '2000-10-01';          // 25 ans la veille de ses 26 → moins de 26
  else if (i <= 4) e.birth_date = '2003-05-05';
  else if (i === 5) e.birth_date = '2000-09-30';     // 26 ans le jour même → 26-49
  else if (i === 35) e.birth_date = '1976-10-01';    // 49 ans → 26-49
  else if (i === 36) e.birth_date = '1976-09-30';    // 50 ans le jour même → 50 et plus
  else if (i >= 37) e.birth_date = '1965-03-03';
  else e.birth_date = '1985-06-15';
  // RSA 32 : statut de la fiche (20), le reste par critère / ressources (plus bas).
  if (i <= 20) e.brsa = true;
  // RTH 5 : 4 par critère (plus bas), 37-38 au diagnostic, 39-40 par la fiche ; 41-42 pièges.
  if (i === 39) e.disability_status = 'RQTH';
  if (i === 40) e.disability_status = 'Travailleur handicapé';
  if (i === 41) e.disability_status = 'non';
  if (i === 42) e.disability_status = 'Aucun';
  // Orienteurs : 37 FT, 1 ML, 5 PLIE, 2 « autre acteur local d'accompagnement »
  // (une saisie ancienne `ccas` transcodée + une saisie directe), 1 spontanée.
  e.orienteur_type = i <= 37 ? 'france_travail' : i === 38 ? 'mission_locale'
    : i <= 43 ? 'plie_pmie' : i === 44 ? 'ccas' : i === 45 ? 'autre_accompagnement' : 'candidature_spontanee';
  if (i <= 9) {
    const fin = FINS_SORTANTS[i - 1];
    e.insertion_end_date = fin;
    e.insertion_start_date = decalerJours(fin, -DUREES_SORTANTS[i - 1]);
    e.contract_end = fin;
  } else {
    e.insertion_start_date = i <= 40 ? '2026-01-05' : '2026-06-01';
    if (i > 39) { e.contract_start = e.insertion_start_date; e.contract_end = i === 46 ? null : '2027-03-31'; }
  }
  return e;
}

/** Diagnostic d'accueil de la personne n° i. */
function diagnostic(i) {
  const d = { parcours_num: 1 };
  d.niveau_formation = i <= 5 ? 'infra3' : i <= 34 ? 'niv3' : i <= 42 ? 'niv4' : i <= 44 ? 'niv5' : 'niv7';
  // Habitat 14 / 22 / 2 / 7 / 0, 1 non renseigné (« hébergé » : ambigu).
  if (i <= 10) d.habitat_type = 'autonome';
  else if (i === 11) d.logement_statut = 'locataire_social';
  else if (i === 12) d.logement_statut = 'locataire_prive';
  else if (i <= 14) d.logement_statut = 'proprietaire';
  else if (i <= 36) d.habitat_type = 'semi_durable';
  else if (i <= 38) { d.habitat_type = 'hebergement_collectif'; d.logement_statut = 'heberge'; }
  else if (i <= 45) d.habitat_type = 'hebergement_precaire';
  else d.logement_statut = 'heberge';
  if (i === 39) d.logement_statut = 'sans_abri'; // la saisie CVG prime : précaire, pas rue
  d.parcours_rue = i >= 39 && i <= 43;
  if (i === 37 || i === 38) d.rqth = true;
  if (i === 1 || i === 2) d.pension_invalidite = true;
  if (i === 4) d.pension_invalidite = false;
  if (i <= 3) d.medecin_traitant = true;
  if (i === 5) d.medecin_traitant = false;
  d.mutuelle_statut = i <= 2 ? 'css' : 'aucune';
  const fse = {};
  if (i <= 15) fse.duree_sans_emploi = 'gt_24m';
  if (i === 31 || i === 32) fse.ressources_principales = 'rsa';
  if (i === 35) fse.ressources_principales = 'ass';
  d.fse_entree = JSON.stringify(fse);
  if (i >= 27 && i <= 30) d.ressources = ['rsa'];
  if (i === 34) d.ressources = ['ASS'];
  // Difficultés à l'entrée (seuil 3) : 16 / 20 / 19 / 31 / 7 / 3 / 6 / 23.
  // En dessous du seuil : 1 ou 2 — jamais une difficulté. Numérique : 5 pour
  // TOUT LE MONDE (s'il était transmis, il le serait sur 46).
  d.frein_linguistique = i <= 16 ? 3 : 2;
  d.frein_sante = i <= 20 ? 4 : 1;
  d.frein_logement = i <= 19 ? 3 : 2;
  d.frein_administratif = i <= 31 ? 3 : 1;
  d.frein_finances = i <= 7 ? 5 : 2;
  d.frein_judiciaire = i <= 3 ? 3 : 1;
  d.frein_famille = i <= 6 ? 3 : 2;
  d.frein_mobilite = i <= 23 ? 3 : 1;
  d.frein_numerique = 5;
  return d;
}

/** Critères d'éligibilité de la personne n° i. */
function criteres(i) {
  const c = [];
  if (i >= 21 && i <= 26) c.push('brsa');
  if (i === 33) c.push('ass');
  if (i >= 16 && i <= 23) c.push('detld');
  if (i === 4) c.push('rqth');
  if (i >= 44) c.push('refugie_bpi');
  return c;
}

/** Bilans de sortie des 9 sortants (+ les évaluations qui portent les freins de sortie). */
const BILANS = {
  // Sortant 1 : bilan de sortie rédigé le 20/03, DOUZE JOURS AVANT la fin du
  // parcours (le 01/04) — l'échéancier de l'outil le pose à fin − 15 j.
  1: { completed_date: '2026-03-20', sortie_classification: 'emploi_durable', sortie_type: 'CDI',
    freins: { frein_linguistique: 1, frein_sante: 3, frein_logement: 2, frein_administratif: 1, frein_finances: 4, frein_judiciaire: 3, frein_famille: 3, frein_mobilite: 1 } },
  2: { completed_date: '2026-04-10', sortie_classification: 'sortie_positive', sortie_type: 'formation' },
  3: { completed_date: '2026-05-01', sortie_classification: 'sortie_positive', sortie_type: 'formation' },
  4: { completed_date: '2026-05-20', sortie_classification: 'autre', sortie_type: 'fin_contrat' },
  5: { completed_date: '2026-06-05', sortie_classification: 'autre', sortie_type: null },
  6: { completed_date: '2026-06-20', sortie_classification: 'autre', sortie_type: null },
  7: { completed_date: '2026-07-10', sortie_classification: 'sortie_positive', sortie_type: null },
  8: { completed_date: '2026-08-01', sortie_classification: 'emploi_transition', sortie_type: null },
  9: { completed_date: '2026-09-20', sortie_classification: 'sortie_positive', sortie_type: 'autre' },
};
/** Évaluations intermédiaires (dernière évaluation des freins). */
const EVALS = {
  2: { completed_date: '2026-02-10', freins: { frein_linguistique: 1 } },
  4: { completed_date: '2026-05-01', freins: { frein_finances: 2, frein_logement: 3, frein_sante: 5 } },
  5: { completed_date: '2026-05-15', freins: { frein_administratif: 2, frein_mobilite: 2 } },
  // Sortant 7 : famille 2 → 1. Ce n'était PAS une difficulté à l'entrée (seuil 3).
  7: { completed_date: '2026-06-01', freins: { frein_sante: 2, frein_famille: 1, frein_linguistique: 3 } },
  8: { completed_date: '2026-07-01', freins: { frein_mobilite: 1 } },
};

async function creerPersonne(i, over = {}) {
  const p = { ...profil(i), ...over };
  const id = await creerSalarie(pool, over.malibou_id || MAT(i), p);
  tousIds.push(id);
  return id;
}

async function poserDossier(i, id) {
  await ins('insertion_diagnostics', { employee_id: id, ...diagnostic(i) });
  for (const c of criteres(i)) {
    await pool.query('INSERT INTO employee_eligibilite (employee_id, critere_code) VALUES ($1, $2)', [id, c]);
  }
}

(RUN ? describe : describe.skip)('Lot 2.60.0 — reporting Convergence (PostgreSQL réel)', () => {
  let conventionAvant;

  beforeAll(async () => {
    await purgerPrE(pool, { matricules: MATS, usernamePrefix: PREFIXE, ressourcesPrefix: RESS });
    U = await creerComptes(pool, PREFIXE, ['ADMIN', 'RH']);
    U.COLLABORATEUR = { token: signer({ id: 0, username: `${PREFIXE}_col`, role: 'COLLABORATEUR' }) };
    U.DPO = { token: signer({ id: 0, username: `${PREFIXE}_dpo`, role: 'DPO' }) };
    U.CHAUFFEUR = { token: signerChauffeur(66) };

    const c = await pool.query("SELECT value FROM settings WHERE key = 'effectifs.convention_2026'");
    conventionAvant = c.rows[0] ? c.rows[0].value : undefined;
    await pool.query(
      `INSERT INTO settings (key, value, category) VALUES ('effectifs.convention_2026', $1, 'effectifs')
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [JSON.stringify({ etp_conventionnes: 25.17, heures_annuelles_etp: 1820 })]
    );

    // ── La cohorte du scan : 46 personnes ─────────────────────────────────
    for (let i = 1; i <= N; i += 1) {
      E[i] = await creerPersonne(i);
      await poserDossier(i, E[i]);
      const p = profil(i);
      if (i <= 9) {
        await ins('employee_contracts', {
          employee_id: E[i], contract_type: 'CDDI', start_date: p.insertion_start_date,
          end_date: p.insertion_end_date, is_current: false, weekly_hours: 26,
        });
      } else if (i === 12 || i === 13) {
        // Contrats CHAÎNÉS : le premier s'arrête avant la date de fin, le renouvellement la couvre.
        await ins('employee_contracts', { employee_id: E[i], contract_type: 'CDDI', start_date: '2026-01-05', end_date: '2026-06-30', is_current: false, weekly_hours: 26 });
        await ins('employee_contracts', { employee_id: E[i], contract_type: 'CDDI', start_date: '2026-07-01', end_date: '2027-01-31', is_current: true, weekly_hours: 26 });
      } else if (i <= 39) {
        await ins('employee_contracts', {
          employee_id: E[i], contract_type: 'CDDI', start_date: p.insertion_start_date,
          end_date: '2026-12-31', is_current: true, weekly_hours: 26,
        });
      }
      // 40-46 : AUCUN historique de contrats — repli sur la fiche (contract_start/end).
    }
    for (const [i, b] of Object.entries(BILANS)) {
      await ins('insertion_milestones', {
        employee_id: E[i], parcours_num: 1, milestone_type: 'bilan_sortie', status: 'realise',
        due_date: b.completed_date, completed_date: b.completed_date,
        sortie_classification: b.sortie_classification, sortie_type: b.sortie_type, ...(b.freins || {}),
      });
    }
    for (const [i, ev] of Object.entries(EVALS)) {
      await ins('insertion_milestones', {
        employee_id: E[i], parcours_num: 1, milestone_type: 'bilan_intermediaire', status: 'realise',
        due_date: ev.completed_date, completed_date: ev.completed_date, ...ev.freins,
      });
    }

    // ── Pièges : ne doivent apparaître NULLE PART ─────────────────────────
    E.avant = await creerSalarie(pool, 'PRECVG_AVANT', {
      first_name: 'Avant', last_name: 'Periode', insertion_status: 'termine', gender: 'F',
      insertion_start_date: '2025-06-01', insertion_end_date: '2026-03-31', orienteur_type: 'cap_emploi',
    });
    E.apres = await creerSalarie(pool, 'PRECVG_APRES', {
      first_name: 'Apres', last_name: 'Periode', insertion_status: 'en_parcours', gender: 'F',
      insertion_start_date: '2026-10-01', orienteur_type: 'cap_emploi', contract_start: '2026-10-01',
    });
    E.perm = await creerSalarie(pool, 'PRECVG_PERM', {
      first_name: 'Perm', last_name: 'Anent', insertion_status: 'none', gender: 'F',
      contract_start: '2020-01-01', orienteur_type: 'cap_emploi',
    });
    tousIds.push(E.avant, E.apres, E.perm);

    // ── Situations de sortie Convergence, saisies PAR L'API (RH) ─────────
    const situations = {
      5: { categorie: 'sortie_neutre', habitat_type_sortie: 'autonome', medecin_traitant_sortie: true },
      6: { categorie: 'sortie_neutre', habitat_type_sortie: 'autonome', medecin_traitant_sortie: true },
      7: { categorie: 'autre_positive', parcours_de_soin: false, accompagnement_post_sortie: true },
      // Situation saisie SANS catégorie : la catégorie vient alors du bilan.
      1: { categorie: null, habitat_type_sortie: 'autonome', accompagnement_post_sortie: false },
    };
    for (const [i, corps] of Object.entries(situations)) {
      const r = await auth(request(app).put(`/api/insertion/convergence/situation-sortie/${E[i]}`), 'RH').send(corps);
      if (r.status !== 200) throw new Error(`situation ${i} : ${r.status} ${JSON.stringify(r.body)}`);
    }
  });

  afterAll(async () => {
    await purgerPrE(pool, { matricules: MATS, usernamePrefix: PREFIXE, ressourcesPrefix: RESS });
    await pool.query('DELETE FROM employees WHERE id = ANY($1::int[])', [tousIds]).catch(() => {});
    if (conventionAvant === undefined) await pool.query("DELETE FROM settings WHERE key = 'effectifs.convention_2026'");
    else await pool.query("UPDATE settings SET value = $1 WHERE key = 'effectifs.convention_2026'", [conventionAvant]);
    await pool.query("DELETE FROM settings WHERE key = 'insertion.cvg_sans_bilan_est_sans_nouvelles'");
  });

  test('V-10 — la base ne porte AUCUN autre parcours que la cohorte de la suite', async () => {
    expect(await cohorteHorsPerimetre(pool, MATS)).toBe(0);
  });

  // ═════════════════════════════════════════════════════════════════════════
  describe('la cohorte du formulaire scanné — GET /convergence/apercu', () => {
    let c;
    beforeAll(async () => {
      const r = await apercu();
      if (r.status !== 200) throw new Error(`aperçu ${r.status} ${JSON.stringify(r.body)}`);
      c = r.body;
    });

    test('V-11 — aucune source illisible : la méthode ne nomme aucune source manquante', () => {
      expect(c.methode.join(' ')).not.toMatch(/Sources illisibles/);
      expect(c.partie2.registre_lisible).toBe(true);
    });

    test('V-12 — effectifs : ETP conventionnés 25,17, 46 accueillis, 37 en contrat au 30/09', () => {
      expect(c.partie1.effectifs).toEqual({ etp_conventionnes: 25.17, accueillis: 46, en_contrat_fin: 37 });
      expect(c.partie1.base).toBe(46);
    });

    test('V-13 — sexe 18 H / 28 F (civilité en repli), âges 4 / 31 / 11 aux bornes exactes', () => {
      const p = c.partie1.publics;
      expect(p.hommes).toEqual({ nb: 18, pct: 39.1 });
      expect(p.femmes).toEqual({ nb: 28, pct: 60.9 });
      expect([p.moins_26.nb, p.de_26_a_49.nb, p.plus_50.nb]).toEqual([4, 31, 11]);
      expect(p.non_renseigne).toEqual({ sexe: 0, age: 0, formation: 0 });
    });

    test('V-14 — formation 5 / 29 / 8 / 2 / 0 / 2 / 0 ; ligne « 6 et plus » absente', () => {
      const p = c.partie1.publics;
      expect([p.niv1_2, p.niv3, p.niv4, p.niv5, p.niv6, p.niv7, p.niv8].map((x) => x.nb)).toEqual([5, 29, 8, 2, 0, 2, 0]);
      expect(p.niv6plus).toBeUndefined();
      expect(p.total_formation).toEqual({ nb: 46, pct: 100 });
    });

    test('V-15 — minima sociaux : 2 ans+ 23, RSA 32, ASS 3, RTH 5, AAH 0 (zéro explicite), réfugiés 3', () => {
      const p = c.partie1.publics;
      expect(p.sans_emploi_2ans).toEqual({ nb: 23, pct: 50 });
      expect(p.rsa_socle).toEqual({ nb: 32, pct: 69.6 });
      expect(p.ass).toEqual({ nb: 3, pct: 6.5 });
      expect(p.rth).toEqual({ nb: 5, pct: 10.9 });
      expect(p.aah).toEqual({ nb: 0, pct: 0 });
      expect(p.refugies).toEqual({ nb: 3, pct: 6.5 });
    });

    test('V-16 — habitat 14 / 22 / 2 / 7 / 0, « hébergé » non renseigné, 5 parcours de rue', () => {
      const h = c.partie1.habitat_entree;
      expect([h.autonome, h.semi_durable, h.hebergement_collectif, h.hebergement_precaire, h.rue].map((x) => x.nb))
        .toEqual([14, 22, 2, 7, 0]);
      expect(h.total).toEqual({ nb: 45, pct: 97.8 });
      expect(h.non_renseigne).toBe(1);
      expect(h.parcours_rue).toEqual({ nb: 5, pct: 10.9 });
    });

    test('V-17 — difficultés à l\'entrée 16 / 20 / 19 / 31 / 7 / 3 / 6 / 23, numérique jamais transmis', () => {
      const d = c.partie1.difficultes_entree;
      expect(['linguistique', 'sante', 'logement', 'administratif', 'finances', 'judiciaire', 'famille', 'mobilite'].map((a) => d[a].nb))
        .toEqual([16, 20, 19, 31, 7, 3, 6, 23]);
      expect(d.numerique).toBeUndefined();
      expect(d.non_evalue).toBe(0);
      expect(JSON.stringify(c)).not.toMatch(/numerique/);
    });

    test('V-18 — orienteurs 37 FT / 1 ML / 5 PLIE / 2 autre acteur (dont `ccas` transcodé) / 1 spontanée', () => {
      const o = c.partie1.orienteurs;
      expect(o.france_travail).toEqual({ nb: 37, pct: 80.4 });
      expect(o.mission_locale.nb).toBe(1);
      expect(o.plie_pmie.nb).toBe(5);
      expect(o.autre_accompagnement.nb).toBe(2);
      expect(o.candidature_spontanee.nb).toBe(1);
      expect(o.cap_emploi).toEqual({ nb: 0, pct: 0 }); // les pièges (cap_emploi) sont hors période
      expect(o.total.nb).toBe(46);
      expect(o.non_renseigne).toBe(0);
    });

    test('V-19 — sorties : 9 sortis, 0 sans bilan, 9,3 mois, 2 non catégorisés', () => {
      const s = c.sorties;
      expect(s.total).toBe(9);
      expect(s.duree_moyenne_mois).toBe(9.3);
      expect(s.non_categorises).toBe(2);
      // Sortant 1 a un bilan de sortie « CDI » rédigé douze jours avant la fin de son
      // parcours : il n'est PAS « parti sans bilan ».
      expect(s.non_documentees).toBe(0);
    });

    test('V-20 — tableau « emploi ou formation » : 3 sortants, 1 emploi, 2 formation, 1 non catégorisé de ce côté', () => {
      const j = c.sorties.emploi;
      expect(j.total).toBe(3);
      expect(j.categories).toEqual({
        emploi: { nb: 1, pct: 11.1 }, suite_parcours_insertion: { nb: 0, pct: 0 }, formation: { nb: 2, pct: 22.2 },
      });
      expect(j.non_categorises).toBe(1);
    });

    test('V-21 — tableau « hors emploi » : 4 sortants, 1 sans solution, 2 neutres, 1 autre positive', () => {
      const j = c.sorties.hors_emploi;
      expect(j.total).toBe(4);
      expect(j.categories).toEqual({
        retraite: { nb: 0, pct: 0 },
        sans_solution: { nb: 1, pct: 11.1 },
        sans_nouvelles: { nb: 0, pct: 0 },
        sortie_neutre: { nb: 2, pct: 22.2 },
        autre_positive: { nb: 1, pct: 11.1 },
        parcours_de_soin: { nb: 0, pct: 0 },
      });
      expect(j.non_categorises).toBe(0);
    });

    test('V-22 — évolution des freins, tableau emploi : entrée 3/3 partout, résolutions 2/1/1/1/1/0/0/1', () => {
      const f = c.sorties.emploi.freins;
      const axes = ['linguistique', 'sante', 'logement', 'administratif', 'finances', 'judiciaire', 'famille', 'mobilite'];
      expect(axes.map((a) => f[a].entree.nb)).toEqual([3, 3, 3, 3, 3, 3, 3, 3]);
      expect(axes.map((a) => f[a].resolution.nb)).toEqual([2, 1, 1, 1, 1, 0, 0, 1]);
      expect(f.linguistique.resolution.pct).toBe(66.7);
      expect(f.numerique).toBeUndefined();
    });

    test('V-23 — évolution des freins, tableau hors emploi : entrée 4/4/4/4/4/0/3/4, résolutions 0/1/0/1/1/0/1/1', () => {
      const f = c.sorties.hors_emploi.freins;
      const axes = ['linguistique', 'sante', 'logement', 'administratif', 'finances', 'judiciaire', 'famille', 'mobilite'];
      expect(axes.map((a) => f[a].entree.nb)).toEqual([4, 4, 4, 4, 4, 0, 3, 4]);
      // Famille : 1 résolution (sortant 7, 2 → 1) pour une personne qui n'était
      // PAS en difficulté à l'entrée — règle de méthode « quel que soit le niveau
      // d'entrée », nommée au rapport (R-02).
      expect(axes.map((a) => f[a].resolution.nb)).toEqual([0, 1, 0, 1, 1, 0, 1, 1]);
    });

    test('V-24 — logement et santé entrée → sortie, accompagnement post-sortie', () => {
      const em = c.sorties.emploi;
      const he = c.sorties.hors_emploi;
      expect(em.logement.autonome).toEqual({ entree: { nb: 3, pct: 100 }, sortie: { nb: 1, pct: 33.3 } });
      expect(he.logement.autonome).toEqual({ entree: { nb: 4, pct: 100 }, sortie: { nb: 2, pct: 50 } });
      expect(em.sante.pension_invalidite.entree.nb).toBe(2);
      expect(em.sante.medecin_traitant.entree.nb).toBe(3);
      expect(em.sante.couverture_sante_amelioree.entree.nb).toBe(2);
      expect(he.sante.rqth.entree.nb).toBe(1);
      expect(he.sante.medecin_traitant.sortie).toEqual({ nb: 2, pct: 50 });
      expect(em.post_sortie).toEqual({ nb: 0, pct: 0 });
      expect(he.post_sortie).toEqual({ nb: 1, pct: 25 });
      expect(em.non_renseigne.situation_sortie).toBe(2);   // sortants 2 et 3
      expect(he.non_renseigne.situation_sortie).toBe(1);   // sortant 4
    });

    test('V-25 — aucun nom ni identifiant de salarié en insertion dans le document', () => {
      const brut = JSON.stringify(c);
      for (let i = 1; i <= N; i += 1) expect(brut).not.toContain(`Personne${i}"`);
      expect(brut).not.toMatch(/employee_id/);
      expect(brut).not.toMatch(/PRECVG_/);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  describe('dates civiles aux bornes (fuseau du processus : ' + (process.env.TZ || 'système') + ')', () => {
    test('V-26 — un sortant du 30/09 est compté le 30/09 (pas le 29, pas le 01/10) ; un sortant du 01/10 ne l\'est pas', async () => {
      const id3009 = await creerPersonne(10, {
        malibou_id: 'PRECVG_3009', insertion_status: 'termine', is_active: false,
        insertion_start_date: '2025-12-15', insertion_end_date: '2026-09-30', contract_end: '2026-09-30',
      });
      const id1001 = await creerPersonne(11, {
        malibou_id: 'PRECVG_1001', insertion_status: 'termine', is_active: false,
        insertion_start_date: '2025-12-15', insertion_end_date: '2026-10-01', contract_end: '2026-10-01',
      });
      for (const [id, fin] of [[id3009, '2026-09-30'], [id1001, '2026-10-01']]) {
        await ins('employee_contracts', {
          employee_id: id, contract_type: 'CDDI', start_date: '2025-12-15', end_date: fin, is_current: false, weekly_hours: 26,
        });
      }
      try {
        const r = await apercu();
        expect(r.status).toBe(200);
        expect(r.body.partie1.effectifs.accueillis).toBe(48);
        expect(r.body.sorties.total).toBe(10); // le 30/09, pas le 01/10
        // Période qui s'arrête la veille : le sortant du 30/09 n'y est PAS.
        const veille = await apercu(`debut=${DEBUT}&fin=2026-09-29`);
        expect(veille.body.sorties.total).toBe(9);
        // Période qui commence le 01/10 : le sortant du 01/10 y est, celui du 30/09 non.
        const apres = await apercu('debut=2026-10-01&fin=2026-12-31');
        expect(apres.body.sorties.total).toBe(1);
        // Durée du sortant du 30/09 : 289 jours exactement (15/12 → 30/09), en mois.
        const d = await apercu('debut=2026-09-30&fin=2026-09-30');
        expect(d.body.sorties.total).toBe(1);
        expect(d.body.sorties.duree_moyenne_mois).toBe(Math.round((289 / (365.25 / 12)) * 10) / 10);
        // RÈGLE DE MÉTHODE (R-01) : un parcours qui s'achève LE jour de fin est à
        // la fois « sorti » et « en contrat à la date de fin » (le contrat couvre
        // ce jour-là) ; celui qui s'achève le lendemain est en contrat et NON
        // sorti : 37 + 2.
        expect(r.body.partie1.effectifs.en_contrat_fin).toBe(39);
        // Période au 29/09 : ni l'un ni l'autre n'est sorti, les deux sont en
        // contrat — ET le sortant n° 9, dont le parcours s'achève le 29/09, bascule
        // à son tour dans la même règle : 37 + 3.
        expect(veille.body.partie1.effectifs.en_contrat_fin).toBe(40);
      } finally {
        await pool.query('DELETE FROM employees WHERE id = ANY($1::int[])', [[id3009, id1001]]);
      }
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  describe('journal RGPD et gestes du document', () => {
    let snapId;

    test('V-30 — aperçu : 200 et une ligne INSERTION_CVG_APERCU (période, jamais le contenu)', async () => {
      const avant = await dernierIdJournal(pool);
      const r = await apercu();
      expect(r.status).toBe(200);
      const j = await journalParAction(pool, 'INSERTION_CVG_APERCU', avant);
      expect(j).toHaveLength(1);
      expect(j[0].user_id).toBe(U.RH.id);
      expect(j[0].entity_type).toBe('insertion_convergence');
      expect(j[0].entity_id).toBeNull();
      expect(j[0].details).toEqual(expect.objectContaining({ periode_debut: DEBUT, periode_fin: FIN }));
      expect(JSON.stringify(j[0].details)).not.toMatch(/partie1|france_travail|sortie_neutre/);
    });

    test('V-31 — génération : 201, instantané `type=\'cvg\'` avec sa période, trace dans la MÊME transaction', async () => {
      const avant = await dernierIdJournal(pool);
      const r = await auth(request(app).post('/api/insertion/convergence/generer'), 'ADMIN').send({ debut: DEBUT, fin: FIN });
      expect(r.status).toBe(201);
      snapId = r.body.id;
      const s = await pool.query(
        "SELECT type, annee, trimestre, to_char(periode_debut,'YYYY-MM-DD') d, to_char(periode_fin,'YYYY-MM-DD') f, genere_par, contenu FROM insertion_dialogues_gestion WHERE id = $1",
        [snapId]
      );
      expect(s.rows[0]).toEqual(expect.objectContaining({ type: 'cvg', annee: 2026, trimestre: null, d: DEBUT, f: FIN, genere_par: U.ADMIN.id }));
      expect(s.rows[0].contenu.sorties.total).toBe(9);
      expect(s.rows[0].contenu.partie1.effectifs.accueillis).toBe(46);
      const j = await journalParAction(pool, 'INSERTION_CVG_GENERATION', avant);
      expect(j).toHaveLength(1);
      expect(j[0].details.snapshot_id).toBe(snapId);
    });

    test('V-32 — historique CVG et consultation (INSERTION_CVG_CONSULTATION) ; rejeu identique', async () => {
      const h = await auth(request(app).get('/api/insertion/convergence/historique'), 'RH');
      expect(h.status).toBe(200);
      expect(h.body.map((x) => x.id)).toContain(snapId);
      const l = h.body.find((x) => x.id === snapId);
      expect(l).toEqual(expect.objectContaining({ periode_debut: DEBUT, periode_fin: FIN, genere_par_nom: 'Jest A.' }));
      const avant = await dernierIdJournal(pool);
      const s = await auth(request(app).get(`/api/insertion/convergence/snapshot/${snapId}`), 'RH');
      expect(s.status).toBe(200);
      expect(s.body.contenu.sorties.total).toBe(9);
      const j = await journalParAction(pool, 'INSERTION_CVG_CONSULTATION', avant);
      expect(j).toHaveLength(1);
      expect(j[0].details.snapshot_id).toBe(snapId);
    });

    test('V-33 — l\'instantané CVG n\'apparaît PAS dans l\'historique de la synthèse, ni par son id', async () => {
      const h = await auth(request(app).get('/api/insertion/reporting/dialogue-gestion/historique'), 'RH');
      expect(h.status).toBe(200);
      expect(h.body.map((x) => x.id)).not.toContain(snapId);
      const h2 = await auth(request(app).get('/api/insertion/reporting/dialogue-gestion/historique?annee=2026'), 'RH');
      expect(h2.body.map((x) => x.id)).not.toContain(snapId);
      const d = await auth(request(app).get(`/api/insertion/reporting/dialogue-gestion/${snapId}`), 'RH');
      expect(d.status).toBe(404);
    });

    test('V-34 — l\'inverse : une synthèse de dialogue de gestion n\'apparaît pas dans l\'historique CVG', async () => {
      const g = await auth(request(app).post('/api/insertion/reporting/dialogue-gestion'), 'ADMIN').send({ annee: 2026 });
      expect(g.status).toBe(201);
      try {
        const t = await pool.query('SELECT type FROM insertion_dialogues_gestion WHERE id = $1', [g.body.id]);
        expect(t.rows[0].type).toBe('dialogue');
        const h = await auth(request(app).get('/api/insertion/convergence/historique'), 'RH');
        expect(h.body.map((x) => x.id)).not.toContain(g.body.id);
        const s = await auth(request(app).get(`/api/insertion/convergence/snapshot/${g.body.id}`), 'RH');
        expect(s.status).toBe(404);
        const hd = await auth(request(app).get('/api/insertion/reporting/dialogue-gestion/historique'), 'RH');
        expect(hd.body.map((x) => x.id)).toContain(g.body.id);
      } finally {
        await pool.query('DELETE FROM insertion_dialogues_gestion WHERE id = $1', [g.body.id]);
      }
    });

    test('V-35 — CSV : 200, écrit la ligne EXPORT_CVG avant l\'envoi, cellule vide ≠ 0', async () => {
      const avant = await dernierIdJournal(pool);
      const r = await auth(request(app).get(`/api/insertion/convergence/csv?${PERIODE}`), 'RH');
      expect(r.status).toBe(200);
      expect(r.headers['content-type']).toMatch(/text\/csv/);
      expect(r.text).toMatch(/Salariés en insertion accueillis sur la période;46;/);
      expect(r.text).toMatch(/Nombre de salariés sortis sur la période;9;/);
      const j = await journalParAction(pool, 'EXPORT_CVG', avant);
      expect(j).toHaveLength(1);
      expect(j[0].details).toEqual(expect.objectContaining({ format: 'csv', periode_debut: DEBUT }));
    });

    test('V-36 — journal indisponible : aperçu 500 SANS contenu, génération sans instantané, CSV 500', async () => {
      const nbAvant = (await pool.query("SELECT COUNT(*)::int n FROM insertion_dialogues_gestion WHERE type = 'cvg'")).rows[0].n;
      await pool.query('ALTER TABLE rgpd_audit_log RENAME TO rgpd_audit_log_hors_ligne');
      try {
        const a = await apercu();
        expect(a.status).toBe(500);
        expect(a.body).not.toHaveProperty('partie1');
        expect(JSON.stringify(a.body)).not.toMatch(/accueillis|sorties/);
        const g = await auth(request(app).post('/api/insertion/convergence/generer'), 'ADMIN').send({ debut: DEBUT, fin: FIN });
        expect(g.status).toBe(500);
        expect(g.body).not.toHaveProperty('contenu');
        const c = await auth(request(app).get(`/api/insertion/convergence/csv?${PERIODE}`), 'RH');
        expect(c.status).toBe(500);
        expect(c.text).not.toMatch(/accueillis/);
        const s = await auth(request(app).get('/api/insertion/convergence/snapshot/' + snapId), 'RH');
        expect(s.status).toBe(500);
        expect(s.body).not.toHaveProperty('contenu');
      } finally {
        await pool.query('ALTER TABLE rgpd_audit_log_hors_ligne RENAME TO rgpd_audit_log');
      }
      const nbApres = (await pool.query("SELECT COUNT(*)::int n FROM insertion_dialogues_gestion WHERE type = 'cvg'")).rows[0].n;
      expect(nbApres).toBe(nbAvant); // aucun instantané orphelin de sa trace
    });

    test('V-37 — 409 EXPORT_VIDE sur une période sans personne : ni instantané ni trace', async () => {
      const avant = await dernierIdJournal(pool);
      const nb = (await pool.query("SELECT COUNT(*)::int n FROM insertion_dialogues_gestion WHERE type = 'cvg'")).rows[0].n;
      const g = await auth(request(app).post('/api/insertion/convergence/generer'), 'ADMIN').send({ debut: '2019-01-01', fin: '2019-06-30' });
      expect(g.status).toBe(409);
      expect(g.body.code).toBe('EXPORT_VIDE');
      const c = await auth(request(app).get('/api/insertion/convergence/csv?debut=2019-01-01&fin=2019-06-30'), 'RH');
      expect(c.status).toBe(409);
      expect(c.body.code).toBe('EXPORT_VIDE');
      expect((await pool.query("SELECT COUNT(*)::int n FROM insertion_dialogues_gestion WHERE type = 'cvg'")).rows[0].n).toBe(nb);
      expect(await journalParAction(pool, 'INSERTION_CVG_GENERATION', avant)).toHaveLength(0);
      expect(await journalParAction(pool, 'EXPORT_CVG', avant)).toHaveLength(0);
    });

    test('V-38 — 400 PERIODE_INVALIDE (fin < début, > 24 mois, date inexistante) AVANT toute requête', async () => {
      const cas = [
        'debut=2026-09-30&fin=2026-04-01',
        'debut=2024-01-01&fin=2026-02-02',
        'debut=2026-02-30&fin=2026-09-30',
      ];
      const espion = jest.spyOn(pool, 'query');
      const espionC = jest.spyOn(pool, 'connect');
      try {
        for (const q of cas) {
          espion.mockClear(); espionC.mockClear();
          for (const r of [
            await apercu(q),
            await auth(request(app).get(`/api/insertion/convergence/csv?${q}`), 'RH'),
            await auth(request(app).get(`/api/insertion/convergence/completude?${q}`), 'RH'),
          ]) {
            expect(r.status).toBe(400);
            expect(r.body.code).toBe('PERIODE_INVALIDE');
          }
          const [debut, fin] = q.split('&').map((x) => x.split('=')[1]);
          const g = await auth(request(app).post('/api/insertion/convergence/generer'), 'ADMIN').send({ debut, fin });
          expect(g.status).toBe(400);
          expect(g.body.code).toBe('PERIODE_INVALIDE');
          const metier = espion.mock.calls.map(([s]) => String(s)).filter((s) => /employees|insertion_|rgpd_audit_log|employee_/.test(s));
          expect(metier).toEqual([]);
          expect(espionC).not.toHaveBeenCalled();
        }
      } finally {
        espion.mockRestore(); espionC.mockRestore();
      }
    });

    test('V-39 — COLLABORATEUR, DPO et jeton chauffeur refusés en 403 avant toute requête métier', async () => {
      const espion = jest.spyOn(pool, 'query');
      try {
        for (const role of ['COLLABORATEUR', 'DPO', 'CHAUFFEUR']) {
          for (const r of [
            await auth(request(app).get(`/api/insertion/convergence/apercu?${PERIODE}`), role),
            await auth(request(app).put(`/api/insertion/convergence/situation-sortie/${E[4]}`), role).send({ categorie: 'retraite' }),
            await auth(request(app).get('/api/insertion/convergence/ressources'), role),
          ]) expect(r.status).toBe(403);
        }
        const metier = espion.mock.calls.map(([s]) => String(s)).filter((s) => /insertion_|rgpd_audit_log|employee_eligibilite/.test(s));
        expect(metier).toEqual([]);
      } finally { espion.mockRestore(); }
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  describe('situation de sortie — GET/PUT /situation-sortie/:employeeId', () => {
    test('V-40 — proposition déduite du bilan (CDI → emploi), sourcée, jamais écrite', async () => {
      const avantLignes = (await pool.query('SELECT COUNT(*)::int n FROM insertion_sortie_cvg WHERE employee_id = $1', [E[1]])).rows[0].n;
      const r = await auth(request(app).get(`/api/insertion/convergence/situation-sortie/${E[1]}`), 'RH');
      expect(r.status).toBe(200);
      expect(r.body.parcours_num).toBe(1);
      expect(r.body.proposition.categorie).toBe('emploi');
      expect(r.body.proposition.source.categorie).toMatch(/CDI/);
      expect(r.body.proposition.habitat_type_sortie).toBe('autonome');
      expect(r.body.proposition.pension_invalidite_sortie).toBe(true);
      expect(r.body.proposition.medecin_traitant_sortie).toBe(true);
      expect(r.body.situation).toEqual(expect.objectContaining({ categorie: null, habitat_type_sortie: 'autonome', accompagnement_post_sortie: false }));
      expect(r.body.situation.saisi_par_nom).toBe('Jest R.');
      expect((await pool.query('SELECT COUNT(*)::int n FROM insertion_sortie_cvg WHERE employee_id = $1', [E[1]])).rows[0].n).toBe(avantLignes);
      // Pas de bilan transcodable : aucune catégorie proposée, jamais devinée.
      const r9 = await auth(request(app).get(`/api/insertion/convergence/situation-sortie/${E[9]}`), 'RH');
      expect(r9.body.proposition.categorie).toBeNull();
      expect(r9.body.situation).toBeNull();
    });

    test('V-41 — upsert idempotent : deux PUT = une ligne, la seconde met à jour ; journal sans valeur', async () => {
      const avant = await dernierIdJournal(pool);
      const a = await auth(request(app).put(`/api/insertion/convergence/situation-sortie/${E[8]}`), 'RH')
        .send({ categorie: 'suite_parcours_insertion', rqth_sortie: true });
      expect(a.status).toBe(200);
      const b = await auth(request(app).put(`/api/insertion/convergence/situation-sortie/${E[8]}`), 'ADMIN')
        .send({ categorie: 'emploi', couverture_sante_amelioree: true });
      expect(b.status).toBe(200);
      const l = await pool.query('SELECT categorie, rqth_sortie, couverture_sante_amelioree, saisi_par FROM insertion_sortie_cvg WHERE employee_id = $1', [E[8]]);
      expect(l.rows).toEqual([{ categorie: 'emploi', rqth_sortie: true, couverture_sante_amelioree: true, saisi_par: U.ADMIN.id }]);
      const j = await journalParAction(pool, 'INSERTION_SORTIE_CVG_ECRITURE', avant);
      expect(j).toHaveLength(2);
      expect(j.map((x) => x.entity_id)).toEqual([E[8], E[8]]);
      expect(j[1].details).toEqual(expect.objectContaining({ parcours_num: 1, champs: ['categorie', 'couverture_sante_amelioree'] }));
      const brut = JSON.stringify(j.map((x) => x.details));
      expect(brut).not.toMatch(/suite_parcours_insertion|"emploi"|true/);
      // Remise en état : sortant 8 redevient sans situation (cohorte du scan).
      await pool.query('DELETE FROM insertion_sortie_cvg WHERE employee_id = $1', [E[8]]);
    });

    test('V-42 — listes fermées refusées en 400, rien n\'est écrit', async () => {
      for (const corps of [{ categorie: 'demenagement' }, { habitat_type_sortie: 'chateau' }, { rqth_sortie: 'oui' }, {}]) {
        const r = await auth(request(app).put(`/api/insertion/convergence/situation-sortie/${E[9]}`), 'RH').send(corps);
        expect(r.status).toBe(400);
      }
      expect((await pool.query('SELECT COUNT(*)::int n FROM insertion_sortie_cvg WHERE employee_id = $1', [E[9]])).rows[0].n).toBe(0);
      const x = await auth(request(app).put('/api/insertion/convergence/situation-sortie/999999999'), 'RH').send({ categorie: 'retraite' });
      expect(x.status).toBe(404);
    });

    test('V-43 — `parcours_num` respecté : deux parcours = deux lignes, lues séparément', async () => {
      const a = await auth(request(app).put(`/api/insertion/convergence/situation-sortie/${E[9]}`), 'RH')
        .send({ parcours_num: 2, categorie: 'retraite' });
      expect(a.status).toBe(200);
      expect(a.body.parcours_num).toBe(2);
      const b = await auth(request(app).put(`/api/insertion/convergence/situation-sortie/${E[9]}`), 'RH')
        .send({ parcours_num: 1, categorie: 'formation' });
      expect(b.status).toBe(200);
      const l = await pool.query('SELECT parcours_num, categorie FROM insertion_sortie_cvg WHERE employee_id = $1 ORDER BY parcours_num', [E[9]]);
      expect(l.rows).toEqual([{ parcours_num: 1, categorie: 'formation' }, { parcours_num: 2, categorie: 'retraite' }]);
      const g2 = await auth(request(app).get(`/api/insertion/convergence/situation-sortie/${E[9]}?parcours_num=2`), 'RH');
      expect(g2.body.situation.categorie).toBe('retraite');
      // Le document lit le parcours COURANT (1) : le sortant 9 passe « formation ».
      const r = await apercu();
      expect(r.body.sorties.emploi.categories.formation.nb).toBe(3);
      expect(r.body.sorties.hors_emploi.categories.retraite.nb).toBe(0);
      expect(r.body.sorties.non_categorises).toBe(1);
      await pool.query('DELETE FROM insertion_sortie_cvg WHERE employee_id = $1', [E[9]]);
    });

    test('V-44 — complétude : liste NOMINATIVE interne, manques nommés, jamais dans le document ; lecture NON journalisée (O-02)', async () => {
      const avant = await dernierIdJournal(pool);
      const r = await auth(request(app).get(`/api/insertion/convergence/completude?${PERIODE}`), 'RH');
      expect(r.status).toBe(200);
      const l8 = r.body.find((x) => x.employee_id === E[8]);
      expect(l8).toEqual(expect.objectContaining({ nom: 'PERSONNE8 Cvg8', lien: `/insertion?employee=${E[8]}` }));
      expect(l8.manques).toEqual(expect.arrayContaining([
        'Situation de sortie Convergence non saisie (bilan de sortie)', 'Catégorie de sortie Convergence à préciser',
      ]));
      const l46 = r.body.find((x) => x.employee_id === E[46]);
      expect(l46.manques.join(' ')).toMatch(/Type d'habitat à l'entrée à préciser/);
      // Le sortant 5 (situation saisie, catégorie « sortie neutre ») n'a plus rien à compléter.
      expect(r.body.find((x) => x.employee_id === E[5])).toBeUndefined();
      const j = await pool.query('SELECT action FROM rgpd_audit_log WHERE id > $1', [avant]);
      expect(j.rows).toEqual([]);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  describe('moyens humains — registre et Partie 2', () => {
    let idInterne; let idMut;

    test('V-50 — registre vide : totaux VIDES (null), jamais zéro', async () => {
      const autres = (await pool.query('SELECT COUNT(*)::int n FROM insertion_cvg_ressources WHERE nom NOT LIKE $1', [`${RESS}%`])).rows[0].n;
      expect(autres).toBe(0);
      const r = await apercu();
      expect(r.body.partie2.internes).toEqual([]);
      expect(r.body.partie2.totaux.internes.etp_total).toBeNull();
      expect(r.body.partie2.totaux.cvg).toBeNull();
    });

    test('V-51 — création : interne 201 ; accompagnement + encadrement > total → 400 ; mutualisée sans ventilation', async () => {
      const a = await auth(request(app).post('/api/insertion/convergence/ressources'), 'RH')
        .send({ type: 'interne', nom: `${RESS}MARTIN Claire`, fonction: 'CIP', etp_total: 1, etp_accompagnement: 1 });
      expect(a.status).toBe(201);
      idInterne = a.body.id;
      const b = await auth(request(app).post('/api/insertion/convergence/ressources'), 'RH')
        .send({ type: 'interne', nom: `${RESS}DURAND Paul`, fonction: 'ETI', etp_total: 1, etp_accompagnement: 0.2, etp_encadrement: 0.8 });
      expect(b.status).toBe(201);
      const refus = await auth(request(app).post('/api/insertion/convergence/ressources'), 'RH')
        .send({ type: 'interne', nom: `${RESS}TROP`, etp_total: 0.5, etp_accompagnement: 0.4, etp_encadrement: 0.2 });
      expect(refus.status).toBe(400);
      expect(refus.body.code).toBe('RESSOURCE_INVALIDE');
      const m = await auth(request(app).post('/api/insertion/convergence/ressources'), 'RH')
        .send({ type: 'mutualisee', nom: `${RESS}LEROY Anne`, fonction: 'Chargée de mission', employeur: 'PLIE', etp_total: 0.1, etp_accompagnement: 0.1, etp_encadrement: 0.1 });
      expect(m.status).toBe(201);
      idMut = m.body.id;
      expect(m.body).toEqual(expect.objectContaining({ etp_total: 0.1, etp_accompagnement: null, etp_encadrement: null }));
      // Hors période ou inactive : au registre, pas dans le document.
      const hp = await auth(request(app).post('/api/insertion/convergence/ressources'), 'RH')
        .send({ type: 'interne', nom: `${RESS}ANCIEN`, etp_total: 1, date_debut: '2024-01-01', date_fin: '2026-03-31' });
      expect(hp.status).toBe(201);
      const ina = await auth(request(app).post('/api/insertion/convergence/ressources'), 'RH')
        .send({ type: 'interne', nom: `${RESS}INACTIF`, etp_total: 1, actif: false });
      expect(ina.status).toBe(201);
      expect((await pool.query('SELECT COUNT(*)::int n FROM insertion_cvg_ressources WHERE nom = $1', [`${RESS}TROP`])).rows[0].n).toBe(0);
    });

    test('V-52 — modification : PUT partiel contrôlé contre l\'existant ; 404 inconnue', async () => {
      const ko = await auth(request(app).put(`/api/insertion/convergence/ressources/${idInterne}`), 'RH').send({ etp_encadrement: 0.5 });
      expect(ko.status).toBe(400); // 1 + 0,5 > 1
      const ok = await auth(request(app).put(`/api/insertion/convergence/ressources/${idInterne}`), 'RH').send({ etp_total: 1.5, etp_encadrement: 0.5 });
      expect(ok.status).toBe(200);
      expect(ok.body).toEqual(expect.objectContaining({ etp_total: 1.5, etp_accompagnement: 1, etp_encadrement: 0.5 }));
      const mut = await auth(request(app).put(`/api/insertion/convergence/ressources/${idMut}`), 'RH').send({ etp_accompagnement: 0.05 });
      expect(mut.status).toBe(200);
      expect(mut.body.etp_accompagnement).toBeNull(); // mutualisée : jamais ventilée
      expect((await auth(request(app).put('/api/insertion/convergence/ressources/999999999'), 'RH').send({ nom: 'X' })).status).toBe(404);
    });

    test('V-53 — Partie 2 de l\'aperçu = registre actif sur la période (totaux)', async () => {
      const r = await apercu();
      const p2 = r.body.partie2;
      expect(p2.internes.map((x) => x.nom).sort()).toEqual([`${RESS}DURAND Paul`, `${RESS}MARTIN Claire`]);
      expect(p2.totaux.internes).toEqual({ etp_total: 2.5, etp_accompagnement: 1.2, etp_encadrement: 1.3 });
      expect(p2.totaux.mutualisees).toEqual({ etp_total: 0.1 });
      expect(p2.totaux.cvg).toBe(2.6);
      expect(p2.mutualisees).toEqual([{ nom: `${RESS}LEROY Anne`, fonction: 'Chargée de mission', employeur: 'PLIE', etp_total: 0.1 }]);
    });

    test('V-54 — registre illisible (table renommée) : `registre_lisible` false, totaux vides, source nommée', async () => {
      await pool.query('ALTER TABLE insertion_cvg_ressources RENAME TO insertion_cvg_ressources_hors_ligne');
      try {
        const r = await apercu();
        expect(r.status).toBe(200);
        expect(r.body.partie2.registre_lisible).toBe(false);
        expect(r.body.partie2.totaux.cvg).toBeNull();
        expect(r.body.methode.join(' ')).toMatch(/Sources illisibles.*ressources_cvg/);
      } finally {
        await pool.query('ALTER TABLE insertion_cvg_ressources_hors_ligne RENAME TO insertion_cvg_ressources');
      }
    });

    test('V-55 — suppression : 200 puis 404 ; liste triée', async () => {
      const d = await auth(request(app).delete(`/api/insertion/convergence/ressources/${idMut}`), 'RH');
      expect(d.status).toBe(200);
      expect((await auth(request(app).delete(`/api/insertion/convergence/ressources/${idMut}`), 'RH')).status).toBe(404);
      const l = await auth(request(app).get('/api/insertion/convergence/ressources'), 'RH');
      expect(l.body.filter((x) => x.nom.startsWith(RESS)).map((x) => x.type)).toEqual(['interne', 'interne', 'interne', 'interne']);
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  describe('comparaison de périodes', () => {
    let snapA; let snapB; let snapC; const extra = [];

    beforeAll(async () => {
      const a = await auth(request(app).post('/api/insertion/convergence/generer'), 'RH').send({ debut: DEBUT, fin: FIN });
      snapA = a.body.id;
      // Deux sortants de plus, en emploi (CDI / intérim), sur la même période.
      for (const [mat, type, fin] of [['PRECVG_B1', 'CDI', '2026-07-15'], ['PRECVG_B2', 'interim', '2026-08-20']]) {
        const id = await creerSalarie(pool, mat, {
          first_name: 'Bis', last_name: mat, insertion_status: 'termine', gender: 'F', birth_date: '1990-01-01',
          insertion_start_date: '2025-10-01', insertion_end_date: fin, orienteur_type: 'france_travail',
        });
        tousIds.push(id); extra.push(id);
        await ins('insertion_milestones', {
          employee_id: id, parcours_num: 1, milestone_type: 'bilan_sortie', status: 'realise',
          due_date: fin, completed_date: fin, sortie_classification: 'emploi_durable', sortie_type: type,
        });
      }
      const b = await auth(request(app).post('/api/insertion/convergence/generer'), 'RH').send({ debut: DEBUT, fin: FIN });
      snapB = b.body.id;
      const c = await auth(request(app).post('/api/insertion/convergence/generer'), 'RH').send({ debut: '2026-10-01', fin: '2026-12-31' });
      snapC = c.body.id;
    });

    afterAll(async () => {
      await pool.query('DELETE FROM employees WHERE id = ANY($1::int[])', [extra]);
    });

    test('V-60 — deux instantanés : deltas signés, points, sens, phrase sur l\'accès à l\'emploi', async () => {
      const avant = await dernierIdJournal(pool);
      const r = await auth(request(app).get(`/api/insertion/convergence/comparaison?a=${snapA}&b=${snapB}`), 'RH');
      expect(r.status).toBe(200);
      const d = (k) => r.body.deltas.find((x) => x.indicateur === k);
      expect(d('accueillis')).toEqual(expect.objectContaining({ a_nb: 46, b_nb: 48, delta_nb: 2, sens: 'neutre' }));
      expect(d('sorties_total')).toEqual(expect.objectContaining({ a_nb: 9, b_nb: 11, delta_nb: 2 }));
      expect(d('acces_emploi_formation')).toEqual(expect.objectContaining({
        a_nb: 3, a_pct: 33.3, b_nb: 5, b_pct: 45.5, delta_nb: 2, delta_pts: 12.2, sens: 'favorable',
      }));
      // L'écart en points se calcule sur les pourcentages ARRONDIS affichés
      // (36,4 − 44,4 = −8,0 et non −8,08) : le lecteur retrouve l'écart à la main (R-03).
      expect(d('hors_emploi')).toEqual(expect.objectContaining({ a_pct: 44.4, b_pct: 36.4, delta_pts: -8, sens: 'neutre' }));
      expect(d('femmes').delta_pts).toBeGreaterThan(0);
      const phrase = r.body.lecture.find((p) => /accès à l'emploi/.test(p));
      expect(phrase).toBe("Le taux d'accès à l'emploi ou à la formation des sortants passe de 33,3 % à 45,5 % (en hausse de 12,2 points).");
      expect(r.body.lecture.join(' ')).not.toMatch(/parce que|en raison|grâce à|du fait/);
      const j = await journalParAction(pool, 'INSERTION_CVG_COMPARAISON', avant);
      expect(j).toHaveLength(1);
      expect(j[0].details).toEqual(expect.objectContaining({ snapshot_a: snapA, snapshot_b: snapB }));
    });

    test('V-61 — un bloc sans base d\'un côté : « ne peut pas être comparé », sans écart calculé', async () => {
      const r = await auth(request(app).get(`/api/insertion/convergence/comparaison?a=${snapA}&b=${snapC}`), 'RH');
      expect(r.status).toBe(200);
      const x = r.body.deltas.find((k) => k.indicateur === 'acces_emploi_formation');
      expect(x).toEqual(expect.objectContaining({ non_comparable: true, delta_nb: null, delta_pts: null, sens: 'neutre' }));
      const l = r.body.lecture.join('\n');
      expect(l).toMatch(/Le taux d'accès à l'emploi ou à la formation des sortants ne peut pas être comparée : donnée non renseignée ou effectif nul sur la période du 01\/10\/2026 au 31\/12\/2026\./);
      expect(l).toMatch(/indicateur\(s\) ne peuvent pas être comparés/);
    });

    test('V-62 — à la volée (4 dates) : mêmes deltas que les instantanés, trace des périodes', async () => {
      const avant = await dernierIdJournal(pool);
      const q = `debut_a=${DEBUT}&fin_a=${FIN}&debut_b=2026-10-01&fin_b=2026-12-31`;
      const r = await auth(request(app).get(`/api/insertion/convergence/comparaison?${q}`), 'RH');
      expect(r.status).toBe(200);
      const s = await auth(request(app).get(`/api/insertion/convergence/comparaison?a=${snapB}&b=${snapC}`), 'RH');
      const sansDate = (x) => x.deltas;
      expect(sansDate(r.body)).toEqual(sansDate(s.body));
      expect(r.body.lecture.join(' ')).toMatch(/ne peut pas être comparée/);
      const j = await journalParAction(pool, 'INSERTION_CVG_COMPARAISON', avant);
      expect(j[0].details.periode_b).toEqual({ debut: '2026-10-01', fin: '2026-12-31' });
      const bad = await auth(request(app).get(`/api/insertion/convergence/comparaison?debut_a=${FIN}&fin_a=${DEBUT}&debut_b=${DEBUT}&fin_b=${FIN}`), 'RH');
      expect(bad.status).toBe(400);
      expect(bad.body.code).toBe('PERIODE_INVALIDE');
      const inc = await auth(request(app).get(`/api/insertion/convergence/comparaison?a=${snapA}`), 'RH');
      expect(inc.status).toBe(400);
      expect(inc.body.code).toBe('COMPARAISON_INCOMPLETE');
    });
  });

  // ═════════════════════════════════════════════════════════════════════════
  describe('anonymisation d\'un sortant', () => {
    test('V-70 — situation CVG supprimée, pension/médecin traitant remis à NULL, instantané intact', async () => {
      const g = await auth(request(app).post('/api/insertion/convergence/generer'), 'RH').send({ debut: DEBUT, fin: FIN });
      expect(g.status).toBe(201);
      const avant = (await pool.query('SELECT contenu FROM insertion_dialogues_gestion WHERE id = $1', [g.body.id])).rows[0].contenu;
      expect((await pool.query('SELECT COUNT(*)::int n FROM insertion_sortie_cvg WHERE employee_id = $1', [E[1]])).rows[0].n).toBe(1);

      const { anonymizeEmployee } = require('../../src/services/anonymization');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await anonymizeEmployee(client, E[1]);
        await client.query('COMMIT');
      } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }

      expect((await pool.query('SELECT COUNT(*)::int n FROM insertion_sortie_cvg WHERE employee_id = $1', [E[1]])).rows[0].n).toBe(0);
      const d = await pool.query('SELECT pension_invalidite, medecin_traitant, habitat_type FROM insertion_diagnostics WHERE employee_id = $1', [E[1]]);
      expect(d.rows[0]).toEqual({ pension_invalidite: null, medecin_traitant: null, habitat_type: 'autonome' });
      const apres = (await pool.query('SELECT contenu FROM insertion_dialogues_gestion WHERE id = $1', [g.body.id])).rows[0].contenu;
      expect(apres).toEqual(avant);
      expect(JSON.stringify(apres)).not.toMatch(/employee_id|Personne1"/);
    });
  });
});
