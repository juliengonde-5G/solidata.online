// ═══════════════════════════════════════════════════════════════════════════
// UNIT — Export « tableau des freins » (EXG-25/38, PR 2 ; enrichi PR D lot 6)
//   backend/src/utils/insertion-freins-export.js
// Ordre STRICT des 23 colonnes du CDC (rapport 01 §5, NOM/Prénom en 2 colonnes)
// CONSERVÉ TEL QUEL — les colonnes du cadre 2026 viennent APRÈS, jamais
// intercalées : un fichier dont les colonnes se déplacent d'une année sur
// l'autre casse les tableaux croisés de l'instructrice. Variante sensible
// (frein judiciaire — art. 10), cellules vides EXPLICITES, règle d'évolution,
// complétude par colonne (REC-UX-14). Aucune dépendance DB.
// ═══════════════════════════════════════════════════════════════════════════
const {
  freinsExportColumns,
  rowToCells,
  computeCompletude,
  evolutionFrein,
} = require('../../../src/utils/insertion-freins-export');

/** Les 10 colonnes du cadre 2026 (PR D), dans leur ordre dicté. */
const COLONNES_CADRE_2026 = [
  'BRSA', 'Date de constat BRSA', 'Catégorie France Travail',
  "Critères d'éligibilité IAE", 'Statut du Pass IAE', 'Référent unique (type)',
  'Référent unique (nom)', 'Projet cofinancé', 'Prescripteur habilité',
  'Semaines sous 15 h (année)',
];

describe('freinsExportColumns — ordre du CDC', () => {
  it('sensibles=0 (défaut) : les 23 colonnes du CDC EN TÊTE, dans l’ordre exact, SANS « Frein judiciaire »', () => {
    const headers = freinsExportColumns(false).map((c) => c.header);
    // PR D : intitulé de la colonne 5 corrigé (« quotité contractuelle ») à la
    // demande de l'autorité — ce n'est pas l'activité constatée.
    expect(headers.slice(0, 23)).toEqual([
      'NOM', 'Prénom', 'Nationalité', "Date d'entrée ACI", 'Fin PASS IAE',
      'Heures par semaine (quotité contractuelle)', 'Genre', 'Date de naissance', 'RQTH',
      'Niveau de formation', 'Ressources', 'Logement', 'Commune de résidence',
      'Situation familiale', 'Frein linguistique', 'Frein santé',
      'Frein logement', 'Frein administratif', 'Frein financier',
      'Frein mobilité', 'PMSMP', 'Projet de formation', 'Emploi visé',
    ]);
    expect(headers).not.toContain('Frein judiciaire');
    expect(headers).not.toContain('Frein judiciaire — entrée');
    expect(headers).not.toContain('Frein judiciaire — évolution');
  });

  it('PR D : les 10 colonnes du cadre 2026 viennent APRÈS la 23e, jamais intercalées', () => {
    const headers = freinsExportColumns(false).map((c) => c.header);
    expect(headers.slice(23, 33)).toEqual(COLONNES_CADRE_2026);
  });

  it('PR D : chaque axe reçoit « — entrée » et « — évolution » (6 axes hors judiciaire)', () => {
    const headers = freinsExportColumns(false).map((c) => c.header);
    const paires = headers.slice(33);
    expect(paires).toEqual([
      'Frein linguistique — entrée', 'Frein linguistique — évolution',
      'Frein santé — entrée', 'Frein santé — évolution',
      'Frein logement — entrée', 'Frein logement — évolution',
      'Frein administratif — entrée', 'Frein administratif — évolution',
      'Frein financier — entrée', 'Frein financier — évolution',
      'Frein mobilité — entrée', 'Frein mobilité — évolution',
    ]);
    expect(headers).toHaveLength(45);
  });

  it('sensibles=1 : « Frein judiciaire » à sa position CDC (entre financier et mobilité) + ses 2 colonnes d’axe', () => {
    const headers = freinsExportColumns(true).map((c) => c.header);
    expect(headers).toHaveLength(48); // 24 + 10 + 7 axes × 2
    const iFin = headers.indexOf('Frein financier');
    const iJud = headers.indexOf('Frein judiciaire');
    const iMob = headers.indexOf('Frein mobilité');
    expect(iJud).toBe(iFin + 1);
    expect(iMob).toBe(iJud + 1);
    expect(headers).toContain('Frein judiciaire — entrée');
    expect(headers).toContain('Frein judiciaire — évolution');
  });

  it('les axes famille et numérique (hors CDC) n’apparaissent JAMAIS', () => {
    for (const sensibles of [false, true]) {
      const keys = freinsExportColumns(sensibles).map((c) => c.key);
      expect(keys).not.toContain('frein_famille');
      expect(keys).not.toContain('frein_numerique');
    }
  });
});

