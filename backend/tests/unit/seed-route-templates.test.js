/**
 * Tests des fonctions PURES du seed des modèles de tournées
 * (src/scripts/seed-route-templates.js) — rapprochement par nom normalisé
 * des points de la feuille de collecte avec le référentiel CAV.
 */
const { normalizeCavName, matchModeles, routeDescription } = require('../../src/scripts/seed-route-templates');

describe('normalizeCavName', () => {
  test('casse, accents et ponctuation neutralisés', () => {
    expect(normalizeCavName('DARNÉTAL - 98 Rue Sadi Carnot (Face à la Mairie)'))
      .toBe('darnetal 98 rue sadi carnot face a la mairie');
  });

  test('tirets ≡ espaces (FONTAINE-LE-BOURG = FONTAINE LE BOURG)', () => {
    expect(normalizeCavName('FONTAINE-LE-BOURG - 318 rue Delamare Deboutteville'))
      .toBe(normalizeCavName('FONTAINE LE BOURG - 318 rue Delamare Deboutteville'));
  });

  test('espace insécable et apostrophe typographique ramenés aux formes simples', () => {
    expect(normalizeCavName('LA NEUVILLE-CHANT-D’OISEL'))
      .toBe(normalizeCavName("LA NEUVILLE-CHANT-D'OISEL"));
  });

  test('parenthèses doublées et espaces multiples repliés', () => {
    expect(normalizeCavName('FONTAINE LE BOURG - Sente aux Mulets ((Impasse))'))
      .toBe('fontaine le bourg sente aux mulets impasse');
  });

  test('null / undefined → chaîne vide', () => {
    expect(normalizeCavName(null)).toBe('');
    expect(normalizeCavName(undefined)).toBe('');
  });
});

describe('matchModeles', () => {
  const REF = [
    { id: 1, name: 'ROUEN - 19 rue du Général Giraud' },
    { id: 2, name: 'DARNÉTAL - 98 Rue Sadi Carnot (Face à la Mairie)' },
    { id: 3, name: 'FONTAINE LE BOURG - 318 rue Delamare Deboutteville' },
    // Doublon volontaire (même nom normalisé, deux lignes) → ambigu
    { id: 4, name: 'ELBEUF - 26 Rue Leveillé' },
    { id: 5, name: 'ELBEUF - 26 rue Leveille' },
  ];

  test('rapprochement exact et par variantes (accents, tirets), ordre préservé', () => {
    const [m] = matchModeles([{
      name: 'Test', jour: 'Lundi',
      points: [
        { cav_name: 'DARNETAL - 98 rue sadi carnot (face a la mairie)' },
        { cav_name: 'ROUEN - 19 rue du Général Giraud' },
      ],
    }], REF);
    expect(m.points.map((p) => p.cav_id)).toEqual([2, 1]);
    expect(m.nonRapproches).toEqual([]);
  });

  test('libellé inconnu → signalé, jamais inventé', () => {
    const [m] = matchModeles([{
      name: 'Test', jour: null,
      points: [{ cav_name: 'ROUEN - 999 rue Imaginaire' }],
    }], REF);
    expect(m.points).toEqual([]);
    expect(m.nonRapproches).toHaveLength(1);
    expect(m.nonRapproches[0].label).toBe('ROUEN - 999 rue Imaginaire');
    expect(m.nonRapproches[0].raison).toMatch(/aucun CAV/);
  });

  test('nom porté par plusieurs CAV → ambigu, non rapproché (pas de choix au hasard)', () => {
    const [m] = matchModeles([{
      name: 'Test', jour: null,
      points: [{ cav_name: 'ELBEUF - 26 Rue Leveillé' }],
    }], REF);
    expect(m.points).toEqual([]);
    expect(m.nonRapproches[0].raison).toMatch(/2 CAV/);
  });

  test('doublon intra-modèle dédoublonné (UNIQUE(route_id, cav_id))', () => {
    const [m] = matchModeles([{
      name: 'Test', jour: null,
      points: [
        { cav_name: 'ROUEN - 19 rue du Général Giraud' },
        { cav_name: 'ROUEN - 19 rue du General Giraud' },
      ],
    }], REF);
    expect(m.points.map((p) => p.cav_id)).toEqual([1]);
  });
});

describe('routeDescription', () => {
  test('jour conservé dans la description', () => {
    expect(routeDescription('Lundi')).toBe('Tournée du lundi — feuille de collecte (import du 21/08/2026)');
  });
  test('sans jour connu', () => {
    expect(routeDescription(null)).toBe('Tournée — feuille de collecte (import du 21/08/2026)');
  });
});

describe('données versionnées modeles-tournees.json', () => {
  const data = require('../../src/data/modeles-tournees.json');

  test('19 modèles, 307 points, noms et jours renseignés', () => {
    expect(data.modeles).toHaveLength(19);
    const total = data.modeles.reduce((n, m) => n + m.points.length, 0);
    expect(total).toBe(307);
    for (const m of data.modeles) {
      expect(m.name).toBeTruthy();
      expect(['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi']).toContain(m.jour);
      expect(m.points.length).toBeGreaterThan(0);
      for (const p of m.points) expect(p.cav_name).toBeTruthy();
    }
  });

  test('aucun doublon de point (normalisé) dans un même modèle', () => {
    for (const m of data.modeles) {
      const norms = m.points.map((p) => normalizeCavName(p.cav_name));
      expect(new Set(norms).size).toBe(norms.length);
    }
  });

  test('les 4 rapprochements arbitrés portent leur libellé source', () => {
    const aliased = data.modeles.flatMap((m) => m.points).filter((p) => p.source_label);
    expect(aliased.length).toBeGreaterThanOrEqual(4);
    const targets = aliased.map((p) => p.cav_name);
    expect(targets).toContain('ROUEN - 229 Rue Saint Julien (Angle rue Parmentier)');
    expect(targets).toContain('FONTAINE LE BOURG - 318 rue Delamare Deboutteville');
    expect(targets).toContain("LA NEUVILLE-CHANT-D'OISEL - Rue du Froc aux Moines (Stade de Foot)");
    expect(targets).toContain('LE GRAND-QUEVILLY - 41 Avenue J. F. Kennedy');
  });
});
