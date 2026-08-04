/**
 * Service d'intégration SumUp pour le module Vente au Kilo (VAK).
 *
 * Pourquoi : la VAK est encaissée sur une caisse SumUp. SumUp expose une API
 * REST OAuth 2.0 + des webhooks transactionnels — on s'y branche directement
 * plutôt que de demander un export CSV mensuel. Un fallback CSV reste
 * disponible (parser ci-dessous) pour le rattrapage historique novembre 2026
 * → date de mise en prod et les cas de panne API.
 *
 * Couvre :
 *  - Stockage chiffré des credentials et tokens dans la table `settings`
 *  - Flow OAuth 2.0 (auth-url, exchange code, refresh, disconnect)
 *  - Appel `GET /v0.1/me/transactions/history` paginé incrémental
 *  - Validation HMAC signature webhook
 *  - Mapping transaction SumUp → vak_tickets + vak_ventes (UPSERT)
 *  - Parser CSV SumUp (17 colonnes, date FR, décimales virgule)
 *  - Émission Socket.IO pour dashboard live
 */

const crypto = require('crypto');
const pool = require('../config/database');
const { fetchOpenMeteoDaily } = require('../utils/weather');
const logger = require('../config/logger');

const SUMUP_API_BASE = process.env.SUMUP_API_BASE_URL || 'https://api.sumup.com';
const SUMUP_REDIRECT_URI = process.env.SUMUP_REDIRECT_URI
  || 'https://solidata.online/api/vak/sumup/callback';
// Scopes OAuth. SumUp refuse l'autorisation (invalid_scope) si on demande un
// scope non activé pour le client. `transactions.history` suffit pour la sync
// des ventes VAK ; les autres scopes (user.profile_readonly, payments, etc.)
// peuvent être ajoutés via SUMUP_OAUTH_SCOPES si l'app les expose côté
// developer.sumup.com.
const SUMUP_SCOPES = (process.env.SUMUP_OAUTH_SCOPES || 'transactions.history')
  .split(/[\s,]+/).filter(Boolean);

// ── Chiffrement secrets (réutilise PCM_ENCRYPTION_KEY, fallback JWT_SECRET) ──
function getEncryptionKey() {
  const raw = process.env.SUMUP_ENCRYPTION_KEY
    || process.env.PCM_ENCRYPTION_KEY
    || process.env.JWT_SECRET;
  if (!raw) throw new Error('Aucune clé de chiffrement disponible (SUMUP_ENCRYPTION_KEY / PCM_ENCRYPTION_KEY / JWT_SECRET)');
  return crypto.createHash('sha256').update(raw).digest();
}

function encrypt(plaintext) {
  if (plaintext == null || plaintext === '') return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

function decrypt(payload) {
  if (!payload || !payload.startsWith('v1:')) return payload || null;
  try {
    const [, ivB64, tagB64, encB64] = payload.split(':');
    const decipher = crypto.createDecipheriv('aes-256-gcm', getEncryptionKey(), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(encB64, 'base64')), decipher.final()]).toString('utf8');
  } catch (err) {
    logger.error('Décryptage secret SumUp impossible', { error: err.message });
    return null;
  }
}

// ── Stockage settings (clé/valeur, schéma déjà en place) ──
async function getSetting(key) {
  const r = await pool.query('SELECT value FROM settings WHERE key = $1', [key]);
  return r.rows[0]?.value ?? null;
}

async function setSetting(key, value) {
  await pool.query(`
    INSERT INTO settings (key, value, updated_at)
    VALUES ($1, $2, NOW())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `, [key, value == null ? null : String(value)]);
}

async function getEncryptedSetting(key) {
  return decrypt(await getSetting(key));
}

async function setEncryptedSetting(key, value) {
  await setSetting(key, value == null ? null : encrypt(value));
}

// ── Statut connexion ──
async function getConnectionStatus() {
  const [clientId, accessToken, refreshToken, expiresAt, merchantCode, connectedAt] = await Promise.all([
    getSetting('sumup.client_id'),
    getEncryptedSetting('sumup.access_token'),
    getEncryptedSetting('sumup.refresh_token'),
    getSetting('sumup.token_expires_at'),
    getSetting('sumup.merchant_code'),
    getSetting('sumup.connected_at'),
  ]);

  const hasCredentials = !!(clientId && await getEncryptedSetting('sumup.client_secret'));
  const hasTokens = !!(accessToken && refreshToken);
  const expired = expiresAt ? new Date(expiresAt) < new Date() : true;

  return {
    has_credentials: hasCredentials,
    connected: hasTokens,
    expired: hasTokens && expired,
    merchant_code: merchantCode || null,
    token_expires_at: expiresAt || null,
    connected_at: connectedAt || null,
    redirect_uri: SUMUP_REDIRECT_URI,
  };
}

// ── OAuth flow ──
function getAuthorizationUrl(state) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: '',
    redirect_uri: SUMUP_REDIRECT_URI,
    scope: SUMUP_SCOPES.join(' '),
    state,
  });
  return getSetting('sumup.client_id').then((clientId) => {
    if (!clientId) throw new Error('client_id SumUp non configuré');
    params.set('client_id', clientId);
    return `${SUMUP_API_BASE}/authorize?${params.toString()}`;
  });
}

async function exchangeCodeForTokens(code) {
  const clientId = await getSetting('sumup.client_id');
  const clientSecret = await getEncryptedSetting('sumup.client_secret');
  if (!clientId || !clientSecret) throw new Error('Credentials SumUp manquants');

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: SUMUP_REDIRECT_URI,
  });
  const r = await globalThis.fetch(`${SUMUP_API_BASE}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    throw new Error(`SumUp token exchange ${r.status} : ${txt.slice(0, 200)}`);
  }
  const data = await r.json();
  await persistTokens(data);

  // Récupère le merchant_code pour piloter les webhooks
  try {
    const me = await sumupApiGet('/v0.1/me');
    const merchantCode = me?.merchant_profile?.merchant_code || me?.account?.merchant_code;
    if (merchantCode) await setSetting('sumup.merchant_code', merchantCode);
  } catch (err) {
    logger.warn('SumUp /me indisponible après OAuth', { error: err.message });
  }

  await setSetting('sumup.connected_at', new Date().toISOString());
  return data;
}

async function persistTokens(tokenResp) {
  await setEncryptedSetting('sumup.access_token', tokenResp.access_token);
  if (tokenResp.refresh_token) {
    await setEncryptedSetting('sumup.refresh_token', tokenResp.refresh_token);
  }
  const expiresIn = Number(tokenResp.expires_in || 3600);
  await setSetting('sumup.token_expires_at', new Date(Date.now() + expiresIn * 1000).toISOString());
}

async function refreshAccessToken() {
  const refreshToken = await getEncryptedSetting('sumup.refresh_token');
  if (!refreshToken) throw new Error('Pas de refresh_token SumUp');
  const clientId = await getSetting('sumup.client_id');
  const clientSecret = await getEncryptedSetting('sumup.client_secret');

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });
  const r = await globalThis.fetch(`${SUMUP_API_BASE}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    throw new Error(`SumUp refresh ${r.status} : ${txt.slice(0, 200)}`);
  }
  const data = await r.json();
  await persistTokens(data);
  return data;
}

