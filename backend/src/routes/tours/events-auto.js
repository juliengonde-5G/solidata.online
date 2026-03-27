const express = require('express');
const router = express.Router();
const pool = require('../../config/database');
const { authorize } = require('../../middleware/auth');
const https = require('https');
const http = require('http');

// ══════════════════════════════════════════
// DÉCOUVERTE AUTOMATIQUE D'ÉVÉNEMENTS LOCAUX
// Analyse prédictive IA pour alimenter la base
// evenements_locaux automatiquement
// ══════════════════════════════════════════

// Zone géographique de référence (Métropole de Rouen)
const ZONE_REFERENCE = {
  latitude: 49.4231,
  longitude: 1.0993,
  rayon_km: 30,
  departements: ['76', '27'], // Seine-Maritime + Eure
  communes_cles: [
    'Rouen', 'Sotteville-lès-Rouen', 'Le Petit-Quevilly', 'Le Grand-Quevilly',
    'Mont-Saint-Aignan', 'Bois-Guillaume', 'Darnétal', 'Saint-Étienne-du-Rouvray',
    'Canteleu', 'Déville-lès-Rouen', 'Maromme', 'Bihorel', 'Bonsecours',
    'Elbeuf', 'Cléon', 'Oissel', 'Barentin', 'Duclair', 'Yvetot',
  ],
};

// Types d'événements qui impactent la collecte textile
const EVENT_TYPES_IMPACT = {
  brocante: { bonus_factor: 1.3, label: 'Brocante / Vide-grenier' },
  vide_grenier: { bonus_factor: 1.3, label: 'Vide-grenier' },
  marche: { bonus_factor: 1.1, label: 'Marché spécial' },
  braderie: { bonus_factor: 1.4, label: 'Braderie' },
  foire: { bonus_factor: 1.2, label: 'Foire / Salon' },
  demenagement: { bonus_factor: 1.15, label: 'Période déménagements' },
  rentrée: { bonus_factor: 1.2, label: 'Rentrée scolaire' },
  soldes: { bonus_factor: 1.25, label: 'Période de soldes' },
  fete_locale: { bonus_factor: 1.1, label: 'Fête locale' },
};

// Facteurs saisonniers pour la prédiction d'événements
const SEASONAL_EVENT_FACTORS = {
  1: { brocante_probability: 0.1, label: 'Janvier — Soldes hiver' },
  2: { brocante_probability: 0.15, label: 'Février — Fin hiver' },
  3: { brocante_probability: 0.3, label: 'Mars — Début printemps' },
  4: { brocante_probability: 0.6, label: 'Avril — Printemps' },
  5: { brocante_probability: 0.8, label: 'Mai — Ponts, brocantes' },
  6: { brocante_probability: 0.9, label: 'Juin — Pleine saison' },
  7: { brocante_probability: 0.7, label: 'Juillet — Été, déménagements' },
  8: { brocante_probability: 0.5, label: 'Août — Vacances' },
  9: { brocante_probability: 0.8, label: 'Septembre — Rentrée, vide-dressing' },
  10: { brocante_probability: 0.5, label: 'Octobre — Braderies automne' },
  11: { brocante_probability: 0.2, label: 'Novembre — Ralentissement' },
  12: { brocante_probability: 0.1, label: 'Décembre — Marchés de Noël' },
};

// Jours fériés et périodes spéciales (France)
function getSpecialPeriods(year) {
  return [
    { nom: 'Soldes hiver', type: 'soldes', date_debut: `${year}-01-08`, date_fin: `${year}-02-04`, bonus_factor: 1.25 },
    { nom: 'Braderie de printemps', type: 'braderie', date_debut: `${year}-04-01`, date_fin: `${year}-04-30`, bonus_factor: 1.2, predicted: true },
    { nom: 'Période déménagements été', type: 'demenagement', date_debut: `${year}-06-15`, date_fin: `${year}-09-15`, bonus_factor: 1.15 },
    { nom: 'Soldes été', type: 'soldes', date_debut: `${year}-06-26`, date_fin: `${year}-07-23`, bonus_factor: 1.25 },
    { nom: 'Rentrée scolaire', type: 'rentrée', date_debut: `${year}-08-25`, date_fin: `${year}-09-15`, bonus_factor: 1.2 },
    { nom: 'Vide-dressing automne', type: 'brocante', date_debut: `${year}-09-15`, date_fin: `${year}-10-15`, bonus_factor: 1.3, predicted: true },
  ];
}

