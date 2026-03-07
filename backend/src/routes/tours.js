const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

// Upload photos incidents
const photoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '..', '..', 'uploads', 'incidents');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, `incident_${Date.now()}${path.extname(file.originalname)}`),
});
const upload = multer({ storage: photoStorage, limits: { fileSize: 10 * 1024 * 1024 } });

// Centre de tri (coordonnées par défaut)
const CENTRE_TRI_LAT = parseFloat(process.env.CENTRE_TRI_LAT) || 49.4231;
const CENTRE_TRI_LNG = parseFloat(process.env.CENTRE_TRI_LNG) || 1.0993;

// ══════════════════════════════════════════════════════════════
// ALGORITHMES GÉOGRAPHIQUES
// ══════════════════════════════════════════════════════════════

function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// TSP : Plus proche voisin (Nearest Neighbor)
function nearestNeighborTSP(points, startLat, startLng) {
  const remaining = [...points];
  const ordered = [];
  let currentLat = startLat;
  let currentLng = startLng;

  while (remaining.length > 0) {
    let minDist = Infinity;
    let nearestIdx = 0;
    for (let i = 0; i < remaining.length; i++) {
      const d = haversineDistance(currentLat, currentLng, remaining[i].latitude, remaining[i].longitude);
      if (d < minDist) { minDist = d; nearestIdx = i; }
    }
    const nearest = remaining.splice(nearestIdx, 1)[0];
    ordered.push(nearest);
    currentLat = nearest.latitude;
    currentLng = nearest.longitude;
  }
  return ordered;
}

// Amélioration 2-opt
function twoOptImprove(route, startLat, startLng) {
  let improved = true;
  let bestRoute = [...route];

  while (improved) {
    improved = false;
    for (let i = 0; i < bestRoute.length - 1; i++) {
      for (let j = i + 2; j < bestRoute.length; j++) {
        const newRoute = [...bestRoute];
        // Inverser le segment entre i+1 et j
        const segment = newRoute.splice(i + 1, j - i);
        segment.reverse();
        newRoute.splice(i + 1, 0, ...segment);

        const oldDist = calculateTotalDistance(bestRoute, startLat, startLng);
        const newDist = calculateTotalDistance(newRoute, startLat, startLng);

        if (newDist < oldDist) {
          bestRoute = newRoute;
          improved = true;
        }
      }
    }
  }
  return bestRoute;
}

function calculateTotalDistance(route, startLat, startLng) {
  let total = 0;
  let prevLat = startLat, prevLng = startLng;
  for (const p of route) {
    total += haversineDistance(prevLat, prevLng, p.latitude, p.longitude);
    prevLat = p.latitude;
    prevLng = p.longitude;
  }
  // Retour au centre
  total += haversineDistance(prevLat, prevLng, startLat, startLng);
  return total;
}

// ══════════════════════════════════════════════════════════════
// MOTEUR DE PRÉDICTION DE REMPLISSAGE (IA)
// ══════════════════════════════════════════════════════════════

// Facteurs saisonniers mensuels (jan→déc)
const SEASONAL_FACTORS = [0.8, 0.85, 0.95, 1.05, 1.15, 1.2, 1.15, 1.1, 1.05, 0.95, 0.85, 0.8];

// Facteurs jour de la semaine (lun→dim) — les gens trient plus le weekend
const DAY_OF_WEEK_FACTORS = [1.0, 1.0, 1.0, 1.0, 1.05, 1.15, 1.1];

// Jours fériés français (approximation)
const FRENCH_HOLIDAYS_2026 = [
  '2026-01-01', '2026-04-06', '2026-05-01', '2026-05-08',
  '2026-05-14', '2026-05-25', '2026-07-14', '2026-08-15',
  '2026-11-01', '2026-11-11', '2026-12-25',
];

function isHoliday(dateStr) {
  return FRENCH_HOLIDAYS_2026.includes(dateStr);
}

