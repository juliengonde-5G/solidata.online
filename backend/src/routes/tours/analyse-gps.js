// ══════════════════════════════════════════════════════════════════════════
// ARRÊTS GPS — ce que le camion a VRAIMENT fait de sa journée
// ──────────────────────────────────────────────────────────────────────────
// Le programme d'une tournée dit ce qui était prévu ; `tour_cav.collected_at`
// dit à quelle minute le chauffeur a validé une borne. Entre les deux, il
// manquait la seule chose qui se mesure vraiment : COMBIEN DE TEMPS le camion
// est resté immobile, et OÙ. Sans elle, personne ne peut répondre à « combien
// de temps prend un vidage » autrement qu'en le devinant — alors que le module
// fait déjà régler cette durée à la main (2.38.0) sans jamais pouvoir la
// confronter au terrain.
//
// Les relevés GPS sont en base depuis toujours. Ce module les relit après coup
// et en extrait les ARRÊTS. Trois règles gouvernent le fichier :
//
//   1. DÉTECTION PURE ET DÉTERMINISTE. `detecterArrets` ne fait aucune E/S :
//      mêmes positions, mêmes seuils → mêmes arrêts, à la seconde près. C'est
//      ce qui rend le recalcul PROUVABLE hors production, et c'est la raison
//      pour laquelle la détection vit ici et non dans le handler Socket.IO
//      `gps-update` (chemin chaud, non rejouable).
//
//   2. JAMAIS DE TEMPS INVENTÉ. La durée d'un arrêt est l'écart entre deux
//      horodatages RÉELS. Un trou d'émission (téléphone en veille, tunnel,
//      batterie) compte tel quel : on ne comble pas, mais on ne coupe pas non
//      plus en silence — le plus grand trou du cluster est EXPOSÉ
//      (`trou_max_min`) pour que le lecteur sache sur quoi repose le chiffre.
//
//   3. UN ARRÊT NON RATTACHÉ RESTE « INCONNU ». Le classement rapproche du
//      point le plus proche dans un rayon paramétré ; au-delà, le type est
//      `inconnu` — et c'est une information, pas un défaut d'affichage : c'est
//      exactement là que se cachent les arrêts qu'on ne s'explique pas.
// ══════════════════════════════════════════════════════════════════════════

const express = require('express');
const router = express.Router();
const pool = require('../../config/database');
const { authorize } = require('../../middleware/auth');
const { haversineDistance } = require('../../services/TourService');
const { centreDeTri } = require('./arrets');

// Garde-fou de lecture, aligné sur `rapport.js` : au-delà on tronque et on le
// DIT plutôt que de charger une journée entière de relevés en mémoire.
const GPS_LECTURE_MAX = 20000;

// Rayon de rattachement au centre de tri. Distinct du rayon des points de
// collecte : une plateforme de tri est un site, pas une borne sur un trottoir —
// le camion s'y gare, s'y pèse et y manœuvre sur plusieurs dizaines de mètres.
const RAYON_CENTRE_M = 200;

// Réglages (settings §1.5 du contrat). Aucune valeur métier en dur : ces
// nombres sont les DÉFAUTS documentés, pas la règle.
const REGLAGES = {
  seuilMin: { cle: 'collecte.arret_seuil_min', defaut: 5, min: 0.5, max: 240 },
  rayonM: { cle: 'collecte.arret_rayon_m', defaut: 40, min: 5, max: 2000 },
  rattachementM: { cle: 'collecte.arret_rattachement_m', defaut: 80, min: 5, max: 2000 },
};

const CACHE_TTL_MS = 60 * 1000;
let cacheReglages = { value: null, at: 0 };

/** Nombre exploitable, ou `null`. Ne convertit JAMAIS l'absence en 0. */
function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

