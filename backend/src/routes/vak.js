/**
 * Module VAK — Vente au Kilo
 *
 * Sources de données :
 *  - API SumUp (OAuth + pull incrémental) : source principale
 *  - Webhooks SumUp (HMAC) : alimentation temps réel pendant la VAK
 *  - Import CSV manuel : fallback historique / panne API
 *
 * Découpe :
 *  - VAK CRUD                : /api/vak[/...]
 *  - Analytics par VAK       : /api/vak/:id/analytics/*
 *  - Vues annuelles          : /api/vak/annual/*
 *  - Live dashboard data     : /api/vak/live/*
 *  - Import CSV (fallback)   : /api/vak/:id/import-csv + /api/vak/csv-batches/*
 *  - Intégration SumUp       : /api/vak/sumup/* (auth, callback, sync, webhook)
 */

const express = require('express');
const router = express.Router();
const pool = require('../config/database');
const { authenticate, authorize } = require('../middleware/auth');
const { autoLogActivity } = require('../middleware/activity-logger');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { csvFilter } = require('../utils/upload-filters');
const sumup = require('../services/sumup');
const logger = require('../config/logger');
const crypto = require('crypto');

// ══════════════════════════════════════════
// Classification centralisée du moyen de paiement (SQL)
// Reconnaît à la fois les libellés SumUp bruts (POS = carte sur terminal, ECOM,
// VISA, Mastercard…) ET les libellés normalisés à l'ingestion ('CB', 'Espèces').
// Un paiement carte encaissé sur le terminal SumUp (`payment_type` = 'POS') est
// donc bien comptabilisé en CB partout. Voir services/sumup.normalizePaymentMethod.
// `col` est un nom de colonne contrôlé (constantes ci-dessous), jamais une
// entrée utilisateur → pas d'injection.
// ══════════════════════════════════════════
const payIsEspeces = (col) => `(${col} ILIKE '%esp%' OR ${col} ILIKE '%cash%' OR ${col} ILIKE '%numer%' OR ${col} ILIKE '%numér%' OR ${col} ILIKE '%liquide%')`;

// ══════════════════════════════════════════
// Agrégation en heure de Paris (Lot 12)
// Les colonnes date_ticket / date_vente sont des TIMESTAMP (sans fuseau)
// STOCKÉS EN UTC (timestamps SumUp API/webhook déjà UTC ; CSV converti
// Paris→UTC à l'import, cf. services/sumup.parseFRDate). Le client veut tous
// les horaires en heure de Paris : le stockage reste UTC, seuls les
// regroupements par HEURE et par JOUR CIVIL convertissent via la double
// conversion `(col AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Paris'`
// (timestamp naïf → instant UTC → heure murale Paris, hiver +1 h / été +2 h
// gérés par la tzdata de PostgreSQL). `col` est un nom de colonne contrôlé
// (constantes internes), jamais une entrée utilisateur → pas d'injection.
// ══════════════════════════════════════════
const parisTs = (col) => `((${col} AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Paris')`;
const parisHour = (col) => `EXTRACT(HOUR FROM ${parisTs(col)})::INT`;
const parisDay = (col) => `${parisTs(col)}::date`;
// « Aujourd'hui » = jour civil vu de Paris (en-CA → YYYY-MM-DD), et non la
// date UTC (fausse entre minuit Paris et 01:00/02:00 du matin).
const todayParis = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
const payIsCb = (col) => `(${col} ILIKE '%cb%' OR ${col} ILIKE '%pos%' OR ${col} ILIKE '%carte%' OR ${col} ILIKE '%card%' OR ${col} ILIKE '%visa%' OR ${col} ILIKE '%master%' OR ${col} ILIKE '%maestro%' OR ${col} ILIKE '%amex%' OR ${col} ILIKE '%ecom%' OR ${col} ILIKE '%contact%' OR ${col} ILIKE '%bancaire%')`;
const payLabel = (col) => `CASE WHEN ${payIsEspeces(col)} THEN 'Espèces' WHEN ${payIsCb(col)} THEN 'CB' ELSE COALESCE(NULLIF(TRIM(${col}), ''), 'Autre') END`;
const payCategorie = (col) => `CASE WHEN ${payIsEspeces(col)} THEN 'especes' WHEN ${payIsCb(col)} THEN 'cb' ELSE 'autre' END`;

// ══════════════════════════════════════════
// Upload CSV (fallback)
// ══════════════════════════════════════════
const uploadDir = path.join(__dirname, '../../uploads/vak-csv');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
      const safe = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_');
      cb(null, `vak-${Date.now()}-${safe}`);
    },
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: csvFilter,
});

