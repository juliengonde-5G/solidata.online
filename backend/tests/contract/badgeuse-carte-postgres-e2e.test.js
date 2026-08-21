// ═══════════════════════════════════════════════════════════════════════════
// MODULE 33 « TEMPS & PRÉSENCE » — ÉCRAN « POSITION DES TOURNÉES » SUR
// POSTGRESQL RÉEL (ADR-0004, addendum du 19/08/2026)
// ───────────────────────────────────────────────────────────────────────────
// POURQUOI CETTE SUITE EXISTE, EN PLUS DE LA SUITE MOCKÉE
// Le mock rend des lignes quelle que soit la validité du SQL : il ne peut rien
// dire des trois pièges de cette fonctionnalité, qui sont TOUS dans les
// requêtes et non dans le JavaScript :
//   1. la résolution d'une commune par son NOM, qui doit faire converger un
//      CAV sans code INSEE et un point d'association de la même ville sur un
//      SEUL secteur — sinon la même commune apparaît deux fois sur la carte ;
//   2. le référentiel couvrant plusieurs EPCI, deux communes HOMONYMES y
//      coexistent : une jointure par nom dupliquerait le CAV et fausserait le
//      barycentre, donc la place du secteur à l'écran. La sous-requête
//      scalaire est là pour ça, et seule une vraie base peut le prouver ;
//   3. `DISTINCT ON ... ORDER BY collected_at DESC` doit retenir le DERNIER
//      point collecté — c'est toute la définition de la position affichée.
//
// EXÉCUTION (ignorée sans la variable, pour que `npx jest` reste vert sans base) :
//   BADGEUSE_E2E_DB=1 DB_HOST=127.0.0.1 DB_NAME=… DB_USER=… DB_PASSWORD=… \
//     npx jest badgeuse-carte-postgres-e2e
// ═══════════════════════════════════════════════════════════════════════════
const RUN = process.env.BADGEUSE_E2E_DB === '1';

const express = require('express');
const request = require('supertest');
const crypto = require('crypto');

jest.mock('../../src/middleware/activity-logger', () => ({
  autoLogActivity: () => (req, res, next) => next(),
  logActivity: () => {},
}));

const pool = require('../../src/config/database');
const deviceRoutes = require('../../src/routes/badgeuse-device');
const { hashDeviceKey } = require('../../src/utils/badgeuse-crypto');
const engine = require('../../src/services/badgeuse-engine');

const app = express();
app.use(express.json());
// Même montage qu'en production (index.js) : le préfixe /api/badgeuse/device
// est ce que le poste appelle réellement.
app.use('/api/badgeuse/device', deviceRoutes);

const CODE_POSTE = 'JEST-CARTE';
const DEVICE_KEY = 'c'.repeat(64);
const MARQUE = 'jest-carte';           // sert au nettoyage : rien d'autre n'est touché
const JOUR = engine.parisDateStr(new Date());

// Communes réelles de l'agglomération + un HOMONYME volontaire dans un autre
// EPCI : c'est le piège n° 2 décrit en tête de fichier.
const COMMUNES = [
  { insee: '76367', nom: 'Le Houlme', epci: '200023414' },
  { insee: '76451', nom: 'Maromme', epci: '200023414' },
  { insee: '76681', nom: 'Sotteville-lès-Rouen', epci: '200023414' },
  { insee: '76550', nom: 'Saint-Aubin', epci: '200023414' },
  { insee: '27500', nom: 'Saint-Aubin', epci: '200066793' }, // homonyme, autre EPCI
];

let siteId;
let ids = {};

async function nettoyer() {
  await pool.query(`DELETE FROM tour_cav WHERE tour_id IN (SELECT id FROM tours WHERE notes = $1)`, [MARQUE]);
  await pool.query(`DELETE FROM tour_association_point WHERE tour_id IN (SELECT id FROM tours WHERE notes = $1)`, [MARQUE]);
  await pool.query(`DELETE FROM tours WHERE notes = $1`, [MARQUE]);
  await pool.query(`DELETE FROM cav WHERE name LIKE $1`, [`${MARQUE}%`]);
  await pool.query(`DELETE FROM association_points WHERE name LIKE $1`, [`${MARQUE}%`]);
  await pool.query(`DELETE FROM vehicles WHERE registration LIKE $1`, [`ZZ-${MARQUE}%`]);
  await pool.query(`DELETE FROM badgeuse_contenus WHERE titre = $1`, [MARQUE]);
  await pool.query(`DELETE FROM badgeuse_devices WHERE code = $1`, [CODE_POSTE]);
  await pool.query(`DELETE FROM referentiel_communes WHERE code_insee = ANY($1)`,
    [COMMUNES.map((c) => c.insee)]);
}

