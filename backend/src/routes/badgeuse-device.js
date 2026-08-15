/**
 * API Device v1 du module « Temps & Présence » — poste de pointage ↔ SOLIDATA.
 * Contrat : docs/badgeuse/CONTRAT_API_DEVICE.md (producteur de ce contrat).
 *
 * SURFACE PUBLIQUE : ce routeur est monté AVANT le middleware `authenticate`
 * (pattern webhook SumUp / enquêtes publiques). L'authentification se fait par
 * l'en-tête `X-Device-Key` : la clé device (256 bits hex) est générée par le
 * serveur à l'appairage, seul son CONDENSAT SHA-256 est stocké, et la
 * comparaison est à TEMPS CONSTANT (jamais d'égalité SQL sur une clé).
 *
 * ══ INVARIANTS DE CE FICHIER ══
 *  - AUCUN UID DE BADGE EN CLAIR n'existe ici : seul `uid_hmac` transite, et il
 *    n'est jamais écrit dans un log. Les journaux ne portent que le code du
 *    poste et des compteurs (un test vérifie qu'aucune sortie console ne laisse
 *    fuir d'identifiant).
 *  - JAMAIS D'ÉCHEC SILENCIEUX (PST-04/05) : chaque élément d'un lot reçoit son
 *    statut (`ok` / `duplicate` / `orphan` / `invalid`). Les QUATRE valent
 *    accusé de réception TERMINAL — le poste purge sa file (CONTRAT_API_DEVICE
 *    §2.1, amendement v1.1). Un badge inconnu ou un pointage hors plage est
 *    STOCKÉ en statut `orphelin` pour traitement RH, jamais rejeté.
 *  - `invalid` est RÉSERVÉ à l'élément qu'aucun rejeu ne réparera (UUID
 *    invalide, horodatage illisible, charge canonique ambiguë). Il est
 *    JOURNALISÉ ici et remonte dans le champ `alerte` du heartbeat du poste :
 *    une purge silencieuse serait le pire des cas. Un `uid_hmac` valant `-`
 *    (pointage manuel/import, CONTRAT_INTEGRITE §2) est en revanche VALIDE :
 *    il est stocké NULL en base et reste `-` dans le calcul de chaîne (QA-01).
 *  - AUCUNE HEURE NE SE PERD : une rupture de chaîne n'empêche pas le stockage
 *    (chaine_valide = false + avertissement `chain_broken`). On n'efface jamais
 *    une preuve, même imparfaite.
 *  - Le lot n'est jamais rejeté en bloc pour un élément fautif : SAVEPOINT par
 *    élément (même parade que l'import paie, cf. 2.3.1).
 */
const express = require('express');
const crypto = require('crypto');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const router = express.Router();
const pool = require('../config/database');
const { body, param } = require('express-validator');
const { validate } = require('../middleware/validate');
const {
  canonicalPointage, genesisHash, chainHash, hashDeviceKey, timingSafeEqualHex, isoMillisUTC,
  NO_BADGE,
} = require('../utils/badgeuse-crypto');
const { readBadgeuseParams } = require('../utils/badgeuse-settings');
const engine = require('../services/badgeuse-engine');

// Lot ≤ 100 (CONTRAT_API_DEVICE §2.1).
const LOT_MAX = 100;

// Limitation de débit par POSTE (et non par IP : plusieurs postes peuvent
// sortir derrière la même IP). Large par rapport à l'usage réel (un heartbeat
// par minute + une sync toutes les 5 min), serré par rapport à un abus.
const deviceLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  // Clé = le poste. Toutes les routes de ce routeur portent `:code`, mais on
  // garde un repli sur l'IP par prudence — normalisé par `ipKeyGenerator`, qui
  // regroupe correctement les préfixes IPv6 (sans quoi un client IPv6 pourrait
  // contourner la limite en changeant d'adresse dans son /64).
  keyGenerator: (req) => (req.params.code
    ? `badgeuse:${req.params.code}`
    : `badgeuse-ip:${ipKeyGenerator(req.ip)}`),
  message: { error: 'rate_limited' },
});

