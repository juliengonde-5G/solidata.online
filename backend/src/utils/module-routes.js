/**
 * Correspondance ROUTEUR D'API → CLÉ(S) DE MODULE de la matrice d'habilitations.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * POURQUOI CE FICHIER EXISTE
 *
 * Depuis la 2.56.0 la matrice `/admin/permissions` peut ACCORDER un module à un
 * rôle, et plus seulement le lui retirer. Pour qu'un accord soit autre chose
 * qu'un lien de plus dans la barre latérale, `authorize()` doit pouvoir répondre
 * à la question « la requête en cours relève-t-elle d'un module accordé à ce
 * rôle ? ». Or `authorize('ADMIN', 'RH')` ne connaît que des rôles : il ignore
 * tout du module auquel appartient la route qu'il garde.
 *
 * Cette carte comble ce trou, en UN SEUL endroit. L'alternative — poser un
 * `moduleContext('operations')` sur chacun des ~75 montages d'`index.js` —
 * disperserait la même information sur 75 lignes qu'on oublierait de tenir à
 * jour ; ici, la garde anti-dérive ci-dessous fait échouer la suite dès qu'un
 * routeur monté n'a pas sa réponse.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * DEUX RÈGLES, ET LEURS RAISONS
 *
 * 1. UN ROUTEUR PEUT RELEVER DE PLUSIEURS MODULES. Ce n'est pas une facilité :
 *    la barre latérale elle-même expose `/refashion` sous « Analyse » ET sous
 *    « Audit & conformité », `/fill-rate` sous « Opérations » ET « Audit ». Un
 *    écran atteignable par deux sections doit s'ouvrir si l'une OU l'autre est
 *    accordée, sinon l'accord tiendrait sur le chemin emprunté par l'exploitant
 *    plutôt que sur ce qu'il a coché.
 *
 * 2. `null` SIGNIFIE « HORS MATRICE », ET C'EST UN CHOIX EXPLICITE. Les routeurs
 *    d'authentification, de santé, de webhooks signés, de l'API partenaire, du
 *    poste badgeuse et de la matrice elle-même ne relèvent d'aucun module : rien
 *    ne doit pouvoir les ouvrir par un accord. `null` est écrit à la main, jamais
 *    déduit d'une absence — une clé oubliée fait échouer la garde anti-dérive au
 *    lieu de devenir silencieusement « hors matrice ».
 *
 * NB : la carte dit de QUEL module relève une route. Elle ne dit pas qui y a
 * droit — c'est `authorize()` qui le décide, et un accord ne fait que s'ajouter
 * à sa liste de rôles. Elle ne relâche donc aucune garde par elle-même.
 */

