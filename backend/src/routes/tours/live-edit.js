// ══════════════════════════════════════════════════════════════
// PILOTAGE D'UNE TOURNÉE EN COURS (demande client, août 2026)
// ──────────────────────────────────────────────────────────────
// Le gestionnaire doit pouvoir reprendre la main sur une tournée DÉJÀ PARTIE,
// depuis l'écran « Collecte en direct » :
//   • réordonner les points (glisser-déposer) ;
//   • ajouter / retirer un point de collecte ;
//   • intercaler ou retirer un ARRÊT TECHNIQUE (magasin, entretien…) ;
//   • changer le chauffeur ou les suiveurs en cours de journée.
//
// PRINCIPES
//  1. Le PROGRAMME d'une tournée est la fusion ordonnée de `tour_cav` et
//     `tour_arret_technique`, qui partagent l'échelle de `position`.
//  2. Ce qui est FAIT ne bouge plus : un point collecté ou sauté n'est ni
//     réordonnable ni supprimable — on ne réécrit pas le passé du chauffeur.
//  3. Toute modification PRÉVIENT le chauffeur : message dans `driver_messages`
//     (que le mobile relève déjà toutes les 15 s et affiche en bandeau FALC)
//     + évènement Socket.IO pour les écrans ouverts.
//
// Endpoints (ADMIN/MANAGER) :
//   GET    /api/tours/:id/programme
//   PUT    /api/tours/:id/programme/ordre
//   POST   /api/tours/:id/programme/cav          DELETE .../cav/:tourCavId
//   POST   /api/tours/:id/programme/arret        DELETE .../arret/:arretId
//   PATCH  /api/tours/:id/equipe
//   GET/POST/PUT/DELETE /api/tours/lieux-techniques[/:id]
// ══════════════════════════════════════════════════════════════

const express = require('express');
const router = express.Router();
const pool = require('../../config/database');
const { authorize } = require('../../middleware/auth');

/** Statuts de tournée sur lesquels le programme reste modifiable. */
const STATUTS_MODIFIABLES = ['planned', 'in_progress', 'paused', 'returning'];
/** Un point déjà traité n'est plus déplaçable ni supprimable. */
const POINT_FIGE = ['collected', 'skipped', 'incident', 'done'];

/** Charge la tournée et refuse tôt si elle n'est pas modifiable. */
async function loadTourEditable(tourId, res) {
  const r = await pool.query(
    `SELECT t.id, t.date, t.status, t.vehicle_id, t.driver_employee_id,
            t.suiveur1_employee_id, t.suiveur2_employee_id, v.registration
       FROM tours t LEFT JOIN vehicles v ON v.id = t.vehicle_id
      WHERE t.id = $1`,
    [tourId]
  );
  if (r.rows.length === 0) {
    res.status(404).json({ error: 'Tournée non trouvée' });
    return null;
  }
  const tour = r.rows[0];
  if (!STATUTS_MODIFIABLES.includes(tour.status)) {
    res.status(409).json({
      error: 'Cette tournée est terminée ou annulée : son programme n\'est plus modifiable.',
      code: 'TOURNEE_NON_MODIFIABLE',
      status: tour.status,
    });
    return null;
  }
  return tour;
}

/**
 * Programme complet et ordonné : points de collecte ET arrêts techniques,
 * fusionnés sur `position`. `editable` dit au front ce qui peut encore bouger.
 */
