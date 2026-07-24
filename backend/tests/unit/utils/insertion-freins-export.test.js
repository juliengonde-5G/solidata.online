// ═══════════════════════════════════════════════════════════════════════════
// UNIT — Export « tableau des freins » 23 colonnes (EXG-25/38, PR 2)
//   backend/src/utils/insertion-freins-export.js
// Ordre STRICT des colonnes du CDC (rapport 01 §5, NOM/Prénom en 2 colonnes),
// variante sensible (frein judiciaire — art. 10), cellules vides EXPLICITES,
// complétude par colonne (REC-UX-14). Aucune dépendance DB.
// ═══════════════════════════════════════════════════════════════════════════
const {
  freinsExportColumns,
  rowToCells,
  computeCompletude,
} = require('../../../src/utils/insertion-freins-export');

describe('freinsExportColumns — ordre du CDC', () => {
  it('sensibles=0 (défaut) : 23 colonnes, SANS « Frein judiciaire », dans l’ordre exact', () => {
    const headers = freinsExportColumns(false).map((c) => c.header);
    expect(headers).toEqual([
      'NOM', 'Prénom', 'Nationalité', "Date d'entrée ACI", 'Fin PASS IAE',
      'Heures par semaine', 'Genre', 'Date de naissance', 'RQTH',
      'Niveau de formation', 'Ressources', 'Logement', 'Commune de résidence',
      'Situation familiale', 'Frein linguistique', 'Frein santé',
      'Frein logement', 'Frein administratif', 'Frein financier',
      'Frein mobilité', 'PMSMP', 'Projet de formation', 'Emploi visé',
    ]);
    expect(headers).toHaveLength(23);
    expect(headers).not.toContain('Frein judiciaire');
  });

  it('sensibles=1 : 24 colonnes, « Frein judiciaire » à sa position CDC (entre financier et mobilité)', () => {
    const headers = freinsExportColumns(true).map((c) => c.header);
    expect(headers).toHaveLength(24);
    const iFin = headers.indexOf('Frein financier');
    const iJud = headers.indexOf('Frein judiciaire');
    const iMob = headers.indexOf('Frein mobilité');
    expect(iJud).toBe(iFin + 1);
    expect(iMob).toBe(iJud + 1);
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

  it('ligne vide → toutes les cellules vides EXPLICITES (EXG-25)', () => {
    const c = rowToCells({}, false);
    for (const col of freinsExportColumns(false)) {
      expect(c[col.key]).toBe('');
    }
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
    expect(comp.colonnes).toHaveLength(23);
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

  it('sensibles=1 → la colonne judiciaire est aussi mesurée (24 colonnes)', () => {
    const rows = [rowToCells({ last_name: 'A', frein_judiciaire: 3 }, true)];
    const comp = computeCompletude(rows, true);
    expect(comp.colonnes).toHaveLength(24);
    const jud = comp.colonnes.find((c) => c.cle === 'frein_judiciaire');
    expect(jud.pct).toBe(100);
  });
});
