const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { authenticate, authorize } = require('../../middleware/auth');
const { imageFilter } = require('../../utils/upload-filters');

// Upload photos incidents
const photoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '..', '..', '..', 'uploads', 'incidents');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).replace(/[^a-zA-Z0-9.]/g, '');
    cb(null, `incident_${Date.now()}${ext}`);
  },
});
// T1.1 : whitelist image — bloque l'upload de fichiers exécutables / SVG+JS
// qui pourraient être réfléchis via /uploads/incidents.
const upload = multer({ storage: photoStorage, limits: { fileSize: 10 * 1024 * 1024 }, fileFilter: imageFilter });

// Upload photos de collecte (audit aléatoire — une par tournée, FillLevel.jsx)
const collectePhotoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '..', '..', '..', 'uploads', 'collectes');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).replace(/[^a-zA-Z0-9.]/g, '');
    cb(null, `collecte_${Date.now()}${ext}`);
  },
});
const uploadCollectePhoto = multer({ storage: collectePhotoStorage, limits: { fileSize: 10 * 1024 * 1024 }, fileFilter: imageFilter });

// Upload photo DU POINT (CAV) prise par le chauffeur — exigence 08/2026.
// Même dossier que les photos posées au back-office (uploads/cav-photos) : ce
// n'est pas une pièce de tournée mais LA photo de référence du CAV, qui remonte
// sur la fiche du point (AdminCAV) et dont la fraîcheur pilote la redemande.
const cavPhotoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '..', '..', '..', 'uploads', 'cav-photos');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).replace(/[^a-zA-Z0-9.]/g, '');
    const cavId = String(req.params.cavId || '').replace(/\D/g, '') || 'x';
    cb(null, `cav_${cavId}_${Date.now()}${ext}`);
  },
});
const uploadCavPhoto = multer({ storage: cavPhotoStorage, limits: { fileSize: 10 * 1024 * 1024 }, fileFilter: imageFilter });

// Un refus de `imageFilter` (ou un dépassement de taille) doit ressortir en
// 400/413 explicite côté mobile, pas en 500 opaque via le handler global.
function uploadPhotoOr400(mw) {
  return (req, res, next) => mw(req, res, (err) => {
    if (!err) return next();
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'Photo trop volumineuse (max 10 Mo)' });
    return res.status(400).json({ error: err.message || 'Fichier refusé (jpg, png, webp)' });
  });
}

// Fraîcheur de la photo du CAV — seuil paramétrable `collecte.photo_fraicheur_mois`.
const { getPhotoFraicheurMois, photoRequise } = require('../../utils/cav-photo');
const { arretsPourMobile, avancerRetourCentre, cloturerDepartCentre, centreDeTri, SUITE_MOTIF } = require('./arrets');

// Sub-routers
const crudRouter = require('./crud');
const proposalsRouter = require('./proposals');
const createExecutionRouter = require('./execution');
const eventsRouter = require('./events');
const eventsAutoRouter = require('./events-auto');
const statsRouter = require('./stats');
const liveSummaryRouter = require('./live-summary');
const activeSummaryRouter = require('./active-summary');
const reoptimizeRouter = require('./reoptimize');
const planningRouter = require('./planning');
const dashboardRouter = require('./dashboard');
const { ensurePlannedPassages } = require('./planned-passage');
const { applyCompletionSideEffects } = require('./completion-effects');
// Session chauffeur « 1 URL = 1 véhicule » : le véhicule est lu dans le claim
// `vehicle_id` du jeton et, en repli, dans le `username` historique
// « driver_<vehicleId> ». Helper partagé avec routes/tours/execution.js.
const { driverVehicleIdFromToken, resolveDriverEmployeeId } = require('./driver-session');
const {
  proposeReoptimization,
  applyReoptimization,
  rejectReoptimization,
} = require('./reoptimize-service');
const { sendPushToRoles } = require('../../services/push-notifications');
const { isDemoTour, isDemoTourId } = require('../../services/demo-mode');

// ── Endpoints publics (mobile sans auth) ──────────────────────────────

const pool = require('../../config/database');

// ── Auth chauffeur sur les routes mobile historiquement « publiques » ──────
// Audit 07/2026 : le détail de tournée et les actions de collecte (démarrer,
// collecter, peser, incident, statut, scan, ré-optim) étaient exposés SANS
// authentification, avec un :id de tournée/véhicule énumérable — n'importe qui
// sur Internet pouvait lire les tournées (adresses CAV, GPS) ou falsifier
// anonymement tonnage/pesées/incidents. Elles exigent désormais le JWT
// chauffeur émis par POST /auth/driver-start ; le mobile le joint et se
// ré-authentifie de façon transparente (mobile/src/services/authedFetch.js).
// Les URLs « -public »/« /public »/« /today » sont conservées à l'identique
// pour éviter une migration d'URL coordonnée — seule l'exigence d'auth change.
const MOBILE_DRIVER_PATH = /(-public(\/|$))|(^\/[^/]+\/public$)|(^\/vehicle\/[^/]+\/today$)/;

// ── Vague 3 — Contre-vérification JWT ↔ véhicule (durcissement) ─────────────
// Résiduel vague 2 (point 4) : le JWT chauffeur était exigé, mais AUCUN contrôle
// ne liait la requête au véhicule du token — un chauffeur (ou un raccourci
// détourné) portant le token du véhicule A pouvait agir sur les tournées/pesées/
// incidents/consignes du véhicule B (id de tournée/véhicule énumérable).
// Le JWT de POST /auth/driver-start encode le véhicule dans son `username` :
// « driver_<vehicleId> » (tous les chauffeurs partagent un user générique — seul
// l'username distingue le véhicule). On en dérive le véhicule autorisé et on
// refuse (403) toute cible d'un autre véhicule. Le flux légitime (le chauffeur
// agit TOUJOURS sur son véhicule) est inchangé.

// Refuse (403) si le token chauffeur cible un véhicule différent du sien.
//   - tokenVehId null → token NON chauffeur (ADMIN/MANAGER en supervision, ou
//     tout autre compte authentifié) : comportement historique inchangé, aucune
//     restriction ajoutée (zéro régression pour les appelants non-mobile).
//   - vehId null → cible inconnue (tournée/message introuvable) : on laisse le
//     handler répondre 404 ; aucune donnée d'un autre véhicule n'est exposée.
function driverVehicleMismatch(req, res, vehId) {
  const tokenVehId = driverVehicleIdFromToken(req.user);
  if (tokenVehId == null) return false;
  if (vehId == null) return false;
  if (Number(vehId) !== tokenVehId) {
    res.status(403).json({ error: 'Ce véhicule ne correspond pas à votre session chauffeur' });
    return true;
  }
  return false;
}