async function getValidAccessToken() {
  const expiresAt = await getSetting('sumup.token_expires_at');
  const expired = !expiresAt || (new Date(expiresAt).getTime() - Date.now()) < 60_000;
  if (expired) {
    await refreshAccessToken();
  }
  const token = await getEncryptedSetting('sumup.access_token');
  if (!token) throw new Error('Token SumUp indisponible');
  return token;
}

async function sumupApiGet(path, params = {}) {
  const token = await getValidAccessToken();
  const qs = new URLSearchParams(params).toString();
  const url = `${SUMUP_API_BASE}${path}${qs ? `?${qs}` : ''}`;
  const r = await globalThis.fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    throw new Error(`SumUp ${r.status} ${path} : ${txt.slice(0, 200)}`);
  }
  return r.json();
}

async function disconnect() {
  const merchantCode = await getSetting('sumup.merchant_code');
  // Tente de désinscrire les webhooks (best effort, ignore les erreurs)
  if (merchantCode) {
    try {
      const hooks = await sumupApiGet(`/v0.1/me/merchants/${merchantCode}/webhooks`).catch(() => []);
      const token = await getValidAccessToken().catch(() => null);
      if (token && Array.isArray(hooks)) {
        for (const h of hooks) {
          if (h?.id) {
            await globalThis.fetch(`${SUMUP_API_BASE}/v0.1/me/merchants/${merchantCode}/webhooks/${h.id}`, {
              method: 'DELETE',
              headers: { Authorization: `Bearer ${token}` },
            }).catch(() => {});
          }
        }
      }
    } catch (_) { /* silent */ }
  }
  await Promise.all([
    setSetting('sumup.access_token', null),
    setSetting('sumup.refresh_token', null),
    setSetting('sumup.token_expires_at', null),
    setSetting('sumup.merchant_code', null),
    setSetting('sumup.webhook_secret', null),
    setSetting('sumup.connected_at', null),
  ]);
}

// ── Webhook signature HMAC ──
function validateWebhookSignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader || !secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  // SumUp envoie parfois "sha256=..." en préfixe
  const provided = signatureHeader.replace(/^sha256=/, '').trim();
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(provided, 'hex'));
  } catch (_) {
    return false;
  }
}

// ── Mapping description → segment métier ──
const DESCRIPTION_TO_SEGMENT = {
  'vente moins de 5 kg': 'textile_vrac',
  'vente plus de 5 kilos': 'textile_vrac',
  'vente plus de 5 kg': 'textile_vrac',
  'chaussures': 'chaussures',
  'sacs': 'consommables',
  'sac': 'consommables',
};

function getSegment(description) {
  const k = (description || '').toLowerCase().trim();
  if (DESCRIPTION_TO_SEGMENT[k]) return DESCRIPTION_TO_SEGMENT[k];
  if (k.includes('moins de') || k.includes('plus de')) return 'textile_vrac';
  if (k.includes('chauss')) return 'chaussures';
  if (k.includes('sac')) return 'consommables';
  return 'autre';
}

// ── Détection « vendu au kilo » (unifie CSV + API/webhook) ──
// L'export CSV SumUp porte une colonne « Unité » (kg / pce) : elle FAIT FOI
// quand elle est renseignée. En revanche, les transactions remontées par l'API
// (/v0.1/me/transactions) et par les webhooks n'ont PAS d'unité sur leurs
// produits (name/description + quantity + price seulement) — sans inférence,
// tout le flux API/webhook restait à `unite = 'pce'` et le poids vendu sortait
// à 0 (bug « les poids des ventes sont tous à zéro »). Règle partagée :
//   1. unité explicite non vide → au kilo ssi elle contient « kg »
//      (comportement du chemin CSV, inchangé) ;
//   2. sinon, un produit dont le libellé matche le mapping textile au kilo
//      (« Vente moins de 5 kg », « Vente plus de 5 kilos »… → segment
//      textile_vrac) est vendu AU KG → poids = quantité (la caisse SumUp
//      saisit le poids pesé dans le champ quantité pour ces articles).
// Chaussures et consommables (sacs) restent à la pièce (poids 0).
function isKgItem(description, unite = '') {
  const u = String(unite || '').trim().toLowerCase();
  if (u) return u.includes('kg');
  return getSegment(description) === 'textile_vrac';
}

// ── Normalisation moyen de paiement → libellé métier ('CB' / 'Espèces') ──
// SumUp expose des types techniques : `payment_type` = 'POS' (carte présentée
// sur le terminal en boutique), 'ECOM' (carte en ligne), et/ou une marque via
// `card.type` ('VISA', 'MASTERCARD'…). Le CSV peut contenir 'Carte', 'Espèces',
// etc. On ramène tout à deux libellés lisibles pour les tableaux de bord VAK :
//   - 'CB'      = carte bancaire (POS, ECOM, VISA, Mastercard, sans contact…)
//   - 'Espèces' = paiement en numéraire
// Toute valeur non reconnue est conservée telle quelle (ex. 'Chèque').
function normalizePaymentMethod(raw) {
  const s = (raw == null ? '' : String(raw)).trim();
  if (!s) return 'Inconnu';
  const k = s.toLowerCase();
  if (/esp[eè]ce|cash|num[eé]raire|liquide/.test(k)) return 'Espèces';
  if (/\bpos\b|\bcb\b|\becom\b|carte|card|visa|master|maestro|amex|american express|contactless|sans[\s-]?contact|bancaire/.test(k)) return 'CB';
  return s;
}

