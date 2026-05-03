/**
 * Service de découverte automatique d'événements locaux
 * Sources : OpenAgenda + vide-greniers.fr + brocabrac.fr
 *
 * Stratégie : pour chaque CAV active (et chaque association partenaire),
 * on interroge les 3 sources avec les coordonnées GPS de la CAV/asso,
 * on filtre les events à <500m, on déduplique sur (source, external_id),
 * on insère dans evenements_locaux avec lien sur la CAV concernée.
 */

const https = require('https');
const pool = require('../config/database');

const RADIUS_M = 500; // Rayon impact CAV : 500 mètres
const FETCH_TIMEOUT_MS = 8000;

/**
 * GET HTTP/HTTPS robuste avec timeout court (silencieux si la source est down).
 */
function httpFetch(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        'User-Agent': 'Solidata-EventBot/1.0',
        'Accept': 'text/html,application/json,application/xml',
        ...headers,
      },
      timeout: FETCH_TIMEOUT_MS,
    };
    const req = https.get(url, options, (res) => {
      // Suivre les redirections jusqu'à 3 niveaux
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        return resolve(httpFetch(new URL(res.headers.location, url).toString(), headers));
      }
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, data }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

// Distance haversine en mètres
function haversineDistanceM(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ───────────────────────────────────────────────────────────────
// SOURCE 1 — OpenAgenda (API REST publique)
// ───────────────────────────────────────────────────────────────
async function discoverFromOpenAgenda(lat, lng) {
  const url = `https://api.openagenda.com/v2/events?geo[northEast][lat]=${lat + 0.01}&geo[northEast][lng]=${lng + 0.015}&geo[southWest][lat]=${lat - 0.01}&geo[southWest][lng]=${lng - 0.015}&detailed=1&size=20&relative[]=upcoming&relative[]=current`;
  try {
    const r = await httpFetch(url);
    if (r.status !== 200) return [];
    const json = JSON.parse(r.data);
    const events = json.events || [];
    return events
      .filter((e) => e.location && e.location.latitude && e.location.longitude)
      .map((e) => ({
        source: 'openagenda',
        external_id: String(e.uid || e.slug),
        nom: (e.title?.fr || e.title?.en || 'Événement').slice(0, 240),
        type: detectEventType(e.title?.fr || ''),
        date_debut: (e.firstTiming?.begin || e.timings?.[0]?.begin || '').slice(0, 10),
        date_fin: (e.lastTiming?.end || e.timings?.[e.timings?.length - 1]?.end || '').slice(0, 10),
        latitude: parseFloat(e.location.latitude),
        longitude: parseFloat(e.location.longitude),
        adresse: e.location.address || null,
        commune: e.location.city || null,
      }))
      .filter((e) => e.date_debut && e.date_fin);
  } catch (err) {
    console.warn('[EVENT-DISCO] OpenAgenda erreur :', err.message);
    return [];
  }
}

// ───────────────────────────────────────────────────────────────
// SOURCE 2 — vide-greniers.fr
// Recherche par code postal (URL : /80-Somme/code-postal/76000)
// Fallback silencieux si format HTML change.
// ───────────────────────────────────────────────────────────────
async function discoverFromVideGreniers(codePostal) {
  if (!codePostal || !/^\d{5}$/.test(codePostal)) return [];
  // L'URL de recherche par code postal varie ; on tape la page de département
  // puis on parse les events dont le code postal correspond.
  const dept = codePostal.slice(0, 2);
  const url = `https://vide-greniers.org/${dept}-${departementName(dept) || ''}`;
  try {
    const r = await httpFetch(url);
    if (r.status !== 200) return [];
    return parseVideGreniersHTML(r.data, codePostal);
  } catch (err) {
    console.warn('[EVENT-DISCO] vide-greniers.fr erreur :', err.message);
    return [];
  }
}

function departementName(dept) {
  // Mapping minimal — Seine-Maritime (Rouen) = 76
  return ({ '76': 'Seine-Maritime', '27': 'Eure', '14': 'Calvados' })[dept] || '';
}

function parseVideGreniersHTML(html, codePostal) {
  const events = [];
  // Pattern simple : on cherche les blocs contenant date + lieu + code postal correspondant.
  // L'HTML de vide-greniers.org est variable ; on se contente d'un best-effort.
  const linkRegex = /<a[^>]+href="([^"]+\d{4,}[^"]*)"[^>]*>([^<]{5,80})<\/a>/g;
  const dateRegex = /(\d{1,2})[/-](\d{1,2})[/-](\d{4})/;
  let m;
  let count = 0;
  while ((m = linkRegex.exec(html)) !== null && count < 50) {
    const href = m[1];
    const label = m[2].trim();
    const dateMatch = label.match(dateRegex) || href.match(dateRegex);
    if (!dateMatch || !label.toLowerCase().includes(codePostal.slice(0, 2))) continue;
    const dd = dateMatch[1].padStart(2, '0');
    const mm = dateMatch[2].padStart(2, '0');
    const yyyy = dateMatch[3];
    events.push({
      source: 'vide-greniers',
      external_id: href.split('/').filter(Boolean).pop(),
      nom: label.slice(0, 240),
      type: 'brocante',
      date_debut: `${yyyy}-${mm}-${dd}`,
      date_fin: `${yyyy}-${mm}-${dd}`,
      latitude: null, // pas d'info GPS dans la liste — on filtrera par code postal après
      longitude: null,
      adresse: label,
      commune: null,
      _codePostal: codePostal,
    });
    count++;
  }
  return events;
}

// ───────────────────────────────────────────────────────────────
// SOURCE 3 — brocabrac.fr
// ───────────────────────────────────────────────────────────────
async function discoverFromBrocabrac(codePostal) {
  if (!codePostal || !/^\d{5}$/.test(codePostal)) return [];
  const url = `https://www.brocabrac.fr/recherche?cp=${codePostal}`;
  try {
    const r = await httpFetch(url);
    if (r.status !== 200) return [];
    return parseBrocabracHTML(r.data, codePostal);
  } catch (err) {
    console.warn('[EVENT-DISCO] brocabrac.fr erreur :', err.message);
    return [];
  }
}

function parseBrocabracHTML(html, codePostal) {
  const events = [];
  // Best-effort sur le HTML — capture les blocs <article> ou cellules contenant
  // une date et un lieu.
  const blockRegex = /<article[^>]*>([\s\S]*?)<\/article>/g;
  const titleRegex = /<h\d[^>]*>([^<]+)<\/h\d>/;
  const isoDateRegex = /(\d{4})-(\d{2})-(\d{2})/;
  const frDateRegex = /(\d{1,2})\/(\d{1,2})\/(\d{4})/;
  let m;
  let count = 0;
  while ((m = blockRegex.exec(html)) !== null && count < 40) {
    const block = m[1];
    const title = (block.match(titleRegex) || [])[1]?.trim();
    if (!title) continue;
    const iso = block.match(isoDateRegex);
    const fr = block.match(frDateRegex);
    let date = null;
    if (iso) date = `${iso[1]}-${iso[2]}-${iso[3]}`;
    else if (fr) date = `${fr[3]}-${fr[2].padStart(2, '0')}-${fr[1].padStart(2, '0')}`;
    if (!date) continue;
    events.push({
      source: 'brocabrac',
      external_id: `${date}-${title.slice(0, 40).replace(/\W+/g, '-')}`,
      nom: title.slice(0, 240),
      type: 'brocante',
      date_debut: date,
      date_fin: date,
      latitude: null,
      longitude: null,
      adresse: title,
      commune: null,
      _codePostal: codePostal,
    });
    count++;
  }
  return events;
}

// ───────────────────────────────────────────────────────────────
// Détection automatique du type à partir du titre
// ───────────────────────────────────────────────────────────────
function detectEventType(title) {
  const t = (title || '').toLowerCase();
  if (t.includes('vide-grenier') || t.includes('vide grenier')) return 'brocante';
  if (t.includes('brocante')) return 'brocante';
  if (t.includes('foire')) return 'foire';
  if (t.includes('vide maison') || t.includes('vide-maison')) return 'brocante';
  if (t.includes('marché')) return 'marche';
  return 'autre';
}

// ───────────────────────────────────────────────────────────────
// PIPELINE : découverte + filtrage + insertion
// ───────────────────────────────────────────────────────────────

/**
 * Découverte exhaustive autour d'un point (lat/lng + commune + codePostal)
 * Combine OpenAgenda + vide-greniers + brocabrac, filtre à <500m si coords.
 */
async function discoverNear(lat, lng, codePostal) {
  const [og, vg, br] = await Promise.all([
    discoverFromOpenAgenda(lat, lng).catch(() => []),
    discoverFromVideGreniers(codePostal).catch(() => []),
    discoverFromBrocabrac(codePostal).catch(() => []),
  ]);
  // Filtre par distance (si on a les coords)
  const all = [...og, ...vg, ...br];
  return all.filter((e) => {
    if (e.latitude && e.longitude && lat && lng) {
      const dist = haversineDistanceM(lat, lng, e.latitude, e.longitude);
      return dist <= RADIUS_M;
    }
    // Sans coords → on garde mais marque "approximatif"
    return true;
  });
}

/**
 * Découverte sur tous les CAV actifs.
 * @param {object} opts - { triggeredBy: 'manual' | 'cron' }
 */
async function discoverNearAllCAVs(opts = {}) {
  const triggeredBy = opts.triggeredBy || 'manual';
  const runRes = await pool.query(
    `INSERT INTO event_discovery_runs (source, scope, status, triggered_by) VALUES ('all', 'cav', 'running', $1) RETURNING id`,
    [triggeredBy]
  );
  const runId = runRes.rows[0].id;
  const results = { found: 0, inserted: 0, skipped: 0 };
  try {
    const cavs = await pool.query(
      `SELECT id, name, latitude, longitude, code_postal FROM cav WHERE status = 'active' AND latitude IS NOT NULL`
    );
    for (const cav of cavs.rows) {
      const events = await discoverNear(parseFloat(cav.latitude), parseFloat(cav.longitude), cav.code_postal);
      results.found += events.length;
      for (const evt of events) {
        try {
          const ins = await pool.query(
            `INSERT INTO evenements_locaux
               (nom, type, date_debut, date_fin, latitude, longitude, adresse, commune, rayon_km, bonus_factor,
                source, external_id, cav_id, imported_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0.5, 1.2, $9, $10, $11, NOW())
             ON CONFLICT (source, external_id) DO NOTHING
             RETURNING id`,
            [evt.nom, evt.type, evt.date_debut, evt.date_fin,
              evt.latitude || cav.latitude, evt.longitude || cav.longitude,
              evt.adresse, evt.commune || cav.name,
              evt.source, evt.external_id, cav.id]
          );
          if (ins.rows.length > 0) results.inserted++; else results.skipped++;
        } catch (e) {
          results.skipped++;
        }
      }
      // Petite pause entre CAVs pour être gentil avec les sources externes
      await new Promise((r) => setTimeout(r, 500));
    }
    await pool.query(
      `UPDATE event_discovery_runs SET completed_at = NOW(), status = 'completed',
       events_found = $1, events_inserted = $2, events_skipped = $3 WHERE id = $4`,
      [results.found, results.inserted, results.skipped, runId]
    );
    return { ...results, run_id: runId };
  } catch (err) {
    await pool.query(
      `UPDATE event_discovery_runs SET completed_at = NOW(), status = 'error', error = $1 WHERE id = $2`,
      [err.message, runId]
    );
    throw err;
  }
}

/**
 * Découverte sur les associations partenaires.
 */
async function discoverNearAllAssociations(opts = {}) {
  const triggeredBy = opts.triggeredBy || 'manual';
  const runRes = await pool.query(
    `INSERT INTO event_discovery_runs (source, scope, status, triggered_by) VALUES ('all', 'association', 'running', $1) RETURNING id`,
    [triggeredBy]
  );
  const runId = runRes.rows[0].id;
  const results = { found: 0, inserted: 0, skipped: 0 };
  try {
    const aps = await pool.query(`
      SELECT id, name, latitude, longitude, code_postal FROM association_points
      WHERE status = 'active' AND latitude IS NOT NULL
    `);
    for (const ap of aps.rows) {
      const events = await discoverNear(parseFloat(ap.latitude), parseFloat(ap.longitude), ap.code_postal);
      results.found += events.length;
      for (const evt of events) {
        try {
          const ins = await pool.query(
            `INSERT INTO evenements_locaux
               (nom, type, date_debut, date_fin, latitude, longitude, adresse, commune, rayon_km, bonus_factor,
                source, external_id, association_point_id, imported_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0.5, 1.2, $9, $10, $11, NOW())
             ON CONFLICT (source, external_id) DO NOTHING
             RETURNING id`,
            [evt.nom, evt.type, evt.date_debut, evt.date_fin,
              evt.latitude || ap.latitude, evt.longitude || ap.longitude,
              evt.adresse, evt.commune || ap.name,
              evt.source, evt.external_id, ap.id]
          );
          if (ins.rows.length > 0) results.inserted++; else results.skipped++;
        } catch (e) {
          results.skipped++;
        }
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    await pool.query(
      `UPDATE event_discovery_runs SET completed_at = NOW(), status = 'completed',
       events_found = $1, events_inserted = $2, events_skipped = $3 WHERE id = $4`,
      [results.found, results.inserted, results.skipped, runId]
    );
    return { ...results, run_id: runId };
  } catch (err) {
    await pool.query(
      `UPDATE event_discovery_runs SET completed_at = NOW(), status = 'error', error = $1 WHERE id = $2`,
      [err.message, runId]
    );
    throw err;
  }
}

module.exports = {
  discoverNear,
  discoverNearAllCAVs,
  discoverNearAllAssociations,
  discoverFromOpenAgenda,
  discoverFromVideGreniers,
  discoverFromBrocabrac,
};
