const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const FillRateModel = require('../services/ml-model');

// Cache du modèle en mémoire pour éviter de le recharger à chaque prédiction
let cachedModel = null;

/**
 * Charger le modèle actif depuis la base de données
 */
async function loadActiveModel() {
  if (cachedModel) return cachedModel;

  const result = await pool.query(
    `SELECT model_path FROM ml_model_metadata
     WHERE model_name = 'fill_rate_linear' AND is_active = true
     ORDER BY trained_at DESC LIMIT 1`
  );

  if (result.rows.length === 0) return null;

  try {
    const modelData = JSON.parse(result.rows[0].model_path);
    cachedModel = FillRateModel.fromJSON(modelData);
    return cachedModel;
  } catch (err) {
    console.error('[ML] Erreur chargement modèle:', err.message);
    return null;
  }
}

/**
 * Déterminer si une date tombe pendant les vacances scolaires (zone B - Normandie)
 * Approximation basée sur les périodes courantes
 */
function isVacationPeriod(date) {
  const d = new Date(date);
  const month = d.getMonth() + 1; // 1-12
  const day = d.getDate();

  // Vacances d'été (juillet-août)
  if (month === 7 || month === 8) return 1;
  // Vacances de Noël (~20 déc - 3 jan)
  if ((month === 12 && day >= 20) || (month === 1 && day <= 3)) return 1;
  // Vacances de février (~10-25 fév)
  if (month === 2 && day >= 10 && day <= 25) return 1;
  // Vacances de Pâques (~début avril, ~2 semaines)
  if (month === 4 && day >= 5 && day <= 21) return 1;
  // Vacances de Toussaint (~19 oct - 3 nov)
  if ((month === 10 && day >= 19) || (month === 11 && day <= 3)) return 1;

  return 0;
}

/**
 * Construire le vecteur de features pour un CAV à une date donnée
 */
async function buildFeatures(cavId, date) {
  const d = new Date(date);

  // Info CAV
  const cavResult = await pool.query(
    'SELECT nb_containers, avg_fill_rate FROM cav WHERE id = $1',
    [cavId]
  );
  if (cavResult.rows.length === 0) return null;
  const cav = cavResult.rows[0];

  // Dernière collecte pour ce CAV
  const lastCollectionResult = await pool.query(
    `SELECT MAX(t.date) as last_date
     FROM tours t
     JOIN tour_cav tc ON tc.tour_id = t.id
     WHERE tc.cav_id = $1 AND t.status = 'completed' AND t.date < $2`,
    [cavId, date]
  );
  const lastDate = lastCollectionResult.rows[0]?.last_date;
  const daysSinceCollection = lastDate
    ? Math.floor((d - new Date(lastDate)) / (1000 * 60 * 60 * 24))
    : 14; // valeur par défaut si pas d'historique

  // Moyenne historique de poids pour ce CAV
  const avgResult = await pool.query(
    'SELECT AVG(weight_kg) as avg_weight FROM tonnage_history WHERE cav_id = $1',
    [cavId]
  );
  const historicalAvg = parseFloat(avgResult.rows[0]?.avg_weight) || parseFloat(cav.avg_fill_rate) || 50;

  // Température (depuis collection_context si disponible)
  const dateStr = d.toISOString().split('T')[0];
  const ctxResult = await pool.query(
    'SELECT temp_max FROM collection_context WHERE date = $1',
    [dateStr]
  );
  const temperature = ctxResult.rows[0]?.temp_max != null
    ? parseFloat(ctxResult.rows[0].temp_max)
    : 15; // valeur par défaut

  return [
    d.getDay(),                           // day_of_week (0-6)
    d.getMonth() + 1,                     // month (1-12)
    daysSinceCollection,                  // days_since_collection
    historicalAvg,                        // historical_avg
    parseInt(cav.nb_containers) || 1,     // nb_containers
    isVacationPeriod(d),                  // is_vacation
    temperature,                          // temperature
  ];
}