// ── Détection remboursement (unifie CSV + API/webhook) ──
// L'import CSV traite une ligne « Remboursement » en négatif (voir importCSVContent).
// On applique la MÊME sémantique aux voies API et webhook : une transaction SumUp
// de type REFUND (ou CHARGE_BACK) devient un ticket négatif distinct qui vient
// nette la vente d'origine dans tous les agrégats (KPI, horaire, paiements, live).
//   - `type` API SumUp : 'PAYMENT' | 'REFUND' | 'CHARGE_BACK'
//   - colonne « Type » du CSV FR : 'Remboursement'
// IMPORTANT : un paiement dont seul le STATUT est 'REFUNDED' (l'original remboursé)
// n'est PAS un événement de remboursement — il reste le ticket de vente positif,
// annulé par l'événement REFUND distinct que SumUp émet en parallèle. Le traiter
// en négatif ici sur-déduirait (double comptage du remboursement).
function isRefundTransaction(tx) {
  if (!tx) return false;
  const type = String(tx.type || tx.transaction_type || '').trim().toUpperCase();
  return type === 'REFUND'
    || type === 'CHARGE_BACK'
    || type === 'CHARGEBACK'
    || type === 'REMBOURSEMENT';
}

// ── Éligibilité d'une transaction API à l'ingestion ──
// Retenues : ventes réussies (SUCCESSFUL/PAID), l'original remboursé (statut
// REFUNDED — reste un vrai ticket, netté par l'événement REFUND), et tout
// remboursement (négatif). Écartées : échec, annulation, expiration, en attente.
// Sans statut : on tente l'ingestion (comportement historique conservé).
function isSyncEligibleTransaction(tx) {
  if (isRefundTransaction(tx)) return true;
  const status = String(tx?.status || tx?.transaction_status || '').trim().toUpperCase();
  if (!status) return true;
  return ['SUCCESSFUL', 'PAID', 'REFUNDED'].includes(status);
}

// ── Mapping pur transaction SumUp → ticket + lignes (sans DB ni IO) ──
// Extrait de ingestSumUpTransaction pour être testable. Applique le signe du
// remboursement (−1) sur les montants ET les quantités (donc le poids), à
// l'identique du chemin CSV, afin que le CA et le poids nets tiennent compte
// des retours. `detail` = charge enrichie (line_items) quand disponible, sinon
// = la transaction résumée.
function mapSumUpTransaction(tx, detail = tx) {
  const refund = isRefundTransaction(detail) || isRefundTransaction(tx);
  const sign = refund ? -1 : 1;
  const refTx = detail.transaction_code || detail.transaction_id || detail.id
    || tx.transaction_code || tx.transaction_id || tx.id || `sumup-${Date.now()}`;
  const moyenPaiement = normalizePaymentMethod(
    detail.payment_type || detail.card?.type || detail.payment_method || 'Inconnu');
  const entryMode = detail.entry_mode || null;
  const items = detail.line_items || detail.products || [];

  let totalTTC = sign * Math.abs(Number(detail.amount || 0));
  let totalHT = 0;
  let totalTVA = 0;
  let poidsTicket = 0;
  let nbArticles = 0;
  const lignes = [];

  if (items.length === 0) {
    // Ticket sans détail de lignes (rare) : 1 ligne globale. Le poids reste 0
    // (quantité inconnue — jamais de valeur inventée), mais le segment est
    // dérivé du libellé s'il existe pour ne pas fausser les analyses.
    const magTTC = Math.abs(Number(detail.amount || 0));
    const ht = magTTC / 1.2;
    lignes.push({
      description: detail.description || (refund ? 'Remboursement' : 'Vente'),
      segment: getSegment(detail.description),
      unite: 'pce',
      quantite: sign * 1,
      prix_unitaire_ttc: sign * magTTC,
      total_ttc: sign * magTTC,
      total_ht: sign * ht,
      total_tva: sign * (magTTC - ht),
      taux_tva: 20,
    });
    totalTTC = sign * magTTC;
    totalHT = sign * ht;
    totalTVA = sign * (magTTC - ht);
    nbArticles = 1;
  } else {
    for (const it of items) {
      const desc = (it.description || it.name || '').trim();
      const qtyMag = Math.abs(Number(it.quantity || 1));
      // Les produits API/webhook SumUp exposent `price` (prix unitaire), pas
      // `price_per_unit` — repli en cascade pour couvrir les deux formes.
      const unitPrice = Math.abs(Number(it.price_per_unit || it.unit_price || it.price || 0));
      const lineTTCmag = Math.abs(Number(it.total_price || it.total_with_vat || qtyMag * unitPrice));
      const tvaMag = Math.abs(Number(it.vat_amount || (lineTTCmag - lineTTCmag / 1.2)));
      const htMag = Math.abs(Number(it.subtotal || (lineTTCmag - tvaMag)));
      const taux = Number(it.vat_rate || 20);
      // BUG « poids à zéro » (Lot 6) : les produits des transactions API et des
      // webhooks n'ont pas de champ `unit` → l'unité tombait à 'pce' et le
      // poids restait 0 pour TOUTES les ventes synchronisées. On infère « kg »
      // depuis le libellé (mapping textile au kilo, cf. isKgItem) quand
      // l'unité est absente, et on STOCKE l'unité inférée pour que les
      // agrégats SQL (`unite ILIKE '%kg%'` dans routes/vak.js) suivent.
      const rawUnite = (it.unit || '').trim().toLowerCase();
      const kg = isKgItem(desc, rawUnite);
      const unite = rawUnite || (kg ? 'kg' : 'pce');
      const segment = getSegment(desc);
      lignes.push({
        description: desc, segment, unite,
        quantite: sign * qtyMag,
        prix_unitaire_ttc: sign * unitPrice,
        total_ttc: sign * lineTTCmag,
        total_ht: sign * htMag,
        total_tva: sign * tvaMag,
        taux_tva: taux,
      });
      totalHT += sign * htMag;
      totalTVA += sign * tvaMag;
      if (kg) poidsTicket += sign * qtyMag;
      nbArticles += 1;
    }
    // Si le montant n'est pas donné au header, recalcul depuis les lignes (déjà signées)
    if (!detail.amount) totalTTC = lignes.reduce((s, l) => s + l.total_ttc, 0);
  }

  return {
    refTx, moyenPaiement, entryMode, isRefund: refund,
    totalTTC, totalHT, totalTVA, poidsTicket, nbArticles, lignes,
  };
}