describe('rowToCells — valorisation des cellules', () => {
  const fullRow = () => ({
    last_name: 'X', first_name: 'Y', nationality: 'Française',
    date_entree_aci: '2025-03-01', pass_iae_end: new Date('2027-01-31'),
    heures_semaine: '28', gender: 'F', birth_date: '1990-01-15',
    rqth: true, disability_status: null,
    niveau_formation: 'niv3', qualification: 'CAP',
    ressources: ['RSA', 'APL'], logement_statut: 'locataire_social',
    city: 'Rouen', situation_familiale: 'celibataire',
    frein_linguistique: 2, frein_sante: 3, frein_logement: 4,
    frein_administratif: null, frein_finances: 1, frein_mobilite: 2,
    frein_judiciaire: 5,
    nb_pmsmp: 2, derniere_pmsmp: '2026-05-12',
    projet_formation: 'CACES 3', emploi_vise: 'Agent de tri', emploi_vise_rome: 'K2304',
  });

  it('mappe chaque colonne depuis sa source documentée', () => {
    const c = rowToCells(fullRow(), false);
    expect(c.nom).toBe('X');
    expect(c.prenom).toBe('Y');
    expect(c.date_entree_aci).toBe('2025-03-01');
    expect(c.fin_pass_iae).toBe('2027-01-31');
    expect(c.heures_semaine).toBe(28);
    expect(c.rqth).toBe('Oui');
    expect(c.niveau_formation).toBe('niv3'); // structuré prioritaire sur qualification
    expect(c.ressources).toBe('RSA, APL');
    expect(c.logement).toBe('locataire_social');
    expect(c.commune).toBe('Rouen');
    expect(c.frein_administratif).toBe(''); // non évalué → vide EXPLICITE
    expect(c.frein_logement).toBe(4);
    expect(c.pmsmp).toBe('2 (dern. 2026-05-12)');
    expect(c.emploi_vise).toBe('Agent de tri — K2304');
    expect('frein_judiciaire' in c).toBe(false); // sensibles=0
  });

  it('sensibles=1 → la cellule frein_judiciaire est présente', () => {
    const c = rowToCells(fullRow(), true);
    expect(c.frein_judiciaire).toBe(5);
  });

  it('RQTH : repli sur le texte disability_status (import paie) quand le booléen structuré est absent', () => {
    expect(rowToCells({ ...fullRow(), rqth: null, disability_status: 'RQTH jusque 2027' }).rqth).toBe('Oui');
    expect(rowToCells({ ...fullRow(), rqth: null, disability_status: '  ' }).rqth).toBe('');
    expect(rowToCells({ ...fullRow(), rqth: false, disability_status: 'RQTH' }).rqth).toBe('Non'); // le structuré prime
  });

  it('ligne vide → toutes les cellules vides EXPLICITES (EXG-25), sauf l’évolution qui vaut « non évalué »', () => {
    const c = rowToCells({}, false);
    for (const col of freinsExportColumns(false)) {
      if (col.key.endsWith('_evolution')) {
        // « non évalué » est l'une des QUATRE valeurs dictées par l'autorité,
        // pas une absence : elle dit qu'il manque une des deux mesures.
        expect(c[col.key]).toBe('non évalué');
      } else {
        expect(c[col.key]).toBe('');
      }
    }
  });

  it('PR D : cadre 2026 — cellule vide quand la donnée manque, jamais un « Non » inventé', () => {
    const c = rowToCells({}, false);
    expect(c.brsa).toBe('');            // NULL ≠ « Non » : le BRSA non constaté n'est pas un non-BRSA
    expect(c.ft_categorie).toBe('');
    expect(c.criteres_eligibilite).toBe('');
    expect(c.pass_iae_statut).toBe(''); // statut 'inconnu' → vide, jamais « Inconnu »
    expect(c.semaines_sous_seuil).toBe(''); // null ≠ 0 semaine sous le plancher
  });

  it('PR D : cadre 2026 — valorisation depuis les sources documentées', () => {
    const c = rowToCells({
      brsa: true, brsa_date_constat: '2026-02-01', ft_categorie: 'G',
      criteres_eligibilite: ['Bénéficiaire du RSA', 'DELD'],
      pass_iae_statut: 'suspendu', referent_unique_type: 'cms', referent_unique_nom: 'Mme L.',
      projets_cofinances: ['ASI-2026-2027'], eligibilite_source: 'prescripteur_habilite',
      semaines_sous_seuil: 3,
    }, false);
    expect(c.brsa).toBe('Oui');
    expect(c.brsa_date_constat).toBe('2026-02-01');
    expect(c.ft_categorie).toBe('G');
    expect(c.criteres_eligibilite).toBe('Bénéficiaire du RSA ; DELD');
    expect(c.pass_iae_statut).toBe('Suspendu');
    expect(c.referent_unique_type).toBe('CMS');
    expect(c.projet_cofinance).toBe('ASI-2026-2027');
    expect(c.prescripteur_habilite).toBe('Oui');
    expect(c.semaines_sous_seuil).toBe(3);
    expect(rowToCells({ brsa: false }, false).brsa).toBe('Non');
  });

  it('PR D : évolution d’un axe — levé / stable / aggravé / non évalué', () => {
    // L'échelle va de 1 (pas de difficulté) à 5 (bloquant) : une BAISSE est une
    // amélioration. C'est la MÊME règle que le bloc 3 de la synthèse.
    expect(evolutionFrein(4, 2)).toBe('levé');
    expect(evolutionFrein(4, 3)).toBe('levé');   // une marche suffit
    expect(evolutionFrein(3, 3)).toBe('stable');
    expect(evolutionFrein(2, 4)).toBe('aggravé');
    expect(evolutionFrein(null, 3)).toBe('non évalué');
    expect(evolutionFrein(3, null)).toBe('non évalué');
    expect(evolutionFrein(null, null)).toBe('non évalué');
    // Jamais « stable » par défaut : une absence de mesure n'est pas un constat.
    expect(evolutionFrein('', '')).toBe('non évalué');
  });

  it("PR D : l'évolution lit le diagnostic et la DERNIÈRE ÉVALUATION, jamais la valeur repliée", () => {
    // CORRECTIF D-02 — `frein_<axe>` est la valeur COURANTE, déjà repliée sur
    // le diagnostic par le `COALESCE(lm, d)` de la requête. La comparer à
    // l'entrée revient à comparer le diagnostic avec lui-même : « stable »
    // toujours. Le second terme est `frein_<axe>_actuel`, la dernière
    // évaluation BRUTE.
    const c = rowToCells({
      frein_mobilite: 2, frein_mobilite_entree: 4, frein_mobilite_actuel: 2,
      frein_sante: 3, frein_sante_entree: 3, frein_sante_actuel: 3,
    }, false);
    expect(c.frein_mobilite_entree).toBe(4);
    expect(c.frein_mobilite_evolution).toBe('levé');
    expect(c.frein_sante_evolution).toBe('stable');
  });

  it("PR D / D-02 : jamais réévaluée → « non évalué », même si la valeur courante existe", () => {
    // Le cas exact du défaut : un diagnostic à 3, AUCUN entretien réalisé. La
    // valeur courante vaut 3 (repli), la dernière évaluation n'existe pas.
    const c = rowToCells({ frein_mobilite: 3, frein_mobilite_entree: 3, frein_mobilite_actuel: null }, false);
    expect(c.frein_mobilite).toBe(3);              // la valeur courante ne bouge pas
    expect(c.frein_mobilite_evolution).toBe('non évalué');
  });

  it('PMSMP sans réalisation → vide ; niveau de formation replie sur qualification', () => {
    const c = rowToCells({ ...fullRow(), nb_pmsmp: 0, derniere_pmsmp: null, niveau_formation: null });
    expect(c.pmsmp).toBe('');
    expect(c.niveau_formation).toBe('CAP');
  });
});

