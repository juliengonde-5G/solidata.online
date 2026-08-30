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

// ── Nombre robuste (voies API/webhook) ──
// SumUp renvoie normalement des nombres JSON, mais certaines charges (webhook,
// détails de transaction) peuvent porter des CHAÎNES, parfois à virgule
// décimale française ("3,2"). Number("3,2") donne NaN → la quantité (donc le
// POIDS pesé saisi en caisse dans le champ quantité) serait perdue ou
// corromprait l'insertion. Jamais de parseInt ni d'arrondi ici : les quantités
// des articles au kilo sont DÉCIMALES (3,2 kg) et doivent survivre telles
// quelles jusqu'à vak_ventes.quantite (NUMERIC(10,3)).
function toNumber(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = parseFloat(String(v).trim().replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

// ── Segments vendus AU POIDS (source unique de la règle « au kilo ») ──
// Constaté sur les données réelles de la caisse (marchand FRIP & CO, ex.
// transaction TAAA4NKXTDV du 07/08/2026, 64,00 €) : la liste des ventes SumUp
// affiche « 1.595 x Chaussures, 10.575 x Vente Plus de 5 kilos » — pour ces
// articles, la QUANTITÉ saisie en caisse est le POIDS pesé en kg (décimale) et
// le prix unitaire est un €/kg (Chaussures 1,595 kg × 3,00 €/kg = 4,78 €).
// Les articles au poids sont donc le textile en vrac ET les chaussures.
// Les consommables (« Sacs », quantités entières) et les libellés inconnus
// restent à la pièce (poids 0 — jamais de poids inventé).
// Cette constante est LA source de vérité : consommée par isKgItem (ingestion
// API/webhook/CSV, resync-vak-details.js via mapSumUpTransaction) et par le
// backfill backfill-vak-poids.js — jamais de liste de libellés dupliquée,
// l'inférence passe par getSegment (mapping libellé → segment ci-dessus).
const KG_SEGMENTS = ['textile_vrac', 'chaussures'];

// ── Détection « vendu au kilo » (unifie CSV + API/webhook) ──
// L'export CSV SumUp porte une colonne « Unité » (kg / pce) : elle FAIT FOI
// quand elle est renseignée. En revanche, les transactions remontées par l'API
// (/v0.1/me/transactions) et par les webhooks n'ont PAS d'unité sur leurs
// produits (name/description + quantity + price seulement) — sans inférence,
// tout le flux API/webhook restait à `unite = 'pce'` et le poids vendu sortait
// à 0 (bug « les poids des ventes sont tous à zéro »). Règle partagée :
//   1. unité explicite non vide → au kilo ssi elle contient « kg »
//      (comportement du chemin CSV, inchangé) ;
//   2. sinon, un produit dont le libellé tombe dans un segment au poids
//      (KG_SEGMENTS : « Vente moins de 5 kg », « Vente plus de 5 kilos »…
//      → textile_vrac ; « Chaussures » → chaussures) est vendu AU KG →
//      poids = quantité (la caisse SumUp saisit le poids pesé, décimal, dans
//      le champ quantité pour ces articles ; le prix unitaire est un €/kg).
// Les consommables (sacs) restent à la pièce (poids 0).
function isKgItem(description, unite = '') {
  const u = String(unite || '').trim().toLowerCase();
  if (u) return u.includes('kg');
  return KG_SEGMENTS.includes(getSegment(description));
}

// ── Poids encodé dans le NOM du produit (forme RÉELLE de l'API SumUp en prod) ──
// Diagnostic production (endpoint /sumup/diagnostic-transaction, transaction
// TAAA4NPRDAC du marchand FRIP & CO) : pour un article PESÉ, la caisse SumUp
// crée un produit dont le NOM est préfixé du poids —
//   products[0] = { name: « 3,88 kg Vente Moins de 5 Kg », quantity: 1,
//                   price: 22.63 (HT), total_price: 22.63 (HT),
//                   price_with_vat: 27.16, total_with_vat: 27.16 (TTC),
//                   vat_rate: 0.2, vat_amount: 4.53 }
// → `quantity` vaut TOUJOURS 1 pour ces articles : le poids n'est PAS dans la
// quantité mais DANS LE TEXTE du nom (décimale à virgule française). Le résumé
// `product_summary` porte la même forme préfixée « 1 x 3,88 kg Vente… ».
// parseKgPrefix extrait ce poids : « 3,88 kg Vente Moins de 5 Kg » →
// { poids: 3.88, libelle: 'Vente Moins de 5 Kg' } ; null si pas de préfixe
// (« Sacs », « Vente Vintiz #12 », « Vente moins de 5 kg » sans nombre…) ou si
// le texte est un résumé MULTI-articles (« 1 x 3,88 kg Vente…, 2 x Sacs ») —
// dans ce cas seul le détail produits (API), le resync ou le rapport CSV
// peuvent reconstruire les lignes, jamais une regex sur le résumé.
function parseKgPrefix(name) {
  const s = String(name || '');
  // Résumé multi-articles : « …, N x … » — jamais parsé (poids par article inconnu).
  if (/,\s*\d+(?:[.,]\d+)?\s*[x×]\s/.test(s)) return null;
  const m = s.match(/^\s*(?:1\s*[x×]\s*)?(\d+(?:[.,]\d+)?)\s*kg\s+(.+)$/i);
  if (!m) return null;
  const poids = toNumber(m[1]);
  if (!poids || poids <= 0) return null;
  return { poids, libelle: m[2].trim() };
}

// ── Identifiant de caisse/employé d'une transaction (filtre de périmètre VAK) ──
// Ce que l'API expose RÉELLEMENT (constaté en production via le diagnostic) :
// le détail de transaction porte un champ TOP-LEVEL `username` (login/email du
// sous-compte SumUp qui a encaissé). Les autres formes (`user` chaîne ou objet
// { email, username, name }) sont couvertes en repli défensif. La charge
// webhook minimale n'en porte généralement pas → compte NULL (honnête : on ne
// sait pas qui a encaissé, le ticket reste compté dans les KPI — cf.
// sqlPerimetreCaisse). ATTENTION : ce `username` API (email/login) n'est PAS
// le même libellé que la colonne « Compte » du rapport CSV (nom d'affichage
// « Caissier Frip & Co ») — d'où `vaks.compte_caisse` en liste d'ALIAS.
function extractCompteCaisse(...objs) {
  for (const o of objs) {
    if (!o || typeof o !== 'object') continue;
    for (const k of ['username', 'user', 'user_name', 'operator', 'cashier']) {
      const v = o[k];
      if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 120);
      if (v && typeof v === 'object') {
        const nested = v.email || v.username || v.name;
        if (typeof nested === 'string' && nested.trim()) return nested.trim().slice(0, 120);
      }
    }
  }
  return null;
}

// ── Caisses EXCLUES de toute VAK (règle globale, arbitrage client 30/08/2026) ──
// « Sur les VAK, l'activité de la caisse VINTIZ est à exclure. »
//
// Le réglage `vaks.compte_caisse` répondait déjà au besoin, mais UNE VAK À LA
// FOIS et par liste blanche : il fallait penser à le renseigner à chaque
// événement, et l'oubli était silencieux — c'est exactement ce qui s'est
// produit sur la VAK d'août 2026, où les 483 € de Vintiz sont entrés dans le
// chiffre d'affaires annoncé. Une règle qui vaut pour toutes les VAK doit être
// écrite une fois, pas recopiée à chaque session.
//
// Cette liste NOIRE s'applique donc à TOUTES les VAK, passées et à venir, sans
// aucune saisie. Elle se combine à `compte_caisse` (liste BLANCHE facultative,
// conservée : elle sert quand un événement doit être restreint à une caisse
// précise) — un ticket est compté s'il n'est pas exclu ET s'il passe le
// périmètre de sa VAK.
//
// Défaut EN CODE, aucun seed en base (doctrine du projet) : la table `settings`
// ne sert qu'à SURCHARGER, clé « vak.caisses_exclues » (alias séparés par des
// virgules, comme `compte_caisse`). Une valeur VIDE est une décision légitime
// — « plus aucune caisse n'est exclue » — et est respectée telle quelle.
const CAISSES_EXCLUES_DEFAUT = ['Caisse Vintiz'];
const SETTING_CAISSES_EXCLUES = 'vak.caisses_exclues';

/** Littéral SQL sûr (apostrophes doublées) — les valeurs viennent du CODE. */
const sqlTexte = (v) => `'${String(v).replace(/'/g, "''")}'`;

/**
 * Tableau SQL des caisses exclues : le réglage s'il existe, sinon le défaut en
 * code. Le CASE distingue « réglage absent » (aucune ligne → NULL → défaut) de
 * « réglage vidé volontairement » (ligne présente, valeur vide → aucune
 * exclusion) — sans lui, on ne pourrait jamais désactiver la règle.
 */
function sqlCaissesExclues() {
  const defaut = CAISSES_EXCLUES_DEFAUT
    .map((c) => sqlTexte(c.trim().toLowerCase())).join(', ');
  return `COALESCE(
      (SELECT CASE WHEN NULLIF(TRIM(s.value), '') IS NULL THEN ARRAY[]::text[]
                   ELSE string_to_array(REGEXP_REPLACE(TRIM(LOWER(s.value)), '\\s*,\\s*', ',', 'g'), ',')
              END
         FROM settings s WHERE s.key = ${sqlTexte(SETTING_CAISSES_EXCLUES)}),
      ARRAY[${defaut}]::text[]
    )`;
}

/**
 * Miroir JS PUR : ce compte est-il celui d'une caisse exclue ?
 * @param {string|null} compteTicket
 * @param {string[]|string|null} [exclues] surcharge (défaut : la liste en code)
 */
function caisseExclue(compteTicket, exclues = CAISSES_EXCLUES_DEFAUT) {
  const compte = String(compteTicket ?? '').trim().toLowerCase();
  if (!compte) return false;   // compte inconnu → jamais exclu (doctrine honnête)
  const liste = Array.isArray(exclues)
    ? exclues
    : String(exclues ?? '').split(',');
  return liste
    .map((c) => String(c).trim().toLowerCase())
    .filter(Boolean)
    .includes(compte);
}

// ── Filtre de périmètre par caisse (SÉMANTIQUE — doctrine honnête) ──────────
// Constat prod (VAK 10-11/07/2026) : une DEUXIÈME caisse SumUp (« Caisse
// Vintiz », ventes à la pièce toute l'année) encaisse sur le même compte
// marchand — ses tickets tombent dans la fenêtre de dates de la VAK et
// polluent les KPI (62 tickets / 798 € sur l'exemple).
// RÈGLE : quand `vaks.compte_caisse` est renseigné (un ou PLUSIEURS alias
// séparés par des virgules — le nom d'affichage de la colonne « Compte » du
// rapport CSV ET/OU le `username` API, qui diffèrent), les agrégats de la VAK
// EXCLUENT les tickets dont le compte est CONNU ET DIFFÉRENT de tous les
// alias. Les tickets à compte NULL/vide (API/webhook sans info) RESTENT
// comptés : on n'exclut que ce qu'on SAIT étranger — sinon le live API (qui
// n'expose pas toujours l'identifiant) disparaîtrait de l'écran TV.
// Le RATTACHEMENT ticket→VAK n'est jamais modifié : on rattache tout, on
// filtre à la LECTURE (le filtre est réversible en vidant compte_caisse).
// Comparaison insensible à la casse et aux espaces de bord.
//
// Version SQL (consommée par routes/vak.js et emitLiveUpdate) : `vakAlias` et
// `ticketAlias` sont des alias de table CONTRÔLÉS par le code appelant (jamais
// une entrée utilisateur) → pas d'injection.
function sqlPerimetreCaisse(vakAlias, ticketAlias) {
  const caisse = `NULLIF(TRIM(${vakAlias}.compte_caisse), '')`;
  const compte = `NULLIF(TRIM(${ticketAlias}.compte), '')`;
  // Alias normalisés : minuscules + espaces autour des virgules retirés, puis
  // comparaison `= ANY(tableau)` (expression corrélée simple, pas de LATERAL).
  const aliases = `string_to_array(REGEXP_REPLACE(TRIM(LOWER(${vakAlias}.compte_caisse)), '\\s*,\\s*', ',', 'g'), ',')`;
  const blanche = `(${caisse} IS NULL OR ${compte} IS NULL OR LOWER(${compte}) = ANY(${aliases}))`;
  // Liste NOIRE globale, appliquée à toutes les VAK sans saisie (cf. ci-dessus).
  // Même doctrine que la liste blanche : un compte INCONNU n'est jamais exclu.
  const noire = `NOT (${compte} IS NOT NULL AND LOWER(${compte}) = ANY(${sqlCaissesExclues()}))`;
  return `(${blanche} AND ${noire})`;
}

// Miroir JS PUR de sqlPerimetreCaisse (testé, réutilisable hors SQL).
// @param {string[]|string} [exclues] liste noire (défaut : la liste en code)
function compteDansPerimetre(compteCaisse, compteTicket, exclues = CAISSES_EXCLUES_DEFAUT) {
  // Liste NOIRE d'abord : elle prime, et vaut pour toutes les VAK.
  if (caisseExclue(compteTicket, exclues)) return false;
  const caisse = String(compteCaisse ?? '').trim();
  if (!caisse) return true; // pas de filtre configuré
  const compte = String(compteTicket ?? '').trim();
  if (!compte) return true; // compte inconnu → jamais exclu (doctrine honnête)
  const aliases = caisse.split(',').map((a) => a.trim().toLowerCase()).filter(Boolean);
  return aliases.includes(compte.toLowerCase());
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
  const hasRealItems = items.length > 0;
  // Identifiant de caisse/employé (top-level `username` constaté en prod) —
  // renseigne vak_tickets.compte pour le filtre de périmètre par caisse.
  const compte = extractCompteCaisse(detail, tx);

  let totalTTC = sign * Math.abs(toNumber(detail.amount) ?? 0);
  let totalHT = 0;
  let totalTVA = 0;
  let poidsTicket = 0;
  let nbArticles = 0;
  const lignes = [];

  if (!hasRealItems) {
    // Ticket SANS détail de lignes (le résumé /transactions/history et la
    // charge webhook n'en portent pas, et le « retrieve » a échoué ou n'en a
    // pas renvoyé) : 1 ligne GLOBALE SYNTHÉTIQUE, marquée `synthetic`.
    // RÈGLES STRICTES (bug « poids trop faibles ») :
    //  - unite = 'pce' TOUJOURS, jamais 'kg' : la quantité 1 est un artefact
    //    de facturation (1 ticket), PAS un poids pesé — la marquer kg ferait
    //    compter ~1 kg par vente au lieu du poids réel (3,2 kg…) ;
    //  - le poids du ticket reste 0 (quantité inconnue — jamais de valeur
    //    inventée) ; le ticket est signalé « sans détail » à l'appelant
    //    (hasRealItems=false) pour alimenter l'indicateur de supervision et
    //    le script de resynchronisation resync-vak-details.js ;
    //  - le segment est dérivé du libellé s'il existe pour ne pas fausser
    //    les analyses par segment.
    const descGlobal = detail.description || detail.product_summary || '';
    const magTTC = Math.abs(toNumber(detail.amount) ?? 0);
    const ht = magTTC / 1.2;
    // « Le texte fait foi » : un résumé MONO-article de forme « 1 x 3,88 kg
    // Vente Moins de 5 Kg » porte le poids RÉEL dans son libellé (la forme
    // constatée de product_summary en prod) → on crée une vraie ligne kg au
    // lieu de la ligne synthétique quantité 1 (le poids n'est plus perdu même
    // quand le « retrieve » du détail échoue). Un résumé multi-articles reste
    // synthétique (poids par article inconnu — jamais de valeur inventée).
    const summaryKg = parseKgPrefix(descGlobal);
    if (summaryKg) {
      lignes.push({
        description: descGlobal,
        segment: getSegment(summaryKg.libelle),
        unite: 'kg',
        quantite: sign * summaryKg.poids,
        prix_unitaire_ttc: sign * (summaryKg.poids > 0 ? magTTC / summaryKg.poids : magTTC),
        total_ttc: sign * magTTC,
        total_ht: sign * ht,
        total_tva: sign * (magTTC - ht),
        taux_tva: 20,
      });
      poidsTicket = sign * summaryKg.poids;
    } else {
      lignes.push({
        description: descGlobal || (refund ? 'Remboursement' : 'Vente'),
        segment: getSegment(descGlobal),
        unite: 'pce',
        quantite: sign * 1,
        prix_unitaire_ttc: sign * magTTC,
        total_ttc: sign * magTTC,
        total_ht: sign * ht,
        total_tva: sign * (magTTC - ht),
        taux_tva: 20,
        synthetic: true,
      });
    }
    totalTTC = sign * magTTC;
    totalHT = sign * ht;
    totalTVA = sign * (magTTC - ht);
    nbArticles = 1;
  } else {
    for (const it of items) {
      const nameRaw = (it.description || it.name || '').trim();
      const rawUnite = (it.unit || '').trim().toLowerCase();
      // ── CASCADE DE DÉTECTION DU POIDS D'UNE LIGNE (source de vérité) ──
      //  1. unité EXPLICITE (colonne « Unité » du CSV) → elle fait foi,
      //     quantité = poids si kg (comportement historique inchangé) ;
      //  2. préfixe « X kg » du NOM produit (forme RÉELLE de l'API en prod,
      //     transaction TAAA4NPRDAC : name « 3,88 kg Vente Moins de 5 Kg »,
      //     quantity toujours 1) → poids = préfixe, quantité SumUp ignorée ;
      //  3. inférence par segment sur `quantity` (KG_SEGMENTS via isKgItem,
      //     forme legacy « Vente plus de 5 kilos » quantity 10.575) conservée.
      const kgPrefix = rawUnite ? null : parseKgPrefix(nameRaw);
      const desc = kgPrefix ? kgPrefix.libelle : nameRaw;
      // toNumber : préserve les quantités DÉCIMALES (3.2) y compris reçues en
      // chaîne à virgule ("3,2") — jamais de parseInt/arrondi (forme legacy où
      // le poids pesé est saisi dans `quantity`).
      const sumupQty = Math.abs(toNumber(it.quantity) ?? 1);
      const qtyMag = kgPrefix ? Math.abs(kgPrefix.poids) : sumupQty;
      // Les produits API/webhook SumUp exposent `price` (prix unitaire), pas
      // `price_per_unit` — repli en cascade pour couvrir les deux formes.
      const unitPriceRaw = Math.abs(toNumber(it.price_per_unit) ?? toNumber(it.unit_price) ?? toNumber(it.price) ?? 0);
      // TTC de ligne : les charges API réelles portent total_with_vat /
      // price_with_vat (TTC) ET total_price / price (HT — piège : sans cette
      // préférence, le HT passait pour le TTC sur la forme prod). Les formes
      // legacy (total_price seul) restent lues comme TTC (comportement
      // historique conservé, fixtures TAAA4NKXTDV).
      const lineTTCmag = Math.abs(
        toNumber(it.total_with_vat)
        ?? (toNumber(it.price_with_vat) != null ? toNumber(it.price_with_vat) * sumupQty : null)
        ?? toNumber(it.total_price)
        ?? (sumupQty * unitPriceRaw),
      );
      const tvaMag = Math.abs(toNumber(it.vat_amount) ?? (lineTTCmag - lineTTCmag / 1.2));
      const htMag = Math.abs(toNumber(it.subtotal) ?? (lineTTCmag - tvaMag));
      // Taux de TVA : l'API prod le renvoie FRACTIONNAIRE (vat_rate: 0.2) là
      // où le CSV utilise 20 — normalisation en pourcentage (0.2 → 20).
      let taux = toNumber(it.vat_rate) ?? 20;
      if (taux > 0 && taux <= 1) taux = taux * 100;
      // BUG « poids à zéro » (Lot 6) : les produits API/webhook n'ont pas de
      // champ `unit` → sans inférence, tout restait à 'pce' et poids 0.
      // L'unité retenue est STOCKÉE pour que les agrégats SQL
      // (`unite ILIKE '%kg%'` dans routes/vak.js) suivent.
      const kg = kgPrefix ? true : isKgItem(desc, rawUnite);
      const unite = rawUnite || (kg ? 'kg' : 'pce');
      const segment = getSegment(desc);
      // Prix unitaire d'un article pesé « au nom préfixé » : un €/kg réel
      // (TTC ÷ poids — TAAA4NPRDAC : 27,16 / 3,88 = 7,00 €/kg), le `price`
      // SumUp étant le total HT de la ligne (pas un prix unitaire).
      const unitPrice = kgPrefix
        ? (qtyMag > 0 ? lineTTCmag / qtyMag : unitPriceRaw)
        : unitPriceRaw;
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
    refTx, moyenPaiement, entryMode, isRefund: refund, compte,
    totalTTC, totalHT, totalTVA, poidsTicket, nbArticles, lignes,
    // false = résumé sans produits (ligne globale — synthétique, ou kg déduite
    // du product_summary mono-article) : le ticket est compté « sans détail »
    // et ne doit jamais écraser un ticket déjà détaillé (cf. garde
    // anti-dégradation d'ingestSumUpTransaction).
    hasRealItems,
  };
}

// ── Forme d'une ligne globale synthétique déjà STOCKÉE ──
// Sert au diagnostic et au script resync-vak-details.js pour repérer les
// tickets api_sumup/webhook_sumup ingérés SANS détail produits : exactement
// UNE ligne de |quantité| = 1 (la forme produite par le fallback de
// mapSumUpTransaction — et, pour l'historique, requalifiée à tort en 'kg' par
// le backfill v2.20.0 : chaque vente au kilo comptait alors ~1 kg au lieu du
// poids pesé). Un vrai ticket mono-article de quantité 1 peut matcher : c'est
// assumé, le resync re-lit la VÉRITÉ chez SumUp (reconstruction idempotente).
function isProbablySyntheticLines(lignes) {
  if (!Array.isArray(lignes) || lignes.length !== 1) return false;
  const q = Math.abs(toNumber(lignes[0].quantite ?? lignes[0].quantity) ?? 0);
  return q === 1;
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
      // renseignée ; si elle est vide, inférence par le libellé (segments au
      // poids KG_SEGMENTS) — même helper que le chemin API/webhook (isKgItem).
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
    // Compte de caisse du ticket = colonne « Compte » du CSV (1re ligne non
    // vide) — alimente le filtre de périmètre par caisse (vaks.compte_caisse).
    const compteTicket = tk.lignes.map((l) => (l.compte || '').trim()).find((c) => c) || null;

    const tickRes = await client.query(`
      INSERT INTO vak_tickets
        (vak_id, ref_transaction, date_ticket, moyen_paiement, nb_articles,
         poids_kg, total_ttc, total_ht, total_tva, compte, batch_id, source)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      ON CONFLICT (vak_id, ref_transaction) DO UPDATE SET
        nb_articles = EXCLUDED.nb_articles,
        poids_kg = EXCLUDED.poids_kg,
        total_ttc = EXCLUDED.total_ttc,
        total_ht = EXCLUDED.total_ht,
        total_tva = EXCLUDED.total_tva,
        compte = COALESCE(EXCLUDED.compte, vak_tickets.compte),
        batch_id = EXCLUDED.batch_id
      RETURNING id
    `, [vakId, ref, tk.date_ticket.toISOString(), tk.moyen_paiement, nbArticles,
        poidsTicket, totalTTC, totalHT, totalTVA, compteTicket ? compteTicket.slice(0, 120) : null,
        batchId, source]);
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
    let sansDetail = 0; // tickets ingérés SANS détail produits (poids inconnu)
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
        const r = await ingestSumUpTransaction(tx, { io, source: 'api_sumup' });
        if (r.inserted) inserted++; else skipped++;
        if (r.sans_detail && !r.preserved) sansDetail++;
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
        oldest_time = $4, newest_time = $5,
        details = COALESCE(details, '{}'::jsonb) || $6::jsonb
      WHERE id = $7
    `, [received, inserted, skipped, since, newestTime,
        JSON.stringify({ sans_detail: sansDetail }), logId]);

    return { received, inserted, skipped, sans_detail: sansDetail, newest_time: newestTime };
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
// Un objet transaction porte-t-il un détail produits exploitable ?
function hasProductItems(d) {
  return !!d && ((Array.isArray(d.line_items) && d.line_items.length > 0)
    || (Array.isArray(d.products) && d.products.length > 0));
}

// Déballe une réponse « liste » : `GET /v0.1/me/transactions?id=…` peut, selon
// la forme servie, renvoyer l'objet transaction directement, un tableau, ou un
// wrapper `{ items: [...] }` — on ramène tout à l'objet transaction.
function unwrapTransactionResponse(resp) {
  if (Array.isArray(resp)) return resp[0] || null;
  if (resp && Array.isArray(resp.items)) return resp.items[0] || null;
  return resp || null;
}

// Version STRUCTURÉE du « retrieve » : essaie les 3 formes d'appel (paramètre
// `?id=` documenté, `?transaction_code=`, ancien chemin `/<id>`), déballe les
// réponses liste, et PRÉFÈRE une réponse portant les produits (c'est elle qui
// contient les quantités, donc le poids pesé) à une réponse valide mais
// résumée. Retourne { ok, has_products, via, detail, attempts[] } — consommée
// par l'endpoint de diagnostic ADMIN et le script resync-vak-details.js pour
// trancher en production la forme réellement servie par l'API.
// `apiGet` est injectable pour les tests (aucun réseau ici en environnement de dev).
async function fetchTransactionDetailStrict({ id, transactionCode } = {}, { apiGet = sumupApiGet } = {}) {
  const attempts = [];
  if (id) attempts.push({ via: 'query_id', path: '/v0.1/me/transactions', params: { id } });
  if (transactionCode) attempts.push({ via: 'query_transaction_code', path: '/v0.1/me/transactions', params: { transaction_code: transactionCode } });
  if (id) attempts.push({ via: 'path_id', path: `/v0.1/me/transactions/${encodeURIComponent(id)}`, params: {} });

  const journal = [];
  let fallback = null; // 1re réponse valide SANS produits (si aucune forme n'en renvoie)
  for (const a of attempts) {
    try {
      const raw = await apiGet(a.path, a.params);
      const d = unwrapTransactionResponse(raw);
      const valid = !!(d && (d.id || d.transaction_code || d.transaction_id || d.amount != null));
      const withProducts = valid && hasProductItems(d);
      journal.push({ via: a.via, ok: valid, has_products: withProducts, error: valid ? null : 'réponse vide ou de forme inattendue' });
      if (withProducts) {
        return { ok: true, has_products: true, via: a.via, detail: d, attempts: journal };
      }
      if (valid && !fallback) fallback = { via: a.via, detail: d };
    } catch (err) {
      journal.push({ via: a.via, ok: false, has_products: false, error: String(err.message || err).slice(0, 300) });
    }
  }
  if (fallback) return { ok: true, has_products: false, via: fallback.via, detail: fallback.detail, attempts: journal };
  return { ok: false, has_products: false, via: null, detail: null, attempts: journal };
}

async function fetchTransactionDetail(tx) {
  if (!tx) return tx;
  if (hasProductItems(tx)) return tx;
  const txId = tx.id || tx.transaction_id;
  const txCode = tx.transaction_code;
  if (!txId && !txCode) return tx;
  const r = await fetchTransactionDetailStrict({ id: txId, transactionCode: txCode });
  if (r.ok && r.has_products) return r.detail;
  if (r.ok) {
    logger.warn('SumUp détail transaction SANS lignes produits — résumé utilisé (poids non calculable, ticket marqué « sans détail »)', {
      transaction_id: txId || txCode, via: r.via,
    });
    return r.detail;
  }
  logger.warn('SumUp détail transaction indisponible — résumé utilisé (lignes produits absentes, poids non calculable)', {
    transaction_id: txId || txCode,
    attempts: r.attempts,
  });
  return tx;
}

// ── Ingest une transaction SumUp en BDD (lookup VAK, UPSERT ticket + ventes) ──
// Retourne un objet { inserted, sans_detail, preserved } :
//  - inserted    : true si un NOUVEAU ticket a été créé (false = mise à jour,
//    hors VAK, préservation ou erreur) ;
//  - sans_detail : true si SumUp n'a pas fourni le détail produits (ligne
//    globale synthétique, poids inconnu → 0) — alimente l'indicateur
//    « tickets sans détail » de la supervision et du diagnostic ;
//  - preserved   : true si un ticket déjà détaillé a été PROTÉGÉ contre
//    l'écrasement par un résumé (cf. garde ci-dessous).
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
    if (vakRow.rows.length === 0) return { inserted: false, sans_detail: false, preserved: false, hors_vak: true };
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
      refTx, moyenPaiement, entryMode, compte,
      totalTTC, totalHT, totalTVA, poidsTicket, nbArticles, lignes, hasRealItems,
    } = mapSumUpTransaction(tx, detail);

    // ── GARDE ANTI-DÉGRADATION (cause de sous-évaluation des poids) ──
    // Un résumé SANS produits (webhook arrivé après une sync détaillée, ou
    // « retrieve » momentanément en échec) ne doit JAMAIS écraser un ticket
    // déjà ingéré avec ses vraies lignes : l'upsert + DELETE/INSERT ci-dessous
    // remplacerait le détail réel (quantités pesées) par la ligne globale
    // synthétique quantité 1 → poids retombé à 0/1 kg. Si le ticket existe et
    // possède déjà des lignes, on le préserve tel quel.
    if (!hasRealItems) {
      const existing = await pool.query(`
        SELECT t.id, COUNT(v.id)::INT AS nb_lignes
        FROM vak_tickets t
        LEFT JOIN vak_ventes v ON v.ticket_id = t.id
        WHERE t.vak_id = $1
          AND (t.ref_transaction = $2 OR ($3::VARCHAR IS NOT NULL AND t.sumup_transaction_id = $3))
        GROUP BY t.id
        LIMIT 1
      `, [vakId, refTx, txId || null]);
      if (existing.rows.length > 0 && existing.rows[0].nb_lignes > 0) {
        return { inserted: false, sans_detail: true, preserved: true };
      }
    }

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
           entry_mode, nb_articles, poids_kg, total_ttc, total_ht, total_tva, compte, source)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        ON CONFLICT (vak_id, ref_transaction) DO UPDATE SET
          sumup_transaction_id = COALESCE(EXCLUDED.sumup_transaction_id, vak_tickets.sumup_transaction_id),
          moyen_paiement = EXCLUDED.moyen_paiement,
          entry_mode = COALESCE(EXCLUDED.entry_mode, vak_tickets.entry_mode),
          nb_articles = EXCLUDED.nb_articles,
          poids_kg = EXCLUDED.poids_kg,
          total_ttc = EXCLUDED.total_ttc,
          total_ht = EXCLUDED.total_ht,
          total_tva = EXCLUDED.total_tva,
          compte = COALESCE(EXCLUDED.compte, vak_tickets.compte),
          source = EXCLUDED.source
        RETURNING id, (xmax = 0) AS inserted
      `, [vakId, txId || null, refTx, txDate.toISOString(), moyenPaiement, entryMode,
          nbArticles, poidsTicket, totalTTC, totalHT, totalTVA, compte, source]);
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
        compte,
      }).catch((err) => logger.warn('emitLiveUpdate failed', { error: err.message }));
    }

    return { inserted: !!wasInserted, sans_detail: !hasRealItems, preserved: false };
  } catch (err) {
    logger.error('ingestSumUpTransaction', { error: err.message });
    return { inserted: false, sans_detail: false, preserved: false, error: err.message };
  }
}