async function predictFillRate(cavId, targetDate) {
  const now = new Date(targetDate || Date.now());
  const monthIndex = now.getMonth();
  const dayOfWeek = now.getDay() === 0 ? 6 : now.getDay() - 1; // 0=lun, 6=dim
  const dateStr = now.toISOString().split('T')[0];

  // Récupérer l'historique de ce CAV
  const histResult = await pool.query(
    `SELECT date, weight_kg FROM tonnage_history
     WHERE cav_id = $1 AND date >= NOW() - INTERVAL '180 days'
     ORDER BY date DESC`,
    [cavId]
  );

  const cavResult = await pool.query('SELECT * FROM cav WHERE id = $1', [cavId]);
  if (cavResult.rows.length === 0) return { fill: 0, confidence: 0 };
  const cav = cavResult.rows[0];

  const history = histResult.rows;

  if (history.length === 0) {
    // Pas d'historique → estimation par défaut
    return {
      fill: 50, // Milieu de fourchette
      confidence: 0.2,
      method: 'default',
    };
  }

  // Calculer le poids moyen par collecte
  const avgWeight = history.reduce((sum, h) => sum + parseFloat(h.weight_kg), 0) / history.length;

  // Jours depuis dernière collecte
  const lastCollection = history[0].date;
  const daysSince = Math.floor((now - new Date(lastCollection)) / 86400000);

  // Accumulation journalière estimée
  const dailyAccumulation = avgWeight / 7; // Hypothèse : collecte hebdomadaire moyenne

  // Calcul du remplissage brut
  let rawFill = (daysSince * dailyAccumulation / (cav.nb_containers || 1)) * 100;

  // Appliquer les facteurs
  rawFill *= SEASONAL_FACTORS[monthIndex];
  rawFill *= DAY_OF_WEEK_FACTORS[dayOfWeek];

  // Facteur vacances : +10% pendant les semaines de fêtes
  if (isHoliday(dateStr)) rawFill *= 1.1;

  // Tendance sur les 30 derniers jours vs les 90 jours
  const recent30 = history.filter(h => {
    const d = new Date(h.date);
    return (now - d) / 86400000 <= 30;
  });
  const older = history.filter(h => {
    const d = new Date(h.date);
    return (now - d) / 86400000 > 30 && (now - d) / 86400000 <= 90;
  });

  if (recent30.length > 0 && older.length > 0) {
    const recentAvg = recent30.reduce((s, h) => s + parseFloat(h.weight_kg), 0) / recent30.length;
    const olderAvg = older.reduce((s, h) => s + parseFloat(h.weight_kg), 0) / older.length;
    const trend = recentAvg / olderAvg; // >1 = tendance hausse
    rawFill *= trend;
  }

  // Facteur densité de population (basé sur le nombre de conteneurs)
  // Plus de conteneurs = zone plus dense = remplissage potentiellement plus rapide
  if (cav.nb_containers >= 3) rawFill *= 1.1;

  // Cap à 120%
  const fill = Math.min(120, Math.max(0, rawFill));

  // Confiance basée sur la quantité de données
  const confidence = Math.min(0.95, 0.3 + (history.length * 0.05));

  return {
    fill: Math.round(fill),
    confidence: Math.round(confidence * 100) / 100,
    method: 'predictive',
    factors: {
      seasonal: SEASONAL_FACTORS[monthIndex],
      dayOfWeek: DAY_OF_WEEK_FACTORS[dayOfWeek],
      daysSinceCollection: daysSince,
      avgWeight: Math.round(avgWeight * 10) / 10,
      dailyAccumulation: Math.round(dailyAccumulation * 10) / 10,
    },
  };
}

