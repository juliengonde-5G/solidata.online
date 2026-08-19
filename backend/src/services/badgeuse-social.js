/**
 * Écran d'information v2 — MÉDIAS EXTERNES du module 33 « Temps & Présence »
 * (CDC_AFFICHAGE_V2 §2, ADR-0004 §6, ADR-0006).
 *
 * Ce fichier regroupe TOUT ce que le serveur va chercher DEHORS pour l'écran :
 * médias partagés, réseaux sociaux (API Meta Graph), presse nationale (flux
 * RSS) et météo (Open-Meteo). Le point commun n'est pas le sujet, c'est le
 * principe structurant ci-dessous — et les gardes qui vont avec.
 *
 * ══ PRINCIPE STRUCTURANT ══
 * LE POSTE NE CONTACTE JAMAIS UN DOMAINE EXTERNE. Tout contenu venu du dehors
 * (lien partagé par un utilisateur, visuel d'un post Instagram/Facebook) est
 * rapatrié PAR LE SERVEUR, stocké dans `uploads/badgeuse/`, puis servi au poste
 * par l'API device (`GET /devices/:code/media/:id`). La CSP du kiosque reste
 * `'self'` et l'affichage continue de fonctionner hors ligne (AFF-07).
 *
 * ══ CONSÉQUENCE : LE SERVEUR DEVIENT LE CLIENT HTTP ══
 * Un serveur qui télécharge une URL fournie par un utilisateur est une surface
 * SSRF classique (« va me chercher http://169.254.169.254/… »). Les gardes de
 * `assertSafeHttpsUrl` sont donc NON NÉGOCIABLES et s'appliquent aussi aux URL
 * rendues par l'API Meta (on ne fait pas davantage confiance à un tiers) :
 *   1. `https:` uniquement (jamais http, file, gopher, data…) ;
 *   2. résolution DNS explicite, puis REJET si UNE SEULE des adresses est
 *      privée / loopback / lien-local / multicast / réservée ;
 *   3. redirections suivies à la main (3 sauts max), chaque saut REVALIDÉ ;
 *   4. type MIME en liste blanche (image/vidéo), taille plafonnée en flux
 *      (abandon dès le dépassement), délai global borné.
 *
 * LIMITE CONNUE, DITE PLUTÔT QUE TUE : entre la résolution DNS et la connexion,
 * un attaquant maîtrisant la zone peut faire varier la réponse (DNS rebinding).
 * S'en prémunir imposerait de se connecter à l'IP validée avec l'en-tête Host
 * d'origine, ce qui casse la validation TLS (SNI). Le risque résiduel est
 * accepté ici : l'écriture est réservée à ADMIN/RH (surface interne), et le
 * contenu rapatrié n'est jamais interprété (fichier statique servi tel quel).
 *
 * ══ RÉSEAUX SOCIAUX ══
 * API officielle Meta Graph avec jeton chiffré (AES-256-GCM, pattern SumUp) —
 * JAMAIS de scraping. Sans jeton, le job est un no-op SILENCIEUX : le partage
 * manuel (types `media` / `lien`) reste la voie nominale. Les stories vidéo
 * relèvent de la V2 (ADR-0004 §6) : les vidéos sont ignorées et JOURNALISÉES,
 * jamais promises à moitié.
 *
 * Aucune donnée personnelle de salarié ne transite ici : ce sont des
 * publications publiques des comptes DE la structure.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dns = require('dns');
const net = require('net');
const pool = require('../config/database');
const { readBadgeuseParams, writeSetting, META_TOKEN_KEY, SOCIAL_DERNIER_SYNC_KEY } = require('../utils/badgeuse-settings');
const { decryptSecret } = require('../utils/badgeuse-crypto');

// ── Racine de stockage des médias du module ────────────────────────────────
// Un seul répertoire, deux sous-espaces : la racine pour les médias
// téléversés/rapatriés depuis un lien, `social/` pour les visuels des posts.
const MEDIA_ROOT = path.join(__dirname, '..', '..', 'uploads', 'badgeuse');
const SOCIAL_SUBDIR = 'social';
// Vignettes de presse : sous-dossier DÉDIÉ. Ce n'est pas cosmétique — la purge
// des médias orphelins (scheduler) ne balaie que les dossiers qu'elle connaît :
// un fichier posé à la racine et référencé par une table qu'elle ignore serait
// effacé sous 24 h, et l'écran presse perdrait ses images en silence.
const PRESSE_SUBDIR = 'presse';

/** Types de médias diffusables sur le kiosque (liste blanche STRICTE). */
const MEDIA_MIME_BY_EXT = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

/** Extension canonique d'un type MIME accepté (première forme rencontrée). */
const MEDIA_EXT_BY_MIME = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
};

const MAX_REDIRECTS = 3;
const DOWNLOAD_TIMEOUT_MS = 30000;
const GRAPH_TIMEOUT_MS = 15000;
const GRAPH_VERSION = 'v21.0';

/** Erreur métier portant un code stable (les routes le traduisent en 4xx). */
class MediaError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// ── Chemins ────────────────────────────────────────────────────────────────

/** Racine absolue des médias du module (créée à la demande). */
function mediaRoot() {
  return MEDIA_ROOT;
}

/** Crée un répertoire de médias s'il n'existe pas (best effort). */
function ensureMediaDir(sub = '') {
  const dir = sub ? path.join(MEDIA_ROOT, sub) : MEDIA_ROOT;
  try { fs.mkdirSync(dir, { recursive: true }); } catch (_) { /* déjà là, ou droits — l'écriture le dira */ }
  return dir;
}

/**
 * Résout un chemin RELATIF stocké en base vers un chemin absolu, en refusant
 * tout ce qui sort de la racine (path traversal). Rend `null` si le chemin est
 * absolu, remonte (`..`), ou porte un séparateur Windows.
 *
 * C'est le SEUL point d'entrée autorisé pour servir un fichier : la valeur
 * vient de la base, mais la base n'est pas une frontière de confiance.
 */
