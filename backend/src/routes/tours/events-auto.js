const express = require('express');
const router = express.Router();
const pool = require('../../config/database');
const { authorize } = require('../../middleware/auth');
const https = require('https');

// ══════════════════════════════════════════
// DÉCOUVERTE AUTOMATIQUE D'ÉVÉNEMENTS LOCAUX
// Sources : OpenAgenda, OpenDataSoft, Métropole Rouen,
// + analyse prédictive IA saisonnière
// ══════════════════════════════════════════

// Zone géographique de référence (Métropole de Rouen)
const ZONE_REFERENCE = {
  latitude: 49.4231,
  longitude: 1.0993,
  rayon_km: 30,
  departements: ['76', '27'],
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
  festival: { bonus_factor: 1.15, label: 'Festival' },
};

// Mots-clés pour classifier les événements par impact textile
const TEXTILE_KEYWORDS = {
  brocante: ['brocante', 'vide-grenier', 'vide grenier', 'puces', 'bric-à-brac', 'brocabrac'],
  vide_grenier: ['vide-dressing', 'vide dressing', 'troc', 'seconde main', 'occasion'],
  braderie: ['braderie', 'grande braderie', 'braderie de'],
  foire: ['foire', 'salon', 'expo', 'marché aux puces'],
  marche: ['marché', 'marche nocturne', 'marché de noël', 'marché artisanal'],
  fete_locale: ['fête', 'kermesse', 'carnaval', 'journée', 'forum'],
  festival: ['festival', 'concerts', 'spectacle'],
};

// Facteurs saisonniers
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

// Périodes spéciales nationales
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
// HELPERS : Requêtes HTTP pour sources publiques
// ══════════════════════════════════════════

function httpGet(url, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : require('http');
    const request = client.get(url, { timeout }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        return httpGet(response.headers.location, timeout).then(resolve).catch(reject);
      }
      let data = '';
      response.on('data', chunk => data += chunk);
      response.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(data); }
      });
    });
    request.on('error', reject);
    request.on('timeout', () => { request.destroy(); reject(new Error('Timeout')); });
  });
}

// Classifier un événement par son titre/description
function classifyEvent(title, description) {
  const text = `${title} ${description || ''}`.toLowerCase();
  for (const [type, keywords] of Object.entries(TEXTILE_KEYWORDS)) {
    if (keywords.some(kw => text.includes(kw))) {
      return type;
    }
  }
  // Fallback
  if (text.includes('marché') || text.includes('marche')) return 'marche';
  if (text.includes('fête') || text.includes('fete') || text.includes('kermesse')) return 'fete_locale';
  return 'fete_locale';
}

// Calculer le bonus d'impact sur la collecte textile
function calculateBonus(type, title) {
  const text = (title || '').toLowerCase();
  const base = EVENT_TYPES_IMPACT[type]?.bonus_factor || 1.1;
  // Bonus supplémentaire pour les événements clairement textile
  if (text.includes('vide-dressing') || text.includes('textile') || text.includes('friperie')) {
    return Math.min(base + 0.1, 1.5);
  }
  return base;
}

// ══════════════════════════════════════════
// SOURCE 1 : OpenAgenda (API publique, clé optionnelle)
// https://developers.openagenda.com/
// ══════════════════════════════════════════