const dev = (p) => request(app).get(p).set('X-Device-Key', DEVICE_KEY);

(RUN ? describe : describe.skip)('écran « position des tournées » — PostgreSQL réel', () => {
  beforeAll(async () => {
    await nettoyer();

    for (const c of COMMUNES) {
      await pool.query(
        `INSERT INTO referentiel_communes (code_insee, nom, epci_code, is_metropole_rouen)
         VALUES ($1, $2, $3, true) ON CONFLICT (code_insee) DO NOTHING`,
        [c.insee, c.nom, c.epci]
      );
    }

    // CAV rattachés à leur code INSEE.
    const cav = async (nom, commune, insee, lat, lng) => (await pool.query(
      `INSERT INTO cav (name, commune, code_insee_commune, latitude, longitude, qr_code_data)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [`${MARQUE} ${nom}`, commune, insee, lat, lng, `${MARQUE}-${nom}-${crypto.randomUUID()}`]
    )).rows[0].id;

    ids.houlmeA = await cav('houlme-a', 'Le Houlme', '76367', 49.5100, 1.0500);
    ids.houlmeB = await cav('houlme-b', 'Le Houlme', '76367', 49.5140, 1.0540);
    ids.maromme = await cav('maromme', 'Maromme', '76451', 49.4700, 1.0200);
    ids.sotteville = await cav('sotteville', 'Sotteville-lès-Rouen', '76681', 49.4100, 1.0900);
    // CAV SANS code INSEE : seul le nom de commune est renseigné. Il doit
    // quand même situer une tournée — c'est l'état réel d'une base où le
    // rattachement manuel d'AdminCAV n'a pas été fait.
    ids.sansInsee = await cav('sans-insee', 'Saint-Aubin', null, 49.4400, 1.1400);

    // Point d'association DANS LA MÊME VILLE que le CAV sans INSEE : les deux
    // doivent converger sur un seul secteur (piège n° 1).
    ids.assoc = (await pool.query(
      `INSERT INTO association_points (name, ville, latitude, longitude)
       VALUES ($1, 'Saint-Aubin', 49.4420, 1.1420) RETURNING id`, [`${MARQUE} assoc`]
    )).rows[0].id;

    const vehicule = async (immat, nom) => (await pool.query(
      `INSERT INTO vehicles (registration, name, max_capacity_kg) VALUES ($1, $2, 3500) RETURNING id`,
      [`ZZ-${MARQUE}-${immat}`, nom]
    )).rows[0].id;
    ids.v1 = await vehicule('1', 'Camion Jest 1');
    ids.v2 = await vehicule('2', 'Camion Jest 2');
    ids.v3 = await vehicule('3', 'Camion Jest 3');

    const tour = async (vehicleId, type) => (await pool.query(
      `INSERT INTO tours (date, vehicle_id, mode, status, collection_type, notes)
       VALUES ($1::date, $2, 'standard', 'in_progress', $3, $4) RETURNING id`,
      [JOUR, vehicleId, type, MARQUE]
    )).rows[0].id;

    // Tournée 1 : deux CAV collectés, le SECOND (Maromme) plus tard que le
    // premier (Le Houlme). La position affichée doit être Maromme.
    ids.t1 = await tour(ids.v1, 'pav');
    await pool.query(
      `INSERT INTO tour_cav (tour_id, cav_id, position, status, collected_at)
       VALUES ($1, $2, 1, 'collected', NOW() - INTERVAL '2 hours'),
              ($1, $3, 2, 'collected', NOW() - INTERVAL '20 minutes'),
              ($1, $4, 3, 'pending', NULL)`,
      [ids.t1, ids.houlmeA, ids.maromme, ids.sotteville]
    );

    // Tournée 2 : associations, un point collecté à Saint-Aubin.
    ids.t2 = await tour(ids.v2, 'association');
    await pool.query(
      `INSERT INTO tour_association_point (tour_id, association_point_id, position, status, collected_at)
       VALUES ($1, $2, 1, 'collected', NOW() - INTERVAL '30 minutes')`,
      [ids.t2, ids.assoc]
    );

    // Tournée 3 : partie, rien de collecté → position inconnue.
    ids.t3 = await tour(ids.v3, 'pav');
    await pool.query(
      `INSERT INTO tour_cav (tour_id, cav_id, position, status) VALUES ($1, $2, 1, 'pending')`,
      [ids.t3, ids.sotteville]
    );

    siteId = (await pool.query(
      `INSERT INTO badgeuse_sites (code, libelle, actif) VALUES ('LH', 'Site Jest', true)
       ON CONFLICT (code) DO UPDATE SET actif = true RETURNING id`
    )).rows[0].id;
    await pool.query(
      `INSERT INTO badgeuse_devices (code, libelle, site_id, api_key_hash, actif)
       VALUES ($1, 'Poste Jest carte', $2, $3, true)`,
      [CODE_POSTE, siteId, hashDeviceKey(DEVICE_KEY)]
    );
    await pool.query(
      `INSERT INTO badgeuse_contenus (site_id, type, titre, duree_sec, ordre, actif)
       VALUES ($1, 'tournees_carte', $2, 15, 1, true)`,
      [siteId, MARQUE]
    );
  });

  afterAll(async () => {
    await nettoyer();
    await pool.end();
  });

  let carte;
  beforeAll(async () => {
    const r = await dev(`/api/badgeuse/device/v1/devices/${CODE_POSTE}/playlist`);
    expect(r.status).toBe(200);
    // La base d'intégration peut contenir d'autres contenus : on ne prend que
    // l'écran de CE test, repéré par son titre-marqueur.
    const el = r.body.elements.find((e) => e.titre === MARQUE);
    expect(el).toBeDefined();
    expect(el.type).toBe('tournees_carte');
    carte = el.carte;
  });

  test('le SQL réel produit un fond de carte exploitable', () => {
    expect(carte.largeur).toBeGreaterThan(0);
    expect(carte.secteurs.length).toBeGreaterThanOrEqual(4);
    expect(carte.contour.length).toBeGreaterThanOrEqual(3);
  });

  test('AUCUNE coordonnée géographique dans la réponse servie par une vraie base', () => {
    const brut = JSON.stringify(carte);
    expect(brut).not.toMatch(/latitude|longitude|"lat"|"lng"/i);
    expect(brut).not.toMatch(/49\.[0-9]{2}|1\.0[0-9]{2}/);
  });

  test('la position affichée est celle du DERNIER point collecté (Maromme, pas Le Houlme)', () => {
    const v = carte.vehicules.find((x) => x.code === 'Camion Jest 1');
    const secteur = carte.secteurs.find((s) => s.code === v.secteur);
    expect(secteur.nom).toBe('Maromme');
    expect(v.points_faits).toBe(2);
    expect(v.points_total).toBe(3);
  });

  test('une tournée ASSOCIATIONS se situe elle aussi (via la ville du point collecté)', () => {
    const v = carte.vehicules.find((x) => x.code === 'Camion Jest 2');
    expect(v.libelle).toBe('Tournée associations');
    const secteur = carte.secteurs.find((s) => s.code === v.secteur);
    expect(secteur.nom).toBe('Saint-Aubin');
  });

  test('CAV sans code INSEE et point d\'association de la même ville : UN SEUL secteur', () => {
    // Sans la résolution du code INSEE par le nom, on obtiendrait deux points
    // « Saint-Aubin » superposés sur la carte.
    const saintAubin = carte.secteurs.filter((s) => s.nom === 'Saint-Aubin');
    expect(saintAubin).toHaveLength(1);
  });

  test('une commune HOMONYME dans un autre EPCI ne duplique pas le point de collecte', () => {
    // Piège n° 2 : une jointure par nom aurait produit deux lignes pour le même
    // CAV. Le secteur est identifié par le PLUS PETIT code INSEE homonyme et
    // reste unique — la carte ne compte pas deux fois le même conteneur.
    const saintAubin = carte.secteurs.find((s) => s.nom === 'Saint-Aubin');
    expect(saintAubin.code).toBe('27500');
    expect(carte.secteurs.filter((s) => s.code === '27500')).toHaveLength(1);
  });

  test('la tournée sans point collecté est annoncée « position inconnue »', () => {
    expect(carte.sans_position.map((v) => v.code)).toContain('Camion Jest 3');
    expect(carte.vehicules.some((v) => v.code === 'Camion Jest 3')).toBe(false);
  });

  test('aucun nom de personne ne figure dans la charge utile', () => {
    expect(JSON.stringify(carte)).not.toMatch(/first_name|last_name|chauffeur|driver/i);
  });
});
