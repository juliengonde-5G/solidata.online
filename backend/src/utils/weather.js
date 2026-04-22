// Helper météo partagé : consommé par le moteur prédictif (tours/context.js),
// le scheduler (collectBoutiqueWeather) et les routes boutique-meteo.
// Centralise l'appel Open-Meteo (free tier, pas de clé) et le cache mémoire.

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 h
const cache = new Map();

function cacheKey(fn, lat, lng, dateStr) {
  // Mutualise les 2 boutiques Rouen (mêmes coords à 0.01° près)
  const la = Math.round(Number(lat) * 100) / 100;
  const ln = Math.round(Number(lng) * 100) / 100;
  return `${fn}:${la}:${ln}:${dateStr}`;
}

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function cacheSet(key, value) {
  cache.set(key, { ts: Date.now(), value });
}

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

// Fetch Open-Meteo daily forecast for a given (lat, lng, date)
// Returns { code, label, tempMin, tempMax, precipMm, windMax, sunshineHours } or null on failure
async function fetchOpenMeteoDaily(lat, lng, dateStr) {
  const key = cacheKey('daily', lat, lng, dateStr);
  const hit = cacheGet(key);
  if (hit) return hit;
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,sunshine_duration` +
      `&timezone=Europe/Paris&start_date=${dateStr}&end_date=${dateStr}`;
    const response = await globalThis.fetch(url);
    if (!response.ok) return null;
    const data = await response.json();
    const code = data.daily?.weather_code?.[0] ?? null;
    const tempMax = data.daily?.temperature_2m_max?.[0] ?? null;
    const tempMin = data.daily?.temperature_2m_min?.[0] ?? null;
    const precipMm = data.daily?.precipitation_sum?.[0] ?? null;
    const windMax = data.daily?.wind_speed_10m_max?.[0] ?? null;
    const sunshineSec = data.daily?.sunshine_duration?.[0] ?? null;
    const sunshineHours = sunshineSec != null ? sunshineSec / 3600 : null;
    const out = {
      code,
      label: wmoCodeToLabel(code),
      tempMin,
      tempMax,
      precipMm,
      windMax,
      sunshineHours,
    };
    cacheSet(key, out);
    return out;
  } catch (e) {
    return null;
  }
}

// Fetch Open-Meteo hourly forecast for a given (lat, lng, date)
// Retour : { date, points: [{ hour 0..23, temp, tempFeel, precipMm, code, label, wind }] }
// ou null en cas d'échec HTTP/parsing. Cache mémoire mutualisé 1 h.
async function fetchOpenMeteoHourly(lat, lng, dateStr) {
  const key = cacheKey('hourly', lat, lng, dateStr);
  const hit = cacheGet(key);
  if (hit) return hit;
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
      `&hourly=temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m` +
      `&timezone=Europe/Paris&start_date=${dateStr}&end_date=${dateStr}`;
    const response = await globalThis.fetch(url);
    if (!response.ok) return null;
    const data = await response.json();
    const times = data.hourly?.time || [];
    const temp = data.hourly?.temperature_2m || [];
    const tempFeel = data.hourly?.apparent_temperature || [];
    const precip = data.hourly?.precipitation || [];
    const codes = data.hourly?.weather_code || [];
    const wind = data.hourly?.wind_speed_10m || [];
    const points = times.map((t, i) => {
      const c = codes[i] ?? null;
      return {
        hour: Number(String(t).slice(11, 13)),
        temp: temp[i] ?? null,
        tempFeel: tempFeel[i] ?? null,
        precipMm: precip[i] ?? null,
        code: c,
        label: wmoCodeToLabel(c),
        wind: wind[i] ?? null,
      };
    });
    const out = { date: dateStr, points };
    cacheSet(key, out);
    return out;
  } catch (e) {
    return null;
  }
}

module.exports = {
  wmoCodeToLabel,
  fetchOpenMeteoDaily,
  fetchOpenMeteoHourly,
};
