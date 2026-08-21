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
    expect(parseArgs([])).toEqual({ apply: false, annuler: false, purger: false, date: null });
  });
  test('date explicite et annulation', () => {
    expect(parseArgs(['--date=2026-09-01', '--apply'])).toEqual({ apply: true, annuler: false, purger: false, date: '2026-09-01' });
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

describe('purge de tout ce qui précède aujourd’hui (--anterieures)', () => {
  const purge = require('../../src/scripts/purge-tournees-realisees');
  const JOUR_PARIS = /date < \(CURRENT_TIMESTAMP AT TIME ZONE 'Europe\/Paris'\)::date/;

  test('le drapeau est reconnu et n’est JAMAIS actif par défaut', () => {
    expect(purge.parseArgs([]).anterieures).toBe(false);
    expect(purge.parseArgs(['--anterieures']).anterieures).toBe(true);
    // Sans --apply, aucune suppression : la simulation reste la porte d'entrée.
    expect(purge.parseArgs(['--anterieures']).apply).toBe(false);
  });

  test('le filtre ne retient QUE la date, sans condition de statut', () => {
    const w = purge.buildWhere({ anterieures: true });
    expect(w.sql).toMatch(JOUR_PARIS);
    // Aucun statut n'est nommé : tout ce qui précède aujourd'hui est emporté,
    // y compris une tournée restée « en cours » d'un jour passé.
    expect(w.sql).not.toMatch(/status/);
    expect(w.params).toEqual([]);
  });

  test('le jour même et les jours à venir restent hors périmètre', () => {
    // La comparaison est STRICTEMENT « < aujourd'hui » : jamais `<=`, jamais
    // `>`. C'est la seule garde qui protège le travail en cours et le planning.
    const sql = purge.buildWhere({ anterieures: true }).sql;
    expect(sql).toMatch(/date < /);
    expect(sql).not.toMatch(/date <= /);
  });

  test('--anterieures prime sur --planifiees / --annulees (il les englobe)', () => {
    const seul = purge.buildWhere({ anterieures: true }).sql;
    const cumule = purge.buildWhere({ anterieures: true, planifiees: true, annulees: true }).sql;
    expect(cumule).toBe(seul);
  });

  test('le filtre --avant se cumule et reste paramétré', () => {
    const w = purge.buildWhere({ anterieures: true, avant: '2026-08-01' });
    expect(w.sql).toMatch(/AND date < \$1$/);
    expect(w.params).toEqual(['2026-08-01']);
  });

  test('sans le drapeau, le périmètre historique est inchangé (non-régression)', () => {
    expect(purge.buildWhere({}).sql).toBe("status = 'completed'");
  });
});

describe('purge de l’historique (--purger-historique)', () => {
  const { parseArgs, TABLES_HISTORIQUE } = require('../../src/scripts/reset-remplissage-cav');

  test('le drapeau est reconnu et n’est JAMAIS actif par défaut', () => {
    expect(parseArgs([]).purger).toBe(false);
    expect(parseArgs(['--purger-historique']).purger).toBe(true);
    // Sans --apply, aucune suppression : la simulation reste la porte d’entrée.
    expect(parseArgs(['--purger-historique']).apply).toBe(false);
  });

  test('le périmètre couvre l’historique de collecte ET d’apprentissage', () => {
    const tables = TABLES_HISTORIQUE.map(([t]) => t);
    expect(tables).toEqual(expect.arrayContaining([
      'tonnage_history', 'collection_learning_feedback', 'ml_fill_predictions',
      'predictive_weather_factors', 'cav_collection_times',
    ]));
  });

  test('n’efface NI le stock, NI les tournées, NI les fiches CAV', () => {
    const tables = TABLES_HISTORIQUE.map(([t]) => t);
    for (const interdite of ['stock_movements', 'stock_original_movements', 'tours', 'cav', 'incidents']) {
      expect(tables).not.toContain(interdite);
    }
  });

  test('chaque table est décrite en clair pour le récapitulatif', () => {
    for (const [table, libelle] of TABLES_HISTORIQUE) {
      expect(typeof table).toBe('string');
      expect(libelle.length).toBeGreaterThan(5);
    }
  });
});

describe('poids d’un conteneur plein à 100 % (paramétrable)', () => {
  const f = require('../../src/utils/fill-factors');

  test('un PAV à plusieurs conteneurs cumule leur capacité', () => {
    expect(f.getCapacityKg(6)).toBe(6 * f.CAPACITY_KG_PER_CONTAINER);
    expect(f.getCapacityKg(1)).toBe(f.CAPACITY_KG_PER_CONTAINER);
  });

  test('la capacité unitaire paramétrée remplace le défaut', () => {
    expect(f.getCapacityKg(6, 200)).toBe(1200);
    expect(f.resolveCapacityKg({ capacityKgPerContainer: 180 })).toBe(180);
  });

  test('une saisie aberrante retombe sur le défaut (jamais de moteur faussé)', () => {
    expect(f.resolveCapacityKg({ capacityKgPerContainer: 5 })).toBe(f.CAPACITY_KG_PER_CONTAINER);
    expect(f.resolveCapacityKg({ capacityKgPerContainer: 99999 })).toBe(f.CAPACITY_KG_PER_CONTAINER);
    expect(f.resolveCapacityKg({ capacityKgPerContainer: 'beaucoup' })).toBe(f.CAPACITY_KG_PER_CONTAINER);
    expect(f.resolveCapacityKg({})).toBe(f.CAPACITY_KG_PER_CONTAINER);
  });

  test('à capacité doublée, le même tonnage remplit deux fois moins', () => {
    const base = { daysSinceCollection: 10, avgWeightKg: 150, avgDaysBetween: 10, nbContainers: 1 };
    const a = f.computeBaseFillPercent({ ...base });
    const b = f.computeBaseFillPercent({ ...base, capacityKgPerContainer: 300 });
    expect(Math.round(a)).toBe(100);
    expect(Math.round(b)).toBe(50);
  });
});