// ── Fuseau Europe/Paris (sans librairie externe) ──
// Doctrine du module (Lot 12 « heure de Paris ») : le STOCKAGE reste en UTC
// (les timestamps SumUp API/webhook sont déjà en UTC) ; l'INTERPRÉTATION du
// CSV (horodaté en heure locale française) et les regroupements par JOUR
// CIVIL raisonnent en Europe/Paris. Offset calculé via Intl (tzdata du
// runtime), donc correct hiver (+1 h) / été (+2 h) sans librairie externe.
const PARIS_TZ = 'Europe/Paris';

// Décalage (minutes) de Europe/Paris par rapport à UTC à l'instant donné.
function parisOffsetMinutes(instant) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: PARIS_TZ, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = {};
  for (const p of dtf.formatToParts(instant)) parts[p.type] = p.value;
  const asUTC = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour) % 24, Number(parts.minute), Number(parts.second),
  );
  return Math.round((asUTC - instant.getTime()) / 60000);
}

// Convertit une heure « murale » Paris (année/mois/jour/h/m/s) en instant UTC.
// Deux passes : on estime l'offset en traitant l'heure comme UTC, on ajuste,
// puis on re-vérifie l'offset à l'instant ajusté (bascules d'heure d'été).
function parisWallClockToUTC(year, monthIdx, day, hh, mm, ss) {
  const naive = Date.UTC(year, monthIdx, day, hh, mm, ss);
  let offset = parisOffsetMinutes(new Date(naive));
  let ts = naive - offset * 60000;
  const offset2 = parisOffsetMinutes(new Date(ts));
  if (offset2 !== offset) ts = naive - offset2 * 60000;
  return new Date(ts);
}

// Date civile 'YYYY-MM-DD' d'un instant, vue depuis Europe/Paris.
// Remplace les `toISOString().slice(0, 10)` (date UTC : fausse entre minuit
// Paris et 01:00/02:00 du matin) pour le rattachement d'un ticket à sa VAK.
function parisDateStr(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: PARIS_TZ }).format(date);
}

// 'YYYY-MM-DD' d'une colonne SQL DATE parsée par node-postgres (qui la
// matérialise à minuit LOCAL du process Node) : les composantes locales
// redonnent la date civile quel que soit le fuseau du conteneur — là où
// `toISOString()` reculait d'un jour si le conteneur tournait à l'est d'UTC.
function dateOnlyStr(d) {
  const dd = d instanceof Date ? d : new Date(d);
  const p = (n) => String(n).padStart(2, '0');
  return `${dd.getFullYear()}-${p(dd.getMonth() + 1)}-${p(dd.getDate())}`;
}

// ── Parse date FR "15 mai 2026 10:15" ──
const MOIS_FR = {
  'janv.': 0, janvier: 0, 'janv': 0,
  'févr.': 1, 'fevr.': 1, février: 1, fevrier: 1, 'févr': 1, 'fevr': 1,
  'mars': 2,
  'avr.': 3, avril: 3, 'avr': 3,
  'mai': 4,
  'juin': 5,
  'juil.': 6, juillet: 6, 'juil': 6,
  'août': 7, aout: 7, 'aoû': 7,
  'sept.': 8, septembre: 8, 'sept': 8,
  'oct.': 9, octobre: 9, 'oct': 9,
  'nov.': 10, novembre: 10, 'nov': 10,
  'déc.': 11, 'dec.': 11, décembre: 11, decembre: 11, 'déc': 11, 'dec': 11,
};

function parseFRDate(str) {
  if (!str) return null;
  const s = String(str).trim();
  const m = s.match(/^(\d{1,2})\s+([\wéûôî.]+)\.?\s+(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/iu);
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const moisKey = m[2].toLowerCase().replace(/[.]/g, '').trim();
  const moisIdx = MOIS_FR[moisKey] ?? MOIS_FR[`${moisKey}.`];
  if (moisIdx == null) return null;
  const year = parseInt(m[3], 10);
  const hh = parseInt(m[4], 10);
  const mm = parseInt(m[5], 10);
  const ss = m[6] ? parseInt(m[6], 10) : 0;
  // Lot 12 « heure de Paris » : l'export CSV SumUp est horodaté en heure
  // LOCALE française (Europe/Paris) — l'interprétation UTC de v2.6.0 décalait
  // l'instant réel de −1 h/−2 h. On convertit ce « mur d'horloge » Paris en
  // instant UTC pour le stockage (offset hiver/été via Intl, indépendant du
  // fuseau du conteneur) : l'heure STOCKÉE reste en UTC, cohérente avec le
  // flux API (`tx.timestamp` déjà en UTC), et l'agrégation/affichage se fait
  // en Europe/Paris partout (routes/vak.js + pages Vak*).
  return parisWallClockToUTC(year, moisIdx, day, hh, mm, ss);
}

function parseNumberFR(str) {
  if (str == null || str === '') return 0;
  return parseFloat(String(str).replace(/\s/g, '').replace(',', '.')) || 0;
}

// ── Split CSV ligne (gère les guillemets pour les valeurs avec virgule) ──
function splitCSVLine(line) {
  const cells = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (c === ',' && !inQuotes) {
      cells.push(cur); cur = '';
    } else {
      cur += c;
    }
  }
  cells.push(cur);
  return cells;
}

