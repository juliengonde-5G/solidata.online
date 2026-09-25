// ═══════════════════════════════════════════════════════════════════════════
// UNITAIRE — reporting Convergence (programme CVG), lot 2.58.0
// ───────────────────────────────────────────────────────────────────────────
// Le composeur est exercé avec un `db` INJECTÉ qui reproduit la cohorte du
// formulaire scanné (période 01/04/2026 → 30/09/2026) : 46 accueillis, 18 H /
// 28 F, 37 en contrat à la fin, 9 sortis dont 3 en emploi ou formation et 4
// hors emploi, durée moyenne 9,3 mois.
//
// Ce que ces tests tiennent :
//   1. TRANSCODAGES — purs, et jamais devinés (`heberge`, `autre`, `numerique`).
//   2. COMPOSITION — les chiffres du scan, la forme `{ nb, pct }`, les zéros
//      explicites, les bases des pourcentages.
//   3. JAMAIS DE VALEUR INVENTÉE — une source illisible donne `null`, jamais 0.
//   4. COMPARATEUR — écarts, sens, seuil « stable », phrases sans cause, bloc
//      non comparable nommé.
//   5. CSV — cellule vide pour `null`, en-tête de traçabilité.
// ═══════════════════════════════════════════════════════════════════════════

jest.mock('../../../src/config/database', () => ({ query: jest.fn(async () => ({ rows: [] })), connect: jest.fn() }));
jest.mock('../../../src/utils/insertion-settings', () => ({
  readInsertionSetting: jest.fn(async (k) => ({
    'insertion.cvg_frein_seuil': 3,
    'insertion.cvg_sans_bilan_est_sans_nouvelles': true,
  }[k] ?? null)),
  INSERTION_SETTING_DEFAULTS: {},
}));

const R = require('../../../src/utils/convergence-cvg-referentiels');
const svc = require('../../../src/services/convergence-cvg');
const { decalerJours } = require('../../../src/utils/date-iso');

const DEBUT = '2026-04-01';
const FIN = '2026-09-30';

// ── Cohorte du scan ─────────────────────────────────────────────────────────
function cohorteScan() {
  const lignes = [];
  for (let id = 1; id <= 46; id += 1) {
    const sortant = id <= 9;
    const fin = sortant ? decalerJours('2026-05-01', id * 10) : null;
    lignes.push({
      id,
      gender: id <= 18 ? 'M' : 'F',
      civility: null,
      // 4 moins de 26 ans, 31 de 26 à 49, 11 de 50 ans et plus (scan)
      birth_date: id <= 4 ? '2003-01-01' : id <= 35 ? '1985-01-01' : '1965-01-01',
      brsa: id <= 32,
      orienteur_type: id <= 37 ? 'france_travail' : id === 38 ? 'mission_locale' : id <= 43 ? 'plie_pmie' : id <= 45 ? 'departement_cms' : 'candidature_spontanee',
      disability_status: null,
      insertion_status: sortant ? 'termine' : 'en_parcours',
      insertion_start_date: sortant ? decalerJours(fin, -283) : '2026-01-05',
      insertion_end_date: fin,
      parcours_num: 1,
      diag_id: id,
      // 5 infra3, 29 niv3, 8 niv4, 2 niv5, 2 niv7
      niveau_formation: id <= 5 ? 'infra3' : id <= 34 ? 'niv3' : id <= 42 ? 'niv4' : id <= 44 ? 'niv5' : 'niv7',
      habitat_type: id === 46 ? null : (id <= 14 ? 'autonome' : id <= 36 ? 'semi_durable' : id <= 38 ? 'hebergement_collectif' : 'hebergement_precaire'),
      logement_statut: id === 46 ? 'heberge' : null,
      parcours_rue: id <= 5,
      rqth: id <= 5,
      pension_invalidite: null,
      medecin_traitant: id <= 3 ? true : null,
      mutuelle_statut: id <= 2 ? 'css' : 'aucune',
      ressources: id <= 3 ? ['ASS'] : [],
      fse_entree: id <= 23 ? { duree_sans_emploi: 'gt_24m' } : {},
      entree_frein_linguistique: id <= 16 ? 3 : 1,
      entree_frein_sante: id <= 20 ? 4 : 1,
      entree_frein_logement: id <= 19 ? 3 : 2,
      entree_frein_administratif: id <= 31 ? 3 : 1,
      entree_frein_finances: id <= 7 ? 5 : 1,
      entree_frein_judiciaire: id <= 3 ? 3 : 1,
      entree_frein_famille: id <= 6 ? 3 : 1,
      entree_frein_mobilite: id <= 23 ? 3 : 1,
    });
  }
  return lignes;
}

