// ═══════════════════════════════════════════════════════════════════════════
// UNIT — Schéma typé du questionnaire FSE+ (PR A lot 2)
//   backend/src/utils/fse-schema.js
// Ce que ces tests verrouillent : une clé inconnue est REFUSÉE (et non ignorée
// en silence, ce qui ferait disparaître une réponse de l'export sans que
// personne ne le sache), les réponses héritées du formulaire libre restent
// enregistrables, la complétude ne compte que les items obligatoires, et
// AUCUNE suggestion n'est produite sans source lisible. Aucune dépendance DB.
// ═══════════════════════════════════════════════════════════════════════════
const {
  FSE_ENTREE_ITEMS, FSE_SORTIE_ITEMS, SITUATIONS_SORTIE,
  valider, completude, suggestionsEntree, libelleValeur,
} = require('../../../src/utils/fse-schema');

describe('FSE_ENTREE_ITEMS — 5 items obligatoires + 1 commentaire', () => {
  it('expose les 6 clés attendues, dans l’ordre du questionnaire', () => {
    expect(FSE_ENTREE_ITEMS.map((i) => i.cle)).toEqual([
      'statut_avant_entree', 'duree_sans_emploi', 'foyer_monoparental',
      'sans_domicile_stable', 'ressources_principales', 'commentaire',
    ]);
    expect(FSE_ENTREE_ITEMS.filter((i) => i.obligatoire)).toHaveLength(5);
    expect(FSE_ENTREE_ITEMS.find((i) => i.cle === 'commentaire').obligatoire).toBe(false);
  });

  it('les situations de sortie sont exactement celles du CHECK de la table', () => {
    expect(SITUATIONS_SORTIE).toEqual([
      'emploi_durable', 'emploi_transition', 'formation',
      'autre_sortie_positive', 'inactivite', 'chomage', 'inconnue',
    ]);
  });
});

describe('valider', () => {
  it('accepte un questionnaire complet et rend les valeurs canoniques', () => {
    const v = valider({
      statut_avant_entree: 'demandeur_emploi', duree_sans_emploi: '12_24m',
      foyer_monoparental: true, sans_domicile_stable: false, ressources_principales: 'rsa',
    }, FSE_ENTREE_ITEMS);
    expect(v.ok).toBe(true);
    expect(v.erreurs).toEqual([]);
    expect(v.valeurs.duree_sans_emploi).toBe('12_24m');
  });

  it('REFUSE une clé inconnue (elle ne doit pas se perdre dans le JSONB)', () => {
    const v = valider({ niveau_etudes: 'bac' }, FSE_ENTREE_ITEMS);
    expect(v.ok).toBe(false);
    expect(v.erreurs[0].cle).toBe('niveau_etudes');
    expect(v.erreurs[0].motif).toMatch(/Champ inconnu/);
  });

  it('REFUSE une valeur hors liste en nommant les valeurs acceptées', () => {
    const v = valider({ statut_avant_entree: 'retraite' }, FSE_ENTREE_ITEMS);
    expect(v.ok).toBe(false);
    expect(v.erreurs[0].motif).toMatch(/demandeur_emploi/);
  });

  it('convertit les réponses HÉRITÉES du formulaire libre (jamais un dossier inenregistrable)', () => {
    const v = valider({ duree_sans_emploi: 'moins_6_mois' }, FSE_ENTREE_ITEMS);
    expect(v.ok).toBe(true);
    expect(v.valeurs.duree_sans_emploi).toBe('lt_6m');
    expect(valider({ duree_sans_emploi: 'plus_24_mois' }, FSE_ENTREE_ITEMS).valeurs.duree_sans_emploi).toBe('gt_24m');
  });

  it('une valeur vide EFFACE la réponse et n’est jamais remplacée par un défaut', () => {
    const v = valider({ foyer_monoparental: null, sans_domicile_stable: '' }, FSE_ENTREE_ITEMS);
    expect(v.ok).toBe(true);
    expect(v.valeurs).toEqual({});
  });

  it('normalise un booléen tolérant mais refuse une valeur illisible', () => {
    expect(valider({ foyer_monoparental: 'oui' }, FSE_ENTREE_ITEMS).valeurs.foyer_monoparental).toBe(true);
    expect(valider({ foyer_monoparental: 'peut-être' }, FSE_ENTREE_ITEMS).ok).toBe(false);
  });

  it('borne le commentaire et accepte null / objet vide', () => {
    expect(valider({ commentaire: 'x'.repeat(2001) }, FSE_ENTREE_ITEMS).ok).toBe(false);
    expect(valider(null, FSE_ENTREE_ITEMS)).toEqual({ ok: true, erreurs: [], valeurs: {} });
    expect(valider([], FSE_ENTREE_ITEMS).ok).toBe(false);
  });

  it('valide aussi le questionnaire de SORTIE', () => {
    expect(valider({ situation_sortie: 'emploi_durable', type_contrat: 'cdi' }, FSE_SORTIE_ITEMS).ok).toBe(true);
    expect(valider({ type_contrat: 'apprentissage' }, FSE_SORTIE_ITEMS).ok).toBe(false);
  });
});

