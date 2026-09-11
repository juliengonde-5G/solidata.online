/**
 * Client de l'API publique Malibou (logiciel de préparation de la paie).
 *
 * ──────────────────────────────────────────────────────────────────────────
 * POURQUOI PASSER PAR MALIBOU ET NON PAR SILAE
 *
 * Malibou produit la paie AVEC Silae, dont il est partenaire. Aller chercher
 * les données directement dans Silae reviendrait à court-circuiter la couche
 * où elles sont SAISIES pour les lire en aval, dans l'outil de production :
 * deux sources, deux vérités, et un écart à expliquer le jour où elles
 * divergent. L'API Silae s'adresse par ailleurs aux éditeurs partenaires
 * conventionnés — SOLIDATA est l'outil interne d'une structure, pas un
 * éditeur qui commercialise une intégration.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * CE QUE CE FICHIER NE DÉCIDE PAS
 *
 * L'hôte de l'API, le nom de l'en-tête d'authentification et les chemins des
 * ressources ne sont PAS écrits en dur ici. Ils sont DÉCOUVERTS une fois par
 * `scripts/malibou-diagnostic.js`, qui interroge l'API réelle et range ce
 * qu'il a constaté dans `settings`. Le client ne fait ensuite que relire ce
 * réglage. Coder une supposition à cet endroit, c'est produire un module qui
 * « marche » en test et rend 404 en production sans que personne ne sache où
 * regarder.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * LECTURE SEULE, ET STRUCTURELLEMENT
 *
 * Toute méthode passe par `malibouGet`, qui n'accepte que GET. La clé fournie
 * par l'exploitant est elle-même en lecture seule côté Malibou ; ce contrôle
 * local est la seconde ceinture — un futur appelant ne peut pas écrire dans la
 * paie par mégarde depuis SOLIDATA.
 *
 * La clé ne figure JAMAIS dans un journal, un message d'erreur ou une réponse
 * d'API : `masquerCle` est le seul chemin par lequel elle peut s'afficher.
 */
const logger = require('../config/logger');
const { secretStore } = require('../utils/secret-settings');

const store = secretStore({ envVar: 'MALIBOU_ENCRYPTION_KEY', libelle: 'clé Malibou' });

const CLE_API = 'malibou.api_key';
const CLE_BASE = 'malibou.api_base';
const CLE_AUTH = 'malibou.auth_mode';

/** Délai maximal d'un appel. Un import de paie ne doit pas retenir un job. */
const TIMEOUT_MS = 20000;
/** Pagination : taille de page demandée par défaut. */
const TAILLE_PAGE = 100;
/** Garde-fou anti-boucle : au-delà, on s'arrête en le DISANT. */
const MAX_PAGES = 200;

/**
 * Modes d'authentification essayés par la sonde, dans cet ordre.
 * Le mode retenu est ensuite figé en réglage : on ne re-teste pas à chaque
 * appel, ce qui multiplierait les 401 dans les journaux de Malibou.
 */
const MODES_AUTH = [
  { id: 'bearer', entete: (cle) => ({ Authorization: `Bearer ${cle}` }) },
  { id: 'x-api-key', entete: (cle) => ({ 'X-API-Key': cle }) },
  { id: 'api-key', entete: (cle) => ({ 'Api-Key': cle }) },
  { id: 'authorization-brut', entete: (cle) => ({ Authorization: cle }) },
];

/** Ne montre que de quoi reconnaître une clé, jamais de quoi s'en servir. */
function masquerCle(cle) {
  if (!cle) return '(absente)';
  const s = String(cle);
  return s.length <= 8 ? `${s.slice(0, 2)}…(${s.length} car.)` : `${s.slice(0, 4)}…${s.slice(-2)} (${s.length} car.)`;
}

async function lireCle() {
  // Le réglage chiffré prime ; la variable d'environnement est le repli pour
  // une installation qui préfère garder ses secrets hors base.
  return (await store.getEncryptedSetting(CLE_API)) || process.env.MALIBOU_API_KEY || null;
}

async function lireConfig() {
  const [cle, base, auth] = await Promise.all([
    lireCle(),
    store.getSetting(CLE_BASE),
    store.getSetting(CLE_AUTH),
  ]);
  return {
    cle,
    base: base || process.env.MALIBOU_API_BASE || null,
    auth: auth || null,
  };
}

/** État de la configuration, sans jamais rendre le secret. */
async function statut() {
  const { cle, base, auth } = await lireConfig();
  return {
    configure: Boolean(cle && base && auth),
    cle_presente: Boolean(cle),
    cle_apercu: masquerCle(cle),
    base_url: base,
    mode_auth: auth,
    manques: [
      !cle ? 'clé API' : null,
      !base ? 'URL de base (lancer le diagnostic)' : null,
      !auth ? "mode d'authentification (lancer le diagnostic)" : null,
    ].filter(Boolean),
  };
}