describe('computeCompletude — % de renseigné par colonne (REC-UX-14)', () => {
  it('calcule le pourcentage colonne par colonne sur les lignes préparées', () => {
    const rows = [
      rowToCells({ last_name: 'A', first_name: 'B', frein_sante: 2 }, false),
      rowToCells({ last_name: 'C', first_name: 'D' }, false),
    ];
    const comp = computeCompletude(rows, false);
    expect(comp.total).toBe(2);
    expect(comp.colonnes).toHaveLength(45);
    const byKey = Object.fromEntries(comp.colonnes.map((c) => [c.cle, c]));
    expect(byKey.nom.pct).toBe(100);
    expect(byKey.frein_sante).toEqual(expect.objectContaining({ renseigne: 1, pct: 50 }));
    expect(byKey.nationalite.pct).toBe(0);
    expect(byKey.nom.colonne).toBe('NOM'); // intitulé exact restitué
  });

  it('aucune ligne → pct null (pas de faux 0 %)', () => {
    const comp = computeCompletude([], false);
    expect(comp.total).toBe(0);
    for (const c of comp.colonnes) expect(c.pct).toBeNull();
  });

  it('sensibles=1 → la colonne judiciaire est aussi mesurée (48 colonnes)', () => {
    const rows = [rowToCells({ last_name: 'A', frein_judiciaire: 3 }, true)];
    const comp = computeCompletude(rows, true);
    expect(comp.colonnes).toHaveLength(48);
    const jud = comp.colonnes.find((c) => c.cle === 'frein_judiciaire');
    expect(jud.pct).toBe(100);
  });

  it('PR D : « non évalué » ne compte PAS comme renseigné dans la complétude', () => {
    // Sans cela, la colonne d'évolution afficherait 100 % « renseigné » alors
    // que rien n'est mesurable — l'écran dirait « rien à compléter » là où il
    // faut précisément compléter les diagnostics.
    const rows = [
      rowToCells({ last_name: 'A', frein_mobilite: 2, frein_mobilite_entree: 4, frein_mobilite_actuel: 2 }, false),
      rowToCells({ last_name: 'B' }, false),
    ];
    const comp = computeCompletude(rows, false);
    const evo = comp.colonnes.find((c) => c.cle === 'frein_mobilite_evolution');
    expect(evo).toEqual(expect.objectContaining({ renseigne: 1, pct: 50 }));
  });
});