describe('completude', () => {
  it('ne compte que les items obligatoires (le commentaire n’est pas une pièce)', () => {
    const c = completude({ commentaire: 'bla' }, FSE_ENTREE_ITEMS);
    expect(c).toMatchObject({ total: 5, renseignes: 0, complet: false, pct: 0 });
    expect(c.manquants).toHaveLength(5);
  });

  it('déclare complet à 5 réponses sur 5, y compris avec des « false »', () => {
    const c = completude({
      statut_avant_entree: 'inactif', duree_sans_emploi: 'gt_24m',
      foyer_monoparental: false, sans_domicile_stable: false, ressources_principales: 'aucune',
    }, FSE_ENTREE_ITEMS);
    expect(c.complet).toBe(true);
    expect(c.pct).toBe(100);
    expect(c.manquants).toEqual([]);
  });
});

describe('suggestionsEntree — jamais de suggestion sans source', () => {
  it('déduit « sans domicile stable » du statut de logement, avec la source affichée', () => {
    expect(suggestionsEntree({ logement_statut: 'sans_abri' }, {}).sans_domicile_stable)
      .toEqual({ valeur: true, source: 'Logement : sans domicile' });
    expect(suggestionsEntree({ logement_statut: 'heberge' }, {}).sans_domicile_stable.valeur).toBe(true);
    expect(suggestionsEntree({ logement_statut: 'locataire_social' }, {}).sans_domicile_stable.valeur).toBe(false);
  });

  it('ne suggère RIEN quand le champ source est absent', () => {
    expect(suggestionsEntree({}, {})).toEqual({});
    expect(suggestionsEntree(null, null)).toEqual({});
  });

  it('exige les DEUX informations pour proposer « foyer monoparental : oui »', () => {
    // Vivre seul·e ne suffit pas : sans enfant à charge, on ne conclut pas.
    expect(suggestionsEntree({ situation_familiale: 'celibataire' }, {}).foyer_monoparental).toBeUndefined();
    const s = suggestionsEntree({ situation_familiale: 'divorce', enfants_a_charge: true }, {});
    expect(s.foyer_monoparental.valeur).toBe(true);
    expect(s.foyer_monoparental.source).toMatch(/enfant/);
    expect(suggestionsEntree({ situation_familiale: 'marie' }, {}).foyer_monoparental.valeur).toBe(false);
  });

  it('propose « RSA » depuis le constat BRSA du dossier administratif, sinon depuis les ressources déclarées', () => {
    expect(suggestionsEntree({}, { brsa: true }).ressources_principales)
      .toEqual({ valeur: 'rsa', source: 'Dossier administratif : bénéficiaire du RSA' });
    const s = suggestionsEntree({ ressources: ['APL', 'ARE'] }, { brsa: false });
    expect(s.ressources_principales.valeur).toBe('are');
    expect(s.ressources_principales.source).toMatch(/ressources déclarées/);
    // Aucune ressource connue du référentiel → silence.
    expect(suggestionsEntree({ ressources: ['APL'] }, {}).ressources_principales).toBeUndefined();
  });

  it('propose « demandeur d’emploi » depuis l’identifiant France Travail', () => {
    const s = suggestionsEntree({}, { france_travail_id: '7612345A' });
    expect(s.statut_avant_entree).toEqual({ valeur: 'demandeur_emploi', source: 'Dossier administratif : identifiant France Travail renseigné' });
  });

  it('ne suggère JAMAIS de durée sans emploi (aucune date de dernier emploi au diagnostic)', () => {
    const s = suggestionsEntree({ logement_statut: 'heberge', situation_familiale: 'celibataire', enfants_a_charge: true }, { brsa: true });
    expect(s.duree_sans_emploi).toBeUndefined();
  });
});

describe('libelleValeur — français pour l’export, vide pour l’absence', () => {
  it('rend le libellé français d’une valeur canonique ou héritée', () => {
    expect(libelleValeur('duree_sans_emploi', '12_24m', FSE_ENTREE_ITEMS)).toBe('12 à 24 mois');
    expect(libelleValeur('duree_sans_emploi', 'moins_6_mois', FSE_ENTREE_ITEMS)).toBe('Moins de 6 mois');
    expect(libelleValeur('foyer_monoparental', false, FSE_ENTREE_ITEMS)).toBe('Non');
  });

  it('rend une CELLULE VIDE pour une absence ou une valeur illisible (jamais un code technique)', () => {
    expect(libelleValeur('statut_avant_entree', null, FSE_ENTREE_ITEMS)).toBe('');
    expect(libelleValeur('statut_avant_entree', 'zzz', FSE_ENTREE_ITEMS)).toBe('');
    expect(libelleValeur('inconnue', 'x', FSE_ENTREE_ITEMS)).toBe('');
  });
});