async function fetchOpenAgenda(dateFrom, dateTo) {
  const events = [];
  const apiKey = process.env.OPENAGENDA_API_KEY;
  if (!apiKey) {
    console.log('[EVENTS-AUTO] OpenAgenda : pas de clé API (OPENAGENDA_API_KEY), source ignorée');
    return events;
  }

  try {
    // Recherche par géolocalisation autour de Rouen
    const params = new URLSearchParams({
      key: apiKey,
      'geo[latitude]': ZONE_REFERENCE.latitude.toString(),
      'geo[longitude]': ZONE_REFERENCE.longitude.toString(),
      'geo[radius]': ZONE_REFERENCE.rayon_km.toString(),
      'timings[gte]': dateFrom,
      'timings[lte]': dateTo,
      size: '100',
    });

    // Recherche brocantes/vide-greniers
    const searchTerms = ['brocante', 'vide-grenier', 'braderie', 'vide-dressing', 'marché aux puces'];
    for (const search of searchTerms) {
      try {
        const searchParams = new URLSearchParams(params);
        searchParams.set('search', search);
        const url = `https://api.openagenda.com/v2/events?${searchParams.toString()}`;
        const data = await httpGet(url);

        if (data?.events && Array.isArray(data.events)) {
          for (const evt of data.events) {
            const location = evt.location || {};
            events.push({
              nom: evt.title?.fr || evt.title?.en || evt.title || 'Événement OpenAgenda',
              description: evt.description?.fr || evt.description?.en || '',
              date_debut: evt.firstTiming?.begin?.split('T')[0] || evt.timings?.[0]?.begin?.split('T')[0],
              date_fin: evt.lastTiming?.end?.split('T')[0] || evt.timings?.[evt.timings.length - 1]?.end?.split('T')[0],
              latitude: location.latitude || location.coords?.latitude,
              longitude: location.longitude || location.coords?.longitude,
              adresse: location.address || location.name,
              commune: location.city || location.adminLevel2,
              source: 'openagenda',
              source_id: `oa-${evt.uid}`,
              source_url: evt.canonicalUrl || `https://openagenda.com/events/${evt.uid}`,
            });
          }
        }
      } catch (searchErr) {
        console.warn(`[EVENTS-AUTO] OpenAgenda recherche "${search}" :`, searchErr.message);
      }
    }

    console.log(`[EVENTS-AUTO] OpenAgenda : ${events.length} événement(s) trouvé(s)`);
  } catch (err) {
    console.error('[EVENTS-AUTO] OpenAgenda erreur globale :', err.message);
  }
  return events;
}

// ══════════════════════════════════════════
// SOURCE 2 : OpenDataSoft / data.gouv.fr
// Événements publics (pas de clé requise)
// ══════════════════════════════════════════

async function fetchOpenDataSoft(dateFrom, dateTo) {
  const events = [];
  try {
    // Dataset public : événements publics France (miroir OpenAgenda sur data.gouv.fr)
    const where = encodeURIComponent(
      `within_distance(location_coordinates, geom'POINT(${ZONE_REFERENCE.longitude} ${ZONE_REFERENCE.latitude})', ${ZONE_REFERENCE.rayon_km}km)`
    );
    const url = `https://public.opendatasoft.com/api/explore/v2.1/catalog/datasets/evenements-publics-openagenda/records?where=${where}&limit=100&order_by=date_start`;

    const data = await httpGet(url);

    if (data?.results && Array.isArray(data.results)) {
      for (const record of data.results) {
        const dateDebut = record.date_start?.split('T')[0] || record.firstdate?.split('T')[0];
        const dateFin = record.date_end?.split('T')[0] || record.lastdate?.split('T')[0];

        // Filtrer par dates
        if (dateDebut && dateDebut >= dateFrom && dateDebut <= dateTo) {
          events.push({
            nom: record.title_fr || record.title || record.slug || 'Événement OpenDataSoft',
            description: record.description_fr || record.description || '',
            date_debut: dateDebut,
            date_fin: dateFin || dateDebut,
            latitude: record.location_coordinates?.lat || record.latitude,
            longitude: record.location_coordinates?.lon || record.longitude,
            adresse: record.location_address || record.address,
            commune: record.location_city || record.city,
            source: 'opendatasoft',
            source_id: `ods-${record.uid || record.recordid || record.slug}`,
            source_url: record.canonicalurl || record.link || null,
          });
        }
      }
    }

    console.log(`[EVENTS-AUTO] OpenDataSoft : ${events.length} événement(s) trouvé(s)`);
  } catch (err) {
    console.error('[EVENTS-AUTO] OpenDataSoft erreur :', err.message);
  }
  return events;
}

// ══════════════════════════════════════════
// SOURCE 3 : Métropole Rouen Open Data
// https://data.metropole-rouen-normandie.fr
// ══════════════════════════════════════════

