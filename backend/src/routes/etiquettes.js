const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { formatId, parseId } = require('../utils/base24');

router.use(authenticate);

const BTQ_ACTIVE_STATUTS = ['envoyee', 'ajustee', 'en_preparation'];
const VAK_ACTIVE_STATUTS = ['confirmee', 'en_preparation', 'chargee'];

// ══════════════════════════════════════════
// Générateur de produit fini — SOURCE UNIQUE (item 32)
// Réutilisé par la voie « étiquette » (/generer) ET la voie « manuel »
// (routes/produits-finis.js) pour garantir des champs et un code-barres
// GÉNÉRÉ identiques (base24 + compteur de poste), avec created_by et source
// systématiques. Doit être appelé à l'intérieur d'une transaction (client).
// Lève une erreur enrichie { pfStatus, pfCode } que l'appelant traduit en HTTP.
// L'ordre des requêtes est stable (poste → [lot] → catalogue → insert → compteur)
// et couvert par les tests existants d'etiquettes.
// ══════════════════════════════════════════
async function generateProduitFini(client, {
  poste_id, produit, categorie_eco_org, genre, saison, gamme, poids_kg,
  batch_id, created_by, source = 'etiquette',
}) {
  const poste = await client.query(
    `SELECT id, numero_poste, compteur_actuel FROM postes_etiquetage WHERE id = $1 AND is_active = true FOR UPDATE`,
    [poste_id]
  );
  if (poste.rowCount === 0) {
    const e = new Error('Poste introuvable ou inactif'); e.pfStatus = 404; throw e;
  }

  // Traçabilité carton → lot (optionnel) : uniquement un lot ouvert.
  let linkedBatchId = null;
  if (batch_id !== undefined && batch_id !== null && batch_id !== '') {
    const batch = await client.query(
      `SELECT id FROM batch_tracking WHERE id = $1 AND status IN ('en_attente', 'en_cours')`,
      [batch_id]
    );
    if (batch.rowCount === 0) {
      const e = new Error('Lot introuvable ou déjà clôturé (batch_id)'); e.pfStatus = 400; throw e;
    }
    linkedBatchId = batch.rows[0].id;
  }

  let catRow = await client.query(
    `SELECT id FROM produits_catalogue
     WHERE nom = $1 AND categorie_eco_org = $2 AND genre = $3 AND saison = $4 AND gamme = $5
     LIMIT 1`,
    [produit, categorie_eco_org, genre, saison, gamme]
  );
  let catalogue_id;
  if (catRow.rowCount > 0) {
    catalogue_id = catRow.rows[0].id;
  } else {
    const ins = await client.query(
      `INSERT INTO produits_catalogue (nom, categorie_eco_org, genre, saison, gamme, is_active)
       VALUES ($1, $2, $3, $4, $5, true) RETURNING id`,
      [produit, categorie_eco_org, genre, saison, gamme]
    );
    catalogue_id = ins.rows[0].id;
  }

  const newCounter = poste.rows[0].compteur_actuel + 1;
  let code_barre;
  try {
    code_barre = formatId(newCounter, poste.rows[0].numero_poste);
  } catch (e2) {
    const e = new Error(`Compteur poste saturé : ${e2.message}`); e.pfStatus = 409; throw e;
  }

  const dateFab = new Date();
  const insert = await client.query(
    `INSERT INTO produits_finis
       (code_barre, catalogue_id, produit, categorie_eco_org, genre, saison, gamme,
        poids_kg, date_fabrication, poste_etiquetage_id, status, batch_id, created_by, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'en_stock', $11, $12, $13)
     RETURNING id, code_barre, poids_kg, date_fabrication, produit, categorie_eco_org, genre, saison, gamme, batch_id, source`,
    [code_barre, catalogue_id, produit, categorie_eco_org, genre, saison, gamme,
      Number(poids_kg), dateFab, poste_id, linkedBatchId, created_by, source]
  );

  await client.query(
    `UPDATE postes_etiquetage SET compteur_actuel = $1, derniere_etiquette_at = NOW() WHERE id = $2`,
    [newCounter, poste_id]
  );

  return {
    row: insert.rows[0],
    poste_label: `Poste ${poste.rows[0].numero_poste}`,
    numero_poste: poste.rows[0].numero_poste,
  };
}

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
      `SELECT MIN(id) AS id, nom, categorie_eco_org
       FROM produits_catalogue WHERE is_active = true
       GROUP BY nom, categorie_eco_org
       ORDER BY categorie_eco_org, nom`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Lots ouverts (en_attente/en_cours) pour le sélecteur d'étiquetage — exposé ici
