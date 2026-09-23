/**
 * ARBRE DE NAVIGATION — source unique de la barre latérale.
 *
 * Extrait de `components/Layout.jsx` en 2.56.0, et pas par goût du rangement :
 * `ProtectedRoute` (App.jsx) doit savoir de quelle SECTION relève l'écran
 * demandé, pour qu'un module accordé dans `/admin/permissions` ouvre la route
 * autant que le lien. Importer Layout depuis App.jsx le faisait, mais tirait
 * avec lui le dock de communication, ses hooks et leurs dépendances dans le
 * bundle d'ENTRÉE : mesuré, il passait de 15,6 à 34,3 ko gzip — payés par tout
 * le monde, page de connexion comprise. Séparer la DONNÉE (cet arbre) de la
 * PRÉSENTATION (Layout) rend la correspondance accessible aux deux sans ce prix.
 *
 * La règle qui compte : cet arbre reste la SEULE description de la navigation.
 * `modulesDuChemin` en est DÉRIVÉ, jamais recopié — une seconde liste tenue à la
 * main divergerait au premier écran déplacé, et l'accord porterait alors sur un
 * module différent de celui affiché dans le menu.
 */
// `Map as MapIcon` N'EST PAS UNE COQUETTERIE DE STYLE : lucide expose une icône
// nommée `Map`, qui MASQUE le `Map` du langage sur tout le module. Le `new Map()`
// de l'index plus bas construisait alors l'icône — un objet React, pas un
// constructeur —, l'entrée du bundle mourait à l'évaluation et TOUTES les pages,
// connexion comprise, restaient blanches (aucun rempart React ne peut rattraper
// cela : React n'a jamais démarré). Ne pas retirer l'alias.
import {
  LayoutDashboard, Newspaper, UserPlus, Brain, Users, Clock, Star, Heart,
  ClipboardList, IdCard, Truck, Sparkles, Map as MapIcon, BarChart3, MapPin, Factory, Route,
  ArrowUpDown, Package, Tag, CircleDollarSign, PieChart, BarChart2,
  RefreshCw, Lock, Settings, Car,
  Handshake, Warehouse, Scale, Activity, Radio,
  ShoppingBag, Target, Upload, Calendar, Briefcase, Wrench, ShieldCheck,
  Database, Building2, ListChecks, FileText, Beaker, ScanLine, Download,
  TrendingUp, AlertTriangle, Leaf, Zap, Gauge, MessageSquare, MessageCircle, ShoppingCart,
  GraduationCap, Shirt, Fingerprint, MapPinned, Workflow, FolderOpen,
} from 'lucide-react';

// ══════════════════════════════════════════
// MENU CONFIG — Arbre récursif 4 niveaux
// Chaque nœud : { label, icon?, roles?, children? } ou { label, icon?, roles?, path }
// ══════════════════════════════════════════

