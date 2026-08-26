// ═══════════════════════════════════════════════════════════════════════════
// TOURNÉES ASSOCIATION — CHAÎNE COMPLÈTE SUR POSTGRESQL RÉEL
// ───────────────────────────────────────────────────────────────────────────
// Les suites de contrat du module montent les vrais routeurs Express, mais sur
// une base MOCKÉE : le mock rend des lignes quelle que soit la validité du SQL.
// Les trois défauts corrigés le 26/08/2026 sont précisément passés sous ce
// filet, parce qu'ils portaient sur ce que le SQL VOIT :
//   L6  positions calculées sans `tour_association_point` → départ du centre et
//       premier point en collision, retour de fin devant les points restants ;
//   L5  `/programme` aveugle aux points association → édition en direct
//       inopérante sur ces tournées ;
//   L4  effets de clôture aveugles eux aussi → `tonnage_history_association`
//       jamais écrite, et « 0 CAV collectés » sur le mouvement de stock.
// Cette suite les exerce contre un vrai moteur, de la pose du programme à la
// clôture, puis nettoie tout ce qu'elle a créé.
//
// EXÉCUTION : ignorée tant que `TOURS_ASSOC_E2E_DB=1` n'est pas fourni, pour
// que `npx jest` reste vert sans base :
//   TOURS_ASSOC_E2E_DB=1 DB_HOST=127.0.0.1 DB_PORT=5432 DB_NAME=solidata \
//     DB_USER=… DB_PASSWORD=… npx jest tours-association-postgres-e2e
// ═══════════════════════════════════════════════════════════════════════════
const RUN = process.env.TOURS_ASSOC_E2E_DB === '1';

const JWT_SECRET = process.env.JWT_SECRET || 'change-this-in-production';
process.env.JWT_SECRET = JWT_SECRET;

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');

const pool = require('../../src/config/database');
const { poserRetoursAutomatiques } = require('../../src/routes/tours/arrets');
const { applyCompletionSideEffects } = require('../../src/routes/tours/completion-effects');
const { motifExclusion } = require('../../src/scripts/rattraper-tonnage-associations');

const app = express();
app.use(express.json());
app.use('/api/tours', require('../../src/middleware/auth').authenticate, require('../../src/routes/tours/live-edit'));
// Jeton sans `tv` : le contrôle de révocation est sauté, aucun compte à semer.
const ADMIN = jwt.sign({ id: 1, username: 'e2e', role: 'ADMIN' }, JWT_SECRET, { expiresIn: '1h' });
const auth = (r) => r.set('Authorization', `Bearer ${ADMIN}`);

/** Chronologie du moteur de temps : pause après les deux premiers points. */
const ESTIMATION = { timeline: [
  { type: 'point' }, { type: 'point' }, { type: 'pause_dejeuner' }, { type: 'point' }, { type: 'point' },
] };

const NOM_POINT_TEST = 'ZZ-E2E point association (test automatisé)';
let pointsRef = [];      // points association du référentiel utilisés
let pointTestId = null;  // point créé pour l'ajout en direct
const tournees = [];

/** Programme fusionné, tel que le mobile le reconstitue : trié par position. */
async function programme(tourId) {
  const r = await pool.query(
    `SELECT position, 'association' AS kind, ap.name AS libelle
       FROM tour_association_point tap JOIN association_points ap ON ap.id = tap.association_point_id
      WHERE tap.tour_id = $1
      UNION ALL
     SELECT position, 'arret' AS kind, libelle FROM tour_arret_technique WHERE tour_id = $1
      ORDER BY position, kind`,
    [tourId]
  );
  return r.rows.map((x) => ({ ...x, position: Number(x.position) }));
}

async function creerTournee(nbPoints = 4) {
  const t = await pool.query(
    `INSERT INTO tours (date, vehicle_id, collection_type, mode, status, nb_cav)
     VALUES (CURRENT_DATE, $1, 'association', 'standard', 'in_progress', $2) RETURNING id`,
    [vehiculeId, nbPoints]
  );
  const id = t.rows[0].id;
  tournees.push(id);
  for (let i = 0; i < nbPoints; i++) {
    await pool.query(
      'INSERT INTO tour_association_point (tour_id, association_point_id, position) VALUES ($1,$2,$3)',
      [id, pointsRef[i].id, i + 1]
    );
  }
  return id;
}

let vehiculeId;
let tourA;

const d = RUN ? describe : describe.skip;

beforeAll(async () => {
  if (!RUN) return;
  const v = await pool.query('SELECT id FROM vehicles WHERE COALESCE(is_demo,false) = false ORDER BY id LIMIT 1');
  vehiculeId = v.rows[0].id;
  const p = await pool.query('SELECT id, name FROM association_points ORDER BY id LIMIT 4');
  pointsRef = p.rows;
  const test = await pool.query(
    `INSERT INTO association_points (name, ville, latitude, longitude, status)
     VALUES ($1, 'Rouen', 49.44, 1.10, 'active') RETURNING id`,
    [NOM_POINT_TEST]
  );
  pointTestId = test.rows[0].id;

  tourA = await creerTournee(4);
  await poserRetoursAutomatiques(pool, tourA, ESTIMATION, null);
}, 30000);

