// ═══════════════════════════════════════════════════════════════════════════
// UNIT — Règles PMSMP (EXG-05, PR 2) : bornes réglementaires PURES
//   backend/src/routes/insertion/pmsmp-rules.js
// Durée inclusive d'une convention (≤ 31 j) et cumul sur 12 mois glissants
// (≤ 60 j, assiette prudente + jours déclarés hors ERP — réserve RES-07).
// Aucune dépendance DB.
// ═══════════════════════════════════════════════════════════════════════════
const {
  PMSMP_MAX_JOURS_CONVENTION,
  PMSMP_MAX_CUMUL_12M,
  pmsmpDays,
  computeCumul12MoisGlissants,
} = require('../../../src/routes/insertion/pmsmp-rules');

describe('pmsmpDays — jours calendaires INCLUSIFS', () => {
  it('début = fin → 1 jour', () => {
    expect(pmsmpDays('2026-07-01', '2026-07-01')).toBe(1);
  });

  it('1er → 31 du même mois → 31 jours (borne exacte du plafond convention)', () => {
    expect(pmsmpDays('2026-07-01', '2026-07-31')).toBe(31);
    expect(PMSMP_MAX_JOURS_CONVENTION).toBe(31);
  });

  it('1er juillet → 1er août → 32 jours (> plafond)', () => {
    expect(pmsmpDays('2026-07-01', '2026-08-01')).toBe(32);
  });

  it('fin < début → null ; dates invalides → null', () => {
    expect(pmsmpDays('2026-07-10', '2026-07-01')).toBeNull();
    expect(pmsmpDays('n/a', '2026-07-01')).toBeNull();
    expect(pmsmpDays(null, '2026-07-01')).toBeNull();
  });

  it('accepte les objets Date (normalisation UTC)', () => {
    expect(pmsmpDays(new Date('2026-07-01T23:00:00Z'), new Date('2026-07-03T01:00:00Z'))).toBe(3);
  });
});

describe('computeCumul12MoisGlissants — fenêtre de 12 mois se terminant à la fin de la période', () => {
  it('période seule sous le plafond → pas de dépassement', () => {
    const c = computeCumul12MoisGlissants({ date_debut: '2026-07-01', date_fin: '2026-07-20' }, []);
    expect(c.jours_nouvelle).toBe(20);
    expect(c.jours_enregistres).toBe(0);
    expect(c.total).toBe(20);
    expect(c.plafond).toBe(PMSMP_MAX_CUMUL_12M);
    expect(c.depassement).toBe(false);
    expect(c.fenetre_au).toBe('2026-07-20');
    expect(c.fenetre_du).toBe('2025-07-21'); // 12 mois glissants inclusifs
  });

  it('cumul avec des PMSMP enregistrées dans la fenêtre → dépassement au-delà de 60 j', () => {
    const existantes = [
      { date_debut: '2026-01-05', date_fin: '2026-02-18' }, // 45 jours
    ];
    const c = computeCumul12MoisGlissants({ date_debut: '2026-07-01', date_fin: '2026-07-20' }, existantes);
    expect(c.jours_enregistres).toBe(45);
    expect(c.total).toBe(65);
    expect(c.depassement).toBe(true);
  });

  it('une PMSMP ENTIÈREMENT hors fenêtre (13 mois avant) ne compte pas', () => {
    const existantes = [
      { date_debut: '2025-05-01', date_fin: '2025-06-10' }, // se termine avant fenetre_du (2025-07-21)
    ];
    const c = computeCumul12MoisGlissants({ date_debut: '2026-07-01', date_fin: '2026-07-20' }, existantes);
    expect(c.jours_enregistres).toBe(0);
    expect(c.depassement).toBe(false);
  });

  it('une PMSMP À CHEVAL sur la fenêtre est comptée au prorata (intersection)', () => {
    // Fenêtre : 2025-07-21 → 2026-07-20. Période 2025-07-10 → 2025-07-30 :
    // seuls les jours 21→30 juillet 2025 comptent (10 jours).
    const existantes = [{ date_debut: '2025-07-10', date_fin: '2025-07-30' }];
    const c = computeCumul12MoisGlissants({ date_debut: '2026-07-01', date_fin: '2026-07-20' }, existantes);
    expect(c.jours_enregistres).toBe(10);
  });

  it('les jours déclarés hors ERP (autres_jours_connus — réserve auditeur) entrent dans le total', () => {
    const c = computeCumul12MoisGlissants(
      { date_debut: '2026-07-01', date_fin: '2026-07-20' }, [], 45
    );
    expect(c.autres_jours_connus).toBe(45);
    expect(c.total).toBe(65);
    expect(c.depassement).toBe(true);
  });

  it('autres_jours_connus négatif ou non numérique → ignoré (0)', () => {
    expect(computeCumul12MoisGlissants({ date_debut: '2026-07-01', date_fin: '2026-07-02' }, [], -5).autres_jours_connus).toBe(0);
    expect(computeCumul12MoisGlissants({ date_debut: '2026-07-01', date_fin: '2026-07-02' }, [], 'n/a').autres_jours_connus).toBe(0);
  });

  it('exactement 60 jours → PAS de dépassement (plafond inclusif), 61 → dépassement', () => {
    const ok = computeCumul12MoisGlissants(
      { date_debut: '2026-07-01', date_fin: '2026-07-30' }, // 30 j
      [{ date_debut: '2026-03-01', date_fin: '2026-03-30' }] // 30 j
    );
    expect(ok.total).toBe(60);
    expect(ok.depassement).toBe(false);

    const ko = computeCumul12MoisGlissants(
      { date_debut: '2026-07-01', date_fin: '2026-07-31' }, // 31 j
      [{ date_debut: '2026-03-01', date_fin: '2026-03-30' }]
    );
    expect(ko.total).toBe(61);
    expect(ko.depassement).toBe(true);
  });

  it('période de référence inexploitable → null ; existantes invalides ignorées', () => {
    expect(computeCumul12MoisGlissants({ date_debut: 'x', date_fin: '2026-07-01' }, [])).toBeNull();
    expect(computeCumul12MoisGlissants(null, [])).toBeNull();
    const c = computeCumul12MoisGlissants(
      { date_debut: '2026-07-01', date_fin: '2026-07-05' },
      [{ date_debut: '2026-06-10', date_fin: '2026-06-01' }, null] // fin < début + null
    );
    expect(c.jours_enregistres).toBe(0);
  });
});
