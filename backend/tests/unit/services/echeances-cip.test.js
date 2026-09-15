// ═══════════════════════════════════════════════════════════════════════════
// UNITAIRE — moteur des échéances CIP (PR C, lot 5)
// ───────────────────────────────────────────────────────────────────────────
// Le service est exercé avec un faux `db` : on contrôle ce qui SORT (les
// obligations, leur niveau, leur cible) et surtout ce qui N'EST PAS DEMANDÉ à
// la base (les familles sociales pour un MANAGER).
//
// Ce que ces tests tiennent :
//   1. CHAMPS DU SOCLE — le fichier partagé backend ET sa copie frontend
//      désignent les mêmes champs. Deux listes qui divergent, et le stepper du
//      diagnostic affiche « socle terminé » pendant que la file le nie.
//   2. PÉRIMÈTRE — les permanents sortent, les terminés récents restent,
//      `is_active` n'est plus un filtre.
//   3. RÔLE — un MANAGER ne fait même pas partir les requêtes des familles
//      sociales, et sa cohorte ne projette pas `brsa`.
//   4. NIVEAU DE RISQUE — une seule fonction, celle que consomme GET /insertion.
//   5. SOURCE INDISPONIBLE — une requête qui échoue se NOMME, elle ne rend
//      jamais « zéro obligation » en silence.
// ═══════════════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');

jest.mock('../../../src/config/database', () => ({ query: jest.fn(), connect: jest.fn() }));
jest.mock('../../../src/utils/insertion-settings', () => ({
  readInsertionSetting: jest.fn(async (k) => ({
    'insertion.file_active_terminees_mois': 7,
    'insertion.delai_diagnostic_jours': 30,
    'insertion.alerte_pass_iae_mois': 7,
    'insertion.alerte_sortie_fse_j1': 15,
    'insertion.alerte_sortie_fse_j2': 25,
    'insertion.categorie_g_alerte_jours': 30,
    'insertion.renouvellement_anticipation_jours': 42,
    'insertion.point_etape_referent_mois': 3,
    'insertion.report_echeance_heures': 48,
  }[k] ?? null)),
  INSERTION_SETTING_DEFAULTS: {},
}));
jest.mock('../../../src/services/activite-hebdo', () => ({
  activiteHebdoCohorte: jest.fn(async () => new Map()),
  activiteHebdo: jest.fn(),
}));

const svc = require('../../../src/services/echeances-cip');
const { aujourdhuiParis, decalerJours } = require('../../../src/utils/date-iso');

const JOUR = aujourdhuiParis();
const ilYA = (n) => decalerJours(JOUR, -n);
const dans = (n) => decalerJours(JOUR, n);

/** Faux `db` : chaque requête est aiguillée par un motif de son texte. */
function fauxDb(reponses = {}, journal = []) {
  return {
    query: jest.fn(async (sql, params) => {
      const s = String(sql).replace(/\s+/g, ' ');
      journal.push([s, params]);
      for (const [motif, lignes] of Object.entries(reponses)) {
        if (s.includes(motif)) {
          if (lignes instanceof Error) throw lignes;
          return { rows: lignes };
        }
      }
      return { rows: [] };
    }),
  };
}

const SALARIE = {
  id: 5, first_name: 'Amine', last_name: 'BENALI', insertion_status: 'en_parcours',
  insertion_start_date: ilYA(120), insertion_end_date: null, parcours_num: 1,
  cip_referent_user_id: 7, contract_end: dans(90), contrat_fin: dans(90),
  pass_iae_number: '2026-03-0441', pass_iae_end: dans(400), pass_iae_statut: 'actif',
  cddi_derogation_motif: null, referent_unique_type: 'cms',
  ft_categorie: null, ft_categorie_date: null,
};