afterAll(async () => {
  if (!RUN) return;
  for (const id of tournees) {
    await pool.query('DELETE FROM association_learning_feedback WHERE tour_id = $1', [id]).catch(() => {});
    await pool.query('DELETE FROM tonnage_history_association WHERE tour_id = $1', [id]).catch(() => {});
    await pool.query('DELETE FROM stock_movements WHERE tour_id = $1', [id]).catch(() => {});
    await pool.query('DELETE FROM stock_original_movements WHERE tour_id = $1', [id]).catch(() => {});
    await pool.query('DELETE FROM driver_messages WHERE tour_id = $1', [id]).catch(() => {});
    await pool.query('DELETE FROM tour_arret_technique WHERE tour_id = $1', [id]).catch(() => {});
    await pool.query('DELETE FROM tour_association_point WHERE tour_id = $1', [id]).catch(() => {});
    await pool.query('DELETE FROM tours WHERE id = $1', [id]).catch(() => {});
  }
  if (pointTestId) {
    await pool.query('DELETE FROM tonnage_history_association WHERE association_point_id = $1', [pointTestId]).catch(() => {});
    await pool.query('DELETE FROM association_points WHERE id = $1', [pointTestId]).catch(() => {});
  }
  await pool.end().catch(() => {});
}, 30000);

