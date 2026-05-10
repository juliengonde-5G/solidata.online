const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);

router.get('/', async (req, res) => {
  try {
    const { metropole, q } = req.query;
    let sql = `SELECT code_insee, nom, code_postal, epci_code, epci_nom, population_insee, is_metropole_rouen
               FROM referentiel_communes WHERE 1=1`;
    const params = [];
    if (metropole === 'true') sql += ` AND is_metropole_rouen = true`;
    if (q) { params.push(`%${q.toLowerCase()}%`); sql += ` AND LOWER(nom) LIKE $${params.length}`; }
    sql += ` ORDER BY nom`;
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

const METROPOLE_ROUEN_EPCI = '200023414';

router.post('/refresh-metropole', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const url = `https://geo.api.gouv.fr/epcis/${METROPOLE_ROUEN_EPCI}/communes?fields=nom,code,codesPostaux,population&format=json`;
    const r = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!r.ok) {
      return res.status(502).json({ error: `geo.api.gouv.fr a répondu ${r.status}` });
    }
    const data = await r.json();
    if (!Array.isArray(data)) return res.status(502).json({ error: 'Réponse inattendue de geo.api.gouv.fr' });

    const client = await pool.connect();
    let inserted = 0, updated = 0;
    try {
      await client.query('BEGIN');
      for (const c of data) {
        if (!c.code || !c.nom) continue;
        const exists = await client.query(`SELECT 1 FROM referentiel_communes WHERE code_insee = $1`, [c.code]);
        const codePostal = Array.isArray(c.codesPostaux) ? c.codesPostaux[0] : null;
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
             is_metropole_rouen = true`,
          [c.code, c.nom, codePostal, METROPOLE_ROUEN_EPCI, 'Métropole Rouen Normandie', c.population || null, true]
        );
        if (exists.rowCount > 0) updated++; else inserted++;
      }
      await client.query('COMMIT');
      res.json({ inserted, updated, total: data.length, source: 'geo.api.gouv.fr', epci: METROPOLE_ROUEN_EPCI });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally { client.release(); }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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

module.exports = router;
