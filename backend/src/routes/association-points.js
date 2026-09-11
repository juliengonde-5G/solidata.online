const express = require('express');
const router = express.Router();
const https = require('https');
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { body } = require('express-validator');
const { validate } = require('../middleware/validate');
const { autoLogActivity } = require('../middleware/activity-logger');
const { validerHoraires, joursFermes } = require('../services/association-horaires');
const { rappelerExtranetRefashion, auteurDe } = require('../services/rappel-refashion');

router.use(authenticate);
router.use(autoLogActivity('association-points'));

// ══════════════════════════════════════════
// Horaires d'accessibilité & durée d'arrêt (RG-A1, RG-C1)
// ══════════════════════════════════════════

/**
 * Ajoute à une ligne de point les deux informations DÉRIVÉES des horaires :
 *  - `horaires_renseignes` : la fiche a-t-elle été complétée ? Un `false` dit
 *    « information inconnue », pas « ouvert en permanence » (RG-A2).
 *  - `jours_fermes` : jours sans aucune plage (RG-A5) ; [] si non renseigné.
 */
function enrichirHoraires(row) {
  if (!row) return row;
  return {
    ...row,
    horaires_renseignes: row.horaires_accessibilite !== null && row.horaires_accessibilite !== undefined,
    jours_fermes: joursFermes(row.horaires_accessibilite),
  };
}

/**
 * Durée d'arrêt de la fiche : entier 1-480 minutes, ou null (non renseignée →
 * le réglage global prendra le relais, RG-C3). Jamais de valeur inventée.
 * @returns {{ok: true, valeur: number|null} | {ok: false, message: string}}
 */
function lireDureeCollecte(brut) {
  if (brut === null || brut === undefined || brut === '') return { ok: true, valeur: null };
  const n = Number(brut);
  if (!Number.isInteger(n) || n < 1 || n > 480) {
    return { ok: false, message: 'Durée de collecte : nombre entier de minutes entre 1 et 480 attendu (ou vide).' };
  }
  return { ok: true, valeur: n };
}

/**
 * Adresse électronique du référent (10/09/2026, demande client).
 *
 * Vide ou absente → `null` : une association sans adresse connue reste une
 * fiche valide. Une adresse MAL FORMÉE, en revanche, est refusée plutôt que
 * rangée en base « au mieux » — une adresse fausse coûte plus cher qu'une
 * adresse absente : on croit avoir prévenu l'association, et on ne l'a pas fait.
 *
 * Contrôle volontairement SIMPLE (une arobase, un point dans le domaine, pas
 * d'espace) : les expressions rationnelles exhaustives de la RFC 5322 rejettent
 * des adresses valides et acceptent des adresses mortes. Seul un envoi réel
 * prouve qu'une adresse existe.
 * @returns {{ok: true, valeur: string|null} | {ok: false, message: string}}
 */
function lireContactEmail(brut) {
  if (brut === null || brut === undefined) return { ok: true, valeur: null };
  const v = String(brut).trim();
  if (v === '') return { ok: true, valeur: null };
  if (v.length > 255) return { ok: false, message: 'Adresse e-mail trop longue (255 caractères maximum).' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) {
    return { ok: false, message: "Adresse e-mail invalide (exemple attendu : contact@association.fr)." };
  }
  return { ok: true, valeur: v };
}

// ══════════════════════════════════════════
// Géocodage via API adresse.data.gouv.fr
// ══════════════════════════════════════════
function geocodeAddress(address, city, postcode) {
  return new Promise((resolve) => {
    if (!address || !city) { resolve(null); return; }
    const query = encodeURIComponent(`${address} ${city}`);
    const url = `https://api-adresse.data.gouv.fr/search/?q=${query}${postcode ? `&postcode=${postcode}` : ''}&limit=1`;

    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.features && json.features.length > 0) {
            const [lng, lat] = json.features[0].geometry.coordinates;
            const label = json.features[0].properties.label;
            resolve({ latitude: lat, longitude: lng, label });
          } else {
            resolve(null);
          }
        } catch { resolve(null); }
      });
    }).on('error', () => resolve(null));
  });
}

