// ═══════════════════════════════════════════════════════════════════════════
// ÉCHELLE DE POSITIONS UNIFIÉE — tournées ASSOCIATION
// ───────────────────────────────────────────────────────────────────────────
// Défaut PROUVÉ sur PostgreSQL réel le 26/08/2026 : les fonctions de position
// d'`arrets.js` ne lisaient que `tour_cav` et `tour_arret_technique`. Sur une
// tournée d'associations, dont les points vivent dans `tour_association_point`,
// le programme résultant était :
//
//     position 1 : Départ du centre de tri      ← collision
//     position 1 : 1er point association        ← collision
//     position 2 : Retour au centre — fin       ← devant presque tous les points
//     positions 2,3,4 : les points restants
//
// Le mobile fusionnant les listes `arrets` et `cavs` par numéro de position,
// l'ordre affiché au chauffeur était faux. Cette suite rejoue le scénario SANS
// base : une petite base simulée porte les trois tables et interprète les
// requêtes réellement émises, de sorte qu'une régression qui « oublierait » à
// nouveau la table des points association échoue ici, immédiatement.
// ═══════════════════════════════════════════════════════════════════════════

jest.mock('../../src/config/database', () => ({ query: jest.fn(), connect: jest.fn() }));
jest.mock('../../src/routes/tours/impact', () => ({ estimerProgramme: jest.fn() }));

const { estimerProgramme } = require('../../src/routes/tours/impact');
const {
  assurerPassagesCentre, poserRetoursAutomatiques, avancerRetourCentre, LIBELLE_MOTIF,
} = require('../../src/routes/tours/arrets');
const {
  parseArgs, buildQuery, motifExclusion,
} = require('../../src/scripts/rattraper-tonnage-associations');

const TOUR = 900;

/**
 * Base simulée portant les TROIS tables du programme. Elle n'interprète que les
 * requêtes réellement émises par `arrets.js` — c'est volontaire : ce test
 * vérifie l'ordre produit, pas un moteur SQL.
 */
