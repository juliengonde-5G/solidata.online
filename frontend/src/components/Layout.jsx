import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import SolidataBot from './SolidataBot';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import {
  LayoutDashboard, Newspaper, UserPlus, Brain, Users, Clock, Star, Heart,
  ClipboardList, IdCard, Truck, Sparkles, Map, BarChart3, MapPin, Factory,
  ArrowUpDown, Package, Tag, CircleDollarSign, PieChart, BarChart2,
  RefreshCw, Lock, Settings, Car,
  Handshake, Warehouse, Scale, Activity, Radio,
  ShoppingBag, Target, Upload, Calendar, Briefcase, Wrench, ShieldCheck,
  Database, Building2, ListChecks, FileText, Beaker, ScanLine, Download,
  TrendingUp,
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
            ],
          },
          { label: 'Collecte en direct', path: '/collections-live', icon: MapPin, roles: ['ADMIN', 'MANAGER'] },
          {
            label: 'Réglages',
            icon: Settings,
            children: [
              { label: 'Carte des CAV', path: '/fill-rate', icon: Map, roles: ['ADMIN', 'MANAGER'] },
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
      { label: 'Étiquettes', path: '/tri/etiquettes', icon: Tag, roles: ['ADMIN', 'MANAGER', 'COLLABORATEUR'] },
    ],
  },
  {
    id: 'boutiques',
    label: 'Boutiques',
    icon: ShoppingBag,
    children: [
      { label: 'Tableau de bord', path: '/boutiques', icon: LayoutDashboard, roles: ['ADMIN', 'MANAGER', 'RESP_BTQ'] },
      { label: 'Ventes', path: '/boutiques/ventes', icon: ShoppingBag, roles: ['ADMIN', 'MANAGER', 'RESP_BTQ'] },
      { label: 'Commandes', path: '/boutiques/commandes', icon: ClipboardList, roles: ['ADMIN', 'MANAGER', 'RESP_BTQ'] },
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
          { label: "Parcours d'insertion", path: '/insertion', icon: Heart, roles: ['ADMIN', 'RH', 'MANAGER'] },
          { label: 'Compétences', path: '/skills', icon: Star, roles: ['ADMIN', 'RH'] },
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
    id: 'analyse',
    label: 'Analyse',
    icon: BarChart3,
    children: [
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
          { label: 'Opérations', path: '/finance/operations', icon: Factory, roles: ['ADMIN', 'MANAGER'] },
          { label: 'Rentabilité', path: '/finance/rentabilite', icon: PieChart, roles: ['ADMIN', 'MANAGER'] },
        ],
      },
      {
        label: 'Finances',
        icon: CircleDollarSign,
        children: [
          { label: 'Synthèse', path: '/finance', icon: LayoutDashboard, roles: ['ADMIN', 'MANAGER'] },
          { label: 'Trésorerie', path: '/finance/tresorerie', icon: CircleDollarSign, roles: ['ADMIN', 'MANAGER'] },
          { label: 'P&L Centre', path: '/finance/pl', icon: PieChart, roles: ['ADMIN', 'MANAGER'] },
          { label: 'Bilan CR', path: '/finance/bilan', icon: BarChart3, roles: ['ADMIN', 'MANAGER'] },
          {
            label: 'Réglages',
            icon: Settings,
            children: [
              { label: 'Contrôles', path: '/finance/controles', icon: Star, roles: ['ADMIN', 'MANAGER'] },
              { label: 'Pennylane', path: '/pennylane', icon: CircleDollarSign, roles: ['ADMIN', 'MANAGER'] },
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
          { label: 'Véhicules', path: '/vehicles', icon: Car, roles: ['ADMIN'] },
          { label: 'Maintenance', path: '/vehicle-maintenance', icon: Wrench, roles: ['ADMIN'] },
          { label: 'Moteur prédictif', path: '/admin-predictive', icon: Brain, roles: ['ADMIN'] },
          { label: 'Gestion des CAV', path: '/admin-cav', icon: Map, roles: ['ADMIN'] },
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
      { label: 'Catalogue & référentiels', path: '/admin/catalogue', icon: Tag, roles: ['ADMIN', 'MANAGER'] },
      { label: 'Configuration Refashion', path: '/admin/refashion-config', icon: ShieldCheck, roles: ['ADMIN', 'MANAGER'] },
      { label: 'Exports DPAV Refashion', path: '/admin/refashion-exports', icon: Download, roles: ['ADMIN', 'MANAGER'] },
      {
        label: 'Utilisateurs & RGPD',
        icon: Users,
        children: [
          { label: 'Utilisateurs', path: '/users', icon: Users, roles: ['ADMIN'] },
          { label: 'Registre RGPD', path: '/rgpd', icon: Lock, roles: ['ADMIN'] },
        ],
      },
      {
        label: 'Utilitaires',
        icon: Wrench,
        children: [
          { label: 'Importer collaborateurs', path: '/admin-collaborators-import', icon: UserPlus, roles: ['ADMIN'] },
          { label: "Journal d'activité", path: '/activity-log', icon: FileText, roles: ['ADMIN'] },
          { label: 'Base de données', path: '/admin-db', icon: Database, roles: ['ADMIN'] },
        ],
      },
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

// Persist sidebar collapse state across Layout re-mounts
const persistedState = {
  collapsed: (() => {
    try { return localStorage.getItem('solidata_sidebar_collapsed') === '1'; } catch { return false; }
  })(),
};

export default function Layout({ children }) {
  const { user } = useAuth();

  const [collapsed, setCollapsed] = useState(persistedState.collapsed);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [alerts, setAlerts] = useState([]);
  const [counts, setCounts] = useState({});

  useEffect(() => {
    persistedState.collapsed = collapsed;
    try { localStorage.setItem('solidata_sidebar_collapsed', collapsed ? '1' : '0'); } catch { /* noop */ }
  }, [collapsed]);

  // Arbre filtré par rôle
  const filteredTree = useMemo(() => filterByRole(NAV_TREE, user?.role), [user?.role]);

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