// ── Import CSV SumUp ──
// Colonnes (17) : Date,Type,Réf. transaction,Moyen de paiement,Quantité,Unité,
// Description,Catégorie,SKU,Devise,Prix avant réduction,Réduction,Prix (TTC),
// Prix (HT),TVA,Taux de TVA,Compte
async function importCSVContent(vakId, content, filename, userId, source = 'csv_manuel') {
  const fileHash = crypto.createHash('sha256').update(content).digest('hex');

  const existing = await pool.query(
    'SELECT id FROM vak_import_batches WHERE file_hash = $1 LIMIT 1',
    [fileHash],
  );
  if (existing.rows.length > 0) {
    return {
      duplicate: true,
      reason: 'file_hash',
      batch_id: existing.rows[0].id,
      message: 'Ce fichier a déjà été importé (hash identique).',
    };
  }

  const vakRow = await pool.query('SELECT id, date_debut, date_fin FROM vaks WHERE id = $1', [vakId]);
  if (vakRow.rows.length === 0) {
    return { error: 'VAK introuvable' };
  }
  const vak = vakRow.rows[0];

  // ── Import ATOMIQUE (vague 3, item 3.B) ──
  // INSERT batch → upsert tickets → reset+insert ventes → UPDATE batch : une seule
  // transaction. Le file_hash n'est COMMITé qu'au succès complet → un échec en cours
  // ROLLBACK le batch ET son hash, rendant le même fichier ré-importable (avant : un
  // import partiel restait bloqué en 'duplicate', irrécupérable sans intervention DB).
  const client = await pool.connect();
  try {
  await client.query('BEGIN');

  const batchRes = await client.query(`
    INSERT INTO vak_import_batches (vak_id, filename, file_hash, statut, source, imported_by)
    VALUES ($1, $2, $3, 'en_cours', $4, $5) RETURNING id
  `, [vakId, filename, fileHash, source, userId]);
  const batchId = batchRes.rows[0].id;

  const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
  let header = lines.shift();
  // Auto-detect : si la 1ère ligne ne contient pas "Date" ou "Réf", la traiter en data
  if (header && !/^Date|^Réf|^Date,/i.test(header)) {
    lines.unshift(header);
  }

  let nbTotal = lines.length;
  let nbImport = 0;
  let nbErreur = 0;
  let caTotal = 0;
  let poidsTotal = 0;
  let dateDebutISO = null;
  let dateFinISO = null;
  const erreurs = [];
  const ticketsMap = new Map();      // ref_transaction → { date, moyen_paiement, lignes: [] }
  const dateRangeRejets = [];        // hors période VAK

  for (let i = 0; i < lines.length; i++) {
    const parts = splitCSVLine(lines[i]);
    if (parts.length < 14) {
      nbErreur++;
      erreurs.push({ line: i + 2, error: `Colonnes insuffisantes (${parts.length})` });
      continue;
    }
    try {
      const [
        dateStr, type, refTx, moyenPaiement, quantiteStr, unite, description,
        _categorie, _sku, _devise, _prixAvantRed, remiseStr, totalTTCStr, totalHTStr, totalTVAStr, tauxTVAStr, compte,
      ] = parts;

      const dateVente = parseFRDate(dateStr);
      if (!dateVente) throw new Error(`Date invalide: "${dateStr}"`);

      // Vérification rattachement VAK — en date CIVILE Paris (une vente à
      // 00:30 Paris stockée 22:30/23:30 UTC la veille compte sur le bon jour),
      // comparée aux bornes DATE de la VAK lues par leurs composantes locales
      // (dateOnlyStr) et non par toISOString (dérive d'un jour possible).
      const isoDate = parisDateStr(dateVente);
      if (isoDate < dateOnlyStr(vak.date_debut) || isoDate > dateOnlyStr(vak.date_fin)) {
        dateRangeRejets.push({ line: i + 2, date: isoDate });
        continue;
      }

      const quantite = parseNumberFR(quantiteStr);
      const totalTTC = parseNumberFR(totalTTCStr);
      const totalHT = parseNumberFR(totalHTStr);
      const totalTVA = parseNumberFR(totalTVAStr);
      const tauxTVA = parseNumberFR((tauxTVAStr || '').replace(/[%\s]/g, ''));
      const remise = parseNumberFR(remiseStr);
      const segment = getSegment(description);
      // Unité kg : la colonne « Unité » du CSV fait foi quand elle est
      // renseignée ; si elle est vide, inférence par le libellé (mapping
      // textile au kilo) — même helper que le chemin API/webhook (isKgItem).
      // L'unité inférée est STOCKÉE pour garder les agrégats SQL cohérents.
      const ligneKg = isKgItem(description, unite);
      const uniteNorm = (unite || '').trim().toLowerCase() || (ligneKg ? 'kg' : '');
      // Remboursement (colonne « Type » = Remboursement) → lignes en négatif,
      // même sémantique que les voies API/webhook. Voir isRefundTransaction.
      const sign = isRefundTransaction({ type }) ? -1 : 1;

      const moyenPaiementNorm = normalizePaymentMethod(moyenPaiement);
      const ref = (refTx || '').trim() || `unknown-${i}`;
      if (!ticketsMap.has(ref)) {
        ticketsMap.set(ref, {
          date_ticket: dateVente,
          moyen_paiement: moyenPaiementNorm,
          lignes: [],
        });
      }
      const tk = ticketsMap.get(ref);
      // La date du ticket est la 1ère ligne (chronologique)
      if (dateVente < tk.date_ticket) tk.date_ticket = dateVente;

      tk.lignes.push({
        date_vente: dateVente,
        moyen_paiement: moyenPaiementNorm,
        description: (description || '').trim(),
        segment,
        unite: uniteNorm,
        quantite: sign * quantite,
        prix_unitaire_ttc: sign * (totalTTC / Math.max(1, Math.abs(quantite || 1))),
        remise,
        total_ht: sign * totalHT,
        total_ttc: sign * totalTTC,
        total_tva: sign * totalTVA,
        taux_tva: tauxTVA,
        compte: (compte || '').trim(),
      });

      caTotal += sign * totalTTC;
      const poidsLigne = ligneKg ? sign * quantite : 0;
      poidsTotal += poidsLigne;

      if (!dateDebutISO || isoDate < dateDebutISO) dateDebutISO = isoDate;
      if (!dateFinISO || isoDate > dateFinISO) dateFinISO = isoDate;
      nbImport++;
    } catch (e) {
      nbErreur++;
      erreurs.push({ line: i + 2, error: e.message });
    }
  }

  if (dateRangeRejets.length > 0) {
    erreurs.push({ type: 'out_of_range', count: dateRangeRejets.length, samples: dateRangeRejets.slice(0, 5) });
  }

  // UPSERT tickets + ventes
  for (const [ref, tk] of ticketsMap.entries()) {
    // Poids du ticket = somme SIGNÉE des quantités en kg (un remboursement pèse
    // négatif) → cohérent avec le CA signé du ticket et avec la voie API, pour
    // que les vues horaire / live nettent aussi le poids retourné.
    const poidsTicket = tk.lignes
      .filter((l) => (l.unite || '').includes('kg'))
      .reduce((s, l) => s + (Number.isFinite(l.quantite) ? l.quantite : 0), 0);
    const nbArticles = tk.lignes.length;
    const totalTTC = tk.lignes.reduce((s, l) => s + l.total_ttc, 0);
    const totalHT = tk.lignes.reduce((s, l) => s + l.total_ht, 0);
    const totalTVA = tk.lignes.reduce((s, l) => s + l.total_tva, 0);

    const tickRes = await client.query(`
      INSERT INTO vak_tickets
        (vak_id, ref_transaction, date_ticket, moyen_paiement, nb_articles,
         poids_kg, total_ttc, total_ht, total_tva, batch_id, source)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (vak_id, ref_transaction) DO UPDATE SET
        nb_articles = EXCLUDED.nb_articles,
        poids_kg = EXCLUDED.poids_kg,
        total_ttc = EXCLUDED.total_ttc,
        total_ht = EXCLUDED.total_ht,
        total_tva = EXCLUDED.total_tva,
        batch_id = EXCLUDED.batch_id
      RETURNING id
    `, [vakId, ref, tk.date_ticket.toISOString(), tk.moyen_paiement, nbArticles,
        poidsTicket, totalTTC, totalHT, totalTVA, batchId, source]);
    const ticketId = tickRes.rows[0].id;

    // Reset des lignes avant réinsertion — un ré-import CSV du même ticket crée
    // un NOUVEAU batch (le batch_id du ticket est mis à jour), donc l'ancien
    // batch n'est jamais supprimé et sa cascade ne joue pas : sans ce DELETE,
    // les lignes se cumulaient (segments/annuel double-comptés). Aligné sur le
    // chemin API qui fait déjà ce DELETE.
    await client.query('DELETE FROM vak_ventes WHERE ticket_id = $1', [ticketId]);

    // INSERT lignes
    for (const l of tk.lignes) {
      await client.query(`
        INSERT INTO vak_ventes
          (vak_id, ticket_id, batch_id, date_vente, ref_transaction, moyen_paiement,
           description, segment, unite, quantite, prix_unitaire_ttc, remise,
           total_ht, total_ttc, total_tva, taux_tva, compte, source)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
      `, [vakId, ticketId, batchId, l.date_vente.toISOString(), ref, l.moyen_paiement,
          l.description, l.segment, l.unite, l.quantite, l.prix_unitaire_ttc,
          l.remise, l.total_ht, l.total_ttc, l.total_tva, l.taux_tva, l.compte, source]);
    }
  }

  const statutFinal = nbErreur > 0 && nbImport === 0 ? 'erreur' : 'termine';
  await client.query(`
    UPDATE vak_import_batches SET
      date_debut = $1, date_fin = $2,
      nb_lignes_total = $3, nb_lignes_importees = $4, nb_lignes_erreur = $5,
      nb_tickets_reconstitues = $6, ca_total_ttc = $7, poids_total_kg = $8,
      statut = $9, erreurs = $10
    WHERE id = $11
  `, [dateDebutISO, dateFinISO, nbTotal, nbImport, nbErreur,
      ticketsMap.size, caTotal.toFixed(2), poidsTotal.toFixed(3),
      statutFinal, erreurs.length ? JSON.stringify(erreurs.slice(0, 100)) : null,
      batchId]);

  await client.query('COMMIT');

  // Météo best-effort APRÈS le commit (indépendante de l'atomicité de l'import).
  await captureWeatherForVak(vakId).catch((err) => logger.warn('VAK météo failed', { error: err.message }));

  return {
    batch_id: batchId,
    nb_lignes_total: nbTotal,
    nb_lignes_importees: nbImport,
    nb_lignes_erreur: nbErreur,
    nb_tickets: ticketsMap.size,
    ca_total_ttc: caTotal,
    poids_total_kg: poidsTotal,
    duplicate: false,
  };
  } catch (importErr) {
    await client.query('ROLLBACK').catch(() => {});
    throw importErr;
  } finally {
    client.release();
  }
}