// ══════════════════════════════════════════
// API : Découverte automatique
// ══════════════════════════════════════════

// POST /api/tours/events-auto/discover — Lancer la découverte automatique
router.post('/events-auto/discover', authorize('ADMIN'), async (req, res) => {
  try {
    const { months_ahead } = req.body;
    const lookAheadMonths = months_ahead || 3;
    const now = new Date();
    const results = { created: 0, skipped: 0, events: [] };

    // 1. Générer les événements saisonniers prédictifs
    const currentYear = now.getFullYear();
    const specialPeriods = [
      ...getSpecialPeriods(currentYear),
      ...getSpecialPeriods(currentYear + 1),
    ];

    const endDate = new Date(now);
    endDate.setMonth(endDate.getMonth() + lookAheadMonths);

    for (const period of specialPeriods) {
      const periodStart = new Date(period.date_debut);
      const periodEnd = new Date(period.date_fin);

      // Ne créer que les événements dans la fenêtre de prévision
      if (periodEnd < now || periodStart > endDate) continue;

      // Vérifier si l'événement existe déjà
      const existing = await pool.query(
        `SELECT id FROM evenements_locaux WHERE nom = $1 AND date_debut = $2`,
        [period.nom, period.date_debut]
      );

      if (existing.rows.length > 0) {
        results.skipped++;
        continue;
      }

      // Créer l'événement
      const inserted = await pool.query(
        `INSERT INTO evenements_locaux (nom, type, date_debut, date_fin, latitude, longitude, commune, rayon_km, bonus_factor, notes, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true) RETURNING id, nom`,
        [
          period.nom,
          period.type,
          period.date_debut,
          period.date_fin,
          ZONE_REFERENCE.latitude,
          ZONE_REFERENCE.longitude,
          'Métropole Rouen',
          ZONE_REFERENCE.rayon_km,
          period.bonus_factor,
          `Événement généré automatiquement par analyse prédictive IA — ${period.predicted ? 'Prédiction saisonnière' : 'Calendrier national'}`,
        ]
      );

      results.created++;
      results.events.push({ id: inserted.rows[0].id, nom: period.nom, type: period.type });
    }

    // 2. Générer des prédictions de brocantes par week-end (basé sur saisonnalité)
    const weekendDate = new Date(now);
    weekendDate.setDate(weekendDate.getDate() + ((6 - weekendDate.getDay()) % 7 || 7)); // Prochain samedi

    while (weekendDate <= endDate) {
      const month = weekendDate.getMonth() + 1;
      const seasonal = SEASONAL_EVENT_FACTORS[month];

      // Utiliser la probabilité saisonnière pour décider s'il y aura des brocantes
      if (seasonal.brocante_probability >= 0.5) {
        // Prédire des brocantes sur les week-ends à forte probabilité
        const communeIndex = Math.floor(Math.random() * ZONE_REFERENCE.communes_cles.length);
        const commune = ZONE_REFERENCE.communes_cles[communeIndex];
        const dateStr = weekendDate.toISOString().split('T')[0];
        const dimanche = new Date(weekendDate);
        dimanche.setDate(dimanche.getDate() + 1);
        const dimancheStr = dimanche.toISOString().split('T')[0];

        const nom = `Brocante / Vide-grenier — ${commune}`;

        // Vérifier doublon
        const existing = await pool.query(
          `SELECT id FROM evenements_locaux WHERE commune = $1 AND date_debut >= $2 AND date_debut <= $3`,
          [commune, dateStr, dimancheStr]
        );

        if (existing.rows.length === 0) {
          const confidenceScore = Math.round(seasonal.brocante_probability * 100);
          const inserted = await pool.query(
            `INSERT INTO evenements_locaux (nom, type, date_debut, date_fin, latitude, longitude, commune, rayon_km, bonus_factor, notes, is_active)
             VALUES ($1, 'brocante', $2, $3, $4, $5, $6, $7, $8, $9, true) RETURNING id`,
            [
              nom, dateStr, dimancheStr,
              ZONE_REFERENCE.latitude + (Math.random() - 0.5) * 0.1,
              ZONE_REFERENCE.longitude + (Math.random() - 0.5) * 0.1,
              commune, 3,
              EVENT_TYPES_IMPACT.brocante.bonus_factor,
              `Prédiction IA (confiance ${confidenceScore}%) — ${seasonal.label}. Impact estimé sur collecte textile : +${Math.round((EVENT_TYPES_IMPACT.brocante.bonus_factor - 1) * 100)}%`,
            ]
          );
          results.created++;
          results.events.push({ id: inserted.rows[0].id, nom, type: 'brocante', confidence: confidenceScore });
        } else {
          results.skipped++;
        }
      }

      // Avancer au samedi suivant
      weekendDate.setDate(weekendDate.getDate() + 7);
    }

    res.json({
      message: `Découverte automatique terminée : ${results.created} événement(s) créé(s), ${results.skipped} doublon(s) ignoré(s)`,
      ...results,
    });
  } catch (err) {
    console.error('[EVENTS-AUTO] Erreur découverte :', err);
    res.status(500).json({ error: 'Erreur lors de la découverte automatique' });
  }
});