/**
 * Authentification du poste. Réponse 401 GÉNÉRIQUE dans tous les cas (clé
 * absente, poste inconnu, poste inactif, clé fausse) : aucun détail exploitable
 * pour énumérer les postes.
 */
async function authenticateDevice(req, res, next) {
  const unauthorized = () => res.status(401).json({ error: 'unauthorized' });
  try {
    const provided = req.header('X-Device-Key') || '';
    const code = String(req.params.code || '');
    if (!provided || !code) return unauthorized();

    const r = await pool.query(
      `SELECT d.id, d.code, d.site_id, d.actif, d.api_key_hash, s.code AS site_code
       FROM badgeuse_devices d
       LEFT JOIN badgeuse_sites s ON s.id = d.site_id
       WHERE d.code = $1`,
      [code]
    );
    const device = r.rows[0];
    if (!device || !device.actif || !device.api_key_hash) return unauthorized();
    if (!timingSafeEqualHex(hashDeviceKey(provided), device.api_key_hash)) return unauthorized();

    req.device = device;
    next();
  } catch (err) {
    console.error('[BADGEUSE-DEVICE] Erreur authentification poste :', err.message);
    res.status(503).json({ error: 'service_unavailable' });
  }
}

/** ETag faible dérivé du contenu servi (change ⇔ le contenu change). */
function computeEtag(payload) {
  const h = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  return `W/"${h.slice(0, 16)}"`;
}

/** Répond 304 si l'ETag du client correspond, 200 + ETag sinon. */
function sendWithEtag(req, res, etag, payload) {
  res.set('ETag', etag);
  res.set('Cache-Control', 'no-cache');
  if (req.header('If-None-Match') === etag) return res.status(304).end();
  return res.json({ etag, ...payload });
}

const isUuid = (v) => /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(String(v || ''));
const isHex64 = (v) => /^[0-9a-fA-F]{64}$/.test(String(v || ''));

/**
 * Un pointage SANS badge (manuel ou import) est identifié par un `uid_hmac`
 * absent (`null`), vide, ou valant le `-` littéral — la forme canonique du
 * CONTRAT_INTEGRITE §2, celle que le poste sérialise par défaut. Les trois
 * formes sont ACCEPTÉES et stockées `NULL` en base ; `canonicalPointage`
 * recanonise `NULL` → `-`, si bien que la chaîne reste vérifiable des deux
 * côtés (QA-01).
 */
const isSansBadge = (v) => v == null || v === '' || String(v) === NO_BADGE;