d('L6 — échelle de positions unifiée', () => {
  it('le programme raconte la journée sans collision ni trou', async () => {
    const prog = await programme(tourA);
    expect(prog.map((p) => p.position)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(prog.map((p) => p.kind)).toEqual([
      'arret', 'association', 'association', 'arret', 'association', 'association', 'arret',
    ]);
    expect(prog[0].libelle).toMatch(/Départ du centre/);
    expect(prog[3].libelle).toMatch(/Pause déjeuner/);
    expect(prog[6].libelle).toMatch(/fin de tournée/);
  });
});

d('L5 — édition en direct d\'une tournée association', () => {
  it('GET /programme affiche les points association ET les arrêts', async () => {
    const res = await auth(request(app).get(`/api/tours/${tourA}/programme`));
    expect(res.status).toBe(200);
    expect(res.body.points).toHaveLength(7);
    expect(res.body.points.filter((p) => p.kind === 'association')).toHaveLength(4);
    expect(res.body.points.every((p) => p.name)).toBe(true);
  });

  it('refuse d\'ajouter une BORNE à une tournée association', async () => {
    const cav = await pool.query('SELECT id FROM cav ORDER BY id LIMIT 1');
    const res = await auth(request(app).post(`/api/tours/${tourA}/programme/cav`)).send({ cav_id: cav.rows[0].id });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('TYPE_POINT_INCOMPATIBLE');
  });

  it('ajoute un point association en fin de programme, avec un impact renseigné', async () => {
    const res = await auth(request(app).post(`/api/tours/${tourA}/programme/association`))
      .send({ association_point_id: pointTestId });
    expect(res.status).toBe(201);
    expect(res.body.points).toHaveLength(8);
    const ajoute = res.body.points.find((p) => p.ref_id === pointTestId);
    expect(ajoute.position).toBe(8);
    // L'impact est toujours présent : calculé, ou motivé s'il ne l'est pas.
    expect(res.body.impact).toBeDefined();
    expect(typeof res.body.impact.calculable).toBe('boolean');
    if (!res.body.impact.calculable) expect(res.body.impact.motif).toBeTruthy();
  }, 30000);

  it('le refuse une seconde fois plutôt que de le doubler', async () => {
    const res = await auth(request(app).post(`/api/tours/${tourA}/programme/association`))
      .send({ association_point_id: pointTestId });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('POINT_DEJA_PRESENT');
  }, 30000);

  it('réordonne le programme : le nouveau point passe avant le retour de fin', async () => {
    const avant = (await auth(request(app).get(`/api/tours/${tourA}/programme`))).body.points;
    const nouveau = avant.find((p) => p.ref_id === pointTestId);
    const fin = avant.find((p) => p.motif === 'fin_tournee');
    const ordre = avant
      .filter((p) => p.id !== nouveau.id)
      .map((p) => ({ kind: p.kind, id: p.id }));
    ordre.splice(ordre.findIndex((o) => o.id === fin.id), 0, { kind: 'association', id: nouveau.id });

    const res = await auth(request(app).put(`/api/tours/${tourA}/programme/ordre`)).send({ ordre });
    expect(res.status).toBe(200);
    const prog = await programme(tourA);
    expect(prog.map((p) => p.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(prog[7].libelle).toMatch(/fin de tournée/);
    expect(prog[6].libelle).toBe(NOM_POINT_TEST);
  }, 30000);

  it('retire le point et renumérote le programme ENTIER, sans laisser de trou', async () => {
    const prog = (await auth(request(app).get(`/api/tours/${tourA}/programme`))).body.points;
    const nouveau = prog.find((p) => p.ref_id === pointTestId);
    const res = await auth(request(app).delete(`/api/tours/${tourA}/programme/association/${nouveau.id}`));
    expect(res.status).toBe(200);
    const apres = await programme(tourA);
    expect(apres.map((p) => p.position)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(apres[6].libelle).toMatch(/fin de tournée/);
  }, 30000);
});

d('L4 — clôture : l\'historique association est enfin écrit', () => {
  it('répartit le poids pesé sur les points collectés, et le DIT dans le stock', async () => {
    // Le chauffeur a collecté trois points sur quatre, avec un niveau saisi.
    await pool.query(
      `UPDATE tour_association_point SET status = 'collected', fill_level = 4, collected_at = NOW()
        WHERE tour_id = $1 AND association_point_id = ANY($2::int[])`,
      [tourA, pointsRef.slice(0, 3).map((p) => p.id)]
    );
    await pool.query('UPDATE tours SET total_weight_kg = 900 WHERE id = $1', [tourA]);

    // Bascule en 'completed' comme le fait la route : garde SQL sur le statut.
    const bascule = await pool.query(
      "UPDATE tours SET status = 'completed' WHERE id = $1 AND status <> 'completed' RETURNING *",
      [tourA]
    );
    expect(bascule.rowCount).toBe(1);
    await applyCompletionSideEffects(bascule.rows[0], tourA, null);

    const th = await pool.query(
      'SELECT association_point_id, weight_kg FROM tonnage_history_association WHERE tour_id = $1 ORDER BY association_point_id',
      [tourA]
    );
    expect(th.rows).toHaveLength(3);
    expect(th.rows.map((r) => Number(r.weight_kg))).toEqual([300, 300, 300]);

    const stock = await pool.query('SELECT notes, origine FROM stock_movements WHERE tour_id = $1', [tourA]);
    expect(stock.rows[0].notes).toMatch(/3 point\(s\) association collecté\(s\)/);
    const original = await pool.query('SELECT origine FROM stock_original_movements WHERE tour_id = $1', [tourA]);
    expect(original.rows[0].origine).toBe('collecte_association');
  }, 60000);

  it('une re-clôture ne redouble rien : la garde de statut ne bascule plus', async () => {
    const rejoue = await pool.query(
      "UPDATE tours SET status = 'completed' WHERE id = $1 AND status <> 'completed' RETURNING *",
      [tourA]
    );
    expect(rejoue.rowCount).toBe(0);   // aucun effet n'est réappliqué
    const th = await pool.query('SELECT COUNT(*)::int AS n FROM tonnage_history_association WHERE tour_id = $1', [tourA]);
    expect(th.rows[0].n).toBe(3);
  });

  it('le script de rattrapage voit cette tournée comme DÉJÀ rattrapée', async () => {
    const r = await pool.query(
      `SELECT t.collection_type, t.status, COALESCE(t.is_demo,false) AS is_demo, t.total_weight_kg,
              (SELECT COUNT(*)::int FROM tour_association_point tap
                WHERE tap.tour_id = t.id AND tap.status = 'collected') AS points_collectes,
              (SELECT COUNT(*)::int FROM tonnage_history_association th
                WHERE th.tour_id = t.id) AS lignes_existantes
         FROM tours t WHERE t.id = $1`,
      [tourA]
    );
    expect(motifExclusion(r.rows[0])).toMatch(/déjà rattrapée/);
  });

  it('la boucle se referme : une seconde tournée dispose enfin d\'un historique à comparer', async () => {
    // Les tonnages de la tournée A datent d'aujourd'hui : on les recule d'un
    // mois pour que la seconde collecte ressemble à une vraie cadence, et que
    // le moteur ait autre chose à prédire qu'un point vidé le matin même.
    await pool.query(
      "UPDATE tonnage_history_association SET date = CURRENT_DATE - 30 WHERE tour_id = $1", [tourA]
    );
    const tourB = await creerTournee(4);
    await pool.query(
      `UPDATE tour_association_point SET status = 'collected', fill_level = 3, collected_at = NOW()
        WHERE tour_id = $1 AND association_point_id = ANY($2::int[])`,
      [tourB, pointsRef.slice(0, 3).map((p) => p.id)]
    );
    const bascule = await pool.query(
      "UPDATE tours SET status = 'completed', total_weight_kg = 600 WHERE id = $1 AND status <> 'completed' RETURNING *",
      [tourB]
    );
    await applyCompletionSideEffects(bascule.rows[0], tourB, null);

    // Le moteur avait cette fois un historique (les tonnages de la tournée A) :
    // il a donc produit une VRAIE prédiction, enregistrée face à l'observation.
    const fb = await pool.query(
      'SELECT predicted_fill_rate, observed_fill_level FROM association_learning_feedback WHERE tour_id = $1',
      [tourB]
    );
    expect(fb.rows.length).toBeGreaterThan(0);
    expect(Number(fb.rows[0].predicted_fill_rate)).toBeGreaterThan(0);
    expect(Number(fb.rows[0].observed_fill_level)).toBe(3);
  }, 60000);
});

if (!RUN) {
  test('suite PostgreSQL ignorée (TOURS_ASSOC_E2E_DB non fourni)', () => {
    expect(RUN).toBe(false);
  });
}
