// ══════════════════════════════════════════════════════════════════════════
// RAPPORT DE TOURNÉE — tout ce qu'on sait d'une tournée, en une réponse
// ──────────────────────────────────────────────────────────────────────────
// Destiné au compte rendu d'UNE PAGE que le gestionnaire imprime après coup :
// ce qui était prévu, ce qui s'est passé, et l'écart entre les deux.
//
// Les données d'une tournée sont éparpillées dans une dizaine de tables — le
// programme lui-même en occupe trois (`tour_cav`, `tour_association_point`,
// `tour_arret_technique`), qui partagent la MÊME échelle de position. Les
// rassembler côté client demanderait autant d'appels, et surtout autant
// d'occasions de recomposer l'ordre de travers. Le serveur le fait une fois.
//
// DEUX RÈGLES GOUVERNENT CE FICHIER :
//
//   1. Jamais de valeur inventée. Une donnée absente vaut `null`, accompagnée
//      du motif quand il éclaire le lecteur (`distance_motif`…). Un écart
//      d'horaire non calculable — heure prévue OU heure réelle manquante —
//      vaut `null` et jamais 0 : « à l'heure » et « on ne sait pas » sont deux
//      informations différentes, et les confondre trompe le gestionnaire.
//
//   2. Chaque bloc est indépendant. Une requête qui échoue (colonne absente
//      sur une base non migrée) dégrade SON bloc et n'emporte pas le rapport :
//      un compte rendu sans trace GPS reste un compte rendu. Les blocs tombés
//      sont NOMMÉS dans `degraded` — dégrader en silence reviendrait à
//      présenter une tournée sans incident comme une tournée sans problème.
//      (Motif emprunté au helper `soft()` de services/insertion-ai.js.)
// ══════════════════════════════════════════════════════════════════════════

const express = require('express');
const router = express.Router();
const pool = require('../../config/database');
const { authorize } = require('../../middleware/auth');
const { centreDeTri, LIBELLE_MOTIF } = require('./arrets');

/**
 * Journalise la consultation du compte rendu — BEST EFFORT (correctif 27/08).
 *
 * POURQUOI ICI ET NULLE PART AILLEURS : les points d'accès dédiés aux arrêts
 * (`/arrets-gps`, `/analyse-gps/cav-durees`) ne renvoient AUCUN nom de
 * conducteur. Ce compte rendu est la seule surface qui présente, dans le MÊME
 * document, l'identité du conducteur et ses arrêts géolocalisés minute par
 * minute — et il est imprimable en PDF, donc extractible de l'application.
 *
 * L'arbitrage retenu (tracé au registre RGPD, init-db.js §1.6 bis) est de
 * CONSERVER le nom : un compte rendu de tournée qui tait qui conduisait est
 * inexploitable en exploitation, et l'anonymiser ne masquerait rien (la
 * tournée et le véhicule désignent la personne). La contrepartie est la trace
 * de consultation, sur le modèle des consultations individuelles du module
 * Temps & Présence — on sait qui a regardé quoi, et quand.
 *
 * Une panne de journal n'empêche jamais la lecture : l'échec est logué.
 */
function journaliserConsultationRapport(req, tourId, contexte) {
  const uid = req.user && req.user.id != null ? req.user.id : null;
  pool.query(
    'INSERT INTO rgpd_audit_log (user_id, action, entity_type, entity_id, details) VALUES ($1, $2, $3, $4, $5)',
    [uid, 'RAPPORT_TOURNEE_CONSULTE', 'tours', tourId, JSON.stringify(contexte || {})]
  ).catch((err) => console.error('[TOURS] Journalisation de la consultation du rapport impossible :', err.message));
}

// Nombre de positions GPS renvoyées au maximum (cf. échantillonnage plus bas).
const GPS_ECHANTILLON_CIBLE = 300;

// Garde-fou de lecture : au-delà, on tronque et on le DIT plutôt que de
// charger une journée entière de relevés en mémoire.
const GPS_LECTURE_MAX = 20000;

/**
 * Motifs de non-collecte, traduits. Le vocabulaire stocké est contraint par le
 * CHECK de `tour_cav.skip_reason` (init-db.js) ; il est technique et ne doit
 * pas atteindre un compte rendu imprimé. La table vivait en constante locale
 * d'un écran d'administration — elle est ici parce que le rapport en a besoin
 * et qu'un PDF n'a pas à réinventer une traduction.
 */
const LIBELLE_SKIP_REASON = {
  cav_fermee: 'Conteneur fermé',
  bouchee: 'Conteneur bouché',
  acces_impossible: 'Accès impossible',
  proprietaire_absent: 'Propriétaire absent',
  vide: 'Conteneur vide',
  autre: 'Autre motif',
};

/**
 * Repli sur la valeur brute plutôt que sur un tiret : un motif inconnu qui
 * s'affiche en clair signale un libellé manquant ici ; masqué derrière « — »
 * il se lirait comme une donnée absente.
 */