// ═══════════════════════════════════════════════════════════════════════════
// POST /v1/devices/:code/pointages — dépôt d'un lot (idempotent)
// ═══════════════════════════════════════════════════════════════════════════
router.post('/v1/devices/:code/pointages',
  deviceLimiter,
  [param('code').isString().isLength({ min: 1, max: 30 })],
  validate,
  authenticateDevice,
  async (req, res) => {
    const lot = req.body && Array.isArray(req.body.pointages) ? req.body.pointages : null;
    if (!lot) {
      return res.status(400).json({ error: 'invalid_payload', detail: 'champ « pointages » (tableau) attendu' });
    }
    if (lot.length > LOT_MAX) {
      return res.status(400).json({ error: 'invalid_payload', detail: `lot de ${lot.length} éléments — maximum ${LOT_MAX}` });
    }

    const client = await pool.connect();
    const resultats = [];
    let inserts = 0;
    let orphelins = 0;
    let ruptures = 0;
    let invalides = 0;

    /**
     * Accusé TERMINAL `invalid` (CONTRAT_API_DEVICE §2.1 v1.1) : le poste purge
     * l'élément, il ne le rejouera jamais. Un rejet SILENCIEUX serait la pire
     * des issues — chaque cas est donc journalisé ici (code du poste, uuid et
     * raison : jamais d'UID de badge) et le poste le signale de son côté dans
     * le champ `alerte` de son heartbeat (QA-01/QA-02).
     */
    const rejeter = (liste, uuid, raison) => {
      invalides += 1;
      console.warn(`[BADGEUSE-DEVICE] ${req.device.code} : pointage ${uuid || '(uuid absent)'} refusé définitivement — ${raison}`);
      liste.push({ uuid: uuid || null, status: 'invalid', raison });
    };

    try {
      const params = await readBadgeuseParams();
      await client.query('BEGIN');

      // Dernier maillon connu de la chaîne de ce poste (séquence max).
      const last = await client.query(
        `SELECT sequence_device, hash_courant FROM badgeuse_pointages
         WHERE device_id = $1 AND sequence_device IS NOT NULL
         ORDER BY sequence_device DESC LIMIT 1`,
        [req.device.id]
      );
      let dernierHash = last.rows[0] ? last.rows[0].hash_courant : genesisHash(req.device.code);

      for (const p of lot) {
        // Validation syntaxique par élément : un élément malformé n'invalide
        // pas le lot, il est signalé — le poste ne peut pas boucler dessus.
        if (!isUuid(p && p.uuid)) {
          rejeter(resultats, (p && p.uuid) || null, 'uuid_invalide');
          continue;
        }
        const horodatage = isoMillisUTC(p.horodatage_utc);
        const sens = ['entree', 'sortie', 'inconnu'].includes(p.sens) ? p.sens : null;
        const source = ['badge', 'manuel', 'import'].includes(p.source) ? p.source : 'badge';
        // Un uid_hmac absent / vide / `-` est VALIDE (pointage sans badge) ;
        // toute AUTRE valeur doit être un condensat de 64 hex.
        if (!horodatage || !sens || (!isSansBadge(p.uid_hmac) && !isHex64(p.uid_hmac))) {
          rejeter(resultats, p.uuid, 'champs_invalides');
          continue;
        }

        const uidHmac = isSansBadge(p.uid_hmac) ? null : String(p.uid_hmac).toLowerCase();
        const sequence = Number.isFinite(parseInt(p.sequence_device, 10)) ? parseInt(p.sequence_device, 10) : null;

        // ── Vérification de la chaîne (CONTRAT_INTEGRITE §3) ──
        // `canonicalPointage` LÈVE sur une charge ambiguë (champ vide, ou
        // contenant le séparateur `|` — QA-08). C'est un payload que le rejeu
        // ne réparera jamais : accusé terminal `invalid`, jamais une boucle.
        let chaineValide = true;
        let canonical;
        try {
          canonical = canonicalPointage({
            uuid: p.uuid,
            device_code: req.device.code,
            sequence_device: sequence,
            // NULL en base ⇔ `-` dans la charge canonique : la symétrie avec
            // le poste est assurée par la valeur de repli de l'helper.
            uid_hmac: uidHmac,
            horodatage_utc: horodatage,
            sens,
            source,
          });
        } catch (e) {
          rejeter(resultats, p.uuid, 'canonique_invalide');
          continue;
        }
        const attendu = chainHash(p.hash_precedent || dernierHash, canonical);
        // 1. le hash reçu doit correspondre au recalcul (payload non altéré) ;
        // 2. le maillon précédent reçu doit être le dernier hash stocké.
        if (!p.hash_courant || String(p.hash_courant).toLowerCase() !== attendu) chaineValide = false;
        if (!p.hash_precedent || String(p.hash_precedent).toLowerCase() !== String(dernierHash).toLowerCase()) chaineValide = false;

        // ── Résolution du badge (jamais d'UID en clair : on ne connaît que le HMAC) ──
        let employeeId = null;
        let statut = 'brut';
        let orphelinRaison = null;
        if (uidHmac) {
          const b = await client.query(
            'SELECT employee_id, statut FROM badgeuse_badges WHERE uid_hmac = $1',
            [uidHmac]
          );
          if (b.rows.length === 0) {
            statut = 'orphelin';
            orphelinRaison = 'badge_inconnu';
          } else if (b.rows[0].statut !== 'actif') {
            statut = 'orphelin';
            orphelinRaison = 'badge_inactif';
          } else {
            employeeId = b.rows[0].employee_id;
          }
        }

        // Plage d'acceptation appliquée par le SERVEUR (le poste enregistre
        // tout) : hors plage → orphelin, jamais un rejet.
        if (statut !== 'orphelin' && engine.estHorsPlage(horodatage, params)) {
          statut = 'orphelin';
          orphelinRaison = 'hors_plage';
        }

        await client.query('SAVEPOINT badgeuse_item');
        try {
          const ins = await client.query(
            `INSERT INTO badgeuse_pointages
               (uuid, employee_id, device_id, uid_hmac, horodatage_utc, horodatage_local, fuseau,
                sens, source, statut, orphelin_raison, sequence_device,
                hash_precedent, hash_courant, chaine_valide)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
             ON CONFLICT (uuid) DO NOTHING
             RETURNING id`,
            [
              p.uuid, employeeId, req.device.id, uidHmac, horodatage,
              p.horodatage_local ? String(p.horodatage_local).slice(0, 30) : null,
              p.fuseau ? String(p.fuseau).slice(0, 40) : 'Europe/Paris',
              sens, source, statut, orphelinRaison, sequence,
              p.hash_precedent ? String(p.hash_precedent).toLowerCase() : null,
              p.hash_courant ? String(p.hash_courant).toLowerCase() : null,
              chaineValide,
            ]
          );
          await client.query('RELEASE SAVEPOINT badgeuse_item');

          if (ins.rows.length === 0) {
            // Idempotence : rejeu du même uuid → accusé de réception sans insertion.
            resultats.push({ uuid: p.uuid, status: 'duplicate' });
            continue;
          }

          inserts++;
          if (p.hash_courant) dernierHash = String(p.hash_courant).toLowerCase();

          const item = { uuid: p.uuid, status: statut === 'orphelin' ? 'orphan' : 'ok' };
          if (statut === 'orphelin') { item.raison = orphelinRaison; orphelins++; }
          if (!chaineValide) { item.avertissement = 'chain_broken'; ruptures++; }
          resultats.push(item);

          // Supervision temps réel — AUCUN identifiant de badge n'est diffusé.
          const io = req.app.get('io');
          if (io) {
            io.to('badgeuse:supervision').emit('badgeuse:pointage', {
              device_code: req.device.code,
              horodatage_utc: horodatage,
              sens,
              statut,
              orphelin_raison: orphelinRaison,
              chaine_valide: chaineValide,
            });
          }
        } catch (e) {
          await client.query('ROLLBACK TO SAVEPOINT badgeuse_item');
          await client.query('RELEASE SAVEPOINT badgeuse_item');
          if (e.code === '23505') {
            // Séquence de poste déjà utilisée : accusé de réception (le poste
            // purge) — l'anomalie reste visible dans /devices/:id/verify-chain.
            resultats.push({ uuid: p.uuid, status: 'duplicate', avertissement: 'sequence_reutilisee' });
          } else {
            // Erreur SQL non gérable par le poste (FK d'un salarié supprimé,
            // dépassement de BIGINT sur la séquence…) : accusé terminal, mais
            // la cause est journalisée côté serveur pour l'exploitant.
            console.error(`[BADGEUSE-DEVICE] ${req.device.code} : échec de stockage (${e.code || 'sans code'}) — ${e.message}`);
            rejeter(resultats, p.uuid, 'erreur_stockage');
          }
        }
      }

      await client.query('COMMIT');
      if (ruptures > 0) {
        console.warn(`[BADGEUSE-DEVICE] ${req.device.code} : ${ruptures} rupture(s) de chaîne détectée(s) sur ${lot.length} élément(s)`);
      }
      if (inserts > 0 || orphelins > 0) {
        console.log(`[BADGEUSE-DEVICE] ${req.device.code} : ${inserts} pointage(s) enregistré(s), ${orphelins} orphelin(s)`);
      }
      if (invalides > 0) {
        console.warn(`[BADGEUSE-DEVICE] ${req.device.code} : ${invalides} élément(s) refusé(s) définitivement sur ${lot.length} — à investiguer (le poste les purge et le signale par heartbeat)`);
      }
      res.json({ resultats, server_time_utc: new Date().toISOString() });
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch (_) { /* déjà hors transaction */ }
      console.error('[BADGEUSE-DEVICE] Erreur dépôt de lot :', err.message);
      // 503 : le poste conserve sa file et réessaie (backoff) — aucune heure perdue.
      res.status(503).json({ error: 'service_unavailable' });
    } finally {
      client.release();
    }
  });