// ══════════════════════════════════════════════════════════════
// ALGORITHME DE TOURNÉE INTELLIGENTE
// ══════════════════════════════════════════════════════════════
async function generateIntelligentTour(vehicleId, date) {
  // 1. Récupérer le véhicule
  const vResult = await pool.query('SELECT * FROM vehicles WHERE id = $1', [vehicleId]);
  if (vResult.rows.length === 0) throw new Error('Véhicule non trouvé');
  const vehicle = vResult.rows[0];

  // 2. Récupérer tous les CAV actifs
  const cavResult = await pool.query("SELECT * FROM cav WHERE status = 'active' ORDER BY name");
  const allCavs = cavResult.rows;

  // 3. Prédire le remplissage pour chaque CAV
  const cavWithPredictions = [];
  for (const cav of allCavs) {
    const prediction = await predictFillRate(cav.id, date);
    cavWithPredictions.push({ ...cav, prediction });
  }

  // 4. Calculer le score de priorité
  const scoredCavs = cavWithPredictions.map(cav => {
    const fill = cav.prediction.fill;
    let score = 0;

    // Score basé sur le remplissage
    if (fill >= 100) score += 50;
    else if (fill >= 80) score += 35;
    else if (fill >= 60) score += 20;
    else if (fill >= 40) score += 10;
    else score += 2;

    // Bonus : jours depuis dernière collecte
    score += (cav.prediction.factors?.daysSinceCollection || 0) * 1.5;

    // Bonus : nombre de conteneurs (priorité aux grands sites)
    score += (cav.nb_containers || 1) * 3;

    // Bonus confiance
    score *= cav.prediction.confidence;

    return { ...cav, score: Math.round(score * 10) / 10 };
  });

  // 5. Trier par score décroissant
  scoredCavs.sort((a, b) => b.score - a.score);

  // 6. Sélectionner les CAV pour remplir le véhicule à 95% de sa capacité
  const maxCapacity = vehicle.max_capacity_kg * 0.95;
  let estimatedWeight = 0;
  const selectedCavs = [];
  let urgentCount = 0;

  for (const cav of scoredCavs) {
    const estimatedCavWeight = cav.prediction.factors?.avgWeight || 50;
    if (estimatedWeight + estimatedCavWeight <= maxCapacity) {
      selectedCavs.push(cav);
      estimatedWeight += estimatedCavWeight;
      if (cav.prediction.fill >= 80) urgentCount++;
    }
    if (estimatedWeight >= maxCapacity) break;
  }

  // 7. Optimiser la route (TSP + 2-opt)
  let optimizedRoute = nearestNeighborTSP(selectedCavs, CENTRE_TRI_LAT, CENTRE_TRI_LNG);
  optimizedRoute = twoOptImprove(optimizedRoute, CENTRE_TRI_LAT, CENTRE_TRI_LNG);

  // 8. Calculer distance et durée
  const totalDistance = calculateTotalDistance(optimizedRoute, CENTRE_TRI_LAT, CENTRE_TRI_LNG);
  const estimatedDuration = Math.round((totalDistance / 30) * 60 + selectedCavs.length * 10); // 30 km/h + 10 min par CAV

  // 9. Générer l'explication IA
  const explanation = generateAIExplanation(optimizedRoute, totalDistance, estimatedDuration, estimatedWeight, urgentCount, vehicle);

  return {
    vehicle,
    cavList: optimizedRoute.map((cav, idx) => ({
      cav_id: cav.id,
      name: cav.name,
      address: cav.address,
      commune: cav.commune,
      latitude: cav.latitude,
      longitude: cav.longitude,
      position: idx + 1,
      predicted_fill: cav.prediction.fill,
      confidence: cav.prediction.confidence,
      score: cav.score,
      estimated_weight: cav.prediction.factors?.avgWeight || 50,
      nb_containers: cav.nb_containers,
    })),
    stats: {
      totalCavs: optimizedRoute.length,
      totalDistance: Math.round(totalDistance * 10) / 10,
      estimatedDuration,
      estimatedWeight: Math.round(estimatedWeight),
      maxCapacity: vehicle.max_capacity_kg,
      fillRate: Math.round((estimatedWeight / vehicle.max_capacity_kg) * 100),
      urgentCavs: urgentCount,
    },
    explanation,
  };
}