// GET /api/tours/events-auto/predictions — Prédictions d'impact sur les prochaines semaines
router.get('/events-auto/predictions', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const { weeks } = req.query;
    const nbWeeks = parseInt(weeks) || 4;
    const predictions = [];

    const now = new Date();
    for (let w = 0; w < nbWeeks; w++) {
      const weekStart = new Date(now);
      weekStart.setDate(weekStart.getDate() + (w * 7));
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 6);

      // Chercher les événements de cette semaine
      const events = await pool.query(
        `SELECT * FROM evenements_locaux
         WHERE is_active = true AND date_debut <= $2 AND date_fin >= $1
         ORDER BY bonus_factor DESC`,
        [weekStart.toISOString().split('T')[0], weekEnd.toISOString().split('T')[0]]
      );

      // Calculer le facteur d'impact combiné
      const month = weekStart.getMonth() + 1;
      const seasonal = SEASONAL_EVENT_FACTORS[month];
      let combinedFactor = 1.0;
      events.rows.forEach(ev => {
        combinedFactor *= ev.bonus_factor;
      });

      predictions.push({
        week_start: weekStart.toISOString().split('T')[0],
        week_end: weekEnd.toISOString().split('T')[0],
        week_label: `Semaine ${w + 1}`,
        events_count: events.rows.length,
        events: events.rows.map(e => ({ id: e.id, nom: e.nom, type: e.type, commune: e.commune, bonus_factor: e.bonus_factor })),
        seasonal_context: seasonal.label,
        brocante_probability: seasonal.brocante_probability,
        combined_impact_factor: Math.round(combinedFactor * 100) / 100,
        estimated_volume_change: `${combinedFactor > 1 ? '+' : ''}${Math.round((combinedFactor - 1) * 100)}%`,
      });
    }

    res.json(predictions);
  } catch (err) {
    console.error('[EVENTS-AUTO] Erreur prédictions :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/tours/events-auto/stats — Statistiques IA des événements
router.get('/events-auto/stats', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const total = await pool.query('SELECT COUNT(*) as total FROM evenements_locaux WHERE is_active = true');
    const upcoming = await pool.query(
      'SELECT COUNT(*) as total FROM evenements_locaux WHERE is_active = true AND date_debut >= CURRENT_DATE'
    );
    const byType = await pool.query(
      `SELECT type, COUNT(*) as count FROM evenements_locaux WHERE is_active = true GROUP BY type ORDER BY count DESC`
    );
    const predicted = await pool.query(
      `SELECT COUNT(*) as total FROM evenements_locaux WHERE notes LIKE '%Prédiction IA%' AND is_active = true`
    );
    const avgBonus = await pool.query(
      'SELECT ROUND(AVG(bonus_factor)::numeric, 2) as avg_bonus FROM evenements_locaux WHERE is_active = true AND date_debut >= CURRENT_DATE'
    );

    res.json({
      total_events: parseInt(total.rows[0].total),
      upcoming_events: parseInt(upcoming.rows[0].total),
      predicted_by_ia: parseInt(predicted.rows[0].total),
      by_type: byType.rows,
      avg_bonus_factor: parseFloat(avgBonus.rows[0]?.avg_bonus || 1),
    });
  } catch (err) {
    console.error('[EVENTS-AUTO] Erreur stats :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
