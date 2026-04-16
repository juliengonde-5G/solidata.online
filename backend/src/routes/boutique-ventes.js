const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { autoLogActivity } = require('../middleware/activity-logger');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const uploadDir = path.join(__dirname, '../../uploads/boutique-csv');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const safeName = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `btq-${Date.now()}-${safeName}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

router.use(authenticate);
router.use(autoLogActivity('boutique_vente'));

// ══════════════════════════════════════════
// Mapping rayon → segment (ventes_courantes / promotions / consommables)
// ══════════════════════════════════════════
const RAYON_TO_SEGMENT = {
  'FEMME': 'ventes_courantes',
  'ENFANTS': 'ventes_courantes',
  'LAYETTES': 'ventes_courantes',
  'KINTSU': 'ventes_courantes',
  'BRADERIE': 'promotions',
  'OPERATION': 'promotions',
  'PRIX RONDS': 'promotions',
  'SAC KRAFT': 'consommables',
};

function getSegment(rayon) {
  return RAYON_TO_SEGMENT[rayon?.toUpperCase()?.trim()] || 'ventes_courantes';
}

// Parse une date au format "DD/MM/YYYY HH:MM:SS"
function parseCSVDate(str) {
  const m = str?.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  return new Date(`${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6]}`);
}

function minuteKey(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// Core CSV import function (reusable by manual upload + scheduler)
// Returns { batch_id, nb_lignes_total, nb_lignes_importees, nb_lignes_erreur, nb_tickets, ca_total_ttc }
async function importCSVContent(boutiqueId, content, filename, userId = null, source = 'manuel') {
  const fileHash = crypto.createHash('sha256').update(content).digest('hex');

  const existing = await pool.query(
    'SELECT id FROM boutique_import_batches WHERE file_hash = $1 LIMIT 1',
    [fileHash]
  );
  if (existing.rows.length > 0) {
    return {
      duplicate: true,
      batch_id: existing.rows[0].id,
      message: 'Ce fichier a déjà été importé (hash identique).'
    };
  }

  const batchRes = await pool.query(
    `INSERT INTO boutique_import_batches
     (boutique_id, filename, file_hash, statut, source, imported_by)
     VALUES ($1, $2, $3, 'en_cours', $4, $5) RETURNING id`,
    [boutiqueId, filename, fileHash, source, userId]
  );
  const batchId = batchRes.rows[0].id;

  const lines = content.split(/\r?\n/).filter(l => l.trim());
  let header = lines.shift();
  const expected = 'Rayon;Date;ID Article;Article;Quantite;Prix U. TTC;Total HT;Total TTC;Montant TVA;Taux TVA';
  if (!header || !header.startsWith('Rayon;')) {
    // Header manquant : on remet la première ligne dans le tableau et on continue
    lines.unshift(header);
  }

  let nbTotal = lines.length;
  let nbImport = 0;
  let nbErreur = 0;
  let caTotal = 0;
  let dateDebut = null;
  let dateFin = null;
  const erreurs = [];
  const ticketsMap = new Map(); // minute_key → { total_ttc, total_ht, nb_articles, date_ticket }
  const ventesBuffer = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const parts = line.split(';');
    if (parts.length < 10) {
      nbErreur++;
      erreurs.push({ line: i + 2, error: 'Colonnes manquantes' });
      continue;
    }
    try {
      const rayon = parts[0].trim();
      const dateVente = parseCSVDate(parts[1].trim());
      if (!dateVente) throw new Error('Date invalide');
      const idArticle = parts[2] ? parseInt(parts[2]) : null;
      const article = parts[3].trim();
      const quantite = parseInt(parts[4]) || 1;
      const prixU = parseFloat(parts[5].replace(',', '.')) || 0;
      const totalHT = parseFloat(parts[6].replace(',', '.')) || 0;
      const totalTTC = parseFloat(parts[7].replace(',', '.')) || 0;
      const montantTVA = parseFloat(parts[8].replace(',', '.')) || 0;
      const tauxTVA = parseFloat(parts[9].replace(',', '.')) || 0;
      const segment = getSegment(rayon);

      const mk = minuteKey(dateVente);
      if (!ticketsMap.has(mk)) {
        ticketsMap.set(mk, { total_ttc: 0, total_ht: 0, nb_articles: 0, date_ticket: dateVente });
      }
      const tk = ticketsMap.get(mk);
      tk.total_ttc += totalTTC;
      tk.total_ht += totalHT;
      tk.nb_articles += quantite;

      ventesBuffer.push({
        mk, rayon, segment, idArticle, article, quantite, prixU, totalHT, totalTTC, montantTVA, tauxTVA, dateVente
      });

      nbImport++;
      caTotal += totalTTC;
      const d = dateVente.toISOString().slice(0, 10);
      if (!dateDebut || d < dateDebut) dateDebut = d;
      if (!dateFin || d > dateFin) dateFin = d;
    } catch (e) {
      nbErreur++;
      erreurs.push({ line: i + 2, error: e.message });
    }
  }

  // UPSERT tickets puis mapping minute_key → ticket_id
  const ticketIdByKey = new Map();
  for (const [mk, tk] of ticketsMap.entries()) {
    const r = await pool.query(`
      INSERT INTO boutique_tickets (boutique_id, date_ticket, minute_key, nb_articles, total_ttc, total_ht, batch_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (boutique_id, minute_key) DO UPDATE SET
        nb_articles = boutique_tickets.nb_articles + EXCLUDED.nb_articles,
        total_ttc = boutique_tickets.total_ttc + EXCLUDED.total_ttc,
        total_ht = boutique_tickets.total_ht + EXCLUDED.total_ht
      RETURNING id
    `, [boutiqueId, tk.date_ticket, mk, tk.nb_articles, tk.total_ttc, tk.total_ht, batchId]);
    ticketIdByKey.set(mk, r.rows[0].id);
  }

  // Insertion des ventes (bulk, par paquets de 500 pour éviter timeouts)
  const CHUNK = 500;
  for (let i = 0; i < ventesBuffer.length; i += CHUNK) {
    const chunk = ventesBuffer.slice(i, i + CHUNK);
    const values = [];
    const params = [];
    let idx = 1;
    for (const v of chunk) {
      values.push(`($${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++})`);
      params.push(
        boutiqueId, batchId, ticketIdByKey.get(v.mk) || null,
        v.dateVente, v.rayon, v.segment, v.idArticle, v.article,
        v.quantite, v.prixU, v.totalHT, v.totalTTC, v.montantTVA, v.tauxTVA
      );
    }
    await pool.query(`
      INSERT INTO boutique_ventes
        (boutique_id, batch_id, ticket_id, date_vente, rayon, segment, id_article, article,
         quantite, prix_unitaire_ttc, total_ht, total_ttc, montant_tva, taux_tva)
      VALUES ${values.join(',')}
    `, params);
  }

  const statutFinal = nbErreur > 0 && nbImport === 0 ? 'erreur' : 'termine';
  await pool.query(`
    UPDATE boutique_import_batches SET
      date_debut = $1, date_fin = $2,
      nb_lignes_total = $3, nb_lignes_importees = $4, nb_lignes_erreur = $5,
      nb_tickets_reconstitues = $6, ca_total_ttc = $7, statut = $8, erreurs = $9
    WHERE id = $10
  `, [
    dateDebut, dateFin, nbTotal, nbImport, nbErreur,
    ticketsMap.size, caTotal.toFixed(2), statutFinal,
    erreurs.length > 0 ? JSON.stringify(erreurs.slice(0, 100)) : null,
    batchId
  ]);

  return {
    batch_id: batchId,
    nb_lignes_total: nbTotal,
    nb_lignes_importees: nbImport,
    nb_lignes_erreur: nbErreur,
    nb_tickets: ticketsMap.size,
    ca_total_ttc: caTotal,
    duplicate: false,
  };
}

// POST /api/boutique-ventes/import — upload CSV manuel
router.post('/import',
  authorize('ADMIN', 'MANAGER'),
  upload.single('file'),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'Fichier CSV requis' });
      const boutiqueId = parseInt(req.body.boutique_id);
      if (!boutiqueId) return res.status(400).json({ error: 'boutique_id requis' });

      const content = fs.readFileSync(req.file.path, 'utf-8');
      const result = await importCSVContent(boutiqueId, content, req.file.originalname, req.user.id, 'manuel');
      fs.unlinkSync(req.file.path);
      res.json(result);
    } catch (err) {
      console.error('[boutique-ventes] import:', err);
      if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      res.status(500).json({ error: 'Erreur import CSV', details: err.message });
    }
  }
);

// GET /api/boutique-ventes/batches
router.get('/batches', async (req, res) => {
  try {
    const { boutique_id } = req.query;
    let query = `
      SELECT b.*, u.first_name || ' ' || u.last_name AS imported_by_name,
             bo.nom AS boutique_nom
      FROM boutique_import_batches b
      LEFT JOIN users u ON b.imported_by = u.id
      LEFT JOIN boutiques bo ON b.boutique_id = bo.id
      WHERE 1=1
    `;
    const params = [];
    if (boutique_id) {
      params.push(boutique_id);
      query += ` AND b.boutique_id = $${params.length}`;
    }
    query += ' ORDER BY b.created_at DESC LIMIT 100';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[boutique-ventes] GET /batches:', err);
    res.status(500).json({ error: 'Erreur chargement batches' });
  }
});

// GET /api/boutique-ventes/batches/:id
router.get('/batches/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM boutique_import_batches WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Batch introuvable' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erreur' });
  }
});

// DELETE /api/boutique-ventes/batches/:id — supprime le batch et ses ventes (cascade)
router.delete('/batches/:id',
  authorize('ADMIN', 'MANAGER'),
  async (req, res) => {
    try {
      await pool.query('DELETE FROM boutique_import_batches WHERE id = $1', [req.params.id]);
      res.json({ success: true });
    } catch (err) {
      console.error('[boutique-ventes] DELETE batch:', err);
      res.status(500).json({ error: 'Erreur suppression' });
    }
  }
);

// GET /api/boutique-ventes — liste paginée des ventes
router.get('/', async (req, res) => {
  try {
    const { boutique_id, date_from, date_to, rayon, segment, limit = 200, offset = 0 } = req.query;
    let query = 'SELECT * FROM boutique_ventes WHERE 1=1';
    const params = [];
    if (boutique_id) { params.push(boutique_id); query += ` AND boutique_id = $${params.length}`; }
    if (date_from) { params.push(date_from); query += ` AND date_vente >= $${params.length}`; }
    if (date_to) { params.push(date_to + ' 23:59:59'); query += ` AND date_vente <= $${params.length}`; }
    if (rayon) { params.push(rayon); query += ` AND rayon = $${params.length}`; }
    if (segment) { params.push(segment); query += ` AND segment = $${params.length}`; }
    params.push(parseInt(limit));
    params.push(parseInt(offset));
    query += ` ORDER BY date_vente DESC LIMIT $${params.length - 1} OFFSET $${params.length}`;
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[boutique-ventes] GET /:', err);
    res.status(500).json({ error: 'Erreur chargement ventes' });
  }
});

// GET /api/boutique-ventes/analytics/daily — CA quotidien
router.get('/analytics/daily', async (req, res) => {
  try {
    const { boutique_id, date_from, date_to } = req.query;
    if (!boutique_id) return res.status(400).json({ error: 'boutique_id requis' });
    const result = await pool.query(`
      SELECT DATE(date_vente) AS jour,
             COALESCE(SUM(total_ttc), 0)::FLOAT AS ca_ttc,
             COALESCE(SUM(total_ht), 0)::FLOAT AS ca_ht,
             COUNT(*)::INT AS nb_lignes,
             COUNT(DISTINCT ticket_id)::INT AS nb_tickets,
             COALESCE(SUM(quantite), 0)::INT AS nb_articles
      FROM boutique_ventes
      WHERE boutique_id = $1
        AND ($2::DATE IS NULL OR DATE(date_vente) >= $2::DATE)
        AND ($3::DATE IS NULL OR DATE(date_vente) <= $3::DATE)
      GROUP BY DATE(date_vente)
      ORDER BY jour
    `, [boutique_id, date_from || null, date_to || null]);
    res.json(result.rows);
  } catch (err) {
    console.error('[boutique-ventes] analytics/daily:', err);
    res.status(500).json({ error: 'Erreur analytics' });
  }
});

// GET /api/boutique-ventes/analytics/monthly
router.get('/analytics/monthly', async (req, res) => {
  try {
    const { boutique_id, annee } = req.query;
    if (!boutique_id) return res.status(400).json({ error: 'boutique_id requis' });
    const year = annee || new Date().getFullYear();
    const result = await pool.query(`
      SELECT EXTRACT(MONTH FROM date_vente)::INT AS mois,
             COALESCE(SUM(total_ttc), 0)::FLOAT AS ca_ttc,
             COUNT(DISTINCT ticket_id)::INT AS nb_tickets,
             COALESCE(SUM(quantite), 0)::INT AS nb_articles,
             CASE WHEN COUNT(DISTINCT ticket_id) > 0
                  THEN (SUM(total_ttc) / COUNT(DISTINCT ticket_id))::FLOAT
                  ELSE 0 END AS panier_moyen
      FROM boutique_ventes
      WHERE boutique_id = $1 AND EXTRACT(YEAR FROM date_vente) = $2
      GROUP BY mois
      ORDER BY mois
    `, [boutique_id, year]);
    res.json(result.rows);
  } catch (err) {
    console.error('[boutique-ventes] analytics/monthly:', err);
    res.status(500).json({ error: 'Erreur analytics' });
  }
});

// GET /api/boutique-ventes/analytics/rayons
router.get('/analytics/rayons', async (req, res) => {
  try {
    const { boutique_id, date_from, date_to } = req.query;
    if (!boutique_id) return res.status(400).json({ error: 'boutique_id requis' });
    const result = await pool.query(`
      SELECT rayon, segment,
             COALESCE(SUM(total_ttc), 0)::FLOAT AS ca_ttc,
             COUNT(*)::INT AS nb_lignes,
             COALESCE(SUM(quantite), 0)::INT AS nb_articles
      FROM boutique_ventes
      WHERE boutique_id = $1
        AND ($2::DATE IS NULL OR DATE(date_vente) >= $2::DATE)
        AND ($3::DATE IS NULL OR DATE(date_vente) <= $3::DATE)
      GROUP BY rayon, segment
      ORDER BY ca_ttc DESC
    `, [boutique_id, date_from || null, date_to || null]);
    res.json(result.rows);
  } catch (err) {
    console.error('[boutique-ventes] analytics/rayons:', err);
    res.status(500).json({ error: 'Erreur analytics' });
  }
});

// GET /api/boutique-ventes/analytics/segments
router.get('/analytics/segments', async (req, res) => {
  try {
    const { boutique_id, date_from, date_to } = req.query;
    if (!boutique_id) return res.status(400).json({ error: 'boutique_id requis' });
    const result = await pool.query(`
      SELECT segment,
             COALESCE(SUM(total_ttc), 0)::FLOAT AS ca_ttc,
             COUNT(*)::INT AS nb_lignes,
             COALESCE(SUM(quantite), 0)::INT AS nb_articles
      FROM boutique_ventes
      WHERE boutique_id = $1
        AND ($2::DATE IS NULL OR DATE(date_vente) >= $2::DATE)
        AND ($3::DATE IS NULL OR DATE(date_vente) <= $3::DATE)
      GROUP BY segment
      ORDER BY ca_ttc DESC
    `, [boutique_id, date_from || null, date_to || null]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erreur analytics' });
  }
});

// GET /api/boutique-ventes/analytics/articles — top articles
router.get('/analytics/articles', async (req, res) => {
  try {
    const { boutique_id, date_from, date_to, limit = 20 } = req.query;
    if (!boutique_id) return res.status(400).json({ error: 'boutique_id requis' });
    const result = await pool.query(`
      SELECT article, rayon,
             COALESCE(SUM(total_ttc), 0)::FLOAT AS ca_ttc,
             COALESCE(SUM(quantite), 0)::INT AS nb_articles,
             CASE WHEN SUM(quantite) > 0
                  THEN (SUM(total_ttc) / SUM(quantite))::FLOAT
                  ELSE 0 END AS prix_moyen
      FROM boutique_ventes
      WHERE boutique_id = $1
        AND ($2::DATE IS NULL OR DATE(date_vente) >= $2::DATE)
        AND ($3::DATE IS NULL OR DATE(date_vente) <= $3::DATE)
      GROUP BY article, rayon
      ORDER BY ca_ttc DESC
      LIMIT $4
    `, [boutique_id, date_from || null, date_to || null, parseInt(limit)]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erreur analytics' });
  }
});

// GET /api/boutique-ventes/analytics/panier-moyen — évolution quotidienne
router.get('/analytics/panier-moyen', async (req, res) => {
  try {
    const { boutique_id, date_from, date_to } = req.query;
    if (!boutique_id) return res.status(400).json({ error: 'boutique_id requis' });
    const result = await pool.query(`
      SELECT DATE(date_ticket) AS jour,
             COUNT(*)::INT AS nb_tickets,
             COALESCE(AVG(total_ttc), 0)::FLOAT AS panier_moyen_ttc,
             COALESCE(SUM(total_ttc), 0)::FLOAT AS ca_ttc
      FROM boutique_tickets
      WHERE boutique_id = $1
        AND ($2::DATE IS NULL OR DATE(date_ticket) >= $2::DATE)
        AND ($3::DATE IS NULL OR DATE(date_ticket) <= $3::DATE)
      GROUP BY DATE(date_ticket)
      ORDER BY jour
    `, [boutique_id, date_from || null, date_to || null]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erreur analytics' });
  }
});

// GET /api/boutique-ventes/tickets — tickets reconstitués
router.get('/tickets', async (req, res) => {
  try {
    const { boutique_id, date } = req.query;
    if (!boutique_id) return res.status(400).json({ error: 'boutique_id requis' });
    let query = `
      SELECT t.*,
             json_agg(json_build_object(
               'article', v.article, 'rayon', v.rayon,
               'quantite', v.quantite, 'total_ttc', v.total_ttc
             ) ORDER BY v.date_vente) AS lignes
      FROM boutique_tickets t
      LEFT JOIN boutique_ventes v ON v.ticket_id = t.id
      WHERE t.boutique_id = $1
    `;
    const params = [boutique_id];
    if (date) {
      params.push(date);
      query += ` AND DATE(t.date_ticket) = $${params.length}`;
    }
    query += ' GROUP BY t.id ORDER BY t.date_ticket DESC LIMIT 500';
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('[boutique-ventes] tickets:', err);
    res.status(500).json({ error: 'Erreur tickets' });
  }
});

module.exports = router;
module.exports.importCSVContent = importCSVContent;
