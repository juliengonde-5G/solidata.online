/**
 * Module Énergie & GES (RSEI-11) — 29e module de l'ERP.
 *
 * Comble le critère RSEi 4.2 « Énergies et GES » (le seul à 0 du référentiel) et
 * alimente 4.1 / 4.5 (données B3 énergie/GES, B6 eau de l'export VSME RSEI-09).
 * Cadrage : rapports/rsei-2026-07-22/03-plan-action-rsei.md §2.2 (RSEI-11).
 *
 *   (a) énergie bâtiments : relevés mensuels par site/compteur (électricité, gaz,
 *       eau) ;
 *   (b) carburant flotte : pleins par véhicule (date, litres, €, km) → L/100 km,
 *       la dérive = signal maintenance (synergie module véhicules) ;
 *   (c) conversion GES méthode ADEME — même mécanique que metropole.js (CO2 évité)
 *       mais facteurs DISTINCTS pour les émissions PROPRES, STOCKÉS EN BASE et
 *       PARAMÉTRABLES (table ges_facteurs). Intensité tCO2e / CA.
 *
 * HABILITATIONS
 *  - Lecture  : ADMIN / MANAGER / RH / QHSE (REF_RSE hérite de MANAGER).
 *  - Écriture : ADMIN / RH / MANAGER (saisie terrain des relevés/pleins possible).
 *  - Facteurs d'émission (édition)  : ADMIN / RH uniquement.
 *
 * ⚠ Les facteurs d'émission sont INDICATIFS et PARAMÉTRABLES : ils ne prétendent
 * PAS à l'exactitude réglementaire (cf. seed init-db.js). La structure les ajuste
 * avec ses propres facteurs ADEME Base Empreinte millésimés.
 *
 * CONFIDENTIALITÉ : données quasi non personnelles (consommations, pleins) ; seul
 * l'utilisateur ayant SAISI la donnée est tracé (saisi_par). Registre RGPD
 * « Énergie & GES » (init-db.js).
 */
const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { body, param, query } = require('express-validator');
const { validate } = require('../middleware/validate');
const { autoLogActivity } = require('../middleware/activity-logger');

router.use(authenticate);
router.use(autoLogActivity('energie'));

const READ = authorize('ADMIN', 'MANAGER', 'RH', 'QHSE');
const WRITE = authorize('ADMIN', 'RH', 'MANAGER');
const FACTEURS_WRITE = authorize('ADMIN', 'RH'); // facteurs d'émission : ADMIN/RH

const TYPES_COMPTEUR = ['electricite', 'gaz', 'eau', 'autre'];
const TYPES_CARBURANT = ['gazole', 'essence', 'gnv', 'electrique', 'adblue', 'autre'];

// Exécute une sous-requête « best effort » : toute erreur (table/colonne absente
// sur une base non migrée) dégrade en fallback sans casser l'agrégat (dashboard).
async function soft(fn, fallback) {
  try { return await fn(); } catch (err) {
    console.error('[ENERGIE] sous-requête ignorée :', err.message);
    return fallback;
  }
}

// Lit une valeur de la table settings (clé/valeur). Renvoie null si absente.
async function readSetting(key) {
  try {
    const r = await pool.query('SELECT value FROM settings WHERE key = $1', [key]);
    return r.rows[0] ? r.rows[0].value : null;
  } catch (_) { return null; }
}

// ───────────────────────────────────────────────────────────────────────────
// ORACLES DE CALCUL (spécifications exécutables, verrouillées par les tests) —
// exposés sur le router (comme metropole.distributeTonnageProrata).
// ───────────────────────────────────────────────────────────────────────────

/**
 * Sélectionne le facteur d'émission d'un poste : privilégie une ligne active du
 * millésime demandé, sinon la ligne active la plus récente (année ≤ demandée puis
 * la plus récente disponible), sinon null. `facteurs` = lignes ges_facteurs.
 */
function pickFacteur(facteurs, poste, annee) {
  const actifs = (facteurs || []).filter((f) => f.poste === poste && f.actif !== false);
  if (actifs.length === 0) return null;
  const exact = actifs.find((f) => Number(f.annee) === Number(annee));
  if (exact) return exact;
  const anneeNum = (f) => (f.annee == null ? -Infinity : Number(f.annee));
  const anterieurs = actifs.filter((f) => anneeNum(f) <= Number(annee)).sort((a, b) => anneeNum(b) - anneeNum(a));
  if (anterieurs.length) return anterieurs[0];
  return actifs.slice().sort((a, b) => anneeNum(b) - anneeNum(a))[0];
}