async function fetchMetropoleRouen(dateFrom, dateTo) {
  const events = [];
  try {
    // Tester plusieurs noms de datasets possibles
    const datasetNames = [
      'evenements-publics-openagenda',
      'agenda-des-manifestations-702588',
      'evenements',
      'agenda',
    ];

    for (const dsName of datasetNames) {
      try {
        const url = `https://data.metropole-rouen-normandie.fr/api/explore/v2.1/catalog/datasets/${dsName}/records?limit=100&order_by=date`;
        const data = await httpGet(url, 10000);

        if (data?.results && Array.isArray(data.results)) {
          for (const record of data.results) {
            const dateDebut = record.date_start?.split('T')[0] || record.date?.split('T')[0] || record.date_debut?.split('T')[0];
            const dateFin = record.date_end?.split('T')[0] || record.date_fin?.split('T')[0] || dateDebut;

            if (dateDebut && dateDebut >= dateFrom && dateDebut <= dateTo) {
              events.push({
                nom: record.titre || record.title || record.nom || record.name || 'Événement Métropole Rouen',
                description: record.description || record.detail || '',
                date_debut: dateDebut,
                date_fin: dateFin,
                latitude: record.geo_point_2d?.lat || record.latitude || ZONE_REFERENCE.latitude,
                longitude: record.geo_point_2d?.lon || record.longitude || ZONE_REFERENCE.longitude,
                adresse: record.adresse || record.lieu || record.location || '',
                commune: record.commune || record.ville || record.city || 'Rouen',
                source: 'metropole_rouen',
                source_id: `mr-${record.recordid || record.id || Math.random().toString(36).substring(7)}`,
                source_url: null,
              });
            }
          }
          if (events.length > 0) break; // Dataset trouvé, on arrête
        }
      } catch { /* dataset non trouvé, essayer le suivant */ }
    }

    console.log(`[EVENTS-AUTO] Métropole Rouen : ${events.length} événement(s) trouvé(s)`);
  } catch (err) {
    console.error('[EVENTS-AUTO] Métropole Rouen erreur :', err.message);
  }
  return events;
}

// ══════════════════════════════════════════
// SOURCE 4 : Département Seine-Maritime Open Data
// ══════════════════════════════════════════

async function fetchSeineMaritime(dateFrom, dateTo) {
  const events = [];
  try {
    const datasetNames = [
      'agenda-evenements-76',
      'evenements-seine-maritime',
      'agenda',
    ];

    for (const dsName of datasetNames) {
      try {
        const url = `https://opendata.seinemaritime.fr/api/explore/v2.1/catalog/datasets/${dsName}/records?limit=100`;
        const data = await httpGet(url, 10000);

        if (data?.results && Array.isArray(data.results)) {
          for (const record of data.results) {
            const dateDebut = record.date_start?.split('T')[0] || record.date?.split('T')[0];
            if (dateDebut && dateDebut >= dateFrom && dateDebut <= dateTo) {
              events.push({
                nom: record.titre || record.title || record.nom || 'Événement Seine-Maritime',
                description: record.description || '',
                date_debut: dateDebut,
                date_fin: record.date_end?.split('T')[0] || dateDebut,
                latitude: record.geo_point_2d?.lat || null,
                longitude: record.geo_point_2d?.lon || null,
                adresse: record.adresse || record.lieu || '',
                commune: record.commune || record.ville || '',
                source: 'seine_maritime',
                source_id: `sm-${record.recordid || Math.random().toString(36).substring(7)}`,
                source_url: null,
              });
            }
          }
          if (events.length > 0) break;
        }
      } catch { /* ignorer */ }
    }

    console.log(`[EVENTS-AUTO] Seine-Maritime : ${events.length} événement(s) trouvé(s)`);
  } catch (err) {
    console.error('[EVENTS-AUTO] Seine-Maritime erreur :', err.message);
  }
  return events;
}

// ══════════════════════════════════════════
// IMPORT : Insérer les événements dans la base
// ══════════════════════════════════════════