async function emitLiveUpdate(io, vakId, ticket) {
  if (!io) return;
  // Compteurs jour courant et VAK — « aujourd'hui » = jour civil PARIS, et
  // date_ticket (TIMESTAMP stocké en UTC) est ramené au jour civil Paris via
  // la double conversion AT TIME ZONE (même règle que routes/vak.js).
  const today = parisDateStr(new Date());
  // Filtre de périmètre par caisse (cf. sqlPerimetreCaisse) : les compteurs
  // live excluent les tickets d'une AUTRE caisse connue (ex. Vintiz) quand la
  // session a un compte_caisse ; les tickets sans compte restent comptés.
  const counters = await pool.query(`
    SELECT
      COALESCE(SUM(CASE WHEN ((t.date_ticket AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Paris')::date = $1::DATE THEN t.total_ttc END), 0)::FLOAT AS ca_jour,
      COALESCE(SUM(CASE WHEN ((t.date_ticket AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Paris')::date = $1::DATE THEN t.poids_kg END), 0)::FLOAT AS poids_jour,
      COUNT(CASE WHEN ((t.date_ticket AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Paris')::date = $1::DATE THEN 1 END)::INT AS tickets_jour,
      COALESCE(SUM(t.total_ttc), 0)::FLOAT AS ca_vak,
      COALESCE(SUM(t.poids_kg), 0)::FLOAT AS poids_vak,
      COUNT(*)::INT AS tickets_vak
    FROM vak_tickets t
    JOIN vaks vk ON vk.id = t.vak_id
    WHERE t.vak_id = $2 AND ${sqlPerimetreCaisse('vk', 't')}
  `, [today, vakId]);
  const objRow = await pool.query('SELECT ca_objectif_ttc, poids_objectif_kg, compte_caisse FROM vaks WHERE id = $1', [vakId]);
  const c = counters.rows[0];
  const obj = objRow.rows[0] || {};
  const room = `vak:live:${vakId}`;
  // Le ticker ne montre pas une vente d'une AUTRE caisse connue (miroir JS du
  // filtre SQL) ; les compteurs (déjà filtrés) sont toujours réémis.
  if (compteDansPerimetre(obj.compte_caisse, ticket?.compte)) {
    io.to(room).emit('vak:live:transaction', ticket);
  }
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
  fetchTransactionDetailStrict,
  hasProductItems,
  unwrapTransactionResponse,
  isProbablySyntheticLines,
  toNumber,
  // Webhooks
  validateWebhookSignature,
  registerWebhook,
  // CSV fallback
  importCSVContent,
  parseFRDate,
  parseNumberFR,
  splitCSVLine,
  // Fuseau Europe/Paris (réutilisés par les scripts de correction + tests)
  parisOffsetMinutes,
  parisWallClockToUTC,
  parisDateStr,
  getSegment,
  KG_SEGMENTS,
  isKgItem,
  parseKgPrefix,
  normalizePaymentMethod,
  // Filtre de périmètre par caisse (SQL partagé + miroir JS + extraction)
  extractCompteCaisse,
  sqlPerimetreCaisse,
  compteDansPerimetre,
  // Caisses exclues de TOUTE VAK (règle globale — arbitrage client 30/08/2026)
  caisseExclue,
  sqlCaissesExclues,
  sqlTexte,
  CAISSES_EXCLUES_DEFAUT,
  SETTING_CAISSES_EXCLUES,
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
