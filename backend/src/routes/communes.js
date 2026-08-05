const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

// ═══════════════════════════════════════════════════════════════════════════
// RÉFÉRENTIEL COMMUNES (INSEE) — Lot 10 (2026-08) : élargissement aux EPCI
// limitrophes (Eure 27 / Seine-Maritime 76).
// ───────────────────────────────────────────────────────────────────────────
// La liste des EPCI suivis est CONFIGURABLE (setting `communes.epci_codes`,
// JSON array d'objets { code, nom }) — défaut : Métropole Rouen Normandie.
// AUCUN code d'EPCI limitrophe n'est codé en dur : l'admin les recherche via
// GET /epci-search (proxy serveur vers geo.api.gouv.fr, accessible depuis le
// serveur de production) puis les ajoute via POST /epcis.
// Le refresh (POST /refresh-metropole, alias /refresh-epcis) boucle sur TOUS
// les EPCI configurés ; un EPCI en échec ne casse pas les autres.
// NB reporting : is_metropole_rouen n'est posé à true QUE pour l'EPCI
// 200023414 — les KPI Métropole (metropole.js, GET /?metropole=true) restent
// scopés sur la Métropole malgré l'élargissement du référentiel.
// ═══════════════════════════════════════════════════════════════════════════

const METROPOLE_ROUEN_EPCI = '200023414';
const DEFAULT_EPCIS = [{ code: METROPOLE_ROUEN_EPCI, nom: 'Métropole Rouen Normandie' }];
const EPCI_SETTING_KEY = 'communes.epci_codes';
const GEO_API_BASE = process.env.GEO_API_BASE || 'https://geo.api.gouv.fr';
const GEO_API_TIMEOUT_MS = parseInt(process.env.GEO_API_TIMEOUT_MS, 10) || 8000;

// ───────────────────────────────────────────────────────────────────────────
// Helpers purs (exportés sur le router pour les tests unitaires — même
// pattern que metropole.js › distributeTonnageProrata)
// ───────────────────────────────────────────────────────────────────────────

/** Un code EPCI est un SIREN : exactement 9 chiffres. */
function isValidEpciCode(code) {
  return typeof code === 'string' && /^\d{9}$/.test(code.trim());
}

/**
 * Parse la valeur brute du setting `communes.epci_codes` (JSON array de
 * { code, nom }). Résilient : JSON invalide, entrées malformées ou doublons
 * sont écartés ; si rien d'exploitable ne reste → défaut Métropole Rouen.
 * @param {string|null|undefined} raw valeur de settings.value
 * @returns {Array<{code:string, nom:string}>} liste jamais vide
 */
function parseEpciSetting(raw) {
  let list = null;
  if (raw != null && raw !== '') {
    try { list = JSON.parse(raw); } catch (_) { list = null; }
  }
  if (!Array.isArray(list)) return DEFAULT_EPCIS.map((e) => ({ ...e }));
  const seen = new Set();
  const out = [];
  for (const e of list) {
    if (!e || typeof e !== 'object') continue;
    const code = typeof e.code === 'string' ? e.code.trim() : '';
    const nom = typeof e.nom === 'string' ? e.nom.trim() : '';
    if (!isValidEpciCode(code) || !nom || seen.has(code)) continue;
    seen.add(code);
    out.push({ code, nom });
  }
  return out.length > 0 ? out : DEFAULT_EPCIS.map((e) => ({ ...e }));
}

/**
 * Mappe une commune renvoyée par geo.api.gouv.fr
 * (/epcis/:code/communes?fields=nom,code,codesPostaux,population) vers les
 * champs du référentiel. Renvoie null si l'entrée est inexploitable.
 */
function mapApiCommune(c) {
  if (!c || typeof c !== 'object' || !c.code || !c.nom) return null;
  return {
    code_insee: String(c.code),
    nom: String(c.nom),
    code_postal: Array.isArray(c.codesPostaux) && c.codesPostaux.length > 0 ? String(c.codesPostaux[0]) : null,
    population: Number.isFinite(c.population) ? c.population : null,
  };
}

/**
 * Filtre côté serveur une liste d'EPCI geo.api.gouv.fr
 * ({ nom, code, codesDepartements }) sur un département (ex. '27', '76') —
 * ceinture et bretelles en plus du paramètre codeDepartement passé à l'API.
 */