// ══════════════════════════════════════════
// State CSRF en mémoire (TTL 10 min) pour OAuth flow
// ══════════════════════════════════════════
const oauthStates = new Map();
function generateState(userId) {
  const state = crypto.randomBytes(24).toString('hex');
  oauthStates.set(state, { userId, createdAt: Date.now() });
  // Purge anciens
  for (const [k, v] of oauthStates.entries()) {
    if (Date.now() - v.createdAt > 10 * 60 * 1000) oauthStates.delete(k);
  }
  return state;
}
function consumeState(state) {
  const entry = oauthStates.get(state);
  if (!entry) return null;
  oauthStates.delete(state);
  if (Date.now() - entry.createdAt > 10 * 60 * 1000) return null;
  return entry;
}

// ══════════════════════════════════════════
// WEBHOOK SumUp (PUBLIC, validé par HMAC)
// IMPORTANT : monté AVANT le middleware authenticate global pour rester public
// ══════════════════════════════════════════
router.post('/sumup/webhook', async (req, res) => {
  try {
    // rawBody est capturé par le `verify` du middleware express.json global
    // (cf. backend/src/index.js). On retombe sur un stringify si jamais
    // l'app était reconfigurée pour ne plus capturer.
    const rawBody = req.rawBody instanceof Buffer
      ? req.rawBody
      : Buffer.from(JSON.stringify(req.body || {}));
    const webhookSecret = await sumup.getEncryptedSetting('sumup.webhook_secret');
    const signature = req.headers['sumup-signature'] || req.headers['x-sumup-signature'];

    if (!webhookSecret) {
      logger.warn('SumUp webhook reçu mais aucun secret configuré');
      return res.status(503).json({ error: 'Webhook non configuré' });
    }
    if (!sumup.validateWebhookSignature(rawBody, signature, webhookSecret)) {
      logger.warn('SumUp webhook signature invalide', { signature });
      return res.status(401).json({ error: 'Signature invalide' });
    }

    const payload = req.body || JSON.parse(rawBody.toString('utf-8'));
    const eventType = payload.event_type || payload.type;
    const txData = payload.payload || payload.data || payload;

    // Log entrée
    const logRes = await pool.query(`
      INSERT INTO vak_sumup_sync_log (sync_type, status, details)
      VALUES ('webhook', 'running', $1) RETURNING id
    `, [JSON.stringify({ event_type: eventType, transaction_id: txData?.id })]);

    if (eventType && !String(eventType).toLowerCase().includes('transaction')) {
      await pool.query(`UPDATE vak_sumup_sync_log SET ended_at = NOW(), status = 'success' WHERE id = $1`, [logRes.rows[0].id]);
      return res.status(202).json({ received: true, ignored: true });
    }

    const io = req.app.get('io');
    const inserted = await sumup.ingestSumUpTransaction(txData, { io, source: 'webhook_sumup' });
    await pool.query(`
      UPDATE vak_sumup_sync_log SET
        ended_at = NOW(), status = 'success',
        nb_transactions_received = 1,
        nb_transactions_inserted = $1, nb_transactions_skipped = $2
      WHERE id = $3
    `, [inserted ? 1 : 0, inserted ? 0 : 1, logRes.rows[0].id]);

    return res.status(200).json({ received: true, inserted });
  } catch (err) {
    logger.error('SumUp webhook handler', { error: err.message });
    return res.status(500).json({ error: 'Erreur webhook' });
  }
});

// ══════════════════════════════════════════
// OAuth callback (PUBLIC, state vérifié)
// ══════════════════════════════════════════
router.get('/sumup/callback', async (req, res) => {
  try {
    const { code, state, error } = req.query;
    if (error) {
      return res.redirect(`/admin/vak/sumup-config?error=${encodeURIComponent(error)}`);
    }
    if (!code || !state) return res.status(400).send('code et state requis');
    const entry = consumeState(state);
    if (!entry) return res.status(400).send('state invalide ou expiré');

    await sumup.exchangeCodeForTokens(code);
    // Tente d'enregistrer le webhook côté SumUp (best effort)
    await sumup.registerWebhook().catch((err) => logger.warn('SumUp registerWebhook au callback', { error: err.message }));

    return res.redirect('/admin/vak/sumup-config?connected=1');
  } catch (err) {
    logger.error('SumUp callback', { error: err.message });
    return res.redirect(`/admin/vak/sumup-config?error=${encodeURIComponent(err.message)}`);
  }
});

// ══════════════════════════════════════════
// À partir d'ici : auth obligatoire
// ══════════════════════════════════════════
router.use(authenticate);
router.use(autoLogActivity('vak'));

