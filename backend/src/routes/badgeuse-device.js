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
 *    invalide, horodatage illisible, charge canonique ambiguë, donnée refusée
 *    par la base en SQLSTATE 22xxx/23xxx). Il est JOURNALISÉ ici et remonte
 *    dans le champ `alerte` du heartbeat du poste : une purge silencieuse
 *    serait le pire des cas. Un `uid_hmac` valant `-` (pointage manuel/import,
 *    CONTRAT_INTEGRITE §2) est en revanche VALIDE : il est stocké NULL en base
 *    et reste `-` dans le calcul de chaîne (QA-01).
 *  - `retry` (v1.2, QA-13) n'est PAS un accusé : tout échec de stockage qui
 *    n'est pas démontrablement une erreur de DONNÉES (timeout, disque, verrou,
 *    connexion, erreur sans SQLSTATE) laisse l'élément dans la file du poste.
 *    Un incident d'infrastructure ne détruit jamais une heure de travail.
 *  - AUCUNE HEURE NE SE PERD : une rupture de chaîne n'empêche pas le stockage
 *    (chaine_valide = false + avertissement `chain_broken`). On n'efface jamais
 *    une preuve, même imparfaite.
 *  - Le lot n'est jamais rejeté en bloc pour un élément fautif : SAVEPOINT par
 *    élément (même parade que l'import paie, cf. 2.3.1).
 */
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const router = express.Router();
const pool = require('../config/database');
const { body, param } = require('express-validator');
const { validate } = require('../middleware/validate');
const {
  canonicalPointage, genesisHash, chainHash, hashDeviceKey, timingSafeEqualHex, isoMillisUTC,
  NO_BADGE, hashAppairageCode, generateDeviceKey, generateSiteKey, encryptSecret, decryptSecret,
} = require('../utils/badgeuse-crypto');
const { readBadgeuseParams, hmacKeySettingKey, writeSetting } = require('../utils/badgeuse-settings');
const engine = require('../services/badgeuse-engine');
const media = require('../services/badgeuse-social');
// Périmètre de caisse d'une VAK : SOURCE UNIQUE partagée avec routes/vak.js
// (l'écran promotionnel doit compter exactement ce que compte le module VAK,
// sinon deux chiffres circulent dans la maison).
const { sqlPerimetreCaisse } = require('../services/sumup');

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

/**
 * Nature d'un échec d'insertion, d'après son SQLSTATE (CONTRAT_API_DEVICE §2.1,
 * amendement v1.2 — QA-13). C'est la frontière entre « on peut purger » et
 * « il faut garder » : s'y tromper détruit une heure de travail.
 *
 *  - `'invalid'` (PERMANENT, accusé terminal) : classes **22** (données
 *    erronées : 22P02 texte non convertible, 22001 débordement, 22003 valeur
 *    hors bornes) et **23** (violation de contrainte : 23502 NOT NULL, 23503
 *    clé étrangère, 23514 CHECK). Le contenu de l'élément est en cause —
 *    aucun rejeu ne le réparera. `23505` est traité en amont (`duplicate`).
 *  - `'retry'` (TRANSITOIRE, PAS un accusé) : tout le reste — 57xxx (timeout
 *    d'instruction, arrêt administrateur), 53xxx (disque plein, mémoire,
 *    connexions épuisées), 40xxx (échec de sérialisation, interblocage),
 *    08xxx (connexion perdue), 25xxx (transaction avortée), ainsi que toute
 *    erreur SANS SQLSTATE (indisponibilité du pool, coupure réseau, bug JS).
 *    La cause est l'INFRASTRUCTURE, pas la donnée : le poste conserve
 *    l'élément et le représentera.
 *
 * DOCTRINE : le doute profite à la preuve. Tout ce qui n'est pas
 * démontrablement une erreur de données est traité comme transitoire.
 */
function classerErreurStockage(err) {
  const code = err && typeof err.code === 'string' ? err.code.trim() : '';
  if (!/^[0-9A-Za-z]{5}$/.test(code)) return 'retry';
  const classe = code.slice(0, 2);
  return classe === '22' || classe === '23' ? 'invalid' : 'retry';
}

// ═══════════════════════════════════════════════════════════════════════════
// POST /v1/appairage — réclamation de configuration par CODE COURT (ADR-0005)
// ───────────────────────────────────────────────────────────────────────────
// SEULE route de ce fichier SANS `X-Device-Key` : le poste n'a pas encore de
// clé, c'est précisément ce qu'il vient chercher. Elle est donc montée AVANT
// les routes `:code`, hors du middleware `authenticateDevice`.
//
// Le secret présenté est un code de 8 caractères. Les garde-fous (ADR-0005
// §Analyse de risque) : usage unique, expiration courte, portée d'un seul
// poste, débit strictement limité, message d'échec générique.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Limiteur DÉDIÉ à la réclamation : 20 tentatives/heure/IP (ADR-0005). Il est
 * distinct de `deviceLimiter` (120/min) — celui-ci protège l'exploitation
 * normale d'un poste appairé, celui-là borde une devinette de secret court.
 * La clé est l'IP normalisée par `ipKeyGenerator` : sans elle, un client IPv6
 * changerait d'adresse dans son /64 pour repartir à zéro.
 */
const appairageLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `badgeuse-appairage:${ipKeyGenerator(req.ip)}`,
  message: { error: 'rate_limited' },
});