const BILANS = [
  { employee_id: 1, parcours_num: 1, sortie_classification: 'emploi_durable', sortie_type: 'CDI' },
  { employee_id: 2, parcours_num: 1, sortie_classification: 'sortie_positive', sortie_type: 'formation' },
  { employee_id: 3, parcours_num: 1, sortie_classification: 'sortie_positive', sortie_type: 'formation' },
  { employee_id: 4, parcours_num: 1, sortie_classification: 'autre', sortie_type: 'fin_contrat' },
  { employee_id: 5, parcours_num: 1, sortie_classification: 'autre', sortie_type: null },
  { employee_id: 6, parcours_num: 1, sortie_classification: 'autre', sortie_type: null },
  { employee_id: 7, parcours_num: 1, sortie_classification: 'sortie_positive', sortie_type: null },
  { employee_id: 8, parcours_num: 1, sortie_classification: 'emploi_transition', sortie_type: null },
  { employee_id: 9, parcours_num: 1, sortie_classification: 'sortie_positive', sortie_type: null },
];

const SITUATIONS = [
  { employee_id: 5, parcours_num: 1, categorie: 'sortie_neutre', habitat_type_sortie: 'autonome', medecin_traitant_sortie: true },
  { employee_id: 6, parcours_num: 1, categorie: 'sortie_neutre', habitat_type_sortie: 'autonome', medecin_traitant_sortie: true },
  { employee_id: 7, parcours_num: 1, categorie: 'autre_positive', parcours_de_soin: false, accompagnement_post_sortie: true },
  { employee_id: 1, parcours_num: 1, categorie: null, habitat_type_sortie: 'autonome', accompagnement_post_sortie: false },
];

function fauxDb(over = {}) {
  const journal = [];
  const db = {
    query: jest.fn(async (sql, params) => {
      const s = String(sql);
      journal.push([s, params]);
      const rep = (k, defaut) => {
        const v = Object.prototype.hasOwnProperty.call(over, k) ? over[k] : defaut;
        if (v instanceof Error) throw v;
        return { rows: v };
      };
      if (/FROM settings/.test(s)) return rep('settings', []);
      if (/AS sortie_frein_/.test(s)) {
        // Sortant 2 : linguistique 3 → 1 (résolution) ; sortant 4 : finances 5 → 2.
        return rep('eval', [
          { id: 2, sortie_frein_linguistique: 1 },
          { id: 4, sortie_frein_finances: 2, sortie_frein_logement: 3 },
        ]);
      }
      if (/FROM employees e\s+LEFT JOIN insertion_diagnostics d/.test(s)) return rep('cohorte', cohorteScan());
      if (/FROM employee_eligibilite/.test(s)) {
        return rep('criteres', [
          { employee_id: 44, critere_code: 'refugie_bpi' }, { employee_id: 45, critere_code: 'refugie_bpi' },
          { employee_id: 46, critere_code: 'refugie_bpi' },
        ]);
      }
      if (/FROM employees e\s+WHERE e\.id = ANY/.test(s)) {
        return rep('en_contrat', Array.from({ length: 37 }, (_, i) => ({ id: i + 10 })));
      }
      if (/insertion_end_date BETWEEN/.test(s)) {
        return rep('fins', BILANS.map((b) => ({ employee_id: b.employee_id, parcours_num: 1 })));
      }
      if (/milestone_type = 'bilan_sortie'/.test(s)) return rep('bilans', BILANS);
      if (/FROM insertion_sortie_cvg/.test(s)) return rep('situations', SITUATIONS);
      if (/FROM employee_contracts WHERE employee_id = ANY/.test(s)) return rep('contrats', []);
      if (/FROM insertion_cvg_ressources/.test(s)) {
        return rep('ressources', [
          { id: 1, type: 'interne', nom: 'MARTIN Claire', fonction: 'CIP', etp_total: 1, etp_accompagnement: 1, etp_encadrement: null },
          { id: 2, type: 'interne', nom: 'DURAND Paul', fonction: 'Encadrant technique', etp_total: 1, etp_accompagnement: 0.2, etp_encadrement: 0.8 },
          { id: 3, type: 'mutualisee', nom: 'LEROY Anne', fonction: 'Chargée de mission', employeur: 'PLIE', etp_total: 0.1 },
        ]);
      }
      return { rows: [] };
    }),
  };
  return { db, journal };
}

