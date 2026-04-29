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

// Pré-scan rapide du CSV pour extraire la plage de dates couverte (sans
// dérouler toute la logique d'import). Retourne { from: 'YYYY-MM-DD', to: ... }
// ou null si on ne trouve aucune date exploitable.
function extractCSVDateRange(content) {
  let min = null, max = null;
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('Rayon;')) continue;
    const parts = line.split(';');
    // Date est en col 1 (les 2 formats CSV LogicS la placent au même index)
    const d = parseCSVDate(parts[1]?.trim());
    if (!d) continue;
    const iso = d.toISOString().slice(0, 10);
    if (!min || iso < min) min = iso;
    if (!max || iso > max) max = iso;
  }
  if (!min || !max) return null;
  return { from: min, to: max };
}

// Core CSV import function (reusable by manual upload + scheduler)
// Returns { batch_id, nb_lignes_total, nb_lignes_importees, nb_lignes_erreur, nb_tickets, ca_total_ttc }
async function importCSVContent(boutiqueId, content, filename, userId = null, source = 'manuel', { force = false } = {}) {
  const fileHash = crypto.createHash('sha256').update(content).digest('hex');

  const existing = await pool.query(
    'SELECT id FROM boutique_import_batches WHERE file_hash = $1 LIMIT 1',
    [fileHash]
  );
  if (existing.rows.length > 0) {
    return {
      duplicate: true,
      reason: 'file_hash',
      batch_id: existing.rows[0].id,
      message: 'Ce fichier a déjà été importé (hash identique).'
    };
  }

  // Détection doublon métier : pour la même boutique, on cherche l'overlap de la
  // plage de dates couverte. On parse rapidement la 1ère et dernière date du CSV
  // pour comparer aux batches existants. Évite d'importer 2 fois les ventes du
  // même jour (cas Power Automate qui re-déclenche un mail déjà reçu).
  if (!force) {
    const dates = extractCSVDateRange(content);
    if (dates) {
      const overlap = await pool.query(
        `SELECT id, filename, date_debut, date_fin, created_at
           FROM boutique_import_batches
          WHERE boutique_id = $1
            AND statut IN ('termine', 'en_cours')
            AND date_debut IS NOT NULL AND date_fin IS NOT NULL
            AND daterange(date_debut, date_fin, '[]') && daterange($2::date, $3::date, '[]')
          ORDER BY created_at DESC LIMIT 1`,
        [boutiqueId, dates.from, dates.to]
      );
      if (overlap.rows.length > 0) {
        const o = overlap.rows[0];
        return {
          duplicate: true,
          reason: 'date_overlap',
          batch_id: o.id,
          conflict: {
            filename: o.filename,
            date_debut: o.date_debut,
            date_fin: o.date_fin,
            created_at: o.created_at,
          },
          message: `Un import existe déjà pour cette boutique entre ${o.date_debut} et ${o.date_fin} (fichier: ${o.filename}).`,
        };
      }
    }
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
  // Deux formats supportés :
  //  - Ancien (10 col) : Rayon;Date;ID Article;Article;Quantite;Prix U. TTC;Total HT;Total TTC;Montant TVA;Taux TVA
  //  - Nouveau (11 col): Rayon;Date;Num_Ticket;ID Article;Article;Quantite;Prix U. TTC;Total HT;Total TTC;Montant TVA;Taux TVA
  let hasNumTicket = false;
  if (header && header.startsWith('Rayon;')) {
    hasNumTicket = /Num_Ticket/i.test(header);
  } else {
    // Header manquant : autodétection par nombre de colonnes de la 1ère ligne
    if (header) {
      const probe = header.split(';');
      hasNumTicket = probe.length >= 11;
      lines.unshift(header);
    }
  }

  let nbTotal = lines.length;
  let nbImport = 0;
  let nbErreur = 0;
  let caTotal = 0;
  let dateDebut = null;
  let dateFin = null;
  const erreurs = [];
  // Clé de regroupement :
  //   - nouveau format : "T<num_ticket>" (vrai ticket LogicS)
  //   - ancien format  : minute_key "YYYY-MM-DD HH:MM" (reconstruction par minute)
  const ticketsMap = new Map();
  const ventesBuffer = [];
  const minCols = hasNumTicket ? 11 : 10;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const parts = line.split(';');
    if (parts.length < minCols) {
      nbErreur++;
      erreurs.push({ line: i + 2, error: 'Colonnes manquantes' });
      continue;
    }
    try {
      let col = 0;
      const rayon = parts[col++].trim();
      const dateVente = parseCSVDate(parts[col++].trim());
      if (!dateVente) throw new Error('Date invalide');
      let numTicket = null;
      if (hasNumTicket) {
        numTicket = parts[col++].trim();
        if (!numTicket) numTicket = null;
      }
      const idArticle = parts[col] ? parseInt(parts[col]) : null; col++;
      const article = parts[col++].trim();
      const quantite = parseInt(parts[col++]) || 1;
      const prixU = parseFloat(parts[col++].replace(',', '.')) || 0;
      const totalHT = parseFloat(parts[col++].replace(',', '.')) || 0;
      const totalTTC = parseFloat(parts[col++].replace(',', '.')) || 0;
      const montantTVA = parseFloat(parts[col++].replace(',', '.')) || 0;
      const tauxTVA = parseFloat(parts[col++].replace(',', '.')) || 0;
      const segment = getSegment(rayon);

      // Clé de ticket : privilégier le vrai numéro LogicS si disponible
      const mk = numTicket ? `T${numTicket}` : minuteKey(dateVente);
      if (!ticketsMap.has(mk)) {
        ticketsMap.set(mk, {
          total_ttc: 0, total_ht: 0, nb_articles: 0,
          date_ticket: dateVente,      // 1er scan
          date_ticket_max: dateVente,  // dernier scan (durée)
          num_ticket: numTicket,
        });
      }
      const tk = ticketsMap.get(mk);
      tk.total_ttc += totalTTC;
      tk.total_ht += totalHT;
      tk.nb_articles += quantite;
      if (dateVente < tk.date_ticket) tk.date_ticket = dateVente;
      if (dateVente > tk.date_ticket_max) tk.date_ticket_max = dateVente;

      ventesBuffer.push({
        mk, numTicket, rayon, segment, idArticle, article, quantite, prixU,
        totalHT, totalTTC, montantTVA, tauxTVA, dateVente
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

  // UPSERT tickets puis mapping clé → ticket_id
  const ticketIdByKey = new Map();
  for (const [mk, tk] of ticketsMap.entries()) {
    const r = await pool.query(`
      INSERT INTO boutique_tickets (boutique_id, date_ticket, minute_key, num_ticket, nb_articles, total_ttc, total_ht, batch_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (boutique_id, minute_key) DO UPDATE SET
        nb_articles = boutique_tickets.nb_articles + EXCLUDED.nb_articles,
        total_ttc = boutique_tickets.total_ttc + EXCLUDED.total_ttc,
        total_ht = boutique_tickets.total_ht + EXCLUDED.total_ht,
        num_ticket = COALESCE(boutique_tickets.num_ticket, EXCLUDED.num_ticket)
      RETURNING id
    `, [boutiqueId, tk.date_ticket, mk, tk.num_ticket, tk.nb_articles, tk.total_ttc, tk.total_ht, batchId]);
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
      values.push(`($${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++},$${idx++})`);
      params.push(
        boutiqueId, batchId, ticketIdByKey.get(v.mk) || null,
        v.dateVente, v.rayon, v.segment, v.idArticle, v.article,
        v.quantite, v.prixU, v.totalHT, v.totalTTC, v.montantTVA, v.tauxTVA,
        v.numTicket
      );
    }
    await pool.query(`
      INSERT INTO boutique_ventes
        (boutique_id, batch_id, ticket_id, date_vente, rayon, segment, id_article, article,
         quantite, prix_unitaire_ttc, total_ht, total_ttc, montant_tva, taux_tva, num_ticket)
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

      const force = req.body.force === 'true' || req.body.force === '1';
      const content = fs.readFileSync(req.file.path, 'utf-8');
      const result = await importCSVContent(
        boutiqueId, content, req.file.originalname, req.user.id, 'manuel', { force }
      );
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

// DELETE /api/boutique-ventes/batches/:id — supprime le batch et ses ventes
// boutique_ventes.batch_id a déjà ON DELETE CASCADE ; pour boutique_tickets.batch_id
// la migration ON DELETE CASCADE peut ne pas être appliquée sur d'anciennes bases,
// d'où le DELETE explicite avant pour éviter une violation FK.
router.delete('/batches/:id',
  authorize('ADMIN', 'MANAGER'),
  async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM boutique_tickets WHERE batch_id = $1', [req.params.id]);
      const r = await client.query('DELETE FROM boutique_import_batches WHERE id = $1', [req.params.id]);
      await client.query('COMMIT');
      if (r.rowCount === 0) return res.status(404).json({ error: 'Batch introuvable' });
      res.json({ success: true });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      console.error('[boutique-ventes] DELETE batch:', err);
      res.status(500).json({ error: 'Erreur suppression', details: err.message });
    } finally {
      client.release();
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

// ══════════════════════════════════════════
// KPIs retail synthétiques sur une période
// CA TTC/HT, nb tickets, panier moyen, IPT (items/ticket),
// prix moyen article, taux promo, TVA collectée,
// durée moyenne ticket, % tickets avec sac.
// ══════════════════════════════════════════
router.get('/analytics/kpis', async (req, res) => {
  try {
    const { boutique_id, date_from, date_to } = req.query;
    if (!boutique_id) return res.status(400).json({ error: 'boutique_id requis' });

    // Agrégats ventes (CA, articles, TVA, mix segments)
    const vq = await pool.query(`
      SELECT
        COALESCE(SUM(total_ttc),0)::FLOAT     AS ca_ttc,
        COALESCE(SUM(total_ht),0)::FLOAT      AS ca_ht,
        COALESCE(SUM(montant_tva),0)::FLOAT   AS tva_collectee,
        COALESCE(SUM(quantite),0)::INT        AS nb_articles,
        COUNT(*)::INT                         AS nb_lignes,
        COALESCE(SUM(CASE WHEN segment='ventes_courantes' THEN total_ttc END),0)::FLOAT AS ca_courantes,
        COALESCE(SUM(CASE WHEN segment='promotions'       THEN total_ttc END),0)::FLOAT AS ca_promo,
        COALESCE(SUM(CASE WHEN segment='consommables'     THEN total_ttc END),0)::FLOAT AS ca_consommables,
        COALESCE(SUM(CASE WHEN segment='ventes_courantes' THEN quantite END),0)::INT    AS nb_courantes,
        COALESCE(SUM(CASE WHEN segment='promotions'       THEN quantite END),0)::INT    AS nb_promo
      FROM boutique_ventes
      WHERE boutique_id = $1
        AND ($2::DATE IS NULL OR DATE(date_vente) >= $2::DATE)
        AND ($3::DATE IS NULL OR DATE(date_vente) <= $3::DATE)
    `, [boutique_id, date_from || null, date_to || null]);

    // Agrégats tickets (nb tickets réels, durée moyenne, % avec sac)
    const tq = await pool.query(`
      WITH tickets_periode AS (
        SELECT t.id, t.total_ttc
        FROM boutique_tickets t
        WHERE t.boutique_id = $1
          AND ($2::DATE IS NULL OR DATE(t.date_ticket) >= $2::DATE)
          AND ($3::DATE IS NULL OR DATE(t.date_ticket) <= $3::DATE)
      ),
      ticket_duree AS (
        SELECT v.ticket_id,
               EXTRACT(EPOCH FROM (MAX(v.date_vente) - MIN(v.date_vente))) AS duree_sec
        FROM boutique_ventes v
        WHERE v.ticket_id IN (SELECT id FROM tickets_periode)
        GROUP BY v.ticket_id
      ),
      ticket_sac AS (
        SELECT DISTINCT v.ticket_id
        FROM boutique_ventes v
        WHERE v.ticket_id IN (SELECT id FROM tickets_periode)
          AND v.segment = 'consommables'
      )
      SELECT
        COUNT(*)::INT                                                        AS nb_tickets,
        COALESCE(AVG(tp.total_ttc),0)::FLOAT                                 AS panier_moyen,
        COALESCE(AVG(td.duree_sec),0)::FLOAT                                 AS duree_moy_sec,
        (SELECT COUNT(*) FROM ticket_sac)::INT                               AS nb_tickets_avec_sac
      FROM tickets_periode tp
      LEFT JOIN ticket_duree td ON td.ticket_id = tp.id
    `, [boutique_id, date_from || null, date_to || null]);

    const v = vq.rows[0];
    const t = tq.rows[0];
    const nbTickets = t.nb_tickets || 0;
    const nbArticles = v.nb_articles || 0;

    res.json({
      ca_ttc: v.ca_ttc,
      ca_ht: v.ca_ht,
      tva_collectee: v.tva_collectee,
      taux_tva_effectif: v.ca_ht > 0 ? (v.tva_collectee / v.ca_ht) * 100 : 0,
      nb_tickets: nbTickets,
      nb_articles: nbArticles,
      panier_moyen: t.panier_moyen,
      ipt: nbTickets > 0 ? nbArticles / nbTickets : 0,            // Indice Panier Ticket (articles/ticket)
      prix_moyen_article: nbArticles > 0 ? v.ca_ttc / nbArticles : 0,
      ca_courantes: v.ca_courantes,
      ca_promo: v.ca_promo,
      ca_consommables: v.ca_consommables,
      taux_promo_ca: v.ca_ttc > 0 ? (v.ca_promo / v.ca_ttc) * 100 : 0,
      taux_promo_volume: (v.nb_courantes + v.nb_promo) > 0
        ? (v.nb_promo / (v.nb_courantes + v.nb_promo)) * 100 : 0,
      duree_moy_ticket_sec: t.duree_moy_sec,
      taux_attache_sac: nbTickets > 0 ? (t.nb_tickets_avec_sac / nbTickets) * 100 : 0,
    });
  } catch (err) {
    console.error('[boutique-ventes] analytics/kpis:', err);
    res.status(500).json({ error: 'Erreur KPIs' });
  }
});

// GET /api/boutique-ventes/analytics/hourly
// Répartition par heure de la journée (agrégé sur la période)
// + optionnel: heatmap jour-semaine x heure
router.get('/analytics/hourly', async (req, res) => {
  try {
    const { boutique_id, date_from, date_to } = req.query;
    if (!boutique_id) return res.status(400).json({ error: 'boutique_id requis' });

    const byHour = await pool.query(`
      SELECT EXTRACT(HOUR FROM t.date_ticket)::INT AS heure,
             COUNT(*)::INT AS nb_tickets,
             COALESCE(SUM(t.total_ttc),0)::FLOAT AS ca_ttc,
             COALESCE(AVG(t.total_ttc),0)::FLOAT AS panier_moyen
      FROM boutique_tickets t
      WHERE t.boutique_id = $1
        AND ($2::DATE IS NULL OR DATE(t.date_ticket) >= $2::DATE)
        AND ($3::DATE IS NULL OR DATE(t.date_ticket) <= $3::DATE)
      GROUP BY heure ORDER BY heure
    `, [boutique_id, date_from || null, date_to || null]);

    // EXTRACT(DOW) : 0=dim, 1=lun, ... 6=sam
    const heatmap = await pool.query(`
      SELECT EXTRACT(DOW FROM t.date_ticket)::INT  AS jour_semaine,
             EXTRACT(HOUR FROM t.date_ticket)::INT AS heure,
             COUNT(*)::INT AS nb_tickets,
             COALESCE(SUM(t.total_ttc),0)::FLOAT AS ca_ttc
      FROM boutique_tickets t
      WHERE t.boutique_id = $1
        AND ($2::DATE IS NULL OR DATE(t.date_ticket) >= $2::DATE)
        AND ($3::DATE IS NULL OR DATE(t.date_ticket) <= $3::DATE)
      GROUP BY jour_semaine, heure
      ORDER BY jour_semaine, heure
    `, [boutique_id, date_from || null, date_to || null]);

    res.json({ by_hour: byHour.rows, heatmap: heatmap.rows });
  } catch (err) {
    console.error('[boutique-ventes] analytics/hourly:', err);
    res.status(500).json({ error: 'Erreur analytics horaires' });
  }
});

// GET /api/boutique-ventes/analytics/evolution
// Compare la période [date_from..date_to] à la période équivalente juste avant.
// Retourne les deltas CA, nb_tickets, panier_moyen, IPT, prix_moyen_article.
router.get('/analytics/evolution', async (req, res) => {
  try {
    const { boutique_id, date_from, date_to } = req.query;
    if (!boutique_id || !date_from || !date_to) {
      return res.status(400).json({ error: 'boutique_id, date_from, date_to requis' });
    }

    // Calcul de la période N-1 équivalente
    const periodDays = Math.max(
      1,
      Math.round((new Date(date_to) - new Date(date_from)) / 86400000) + 1
    );
    const prevTo = new Date(date_from);
    prevTo.setDate(prevTo.getDate() - 1);
    const prevFrom = new Date(prevTo);
    prevFrom.setDate(prevFrom.getDate() - (periodDays - 1));
    const prevFromStr = prevFrom.toISOString().slice(0, 10);
    const prevToStr = prevTo.toISOString().slice(0, 10);

    async function agg(from, to) {
      const vr = await pool.query(`
        SELECT
          COALESCE(SUM(total_ttc),0)::FLOAT AS ca_ttc,
          COALESCE(SUM(quantite),0)::INT    AS nb_articles
        FROM boutique_ventes
        WHERE boutique_id=$1 AND DATE(date_vente) BETWEEN $2::DATE AND $3::DATE
      `, [boutique_id, from, to]);
      const tr = await pool.query(`
        SELECT COUNT(*)::INT AS nb_tickets, COALESCE(AVG(total_ttc),0)::FLOAT AS panier_moyen
        FROM boutique_tickets
        WHERE boutique_id=$1 AND DATE(date_ticket) BETWEEN $2::DATE AND $3::DATE
      `, [boutique_id, from, to]);
      const v = vr.rows[0];
      const t = tr.rows[0];
      return {
        ca_ttc: v.ca_ttc,
        nb_tickets: t.nb_tickets,
        nb_articles: v.nb_articles,
        panier_moyen: t.panier_moyen,
        ipt: t.nb_tickets > 0 ? v.nb_articles / t.nb_tickets : 0,
        prix_moyen_article: v.nb_articles > 0 ? v.ca_ttc / v.nb_articles : 0,
      };
    }

    const current = await agg(date_from, date_to);
    const previous = await agg(prevFromStr, prevToStr);

    const delta = (c, p) => p > 0 ? ((c - p) / p) * 100 : (c > 0 ? 100 : 0);

    res.json({
      periode_courante: { date_from, date_to, ...current },
      periode_precedente: { date_from: prevFromStr, date_to: prevToStr, ...previous },
      variations: {
        ca_ttc: delta(current.ca_ttc, previous.ca_ttc),
        nb_tickets: delta(current.nb_tickets, previous.nb_tickets),
        nb_articles: delta(current.nb_articles, previous.nb_articles),
        panier_moyen: delta(current.panier_moyen, previous.panier_moyen),
        ipt: delta(current.ipt, previous.ipt),
        prix_moyen_article: delta(current.prix_moyen_article, previous.prix_moyen_article),
      },
    });
  } catch (err) {
    console.error('[boutique-ventes] analytics/evolution:', err);
    res.status(500).json({ error: 'Erreur évolution' });
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
               'quantite', v.quantite, 'total_ttc', v.total_ttc,
               'date_vente', v.date_vente
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

// POST /api/boutique-ventes/webhook-email — réception CSV depuis Power Automate
// Authentifié par clé secrète (header X-Webhook-Secret), sans JWT
router.post('/webhook-email', async (req, res) => {
  const secret = process.env.BOUTIQUE_WEBHOOK_SECRET;
  if (!secret) return res.status(503).json({ error: 'Webhook non configuré (BOUTIQUE_WEBHOOK_SECRET manquant)' });

  const provided = req.headers['x-webhook-secret'];
  if (!provided || provided !== secret) {
    return res.status(401).json({ error: 'Clé secrète invalide' });
  }

  const { boutique_id, boutique_code, filename, content_base64 } = req.body;
  if (!content_base64 || !filename) {
    return res.status(400).json({ error: 'Champs requis : filename, content_base64' });
  }
  if (!boutique_id && !boutique_code) {
    return res.status(400).json({ error: 'Champs requis : boutique_id ou boutique_code' });
  }

  try {
    let btqId = boutique_id;
    if (!btqId && boutique_code) {
      const r = await pool.query('SELECT id FROM boutiques WHERE code = $1 AND is_active = true LIMIT 1', [boutique_code]);
      if (r.rows.length === 0) return res.status(404).json({ error: `Boutique introuvable (code: ${boutique_code})` });
      btqId = r.rows[0].id;
    }

    const csvContent = Buffer.from(content_base64, 'base64').toString('utf-8');
    const result = await importCSVContent(btqId, csvContent, filename, null, 'auto');

    if (result.duplicate) {
      return res.json({ status: 'duplicate', message: 'Fichier déjà importé' });
    }
    res.json({
      status: 'ok',
      nb_lignes_importees: result.nb_lignes_importees,
      nb_tickets: result.nb_tickets,
      ca_total_ttc: result.ca_total_ttc,
    });
  } catch (err) {
    console.error('[boutique-ventes] webhook-email:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.importCSVContent = importCSVContent;