function resolveMediaPath(relatif) {
  const brut = String(relatif == null ? '' : relatif).trim();
  if (!brut) return null;
  if (brut.includes('\0') || brut.includes('\\')) return null;
  if (path.isAbsolute(brut)) return null;
  if (brut.split('/').some((seg) => seg === '..')) return null;
  const abs = path.resolve(MEDIA_ROOT, brut);
  const racine = path.resolve(MEDIA_ROOT) + path.sep;
  if (!abs.startsWith(racine)) return null;
  return abs;
}

/** Type MIME sûr d'un fichier, d'après son EXTENSION seule (jamais de sniffing). */
function mimeForFile(relatif) {
  const ext = path.extname(String(relatif || '')).toLowerCase();
  return MEDIA_MIME_BY_EXT[ext] || null;
}

/** 'image' | 'video' | null, d'après le type MIME. */
function mediaTypeForMime(mime) {
  const m = String(mime || '').toLowerCase().split(';')[0].trim();
  if (!MEDIA_EXT_BY_MIME[m]) return null;
  return m.startsWith('video/') ? 'video' : 'image';
}

/** Supprime un fichier média (best effort, jamais bloquant). */
function unlinkMedia(relatif) {
  const abs = resolveMediaPath(relatif);
  if (!abs) return false;
  try { fs.unlinkSync(abs); return true; } catch (_) { return false; }
}

// ── Gardes anti-SSRF ───────────────────────────────────────────────────────

/**
 * Une adresse IP est-elle NON routable publiquement ? (v4 et v6)
 * Fonction PURE — c'est l'oracle du garde-fou SSRF, testé à part.
 */
function isPrivateAddress(ip) {
  const adresse = String(ip || '').trim().toLowerCase();
  if (!adresse) return true; // rien de connu ⇒ on refuse

  if (net.isIPv4(adresse)) {
    const o = adresse.split('.').map(Number);
    if (o.some((n) => !Number.isFinite(n) || n < 0 || n > 255)) return true;
    if (o[0] === 0) return true;                                  // 0.0.0.0/8
    if (o[0] === 10) return true;                                 // privé
    if (o[0] === 127) return true;                                // loopback
    if (o[0] === 169 && o[1] === 254) return true;                // lien-local (métadonnées cloud)
    if (o[0] === 172 && o[1] >= 16 && o[1] <= 31) return true;    // privé
    if (o[0] === 192 && o[1] === 168) return true;                // privé
    if (o[0] === 192 && o[1] === 0 && o[2] === 0) return true;    // IETF
    if (o[0] === 100 && o[1] >= 64 && o[1] <= 127) return true;   // CGNAT
    if (o[0] === 198 && (o[1] === 18 || o[1] === 19)) return true; // bancs d'essai
    if (o[0] >= 224) return true;                                 // multicast + réservé + broadcast
    return false;
  }

  if (net.isIPv6(adresse)) {
    const v6 = adresse.replace(/^\[|\]$/g, '');
    // IPv4 encapsulée (::ffff:10.0.0.1) : c'est l'adresse v4 qui décide.
    const mapped = /(?:^|:)((?:\d{1,3}\.){3}\d{1,3})$/.exec(v6);
    if (mapped) return isPrivateAddress(mapped[1]);
    if (v6 === '::' || v6 === '::1') return true;                 // non spécifiée / loopback
    if (/^f[cd]/.test(v6)) return true;                           // fc00::/7 unique-local
    if (/^fe[89ab]/.test(v6)) return true;                        // fe80::/10 lien-local
    if (/^ff/.test(v6)) return true;                              // ff00::/8 multicast
    return false;
  }

  return true; // ni v4 ni v6 ⇒ on refuse
}

/**
 * Valide une URL avant que le serveur ne la contacte : https, hôte résolu, et
 * AUCUNE des adresses obtenues dans un plan d'adressage interne.
 * @throws {MediaError} code `protocole` | `hote` | `dns` | `ip_privee`
 * @returns {Promise<URL>}
 */
async function assertSafeHttpsUrl(rawUrl) {
  let url;
  try {
    url = new URL(String(rawUrl || '').trim());
  } catch (_) {
    throw new MediaError('protocole', 'Lien invalide : une URL https complète est attendue');
  }
  if (url.protocol !== 'https:') {
    throw new MediaError('protocole', 'Seuls les liens https sont acceptés (le serveur télécharge le contenu à la place du poste)');
  }
  const hote = url.hostname.replace(/^\[|\]$/g, '');
  if (!hote) throw new MediaError('hote', 'Lien invalide : hôte absent');

  // Hôte déjà littéral : pas de DNS à interroger, on tranche tout de suite.
  if (net.isIP(hote)) {
    if (isPrivateAddress(hote)) {
      throw new MediaError('ip_privee', 'Lien refusé : il désigne une adresse du réseau interne');
    }
    return url;
  }

  let adresses;
  try {
    adresses = await dns.promises.lookup(hote, { all: true });
  } catch (err) {
    throw new MediaError('dns', `Lien refusé : le nom de domaine « ${hote} » n'a pas pu être résolu`);
  }
  const liste = (Array.isArray(adresses) ? adresses : [adresses]).filter(Boolean);
  if (liste.length === 0) {
    throw new MediaError('dns', `Lien refusé : aucune adresse pour « ${hote} »`);
  }
  // UNE SEULE adresse interne suffit à refuser (un domaine peut en publier
  // plusieurs, dont une privée : accepter reviendrait à jouer aux dés).
  for (const a of liste) {
    if (isPrivateAddress(a && a.address)) {
      throw new MediaError('ip_privee', 'Lien refusé : il désigne une adresse du réseau interne');
    }
  }
  return url;
}

/**
 * Télécharge un média distant sous garde SSRF, en flux et avec plafond.
 *
 * @param {string} rawUrl URL https
 * @param {object} o { maxBytes, sousDossier, prefixe, timeoutMs }
 * @returns {Promise<{fichier:string, media_type:string, media_sha256:string, mime:string, bytes:number}>}
 * @throws {MediaError} `protocole`|`hote`|`dns`|`ip_privee`|`redirections`|`http`|`type`|`trop_gros`|`reseau`
 */