function generateAIExplanation(route, distance, duration, weight, urgentCount, vehicle) {
  const lines = [];
  lines.push(`📊 Tournée intelligente générée pour ${vehicle.name || vehicle.registration}`);
  lines.push(`\n🚛 ${route.length} points de collecte sélectionnés parmi les CAV actifs`);
  lines.push(`📏 Distance totale estimée : ${Math.round(distance * 10) / 10} km`);
  lines.push(`⏱️ Durée estimée : ${Math.floor(duration / 60)}h${String(duration % 60).padStart(2, '0')}`);
  lines.push(`⚖️ Poids estimé : ${Math.round(weight)} kg / ${vehicle.max_capacity_kg} kg (${Math.round(weight / vehicle.max_capacity_kg * 100)}%)`);

  if (urgentCount > 0) {
    lines.push(`\n⚠️ ${urgentCount} CAV urgents (remplissage ≥80%)`);
  }

  lines.push(`\n🔬 Méthode : Prédiction de remplissage (historique 180j + saisonnalité + tendance) + TSP 2-opt`);

  const topCavs = route.slice(0, 3);
  if (topCavs.length > 0) {
    lines.push(`\n🏆 Priorités :`);
    topCavs.forEach((cav, i) => {
      lines.push(`  ${i + 1}. ${cav.name} — remplissage estimé ${cav.prediction.fill}% (confiance ${Math.round(cav.prediction.confidence * 100)}%)`);
    });
  }

  return lines.join('\n');
}

// ══════════════════════════════════════════════════════════════
// ROUTES API
// ══════════════════════════════════════════════════════════════

router.use(authenticate);