// ──────────────────────────────────────────
// VAK CRUD
// ──────────────────────────────────────────
router.get('/', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT v.*,
        COALESCE((SELECT SUM(total_ttc) FROM vak_tickets WHERE vak_id = v.id), 0)::FLOAT AS ca_realise,
        COALESCE((SELECT SUM(poids_kg) FROM vak_tickets WHERE vak_id = v.id), 0)::FLOAT AS poids_realise,
        COALESCE((SELECT COUNT(*) FROM vak_tickets WHERE vak_id = v.id), 0)::INT AS nb_tickets
      FROM vaks v
      ORDER BY v.date_debut DESC
    `);
    res.json(r.rows);
  } catch (err) {
    logger.error('VAK list', { error: err.message });
    res.status(500).json({ error: 'Erreur chargement VAK' });
  }
});

router.post('/', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const { libelle, date_debut, date_fin, lieu, latitude, longitude, ca_objectif_ttc, poids_objectif_kg, kg_approvisionnes, notes } = req.body;
    if (!libelle || !date_debut || !date_fin) {
      return res.status(400).json({ error: 'libelle, date_debut et date_fin requis' });
    }
    const r = await pool.query(`
      INSERT INTO vaks (libelle, date_debut, date_fin, lieu, latitude, longitude,
                        ca_objectif_ttc, poids_objectif_kg, kg_approvisionnes, notes, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING *
    `, [libelle, date_debut, date_fin, lieu || 'Siège - Rouen',
        latitude || 49.4231, longitude || 1.0993,
        ca_objectif_ttc || null, poids_objectif_kg || null, kg_approvisionnes || null, notes || null, req.user.id]);
    // Préparer la météo en best effort
    sumup.captureWeatherForVak(r.rows[0].id).catch(() => {});
    res.status(201).json(r.rows[0]);
  } catch (err) {
    logger.error('VAK create', { error: err.message });
    res.status(500).json({ error: 'Erreur création VAK' });
  }
});

router.get('/:id', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM vaks WHERE id = $1', [req.params.id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'VAK introuvable' });
    res.json(r.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Erreur' });
  }
});

router.put('/:id', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const { libelle, date_debut, date_fin, lieu, ca_objectif_ttc, poids_objectif_kg, kg_approvisionnes, notes } = req.body;
    const r = await pool.query(`
      UPDATE vaks SET libelle = COALESCE($1, libelle),
                      date_debut = COALESCE($2, date_debut),
                      date_fin = COALESCE($3, date_fin),
                      lieu = COALESCE($4, lieu),
                      ca_objectif_ttc = $5, poids_objectif_kg = $6,
                      kg_approvisionnes = $7,
                      notes = $8, updated_at = NOW()
      WHERE id = $9 RETURNING *
    `, [libelle, date_debut, date_fin, lieu, ca_objectif_ttc, poids_objectif_kg, kg_approvisionnes, notes, req.params.id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'VAK introuvable' });
    res.json(r.rows[0]);
  } catch (err) {
    logger.error('VAK update', { error: err.message });
    res.status(500).json({ error: 'Erreur mise à jour' });
  }
});

router.delete('/:id', authorize('ADMIN'), async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM vaks WHERE id = $1', [req.params.id]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'VAK introuvable' });
    res.json({ success: true });
  } catch (err) {
    logger.error('VAK delete', { error: err.message });
    res.status(500).json({ error: 'Erreur suppression' });
  }
});

// ──────────────────────────────────────────
// Analytics par VAK
// ──────────────────────────────────────────
router.get('/:id/analytics/kpis', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const vakId = req.params.id;
    const v = await pool.query(`
      SELECT
        COALESCE(SUM(total_ttc),0)::FLOAT AS ca_ttc,
        COALESCE(SUM(total_ht),0)::FLOAT  AS ca_ht,
        COALESCE(SUM(total_tva),0)::FLOAT AS tva_collectee,
        COUNT(*)::INT                     AS nb_lignes,
        COALESCE(SUM(CASE WHEN unite ILIKE '%kg%' THEN quantite END), 0)::FLOAT AS poids_kg,
        COALESCE(SUM(CASE WHEN segment = 'textile_vrac' THEN total_ttc END), 0)::FLOAT AS ca_textile,
        COALESCE(SUM(CASE WHEN segment = 'chaussures'   THEN total_ttc END), 0)::FLOAT AS ca_chaussures,
        COALESCE(SUM(CASE WHEN segment = 'consommables' THEN total_ttc END), 0)::FLOAT AS ca_sacs,
        COALESCE(SUM(CASE WHEN segment = 'consommables' THEN quantite END), 0)::INT AS nb_sacs,
        COALESCE(SUM(remise), 0)::FLOAT AS remise_totale
      FROM vak_ventes WHERE vak_id = $1
    `, [vakId]);
    const t = await pool.query(`
      SELECT
        COUNT(*)::INT                                  AS nb_tickets,
        COALESCE(AVG(total_ttc), 0)::FLOAT             AS panier_moyen,
        COALESCE(SUM(nb_articles), 0)::INT             AS total_articles,
        COALESCE(SUM(CASE WHEN ${payIsEspeces('moyen_paiement')} THEN total_ttc END), 0)::FLOAT AS ca_especes,
        COALESCE(SUM(CASE WHEN ${payIsCb('moyen_paiement')} THEN total_ttc END), 0)::FLOAT AS ca_cb,
        COUNT(CASE WHEN ${payIsEspeces('moyen_paiement')} THEN 1 END)::INT AS nb_especes,
        COUNT(CASE WHEN ${payIsCb('moyen_paiement')} THEN 1 END)::INT AS nb_cb
      FROM vak_tickets WHERE vak_id = $1
    `, [vakId]);
    // Approvisionnement saisi manuellement sur la session (base du taux d'écoulement)
    const meta = await pool.query('SELECT kg_approvisionnes FROM vaks WHERE id = $1', [vakId]);
    const a = v.rows[0]; const b = t.rows[0];
    const nbTickets = b.nb_tickets || 0;
    const kgApprov = meta.rows[0]?.kg_approvisionnes != null ? Number(meta.rows[0].kg_approvisionnes) : null;
    res.json({
      ca_ttc: a.ca_ttc,
      ca_ht: a.ca_ht,
      tva_collectee: a.tva_collectee,
      poids_kg: a.poids_kg,
      nb_tickets: nbTickets,
      nb_articles: b.total_articles,
      panier_moyen: b.panier_moyen,
      ipt: nbTickets > 0 ? b.total_articles / nbTickets : 0,
      prix_moyen_kg: a.poids_kg > 0 ? a.ca_ttc / a.poids_kg : 0,
      ca_textile_vrac: a.ca_textile,
      ca_chaussures: a.ca_chaussures,
      ca_consommables: a.ca_sacs,
      nb_sacs: a.nb_sacs,
      part_chaussures_ca: a.ca_ttc > 0 ? (a.ca_chaussures / a.ca_ttc) * 100 : 0,
      part_textile_ca: a.ca_ttc > 0 ? (a.ca_textile / a.ca_ttc) * 100 : 0,
      ca_especes: b.ca_especes,
      ca_cb: b.ca_cb,
      nb_especes: b.nb_especes,
      nb_cb: b.nb_cb,
      taux_cb_volume: nbTickets > 0 ? (b.nb_cb / nbTickets) * 100 : 0,
      taux_cb_ca: a.ca_ttc > 0 ? (b.ca_cb / a.ca_ttc) * 100 : 0,
      remise_totale: a.remise_totale,
      // Taux d'écoulement = kg vendus (net des remboursements) / kg approvisionnés
      // (saisie manuelle sur la session). null si l'approvisionnement n'est pas renseigné.
      kg_approvisionnes: kgApprov,
      taux_ecoulement: (kgApprov && kgApprov > 0) ? (a.poids_kg / kgApprov) * 100 : null,
    });
  } catch (err) {
    logger.error('VAK kpis', { error: err.message });
    res.status(500).json({ error: 'Erreur KPIs' });
  }
});

router.get('/:id/analytics/hourly', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const vakId = req.params.id;
    const byHour = await pool.query(`
      SELECT ${parisHour('date_ticket')} AS heure,
             COUNT(*)::INT AS nb_tickets,
             COALESCE(SUM(total_ttc),0)::FLOAT AS ca_ttc,
             COALESCE(SUM(poids_kg),0)::FLOAT AS poids_kg,
             COALESCE(AVG(total_ttc),0)::FLOAT AS panier_moyen
      FROM vak_tickets WHERE vak_id = $1
      GROUP BY heure ORDER BY heure
    `, [vakId]);
    const heatmap = await pool.query(`
      SELECT ${parisDay('date_ticket')} AS jour,
             ${parisHour('date_ticket')} AS heure,
             COUNT(*)::INT AS nb_tickets,
             COALESCE(SUM(total_ttc),0)::FLOAT AS ca_ttc
      FROM vak_tickets WHERE vak_id = $1
      GROUP BY jour, heure ORDER BY jour, heure
    `, [vakId]);
    res.json({ by_hour: byHour.rows, heatmap: heatmap.rows });
  } catch (err) {
    logger.error('VAK hourly', { error: err.message });
    res.status(500).json({ error: 'Erreur analytics horaires' });
  }
});

router.get('/:id/analytics/segments', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT segment,
             COALESCE(SUM(total_ttc),0)::FLOAT AS ca_ttc,
             COALESCE(SUM(quantite),0)::FLOAT AS quantite,
             COUNT(*)::INT AS nb_lignes
      FROM vak_ventes WHERE vak_id = $1
      GROUP BY segment ORDER BY ca_ttc DESC
    `, [req.params.id]);
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erreur' });
  }
});

