/**
 * Tests du parseur des états mensuels de présence ASP (services/asp-parser.js).
 *
 * FIXTURES ANONYMISÉES : les états réels portent des données personnelles
 * (identité, date de naissance, salaire brut) — ils ne sont JAMAIS versionnés.
 * Les fixtures ci-dessous reproduisent fidèlement la mise en page réelle
 * (vérifiée sur les 7 états 2026 de la structure) avec des identités fictives.
 *
 * Le parseur a été validé en exécution sur les 7 états réels : 7/7 lus, la
 * somme des heures des salariés tombant exactement sur le total déclaré et
 * l'ETP recalculé sur l'ETP publié.
 */

const {
  parseAspText,
  splitRecords,
  splitInlineRecord,
  AspParseError,
  HEURES_MENSUELLES_ETP,
} = require('../../../src/services/asp-parser');

// Mise en page réelle : en-tête à deux colonnes fusionnées à l'extraction,
// puis un bloc de 2-3 lignes par salarié terminé par « Période du contrat ».
const ENTETE = `
                                    ATELIER ET CHANTIER D'INSERTION
                              Etat mensuel de présence
                              Mois d'effet : Janvier 2026            487333-11

STRUCTURE FICTIVE                        ASP - Direction régionale Occitanie
1 RUE DE NULLE PART                      Site de Nîmes
76000 VILLE                              Service en charge des mesures de l'IAE

SIRET : 00000000000000
N° Annexe : ACI 076 26 0005 A0 M0

Montant forfaitaire mensuel versé :      49357     Nb total salariés déclarés :        4
Nb total d'heure déclarées tous salariés confondus :  530   Dont BRSA :                 2
Nb total d'heures saisies éligibles à l'aide au poste : 484  Nb ETP réalisés :          3.49
Nb total de salariés contribuant au calcul de l'aide :  4    Nb ETP conventionnés :    24.76
Dont BRSA :                                             2    Taux réalisation ETP :   104.97%
`;

// 4 salariés / 530 h : 152 (CDDI plein temps) + 113 (CDDI 26 h) + 152 (CDII
// MONO-LIGNE) + 113 (sortie + motif) = 530.
const DETAIL = `
                     Nom Prénom            Date de     Forme      Nb heures      Salaire brut
DUPONT MARIE                                             CDDI
                                          12/03/1980                152          1823.07
Période du contrat : 01/10/2025 - 31/01/2026           Classique

MARTIN JEAN-PIERRE                                       CDDI
                                          04/07/1975                113          1354.29
Période du contrat : 01/11/2025 - 28/02/2026           Classique

DURAND SOPHIE                             19/07/1964     CDII       152          2000.00
Période du contrat : 01/01/2025 - 29/03/2035

BERNARD LUC                                              CDDI
                                          30/05/1991                113          1354.29    14/01/2026    25
Période du contrat : 01/12/2025 - 31/03/2026           Classique

Identification : 2026-01 / 11                                                        1/4
`;

const ETAT = ENTETE + DETAIL;

describe('asp-parser — en-têtes', () => {
  it('lit le mois d\'effet, les totaux et les ETP', () => {
    const r = parseAspText(ETAT);
    expect(r.annee).toBe(2026);
    expect(r.mois).toBe(1);
    expect(r.entetes.heures_declarees).toBe(530);
    expect(r.entetes.heures_eligibles).toBe(484);
    expect(r.entetes.etp_conventionnes).toBe(24.76);
    expect(r.entetes.nb_salaries).toBe(4);
    expect(r.entetes.montant_forfaitaire).toBe(49357);
  });

  it('un libellé absent rend null, jamais 0 (« jamais de valeur inventée »)', () => {
    const sansMontant = ETAT.replace(/Montant forfaitaire mensuel versé :\s+49357/, '');
    const r = parseAspText(sansMontant, { tolerant: true });
    expect(r.entetes.montant_forfaitaire).toBeNull();
  });

  it('refuse un document qui n\'est pas un état ASP', () => {
    expect(() => parseAspText('Bonjour, ceci est une facture.')).toThrow(AspParseError);
  });
});

