import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import SolidataBot from './SolidataBot';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import {
  LayoutDashboard, Newspaper, UserPlus, Brain, Users, Clock, Star, Heart,
  ClipboardList, IdCard, Truck, Sparkles, Map, BarChart3, MapPin, Factory, Route,
  ArrowUpDown, Package, Tag, CircleDollarSign, PieChart, BarChart2,
  RefreshCw, Lock, Settings, Car,
  Handshake, Warehouse, Scale, Activity, Radio,
  ShoppingBag, Target, Upload, Calendar, Briefcase, Wrench, ShieldCheck,
  Database, Building2, ListChecks, FileText, Beaker, ScanLine, Download,
  TrendingUp, AlertTriangle, Leaf, Zap, Gauge, MessageSquare, ShoppingCart,
  GraduationCap, Shirt, Fingerprint,
} from 'lucide-react';
import api from '../services/api';

// ══════════════════════════════════════════
// MENU CONFIG — Arbre récursif 4 niveaux
// Chaque nœud : { label, icon?, roles?, children? } ou { label, icon?, roles?, path }
// ══════════════════════════════════════════

const NAV_TREE = [
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
          { label: 'Tableau de bord', path: '/dashboard-collecte', icon: LayoutDashboard, roles: ['ADMIN', 'MANAGER'] },
          {
            label: 'Programmation',
            icon: Calendar,
            children: [
              { label: 'Planning Tournée', path: '/planning-tournees', icon: Calendar, roles: ['ADMIN', 'MANAGER'] },
              { label: 'Proposition IA', path: '/collection-proposals', icon: Sparkles, roles: ['ADMIN', 'MANAGER'] },
              { label: 'Modèles de tournées', path: '/route-templates', icon: Route, roles: ['ADMIN', 'MANAGER'] },
            ],
          },
          { label: 'Collecte en direct', path: '/collections-live', icon: MapPin, roles: ['ADMIN', 'MANAGER'] },
          { label: 'Incidents', path: '/incidents', icon: AlertTriangle, roles: ['ADMIN', 'MANAGER', 'QHSE'] },
          { label: 'Carte des CAV', path: '/fill-rate', icon: Map, roles: ['ADMIN', 'MANAGER'] },
          {
            label: 'Réglages',
            icon: Settings,
            children: [
              { label: 'Associations', path: '/admin-associations', icon: Handshake, roles: ['ADMIN', 'MANAGER'] },
            ],
          },
          { label: 'Historique des tournées', path: '/tours', icon: ClipboardList, roles: ['ADMIN', 'MANAGER'] },
        ],
      },
      {
        label: 'Logistique',
        icon: Warehouse,
        children: [
          { label: 'Calendrier', path: '/exutoires-calendrier', icon: Calendar, roles: ['ADMIN', 'MANAGER'] },
          {
            label: 'Gestion Commandes',
            icon: ClipboardList,
            children: [
              { label: 'Commandes', path: '/exutoires-commandes', icon: ClipboardList, roles: ['ADMIN', 'MANAGER'] },
              { label: 'Préparation', path: '/exutoires-preparation', icon: Truck, roles: ['ADMIN', 'MANAGER'] },
              { label: 'Occupation zone de chargement', path: '/exutoires-gantt', icon: BarChart3, roles: ['ADMIN', 'MANAGER'] },
            ],
          },
          {
            label: 'Commercial',
            icon: Briefcase,
            children: [
              { label: 'Clients', path: '/exutoires-clients', icon: Users, roles: ['ADMIN', 'MANAGER'] },
              { label: 'Grille tarifaire', path: '/exutoires-tarifs', icon: CircleDollarSign, roles: ['ADMIN', 'MANAGER'] },
              { label: 'Contrôle facturation', path: '/exutoires-controle-facturation', icon: FileText, roles: ['ADMIN', 'MANAGER'] },
            ],
          },
          {
            label: 'Inventaire',
            icon: Package,
            children: [
              { label: 'Inventaire Original', path: '/inventaire-original', icon: Warehouse, roles: ['ADMIN', 'MANAGER'] },
              { label: 'Stock MP', path: '/stock', icon: Package, roles: ['ADMIN', 'MANAGER'] },
              { label: 'Produits Finis', path: '/produits-finis', icon: Tag, roles: ['ADMIN', 'MANAGER'] },
              { label: 'Sortie cartons', path: '/inventaire/sortie-cartons', icon: ScanLine, roles: ['ADMIN', 'MANAGER', 'COLLABORATEUR'] },
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
      { label: 'Feuille de production', path: '/production', icon: Factory, roles: ['ADMIN', 'MANAGER'] },
      { label: 'Chaîne de tri', path: '/chaine-tri', icon: ArrowUpDown, roles: ['ADMIN', 'MANAGER'] },
      { label: 'Saisie exécution', path: '/tri/execution', icon: ScanLine, roles: ['ADMIN', 'MANAGER'] },
      { label: 'Étiquettes', path: '/tri/etiquettes', icon: Tag, roles: ['ADMIN', 'MANAGER', 'COLLABORATEUR'] },
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
          { label: 'Gestion candidatures', path: '/candidates', icon: UserPlus, roles: ['ADMIN', 'RH', 'MANAGER'] },
          { label: 'Analyse personnalités', path: '/pcm', icon: Brain, roles: ['ADMIN', 'RH'] },
        ],
      },
      {
        label: 'Gestion du personnel',
        icon: Users,
        children: [
          { label: 'Collaborateurs', path: '/employees', icon: Users, roles: ['ADMIN', 'RH', 'MANAGER'] },
          { label: 'Espace CIP (insertion)', path: '/insertion', icon: Heart, roles: ['ADMIN', 'RH', 'MANAGER'] },
          { label: 'Actions CIP', path: '/insertion/actions', icon: ListChecks, roles: ['ADMIN', 'RH', 'MANAGER'] },
          { label: 'Pilotage & indicateurs', path: '/insertion/audit', icon: ClipboardList, roles: ['ADMIN', 'RH', 'MANAGER'] },
          { label: 'Effectifs ETP', path: '/rh/effectifs', icon: Gauge, roles: ['ADMIN', 'RH', 'MANAGER'] },
          { label: 'Compétences', path: '/skills', icon: Star, roles: ['ADMIN', 'RH'] },
          { label: 'Plan de formation', path: '/rh/formation', icon: GraduationCap, roles: ['ADMIN', 'RH', 'MANAGER'] },
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
          { label: 'Planning hebdo', path: '/planning-hebdo', icon: ClipboardList, roles: ['ADMIN', 'MANAGER'] },
          { label: 'Pointage', path: '/pointage', icon: IdCard, roles: ['ADMIN', 'RH', 'MANAGER'] },
          { label: 'Heures de travail', path: '/work-hours', icon: Clock, roles: ['ADMIN', 'RH'] },
        ],
      },
    ],
  },
  {
    id: 'qhse',
    label: 'QHSE',
    icon: ShieldCheck,
    children: [
      { label: "Accidents & presqu'accidents", path: '/qhse/accidents', icon: AlertTriangle, roles: ['ADMIN', 'MANAGER', 'QHSE'] },
      { label: 'Habilitations', path: '/qhse/habilitations', icon: IdCard, roles: ['ADMIN', 'MANAGER', 'QHSE'] },
      { label: 'Dotation EPI', path: '/qhse/epi', icon: ShieldCheck, roles: ['ADMIN', 'MANAGER', 'QHSE'] },
    ],
  },
  {
    // Module « Pilotage RSE » (RSEI-10 — 28e module). Démarche de labellisation
    // RSEi : agrégats non nominatifs uniquement. Le rôle personnalisé REF_RSE
    // (base MANAGER) le voit ; la visibilité fine se règle dans /admin/permissions
    // (module 'rse'). base_role : un rôle custom suit son rôle de base.
    id: 'rse',
    label: 'Pilotage RSE',
    icon: Leaf,
    children: [
      { label: 'Tableau de bord RSE', path: '/rse', icon: Leaf, roles: ['ADMIN', 'MANAGER', 'RH'] },
    ],
  },
  {
    // Module « Énergie & GES » (RSEI-11 — 29e module). Comble le critère RSEi 4.2
    // (Énergies et GES) et alimente l'export VSME (B3/B6). Lecture ADMIN/MANAGER/
    // RH/QHSE ; la visibilité fine se règle dans /admin/permissions (module 'energie').
    id: 'energie',
    label: 'Énergie & GES',
    icon: Zap,
    children: [
      { label: 'Énergie & GES', path: '/energie', icon: Gauge, roles: ['ADMIN', 'MANAGER', 'RH', 'QHSE'] },
    ],
  },
  {
    // Module « Enquêtes » (RSEI-13 — 30e module). Questionnaires anonymes (QVCT,
    // satisfaction, intégration…) diffusés par lien ; restitution agrégée avec
    // seuil d'anonymat n ≥ 5. Lecture/écriture ADMIN/MANAGER/RH/QHSE ; la
    // visibilité fine se règle dans /admin/permissions (module 'enquetes').
    id: 'enquetes',
    label: 'Enquêtes',
    icon: MessageSquare,
    children: [
      { label: 'Enquêtes internes', path: '/enquetes', icon: MessageSquare, roles: ['ADMIN', 'MANAGER', 'RH', 'QHSE'] },
    ],
  },
  {
    // Module « Achats responsables » (RSEI-17 — 31e module). Outille le critère
    // RSEi 1.7 : référentiel fournisseurs + statut responsable, critères d'achat,
    // registre des FDS, part d'achats responsables. Lecture ADMIN/MANAGER/RH/QHSE ;
    // la visibilité fine se règle dans /admin/permissions (module 'achats').
    id: 'achats',
    label: 'Achats responsables',
    icon: ShoppingCart,
    children: [
      { label: 'Achats responsables', path: '/achats', icon: ShoppingCart, roles: ['ADMIN', 'MANAGER', 'RH', 'QHSE'] },
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
      { label: 'Carte des CAV', path: '/fill-rate', icon: Map, roles: ['AUTORITE'] },
      { label: 'Refashion (DPAV)', path: '/refashion', icon: RefreshCw, roles: ['AUTORITE'] },
      { label: "Exports d'audit DPAV", path: '/admin/refashion-exports', icon: Download, roles: ['AUTORITE'] },
    ],
  },
  {
    id: 'analyse',
    label: 'Analyse',
    icon: BarChart3,
    children: [
      { label: 'Dashboard exécutif', path: '/dashboard-executif', icon: LayoutDashboard, roles: ['ADMIN', 'MANAGER'] },
      { label: 'Performance', path: '/performance', icon: Activity, roles: ['ADMIN', 'MANAGER'] },
      { label: 'Collecte', path: '/reporting-collecte', icon: BarChart3, roles: ['ADMIN', 'MANAGER'] },
      { label: 'RH', path: '/reporting-rh', icon: BarChart2, roles: ['ADMIN', 'RH'] },
      {
        label: 'Reporting',
        icon: PieChart,
        children: [
          { label: 'Refashion', path: '/refashion', icon: RefreshCw, roles: ['ADMIN', 'MANAGER'] },
          { label: 'Métropole Rouen', path: '/reporting-metropole', icon: Building2, roles: ['ADMIN', 'MANAGER'] },
          { label: 'Production', path: '/reporting-production', icon: Factory, roles: ['ADMIN', 'MANAGER'] },
        ],
      },
      {
        label: 'Contrôle de gestion',
        icon: ListChecks,
        children: [
          { label: 'Opérations', path: '/finance/operations', icon: Factory, roles: ['ADMIN', 'MANAGER', 'FINANCE'] },
          { label: 'Rentabilité', path: '/finance/rentabilite', icon: PieChart, roles: ['ADMIN', 'MANAGER', 'FINANCE'] },
        ],
      },
      {
        label: 'Finances',
        icon: CircleDollarSign,
        children: [
          { label: 'Synthèse', path: '/finance', icon: LayoutDashboard, roles: ['ADMIN', 'MANAGER', 'FINANCE'] },
          { label: 'Trésorerie', path: '/finance/tresorerie', icon: CircleDollarSign, roles: ['ADMIN', 'MANAGER', 'FINANCE'] },
          { label: 'P&L Centre', path: '/finance/pl', icon: PieChart, roles: ['ADMIN', 'MANAGER', 'FINANCE'] },
          { label: 'Bilan CR', path: '/finance/bilan', icon: BarChart3, roles: ['ADMIN', 'MANAGER', 'FINANCE'] },
          {
            label: 'Réglages',
            icon: Settings,
            children: [
              { label: 'Contrôles', path: '/finance/controles', icon: Star, roles: ['ADMIN', 'MANAGER', 'FINANCE'] },
              { label: 'Pennylane', path: '/pennylane', icon: CircleDollarSign, roles: ['ADMIN', 'MANAGER', 'FINANCE'] },
              { label: 'Import', path: '/finance/import', icon: Upload, roles: ['ADMIN', 'MANAGER'] },
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
      {
        label: 'Collecte',
        icon: Truck,
        children: [
          { label: 'Véhicules', path: '/vehicles', icon: Car, roles: ['ADMIN', 'MANAGER', 'QHSE'] },
          { label: 'Maintenance', path: '/vehicle-maintenance', icon: Wrench, roles: ['ADMIN', 'MANAGER', 'QHSE'] },
          { label: 'Moteur prédictif', path: '/admin-predictive', icon: Brain, roles: ['ADMIN'] },
          { label: 'Gestion des CAV', path: '/admin-cav', icon: Map, roles: ['ADMIN', 'MANAGER'] },
          { label: 'Capteurs CAV', path: '/admin-sensors', icon: Radio, roles: ['ADMIN', 'MANAGER'] },
          { label: 'Communes (INSEE)', path: '/admin/communes', icon: Map, roles: ['ADMIN', 'MANAGER'] },
        ],
      },
      {
        label: 'Reporting',
        icon: PieChart,
        children: [
          { label: 'Stock Original', path: '/admin-stock-original', icon: Scale, roles: ['ADMIN'] },
        ],
      },
      { label: 'Configuration', path: '/settings', icon: Settings, roles: ['ADMIN'] },
      { label: "Seuils d'alerte", path: '/admin-alert-thresholds', icon: Target, roles: ['ADMIN', 'MANAGER'] },
      { label: 'Catalogue & référentiels', path: '/admin/catalogue', icon: Tag, roles: ['ADMIN', 'MANAGER'] },
      { label: 'Configuration Refashion', path: '/admin/refashion-config', icon: ShieldCheck, roles: ['ADMIN', 'MANAGER'] },
      { label: 'Exports DPAV Refashion', path: '/admin/refashion-exports', icon: Download, roles: ['ADMIN', 'MANAGER', 'QHSE'] },
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
          { label: 'Tableau de bord', path: '/boutiques', icon: LayoutDashboard, roles: ['ADMIN', 'MANAGER', 'RESP_BTQ'] },
          { label: 'Ventes', path: '/boutiques/ventes', icon: ShoppingBag, roles: ['ADMIN', 'MANAGER', 'RESP_BTQ'] },
          { label: 'Commandes', path: '/boutiques/commandes', icon: ClipboardList, roles: ['ADMIN', 'MANAGER', 'RESP_BTQ'] },
          { label: 'Planning', path: '/boutiques/planning', icon: Calendar, roles: ['ADMIN', 'MANAGER', 'RESP_BTQ'] },
          {
            label: 'Réglages',
            icon: Settings,
            children: [
              { label: 'Objectifs', path: '/boutiques/objectifs', icon: Target, roles: ['ADMIN', 'MANAGER'] },
              { label: 'Import CSV', path: '/boutiques/import', icon: Upload, roles: ['ADMIN', 'MANAGER'] },
            ],
          },
        ],
      },
      {
        id: 'vak',
        label: 'Vente au Kilo',
        icon: Scale,
        children: [
          { label: 'Performance VAK', path: '/vak', icon: BarChart3, roles: ['ADMIN', 'MANAGER'] },
          { label: 'Vue par jour', path: '/vak/jours', icon: Calendar, roles: ['ADMIN', 'MANAGER'] },
          { label: 'Performance annuelle', path: '/vak/annuel', icon: TrendingUp, roles: ['ADMIN', 'MANAGER'] },
          { label: 'Sessions & Import', path: '/vak/sessions', icon: Calendar, roles: ['ADMIN', 'MANAGER'] },
          { label: 'Écran Live', path: '/vak/live', icon: Activity, roles: ['ADMIN', 'MANAGER'] },
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
    id: 'badgeuse',
    label: 'Temps & Présence',
    icon: Fingerprint,
    children: [
      { label: 'Temps & Présence', path: '/badgeuse', icon: Fingerprint, roles: ['ADMIN', 'RH', 'MANAGER'] },
    ],
  },
];

// Filtre récursif par rôle ; un nœud "groupe" disparaît si tous ses enfants disparaissent.
function filterByRole(tree, role) {
  return tree
    .map((node) => {
      if (node.children) {
        const kids = filterByRole(node.children, role);
        if (kids.length === 0) return null;
        return { ...node, children: kids };
      }
      if (node.roles && !node.roles.includes(role)) return null;
      return node;
    })
    .filter(Boolean);
}

// Filtre récursif par habilitation module. Historiquement seules les sections de
// 1er niveau portaient un `id` (module_key de role_module_access). Depuis le
// regroupement « Frip » (Boutiques + Vente au Kilo), des sous-branches portent
// aussi leur `id` legacy ('boutiques'/'vak') pour rester restreignables
// individuellement — un nœud disparaît si SON id est refusé (le module 'frip'
// masque les deux d'un coup ; 'boutiques' ou 'vak' masque uniquement sa branche)
// ou si tous ses enfants disparaissent.
function filterByModuleAccess(tree, canAccessModule) {
  return tree
    .map((node) => {
      if (node.id && !canAccessModule(node.id)) return null;
      if (node.children) {
        const kids = filterByModuleAccess(node.children, canAccessModule);
        if (kids.length === 0) return null;
        return { ...node, children: kids };
      }
      return node;
    })
    .filter(Boolean);
}

// Persist sidebar collapse state across Layout re-mounts
const persistedState = {
  collapsed: (() => {
    try { return localStorage.getItem('solidata_sidebar_collapsed') === '1'; } catch { return false; }
  })(),
};

export default function Layout({ children }) {
  const { user, canAccessModule } = useAuth();

  const [collapsed, setCollapsed] = useState(persistedState.collapsed);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [alerts, setAlerts] = useState([]);
  const [counts, setCounts] = useState({});

  useEffect(() => {
    persistedState.collapsed = collapsed;
    try { localStorage.setItem('solidata_sidebar_collapsed', collapsed ? '1' : '0'); } catch { /* noop */ }
  }, [collapsed]);

  // Arbre filtré par rôle PUIS par habilitation module (un nœud — section de
  // 1er niveau ou sous-branche legacy comme 'boutiques'/'vak' sous 'frip' —
  // refusé au rôle est masqué ; l'ADMIN voit tout).
  // base_role : un rôle personnalisé hérite des accès de son rôle intégré.
  const filteredTree = useMemo(() => {
    const byRole = filterByRole(NAV_TREE, user?.base_role || user?.role);
    return filterByModuleAccess(byRole, canAccessModule);
  }, [user?.base_role, user?.role, canAccessModule]);

  // Charger alertes + compteurs sidebar (best-effort)
  useEffect(() => {
    api.get('/dashboard/kpis')
      .then((res) => {
        setAlerts(res.data?.alertes || []);
        const k = res.data?.kpis || res.data || {};
        setCounts({
          '/candidates': k.candidates_actifs ?? k.candidats ?? null,
          '/tours': k.tours_today ?? k.tournees_du_jour ?? null,
        });
      })
      .catch(() => { /* silencieux */ });
  }, []);

  const handleMobileNav = useCallback(() => {
    if (window.innerWidth < 1024) setMobileOpen(false);
  }, []);

  return (
    <div className="flex h-screen bg-[var(--color-bg)]">
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/30 z-40 lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      <div
        className={`${
          mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        } fixed lg:relative z-50 lg:z-auto h-full transition-transform duration-300`}
      >
        <Sidebar
          tree={filteredTree}
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed((c) => !c)}
          onNavigate={handleMobileNav}
          counts={counts}
        />
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        <TopBar
          alerts={alerts}
          onMobileMenu={() => setMobileOpen((o) => !o)}
        />

        <main className="flex-1 overflow-y-auto min-h-0">
          <div className="p-4 sm:p-6 lg:p-6 max-w-[1600px] mx-auto">
            {children}
          </div>
        </main>
      </div>

      <SolidataBot />
    </div>
  );
}