// Garde de périmètre véhicule appliquée aux routes mobiles « -public » après
// authentification. read-public / history-public sont bornées dans leur handler
// (elles chargent déjà leur entité → pas de requête supplémentaire ici).
async function enforceDriverVehicleScope(req, res, next) {
  try {
    const tokenVehId = driverVehicleIdFromToken(req.user);
    if (tokenVehId == null) return next(); // non-chauffeur : comportement inchangé

    const p = req.path;

    // Enforcées dans le handler (réutilisation de la requête existante).
    if (/\/history-public$/.test(p) || /^\/messages\/\d+\/read-public$/.test(p)) {
      return next();
    }

    // Flush GPS hors-ligne : chaque position doit porter le véhicule du chauffeur.
    if (/^\/gps-batch-public(\/|$)/.test(p)) {
      const positions = Array.isArray(req.body && req.body.positions) ? req.body.positions : [];
      const foreign = positions.some((pos) =>
        pos && pos.vehicle_id != null && parseInt(pos.vehicle_id, 10) !== tokenVehId);
      if (foreign) {
        return res.status(403).json({ error: 'Position GPS d\'un autre véhicule refusée' });
      }
      return next();
    }

    // Routes ciblant un véhicule par paramètre (/vehicle/:id/...) : compare sans requête.
    let m;
    if ((m = /^\/vehicle\/(\d+)(\/|$)/.exec(p))) {
      if (parseInt(m[1], 10) !== tokenVehId) {
        return res.status(403).json({ error: 'Ce véhicule ne correspond pas à votre session chauffeur' });
      }
      return next();
    }

    // Toutes les autres routes mobiles ciblent une tournée via /:tourId/... :
    // le véhicule de la tournée doit être celui du chauffeur.
    if ((m = /^\/(\d+)(\/|$)/.exec(p))) {
      const r = await pool.query('SELECT vehicle_id FROM tours WHERE id = $1', [parseInt(m[1], 10)]);
      const vehId = r.rows.length ? r.rows[0].vehicle_id : null;
      if (vehId != null && Number(vehId) !== tokenVehId) {
        return res.status(403).json({ error: 'Cette tournée ne correspond pas à votre véhicule' });
      }
      return next();
    }

    return next();
  } catch (err) {
    console.error('[TOURS] garde véhicule mobile:', err.message);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
}

router.use((req, res, next) => {
  if (!MOBILE_DRIVER_PATH.test(req.path)) return next();
  // 1. JWT chauffeur exigé, puis 2. le véhicule ciblé doit être celui du token.
  authenticate(req, res, (err) => {
    if (err) return next(err);
    enforceDriverVehicleScope(req, res, next);
  });
});

// ── Photo du point (exigence 08/2026) ───────────────────────────────────────
// Le mobile doit savoir, AVANT que le chauffeur reparte, si une photo du CAV est
// attendue : aucune photo en base, ou photo plus vieille que le seuil paramétré
// (`collecte.photo_fraicheur_mois`). La règle est évaluée CÔTÉ SERVEUR (source
// unique utils/cav-photo) et transmise en clair (`photo_requise`) — le mobile ne
// rejoue aucune règle de fraîcheur et fonctionne donc hors ligne sur la dernière
// tournée chargée.
//
// Les colonnes du CAV sont volontairement ALIASÉES `cav_photo_*` : `tour_cav`
// possède déjà sa propre colonne `photo_path` (photo d'audit aléatoire de la
// collecte, cf. collect-public) qui ne doit pas être écrasée dans le payload.
const CAV_PHOTO_COLUMNS = `c.photo_path AS cav_photo_path,
                c.photo_taken_at AS cav_photo_taken_at,
                c.photo_source AS cav_photo_source`;

async function decoratePhotoState(points, isAssociation) {
  const mois = await getPhotoFraicheurMois(pool);
  return {
    photo_fraicheur_mois: mois,
    points: points.map((p) => ({
      ...p,
      // Un point association n'est pas un CAV : l'exigence ne le concerne pas.
      photo_requise: isAssociation
        ? false
        : photoRequise(p.cav_photo_path, p.cav_photo_taken_at, mois),
    })),
  };
}

// GET /api/tours/vehicle/:vehicleId/today — Tournée du jour (JWT chauffeur requis)
router.get('/vehicle/:vehicleId/today', async (req, res) => {
  try {
    const { vehicleId } = req.params;
    const tourResult = await pool.query(
      `SELECT t.*, v.registration, v.name as vehicle_name,
              (SELECT COUNT(*) FROM tour_cav tc WHERE tc.tour_id = t.id) as nb_cav
       FROM tours t
       JOIN vehicles v ON v.id = t.vehicle_id
       WHERE t.vehicle_id = $1
         AND t.date = (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Paris')::date
         AND t.status IN ('planned', 'in_progress')
       ORDER BY t.id DESC LIMIT 1`,
      [vehicleId]
    );
    if (tourResult.rows.length === 0) {
      return res.json({ tour: null });
    }
    const tour = tourResult.rows[0];
    // Charger les points de la tournée selon le type de collecte
    let points = [];
    if (tour.collection_type === 'association') {
      const assoResult = await pool.query(
        `SELECT tap.id, tap.tour_id, tap.association_point_id as cav_id, tap.position, tap.status,
                tap.fill_level, tap.collected_at, tap.planned_passage_time, tap.notes,
                ap.name as cav_name, ap.address, ap.ville as commune, ap.latitude, ap.longitude,
                ap.contact_phone, NULL as nb_containers, NULL as qr_code_data
         FROM tour_association_point tap
         JOIN association_points ap ON ap.id = tap.association_point_id
         WHERE tap.tour_id = $1 ORDER BY tap.position`,
        [tour.id]
      );
      points = assoResult.rows;
    } else {
      const cavsResult = await pool.query(
        `SELECT tc.*, c.name as cav_name, c.address, c.commune, c.latitude, c.longitude,
                c.nb_containers, c.qr_code_data,
                ${CAV_PHOTO_COLUMNS}
         FROM tour_cav tc
         JOIN cav c ON c.id = tc.cav_id
         WHERE tc.tour_id = $1
         ORDER BY tc.position`,
        [tour.id]
      );
      points = cavsResult.rows;
    }
    const photoState = await decoratePhotoState(points, tour.collection_type === 'association');
    // Les arrêts de programme (retour au centre : vidage, pause, fin) voyagent
    // À CÔTÉ des points de collecte, dans une clé distincte : un mobile hors
    // ligne resté sur une ancienne version continue de lire `cavs` sans rien
    // perdre, et la carte fusionne les deux sur `position`.
    res.json({
      tour: { ...tour, photo_fraicheur_mois: photoState.photo_fraicheur_mois },
      cavs: photoState.points,
      arrets: await arretsPourMobile(tour.id),
    });
  } catch (err) {
    console.error('[TOURS] Erreur vehicle/today:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/tours/:id/public — Détail d'une tournée (public, pour mobile sans auth)
router.get('/:id/public', async (req, res) => {
  try {
    const tourResult = await pool.query(
      `SELECT t.*, v.registration, v.name as vehicle_name
       FROM tours t JOIN vehicles v ON v.id = t.vehicle_id
       WHERE t.id = $1`,
      [req.params.id]
    );
    if (tourResult.rows.length === 0) return res.status(404).json({ error: 'Tournée non trouvée' });
    const tour = tourResult.rows[0];

    let points = [];
    if (tour.collection_type === 'association') {
      // Charger les points association
      const assoResult = await pool.query(
        `SELECT tap.id, tap.tour_id, tap.association_point_id as cav_id, tap.position, tap.status,
                tap.fill_level, tap.collected_at, tap.planned_passage_time, tap.notes,
                ap.name as cav_name, ap.address, ap.ville as commune, ap.latitude, ap.longitude,
                ap.contact_phone, NULL as nb_containers, NULL as qr_code_data
         FROM tour_association_point tap
         JOIN association_points ap ON ap.id = tap.association_point_id
         WHERE tap.tour_id = $1 ORDER BY tap.position`,
        [tour.id]
      );
      points = assoResult.rows;
    } else {
      const cavsResult = await pool.query(
        `SELECT tc.*, c.name as cav_name, c.address, c.commune, c.latitude, c.longitude,
                c.nb_containers, c.qr_code_data,
                ${CAV_PHOTO_COLUMNS}
         FROM tour_cav tc JOIN cav c ON c.id = tc.cav_id
         WHERE tc.tour_id = $1 ORDER BY tc.position`,
        [tour.id]
      );
      points = cavsResult.rows;
    }
    const photoState = await decoratePhotoState(points, tour.collection_type === 'association');
    res.json({
      ...tour,
      photo_fraicheur_mois: photoState.photo_fraicheur_mois,
      cavs: photoState.points,
      arrets: await arretsPourMobile(tour.id),
    });
  } catch (err) {
    console.error('[TOURS] Erreur public/:id:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Vues et types de dégât acceptés sur le schéma du véhicule (constat de départ).
const DEGAT_VUES = ['avant', 'arriere', 'gauche', 'droit'];
const DEGAT_TYPES = ['rayure', 'choc', 'bris', 'autre'];

/**
 * Nettoie la liste de dégâts pointés sur le schéma (fonction PURE, exportée
 * pour les tests). Coordonnées RELATIVES bornées à [0,1], vue et type validés,
 * commentaire tronqué. Une entrée invalide est ignorée — jamais d'échec du
 * départ pour un point mal formé, et jamais de donnée fantaisiste stockée.
 */
/**
 * Normalise le détail du questionnaire de début de journée.
 * Chaque entrée conserve l'identifiant du point, son LIBELLÉ au moment de la
 * saisie (un référentiel qui évolue ne doit pas réécrire l'histoire) et la
 * réponse. Bornes de taille : le mobile ne dicte pas la charge acceptée.
 */
function sanitizeReponses(brut) {
  if (!Array.isArray(brut)) return [];
  return brut.slice(0, 50).map((r) => ({
    id: String(r?.id ?? '').slice(0, 60),
    libelle: String(r?.libelle ?? '').slice(0, 200),
    ok: r?.ok === true,
  })).filter((r) => r.id);
}

function sanitizeDegats(input) {
  if (!Array.isArray(input)) return null;
  const clean = input.slice(0, 40).map((d) => {
    if (!d || typeof d !== 'object') return null;
    const vue = DEGAT_VUES.includes(d.vue) ? d.vue : null;
    const x = Number(d.x); const y = Number(d.y);
    if (!vue || !Number.isFinite(x) || !Number.isFinite(y)) return null;
    return {
      vue,
      x: Math.max(0, Math.min(1, x)),
      y: Math.max(0, Math.min(1, y)),
      type: DEGAT_TYPES.includes(d.type) ? d.type : 'autre',
      commentaire: d.commentaire ? String(d.commentaire).trim().slice(0, 300) : null,
    };
  }).filter(Boolean);
  return clean.length > 0 ? clean : null;
}

/**
 * Message de prévention routière du jour (rotation déterministe sur le
 * quantième de l'année) : tous les chauffeurs voient le même message le même
 * jour, et il change chaque jour sans rien tirer au hasard. `null` si aucun
 * message actif n'est paramétré — l'écran mobile n'affiche alors rien.
 */
async function messagePreventionDuJour() {
  try {
    const r = await pool.query(
      'SELECT id, titre, texte FROM messages_prevention WHERE is_active = true ORDER BY ordre, id'
    );
    if (r.rows.length === 0) return null;
    const jour = Math.floor(
      (Date.now() - Date.UTC(new Date().getUTCFullYear(), 0, 0)) / 86400000
    );
    return r.rows[jour % r.rows.length];
  } catch (err) {
    console.warn('[TOURS] Message de prévention indisponible :', err.message);
    return null;
  }
}

// POST /api/tours/:id/checklist-public — Questionnaire de début de journée.
//
// UNE SEULE checklist par VÉHICULE et par JOUR (demande client 08/2026) : un
// chauffeur qui reprend son téléphone en cours de journée, ou un binôme qui
// démarre une seconde tournée, ne refait pas la vérification du camion. La
// garde porte sur le véhicule + le jour civil de PARIS (le conteneur tourne en
// UTC) et répond 409 avec l'heure de la checklist existante, pour que l'écran
// mobile puisse enchaîner sans bloquer le départ.
router.post('/:id/checklist-public', async (req, res) => {
  try {
    // Vague 1 (item 45) : `notes` (remarques/anomalies saisies par le chauffeur
    // dans Checklist.jsx) était ignoré → l'anomalie disparaissait silencieusement.
    // Désormais persisté et consultable côté web (fiche véhicule).
    const { vehicle_id, employee_id, exterior_ok, fuel_level, km_start, notes, degats, reponses } = req.body;

    // Le véhicule de référence est celui du JETON quand il est connu : le corps
    // de requête ne doit pas pouvoir viser un autre camion que celui du lien.
    const vehId = driverVehicleIdFromToken(req.user) || parseInt(vehicle_id, 10) || null;
    if (vehId) {
      const deja = await pool.query(
        `SELECT created_at FROM vehicle_checklists
          WHERE vehicle_id = $1
            AND (created_at AT TIME ZONE 'Europe/Paris')::date
                = (CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Paris')::date
          ORDER BY created_at LIMIT 1`,
        [vehId]
      );
      if (deja.rows.length > 0) {
        return res.status(409).json({
          error: 'La vérification du camion a déjà été faite aujourd\'hui pour ce véhicule.',
          code: 'CHECKLIST_DEJA_FAITE',
          faite_le: deja.rows[0].created_at,
        });
      }
    }

    await pool.query(
      `INSERT INTO vehicle_checklists (tour_id, vehicle_id, employee_id, exterior_ok, fuel_level,
                                       km_start, notes, degats, reponses)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
       ON CONFLICT DO NOTHING`,
      [req.params.id, vehId, employee_id || null, exterior_ok,
       // Le niveau de carburant vient du chauffeur. Le repli '1/2' n'est
       // conservé que pour les versions de l'application qui ne le demandent
       // pas encore — il ne doit pas devenir la valeur normale.
       (fuel_level && String(fuel_level).trim()) || '1/2', km_start || 0,
       (notes && String(notes).trim()) ? String(notes).trim() : null,
       JSON.stringify(sanitizeDegats(degats)),
       JSON.stringify(sanitizeReponses(reponses))]
    );
    res.json({ ok: true, message_prevention: await messagePreventionDuJour() });
  } catch (err) {
    console.error('[TOURS] Erreur checklist-public:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/tours/:id/end-of-day-public — Déclarations de fin de journée
// (chauffeur / suiveur / binôme, mobile chauffeur JWT requis).
//
// Contrôle serveur, pas seulement client : les 6 déclarations doivent TOUTES
// être true. L'écran mobile ne permet déjà pas d'envoyer autrement, mais un
// client modifié ou un rejeu de requête ne doit pas pouvoir poser une
// déclaration partielle.
const END_OF_DAY_FIELDS = [
  'chauffeur_non_fume', 'chauffeur_pas_objet_personnel',
  'suiveur_non_fume', 'suiveur_pas_objet_personnel',
  'binome_vehicule_vide', 'binome_vehicule_ok',
];
router.post('/:id/end-of-day-public', async (req, res) => {
  try {
    const missing = END_OF_DAY_FIELDS.filter((f) => req.body[f] !== true);
    if (missing.length > 0) {
      return res.status(400).json({ error: 'Toutes les déclarations doivent être cochées', missing });
    }
    // Le véhicule vient de la session chauffeur (source fiable), pas du corps
    // de la requête. Le chauffeur rattaché suit la même cascade honnête que
    // les prises de tournée (jeton → compte → affectation du véhicule → null).
    const vehicleId = driverVehicleIdFromToken(req.user);
    const employeeId = await resolveDriverEmployeeId(pool, req.user, vehicleId);
    const remarques = req.body.remarques && String(req.body.remarques).trim()
      ? String(req.body.remarques).trim() : null;

    const result = await pool.query(
      `INSERT INTO tour_end_of_day_declarations
         (tour_id, vehicle_id, employee_id, chauffeur_non_fume, chauffeur_pas_objet_personnel,
          suiveur_non_fume, suiveur_pas_objet_personnel, binome_vehicule_vide, binome_vehicule_ok, remarques)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [req.params.id, vehicleId, employeeId, true, true, true, true, true, true, remarques]
    );
    res.status(201).json({ ok: true, id: result.rows[0].id });
  } catch (err) {
    console.error('[TOURS] Erreur end-of-day-public:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/tours/:id/start-public — Démarrer une tournée (mobile sans auth)
router.put('/:id/start-public', async (req, res) => {
  try {
    // Le flux mobile réel passe par claim (qui bascule déjà in_progress) AVANT
    // start-public : on accepte donc les deux statuts et on ne pose started_at
    // que s'il manque encore (COALESCE) — sinon le démarrage restait sans
    // horodatage sur le parcours normal.
    const result = await pool.query(
      `UPDATE tours SET status = 'in_progress',
              started_at = COALESCE(started_at, NOW()),
              updated_at = NOW()
       WHERE id = $1 AND status IN ('planned', 'in_progress') RETURNING id, status`,
      [req.params.id]
    );
    if (result.rows.length === 0) {
      // Statut plus avancé (returning/completed…) : no-op informatif
      const existing = await pool.query('SELECT id, status FROM tours WHERE id = $1', [req.params.id]);
      return res.json(existing.rows[0] || { error: 'Tournée non trouvée' });
    }
    // Calculer les horaires prévisionnels en tâche de fond (non bloquant)
    ensurePlannedPassages(req.params.id).catch(err =>
      console.warn('[TOURS] planned-passage (start-public) échec :', err.message));
    // Le départ du centre est acquitté d'office : l'équipage EST au centre à cet
    // instant. Lui demander de déclarer son arrivée à son propre point de départ
    // n'apporterait rien et ajouterait un geste.
    await cloturerDepartCentre(pool, req.params.id);
    res.json(result.rows[0]);
  } catch (err) {
    console.error('[TOURS] Erreur start-public:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/tours/:id/cav/:cavId/collect-public — Marquer un point (mobile sans auth)
// Vague 1 (item 46a) : gère la collecte ET le « saut » d'un CAV (status='skipped'
// + skip_reason) — le chauffeur peut déclarer un point impossible à collecter
// (inaccessible, bouché, vide…) sans forcer une saisie de niveau. skip_reason
// est aligné sur le CHECK de tour_cav et sur la route web execution.js.
const VALID_SKIP_REASON = ['cav_fermee', 'bouchee', 'acces_impossible', 'proprietaire_absent', 'vide', 'autre'];
// multer laisse passer les requêtes JSON non-multipart (hors ligne, sans
// photo) — même pattern que incident-public.
router.put('/:id/cav/:cavId/collect-public', uploadCollectePhoto.single('photo'), async (req, res) => {
  try {
    const { fill_level, qr_scanned, qr_unavailable, qr_unavailable_reason, notes } = req.body;
    // Pourcentage RÉEL choisi par le chauffeur (« un fond » 10 %, « plein »
    // 100 %, « au-delà » 110 %…). L'échelle 0-5 stockée dans `fill_level` ne
    // sait pas représenter ces paliers : elle plafonne à 4, que le moteur lit
    // ×20 = 80 %. Le pourcentage lève cette perte ; borné 0-150 et ignoré s'il
    // est absent (les clients mobiles antérieurs ne l'envoient pas).
    const fillPercentRaw = Number(req.body.fill_percent);
    const fill_percent = Number.isFinite(fillPercentRaw)
      ? Math.max(0, Math.min(150, fillPercentRaw)) : null;
    const status = req.body.status === 'skipped' ? 'skipped' : 'collected';
    const skip_reason = req.body.skip_reason || null;
    // multipart : les champs arrivent en string ('true'/'false').
    const remballe = req.body.remballe === true || req.body.remballe === 'true';
    // Photo d'audit (item « photo aléatoire par tournée ») : présente seulement
    // si ce point est le point tiré au sort pour cette tournée (choisi côté
    // mobile, cf. services/auditPhoto.js). COALESCE : un re-submit sans photo
    // (ex. correction du niveau) ne doit jamais effacer une photo déjà reçue.
    const photo_path = req.file ? `/uploads/collectes/${req.file.filename}` : null;

    if (status === 'skipped' && skip_reason && !VALID_SKIP_REASON.includes(skip_reason)) {
      return res.status(400).json({ error: 'skip_reason invalide', allowed: VALID_SKIP_REASON });
    }

    // Vérifier si c'est une tournée association
    const tourCheck = await pool.query('SELECT collection_type FROM tours WHERE id = $1', [req.params.id]);
    const collectionType = tourCheck.rows[0]?.collection_type || 'pav';

    if (collectionType === 'association') {
      // tour_association_point n'a pas de colonne skip_reason : le motif de saut
      // est conservé dans notes. collected_at reste null si le point est sauté.
      // $1::varchar : sans cast explicite, PostgreSQL 16 déduit deux types
      // incompatibles pour $1 (varchar dans le SET, text dans les CASE) et
      // refuse la requête (42P08 « inconsistent types deduced ») → 500 sur
      // CHAQUE collecte mobile. Prouvé par bisection sur PostgreSQL 16 réel.
      const result = await pool.query(
        `UPDATE tour_association_point SET status = $1::varchar,
         fill_level = $2,
         notes = $3,
         remballe = $4,
         photo_path = COALESCE($5, photo_path),
         collected_at = CASE WHEN $1::varchar = 'collected' THEN NOW() ELSE collected_at END
         WHERE tour_id = $6 AND association_point_id = $7 RETURNING *`,
        [status,
         status === 'skipped' ? null : fill_level,
         status === 'skipped' ? (notes || (skip_reason ? `Non collecté : ${skip_reason}` : 'Non collecté')) : (notes || null),
         remballe, photo_path,
         req.params.id, req.params.cavId]
      );
      if (result.rows.length === 0) return res.status(404).json({ error: 'Point association non trouvé dans la tournée' });
      res.json(result.rows[0]);
    } else {
      // $1::varchar : même défaut 42P08 que la branche association ci-dessus.
      const result = await pool.query(
        `UPDATE tour_cav SET status = $1::varchar,
         fill_level = CASE WHEN $1::varchar = 'skipped' THEN NULL ELSE $2::int END,
         fill_percent = CASE WHEN $1::varchar = 'skipped' THEN NULL ELSE $12::double precision END,
         qr_scanned = $3,
         qr_unavailable = $4,
         qr_unavailable_reason = $5,
         skip_reason = CASE WHEN $1::varchar = 'skipped' THEN $6::varchar ELSE NULL END,
         notes = $7,
         remballe = $8,
         photo_path = COALESCE($9, photo_path),
         collected_at = CASE WHEN $1::varchar = 'collected' THEN NOW() ELSE collected_at END
         WHERE tour_id = $10 AND cav_id = $11 RETURNING *`,
        [status, fill_level, qr_scanned || false, qr_unavailable || false, qr_unavailable_reason || null,
         skip_reason, notes || null, remballe, photo_path, req.params.id, req.params.cavId, fill_percent]
      );
      if (result.rows.length === 0) return res.status(404).json({ error: 'CAV de tournée non trouvé' });
      res.json(result.rows[0]);
    }

    // ── Ré-optimisation APRÈS CHAQUE BORNE (arbitrage client, août 2026) ──
    // C'est le SEUL déclencheur du recalcul d'ordre : jamais pendant un trajet
    // entre deux points. Le chauffeur qui roule vers une borne y est engagé ;
    // réordonner la suite sous ses yeux à ce moment-là n'aurait pas de sens.
    // Le camion vient de repartir d'un point : la liste des points restants a
    // changé, et les conditions de circulation aussi. Le calcul part en
    // arrière-plan, APRÈS la réponse au chauffeur — son écran ne doit jamais
    // attendre une optimisation.
    // Le service refuse de lui-même les tournées de formation, les gains
    // marginaux et les propositions en double : rien à filtrer ici.
    if (status === 'collected' || status === 'skipped') {
      const tourId = parseInt(req.params.id, 10);
      const io = req.app.get('io');
      try { require('../../services/scheduler').noterRecalcul(tourId); } catch (_) { /* scheduler absent */ }
      proposeReoptimization({
        tourId,
        triggerReason: 'arret',
        triggeredBy: 'auto',
        currentLat: req.body?.current_lat != null ? parseFloat(req.body.current_lat) : null,
        currentLng: req.body?.current_lng != null ? parseFloat(req.body.current_lng) : null,
        io,
      }).catch((err) => console.warn('[TOURS] ré-optimisation après arrêt :', err.message));
    }
  } catch (err) {
    console.error('[TOURS] Erreur collect-public:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/tours/:id/cav/:cavId/photo-public — Photo DU POINT prise par le chauffeur
// (exigence 08/2026 : un CAV sans photo, ou dont la photo dépasse le seuil
// `collecte.photo_fraicheur_mois`, doit être re-photographié au passage).
//
// Sécurité : le chemin finit par « -public » → capté par MOBILE_DRIVER_PATH,
// donc JWT chauffeur exigé PUIS garde de périmètre (la tournée doit appartenir
// au véhicule du jeton). Le contrôle véhicule est re-fait ici sans requête
// supplémentaire (défense en profondeur, la jointure le remonte déjà).
//
// Écrit la photo de RÉFÉRENCE du CAV (table cav), pas une pièce de tournée :
// c'est elle qui s'affiche sur la fiche du point et qui repart à zéro le compteur
// de fraîcheur.
router.post('/:id/cav/:cavId/photo-public', uploadPhotoOr400(uploadCavPhoto.single('photo')), async (req, res) => {
  const cleanupUpload = () => {
    if (!req.file) return;
    try { if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path); }
    catch (e) { console.warn('[TOURS] nettoyage photo CAV ignoré :', e.message); }
  };
  try {
    if (!req.file) return res.status(400).json({ error: 'Aucune photo fournie (jpg, png, webp, max 10 Mo)' });

    const tourId = parseInt(req.params.id, 10);
    const cavId = parseInt(req.params.cavId, 10);
    if (!Number.isInteger(tourId) || !Number.isInteger(cavId)) {
      cleanupUpload();
      return res.status(400).json({ error: 'Identifiants invalides' });
    }

    // Le point doit appartenir à CETTE tournée (pas de photo sur un CAV arbitraire).
    const link = await pool.query(
      `SELECT t.status, t.vehicle_id, t.is_demo, c.photo_path
         FROM tour_cav tc
         JOIN tours t ON t.id = tc.tour_id
         JOIN cav c ON c.id = tc.cav_id
        WHERE tc.tour_id = $1 AND tc.cav_id = $2`,
      [tourId, cavId]
    );
    if (link.rows.length === 0) {
      cleanupUpload();
      return res.status(404).json({ error: 'Point non trouvé dans cette tournée' });
    }
    const row = link.rows[0];
    if (driverVehicleMismatch(req, res, row.vehicle_id)) { cleanupUpload(); return; }
    if (!['planned', 'in_progress'].includes(row.status)) {
      cleanupUpload();
      return res.status(403).json({ error: 'Cette tournée n\'est plus en cours' });
    }

    const photoPath = `/uploads/cav-photos/${req.file.filename}`;

    // MODE DÉMO : le stagiaire prend une photo et voit la confirmation à
    // l'écran, mais la photo de RÉFÉRENCE du CAV réel n'est jamais remplacée.
    // Le fichier téléversé est supprimé dans la foulée (aucun orphelin).
    if (isDemoTour(row)) {
      cleanupUpload();
      return res.json({
        success: true,
        demo: true,
        photo_path: row.photo_path || null,
        photo_taken_at: new Date().toISOString(),
      });
    }

    const upd = await pool.query(
      `UPDATE cav SET photo_path = $1, photo_taken_at = NOW(), photo_source = 'chauffeur', updated_at = NOW()
        WHERE id = $2 RETURNING photo_path, photo_taken_at`,
      [photoPath, cavId]
    );
    if (upd.rows.length === 0) {
      cleanupUpload();
      return res.status(404).json({ error: 'CAV non trouvé' });
    }

    // Ancienne photo supprimée seulement APRÈS le succès de l'écriture.
    if (row.photo_path && row.photo_path !== photoPath) {
      try {
        const oldAbs = path.join(__dirname, '..', '..', '..', row.photo_path);
        if (fs.existsSync(oldAbs)) fs.unlinkSync(oldAbs);
      } catch (e) { console.warn('[TOURS] ancienne photo CAV non supprimée :', e.message); }
    }

    res.json({
      success: true,
      photo_path: upd.rows[0].photo_path,
      photo_taken_at: upd.rows[0].photo_taken_at,
    });
  } catch (err) {
    cleanupUpload();
    console.error('[TOURS] Erreur photo-public:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── RETOUR AU CENTRE DE TRI (demande client 08/2026) ───────────────────────
// Avant : « camion plein » ouvrait la page de pesée sur-le-champ. Le trajet de
// retour n'existait ni à l'écran du chauffeur, ni dans les chiffres de la
// tournée. Désormais l'équipage se voit poser une ÉTAPE de plus, avec son
// itinéraire, et la pesée n'arrive qu'une fois l'arrivée déclarée.
//
// POST /api/tours/:id/retour-centre-public  { motif: 'vidage' | 'fin_tournee' }
router.post('/:id/retour-centre-public', async (req, res) => {
  const client = await pool.connect();
  try {
    const tourId = parseInt(req.params.id, 10);
    if (!Number.isInteger(tourId)) return res.status(400).json({ error: 'Tournée invalide' });

    const motif = String(req.body?.motif || 'vidage');
    // La pause du midi est POSÉE PAR LE SERVEUR, pas déclarée par le chauffeur :
    // elle n'a pas à être créable depuis le mobile.
    if (!['vidage', 'fin_tournee'].includes(motif)) {
      return res.status(400).json({ error: 'Motif de retour inconnu' });
    }

    const t = await client.query('SELECT id, status FROM tours WHERE id = $1', [tourId]);
    if (t.rows.length === 0) return res.status(404).json({ error: 'Tournée non trouvée' });
    if (['completed', 'cancelled'].includes(t.rows[0].status)) {
      return res.status(409).json({ error: 'Cette tournée est déjà terminée.' });
    }

    await client.query('BEGIN');
    const centre = await centreDeTri(client);
    // Un retour DÉCLARÉ par l'équipage vient toujours se placer devant lui —
    // qu'il faille le créer, ou déplacer celui que la création de tournée avait
    // posé plus loin dans la journée. Laisser le retour de fin en queue de
    // programme le rendrait invisible tant qu'il reste des bornes : l'étape
    // courante du mobile est le point le plus proche devant le chauffeur.
    const arret = await avancerRetourCentre(client, { tourId, motif, centre });
    await client.query('COMMIT');

    res.json({
      success: true,
      arret_id: arret.id,
      position: arret.position,
      deja_present: arret.deja_present,
      motif,
      suite: SUITE_MOTIF[motif],
      destination: {
        name: centre.nom || 'Centre de tri',
        address: centre.adresse || null,
        latitude: centre.latitude,
        longitude: centre.longitude,
      },
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[TOURS] Erreur retour-centre-public:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

// POST /api/tours/:id/arret/:arretId/arrive-public — l'équipage est arrivé.
// C'est CE geste, et lui seul, qui ouvre la pesée : tant qu'il n'a pas eu lieu,
// le camion est en route et la tournée n'a rien à peser.
router.post('/:id/arret/:arretId/arrive-public', async (req, res) => {
  try {
    const tourId = parseInt(req.params.id, 10);
    const arretId = parseInt(req.params.arretId, 10);
    if (!Number.isInteger(tourId) || !Number.isInteger(arretId)) {
      return res.status(400).json({ error: 'Identifiant invalide' });
    }

    const r = await pool.query(
      `UPDATE tour_arret_technique
          SET status = 'done',
              arrived_at = COALESCE(arrived_at, NOW()),
              completed_at = NOW()
        WHERE id = $1 AND tour_id = $2
        RETURNING id, motif, position, arrived_at`,
      [arretId, tourId]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Arrêt non trouvé' });

    const arret = r.rows[0];
    res.json({
      success: true,
      arret_id: arret.id,
      motif: arret.motif,
      arrived_at: arret.arrived_at,
      suite: SUITE_MOTIF[arret.motif] || 'reprise_tournee',
    });
  } catch (err) {
    console.error('[TOURS] Erreur arrive-public:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/tours/:id/scan-public — Enregistrer un scan QR (JWT chauffeur requis)
router.post('/:id/scan-public', async (req, res) => {
  try {
    const { cav_id, scanned_at } = req.body;
    // MODE DÉMO : le scan est acquitté au chauffeur mais rien n'est historisé —
    // `cav_qr_scans` est rattaché au CAV (tour_id passe à NULL si la tournée
    // est supprimée), une trace d'exercice y survivrait à la réinitialisation.
    if (await isDemoTourId(req.params.id)) {
      return res.json({ ok: true, demo: true });
    }
    await pool.query(
      `INSERT INTO cav_qr_scans (cav_id, tour_id, scanned_at)
       VALUES ($1, $2, $3)`,
      [cav_id, req.params.id, scanned_at || new Date()]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[TOURS] Erreur scan-public:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/tours/gps-batch-public — Flush des positions GPS bufferisées hors-ligne.
// Le suivi temps réel passe par Socket.IO (gps-update) quand le réseau est là ;
// hors zone de couverture, le mobile bufferise localement (IndexedDB) et rejoue
// ici par lots à la reconnexion. Auth : JWT chauffeur (route « -public », voir
// le middleware MOBILE_DRIVER_PATH en tête de ce routeur).
router.post('/gps-batch-public', async (req, res) => {
  const positions = Array.isArray(req.body?.positions) ? req.body.positions : [];
  if (positions.length === 0) return res.json({ inserted: 0 });
  if (positions.length > 500) {
    return res.status(400).json({ error: 'Lot trop volumineux (max 500 positions)' });
  }
  // On ne garde que les positions complètes (tour_id + vehicle_id NOT NULL en
  // base) ; une position incomplète est ignorée sans faire échouer tout le lot.
  const valid = positions.filter((p) =>
    p && p.tour_id != null && p.vehicle_id != null &&
    p.latitude != null && p.longitude != null);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const p of valid) {
      await client.query(
        `INSERT INTO gps_positions (tour_id, vehicle_id, latitude, longitude, speed, recorded_at)
         VALUES ($1, $2, $3, $4, $5, COALESCE($6, NOW()))`,
        [p.tour_id, p.vehicle_id, p.latitude, p.longitude, p.speed ?? null, p.recorded_at || null]
      );
    }
    await client.query('COMMIT');
    res.json({ inserted: valid.length, skipped: positions.length - valid.length });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[TOURS] Erreur gps-batch-public:', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

// POST /api/tours/:id/weigh-public — Enregistrer une pesée (mobile sans auth)
router.post('/:id/weigh-public', async (req, res) => {
  try {
    const { weight_kg, tare_kg, is_intermediate, notes } = req.body;
    if (weight_kg === undefined || weight_kg === null) {
      return res.status(400).json({ error: 'Poids requis (weight_kg)' });
    }
    // Fix bug C5 : persistance de tare_kg, is_intermediate et notes
    // (champs envoyés par mobile/WeighIn.jsx mais ignorés auparavant).
    const result = await pool.query(
      `INSERT INTO tour_weights (tour_id, weight_kg, tare_kg, is_intermediate, notes, recorded_at)
       VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING *`,
      [
        req.params.id,
        weight_kg,
        tare_kg ?? null,
        is_intermediate === true || is_intermediate === 'true',
        notes ?? null,
      ]
    );
    // Total de la tournée = somme de TOUTES les pesées.
    //
    // Correctif (août 2026) : la somme ne retenait que les pesées « non
    // intermédiaires ». Or une pesée intermédiaire n'est pas un relevé
    // provisoire : c'est un CHARGEMENT RÉELLEMENT DÉPOSÉ au centre par un
    // chauffeur qui repart collecter. L'exclure faisait disparaître ces kilos
    // du total, et donc — via applyCompletionSideEffects — de tonnage_history
    // (moteur prédictif, carte des CAV) ET des entrées de stock.
    // Cas observé en production : une tournée avec 649 kg pesés en
    // intermédiaire et 0 kg en pesée finale ressortait à 0 kg partout.
    await pool.query(
      `UPDATE tours SET total_weight_kg = (
         SELECT COALESCE(SUM(weight_kg), 0) FROM tour_weights WHERE tour_id = $1
       ) WHERE id = $1`,
      [req.params.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[TOURS] Erreur weigh-public:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/tours/:id/incident-public — Signaler un incident (mobile, JWT chauffeur)
// Vague 1 (item 46b) : accepte une photo en multipart quand l'appareil est en
// ligne (upload.single('photo')). Hors ligne, le mobile poste du JSON via la
// file de sync (sans photo) — multer laisse passer les requêtes non-multipart.
// Vague 1 (item 44) : types mobiles hors du CHECK SQL (cav_overflow, security)
// normalisés vers un type valide, le libellé d'origine préservé en description
// (avant : violation de contrainte → 500 en boucle dans la file de sync).
const INCIDENT_TYPE_MAP = { cav_overflow: 'environment', security: 'other' };
const INCIDENT_TYPE_ORIG_LABELS = { cav_overflow: 'Débordement', security: 'Sécurité' };
const VALID_INCIDENT_TYPES = ['cav_problem', 'environment', 'vehicle_breakdown', 'accident', 'other'];
router.post('/:id/incident-public', upload.single('photo'), async (req, res) => {
  try {
    const { type, description, cav_id, vehicle_id, current_lat, current_lng } = req.body;
    if (!type) {
      return res.status(400).json({ error: 'Type d\'incident requis' });
    }
    const dbType = INCIDENT_TYPE_MAP[type] || type;
    if (!VALID_INCIDENT_TYPES.includes(dbType)) {
      return res.status(400).json({ error: 'Type d\'incident invalide', allowed: VALID_INCIDENT_TYPES });
    }
    // Conserve le libellé mobile d'origine dans la description si le type a été
    // remappé (ex. « Débordement » → environment).
    let finalDescription = description || null;
    if (INCIDENT_TYPE_MAP[type]) {
      const lbl = INCIDENT_TYPE_ORIG_LABELS[type] || type;
      finalDescription = finalDescription ? `[${lbl}] ${finalDescription}` : lbl;
    }
    const photo_path = req.file ? `/uploads/incidents/${req.file.filename}` : null;

    // MODE DÉMO : l'incident est bien enregistré (le stagiaire doit le
    // retrouver dans le récapitulatif de SA tournée) mais il est marqué
    // `is_demo` — la page Incidents et les alertes du tableau de bord
    // l'excluent, et aucun manager n'est notifié.
    const demo = await isDemoTourId(req.params.id);
    const result = await pool.query(
      `INSERT INTO incidents (tour_id, type, description, cav_id, vehicle_id, photo_path, is_demo, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW()) RETURNING *`,
      [req.params.id, dbType, finalDescription, cav_id || null, vehicle_id || null, photo_path, demo]
    );

    // Si l'incident bloque un CAV, déclenche une proposition de ré-optim
    // en arrière-plan (non bloquant) — ordonne les CAV restants depuis la
    // position GPS actuelle si fournie.
    if (dbType === 'cav_problem' || dbType === 'environment') {
      const io = req.app.get('io');
      proposeReoptimization({
        tourId: parseInt(req.params.id, 10),
        triggerReason: 'incident',
        triggeredBy: 'auto',
        currentLat: typeof current_lat === 'number' ? current_lat : parseFloat(current_lat) || null,
        currentLng: typeof current_lng === 'number' ? current_lng : parseFloat(current_lng) || null,
        io,
      }).catch(err => console.warn('[TOURS] auto-reoptim (incident) échec :', err.message));
    }

    // Push aux managers : nouvel incident sur tournée en cours. Le lien pointe
    // vers la page Incidents (cycle de vie / clôture), pas seulement la carte.
    // JAMAIS en mode démo : un exercice de formation ne réveille personne.
    if (!demo) {
      sendPushToRoles(['ADMIN', 'MANAGER'], {
        title: 'Incident signalé',
        body: `Tournée #${req.params.id} — ${dbType}${finalDescription ? ` : ${finalDescription.slice(0, 80)}` : ''}`,
        tag: `incident-${req.params.id}`,
        data: { url: `/incidents?tourId=${parseInt(req.params.id, 10)}`, tourId: parseInt(req.params.id, 10) },
      }).catch(() => {});
    }

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[TOURS] Erreur incident-public:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/tours/:id/reoptimize-public — Proposer une ré-optim (mobile sans auth)
router.post('/:id/reoptimize-public', async (req, res) => {
  try {
    const io = req.app.get('io');
    const result = await proposeReoptimization({
      tourId: parseInt(req.params.id, 10),
      triggerReason: req.body?.reason || 'manual',
      triggeredBy: 'driver',
      currentLat: req.body?.current_lat != null ? parseFloat(req.body.current_lat) : null,
      currentLng: req.body?.current_lng != null ? parseFloat(req.body.current_lng) : null,
      io,
    });
    res.json(result);
  } catch (err) {
    console.error('[TOURS] Erreur reoptimize-public :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/tours/:id/reoptimize/:reoptId/accept-public — Chauffeur accepte
router.post('/:id/reoptimize/:reoptId/accept-public', async (req, res) => {
  try {
    const result = await applyReoptimization(parseInt(req.params.reoptId, 10), null);
    if (result.error) return res.status(400).json(result);
    const io = req.app.get('io');
    if (io) io.to(`tour-${result.tour_id}`).emit('reoptimization-accepted', {
      reoptId: parseInt(req.params.reoptId, 10), tour_id: result.tour_id,
    });
    res.json(result);
  } catch (err) {
    console.error('[TOURS] Erreur accept-public :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/tours/:id/reoptimize/:reoptId/reject-public — Chauffeur refuse
router.post('/:id/reoptimize/:reoptId/reject-public', async (req, res) => {
  try {
    const result = await rejectReoptimization(parseInt(req.params.reoptId, 10), null);
    if (result.error) return res.status(400).json(result);
    const io = req.app.get('io');
    if (io) io.to(`tour-${result.tour_id}`).emit('reoptimization-rejected', {
      reoptId: parseInt(req.params.reoptId, 10), tour_id: result.tour_id,
    });
    res.json(result);
  } catch (err) {
    console.error('[TOURS] Erreur reject-public :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/tours/:id/reoptimize/pending-public — Proposition en attente (mobile)
router.get('/:id/reoptimize/pending-public', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT * FROM tour_reoptimizations
         WHERE tour_id = $1 AND status = 'pending'
         ORDER BY triggered_at DESC LIMIT 1`,
      [req.params.id]
    );
    res.json(r.rows[0] || null);
  } catch (err) {
    console.error('[TOURS] Erreur pending-public :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/tours/:id/status-public — Changer le statut d'une tournée (mobile sans auth)
router.put('/:id/status-public', async (req, res) => {
  try {
    const { status, km_start, km_end, notes } = req.body;
    if (!status) {
      return res.status(400).json({ error: 'Statut requis' });
    }
    // Vérifier les transitions autorisées
    const allowedTransitions = {
      'planned': ['in_progress'],
      'in_progress': ['returning', 'completed'],
      'returning': ['completed']
    };
    const current = await pool.query('SELECT * FROM tours WHERE id = $1', [req.params.id]);
    if (current.rows.length === 0) {
      return res.status(404).json({ error: 'Tournée non trouvée' });
    }
    const currentStatus = current.rows[0].status;

    // Résidu 2 (vague 0) — Idempotence du chemin MOBILE de clôture.
    // Le chemin web execution.js a été rendu idempotent en vague 0
    // (garde AND status <> 'completed' + réponse 200 sans effet de bord).
    // On réplique ici : un rejeu offline demandant le statut déjà courant est
    // un no-op qui répond 200 avec la tournée telle quelle, SANS ré-émettre de
    // push aux managers ni recalculer les horaires. Indispensable car la file
    // de sync peut renvoyer « completed » plusieurs fois (finalisation de
    // pesée) — sans cette garde le mobile recevait un 400 « transition non
    // autorisée » trompeur.
    if (status === currentStatus) {
      return res.json(current.rows[0]);
    }

    const allowed = allowedTransitions[currentStatus];
    if (!allowed || !allowed.includes(status)) {
      return res.status(400).json({ error: `Transition ${currentStatus} → ${status} non autorisée` });
    }

    // Fix bug C6 : persister km_start / km_end / notes envoyés par le
    // mobile (Checklist, ReturnCentre). Sans ça, TourSummary affiche
    // distance = null.
    const updates = ['status = $1', 'updated_at = NOW()'];
    const params = [status];
    if (status === 'in_progress') updates.push('started_at = NOW()');
    if (status === 'completed') updates.push('completed_at = NOW()');
    // Déclenche le calcul OSRM des horaires prévisionnels une fois la
    // tournée passée en in_progress (non bloquant).
    if (status === 'in_progress') {
      ensurePlannedPassages(req.params.id).catch(err =>
        console.warn('[TOURS] planned-passage (status-public) échec :', err.message));
    }
    if (km_start !== undefined && km_start !== null && km_start !== '') {
      params.push(parseInt(km_start, 10));
      updates.push(`km_start = $${params.length}`);
    }
    if (km_end !== undefined && km_end !== null && km_end !== '') {
      params.push(parseInt(km_end, 10));
      updates.push(`km_end = $${params.length}`);
    }
    if (notes !== undefined && notes !== null && notes !== '') {
      params.push(String(notes));
      updates.push(`notes = $${params.length}`);
    }

    params.push(req.params.id);
    // Garde d'idempotence défensive contre une course (deux requêtes « completed »
    // lisant toutes deux « in_progress ») : seule la première ligne bascule et
    // déclenche le push. Aligné sur execution.js (vague 0).
    let whereClause = `id = $${params.length}`;
    if (status === 'completed') whereClause += " AND status <> 'completed'";
    const result = await pool.query(
      `UPDATE tours SET ${updates.join(', ')} WHERE ${whereClause} RETURNING *`,
      params
    );

    if (result.rows.length === 0) {
      // 0 ligne sur une clôture = déjà terminée entre-temps (course) → no-op
      // idempotent : on renvoie la tournée existante sans ré-émettre de push.
      return res.json(current.rows[0]);
    }

    // Effets de clôture (tonnage par CAV, entrées de stock, feedback
    // d'apprentissage) — partagés avec la route web via completion-effects.js.
    // La bascule de statut est déjà commitée et la garde d'idempotence assure
    // un passage unique : un échec ici est journalisé sans faire échouer la
    // clôture (un 500 ferait rejouer la file mobile sur une tournée déjà
    // completed → no-op, et les effets seraient perdus dans tous les cas).
    if (status === 'completed') {
      try {
        await applyCompletionSideEffects(result.rows[0], parseInt(req.params.id, 10), req.user?.id ?? null);
      } catch (effErr) {
        console.error('[TOURS] status-public — effets de clôture en échec :', effErr.message);
      }
    }

    // Push notification aux managers sur fin / annulation déclenchée côté mobile.
    // Lien vers la page Incidents non pertinent ici : on garde la vue collecte.
    // Jamais en mode démo : une tournée de formation ne notifie personne.
    if ((status === 'completed' || status === 'cancelled') && !isDemoTour(result.rows[0])) {
      const label = status === 'completed' ? 'terminée' : 'annulée';
      const tour = result.rows[0];
      sendPushToRoles(['ADMIN', 'MANAGER'], {
        title: `Tournée #${req.params.id} ${label}`,
        body: tour?.total_weight_kg
          ? `Poids total : ${Math.round(tour.total_weight_kg)} kg`
          : 'Déclarée depuis le mobile chauffeur',
        tag: `tour-${req.params.id}-${status}`,
        data: { url: '/collections-live', tourId: parseInt(req.params.id, 10) },
      }).catch(() => {});
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[TOURS] Erreur status-public:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/tours/:id/summary-public — Résumé d'une tournée (mobile sans auth)
router.get('/:id/summary-public', async (req, res) => {
  try {
    const tourResult = await pool.query(
      `SELECT t.*, v.registration, v.name as vehicle_name
       FROM tours t
       JOIN vehicles v ON v.id = t.vehicle_id
       WHERE t.id = $1`,
      [req.params.id]
    );
    if (tourResult.rows.length === 0) {
      return res.status(404).json({ error: 'Tournée non trouvée' });
    }
    const tour = tourResult.rows[0];

    // Adapter les stats selon le type de collecte
    let statsResult;
    if (tour.collection_type === 'association') {
      statsResult = await pool.query(
        `SELECT
           (SELECT COUNT(*)::int FROM tour_association_point WHERE tour_id = $1 AND status = 'collected') as cavs_collected,
           (SELECT COUNT(*)::int FROM tour_association_point WHERE tour_id = $1) as cavs_total,
           (SELECT COALESCE(SUM(weight_kg), 0) FROM tour_weights WHERE tour_id = $1) as total_weight_kg,
           (SELECT COUNT(*)::int FROM incidents WHERE tour_id = $1) as incidents_count`,
        [req.params.id]
      );
    } else {
      statsResult = await pool.query(
        `SELECT
           (SELECT COUNT(*)::int FROM tour_cav WHERE tour_id = $1 AND status = 'collected') as cavs_collected,
           (SELECT COUNT(*)::int FROM tour_cav WHERE tour_id = $1) as cavs_total,
           (SELECT COALESCE(SUM(weight_kg), 0) FROM tour_weights WHERE tour_id = $1) as total_weight_kg,
           (SELECT COUNT(*)::int FROM incidents WHERE tour_id = $1) as incidents_count`,
        [req.params.id]
      );
    }
    const stats = statsResult.rows[0];

    // Calculer la durée en minutes
    let duration_minutes = null;
    if (tour.started_at && tour.completed_at) {
      duration_minutes = Math.round((new Date(tour.completed_at) - new Date(tour.started_at)) / 60000);
    } else if (tour.started_at) {
      duration_minutes = Math.round((new Date() - new Date(tour.started_at)) / 60000);
    }

    // Liste détaillée des points pour que l'écran récap mobile puisse
    // afficher la comparaison prévu / réalisé (badges décalage).
    let cavs = [];
    if (tour.collection_type === 'association') {
      const r = await pool.query(
        `SELECT tap.id, tap.association_point_id AS cav_id, tap.position, tap.status,
                tap.fill_level, tap.collected_at, tap.planned_passage_time, tap.notes,
                ap.name AS cav_name, ap.ville AS commune
           FROM tour_association_point tap
           JOIN association_points ap ON ap.id = tap.association_point_id
          WHERE tap.tour_id = $1 ORDER BY tap.position`,
        [req.params.id]
      );
      cavs = r.rows;
    } else {
      const r = await pool.query(
        `SELECT tc.id, tc.cav_id, tc.position, tc.status, tc.fill_level,
                tc.collected_at, tc.planned_passage_time, tc.notes, tc.skip_reason,
                c.name AS cav_name, c.commune
           FROM tour_cav tc JOIN cav c ON c.id = tc.cav_id
          WHERE tc.tour_id = $1 ORDER BY tc.position`,
        [req.params.id]
      );
      cavs = r.rows;
    }
    const enrichedCavs = cavs.map(c => {
      let delay_minutes = null;
      if (c.collected_at && c.planned_passage_time) {
        delay_minutes = Math.round((new Date(c.collected_at) - new Date(c.planned_passage_time)) / 60000);
      }
      return { ...c, delay_minutes };
    });

    const incidentsRows = await pool.query(
      `SELECT id, type, description, created_at FROM incidents WHERE tour_id = $1 ORDER BY created_at`,
      [req.params.id]
    );

    const checklistRes = await pool.query(
      `SELECT * FROM vehicle_checklists WHERE tour_id = $1 LIMIT 1`,
      [req.params.id]
    );

    res.json({
      tour,
      cavs: enrichedCavs,
      incidents: incidentsRows.rows,
      checklist: checklistRes.rows[0] || null,
      stats: {
        cavs_collected: stats.cavs_collected,
        cavs_total: stats.cavs_total,
        total_weight_kg: parseFloat(stats.total_weight_kg),
        incidents_count: stats.incidents_count,
        duration_minutes,
        distance_km: tour.estimated_distance_km || null
      }
    });
  } catch (err) {
    console.error('[TOURS] Erreur summary-public:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── Vague 2 (item 62) — Canal manager → chauffeur (côté mobile) ────────────
// Ces routes « -public » sont authentifiées par le JWT chauffeur (middleware
// MOBILE_DRIVER_PATH en tête de ce routeur) — pas d'accès anonyme.

// GET /api/tours/vehicle/:vehicleId/messages-public — consignes NON LUES pour
// le véhicule du chauffeur. Sert la bannière DriverMessageBanner (poll mobile).
router.get('/vehicle/:vehicleId/messages-public', async (req, res) => {
  try {
    const vehicleId = parseInt(req.params.vehicleId, 10);
    if (!vehicleId) return res.status(400).json({ error: 'vehicleId invalide' });
    const r = await pool.query(
      `SELECT id, tour_id, vehicle_id, message, created_at, read_at
         FROM driver_messages
        WHERE vehicle_id = $1 AND read_at IS NULL
        ORDER BY created_at ASC`,
      [vehicleId]
    );
    res.json({ messages: r.rows });
  } catch (err) {
    console.error('[TOURS] Erreur messages-public:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/tours/messages/:id/read-public — accusé de lecture (« J'ai compris »).
// Idempotent : le premier accusé fixe read_at ; un rejeu (file de sync offline)
// répond 200 sans effet de bord (jamais d'erreur qui bloquerait la file).
router.post('/messages/:id/read-public', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) return res.status(400).json({ error: 'id invalide' });
    // Vague 3 — garde véhicule : un chauffeur n'accuse réception que d'une
    // consigne destinée à SON véhicule. La clause `vehicle_id = $2` borne
    // l'UPDATE (aucun effet de bord sur une consigne d'un autre véhicule) ; en
    // cas de 0 ligne, on distingue « autre véhicule » (403) de « déjà lu ».
    const tokenVehId = driverVehicleIdFromToken(req.user);
    const r = tokenVehId != null
      ? await pool.query(
          `UPDATE driver_messages SET read_at = NOW()
            WHERE id = $1 AND read_at IS NULL AND vehicle_id = $2
            RETURNING id, read_at`,
          [id, tokenVehId]
        )
      : await pool.query(
          `UPDATE driver_messages SET read_at = NOW()
            WHERE id = $1 AND read_at IS NULL
            RETURNING id, read_at`,
          [id]
        );
    if (r.rows.length === 0) {
      const existing = await pool.query('SELECT id, read_at, vehicle_id FROM driver_messages WHERE id = $1', [id]);
      if (existing.rows.length === 0) return res.status(404).json({ error: 'Message non trouvé' });
      if (tokenVehId != null && existing.rows[0].vehicle_id != null
          && Number(existing.rows[0].vehicle_id) !== tokenVehId) {
        return res.status(403).json({ error: 'Consigne destinée à un autre véhicule' });
      }
      return res.json({ id: existing.rows[0].id, read_at: existing.rows[0].read_at, already: true });
    }
    res.json({ id: r.rows[0].id, read_at: r.rows[0].read_at });
  } catch (err) {
    console.error('[TOURS] Erreur read-public:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/tours/:id/history-public — historique SERVEUR enrichi d'une tournée
// pour le mobile (points, incidents déclarés, pesées enregistrées). Permet au
// chauffeur de vérifier que « sa pesée est bien passée » au-delà de sa file
// locale (qui se vide après synchronisation).
router.get('/:id/history-public', async (req, res) => {
  try {
    const tourId = parseInt(req.params.id, 10);
    if (!tourId) return res.status(400).json({ error: 'id invalide' });
    const tourCheck = await pool.query('SELECT id, collection_type, vehicle_id FROM tours WHERE id = $1', [tourId]);
    if (tourCheck.rows.length === 0) return res.status(404).json({ error: 'Tournée non trouvée' });
    // Vague 3 — garde véhicule : historique borné à la tournée du véhicule du token.
    if (driverVehicleMismatch(req, res, tourCheck.rows[0].vehicle_id)) return;
    const collectionType = tourCheck.rows[0].collection_type || 'pav';

    let cavs = [];
    if (collectionType === 'association') {
      const r = await pool.query(
        `SELECT tap.id, tap.association_point_id AS cav_id, tap.position, tap.status,
                tap.fill_level, tap.collected_at, tap.notes,
                ap.name AS cav_name, ap.ville AS commune
           FROM tour_association_point tap
           JOIN association_points ap ON ap.id = tap.association_point_id
          WHERE tap.tour_id = $1 ORDER BY tap.position`,
        [tourId]
      );
      cavs = r.rows;
    } else {
      const r = await pool.query(
        `SELECT tc.id, tc.cav_id, tc.position, tc.status, tc.fill_level,
                tc.collected_at, tc.notes, tc.skip_reason,
                c.name AS cav_name, c.commune
           FROM tour_cav tc JOIN cav c ON c.id = tc.cav_id
          WHERE tc.tour_id = $1 ORDER BY tc.position`,
        [tourId]
      );
      cavs = r.rows;
    }

    const incidents = await pool.query(
      `SELECT id, type, description, photo_path, created_at
         FROM incidents WHERE tour_id = $1 ORDER BY created_at`,
      [tourId]
    );
    const weights = await pool.query(
      `SELECT id, weight_kg, tare_kg, is_intermediate, notes, recorded_at
         FROM tour_weights WHERE tour_id = $1 ORDER BY recorded_at`,
      [tourId]
    );

    res.json({ cavs, incidents: incidents.rows, weights: weights.rows });
  } catch (err) {
    console.error('[TOURS] Erreur history-public:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// All routes below require authentication
router.use(authenticate);

// ── Vague 2 (item 62) — Canal manager → chauffeur (côté web) ───────────────
// Le responsable logistique envoie une consigne à un chauffeur en tournée
// (consigne, CAV ajouté, danger signalé) depuis la Collecte en direct.
// LECTURE + ÉCRITURE réservées ADMIN/MANAGER (aucune écriture pour AUTORITE).

// POST /api/tours/messages — envoyer une consigne au chauffeur d'un véhicule.
router.post('/messages', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const vehicleId = parseInt(req.body?.vehicle_id, 10);
    const tourId = req.body?.tour_id != null && req.body.tour_id !== ''
      ? parseInt(req.body.tour_id, 10) : null;
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    if (!vehicleId) return res.status(400).json({ error: 'vehicle_id requis' });
    if (!message) return res.status(400).json({ error: 'Message vide' });
    if (message.length > 1000) return res.status(400).json({ error: 'Message trop long (max 1000 caractères)' });

    const veh = await pool.query('SELECT id FROM vehicles WHERE id = $1', [vehicleId]);
    if (veh.rows.length === 0) return res.status(404).json({ error: 'Véhicule non trouvé' });

    const r = await pool.query(
      `INSERT INTO driver_messages (tour_id, vehicle_id, message, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING id, tour_id, vehicle_id, message, created_by, created_at, read_at`,
      [tourId, vehicleId, message, req.user.id]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    console.error('[TOURS] Erreur POST messages:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/tours/messages?vehicle_id=&tour_id= — consignes envoyées (lu/non lu).
router.get('/messages', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const vehicleId = req.query.vehicle_id ? parseInt(req.query.vehicle_id, 10) : null;
    const tourId = req.query.tour_id ? parseInt(req.query.tour_id, 10) : null;
    const conds = [];
    const params = [];
    if (vehicleId) { params.push(vehicleId); conds.push(`dm.vehicle_id = $${params.length}`); }
    if (tourId) { params.push(tourId); conds.push(`dm.tour_id = $${params.length}`); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const r = await pool.query(
      `SELECT dm.id, dm.tour_id, dm.vehicle_id, dm.message, dm.created_at, dm.read_at,
              u.first_name AS sender_first_name, u.last_name AS sender_last_name
         FROM driver_messages dm
         LEFT JOIN users u ON u.id = dm.created_by
         ${where}
        ORDER BY dm.created_at DESC
        LIMIT 100`,
      params
    );
    res.json({ messages: r.rows });
  } catch (err) {
    console.error('[TOURS] Erreur GET messages:', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Mount pilotage d'une tournée en cours (programme, arrêts techniques, équipe)
// et référentiel des lieux d'arrêt. Monté AVANT les routeurs à paramètre pour
// que « /lieux-techniques » ne soit pas capté par une route « /:id ».
router.use('/', require('./live-edit'));

// Mount démo formation (accès formateur + réinitialisation). Monté AVANT les
// routeurs à paramètre pour que « /demo/... » ne soit jamais capté par une
// route « /:id/... ».
router.use('/', require('./demo'));

// Mount live-summary route (supervision d'une tournée en cours)
router.use('/', liveSummaryRouter);
router.use('/', activeSummaryRouter);

// Mount reoptimize routes (manager trigger / accept / reject)
router.use('/', reoptimizeRouter);

// Mount planning routes (Niveau 2.7 — drag-drop affectation)
router.use('/', planningRouter);

// Mount dashboard collecte (Niveau 2.1 — supervision consolidée)
router.use('/', dashboardRouter);

// Mount execution routes (needs upload for incidents)
const executionRouter = createExecutionRouter(upload);
router.use('/', executionRouter);

// Mount events routes
router.use('/', eventsRouter);

// Mount auto-discovery events routes
router.use('/', eventsAutoRouter);

// Mount stats/reporting routes
router.use('/', statsRouter);

// Mount proposals routes
router.use('/', proposalsRouter);

// Mount CRUD routes (must be after more specific routes to avoid /:id catching everything)
router.use('/', crudRouter);

module.exports = router;
