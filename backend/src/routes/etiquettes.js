const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { formatId, parseId } = require('../utils/base24');

router.use(authenticate);

const BTQ_ACTIVE_STATUTS = ['envoyee', 'ajustee', 'en_preparation'];
const VAK_ACTIVE_STATUTS = ['confirmee', 'en_preparation', 'chargee'];

router.get('/postes', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, numero_poste, nom, compteur_actuel, is_active, derniere_etiquette_at
       FROM postes_etiquetage WHERE is_active = true ORDER BY numero_poste`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/options', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, nom, categorie_eco_org, genre, saison, gamme
       FROM produits_catalogue WHERE is_active = true
       ORDER BY categorie_eco_org, nom`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/generer', authorize('ADMIN', 'MANAGER', 'COLLABORATEUR'), async (req, res) => {
  const { poste_id, catalogue_id, poids_kg } = req.body || {};
  if (!poste_id || !catalogue_id || !poids_kg || Number(poids_kg) <= 0) {
    return res.status(400).json({ error: 'poste_id, catalogue_id et poids_kg (>0) requis' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const poste = await client.query(
      `SELECT id, numero_poste, compteur_actuel FROM postes_etiquetage WHERE id = $1 AND is_active = true FOR UPDATE`,
      [poste_id]
    );
    if (poste.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Poste introuvable ou inactif' });
    }
    const cat = await client.query(
      `SELECT nom, categorie_eco_org, genre, saison, gamme
       FROM produits_catalogue WHERE id = $1 AND is_active = true`,
      [catalogue_id]
    );
    if (cat.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Produit catalogue introuvable' });
    }

    const newCounter = poste.rows[0].compteur_actuel + 1;
    let code_barre;
    try {
      code_barre = formatId(newCounter, poste.rows[0].numero_poste);
    } catch (e) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `Compteur poste saturé : ${e.message}` });
    }

    const c = cat.rows[0];
    const dateFab = new Date();
    const insert = await client.query(
      `INSERT INTO produits_finis
         (code_barre, catalogue_id, produit, categorie_eco_org, genre, saison, gamme,
          poids_kg, date_fabrication, poste_etiquetage_id, status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'en_stock', $11)
       RETURNING id, code_barre, poids_kg, date_fabrication, produit, categorie_eco_org, genre, saison, gamme`,
      [code_barre, catalogue_id, c.nom, c.categorie_eco_org, c.genre, c.saison, c.gamme,
        Number(poids_kg), dateFab, poste_id, req.user.id]
    );

    await client.query(
      `UPDATE postes_etiquetage SET compteur_actuel = $1, derniere_etiquette_at = NOW() WHERE id = $2`,
      [newCounter, poste_id]
    );

    await client.query('COMMIT');
    res.status(201).json({
      ...insert.rows[0],
      poste_label: `Poste ${poste.rows[0].numero_poste}`,
      poste_etiquetage_id: poste_id,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return res.status(409).json({ error: 'code_barre déjà existant', code: 'DUPLICATE' });
    }
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.post('/sortie-scan', authorize('ADMIN', 'MANAGER', 'COLLABORATEUR'), async (req, res) => {
  const { code_barre, commande_type, commande_id } = req.body || {};
  if (!code_barre || !commande_type) {
    return res.status(400).json({ error: 'code_barre et commande_type requis' });
  }
  if (!['btq', 'vak', 'libre'].includes(commande_type)) {
    return res.status(400).json({ error: 'commande_type doit être btq, vak ou libre' });
  }
  if (commande_type !== 'libre' && !commande_id) {
    return res.status(400).json({ error: 'commande_id requis pour ce type' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const carton = await client.query(
      `SELECT id, code_barre, status, date_sortie, poids_kg, produit, categorie_eco_org, genre, gamme
       FROM produits_finis WHERE code_barre = $1 FOR UPDATE`,
      [code_barre]
    );
    if (carton.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Code-barre inconnu', code: 'NOT_FOUND', code_barre });
    }
    const c = carton.rows[0];
    if (c.status !== 'en_stock' || c.date_sortie) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Carton déjà sorti', code: 'ALREADY_OUT', carton: c });
    }

    let cmdRow = null;
    if (commande_type === 'btq') {
      cmdRow = await client.query(
        `SELECT id, reference, statut FROM boutique_commandes WHERE id = $1`,
        [commande_id]
      );
      if (cmdRow.rowCount === 0 || !BTQ_ACTIVE_STATUTS.includes(cmdRow.rows[0].statut)) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Commande BTQ inactive ou introuvable', code: 'COMMANDE_FERMEE' });
      }
    } else if (commande_type === 'vak') {
      cmdRow = await client.query(
        `SELECT id, reference, statut FROM commandes_exutoires WHERE id = $1`,
        [commande_id]
      );
      if (cmdRow.rowCount === 0 || !VAK_ACTIVE_STATUTS.includes(cmdRow.rows[0].statut)) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Commande VAK inactive ou introuvable', code: 'COMMANDE_FERMEE' });
      }
    }

    const updated = await client.query(
      `UPDATE produits_finis SET
         date_sortie = NOW(), status = 'expedie',
         sortie_commande_type = $1, sortie_commande_id = $2, scanned_by = $3
       WHERE id = $4
       RETURNING id, code_barre, produit, categorie_eco_org, genre, gamme, poids_kg, date_sortie`,
      [commande_type, commande_type === 'libre' ? null : commande_id, req.user.id, c.id]
    );

    await client.query('COMMIT');
    res.json({
      carton: updated.rows[0],
      commande: cmdRow ? cmdRow.rows[0] : null,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

router.get('/sortie-session/:type/:commande_id', async (req, res) => {
  const { type, commande_id } = req.params;
  if (!['btq', 'vak'].includes(type)) {
    return res.status(400).json({ error: 'type doit être btq ou vak' });
  }
  // mode 'libre' n'a pas de session persistante côté backend (pas de commande)
  try {
    const { rows } = await pool.query(
      `SELECT id, code_barre, produit, categorie_eco_org, genre, gamme, poids_kg, date_sortie, scanned_by
       FROM produits_finis
       WHERE sortie_commande_type = $1 AND sortie_commande_id = $2
       ORDER BY date_sortie DESC`,
      [type, commande_id]
    );
    const total_kg = rows.reduce((s, r) => s + Number(r.poids_kg || 0), 0);
    res.json({ items: rows, count: rows.length, total_kg });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/sortie-session/:type/:commande_id/annuler-scan', authorize('ADMIN', 'MANAGER', 'COLLABORATEUR'), async (req, res) => {
  const { type, commande_id } = req.params;
  const { code_barre } = req.body || {};
  if (!code_barre) return res.status(400).json({ error: 'code_barre requis' });
  if (!['btq', 'vak'].includes(type)) {
    return res.status(400).json({ error: 'type doit être btq ou vak' });
  }
  try {
    const result = await pool.query(
      `UPDATE produits_finis SET
         date_sortie = NULL, status = 'en_stock',
         sortie_commande_type = NULL, sortie_commande_id = NULL, scanned_by = NULL
       WHERE code_barre = $1 AND sortie_commande_type = $2 AND sortie_commande_id = $3
       RETURNING id, code_barre`,
      [code_barre, type, commande_id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Scan introuvable pour cette commande' });
    }
    res.json({ ok: true, carton: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/commandes-actives/:type', async (req, res) => {
  const { type } = req.params;
  try {
    if (type === 'btq') {
      const { rows } = await pool.query(
        `SELECT bc.id, bc.reference, bc.statut, bc.date_commande, b.nom AS label
         FROM boutique_commandes bc LEFT JOIN boutiques b ON b.id = bc.boutique_id
         WHERE bc.statut = ANY($1::varchar[])
         ORDER BY bc.date_commande DESC LIMIT 50`,
        [BTQ_ACTIVE_STATUTS]
      );
      return res.json(rows);
    }
    if (type === 'vak') {
      const { rows } = await pool.query(
        `SELECT ce.id, ce.reference, ce.statut, ce.date_commande,
                COALESCE(cl.raison_sociale, ce.reference) AS label
         FROM commandes_exutoires ce LEFT JOIN clients_exutoires cl ON cl.id = ce.client_id
         WHERE ce.statut = ANY($1::varchar[])
         ORDER BY ce.date_commande DESC LIMIT 50`,
        [VAK_ACTIVE_STATUTS]
      );
      return res.json(rows);
    }
    res.status(400).json({ error: 'type doit être btq ou vak' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
