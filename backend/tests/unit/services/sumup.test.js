/**
 * Tests des helpers VAK/SumUp.
 * Couvre :
 *  - normalizePaymentMethod : POS/ECOM/marques carte → 'CB', numéraire → 'Espèces'
 *    (le paiement carte sur terminal SumUp `payment_type` = 'POS' doit compter en CB).
 *  - parseFRDate : l'horodatage de l'export SumUp est interprété en GMT/UTC,
 *    indépendamment du fuseau du serveur (évite le décalage ±1-2 h).
 */

const { normalizePaymentMethod, parseFRDate } = require('../../../src/services/sumup');

describe('sumup — normalizePaymentMethod', () => {
  test('POS (carte terminal) → CB', () => {
    expect(normalizePaymentMethod('POS')).toBe('CB');
    expect(normalizePaymentMethod('pos')).toBe('CB');
  });

  test('carte en ligne / marques → CB', () => {
    ['ECOM', 'VISA', 'MASTERCARD', 'Carte bancaire', 'Sans contact', 'CONTACTLESS', 'Maestro', 'AMEX'].forEach((v) => {
      expect(normalizePaymentMethod(v)).toBe('CB');
    });
  });

  test('déjà normalisé CB reste CB', () => {
    expect(normalizePaymentMethod('CB')).toBe('CB');
  });

  test('numéraire → Espèces', () => {
    ['Espèces', 'Especes', 'cash', 'Numéraire', 'liquide'].forEach((v) => {
      expect(normalizePaymentMethod(v)).toBe('Espèces');
    });
  });

  test('libellé inconnu conservé tel quel', () => {
    expect(normalizePaymentMethod('Chèque')).toBe('Chèque');
  });

  test('vide / null → Inconnu', () => {
    expect(normalizePaymentMethod('')).toBe('Inconnu');
    expect(normalizePaymentMethod(null)).toBe('Inconnu');
    expect(normalizePaymentMethod(undefined)).toBe('Inconnu');
  });
});

describe('sumup — parseFRDate (GMT/UTC)', () => {
  test('interprète l\'heure de l\'export comme GMT', () => {
    const d = parseFRDate('15 mai 2026 10:15');
    expect(d.toISOString()).toBe('2026-05-15T10:15:00.000Z');
  });

  test('gère les secondes et les mois abrégés', () => {
    expect(parseFRDate('3 déc. 2026 09:05:30').toISOString()).toBe('2026-12-03T09:05:30.000Z');
    expect(parseFRDate('1 janv. 2027 00:00').toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  test('les champs UTC correspondent au texte (pas de dérive de fuseau)', () => {
    const d = parseFRDate('15 juillet 2026 14:30');
    expect(d.getUTCHours()).toBe(14);
    expect(d.getUTCMinutes()).toBe(30);
    expect(d.getUTCMonth()).toBe(6); // juillet = index 6
    expect(d.getUTCDate()).toBe(15);
  });

  test('chaîne invalide → null', () => {
    expect(parseFRDate('')).toBeNull();
    expect(parseFRDate('pas une date')).toBeNull();
  });
});