async function importEvents(rawEvents) {
  const results = { created: 0, skipped: 0, events: [] };

  for (const evt of rawEvents) {
    if (!evt.nom || !evt.date_debut) continue;

    // Classifier le type
    const type = classifyEvent(evt.nom, evt.description);
    const bonus = calculateBonus(type, evt.nom);

    // Vérifier doublon (même source_id, ou même nom+date)
    const existing = await pool.query(
      `SELECT id FROM evenements_locaux
       WHERE (notes LIKE $1)
       OR (nom = $2 AND date_debut = $3)
       LIMIT 1`,
      [`%${evt.source_id}%`, evt.nom, evt.date_debut]
    );

    if (existing.rows.length > 0) {
      results.skipped++;
      continue;
    }

    // Vérifier que c'est dans la zone géographique (si coordonnées disponibles)
    if (evt.latitude && evt.longitude) {
      const dist = haversineDistance(
        ZONE_REFERENCE.latitude, ZONE_REFERENCE.longitude,
        parseFloat(evt.latitude), parseFloat(evt.longitude)
      );
      if (dist > ZONE_REFERENCE.rayon_km) {
        results.skipped++;
        continue;
      }
    }

    try {
      const sourceInfo = `Source : ${evt.source}${evt.source_url ? ` — ${evt.source_url}` : ''} [${evt.source_id}]`;
      const inserted = await pool.query(
        `INSERT INTO evenements_locaux (nom, type, date_debut, date_fin, latitude, longitude, adresse, commune, rayon_km, bonus_factor, notes, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true) RETURNING id, nom`,
        [
          evt.nom,
          type,
          evt.date_debut,
          evt.date_fin || evt.date_debut,
          evt.latitude || ZONE_REFERENCE.latitude,
          evt.longitude || ZONE_REFERENCE.longitude,
          evt.adresse || null,
          evt.commune || null,
          3,
          bonus,
          sourceInfo,
        ]
      );
      results.created++;
      results.events.push({
        id: inserted.rows[0].id,
        nom: evt.nom,
        type,
        source: evt.source,
        commune: evt.commune,
        bonus_factor: bonus,
      });
    } catch (insertErr) {
      console.warn('[EVENTS-AUTO] Erreur insertion :', insertErr.message);
      results.skipped++;
    }
  }

  return results;
}

// Distance Haversine (km)
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ══════════════════════════════════════════
// API ROUTES
// ══════════════════════════════════════════

