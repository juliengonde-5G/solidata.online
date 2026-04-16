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
    return {
      code,
      label: wmoCodeToLabel(code),
      tempMin,
      tempMax,
      precipMm,
      windMax,
      sunshineHours,
    };
  } catch (e) {
    return null;
  }
}

module.exports = {
  wmoCodeToLabel,
  fetchOpenMeteoDaily,
};