// Préfixe de montage (tel qu'écrit dans index.js) → clé(s) du MODULE_CATALOG.
// Les préfixes les plus longs priment (cf. resoudreModules) : '/api/badgeuse/device'
// est hors matrice alors que '/api/badgeuse' relève du module badgeuse.
const MODULE_PAR_ROUTEUR = {
  // ── Hors matrice (règle 2) ────────────────────────────────────────────────
  '/api/auth': null,              // authentification : antérieure à tout module
  '/api/health': null,            // sonde de supervision
  '/api/webhooks': null,          // entrants signés (SumUp, Live Objects)
  '/api/public': null,            // API partenaire, clés dédiées
  '/api/permissions': null,       // la matrice ne peut pas s'ouvrir elle-même
  '/api/push': null,              // abonnement aux notifications, tout compte
  '/api/chat': null,              // assistant : périmètre propre (routes/chat.js)
  '/api/badgeuse/device': null,   // poste RFID, X-Device-Key (pas un utilisateur)
  '/api/geocodage': null,         // utilitaire d'adresses, aucune donnée métier

  // ── Accueil ───────────────────────────────────────────────────────────────
  '/api/news': 'accueil',
  '/api/dashboard': ['accueil', 'analyse'], // tableau de bord ET dashboard exécutif

  // ── Opérations (collecte, logistique, stock) ──────────────────────────────
  '/api/cav': 'operations',
  '/api/vehicles': 'operations',
  '/api/vehicle-contracts': 'operations',
  '/api/tours': 'operations',
  '/api/incidents': 'operations',
  '/api/association-points': 'operations',
  '/api/association-demandes': 'operations',
  '/api/communes': 'operations',
  '/api/stock': 'operations',
  '/api/stock-original': ['operations', 'admin'], // Stock Original : écran sous Administration
  '/api/produits-finis': 'operations',
  '/api/expeditions': 'operations',
  '/api/clients-exutoires': 'operations',
  '/api/tarifs-exutoires': 'operations',
  '/api/commandes-exutoires': 'operations',
  '/api/preparations': 'operations',
  '/api/controles-pesee': 'operations',
  '/api/factures-exutoires': 'operations',
  '/api/calendrier-logistique': 'operations',
  '/api/partners': 'operations', // référentiel exutoires/clients, aval logistique

  // ── Tri ───────────────────────────────────────────────────────────────────
  '/api/tri': 'tri',
  '/api/production': 'tri',
  '/api/chaine-config': 'tri',
  // Étiquettes : clé PROPRE, imbriquée sous « Tri » dans la barre latérale.
  // Accorder « Tri » emporte donc les étiquettes ; accorder « Étiquettes » seul
  // n'ouvre que cet écran. Le refus, lui, reste porté par requireModule.
  '/api/etiquettes': ['etiquettes', 'tri'],

  // ── RH & Insertion ────────────────────────────────────────────────────────
  '/api/candidates': 'rh',
  '/api/employees': 'rh',
  '/api/prescripteurs': 'rh',
  '/api/insertion': 'rh',
  '/api/effectifs': 'rh',
  '/api/malibou': 'rh',
  '/api/pcm': ['pcm', 'rh'],

  // ── Gestion d'équipe ──────────────────────────────────────────────────────
  '/api/teams': 'equipe',
  '/api/planning-hebdo': 'equipe',

  // ── QHSE, RSE et modules satellites ───────────────────────────────────────
  '/api/qhse': 'qhse',
  '/api/rse': 'rse',
  '/api/energie': 'energie',
  '/api/enquetes': 'enquetes',
  '/api/achats': 'achats',

  // ── Analyse & Audit ───────────────────────────────────────────────────────
  '/api/reporting': ['analyse', 'audit'],
  '/api/exports': ['analyse', 'audit'],
  '/api/metropole': ['audit', 'analyse'],
  '/api/refashion': ['audit', 'analyse', 'admin'],
  '/api/historique': 'analyse',
  '/api/performance': 'analyse',
  '/api/finance': 'analyse',
  '/api/pennylane': 'analyse',

  // ── Frip ──────────────────────────────────────────────────────────────────
  '/api/boutiques': ['boutiques', 'frip'],
  '/api/boutique-ventes': ['boutiques', 'frip'],
  '/api/boutique-commandes': ['boutiques', 'frip'],
  '/api/boutique-objectifs': ['boutiques', 'frip'],
  '/api/boutique-meteo': ['boutiques', 'frip'],
  '/api/vak': ['vak', 'frip'],

  // ── Temps & Présence, messagerie ──────────────────────────────────────────
  '/api/badgeuse': 'badgeuse',
  '/api/messages': 'messagerie',

  // ── Administration du logiciel ────────────────────────────────────────────
  // Ces clés restent REFUSABLES, mais jamais accordables (cf. MODULES_NON_ACCORDABLES).
  '/api/users': 'admin',
  '/api/settings': 'admin',
  '/api/admin-db': 'admin',
  '/api/admin/api-keys': 'admin',
  '/api/activity-log': 'admin',
  '/api/rgpd': 'admin',
  '/api/alert-thresholds': 'admin',
  '/api/referentiels': 'admin',
  '/api/notifications': 'admin',
  '/api/monitoring': 'admin',
  '/api/state-machines': 'admin',
};

