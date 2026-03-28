const Anthropic = require('@anthropic-ai/sdk');
const pool = require('../config/database');

// ══════════════════════════════════════════════════════════════
// SERVICE IA PREDICTIF — Analyse Claude sur données historiques
// Utilise l'API Anthropic pour analyser les patterns de collecte,
// recommander des ajustements de facteurs et détecter les anomalies
// ══════════════════════════════════════════════════════════════

let client = null;

function getClient() {
  if (!client && process.env.ANTHROPIC_API_KEY) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514';

// ──────────────────────────────────────────────────────────────
// Collecte des données pour analyse
// ──────────────────────────────────────────────────────────────

async function getHistoricalData(days = 90) {
  // Feedback prédictions vs observé
  const feedback = await pool.query(`
    SELECT clf.cav_id, c.name as cav_name, c.commune, c.nb_containers,
           clf.predicted_fill_rate, clf.observed_fill_level,
           clf.predicted_weight_kg, clf.created_at::date as date,
           EXTRACT(DOW FROM clf.created_at) as day_of_week,
           EXTRACT(MONTH FROM clf.created_at) as month
    FROM collection_learning_feedback clf
    JOIN cav c ON clf.cav_id = c.id
    WHERE clf.created_at >= NOW() - INTERVAL '1 day' * $1
      AND clf.observed_fill_level IS NOT NULL
    ORDER BY clf.created_at DESC
  `, [days]);

  // Contexte météo
  const weather = await pool.query(`
    SELECT date, weather_label, temp_max, precip_mm, weather_factor
    FROM collection_context
    WHERE date >= CURRENT_DATE - INTERVAL '1 day' * $1
    ORDER BY date DESC
  `, [days]);

  // Événements locaux
  const events = await pool.query(`
    SELECT nom, type, date_debut, date_fin, commune, bonus_factor
    FROM evenements_locaux
    WHERE date_fin >= CURRENT_DATE - INTERVAL '1 day' * $1
      AND is_active = true
    ORDER BY date_debut DESC
  `, [days]);

  // Tournées complétées
  const tours = await pool.query(`
    SELECT t.id, t.date, t.total_weight_kg, t.type,
           COUNT(tc.id) as nb_cav,
           t.start_time, t.end_time
    FROM tours t
    LEFT JOIN tour_cav tc ON tc.tour_id = t.id
    WHERE t.date >= CURRENT_DATE - INTERVAL '1 day' * $1
      AND t.status = 'completed'
    GROUP BY t.id
    ORDER BY t.date DESC
  `, [days]);

  // Précision par jour de semaine
  const accuracyByDay = await pool.query(`
    SELECT EXTRACT(DOW FROM created_at) as dow,
           COUNT(*) as samples,
           AVG(ABS(predicted_fill_rate - observed_fill_level * 20)) as mae,
           AVG(predicted_fill_rate - observed_fill_level * 20) as bias
    FROM collection_learning_feedback
    WHERE created_at >= NOW() - INTERVAL '1 day' * $1
      AND observed_fill_level IS NOT NULL
    GROUP BY EXTRACT(DOW FROM created_at)
    ORDER BY dow
  `, [days]);

  // Précision par mois
  const accuracyByMonth = await pool.query(`
    SELECT EXTRACT(MONTH FROM created_at) as month,
           COUNT(*) as samples,
           AVG(ABS(predicted_fill_rate - observed_fill_level * 20)) as mae,
           AVG(predicted_fill_rate - observed_fill_level * 20) as bias
    FROM collection_learning_feedback
    WHERE created_at >= NOW() - INTERVAL '1 day' * $1
      AND observed_fill_level IS NOT NULL
    GROUP BY EXTRACT(MONTH FROM created_at)
    ORDER BY month
  `, [days]);

  // CAVs les plus problématiques (plus gros écart)
  const worstCavs = await pool.query(`
    SELECT clf.cav_id, c.name, c.commune, c.nb_containers,
           COUNT(*) as samples,
           AVG(ABS(clf.predicted_fill_rate - clf.observed_fill_level * 20)) as mae,
           AVG(clf.predicted_fill_rate - clf.observed_fill_level * 20) as bias
    FROM collection_learning_feedback clf
    JOIN cav c ON clf.cav_id = c.id
    WHERE clf.created_at >= NOW() - INTERVAL '1 day' * $1
      AND clf.observed_fill_level IS NOT NULL
    GROUP BY clf.cav_id, c.name, c.commune, c.nb_containers
    HAVING COUNT(*) >= 5
    ORDER BY mae DESC
    LIMIT 10
  `, [days]);

  return {
    feedback: feedback.rows,
    weather: weather.rows,
    events: events.rows,
    tours: tours.rows,
    accuracyByDay: accuracyByDay.rows,
    accuracyByMonth: accuracyByMonth.rows,
    worstCavs: worstCavs.rows,
    totalFeedback: feedback.rows.length,
    totalTours: tours.rows.length,
  };
}

// ──────────────────────────────────────────────────────────────
// Analyse hebdomadaire — Synthèse IA des performances
// ──────────────────────────────────────────────────────────────

async function analyseHebdomadaire() {
  const anthropic = getClient();
  if (!anthropic) throw new Error('ANTHROPIC_API_KEY non configurée');

  const data = await getHistoricalData(30);

  // Résumé statistique compact pour le prompt
  const stats = {
    periode: '30 derniers jours',
    nb_feedbacks: data.totalFeedback,
    nb_tournees: data.totalTours,
    tonnage_total: data.tours.reduce((s, t) => s + (parseFloat(t.total_weight_kg) || 0), 0),
    precision_par_jour: data.accuracyByDay.map(d => ({
      jour: ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'][d.dow],
      mae: Math.round(parseFloat(d.mae) * 10) / 10,
      biais: Math.round(parseFloat(d.bias) * 10) / 10,
      echantillons: parseInt(d.samples),
    })),
    precision_par_mois: data.accuracyByMonth.map(m => ({
      mois: parseInt(m.month),
      mae: Math.round(parseFloat(m.mae) * 10) / 10,
      biais: Math.round(parseFloat(m.bias) * 10) / 10,
    })),
    cav_problematiques: data.worstCavs.map(c => ({
      nom: c.name,
      commune: c.commune,
      conteneurs: c.nb_containers,
      mae: Math.round(parseFloat(c.mae) * 10) / 10,
      biais: Math.round(parseFloat(c.bias) * 10) / 10,
      echantillons: parseInt(c.samples),
    })),
    meteo_recente: data.weather.slice(0, 14).map(w => ({
      date: w.date,
      label: w.weather_label,
      temp: w.temp_max,
      pluie_mm: w.precip_mm,
    })),
    evenements: data.events.slice(0, 10).map(e => ({
      nom: e.nom,
      type: e.type,
      debut: e.date_debut,
      commune: e.commune,
      bonus: e.bonus_factor,
    })),
  };

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: `Tu es l'assistant IA de Solidata, un ERP pour Solidarité Textiles (SIAE textile à Rouen, Normandie).
Tu analyses les données du moteur prédictif de remplissage des CAV (Conteneurs d'Apport Volontaire) pour la collecte de textiles usagés.

Ton rôle : produire une synthèse hebdomadaire concise et actionnable en français.
- Identifie les tendances et anomalies
- Propose des actions concrètes pour améliorer la précision
- Signale les CAV problématiques avec des recommandations spécifiques
- Un biais positif = surestimation (on prédit plus rempli que la réalité)
- Un biais négatif = sous-estimation (on prédit moins rempli que la réalité)
- MAE = erreur absolue moyenne (objectif < 15 points sur échelle 0-100)
- observed_fill_level est sur une échelle 0-5 (x20 = pourcentage)

Réponds en JSON structuré avec les clés : resume, tendances, anomalies, recommandations, cav_actions, score_global (0-100).`,
    messages: [{
      role: 'user',
      content: `Voici les données des ${stats.periode} pour l'analyse hebdomadaire :\n\n${JSON.stringify(stats, null, 2)}`,
    }],
  });

  const text = response.content[0]?.text || '{}';
  try {
    // Extraire le JSON du texte (peut être entouré de markdown)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : { resume: text, score_global: 0 };
  } catch {
    return { resume: text, score_global: 0 };
  }
}