function filterEpcisByDep(list, dep) {
  if (!dep) return Array.isArray(list) ? list : [];
  return (Array.isArray(list) ? list : []).filter(
    (e) => Array.isArray(e?.codesDepartements) && e.codesDepartements.includes(dep)
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Accès settings
// ───────────────────────────────────────────────────────────────────────────

/** Liste des EPCI suivis (défaut Métropole Rouen). Résilient : erreur → défaut. */
async function getConfiguredEpcis() {
  try {
    const r = await pool.query('SELECT value FROM settings WHERE key = $1', [EPCI_SETTING_KEY]);
    return parseEpciSetting(r.rows[0]?.value);
  } catch (_) {
    return DEFAULT_EPCIS.map((e) => ({ ...e }));
  }
}

async function saveConfiguredEpcis(list) {
  await pool.query(
    `INSERT INTO settings (key, value, category, updated_at)
     VALUES ($1, $2, 'communes', NOW())
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
    [EPCI_SETTING_KEY, JSON.stringify(list)]
  );
}

/** fetch avec timeout court — l'API geo.api.gouv.fr n'est joignable qu'en prod. */
async function fetchGeoApi(url) {
  return fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(GEO_API_TIMEOUT_MS),
  });
}

function geoApiErrorPayload(err) {
  if (err && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
    return { status: 504, body: { error: `geo.api.gouv.fr injoignable (délai ${GEO_API_TIMEOUT_MS} ms dépassé) — cet appel nécessite l'accès Internet du serveur.` } };
  }
  return { status: 502, body: { error: `geo.api.gouv.fr injoignable : ${err?.message || 'erreur réseau'}` } };
}

router.use(authenticate);

// ───────────────────────────────────────────────────────────────────────────
// GET / — liste du référentiel (+ filtres metropole / epci / q)
// ───────────────────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { metropole, q, epci } = req.query;
    let sql = `SELECT code_insee, nom, code_postal, epci_code, epci_nom, population_insee, is_metropole_rouen
               FROM referentiel_communes WHERE 1=1`;
    const params = [];
    if (metropole === 'true') sql += ` AND is_metropole_rouen = true`;
    if (epci === 'none') {
      sql += ` AND epci_code IS NULL`;
    } else if (epci) {
      params.push(epci);
      sql += ` AND epci_code = $${params.length}`;
    }
    if (q) { params.push(`%${q.toLowerCase()}%`); sql += ` AND LOWER(nom) LIKE $${params.length}`; }
    sql += ` ORDER BY nom`;
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ───────────────────────────────────────────────────────────────────────────
// EPCI suivis — liste configurée (setting communes.epci_codes)
// ───────────────────────────────────────────────────────────────────────────

// GET /epcis — liste des EPCI suivis (ADMIN/MANAGER, comme le refresh)
router.get('/epcis', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const epcis = await getConfiguredEpcis();
    res.json({ epcis, metropole_code: METROPOLE_ROUEN_EPCI });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /epcis { code, nom } — ajoute un EPCI à suivre (ADMIN)
router.post('/epcis', authorize('ADMIN'), async (req, res) => {
  try {
    const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
    const nom = typeof req.body?.nom === 'string' ? req.body.nom.trim() : '';
    if (!isValidEpciCode(code)) {
      return res.status(400).json({ error: 'Code EPCI invalide (SIREN attendu : 9 chiffres).' });
    }
    if (!nom) return res.status(400).json({ error: 'Nom de l\'EPCI requis.' });
    const epcis = await getConfiguredEpcis();
    if (epcis.some((e) => e.code === code)) {
      return res.status(409).json({ error: `L'EPCI ${code} est déjà suivi.` });
    }
    epcis.push({ code, nom });
    await saveConfiguredEpcis(epcis);
    res.status(201).json({ epcis, metropole_code: METROPOLE_ROUEN_EPCI });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /epcis/:code — retire un EPCI suivi (ADMIN). La Métropole Rouen
// (200023414) n'est pas retirable : c'est l'EPCI de référence du reporting
// conventionnel (metropole.js) et du flag is_metropole_rouen.
router.delete('/epcis/:code', authorize('ADMIN'), async (req, res) => {
  try {
    const code = String(req.params.code || '').trim();
    if (code === METROPOLE_ROUEN_EPCI) {
      return res.status(409).json({ error: 'La Métropole Rouen Normandie est l\'EPCI de référence du reporting conventionnel : elle ne peut pas être retirée.' });
    }
    const epcis = await getConfiguredEpcis();
    if (!epcis.some((e) => e.code === code)) {
      return res.status(404).json({ error: `L'EPCI ${code} n'est pas dans la liste suivie.` });
    }
    const next = epcis.filter((e) => e.code !== code);
    await saveConfiguredEpcis(next);
    // Les communes déjà importées de cet EPCI restent dans le référentiel
    // (des CAV peuvent y être rattachés) — le retrait arrête seulement leur
    // actualisation au prochain refresh.
    res.json({ epcis: next, metropole_code: METROPOLE_ROUEN_EPCI });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ───────────────────────────────────────────────────────────────────────────
// GET /epci-search?q=&dep= — recherche d'EPCI par nom via geo.api.gouv.fr
// (proxy serveur : le navigateur ne parle jamais à l'API directement).
// dep optionnel (ex. 27, 76) : passé à l'API (codeDepartement) ET refiltré
// côté serveur sur codesDepartements.
// ───────────────────────────────────────────────────────────────────────────
router.get('/epci-search', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const dep = typeof req.query.dep === 'string' ? req.query.dep.trim() : '';
    if (q.length < 2) return res.status(400).json({ error: 'Recherche trop courte (2 caractères minimum).' });
    if (dep && !/^(\d{2,3}|2A|2B)$/.test(dep)) {
      return res.status(400).json({ error: 'Département invalide (attendu : 27, 76…).' });
    }
    let url = `${GEO_API_BASE}/epcis?nom=${encodeURIComponent(q)}&fields=nom,code,codesDepartements&limit=25`;
    if (dep) url += `&codeDepartement=${encodeURIComponent(dep)}`;

    let r;
    try {
      r = await fetchGeoApi(url);
    } catch (err) {
      const { status, body } = geoApiErrorPayload(err);
      return res.status(status).json(body);
    }
    if (!r.ok) return res.status(502).json({ error: `geo.api.gouv.fr a répondu ${r.status}` });
    const data = await r.json();
    if (!Array.isArray(data)) return res.status(502).json({ error: 'Réponse inattendue de geo.api.gouv.fr' });

    const suivis = new Set((await getConfiguredEpcis()).map((e) => e.code));
    const results = filterEpcisByDep(data, dep)
      .filter((e) => e && e.code && e.nom)
      .map((e) => ({
        code: String(e.code),
        nom: String(e.nom),
        departements: Array.isArray(e.codesDepartements) ? e.codesDepartements : [],
        deja_suivi: suivis.has(String(e.code)),
      }));
    res.json({ results, source: 'geo.api.gouv.fr' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ───────────────────────────────────────────────────────────────────────────
// POST /refresh-metropole (nom historique, conservé pour compat) + alias
// /refresh-epcis — actualise les communes de TOUS les EPCI suivis depuis
// geo.api.gouv.fr. Récap par EPCI ; un EPCI en échec ne casse pas les autres.
// Transaction PAR EPCI (un échec ne rollback que son EPCI).
// Backfill Lot 10 : les communes historiques (importées sans epci_code) sont
// ré-upsertées avec epci_code=200023414 au passage de la Métropole.
// ───────────────────────────────────────────────────────────────────────────
async function refreshEpcisHandler(req, res) {
  try {
    const epcis = await getConfiguredEpcis();
    const recap = [];
    let inserted = 0, updated = 0;

    for (const epci of epcis) {
      const isMetropole = epci.code === METROPOLE_ROUEN_EPCI;
      try {
        const url = `${GEO_API_BASE}/epcis/${epci.code}/communes?fields=nom,code,codesPostaux,population&format=json`;
        const r = await fetchGeoApi(url);
        if (!r.ok) throw new Error(`geo.api.gouv.fr a répondu ${r.status}`);
        const data = await r.json();
        if (!Array.isArray(data)) throw new Error('Réponse inattendue de geo.api.gouv.fr');

        const client = await pool.connect();
        let epciInserted = 0, epciUpdated = 0;
        try {
          await client.query('BEGIN');
          for (const raw of data) {
            const c = mapApiCommune(raw);
            if (!c) continue;
            const exists = await client.query(`SELECT 1 FROM referentiel_communes WHERE code_insee = $1`, [c.code_insee]);
            await client.query(
              `INSERT INTO referentiel_communes
                 (code_insee, nom, code_postal, epci_code, epci_nom, population_insee, is_metropole_rouen)
               VALUES ($1,$2,$3,$4,$5,$6,$7)
               ON CONFLICT (code_insee) DO UPDATE SET
                 nom = EXCLUDED.nom,
                 code_postal = COALESCE(EXCLUDED.code_postal, referentiel_communes.code_postal),
                 epci_code = EXCLUDED.epci_code,
                 epci_nom = EXCLUDED.epci_nom,
                 population_insee = EXCLUDED.population_insee,
                 is_metropole_rouen = EXCLUDED.is_metropole_rouen`,
              [c.code_insee, c.nom, c.code_postal, epci.code, epci.nom, c.population, isMetropole]
            );
            if (exists.rowCount > 0) epciUpdated++; else epciInserted++;
          }
          await client.query('COMMIT');
        } catch (e) {
          await client.query('ROLLBACK');
          throw e;
        } finally { client.release(); }

        inserted += epciInserted;
        updated += epciUpdated;
        recap.push({ code: epci.code, nom: epci.nom, communes_upsertees: epciInserted + epciUpdated, inserted: epciInserted, updated: epciUpdated });
      } catch (e) {
        const msg = (e && (e.name === 'TimeoutError' || e.name === 'AbortError'))
          ? `geo.api.gouv.fr injoignable (délai ${GEO_API_TIMEOUT_MS} ms dépassé)`
          : (e?.message || 'erreur inconnue');
        recap.push({ code: epci.code, nom: epci.nom, communes_upsertees: 0, erreur: msg });
      }
    }

    res.json({
      epcis: recap,
      ok: recap.filter((r2) => !r2.erreur).length,
      echecs: recap.filter((r2) => r2.erreur).length,
      inserted,
      updated,
      total: inserted + updated,
      source: 'geo.api.gouv.fr',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

router.post('/refresh-metropole', authorize('ADMIN', 'MANAGER'), refreshEpcisHandler);
router.post('/refresh-epcis', authorize('ADMIN', 'MANAGER'), refreshEpcisHandler);

// ───────────────────────────────────────────────────────────────────────────
// Saisie / import manuels (inchangés)
// ───────────────────────────────────────────────────────────────────────────

router.post('/', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  const { code_insee, nom, code_postal, epci_code, epci_nom, population_insee, is_metropole_rouen } = req.body || {};
  if (!code_insee || !nom) return res.status(400).json({ error: 'code_insee et nom requis' });
  try {
    const r = await pool.query(
      `INSERT INTO referentiel_communes
         (code_insee, nom, code_postal, epci_code, epci_nom, population_insee, is_metropole_rouen)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (code_insee) DO UPDATE SET
         nom = EXCLUDED.nom,
         code_postal = COALESCE(EXCLUDED.code_postal, referentiel_communes.code_postal),
         epci_code = COALESCE(EXCLUDED.epci_code, referentiel_communes.epci_code),
         epci_nom = COALESCE(EXCLUDED.epci_nom, referentiel_communes.epci_nom),
         population_insee = COALESCE(EXCLUDED.population_insee, referentiel_communes.population_insee),
         is_metropole_rouen = EXCLUDED.is_metropole_rouen
       RETURNING *`,
      [code_insee, nom, code_postal || null, epci_code || null, epci_nom || null,
       population_insee || null, is_metropole_rouen ?? false]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/import', authorize('ADMIN'), async (req, res) => {
  const { rows: incoming } = req.body || {};
  if (!Array.isArray(incoming)) return res.status(400).json({ error: 'rows[] (array) requis' });
  const client = await pool.connect();
  let inserted = 0, updated = 0;
  try {
    await client.query('BEGIN');
    for (const c of incoming) {
      if (!c.code_insee || !c.nom) continue;
      const exists = await client.query(`SELECT 1 FROM referentiel_communes WHERE code_insee = $1`, [c.code_insee]);
      await client.query(
        `INSERT INTO referentiel_communes
           (code_insee, nom, code_postal, epci_code, epci_nom, population_insee, is_metropole_rouen)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (code_insee) DO UPDATE SET
           nom = EXCLUDED.nom,
           code_postal = COALESCE(EXCLUDED.code_postal, referentiel_communes.code_postal),
           epci_code = COALESCE(EXCLUDED.epci_code, referentiel_communes.epci_code),
           epci_nom = COALESCE(EXCLUDED.epci_nom, referentiel_communes.epci_nom),
           population_insee = COALESCE(EXCLUDED.population_insee, referentiel_communes.population_insee),
           is_metropole_rouen = EXCLUDED.is_metropole_rouen`,
        [c.code_insee, c.nom, c.code_postal || null, c.epci_code || null, c.epci_nom || null,
         c.population_insee || null, c.is_metropole_rouen ?? true]
      );
      if (exists.rowCount > 0) updated++; else inserted++;
    }
    await client.query('COMMIT');
    res.json({ inserted, updated, total: incoming.length });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally { client.release(); }
});

router.patch('/cav/:cavId', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  const { code_insee } = req.body || {};
  try {
    if (code_insee) {
      const exists = await pool.query(`SELECT 1 FROM referentiel_communes WHERE code_insee = $1`, [code_insee]);
      if (exists.rowCount === 0) return res.status(400).json({ error: 'code_insee inconnu' });
    }
    const r = await pool.query(
      `UPDATE cav SET code_insee_commune = $1 WHERE id = $2 RETURNING id, name, commune, code_insee_commune`,
      [code_insee || null, req.params.cavId]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'CAV introuvable' });
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Exports pour tests unitaires (spécifications exécutables — pattern metropole.js)
router.METROPOLE_ROUEN_EPCI = METROPOLE_ROUEN_EPCI;
router.DEFAULT_EPCIS = DEFAULT_EPCIS;
router.EPCI_SETTING_KEY = EPCI_SETTING_KEY;
router.parseEpciSetting = parseEpciSetting;
router.isValidEpciCode = isValidEpciCode;
router.mapApiCommune = mapApiCommune;
router.filterEpcisByDep = filterEpcisByDep;

module.exports = router;