// ═══════════════════════════════════════════════════════════════════════════
describe('1. transcodages — purs, jamais devinés', () => {
  test('type de sortie → catégorie Convergence', () => {
    for (const t of ['CDI', 'CDD', 'CDD_court', 'interim', 'creation_activite']) expect(R.transcoderSortieType(t)).toBe('emploi');
    expect(R.transcoderSortieType('autre_IAE')).toBe('suite_parcours_insertion');
    expect(R.transcoderSortieType('formation')).toBe('formation');
    expect(R.transcoderSortieType('fin_contrat')).toBe('sans_solution');
    expect(R.transcoderSortieType('sans_suite')).toBe('sans_nouvelles');
    expect(R.transcoderSortieType('autre')).toBeNull();
    expect(R.transcoderSortieType(null)).toBeNull();
  });

  test('habitat : « hébergé » est AMBIGU et n’est rangé nulle part', () => {
    for (const s of ['locataire_social', 'locataire_prive', 'proprietaire']) expect(R.transcoderHabitat(s)).toBe('autonome');
    expect(R.transcoderHabitat('sans_abri')).toBe('rue');
    expect(R.transcoderHabitat('heberge')).toBeNull();
    expect(R.transcoderHabitat(null)).toBeNull();
  });

  test('orienteurs : 12 clés passent, les anciennes se transcodent, « autre » reste à préciser', () => {
    for (const o of R.ORIENTEURS_CVG) expect(R.transcoderOrienteur(o)).toBe(o);
    expect(R.ORIENTEURS_CVG).toHaveLength(12);
    expect(R.transcoderOrienteur('departement_cms')).toBe('services_sociaux_departement');
    expect(R.transcoderOrienteur('ccas')).toBe('autre_accompagnement');
    expect(R.transcoderOrienteur('autre')).toBeNull();
    expect(R.ORIENTEURS_ACCEPTES).toEqual(expect.arrayContaining(['departement_cms', 'ccas', 'autre', ...R.ORIENTEURS_CVG]));
    // La colonne a été élargie à 40 caractères pour ces valeurs.
    for (const o of R.ORIENTEURS_ACCEPTES) expect(o.length).toBeLessThanOrEqual(40);
  });

  test('freins : huit axes transmis, le numérique jamais', () => {
    expect(R.transcoderFrein('linguistique')).toBe('illettrisme_fle');
    expect(R.transcoderFrein('administratif')).toBe('demarches_droits');
    expect(R.transcoderFrein('finances')).toBe('surendettement');
    expect(R.transcoderFrein('judiciaire')).toBe('justice');
    expect(R.transcoderFrein('famille')).toBe('garde_enfant');
    expect(R.transcoderFrein('numerique')).toBeNull();
    expect(svc.AXES).not.toContain('numerique');
    expect(svc.AXES).toHaveLength(8);
  });

  test('niveaux de formation et tranches d’âge (bornes CVG, à la date de fin)', () => {
    expect(R.niveauFormationCvg('infra3')).toBe('niv1_2');
    expect(R.niveauFormationCvg('niv8')).toBe('niv8');
    expect(R.niveauFormationCvg('niv6plus')).toBe('niv6plus');
    expect(R.niveauFormationCvg('CAP')).toBeNull();
    expect(R.trancheAgeCvg('2000-10-01', FIN)).toBe('moins_26'); // 25 ans la veille de ses 26
    expect(R.trancheAgeCvg('2000-09-30', FIN)).toBe('de_26_a_49');
    expect(R.trancheAgeCvg('1976-10-01', FIN)).toBe('de_26_a_49');
    expect(R.trancheAgeCvg('1976-09-30', FIN)).toBe('plus_50');
    expect(R.trancheAgeCvg(null, FIN)).toBeNull();
  });

  test('sexe : la fiche fait foi, la civilité n’est qu’un repli, l’inconnu reste inconnu', () => {
    expect(R.sexeCvg({ gender: 'F', civility: 'M.' })).toBe('F');
    expect(R.sexeCvg({ gender: null, civility: 'Mme' })).toBe('F');
    expect(R.sexeCvg({ gender: null, civility: 'Monsieur' })).toBe('H');
    expect(R.sexeCvg({ gender: null, civility: 'Dr' })).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('2. composition — les chiffres du formulaire scanné', () => {
  let c;
  beforeAll(async () => {
    const { db } = fauxDb();
    c = await svc.composerCvg({ debut: DEBUT, fin: FIN, db, user: { first_name: 'Claire', last_name: 'MARTIN', role: 'RH' } });
  });

  test('en-tête : période, prénom + initiale, rôle, mention', () => {
    expect(c.en_tete).toEqual(expect.objectContaining({
      periode_debut: DEBUT, periode_fin: FIN, genere_par_nom: 'Claire M.', genere_par_role: 'RH',
    }));
    expect(c.en_tete.mention).toMatch(/Convergence/);
  });

  test('Partie 1 — effectifs', () => {
    expect(c.partie1.effectifs).toEqual({ etp_conventionnes: null, accueillis: 46, en_contrat_fin: 37 });
    expect(c.partie1.base).toBe(46);
  });

  test('Partie 1 — publics : sexe, âge, formation, minima sociaux', () => {
    const p = c.partie1.publics;
    expect(p.hommes).toEqual({ nb: 18, pct: 39.1 });
    expect(p.femmes).toEqual({ nb: 28, pct: 60.9 });
    expect([p.moins_26.nb, p.de_26_a_49.nb, p.plus_50.nb]).toEqual([4, 31, 11]);
    expect([p.niv1_2.nb, p.niv3.nb, p.niv4.nb, p.niv5.nb, p.niv6.nb, p.niv7.nb, p.niv8.nb]).toEqual([5, 29, 8, 2, 0, 2, 0]);
    expect(p.niv6plus).toBeUndefined(); // ligne de rattrapage absente quand elle ne compte personne
    expect(p.total_formation).toEqual({ nb: 46, pct: 100 });
    expect(p.sans_emploi_2ans.nb).toBe(23);
    expect(p.rsa_socle.nb).toBe(32);
    expect(p.ass.nb).toBe(3);
    expect(p.rth.nb).toBe(5);
    expect(p.aah).toEqual({ nb: 0, pct: 0 }); // zéro EXPLICITE
    expect(p.refugies.nb).toBe(3);
    expect(p.non_renseigne).toEqual({ sexe: 0, age: 0, formation: 0 });
  });

  test('habitat à l’entrée : « hébergé » compté non renseigné, jamais rangé', () => {
    const h = c.partie1.habitat_entree;
    expect([h.autonome.nb, h.semi_durable.nb, h.hebergement_collectif.nb, h.hebergement_precaire.nb, h.rue.nb])
      .toEqual([14, 22, 2, 7, 0]);
    expect(h.total).toEqual({ nb: 45, pct: 97.8 });
    expect(h.non_renseigne).toBe(1);
    expect(h.parcours_rue.nb).toBe(5);
  });

  test('difficultés à l’entrée : clés SOLIDATA, seuil 3, numérique absent', () => {
    const d = c.partie1.difficultes_entree;
    expect(d.linguistique.nb).toBe(16);
    expect(d.sante.nb).toBe(20);
    expect(d.logement.nb).toBe(19);
    expect(d.administratif.nb).toBe(31);
    expect(d.finances.nb).toBe(7);
    expect(d.judiciaire.nb).toBe(3);
    expect(d.famille.nb).toBe(6);
    expect(d.mobilite.nb).toBe(23);
    expect(d.numerique).toBeUndefined();
    expect(d.non_evalue).toBe(0);
  });

  test('orienteurs : anciennes valeurs transcodées, total et non renseigné', () => {
    const o = c.partie1.orienteurs;
    expect(o.france_travail).toEqual({ nb: 37, pct: 80.4 });
    expect(o.plie_pmie.nb).toBe(5);
    expect(o.services_sociaux_departement.nb).toBe(2);
    expect(o.cap_emploi).toEqual({ nb: 0, pct: 0 });
    expect(o.total.nb).toBe(46);
    expect(o.non_renseigne).toBe(0);
    expect(Object.keys(o)).toEqual([...R.ORIENTEURS_CVG, 'total', 'non_renseigne']);
  });

  test('Partie 2 — moyens humains et totaux', () => {
    expect(c.partie2.internes).toHaveLength(2);
    expect(c.partie2.mutualisees).toEqual([{ nom: 'LEROY Anne', fonction: 'Chargée de mission', employeur: 'PLIE', etp_total: 0.1 }]);
    expect(c.partie2.totaux.internes).toEqual({ etp_total: 2, etp_accompagnement: 1.2, etp_encadrement: 0.8 });
    expect(c.partie2.totaux.cvg).toBe(2.1);
  });

  test('sorties : 9 sortis, 3 emploi/formation, 4 hors emploi, 9,3 mois', () => {
    const s = c.sorties;
    expect(s.total).toBe(9);
    expect(s.duree_moyenne_mois).toBe(9.3);
    expect(s.non_documentees).toBe(0);
    expect(s.emploi.total).toBe(3);
    expect(s.emploi.categories).toEqual({
      emploi: { nb: 1, pct: 11.1 }, suite_parcours_insertion: { nb: 0, pct: 0 }, formation: { nb: 2, pct: 22.2 },
    });
    expect(s.hors_emploi.total).toBe(4);
    expect(s.hors_emploi.categories.sans_solution.nb).toBe(1);
    expect(s.hors_emploi.categories.sortie_neutre).toEqual({ nb: 2, pct: 22.2 });
    expect(s.hors_emploi.categories.autre_positive.nb).toBe(1);
    expect(s.hors_emploi.categories.parcours_de_soin.nb).toBe(0);
    expect(s.hors_emploi.categories.retraite).toEqual({ nb: 0, pct: 0 });
    // Deux sortants sans catégorie : ni devinés, ni rangés — comptés à part.
    expect(s.non_categorises).toBe(2);
    expect(s.emploi.non_categorises).toBe(1); // classification « emploi de transition »
    expect(s.hors_emploi.non_categorises).toBe(0);
  });

  test('tableaux jumeaux : freins, logement, santé, post-sortie — base = total du tableau', () => {
    const e = c.sorties.emploi;
    // Sortant 2 : linguistique 3 → 1 : difficulté ET résolution.
    expect(e.freins.linguistique).toEqual({ entree: { nb: 3, pct: 100 }, resolution: { nb: 1, pct: 33.3 } });
    expect(Object.keys(e.freins)).not.toContain('numerique');
    expect(e.logement.autonome).toEqual({ entree: { nb: 3, pct: 100 }, sortie: { nb: 1, pct: 33.3 } });
    expect(e.sante.medecin_traitant.entree.nb).toBe(3);
    expect(e.sante.couverture_sante_amelioree.entree.nb).toBe(2);
    expect(e.post_sortie).toEqual({ nb: 0, pct: 0 });
    const h = c.sorties.hors_emploi;
    expect(h.freins.finances.resolution.nb).toBe(1); // sortant 4 : 5 → 2
    expect(h.freins.logement.resolution.nb).toBe(0); // 3 → 3 : pas de résolution
    expect(h.sante.medecin_traitant.sortie).toEqual({ nb: 2, pct: 50 });
    expect(h.logement.autonome.sortie.nb).toBe(2);
    expect(h.post_sortie).toEqual({ nb: 1, pct: 25 });
    expect(h.non_renseigne.situation_sortie).toBe(1); // sortant 4 : aucune situation saisie
  });

  test('complétude et méthode', () => {
    expect(c.completude.nb_incomplets).toBeGreaterThan(0);
    expect(c.completude.manques_par_type.situation_sortie).toBeGreaterThan(0);
    expect(Array.isArray(c.methode)).toBe(true);
    expect(c.methode.join(' ')).toMatch(/numérique/);
    expect(c.methode.join(' ')).toMatch(/sans nouvelles/);
  });

  test('aucun nom de salarié en insertion dans le document (seule la Partie 2 nomme)', () => {
    const sansP2 = JSON.stringify({ ...c, partie2: null });
    for (const cle of ['"nom"', '"prenom"', '"employee_id"', '"first_name"', '"last_name"', '"birth_date"']) {
      expect(sansP2).not.toContain(cle);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('3. jamais de valeur inventée', () => {
  test('cohorte illisible → effectifs et comptes `null`, jamais 0 ; la source est nommée', async () => {
    const { db } = fauxDb({ cohorte: Object.assign(new Error('relation absente'), { code: '42P01' }) });
    const c = await svc.composerCvg({ debut: DEBUT, fin: FIN, db });
    expect(c.partie1.effectifs.accueillis).toBeNull();
    expect(c.partie1.publics.femmes).toEqual({ nb: null, pct: null });
    expect(c.partie1.habitat_entree.non_renseigne).toBeNull();
    expect(c.methode.join(' ')).toMatch(/cohorte/);
  });

  test('sorties illisibles → bloc des sorties à `null`', async () => {
    const { db } = fauxDb({ fins: Object.assign(new Error('x'), { code: '42703' }) });
    const c = await svc.composerCvg({ debut: DEBUT, fin: FIN, db });
    expect(c.sorties.total).toBeNull();
    expect(c.sorties.emploi).toBeNull();
  });

  test('registre des moyens humains vide → totaux vides, jamais 0', async () => {
    const { db } = fauxDb({ ressources: [] });
    const c = await svc.composerCvg({ debut: DEBUT, fin: FIN, db });
    expect(c.partie2.totaux.cvg).toBeNull();
    expect(c.partie2.totaux.internes.etp_total).toBeNull();
  });

  test('pourcentage sur base nulle → null, jamais 0 %', () => {
    expect(svc.pctDe(0, 0)).toBeNull();
    expect(svc.pctDe(null, 10)).toBeNull();
    expect(svc.pctDe(1, 3)).toBe(33.3);
  });

  test('période invalide refusée avant toute requête', async () => {
    const { db } = fauxDb();
    await expect(svc.composerCvg({ debut: '2026-09-30', fin: '2026-04-01', db })).rejects.toMatchObject({ code: 'PERIODE_INVALIDE' });
    await expect(svc.composerCvg({ debut: '2024-01-01', fin: '2026-09-30', db })).rejects.toMatchObject({ code: 'PERIODE_INVALIDE' });
    expect(db.query).not.toHaveBeenCalled();
  });

  test('complétude nominative : lien vers la fiche, manques en phrases', async () => {
    const { db } = fauxDb();
    const orig = db.query.getMockImplementation();
    db.query.mockImplementation(async (sql, params) => {
      if (/SELECT id, first_name, last_name FROM employees/.test(String(sql))) {
        return { rows: params[0].map((id) => ({ id, first_name: 'Prénom', last_name: `nom${id}` })) };
      }
      return orig(sql, params);
    });
    const liste = await svc.composerCompletude({ debut: DEBUT, fin: FIN, db });
    const quatre = liste.find((l) => l.employee_id === 4);
    expect(quatre).toEqual(expect.objectContaining({ nom: 'NOM4 Prénom', lien: '/insertion?employee=4' }));
    expect(quatre.manques.join(' ')).toMatch(/Situation de sortie Convergence non saisie/);
    const hebergee = liste.find((l) => l.employee_id === 46);
    expect(hebergee.manques.join(' ')).toMatch(/habitat/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('4. comparateur', () => {
  const contenu = (o = {}) => ({
    en_tete: { periode_debut: o.debut || '2025-10-01', periode_fin: o.fin || '2026-03-31' },
    partie1: {
      effectifs: { accueillis: o.acc ?? 40, en_contrat_fin: 30, etp_conventionnes: null },
      base: o.acc ?? 40,
      publics: { femmes: { nb: o.femmes ?? 20 }, rsa_socle: { nb: o.rsa ?? 20 }, moins_26: { nb: 4 }, plus_50: { nb: 8 }, rth: { nb: 2 }, sans_emploi_2ans: { nb: 10 }, refugies: { nb: 1 } },
      habitat_entree: { hebergement_precaire: { nb: o.precaire ?? 4 }, rue: { nb: 0 }, parcours_rue: { nb: 2 } },
      difficultes_entree: { linguistique: { nb: 10 }, sante: { nb: o.sante ?? 12 }, logement: { nb: 5 }, administratif: { nb: 20 }, finances: { nb: 3 }, judiciaire: { nb: 1 }, famille: { nb: 2 }, mobilite: { nb: 15 } },
    },
    sorties: {
      total: o.sorties ?? 10,
      non_documentees: 1,
      duree_moyenne_mois: o.duree ?? 9.3,
      emploi: o.emploiNull ? null : { total: o.emploi ?? 4, post_sortie: { nb: 1 }, freins: { linguistique: { resolution: { nb: 2 } } } },
      hors_emploi: o.emploiNull ? null : { total: 5, post_sortie: { nb: 0 }, freins: {} },
    },
  });

  test('écarts en nombre et en points, sens, seuil de stabilité à 2 points', () => {
    const r = svc.comparerCvg(contenu(), contenu({ debut: '2026-04-01', fin: '2026-09-30', acc: 46, femmes: 28, rsa: 23, emploi: 3, sorties: 9 }));
    expect(r.a.periode).toEqual({ debut: '2025-10-01', fin: '2026-03-31' });
    const f = r.deltas.find((d) => d.indicateur === 'femmes');
    expect(f).toEqual(expect.objectContaining({ a_nb: 20, a_pct: 50, b_nb: 28, b_pct: 60.9, delta_nb: 8, delta_pts: 10.9, sens: 'neutre' }));
    const rsa = r.deltas.find((d) => d.indicateur === 'rsa_socle');
    expect(rsa.sens).toBe('stable'); // 50 % → 50 %
    const emp = r.deltas.find((d) => d.indicateur === 'acces_emploi_formation');
    expect(emp.sens).toBe('defavorable'); // 40 % → 33,3 %
    for (const d of r.deltas) expect(['favorable', 'defavorable', 'stable', 'neutre']).toContain(d.sens);
  });

  test('lecture rédigée : variations en toutes lettres, jamais de cause', () => {
    const r = svc.comparerCvg(contenu(), contenu({ acc: 46, femmes: 28 }));
    const texte = r.lecture.join(' ');
    expect(texte).toMatch(/L'effectif accueilli passe de 40 à 46 personnes \(\+6\)/);
    expect(texte).toMatch(/La part de femmes passe de 50 % à 60,9 % \(en hausse de 10,9 points\)/);
    expect(texte).toMatch(/difficulté la plus fréquente/);
    expect(texte).not.toMatch(/parce que|en raison|grâce à|à cause/i);
  });

  test('un bloc non comparable est nommé, sans écart calculé', () => {
    const r = svc.comparerCvg(contenu(), contenu({ emploiNull: true }));
    const emp = r.deltas.find((d) => d.indicateur === 'acces_emploi_formation');
    expect(emp).toEqual(expect.objectContaining({ b_nb: null, delta_nb: null, delta_pts: null, non_comparable: true }));
    expect(r.lecture.join(' ')).toMatch(/ne peut pas être comparée/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('5. CSV', () => {
  test('en-tête de traçabilité, cellule vide pour null, jamais 0', async () => {
    const { db } = fauxDb({ ressources: [] });
    const c = await svc.composerCvg({ debut: DEBUT, fin: FIN, db });
    const csv = svc.cvgVersCsv(c, { generePar: 'Claire MARTIN' });
    expect(csv.charCodeAt(0)).toBe(0xFEFF);
    expect(csv).toMatch(/# Export;Outil de dialogue de gestion — programme CVG/);
    expect(csv).toMatch(/Généré par;Claire MARTIN/);
    expect(csv).toMatch(/Partie 1 — Effectifs;Nombre d'ETP conventionnés à la date de fin;;\n/);
    expect(csv).toMatch(/Partie 2 — Total;Total ressources CVG \(ETP\);;/);
    expect(csv).toMatch(/Partie 1 — Publics;Femmes;28;60,9/);
  });

  test('document vide détecté', () => {
    expect(svc.cvgEstVide({ partie1: { effectifs: { accueillis: 0 } }, sorties: { total: 0 } })).toBe(true);
    expect(svc.cvgEstVide({ partie1: { effectifs: { accueillis: 0 } }, sorties: { total: 1 } })).toBe(false);
  });
});
