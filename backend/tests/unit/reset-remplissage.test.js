/**
 * Jalon de remise à zéro du remplissage des CAV (fonctions PURES).
 * Doctrine : on ne détruit aucun tonnage — on décale la référence de calcul.
 */
const { effectiveLastCollection } = require('../../src/utils/fill-factors');
const { parseArgs } = require('../../src/scripts/reset-remplissage-cav');
const purge = require('../../src/scripts/purge-tournees-realisees');

describe('effectiveLastCollection', () => {
  const jalon = new Date('2026-08-21T00:00:00Z');

  test('une collecte ANTÉRIEURE au jalon est ignorée : le CAV repart de zéro', () => {
    expect(effectiveLastCollection('2026-06-01', jalon).toISOString()).toBe(jalon.toISOString());
  });

  test('une collecte POSTÉRIEURE au jalon fait foi (le réel prime)', () => {
    expect(effectiveLastCollection('2026-08-25', jalon).toISOString().slice(0, 10)).toBe('2026-08-25');
  });

  test('un CAV sans historique part du jalon', () => {
    expect(effectiveLastCollection(null, jalon).toISOString()).toBe(jalon.toISOString());
  });

  test('sans jalon, le comportement historique est INCHANGÉ', () => {
    expect(effectiveLastCollection('2026-06-01', null).toISOString().slice(0, 10)).toBe('2026-06-01');
    expect(effectiveLastCollection(null, null)).toBeNull();
  });

  test('une date invalide est traitée comme absente (jamais de NaN propagé)', () => {
    expect(effectiveLastCollection('pas-une-date', jalon).toISOString()).toBe(jalon.toISOString());
    expect(effectiveLastCollection('pas-une-date', null)).toBeNull();
  });
});

describe('reset-remplissage-cav — arguments', () => {
  test('simulation par défaut', () => {
    expect(parseArgs([])).toEqual({ apply: false, annuler: false, date: null });
  });
  test('date explicite et annulation', () => {
    expect(parseArgs(['--date=2026-09-01', '--apply'])).toEqual({ apply: true, annuler: false, date: '2026-09-01' });
    expect(parseArgs(['--annuler', '--apply']).annuler).toBe(true);
  });
  test('une date mal formée LÈVE (jamais de remise à zéro sur un filtre mal compris)', () => {
    expect(() => parseArgs(['--date=01/09/2026'])).toThrow(/YYYY-MM-DD/);
    expect(() => parseArgs(['--date=2026-13-45'])).toThrow(/YYYY-MM-DD/);
  });
});

describe('purge des tournées — périmètre', () => {
  test('par défaut : uniquement les réalisées', () => {
    expect(purge.buildWhere({}).sql).toBe("status = 'completed'");
  });

  test('--planifiees : ajoute les planifiées PASSÉES et JAMAIS démarrées', () => {
    const sql = purge.buildWhere({ planifiees: true }).sql;
    expect(sql).toMatch(/status = 'planned'/);
    expect(sql).toMatch(/started_at IS NULL/);
    // Garde essentielle : le jour même et les jours à venir sont préservés.
    expect(sql).toMatch(/date < \(CURRENT_TIMESTAMP AT TIME ZONE 'Europe\/Paris'\)::date/);
  });

  test('--annulees ajoute les annulées, le filtre de date se cumule', () => {
    const w = purge.buildWhere({ planifiees: true, annulees: true, avant: '2026-08-01' });
    expect(w.sql).toMatch(/status = 'cancelled'/);
    expect(w.sql).toMatch(/AND date < \$1$/);
    expect(w.params).toEqual(['2026-08-01']);
  });

  test('les tournées EN COURS ne sont jamais ciblées', () => {
    const sql = purge.buildWhere({ planifiees: true, annulees: true }).sql;
    expect(sql).not.toMatch(/in_progress|returning|paused/);
  });
});