// ═══════════════════════════════════════════════════════════════════════════
// GET /v1/devices/:code/badges — cache des badges actifs (ETag)
// MINIMISATION (exigence A5) : prénom + initiale du nom, RIEN d'autre.
// Ni nom complet, ni statut, ni équipe, ni parcours d'insertion.
// ═══════════════════════════════════════════════════════════════════════════
router.get('/v1/devices/:code/badges', deviceLimiter, authenticateDevice, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT b.uid_hmac, b.employee_id, e.first_name, e.last_name
       FROM badgeuse_badges b
       JOIN employees e ON e.id = b.employee_id
       WHERE b.statut = 'actif'
       ORDER BY b.employee_id`
    );
    const badges = r.rows.map((row) => ({
      uid_hmac: row.uid_hmac,
      salarie_id: row.employee_id,
      prenom: row.first_name || '',
      initiale_nom: String(row.last_name || '').trim().charAt(0).toUpperCase() || '',
    }));
    sendWithEtag(req, res, computeEtag(badges), { badges });
  } catch (err) {
    console.error('[BADGEUSE-DEVICE] Erreur cache badges :', err.message);
    res.status(503).json({ error: 'service_unavailable' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /v1/devices/:code/config — paramètres d'affichage et de capture (ETag)
// ═══════════════════════════════════════════════════════════════════════════
router.get('/v1/devices/:code/config', deviceLimiter, authenticateDevice, async (req, res) => {
  try {
    const p = await readBadgeuseParams();
    // overlay_duree_sec est déjà reborné 3–8 s par readBadgeuseParams (exigence
    // juridique §3.5) ; le poste re-borne de son côté : double plafond.
    const config = {
      overlay_duree_sec: p.overlay_duree_sec,
      anti_rebond_sec: p.anti_rebond_sec,
      affichage_cumul_hebdo: p.affichage_cumul_hebdo,
      plage_acceptation: { debut: p.plage_acceptation_debut, fin: p.plage_acceptation_fin },
      dpms: { extinction: p.dpms_extinction, allumage: p.dpms_allumage },
      heartbeat_interval_sec: p.heartbeat_interval_sec,
      sync_badges_interval_sec: p.sync_badges_interval_sec,
      sync_playlist_interval_sec: p.sync_playlist_interval_sec,
    };
    sendWithEtag(req, res, computeEtag(config), { config });
  } catch (err) {
    console.error('[BADGEUSE-DEVICE] Erreur config :', err.message);
    res.status(503).json({ error: 'service_unavailable' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /v1/devices/:code/playlist — contenus de veille (ETag)
// Aucune donnée personnelle (finalité communication interne dissociée).
// ═══════════════════════════════════════════════════════════════════════════
router.get('/v1/devices/:code/playlist', deviceLimiter, authenticateDevice, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, type, titre, corps, media_url, duree_sec, ordre
       FROM badgeuse_contenus
       WHERE actif = true
         AND (site_id IS NULL OR site_id = $1)
         AND (visible_du IS NULL OR visible_du <= CURRENT_DATE)
         AND (visible_au IS NULL OR visible_au >= CURRENT_DATE)
       ORDER BY ordre, id`,
      [req.device.site_id]
    );
    const elements = r.rows.map((x) => ({
      id: x.id,
      type: x.type,
      titre: x.titre,
      corps: x.corps,
      media_url: x.media_url,
      duree_sec: x.duree_sec,
      ordre: x.ordre,
    }));
    sendWithEtag(req, res, computeEtag(elements), { elements });
  } catch (err) {
    console.error('[BADGEUSE-DEVICE] Erreur playlist :', err.message);
    res.status(503).json({ error: 'service_unavailable' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /v1/devices/:code/heartbeat — supervision (BO-09)
// ═══════════════════════════════════════════════════════════════════════════
router.post('/v1/devices/:code/heartbeat',
  deviceLimiter,
  [body('version').optional().isString().isLength({ max: 30 })],
  validate,
  authenticateDevice,
  async (req, res) => {
    try {
      const hb = req.body || {};
      // Liste blanche : on ne stocke que les champs du contrat (pas de champ
      // libre qui pourrait charrier une donnée personnelle).
      // `alerte` (CONTRAT_API_DEVICE §2.5, amendement v1.1 — QA-02) : signal
      // d'exploitation émis par le poste (lot refusé 400, éléments `invalid`
      // purgés, lecteur débranché…). Il était jusqu'ici JETÉ par cette liste
      // blanche, ce qui rendait la panne invisible depuis le back-office.
      // Borné à 300 caractères : c'est un signal technique, pas un journal.
      const alerte = hb.alerte == null || hb.alerte === ''
        ? null
        : String(hb.alerte).slice(0, 300);
      const info = {
        version: hb.version ?? null,
        horloge_utc: hb.horloge_utc ?? null,
        derive_estimee_sec: hb.derive_estimee_sec ?? null,
        taille_file: hb.taille_file ?? null,
        temperature_cpu: hb.temperature_cpu ?? null,
        disque_libre_mo: hb.disque_libre_mo ?? null,
        cible: hb.cible ?? null,
        reader_mode: hb.reader_mode ?? null,
        throttled: hb.throttled ?? null,
        alerte,
      };

      await pool.query(
        `UPDATE badgeuse_devices
         SET dernier_heartbeat = NOW(),
             version_logicielle = COALESCE($2, version_logicielle),
             cible = COALESCE($3, cible),
             heartbeat_info = $4
         WHERE id = $1`,
        [
          req.device.id,
          info.version ? String(info.version).slice(0, 30) : null,
          info.cible ? String(info.cible).slice(0, 10) : null,
          JSON.stringify(info),
        ]
      );

      // Anomalies journalisées (dérive d'horloge, throttling, file qui gonfle) —
      // le poste ne porte AUCUNE donnée RH dans son heartbeat.
      const derive = Math.abs(Number(info.derive_estimee_sec) || 0);
      if (derive > 2) console.warn(`[BADGEUSE-DEVICE] ${req.device.code} : dérive d'horloge ${derive}s`);
      if (info.throttled === true) console.warn(`[BADGEUSE-DEVICE] ${req.device.code} : throttling CPU signalé`);
      if (Number(info.taille_file) > 0) console.log(`[BADGEUSE-DEVICE] ${req.device.code} : file locale de ${info.taille_file} élément(s)`);
      if (alerte) console.warn(`[BADGEUSE-DEVICE] ${req.device.code} : alerte du poste — ${alerte}`);
      if (info.reader_mode === 'decimal') console.warn(`[BADGEUSE-DEVICE] ${req.device.code} : lecteur en mode décimal — à reconfigurer en hexadécimal (SPEC §3.6)`);

      res.json({ status: 'ok', server_time_utc: new Date().toISOString() });
    } catch (err) {
      console.error('[BADGEUSE-DEVICE] Erreur heartbeat :', err.message);
      res.status(503).json({ error: 'service_unavailable' });
    }
  });

module.exports = router;