// Plancher de temps de réponse sur ÉCHEC. Deux effets : les rejets coûtent
// tous la même durée, qu'ils viennent d'un code malformé (aucune requête) ou
// d'un code bien formé mais faux (une requête) — plus d'oracle de forme ; et
// une campagne de devinettes est ralentie même sous le plafond de débit.
// Le SUCCÈS, lui, est plus long (transaction) : ce n'est pas une fuite, celui
// qui réussit sait déjà qu'il a réussi.
const APPAIRAGE_ECHEC_DELAI_MS = 250;
const attendre = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * Adresse du serveur remise au poste. CASCADE HONNÊTE, jamais une valeur
 * inventée à la volée : réglage `badgeuse.server_url` (renseigné quand le
 * poste doit joindre SOLIDATA par une autre adresse — VPN, nom interne) →
 * `PUBLIC_BASE_URL` de l'environnement (déjà la source d'URL publique du
 * dépôt, cf. SumUp) → domaine de production documenté en dernier recours.
 */
async function resolveServerUrl() {
  const params = await readBadgeuseParams();
  const configure = String(params.server_url || '').trim();
  if (configure) return configure.replace(/\/+$/, '');
  const env = String(process.env.PUBLIC_BASE_URL || '').trim();
  if (env) return env.replace(/\/+$/, '');
  return 'https://solidata.online';
}