async function chargerProgramme(tourId) {
  const [cavs, arrets] = await Promise.all([
    pool.query(
      `SELECT tc.id, tc.cav_id AS ref_id, tc.position, tc.status, tc.fill_level,
              tc.skip_reason, tc.collected_at,
              c.name, c.address, c.commune, c.latitude, c.longitude, c.nb_containers
         FROM tour_cav tc JOIN cav c ON c.id = tc.cav_id
        WHERE tc.tour_id = $1`,
      [tourId]
    ),
    pool.query(
      `SELECT ta.id, ta.lieu_id AS ref_id, ta.position, ta.status, ta.notes,
              ta.arrived_at, ta.completed_at,
              COALESCE(ta.libelle, lt.nom) AS name,
              lt.adresse AS address, lt.latitude, lt.longitude,
              lt.categorie, lt.duree_min
         FROM tour_arret_technique ta LEFT JOIN lieux_techniques lt ON lt.id = ta.lieu_id
        WHERE ta.tour_id = $1`,
      [tourId]
    ),
  ]);

  const points = [
    ...cavs.rows.map((r) => ({ ...r, kind: 'cav' })),
    ...arrets.rows.map((r) => ({ ...r, kind: 'arret_technique' })),
  ]
    .map((p) => ({ ...p, editable: !POINT_FIGE.includes(p.status) }))
    .sort((a, b) => (a.position - b.position) || (a.kind === 'cav' ? -1 : 1));

  return points;
}

/**
 * Prévient le chauffeur qu'il a un nouvel itinéraire. Best effort : une
 * notification qui échoue ne doit jamais annuler la modification déjà commitée
 * — mais elle est journalisée, jamais avalée en silence.
 */
async function notifierChauffeur(req, tour, message) {
  try {
    await pool.query(
      `INSERT INTO driver_messages (tour_id, vehicle_id, message, created_by)
       VALUES ($1, $2, $3, $4)`,
      [tour.id, tour.vehicle_id, message, req.user?.id ?? null]
    );
  } catch (err) {
    console.error('[TOURS] Notification chauffeur non enregistrée :', err.message);
  }
  try {
    const io = req.app.get('io');
    if (io) {
      io.emit('tour:programme-updated', {
        tour_id: tour.id, vehicle_id: tour.vehicle_id, message,
      });
    }
  } catch (err) {
    console.warn('[TOURS] Diffusion temps réel ignorée :', err.message);
  }
}

/** Prochaine position libre du programme. */
async function positionSuivante(client, tourId) {
  const r = await client.query(
    `SELECT COALESCE(MAX(p), 0) + 1 AS suivante FROM (
       SELECT MAX(position) AS p FROM tour_cav WHERE tour_id = $1
       UNION ALL
       SELECT MAX(position) AS p FROM tour_arret_technique WHERE tour_id = $1
     ) x`,
    [tourId]
  );
  return r.rows[0].suivante;
}