async function downloadMedia(rawUrl, {
  maxBytes = 50 * 1024 * 1024,
  sousDossier = '',
  prefixe = 'media',
  timeoutMs = DOWNLOAD_TIMEOUT_MS,
} = {}) {
  const controleur = new AbortController();
  const minuteur = setTimeout(() => controleur.abort(), timeoutMs);
  try {
    let cible = await assertSafeHttpsUrl(rawUrl);
    let reponse = null;

    // Redirections suivies À LA MAIN : chaque saut repasse par la garde
    // (un 302 vers http://169.254.169.254 est le contournement classique).
    for (let saut = 0; saut <= MAX_REDIRECTS; saut += 1) {
      try {
        reponse = await globalThis.fetch(cible.toString(), {
          redirect: 'manual',
          signal: controleur.signal,
          headers: { Accept: 'image/*,video/*;q=0.9,*/*;q=0.1' },
        });
      } catch (err) {
        throw new MediaError('reseau', `Téléchargement impossible : ${err.name === 'AbortError' ? 'délai dépassé' : 'contenu injoignable'}`);
      }
      const statut = Number(reponse.status) || 0;
      if (statut >= 300 && statut < 400) {
        const location = reponse.headers && reponse.headers.get ? reponse.headers.get('location') : null;
        if (!location) throw new MediaError('http', 'Lien refusé : redirection sans destination');
        if (saut === MAX_REDIRECTS) throw new MediaError('redirections', 'Lien refusé : trop de redirections');
        cible = await assertSafeHttpsUrl(new URL(location, cible).toString());
        continue;
      }
      break;
    }

    if (!reponse || !reponse.ok) {
      throw new MediaError('http', `Lien refusé : le contenu répond ${reponse ? reponse.status : 'sans statut'}`);
    }

    const entetes = reponse.headers && reponse.headers.get ? reponse.headers : { get: () => null };
    const mime = String(entetes.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const mediaType = mediaTypeForMime(mime);
    if (!mediaType) {
      throw new MediaError('type', `Ce lien ne pointe pas vers une image ou une vidéo diffusable (type reçu : ${mime || 'inconnu'})`);
    }
    // Refus AVANT téléchargement quand la taille est annoncée.
    const annonce = parseInt(entetes.get('content-length') || '', 10);
    if (Number.isFinite(annonce) && annonce > maxBytes) {
      throw new MediaError('trop_gros', `Contenu trop volumineux (${Math.round(annonce / 1048576)} Mo, maximum ${Math.round(maxBytes / 1048576)} Mo)`);
    }

    const dir = ensureMediaDir(sousDossier);
    const nom = `${prefixe}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}${MEDIA_EXT_BY_MIME[mime]}`;
    const relatif = sousDossier ? `${sousDossier}/${nom}` : nom;
    const abs = path.join(dir, nom);

    const hash = crypto.createHash('sha256');
    let total = 0;
    const morceaux = [];
    const avaler = (chunk) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buf.length;
      // Plafond appliqué EN FLUX : un serveur menteur sur content-length est
      // coupé net au lieu de saturer le disque.
      if (total > maxBytes) {
        throw new MediaError('trop_gros', `Contenu trop volumineux (maximum ${Math.round(maxBytes / 1048576)} Mo)`);
      }
      hash.update(buf);
      morceaux.push(buf);
    };

    if (reponse.body && typeof reponse.body.getReader === 'function') {
      const lecteur = reponse.body.getReader();
      for (;;) {
        const { done, value } = await lecteur.read();
        if (done) break;
        try {
          avaler(value);
        } catch (err) {
          try { await lecteur.cancel(); } catch (_) { /* flux déjà clos */ }
          throw err;
        }
      }
    } else if (typeof reponse.arrayBuffer === 'function') {
      // Repli (implémentations sans flux) : la taille est vérifiée après coup,
      // le plafond annoncé ayant déjà filtré le gros du risque.
      avaler(Buffer.from(await reponse.arrayBuffer()));
    } else {
      throw new MediaError('reseau', 'Téléchargement impossible : réponse illisible');
    }

    if (total === 0) throw new MediaError('type', 'Le lien renvoie un contenu vide');
    await fs.promises.writeFile(abs, Buffer.concat(morceaux));

    return {
      fichier: relatif,
      media_type: mediaType,
      media_sha256: hash.digest('hex'),
      mime,
      bytes: total,
    };
  } finally {
    clearTimeout(minuteur);
  }
}

// ── Réseaux sociaux (API Meta Graph) ───────────────────────────────────────

/** Jeton Meta en clair (déchiffré à l'usage), ou null s'il n'est pas configuré. */
async function readMetaToken() {
  try {
    const r = await pool.query('SELECT value FROM settings WHERE key = $1', [META_TOKEN_KEY]);
    const chiffre = r.rows[0] ? r.rows[0].value : null;
    if (!chiffre) return null;
    return decryptSecret(chiffre);
  } catch (_) {
    return null;
  }
}

/**
 * Normalise un post Graph, quelle que soit la forme rendue.
 * Fonction PURE : les deux dialectes (Page Facebook / compte Instagram
 * Business) n'ont ni les mêmes noms de champs ni la même structure, et Meta
 * fait évoluer les deux. On lit donc en TOLÉRANT les alias plutôt qu'en
 * supposant une forme unique — et ce qu'on ne comprend pas est signalé, jamais
 * inventé.
 * @returns {object|null} { post_id, permalink, legende, media_url, publie_le, kind }
 */
function normalizeGraphPost(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const postId = raw.id || raw.post_id || null;
  if (!postId) return null;
  const mediaUrl = raw.media_url || raw.full_picture || raw.picture || raw.thumbnail_url || null;
  const kindBrut = String(raw.media_type || raw.type || '').toUpperCase();
  const kind = kindBrut === 'VIDEO' || kindBrut === 'REELS' ? 'video' : 'image';
  return {
    post_id: String(postId).slice(0, 100),
    permalink: raw.permalink || raw.permalink_url || null,
    legende: raw.caption || raw.message || raw.description || null,
    media_url: mediaUrl,
    publie_le: raw.timestamp || raw.created_time || null,
    kind,
  };
}

/** Extrait le tableau de posts d'une réponse Graph, sans supposer sa forme. */
function extractGraphData(json) {
  if (Array.isArray(json)) return json;
  if (json && Array.isArray(json.data)) return json.data;
  if (json && json.data && Array.isArray(json.data.data)) return json.data.data;
  return null;
}