// (routeur étiquettes, accessible COLLABORATEUR) plutôt que via /tri/batches
// (réservé ADMIN/MANAGER) pour que l'opérateur du poste puisse rattacher le lot.
router.get('/lots-actifs', authorize('ADMIN', 'MANAGER', 'COLLABORATEUR'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT bt.id, bt.code, bt.status, ct.nom AS chaine_nom
       FROM batch_tracking bt
       LEFT JOIN chaines_tri ct ON bt.chaine_id = ct.id
       WHERE bt.status IN ('en_attente', 'en_cours')
       ORDER BY bt.created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/dimensions', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, type, valeur, ordre FROM ref_dimensions
       WHERE is_active = true ORDER BY type, ordre, valeur`
    );
    const out = { categorie_eco_org: [], genre: [], saison: [], gamme: [] };
    for (const r of rows) if (out[r.type]) out[r.type].push(r.valeur);
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/generer', authorize('ADMIN', 'MANAGER', 'COLLABORATEUR'), async (req, res) => {
  const { poste_id, produit, categorie_eco_org, genre, saison, gamme, poids_kg, batch_id } = req.body || {};
  if (!poste_id || !produit || !categorie_eco_org || !genre || !saison || !gamme || !poids_kg || Number(poids_kg) <= 0) {
    return res.status(400).json({ error: 'poste_id, produit, categorie_eco_org, genre, saison, gamme et poids_kg (>0) requis' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { row, poste_label } = await generateProduitFini(client, {
      poste_id, produit, categorie_eco_org, genre, saison, gamme, poids_kg,
      batch_id, created_by: req.user.id, source: 'etiquette',
    });
    await client.query('COMMIT');
    res.status(201).json({ ...row, poste_label, poste_etiquetage_id: poste_id });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.pfStatus) {
      return res.status(err.pfStatus).json({ error: err.message, ...(err.pfCode ? { code: err.pfCode } : {}) });
    }
    if (err.code === '23505') {
      return res.status(409).json({ error: 'code_barre déjà existant', code: 'DUPLICATE' });
    }
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

// === Admin catalogue ===
router.get('/admin/produits', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT MIN(id) AS id, nom, categorie_eco_org, bool_or(is_active) AS is_active
       FROM produits_catalogue
       GROUP BY nom, categorie_eco_org
       ORDER BY categorie_eco_org, nom`
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/admin/produits', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  const { nom, categorie_eco_org } = req.body || {};
  if (!nom || !categorie_eco_org) return res.status(400).json({ error: 'nom et categorie_eco_org requis' });
  try {
    const r = await pool.query(
      `INSERT INTO produits_catalogue (nom, categorie_eco_org, genre, saison, gamme, is_active)
       VALUES ($1, $2, 'Sans Genre', 'Sans Saison', 'VAK', true)
       ON CONFLICT DO NOTHING
       RETURNING id, nom, categorie_eco_org`,
      [nom.trim(), categorie_eco_org.trim()]
    );
    res.status(201).json(r.rows[0] || { ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/admin/produits', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  const { nom, categorie_eco_org, is_active } = req.body || {};
  if (!nom || !categorie_eco_org || typeof is_active !== 'boolean') {
    return res.status(400).json({ error: 'nom, categorie_eco_org, is_active (boolean) requis' });
  }
  try {
    const r = await pool.query(
      `UPDATE produits_catalogue SET is_active = $1
       WHERE nom = $2 AND categorie_eco_org = $3 RETURNING count(*) OVER ()`,
      [is_active, nom, categorie_eco_org]
    );
    res.json({ updated: r.rowCount });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/admin/dimensions', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, type, valeur, ordre, is_active FROM ref_dimensions ORDER BY type, ordre, valeur`
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/admin/dimensions', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  const { type, valeur, ordre } = req.body || {};
  if (!type || !valeur) return res.status(400).json({ error: 'type et valeur requis' });
  if (!['categorie_eco_org', 'genre', 'saison', 'gamme'].includes(type)) {
    return res.status(400).json({ error: 'type invalide' });
  }
  try {
    const r = await pool.query(
      `INSERT INTO ref_dimensions (type, valeur, ordre) VALUES ($1, $2, $3)
       ON CONFLICT (type, valeur) DO UPDATE SET is_active = true
       RETURNING id, type, valeur, ordre, is_active`,
      [type, valeur.trim(), ordre || 100]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.patch('/admin/dimensions/:id', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  const { id } = req.params;
  const { is_active, ordre, valeur } = req.body || {};
  const sets = []; const vals = [];
  if (typeof is_active === 'boolean') { sets.push(`is_active = $${sets.length + 1}`); vals.push(is_active); }
  if (Number.isFinite(ordre)) { sets.push(`ordre = $${sets.length + 1}`); vals.push(ordre); }
  if (valeur && typeof valeur === 'string') { sets.push(`valeur = $${sets.length + 1}`); vals.push(valeur.trim()); }
  if (sets.length === 0) return res.status(400).json({ error: 'Aucun champ à modifier' });
  vals.push(id);
  try {
    const r = await pool.query(
      `UPDATE ref_dimensions SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`,
      vals
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Dimension introuvable' });
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
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

    // Item 31a : la sortie carton DÉCRÉMENTE le stock moderne — UNIQUEMENT pour
    // les sorties LIBRES (sans commande), le seul flux qui n'avait AUCUNE
    // écriture de sortie. Les flux btq/vak ont déjà leur décrément canonique en
    // aval — boutique-commandes.js (passage « expediee » : sortie du poids des
    // lignes) et preparations.js (mouvement 'EXU-'+référence à l'expédition,
    // corrigé ensuite par controles-pesee sur la pesée client ; chemin désormais
    // OBLIGATOIRE via la garde stock de commandes-exutoires, item 38b). Écrire
    // aussi une sortie par carton pour btq/vak ferait sortir la même marchandise
    // DEUX FOIS du grand livre (constaté en revue debug Vague 1).
    // Catégorie best-effort : appariement par nom categorie_eco_org ↔
    // categories_sortantes (taxonomies distinctes, pas de FK) ; sinon NULL
    // (« Non classé »), ce qui corrige au moins le total global.
    if (commande_type === 'libre') {
      const catMatch = await client.query(
        `SELECT id FROM categories_sortantes WHERE lower(nom) = lower($1) AND is_active = true LIMIT 1`,
        [c.categorie_eco_org]
      );
      const matiereId = catMatch.rows[0]?.id || null;
      await client.query(
        `INSERT INTO stock_movements
           (type, date, poids_kg, matiere_id, code_barre, origine, notes, produit_fini_id, created_by)
         VALUES ('sortie', CURRENT_DATE, $1, $2, $3, 'sortie_carton', $4, $5, $6)`,
        [c.poids_kg, matiereId, c.code_barre,
         `Sortie carton ${c.code_barre} (${commande_type})`, c.id, req.user.id]
      );
    }

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
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE produits_finis SET
         date_sortie = NULL, status = 'en_stock',
         sortie_commande_type = NULL, sortie_commande_id = NULL, scanned_by = NULL
       WHERE code_barre = $1 AND sortie_commande_type = $2 AND sortie_commande_id = $3
       RETURNING id, code_barre`,
      [code_barre, type, commande_id]
    );
    if (result.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Scan introuvable pour cette commande' });
    }
    // Item 31a : si un mouvement de sortie a été généré lors du scan, on le
    // retire (cohérence du ledger tant que la commande est ouverte). Depuis la
    // revue debug Vague 1, seuls les scans LIBRES écrivent un mouvement — pour
    // btq/vak ce DELETE est un no-op de sécurité (le décrément vit en aval).
    await client.query(
      `DELETE FROM stock_movements WHERE produit_fini_id = $1 AND origine = 'sortie_carton'`,
      [result.rows[0].id]
    );
    await client.query('COMMIT');
    res.json({ ok: true, carton: result.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
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
// Générateur partagé (voie manuelle produits-finis.js) — item 32
module.exports.generateProduitFini = generateProduitFini;