// ──────────────────────────────────────────────────────────────
// Recommandation d'ajustement des facteurs
// ──────────────────────────────────────────────────────────────

async function recommanderAjustements() {
  const anthropic = getClient();
  if (!anthropic) throw new Error('ANTHROPIC_API_KEY non configurée');

  const data = await getHistoricalData(90);

  // Charger les facteurs actuels
  const { getSeasonalFactors, getDayOfWeekFactors } = require('./tours/predictions');
  const currentFactors = {
    saisonniers: getSeasonalFactors(),
    jours_semaine: getDayOfWeekFactors(),
  };

  const analysisData = {
    facteurs_actuels: currentFactors,
    precision_par_jour: data.accuracyByDay.map(d => ({
      jour_index: parseInt(d.dow),
      jour: ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'][d.dow],
      mae: Math.round(parseFloat(d.mae) * 10) / 10,
      biais: Math.round(parseFloat(d.bias) * 10) / 10,
      echantillons: parseInt(d.samples),
    })),
    precision_par_mois: data.accuracyByMonth.map(m => ({
      mois_index: parseInt(m.month),
      mae: Math.round(parseFloat(m.mae) * 10) / 10,
      biais: Math.round(parseFloat(m.bias) * 10) / 10,
      echantillons: parseInt(m.samples),
    })),
    nb_feedbacks_total: data.totalFeedback,
    cav_les_plus_biaises: data.worstCavs.slice(0, 5).map(c => ({
      nom: c.name,
      commune: c.commune,
      biais: Math.round(parseFloat(c.bias) * 10) / 10,
      echantillons: parseInt(c.samples),
    })),
  };

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: `Tu es l'IA de calibration du moteur prédictif Solidata.
Tu analyses les écarts entre prédictions et observations pour recommander des ajustements.

Le moteur utilise :
- facteurs_saisonniers : tableau de 12 floats (index 0=Jan, 11=Déc), multiplicateur sur le remplissage
- facteurs_jours_semaine : tableau de 7 floats (index 0=Lun, 6=Dim), multiplicateur

Règles d'ajustement :
- Biais positif (surestimation) → baisser le facteur correspondant
- Biais négatif (sous-estimation) → augmenter le facteur
- Amplitude d'ajustement proportionnelle au biais (max ±0.15 par itération)
- Ne proposer un ajustement que si l'échantillon est suffisant (≥10 feedbacks)
- Les facteurs doivent rester entre 0.3 et 2.0

Réponds en JSON avec les clés :
- facteurs_saisonniers_proposes : tableau de 12 floats
- facteurs_jours_proposes : tableau de 7 floats (Lun→Dim)
- justifications : tableau de strings expliquant chaque changement significatif
- confiance : float 0-1 (confiance dans les recommandations)
- message : résumé court en français`,
    messages: [{
      role: 'user',
      content: `Données des 90 derniers jours :\n\n${JSON.stringify(analysisData, null, 2)}`,
    }],
  });

  const text = response.content[0]?.text || '{}';
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : { message: text };
  } catch {
    return { message: text };
  }
}