const libelleSkipReason = (v) => (v ? (LIBELLE_SKIP_REASON[v] || v) : null);

/** Distance haversine en km — même formule que live-summary, mêmes chiffres. */
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

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

/** Date exploitable, ou `null` (une date illisible ne vaut pas « maintenant »). */
function dateOuNull(v) {
  if (!v) return null;
  const t = new Date(v);
  return Number.isNaN(t.getTime()) ? null : t;
}

/**
 * Écart en minutes entre l'heure réelle et l'heure prévue. Positif = en retard.
 * `null` dès qu'une des deux heures manque — voir la règle 1 en tête de fichier.
 */
function ecartMinutes(prevue, reelle) {
  const p = dateOuNull(prevue);
  const r = dateOuNull(reelle);
  if (!p || !r) return null;
  return Math.round((r.getTime() - p.getTime()) / 60000);
}

/**
 * Rang de famille pour départager deux éléments à position égale (héritage
 * d'une base non renumérotée) : un point de collecte passe devant un arrêt.
 * Même règle que routes/tours/live-edit.js — le programme doit s'ordonner
 * partout de la même façon, sinon l'ordre imprimé et l'ordre à l'écran
 * divergent sur les tournées anciennes.
 */
const rangKind = (kind) => (kind === 'arret_technique' ? 1 : 0);

/**
 * Fabrique les helpers de résilience d'UNE requête HTTP. `degraded` accumule
 * les noms des blocs tombés, `soft` exécute une requête en dégradant sur
 * `{ rows: [] }`, `softAvecRepli` tente d'abord la requête riche puis une
 * requête minimale (colonnes historiques) avant d'abandonner le bloc.
 */
function fabriqueSoft() {
  const degraded = [];
  const soft = (text, params, bloc) => pool.query(text, params).catch((e) => {
    console.error(`[TOURS] rapport — bloc « ${bloc} » ignoré (${e.code || '?'}) : ${e.message}`);
    if (!degraded.includes(bloc)) degraded.push(bloc);
    return { rows: [] };
  });
  const softAvecRepli = async (text, repli, params, bloc) => {
    try {
      return await pool.query(text, params);
    } catch (e) {
      console.warn(`[TOURS] rapport — bloc « ${bloc} » en repli minimal (${e.code || '?'}) : ${e.message}`);
      return soft(repli, params, bloc);
    }
  };
  return { degraded, soft, softAvecRepli };
}