/**
 * Consommation L/100 km d'un véhicule par la méthode « plein à plein » : le
 * carburant ajouté à chaque plein couvre la distance parcourue depuis le plein
 * précédent. On exclut le premier plein (réservoir de départ inconnu).
 *
 * @param {Array<{km_compteur:number|null, litres:number|string, date_plein?:string}>} pleins
 * @returns {null|{conso_l_100km, km_parcourus, litres_utilises, nb_pleins,
 *   derniere_conso, moyenne_hors_derniere, segments}}
 *   null si < 2 pleins exploitables (km relevé) ou kilométrage incohérent.
 */
function computeConsommation100km(pleins) {
  const pts = (pleins || [])
    .filter((p) => p.km_compteur != null && Number.isFinite(Number(p.km_compteur)))
    .map((p) => ({ km: Number(p.km_compteur), litres: Number(p.litres) || 0 }))
    .sort((a, b) => a.km - b.km);
  if (pts.length < 2) return null;

  const kmParcourus = pts[pts.length - 1].km - pts[0].km;
  if (!(kmParcourus > 0)) return null;

  // Segments consécutifs : la conso du segment i utilise les litres du plein i.
  const segments = [];
  for (let i = 1; i < pts.length; i++) {
    const dkm = pts[i].km - pts[i - 1].km;
    if (dkm > 0) segments.push({ km: dkm, litres: pts[i].litres, conso: (pts[i].litres / dkm) * 100 });
  }
  if (segments.length === 0) return null;

  const litresUtilises = pts.slice(1).reduce((s, p) => s + p.litres, 0);
  const conso = (litresUtilises / kmParcourus) * 100;
  const derniere = segments[segments.length - 1].conso;
  const anterieurs = segments.slice(0, -1);
  const moyenneHorsDerniere = anterieurs.length
    ? anterieurs.reduce((s, x) => s + x.conso, 0) / anterieurs.length
    : null;

  const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);
  return {
    conso_l_100km: r2(conso),
    km_parcourus: kmParcourus,
    litres_utilises: r2(litresUtilises),
    nb_pleins: pts.length,
    derniere_conso: r2(derniere),
    moyenne_hors_derniere: r2(moyenneHorsDerniere),
    segments: segments.map((s) => ({ km: s.km, litres: r2(s.litres), conso: r2(s.conso) })),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// SITES
// ═══════════════════════════════════════════════════════════════════════════
router.get('/sites', READ, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT s.*, (SELECT COUNT(*)::int FROM energie_compteurs c WHERE c.site_id = s.id) AS nb_compteurs
       FROM energie_sites s ORDER BY s.actif DESC, s.nom`
    );
    res.json(r.rows);
  } catch (err) {
    console.error('[ENERGIE] GET sites :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.post('/sites', WRITE, [
  body('nom').isString().trim().notEmpty(),
  body('adresse').optional({ nullable: true }).isString(),
  body('actif').optional().isBoolean(),
], validate, async (req, res) => {
  try {
    const { nom, adresse = null, actif = true } = req.body;
    const r = await pool.query(
      `INSERT INTO energie_sites (nom, adresse, actif) VALUES ($1, $2, $3) RETURNING *`,
      [nom.trim(), adresse, actif]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    console.error('[ENERGIE] POST site :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.put('/sites/:id', WRITE, [param('id').isInt()], validate, async (req, res) => {
  try {
    const fields = ['nom', 'adresse', 'actif'];
    const sets = [];
    const params = [];
    for (const f of fields) {
      if (Object.prototype.hasOwnProperty.call(req.body, f)) {
        params.push(req.body[f]); sets.push(`${f} = $${params.length}`);
      }
    }
    if (!sets.length) return res.status(400).json({ error: 'Aucune modification' });
    params.push(req.params.id);
    const r = await pool.query(
      `UPDATE energie_sites SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${params.length} RETURNING *`,
      params
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Site introuvable' });
    res.json(r.rows[0]);
  } catch (err) {
    console.error('[ENERGIE] PUT site :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.delete('/sites/:id', WRITE, [param('id').isInt()], validate, async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM energie_sites WHERE id = $1 RETURNING id', [req.params.id]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Site introuvable' });
    res.json({ message: 'Site supprimé', id: r.rows[0].id });
  } catch (err) {
    console.error('[ENERGIE] DELETE site :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// COMPTEURS (?site=)
// ═══════════════════════════════════════════════════════════════════════════
router.get('/compteurs', READ, async (req, res) => {
  try {
    const conds = [];
    const params = [];
    if (req.query.site) { params.push(parseInt(req.query.site, 10)); conds.push(`c.site_id = $${params.length}`); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const r = await pool.query(
      `SELECT c.*, s.nom AS site_nom FROM energie_compteurs c
       JOIN energie_sites s ON s.id = c.site_id ${where}
       ORDER BY s.nom, c.type, c.reference`,
      params
    );
    res.json(r.rows);
  } catch (err) {
    console.error('[ENERGIE] GET compteurs :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.post('/compteurs', WRITE, [
  body('site_id').isInt(),
  body('type').isIn(TYPES_COMPTEUR),
  body('reference').optional({ nullable: true }).isString(),
  body('unite').optional({ nullable: true }).isString(),
  body('actif').optional().isBoolean(),
], validate, async (req, res) => {
  try {
    const { site_id, type, reference = null, unite = 'kWh', actif = true } = req.body;
    const r = await pool.query(
      `INSERT INTO energie_compteurs (site_id, type, reference, unite, actif)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [site_id, type, reference, unite || 'kWh', actif]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    if (err.code === '23503') return res.status(400).json({ error: 'Site inconnu' });
    console.error('[ENERGIE] POST compteur :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.put('/compteurs/:id', WRITE, [
  param('id').isInt(),
  body('type').optional().isIn(TYPES_COMPTEUR),
  body('actif').optional().isBoolean(),
], validate, async (req, res) => {
  try {
    const fields = ['site_id', 'type', 'reference', 'unite', 'actif'];
    const sets = [];
    const params = [];
    for (const f of fields) {
      if (Object.prototype.hasOwnProperty.call(req.body, f)) {
        params.push(req.body[f]); sets.push(`${f} = $${params.length}`);
      }
    }
    if (!sets.length) return res.status(400).json({ error: 'Aucune modification' });
    params.push(req.params.id);
    const r = await pool.query(
      `UPDATE energie_compteurs SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${params.length} RETURNING *`,
      params
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Compteur introuvable' });
    res.json(r.rows[0]);
  } catch (err) {
    console.error('[ENERGIE] PUT compteur :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.delete('/compteurs/:id', WRITE, [param('id').isInt()], validate, async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM energie_compteurs WHERE id = $1 RETURNING id', [req.params.id]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Compteur introuvable' });
    res.json({ message: 'Compteur supprimé', id: r.rows[0].id });
  } catch (err) {
    console.error('[ENERGIE] DELETE compteur :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// RELEVÉS ÉNERGIE (?annee=&site=)
// ═══════════════════════════════════════════════════════════════════════════
router.get('/releves', READ, [
  query('annee').optional().isInt({ min: 2000, max: 2100 }),
  query('site').optional().isInt(),
], validate, async (req, res) => {
  try {
    const conds = [];
    const params = [];
    if (req.query.annee) { params.push(parseInt(req.query.annee, 10)); conds.push(`r.periode_annee = $${params.length}`); }
    if (req.query.site) { params.push(parseInt(req.query.site, 10)); conds.push(`c.site_id = $${params.length}`); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const r = await pool.query(
      `SELECT r.*, c.type AS compteur_type, c.unite AS compteur_unite, c.reference AS compteur_reference,
              s.id AS site_id, s.nom AS site_nom
       FROM energie_releves r
       JOIN energie_compteurs c ON c.id = r.compteur_id
       JOIN energie_sites s ON s.id = c.site_id
       ${where}
       ORDER BY r.periode_annee DESC, r.periode_mois DESC, s.nom, c.type`,
      params
    );
    res.json(r.rows);
  } catch (err) {
    console.error('[ENERGIE] GET releves :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.post('/releves', WRITE, [
  body('compteur_id').isInt(),
  body('periode_annee').isInt({ min: 2000, max: 2100 }),
  body('periode_mois').isInt({ min: 1, max: 12 }),
  body('valeur').isFloat({ min: 0 }),
  body('cout_euros').optional({ nullable: true }).isFloat({ min: 0 }),
], validate, async (req, res) => {
  try {
    const { compteur_id, periode_annee, periode_mois, valeur, cout_euros = null } = req.body;
    const r = await pool.query(
      `INSERT INTO energie_releves (compteur_id, periode_annee, periode_mois, valeur, cout_euros, saisi_par)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [compteur_id, periode_annee, periode_mois, valeur, cout_euros, req.user.id]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Un relevé existe déjà pour ce compteur sur cette période' });
    if (err.code === '23503') return res.status(400).json({ error: 'Compteur inconnu' });
    console.error('[ENERGIE] POST releve :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.put('/releves/:id', WRITE, [
  param('id').isInt(),
  body('valeur').optional().isFloat({ min: 0 }),
  body('cout_euros').optional({ nullable: true }).isFloat({ min: 0 }),
  body('periode_mois').optional().isInt({ min: 1, max: 12 }),
  body('periode_annee').optional().isInt({ min: 2000, max: 2100 }),
], validate, async (req, res) => {
  try {
    const fields = ['periode_annee', 'periode_mois', 'valeur', 'cout_euros'];
    const sets = [];
    const params = [];
    for (const f of fields) {
      if (Object.prototype.hasOwnProperty.call(req.body, f)) {
        params.push(req.body[f]); sets.push(`${f} = $${params.length}`);
      }
    }
    if (!sets.length) return res.status(400).json({ error: 'Aucune modification' });
    params.push(req.params.id);
    const r = await pool.query(
      `UPDATE energie_releves SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${params.length} RETURNING *`,
      params
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Relevé introuvable' });
    res.json(r.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Un relevé existe déjà pour ce compteur sur cette période' });
    console.error('[ENERGIE] PUT releve :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.delete('/releves/:id', WRITE, [param('id').isInt()], validate, async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM energie_releves WHERE id = $1 RETURNING id', [req.params.id]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Relevé introuvable' });
    res.json({ message: 'Relevé supprimé', id: r.rows[0].id });
  } catch (err) {
    console.error('[ENERGIE] DELETE releve :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// PLEINS CARBURANT (?annee=&vehicle=)
// ═══════════════════════════════════════════════════════════════════════════
router.get('/pleins', READ, [
  query('annee').optional().isInt({ min: 2000, max: 2100 }),
  query('vehicle').optional().isInt(),
], validate, async (req, res) => {
  try {
    const conds = [];
    const params = [];
    if (req.query.annee) { params.push(parseInt(req.query.annee, 10)); conds.push(`EXTRACT(YEAR FROM p.date_plein) = $${params.length}`); }
    if (req.query.vehicle) { params.push(parseInt(req.query.vehicle, 10)); conds.push(`p.vehicle_id = $${params.length}`); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const r = await pool.query(
      `SELECT p.*, v.registration AS vehicle_registration, v.name AS vehicle_name
       FROM carburant_pleins p
       LEFT JOIN vehicles v ON v.id = p.vehicle_id
       ${where}
       ORDER BY p.date_plein DESC, p.id DESC`,
      params
    );
    res.json(r.rows);
  } catch (err) {
    console.error('[ENERGIE] GET pleins :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.post('/pleins', WRITE, [
  body('vehicle_id').optional({ nullable: true }).isInt(),
  body('date_plein').isISO8601(),
  body('litres').isFloat({ min: 0 }),
  body('cout_euros').optional({ nullable: true }).isFloat({ min: 0 }),
  body('km_compteur').optional({ nullable: true }).isInt({ min: 0 }),
  body('type_carburant').optional().isIn(TYPES_CARBURANT),
], validate, async (req, res) => {
  try {
    const { vehicle_id = null, date_plein, litres, cout_euros = null, km_compteur = null, type_carburant = 'gazole' } = req.body;
    const r = await pool.query(
      `INSERT INTO carburant_pleins (vehicle_id, date_plein, litres, cout_euros, km_compteur, type_carburant, saisi_par)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [vehicle_id, date_plein, litres, cout_euros, km_compteur, type_carburant, req.user.id]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    if (err.code === '23503') return res.status(400).json({ error: 'Véhicule inconnu' });
    console.error('[ENERGIE] POST plein :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.put('/pleins/:id', WRITE, [
  param('id').isInt(),
  body('litres').optional().isFloat({ min: 0 }),
  body('cout_euros').optional({ nullable: true }).isFloat({ min: 0 }),
  body('km_compteur').optional({ nullable: true }).isInt({ min: 0 }),
  body('type_carburant').optional().isIn(TYPES_CARBURANT),
  body('date_plein').optional().isISO8601(),
  body('vehicle_id').optional({ nullable: true }).isInt(),
], validate, async (req, res) => {
  try {
    const fields = ['vehicle_id', 'date_plein', 'litres', 'cout_euros', 'km_compteur', 'type_carburant'];
    const sets = [];
    const params = [];
    for (const f of fields) {
      if (Object.prototype.hasOwnProperty.call(req.body, f)) {
        params.push(req.body[f]); sets.push(`${f} = $${params.length}`);
      }
    }
    if (!sets.length) return res.status(400).json({ error: 'Aucune modification' });
    params.push(req.params.id);
    const r = await pool.query(
      `UPDATE carburant_pleins SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${params.length} RETURNING *`,
      params
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Plein introuvable' });
    res.json(r.rows[0]);
  } catch (err) {
    console.error('[ENERGIE] PUT plein :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.delete('/pleins/:id', WRITE, [param('id').isInt()], validate, async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM carburant_pleins WHERE id = $1 RETURNING id', [req.params.id]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Plein introuvable' });
    res.json({ message: 'Plein supprimé', id: r.rows[0].id });
  } catch (err) {
    console.error('[ENERGIE] DELETE plein :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// FACTEURS D'ÉMISSION GES — édition ADMIN/RH (PARAMÉTRABLES, valeurs indicatives)
// ═══════════════════════════════════════════════════════════════════════════
router.get('/facteurs', READ, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT * FROM ges_facteurs ORDER BY poste, annee DESC NULLS LAST`
    );
    res.json({
      avertissement: 'Facteurs INDICATIFS et paramétrables — à ajuster par la structure avec ses propres facteurs ADEME Base Empreinte millésimés. Ne prétendent pas à l\'exactitude réglementaire.',
      facteurs: r.rows,
    });
  } catch (err) {
    console.error('[ENERGIE] GET facteurs :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.post('/facteurs', FACTEURS_WRITE, [
  body('poste').isString().trim().notEmpty(),
  body('unite').isString().trim().notEmpty(),
  body('facteur_kgco2e').isFloat({ min: 0 }),
  body('source').optional({ nullable: true }).isString(),
  body('annee').optional({ nullable: true }).isInt({ min: 2000, max: 2100 }),
  body('actif').optional().isBoolean(),
], validate, async (req, res) => {
  try {
    const { poste, unite, facteur_kgco2e, source = 'ADEME Base Empreinte', annee = null, actif = true } = req.body;
    const r = await pool.query(
      `INSERT INTO ges_facteurs (poste, unite, facteur_kgco2e, source, annee, actif)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [poste.trim(), unite.trim(), facteur_kgco2e, source, annee, actif]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Un facteur existe déjà pour ce poste et cette année' });
    console.error('[ENERGIE] POST facteur :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.put('/facteurs/:id', FACTEURS_WRITE, [
  param('id').isInt(),
  body('facteur_kgco2e').optional().isFloat({ min: 0 }),
  body('annee').optional({ nullable: true }).isInt({ min: 2000, max: 2100 }),
  body('actif').optional().isBoolean(),
], validate, async (req, res) => {
  try {
    const fields = ['poste', 'unite', 'facteur_kgco2e', 'source', 'annee', 'actif'];
    const sets = [];
    const params = [];
    for (const f of fields) {
      if (Object.prototype.hasOwnProperty.call(req.body, f)) {
        params.push(req.body[f]); sets.push(`${f} = $${params.length}`);
      }
    }
    if (!sets.length) return res.status(400).json({ error: 'Aucune modification' });
    params.push(req.params.id);
    const r = await pool.query(
      `UPDATE ges_facteurs SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${params.length} RETURNING *`,
      params
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Facteur introuvable' });
    res.json(r.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Un facteur existe déjà pour ce poste et cette année' });
    console.error('[ENERGIE] PUT facteur :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ───────────────────────────────────────────────────────────────────────────
// Agrégat GES annuel partagé (dashboard + vsme-b3b6). Résilient (soft).
// Renvoie consommations, émissions par poste, totaux, intensité, L/100 km.
// ───────────────────────────────────────────────────────────────────────────
async function computeAnnualGes(annee) {
  // Consommations énergie bâtiments par type (électricité/gaz/eau/autre).
  const energieRows = await soft(async () => (await pool.query(
    `SELECT c.type AS poste,
            COALESCE(SUM(r.valeur), 0)::numeric AS conso,
            COALESCE(SUM(r.cout_euros), 0)::numeric AS cout,
            COUNT(*)::int AS nb_releves
     FROM energie_releves r
     JOIN energie_compteurs c ON c.id = r.compteur_id
     WHERE r.periode_annee = $1
     GROUP BY c.type`, [annee])).rows, []);

  // Carburant flotte par type.
  const carburantRows = await soft(async () => (await pool.query(
    `SELECT type_carburant AS poste,
            COALESCE(SUM(litres), 0)::numeric AS litres,
            COALESCE(SUM(cout_euros), 0)::numeric AS cout,
            COUNT(*)::int AS nb_pleins
     FROM carburant_pleins
     WHERE EXTRACT(YEAR FROM date_plein) = $1
     GROUP BY type_carburant`, [annee])).rows, []);

  // Facteurs d'émission (paramétrables).
  const facteurs = await soft(async () => (await pool.query(
    `SELECT poste, unite, facteur_kgco2e::float AS facteur_kgco2e, annee, actif FROM ges_facteurs`)).rows, []);

  // Émissions énergie bâtiments.
  const emissionsEnergie = energieRows.map((row) => {
    const conso = Number(row.conso) || 0;
    const f = pickFacteur(facteurs, row.poste, annee);
    const kg = f ? conso * Number(f.facteur_kgco2e) : null;
    return {
      poste: row.poste, conso, cout_euros: Number(row.cout) || 0, nb_releves: row.nb_releves,
      facteur_kgco2e: f ? Number(f.facteur_kgco2e) : null, facteur_unite: f ? f.unite : null,
      facteur_manquant: !f,
      tco2e: kg == null ? null : Math.round((kg / 1000) * 1000) / 1000,
    };
  });

  // Émissions carburant flotte.
  const emissionsCarburant = carburantRows.map((row) => {
    const litres = Number(row.litres) || 0;
    const f = pickFacteur(facteurs, row.poste, annee);
    const kg = f ? litres * Number(f.facteur_kgco2e) : null;
    return {
      poste: row.poste, litres, cout_euros: Number(row.cout) || 0, nb_pleins: row.nb_pleins,
      facteur_kgco2e: f ? Number(f.facteur_kgco2e) : null, facteur_unite: f ? f.unite : null,
      facteur_manquant: !f,
      tco2e: kg == null ? null : Math.round((kg / 1000) * 1000) / 1000,
    };
  });

  const sumTco2e = (arr) => Math.round(arr.reduce((s, e) => s + (e.tco2e || 0), 0) * 1000) / 1000;
  const tco2eEnergie = sumTco2e(emissionsEnergie);
  const tco2eCarburant = sumTco2e(emissionsCarburant);
  const tco2eTotal = Math.round((tco2eEnergie + tco2eCarburant) * 1000) / 1000;

  return {
    annee,
    energie: emissionsEnergie,
    carburant: emissionsCarburant,
    totaux: { tco2e_energie: tco2eEnergie, tco2e_carburant: tco2eCarburant, tco2e_total: tco2eTotal },
  };
}

// Résout le CA de référence pour l'intensité tCO2e/CA. Ordre (doctrine « jamais
// de valeur inventée » : null si aucune source) :
//   1. setting explicite `energie.ca_reference_<annee>` (CA officiel épinglé) ;
//   2. setting générique `energie.ca_reference_annee` ;
//   3. comptes 70 (+74) du Grand Livre pour l'année (CA comptable) — soft ;
//   4. CA opérationnel (boutiques HT + VAK HT + exutoires facturés/clôturés) — soft.
async function resolveCA(annee) {
  const parse = (v) => { const n = parseFloat(v); return Number.isFinite(n) && n > 0 ? n : null; };

  const sPin = parse(await readSetting(`energie.ca_reference_${annee}`));
  if (sPin != null) return { ca: sPin, source: 'settings' };
  const sGen = parse(await readSetting('energie.ca_reference_annee'));
  if (sGen != null) return { ca: sGen, source: 'settings' };

  const gl = await soft(async () => {
    const r = await pool.query(
      `SELECT COALESCE(SUM(g.credit - g.debit), 0)::float AS ca
       FROM financial_gl_entries g JOIN financial_exercises e ON g.exercise_id = e.id
       WHERE e.year = $1 AND (g.account LIKE '70%' OR g.account LIKE '74%')`, [annee]);
    return parse(r.rows[0] && r.rows[0].ca);
  }, null);
  if (gl != null) return { ca: gl, source: 'gl' };

  const op = await soft(async () => {
    const b = await pool.query(`SELECT COALESCE(SUM(total_ht),0)::float AS ca FROM boutique_ventes WHERE EXTRACT(YEAR FROM date_vente) = $1`, [annee]);
    const v = await pool.query(`SELECT COALESCE(SUM(total_ht),0)::float AS ca FROM vak_ventes WHERE EXTRACT(YEAR FROM date_vente) = $1`, [annee]);
    const e = await pool.query(
      `SELECT COALESCE(SUM(COALESCE(cp.pesee_client * c.prix_tonne, c.tonnage_prevu * c.prix_tonne, 0)),0)::float AS ca
       FROM commandes_exutoires c
       LEFT JOIN LATERAL (SELECT pesee_client FROM controles_pesee WHERE commande_id = c.id ORDER BY id DESC LIMIT 1) cp ON true
       WHERE EXTRACT(YEAR FROM c.date_commande) = $1 AND c.statut IN ('facturee','cloturee')`, [annee]);
    const total = (b.rows[0].ca || 0) + (v.rows[0].ca || 0) + (e.rows[0].ca || 0);
    return parse(total);
  }, null);
  if (op != null) return { ca: op, source: 'operationnel' };

  return { ca: null, source: null };
}

// L/100 km par véhicule + signal de dérive. Résilient (soft).
async function computeVehicleConso(annee, seuilDerivePct) {
  const rows = await soft(async () => (await pool.query(
    `SELECT p.vehicle_id, p.date_plein, p.litres::float AS litres, p.km_compteur,
            v.registration, v.name
     FROM carburant_pleins p
     LEFT JOIN vehicles v ON v.id = p.vehicle_id
     WHERE p.vehicle_id IS NOT NULL AND EXTRACT(YEAR FROM p.date_plein) = $1
     ORDER BY p.vehicle_id, p.km_compteur NULLS LAST, p.date_plein`, [annee])).rows, []);

  const byVehicle = new Map();
  for (const r of rows) {
    if (!byVehicle.has(r.vehicle_id)) {
      byVehicle.set(r.vehicle_id, { vehicle_id: r.vehicle_id, registration: r.registration, name: r.name, pleins: [] });
    }
    byVehicle.get(r.vehicle_id).pleins.push({ km_compteur: r.km_compteur, litres: r.litres, date_plein: r.date_plein });
  }

  const vehicules = [];
  const derives = [];
  for (const v of byVehicle.values()) {
    const conso = computeConsommation100km(v.pleins);
    if (!conso) continue;
    let derive = false;
    if (conso.moyenne_hors_derniere != null && conso.moyenne_hors_derniere > 0 && conso.derniere_conso != null) {
      derive = conso.derniere_conso > conso.moyenne_hors_derniere * (1 + seuilDerivePct / 100);
    }
    const entry = {
      vehicle_id: v.vehicle_id, registration: v.registration, name: v.name,
      conso_l_100km: conso.conso_l_100km, derniere_conso: conso.derniere_conso,
      moyenne_hors_derniere: conso.moyenne_hors_derniere,
      km_parcourus: conso.km_parcourus, litres_utilises: conso.litres_utilises,
      nb_pleins: conso.nb_pleins, derive,
    };
    vehicules.push(entry);
    if (derive) derives.push(entry);
  }
  vehicules.sort((a, b) => (b.conso_l_100km || 0) - (a.conso_l_100km || 0));
  return { vehicules, derives, seuil_derive_pct: seuilDerivePct };
}

// ═══════════════════════════════════════════════════════════════════════════
// GET /dashboard?annee= — agrégat GES annuel + intensité + L/100 km
// ═══════════════════════════════════════════════════════════════════════════
router.get('/dashboard', READ, [query('annee').optional().isInt({ min: 2000, max: 2100 })], validate, async (req, res) => {
  try {
    const annee = parseInt(req.query.annee, 10) || new Date().getFullYear();

    let seuilDerive = 20;
    const sSeuil = parseFloat(await readSetting('energie.derive_seuil_pct'));
    if (Number.isFinite(sSeuil) && sSeuil > 0) seuilDerive = sSeuil;

    const ges = await computeAnnualGes(annee);
    const { ca, source: caSource } = await resolveCA(annee);
    const conso = await computeVehicleConso(annee, seuilDerive);

    // Intensité tCO2e / CA (en tCO2e par k€ de CA — lisible). null si CA absent.
    const intensiteParKeuro = (ca && ca > 0)
      ? Math.round((ges.totaux.tco2e_total / (ca / 1000)) * 1000) / 1000
      : null;

    res.json({
      annee,
      generated_at: new Date().toISOString(),
      avertissement_facteurs: 'Émissions calculées avec des facteurs INDICATIFS et paramétrables (ADEME Base Empreinte) — à ajuster par la structure. Ne prétendent pas à l\'exactitude réglementaire.',
      energie_batiments: ges.energie,
      carburant_flotte: ges.carburant,
      totaux: ges.totaux,
      intensite: {
        ca_reference: ca,
        ca_source: caSource, // 'settings' | 'gl' | 'operationnel' | null
        tco2e_total: ges.totaux.tco2e_total,
        tco2e_par_keuro_ca: intensiteParKeuro,
      },
      vehicules: conso.vehicules,
      derives: conso.derives,
      seuil_derive_pct: conso.seuil_derive_pct,
    });
  } catch (err) {
    console.error('[ENERGIE] GET dashboard :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /vsme-b3b6?annee= — données B3 (énergie/GES) + B6 (eau) pour le futur
// export VSME (RSEI-09 non encore livré). Structure préparatoire documentée.
// ═══════════════════════════════════════════════════════════════════════════
router.get('/vsme-b3b6', READ, [query('annee').optional().isInt({ min: 2000, max: 2100 })], validate, async (req, res) => {
  try {
    const annee = parseInt(req.query.annee, 10) || new Date().getFullYear();
    const ges = await computeAnnualGes(annee);

    const kwhDe = (poste) => {
      const e = ges.energie.find((x) => x.poste === poste);
      return e ? Math.round(e.conso * 1000) / 1000 : 0;
    };
    const electriciteKwh = kwhDe('electricite');
    const gazKwh = kwhDe('gaz');
    const eauM3 = kwhDe('eau'); // relevé eau en m3 (unité du compteur)

    // Répartition scope (simplifiée, documentée) :
    //  - Scope 1 (émissions directes) = combustion carburant flotte + gaz bâtiment ;
    //  - Scope 2 (émissions indirectes) = électricité achetée.
    const gazTco2e = (ges.energie.find((x) => x.poste === 'gaz') || {}).tco2e || 0;
    const elecTco2e = (ges.energie.find((x) => x.poste === 'electricite') || {}).tco2e || 0;
    const scope1 = Math.round((ges.totaux.tco2e_carburant + gazTco2e) * 1000) / 1000;
    const scope2 = Math.round(elecTco2e * 1000) / 1000;

    res.json({
      annee,
      generated_at: new Date().toISOString(),
      note: 'Structure préparatoire à l\'export VSME (RSEI-09, non encore livré). Facteurs INDICATIFS et paramétrables — ne prétendent pas à l\'exactitude réglementaire. part_renouvelable et sources d\'énergie détaillées non renseignées (à compléter par la structure).',
      b3_energie_ges: {
        energie: {
          electricite_kwh: electriciteKwh,
          gaz_kwh: gazKwh,
          total_energie_kwh: Math.round((electriciteKwh + gazKwh) * 1000) / 1000,
          part_renouvelable_pct: null,
        },
        ges: {
          scope1_tco2e: scope1,
          scope2_tco2e: scope2,
          total_tco2e: ges.totaux.tco2e_total,
          methode: 'Facteurs d\'émission ADEME Base Empreinte (paramétrables, table ges_facteurs)',
        },
        detail_par_poste: [...ges.energie, ...ges.carburant].map((e) => ({
          poste: e.poste, tco2e: e.tco2e, facteur_kgco2e: e.facteur_kgco2e, facteur_manquant: e.facteur_manquant,
        })),
      },
      b6_eau: {
        consommation_eau_m3: eauM3,
      },
    });
  } catch (err) {
    console.error('[ENERGIE] GET vsme-b3b6 :', err.message);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// Oracles exposés pour les tests (comme metropole.distributeTonnageProrata).
router.pickFacteur = pickFacteur;
router.computeConsommation100km = computeConsommation100km;
// Agrégats annuels réutilisés par le module Pilotage RSE (RSEI-18, bilan 3 volets)
// — consommés en LECTURE, agrégats NON nominatifs (émissions propres, intensité).
router.computeAnnualGes = computeAnnualGes;
router.resolveCA = resolveCA;
// Consommation plein-à-plein : SOURCE UNIQUE, réutilisée par le calcul de CO2
// des tournées (services/vehicle-emissions.js) — pas de seconde formule.
router.computeConsommation100km = computeConsommation100km;

module.exports = router;
