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
const CLE_ORG = 'malibou.organization_id';

/**
 * Valeurs par défaut ÉTABLIES SUR LA DOCUMENTATION Malibou (11/09/2026,
 * API publique v1.11.0), et non supposées : l'hôte, le préfixe et le mode
 * d'authentification y sont écrits noir sur blanc. Elles restent surchargeables
 * par réglage — une documentation est vraie le jour où on la lit.
 */
const BASE_PAR_DEFAUT = 'https://app.malibou.com/api/public/v1';
const AUTH_PAR_DEFAUT = 'bearer';

/**
 * Points d'accès réservés aux partenaires conventionnés. Une clé libre-service
 * y reçoit TOUJOURS un 403, quelles que soient les permissions cochées — la
 * documentation le dit explicitement. Les nommer ici permet de rendre un
 * message qui explique, au lieu d'un « interdit » que personne ne sait lever.
 */
const PARTENAIRES_SEULEMENT = /\/(complementary-contracts|meal-vouchers|affiliations)|\/organizations\/[^/]+$/;

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
  const [cle, base, auth, org] = await Promise.all([
    lireCle(),
    store.getSetting(CLE_BASE),
    store.getSetting(CLE_AUTH),
    store.getSetting(CLE_ORG),
  ]);
  return {
    cle,
    base: base || process.env.MALIBOU_API_BASE || BASE_PAR_DEFAUT,
    auth: auth || AUTH_PAR_DEFAUT,
    org: org || process.env.MALIBOU_ORGANIZATION_ID || null,
  };
}

