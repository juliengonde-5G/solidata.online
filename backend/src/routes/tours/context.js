const pool = require('../../config/database');

// Centre de tri (coordonnées par défaut)
const CENTRE_TRI_LAT = parseFloat(process.env.CENTRE_TRI_LAT) || 49.4231;
const CENTRE_TRI_LNG = parseFloat(process.env.CENTRE_TRI_LNG) || 1.0993;

function wmoCodeToLabel(code) {
  if (code == null) return null;
  if (code <= 1) return 'Dégagé';
  if (code <= 3) return 'Nuageux';
  if (code <= 48) return 'Brouillard';
  if (code <= 57) return 'Bruine';
  if (code <= 67) return 'Pluie';
  if (code <= 77) return 'Neige';
  if (code <= 82) return 'Averses';
  if (code <= 86) return 'Neige';
  if (code >= 95) return 'Orage';
  return 'Inconnu';
}

async function getContextForDate(dateStr) {
  const res = await pool.query(
    'SELECT * FROM collection_context WHERE date = $1',
    [dateStr]
  );
  if (res.rows.length > 0) {
    const row = res.rows[0];
    return {
      weatherFactor: parseFloat(row.weather_factor) || 1,
      trafficFactor: parseFloat(row.traffic_factor) || 1,
      durationFactor: parseFloat(row.duration_factor) || 1,
      weatherCode: row.weather_code,
      weatherLabel: row.weather_label || null,
      tempMax: row.temp_max != null ? parseFloat(row.temp_max) : null,
      precipMm: row.precip_mm != null ? parseFloat(row.precip_mm) : null,
      notes: row.notes,
    };
  }
  // Appeler Open-Meteo (gratuit, sans clé) pour la météo du jour
  try {
    const lat = CENTRE_TRI_LAT;
    const lng = CENTRE_TRI_LNG;
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&daily=weather_code,temperature_2m_max,precipitation_sum&timezone=Europe/Paris&start_date=${dateStr}&end_date=${dateStr}`;
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 3000);
    let response;
    try {
      response = await globalThis.fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(t);
    }
    const data = await response.json();
    const code = data.daily?.weather_code?.[0];
    const tempMax = data.daily?.temperature_2m_max?.[0] ?? null;
    const precipMm = data.daily?.precipitation_sum?.[0] ?? null;
    // Facteur météo : pluie/neige = légère baisse remplissage ou durée plus longue
    let weatherFactor = 1;
    if (code >= 61 && code <= 67) weatherFactor = 0.95;  // pluie
    if (code >= 80 && code <= 82) weatherFactor = 0.92;  // averse
    if (code >= 71 && code <= 77) weatherFactor = 0.9;   // neige
    // Beau temps = les gens sortent davantage, trient plus → bonus remplissage
    if (code <= 3 && tempMax != null && tempMax >= 18) weatherFactor = 1.08;
    const weatherLabel = wmoCodeToLabel(code);

    // Persister en cache
    try {
      await pool.query(
        `INSERT INTO collection_context (date, weather_factor, weather_code, weather_label, temp_max, precip_mm, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (date) DO UPDATE SET
           weather_factor = EXCLUDED.weather_factor, weather_code = EXCLUDED.weather_code,
           weather_label = EXCLUDED.weather_label, temp_max = EXCLUDED.temp_max,
           precip_mm = EXCLUDED.precip_mm, updated_at = NOW()`,
        [dateStr, weatherFactor, String(code), weatherLabel, tempMax, precipMm]
      );
    } catch (_) { /* ignore cache write errors */ }

    return { weatherFactor, trafficFactor: 1, durationFactor: 1, weatherCode: String(code), weatherLabel, tempMax, precipMm, notes: null };
  } catch (e) {
    return { weatherFactor: 1, trafficFactor: 1, durationFactor: 1, weatherCode: null, weatherLabel: null, tempMax: null, precipMm: null, notes: null };
  }
}

// Vérifier les événements locaux à proximité d'un CAV pour une date
async function getLocalEventsForDate(dateStr) {
  try {
    const res = await pool.query(
      `SELECT * FROM evenements_locaux
       WHERE date_debut <= $1 AND date_fin >= $1 AND is_active = true
       ORDER BY rayon_km DESC`,
      [dateStr]
    );
    return res.rows;
  } catch (e) {
    return [];
  }
}

function isEventNearCav(event, cav, haversineDistance) {
  if (!event.latitude || !event.longitude || !cav.latitude || !cav.longitude) return false;
  const dist = haversineDistance(event.latitude, event.longitude, cav.latitude, cav.longitude);
  return dist <= (event.rayon_km || 2);
}

module.exports = {
  CENTRE_TRI_LAT,
  CENTRE_TRI_LNG,
  wmoCodeToLabel,
  getContextForDate,
  getLocalEventsForDate,
  isEventNearCav,
};