// ══════════════════════════════════════════════════════════════
// POST /api/ml/train — Entraîner le modèle sur les données historiques
// ══════════════════════════════════════════════════════════════
router.post('/train', authenticate, authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const { learningRate = 0.01, epochs = 1000 } = req.body;

    // 1. Récupérer les données historiques
    //    On joint tonnage_history avec cav et tours pour construire les features
    const dataResult = await pool.query(`
      SELECT
        th.date,
        th.cav_id,
        th.weight_kg,
        c.nb_containers,
        c.avg_fill_rate,
        EXTRACT(DOW FROM th.date) AS day_of_week,
        EXTRACT(MONTH FROM th.date) AS month,
        cc.temp_max
      FROM tonnage_history th
      JOIN cav c ON c.id = th.cav_id
      LEFT JOIN collection_context cc ON cc.date = th.date
      WHERE th.cav_id IS NOT NULL AND th.weight_kg > 0
      ORDER BY th.date ASC
    `);

    if (dataResult.rows.length < 10) {
      return res.status(400).json({
        error: 'Pas assez de données pour entraîner le modèle',
        samples: dataResult.rows.length,
        minimum: 10,
      });
    }

    // 2. Construire la matrice de features et le vecteur cible
    const X = [];
    const y = [];

    // Calculer les jours depuis dernière collecte pour chaque entrée
    // Regrouper par cav_id et trier par date pour calculer les intervalles
    const byCav = {};
    for (const row of dataResult.rows) {
      const cavId = row.cav_id;
      if (!byCav[cavId]) byCav[cavId] = [];
      byCav[cavId].push(row);
    }

    for (const cavId of Object.keys(byCav)) {
      const entries = byCav[cavId].sort((a, b) => new Date(a.date) - new Date(b.date));

      // Calculer la moyenne historique pour ce CAV
      let sumWeight = 0;
      for (const e of entries) sumWeight += parseFloat(e.weight_kg);
      const avgWeight = sumWeight / entries.length;

      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const d = new Date(entry.date);

        // Jours depuis dernière collecte
        let daysSince = 7; // défaut
        if (i > 0) {
          const prevDate = new Date(entries[i - 1].date);
          daysSince = Math.floor((d - prevDate) / (1000 * 60 * 60 * 24));
        }

        const features = [
          parseInt(entry.day_of_week),                    // day_of_week
          parseInt(entry.month),                           // month
          daysSince,                                       // days_since_collection
          avgWeight,                                       // historical_avg
          parseInt(entry.nb_containers) || 1,              // nb_containers
          isVacationPeriod(d),                             // is_vacation
          entry.temp_max != null ? parseFloat(entry.temp_max) : 15, // temperature
        ];

        X.push(features);
        // Target: poids comme proxy du taux de remplissage
        // Normaliser par nb_containers pour avoir un « taux » relatif
        const nbContainers = parseInt(entry.nb_containers) || 1;
        const fillProxy = parseFloat(entry.weight_kg) / nbContainers;
        y.push(fillProxy);
      }
    }

    // 3. Entraîner le modèle
    const model = new FillRateModel();
    const metrics = model.train(X, y, learningRate, epochs);

    // 4. Sauvegarder dans ml_model_metadata
    const version = `v${Date.now()}`;
    const serialized = JSON.stringify(model.toJSON());

    // Désactiver les anciens modèles
    await pool.query(
      `UPDATE ml_model_metadata SET is_active = false WHERE model_name = 'fill_rate_linear'`
    );

    await pool.query(
      `INSERT INTO ml_model_metadata (model_name, version, metrics, training_samples, is_active, model_path)
       VALUES ($1, $2, $3, $4, true, $5)`,
      [
        'fill_rate_linear',
        version,
        JSON.stringify({ mse: metrics.mse, r2: metrics.r2 }),
        X.length,
        serialized,
      ]
    );

    // Mettre à jour le cache
    cachedModel = model;

    res.json({
      success: true,
      version,
      samples: X.length,
      metrics: {
        mse: Math.round(metrics.mse * 100) / 100,
        r2: Math.round(metrics.r2 * 10000) / 10000,
      },
      lossHistory: metrics.history,
    });
  } catch (err) {
    console.error('[ML] Erreur entraînement:', err);
    res.status(500).json({ error: 'Erreur lors de l\'entraînement du modèle' });
  }
});