router.get('/:id/analytics/payments', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    // MAX(entry_mode) plutôt que sous-requête corrélée : Postgres refuse
    // (avec raison) une sous-requête qui référence une colonne non agrégée
    // sous GROUP BY. MAX d'un VARCHAR donne un échantillon stable.
    // Regroupe sur le libellé normalisé : les tickets historiques stockés 'POS'
    // et les nouveaux stockés 'CB' fusionnent dans une seule tranche 'CB'.
    const r = await pool.query(`
      SELECT ${payLabel('moyen_paiement')} AS moyen_paiement,
             COUNT(*)::INT AS nb_tickets,
             COALESCE(SUM(total_ttc),0)::FLOAT AS ca_ttc,
             COALESCE(SUM(poids_kg),0)::FLOAT AS poids_kg,
             COALESCE(AVG(total_ttc),0)::FLOAT AS panier_moyen,
             MAX(entry_mode) AS entry_mode_sample
      FROM vak_tickets WHERE vak_id = $1
      GROUP BY 1 ORDER BY ca_ttc DESC
    `, [req.params.id]);
    res.json(r.rows);
  } catch (err) {
    logger.error('VAK payments', { error: err.message });
    res.status(500).json({ error: 'Erreur' });
  }
});

router.get('/:id/analytics/comparison', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const vakId = req.params.id;
    const current = await pool.query(`
      SELECT v.id, v.libelle, v.date_debut, v.date_fin,
             COALESCE(SUM(t.total_ttc),0)::FLOAT AS ca_ttc,
             COALESCE(SUM(t.poids_kg),0)::FLOAT  AS poids_kg,
             COUNT(t.id)::INT                    AS nb_tickets,
             COALESCE(AVG(t.total_ttc),0)::FLOAT AS panier_moyen
      FROM vaks v LEFT JOIN vak_tickets t ON t.vak_id = v.id
      WHERE v.id = $1 GROUP BY v.id
    `, [vakId]);
    if (current.rows.length === 0) return res.status(404).json({ error: 'VAK introuvable' });
    const cur = current.rows[0];

    // N-1 : VAK même mois année précédente
    const dateNM1 = new Date(cur.date_debut);
    dateNM1.setFullYear(dateNM1.getFullYear() - 1);
    const dateNM1Plus = new Date(dateNM1); dateNM1Plus.setMonth(dateNM1Plus.getMonth() + 1);

    const previous = await pool.query(`
      SELECT v.id, v.libelle, v.date_debut, v.date_fin,
             COALESCE(SUM(t.total_ttc),0)::FLOAT AS ca_ttc,
             COALESCE(SUM(t.poids_kg),0)::FLOAT  AS poids_kg,
             COUNT(t.id)::INT                    AS nb_tickets,
             COALESCE(AVG(t.total_ttc),0)::FLOAT AS panier_moyen
      FROM vaks v LEFT JOIN vak_tickets t ON t.vak_id = v.id
      WHERE v.date_debut >= $1 AND v.date_debut < $2
      GROUP BY v.id ORDER BY v.date_debut DESC LIMIT 1
    `, [dateNM1.toISOString().slice(0, 10), dateNM1Plus.toISOString().slice(0, 10)]);

    // Moyenne YTD année en cours
    const startYear = new Date(cur.date_debut);
    startYear.setMonth(0, 1);
    const ytd = await pool.query(`
      SELECT
        COALESCE(AVG(per_vak.ca),0)::FLOAT          AS avg_ca,
        COALESCE(AVG(per_vak.poids),0)::FLOAT       AS avg_poids,
        COALESCE(AVG(per_vak.tickets),0)::FLOAT     AS avg_tickets,
        COALESCE(AVG(per_vak.panier),0)::FLOAT      AS avg_panier
      FROM (
        SELECT v.id,
               COALESCE(SUM(t.total_ttc),0) AS ca,
               COALESCE(SUM(t.poids_kg),0)  AS poids,
               COUNT(t.id)                  AS tickets,
               COALESCE(AVG(t.total_ttc),0) AS panier
        FROM vaks v LEFT JOIN vak_tickets t ON t.vak_id = v.id
        WHERE v.id != $1
          AND v.date_debut >= $2
          AND v.date_debut <= $3
        GROUP BY v.id
      ) per_vak
    `, [vakId, startYear.toISOString().slice(0, 10), cur.date_debut.toISOString ? cur.date_debut.toISOString().slice(0, 10) : cur.date_debut]);

    const delta = (c, p) => p > 0 ? ((c - p) / p) * 100 : (c > 0 ? 100 : 0);
    const prev = previous.rows[0] || null;
    const moy = ytd.rows[0];

    res.json({
      current: cur,
      previous: prev,
      ytd_average: moy,
      vs_previous: prev ? {
        ca_ttc: delta(cur.ca_ttc, prev.ca_ttc),
        poids_kg: delta(cur.poids_kg, prev.poids_kg),
        nb_tickets: delta(cur.nb_tickets, prev.nb_tickets),
        panier_moyen: delta(cur.panier_moyen, prev.panier_moyen),
      } : null,
      vs_ytd: {
        ca_ttc: delta(cur.ca_ttc, moy.avg_ca),
        poids_kg: delta(cur.poids_kg, moy.avg_poids),
        nb_tickets: delta(cur.nb_tickets, moy.avg_tickets),
        panier_moyen: delta(cur.panier_moyen, moy.avg_panier),
      },
    });
  } catch (err) {
    logger.error('VAK comparison', { error: err.message });
    res.status(500).json({ error: 'Erreur comparaison' });
  }
});