/** Arrondi à `d` décimales, en préservant `null`. */
function arrondi(v, d = 1) {
  const n = num(v);
  if (n === null) return null;
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

/** Borne un réglage lu en base ; hors bornes ou illisible → le défaut. */
function normaliserReglage(brut, { defaut, min, max }) {
  const n = num(brut);
  if (n === null || n < min || n > max) return defaut;
  return n;
}

/**
 * Lit les trois réglages de détection (cache mémoire 60 s).
 * Résilient : table absente ou valeur illisible → défauts documentés. Un
 * réglage manquant ne doit jamais empêcher de lire une tournée.
 */
async function lireReglages(db = pool) {
  const now = Date.now();
  if (cacheReglages.value && now - cacheReglages.at < CACHE_TTL_MS) return cacheReglages.value;
  const valeurs = {
    seuilMin: REGLAGES.seuilMin.defaut,
    rayonM: REGLAGES.rayonM.defaut,
    rattachementM: REGLAGES.rattachementM.defaut,
  };
  try {
    const r = await db.query('SELECT key, value FROM settings WHERE key = ANY($1::text[])', [
      [REGLAGES.seuilMin.cle, REGLAGES.rayonM.cle, REGLAGES.rattachementM.cle],
    ]);
    for (const row of r.rows) {
      const entree = Object.entries(REGLAGES).find(([, def]) => def.cle === row.key);
      if (entree) valeurs[entree[0]] = normaliserReglage(row.value, entree[1]);
    }
  } catch (err) {
    console.warn('[TOURS] Réglages d\'arrêts GPS illisibles, défauts appliqués :', err.message);
  }
  cacheReglages = { value: valeurs, at: now };
  return valeurs;
}

/** Vide le cache (tests, changement de réglage à chaud). */
function resetReglagesCache() {
  cacheReglages = { value: null, at: 0 };
}

// ─────────────────────────────────────────────────────────────────────────────
// DÉTECTION — fonction PURE, aucune E/S
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Découpe une trace GPS en arrêts.
 *
 * ALGORITHME (figé par le contrat, et déterministe par construction) : un
 * cluster s'ouvre au premier point ; un point y reste tant que sa distance
 * haversine au PREMIER point du cluster est ≤ `rayonM`. Le point qui sort ferme
 * le cluster et en ouvre un nouveau.
 *
 * Pourquoi la distance au PREMIER point et non à un centroïde glissant : un
 * centroïde qui suit les points laisserait un camion roulant lentement dériver
 * de cluster en cluster sans jamais en sortir — une heure de circulation dense
 * ressortirait en « arrêt d'une heure ». L'ancre fixe borne l'arrêt à un vrai
 * disque de `rayonM` autour du point d'entrée.
 *
 * DURÉE = dernier horodatage − premier. Les trous d'émission comptent tels
 * quels (règle 2 en tête de fichier) ; le plus grand d'entre eux est exposé
 * dans `trou_max_min` pour que le chiffre puisse être relativisé. L'option
 * `trouMaxMin` permet de COUPER un cluster sur un trou trop long ; elle est
 * désactivée par défaut, car couper reviendrait à décider qu'un camion muet
 * pendant douze minutes est reparti — ce que rien ne prouve.
 *
 * @param {Array<{latitude, longitude, recorded_at}>} positions triées par
 *   `recorded_at` croissant. Les entrées inexploitables sont ignorées.
 * @param {{seuilMin?: number, rayonM?: number, trouMaxMin?: number|null}} options
 * @returns {Array<{debut, fin, duree_min, latitude, longitude, nb_positions,
 *   trou_max_min}>} arrêts retenus, dans l'ordre chronologique.
 */
function detecterArrets(positions, options = {}) {
  const seuilMin = num(options.seuilMin) ?? REGLAGES.seuilMin.defaut;
  const rayonKm = (num(options.rayonM) ?? REGLAGES.rayonM.defaut) / 1000;
  const trouMaxMin = num(options.trouMaxMin);

  if (!Array.isArray(positions) || positions.length === 0) return [];

  // Normalisation : une position sans coordonnées ou sans horodatage lisible
  // n'est pas une position. On l'écarte plutôt que de la faire compter pour un
  // point immobile à (0, 0).
  const pts = [];
  for (const p of positions) {
    const lat = num(p && p.latitude);
    const lng = num(p && p.longitude);
    const t = p && p.recorded_at ? new Date(p.recorded_at) : null;
    if (lat === null || lng === null || !t || Number.isNaN(t.getTime())) continue;
    pts.push({ lat, lng, t });
  }
  if (pts.length === 0) return [];

  const arrets = [];
  let ancre = pts[0];
  let membres = [pts[0]];

  const fermer = () => {
    const premier = membres[0];
    const dernier = membres[membres.length - 1];
    const dureeMin = (dernier.t.getTime() - premier.t.getTime()) / 60000;
    if (dureeMin + 1e-9 < seuilMin) return;
    // Plus grand intervalle entre deux relevés CONSÉCUTIFS du cluster : c'est
    // la mesure honnête de la confiance qu'on peut accorder à la durée.
    let trou = 0;
    for (let i = 1; i < membres.length; i += 1) {
      trou = Math.max(trou, (membres[i].t.getTime() - membres[i - 1].t.getTime()) / 60000);
    }
    arrets.push({
      debut: premier.t.toISOString(),
      fin: dernier.t.toISOString(),
      duree_min: arrondi(dureeMin),
      latitude: premier.lat,
      longitude: premier.lng,
      nb_positions: membres.length,
      trou_max_min: arrondi(trou),
    });
  };

  for (let i = 1; i < pts.length; i += 1) {
    const p = pts[i];
    const sorti = haversineDistance(ancre.lat, ancre.lng, p.lat, p.lng) > rayonKm;
    const ecartMin = (p.t.getTime() - membres[membres.length - 1].t.getTime()) / 60000;
    const coupeSurTrou = trouMaxMin !== null && trouMaxMin > 0 && ecartMin > trouMaxMin;

    if (sorti || coupeSurTrou) {
      fermer();
      ancre = p;
      membres = [p];
      continue;
    }
    membres.push(p);
  }
  fermer();

  return arrets;
}

/**
 * Rattache un arrêt à un point connu du programme.
 *
 * ORDRE DE PRIORITÉ (figé) : borne du programme → point association → centre de
 * tri → inconnu. Le point le plus proche l'emporte au sein d'une famille ; à
 * distance égale, l'ordre de la liste tranche (elle vient d'un `ORDER BY`
 * stable, donc le classement l'est aussi).
 *
 * Fonction PURE : le contexte lui est INJECTÉ, elle ne va rien chercher.
 *
 * @param {{latitude, longitude}} arret
 * @param {{cavs: Array, associations: Array, centre: object|null,
 *   rattachementM: number}} contexte
 * @returns {{type, cav_id, association_point_id, distance_m, cible_nom}}
 */
function classerArret(arret, contexte = {}) {
  const lat = num(arret && arret.latitude);
  const lng = num(arret && arret.longitude);
  const inconnu = {
    type: 'inconnu', cav_id: null, association_point_id: null,
    distance_m: null, cible_nom: null,
  };
  if (lat === null || lng === null) return inconnu;

  const rayonKm = (num(contexte.rattachementM) ?? REGLAGES.rattachementM.defaut) / 1000;

  const plusProche = (liste) => {
    let best = null;
    for (const c of liste || []) {
      const cLat = num(c.latitude);
      const cLng = num(c.longitude);
      if (cLat === null || cLng === null) continue;
      const d = haversineDistance(lat, lng, cLat, cLng);
      if (d > rayonKm) continue;
      if (!best || d < best.d) best = { d, c };
    }
    return best;
  };

  const cav = plusProche(contexte.cavs);
  if (cav) {
    return {
      type: 'cav',
      cav_id: cav.c.id ?? null,
      association_point_id: null,
      distance_m: Math.round(cav.d * 1000),
      cible_nom: cav.c.name ?? null,
    };
  }

  const asso = plusProche(contexte.associations);
  if (asso) {
    return {
      type: 'association',
      cav_id: null,
      association_point_id: asso.c.id ?? null,
      distance_m: Math.round(asso.d * 1000),
      cible_nom: asso.c.name ?? null,
    };
  }

  const centre = contexte.centre;
  const cLat = num(centre && centre.latitude);
  const cLng = num(centre && centre.longitude);
  if (cLat !== null && cLng !== null) {
    const d = haversineDistance(lat, lng, cLat, cLng);
    if (d <= RAYON_CENTRE_M / 1000) {
      return {
        type: 'centre',
        cav_id: null,
        association_point_id: null,
        distance_m: Math.round(d * 1000),
        cible_nom: centre.nom ?? 'Centre de tri',
      };
    }
  }

  return inconnu;
}

// ─────────────────────────────────────────────────────────────────────────────
// ACCÈS BASE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Le contexte de rattachement d'UNE tournée : les points de SON programme, et
 * le centre de tri. Volontairement borné au programme — un arrêt devant une
 * borne qui n'était pas au programme du jour n'est pas une collecte, et le
 * présenter comme telle inventerait un passage.
 *
 * Chaque bloc dégrade seul : une base sans `tour_association_point` renvoie une
 * liste vide, pas une erreur.
 */
async function chargerContexte(tourId, db = pool) {
  const soft = async (text, params, bloc) => {
    try {
      return (await db.query(text, params)).rows;
    } catch (err) {
      console.warn(`[TOURS] arrêts GPS — contexte « ${bloc} » ignoré (${err.code || '?'}) : ${err.message}`);
      return [];
    }
  };

  const [cavs, associations] = await Promise.all([
    soft(
      `SELECT c.id, c.name, c.latitude, c.longitude
         FROM tour_cav tc JOIN cav c ON c.id = tc.cav_id
        WHERE tc.tour_id = $1 AND c.latitude IS NOT NULL AND c.longitude IS NOT NULL
        ORDER BY tc.position, tc.id`,
      [tourId],
      'cav'
    ),
    soft(
      `SELECT ap.id, ap.name, ap.latitude, ap.longitude
         FROM tour_association_point tap JOIN association_points ap ON ap.id = tap.association_point_id
        WHERE tap.tour_id = $1 AND ap.latitude IS NOT NULL AND ap.longitude IS NOT NULL
        ORDER BY tap.position, tap.id`,
      [tourId],
      'association'
    ),
  ]);

  const centre = await centreDeTri(db).catch(() => null);
  return { cavs, associations, centre };
}

/**
 * Détecte, classe et — sur demande — persiste les arrêts d'une tournée.
 *
 * `persist` est IDEMPOTENT par construction : la transaction supprime les
 * arrêts existants de la tournée avant de réécrire. Un recalcul ne peut donc ni
 * doubler ni laisser d'orphelin, et deux exécutions successives donnent le même
 * contenu (la détection étant déterministe).
 *
 * Une tournée de DÉMONSTRATION n'est jamais analysée : c'est un exercice, ses
 * arrêts n'ont rien à dire du terrain.
 *
 * @returns {Promise<{ok, arrets, persistes, motif, seuil_min, rayon_m, rattachement_m,
 *   nb_positions, tronque}>}
 */
async function analyserArretsGps(tourId, { persist = false, source = 'cloture', db = pool } = {}) {
  const id = parseInt(tourId, 10);
  if (!Number.isInteger(id) || id <= 0) {
    return { ok: false, motif: 'Identifiant de tournée invalide', arrets: [], persistes: 0 };
  }

  const reglages = await lireReglages(db);
  const base = {
    seuil_min: reglages.seuilMin,
    rayon_m: reglages.rayonM,
    rattachement_m: reglages.rattachementM,
  };

  let tour;
  try {
    const r = await db.query(
      'SELECT id, vehicle_id, is_demo FROM tours WHERE id = $1',
      [id]
    );
    tour = r.rows[0];
  } catch (err) {
    // Colonne `is_demo` absente (base ancienne) : on retente sans elle plutôt
    // que d'abandonner l'analyse pour une colonne de confort.
    try {
      const r = await db.query('SELECT id, vehicle_id FROM tours WHERE id = $1', [id]);
      tour = r.rows[0];
    } catch (err2) {
      return { ok: false, motif: `Tournée illisible : ${err2.message}`, arrets: [], persistes: 0, ...base };
    }
  }
  if (!tour) {
    return { ok: false, motif: 'Tournée non trouvée', arrets: [], persistes: 0, ...base };
  }
  if (tour.is_demo === true) {
    return {
      ok: true, arrets: [], persistes: 0, nb_positions: 0, tronque: false,
      motif: 'Tournée de démonstration : aucune analyse GPS.', ...base,
    };
  }

  let positions = [];
  try {
    const r = await db.query(
      `SELECT latitude, longitude, recorded_at FROM gps_positions
        WHERE tour_id = $1 ORDER BY recorded_at, id LIMIT ${GPS_LECTURE_MAX + 1}`,
      [id]
    );
    positions = r.rows;
  } catch (err) {
    return { ok: false, motif: `Relevés GPS illisibles : ${err.message}`, arrets: [], persistes: 0, ...base };
  }

  const tronque = positions.length > GPS_LECTURE_MAX;
  if (tronque) positions = positions.slice(0, GPS_LECTURE_MAX);

  const contexte = await chargerContexte(id, db);
  const bruts = detecterArrets(positions, { seuilMin: reglages.seuilMin, rayonM: reglages.rayonM });
  const arrets = bruts.map((a) => ({
    ...a,
    ...classerArret(a, { ...contexte, rattachementM: reglages.rattachementM }),
  }));

  if (!persist) {
    return { ok: true, arrets, persistes: 0, nb_positions: positions.length, tronque, ...base };
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM tour_gps_stops WHERE tour_id = $1', [id]);
    for (const a of arrets) {
      await client.query(
        `INSERT INTO tour_gps_stops
           (tour_id, vehicle_id, debut, fin, duree_min, latitude, longitude,
            type, cav_id, association_point_id, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (tour_id, debut) DO NOTHING`,
        [id, tour.vehicle_id, a.debut, a.fin, a.duree_min, a.latitude, a.longitude,
          a.type, a.cav_id, a.association_point_id,
          source === 'recalcul' ? 'recalcul' : 'cloture']
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    return {
      ok: false, motif: `Enregistrement des arrêts impossible : ${err.message}`,
      arrets, persistes: 0, nb_positions: positions.length, tronque, ...base,
    };
  } finally {
    client.release();
  }

  return {
    ok: true, arrets, persistes: arrets.length,
    nb_positions: positions.length, tronque, ...base,
  };
}

/**
 * Habille les arrêts stockés des libellés que l'écran attend (nom du point,
 * durée prévue). Un rattachement dont la cible a disparu du référentiel garde
 * son identifiant et affiche `null` en nom — ce n'est pas la même chose qu'un
 * arrêt jamais rattaché.
 */
async function lireArretsStockes(tourId, db = pool) {
  const r = await db.query(
    `SELECT s.id, s.debut, s.fin, s.duree_min, s.latitude, s.longitude, s.type,
            s.cav_id, s.association_point_id, s.source, s.created_at,
            c.name AS cav_nom, ap.name AS association_nom,
            tap.duree_prevue_min
       FROM tour_gps_stops s
       LEFT JOIN cav c ON c.id = s.cav_id
       LEFT JOIN association_points ap ON ap.id = s.association_point_id
       LEFT JOIN tour_association_point tap
              ON tap.tour_id = s.tour_id AND tap.association_point_id = s.association_point_id
      WHERE s.tour_id = $1
      ORDER BY s.debut`,
    [tourId]
  );
  return r.rows.map((a) => ({
    debut: a.debut,
    fin: a.fin,
    duree_min: num(a.duree_min),
    latitude: num(a.latitude),
    longitude: num(a.longitude),
    type: a.type,
    cav_id: a.cav_id,
    cav_nom: a.cav_nom ?? null,
    association_point_id: a.association_point_id,
    association_nom: a.association_nom ?? null,
    duree_prevue_min: num(a.duree_prevue_min),
    source: a.source,
  }));
}

/**
 * Complète des arrêts calculés à la volée avec les libellés des cibles.
 * Les identifiants viennent du classement (donc du programme de la tournée) :
 * on ne fait ici que leur donner un nom lisible.
 */
function habillerArrets(arrets, contexte) {
  const nomCav = new Map((contexte.cavs || []).map((c) => [c.id, c.name]));
  const nomAsso = new Map((contexte.associations || []).map((c) => [c.id, c.name]));
  return arrets.map((a) => ({
    debut: a.debut,
    fin: a.fin,
    duree_min: a.duree_min,
    latitude: a.latitude,
    longitude: a.longitude,
    type: a.type,
    cav_id: a.cav_id,
    cav_nom: a.cav_id != null ? (nomCav.get(a.cav_id) ?? null) : null,
    association_point_id: a.association_point_id,
    association_nom: a.association_point_id != null ? (nomAsso.get(a.association_point_id) ?? null) : null,
    duree_prevue_min: null,
    distance_m: a.distance_m ?? null,
    nb_positions: a.nb_positions ?? null,
    trou_max_min: a.trou_max_min ?? null,
  }));
}

/**
 * Le bloc « arrêts GPS » d'une tournée, quelle que soit son état.
 *
 * Tournée CLOSE → lecture de la table (le calcul a été fait et figé à la
 * clôture) ; tournée EN COURS → calcul à la volée, SANS aucune écriture : rien
 * ne doit être figé tant que la journée n'est pas finie, un arrêt en cours
 * n'ayant pas encore de fin.
 *
 * Réutilisable hors HTTP : `rapport.js` s'en sert pour son bloc `arrets_gps`.
 */
async function arretsPourAffichage(tourId, statut, db = pool) {
  const reglages = await lireReglages(db);
  const meta = { seuil_min: reglages.seuilMin, rayon_m: reglages.rayonM };

  if (statut === 'completed') {
    try {
      const arrets = await lireArretsStockes(tourId, db);
      if (arrets.length > 0) return { arrets, source: 'table', ...meta };
      // Table vide : soit la tournée n'a rien à montrer, soit elle a été
      // clôturée avant la mise en service de l'analyse. Le calcul à la volée
      // tranche sans rien écrire — une tournée ancienne n'est pas réécrite
      // dans le dos du gestionnaire, elle a son bouton « Recalculer ».
    } catch (err) {
      console.warn(`[TOURS] arrêts GPS stockés illisibles (tournée ${tourId}) : ${err.message}`);
    }
  }

  const calcul = await analyserArretsGps(tourId, { persist: false, db });
  if (!calcul.ok) {
    return { arrets: [], source: 'indisponible', motif: calcul.motif, ...meta };
  }
  const contexte = await chargerContexte(tourId, db);
  return {
    arrets: habillerArrets(calcul.arrets, contexte),
    source: 'live',
    nb_positions: calcul.nb_positions,
    motif: calcul.nb_positions === 0 ? 'Aucun relevé GPS enregistré pour cette tournée' : null,
    ...meta,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ENDPOINTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/tours/analyse-gps/cav-durees?mois=&cav_id=
 *
 * LE croisement qui manquait : le temps RÉELLEMENT passé sur une borne, mis en
 * face du remplissage constaté ce jour-là. C'est ce qui permet d'ajuster le
 * temps de vidage SELON le taux de remplissage au lieu de le fixer une fois
 * pour toutes.
 *
 * Une combinaison sans donnée est ABSENTE de la réponse. Elle ne vaut pas zéro :
 * « on n'a jamais mesuré une borne pleine » et « une borne pleine se vide en
 * zéro minute » sont deux affirmations très différentes.
 *
 * Déclarée AVANT `/:id/...` : « analyse-gps » serait sinon lu comme un
 * identifiant de tournée par les routeurs à paramètre.
 */
router.get('/analyse-gps/cav-durees', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const moisBrut = parseInt(req.query.mois, 10);
    const mois = Number.isInteger(moisBrut) && moisBrut >= 1 && moisBrut <= 24 ? moisBrut : 6;
    const cavId = req.query.cav_id ? parseInt(req.query.cav_id, 10) : null;
    if (req.query.cav_id && !Number.isInteger(cavId)) {
      return res.status(400).json({ error: 'Identifiant de conteneur invalide', code: 'CAV_INVALIDE' });
    }

    const params = [mois];
    let filtreCav = '';
    if (cavId) { params.push(cavId); filtreCav = `AND s.cav_id = $${params.length}`; }

    // `fill_level` est l'échelle 0-5 saisie par le chauffeur : c'est la seule
    // disponible sur TOUTES les tournées, et c'est elle qui sert de clé
    // d'ajustement. Un passage sans niveau relevé forme son propre groupe
    // (`fill_level` NULL) plutôt que d'être versé dans un niveau qu'il n'a pas.
    const r = await pool.query(
      `SELECT s.cav_id,
              MAX(c.name) AS cav_nom,
              tc.fill_level,
              COUNT(*)::int AS nb_passages,
              ROUND(AVG(s.duree_min)::numeric, 1) AS duree_moyenne_min,
              ROUND(PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY s.duree_min)::numeric, 1) AS duree_mediane_min
         FROM tour_gps_stops s
         JOIN tour_cav tc ON tc.tour_id = s.tour_id AND tc.cav_id = s.cav_id
         LEFT JOIN cav c ON c.id = s.cav_id
         JOIN tours t ON t.id = s.tour_id
        WHERE s.type = 'cav'
          AND s.cav_id IS NOT NULL
          AND s.duree_min IS NOT NULL
          AND COALESCE(t.is_demo, false) = false
          AND s.debut >= NOW() - ($1::int * INTERVAL '1 month')
          ${filtreCav}
        GROUP BY s.cav_id, tc.fill_level
        ORDER BY MAX(c.name) NULLS LAST, tc.fill_level NULLS LAST`,
      params
    );

    res.json({
      lignes: r.rows.map((l) => ({
        cav_id: l.cav_id,
        cav_nom: l.cav_nom ?? null,
        fill_level: l.fill_level === null ? null : Number(l.fill_level),
        nb_passages: l.nb_passages,
        duree_moyenne_min: num(l.duree_moyenne_min),
        duree_mediane_min: num(l.duree_mediane_min),
      })),
      periode: { mois, depuis: new Date(Date.now() - mois * 30 * 86400000).toISOString() },
      // Une réponse vide n'est pas une erreur : elle dit qu'aucun arrêt n'a
      // encore été rattaché à une borne sur la période. On le formule.
      motif: r.rows.length === 0
        ? 'Aucun arrêt rattaché à un conteneur sur la période — les arrêts sont calculés à la clôture des tournées.'
        : null,
    });
  } catch (err) {
    console.error('[TOURS] Erreur cav-durees :', err);
    res.status(500).json({ error: 'Erreur serveur', code: 'ARRETS_DUREES' });
  }
});

// ── Cache court de l'affichage (correctif du 27/08) ────────────────────────
//
// Le tableau de suivi interroge cet endpoint UNE FOIS PAR TOURNÉE ACTIVE,
// toutes les 30 s. Sur une tournée en cours, chaque appel relit `gps_positions`
// (jusqu'à 20 000 lignes) et recharge le contexte des points — soit, avec
// quatre camions émettant toutes les 10 s, quatre relectures de plusieurs
// milliers de lignes deux fois par minute sur un DEV1-S, et un coût qui croît
// avec le parc ET avec l'heure de la journée.
//
// 60 secondes de mémoire suffisent à absorber le rythme d'interrogation sans
// jamais rendre un chiffre périmé à l'œil : un arrêt dure au minimum le seuil
// de détection (5 min par défaut). Même durée et même pattern que le cache de
// `/cav/map`. Écriture volontairement absente : ce cache ne sert QUE la
// lecture ; le recalcul explicite (POST) l'invalide.
const CACHE_AFFICHAGE_MS = 60000;
const cacheAffichage = new Map();

/** Purge du cache — exposée pour les tests et appelée après un recalcul. */
function invaliderCacheArrets(tourId) {
  if (tourId == null) cacheAffichage.clear();
  else cacheAffichage.delete(tourId);
}

/** GET /api/tours/:id/arrets-gps — les arrêts d'une tournée. */
router.get('/:id/arrets-gps', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const tourId = parseInt(req.params.id, 10);
    if (!Number.isInteger(tourId) || tourId <= 0) {
      return res.status(400).json({ error: 'Identifiant de tournée invalide', code: 'TOUR_INVALIDE' });
    }
    const enCache = cacheAffichage.get(tourId);
    if (enCache && enCache.expire > Date.now()) return res.json(enCache.valeur);

    const t = await pool.query('SELECT id, status FROM tours WHERE id = $1', [tourId]);
    if (t.rows.length === 0) {
      return res.status(404).json({ error: 'Tournée non trouvée', code: 'TOUR_INTROUVABLE' });
    }
    const valeur = await arretsPourAffichage(tourId, t.rows[0].status, pool);
    // Une réponse « indisponible » n'est PAS mise en cache : elle traduit un
    // incident (table absente, lecture en échec) qu'on ne veut pas figer une
    // minute de plus que nécessaire.
    if (valeur.source !== 'indisponible') {
      cacheAffichage.set(tourId, { valeur, expire: Date.now() + CACHE_AFFICHAGE_MS });
    }
    res.json(valeur);
  } catch (err) {
    console.error('[TOURS] Erreur arrets-gps :', err);
    res.status(500).json({ error: 'Erreur serveur', code: 'ARRETS_GPS' });
  }
});

/**
 * POST /api/tours/:id/arrets-gps/recalcul — rejoue la détection et la fige.
 *
 * Réservé aux tournées CLOSES : sur une tournée en cours, l'arrêt courant n'a
 * pas encore de fin, et le figer donnerait une durée fausse qui ne serait
 * jamais corrigée.
 */
router.post('/:id/arrets-gps/recalcul', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const tourId = parseInt(req.params.id, 10);
    if (!Number.isInteger(tourId) || tourId <= 0) {
      return res.status(400).json({ error: 'Identifiant de tournée invalide', code: 'TOUR_INVALIDE' });
    }
    const t = await pool.query('SELECT id, status FROM tours WHERE id = $1', [tourId]);
    if (t.rows.length === 0) {
      return res.status(404).json({ error: 'Tournée non trouvée', code: 'TOUR_INTROUVABLE' });
    }
    if (t.rows[0].status !== 'completed') {
      return res.status(409).json({
        error: "Les arrêts ne se figent qu'à la clôture : cette tournée n'est pas terminée.",
        code: 'TOURNEE_NON_CLOTUREE',
      });
    }
    const r = await analyserArretsGps(tourId, { persist: true, source: 'recalcul' });
    if (!r.ok) {
      return res.status(500).json({ error: r.motif || 'Recalcul impossible', code: 'RECALCUL_ECHEC' });
    }
    // Le recalcul est un geste EXPLICITE : le gestionnaire doit voir son
    // résultat tout de suite, pas la version d'il y a une minute.
    invaliderCacheArrets(tourId);
    const contexte = await chargerContexte(tourId, pool);
    res.json({
      ok: true,
      persistes: r.persistes,
      nb_positions: r.nb_positions,
      tronque: r.tronque,
      seuil_min: r.seuil_min,
      rayon_m: r.rayon_m,
      arrets: habillerArrets(r.arrets, contexte),
    });
  } catch (err) {
    console.error('[TOURS] Erreur recalcul arrets-gps :', err);
    res.status(500).json({ error: 'Erreur serveur', code: 'ARRETS_GPS_RECALCUL' });
  }
});

module.exports = router;
// Exportés pour les branchements (clôture, rapport) et les tests. Les deux
// premiers sont PURS : ils se testent sans base, et c'est tout l'intérêt.
module.exports.detecterArrets = detecterArrets;
module.exports.classerArret = classerArret;
module.exports.analyserArretsGps = analyserArretsGps;
module.exports.arretsPourAffichage = arretsPourAffichage;
module.exports.chargerContexte = chargerContexte;
module.exports.habillerArrets = habillerArrets;
module.exports.lireReglages = lireReglages;
module.exports.resetReglagesCache = resetReglagesCache;
// Cache court de l'affichage (correctif 27/08) : purgeable entre deux tests,
// sans quoi le premier imposerait sa réponse aux suivants.
module.exports.invaliderCacheArrets = invaliderCacheArrets;
module.exports.RAYON_CENTRE_M = RAYON_CENTRE_M;
module.exports.REGLAGES = REGLAGES;