/** Un GET Graph JSON, borné en temps, qui ne lève jamais sur le réseau. */
async function graphGet(url, timeoutMs = GRAPH_TIMEOUT_MS) {
  const controleur = new AbortController();
  const minuteur = setTimeout(() => controleur.abort(), timeoutMs);
  try {
    const r = await globalThis.fetch(url, { signal: controleur.signal });
    const json = await r.json().catch(() => null);
    return { ok: !!r.ok, status: r.status, json };
  } catch (err) {
    return { ok: false, status: 0, json: null, erreur: err.message };
  } finally {
    clearTimeout(minuteur);
  }
}

/**
 * Derniers posts d'un compte. La forme exacte de l'appel dépend du TYPE de
 * compte (Page Facebook, compte Instagram Business relié à une Page, ou compte
 * Instagram via Basic Display) — ce que le paramétrage ne dit pas toujours.
 * Les deux hôtes connus sont donc essayés pour Instagram, et l'échec est
 * journalisé avec ce que Meta a répondu : mieux vaut un message exploitable
 * qu'un silence.
 */
async function fetchComptePosts(reseau, graphId, token, limit) {
  const champsIg = 'id,permalink,caption,media_type,media_url,thumbnail_url,timestamp';
  const champsFb = 'id,permalink_url,message,full_picture,created_time';
  const urls = reseau === 'instagram'
    ? [
      `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(graphId)}/media?fields=${champsIg}&limit=${limit}&access_token=${encodeURIComponent(token)}`,
      `https://graph.instagram.com/${encodeURIComponent(graphId)}/media?fields=${champsIg}&limit=${limit}&access_token=${encodeURIComponent(token)}`,
    ]
    : [
      `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(graphId)}/posts?fields=${champsFb}&limit=${limit}&access_token=${encodeURIComponent(token)}`,
    ];

  let dernierEchec = null;
  for (const url of urls) {
    const r = await graphGet(url);
    const data = r.ok ? extractGraphData(r.json) : null;
    if (data) return { posts: data.map(normalizeGraphPost).filter(Boolean) };
    dernierEchec = r.ok
      ? 'réponse Graph de forme inattendue (aucun tableau « data »)'
      : `Graph ${r.status || 'injoignable'}${r.json && r.json.error && r.json.error.message ? ` — ${r.json.error.message}` : ''}`;
  }
  return { posts: [], erreur: dernierEchec };
}

/**
 * Synchronisation des derniers posts des comptes de la structure.
 *
 * RÉSILIENT PAR CONSTRUCTION : aucune erreur ne remonte (un réseau social
 * indisponible ne doit pas faire échouer un run de scheduler, ni vider l'écran
 * — la dernière playlist reçue continue de tourner). Chaque anomalie est
 * journalisée avec le compte concerné.
 *
 * NE PURGE RIEN : la conservation des posts est appliquée au SEUL endroit
 * documenté, la purge RGPD planifiée (`badgeusePurgeRetention`, setting
 * `badgeuse.retention_social_jours`). Deux purges concurrentes = deux règles
 * qui divergent le jour où l'une change.
 */