// ── GET /api/tours/:id/rapport ─────────────────────────────────────────────
router.get('/:id/rapport', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const tourId = parseInt(req.params.id, 10);
    if (!Number.isInteger(tourId) || tourId <= 0) {
      return res.status(400).json({ error: 'Identifiant de tournée invalide' });
    }

    const { degraded, soft, softAvecRepli } = fabriqueSoft();

    // ── 1. La tournée. SEULE requête essentielle du rapport : sans elle il
    // n'y a rien à raconter. Un repli `SELECT *` couvre les bases anciennes
    // où une colonne jointe manquerait (suiveurs, collection_type, is_demo).
    const tourRes = await softAvecRepli(
      `SELECT t.id, t.date, t.status, t.mode, t.collection_type, t.is_demo,
              t.started_at, t.completed_at, t.km_start, t.km_end, t.notes,
              t.estimated_distance_km, t.estimated_duration_min, t.total_weight_kg,
              t.vehicle_id, v.registration, v.name AS vehicle_name, v.max_capacity_kg,
              t.driver_employee_id,
              NULLIF(TRIM(CONCAT(e.first_name, ' ', e.last_name)), '') AS driver_name,
              t.suiveur1_employee_id,
              NULLIF(TRIM(CONCAT(s1.first_name, ' ', s1.last_name)), '') AS suiveur1_name,
              t.suiveur2_employee_id,
              NULLIF(TRIM(CONCAT(s2.first_name, ' ', s2.last_name)), '') AS suiveur2_name
         FROM tours t
         LEFT JOIN vehicles v ON v.id = t.vehicle_id
         LEFT JOIN employees e ON e.id = t.driver_employee_id
         LEFT JOIN employees s1 ON s1.id = t.suiveur1_employee_id
         LEFT JOIN employees s2 ON s2.id = t.suiveur2_employee_id
        WHERE t.id = $1`,
      'SELECT * FROM tours WHERE id = $1',
      [tourId],
      'tour'
    );
    if (tourRes.rows.length === 0) {
      return res.status(404).json({ error: 'Tournée non trouvée' });
    }
    const t = tourRes.rows[0];
    const estAssociation = t.collection_type === 'association';

    // ── 2. Le programme : trois tables, une seule échelle de position.
    // Les trois sont interrogées quel que soit le type de tournée — une
    // tournée association a des arrêts au centre comme les autres, et une
    // base ancienne peut porter des lignes des deux familles.
    const [cavRes, assoRes, arretRes] = await Promise.all([
      softAvecRepli(
        `SELECT tc.id, tc.cav_id AS ref_id, tc.position, tc.status,
                tc.fill_level, tc.fill_percent, tc.skip_reason, tc.remballe,
                tc.collected_at, tc.notes, tc.planned_passage_time,
                c.name, c.address, c.commune, c.latitude, c.longitude, c.nb_containers
           FROM tour_cav tc
           JOIN cav c ON c.id = tc.cav_id
          WHERE tc.tour_id = $1`,
        `SELECT tc.id, tc.cav_id AS ref_id, tc.position, tc.status,
                tc.fill_level, NULL::double precision AS fill_percent,
                NULL::varchar AS skip_reason, NULL::boolean AS remballe,
                tc.collected_at, tc.notes, NULL::timestamp AS planned_passage_time,
                c.name, c.address, c.commune, c.latitude, c.longitude, c.nb_containers
           FROM tour_cav tc
           JOIN cav c ON c.id = tc.cav_id
          WHERE tc.tour_id = $1`,
        [tourId],
        'points_cav'
      ),
      // `tour_association_point` n'a PAS de colonne skip_reason : le motif de
      // saut d'un point association est consigné dans `notes` par le mobile.
      // On expose donc null plutôt qu'un motif fabriqué.
      soft(
        `SELECT tap.id, tap.association_point_id AS ref_id, tap.position, tap.status,
                tap.fill_level, NULL::double precision AS fill_percent,
                NULL::varchar AS skip_reason, tap.remballe,
                tap.collected_at, tap.arrived_at, tap.notes, tap.planned_passage_time,
                ap.name, ap.address, ap.ville AS commune, ap.latitude, ap.longitude,
                NULL::int AS nb_containers
           FROM tour_association_point tap
           JOIN association_points ap ON ap.id = tap.association_point_id
          WHERE tap.tour_id = $1`,
        [tourId],
        'points_association'
      ),
      soft(
        `SELECT ta.id, ta.lieu_id AS ref_id, ta.position, ta.status, ta.notes,
                ta.motif, ta.arrived_at, ta.completed_at,
                COALESCE(ta.libelle, lt.nom) AS name,
                lt.adresse AS address, lt.latitude, lt.longitude,
                lt.categorie, lt.duree_min
           FROM tour_arret_technique ta
           LEFT JOIN lieux_techniques lt ON lt.id = ta.lieu_id
          WHERE ta.tour_id = $1`,
        [tourId],
        'arrets'
      ),
    ]);

    const brut = [
      ...cavRes.rows.map((r) => ({ ...r, kind: 'cav' })),
      ...assoRes.rows.map((r) => ({ ...r, kind: 'association' })),
      ...arretRes.rows.map((r) => ({ ...r, kind: 'arret_technique' })),
    ].sort((a, b) => (num(a.position) - num(b.position))
      || (rangKind(a.kind) - rangKind(b.kind))
      || (num(a.id) - num(b.id)));

    // Le RANG est recalculé séquentiellement : `position` garde un trou
    // définitif quand un point est retiré du programme (« 1, 2, 3, 4, 6 »), et
    // ce trou se lit comme un point oublié. La valeur brute reste exposée pour
    // qui doit recouper avec la base.
    const points = brut.map((p, i) => {
      const estArret = p.kind === 'arret_technique';
      // Heure réelle : arrivée déclarée pour un arrêt, heure de collecte pour
      // un point. Le champ d'origine est nommé pour que le lecteur sache ce
      // qu'il compare.
      // Heure réelle de passage. Pour un ARRÊT technique comme pour un point
      // ASSOCIATION, c'est l'ARRIVÉE : c'est elle qu'on compare à l'heure
      // prévue. Sur une association, le départ (`collected_at`) arrive après un
      // temps de chargement très variable — s'en servir ferait passer pour un
      // retard le temps passé à travailler. Une borne de rue n'a pas d'arrivée
      // distincte : la collecte y est le passage.
      const heureReelle = p.arrived_at || p.collected_at || null;
      const fillPercent = num(p.fill_percent);
      const fillLevel = num(p.fill_level);
      // Remplissage : le pourcentage RÉELLEMENT saisi fait foi. L'échelle
      // historique 0-5 (lue ×20) ne sert que de repli, et elle est signalée
      // comme telle — le mobile plafonnant à 4, elle sous-estime « plein ».
      let fillEffectif = null;
      let fillSource = null;
      if (fillPercent !== null) { fillEffectif = fillPercent; fillSource = 'reel'; }
      else if (fillLevel !== null) { fillEffectif = fillLevel * 20; fillSource = 'echelle_0_5'; }

      return {
        rank: i + 1,
        kind: p.kind,
        id: p.id,
        ref_id: p.ref_id ?? null,
        position: num(p.position),
        name: p.name ?? null,
        address: p.address ?? null,
        commune: p.commune ?? null,
        latitude: num(p.latitude),
        longitude: num(p.longitude),
        nb_containers: num(p.nb_containers),
        status: p.status ?? null,
        // Heure prévue telle qu'elle a été CALCULÉE et posée au démarrage de
        // la tournée. Absente = `null` : on ne reconstitue pas après coup une
        // heure « prévue » par répartition linéaire, qui n'a jamais été
        // promise à personne et se lirait pourtant comme un engagement.
        planned_passage_time: p.planned_passage_time ?? null,
        planned_source: p.planned_passage_time ? 'calcule' : null,
        actual_time: heureReelle,
        actual_time_field: p.arrived_at ? 'arrived_at' : (p.collected_at ? 'collected_at' : null),
        completed_at: estArret ? (p.completed_at ?? null) : null,
        delay_minutes: ecartMinutes(p.planned_passage_time, heureReelle),
        fill_level: fillLevel,
        fill_percent: fillPercent,
        fill_effective_percent: arrondi(fillEffectif),
        fill_source: fillSource,
        skip_reason: p.skip_reason ?? null,
        skip_reason_label: libelleSkipReason(p.skip_reason),
        motif: estArret ? (p.motif ?? null) : null,
        motif_label: estArret ? (LIBELLE_MOTIF[p.motif] || p.name || 'Arrêt technique') : null,
        lieu_categorie: estArret ? (p.categorie ?? null) : null,
        duree_prevue_min: estArret ? num(p.duree_min) : null,
        remballe: p.remballe ?? null,
        notes: p.notes ?? null,
      };
    });

    // ── 3. Pesées, incidents, consignes, GPS, checklist, fin de journée.
    const startedAt = t.started_at || null;
    const completedAt = t.completed_at || null;
    const [weightRes, incidentRes, messageRes, gpsRes, checklistRes, eodRes] = await Promise.all([
      soft(
        `SELECT w.id, w.weight_kg, w.tare_kg, w.is_intermediate, w.notes, w.recorded_at,
                NULLIF(TRIM(CONCAT(e.first_name, ' ', e.last_name)), '') AS recorded_by_name
           FROM tour_weights w
           LEFT JOIN employees e ON e.id = w.recorded_by
          WHERE w.tour_id = $1
          ORDER BY w.recorded_at, w.id`,
        [tourId],
        'weights'
      ),
      soft(
        `SELECT i.id, i.type, i.status, i.description, i.created_at,
                i.resolved_at, i.resolution_notes, i.cav_id, i.photo_path,
                NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), '') AS resolved_by_name
           FROM incidents i
           LEFT JOIN users u ON u.id = i.resolved_by
          WHERE i.tour_id = $1
          ORDER BY i.created_at, i.id`,
        [tourId],
        'incidents'
      ),
      // `driver_messages` ne porte QU'UN SEUL sens : gestionnaire → chauffeur
      // (aucune écriture de l'application mobile, cf. index.js et live-edit.js
      // — le mobile ne fait qu'accuser réception). Le sens est donc exposé en
      // clair et constant, plutôt que laissé à deviner.
      // Deux rattachements : la consigne portant l'identifiant de la tournée,
      // et celle adressée au véhicule SANS tournée pendant que celle-ci
      // roulait — elle a bien été reçue par cet équipage, ce jour-là.
      soft(
        `SELECT dm.id, dm.tour_id, dm.vehicle_id, dm.message, dm.created_at, dm.read_at,
                NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), '') AS sender_name
           FROM driver_messages dm
           LEFT JOIN users u ON u.id = dm.created_by
          WHERE dm.tour_id = $1
             OR ($2::int IS NOT NULL
                 AND dm.tour_id IS NULL
                 AND dm.vehicle_id = $2::int
                 AND $3::timestamp IS NOT NULL
                 AND dm.created_at >= $3::timestamp
                 AND dm.created_at <= COALESCE($4::timestamp, NOW()))
          ORDER BY dm.created_at, dm.id`,
        [tourId, t.vehicle_id ?? null, startedAt, completedAt],
        'messages'
      ),
      soft(
        `SELECT latitude, longitude, speed, recorded_at
           FROM gps_positions
          WHERE tour_id = $1
          ORDER BY recorded_at, id
          LIMIT ${GPS_LECTURE_MAX + 1}`,
        [tourId],
        'gps'
      ),
      soft(
        `SELECT vc.id, vc.exterior_ok, vc.fuel_level, vc.km_start, vc.km_end,
                vc.notes, vc.degats, vc.reponses, vc.created_at,
                NULLIF(TRIM(CONCAT(e.first_name, ' ', e.last_name)), '') AS employee_name
           FROM vehicle_checklists vc
           LEFT JOIN employees e ON e.id = vc.employee_id
          WHERE vc.tour_id = $1
          ORDER BY vc.created_at, vc.id
          LIMIT 1`,
        [tourId],
        'checklist'
      ),
      soft(
        `SELECT d.id, d.chauffeur_non_fume, d.chauffeur_pas_objet_personnel,
                d.suiveur_non_fume, d.suiveur_pas_objet_personnel,
                d.binome_vehicule_vide, d.binome_vehicule_ok,
                d.remarques, d.created_at,
                NULLIF(TRIM(CONCAT(e.first_name, ' ', e.last_name)), '') AS employee_name
           FROM tour_end_of_day_declarations d
           LEFT JOIN employees e ON e.id = d.employee_id
          WHERE d.tour_id = $1
          ORDER BY d.created_at DESC, d.id DESC
          LIMIT 1`,
        [tourId],
        'end_of_day'
      ),
    ]);

    // ── 4. Pesées : la somme porte sur TOUTES les lignes, intermédiaires
    // comprises. Une pesée intermédiaire n'est pas un relevé provisoire, c'est
    // un chargement réellement déposé au centre par un chauffeur qui repart
    // collecter (correctif d'août 2026 : les exclure faisait disparaître les
    // kilos du total, du tonnage et des entrées de stock).
    const weights = weightRes.rows.map((w) => ({
      id: w.id,
      weight_kg: num(w.weight_kg),
      tare_kg: num(w.tare_kg),
      is_intermediate: w.is_intermediate === true,
      recorded_at: w.recorded_at ?? null,
      recorded_by_name: w.recorded_by_name ?? null,
      notes: w.notes ?? null,
    }));
    const totalWeight = weights.reduce((s, w) => s + (w.weight_kg || 0), 0);

    const incidents = incidentRes.rows.map((i) => ({
      id: i.id,
      type: i.type ?? null,
      status: i.status ?? null,
      description: i.description ?? null,
      created_at: i.created_at ?? null,
      resolved_at: i.resolved_at ?? null,
      resolution_notes: i.resolution_notes ?? null,
      resolved_by_name: i.resolved_by_name ?? null,
      cav_id: i.cav_id ?? null,
      photo_path: i.photo_path ?? null,
    }));

    const messages = messageRes.rows.map((m) => ({
      id: m.id,
      sens: 'gestionnaire_vers_chauffeur',
      message: m.message ?? null,
      created_at: m.created_at ?? null,
      read_at: m.read_at ?? null,
      // L'accusé de lecture n'existe QUE si le chauffeur a tapé « J'ai
      // compris ». `false` dit « non acquitté », pas « non lu ».
      acquitte: m.read_at != null,
      sender_name: m.sender_name ?? null,
      rattachement: m.tour_id != null ? 'tournee' : 'vehicule_pendant_la_tournee',
    }));

    // ── 5. Trace GPS. La distance est calculée sur la trace COMPLÈTE (même
    // formule que live-summary), l'échantillonnage ne sert qu'à l'affichage.
    let gpsRows = gpsRes.rows;
    const gpsTronque = gpsRows.length > GPS_LECTURE_MAX;
    if (gpsTronque) gpsRows = gpsRows.slice(0, GPS_LECTURE_MAX);

    let distanceKm = null;
    for (let i = 1; i < gpsRows.length; i += 1) {
      const a = gpsRows[i - 1];
      const b = gpsRows[i];
      const la = num(a.latitude); const lo = num(a.longitude);
      const lb = num(b.latitude); const lob = num(b.longitude);
      if (la === null || lo === null || lb === null || lob === null) continue;
      distanceKm = (distanceKm || 0) + haversineKm(la, lo, lb, lob);
    }
    distanceKm = arrondi(distanceKm);

    // Échantillonnage RÉGULIER : on garde un point sur `pas`, où `pas` est
    // calculé pour ne jamais dépasser la cible. Régulier et non « un point sur
    // deux jusqu'à ce que ça tienne » : le pas constant préserve la forme du
    // trajet (les zones denses restent denses proportionnellement) alors qu'un
    // filtrage par distance écraserait les arrêts. Le DERNIER point est
    // toujours conservé, sans quoi la trace s'arrêterait avant le retour.
    const pas = gpsRows.length > GPS_ECHANTILLON_CIBLE
      ? Math.ceil(gpsRows.length / GPS_ECHANTILLON_CIBLE)
      : 1;
    const echantillon = gpsRows
      .filter((_, i) => i % pas === 0 || i === gpsRows.length - 1)
      .map((p) => ({
        latitude: num(p.latitude),
        longitude: num(p.longitude),
        speed: num(p.speed),
        recorded_at: p.recorded_at ?? null,
      }));

    const gpsTrack = {
      total_positions: gpsRows.length,
      returned_positions: echantillon.length,
      sampling_step: pas,
      tronque: gpsTronque,
      positions: echantillon,
    };

    // ── 6. Itinéraire PRÉVISIONNEL : les points dans l'ordre planifié, plus
    // le centre de tri (départ et retour). C'est ce qui permet de tracer le
    // prévu face au réalisé. Un point sans coordonnées est EXCLU du tracé et
    // COMPTÉ : une ligne qui saute un point sans le dire ment sur le trajet.
    const centre = await centreDeTri(pool).catch(() => null);
    const avecCoords = points.filter((p) => p.latitude !== null && p.longitude !== null);
    const plannedRoute = {
      centre_tri: centre
        ? {
          id: centre.id ?? null,
          nom: centre.nom ?? null,
          adresse: centre.adresse ?? null,
          latitude: num(centre.latitude),
          longitude: num(centre.longitude),
          // `id` nul = le référentiel `lieux_techniques` n'a pas encore été
          // semé : les coordonnées viennent alors des variables
          // d'environnement CENTRE_TRI_LAT/LNG. Le dire évite de présenter un
          // repli comme une donnée du référentiel.
          source: centre.id != null ? 'referentiel' : 'environnement',
        }
        : null,
      waypoints: avecCoords.map((p) => ({
        rank: p.rank,
        kind: p.kind,
        name: p.name,
        latitude: p.latitude,
        longitude: p.longitude,
      })),
      nb_points_sans_coordonnees: points.length - avecCoords.length,
    };

    // ── 7. Indicateurs.
    const pointsCollecte = points.filter((p) => p.kind !== 'arret_technique');
    const nbCollected = pointsCollecte.filter((p) => p.status === 'collected').length;
    const nbSkipped = pointsCollecte.filter((p) => p.status === 'skipped').length;
    const nbIncidentPoint = pointsCollecte.filter((p) => p.status === 'incident').length;
    const nbPending = pointsCollecte.filter((p) => p.status === 'pending' || p.status === 'in_progress').length;

    const debut = dateOuNull(startedAt);
    const fin = dateOuNull(completedAt);
    const durationMin = debut && fin ? Math.round((fin.getTime() - debut.getTime()) / 60000) : null;
    let durationMotif = null;
    if (durationMin === null) {
      if (!debut && !fin) durationMotif = 'Heures de début et de fin non enregistrées';
      else if (!debut) durationMotif = 'Heure de début non enregistrée';
      else durationMotif = 'Tournée non clôturée : heure de fin absente';
    }

    const fillMesures = pointsCollecte
      .map((p) => p.fill_effective_percent)
      .filter((v) => v !== null);
    const avgFill = fillMesures.length > 0
      ? arrondi(fillMesures.reduce((s, v) => s + v, 0) / fillMesures.length)
      : null;

    const ecarts = points.map((p) => p.delay_minutes).filter((v) => v !== null);
    const avgDelay = ecarts.length > 0
      ? Math.round(ecarts.reduce((s, v) => s + v, 0) / ecarts.length)
      : null;

    const kmStart = num(t.km_start);
    const kmEnd = num(t.km_end);
    const kmDriven = kmStart !== null && kmEnd !== null && kmEnd >= kmStart ? kmEnd - kmStart : null;

    const kpis = {
      duration_min: durationMin,
      duration_motif: durationMotif,
      estimated_duration_min: num(t.estimated_duration_min),
      // Distance RÉELLE, mesurée sur les relevés GPS. Deux positions au moins
      // sont nécessaires : sans elles la distance vaut `null` et non 0 — un
      // camion qui n'a pas émis n'est pas un camion qui n'a pas roulé.
      distance_km: distanceKm,
      distance_motif: distanceKm === null
        ? (gpsRows.length === 0
          ? 'Aucun relevé GPS enregistré pour cette tournée'
          : 'Relevés GPS insuffisants pour mesurer une distance')
        : null,
      distance_source: distanceKm === null ? null : 'gps',
      estimated_distance_km: num(t.estimated_distance_km),
      // Kilométrage au compteur : indépendant du GPS, il vient de la saisie du
      // chauffeur (checklist de départ, déclaration de retour).
      km_start: kmStart,
      km_end: kmEnd,
      km_driven: kmDriven,
      nb_points_total: pointsCollecte.length,
      nb_points_collected: nbCollected,
      nb_points_skipped: nbSkipped,
      nb_points_incident: nbIncidentPoint,
      nb_points_pending: nbPending,
      nb_arrets: points.length - pointsCollecte.length,
      progress_percent: pointsCollecte.length > 0
        ? Math.round((nbCollected / pointsCollecte.length) * 100)
        : null,
      // Le poids vient des pesées quand il y en a — leur somme EST la
      // définition. Quand il n'y en a aucune mais que la tournée porte un total
      // (reprise manuelle, import, historique d'avant la pesée mobile), on
      // l'affiche plutôt que d'imprimer « — » sur le chiffre principal du
      // rapport : dire « aucune pesée enregistrée » d'une tournée qui a bien
      // ramené 7 550 kg serait faux. La provenance est dite dans tous les cas.
      total_weight_kg: weights.length > 0
        ? arrondi(totalWeight)
        : (num(t.total_weight_kg) || null),
      total_weight_source: weights.length > 0
        ? 'pesees'
        : (num(t.total_weight_kg) ? 'total_tournee' : null),
      nb_weighings: weights.length,
      nb_weighings_intermediate: weights.filter((w) => w.is_intermediate).length,
      total_weight_motif: weights.length > 0
        ? null
        : (num(t.total_weight_kg)
          ? 'Aucune pesée détaillée — total porté par la tournée'
          : 'Aucune pesée enregistrée'),
      avg_fill_percent: avgFill,
      avg_fill_nb_points: fillMesures.length,
      avg_fill_motif: avgFill === null ? 'Aucun niveau de remplissage relevé' : null,
      avg_delay_min: avgDelay,
      avg_delay_nb_points: ecarts.length,
      nb_incidents: incidents.length,
      nb_incidents_open: incidents.filter((i) => i.status === 'open' || i.status === 'in_progress').length,
    };

    // ── 7bis. Arrêts GPS. Bloc à part entière et donc DÉGRADABLE seul : le
    // module d'analyse lit une table qui peut manquer sur une base non migrée,
    // et un compte rendu sans arrêts reste un compte rendu. Le motif remonte
    // dans la réponse : « aucun relevé GPS » et « analyse indisponible » ne se
    // lisent pas de la même façon.
    let arretsGps = { arrets: [], source: 'indisponible', motif: null };
    try {
      const { arretsPourAffichage } = require('./analyse-gps');
      arretsGps = await arretsPourAffichage(tourId, t.status, pool);
    } catch (e) {
      console.error(`[TOURS] rapport — bloc « arrets_gps » ignoré (${e.code || '?'}) : ${e.message}`);
      if (!degraded.includes('arrets_gps')) degraded.push('arrets_gps');
      arretsGps = { arrets: [], source: 'indisponible', motif: "Analyse des arrêts GPS indisponible" };
    }

    // Temps mesuré PAR POINT du programme : la durée de l'arrêt rattaché à ce
    // point. C'est le « temps de vidage » réel, à mettre en regard du niveau de
    // remplissage relevé. Un point sans arrêt rattaché n'en reçoit AUCUNE — pas
    // un zéro : le camion s'y est peut-être arrêté moins longtemps que le seuil
    // de détection, ou n'a pas émis.
    const dureeParCav = new Map();
    const dureeParAsso = new Map();
    for (const a of arretsGps.arrets || []) {
      const d = num(a.duree_min);
      if (d === null) continue;
      if (a.cav_id != null) dureeParCav.set(a.cav_id, (dureeParCav.get(a.cav_id) || 0) + d);
      if (a.association_point_id != null) {
        dureeParAsso.set(a.association_point_id, (dureeParAsso.get(a.association_point_id) || 0) + d);
      }
    }
    for (const p of points) {
      if (p.kind === 'cav') p.stop_duration_min = arrondi(dureeParCav.get(p.ref_id) ?? null);
      else if (p.kind === 'association') p.stop_duration_min = arrondi(dureeParAsso.get(p.ref_id) ?? null);
      else p.stop_duration_min = null;
    }

    const suiveurs = [
      { id: t.suiveur1_employee_id ?? null, name: t.suiveur1_name ?? null },
      { id: t.suiveur2_employee_id ?? null, name: t.suiveur2_name ?? null },
    ].filter((s) => s.id != null || s.name != null);

    /**
     * La vérification du camion, telle qu'elle doit être IMPRIMÉE : l'heure à
     * laquelle elle s'est terminée, ce qui n'a PAS été validé, les dégâts
     * relevés, le carburant et le kilométrage.
     *
     * `terminee_a` vaut `created_at` : la ligne est écrite au moment où le
     * chauffeur valide l'écran, il n'existe pas d'autre horodatage. Le champ
     * est nommé pour ce qu'il dit, et cette équivalence est assumée ici plutôt
     * que devinée par chaque écran.
     */
    function checklist() {
      const c = checklistRes.rows[0];
      if (!c) return null;
      const reponses = Array.isArray(c.reponses) ? c.reponses : [];
      const degats = Array.isArray(c.degats) ? c.degats : [];
      return {
        id: c.id,
        created_at: c.created_at ?? null,
        terminee_a: c.created_at ?? null,
        employee_name: c.employee_name ?? null,
        exterior_ok: c.exterior_ok ?? null,
        fuel_level: c.fuel_level ?? null,
        km_start: num(c.km_start),
        km_end: num(c.km_end),
        notes: c.notes ?? null,
        degats,
        nb_degats: degats.length,
        reponses,
        points_verifies: reponses.length,
        // Ce qui doit déclencher une action, isolé : le lecteur du rapport n'a
        // pas à relire onze lignes conformes pour trouver la douzième.
        points_non_valides: reponses.filter((x) => x && x.ok !== true),
        // Une checklist enregistrée avant août 2026 ne conserve que son
        // booléen global : le détail est ABSENT, ce qui n'est pas la même
        // chose que « rien à signaler ». On le dit.
        detail_disponible: reponses.length > 0,
      };
    }

    // Avertissements destinés au lecteur du rapport, pas au développeur : ils
    // disent pourquoi un chiffre pourrait surprendre.
    const warnings = [];
    if (t.status !== 'completed') {
      warnings.push("Cette tournée n'est pas clôturée : les chiffres sont partiels.");
    }
    if (t.is_demo === true) {
      warnings.push('Tournée de DÉMONSTRATION (formation) : aucune donnée réelle.');
    }
    if (gpsTronque) {
      warnings.push(`Trace GPS tronquée aux ${GPS_LECTURE_MAX} premiers relevés.`);
    }
    if (degraded.length > 0) {
      warnings.push(`Données indisponibles pour : ${degraded.join(', ')}.`);
    }

    // Le document réunit-il des positions horodatées ET l'identité de celui qui
    // conduisait ? C'est cette CONJONCTION qui fait la sensibilité — un rapport
    // sans conducteur affecté (cas fréquent : le mobile s'authentifie par un
    // lien de véhicule) ne l'a pas, et une tournée sans arrêt détecté non plus.
    const contientDonneesLocalisationNominatives = (arretsGps.arrets || []).length > 0
      && (t.driver_employee_id != null || (t.driver_name != null && String(t.driver_name).trim() !== ''));

    // Trace de consultation (contrepartie de l'arbitrage « on garde le nom »).
    // Best effort, jamais bloquant : le rapport part de toute façon.
    journaliserConsultationRapport(req, tourId, {
      date: t.date ?? null,
      vehicle_id: t.vehicle_id ?? null,
      driver_employee_id: t.driver_employee_id ?? null,
      nb_arrets_gps: (arretsGps.arrets || []).length,
      arrets_source: arretsGps.source || 'indisponible',
      geolocalisation_nominative: contientDonneesLocalisationNominatives,
    });

    res.json({
      generated_at: new Date().toISOString(),
      tour: {
        id: t.id,
        date: t.date ?? null,
        status: t.status ?? null,
        is_completed: t.status === 'completed',
        mode: t.mode ?? null,
        collection_type: t.collection_type ?? null,
        is_association: estAssociation,
        is_demo: t.is_demo === true,
        started_at: startedAt,
        completed_at: completedAt,
        km_start: kmStart,
        km_end: kmEnd,
        notes: t.notes ?? null,
        vehicle: {
          id: t.vehicle_id ?? null,
          registration: t.registration ?? null,
          name: t.vehicle_name ?? null,
          max_capacity_kg: num(t.max_capacity_kg),
        },
        // Nullable PAR CONCEPTION : le mobile s'authentifie par un lien de
        // VÉHICULE (« 1 URL = 1 véhicule »), une tournée peut donc rouler sans
        // fiche employé identifiée. `null` est ici une réponse, pas un trou.
        driver: {
          id: t.driver_employee_id ?? null,
          name: t.driver_name ?? null,
        },
        suiveurs,
      },
      kpis,
      // Le programme dans l'ordre : bornes, points association et arrêts au
      // centre de tri confondus — c'est la journée telle qu'elle s'est déroulée.
      points,
      weights,
      incidents,
      messages,
      gps_track: gpsTrack,
      planned_route: plannedRoute,
      checklist: checklist(),
      end_of_day: eodRes.rows[0] || null,
      // Arrêts détectés sur la trace GPS. `source` dit d'où vient la liste :
      // « table » = figée à la clôture, « live » = recalculée à l'instant (donc
      // susceptible de bouger), « indisponible » = rien de fiable à montrer.
      arrets_gps: {
        arrets: arretsGps.arrets || [],
        source: arretsGps.source || 'indisponible',
        motif: arretsGps.motif ?? null,
        seuil_min: arretsGps.seuil_min ?? null,
        rayon_m: arretsGps.rayon_m ?? null,
        nb_inconnus: (arretsGps.arrets || []).filter((a) => a.type === 'inconnu').length,
      },
      // Mention de confidentialité — présente UNIQUEMENT quand le document
      // réunit effectivement des arrêts géolocalisés ET un conducteur nommé.
      // La rendre inconditionnelle la banaliserait : une page qui avertit à
      // chaque fois n'avertit plus. `null` = ce rapport n'a rien à déclarer.
      confidentialite: contientDonneesLocalisationNominatives
        ? {
          niveau: 'geolocalisation_nominative',
          mention: 'Document contenant des données de géolocalisation rattachées à un conducteur identifié. '
            + "Usage réservé au pilotage de l'exploitation (ajustement des temps de vidage et des durées de tournée) — "
            + 'jamais au décompte du temps de travail. Diffusion limitée aux responsables d\'exploitation. '
            + 'Consultation journalisée. Arrêts conservés au maximum 90 jours, comme les relevés GPS dont ils sont issus.',
        }
        : null,
      // Blocs dont la lecture a échoué (base non migrée, table absente) : le
      // rapport reste servi, amputé, mais il le DIT.
      degraded,
      warnings,
    });
  } catch (err) {
    console.error('[TOURS] Erreur rapport :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