// ── Météo VAK ──
async function captureWeatherForVak(vakId) {
  const vakRow = await pool.query('SELECT id, date_debut, date_fin, latitude, longitude FROM vaks WHERE id = $1', [vakId]);
  if (vakRow.rows.length === 0) return;
  const vak = vakRow.rows[0];
  const lat = vak.latitude || 49.4231;
  const lng = vak.longitude || 1.0993;
  const start = new Date(vak.date_debut);
  const end = new Date(vak.date_fin);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    // dateOnlyStr (composantes locales) et non toISOString : node-postgres
    // matérialise une colonne DATE à minuit LOCAL — toISOString reculerait
    // d'un jour (météo du mauvais jour) si le conteneur tournait à l'est d'UTC.
    const dateStr = dateOnlyStr(d);
    const data = await fetchOpenMeteoDaily(lat, lng, dateStr).catch(() => null);
    if (!data) continue;
    await pool.query(`
      INSERT INTO vak_meteo_quotidien
        (vak_id, date, weather_code, weather_label, temp_min, temp_max,
         precipitation_mm, wind_speed_max, sunshine_hours)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (vak_id, date) DO NOTHING
    `, [vakId, dateStr, data.code, data.label, data.tempMin, data.tempMax,
        data.precipMm, data.windMax, data.sunshineHours]);
  }
}