// GET /api/association-points — Liste avec filtres
router.get('/', async (req, res) => {
  try {
    const { status, ville, search } = req.query;
    let query = 'SELECT * FROM association_points WHERE 1=1';
    const params = [];

    if (status) { params.push(status); query += ` AND status = $${params.length}`; }
    if (ville) { params.push(ville); query += ` AND ville = $${params.length}`; }
    if (search) { params.push(`%${search}%`); query += ` AND (name ILIKE $${params.length} OR address ILIKE $${params.length} OR ville ILIKE $${params.length})`; }

    query += ' ORDER BY name';
    const result = await pool.query(query, params);
    res.json(result.rows.map(enrichirHoraires));
  } catch (err) {
    console.error('[ASSO-POINTS] Erreur liste :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/association-points/villes — Liste des villes distinctes
router.get('/villes', async (req, res) => {
  try {
    const result = await pool.query("SELECT DISTINCT ville FROM association_points WHERE ville IS NOT NULL AND ville != '' ORDER BY ville");
    res.json(result.rows.map(r => r.ville));
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// GET /api/association-points/map — Données carte
router.get('/map', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT ap.id, ap.name, ap.address, ap.complement_adresse, ap.code_postal, ap.ville,
        ap.latitude, ap.longitude, ap.contact_phone, ap.avg_fill_rate, ap.status,
        ap.unavailable_reason, ap.route_count,
        (SELECT MAX(tha.date) FROM tonnage_history_association tha WHERE tha.association_point_id = ap.id) as last_collection,
        (SELECT AVG(tha.weight_kg) FROM tonnage_history_association tha WHERE tha.association_point_id = ap.id
         AND tha.date >= NOW() - INTERVAL '90 days') as avg_weight_90d
      FROM association_points ap
      WHERE ap.status IN ('active', 'temporairement_indisponible')
      ORDER BY ap.name
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('[ASSO-POINTS] Erreur map :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/association-points/geocode — Géocoder une adresse
router.post('/geocode', authorize('ADMIN'), async (req, res) => {
  try {
    const { address, city, postcode } = req.body;
    const result = await geocodeAddress(address, city, postcode);
    if (result) {
      res.json(result);
    } else {
      res.status(404).json({ error: 'Adresse non trouvée' });
    }
  } catch (err) {
    res.status(500).json({ error: 'Erreur de géocodage' });
  }
});

// GET /api/association-points/:id — Détail d'un point
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM association_points WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Point non trouvé' });
    res.json(enrichirHoraires(result.rows[0]));
  } catch (err) {
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/association-points — Créer un point
router.post('/', authorize('ADMIN'), [
  body('name').notEmpty().withMessage('Nom requis'),
], validate, async (req, res) => {
  try {
    const { name, address, complement_adresse, code_postal, ville, latitude, longitude, contact_phone, contact_email, contact_info,
      horaires_accessibilite, horaires_notes, duree_collecte_min } = req.body;

    // Horaires d'accessibilité : validés AVANT toute écriture — une saisie
    // fautive est refusée en 400 détaillé, jamais rangée en base « au mieux ».
    const ctrl = validerHoraires(horaires_accessibilite);
    if (!ctrl.valide) {
      return res.status(400).json({
        error: 'Horaires d\'accessibilité invalides', code: 'HORAIRES_INVALIDES', erreurs: ctrl.erreurs,
      });
    }
    const duree = lireDureeCollecte(duree_collecte_min);
    if (!duree.ok) return res.status(400).json({ error: duree.message, code: 'DUREE_COLLECTE_INVALIDE' });
    const email = lireContactEmail(contact_email);
    if (!email.ok) return res.status(400).json({ error: email.message, code: 'EMAIL_INVALIDE' });

    // Géocodage auto si pas de coordonnées fournies
    let lat = latitude ? parseFloat(latitude) : null;
    let lng = longitude ? parseFloat(longitude) : null;
    if (!lat && !lng && address && ville) {
      const geo = await geocodeAddress(address, ville, code_postal);
      if (geo) { lat = geo.latitude; lng = geo.longitude; }
    }

    const result = await pool.query(
      `INSERT INTO association_points (name, address, complement_adresse, code_postal, ville, latitude, longitude, geom, contact_phone, contact_info,
         horaires_accessibilite, horaires_notes, duree_collecte_min, contact_email)
       VALUES ($1, $2, $3, $4, $5, $6, $7,
         ${lat && lng ? `ST_SetSRID(ST_MakePoint($7, $6), 4326)` : 'NULL'},
         $8, $9, $10::jsonb, $11, $12, $13) RETURNING *`,
      [name, address || null, complement_adresse || null, code_postal || null, ville || null, lat, lng, contact_phone || null, contact_info || null,
        ctrl.normalise ? JSON.stringify(ctrl.normalise) : null, horaires_notes || null, duree.valeur, email.valeur]
    );
    // Rappel « extranet Refashion » (10/09/2026) : un point d'apport créé ici
    // n'existe pas pour Refashion tant qu'il n'y est pas déclaré — et c'est sur
    // le nombre de points déclarés que se calcule la subvention DPAV.
    rappelerExtranetRefashion({
      objet: `Association « ${name} »`,
      action: 'créée',
      detail: [result.rows[0].code_postal, result.rows[0].ville].filter(Boolean).join(' ') || null,
      auteur: auteurDe(req),
      lien: '/admin-associations',
    });

    res.status(201).json(enrichirHoraires(result.rows[0]));
  } catch (err) {
    console.error('[ASSO-POINTS] Erreur création :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// PUT /api/association-points/:id — Modifier un point
router.put('/:id', authorize('ADMIN'), async (req, res) => {
  try {
    const { name, address, complement_adresse, code_postal, ville, latitude, longitude, contact_phone, contact_info, status, unavailable_reason } = req.body;

    let lat = latitude ? parseFloat(latitude) : null;
    let lng = longitude ? parseFloat(longitude) : null;

    // Géocodage auto si adresse modifiée sans coordonnées
    if (!lat && !lng && address && ville) {
      const geo = await geocodeAddress(address, ville, code_postal);
      if (geo) { lat = geo.latitude; lng = geo.longitude; }
    }

    // Horaires, notes et durée d'arrêt : mis à jour SEULEMENT si la clé est
    // présente dans la requête. Les écrans envoient des PUT partiels (le
    // basculement de statut, par exemple, n'envoie que `status`) : écraser des
    // horaires que l'appelant n'a pas mentionnés serait une perte de données.
    // Une clé présente à `null` efface, elle : c'est un geste explicite.
    const setsSup = [];
    const paramsSup = [];
    let idxSup = 12; // $12 = l'identifiant ; les ajouts commencent à $13
    if (Object.prototype.hasOwnProperty.call(req.body, 'horaires_accessibilite')) {
      const ctrl = validerHoraires(req.body.horaires_accessibilite);
      if (!ctrl.valide) {
        return res.status(400).json({
          error: 'Horaires d\'accessibilité invalides', code: 'HORAIRES_INVALIDES', erreurs: ctrl.erreurs,
        });
      }
      paramsSup.push(ctrl.normalise ? JSON.stringify(ctrl.normalise) : null);
      setsSup.push(`horaires_accessibilite = $${++idxSup}::jsonb`);
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'horaires_notes')) {
      paramsSup.push(req.body.horaires_notes || null);
      setsSup.push(`horaires_notes = $${++idxSup}`);
    }
    if (Object.prototype.hasOwnProperty.call(req.body, 'duree_collecte_min')) {
      const duree = lireDureeCollecte(req.body.duree_collecte_min);
      if (!duree.ok) return res.status(400).json({ error: duree.message, code: 'DUREE_COLLECTE_INVALIDE' });
      paramsSup.push(duree.valeur);
      setsSup.push(`duree_collecte_min = $${++idxSup}`);
    }
    // L'adresse e-mail suit la même règle que les horaires : elle n'est écrite
    // que si la clé est PRÉSENTE. Un PUT partiel (bascule de statut, par
    // exemple) ne doit pas effacer un contact que l'appelant n'a pas mentionné.
    if (Object.prototype.hasOwnProperty.call(req.body, 'contact_email')) {
      const email = lireContactEmail(req.body.contact_email);
      if (!email.ok) return res.status(400).json({ error: email.message, code: 'EMAIL_INVALIDE' });
      paramsSup.push(email.valeur);
      setsSup.push(`contact_email = $${++idxSup}`);
    }

    const result = await pool.query(
      `UPDATE association_points SET
        name = COALESCE($1, name),
        address = COALESCE($2, address),
        complement_adresse = $3,
        code_postal = COALESCE($4, code_postal),
        ville = COALESCE($5, ville),
        latitude = COALESCE($6, latitude),
        longitude = COALESCE($7, longitude),
        geom = ${lat && lng ? `ST_SetSRID(ST_MakePoint($7, $6), 4326)` : 'COALESCE(geom, NULL)'},
        contact_phone = $8,
        contact_info = $9,
        status = COALESCE($10, status),
        unavailable_reason = $11,
        unavailable_since = CASE WHEN $10 = 'temporairement_indisponible' AND status != 'temporairement_indisponible' THEN CURRENT_DATE ELSE unavailable_since END,
        updated_at = NOW()${setsSup.length > 0 ? `,\n        ${setsSup.join(',\n        ')}` : ''}
       WHERE id = $12 RETURNING *`,
      [name, address, complement_adresse || null, code_postal, ville, lat, lng, contact_phone || null, contact_info || null, status, unavailable_reason || null, req.params.id,
        ...paramsSup]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Point non trouvé' });

    // Rappel « extranet Refashion » : le changement de STATUT est le cas le
    // plus sensible (un point passé inactif reste déclaré chez Refashion, donc
    // compté), mais une adresse ou un nom qui change compte aussi — c'est sur
    // ces libellés que se fait le rapprochement lors d'un contrôle.
    const modifie = result.rows[0];
    rappelerExtranetRefashion({
      objet: `Association « ${modifie.name} »`,
      action: 'modifiée',
      detail: Object.prototype.hasOwnProperty.call(req.body, 'status') && status
        ? `statut : ${status}`
        : ([modifie.address, modifie.ville].filter(Boolean).join(', ') || null),
      auteur: auteurDe(req),
      lien: '/admin-associations',
    });

    res.json(enrichirHoraires(modifie));
  } catch (err) {
    console.error('[ASSO-POINTS] Erreur mise à jour :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// DELETE /api/association-points/:id — Supprimer un point
router.delete('/:id', authorize('ADMIN'), async (req, res) => {
  try {
    // `RETURNING name` : le rappel doit NOMMER le point, et après le DELETE il
    // n'y a plus rien à lire. Un rappel qui dirait « une association a été
    // supprimée » sans dire laquelle n'aiderait personne à corriger l'extranet.
    const result = await pool.query('DELETE FROM association_points WHERE id = $1 RETURNING id, name', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Point non trouvé' });

    rappelerExtranetRefashion({
      objet: `Association « ${result.rows[0].name} »`,
      action: 'supprimée',
      detail: 'le point ne doit plus figurer parmi les points d\'apport déclarés',
      auteur: auteurDe(req),
      lien: '/admin-associations',
    });

    res.json({ message: 'Point supprimé' });
  } catch (err) {
    console.error('[ASSO-POINTS] Erreur suppression :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

// POST /api/association-points/:id/geocode — Regéocoder un point existant
router.post('/:id/geocode', authorize('ADMIN'), async (req, res) => {
  try {
    const point = await pool.query('SELECT address, ville, code_postal FROM association_points WHERE id = $1', [req.params.id]);
    if (point.rows.length === 0) return res.status(404).json({ error: 'Point non trouvé' });

    const { address, ville, code_postal } = point.rows[0];
    const geo = await geocodeAddress(address, ville, code_postal);
    if (!geo) return res.status(404).json({ error: 'Adresse non trouvée par le géocodeur' });

    await pool.query(
      `UPDATE association_points SET latitude = $1, longitude = $2, geom = ST_SetSRID(ST_MakePoint($2, $1), 4326), updated_at = NOW() WHERE id = $3`,
      [geo.latitude, geo.longitude, req.params.id]
    );
    res.json({ latitude: geo.latitude, longitude: geo.longitude, label: geo.label });
  } catch (err) {
    res.status(500).json({ error: 'Erreur de géocodage' });
  }
});

module.exports = router;