function baseSimulee({ cavs = [], associations = [], arrets = [] } = {}) {
  let seq = 5000;
  const tables = {
    tour_cav: cavs.map((r, i) => ({ id: 1000 + i, tour_id: TOUR, status: 'pending', ...r })),
    tour_association_point: associations.map((r, i) => ({ id: 2000 + i, tour_id: TOUR, status: 'pending', ...r })),
    tour_arret_technique: arrets.map((r, i) => ({ id: 3000 + i, tour_id: TOUR, status: 'pending', motif: 'technique', ...r })),
  };
  const toutes = () => [
    ...tables.tour_cav.map((r) => ({ ...r, table: 'tour_cav' })),
    ...tables.tour_association_point.map((r) => ({ ...r, table: 'tour_association_point' })),
    ...tables.tour_arret_technique.map((r) => ({ ...r, table: 'tour_arret_technique' })),
  ];
  const TRAITE = ['collected', 'skipped', 'incident'];

  /**
   * Lignes visibles d'une requête : SEULES les tables qu'elle nomme réellement.
   * C'est le cœur de la contre-épreuve — une requête de position qui « oublie »
   * `tour_association_point` ne verra pas ces points, exactement comme en base.
   */
  const vues = (t) => toutes().filter((r) => t.includes(r.table));

  const query = jest.fn(async (texte, params = []) => {
    const t = String(texte).replace(/\s+/g, ' ').trim();

    if (/FROM lieux_techniques/.test(t)) {
      return { rows: [{ id: 7, nom: 'Centre de tri', adresse: null, latitude: 49.42, longitude: 1.09, duree_min: 20 }] };
    }
    if (/motif = ANY/.test(t)) {
      const motifs = params[1];
      return { rows: tables.tour_arret_technique.filter((a) => motifs.includes(a.motif)).slice(0, 1).map(() => ({ un: 1 })) };
    }
    if (/AS suivante/.test(t)) {
      const max = vues(t).reduce((m, r) => Math.max(m, r.position), 0);
      return { rows: [{ suivante: max + 1 }] };
    }
    if (/AS derniere/.test(t)) {
      const traites = vues(t).filter((r) => (r.table === 'tour_arret_technique'
        ? ['done', 'skipped'].includes(r.status)
        : TRAITE.includes(r.status)));
      return { rows: [{ derniere: traites.reduce((m, r) => Math.max(m, r.position), 0) }] };
    }
    // Garde « tournée entamée » : ne voit que les tables qu'elle interroge.
    if (/^SELECT 1 FROM tour_cav/.test(t)) {
      const entamee = vues(t).some((r) => r.table !== 'tour_arret_technique' && TRAITE.includes(r.status));
      return { rows: entamee ? [{ un: 1 }] : [] };
    }
    if (/SELECT id, position FROM tour_arret_technique WHERE tour_id = \$1 AND motif = \$2/.test(t)) {
      const trouve = tables.tour_arret_technique
        .filter((a) => a.motif === params[1] && a.status === 'pending')
        .sort((a, b) => a.position - b.position)[0];
      return { rows: trouve ? [{ id: trouve.id, position: trouve.position }] : [] };
    }
    if (/^UPDATE (\w+) SET position = position \+ 1 WHERE tour_id = \$1 AND position >= \$2/.test(t)) {
      const table = t.match(/^UPDATE (\w+)/)[1];
      tables[table].forEach((r) => { if (r.position >= params[1]) r.position += 1; });
      return { rows: [] };
    }
    if (/^UPDATE (\w+) SET position = position \+ 1 WHERE tour_id = \$1$/.test(t)) {
      const table = t.match(/^UPDATE (\w+)/)[1];
      tables[table].forEach((r) => { r.position += 1; });
      return { rows: [] };
    }
    if (/^UPDATE (\w+) SET position = position - 1 WHERE tour_id = \$1 AND position > \$2/.test(t)) {
      const table = t.match(/^UPDATE (\w+)/)[1];
      const sauf = params[2];
      tables[table].forEach((r) => {
        if (r.position > params[1] && (sauf == null || r.id !== sauf)) r.position -= 1;
      });
      return { rows: [] };
    }
    if (/^UPDATE tour_arret_technique SET position = -1 WHERE id = \$1/.test(t)) {
      tables.tour_arret_technique.forEach((r) => { if (r.id === params[0]) r.position = -1; });
      return { rows: [] };
    }
    if (/^UPDATE tour_arret_technique SET position = \$2 WHERE id = \$1/.test(t)) {
      tables.tour_arret_technique.forEach((r) => { if (r.id === params[0]) r.position = params[1]; });
      return { rows: [] };
    }
    if (/SET status = 'skipped'/.test(t)) {
      tables.tour_arret_technique.forEach((r) => {
        if (r.status === 'pending' && r.id !== params[1]) r.status = 'skipped';
      });
      return { rows: [] };
    }
    if (/SET status = 'done'/.test(t)) {
      tables.tour_arret_technique.forEach((r) => {
        if (r.motif === 'depart_centre' && r.status === 'pending') r.status = 'done';
      });
      return { rows: [] };
    }
    if (/^INSERT INTO tour_arret_technique/.test(t)) {
      seq += 1;
      const motif = typeof params[4] === 'string'
        ? params[4]
        : (t.match(/'(depart_centre|pause_dejeuner|vidage|fin_tournee)'/) || [])[1];
      const position = Number.isInteger(params[3]) ? params[3] : 1;
      const ligne = { id: seq, tour_id: TOUR, lieu_id: params[1], libelle: params[2], position, motif, status: 'pending' };
      tables.tour_arret_technique.push(ligne);
      return { rows: [{ id: ligne.id, position: ligne.position }] };
    }
    return { rows: [] };
  });

  /** Programme fusionné tel que le mobile le reconstitue : trié par position. */
  const programme = () => toutes()
    .filter((r) => r.position > 0)
    .sort((a, b) => a.position - b.position || (a.table === 'tour_arret_technique' ? 1 : -1))
    .map((r) => ({ position: r.position, nom: r.libelle || r.nom, table: r.table, status: r.status }));

  return { query, tables, programme };
}

const pointsAssociation = (n) => Array.from({ length: n }, (_, i) => ({ position: i + 1, nom: `Association ${i + 1}` }));

/** Chronologie du moteur : la pause tombe après les deux premiers points. */
const timelineAvecPause = {
  timeline: [
    { type: 'point' }, { type: 'point' },
    { type: 'pause_dejeuner' },
    { type: 'point' }, { type: 'point' },
  ],
};

beforeEach(() => jest.clearAllMocks());

