/**
 * PREUVE SUR BASE RÉELLE (PostgreSQL 16) — lot L6.
 * Les VRAIS handlers Express sont exercés par supertest sur une base réelle.
 */
process.env.DB_HOST = '127.0.0.1';
process.env.DB_PORT = '5432';
process.env.DB_NAME = 'solidata';
process.env.DB_USER = 'solidata_user';
process.env.DB_PASSWORD = 'changeme';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'preuve-l6-secret';
process.env.CENTRE_TRI_LAT = '49.4231';
process.env.CENTRE_TRI_LNG = '1.0993';

const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const pool = require('/home/user/solidata.online/backend/src/config/database');

let ok = 0; let ko = 0;
const check = (nom, cond, detail = '') => {
  if (cond) { ok += 1; console.log(`  ✓ ${nom}`); }
  else { ko += 1; console.log(`  ✗ ${nom} ${detail}`); }
};

const LAT = 49.4231; const LNG = 1.0993;
const nord = (m) => LAT + m / 111320;

async function main() {
  // ── Jeu d'essai ───────────────────────────────────────────────────────────
  await pool.query(`DELETE FROM tour_gps_stops WHERE tour_id IN (SELECT id FROM tours)`);
  await pool.query(`DELETE FROM gps_positions`);
  await pool.query(`DELETE FROM tour_cav`);
  await pool.query(`DELETE FROM tour_association_point`);
  await pool.query(`DELETE FROM tours`);
  await pool.query(`DELETE FROM cav`);
  await pool.query(`DELETE FROM association_points`);
  await pool.query(`DELETE FROM lieux_techniques WHERE categorie = 'centre_tri'`);

  const u = await pool.query(
    `INSERT INTO users (username, email, password_hash, role, first_name, last_name, is_active)
     VALUES ('preuve_l6', 'preuve.l6@example.test', 'x', 'ADMIN', 'Preuve', 'L6', true)
     ON CONFLICT (username) DO UPDATE SET role = 'ADMIN' RETURNING id, role, username`
  );
  const admin = u.rows[0];
  const token = jwt.sign(
    { id: admin.id, username: admin.username, role: 'ADMIN', token_version: 0 },
    process.env.JWT_SECRET, { expiresIn: '1h' }
  );

  const v = await pool.query(
    `INSERT INTO vehicles (registration, name, status)
     VALUES ('L6-TEST-01', 'Camion preuve L6', 'available')
     ON CONFLICT (registration) DO UPDATE SET name = EXCLUDED.name RETURNING id`
  );
  const vehicleId = v.rows[0].id;

  await pool.query(
    `INSERT INTO lieux_techniques (nom, adresse, categorie, latitude, longitude, duree_min, is_active)
     VALUES ('Centre de tri', 'Le Houlme', 'centre_tri', $1, $2, 20, true)`, [LAT, LNG]
  );

  // Deux bornes au programme, à 1 km et 2 km du centre.
  const c1 = (await pool.query(
    `INSERT INTO cav (name, commune, latitude, longitude) VALUES ('ROUEN - Rue A','ROUEN',$1,$2) RETURNING id`,
    [nord(1000), LNG])).rows[0].id;
  const c2 = (await pool.query(
    `INSERT INTO cav (name, commune, latitude, longitude) VALUES ('ROUEN - Rue B','ROUEN',$1,$2) RETURNING id`,
    [nord(2000), LNG])).rows[0].id;

  const t = (await pool.query(
    `INSERT INTO tours (date, vehicle_id, status, collection_type, is_demo, started_at, completed_at, total_weight_kg)
     VALUES (CURRENT_DATE, $1, 'in_progress', 'cav', false, NOW() - INTERVAL '4 hours', NULL, 0) RETURNING id`,
    [vehicleId])).rows[0].id;
  await pool.query(
    `INSERT INTO tour_cav (tour_id, cav_id, position, status, fill_level) VALUES
      ($1,$2,1,'collected',4), ($1,$3,2,'collected',2)`, [t, c1, c2]);

  // Trace GPS : départ centre (8 min), route, borne 1 (12 min), route,
  // borne 2 (6 min), route, arrêt INCONNU en pleine campagne (25 min).
  const base = new Date(Date.UTC(2026, 7, 26, 6, 0, 0)).getTime();
  const trace = [];
  const push = (min, lat, lng) => trace.push([t, vehicleId, lat, lng, new Date(base + min * 60000)]);
  for (let m = 0; m <= 8; m += 2) push(m, LAT, LNG);                 // centre, 8 min
  push(12, nord(400), LNG); push(16, nord(700), LNG);                // en route
  for (let m = 20; m <= 32; m += 3) push(m, nord(1000 + (m % 6)), LNG); // borne 1, 12 min
  push(36, nord(1500), LNG);                                          // en route
  for (let m = 40; m <= 46; m += 2) push(m, nord(2000), LNG);          // borne 2, 6 min
  push(50, nord(3000), LNG);                                          // en route
  for (let m = 55; m <= 80; m += 5) push(m, nord(9000), LNG);          // inconnu, 25 min

  for (const row of trace) {
    await pool.query(
      'INSERT INTO gps_positions (tour_id, vehicle_id, latitude, longitude, recorded_at) VALUES ($1,$2,$3,$4,$5)',
      row
    );
  }

  // ── Application Express réelle ────────────────────────────────────────────
  const app = express();
  app.use(express.json());
  app.use('/api/tours', require('/home/user/solidata.online/backend/src/routes/tours'));
  app.use('/api/vehicles', require('/home/user/solidata.online/backend/src/routes/vehicles'));
  const auth = (r) => r.set('Authorization', `Bearer ${token}`);

  console.log('\n── 1. Tournée EN COURS : calcul à la volée, AUCUNE écriture ──');
  let r = await auth(request(app).get(`/api/tours/${t}/arrets-gps`));
  check('200 sur une tournée en cours', r.status === 200, JSON.stringify(r.body).slice(0, 200));
  check('source = "live"', r.body.source === 'live', r.body.source);
  check('4 arrêts détectés (centre, borne 1, borne 2, inconnu)', r.body.arrets.length === 4,
    `→ ${r.body.arrets.length}`);
  const types = r.body.arrets.map((a) => a.type);
  check('types classés centre/cav/cav/inconnu', JSON.stringify(types) === '["centre","cav","cav","inconnu"]',
    JSON.stringify(types));
  check('borne 1 rattachée au bon CAV', r.body.arrets[1].cav_id === c1, String(r.body.arrets[1].cav_id));
  check('nom du CAV renvoyé', r.body.arrets[1].cav_nom === 'ROUEN - Rue A', r.body.arrets[1].cav_nom);
  check('durée borne 1 = 12 min', r.body.arrets[1].duree_min === 12, String(r.body.arrets[1].duree_min));
  check('seuil et rayon exposés', r.body.seuil_min === 5 && r.body.rayon_m === 40,
    `${r.body.seuil_min}/${r.body.rayon_m}`);
  let n = await pool.query('SELECT COUNT(*)::int AS n FROM tour_gps_stops WHERE tour_id = $1', [t]);
  check('RIEN persisté sur une tournée en cours', n.rows[0].n === 0, String(n.rows[0].n));

  console.log('\n── 2. Recalcul refusé tant que la tournée n’est pas close ──');
  r = await auth(request(app).post(`/api/tours/${t}/arrets-gps/recalcul`));
  check('409 TOURNEE_NON_CLOTUREE', r.status === 409 && r.body.code === 'TOURNEE_NON_CLOTUREE',
    `${r.status} ${r.body.code}`);

  console.log('\n── 3. Clôture : les effets de bord figent les arrêts ──');
  const { applyCompletionSideEffects } = require('/home/user/solidata.online/backend/src/routes/tours/completion-effects');
  await pool.query("UPDATE tours SET status='completed', completed_at=NOW() WHERE id=$1", [t]);
  const tour = (await pool.query('SELECT * FROM tours WHERE id=$1', [t])).rows[0];
  await applyCompletionSideEffects(tour, t, admin.id);
  n = await pool.query("SELECT type, duree_min, source, cav_id FROM tour_gps_stops WHERE tour_id=$1 ORDER BY debut", [t]);
  check('4 arrêts persistés à la clôture', n.rows.length === 4, String(n.rows.length));
  check('source = "cloture"', n.rows.every((x) => x.source === 'cloture'));
  check('durée stockée en base = 12 min sur la borne 1', Number(n.rows[1].duree_min) === 12,
    String(n.rows[1].duree_min));

  console.log('\n── 4. Lecture après clôture : source « table » ──');
  r = await auth(request(app).get(`/api/tours/${t}/arrets-gps`));
  check('source = "table"', r.body.source === 'table', r.body.source);
  check('4 arrêts relus', r.body.arrets.length === 4, String(r.body.arrets.length));

  console.log('\n── 5. Recalcul IDEMPOTENT (ni doublon ni orphelin) ──');
  r = await auth(request(app).post(`/api/tours/${t}/arrets-gps/recalcul`));
  check('200 au recalcul', r.status === 200, `${r.status} ${JSON.stringify(r.body).slice(0, 150)}`);
  n = await pool.query('SELECT COUNT(*)::int AS n FROM tour_gps_stops WHERE tour_id=$1', [t]);
  check('toujours 4 arrêts après recalcul', n.rows[0].n === 4, String(n.rows[0].n));
  const src = await pool.query("SELECT DISTINCT source FROM tour_gps_stops WHERE tour_id=$1", [t]);
  check('source basculée en "recalcul"', src.rows.length === 1 && src.rows[0].source === 'recalcul',
    JSON.stringify(src.rows));
  // Deuxième recalcul : même contenu.
  await auth(request(app).post(`/api/tours/${t}/arrets-gps/recalcul`));
  n = await pool.query('SELECT COUNT(*)::int AS n FROM tour_gps_stops WHERE tour_id=$1', [t]);
  check('deux recalculs successifs → toujours 4', n.rows[0].n === 4, String(n.rows[0].n));

  console.log('\n── 6. Temps de vidage par borne CROISÉ au remplissage ──');
  r = await auth(request(app).get('/api/tours/analyse-gps/cav-durees?mois=6'));
  check('200 sur cav-durees', r.status === 200, JSON.stringify(r.body).slice(0, 200));
  check('2 lignes (une par borne)', r.body.lignes.length === 2, JSON.stringify(r.body.lignes));
  const l1 = r.body.lignes.find((x) => x.cav_id === c1);
  check('borne 1 : remplissage 4/5 → 12 min mesurées',
    l1 && l1.fill_level === 4 && l1.duree_moyenne_min === 12, JSON.stringify(l1));
  check('médiane exposée', l1 && l1.duree_mediane_min === 12, JSON.stringify(l1));
  const l2 = r.body.lignes.find((x) => x.cav_id === c2);
  check('borne 2 : remplissage 2/5 → 6 min mesurées',
    l2 && l2.fill_level === 2 && l2.duree_moyenne_min === 6, JSON.stringify(l2));
  r = await auth(request(app).get(`/api/tours/analyse-gps/cav-durees?cav_id=${c1}`));
  check('filtre cav_id honoré', r.body.lignes.length === 1 && r.body.lignes[0].cav_id === c1,
    JSON.stringify(r.body.lignes));

  console.log('\n── 7. Rapport de tournée : bloc arrêts + durée par point ──');
  r = await auth(request(app).get(`/api/tours/${t}/rapport`));
  check('200 sur le rapport', r.status === 200, JSON.stringify(r.body).slice(0, 200));
  check('bloc arrets_gps présent', !!r.body.arrets_gps && r.body.arrets_gps.arrets.length === 4,
    JSON.stringify(r.body.arrets_gps || {}).slice(0, 200));
  check('1 arrêt inconnu compté', r.body.arrets_gps.nb_inconnus === 1, String(r.body.arrets_gps.nb_inconnus));
  const pt1 = r.body.points.find((p) => p.ref_id === c1);
  check('durée de vidage rattachée au point du programme', pt1 && pt1.stop_duration_min === 12,
    JSON.stringify(pt1 && pt1.stop_duration_min));
  check('bloc arrets_gps NON dégradé', !r.body.degraded.includes('arrets_gps'),
    JSON.stringify(r.body.degraded));

  console.log('\n── 8. Tournée DÉMO : aucune analyse, aucun arrêt ──');
  const td = (await pool.query(
    `INSERT INTO tours (date, vehicle_id, status, collection_type, is_demo, started_at)
     VALUES (CURRENT_DATE, $1, 'in_progress', 'cav', true, NOW()) RETURNING id`, [vehicleId])).rows[0].id;
  for (let m = 0; m <= 20; m += 2) {
    await pool.query('INSERT INTO gps_positions (tour_id, vehicle_id, latitude, longitude, recorded_at) VALUES ($1,$2,$3,$4,$5)',
      [td, vehicleId, LAT, LNG, new Date(base + m * 60000)]);
  }
  const { analyserArretsGps } = require('/home/user/solidata.online/backend/src/routes/tours/analyse-gps');
  const dem = await analyserArretsGps(td, { persist: true });
  check('tournée démo : 0 arrêt, motif explicite', dem.ok && dem.arrets.length === 0 && !!dem.motif,
    JSON.stringify(dem).slice(0, 160));
  n = await pool.query('SELECT COUNT(*)::int AS n FROM tour_gps_stops WHERE tour_id=$1', [td]);
  check('rien écrit pour la démo', n.rows[0].n === 0, String(n.rows[0].n));

  console.log('\n── 9. Tournée SANS relevé GPS : motif honnête, jamais un zéro ──');
  const tv = (await pool.query(
    `INSERT INTO tours (date, vehicle_id, status, collection_type, is_demo, started_at, completed_at)
     VALUES (CURRENT_DATE, $1, 'completed', 'cav', false, NOW(), NOW()) RETURNING id`, [vehicleId])).rows[0].id;
  r = await auth(request(app).get(`/api/tours/${tv}/arrets-gps`));
  check('200 et liste vide', r.status === 200 && r.body.arrets.length === 0);
  check('motif « aucun relevé GPS »', /Aucun relevé GPS/i.test(r.body.motif || ''), r.body.motif);

  console.log('\n── 10. etat-declare : réponses COMPLÈTES et dégâts ──');
  await pool.query(`CREATE TABLE IF NOT EXISTS vehicle_checklists (
      id SERIAL PRIMARY KEY, tour_id INTEGER, vehicle_id INTEGER REFERENCES vehicles(id),
      employee_id INTEGER, exterior_ok BOOLEAN, fuel_level VARCHAR(20),
      km_start INTEGER, km_end INTEGER, notes TEXT, degats JSONB, reponses JSONB,
      created_at TIMESTAMP DEFAULT NOW())`);
  await pool.query('DELETE FROM vehicle_checklists WHERE vehicle_id = $1', [vehicleId]);
  await pool.query(
    `INSERT INTO vehicle_checklists (tour_id, vehicle_id, exterior_ok, fuel_level, km_start, notes, degats, reponses)
     VALUES ($1,$2,true,'3/4',120345,'Feu arrière cassé',$3::jsonb,$4::jsonb)`,
    [t, vehicleId,
      JSON.stringify([{ vue: 'arriere', x: 0.7, y: 0.4, type: 'bris', commentaire: 'feu droit' }]),
      JSON.stringify([
        { id: 'feux', libelle: 'Feux et clignotants', ok: false },
        { id: 'pneus', libelle: 'Pneus', ok: true },
        { id: 'huile', libelle: 'Niveau d’huile', ok: true },
      ])]
  );
  r = await auth(request(app).get(`/api/vehicles/${vehicleId}/etat-declare`));
  check('200 etat-declare', r.status === 200, JSON.stringify(r.body).slice(0, 150));
  check('reponses COMPLÈTES exposées (3 points)', Array.isArray(r.body.reponses) && r.body.reponses.length === 3,
    JSON.stringify(r.body.reponses));
  check('1 point non validé isolé', r.body.nb_points_non_valides === 1, String(r.body.nb_points_non_valides));
  check('dégâts avec coordonnées relatives', r.body.degats.length === 1 && r.body.degats[0].vue === 'arriere',
    JSON.stringify(r.body.degats));

  console.log('\n── 11. Rapport : la checklist du matin est exploitable ──');
  r = await auth(request(app).get(`/api/tours/${t}/rapport`));
  check('checklist.terminee_a renseignée', !!(r.body.checklist && r.body.checklist.terminee_a),
    JSON.stringify(r.body.checklist || {}).slice(0, 150));
  check('points_non_valides détaillés dans le rapport',
    r.body.checklist.points_non_valides.length === 1
    && r.body.checklist.points_non_valides[0].libelle === 'Feux et clignotants',
    JSON.stringify(r.body.checklist.points_non_valides));
  check('nb_degats et détail présents', r.body.checklist.nb_degats === 1 && r.body.checklist.degats.length === 1);
  check('detail_disponible = true', r.body.checklist.detail_disponible === true);

  console.log(`\n══ RÉSULTAT : ${ok} vérifications vertes, ${ko} rouge(s) ══`);
  await pool.end();
  process.exit(ko === 0 ? 0 : 1);
}

main().catch((e) => { console.error('ÉCHEC DE LA PREUVE :', e); process.exit(1); });