// ══════════════════════════════════════════════════════════════
// GET /api/ml/status — Statut du modèle actif
// ══════════════════════════════════════════════════════════════
router.get('/status', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, model_name, version, metrics, trained_at, training_samples, is_active
       FROM ml_model_metadata
       WHERE model_name = 'fill_rate_linear'
       ORDER BY trained_at DESC
       LIMIT 5`
    );

    const active = result.rows.find(r => r.is_active);
    const model = await loadActiveModel();

    res.json({
      hasActiveModel: !!active,
      modelLoaded: !!model,
      active: active ? {
        id: active.id,
        version: active.version,
        trainedAt: active.trained_at,
        samples: active.training_samples,
        metrics: active.metrics,
      } : null,
      history: result.rows.map(r => ({
        id: r.id,
        version: r.version,
        trainedAt: r.trained_at,
        samples: r.training_samples,
        metrics: r.metrics,
        isActive: r.is_active,
      })),
    });
  } catch (err) {
    console.error('[ML] Erreur statut:', err);
    res.status(500).json({ error: 'Erreur récupération statut modèle' });
  }
});

// ══════════════════════════════════════════════════════════════
// GET /api/ml/predict/:cavId — Prédiction pour un CAV spécifique
// ══════════════════════════════════════════════════════════════
router.get('/predict/:cavId', authenticate, async (req, res) => {
  try {
    const cavId = parseInt(req.params.cavId);
    if (isNaN(cavId)) {
      return res.status(400).json({ error: 'ID CAV invalide' });
    }

    const model = await loadActiveModel();
    if (!model) {
      return res.status(404).json({ error: 'Aucun modèle entraîné. Lancez POST /api/ml/train d\'abord.' });
    }

    const date = req.query.date || new Date().toISOString().split('T')[0];
    const features = await buildFeatures(cavId, date);

    if (!features) {
      return res.status(404).json({ error: 'CAV non trouvé' });
    }

    const prediction = model.predict(features);

    // Stocker la prédiction
    await pool.query(
      `INSERT INTO ml_fill_predictions (cav_id, predicted_date, predicted_fill_rate, confidence, model_version, features)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (cav_id, predicted_date)
       DO UPDATE SET predicted_fill_rate = $3, confidence = $4, model_version = $5, features = $6, created_at = NOW()`,
      [
        cavId,
        date,
        Math.round(prediction * 100) / 100,
        model.metadata.r2 || 0,
        model.metadata.trainedAt,
        JSON.stringify({
          day_of_week: features[0],
          month: features[1],
          days_since_collection: features[2],
          historical_avg: features[3],
          nb_containers: features[4],
          is_vacation: features[5],
          temperature: features[6],
        }),
      ]
    );

    res.json({
      cavId,
      date,
      predictedFillRate: Math.round(prediction * 100) / 100,
      confidence: Math.round((model.metadata.r2 || 0) * 100) / 100,
      features: {
        day_of_week: features[0],
        month: features[1],
        days_since_collection: features[2],
        historical_avg: Math.round(features[3] * 100) / 100,
        nb_containers: features[4],
        is_vacation: features[5] === 1,
        temperature: features[6],
      },
    });
  } catch (err) {
    console.error('[ML] Erreur prédiction:', err);
    res.status(500).json({ error: 'Erreur lors de la prédiction' });
  }
});

// ══════════════════════════════════════════════════════════════
// GET /api/ml/predict-batch — Prédiction pour tous les CAV actifs
// ══════════════════════════════════════════════════════════════
router.get('/predict-batch', authenticate, async (req, res) => {
  try {
    const model = await loadActiveModel();
    if (!model) {
      return res.status(404).json({ error: 'Aucun modèle entraîné. Lancez POST /api/ml/train d\'abord.' });
    }

    const date = req.query.date || new Date().toISOString().split('T')[0];

    // Récupérer tous les CAV actifs
    const cavsResult = await pool.query(
      `SELECT id, name, commune FROM cav WHERE status = 'active' ORDER BY id`
    );

    const predictions = [];
    const errors = [];

    for (const cav of cavsResult.rows) {
      try {
        const features = await buildFeatures(cav.id, date);
        if (!features) continue;

        const prediction = model.predict(features);
        predictions.push({
          cavId: cav.id,
          name: cav.name,
          commune: cav.commune,
          predictedFillRate: Math.round(prediction * 100) / 100,
        });

        // Stocker la prédiction
        await pool.query(
          `INSERT INTO ml_fill_predictions (cav_id, predicted_date, predicted_fill_rate, confidence, model_version, features)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (cav_id, predicted_date)
           DO UPDATE SET predicted_fill_rate = $3, confidence = $4, model_version = $5, features = $6, created_at = NOW()`,
          [
            cav.id,
            date,
            Math.round(prediction * 100) / 100,
            model.metadata.r2 || 0,
            model.metadata.trainedAt,
            JSON.stringify({
              day_of_week: features[0],
              month: features[1],
              days_since_collection: features[2],
              historical_avg: features[3],
              nb_containers: features[4],
              is_vacation: features[5],
              temperature: features[6],
            }),
          ]
        );
      } catch (err) {
        errors.push({ cavId: cav.id, error: err.message });
      }
    }

    // Trier par taux de remplissage décroissant (priorité collecte)
    predictions.sort((a, b) => b.predictedFillRate - a.predictedFillRate);

    res.json({
      date,
      totalCavs: cavsResult.rows.length,
      predictionsCount: predictions.length,
      errorsCount: errors.length,
      modelVersion: model.metadata.trainedAt,
      confidence: Math.round((model.metadata.r2 || 0) * 100) / 100,
      predictions,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    console.error('[ML] Erreur prédiction batch:', err);
    res.status(500).json({ error: 'Erreur lors de la prédiction batch' });
  }
});

module.exports = router;