describe('scénario de collision du 26/08/2026 — tournée association de 4 points', () => {
  test('départ en 1, points ensuite, pause intercalée, fin en queue — sans trou ni doublon', async () => {
    estimerProgramme.mockResolvedValue(timelineAvecPause);
    const db = baseSimulee({ associations: pointsAssociation(4) });

    const r = await assurerPassagesCentre(db, TOUR);
    expect(r).toMatchObject({ pose: true, depart: true, pause: true, fin: true });

    const prog = db.programme();
    expect(prog.map((p) => p.position)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(prog.map((p) => p.nom)).toEqual([
      LIBELLE_MOTIF.depart_centre,
      'Association 1',
      'Association 2',
      LIBELLE_MOTIF.pause_dejeuner,
      'Association 3',
      'Association 4',
      LIBELLE_MOTIF.fin_tournee,
    ]);
    // Aucune position n'est portée par deux éléments à la fois.
    expect(new Set(prog.map((p) => p.position)).size).toBe(prog.length);
  });

  test('les points association ne sont plus jamais laissés derrière le retour de fin', async () => {
    estimerProgramme.mockResolvedValue({ timeline: [] });   // pas de pause due
    const db = baseSimulee({ associations: pointsAssociation(4) });
    await poserRetoursAutomatiques(db, TOUR, { timeline: [] }, null);

    const prog = db.programme();
    const fin = prog.find((p) => p.nom === LIBELLE_MOTIF.fin_tournee);
    const dernierPoint = [...prog].reverse().find((p) => p.table === 'tour_association_point');
    expect(fin.position).toBeGreaterThan(dernierPoint.position);
  });
});

describe('garde « tournée entamée »', () => {
  test('un point ASSOCIATION déjà collecté suffit à ne plus retoucher le programme', async () => {
    const assocs = pointsAssociation(4);
    assocs[0].status = 'collected';
    const db = baseSimulee({ associations: assocs });

    const r = await assurerPassagesCentre(db, TOUR);
    expect(r).toEqual({ pose: false, motif: 'tournee_entamee' });
    expect(estimerProgramme).not.toHaveBeenCalled();
    expect(db.tables.tour_arret_technique).toHaveLength(0);
  });
});

describe('« je rentre » en cours de tournée association', () => {
  test('le retour de fin remonte DEVANT le chauffeur, sans doublon ni trou', async () => {
    estimerProgramme.mockResolvedValue({ timeline: [] });
    const assocs = pointsAssociation(4);
    const db = baseSimulee({ associations: assocs });
    await poserRetoursAutomatiques(db, TOUR, { timeline: [] }, null);

    // Le chauffeur a fait les deux premiers points (positions 2 et 3 après le départ).
    db.tables.tour_association_point
      .filter((p) => p.position <= 3).forEach((p) => { p.status = 'collected'; });

    const avant = db.tables.tour_arret_technique.filter((a) => a.motif === 'fin_tournee');
    const r = await avancerRetourCentre(db, { tourId: TOUR, motif: 'fin_tournee', centre: null });
    expect(r.deja_present).toBe(true);   // déplacé, jamais dupliqué
    expect(db.tables.tour_arret_technique.filter((a) => a.motif === 'fin_tournee')).toHaveLength(avant.length);

    const prog = db.programme();
    expect(prog.map((p) => p.position)).toEqual([1, 2, 3, 4, 5, 6]);
    const fin = prog.find((p) => p.nom === LIBELLE_MOTIF.fin_tournee);
    const restants = prog.filter((p) => p.table === 'tour_association_point' && p.status === 'pending');
    // Le retour vient devant ce qui n'a pas été collecté, jamais derrière.
    expect(restants.every((p) => p.position > fin.position)).toBe(true);
  });
});

describe('rattraper-tonnage-associations — arguments et périmètre', () => {
  test('simulation par défaut : --apply est explicite', () => {
    expect(parseArgs(['n', 's']).apply).toBe(false);
    expect(parseArgs(['n', 's', '--apply']).apply).toBe(true);
  });

  test('une date mal formée est refusée plutôt qu\'interprétée', () => {
    expect(() => parseArgs(['n', 's', '--depuis=hier'])).toThrow(/AAAA-MM-JJ/);
    expect(parseArgs(['n', 's', '--depuis=2026-01-01']).depuis).toBe('2026-01-01');
  });

  test('périmètre par défaut : tournées association CLOSES, jamais le camion école', () => {
    const q = buildQuery({});
    expect(q.text).toMatch(/collection_type = 'association'/);
    expect(q.text).toMatch(/status = 'completed'/);
    expect(q.text).toMatch(/is_demo, false\) = false/);
    expect(q.text).toMatch(/tonnage_history_association/);   // idempotence lue en SQL
  });

  test('--tour vise une tournée précise, quel que soit son état', () => {
    const q = buildQuery({ tour: 412 });
    expect(q.values).toEqual([412]);
    expect(q.text).not.toMatch(/status = 'completed'/);
  });

  test('chaque exclusion est MOTIVÉE, jamais silencieuse', () => {
    const base = {
      collection_type: 'association', status: 'completed', is_demo: false,
      total_weight_kg: 600, lignes_existantes: 0, points_collectes: 4,
    };
    expect(motifExclusion(base)).toBeNull();
    expect(motifExclusion({ ...base, collection_type: 'pav' })).toMatch(/pas une tournée association/);
    expect(motifExclusion({ ...base, status: 'in_progress' })).toMatch(/non close/);
    expect(motifExclusion({ ...base, is_demo: true })).toMatch(/démonstration/);
    expect(motifExclusion({ ...base, total_weight_kg: 0 })).toMatch(/aucun poids/);
    expect(motifExclusion({ ...base, lignes_existantes: 4 })).toMatch(/déjà rattrapée/);
    expect(motifExclusion({ ...base, points_collectes: 0 })).toMatch(/rien à répartir/);
  });
});