// Vue ventilée par jour de la VAK (cartes comparatives jour par jour)
router.get('/:id/analytics/by-day', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const vakId = req.params.id;
    const [days, hourly, segments, payments, meteo] = await Promise.all([
      pool.query(`
        SELECT ${parisDay('t.date_ticket')} AS jour,
               COUNT(*)::INT                                              AS nb_tickets,
               COALESCE(SUM(t.total_ttc),0)::FLOAT                        AS ca_ttc,
               COALESCE(SUM(t.total_ht),0)::FLOAT                         AS ca_ht,
               COALESCE(SUM(t.total_tva),0)::FLOAT                        AS tva_collectee,
               COALESCE(SUM(t.poids_kg),0)::FLOAT                         AS poids_kg,
               COALESCE(SUM(t.nb_articles),0)::INT                        AS nb_articles,
               COALESCE(AVG(t.total_ttc),0)::FLOAT                        AS panier_moyen,
               COALESCE(SUM(CASE WHEN ${payIsEspeces('t.moyen_paiement')} THEN t.total_ttc END),0)::FLOAT AS ca_especes,
               COALESCE(SUM(CASE WHEN ${payIsCb('t.moyen_paiement')} THEN t.total_ttc END),0)::FLOAT AS ca_cb,
               COUNT(CASE WHEN ${payIsEspeces('t.moyen_paiement')} THEN 1 END)::INT AS nb_especes,
               COUNT(CASE WHEN ${payIsCb('t.moyen_paiement')} THEN 1 END)::INT AS nb_cb,
               MIN(t.date_ticket) AS premiere_vente,
               MAX(t.date_ticket) AS derniere_vente
        FROM vak_tickets t WHERE t.vak_id = $1
        GROUP BY 1 ORDER BY 1
      `, [vakId]),
      pool.query(`
        SELECT ${parisDay('date_ticket')} AS jour,
               ${parisHour('date_ticket')} AS heure,
               COUNT(*)::INT AS nb_tickets,
               COALESCE(SUM(total_ttc),0)::FLOAT AS ca_ttc,
               COALESCE(SUM(poids_kg),0)::FLOAT AS poids_kg
        FROM vak_tickets WHERE vak_id = $1
        GROUP BY jour, heure ORDER BY jour, heure
      `, [vakId]),
      pool.query(`
        SELECT ${parisDay('date_vente')} AS jour, segment,
               COALESCE(SUM(total_ttc),0)::FLOAT AS ca_ttc,
               COALESCE(SUM(quantite),0)::FLOAT AS quantite
        FROM vak_ventes WHERE vak_id = $1
        GROUP BY jour, segment ORDER BY jour, segment
      `, [vakId]),
      pool.query(`
        SELECT ${parisDay('date_ticket')} AS jour, ${payLabel('moyen_paiement')} AS moyen_paiement,
               COUNT(*)::INT AS nb_tickets,
               COALESCE(SUM(total_ttc),0)::FLOAT AS ca_ttc
        FROM vak_tickets WHERE vak_id = $1
        GROUP BY 1, 2 ORDER BY jour, ca_ttc DESC
      `, [vakId]),
      pool.query(`SELECT * FROM vak_meteo_quotidien WHERE vak_id = $1 ORDER BY date`, [vakId]),
    ]);

    res.json({
      days: days.rows,
      hourly: hourly.rows,
      segments: segments.rows,
      payments: payments.rows,
      meteo: meteo.rows,
    });
  } catch (err) {
    logger.error('VAK by-day', { error: err.message });
    res.status(500).json({ error: 'Erreur analyse par jour' });
  }
});