router.post('/v1/appairage', appairageLimiter, async (req, res) => {
  // Message d'échec UNIQUE : inconnu, expiré, déjà consommé, poste désactivé —
  // rien ne les distingue côté client (CONTRAT_API_DEVICE §3ter). Distinguer
  // « expiré » de « inconnu » confirmerait à un attaquant qu'il a deviné un
  // code, ce qui vaut la moitié du travail.
  const refuser = async () => {
    await attendre(APPAIRAGE_ECHEC_DELAI_MS);
    return res.status(404).json({ error: 'code_invalide' });
  };

  try {
    // Normalisation + condensat en une passe : le code en clair ne sort pas
    // d'ici, et un code malformé n'atteint jamais la base.
    const hash = hashAppairageCode(req.body && req.body.code);
    if (!hash) return refuser();

    const candidats = await pool.query(
      `SELECT id, code, site_id, cible, appairage_code_hash
       FROM badgeuse_devices
       WHERE actif = true
         AND appairage_code_hash IS NOT NULL
         AND appairage_expire_le IS NOT NULL
         AND appairage_expire_le > NOW()`
    );

    // Comparaison à TEMPS CONSTANT, et parcours COMPLET (pas de `break`) : ni
    // la valeur du condensat ni la position du poste dans la liste ne se
    // lisent dans la durée de la réponse.
    let device = null;
    for (const row of candidats.rows) {
      if (timingSafeEqualHex(hash, row.appairage_code_hash)) device = row;
    }
    if (!device) return refuser();

    // Lu AVANT la transaction : aucune requête de confort au milieu d'un
    // verrou d'écriture.
    const serverUrl = await resolveServerUrl();

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // CONSOMMATION ATOMIQUE. Le `WHERE` reprend le condensat et l'échéance :
      // deux postes qui présentent le même code au même instant, un seul
      // l'obtient — le second retombe sur le refus générique. (Cette égalité
      // SQL n'est pas l'authentification : celle-ci a eu lieu ci-dessus, à
      // temps constant. C'est un verrou d'unicité sur une valeur déjà validée.)
      //
      // La clé du poste est RÉGÉNÉRÉE ici : réinstaller un poste révoque
      // automatiquement sa clé précédente (ADR-0005 §Conséquences).
      const apiKey = generateDeviceKey();
      const upd = await client.query(
        `UPDATE badgeuse_devices
         SET api_key_hash = $2, appairage_code_hash = NULL, appairage_expire_le = NULL
         WHERE id = $1 AND appairage_code_hash = $3 AND appairage_expire_le > NOW()
         RETURNING id, code, site_id, cible`,
        [device.id, hashDeviceKey(apiKey), hash]
      );
      if (upd.rows.length === 0) {
        await client.query('ROLLBACK');
        return refuser();
      }
      const poste = upd.rows[0];

      // Clé HMAC du site (CONTRAT_HMAC §3) : générée à la volée si le site
      // n'en a pas encore — même logique que POST /badgeuse/devices.
      let hmacKey = null;
      if (poste.site_id != null) {
        const cle = hmacKeySettingKey(poste.site_id);
        const ex = await client.query('SELECT value FROM settings WHERE key = $1', [cle]);
        const stocke = ex.rows[0] ? ex.rows[0].value : null;
        if (!stocke) {
          hmacKey = generateSiteKey();
          await writeSetting(cle, encryptSecret(hmacKey), client);
        } else {
          hmacKey = decryptSecret(stocke);
          if (!hmacKey) {
            // JAMAIS DE ROTATION SILENCIEUSE : régénérer la clé d'un site qui
            // en a déjà une invaliderait TOUS les `uid_hmac` déjà stockés —
            // tous les badges seraient à réenrôler, sans que personne ne l'ait
            // demandé. On échoue franchement, l'exploitant tranche.
            await client.query('ROLLBACK');
            console.error(`[BADGEUSE-DEVICE] Clé HMAC illisible pour le site ${poste.site_id} : appairage du poste ${poste.code} refusé (aucune rotation silencieuse)`);
            return res.status(503).json({ error: 'service_unavailable' });
          }
        }
      }

      // Consommation tracée (ADR-0005). `user_id` NULL : l'acte vient du poste,
      // pas d'un utilisateur SOLIDATA — l'émission, elle, porte son ADMIN.
      await client.query(
        'INSERT INTO rgpd_audit_log (user_id, action, entity_type, entity_id, details) VALUES ($1, $2, $3, $4, $5)',
        [null, 'BADGEUSE_APPAIRAGE_CONSOMME', 'badgeuse_devices', poste.id,
          JSON.stringify({
            device_code: poste.code,
            site_id: poste.site_id,
            cle_poste: 'regeneree',
            source: 'code_appairage',
          })]
      );
      await client.query('COMMIT');

      // Le poste, jamais le code ni les clés.
      console.log(`[BADGEUSE-DEVICE] Appairage réussi du poste ${poste.code} (clé régénérée, code consommé)`);

      return res.json({
        device_code: poste.code,
        device_key: apiKey,
        hmac_key: hmacKey,
        server_url: serverUrl,
        cible: poste.cible || null,
      });
    } catch (errTx) {
      try { await client.query('ROLLBACK'); } catch (_) { /* déjà hors transaction */ }
      throw errTx;
    } finally {
      // UNE seule libération, quel que soit le chemin de sortie : libérer dans
      // chaque branche exposerait à un double `release()` si quoi que ce soit
      // échouait après coup (le pool le refuse).
      client.release();
    }
  } catch (err) {
    console.error('[BADGEUSE-DEVICE] Erreur appairage :', err.message);
    return res.status(503).json({ error: 'service_unavailable' });
  }
});

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
    let differes = 0;

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

    /**
     * Statut `retry` (CONTRAT_API_DEVICE §2.1 v1.2 — QA-13). Ce n'est PAS un
     * accusé de réception : l'élément n'est pas inséré, le poste le CONSERVE
     * dans sa file et le représentera au prochain lot. C'est la seule issue
     * acceptable pour un incident de stockage passager — un timeout de base ne
     * doit jamais détruire un pointage.
     */
    const differer = (liste, uuid, raison) => {
      differes += 1;
      liste.push({ uuid: uuid || null, status: 'retry', raison });
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

      // Boucle INDEXÉE : sur un incident transitoire, il faut pouvoir différer
      // tout le reste du lot (cf. le bloc `catch` d'insertion ci-dessous).
      for (const [index, p] of lot.entries()) {
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
          // Le retour au point de sauvegarde peut lui-même échouer si la
          // transaction ou la connexion est perdue : on le constate au lieu de
          // le supposer (une exception ici partirait au catch externe → 503,
          // ce qui est sûr mais moins précis pour le poste).
          let savepointOk = true;
          try {
            await client.query('ROLLBACK TO SAVEPOINT badgeuse_item');
            await client.query('RELEASE SAVEPOINT badgeuse_item');
          } catch (_) {
            savepointOk = false;
          }

          if (savepointOk && e.code === '23505') {
            // Séquence de poste déjà utilisée : accusé de réception (le poste
            // purge) — l'anomalie reste visible dans /devices/:id/verify-chain.
            resultats.push({ uuid: p.uuid, status: 'duplicate', avertissement: 'sequence_reutilisee' });
            continue;
          }

          // État transactionnel perdu ⇒ on ne peut RIEN affirmer sur la donnée :
          // le doute profite à la preuve, l'élément est différé.
          const nature = savepointOk ? classerErreurStockage(e) : 'retry';
          console.error(`[BADGEUSE-DEVICE] ${req.device.code} : échec de stockage (SQLSTATE ${e.code || 'absent'}, traité en « ${nature} ») — ${e.message}`);

          if (nature === 'invalid') {
            // Donnée définitivement non stockable (FK d'un salarié supprimé,
            // dépassement de bornes…) : accusé terminal, journalisé.
            rejeter(resultats, p.uuid, 'erreur_stockage');
            continue;
          }

          // ── Incident TRANSITOIRE : le lot s'arrête ici (QA-13) ──
          // On ne tente PAS les éléments suivants, pour deux raisons :
          //  1. INTÉGRITÉ DE LA CHAÎNE — les pointages sont chaînés par
          //     séquence. Insérer l'élément N+1 alors que N a été différé
          //     ferait échouer la vérification de chaîne de N à son rejeu
          //     (son `hash_precedent` ne correspondrait plus au dernier hash
          //     stocké) : on transformerait un incident d'infrastructure en
          //     rupture de preuve permanente.
          //  2. La cause n'est pas propre à l'élément (base sous tension,
          //     connexion perdue) : poursuivre produirait une cascade
          //     d'erreurs, potentiellement « transaction avortée » (25P02).
          // Tout le reste du lot est donc différé — le poste le conserve
          // intégralement et le représentera dans l'ordre.
          differer(resultats, p.uuid, 'erreur_transitoire');
          for (const restant of lot.slice(index + 1)) {
            differer(resultats, restant && restant.uuid, 'lot_interrompu');
          }
          break;
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
      if (differes > 0) {
        console.error(`[BADGEUSE-DEVICE] ${req.device.code} : ${differes} élément(s) différé(s) sur ${lot.length} — incident de stockage transitoire, le poste les CONSERVE et les représentera (aucune heure perdue)`);
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
//
// v1.3 (CDC_AFFICHAGE_V2 §1, ADR-0004 §4) — trois DRAPEAUX s'ajoutent, et
// RIEN de plus :
//   `premier_jour` (bool), `anniversaire` (bool),
//   `anniversaire_entreprise_annees` (entier ≥ 1 | null).
// La DATE DE NAISSANCE NE QUITTE JAMAIS LE SERVEUR : la comparaison de
// jour/mois est faite ici, en SQL, et seul son RÉSULTAT part. Un poste volé
// ne livre donc aucune date d'anniversaire.
//   - `anniversaire` / `anniversaire_entreprise_annees` : uniquement pour les
//     salariés ayant donné leur accord (`employees.badgeuse_optin_festif`,
//     défaut false) ET si l'affichage festif est activé (`badgeuse.festif_actif`)
//     — on n'envoie pas une donnée qui ne sera pas affichée.
//   - `premier_jour` : envoyé SANS condition d'opt-in. Un message de bienvenue
//     n'est pas un anniversaire : il ne divulgue aucune donnée d'état civil,
//     seulement le fait qu'une personne arrive — ce que l'atelier voit de
//     toute façon. Il vaut false quand aucune date de début n'est connue
//     (jamais deviné : « jamais de valeur inventée »).
// ═══════════════════════════════════════════════════════════════════════════

/** Colonnes de base du cache (sans les drapeaux v1.3) — repli documenté. */
const BADGES_SQL_LEGACY = `
  SELECT b.uid_hmac, b.employee_id, e.first_name, e.last_name,
         false AS optin, false AS anniversaire, NULL::int AS anniversaire_annees,
         false AS premier_jour
  FROM badgeuse_badges b
  JOIN employees e ON e.id = b.employee_id
  WHERE b.statut = 'actif'
  ORDER BY b.employee_id`;

/**
 * Cache badges enrichi. `$1` = jour civil Paris (YYYY-MM-DD), `$2` = son
 * « MM-DD » : les deux sont calculés côté serveur pour que la bascule de date
 * suive l'heure de Paris et non celle du conteneur (doctrine 2.20.0).
 * `premier_jour` : un contrat dont le début EST aujourd'hui (source
 * `employee_contracts`, comme heuresHebdoContractuelles), avec repli sur la
 * date d'embauche de la fiche quand aucun contrat n'est importé.
 */
const BADGES_SQL_V13 = `
  SELECT b.uid_hmac, b.employee_id, e.first_name, e.last_name,
         COALESCE(e.badgeuse_optin_festif, false) AS optin,
         (e.birth_date IS NOT NULL AND to_char(e.birth_date, 'MM-DD') = $2) AS anniversaire,
         CASE
           WHEN e.seniority_date IS NOT NULL
                AND to_char(e.seniority_date, 'MM-DD') = $2
                AND EXTRACT(YEAR FROM age($1::date, e.seniority_date))::int >= 1
           THEN EXTRACT(YEAR FROM age($1::date, e.seniority_date))::int
         END AS anniversaire_annees,
         (
           EXISTS (
             SELECT 1 FROM employee_contracts ec
             WHERE ec.employee_id = e.id AND ec.start_date = $1::date
           )
           OR (
             NOT EXISTS (SELECT 1 FROM employee_contracts ec2 WHERE ec2.employee_id = e.id)
             AND e.contract_start = $1::date
           )
         ) AS premier_jour
  FROM badgeuse_badges b
  JOIN employees e ON e.id = b.employee_id
  WHERE b.statut = 'actif'
  ORDER BY b.employee_id`;

router.get('/v1/devices/:code/badges', deviceLimiter, authenticateDevice, async (req, res) => {
  try {
    const aujourdhui = engine.parisDateStr(new Date());
    const jourMois = aujourdhui.slice(5); // « MM-DD »
    const params = await readBadgeuseParams();

    let r;
    try {
      r = await pool.query(BADGES_SQL_V13, [aujourdhui, jourMois]);
    } catch (err) {
      // Base pas encore migrée (colonne absente, SQLSTATE 42703) : le cache
      // badges est le chemin le plus critique du dispositif — il DOIT continuer
      // de servir, quitte à le faire sans les drapeaux festifs.
      if (err.code !== '42703') throw err;
      console.warn('[BADGEUSE-DEVICE] Cache badges servi sans les drapeaux d\'affichage v2 (base non migrée) — exécutez init-db');
      r = await pool.query(BADGES_SQL_LEGACY);
    }

    const festifActif = params.festif_actif !== false;
    const badges = r.rows.map((row) => {
      // Le consentement conditionne les DEUX drapeaux d'anniversaire.
      const festif = festifActif && row.optin === true;
      const annees = parseInt(row.anniversaire_annees, 10);
      return {
        uid_hmac: row.uid_hmac,
        salarie_id: row.employee_id,
        prenom: row.first_name || '',
        initiale_nom: String(row.last_name || '').trim().charAt(0).toUpperCase() || '',
        premier_jour: row.premier_jour === true,
        anniversaire: festif && row.anniversaire === true,
        anniversaire_entreprise_annees: festif && Number.isFinite(annees) && annees >= 1 ? annees : null,
      };
    });
    // Les drapeaux entrent dans le calcul de l'ETag (ils font partie du contenu
    // servi) : le poste reçoit donc bien un 200 le jour où un anniversaire
    // tombe, au lieu d'un 304 sur le cache de la veille.
    sendWithEtag(req, res, computeEtag(badges), { badges });
  } catch (err) {
    console.error('[BADGEUSE-DEVICE] Erreur cache badges :', err.message);
    res.status(503).json({ error: 'service_unavailable' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /v1/devices/:code/config — paramètres d'affichage et de capture (ETag)
//
// v1.3 : bloc `affichage` (gabarits de message, plages des moments, vivier de
// phrases, interrupteurs). AUCUNE règle n'est codée dans le poste (ADR-0002) :
// tout descend d'ici, et le poste se contente de substituer `{prenom}`.
// ═══════════════════════════════════════════════════════════════════════════
router.get('/v1/devices/:code/config', deviceLimiter, authenticateDevice, async (req, res) => {
  try {
    const p = await readBadgeuseParams();

    // Les jours de VAK, la playlist porte un écran promotionnel dont les
    // compteurs bougent : le serveur abaisse lui-même la cadence de
    // rafraîchissement à 300 s (CONTRAT_API_DEVICE §3bis). Résilient : si la
    // table VAK est inaccessible, on garde la cadence paramétrée.
    let syncPlaylist = p.sync_playlist_interval_sec;
    let vakActive = false;
    try {
      vakActive = !!(await vakDuJour());
      if (vakActive) syncPlaylist = Math.min(Number(syncPlaylist) || 900, VAK_SYNC_PLAYLIST_SEC);
    } catch (_) { /* cadence paramétrée conservée */ }

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
      sync_playlist_interval_sec: syncPlaylist,
      media_cache_max_mo: p.media_cache_max_mo,
      affichage: {
        messages: {
          matin: p.msg_matin,
          pause: p.msg_pause,
          retour: p.msg_retour,
          soir: p.msg_soir,
          premier_jour: p.msg_premier_jour,
          anniversaire: p.msg_anniversaire,
          anniversaire_entreprise: p.msg_anniversaire_entreprise,
        },
        plages_moments: {
          matin_fin: p.moment_matin_fin,
          pause_debut: p.moment_pause_debut,
          pause_fin: p.moment_pause_fin,
          retour_fin: p.moment_retour_fin,
          soir_debut: p.moment_soir_debut,
        },
        phrases_motivation: Array.isArray(p.phrases_motivation) ? p.phrases_motivation : [],
        motivation_active: p.motivation_active !== false,
        festif_actif: p.festif_actif !== false,
      },
    };
    sendWithEtag(req, res, computeEtag(config), { config });
  } catch (err) {
    console.error('[BADGEUSE-DEVICE] Erreur config :', err.message);
    res.status(503).json({ error: 'service_unavailable' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GÉNÉRATEURS DE PLAYLIST (v1.3) — le contenu dynamique est construit ICI,
// côté serveur, jamais par le poste.
//
// DEUX INVARIANTS gouvernent tout ce bloc :
//  1. AUCUN NOM COMPLET, AUCUNE DONNÉE DE PARCOURS. Les annonces festives ne
//     portent que « prénom + initiale » (ADR-0004 §1) et n'existent que pour
//     les salariés ayant consenti. Les tournées ne portent JAMAIS le nom du
//     chauffeur (ADR-0004 §5 : ce serait une géolocalisation indirecte d'une
//     personne, devant une audience nouvelle).
//  2. RIEN N'EST INVENTÉ. Un générateur sans donnée du jour est OMIS de la
//     playlist — pas d'écran vide, pas de « 0 » présenté comme un résultat.
// ═══════════════════════════════════════════════════════════════════════════

/** Cadence de rafraîchissement imposée les jours de VAK (CONTRAT_API_DEVICE §3bis). */
const VAK_SYNC_PLAYLIST_SEC = 300;

/** Types dont le contenu est produit par le serveur à chaque construction. */
const TYPES_GENERES = ['annonces', 'actus', 'tournees', 'social', 'vak_live', 'meteo', 'presse'];

/** Configuration JSONB d'un contenu, tolérante (jamais bloquante). */
function contenuConfig(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(String(raw)) || {}; } catch (_) { return {}; }
}

/** Entier borné lu dans la config d'un générateur. */
function nbConfig(config, cle, defaut, max) {
  const n = parseInt(config[cle], 10);
  if (!Number.isFinite(n) || n < 1) return defaut;
  return Math.min(n, max);
}

/**
 * Anniversaires du jour (naissance + entrée dans la structure).
 * PRÉNOM + INITIALE uniquement, opt-in obligatoire, salariés actifs. La date
 * de naissance ne sort pas de SQL : seule la coïncidence jour/mois en sort.
 */
async function buildAnnonces(jourParis) {
  const jourMois = jourParis.slice(5);
  const r = await pool.query(
    `SELECT e.first_name, e.last_name,
            (e.birth_date IS NOT NULL AND to_char(e.birth_date, 'MM-DD') = $2) AS anniversaire,
            CASE
              WHEN e.seniority_date IS NOT NULL
                   AND to_char(e.seniority_date, 'MM-DD') = $2
                   AND EXTRACT(YEAR FROM age($1::date, e.seniority_date))::int >= 1
              THEN EXTRACT(YEAR FROM age($1::date, e.seniority_date))::int
            END AS annees
     FROM employees e
     WHERE COALESCE(e.badgeuse_optin_festif, false) = true
       AND COALESCE(e.is_active, true) = true`,
    [jourParis, jourMois]
  );

  const annonces = [];
  for (const row of r.rows) {
    const prenom = row.first_name || '';
    const initiale = String(row.last_name || '').trim().charAt(0).toUpperCase() || '';
    const annees = parseInt(row.annees, 10);
    if (row.anniversaire === true) {
      annonces.push({ prenom, initiale, type: 'anniversaire', annees: null });
    }
    if (Number.isFinite(annees) && annees >= 1) {
      annonces.push({ prenom, initiale, type: 'anniversaire_entreprise', annees });
    }
  }
  return annonces;
}

/** Dernières brèves du fil d'actualités (épinglées d'abord). */
async function buildActus(limite) {
  const r = await pool.query(
    `SELECT title, summary, source_name
     FROM news_articles
     ORDER BY is_pinned DESC NULLS LAST, created_at DESC, id DESC
     LIMIT $1`,
    [limite]
  );
  return r.rows.map((x) => ({
    titre: x.title,
    resume: x.summary || null,
    source: x.source_name || null,
  }));
}

/**
 * Tournées en cours — SANS NOM DE CHAUFFEUR (ADR-0004 §5). La requête ne joint
 * même pas `employees` : ce qui n'est pas lu ne peut pas fuir par distraction.
 * Progression comptée sur les DEUX natures de points (CAV et points
 * d'association), sinon une tournée « associations » afficherait 0/0.
 */
async function buildTournees(jourParis) {
  const r = await pool.query(
    `SELECT t.id, t.status, t.collection_type,
            v.name AS vehicule_nom, v.registration,
            (SELECT COUNT(*) FROM tour_cav tc WHERE tc.tour_id = t.id)
              + (SELECT COUNT(*) FROM tour_association_point tap WHERE tap.tour_id = t.id) AS total,
            (SELECT COUNT(*) FROM tour_cav tc WHERE tc.tour_id = t.id AND tc.status = 'collected')
              + (SELECT COUNT(*) FROM tour_association_point tap WHERE tap.tour_id = t.id AND tap.status = 'collected') AS faits
     FROM tours t
     LEFT JOIN vehicles v ON v.id = t.vehicle_id
     WHERE t.date = $1::date AND t.status IN ('planned', 'in_progress', 'returning')
     ORDER BY t.id`,
    [jourParis]
  );
  return r.rows.map((x) => ({
    libelle: x.collection_type === 'association' ? 'Tournée associations' : 'Tournée CAV',
    vehicule: x.vehicule_nom || x.registration || null,
    statut: x.status,
    points_faits: Number(x.faits) || 0,
    points_total: Number(x.total) || 0,
  }));
}

/** VAK active aujourd'hui (jour civil Paris) — même borne que /vak/live/current. */
async function vakDuJour() {
  const jour = engine.parisDateStr(new Date());
  const r = await pool.query(
    `SELECT id, libelle, poids_objectif_kg, ca_objectif_ttc
     FROM vaks WHERE $1::date BETWEEN date_debut AND date_fin
     ORDER BY date_debut DESC LIMIT 1`,
    [jour]
  );
  return r.rows[0] || null;
}

/**
 * Écran promotionnel VAK : poids cumulé vendu depuis l'ouverture, objectif,
 * chiffre d'affaires. Aucune donnée personnelle (vocation visiteurs).
 * Le PÉRIMÈTRE DE CAISSE est celui du module VAK (`sqlPerimetreCaisse`) :
 * l'écran ne peut pas afficher un chiffre différent du tableau de bord.
 */
async function buildVakLive() {
  const vak = await vakDuJour();
  if (!vak) return null;
  const c = await pool.query(
    `SELECT COALESCE(SUM(t.poids_kg), 0)::float AS poids,
            COALESCE(SUM(t.total_ttc), 0)::float AS ca,
            COUNT(*)::int AS tickets
     FROM vak_tickets t JOIN vaks vk ON vk.id = t.vak_id
     WHERE t.vak_id = $1 AND ${sqlPerimetreCaisse('vk', 't')}`,
    [vak.id]
  );
  const compteurs = c.rows[0] || {};
  return {
    libelle: vak.libelle,
    poids_kg: Math.round((Number(compteurs.poids) || 0) * 10) / 10,
    objectif_poids_kg: vak.poids_objectif_kg == null ? null : Number(vak.poids_objectif_kg),
    ca_ttc: Math.round((Number(compteurs.ca) || 0) * 100) / 100,
    objectif_ca_ttc: vak.ca_objectif_ttc == null ? null : Number(vak.ca_objectif_ttc),
    tickets: Number(compteurs.tickets) || 0,
  };
}

/**
 * Anti-acharnement du rattrapage météo.
 *
 * Le rattrapage sert le cas « poste appairé entre deux passages du job ». Si
 * Open-Meteo est en panne, il ne doit pas se rejouer à CHAQUE lecture de
 * playlist : la requête du poste attendrait le délai maximal à chaque fois,
 * pour rien. Un échec met le lieu au repos dix minutes ; le job planifié, lui,
 * n'est jamais bridé.
 */
const RATTRAPAGE_METEO_REPOS_MS = 10 * 60 * 1000;
const dernierEchecMeteo = new Map();
const cleLieu = (lieu) => `${lieu.latitude}:${lieu.longitude}`;
function rattrapageMeteoAutorise(lieu) {
  const dernier = dernierEchecMeteo.get(cleLieu(lieu));
  return !dernier || (Date.now() - dernier) > RATTRAPAGE_METEO_REPOS_MS;
}
function marquerEchecMeteo(lieu) {
  dernierEchecMeteo.set(cleLieu(lieu), Date.now());
}

/**
 * MÉTÉO du lieu du poste.
 *
 * Le type `meteo` existait depuis la V1 comme un simple TEXTE : l'exploitant
 * créait l'écran, le serveur n'envoyait aucune donnée, et l'écran restait
 * désespérément vide (constat de production, août 2026). Il devient un vrai
 * générateur.
 *
 * DEUX RÈGLES :
 *  - le LIEU vient du site du poste s'il porte des coordonnées, sinon des
 *    réglages (`resolveMeteoLieu`) ; la source retenue accompagne la prévision,
 *    l'écran ne peut pas se tromper de ville en silence ;
 *  - sans relevé pour AUJOURD'HUI, on rend `null` : mieux vaut pas d'écran
 *    météo qu'une température d'avant-hier présentée comme celle du jour.
 *    Un rafraîchissement de dernier recours est tenté (le job passe avec
 *    runAllJobs — démarrage, puis 7 h, 12 h et 18 h ; un poste appairé entre
 *    deux passages ne doit pas attendre la nuit pour avoir sa météo).
 */
async function buildMeteo(siteId, params) {
  const lieu = await media.resolveMeteoLieu(siteId);
  if (!lieu) return null;                        // aucune coordonnée : rien à afficher

  const nbJours = Math.min(5, Math.max(0, parseInt(params.meteo_jours_prevision, 10) || 0));
  const aujourdhui = media.jourParisDecale(0);

  let jours = await media.readMeteoCache(lieu, nbJours);
  if (!jours.some((j) => j.jour === aujourdhui) && rattrapageMeteoAutorise(lieu)) {
    try {
      if (await media.refreshMeteoLieu(lieu, nbJours)) {
        jours = await media.readMeteoCache(lieu, nbJours);
      } else {
        marquerEchecMeteo(lieu);
      }
    } catch (err) {
      // Source injoignable : on garde ce que la base sait, et si elle ne sait
      // rien pour aujourd'hui, l'écran est omis (jamais inventé).
      marquerEchecMeteo(lieu);
      console.warn(`[BADGEUSE-DEVICE] Météo non rafraîchie : ${err.message}`);
    }
  }

  const jourJ = jours.find((j) => j.jour === aujourdhui);
  if (!jourJ) return null;

  return {
    lieu: lieu.libelle,
    lieu_source: lieu.source,
    releve_le: jourJ.releve_le || null,
    jour: {
      date: jourJ.jour,
      code: jourJ.code,
      libelle: jourJ.libelle,
      temp_min: jourJ.temp_min,
      temp_max: jourJ.temp_max,
      precip_mm: jourJ.precip_mm,
      vent_max: jourJ.vent_max,
    },
    prevision: jours
      .filter((j) => j.jour > aujourdhui)
      .slice(0, nbJours)
      .map((j) => ({
        date: j.jour, code: j.code, libelle: j.libelle,
        temp_min: j.temp_min, temp_max: j.temp_max,
      })),
  };
}

/**
 * PRESSE NATIONALE — les derniers articles rapatriés par le serveur.
 *
 * Rend une LISTE : l'appelant en fait UN ÉLÉMENT DE PLAYLIST PAR ARTICLE
 * (demande de l'exploitant : « un écran par article de presse »). La vignette
 * est référencée comme n'importe quel média de playlist (`media_id`) : le
 * poste la télécharge par l'API device et la sert depuis son cache local — il
 * ne contacte jamais le site de presse (ADR-0004 §6, ADR-0006).
 */
async function buildPresse(limite) {
  const r = await pool.query(
    `SELECT id, source, flux, titre, chapo, publie_le, media_fichier, media_sha256, media_type
     FROM badgeuse_presse_articles
     ORDER BY publie_le DESC NULLS LAST, id DESC
     LIMIT $1`,
    [limite]
  );
  return r.rows.map((x) => ({
    article: {
      titre: x.titre,
      chapo: x.chapo || null,
      // La SOURCE est affichée à l'écran : c'est l'attribution due au média,
      // et le repère qui distingue une brève nationale d'une note interne.
      source: x.source || x.flux || null,
      publie_le: x.publie_le || null,
    },
    media: x.media_fichier
      ? { media_id: `p${x.id}`, media_type: x.media_type || 'image', media_sha256: x.media_sha256 || null }
      : null,
  }));
}

/** Derniers posts sociaux pourvus d'un visuel rapatrié côté serveur. */
async function buildSocial(limite) {
  const r = await pool.query(
    `SELECT id, reseau, compte, legende, media_sha256, publie_le
     FROM badgeuse_social_posts
     WHERE media_fichier IS NOT NULL
     ORDER BY publie_le DESC NULLS LAST, id DESC
     LIMIT $1`,
    [limite]
  );
  return r.rows.map((x) => ({
    media_id: `s${x.id}`,
    media_type: 'image',
    media_sha256: x.media_sha256 || null,
    reseau: x.reseau,
    compte: x.compte,
    legende: x.legende || null,
    publie_le: x.publie_le || null,
  }));
}

// ═══════════════════════════════════════════════════════════════════════════
// GET /v1/devices/:code/playlist — contenus de veille (ETag)
// Aucune donnée personnelle (finalité communication interne dissociée).
// ═══════════════════════════════════════════════════════════════════════════
router.get('/v1/devices/:code/playlist', deviceLimiter, authenticateDevice, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, type, titre, corps, media_url, duree_sec, ordre,
              fichier, media_type, media_sha256, config
       FROM badgeuse_contenus
       WHERE actif = true
         AND (site_id IS NULL OR site_id = $1)
         AND (visible_du IS NULL OR visible_du <= CURRENT_DATE)
         AND (visible_au IS NULL OR visible_au >= CURRENT_DATE)
       ORDER BY ordre, id`,
      [req.device.site_id]
    );

    const params = await readBadgeuseParams();
    const jourParis = engine.parisDateStr(new Date());
    const elements = [];

    for (const x of r.rows) {
      const base = {
        id: x.id,
        type: x.type,
        titre: x.titre,
        corps: x.corps,
        media_url: x.media_url,
        duree_sec: x.duree_sec,
        ordre: x.ordre,
      };

      // Éléments TEXTE historiques : forme strictement inchangée (le poste
      // déployé les consomme déjà — aucune régression tolérée).
      if (!TYPES_GENERES.includes(x.type)) {
        if (x.type === 'media' || x.type === 'lien') {
          // Média téléversé ou lien rapatrié : le poste télécharge le binaire
          // par /media/:id, vérifie le sha256, et sert depuis son cache local.
          if (!x.fichier) continue; // fichier absent ⇒ élément muet, on l'omet
          elements.push({
            ...base,
            type: 'media',
            media_id: `c${x.id}`,
            media_type: x.media_type || 'image',
            media_sha256: x.media_sha256 || null,
          });
          continue;
        }
        elements.push(base);
        continue;
      }

      // ── Générateurs : contenu construit ici, élément OMIS si vide ──
      const config = contenuConfig(x.config);
      try {
        if (x.type === 'annonces') {
          if (params.festif_actif === false) continue;
          const annonces = await buildAnnonces(jourParis);
          if (annonces.length === 0) continue;
          elements.push({ ...base, annonces });
        } else if (x.type === 'actus') {
          const actus = await buildActus(nbConfig(config, 'nb_actus', 3, 10));
          if (actus.length === 0) continue;
          elements.push({ ...base, actus });
        } else if (x.type === 'tournees') {
          const tournees = await buildTournees(jourParis);
          if (tournees.length === 0) continue;
          elements.push({ ...base, tournees });
        } else if (x.type === 'social') {
          const posts = await buildSocial(nbConfig(config, 'nb_posts', 5, 20));
          if (posts.length === 0) continue;
          elements.push({ ...base, posts });
        } else if (x.type === 'vak_live') {
          const vak = await buildVakLive();
          if (!vak) continue;
          elements.push({ ...base, vak });
        } else if (x.type === 'meteo') {
          const meteo = await buildMeteo(req.device.site_id, params);
          // REPLI DE NON-RÉGRESSION : avant que `meteo` ne soit un générateur,
          // l'exploitant pouvait écrire sa météo à la main dans « corps ».
          // Sans prévision disponible, cet écran-là doit continuer d'exister.
          if (!meteo) { if (x.corps) elements.push(base); continue; }
          elements.push({ ...base, meteo });
        } else if (x.type === 'presse') {
          // UN ÉLÉMENT PAR ARTICLE. Tous portent l'`id` du contenu source :
          // ni le poste ni l'interface ne s'en servent comme clé (la playlist
          // est une séquence), et c'est ce qui permet de retrouver le réglage
          // d'origine d'un écran.
          const articles = await buildPresse(nbConfig(config, 'nb_articles', 3, 8));
          if (articles.length === 0) continue;
          for (const a of articles) {
            elements.push({ ...base, ...(a.media || {}), article: a.article });
          }
        }
      } catch (err) {
        // Un générateur en panne (table absente, requête lente) ne doit PAS
        // vider la playlist : il s'efface, les autres passent.
        console.error(`[BADGEUSE-DEVICE] Générateur « ${x.type} » ignoré : ${err.message}`);
      }
    }

    sendWithEtag(req, res, computeEtag(elements), { elements });
  } catch (err) {
    console.error('[BADGEUSE-DEVICE] Erreur playlist :', err.message);
    res.status(503).json({ error: 'service_unavailable' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /v1/devices/:code/media/:id — flux binaire d'un média (v1.3)
//
// ROUTAGE : `:id` est PRÉFIXÉ par l'origine du média — `c<id>` pour un contenu
// de playlist (téléversé ou rapatriage d'un lien), `s<id>` pour le visuel d'un
// post social, `p<id>` pour la vignette d'un article de presse. Un seul point
// d'entrée plutôt que trois routes jumelles : le
// poste reçoit `media_id` dans la playlist et le rejoue tel quel, sans avoir à
// connaître la table d'origine.
//
// SÉCURITÉ : clé device obligatoire ; le chemin vient de la base mais est
// RÉSOLU STRICTEMENT sous uploads/badgeuse (aucun `..` possible) ; le
// Content-Type est déduit d'une LISTE BLANCHE d'extensions — jamais du
// contenu, jamais d'un en-tête stocké — et `nosniff` interdit au navigateur du
// kiosque de réinterpréter le fichier.
// ═══════════════════════════════════════════════════════════════════════════
router.get('/v1/devices/:code/media/:id', deviceLimiter, authenticateDevice, async (req, res) => {
  const introuvable = () => res.status(404).json({ error: 'not_found' });
  try {
    const brut = String(req.params.id || '');
    const m = /^([csp])(\d{1,12})$/.exec(brut);
    if (!m) return introuvable();
    const id = parseInt(m[2], 10);

    const REQUETES = {
      c: 'SELECT fichier FROM badgeuse_contenus WHERE id = $1',
      s: 'SELECT media_fichier AS fichier FROM badgeuse_social_posts WHERE id = $1',
      p: 'SELECT media_fichier AS fichier FROM badgeuse_presse_articles WHERE id = $1',
    };
    const r = await pool.query(REQUETES[m[1]], [id]);
    const relatif = r.rows[0] ? r.rows[0].fichier : null;
    if (!relatif) return introuvable();

    const abs = media.resolveMediaPath(relatif);
    const mime = media.mimeForFile(relatif);
    // Chemin hors racine, ou extension hors liste blanche → 404 (et non 415) :
    // le poste n'a pas à distinguer « absent » de « refusé ».
    if (!abs || !mime) return introuvable();
    if (!fs.existsSync(abs)) return introuvable();

    res.setHeader('Content-Type', mime);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    const flux = fs.createReadStream(abs);
    flux.on('error', (err) => {
      console.error('[BADGEUSE-DEVICE] Lecture média impossible :', err.message);
      if (!res.headersSent) res.status(404).json({ error: 'not_found' });
      else res.end();
    });
    flux.pipe(res);
  } catch (err) {
    console.error('[BADGEUSE-DEVICE] Erreur média :', err.message);
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