/**
 * MODULES QU'UN ACCORD NE PEUT PAS OUVRIR.
 *
 * 1. « Administration » commande les comptes utilisateurs (donc la création d'un
 *    ADMIN), la base de données (sauvegarde, restauration), la configuration et
 *    le registre RGPD — et la matrice elle-même. L'accorder par une case à
 *    cocher ne donnerait pas « un module de plus » : ça fabriquerait un
 *    administrateur, en silence, depuis un écran qui annonce gérer des modules.
 *
 * 2. « RH et Insertion » et « Tests PCM » sont écartés pour une raison
 *    DIFFÉRENTE, et il faut la dire précisément parce qu'elle est temporaire.
 *
 *    Ces surfaces portent des données de l'article 9 (santé) et de l'article 10
 *    (judiciaire), plus les salaires, la RQTH et les titres de séjour. Elles
 *    sont protégées — mais par des gardes écrites en 2.52.0 sur le modèle
 *    « masquer POUR le rôle MANAGER », et non « masquer SAUF pour ADMIN/RH » :
 *    21 branches du type `if (baseRole !== 'MANAGER') return row;` dans
 *    `routes/employees.js` et `routes/insertion/`. Leur défaut est donc de TOUT
 *    MONTRER, et elles ne retenaient rien parce qu'aucun rôle ne pouvait plus
 *    atteindre ces routes — `authorize('ADMIN','RH')` fermait la porte en amont.
 *
 *    L'accord de module (2.56.0) rouvre précisément cette porte. Un rôle
 *    personnalisé à qui l'on accorderait « RH et Insertion » franchirait
 *    `authorize`, puis recevrait le dossier ENTIER : frein judiciaire, détails
 *    de santé, statuts sociaux, RQTH. Pas par un défaut de l'accord — par le
 *    sens de ces gardes, que l'accord rend soudain atteignables.
 *
 *    On ne corrige pas 21 branches dans le même geste que l'ouverture qui les
 *    expose : on ferme d'abord. Rendre ces deux modules accordables suppose de
 *    les inverser en « masquer SAUF ADMIN/RH » (fail-safe), et de le prouver
 *    surface par surface. Tant que ce n'est pas fait, le profil ADMIN ou RH
 *    reste la seule voie vers ces écrans.
 *
 * Le REFUS de ces modules, lui, continue de fonctionner dans les trois cas : la
 * matrice n'a jamais perdu sa capacité à retirer.
 */
const MODULES_NON_ACCORDABLES = new Set(['admin', 'rh', 'pcm']);

/** Normalise une entrée de la carte en tableau (ou null si hors matrice). */
function normaliser(valeur) {
  if (valeur === null || valeur === undefined) return null;
  return Array.isArray(valeur) ? valeur : [valeur];
}

/**
 * Modules dont relève un chemin d'API.
 *
 * Résolution par préfixe le PLUS LONG : '/api/badgeuse/device/...' doit tomber
 * sur l'entrée « device » (hors matrice) et non sur '/api/badgeuse'. Trier par
 * longueur décroissante est ce qui rend ce cas correct sans le traiter à part.
 *
 * @param {string} chemin chemin complet de la requête (req.originalUrl ou req.path)
 * @returns {string[]|null} clés de module, ou null si la route est hors matrice
 *                          ou inconnue (aucun accord ne peut alors s'appliquer)
 */
function resoudreModules(chemin) {
  if (!chemin) return null;
  // La chaîne de requête ne fait pas partie du chemin ('/api/cav?x=1').
  const propre = String(chemin).split('?')[0];
  let meilleur = null;
  for (const prefixe of Object.keys(MODULE_PAR_ROUTEUR)) {
    if (propre === prefixe || propre.startsWith(prefixe + '/')) {
      if (!meilleur || prefixe.length > meilleur.length) meilleur = prefixe;
    }
  }
  if (meilleur === null) return null;
  return normaliser(MODULE_PAR_ROUTEUR[meilleur]);
}

/**
 * Modules qu'un accord peut réellement ouvrir pour un chemin donné.
 * Filtre les modules d'administration (cf. MODULES_NON_ACCORDABLES).
 * @returns {string[]} liste éventuellement vide — jamais null, pour que
 *                     l'appelant n'ait pas à distinguer « aucun » de « hors carte »
 */
function modulesAccordables(chemin) {
  const mods = resoudreModules(chemin);
  if (!mods) return [];
  return mods.filter((m) => !MODULES_NON_ACCORDABLES.has(m));
}

module.exports = {
  MODULE_PAR_ROUTEUR,
  MODULES_NON_ACCORDABLES,
  resoudreModules,
  modulesAccordables,
};