async function syncSocialPosts() {
  const bilan = { items: 0, comptes: 0, posts: 0, videos_ignorees: 0, erreurs: 0 };
  try {
    const params = await readBadgeuseParams();
    if (!params.social_sync_actif) return { ...bilan, ignore: 'desactive' };

    const token = await readMetaToken();
    if (!token) {
      // No-op SILENCIEUX : l'absence de jeton est un choix d'exploitation
      // (partage manuel), pas une panne à signaler trois fois par jour.
      return { ...bilan, ignore: 'sans_jeton' };
    }

    const comptes = Array.isArray(params.social_comptes) ? params.social_comptes : [];
    const limit = Math.min(20, Math.max(1, parseInt(params.social_posts_par_compte, 10) || 5));
    const maxBytes = Math.max(1, Number(params.lien_taille_max_mo) || 50) * 1024 * 1024;

    for (const c of comptes) {
      if (!c || !c.actif) continue;
      const reseau = c.reseau === 'facebook' ? 'facebook' : 'instagram';
      const graphId = c.graph_id || c.id || null;
      if (!graphId) {
        // Rien n'est deviné à partir du nom d'utilisateur : l'identifiant
        // Graph est une donnée de paramétrage, pas une inférence.
        console.warn(`[BADGEUSE-SOCIAL] ${reseau}/${c.compte || '?'} : identifiant Graph non renseigné — compte ignoré`);
        bilan.erreurs += 1;
        continue;
      }

      const { posts, erreur } = await fetchComptePosts(reseau, graphId, token, limit);
      if (erreur) {
        console.error(`[BADGEUSE-SOCIAL] ${reseau}/${c.compte || graphId} : ${erreur}`);
        bilan.erreurs += 1;
        continue;
      }
      bilan.comptes += 1;

      for (const p of posts) {
        try {
          if (p.kind === 'video') {
            // ADR-0004 §6 : les stories/vidéos relèvent de la V2.
            bilan.videos_ignorees += 1;
            continue;
          }
          if (!p.media_url) continue;

          // Un post déjà connu ET déjà pourvu de son visuel n'est pas
          // retéléchargé (idempotence, et on ne martèle pas le CDN de Meta).
          const connu = await pool.query(
            'SELECT id, media_fichier FROM badgeuse_social_posts WHERE reseau = $1 AND post_id = $2',
            [reseau, p.post_id]
          );
          let media = null;
          if (!connu.rows[0] || !connu.rows[0].media_fichier) {
            media = await downloadMedia(p.media_url, {
              maxBytes,
              sousDossier: SOCIAL_SUBDIR,
              prefixe: `${reseau}`,
            });
          }

          await pool.query(
            `INSERT INTO badgeuse_social_posts
               (reseau, compte, post_id, permalink, legende, media_fichier, media_sha256, publie_le, sync_le)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
             ON CONFLICT (reseau, post_id) DO UPDATE SET
               compte = EXCLUDED.compte,
               permalink = COALESCE(EXCLUDED.permalink, badgeuse_social_posts.permalink),
               legende = COALESCE(EXCLUDED.legende, badgeuse_social_posts.legende),
               media_fichier = COALESCE(EXCLUDED.media_fichier, badgeuse_social_posts.media_fichier),
               media_sha256 = COALESCE(EXCLUDED.media_sha256, badgeuse_social_posts.media_sha256),
               publie_le = COALESCE(EXCLUDED.publie_le, badgeuse_social_posts.publie_le),
               sync_le = NOW()`,
            [
              reseau, String(c.compte || graphId).slice(0, 100), p.post_id,
              p.permalink ? String(p.permalink).slice(0, 500) : null,
              p.legende ? String(p.legende).slice(0, 2000) : null,
              media ? media.fichier : null,
              media ? media.media_sha256 : null,
              p.publie_le || null,
            ]
          );
          bilan.posts += 1;
        } catch (err) {
          bilan.erreurs += 1;
          console.error(`[BADGEUSE-SOCIAL] ${reseau}/${c.compte || graphId} — post ignoré : ${err.message}`);
        }
      }
    }

    bilan.items = bilan.posts;
    await writeSetting(SOCIAL_DERNIER_SYNC_KEY, new Date().toISOString()).catch(() => {});
    if (bilan.posts || bilan.erreurs) {
      console.log(`[BADGEUSE-SOCIAL] Synchronisation : ${bilan.posts} post(s), ${bilan.videos_ignorees} vidéo(s) ignorée(s) (V2), ${bilan.erreurs} anomalie(s)`);
    }
    return bilan;
  } catch (err) {
    console.error('[BADGEUSE-SOCIAL] Erreur de synchronisation :', err.message);
    return { ...bilan, erreurs: bilan.erreurs + 1 };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PRESSE NATIONALE (ADR-0006) — flux RSS rapatriés par le SERVEUR
//
// L'écran d'actualité interne (`actus`, table news_articles) est conservé tel
// quel : la presse nationale est un type de contenu DISTINCT (`presse`), avec
// UN ÉCRAN PAR ARTICLE (demande de l'exploitant, août 2026).
//
// Le poste ne joint jamais le site de presse : le serveur lit le flux, range
// les articles en base et télécharge la vignette sous les MÊMES gardes que les
// visuels sociaux. Conséquence utile : l'écran continue de tourner hors ligne
// sur le dernier état connu (AFF-07).
// ═══════════════════════════════════════════════════════════════════════════

/** Taille maximale d'un flux RSS accepté (un fil « à la une » pèse ~100 Ko). */
const RSS_MAX_BYTES = 5 * 1024 * 1024;
const RSS_TIMEOUT_MS = 15000;

/** Types de contenu admis pour un flux (une page HTML n'est PAS un flux). */
const RSS_MIMES = [
  'application/rss+xml', 'application/atom+xml', 'application/xml',
  'text/xml', 'application/rdf+xml', 'text/rss+xml',
];

/**
 * Entités XML/HTML les plus fréquentes dans les fils de presse français.
 * Volontairement COURTE : ce qu'on ne sait pas décoder reste affiché tel quel
 * (une entité visible est un défaut cosmétique ; un décodage approximatif
 * fabriquerait du texte que la source n'a pas écrit).
 */
const ENTITES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  laquo: '«', raquo: '»', hellip: '…', rsquo: '’', lsquo: '‘',
  ldquo: '“', rdquo: '”', ndash: '–', mdash: '—', eacute: 'é', egrave: 'è',
  ecirc: 'ê', agrave: 'à', ccedil: 'ç', ugrave: 'ù', ocirc: 'ô', icirc: 'î',
  euro: '€', deg: '°', middot: '·', times: '×',
};

/** Décode les entités connues (nommées et numériques). Fonction PURE. */
function decodeEntites(texte) {
  return String(texte == null ? '' : texte)
    .replace(/&#x([0-9a-f]+);/gi, (m, hex) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : m;
    })
    .replace(/&#(\d+);/g, (m, dec) => {
      const code = parseInt(dec, 10);
      return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : m;
    })
    .replace(/&([a-z]+);/gi, (m, nom) => {
      const cle = String(nom).toLowerCase();
      return Object.prototype.hasOwnProperty.call(ENTITES, cle) ? ENTITES[cle] : m;
    });
}

/** Texte lisible d'un fragment de flux : CDATA retiré, balises ôtées, espaces normalisés. */
function texteFlux(brut) {
  const sansCdata = String(brut == null ? '' : brut).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
  const sansBalises = sansCdata.replace(/<[^>]*>/g, ' ');
  return decodeEntites(sansBalises).replace(/\s+/g, ' ').trim();
}

/** Contenu du premier élément `<nom>` d'un bloc (brut, CDATA compris). */
function baliseFlux(bloc, nom) {
  const m = new RegExp(`<(?:[a-z0-9]+:)?${nom}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[a-z0-9]+:)?${nom}>`, 'i').exec(bloc);
  return m ? m[1] : null;
}

/** Valeur d'un attribut sur la première balise `<nom …>` d'un bloc. */
function attributFlux(bloc, nom, attribut) {
  const balise = new RegExp(`<(?:[a-z0-9]+:)?${nom}(\\s[^>]*)/?>`, 'i').exec(bloc);
  if (!balise) return null;
  const m = new RegExp(`${attribut}\\s*=\\s*["']([^"']+)["']`, 'i').exec(balise[1]);
  return m ? decodeEntites(m[1]).trim() : null;
}