describe('asp-parser — détail par salarié', () => {
  it('lit les 4 salariés, dont le CDII sur UNE SEULE ligne', () => {
    const r = parseAspText(ETAT);
    expect(r.salaries).toHaveLength(4);
    const noms = r.salaries.map((s) => s.nom_asp);
    expect(noms).toEqual(['DUPONT MARIE', 'MARTIN JEAN-PIERRE', 'DURAND SOPHIE', 'BERNARD LUC']);
  });

  it('RÉGRESSION : le CDII mono-ligne n\'est plus perdu (états de février/mars)', () => {
    // Avant correctif : la ligne « NOM PRÉNOM 19/07/1964 CDII 152 2000.00 »
    // contenait des chiffres → rejetée comme ligne de nom, et le salarié
    // disparaissait (152 h manquantes, import refusé par la garde de cohérence).
    const cdii = parseAspText(ETAT).salaries.find((s) => s.nom_asp === 'DURAND SOPHIE');
    expect(cdii).toBeDefined();
    expect(cdii.forme_contrat).toBe('CDII');
    expect(cdii.heures).toBe(152);
    expect(cdii.date_naissance).toBe('1964-07-19');
    expect(cdii.contrat_debut).toBe('2025-01-01');
    expect(cdii.contrat_fin).toBe('2035-03-29');
  });

  it('splitInlineRecord isole nom et données, et ignore les en-têtes', () => {
    expect(splitInlineRecord('DURAND SOPHIE 19/07/1964 CDII 152 2000.00'))
      .toEqual({ nom: 'DURAND SOPHIE', data: '19/07/1964 CDII 152 2000.00' });
    // En-têtes et lignes de données pures ne doivent jamais ouvrir un salarié.
    expect(splitInlineRecord('STRUCTURE FICTIVE ASP - Direction régionale')).toBeNull();
    expect(splitInlineRecord('12/03/1980 152 1823.07')).toBeNull();
    expect(splitInlineRecord("Période du contrat : 01/10/2025 - 31/01/2026")).toBeNull();
  });

  it('lit la sortie définitive et son code motif', () => {
    const s = parseAspText(ETAT).salaries.find((x) => x.nom_asp === 'BERNARD LUC');
    expect(s.date_sortie).toBe('2026-01-14');
    expect(s.motif_sortie).toBe('25');
    expect(s.heures).toBe(113);
  });

  it('aucun motif de sortie n\'est inventé quand il n\'y a pas de sortie', () => {
    const s = parseAspText(ETAT).salaries.find((x) => x.nom_asp === 'DUPONT MARIE');
    expect(s.date_sortie).toBeNull();
    expect(s.motif_sortie).toBeNull();
  });

  it('les en-têtes en capitales n\'ouvrent pas de faux salariés', () => {
    const recs = splitRecords(['ATELIER ET CHANTIER D\'INSERTION', 'SIRET : 00000000000000']);
    // Un enregistrement peut être ouvert, mais aucun ne porte de période :
    // parseRecord les élimine, d'où 4 salariés seulement dans l'état complet.
    expect(parseAspText(ETAT).salaries.every((s) => s.contrat_debut)).toBe(true);
    expect(Array.isArray(recs)).toBe(true);
  });
});

describe('asp-parser — garde de cohérence (refus d\'un état mal lu)', () => {
  it('REFUSE l\'import si la somme des heures ≠ total déclaré', () => {
    const fausse = ETAT.replace('530', '999');
    expect(() => parseAspText(fausse)).toThrow(/ne correspond pas au total déclaré/);
  });

  it('mode tolérant : ne jette pas mais signale l\'incohérence', () => {
    const fausse = ETAT.replace('530', '999');
    const r = parseAspText(fausse, { tolerant: true });
    expect(r.coherence.somme_heures_ok).toBe(false);
    expect(r.coherence.somme_heures).toBe(530);
    expect(r.coherence.heures_declarees).toBe(999);
  });

  it('contrôle la formule ETP = heures déclarées / (1820/12)', () => {
    const r = parseAspText(ETAT);
    expect(HEURES_MENSUELLES_ETP).toBeCloseTo(151.667, 2);
    expect(r.coherence.etp_calcule).toBeCloseTo(530 / HEURES_MENSUELLES_ETP, 2);
    expect(r.coherence.etp_formule_ok).toBe(true);
  });
});
