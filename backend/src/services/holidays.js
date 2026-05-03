/**
 * Synchronisation des jours fériés (api.gouv.fr) et des vacances scolaires
 * zone B (opendata.education.gouv.fr) — relancé chaque 1er janvier.
 */

const https = require('https');
const pool = require('../config/database');

function httpFetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'Accept': 'application/json' }, timeout: 10000 }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('JSON parse: ' + e.message)); }
      });
    }).on('error', reject).on('timeout', function () { this.destroy(); reject(new Error('Timeout')); });
  });
}

/**
 * Synchronise les jours fériés FR métropole pour une année.
 * API : https://calendrier.api.gouv.fr/jours-feries/metropole/2026.json
 * Format : { "2026-01-01": "1er janvier", ... }
 */
async function syncJoursFeries(year) {
  if (!year) year = new Date().getFullYear();
  const url = `https://calendrier.api.gouv.fr/jours-feries/metropole/${year}.json`;
  const json = await httpFetchJson(url);
  const dates = Object.entries(json || {});
  let inserted = 0;
  for (const [date, nom] of dates) {
    try {
      const r = await pool.query(
        `INSERT INTO jours_feries (date, nom, zone, source) VALUES ($1, $2, 'metropole', 'api.gouv.fr')
         ON CONFLICT (date) DO UPDATE SET nom = EXCLUDED.nom, imported_at = NOW()
         RETURNING (xmax = 0) AS inserted`,
        [date, String(nom).slice(0, 100)]
      );
      if (r.rows[0]?.inserted) inserted++;
    } catch (e) { /* ignore — duplicate ou erreur */ }
  }
  return { year, count_total: dates.length, inserted };
}

/**
 * Synchronise les vacances scolaires zone B pour une année donnée.
 * Source : opendata.education.gouv.fr (jeu de données fr-en-calendrier-scolaire).
 */
async function syncVacancesScolaires(year) {
  if (!year) year = new Date().getFullYear();
  // L'API SQL permet un filtre direct
  // Format : https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets/fr-en-calendrier-scolaire/records?where=zones=%22Zone%20B%22 AND start_date>=%22YYYY-01-01%22&limit=100
  const url = `https://data.education.gouv.fr/api/explore/v2.1/catalog/datasets/fr-en-calendrier-scolaire/records?where=zones%3D%22Zone+B%22+AND+start_date%3E%3D%22${year}-01-01%22+AND+end_date%3C%3D%22${year + 1}-12-31%22&limit=100`;
  const json = await httpFetchJson(url);
  const records = (json?.results || []);
  let inserted = 0;
  for (const r of records) {
    const description = r.description || r.label || 'Vacances scolaires';
    const debut = r.start_date ? String(r.start_date).slice(0, 10) : null;
    const fin = r.end_date ? String(r.end_date).slice(0, 10) : null;
    const annee = r.annee_scolaire || null;
    if (!debut || !fin) continue;
    try {
      const ins = await pool.query(
        `INSERT INTO vacances_scolaires (zone, description, date_debut, date_fin, annee_scolaire, source)
         VALUES ('B', $1, $2, $3, $4, 'opendata.education.gouv.fr')
         ON CONFLICT (zone, date_debut, description) DO UPDATE SET
           date_fin = EXCLUDED.date_fin, imported_at = NOW()
         RETURNING (xmax = 0) AS inserted`,
        [String(description).slice(0, 100), debut, fin, annee]
      );
      if (ins.rows[0]?.inserted) inserted++;
    } catch (e) { /* ignore */ }
  }
  return { year, count_total: records.length, inserted };
}

/**
 * Synchronisation année courante + suivante (pour anticiper la fin d'année).
 */
async function syncAllHolidays() {
  const year = new Date().getFullYear();
  const results = {
    feries: { current: null, next: null },
    vacances: { current: null, next: null },
  };
  try { results.feries.current = await syncJoursFeries(year); } catch (e) { results.feries.current = { error: e.message }; }
  try { results.feries.next = await syncJoursFeries(year + 1); } catch (e) { results.feries.next = { error: e.message }; }
  try { results.vacances.current = await syncVacancesScolaires(year); } catch (e) { results.vacances.current = { error: e.message }; }
  try { results.vacances.next = await syncVacancesScolaires(year + 1); } catch (e) { results.vacances.next = { error: e.message }; }
  return results;
}

module.exports = {
  syncJoursFeries,
  syncVacancesScolaires,
  syncAllHolidays,
};