router.get('/:id/meteo', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT * FROM vak_meteo_quotidien WHERE vak_id = $1 ORDER BY date
    `, [req.params.id]);
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erreur' });
  }
});

// ──────────────────────────────────────────
// Vues annuelles (toutes VAK)
// ──────────────────────────────────────────
router.get('/annual/overview', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const annee = parseInt(req.query.annee) || new Date().getFullYear();
    const r = await pool.query(`
      SELECT v.id, v.libelle, v.date_debut, v.date_fin, v.ca_objectif_ttc, v.poids_objectif_kg,
             v.kg_approvisionnes,
             COALESCE(SUM(t.total_ttc),0)::FLOAT AS ca_ttc,
             COALESCE(SUM(t.poids_kg),0)::FLOAT AS poids_kg,
             COUNT(t.id)::INT AS nb_tickets,
             COALESCE(AVG(t.total_ttc),0)::FLOAT AS panier_moyen
      FROM vaks v LEFT JOIN vak_tickets t ON t.vak_id = v.id
      WHERE EXTRACT(YEAR FROM v.date_debut) = $1
      GROUP BY v.id ORDER BY v.date_debut
    `, [annee]);
    const summary = await pool.query(`
      SELECT COUNT(*)::INT AS nb_vaks,
             COALESCE(SUM(ca),0)::FLOAT AS ca_total,
             COALESCE(SUM(poids),0)::FLOAT AS poids_total,
             COALESCE(SUM(tickets),0)::INT AS tickets_total,
             COALESCE(AVG(panier),0)::FLOAT AS panier_moyen
      FROM (
        SELECT v.id,
               COALESCE(SUM(t.total_ttc),0) AS ca,
               COALESCE(SUM(t.poids_kg),0)  AS poids,
               COUNT(t.id)                  AS tickets,
               COALESCE(AVG(t.total_ttc),0) AS panier
        FROM vaks v LEFT JOIN vak_tickets t ON t.vak_id = v.id
        WHERE EXTRACT(YEAR FROM v.date_debut) = $1
        GROUP BY v.id
      ) x
    `, [annee]);
    const s = summary.rows[0];
    res.json({
      vaks: r.rows,
      summary: {
        ...s,
        prix_moyen_kg: s.poids_total > 0 ? s.ca_total / s.poids_total : 0,
      },
    });
  } catch (err) {
    logger.error('VAK annual overview', { error: err.message });
    res.status(500).json({ error: 'Erreur overview' });
  }
});

router.get('/annual/hourly-heatmap', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const annee = parseInt(req.query.annee) || new Date().getFullYear();
    const r = await pool.query(`
      SELECT ${parisHour('t.date_ticket')} AS heure,
             COUNT(*)::INT AS nb_tickets,
             COALESCE(SUM(t.total_ttc),0)::FLOAT AS ca_ttc,
             COALESCE(SUM(t.poids_kg),0)::FLOAT AS poids_kg
      FROM vak_tickets t JOIN vaks v ON v.id = t.vak_id
      WHERE EXTRACT(YEAR FROM v.date_debut) = $1
      GROUP BY heure ORDER BY heure
    `, [annee]);
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erreur' });
  }
});

router.get('/annual/segments-trend', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const annee = parseInt(req.query.annee) || new Date().getFullYear();
    const r = await pool.query(`
      SELECT v.id AS vak_id, v.libelle, v.date_debut, vv.segment,
             COALESCE(SUM(vv.total_ttc),0)::FLOAT AS ca_ttc
      FROM vaks v
      LEFT JOIN vak_ventes vv ON vv.vak_id = v.id
      WHERE EXTRACT(YEAR FROM v.date_debut) = $1
      GROUP BY v.id, vv.segment
      ORDER BY v.date_debut, vv.segment
    `, [annee]);
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erreur' });
  }
});

router.get('/annual/payment-mix', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const annee = parseInt(req.query.annee) || new Date().getFullYear();
    const r = await pool.query(`
      SELECT v.id AS vak_id, v.libelle, v.date_debut,
             ${payCategorie('t.moyen_paiement')} AS categorie,
             COUNT(*)::INT AS nb_tickets,
             COALESCE(SUM(t.total_ttc),0)::FLOAT AS ca_ttc
      FROM vak_tickets t JOIN vaks v ON v.id = t.vak_id
      WHERE EXTRACT(YEAR FROM v.date_debut) = $1
      GROUP BY v.id, categorie ORDER BY v.date_debut
    `, [annee]);
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erreur' });
  }
});

// ──────────────────────────────────────────
// Live (dashboard temps réel)
// ──────────────────────────────────────────
router.get('/live/current', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    // Jour civil PARIS (une VAK est bornée en jours civils français) — la date
    // UTC faisait basculer l'écran live sur la veille entre minuit et 01:00/02:00.
    const today = todayParis();
    const r = await pool.query(`
      SELECT v.* FROM vaks v
      WHERE $1::DATE BETWEEN v.date_debut AND v.date_fin
      ORDER BY v.date_debut DESC LIMIT 1
    `, [today]);
    if (r.rows.length === 0) {
      // Pas de VAK aujourd'hui, on renvoie la prochaine
      const next = await pool.query(`
        SELECT * FROM vaks WHERE date_debut > $1::DATE ORDER BY date_debut LIMIT 1
      `, [today]);
      return res.json({ current: null, next: next.rows[0] || null });
    }
    const vak = r.rows[0];
    const counters = await pool.query(`
      SELECT
        COALESCE(SUM(CASE WHEN ${parisDay('date_ticket')} = $1::DATE THEN total_ttc END), 0)::FLOAT AS ca_jour,
        COALESCE(SUM(CASE WHEN ${parisDay('date_ticket')} = $1::DATE THEN poids_kg END), 0)::FLOAT AS poids_jour,
        COUNT(CASE WHEN ${parisDay('date_ticket')} = $1::DATE THEN 1 END)::INT AS tickets_jour,
        COALESCE(SUM(total_ttc), 0)::FLOAT AS ca_vak,
        COALESCE(SUM(poids_kg), 0)::FLOAT AS poids_vak,
        COUNT(*)::INT AS tickets_vak
      FROM vak_tickets WHERE vak_id = $2
    `, [today, vak.id]);
    const recent = await pool.query(`
      SELECT id, ref_transaction, date_ticket, moyen_paiement, nb_articles, poids_kg, total_ttc
      FROM vak_tickets WHERE vak_id = $1 ORDER BY date_ticket DESC LIMIT 10
    `, [vak.id]);
    const meteo = await pool.query(`
      SELECT * FROM vak_meteo_quotidien WHERE vak_id = $1 AND date = $2::DATE
    `, [vak.id, today]);
    res.json({
      current: vak,
      next: null,
      counters: counters.rows[0],
      recent: recent.rows,
      meteo: meteo.rows[0] || null,
    });
  } catch (err) {
    logger.error('VAK live current', { error: err.message });
    res.status(500).json({ error: 'Erreur' });
  }
});

// ──────────────────────────────────────────
// Tickets et ventes brutes (debug + export)
// ──────────────────────────────────────────
router.get('/:id/tickets', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT * FROM vak_tickets WHERE vak_id = $1 ORDER BY date_ticket DESC LIMIT 1000
    `, [req.params.id]);
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erreur' });
  }
});