// GET /api/tours — Liste des tournées
router.get('/', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const { date, status, vehicle_id } = req.query;
    let query = `
      SELECT t.*, v.registration as vehicle_registration, v.name as vehicle_name,
       e.first_name as driver_first_name, e.last_name as driver_last_name,
       sr.name as route_name,
       (SELECT COUNT(*) FROM tour_cav tc WHERE tc.tour_id = t.id) as cav_count,
       (SELECT COUNT(*) FROM tour_cav tc WHERE tc.tour_id = t.id AND tc.status = 'collected') as collected_count
      FROM tours t
      LEFT JOIN vehicles v ON t.vehicle_id = v.id
      LEFT JOIN employees e ON t.driver_employee_id = e.id
      LEFT JOIN standard_routes sr ON t.standard_route_id = sr.id
      WHERE 1=1
    `;
    const params = [];

    if (date) { params.push(date); query += ` AND t.date = $${params.length}`; }
    if (status) { params.push(status); query += ` AND t.status = $${params.length}`; }
    if (vehicle_id) { params.push(vehicle_id); query += ` AND t.vehicle_id = $${params.length}`; }

    query += ' ORDER BY t.date DESC, t.created_at DESC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[TOURS] Erreur liste :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/tours/:id — Détail avec CAV et pesées
router.get('/:id', async (req, res) => {
  try {
    const tour = await pool.query(`
      SELECT t.*, v.registration, v.name as vehicle_name, v.max_capacity_kg,
       e.first_name as driver_first_name, e.last_name as driver_last_name
      FROM tours t
      LEFT JOIN vehicles v ON t.vehicle_id = v.id
      LEFT JOIN employees e ON t.driver_employee_id = e.id
      WHERE t.id = $1
    `, [req.params.id]);

    if (tour.rows.length === 0) return res.status(404).json({ error: 'Tournée non trouvée' });

    const cavs = await pool.query(
      `SELECT tc.*, c.name as cav_name, c.address, c.commune, c.latitude, c.longitude, c.nb_containers
       FROM tour_cav tc JOIN cav c ON tc.cav_id = c.id
       WHERE tc.tour_id = $1 ORDER BY tc.position`,
      [req.params.id]
    );

    const weights = await pool.query(
      'SELECT * FROM tour_weights WHERE tour_id = $1 ORDER BY recorded_at',
      [req.params.id]
    );

    const incidents = await pool.query(
      'SELECT * FROM incidents WHERE tour_id = $1 ORDER BY created_at',
      [req.params.id]
    );

    const checklist = await pool.query(
      'SELECT * FROM vehicle_checklists WHERE tour_id = $1',
      [req.params.id]
    );

    res.json({
      ...tour.rows[0],
      cavs: cavs.rows,
      weights: weights.rows,
      incidents: incidents.rows,
      checklist: checklist.rows[0] || null,
    });
  } catch (err) {
    console.error('[TOURS] Erreur détail :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/tours/intelligent — Générer une tournée intelligente
router.post('/intelligent', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const { vehicle_id, date, driver_employee_id } = req.body;
    if (!vehicle_id || !date) {
      return res.status(400).json({ error: 'vehicle_id et date requis' });
    }

    const result = await generateIntelligentTour(vehicle_id, date);

    // Créer la tournée en BDD
    const tourResult = await pool.query(
      `INSERT INTO tours (date, vehicle_id, driver_employee_id, mode, status, ai_explanation)
       VALUES ($1, $2, $3, 'intelligent', 'planned', $4) RETURNING *`,
      [date, vehicle_id, driver_employee_id, result.explanation]
    );
    const tourId = tourResult.rows[0].id;

    // Insérer les CAV
    for (const cav of result.cavList) {
      await pool.query(
        'INSERT INTO tour_cav (tour_id, cav_id, position) VALUES ($1, $2, $3)',
        [tourId, cav.cav_id, cav.position]
      );
    }

    res.status(201).json({
      tour: tourResult.rows[0],
      ...result,
    });
  } catch (err) {
    console.error('[TOURS] Erreur tournée intelligente :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/tours/standard — Créer une tournée standard (route prédéfinie)
router.post('/standard', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const { vehicle_id, date, driver_employee_id, standard_route_id } = req.body;
    if (!vehicle_id || !date || !standard_route_id) {
      return res.status(400).json({ error: 'vehicle_id, date et standard_route_id requis' });
    }

    const tourResult = await pool.query(
      `INSERT INTO tours (date, vehicle_id, driver_employee_id, standard_route_id, mode, status)
       VALUES ($1, $2, $3, $4, 'standard', 'planned') RETURNING *`,
      [date, vehicle_id, driver_employee_id, standard_route_id]
    );
    const tourId = tourResult.rows[0].id;

    // Copier les CAV de la route standard
    const routeCavs = await pool.query(
      'SELECT * FROM standard_route_cav WHERE route_id = $1 ORDER BY position',
      [standard_route_id]
    );
    for (const rc of routeCavs.rows) {
      await pool.query(
        'INSERT INTO tour_cav (tour_id, cav_id, position) VALUES ($1, $2, $3)',
        [tourId, rc.cav_id, rc.position]
      );
    }

    res.status(201).json(tourResult.rows[0]);
  } catch (err) {
    console.error('[TOURS] Erreur tournée standard :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/tours/manual — Créer une tournée manuelle
router.post('/manual', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const { vehicle_id, date, driver_employee_id, cav_ids } = req.body;
    if (!vehicle_id || !date || !cav_ids?.length) {
      return res.status(400).json({ error: 'vehicle_id, date et cav_ids requis' });
    }

    const tourResult = await pool.query(
      `INSERT INTO tours (date, vehicle_id, driver_employee_id, mode, status)
       VALUES ($1, $2, $3, 'manual', 'planned') RETURNING *`,
      [date, vehicle_id, driver_employee_id]
    );
    const tourId = tourResult.rows[0].id;

    for (let i = 0; i < cav_ids.length; i++) {
      await pool.query(
        'INSERT INTO tour_cav (tour_id, cav_id, position) VALUES ($1, $2, $3)',
        [tourId, cav_ids[i], i + 1]
      );
    }

    res.status(201).json(tourResult.rows[0]);
  } catch (err) {
    console.error('[TOURS] Erreur tournée manuelle :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/tours/:id/status — Changer le statut
router.put('/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    const validStatuses = ['planned', 'in_progress', 'paused', 'completed', 'cancelled'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: 'Statut invalide' });
    }

    const updates = ['status = $1', 'updated_at = NOW()'];
    const params = [status];

    if (status === 'in_progress') updates.push('started_at = NOW()');
    if (status === 'completed') updates.push('completed_at = NOW()');

    params.push(req.params.id);
    const result = await pool.query(
      `UPDATE tours SET ${updates.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'Tournée non trouvée' });

    // Remettre le véhicule en available si terminé
    if (status === 'completed' || status === 'cancelled') {
      const tour = result.rows[0];
      await pool.query("UPDATE vehicles SET status = 'available' WHERE id = $1", [tour.vehicle_id]);

      // Mettre à jour le tonnage dans l'historique si complété
      if (status === 'completed' && tour.total_weight_kg > 0) {
        const cavs = await pool.query(
          "SELECT cav_id FROM tour_cav WHERE tour_id = $1 AND status = 'collected'",
          [req.params.id]
        );
        const weightPerCav = tour.total_weight_kg / (cavs.rows.length || 1);
        for (const tc of cavs.rows) {
          await pool.query(
            "INSERT INTO tonnage_history (date, cav_id, weight_kg, source) VALUES ($1, $2, $3, 'mobile')",
            [tour.date, tc.cav_id, weightPerCav]
          );
        }
      }
    } else if (status === 'in_progress') {
      const tour = result.rows[0];
      await pool.query("UPDATE vehicles SET status = 'in_use' WHERE id = $1", [tour.vehicle_id]);
    }

    // Émettre l'événement Socket.io
    const io = req.app.get('io');
    if (io) io.to(`tour-${req.params.id}`).emit('tour-status-update', { tourId: req.params.id, status });

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[TOURS] Erreur changement statut :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/tours/:tourId/cav/:cavId — Mettre à jour un CAV de tournée
router.put('/:tourId/cav/:cavId', async (req, res) => {
  try {
    const { status, fill_level, qr_scanned, qr_unavailable, qr_unavailable_reason, notes } = req.body;

    const result = await pool.query(
      `UPDATE tour_cav SET status = COALESCE($1, status),
       fill_level = COALESCE($2, fill_level),
       qr_scanned = COALESCE($3, qr_scanned),
       qr_unavailable = COALESCE($4, qr_unavailable),
       qr_unavailable_reason = COALESCE($5, qr_unavailable_reason),
       notes = COALESCE($6, notes),
       collected_at = CASE WHEN $1 = 'collected' THEN NOW() ELSE collected_at END
       WHERE tour_id = $7 AND cav_id = $8 RETURNING *`,
      [status, fill_level, qr_scanned, qr_unavailable, qr_unavailable_reason, notes, req.params.tourId, req.params.cavId]
    );

    if (result.rows.length === 0) return res.status(404).json({ error: 'CAV de tournée non trouvé' });

    // Socket.io broadcast
    const io = req.app.get('io');
    if (io) io.to(`tour-${req.params.tourId}`).emit('cav-status-update', result.rows[0]);

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[TOURS] Erreur MAJ CAV :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/tours/:id/weigh — Enregistrer une pesée
router.post('/:id/weigh', async (req, res) => {
  try {
    const { weight_kg, employee_id } = req.body;
    if (!weight_kg) return res.status(400).json({ error: 'Poids requis' });

    const result = await pool.query(
      'INSERT INTO tour_weights (tour_id, weight_kg, recorded_by) VALUES ($1, $2, $3) RETURNING *',
      [req.params.id, weight_kg, employee_id || null]
    );

    // Mettre à jour le total de la tournée
    await pool.query(
      'UPDATE tours SET total_weight_kg = (SELECT COALESCE(SUM(weight_kg), 0) FROM tour_weights WHERE tour_id = $1) WHERE id = $1',
      [req.params.id]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[TOURS] Erreur pesée :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/tours/:id/checklist — Checklist véhicule
router.post('/:id/checklist', async (req, res) => {
  try {
    const { vehicle_id, employee_id, exterior_ok, fuel_level, km_start } = req.body;

    const result = await pool.query(
      `INSERT INTO vehicle_checklists (tour_id, vehicle_id, employee_id, exterior_ok, fuel_level, km_start)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [req.params.id, vehicle_id, employee_id, exterior_ok, fuel_level, km_start]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[TOURS] Erreur checklist :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/tours/:id/checklist/end — Finaliser checklist (km fin)
router.put('/:id/checklist/end', async (req, res) => {
  try {
    const { km_end } = req.body;
    const result = await pool.query(
      'UPDATE vehicle_checklists SET km_end = $1 WHERE tour_id = $2 RETURNING *',
      [km_end, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Checklist non trouvée' });

    // Mettre à jour le km du véhicule
    if (km_end) {
      await pool.query(
        'UPDATE vehicles SET current_km = $1, updated_at = NOW() WHERE id = $2',
        [km_end, result.rows[0].vehicle_id]
      );
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error('[TOURS] Erreur fin checklist :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/tours/:id/incidents — Signaler un incident
router.post('/:id/incidents', upload.single('photo'), async (req, res) => {
  try {
    const { cav_id, employee_id, vehicle_id, type, description } = req.body;
    const photo_path = req.file ? `/uploads/incidents/${req.file.filename}` : null;

    const result = await pool.query(
      `INSERT INTO incidents (tour_id, cav_id, employee_id, vehicle_id, type, description, photo_path)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [req.params.id, cav_id, employee_id, vehicle_id, type, description, photo_path]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[TOURS] Erreur incident :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/tours/:id/gps — Positions GPS
router.get('/:id/gps', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM gps_positions WHERE tour_id = $1 ORDER BY recorded_at',
      [req.params.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('[TOURS] Erreur GPS :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/tours/predict/:cavId — Prédiction de remplissage pour un CAV
router.get('/predict/:cavId', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const prediction = await predictFillRate(req.params.cavId, req.query.date);
    res.json(prediction);
  } catch (err) {
    console.error('[TOURS] Erreur prédiction :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════
// ROUTES STANDARD
// ══════════════════════════════════════════

// GET /api/tours/routes — Routes standard
router.get('/routes/list', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT sr.*, COUNT(src.id) as cav_count
      FROM standard_routes sr
      LEFT JOIN standard_route_cav src ON src.route_id = sr.id
      GROUP BY sr.id ORDER BY sr.name
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('[TOURS] Erreur routes standard :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/tours/routes — Créer route standard
router.post('/routes', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const { name, description, cav_ids } = req.body;
    if (!name) return res.status(400).json({ error: 'Nom requis' });

    const result = await pool.query(
      'INSERT INTO standard_routes (name, description) VALUES ($1, $2) RETURNING *',
      [name, description]
    );
    const routeId = result.rows[0].id;

    if (cav_ids?.length) {
      for (let i = 0; i < cav_ids.length; i++) {
        await pool.query(
          'INSERT INTO standard_route_cav (route_id, cav_id, position) VALUES ($1, $2, $3)',
          [routeId, cav_ids[i], i + 1]
        );
      }
    }

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('[TOURS] Erreur création route :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