/** État de la configuration, sans jamais rendre le secret. */
async function statut() {
  const { cle, base, auth, org } = await lireConfig();
  return {
    configure: Boolean(cle && base && auth && org),
    cle_presente: Boolean(cle),
    cle_apercu: masquerCle(cle),
    base_url: base,
    mode_auth: auth,
    organization_id: org,
    manques: [
      !cle ? 'clé API' : null,
      !base ? 'URL de base' : null,
      !auth ? "mode d'authentification" : null,
      // L'identifiant d'organisation fait partie du CHEMIN de chaque appel :
      // sans lui, aucune route n'existe. Il se copie depuis la page « Clés
      // d'API » de Malibou (menu d'actions → « Copier l'ID d'organisation »).
      !org ? "identifiant d'organisation" : null,
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

/** Attente passive, pour les temporisations de débit. */
const attendre = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * GET authentifié sur la configuration enregistrée.
 *
 * TEMPORISATION SUR 429 : la documentation Malibou demande explicitement un
 * retrait exponentiel. Un import de paie balaie plusieurs centaines d'appels
 * (une fiche détaillée par salarié) — sans cette attente, la première limite
 * atteinte ferait échouer l'import entier alors qu'il suffisait de patienter.
 * L'en-tête `Retry-After` fait foi quand il est présent ; sinon on double.
 */
async function malibouGet(chemin, query = {}, { essais = 3 } = {}) {
  const { cle, base, auth } = await lireConfig();
  if (!cle) { const e = new Error('Clé API Malibou non configurée'); e.code = 'MALIBOU_NON_CONFIGURE'; throw e; }
  if (!base || !auth) {
    const e = new Error("URL de base ou mode d'authentification Malibou inconnus");
    e.code = 'MALIBOU_NON_DECOUVERT';
    throw e;
  }

  let attente = 1000;
  for (let essai = 1; ; essai += 1) {
    const r = await appelBrut({ base, chemin, cle, modeAuth: auth, query });
    if (r.ok) return r.json;

    const rejouable = r.status === 429 || r.status === 500 || r.status === 0;
    if (rejouable && essai < essais) {
      const delai = Number(r.retryAfter) > 0 ? Number(r.retryAfter) * 1000 : attente;
      logger.warn('[MALIBOU] temporisation', { chemin, status: r.status, essai, delai_ms: delai });
      await attendre(delai);
      attente *= 2;
      continue;
    }

    const e = new Error(`Malibou ${chemin} → HTTP ${r.status}`);
    e.code = r.status === 401 || r.status === 403 ? 'MALIBOU_AUTH' : 'MALIBOU_HTTP';
    e.status = r.status;
    // On garde le corps d'erreur (Malibou y met le motif), borné pour ne pas
    // inonder les journaux.
    e.detail = String(r.texte || '').slice(0, 500);
    if (r.status === 403 && PARTENAIRES_SEULEMENT.test(chemin)) {
      e.message += " — point d'accès réservé aux partenaires conventionnés : une clé"
        + ' libre-service y reçoit toujours 403, quelles que soient ses permissions.';
    } else if (r.status === 403) {
      e.message += " — la clé n'a pas la permission requise pour ce point d'accès.";
    }
    throw e;
  }
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
/**
 * Parcourt toutes les pages d'une ressource.
 *
 * LA RÈGLE EST CELLE DE MALIBOU, ET ELLE N'EST PAS CELLE QU'ON DEVINE :
 * l'API ne renvoie NI curseur, NI total, NI drapeau « page suivante ». Sa
 * documentation dit d'incrémenter `page` « jusqu'à ce qu'une page rende moins
 * d'éléments que `limit` ». La première version de cette fonction s'arrêtait
 * faute de méta-données — elle aurait donc importé la PREMIÈRE PAGE et
 * annoncé un succès. C'est le pire genre de défaut : un import tronqué qui
 * ressemble à un import complet, et qu'on ne découvre qu'en comptant les
 * salariés manquants des mois plus tard.
 *
 * `page` et `limit` doivent être des entiers STRICTEMENT positifs : l'API
 * refuse le reste en 400.
 */
async function listerTout(chemin, query = {}) {
  const limit = Math.max(1, Number(query.limit) || TAILLE_PAGE);
  const tout = [];

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const charge = await malibouGet(chemin, { ...query, page, limit });
    const lot = extraireListe(charge);
    tout.push(...lot);
    // Page incomplète = dernière page. Page vide = terminé aussi.
    if (lot.length < limit) return tout;
  }

  // On ne boucle pas indéfiniment en silence : la troncature est ANNONCÉE,
  // sans quoi un import partiel passerait pour un import complet.
  logger.warn('[MALIBOU] pagination interrompue au plafond', { chemin, pages: MAX_PAGES, lignes: tout.length });
  return tout;
}

/** Construit un chemin scopé à l'organisation configurée. */
async function cheminOrg(suffixe) {
  const { org } = await lireConfig();
  if (!org) {
    const e = new Error("Identifiant d'organisation Malibou non configuré"
      + " — le copier depuis la page « Clés d'API » (menu d'actions → « Copier l'ID d'organisation »)");
    e.code = 'MALIBOU_ORG_MANQUANTE';
    throw e;
  }
  return `organizations/${encodeURIComponent(org)}/${suffixe.replace(/^\//, '')}`;
}

// ── Ressources accessibles avec une clé LIBRE-SERVICE ────────────────────
// (company, meal-vouchers et complementary-contracts sont « Partners only »
//  et ne sont donc délibérément pas exposés ici.)

/** Liste des collaborateurs. Permission `org:employee:read`. */
async function listerCollaborateurs(query = {}) {
  return listerTout(await cheminOrg('collaborators'), query);
}

/**
 * Fiche détaillée d'un collaborateur. Permission `org:employee:read` ; les
 * données personnelles n'arrivent qu'avec `org:employee:details:read`, et le
 * tableau des contrats qu'avec `org:contract:details:read`.
 * NON paginé (la documentation le précise pour le tableau des contrats).
 */
async function lireCollaborateur(collaboratorId) {
  return malibouGet(await cheminOrg(`collaborators/${encodeURIComponent(collaboratorId)}`));
}

/** Absences chevauchant la période demandée. Permission `org:absence:read`. */
async function listerAbsences({ startDate, endDate, status } = {}) {
  return listerTout(await cheminOrg('absences'), { startDate, endDate, status });
}

/** Lieux de travail et télétravail. Permission `org:work_location:read`. */
async function listerLieuxTravail({ startDate, endDate, status } = {}) {
  return listerTout(await cheminOrg('work-locations'), { startDate, endDate, status });
}

module.exports = {
  MODES_AUTH,
  CLE_API, CLE_BASE, CLE_AUTH, CLE_ORG,
  BASE_PAR_DEFAUT, AUTH_PAR_DEFAUT, PARTENAIRES_SEULEMENT,
  store,
  masquerCle,
  lireCle,
  lireConfig,
  statut,
  appelBrut,
  malibouGet,
  listerTout,
  cheminOrg,
  listerCollaborateurs,
  lireCollaborateur,
  listerAbsences,
  listerLieuxTravail,
  extraireListe,
  pageSuivante,
  construireUrl,
};