// ──────────────────────────────────────────────────────────────
// Prédiction enrichie — Claude analyse le contexte spécifique
// ──────────────────────────────────────────────────────────────

async function predictionEnrichie(cavId, targetDate) {
  const anthropic = getClient();
  if (!anthropic) throw new Error('ANTHROPIC_API_KEY non configurée');

  // Historique spécifique à ce CAV
  const cavHistory = await pool.query(`
    SELECT clf.predicted_fill_rate, clf.observed_fill_level,
           clf.created_at::date as date,
           EXTRACT(DOW FROM clf.created_at) as dow
    FROM collection_learning_feedback clf
    WHERE clf.cav_id = $1
      AND clf.created_at >= NOW() - INTERVAL '90 days'
    ORDER BY clf.created_at DESC
    LIMIT 30
  `, [cavId]);

  const cavInfo = await pool.query(`
    SELECT id, name, commune, nb_containers, address, latitude, longitude,
           estimated_fill_rate, last_collected_at
    FROM cav WHERE id = $1
  `, [cavId]);

  if (!cavInfo.rows[0]) throw new Error('CAV non trouvé');

  // Météo prévue
  const weather = await pool.query(`
    SELECT weather_label, temp_max, precip_mm FROM collection_context WHERE date = $1
  `, [targetDate]);

  // Événements proches
  const events = await pool.query(`
    SELECT nom, type, date_debut, commune, bonus_factor
    FROM evenements_locaux
    WHERE $1 BETWEEN date_debut AND date_fin AND is_active = true
  `, [targetDate]);

  const context = {
    cav: cavInfo.rows[0],
    historique: cavHistory.rows.map(r => ({
      date: r.date,
      predit: Math.round(parseFloat(r.predicted_fill_rate)),
      observe: parseInt(r.observed_fill_level) * 20,
      jour: parseInt(r.dow),
    })),
    date_cible: targetDate,
    meteo: weather.rows[0] || null,
    evenements_proches: events.rows,
  };

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 800,
    system: `Tu es l'IA prédictive de Solidata pour les CAV (conteneurs textile).
Analyse l'historique de ce CAV et le contexte pour enrichir la prédiction de remplissage.

Échelle : 0 = vide, 100 = plein.
Réponds en JSON : { prediction: number, confiance: number, analyse: string, facteurs_cles: string[] }`,
    messages: [{
      role: 'user',
      content: `Prédiction enrichie pour :\n${JSON.stringify(context, null, 2)}`,
    }],
  });

  const text = response.content[0]?.text || '{}';
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    return jsonMatch ? JSON.parse(jsonMatch[0]) : { analyse: text };
  } catch {
    return { analyse: text };
  }
}

module.exports = {
  analyseHebdomadaire,
  recommanderAjustements,
  predictionEnrichie,
  getHistoricalData,
};