export const NAV_TREE = [
  {
    id: 'accueil',
    label: 'Accueil',
    icon: LayoutDashboard,
    children: [
      { label: 'Tableau de bord', path: '/', icon: LayoutDashboard, roles: null },
      { label: "Fil d'actualité", path: '/news', icon: Newspaper, roles: null },
    ],
  },
  {
    id: 'operations',
    label: 'Opérations',
    icon: Truck,
    children: [
      {
        label: 'Collecte',
        icon: Truck,
        children: [
          { label: 'Tableau de bord', path: '/dashboard-collecte', icon: LayoutDashboard, roles: ['ADMIN'] },
          {
            label: 'Programmation',
            icon: Calendar,
            children: [
              { label: 'Planning Tournée', path: '/planning-tournees', icon: Calendar, roles: ['ADMIN'] },
              { label: 'Proposition IA', path: '/collection-proposals', icon: Sparkles, roles: ['ADMIN'] },
              { label: 'Modèles de tournées', path: '/route-templates', icon: Route, roles: ['ADMIN'] },
            ],
          },
          { label: 'Collecte en direct', path: '/collections-live', icon: MapPin, roles: ['ADMIN'] },
          { label: 'Incidents', path: '/incidents', icon: AlertTriangle, roles: ['ADMIN'] },
          { label: 'Carte des CAV', path: '/fill-rate', icon: MapIcon, roles: ['ADMIN'] },
          {
            // Réglages de la collecte — remontés d'« Administration > Collecte »
            // (demande client 27/08/2026) : ces écrans servent au quotidien du
            // responsable de collecte, pas à l'administration du logiciel. Ils
            // sont ouverts au MANAGER, qui pilote la collecte.
            label: 'Réglages',
            icon: Settings,
            children: [
              { label: 'Gestion des CAV', path: '/admin-cav', icon: MapIcon, roles: ['ADMIN'] },
              { label: 'Capteurs CAV', path: '/admin-sensors', icon: Radio, roles: ['ADMIN'] },
              { label: 'Associations', path: '/admin-associations', icon: Handshake, roles: ['ADMIN'] },
              { label: "Lieux d'arrêt", path: '/admin-lieux-techniques', icon: MapPinned, roles: ['ADMIN'] },
              { label: 'Véhicules', path: '/vehicles', icon: Car, roles: ['ADMIN'] },
              { label: 'Maintenance', path: '/vehicle-maintenance', icon: Wrench, roles: ['ADMIN'] },
              { label: 'Moteur prédictif', path: '/admin-predictive', icon: Brain, roles: ['ADMIN'] },
              { label: 'Communes (INSEE)', path: '/admin/communes', icon: MapIcon, roles: ['ADMIN'] },
            ],
          },
          { label: 'Historique des tournées', path: '/tours', icon: ClipboardList, roles: ['ADMIN'] },
        ],
      },
      {
        label: 'Logistique',
        icon: Warehouse,
        children: [
          { label: 'Calendrier', path: '/exutoires-calendrier', icon: Calendar, roles: ['ADMIN'] },
          {
            label: 'Gestion Commandes',
            icon: ClipboardList,
            children: [
              { label: 'Commandes', path: '/exutoires-commandes', icon: ClipboardList, roles: ['ADMIN'] },
              { label: 'Préparation', path: '/exutoires-preparation', icon: Truck, roles: ['ADMIN'] },
              { label: 'Occupation zone de chargement', path: '/exutoires-gantt', icon: BarChart3, roles: ['ADMIN'] },
            ],
          },
          {
            label: 'Commercial',
            icon: Briefcase,
            children: [
              { label: 'Clients', path: '/exutoires-clients', icon: Users, roles: ['ADMIN'] },
              { label: 'Grille tarifaire', path: '/exutoires-tarifs', icon: CircleDollarSign, roles: ['ADMIN'] },
              { label: 'Contrôle facturation', path: '/exutoires-controle-facturation', icon: FileText, roles: ['ADMIN'] },
            ],
          },
          {
            label: 'Inventaire',
            icon: Package,
            children: [
              { label: 'Inventaire Original', path: '/inventaire-original', icon: Warehouse, roles: ['ADMIN'] },
              { label: 'Stock MP', path: '/stock', icon: Package, roles: ['ADMIN'] },
              { label: 'Produits Finis', path: '/produits-finis', icon: Tag, roles: ['ADMIN'] },
              // `id` porté par cette feuille (comme les Étiquettes juste en
              // dessous, Tri) : l'habilitation `sortie_cartons` lui est propre,
              // distincte de « Produits Finis » et du reste de l'Inventaire.
              { id: 'sortie_cartons', label: 'Sortie cartons', path: '/inventaire/sortie-cartons', icon: ScanLine, roles: ['ADMIN', 'COLLABORATEUR', 'OPERATEUR_STOCK'] },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'tri',
    label: 'Tri',
    icon: Factory,
    children: [
      { label: 'Feuille de production', path: '/production', icon: Factory, roles: ['ADMIN'] },
      { label: 'Chaîne de tri', path: '/chaine-tri', icon: ArrowUpDown, roles: ['ADMIN'] },
      { label: 'Configurateur de chaîne', path: '/tri/configurateur', icon: Workflow, roles: ['ADMIN'] },
      { label: 'Saisie exécution', path: '/tri/execution', icon: ScanLine, roles: ['ADMIN'] },
      // `id` porté par une FEUILLE (et non une section) : le filtre récursif
      // honore l'id de n'importe quel nœud, ce qui donne aux étiquettes leur
      // habilitation propre sans détacher l'entrée de la section Tri.
      { id: 'etiquettes', label: 'Étiquettes', path: '/tri/etiquettes', icon: Tag, roles: ['ADMIN', 'COLLABORATEUR', 'OPERATEUR_STOCK'] },
      { label: 'Référentiel tri', path: '/admin/tri', icon: ListChecks, roles: ['ADMIN'] },
    ],
  },
  {
    id: 'rh',
    label: 'RH et Insertion',
    icon: Users,
    children: [
      {
        label: 'Recrutement',
        icon: UserPlus,
        children: [
          { label: 'Besoin au recrutement', path: '/recruitment-plan', icon: ClipboardList, roles: ['ADMIN', 'RH'] },
          { label: 'Gestion candidatures', path: '/candidates', icon: UserPlus, roles: ['ADMIN', 'RH'] },
          { label: 'Analyse personnalités', path: '/pcm', icon: Brain, roles: ['ADMIN', 'RH', 'PCM'] },
        ],
      },
      {
        label: 'Gestion du personnel',
        icon: Users,
        children: [
          { label: 'Collaborateurs', path: '/employees', icon: Users, roles: ['ADMIN', 'RH'] },
          { label: 'Espace CIP (insertion)', path: '/insertion', icon: Heart, roles: ['ADMIN', 'RH'] },
          { label: 'Actions CIP', path: '/insertion/actions', icon: ListChecks, roles: ['ADMIN', 'RH'] },
          // Refonte CIP (PR #166) — dossiers de conformité FSE+. Réintroduit ici
          // lors de la réparation du 15/09 : la fusion de main dans la branche des
          // habilitations avait laissé DEUX arbres de navigation dans Layout.jsx
          // (build cassé), et cette entrée ne vivait que dans celui qui portait
          // encore les rôles MANAGER/QHSE retirés en 2.52.0.
          { label: 'Dossiers FSE+', path: '/insertion/conformite', icon: FolderOpen, roles: ['ADMIN', 'RH'] },
          { label: 'Pilotage & indicateurs', path: '/insertion/audit', icon: ClipboardList, roles: ['ADMIN', 'RH'] },
          { label: 'Effectifs ETP', path: '/rh/effectifs', icon: Gauge, roles: ['ADMIN', 'RH'] },
          { label: 'Compétences', path: '/skills', icon: Star, roles: ['ADMIN', 'RH'] },
          { label: 'Plan de formation', path: '/rh/formation', icon: GraduationCap, roles: ['ADMIN', 'RH'] },
          { label: 'Prescripteurs', path: '/prescripteurs', icon: Building2, roles: ['ADMIN', 'RH'] },
          {
            label: 'Réglages',
            icon: Settings,
            children: [
              { label: 'Réglages insertion', path: '/admin/insertion', icon: Settings, roles: ['ADMIN'] },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'equipe',
    label: "Gestion d'équipe",
    icon: Calendar,
    children: [
      {
        label: 'Affectations',
        icon: Calendar,
        children: [
          { label: 'Planning hebdo', path: '/planning-hebdo', icon: ClipboardList, roles: ['ADMIN', 'RH'] },
          { label: 'Heures de travail', path: '/work-hours', icon: Clock, roles: ['ADMIN', 'RH'] },
        ],
      },
    ],
  },
  {
    // QHSE regroupe la sécurité au travail ET les démarches RSE/environnement
    // (demande client du 21/08/2026) : Pilotage RSE, Énergie & GES, Enquêtes et
    // Achats responsables deviennent des SOUS-BRANCHES de cette section au lieu
    // de quatre entrées de premier niveau.
    //
    // Les identifiants d'habilitation des modules déplacés sont CONSERVÉS
    // ('rse', 'energie', 'enquetes', 'achats') : le filtrage des habilitations
    // (`filterByModuleAccess`) est récursif et honore l'id de n'importe quel
    // nœud — les réglages déjà posés dans /admin/permissions restent valables,
    // et masquer 'qhse' masque désormais l'ensemble de la branche.
    id: 'qhse',
    label: 'QHSE',
    icon: ShieldCheck,
    children: [
      { label: "Accidents & presqu'accidents", path: '/qhse/accidents', icon: AlertTriangle, roles: ['ADMIN'] },
      { label: 'Habilitations', path: '/qhse/habilitations', icon: IdCard, roles: ['ADMIN'] },
      { label: 'Dotation EPI', path: '/qhse/epi', icon: ShieldCheck, roles: ['ADMIN'] },
      {
        // Module « Pilotage RSE » (RSEI-10 — 28e module). Démarche de labellisation
        // RSEi : agrégats non nominatifs uniquement. Le rôle personnalisé REF_RSE
        // (base MANAGER) le voit ; la visibilité fine se règle dans /admin/permissions
        // (module 'rse'). base_role : un rôle custom suit son rôle de base.
        id: 'rse',
        label: 'Pilotage RSE',
        icon: Leaf,
        children: [
          { label: 'Tableau de bord RSE', path: '/rse', icon: Leaf, roles: ['ADMIN', 'RH'] },
        ],
      },
      {
        // Module « Énergie & GES » (RSEI-11 — 29e module). Comble le critère RSEi 4.2
        // (Énergies et GES) et alimente l'export VSME (B3/B6).
        id: 'energie',
        label: 'Énergie & GES',
        icon: Zap,
        children: [
          { label: 'Énergie & GES', path: '/energie', icon: Gauge, roles: ['ADMIN', 'RH'] },
        ],
      },
      {
        // Module « Enquêtes » (RSEI-13 — 30e module). Questionnaires anonymes (QVCT,
        // satisfaction, intégration…) ; restitution agrégée au seuil n ≥ 5.
        id: 'enquetes',
        label: 'Enquêtes',
        icon: MessageSquare,
        children: [
          { label: 'Enquêtes internes', path: '/enquetes', icon: MessageSquare, roles: ['ADMIN', 'RH'] },
        ],
      },
      {
        // Module « Achats responsables » (RSEI-17 — 31e module). Critère RSEi 1.7 :
        // fournisseurs responsables, critères d'achat, registre des FDS.
        id: 'achats',
        label: 'Achats responsables',
        icon: ShoppingCart,
        children: [
          { label: 'Achats responsables', path: '/achats', icon: ShoppingCart, roles: ['ADMIN', 'RH'] },
        ],
      },
    ],
  },
  {
    // Espace dédié à l'auditeur externe (AUTORITE) — vague 2, item 52/53.
    // Regroupe les pages de contrôle en lecture seule pour éviter que
    // l'auditeur n'atterrisse sur un dashboard opérationnel vide. Les leaves
    // sont AUTORITE-only : ADMIN/MANAGER retrouvent ces pages dans Analyse /
    // Administration (pas de doublon dans leur menu).
    id: 'audit',
    label: 'Audit & conformité',
    icon: ShieldCheck,
    children: [
      { label: 'Reporting Métropole', path: '/reporting-metropole', icon: Building2, roles: ['AUTORITE'] },
      { label: 'Reporting Collecte', path: '/reporting-collecte', icon: BarChart3, roles: ['AUTORITE'] },
      { label: 'Carte des CAV', path: '/fill-rate', icon: MapIcon, roles: ['AUTORITE'] },
      { label: 'Refashion (DPAV)', path: '/refashion', icon: RefreshCw, roles: ['AUTORITE'] },
      { label: "Exports d'audit DPAV", path: '/admin/refashion-exports', icon: Download, roles: ['AUTORITE'] },
    ],
  },
  {
    id: 'analyse',
    label: 'Analyse',
    icon: BarChart3,
    children: [
      { label: 'Dashboard exécutif', path: '/dashboard-executif', icon: LayoutDashboard, roles: ['ADMIN'] },
      { label: 'Performance', path: '/performance', icon: Activity, roles: ['ADMIN'] },
      { label: 'Collecte', path: '/reporting-collecte', icon: BarChart3, roles: ['ADMIN'] },
      { label: 'RH', path: '/reporting-rh', icon: BarChart2, roles: ['ADMIN', 'RH'] },
      {
        label: 'Reporting',
        icon: PieChart,
        children: [
          { label: 'Refashion', path: '/refashion', icon: RefreshCw, roles: ['ADMIN'] },
          { label: 'Métropole Rouen', path: '/reporting-metropole', icon: Building2, roles: ['ADMIN'] },
          { label: 'Production', path: '/reporting-production', icon: Factory, roles: ['ADMIN'] },
        ],
      },
      {
        label: 'Contrôle de gestion',
        icon: ListChecks,
        children: [
          { label: 'Opérations', path: '/finance/operations', icon: Factory, roles: ['ADMIN'] },
          { label: 'Rentabilité', path: '/finance/rentabilite', icon: PieChart, roles: ['ADMIN'] },
        ],
      },
      {
        label: 'Finances',
        icon: CircleDollarSign,
        children: [
          { label: 'Synthèse', path: '/finance', icon: LayoutDashboard, roles: ['ADMIN'] },
          { label: 'Trésorerie', path: '/finance/tresorerie', icon: CircleDollarSign, roles: ['ADMIN'] },
          { label: 'P&L Centre', path: '/finance/pl', icon: PieChart, roles: ['ADMIN'] },
          { label: 'Bilan CR', path: '/finance/bilan', icon: BarChart3, roles: ['ADMIN'] },
          {
            label: 'Réglages',
            icon: Settings,
            children: [
              { label: 'Contrôles', path: '/finance/controles', icon: Star, roles: ['ADMIN'] },
              { label: 'Pennylane', path: '/pennylane', icon: CircleDollarSign, roles: ['ADMIN'] },
              { label: 'Import', path: '/finance/import', icon: Upload, roles: ['ADMIN'] },
            ],
          },
        ],
      },
    ],
  },
  {
    id: 'admin',
    label: 'Administration',
    icon: ShieldCheck,
    children: [
      // La sous-section « Collecte » a été remontée dans Opérations > Collecte >
      // Réglages (demande client 27/08/2026) : ces écrans sont des outils de
      // conduite d'activité, leur place n'était pas dans l'administration du
      // logiciel. Aucune page n'a été retirée ni renommée.
      {
        label: 'Reporting',
        icon: PieChart,
        children: [
          { label: 'Stock Original', path: '/admin-stock-original', icon: Scale, roles: ['ADMIN'] },
        ],
      },
      { label: 'Configuration', path: '/settings', icon: Settings, roles: ['ADMIN'] },
      { label: "Seuils d'alerte", path: '/admin-alert-thresholds', icon: Target, roles: ['ADMIN'] },
      { label: 'Catalogue & référentiels', path: '/admin/catalogue', icon: Tag, roles: ['ADMIN'] },
      { label: 'Configuration Refashion', path: '/admin/refashion-config', icon: ShieldCheck, roles: ['ADMIN'] },
      { label: 'Exports DPAV Refashion', path: '/admin/refashion-exports', icon: Download, roles: ['ADMIN'] },
      {
        label: 'Utilisateurs & RGPD',
        icon: Users,
        children: [
          { label: 'Utilisateurs', path: '/users', icon: Users, roles: ['ADMIN'] },
          { label: 'Habilitations modules', path: '/admin/permissions', icon: ShieldCheck, roles: ['ADMIN'] },
          { label: 'Registre RGPD', path: '/rgpd', icon: Lock, roles: ['ADMIN', 'DPO'] },
        ],
      },
      {
        label: 'Utilitaires',
        icon: Wrench,
        children: [
          { label: 'Importer collaborateurs', path: '/admin-collaborators-import', icon: UserPlus, roles: ['ADMIN', 'RH'] },
          { label: "Journal d'activité", path: '/activity-log', icon: FileText, roles: ['ADMIN'] },
          { label: 'Base de données', path: '/admin-db', icon: Database, roles: ['ADMIN'] },
        ],
      },
    ],
  },
  {
    // Module « Frip » — regroupe Boutiques et Vente au Kilo (Lot 4, demande
    // client). Les deux anciennes sections de 1er niveau ('boutiques'/'vak')
    // deviennent des sous-branches ici, chacune conservant son id historique
    // pour la rétrocompatibilité des habilitations existantes
    // (backend/src/routes/permissions.js MODULE_CATALOG + role_module_access).
    id: 'frip',
    label: 'Frip',
    icon: Shirt,
    children: [
      {
        id: 'boutiques',
        label: 'Boutiques',
        icon: ShoppingBag,
        children: [
          { label: 'Tableau de bord', path: '/boutiques', icon: LayoutDashboard, roles: ['ADMIN', 'RESP_BTQ'] },
          { label: 'Ventes', path: '/boutiques/ventes', icon: ShoppingBag, roles: ['ADMIN', 'RESP_BTQ'] },
          { label: 'Commandes', path: '/boutiques/commandes', icon: ClipboardList, roles: ['ADMIN', 'RESP_BTQ'] },
          { label: 'Planning', path: '/boutiques/planning', icon: Calendar, roles: ['ADMIN', 'RESP_BTQ'] },
          {
            label: 'Réglages',
            icon: Settings,
            children: [
              { label: 'Objectifs', path: '/boutiques/objectifs', icon: Target, roles: ['ADMIN'] },
              { label: 'Import CSV', path: '/boutiques/import', icon: Upload, roles: ['ADMIN'] },
            ],
          },
        ],
      },
      {
        id: 'vak',
        label: 'Vente au Kilo',
        icon: Scale,
        children: [
          { label: 'Performance VAK', path: '/vak', icon: BarChart3, roles: ['ADMIN'] },
          { label: 'Vue par jour', path: '/vak/jours', icon: Calendar, roles: ['ADMIN'] },
          { label: 'Performance annuelle', path: '/vak/annuel', icon: TrendingUp, roles: ['ADMIN'] },
          { label: 'Sessions & Import', path: '/vak/sessions', icon: Calendar, roles: ['ADMIN'] },
          { label: 'Écran Live', path: '/vak/live', icon: Activity, roles: ['ADMIN'] },
          {
            label: 'Réglages',
            icon: Settings,
            children: [
              { label: 'Config SumUp', path: '/admin/vak/sumup-config', icon: Sparkles, roles: ['ADMIN'] },
            ],
          },
        ],
      },
    ],
  },
  {
    // Module « Temps & Présence » (badgeuse) — 33e module. Pointage par badge
    // RFID (poste Raspberry Pi au Houlme) : journal, feuilles de temps,
    // corrections, badges, affichage, supervision, paramètres. READ = ADMIN/
    // MANAGER (encadrant technique)/RH ; certaines écritures (validation RH,
    // exports, appairage des postes) sont resserrées côté page/API. L'id
    // 'badgeuse' est la clé d'habilitation (backend/src/routes/permissions.js
    // MODULE_CATALOG) ; la visibilité fine se règle dans /admin/permissions.
    // COMMUNICATION entre ici pour la SEULE diffusion de contenus : la page ne
    // lui montre que « Affichage » et « Écran en direct », et l'API lui ferme
    // le reste du module (routes/badgeuse.js, AFFICHAGE_READ/AFFICHAGE_WRITE).
    id: 'badgeuse',
    label: 'Temps & Présence',
    icon: Fingerprint,
    children: [
      { label: 'Temps & Présence', path: '/badgeuse', icon: Fingerprint, roles: ['ADMIN', 'RH', 'COMMUNICATION'] },
    ],
  },
  {
    // Messagerie interne (chantier 26/08) — lien direct de 1er niveau, visible
    // de TOUS les rôles connectés (roles: null, comme /news) : le périmètre de
    // participation est contrôlé côté serveur, pas par le menu.
    id: 'messagerie',
    label: 'Messagerie',
    path: '/messagerie',
    icon: MessageCircle,
    roles: null,
  },
];

// ── Chemin d'écran → module(s) dont il relève ──────────────────────────────
//
// DÉRIVÉ de NAV_TREE, jamais recopié : l'arbre est déjà l'autorité sur « quelle
// section porte quel écran ». Une seconde liste tenue à la main divergerait au
// premier écran déplacé, et l'accord porterait alors sur un module différent de
// celui affiché dans la barre latérale.
//
// Un chemin peut relever de PLUSIEURS modules — la barre latérale expose
// `/refashion` sous « Analyse » ET sous « Audit & conformité », `/fill-rate`
// sous « Opérations » ET « Audit ». On les collecte donc tous : l'écran s'ouvre
// si l'un OU l'autre est accordé, sinon l'accord dépendrait du chemin de menu
// emprunté plutôt que de ce que l'administrateur a coché.
const PATH_MODULES = (() => {
  const index = new Map();
  (function parcourir(nodes, ancetres) {
    for (const n of nodes) {
      const mods = n.id ? [...ancetres, n.id] : ancetres;
      if (n.children) parcourir(n.children, mods);
      else if (n.path) {
        if (!index.has(n.path)) index.set(n.path, new Set());
        for (const m of mods) index.get(n.path).add(m);
      }
    }
  })(NAV_TREE, []);
  return index;
})();

/**
 * Modules dont relève un chemin de page.
 *
 * Correspondance par préfixe le PLUS LONG : les routes réelles portent des
 * paramètres (`/tours/412`, `/insertion/renouvellement/:id`) que l'arbre de
 * navigation ne connaît pas. `/tours/412` relève donc du module de `/tours`.
 * Le préfixe le plus long l'emporte pour que `/insertion/actions` ne soit pas
 * capté par `/insertion` quand les deux existent.
 *
 * Exporté pour `ProtectedRoute` (App.jsx) : le menu et la route doivent lire la
 * MÊME correspondance, sinon un accord afficherait un lien que la route refuse.
 */
export function modulesDuChemin(pathname) {
  if (!pathname) return [];
  let meilleur = null;
  for (const chemin of PATH_MODULES.keys()) {
    if (pathname === chemin || pathname.startsWith(chemin + '/')) {
      if (!meilleur || chemin.length > meilleur.length) meilleur = chemin;
    }
  }
  return meilleur ? [...PATH_MODULES.get(meilleur)] : [];
}