/** Date d'un flux (RFC 822 ou ISO 8601) → ISO, ou null si illisible. */
function dateFlux(brut) {
  const t = texteFlux(brut);
  if (!t) return null;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Lit un flux RSS 2.0 ou Atom. Fonction PURE, testée sur des fils réels.
 *
 * PAS DE PARSEUR XML GÉNÉRIQUE, et c'est délibéré : un flux de presse est une
 * entrée non maîtrisée, et les parseurs XML complets traînent une surface
 * d'attaque (entités externes, expansion récursive) dont on n'a aucun besoin
 * ici. On lit les quelques balises attendues et on ignore le reste.
 *
 * @returns {Array<{guid,titre,chapo,lien,publie_le,media_url,media_kind}>}
 */
function parseFluxRss(xml) {
  const source = String(xml == null ? '' : xml);
  let blocs = source.match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>/gi);
  const atom = !blocs;
  if (atom) blocs = source.match(/<entry(?:\s[^>]*)?>[\s\S]*?<\/entry>/gi);
  if (!blocs) return [];

  const articles = [];
  for (const bloc of blocs) {
    const titre = texteFlux(baliseFlux(bloc, 'title'));
    if (!titre) continue;                       // sans titre, il n'y a pas d'écran

    // Atom porte le lien en attribut ; RSS dans le texte de la balise.
    const lien = texteFlux(baliseFlux(bloc, 'link')) || attributFlux(bloc, 'link', 'href') || null;
    const description = baliseFlux(bloc, 'description')
      || baliseFlux(bloc, 'summary')
      || baliseFlux(bloc, 'encoded')            // content:encoded
      || baliseFlux(bloc, 'content');

    // Le visuel, dans l'ordre de fiabilité décroissante. `enclosure` et
    // `media:content` portent leur type MIME : c'est lui qui distingue une
    // image d'une vidéo, jamais l'extension du fichier.
    let mediaUrl = null;
    let mediaMime = null;
    for (const [balise, attr] of [['enclosure', 'url'], ['content', 'url'], ['thumbnail', 'url']]) {
      const u = attributFlux(bloc, balise, attr);
      if (!u) continue;
      mediaUrl = u;
      mediaMime = attributFlux(bloc, balise, 'type');
      break;
    }
    if (!mediaUrl && description) {
      const img = /<img[^>]+src\s*=\s*["']([^"']+)["']/i.exec(description);
      if (img) mediaUrl = decodeEntites(img[1]).trim();
    }
    const kind = String(mediaMime || '').toLowerCase().startsWith('video/') ? 'video' : 'image';

    const guid = texteFlux(baliseFlux(bloc, 'guid')) || texteFlux(baliseFlux(bloc, 'id')) || lien;
    if (!guid) continue;                        // rien de stable à dédoublonner

    articles.push({
      guid: guid.slice(0, 400),
      titre: titre.slice(0, 400),
      chapo: texteFlux(description).slice(0, 600) || null,
      lien: lien ? lien.slice(0, 600) : null,
      publie_le: dateFlux(baliseFlux(bloc, 'pubDate') || baliseFlux(bloc, 'published') || baliseFlux(bloc, 'updated') || baliseFlux(bloc, 'date')),
      media_url: mediaUrl,
      media_kind: mediaUrl ? kind : null,
    });
  }
  return articles;
}

/**
 * Télécharge un flux RSS sous garde SSRF (mêmes règles que les médias : https,
 * IP publiques, redirections revalidées, taille et délai bornés).
 * @throws {MediaError}
 */
async function fetchFluxRss(rawUrl, { maxBytes = RSS_MAX_BYTES, timeoutMs = RSS_TIMEOUT_MS } = {}) {
  const controleur = new AbortController();
  const minuteur = setTimeout(() => controleur.abort(), timeoutMs);
  try {
    let cible = await assertSafeHttpsUrl(rawUrl);
    let reponse = null;
    for (let saut = 0; saut <= MAX_REDIRECTS; saut += 1) {
      try {
        reponse = await globalThis.fetch(cible.toString(), {
          redirect: 'manual',
          signal: controleur.signal,
          headers: { Accept: 'application/rss+xml,application/xml;q=0.9,*/*;q=0.1' },
        });
      } catch (err) {
        throw new MediaError('reseau', `Flux injoignable : ${err.name === 'AbortError' ? 'délai dépassé' : err.message}`);
      }
      const statut = Number(reponse.status) || 0;
      if (statut >= 300 && statut < 400) {
        const location = reponse.headers && reponse.headers.get ? reponse.headers.get('location') : null;
        if (!location) throw new MediaError('http', 'Flux refusé : redirection sans destination');
        if (saut === MAX_REDIRECTS) throw new MediaError('redirections', 'Flux refusé : trop de redirections');
        cible = await assertSafeHttpsUrl(new URL(location, cible).toString());
        continue;
      }
      break;
    }
    if (!reponse || !reponse.ok) {
      throw new MediaError('http', `Flux refusé : réponse ${reponse ? reponse.status : 'absente'}`);
    }
    const entetes = reponse.headers && reponse.headers.get ? reponse.headers : { get: () => null };
    const mime = String(entetes.get('content-type') || '').split(';')[0].trim().toLowerCase();
    // Une page HTML au lieu d'un flux (erreur d'URL, mur de consentement) doit
    // être dite, pas « parsée au cas où » : on n'en tirerait que du faux.
    if (mime && !RSS_MIMES.includes(mime)) {
      throw new MediaError('type', `Ce lien ne renvoie pas un flux RSS (type reçu : ${mime})`);
    }
    const annonce = parseInt(entetes.get('content-length') || '', 10);
    if (Number.isFinite(annonce) && annonce > maxBytes) {
      throw new MediaError('trop_gros', 'Flux trop volumineux');
    }
    const texte = await reponse.text();
    if (texte.length > maxBytes) throw new MediaError('trop_gros', 'Flux trop volumineux');
    return texte;
  } finally {
    clearTimeout(minuteur);
  }
}

/**
 * Synchronisation des flux de presse configurés.
 *
 * RÉSILIENT : un flux en panne n'empêche pas les autres, et n'efface jamais ce
 * qui est déjà en base — l'écran continue sur le dernier état connu.
 * NE PURGE RIEN (comme la synchro sociale) : la conservation est appliquée au
 * seul endroit documenté, `badgeusePurgeRetention`.
 */