// ── Sync incrémentale via API ──
async function syncTransactionsFromApi({ io, triggeredBy = null, sinceOverride = null } = {}) {
  const logRes = await pool.query(`
    INSERT INTO vak_sumup_sync_log (sync_type, status, triggered_by)
    VALUES ('api_pull', 'running', $1) RETURNING id
  `, [triggeredBy]);
  const logId = logRes.rows[0].id;

  try {
    // Cursor : dernière newest_time de succès ou override
    let since = sinceOverride;
    if (!since) {
      const last = await pool.query(`
        SELECT newest_time FROM vak_sumup_sync_log
        WHERE sync_type = 'api_pull' AND status = 'success' AND newest_time IS NOT NULL
        ORDER BY started_at DESC LIMIT 1
      `);
      since = last.rows[0]?.newest_time ? new Date(last.rows[0].newest_time) : null;
    }
    // Défaut : 90 jours
    if (!since) since = new Date(Date.now() - 90 * 24 * 3600 * 1000);

    let received = 0;
    let inserted = 0;
    let skipped = 0;
    let newestTime = since;

    // Pagination paginated. L'API SumUp v0.1 retourne items dans `items` ou `transactions`
    let page = 0;
    let cursor = since.toISOString();
    const limit = 250;
    // Garde-fou anti-infini
    while (page < 50) {
      page++;
      let resp;
      try {
        resp = await sumupApiGet('/v0.1/me/transactions/history', {
          oldest_time: cursor,
          limit,
        });
      } catch (err) {
        // Endpoint sandbox indisponible / pas de transactions
        if (page === 1) throw err;
        break;
      }
      const items = Array.isArray(resp) ? resp : (resp?.items || resp?.transactions || []);
      if (!items || items.length === 0) break;
      received += items.length;

      for (const tx of items) {
        // Écarte échec / annulation / en attente ; retient les ventes réussies,
        // l'original remboursé (statut REFUNDED) et les remboursements (négatifs,
        // qui nettent la vente d'origine). Voir isSyncEligibleTransaction.
        if (!isSyncEligibleTransaction(tx)) {
          skipped++;
          continue;
        }
        const ok = await ingestSumUpTransaction(tx, { io, source: 'api_sumup' });
        if (ok) inserted++; else skipped++;
        const txDate = new Date(tx.timestamp || tx.transaction_date || tx.created_at);
        if (txDate > newestTime) newestTime = txDate;
      }
      if (items.length < limit) break;
      // Avance cursor (dernière transaction)
      cursor = new Date(newestTime.getTime() + 1).toISOString();
    }

    await pool.query(`
      UPDATE vak_sumup_sync_log SET
        ended_at = NOW(), status = 'success',
        nb_transactions_received = $1, nb_transactions_inserted = $2, nb_transactions_skipped = $3,
        oldest_time = $4, newest_time = $5
      WHERE id = $6
    `, [received, inserted, skipped, since, newestTime, logId]);

    return { received, inserted, skipped, newest_time: newestTime };
  } catch (err) {
    await pool.query(`
      UPDATE vak_sumup_sync_log SET ended_at = NOW(), status = 'error', error_message = $1
      WHERE id = $2
    `, [String(err.message || err).slice(0, 1000), logId]);
    throw err;
  }
}

// ── Détail d'une transaction SumUp (lignes produits) ──
// Le résumé renvoyé par /v0.1/me/transactions/history et la charge webhook ne
// portent PAS le détail produits — or c'est lui qui contient les quantités
// (donc le poids vendu). La forme DOCUMENTÉE du « retrieve » SumUp est
// GET /v0.1/me/transactions?id=<id> (paramètre de requête) ; l'ancienne forme
// par chemin /v0.1/me/transactions/<id> est conservée en dernier repli.
// Sans détail exploitable, on retombe sur le résumé (ticket 1 ligne globale,
// poids 0 — jamais de valeur inventée) en le JOURNALISANT : un ticket sans
// lignes n'est plus un échec silencieux.
async function fetchTransactionDetail(tx) {
  if (!tx) return tx;
  const hasItems = (Array.isArray(tx.line_items) && tx.line_items.length > 0)
    || (Array.isArray(tx.products) && tx.products.length > 0);
  if (hasItems) return tx;
  const txId = tx.id || tx.transaction_id;
  const txCode = tx.transaction_code;
  if (!txId && !txCode) return tx;
  const attempts = [];
  if (txId) attempts.push(['/v0.1/me/transactions', { id: txId }]);
  if (txCode) attempts.push(['/v0.1/me/transactions', { transaction_code: txCode }]);
  if (txId) attempts.push([`/v0.1/me/transactions/${txId}`, {}]);
  for (const [p, params] of attempts) {
    try {
      const d = await sumupApiGet(p, params);
      if (d && (d.id || d.transaction_code || d.transaction_id || d.amount != null)) return d;
    } catch (_) { /* essaie la forme suivante */ }
  }
  logger.warn('SumUp détail transaction indisponible — résumé utilisé (lignes produits absentes, poids non calculable)', {
    transaction_id: txId || txCode,
  });
  return tx;
}

// ── Ingest une transaction SumUp en BDD (lookup VAK, UPSERT ticket + ventes) ──
async function ingestSumUpTransaction(tx, { io = null, source = 'api_sumup' } = {}) {
  try {
    const txDate = new Date(tx.timestamp || tx.transaction_date || tx.created_at || Date.now());
    // Rattachement à la VAK par date CIVILE Paris (les bornes date_debut /
    // date_fin d'une VAK sont des jours civils français) — la date UTC
    // reculait d'un jour pour une transaction entre minuit et 01:00/02:00 Paris.
    const isoDate = parisDateStr(txDate);

    // Trouver la VAK couvrant cette date
    const vakRow = await pool.query(
      'SELECT id FROM vaks WHERE $1::DATE BETWEEN date_debut AND date_fin ORDER BY date_debut DESC LIMIT 1',
      [isoDate],
    );
    if (vakRow.rows.length === 0) return false; // hors VAK
    const vakId = vakRow.rows[0].id;

    // Détail produits (quantités → poids) : ni le résumé history ni le webhook
    // ne portent les lignes ; on va le chercher (cf. fetchTransactionDetail).
    const txId = tx.id || tx.transaction_id;
    const detail = await fetchTransactionDetail(tx);
    // Mapping pur : montants, quantités et poids signés (négatifs pour un
    // remboursement, cf. mapSumUpTransaction/isRefundTransaction) → le ticket
    // de remboursement nette la vente d'origine dans tous les agrégats et
    // dans les compteurs live. `payment_type` = 'POS' (carte terminal) est
    // ramené à 'CB' par normalizePaymentMethod.
    const {
      refTx, moyenPaiement, entryMode,
      totalTTC, totalHT, totalTVA, poidsTicket, nbArticles, lignes,
    } = mapSumUpTransaction(tx, detail);

    // ── Écriture ATOMIQUE : upsert ticket + reset lignes + réinsertion (vague 3, item 3.B) ──
    // Auparavant hors transaction : un échec entre le DELETE et les INSERT laissait un
    // ticket SANS lignes (KPI ticket présents, mais segments vides). Le fetch du détail
    // (HTTP, ci-dessus) et l'émission Socket.IO (ci-dessous) restent hors transaction.
    const client = await pool.connect();
    let ticketId; let wasInserted;
    try {
      await client.query('BEGIN');
      const tickRes = await client.query(`
        INSERT INTO vak_tickets
          (vak_id, sumup_transaction_id, ref_transaction, date_ticket, moyen_paiement,
           entry_mode, nb_articles, poids_kg, total_ttc, total_ht, total_tva, source)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        ON CONFLICT (vak_id, ref_transaction) DO UPDATE SET
          sumup_transaction_id = COALESCE(EXCLUDED.sumup_transaction_id, vak_tickets.sumup_transaction_id),
          moyen_paiement = EXCLUDED.moyen_paiement,
          entry_mode = COALESCE(EXCLUDED.entry_mode, vak_tickets.entry_mode),
          nb_articles = EXCLUDED.nb_articles,
          poids_kg = EXCLUDED.poids_kg,
          total_ttc = EXCLUDED.total_ttc,
          total_ht = EXCLUDED.total_ht,
          total_tva = EXCLUDED.total_tva,
          source = EXCLUDED.source
        RETURNING id, (xmax = 0) AS inserted
      `, [vakId, txId || null, refTx, txDate.toISOString(), moyenPaiement, entryMode,
          nbArticles, poidsTicket, totalTTC, totalHT, totalTVA, source]);
      ticketId = tickRes.rows[0].id;
      wasInserted = tickRes.rows[0].inserted;

      // Reset lignes en cas d'update
      await client.query('DELETE FROM vak_ventes WHERE ticket_id = $1', [ticketId]);
      for (const l of lignes) {
        await client.query(`
          INSERT INTO vak_ventes
            (vak_id, ticket_id, date_vente, ref_transaction, moyen_paiement,
             description, segment, unite, quantite, prix_unitaire_ttc,
             total_ht, total_ttc, total_tva, taux_tva, source)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
        `, [vakId, ticketId, txDate.toISOString(), refTx, moyenPaiement,
            l.description, l.segment, l.unite, l.quantite, l.prix_unitaire_ttc,
            l.total_ht, l.total_ttc, l.total_tva, l.taux_tva, source]);
      }
      await client.query('COMMIT');
    } catch (txErr) {
      await client.query('ROLLBACK').catch(() => {});
      throw txErr;
    } finally {
      client.release();
    }

    // Émission Socket.IO temps réel pour dashboard live
    if (io && wasInserted) {
      emitLiveUpdate(io, vakId, {
        ticket_id: ticketId,
        ref_transaction: refTx,
        date_ticket: txDate.toISOString(),
        moyen_paiement: moyenPaiement,
        total_ttc: totalTTC,
        poids_kg: poidsTicket,
        nb_articles: nbArticles,
      }).catch((err) => logger.warn('emitLiveUpdate failed', { error: err.message }));
    }

    return wasInserted;
  } catch (err) {
    logger.error('ingestSumUpTransaction', { error: err.message });
    return false;
  }
}