// ── GET /api/tours/:id/programme ───────────────────────────────────────────
router.get('/:id/programme', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const tourId = parseInt(req.params.id, 10);
    if (!Number.isInteger(tourId)) return res.status(400).json({ error: 'Identifiant invalide' });
    const r = await pool.query(
      `SELECT t.id, t.date, t.status, t.vehicle_id, t.is_demo,
              t.driver_employee_id, t.suiveur1_employee_id, t.suiveur2_employee_id,
              v.registration, v.name AS vehicle_name,
              NULLIF(TRIM(CONCAT(e.first_name, ' ', e.last_name)), '') AS driver_name,
              NULLIF(TRIM(CONCAT(s1.first_name, ' ', s1.last_name)), '') AS suiveur1_name,
              NULLIF(TRIM(CONCAT(s2.first_name, ' ', s2.last_name)), '') AS suiveur2_name
         FROM tours t
         LEFT JOIN vehicles v ON v.id = t.vehicle_id
         LEFT JOIN employees e ON e.id = t.driver_employee_id
         LEFT JOIN employees s1 ON s1.id = t.suiveur1_employee_id
         LEFT JOIN employees s2 ON s2.id = t.suiveur2_employee_id
        WHERE t.id = $1`,
      [tourId]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Tournée non trouvée' });
    res.json({
      tour: r.rows[0],
      modifiable: STATUTS_MODIFIABLES.includes(r.rows[0].status),
      points: await chargerProgramme(tourId),
    });
  } catch (err) {
    console.error('[TOURS] Erreur programme :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── PUT /api/tours/:id/programme/ordre ─────────────────────────────────────
// Body : { ordre: [{ kind: 'cav'|'arret_technique', id }] }
router.put('/:id/programme/ordre', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  const tourId = parseInt(req.params.id, 10);
  if (!Number.isInteger(tourId)) return res.status(400).json({ error: 'Identifiant invalide' });
  const ordre = Array.isArray(req.body?.ordre) ? req.body.ordre : null;
  if (!ordre || ordre.length === 0) {
    return res.status(400).json({ error: 'Ordre attendu : [{ kind, id }, …]' });
  }

  const tour = await loadTourEditable(tourId, res);
  if (!tour) return;

  const client = await pool.connect();
  try {
    const actuels = await chargerProgramme(tourId);
    const cle = (p) => `${p.kind}:${p.id}`;
    const connus = new Map(actuels.map((p) => [cle(p), p]));

    // L'ordre soumis doit porter EXACTEMENT les points du programme : ni oubli
    // (un point disparaîtrait de la tournée du chauffeur), ni intrus.
    const soumis = ordre.map((o) => `${o.kind}:${parseInt(o.id, 10)}`);
    if (soumis.length !== connus.size || new Set(soumis).size !== soumis.length
        || soumis.some((k) => !connus.has(k))) {
      return res.status(400).json({
        error: 'L\'ordre soumis ne correspond pas au programme de la tournée (points manquants, en double ou inconnus).',
        code: 'ORDRE_INCOHERENT',
      });
    }

    // Les points déjà traités gardent leur rang EXACT : on ne réécrit pas le
    // passé du chauffeur. On compare la POSITION ABSOLUE de chacun, et non
    // seulement leur ordre relatif — avec un unique point figé, l'ordre relatif
    // est trivialement conservé et ne protège rien (défaut relevé en recette).
    const rangActuel = new Map(actuels.map((p, i) => [cle(p), i]));
    const deplace = actuels
      .filter((p) => !p.editable)
      .find((p) => soumis.indexOf(cle(p)) !== rangActuel.get(cle(p)));
    if (deplace) {
      return res.status(409).json({
        error: `« ${deplace.name} » a déjà été traité par le chauffeur : sa place dans la tournée ne peut plus changer.`,
        code: 'POINT_DEJA_TRAITE',
      });
    }

    await client.query('BEGIN');
    let position = 1;
    for (const k of soumis) {
      const [kind, rawId] = k.split(':');
      const id = parseInt(rawId, 10);
      const table = kind === 'cav' ? 'tour_cav' : 'tour_arret_technique';
      await client.query(
        `UPDATE ${table} SET position = $1 WHERE id = $2 AND tour_id = $3`,
        [position++, id, tourId]
      );
    }
    await client.query('COMMIT');

    await notifierChauffeur(req, tour, 'Nouvel itinéraire : l\'ordre des points a été modifié. Consulte ta carte.');
    res.json({ ok: true, points: await chargerProgramme(tourId) });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[TOURS] Erreur réordonnancement :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

// ── POST /api/tours/:id/programme/cav ──────────────────────────────────────
router.post('/:id/programme/cav', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  const tourId = parseInt(req.params.id, 10);
  const cavId = parseInt(req.body?.cav_id, 10);
  if (!Number.isInteger(tourId) || !Number.isInteger(cavId)) {
    return res.status(400).json({ error: 'Identifiants invalides' });
  }
  const tour = await loadTourEditable(tourId, res);
  if (!tour) return;

  const client = await pool.connect();
  try {
    const cav = await client.query('SELECT id, name FROM cav WHERE id = $1', [cavId]);
    if (cav.rows.length === 0) return res.status(404).json({ error: 'Point de collecte non trouvé' });

    const deja = await client.query(
      'SELECT id FROM tour_cav WHERE tour_id = $1 AND cav_id = $2', [tourId, cavId]
    );
    if (deja.rows.length > 0) {
      return res.status(409).json({
        error: 'Ce point est déjà au programme de la tournée.', code: 'POINT_DEJA_PRESENT',
      });
    }

    await client.query('BEGIN');
    const position = await positionSuivante(client, tourId);
    await client.query(
      `INSERT INTO tour_cav (tour_id, cav_id, position, status) VALUES ($1, $2, $3, 'pending')`,
      [tourId, cavId, position]
    );
    await client.query('UPDATE tours SET nb_cav = COALESCE(nb_cav, 0) + 1 WHERE id = $1', [tourId]);
    await client.query('COMMIT');

    await notifierChauffeur(req, tour, `Nouveau point ajouté à ta tournée : ${cav.rows[0].name}.`);
    res.status(201).json({ ok: true, points: await chargerProgramme(tourId) });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[TOURS] Erreur ajout de point :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

// ── DELETE /api/tours/:id/programme/cav/:tourCavId ─────────────────────────
router.delete('/:id/programme/cav/:tourCavId', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  const tourId = parseInt(req.params.id, 10);
  const tourCavId = parseInt(req.params.tourCavId, 10);
  if (!Number.isInteger(tourId) || !Number.isInteger(tourCavId)) {
    return res.status(400).json({ error: 'Identifiants invalides' });
  }
  const tour = await loadTourEditable(tourId, res);
  if (!tour) return;

  try {
    const point = await pool.query(
      `SELECT tc.status, c.name FROM tour_cav tc JOIN cav c ON c.id = tc.cav_id
        WHERE tc.id = $1 AND tc.tour_id = $2`,
      [tourCavId, tourId]
    );
    if (point.rows.length === 0) return res.status(404).json({ error: 'Point non trouvé dans cette tournée' });
    if (POINT_FIGE.includes(point.rows[0].status)) {
      return res.status(409).json({
        error: 'Ce point a déjà été traité par le chauffeur : il ne peut plus être retiré.',
        code: 'POINT_DEJA_TRAITE',
      });
    }

    await pool.query('DELETE FROM tour_cav WHERE id = $1 AND tour_id = $2', [tourCavId, tourId]);
    // Renumérotation : sans elle, retirer un point laisse un TROU définitif
    // dans l'ordre (« 1, 2, 3, 4, 6, 7 » pour six points), visible sur la fiche
    // de tournée et faussant le calcul de décalage de la ré-optimisation, qui
    // se cale sur MAX(position). L'ordre relatif est préservé.
    await pool.query(
      `WITH ordonne AS (
         SELECT id, ROW_NUMBER() OVER (ORDER BY position, id) AS rang
           FROM tour_cav WHERE tour_id = $1
       )
       UPDATE tour_cav tc SET position = o.rang
         FROM ordonne o WHERE o.id = tc.id AND tc.position <> o.rang`,
      [tourId]
    );
    await pool.query(
      'UPDATE tours SET nb_cav = GREATEST(COALESCE(nb_cav, 1) - 1, 0) WHERE id = $1', [tourId]
    );
    await notifierChauffeur(req, tour, `Point retiré de ta tournée : ${point.rows[0].name}. Tu n'as plus à y passer.`);
    res.json({ ok: true, points: await chargerProgramme(tourId) });
  } catch (err) {
    console.error('[TOURS] Erreur retrait de point :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── POST /api/tours/:id/programme/arret ────────────────────────────────────
// Body : { lieu_id } ou { libelle } — un arrêt ponctuel sans lieu référencé
// reste possible (le gestionnaire ne doit pas être bloqué par le référentiel).
router.post('/:id/programme/arret', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  const tourId = parseInt(req.params.id, 10);
  if (!Number.isInteger(tourId)) return res.status(400).json({ error: 'Identifiant invalide' });
  const lieuId = Number.isInteger(parseInt(req.body?.lieu_id, 10)) ? parseInt(req.body.lieu_id, 10) : null;
  const libelle = req.body?.libelle ? String(req.body.libelle).trim().slice(0, 150) : null;
  if (!lieuId && !libelle) {
    return res.status(400).json({ error: 'Indiquez un lieu du référentiel ou un libellé d\'arrêt.' });
  }

  const tour = await loadTourEditable(tourId, res);
  if (!tour) return;

  const client = await pool.connect();
  try {
    let nom = libelle;
    if (lieuId) {
      const lieu = await client.query('SELECT nom FROM lieux_techniques WHERE id = $1', [lieuId]);
      if (lieu.rows.length === 0) return res.status(404).json({ error: 'Lieu d\'arrêt non trouvé' });
      nom = nom || lieu.rows[0].nom;
    }

    await client.query('BEGIN');
    const position = await positionSuivante(client, tourId);
    await client.query(
      `INSERT INTO tour_arret_technique (tour_id, lieu_id, libelle, position, notes)
       VALUES ($1, $2, $3, $4, $5)`,
      [tourId, lieuId, libelle, position,
       req.body?.notes ? String(req.body.notes).trim().slice(0, 500) : null]
    );
    await client.query('COMMIT');

    await notifierChauffeur(req, tour, `Nouvel arrêt ajouté à ta tournée : ${nom}.`);
    res.status(201).json({ ok: true, points: await chargerProgramme(tourId) });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[TOURS] Erreur ajout d\'arrêt :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

// ── DELETE /api/tours/:id/programme/arret/:arretId ─────────────────────────
router.delete('/:id/programme/arret/:arretId', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  const tourId = parseInt(req.params.id, 10);
  const arretId = parseInt(req.params.arretId, 10);
  if (!Number.isInteger(tourId) || !Number.isInteger(arretId)) {
    return res.status(400).json({ error: 'Identifiants invalides' });
  }
  const tour = await loadTourEditable(tourId, res);
  if (!tour) return;

  try {
    const arret = await pool.query(
      `SELECT ta.status, COALESCE(ta.libelle, lt.nom) AS nom
         FROM tour_arret_technique ta LEFT JOIN lieux_techniques lt ON lt.id = ta.lieu_id
        WHERE ta.id = $1 AND ta.tour_id = $2`,
      [arretId, tourId]
    );
    if (arret.rows.length === 0) return res.status(404).json({ error: 'Arrêt non trouvé dans cette tournée' });
    if (POINT_FIGE.includes(arret.rows[0].status)) {
      return res.status(409).json({
        error: 'Cet arrêt a déjà été effectué : il ne peut plus être retiré.',
        code: 'POINT_DEJA_TRAITE',
      });
    }

    await pool.query('DELETE FROM tour_arret_technique WHERE id = $1 AND tour_id = $2', [arretId, tourId]);
    await notifierChauffeur(req, tour, `Arrêt retiré de ta tournée : ${arret.rows[0].nom}.`);
    res.json({ ok: true, points: await chargerProgramme(tourId) });
  } catch (err) {
    console.error('[TOURS] Erreur retrait d\'arrêt :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── PATCH /api/tours/:id/equipe ────────────────────────────────────────────
// Changement de chauffeur / suiveurs EN COURS de journée (relève, renfort,
// absence). Mêmes garde-fous que l'affectation au planning : une personne ne
// peut pas tenir deux rôles sur la même tournée.
router.patch('/:id/equipe', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  const tourId = parseInt(req.params.id, 10);
  if (!Number.isInteger(tourId)) return res.status(400).json({ error: 'Identifiant invalide' });
  const tour = await loadTourEditable(tourId, res);
  if (!tour) return;

  const CHAMPS = ['driver_employee_id', 'suiveur1_employee_id', 'suiveur2_employee_id'];
  const fourni = (c) => Object.prototype.hasOwnProperty.call(req.body || {}, c);
  const valeur = (c) => {
    const v = req.body[c];
    if (v === null || v === '') return null;
    const n = parseInt(v, 10);
    return Number.isInteger(n) ? n : undefined; // undefined = valeur illisible
  };

  const maj = {};
  for (const c of CHAMPS) {
    if (!fourni(c)) continue;
    const v = valeur(c);
    if (v === undefined) return res.status(400).json({ error: `Valeur invalide pour ${c}` });
    maj[c] = v;
  }
  if (Object.keys(maj).length === 0) {
    return res.status(400).json({ error: 'Aucun changement d\'équipe fourni.' });
  }

  // État final = existant + modifications, pour contrôler le cumul de rôles.
  const final = {
    driver_employee_id: fourni('driver_employee_id') ? maj.driver_employee_id : tour.driver_employee_id,
    suiveur1_employee_id: fourni('suiveur1_employee_id') ? maj.suiveur1_employee_id : tour.suiveur1_employee_id,
    suiveur2_employee_id: fourni('suiveur2_employee_id') ? maj.suiveur2_employee_id : tour.suiveur2_employee_id,
  };
  const occupes = Object.values(final).filter((v) => v != null);
  if (new Set(occupes).size !== occupes.length) {
    return res.status(400).json({
      error: 'Une même personne ne peut pas être à la fois chauffeur et suiveur sur cette tournée.',
      code: 'ROLE_CUMULE',
    });
  }

  try {
    const noms = await pool.query(
      `SELECT id, NULLIF(TRIM(CONCAT(first_name, ' ', last_name)), '') AS nom
         FROM employees WHERE id = ANY($1)`,
      [occupes.length ? occupes : [0]]
    );
    const parId = new Map(noms.rows.map((r) => [Number(r.id), r.nom]));
    for (const id of occupes) {
      if (!parId.has(id)) return res.status(404).json({ error: `Salarié #${id} introuvable` });
    }

    const sets = Object.keys(maj).map((c, i) => `${c} = $${i + 2}`);
    await pool.query(
      `UPDATE tours SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1`,
      [tourId, ...Object.values(maj)]
    );

    const chauffeur = final.driver_employee_id ? parId.get(final.driver_employee_id) : null;
    await notifierChauffeur(req, tour, chauffeur
      ? `Changement d'équipe : ${chauffeur} conduit désormais ce véhicule.`
      : 'Changement d\'équipe sur cette tournée.');

    res.json({ ok: true, equipe: final });
  } catch (err) {
    console.error('[TOURS] Erreur changement d\'équipe :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── Référentiel des lieux d'arrêt technique ────────────────────────────────
router.get('/lieux-techniques', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const inclureInactifs = req.query.include_inactive === '1' || req.query.include_inactive === 'true';
    const r = await pool.query(
      `SELECT id, nom, categorie, adresse, latitude, longitude, duree_min, notes, is_active
         FROM lieux_techniques
        ${inclureInactifs ? '' : 'WHERE is_active = true'}
        ORDER BY categorie, nom`
    );
    res.json(r.rows);
  } catch (err) {
    console.error('[TOURS] Erreur lieux techniques :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

const CATEGORIES = ['magasin', 'entretien', 'carburant', 'dechetterie', 'administratif', 'pause', 'autre'];

function lireLieu(body) {
  const nom = body?.nom ? String(body.nom).trim().slice(0, 150) : '';
  if (!nom) return { error: 'Le nom du lieu est obligatoire.' };
  const categorie = CATEGORIES.includes(body?.categorie) ? body.categorie : 'autre';
  const num = (v) => (v === null || v === '' || v === undefined ? null : Number(v));
  const lat = num(body?.latitude); const lng = num(body?.longitude);
  if ((lat !== null && !Number.isFinite(lat)) || (lng !== null && !Number.isFinite(lng))) {
    return { error: 'Coordonnées invalides.' };
  }
  const duree = num(body?.duree_min);
  return {
    valeurs: [
      nom, categorie,
      body?.adresse ? String(body.adresse).trim().slice(0, 500) : null,
      lat, lng,
      Number.isFinite(duree) && duree >= 0 && duree <= 480 ? Math.round(duree) : 15,
      body?.notes ? String(body.notes).trim().slice(0, 500) : null,
    ],
  };
}

router.post('/lieux-techniques', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  const lu = lireLieu(req.body);
  if (lu.error) return res.status(400).json({ error: lu.error });
  try {
    const r = await pool.query(
      `INSERT INTO lieux_techniques (nom, categorie, adresse, latitude, longitude, duree_min, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      lu.valeurs
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    console.error('[TOURS] Erreur création lieu technique :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.put('/lieux-techniques/:id', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Identifiant invalide' });
  const lu = lireLieu(req.body);
  if (lu.error) return res.status(400).json({ error: lu.error });
  try {
    const actif = req.body?.is_active === undefined ? true : Boolean(req.body.is_active);
    const r = await pool.query(
      `UPDATE lieux_techniques
          SET nom = $2, categorie = $3, adresse = $4, latitude = $5, longitude = $6,
              duree_min = $7, notes = $8, is_active = $9, updated_at = NOW()
        WHERE id = $1 RETURNING *`,
      [id, ...lu.valeurs, actif]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Lieu non trouvé' });
    res.json(r.rows[0]);
  } catch (err) {
    console.error('[TOURS] Erreur modification lieu technique :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Un lieu déjà utilisé par une tournée n'est pas supprimé : l'historique
// perdrait son libellé. On propose la désactivation, comme pour les modèles.
router.delete('/lieux-techniques/:id', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'Identifiant invalide' });
  try {
    const usage = await pool.query(
      'SELECT COUNT(*)::int AS n FROM tour_arret_technique WHERE lieu_id = $1', [id]
    );
    if (usage.rows[0].n > 0) {
      return res.status(409).json({
        error: `Ce lieu est utilisé par ${usage.rows[0].n} arrêt(s) de tournée : il ne peut pas être supprimé. `
          + 'Désactivez-le pour le retirer des listes tout en conservant l\'historique.',
        code: 'LIEU_UTILISE',
        arrets_count: usage.rows[0].n,
      });
    }
    const r = await pool.query('DELETE FROM lieux_techniques WHERE id = $1 RETURNING id', [id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Lieu non trouvé' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[TOURS] Erreur suppression lieu technique :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── GET /api/tours/trafic?bbox=sud,ouest,nord,est ──────────────────────────
// Événements de circulation de la zone affichée sur « Collecte en direct ».
// Réponse honnête quand la source n'est pas configurée ou ne répond pas : la
// carte doit distinguer « aucune perturbation » de « information indisponible ».
router.get('/trafic', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const { getTrafficIncidents } = require('../../services/traffic');
    res.json(await getTrafficIncidents(req.query.bbox));
  } catch (err) {
    console.error('[TOURS] Erreur trafic :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── GET /api/tours/trafic-public?bbox=sud,ouest,nord,est ───────────────────
// Mêmes événements de circulation, pour la carte du CHAUFFEUR : il doit voir
// le bouchon qui l'attend, pas seulement le gestionnaire au bureau.
//
// Auth : JWT chauffeur (suffixe « -public », garde appliquée en amont par
// tours/index.js). Aucune donnée propre à un véhicule n'est exposée ici — ce
// sont les incidents publics d'une emprise de carte — donc aucun périmètre
// véhicule n'a de sens à appliquer.
//
// Quota : le service met en cache par emprise arrondie (~2 km) pendant 5 min,
// et les chauffeurs travaillent tous sur le même territoire. Quatre camions
// qui consultent la carte coûtent donc à peine plus qu'un seul.
router.get('/trafic-public', async (req, res) => {
  try {
    const { getTrafficIncidents } = require('../../services/traffic');
    res.json(await getTrafficIncidents(req.query.bbox));
  } catch (err) {
    console.error('[TOURS] Erreur trafic-public :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
module.exports.chargerProgramme = chargerProgramme;
module.exports.STATUTS_MODIFIABLES = STATUTS_MODIFIABLES;
module.exports.POINT_FIGE = POINT_FIGE;