async function syncPresseArticles() {
  const bilan = { items: 0, flux: 0, articles: 0, vignettes: 0, videos_ignorees: 0, erreurs: 0 };
  try {
    const params = await readBadgeuseParams();
    if (!params.presse_sync_actif) return { ...bilan, ignore: 'desactive' };

    const flux = Array.isArray(params.presse_flux) ? params.presse_flux : [];
    const limite = Math.min(20, Math.max(1, parseInt(params.presse_articles_par_flux, 10) || 8));
    const maxBytes = Math.max(1, Number(params.lien_taille_max_mo) || 50) * 1024 * 1024;

    for (const f of flux) {
      if (!f || !f.actif || !f.url) continue;
      const libelle = String(f.libelle || f.url).slice(0, 120);
      const source = String(f.source || f.libelle || '').slice(0, 120) || null;

      let articles;
      try {
        articles = parseFluxRss(await fetchFluxRss(f.url));
      } catch (err) {
        console.error(`[BADGEUSE-PRESSE] ${libelle} : ${err.message}`);
        bilan.erreurs += 1;
        continue;
      }
      if (articles.length === 0) {
        console.warn(`[BADGEUSE-PRESSE] ${libelle} : flux lu mais aucun article reconnu`);
        bilan.erreurs += 1;
        continue;
      }
      bilan.flux += 1;

      for (const a of articles.slice(0, limite)) {
        try {
          // Un article déjà connu ET déjà pourvu de sa vignette n'est pas
          // retéléchargé (idempotence, et on ne martèle pas le CDN du média).
          const connu = await pool.query(
            'SELECT id, media_fichier FROM badgeuse_presse_articles WHERE flux = $1 AND guid = $2',
            [libelle, a.guid]
          );
          let media = null;
          const videoRefusee = a.media_kind === 'video' && !params.presse_video_autorisee;
          if (videoRefusee) bilan.videos_ignorees += 1;

          if (a.media_url && params.presse_vignettes && !videoRefusee
              && (!connu.rows[0] || !connu.rows[0].media_fichier)) {
            try {
              media = await downloadMedia(a.media_url, {
                maxBytes, sousDossier: PRESSE_SUBDIR, prefixe: 'presse',
              });
              bilan.vignettes += 1;
            } catch (err) {
              // Une vignette manquante n'annule pas l'article : l'écran
              // affichera le titre en grand, ce qui est déjà l'essentiel.
              console.warn(`[BADGEUSE-PRESSE] ${libelle} — vignette ignorée : ${err.message}`);
            }
          }

          await pool.query(
            `INSERT INTO badgeuse_presse_articles
               (flux, source, guid, titre, chapo, lien, publie_le, media_fichier, media_sha256, media_type, sync_le)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
             ON CONFLICT (flux, guid) DO UPDATE SET
               source = EXCLUDED.source,
               titre = EXCLUDED.titre,
               chapo = COALESCE(EXCLUDED.chapo, badgeuse_presse_articles.chapo),
               lien = COALESCE(EXCLUDED.lien, badgeuse_presse_articles.lien),
               publie_le = COALESCE(EXCLUDED.publie_le, badgeuse_presse_articles.publie_le),
               media_fichier = COALESCE(EXCLUDED.media_fichier, badgeuse_presse_articles.media_fichier),
               media_sha256 = COALESCE(EXCLUDED.media_sha256, badgeuse_presse_articles.media_sha256),
               media_type = COALESCE(EXCLUDED.media_type, badgeuse_presse_articles.media_type),
               sync_le = NOW()`,
            [
              libelle, source, a.guid, a.titre, a.chapo, a.lien, a.publie_le,
              media ? media.fichier : null,
              media ? media.media_sha256 : null,
              media ? media.media_type : null,
            ]
          );
          bilan.articles += 1;
        } catch (err) {
          bilan.erreurs += 1;
          console.error(`[BADGEUSE-PRESSE] ${libelle} — article ignoré : ${err.message}`);
        }
      }
    }

    bilan.items = bilan.articles;
    if (bilan.articles || bilan.erreurs) {
      console.log(`[BADGEUSE-PRESSE] Synchronisation : ${bilan.articles} article(s), ${bilan.vignettes} vignette(s), ${bilan.videos_ignorees} vidéo(s) non rediffusée(s), ${bilan.erreurs} anomalie(s)`);
    }
    return bilan;
  } catch (err) {
    console.error('[BADGEUSE-PRESSE] Erreur de synchronisation :', err.message);
    return { ...bilan, erreurs: bilan.erreurs + 1 };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MÉTÉO (type de contenu `meteo`) — Open-Meteo, rapatriée par le SERVEUR
//
// Le poste n'appelle pas Open-Meteo : la CSP du kiosque reste 'self' et
// l'écran doit tenir hors ligne. Le serveur range la prévision en base
// (`badgeuse_meteo`), la playlist la lit. Aucune valeur n'est inventée : sans
// relevé pour AUJOURD'HUI, le générateur ne rend rien et l'écran est omis.
// ═══════════════════════════════════════════════════════════════════════════

/** Coordonnées à 4 décimales (~11 m) : la clé de cache doit être stable. */
const arrondiCoord = (v) => Math.round(Number(v) * 10000) / 10000;

/** Jour civil Paris décalé de `n` jours (le poste vit à l'heure murale Paris). */
function jourParisDecale(n = 0, maintenant = new Date()) {
  const d = new Date(maintenant.getTime() + n * 86400000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

/**
 * Lieu de la météo d'un poste, EN CASCADE HONNÊTE :
 *   site du poste (badgeuse_sites.latitude/longitude) → réglages badgeuse.* →
 *   null (aucune coordonnée ⇒ aucun écran météo, jamais une ville par défaut).
 * La `source` retenue accompagne la prévision jusqu'à l'écran.
 */
async function resolveMeteoLieu(siteId = null) {
  if (siteId != null) {
    try {
      const r = await pool.query(
        'SELECT code, libelle, latitude, longitude FROM badgeuse_sites WHERE id = $1',
        [siteId]
      );
      const site = r.rows[0];
      if (site && site.latitude != null && site.longitude != null) {
        return {
          latitude: arrondiCoord(site.latitude),
          longitude: arrondiCoord(site.longitude),
          libelle: site.libelle || site.code || null,
          source: 'site',
        };
      }
    } catch (_) {
      // Colonnes absentes (base non migrée) : on retombe sur le paramètre.
    }
  }
  const params = await readBadgeuseParams();
  const lat = Number(params.meteo_latitude);
  const lng = Number(params.meteo_longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    latitude: arrondiCoord(lat),
    longitude: arrondiCoord(lng),
    libelle: params.meteo_lieu || null,
    source: 'parametre',
  };
}

/** Prévisions déjà connues pour un lieu, d'aujourd'hui à J+n (ordre chronologique). */
async function readMeteoCache(lieu, jours = 3) {
  const debut = jourParisDecale(0);
  const fin = jourParisDecale(Math.max(0, jours));
  const r = await pool.query(
    `SELECT to_char(jour, 'YYYY-MM-DD') AS jour, code, libelle,
            temp_min, temp_max, precip_mm, vent_max, releve_le
     FROM badgeuse_meteo
     WHERE latitude = $1 AND longitude = $2 AND jour BETWEEN $3::date AND $4::date
     ORDER BY jour`,
    [lieu.latitude, lieu.longitude, debut, fin]
  );
  return r.rows.map((x) => ({
    jour: x.jour,
    code: x.code == null ? null : Number(x.code),
    libelle: x.libelle || null,
    temp_min: x.temp_min == null ? null : Number(x.temp_min),
    temp_max: x.temp_max == null ? null : Number(x.temp_max),
    precip_mm: x.precip_mm == null ? null : Number(x.precip_mm),
    vent_max: x.vent_max == null ? null : Number(x.vent_max),
    releve_le: x.releve_le || null,
  }));
}

/**
 * Rafraîchit la prévision d'un lieu (une seule requête Open-Meteo pour toute
 * la plage). Rend le nombre de jours écrits, 0 si la source n'a rien donné —
 * auquel cas la base garde le dernier état connu plutôt qu'un trou.
 */
async function refreshMeteoLieu(lieu, jours = 3) {
  const { fetchOpenMeteoDailyRange } = require('../utils/weather');
  const debut = jourParisDecale(0);
  const fin = jourParisDecale(Math.max(0, jours));
  const prev = await fetchOpenMeteoDailyRange(lieu.latitude, lieu.longitude, debut, fin);
  if (!prev || !Array.isArray(prev.jours) || prev.jours.length === 0) return 0;

  let ecrits = 0;
  for (const j of prev.jours) {
    if (!j || !j.date) continue;
    await pool.query(
      `INSERT INTO badgeuse_meteo
         (latitude, longitude, jour, code, libelle, temp_min, temp_max, precip_mm, vent_max, releve_le)
       VALUES ($1,$2,$3::date,$4,$5,$6,$7,$8,$9,NOW())
       ON CONFLICT (latitude, longitude, jour) DO UPDATE SET
         code = EXCLUDED.code, libelle = EXCLUDED.libelle,
         temp_min = EXCLUDED.temp_min, temp_max = EXCLUDED.temp_max,
         precip_mm = EXCLUDED.precip_mm, vent_max = EXCLUDED.vent_max,
         releve_le = NOW()`,
      [
        lieu.latitude, lieu.longitude, j.date,
        j.code == null ? null : Math.round(Number(j.code)),
        j.label || null,
        j.tempMin == null ? null : Number(j.tempMin),
        j.tempMax == null ? null : Number(j.tempMax),
        j.precipMm == null ? null : Number(j.precipMm),
        j.windMax == null ? null : Number(j.windMax),
      ]
    );
    ecrits += 1;
  }
  return ecrits;
}

/**
 * Job de rafraîchissement : tous les lieux réellement utilisés (sites équipés
 * d'un poste ET pourvus de coordonnées, plus le lieu de repli des réglages).
 * Dédoublonné par coordonnées : deux sites au même endroit = un seul appel.
 */
async function syncMeteo() {
  const bilan = { items: 0, lieux: 0, jours: 0, erreurs: 0 };
  try {
    const params = await readBadgeuseParams();
    if (!params.meteo_sync_actif) return { ...bilan, ignore: 'desactive' };
    const jours = Math.min(5, Math.max(0, parseInt(params.meteo_jours_prevision, 10) || 0));

    const lieux = new Map();
    const ajouter = (lieu) => {
      if (!lieu) return;
      lieux.set(`${lieu.latitude}:${lieu.longitude}`, lieu);
    };
    try {
      const sites = await pool.query(
        `SELECT DISTINCT s.id FROM badgeuse_sites s
         JOIN badgeuse_devices d ON d.site_id = s.id AND d.actif = true
         WHERE s.actif = true`
      );
      for (const row of sites.rows) ajouter(await resolveMeteoLieu(row.id));
    } catch (err) {
      console.error(`[BADGEUSE-METEO] Sites illisibles : ${err.message}`);
      bilan.erreurs += 1;
    }
    // Le lieu de repli est rafraîchi dans tous les cas : un poste appairé plus
    // tard doit trouver une prévision prête, pas un écran vide.
    ajouter(await resolveMeteoLieu(null));

    for (const lieu of lieux.values()) {
      try {
        const ecrits = await refreshMeteoLieu(lieu, jours);
        if (ecrits === 0) {
          console.warn(`[BADGEUSE-METEO] ${lieu.libelle || `${lieu.latitude},${lieu.longitude}`} : source injoignable, dernier état conservé`);
          bilan.erreurs += 1;
          continue;
        }
        bilan.lieux += 1;
        bilan.jours += ecrits;
      } catch (err) {
        bilan.erreurs += 1;
        console.error(`[BADGEUSE-METEO] ${lieu.libelle || 'lieu'} : ${err.message}`);
      }
    }
    bilan.items = bilan.jours;
    return bilan;
  } catch (err) {
    console.error('[BADGEUSE-METEO] Erreur de synchronisation :', err.message);
    return { ...bilan, erreurs: bilan.erreurs + 1 };
  }
}

module.exports = {
  MEDIA_MIME_BY_EXT,
  MEDIA_EXT_BY_MIME,
  MEDIA_ROOT,
  SOCIAL_SUBDIR,
  PRESSE_SUBDIR,
  MediaError,
  mediaRoot,
  ensureMediaDir,
  resolveMediaPath,
  mimeForFile,
  mediaTypeForMime,
  unlinkMedia,
  isPrivateAddress,
  assertSafeHttpsUrl,
  downloadMedia,
  normalizeGraphPost,
  extractGraphData,
  fetchComptePosts,
  readMetaToken,
  syncSocialPosts,
  // Presse nationale (ADR-0006)
  parseFluxRss,
  decodeEntites,
  texteFlux,
  fetchFluxRss,
  syncPresseArticles,
  // Météo de l'écran de veille
  resolveMeteoLieu,
  readMeteoCache,
  refreshMeteoLieu,
  syncMeteo,
  jourParisDecale,
};