function construireUrl(base, chemin, query) {
  const url = new URL(chemin.replace(/^\//, ''), base.endsWith('/') ? base : `${base}/`);
  for (const [k, v] of Object.entries(query || {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  return url.toString();
}

/**
 * Appel brut. Exporté pour la sonde, qui doit pouvoir essayer un hôte et un
 * mode d'authentification qui ne sont pas encore enregistrés.
 * @returns {{ok:boolean, status:number, json:any, texte:string, ms:number}}
 */
async function appelBrut({ base, chemin, cle, modeAuth, query, timeout = TIMEOUT_MS }) {
  const mode = MODES_AUTH.find((m) => m.id === modeAuth);
  if (!mode) throw new Error(`Mode d'authentification inconnu : ${modeAuth}`);
  const url = construireUrl(base, chemin, query);
  const t0 = Date.now();
  const ctrl = new AbortController();
  const minuteur = setTimeout(() => ctrl.abort(), timeout);
  try {
    const rep = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json', ...mode.entete(cle) },
      signal: ctrl.signal,
    });
    const texte = await rep.text();
    let json = null;
    try { json = texte ? JSON.parse(texte) : null; } catch { /* réponse non JSON : le texte suffit au diagnostic */ }
    return { ok: rep.ok, status: rep.status, json, texte, ms: Date.now() - t0, retryAfter: rep.headers.get('retry-after') };
  } catch (err) {
    // Un abandon volontaire (timeout) n'est pas une panne du service : il se
    // nomme comme tel, sinon l'exploitant cherche du côté de Malibou.
    const motif = err.name === 'AbortError' ? `délai dépassé (${timeout} ms)` : err.message;
    return { ok: false, status: 0, json: null, texte: motif, ms: Date.now() - t0, erreur: motif };
  } finally {
    clearTimeout(minuteur);
  }
}

/** GET authentifié sur la configuration enregistrée. */
async function malibouGet(chemin, query = {}) {
  const { cle, base, auth } = await lireConfig();
  if (!cle) { const e = new Error('Clé API Malibou non configurée'); e.code = 'MALIBOU_NON_CONFIGURE'; throw e; }
  if (!base || !auth) {
    const e = new Error("URL de base ou mode d'authentification Malibou inconnus — lancer scripts/malibou-diagnostic.js");
    e.code = 'MALIBOU_NON_DECOUVERT';
    throw e;
  }
  const r = await appelBrut({ base, chemin, cle, modeAuth: auth, query });
  if (!r.ok) {
    const e = new Error(`Malibou ${chemin} → HTTP ${r.status}`);
    e.code = r.status === 401 || r.status === 403 ? 'MALIBOU_AUTH' : 'MALIBOU_HTTP';
    e.status = r.status;
    // On garde le corps d'erreur (utile : Malibou y met souvent le motif),
    // borné pour ne pas inonder les journaux.
    e.detail = String(r.texte || '').slice(0, 500);
    throw e;
  }
  return r.json;
}

/**
 * Extrait la liste d'une réponse paginée sans présumer de sa forme : tableau
 * nu, `{data:[…]}`, `{items:[…]}`, `{results:[…]}`… La sonde confirme laquelle
 * Malibou emploie ; ce déballage tolérant évite d'avoir à la réécrire ensuite.
 */
function extraireListe(charge) {
  if (Array.isArray(charge)) return charge;
  if (!charge || typeof charge !== 'object') return [];
  for (const k of ['data', 'items', 'results', 'records', 'employees', 'contracts']) {
    if (Array.isArray(charge[k])) return charge[k];
  }
  return [];
}

/** Curseur/page suivante, quelle que soit la convention employée. */
function pageSuivante(charge, pageCourante) {
  if (!charge || typeof charge !== 'object') return null;
  const meta = charge.meta || charge.pagination || charge;
  if (meta.next_cursor) return { cursor: meta.next_cursor };
  if (meta.nextCursor) return { cursor: meta.nextCursor };
  if (meta.next_page) return { page: meta.next_page };
  if (typeof meta.has_more === 'boolean' && meta.has_more) return { page: pageCourante + 1 };
  if (typeof meta.hasMore === 'boolean' && meta.hasMore) return { page: pageCourante + 1 };
  if (Number.isFinite(meta.total_pages) && pageCourante < meta.total_pages) return { page: pageCourante + 1 };
  return null;
}

/** Parcourt toutes les pages d'une ressource et rend la liste complète. */
async function listerTout(chemin, query = {}) {
  const tout = [];
  let page = 1;
  let curseur = null;
  for (let i = 0; i < MAX_PAGES; i += 1) {
    const q = { ...query, limit: query.limit || TAILLE_PAGE };
    if (curseur) q.cursor = curseur; else if (page > 1) q.page = page;
    const charge = await malibouGet(chemin, q);
    const lot = extraireListe(charge);
    tout.push(...lot);
    const suite = pageSuivante(charge, page);
    if (!suite || lot.length === 0) return tout;
    if (suite.cursor) curseur = suite.cursor; else page = suite.page;
  }
  // On ne boucle pas indéfiniment en silence : la troncature est ANNONCÉE,
  // sans quoi un import partiel passerait pour un import complet.
  logger.warn('[MALIBOU] pagination interrompue au plafond', { chemin, pages: MAX_PAGES, lignes: tout.length });
  return tout;
}

module.exports = {
  MODES_AUTH,
  CLE_API, CLE_BASE, CLE_AUTH,
  store,
  masquerCle,
  lireCle,
  lireConfig,
  statut,
  appelBrut,
  malibouGet,
  listerTout,
  extraireListe,
  pageSuivante,
  construireUrl,
};