async function emitLiveUpdate(io, vakId, ticket) {
  if (!io) return;
  // Compteurs jour courant et VAK — « aujourd'hui » = jour civil PARIS, et
  // date_ticket (TIMESTAMP stocké en UTC) est ramené au jour civil Paris via
  // la double conversion AT TIME ZONE (même règle que routes/vak.js).
  const today = parisDateStr(new Date());
  const counters = await pool.query(`
    SELECT
      COALESCE(SUM(CASE WHEN ((date_ticket AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Paris')::date = $1::DATE THEN total_ttc END), 0)::FLOAT AS ca_jour,
      COALESCE(SUM(CASE WHEN ((date_ticket AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Paris')::date = $1::DATE THEN poids_kg END), 0)::FLOAT AS poids_jour,
      COUNT(CASE WHEN ((date_ticket AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Paris')::date = $1::DATE THEN 1 END)::INT AS tickets_jour,
      COALESCE(SUM(total_ttc), 0)::FLOAT AS ca_vak,
      COALESCE(SUM(poids_kg), 0)::FLOAT AS poids_vak,
      COUNT(*)::INT AS tickets_vak
    FROM vak_tickets WHERE vak_id = $2
  `, [today, vakId]);
  const objRow = await pool.query('SELECT ca_objectif_ttc, poids_objectif_kg FROM vaks WHERE id = $1', [vakId]);
  const c = counters.rows[0];
  const obj = objRow.rows[0] || {};
  const room = `vak:live:${vakId}`;
  io.to(room).emit('vak:live:transaction', ticket);
  io.to(room).emit('vak:live:counters', {
    ...c,
    objectif_ca: Number(obj.ca_objectif_ttc || 0),
    objectif_poids: Number(obj.poids_objectif_kg || 0),
    pct_objectif_ca: obj.ca_objectif_ttc ? (c.ca_vak / Number(obj.ca_objectif_ttc)) * 100 : null,
  });
}

// ── Enregistrement webhook côté SumUp (best effort) ──
async function registerWebhook() {
  const merchantCode = await getSetting('sumup.merchant_code');
  if (!merchantCode) return null;
  const targetUrl = `${(process.env.PUBLIC_BASE_URL || 'https://solidata.online').replace(/\/$/, '')}/api/vak/sumup/webhook`;
  const token = await getValidAccessToken();
  // Génère un secret HMAC (on l'envoie comme metadata, ou on le stocke en local
  // si SumUp ne le retourne pas).
  const secret = crypto.randomBytes(32).toString('hex');
  try {
    const r = await globalThis.fetch(`${SUMUP_API_BASE}/v0.1/me/merchants/${merchantCode}/webhooks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        url: targetUrl,
        event_types: ['transaction.successful'],
        secret,
      }),
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      logger.warn('SumUp webhook registration failed', { status: r.status, body: txt.slice(0, 200) });
      return null;
    }
    await setEncryptedSetting('sumup.webhook_secret', secret);
    return await r.json();
  } catch (err) {
    logger.warn('SumUp webhook registration error', { error: err.message });
    return null;
  }
}

module.exports = {
  // Status & OAuth
  getConnectionStatus,
  getAuthorizationUrl,
  exchangeCodeForTokens,
  refreshAccessToken,
  getValidAccessToken,
  disconnect,
  // API
  sumupApiGet,
  syncTransactionsFromApi,
  ingestSumUpTransaction,
  fetchTransactionDetail,
  // Webhooks
  validateWebhookSignature,
  registerWebhook,
  // CSV fallback
  importCSVContent,
  parseFRDate,
  // Fuseau Europe/Paris (réutilisés par les scripts de correction + tests)
  parisOffsetMinutes,
  parisWallClockToUTC,
  parisDateStr,
  getSegment,
  isKgItem,
  normalizePaymentMethod,
  // Remboursements (sémantique partagée CSV / API / webhook)
  isRefundTransaction,
  isSyncEligibleTransaction,
  mapSumUpTransaction,
  // Live
  emitLiveUpdate,
  captureWeatherForVak,
  // Settings utilities (utiles aux routes)
  getSetting,
  setSetting,
  getEncryptedSetting,
  setEncryptedSetting,
};