router.get('/:id/ventes', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const { limit = 500, offset = 0 } = req.query;
    const r = await pool.query(`
      SELECT * FROM vak_ventes WHERE vak_id = $1
      ORDER BY date_vente DESC LIMIT $2 OFFSET $3
    `, [req.params.id, parseInt(limit), parseInt(offset)]);
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erreur' });
  }
});

// ──────────────────────────────────────────
// Import CSV (fallback)
// ──────────────────────────────────────────
router.post('/:id/import-csv',
  authorize('ADMIN', 'MANAGER'),
  upload.single('file'),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: 'Fichier CSV requis' });
      const content = fs.readFileSync(req.file.path, 'utf-8');
      const result = await sumup.importCSVContent(
        parseInt(req.params.id), content, req.file.originalname, req.user.id, 'csv_manuel',
      );
      try { fs.unlinkSync(req.file.path); } catch (_) { /* ok */ }
      if (result.error) return res.status(400).json(result);
      res.json(result);
    } catch (err) {
      logger.error('VAK CSV import', { error: err.message });
      if (req.file && fs.existsSync(req.file.path)) { try { fs.unlinkSync(req.file.path); } catch (_) {} }
      res.status(500).json({ error: 'Erreur import CSV' });
    }
  });

router.get('/:id/csv-batches', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const r = await pool.query(`
      SELECT b.*, u.first_name || ' ' || u.last_name AS imported_by_name
      FROM vak_import_batches b LEFT JOIN users u ON b.imported_by = u.id
      WHERE b.vak_id = $1 ORDER BY b.created_at DESC LIMIT 100
    `, [req.params.id]);
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erreur' });
  }
});