// POST /api/tours/events-auto/discover — Lancer la découverte automatique multi-sources
router.post('/events-auto/discover', authorize('ADMIN'), async (req, res) => {
  try {
    const { months_ahead, sources } = req.body;
    const lookAheadMonths = months_ahead || 3;
    const now = new Date();
    const endDate = new Date(now);
    endDate.setMonth(endDate.getMonth() + lookAheadMonths);

    const dateFrom = now.toISOString().split('T')[0];
    const dateTo = endDate.toISOString().split('T')[0];

    const allResults = {
      created: 0, skipped: 0, events: [],
      sources_consulted: [],
      sources_errors: [],
    };

    // 1. Sources publiques en ligne (en parallèle)
    const enabledSources = sources || ['openagenda', 'opendatasoft', 'metropole_rouen', 'seine_maritime', 'saisonnier'];

    console.log(`[EVENTS-AUTO] Découverte lancée : ${dateFrom} → ${dateTo}, sources: ${enabledSources.join(', ')}`);

    const fetchPromises = [];

    if (enabledSources.includes('openagenda')) {
      fetchPromises.push(
        fetchOpenAgenda(dateFrom, dateTo)
          .then(events => { allResults.sources_consulted.push({ name: 'OpenAgenda', count: events.length, status: 'ok' }); return events; })
          .catch(err => { allResults.sources_errors.push({ name: 'OpenAgenda', error: err.message }); return []; })
      );
    }

    if (enabledSources.includes('opendatasoft')) {
      fetchPromises.push(
        fetchOpenDataSoft(dateFrom, dateTo)
          .then(events => { allResults.sources_consulted.push({ name: 'OpenDataSoft / data.gouv.fr', count: events.length, status: 'ok' }); return events; })
          .catch(err => { allResults.sources_errors.push({ name: 'OpenDataSoft', error: err.message }); return []; })
      );
    }

    if (enabledSources.includes('metropole_rouen')) {
      fetchPromises.push(
        fetchMetropoleRouen(dateFrom, dateTo)
          .then(events => { allResults.sources_consulted.push({ name: 'Métropole Rouen Open Data', count: events.length, status: 'ok' }); return events; })
          .catch(err => { allResults.sources_errors.push({ name: 'Métropole Rouen', error: err.message }); return []; })
      );
    }

    if (enabledSources.includes('seine_maritime')) {
      fetchPromises.push(
        fetchSeineMaritime(dateFrom, dateTo)
          .then(events => { allResults.sources_consulted.push({ name: 'Seine-Maritime Open Data', count: events.length, status: 'ok' }); return events; })
          .catch(err => { allResults.sources_errors.push({ name: 'Seine-Maritime', error: err.message }); return []; })
      );
    }

    // Fetch toutes les sources en parallèle
    const sourceResults = await Promise.all(fetchPromises);
    const allExternalEvents = sourceResults.flat();

    // Dédupliquer par nom + date
    const seen = new Set();
    const uniqueEvents = allExternalEvents.filter(evt => {
      const key = `${evt.nom.toLowerCase().trim()}|${evt.date_debut}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Importer les événements externes
    if (uniqueEvents.length > 0) {
      const importResult = await importEvents(uniqueEvents);
      allResults.created += importResult.created;
      allResults.skipped += importResult.skipped;
      allResults.events.push(...importResult.events);
    }

    // 2. Événements saisonniers prédictifs (calendrier national)
    if (enabledSources.includes('saisonnier')) {
      const currentYear = now.getFullYear();
      const specialPeriods = [
        ...getSpecialPeriods(currentYear),
        ...getSpecialPeriods(currentYear + 1),
      ];

      let seasonalCreated = 0;
      for (const period of specialPeriods) {
        const periodStart = new Date(period.date_debut);
        const periodEnd = new Date(period.date_fin);
        if (periodEnd < now || periodStart > endDate) continue;

        const existing = await pool.query(
          `SELECT id FROM evenements_locaux WHERE nom = $1 AND date_debut = $2`,
          [period.nom, period.date_debut]
        );

        if (existing.rows.length > 0) { allResults.skipped++; continue; }

        const inserted = await pool.query(
          `INSERT INTO evenements_locaux (nom, type, date_debut, date_fin, latitude, longitude, commune, rayon_km, bonus_factor, notes, is_active)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true) RETURNING id, nom`,
          [
            period.nom, period.type, period.date_debut, period.date_fin,
            ZONE_REFERENCE.latitude, ZONE_REFERENCE.longitude, 'Métropole Rouen',
            ZONE_REFERENCE.rayon_km, period.bonus_factor,
            `Prédiction IA saisonnière — ${period.predicted ? 'Analyse tendancielle' : 'Calendrier national'}`,
          ]
        );
        seasonalCreated++;
        allResults.created++;
        allResults.events.push({ id: inserted.rows[0].id, nom: period.nom, type: period.type, source: 'prediction_ia' });
      }
      allResults.sources_consulted.push({ name: 'Analyse saisonnière IA', count: seasonalCreated, status: 'ok' });
    }

    res.json({
      message: `Découverte terminée : ${allResults.created} événement(s) créé(s), ${allResults.skipped} doublon(s) ignoré(s). ${allResults.sources_consulted.length} source(s) consultée(s).`,
      ...allResults,
    });
  } catch (err) {
    console.error('[EVENTS-AUTO] Erreur découverte :', err);
    res.status(500).json({ error: 'Erreur lors de la découverte automatique' });
  }
});

// GET /api/tours/events-auto/sources — Lister les sources disponibles
router.get('/events-auto/sources', authorize('ADMIN', 'MANAGER'), (req, res) => {
  const hasOpenAgendaKey = !!process.env.OPENAGENDA_API_KEY;
  res.json([
    {
      id: 'openagenda',
      name: 'OpenAgenda',
      description: 'Plateforme nationale d\'événements, utilisée par les mairies et collectivités',
      url: 'https://openagenda.com',
      requires_key: true,
      key_configured: hasOpenAgendaKey,
      env_var: 'OPENAGENDA_API_KEY',
      coverage: 'Brocantes, vide-greniers, marchés, festivals, événements culturels',
    },
    {
      id: 'opendatasoft',
      name: 'OpenDataSoft / data.gouv.fr',
      description: 'Données ouvertes françaises — événements publics géolocalisés',
      url: 'https://public.opendatasoft.com',
      requires_key: false,
      key_configured: true,
      coverage: 'Événements publics de toute la France',
    },
    {
      id: 'metropole_rouen',
      name: 'Métropole Rouen Normandie',
      description: 'Portail open data de la Métropole de Rouen',
      url: 'https://data.metropole-rouen-normandie.fr',
      requires_key: false,
      key_configured: true,
      coverage: 'Événements locaux de la métropole rouennaise',
    },
    {
      id: 'seine_maritime',
      name: 'Département Seine-Maritime',
      description: 'Open data du département 76',
      url: 'https://opendata.seinemaritime.fr',
      requires_key: false,
      key_configured: true,
      coverage: 'Événements départementaux',
    },
    {
      id: 'saisonnier',
      name: 'Analyse saisonnière IA',
      description: 'Prédictions basées sur les tendances saisonnières et le calendrier national (soldes, déménagements, rentrée)',
      url: null,
      requires_key: false,
      key_configured: true,
      coverage: 'Périodes récurrentes impactant la collecte textile',
    },
  ]);
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

      const events = await pool.query(
        `SELECT * FROM evenements_locaux
         WHERE is_active = true AND date_debut <= $2 AND date_fin >= $1
         ORDER BY bonus_factor DESC`,
        [weekStart.toISOString().split('T')[0], weekEnd.toISOString().split('T')[0]]
      );

      const month = weekStart.getMonth() + 1;
      const seasonal = SEASONAL_EVENT_FACTORS[month];
      let combinedFactor = 1.0;
      events.rows.forEach(ev => { combinedFactor *= ev.bonus_factor; });

      predictions.push({
        week_start: weekStart.toISOString().split('T')[0],
        week_end: weekEnd.toISOString().split('T')[0],
        week_label: `Semaine ${w + 1}`,
        events_count: events.rows.length,
        events: events.rows.map(e => ({
          id: e.id, nom: e.nom, type: e.type, commune: e.commune, bonus_factor: e.bonus_factor,
          source: (e.notes || '').includes('Source :') ? e.notes.match(/Source : (\w+)/)?.[1] : 'prediction_ia',
        })),
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
    const bySource = await pool.query(
      `SELECT
        CASE
          WHEN notes LIKE '%Source : openagenda%' THEN 'OpenAgenda'
          WHEN notes LIKE '%Source : opendatasoft%' THEN 'OpenDataSoft'
          WHEN notes LIKE '%Source : metropole_rouen%' THEN 'Métropole Rouen'
          WHEN notes LIKE '%Source : seine_maritime%' THEN 'Seine-Maritime'
          WHEN notes LIKE '%Prédiction IA%' THEN 'Prédiction IA'
          ELSE 'Manuel'
        END as source,
        COUNT(*) as count
      FROM evenements_locaux WHERE is_active = true
      GROUP BY source ORDER BY count DESC`
    );
    const avgBonus = await pool.query(
      'SELECT ROUND(AVG(bonus_factor)::numeric, 2) as avg_bonus FROM evenements_locaux WHERE is_active = true AND date_debut >= CURRENT_DATE'
    );

    res.json({
      total_events: parseInt(total.rows[0].total),
      upcoming_events: parseInt(upcoming.rows[0].total),
      by_type: byType.rows,
      by_source: bySource.rows,
      avg_bonus_factor: parseFloat(avgBonus.rows[0]?.avg_bonus || 1),
    });
  } catch (err) {
    console.error('[EVENTS-AUTO] Erreur stats :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