// ═══════════════════════════════════════════════════════════════════════════
describe('1. champs du socle — une seule liste, deux fichiers', () => {
  test('la copie du frontend est IDENTIQUE à la source du backend', () => {
    // Le front ne peut pas importer `backend/src/data/…` : le contexte de build
    // Docker du frontend est `./frontend` et ne contient pas `backend/`. La
    // copie est donc assumée — et cette assertion est ce qui la tient.
    const dossier = path.join(__dirname, '..', '..', '..', '..');
    const back = fs.readFileSync(path.join(dossier, 'backend', 'src', 'data', 'diagnostic-socle-champs.json'), 'utf8');
    const front = fs.readFileSync(path.join(dossier, 'frontend', 'src', 'components', 'insertion', 'diagnostic-socle-champs.json'), 'utf8');
    expect(JSON.parse(front)).toEqual(JSON.parse(back));
  });

  test('le fragment SQL et le miroir JS portent sur les MÊMES colonnes', () => {
    const frag = svc.sqlSocleComplet('d');
    for (const c of svc.CHAMPS_SOCLE) expect(frag).toContain(`d.${c.colonne}`);
    // Aucune colonne de plus : un champ qui ne serait que dans le SQL rendrait
    // le serveur plus exigeant que l'écran, sans que personne ne le voie.
    const colonnes = (frag.match(/d\.(\w+)/g) || []).map((x) => x.slice(2));
    expect(new Set(colonnes)).toEqual(new Set(svc.CHAMPS_SOCLE.map((c) => c.colonne)));
  });

  test('le miroir JS refuse un socle incomplet et accepte un socle complet', () => {
    const plein = {};
    for (const c of svc.CHAMPS_SOCLE) {
      plein[c.colonne] = c.type === 'liste' ? ['RSA'] : c.type === 'booleen' ? false : '2026-01-01';
    }
    expect(svc.socleComplet(plein)).toBe(true);
    // `false` est une RÉPONSE, pas une absence : un booléen à false compte.
    expect(svc.socleComplet({ ...plein, rqth: false })).toBe(true);
    expect(svc.socleComplet({ ...plein, rqth: null })).toBe(false);
    expect(svc.socleComplet({ ...plein, ressources: [] })).toBe(false);
    expect(svc.socleComplet({ ...plein, logement_statut: '   ' })).toBe(false);
    expect(svc.socleComplet(null)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('2. périmètre de la file active', () => {
  test('les permanents sortent, les terminés récents restent, `is_active` n’est plus un filtre', () => {
    const f = svc.sqlPerimetreFileActive({ alias: 'e', moisTermines: 7 });
    expect(f).toContain("e.insertion_status = 'en_parcours'");
    expect(f).toContain("e.insertion_status = 'termine'");
    expect(f).toContain('make_interval(months => 7)');
    expect(f).not.toContain('is_active');
    expect(f).not.toContain("'none'"); // un permanent n'est jamais renvoyé
  });

  test('`?inclure=tous` rend tous les parcours SAUF les permanents', () => {
    const f = svc.sqlPerimetreFileActive({ alias: 'e', tous: true });
    expect(f).toContain("e.insertion_status <> 'none'");
    expect(f).not.toContain('make_interval');
  });

  test('un nombre de mois aberrant retombe sur le défaut, jamais sur du SQL cassé', () => {
    expect(svc.sqlPerimetreFileActive({ moisTermines: null })).toContain('make_interval(months => 7)');
    expect(svc.sqlPerimetreFileActive({ moisTermines: -3 })).toContain('make_interval(months => 7)');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('3. habilitation — le MANAGER ne fait pas partir les requêtes sociales', () => {
  test('`typesPourRole` retire les familles sociales', () => {
    const admin = svc.typesPourRole('ADMIN');
    const manager = svc.typesPourRole('MANAGER');
    for (const t of ['sortie_fse_a_saisir', 'fse_entree_manquant', 'categorie_g', 'sous_15h']) {
      expect(admin).toContain(t);
      expect(manager).not.toContain(t);
    }
    // … et laisse celles qui n'énoncent aucun statut social.
    for (const t of ['pass_iae', 'cddi_plafond', 'diagnostic_socle', 'referent_unique', 'suivi_6_mois']) {
      expect(manager).toContain(t);
    }
  });

  test('la cohorte d’un MANAGER ne LIT pas `ft_categorie` ni `brsa`', async () => {
    const journal = [];
    const db = fauxDb({ 'FROM employees e WHERE': [SALARIE] }, journal);
    await svc.chargerObligations({ db, baseRole: 'MANAGER' });
    const cohorte = journal.find(([s]) => s.includes('FROM employees e WHERE'))[0];
    expect(cohorte).toContain('NULL::varchar AS ft_categorie');
    expect(cohorte).not.toContain('e.ft_categorie,');
    expect(cohorte).not.toContain('e.brsa');
  });

  test('aucune requête FSE+ ni ASI ne part pour un MANAGER', async () => {
    const journal = [];
    const db = fauxDb({ 'FROM employees e WHERE': [SALARIE] }, journal);
    await svc.chargerObligations({ db, baseRole: 'MANAGER' });
    const tout = journal.map(([s]) => s).join('\n');
    expect(tout).not.toContain('insertion_fse_sorties');
    expect(tout).not.toContain('insertion_projet_participants');
  });

  test('elles partent pour un ADMIN', async () => {
    const journal = [];
    const db = fauxDb({ 'FROM employees e WHERE': [SALARIE] }, journal);
    await svc.chargerObligations({ db, baseRole: 'ADMIN' });
    const tout = journal.map(([s]) => s).join('\n');
    expect(tout).toContain('insertion_fse_sorties');
    expect(tout).toContain('insertion_projet_participants');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('4. obligations calculées', () => {
  const obligationsDe = async (over = {}, baseRole = 'ADMIN') => {
    const db = fauxDb({ 'FROM employees e WHERE': [{ ...SALARIE, ...(over.salarie || {}) }], ...(over.sources || {}) });
    const r = await svc.chargerObligations({ db, baseRole });
    return [...r.parEmploye.values()].flat();
  };

  test('un dossier à jour ne produit AUCUNE obligation', async () => {
    const o = await obligationsDe({
      sources: { 'FROM insertion_diagnostics d': [{ employee_id: 5, parcours_num: 1, socle_complet: true, fse_entree_complet: true }] },
    });
    expect(o).toEqual([]);
  });

  test('Pass IAE suspendu → ROUGE, même avec une fin lointaine', async () => {
    const o = await obligationsDe({
      salarie: { pass_iae_statut: 'suspendu' },
      sources: { 'FROM insertion_diagnostics d': [{ employee_id: 5, socle_complet: true, fse_entree_complet: true }] },
    });
    const p = o.find((x) => x.type === 'pass_iae');
    expect(p).toBeDefined();
    expect(p.niveau).toBe('rouge');
    expect(p.cible).toEqual({ onglet: 'dossier', champ: 'pass_iae' });
  });

  test('Pass IAE à moins de deux mois → ORANGE (et jamais rouge)', async () => {
    const o = await obligationsDe({
      salarie: { pass_iae_end: dans(40) },
      sources: { 'FROM insertion_diagnostics d': [{ employee_id: 5, socle_complet: true, fse_entree_complet: true }] },
    });
    expect(o.find((x) => x.type === 'pass_iae').niveau).toBe('orange');
  });

  test('socle du diagnostic incomplet au-delà du délai → ROUGE ; complet → rien', async () => {
    const avec = await obligationsDe({
      sources: { 'FROM insertion_diagnostics d': [{ employee_id: 5, socle_complet: false, fse_entree_complet: true }] },
    });
    expect(avec.find((x) => x.type === 'diagnostic_socle').niveau).toBe('rouge');
    const sans = await obligationsDe({
      sources: { 'FROM insertion_diagnostics d': [{ employee_id: 5, socle_complet: true, fse_entree_complet: true }] },
    });
    expect(sans.find((x) => x.type === 'diagnostic_socle')).toBeUndefined();
  });

  test('un parcours de moins de 30 jours ne déclenche PAS le socle', async () => {
    const o = await obligationsDe({ salarie: { insertion_start_date: ilYA(10) }, sources: {} });
    expect(o.find((x) => x.type === 'diagnostic_socle')).toBeUndefined();
  });

  test('référent unique non déterminé → ROUGE, pour TOUS (aucun adossement au statut BRSA)', async () => {
    for (const t of [null, 'non_determine']) {
      const o = await obligationsDe({
        salarie: { referent_unique_type: t },
        sources: { 'FROM insertion_diagnostics d': [{ employee_id: 5, socle_complet: true, fse_entree_complet: true }] },
      }, 'MANAGER');
      const r = o.find((x) => x.type === 'referent_unique');
      expect(r).toBeDefined();
      expect(r.niveau).toBe('rouge');
      // Le libellé ne NOMME aucun statut social : il dit quoi faire.
      expect(r.libelle).not.toMatch(/RSA|BRSA|bénéficiaire/i);
    }
  });

  test('catégorie France Travail « G » qui dure → ORANGE et JAMAIS rouge', async () => {
    const o = await obligationsDe({
      salarie: { ft_categorie: 'G', ft_categorie_date: ilYA(200) },
      sources: { 'FROM insertion_diagnostics d': [{ employee_id: 5, socle_complet: true, fse_entree_complet: true }] },
    });
    const g = o.find((x) => x.type === 'categorie_g');
    expect(g.niveau).toBe('orange');
  });

  test('cumul CDDI ≥ 23 mois sans dérogation → ROUGE ; avec motif → rien', async () => {
    const contrats = [{ employee_id: 5, contract_type: 'CDDI', start_date: ilYA(730), end_date: dans(30) }];
    const sans = await obligationsDe({
      sources: {
        'FROM employee_contracts': contrats,
        'FROM insertion_diagnostics d': [{ employee_id: 5, socle_complet: true, fse_entree_complet: true }],
      },
    });
    expect(sans.find((x) => x.type === 'cddi_plafond').niveau).toBe('rouge');
    const avec = await obligationsDe({
      salarie: { cddi_derogation_motif: 'formation_en_cours' },
      sources: {
        'FROM employee_contracts': contrats,
        'FROM insertion_diagnostics d': [{ employee_id: 5, socle_complet: true, fse_entree_complet: true }],
      },
    });
    expect(avec.find((x) => x.type === 'cddi_plafond')).toBeUndefined();
  });

  test('sortie FSE+ : le délai court depuis la SORTIE DE L’OPÉRATION quand elle est datée', async () => {
    // Rupture anticipée : la fin de contrat PRÉVUE est dans 90 jours, la sortie
    // de l'opération remonte à 40. Compter depuis le contrat n'aurait rien
    // affiché (défaut D de la PR A, imprimé 12 jours pour 43 réels).
    const o = await obligationsDe({
      sources: {
        'insertion_projet_participants pp': [{ employee_id: 5, date_sortie: ilYA(40) }],
        'FROM insertion_diagnostics d': [{ employee_id: 5, socle_complet: true, fse_entree_complet: true }],
      },
    });
    const s = o.find((x) => x.type === 'sortie_fse_a_saisir');
    expect(s).toBeDefined();
    expect(s.niveau).toBe('rouge'); // 40 j ≥ seuil 2 (25)
    expect(s.jours).toBe(40);
    expect(s.cible).toEqual({ onglet: 'dossier', champ: 'fse_sortie' });
  });

  test('sortie FSE+ : sous le premier seuil, aucune obligation', async () => {
    const o = await obligationsDe({
      sources: {
        'insertion_projet_participants pp': [{ employee_id: 5, date_sortie: ilYA(5) }],
        'FROM insertion_diagnostics d': [{ employee_id: 5, socle_complet: true, fse_entree_complet: true }],
      },
    });
    expect(o.find((x) => x.type === 'sortie_fse_a_saisir')).toBeUndefined();
  });

  test('questionnaire FSE+ d’entrée manquant : orange avant le délai, rouge après', async () => {
    const recent = await obligationsDe({
      salarie: { insertion_start_date: ilYA(10) },
      sources: {
        'insertion_projet_participants pp': [{ employee_id: 5, date_sortie: null }],
        'FROM insertion_diagnostics d': [{ employee_id: 5, socle_complet: true, fse_entree_complet: false }],
      },
    });
    expect(recent.find((x) => x.type === 'fse_entree_manquant').niveau).toBe('orange');
    const vieux = await obligationsDe({
      sources: {
        'insertion_projet_participants pp': [{ employee_id: 5, date_sortie: null }],
        'FROM insertion_diagnostics d': [{ employee_id: 5, socle_complet: true, fse_entree_complet: false }],
      },
    });
    expect(vieux.find((x) => x.type === 'fse_entree_manquant').niveau).toBe('rouge');
  });

  test('« sous 15 h » est une ligne AGRÉGÉE, qui ne nomme personne dans sa forme de base', async () => {
    const { activiteHebdoCohorte } = require('../../../src/services/activite-hebdo');
    activiteHebdoCohorte.mockResolvedValueOnce(new Map([[5, { alerte: { active: true }, nb_semaines_sous_seuil: 3 }]]));
    const db = fauxDb({
      'FROM employees e WHERE': [SALARIE],
      'FROM insertion_diagnostics d': [{ employee_id: 5, socle_complet: true, fse_entree_complet: true }],
    });
    const r = await svc.chargerObligations({ db, baseRole: 'ADMIN' });
    expect(r.agregees).toHaveLength(1);
    const a = r.agregees[0];
    expect(a.type).toBe('sous_15h');
    expect(a.employee_id).toBeNull();
    expect(a.nom).toBeNull();
    expect(a.libelle).toContain('1 salarié(s) sous 15 h');
    // Le détail nominatif EXISTE (la CIP doit pouvoir agir) mais il est à part.
    expect(a.detail).toEqual([{ employee_id: 5, nom: 'BENALI Amine' }]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('5. niveau de risque — une seule règle', () => {
  test('rouge prime sur orange, aucune obligation vaut null', () => {
    expect(svc.niveauRisque([])).toBeNull();
    expect(svc.niveauRisque(null)).toBeNull();
    expect(svc.niveauRisque([{ niveau: 'orange' }])).toBe('orange');
    expect(svc.niveauRisque([{ niveau: 'orange' }, { niveau: 'rouge' }])).toBe('rouge');
  });

  test('`niveauxRisqueCohorte` rend une carte VIDE si la base tombe, jamais une erreur', async () => {
    const db = { query: jest.fn(async () => { throw new Error('base injoignable'); }) };
    const err = jest.spyOn(console, 'error').mockImplementation(() => {});
    const m = await svc.niveauxRisqueCohorte({ db });
    expect(m instanceof Map).toBe(true);
    expect(m.size).toBe(0);
    err.mockRestore();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('6. dégradation nommée', () => {
  test('une source en échec se NOMME dans `sources_indisponibles`', async () => {
    const err = jest.spyOn(console, 'error').mockImplementation(() => {});
    const db = {
      query: jest.fn(async (sql) => {
        const s = String(sql).replace(/\s+/g, ' ');
        if (s.includes('FROM employees e WHERE')) return { rows: [SALARIE] };
        if (s.includes('FROM insertion_diagnostics d')) { const e = new Error('colonne absente'); e.code = '42703'; throw e; }
        return { rows: [] };
      }),
    };
    const r = await svc.chargerObligations({ db, baseRole: 'ADMIN' });
    expect(r.sources).toContain('diagnostics');
    err.mockRestore();
  });

  test('la cohorte elle-même en échec rend un résultat VIDE et nommé, jamais une exception', async () => {
    const err = jest.spyOn(console, 'error').mockImplementation(() => {});
    const db = { query: jest.fn(async () => { throw new Error('boum'); }) };
    const r = await svc.chargerObligations({ db, baseRole: 'ADMIN' });
    expect(r.salaries).toEqual([]);
    expect(r.sources).toContain('cohorte');
    err.mockRestore();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe('7. lien public de l’écran ETI', () => {
  test('le lien est composé sur PUBLIC_BASE_URL, sans double barre oblique', () => {
    const avant = process.env.PUBLIC_BASE_URL;
    process.env.PUBLIC_BASE_URL = 'https://solidata.online/';
    expect(svc.lienEti('abc')).toBe('https://solidata.online/eti/renouvellement/abc');
    delete process.env.PUBLIC_BASE_URL;
    expect(svc.lienEti('abc')).toMatch(/^https:\/\/[^/]+\/eti\/renouvellement\/abc$/);
    if (avant !== undefined) process.env.PUBLIC_BASE_URL = avant;
  });
});