router.delete('/csv-batches/:batchId', authorize('ADMIN', 'MANAGER'), async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM vak_import_batches WHERE id = $1', [req.params.batchId]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Batch introuvable' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erreur suppression' });
  }
});

// ──────────────────────────────────────────
// SumUp — configuration & synchronisation
// ──────────────────────────────────────────
router.get('/sumup/status', authorize('ADMIN'), async (req, res) => {
  try {
    const status = await sumup.getConnectionStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: 'Erreur' });
  }
});

router.put('/sumup/credentials', authorize('ADMIN'), async (req, res) => {
  try {
    const { client_id, client_secret } = req.body || {};
    if (!client_id || !client_secret) return res.status(400).json({ error: 'client_id et client_secret requis' });
    await sumup.setSetting('sumup.client_id', client_id);
    await sumup.setEncryptedSetting('sumup.client_secret', client_secret);
    res.json({ success: true });
  } catch (err) {
    logger.error('SumUp credentials save', { error: err.message });
    res.status(500).json({ error: 'Erreur' });
  }
});

router.get('/sumup/auth-url', authorize('ADMIN'), async (req, res) => {
  try {
    const state = generateState(req.user.id);
    const url = await sumup.getAuthorizationUrl(state);
    res.json({ url, state });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/sumup/sync', authorize('ADMIN'), async (req, res) => {
  try {
    const io = req.app.get('io');
    const since = req.body?.since ? new Date(req.body.since) : null;
    const result = await sumup.syncTransactionsFromApi({
      io,
      triggeredBy: req.user.id,
      sinceOverride: since,
    });
    res.json(result);
  } catch (err) {
    logger.error('VAK sumup sync', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

router.delete('/sumup/disconnect', authorize('ADMIN'), async (req, res) => {
  try {
    await sumup.disconnect();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/sumup/sync-log', authorize('ADMIN'), async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const r = await pool.query(`
      SELECT * FROM vak_sumup_sync_log ORDER BY started_at DESC LIMIT $1
    `, [limit]);
    res.json(r.rows);
  } catch (err) {
    res.status(500).json({ error: 'Erreur' });
  }
});

router.post('/sumup/register-webhook', authorize('ADMIN'), async (req, res) => {
  try {
    const result = await sumup.registerWebhook();
    res.json({ success: !!result, result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
