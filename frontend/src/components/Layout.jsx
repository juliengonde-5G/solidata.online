import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import SolidataBot from './SolidataBot';
import Sidebar from './Sidebar';
import TopBar from './TopBar';
import {
  LayoutDashboard, Newspaper, UserPlus, Brain, Users, Clock, Star, Heart,
  ClipboardList, IdCard, Truck, Sparkles, Map, BarChart3, MapPin, Factory,
  ArrowUpDown, Package, Tag, Ship, CircleDollarSign, PieChart, BarChart2,
  RefreshCw, Lock, Settings, Car,
  Handshake, Warehouse, Scale, Activity,
  ShoppingBag, Target, Upload, Calendar,
} from 'lucide-react';
import api from '../services/api';

// ══════════════════════════════════════════
// MENU CONFIG (10 sections — regroupées par 4 parents dans Sidebar.jsx)
// ══════════════════════════════════════════

const menuSections = [
  {
    title: 'Accueil',
    hubPath: '/',
    items: [
      { path: '/', label: 'Tableau de bord', icon: LayoutDashboard, roles: null },
      { path: '/news', label: 'Fil d\'actualité', icon: Newspaper, roles: null },
    ],
  },
  {
    title: 'Recrutement',
    hubPath: '/hub-recrutement',
    items: [
      { path: '/candidates', label: 'Candidats', icon: UserPlus, roles: ['ADMIN', 'RH', 'MANAGER'] },
      { path: '/recruitment-plan', label: 'Plan de recrutement', icon: ClipboardList, roles: ['ADMIN', 'RH'] },
      { path: '/pcm', label: 'Matrice PCM', icon: Brain, roles: ['ADMIN', 'RH'] },
    ],
  },
  {
    title: 'Gestion Équipe',
    hubPath: '/hub-equipe',
    items: [
      { path: '/employees', label: 'Collaborateurs', icon: Users, roles: ['ADMIN', 'RH', 'MANAGER'] },
      { path: '/work-hours', label: 'Heures de travail', icon: Clock, roles: ['ADMIN', 'RH'] },
      { path: '/skills', label: 'Compétences', icon: Star, roles: ['ADMIN', 'RH'] },
      { path: '/insertion', label: 'Parcours insertion', icon: Heart, roles: ['ADMIN', 'RH', 'MANAGER'] },
      { path: '/planning-hebdo', label: 'Planning hebdo', icon: ClipboardList, roles: ['ADMIN', 'MANAGER'] },
      { path: '/pointage', label: 'Pointage', icon: IdCard, roles: ['ADMIN', 'RH', 'MANAGER'] },
    ],
  },
  {
    title: 'Collecte',
    hubPath: '/hub-collecte',
    items: [
      { path: '/dashboard-collecte', label: 'Tableau de bord', icon: LayoutDashboard, roles: ['ADMIN', 'MANAGER'] },
      { path: '/tours', label: 'Tournées', icon: Truck, roles: ['ADMIN', 'MANAGER'] },
      { path: '/planning-tournees', label: 'Planning tournées', icon: Calendar, roles: ['ADMIN', 'MANAGER'] },
      { path: '/collection-proposals', label: 'Propositions (IA)', icon: Sparkles, roles: ['ADMIN', 'MANAGER'] },
      { path: '/cav-map', label: 'Carte CAV', icon: Map, roles: ['ADMIN', 'MANAGER'] },
      { path: '/fill-rate', label: 'Remplissage CAV', icon: BarChart3, roles: ['ADMIN', 'MANAGER'] },
      { path: '/collections-live', label: 'Suivi des collectes en cours', icon: MapPin, roles: ['ADMIN', 'MANAGER'] },
      { path: '/admin-associations', label: 'Associations', icon: Handshake, roles: ['ADMIN', 'MANAGER'] },
    ],
  },
  {
    title: 'Tri & Production',
    hubPath: '/hub-tri-production',
    items: [
      { path: '/production', label: 'Production', icon: Factory, roles: ['ADMIN', 'MANAGER'] },
      { path: '/chaine-tri', label: 'Chaînes de tri', icon: ArrowUpDown, roles: ['ADMIN', 'MANAGER'] },
      { path: '/stock', label: 'Stock MP', icon: Package, roles: ['ADMIN', 'MANAGER'] },
      { path: '/produits-finis', label: 'Produits finis', icon: Tag, roles: ['ADMIN', 'MANAGER'] },
      { path: '/expeditions', label: 'Expéditions', icon: Ship, roles: ['ADMIN', 'MANAGER'] },
    ],
  },
  {
    title: 'Logistique',
    hubPath: '/hub-exutoires',
    items: [
      { path: '/exutoires-commandes', label: 'Commandes', icon: ClipboardList, roles: ['ADMIN', 'MANAGER'] },
      { path: '/exutoires-preparation', label: 'Préparation', icon: Truck, roles: ['ADMIN', 'MANAGER'] },
      { path: '/exutoires-gantt', label: 'Gantt Chargement', icon: BarChart3, roles: ['ADMIN', 'MANAGER'] },
      { path: '/exutoires-facturation', label: 'Facturation', icon: CircleDollarSign, roles: ['ADMIN', 'MANAGER'] },
      { path: '/exutoires-calendrier', label: 'Calendrier', icon: Clock, roles: ['ADMIN', 'MANAGER'] },
      { path: '/exutoires-clients', label: 'Clients', icon: Users, roles: ['ADMIN', 'MANAGER'] },
      { path: '/exutoires-tarifs', label: 'Grille Tarifaire', icon: CircleDollarSign, roles: ['ADMIN', 'MANAGER'] },
      { path: '/inventaire-original', label: 'Inventaire Original', icon: Warehouse, roles: ['ADMIN', 'MANAGER'] },
    ],
  },
  {
    title: 'Boutiques',
    hubPath: '/hub-boutiques',
    items: [
      { path: '/boutiques', label: 'Tableau de bord', icon: LayoutDashboard, roles: ['ADMIN', 'MANAGER', 'RESP_BTQ'] },
      { path: '/boutiques/ventes', label: 'Ventes', icon: ShoppingBag, roles: ['ADMIN', 'MANAGER', 'RESP_BTQ'] },
      { path: '/boutiques/commandes', label: 'Commandes', icon: ClipboardList, roles: ['ADMIN', 'MANAGER', 'RESP_BTQ'] },
      { path: '/boutiques/planning', label: 'Planning', icon: Calendar, roles: ['ADMIN', 'MANAGER', 'RESP_BTQ'] },
      { path: '/boutiques/objectifs', label: 'Objectifs', icon: Target, roles: ['ADMIN', 'MANAGER'] },
      { path: '/boutiques/import', label: 'Import CSV', icon: Upload, roles: ['ADMIN', 'MANAGER'] },
    ],
  },
  {
    title: 'Finances',
    hubPath: '/finance',
    items: [
      { path: '/finance', label: 'Synthèse', icon: LayoutDashboard, roles: ['ADMIN', 'MANAGER'] },
      { path: '/finance/operations', label: 'Opérations', icon: Factory, roles: ['ADMIN', 'MANAGER'] },
      { path: '/finance/rentabilite', label: 'Rentabilité', icon: PieChart, roles: ['ADMIN', 'MANAGER'] },
      { path: '/finance/tresorerie', label: 'Trésorerie', icon: CircleDollarSign, roles: ['ADMIN', 'MANAGER'] },
      { path: '/finance/pl', label: 'P&L Centre', icon: PieChart, roles: ['ADMIN', 'MANAGER'] },
      { path: '/finance/bilan', label: 'Bilan / CR', icon: BarChart3, roles: ['ADMIN', 'MANAGER'] },
      { path: '/finance/controles', label: 'Contrôles', icon: Star, roles: ['ADMIN', 'MANAGER'] },
      { path: '/pennylane', label: 'Pennylane', icon: CircleDollarSign, roles: ['ADMIN', 'MANAGER'] },
    ],
  },
  {
    title: 'Reporting',
    hubPath: '/hub-reporting',
    items: [
      { path: '/performance', label: 'Performance', icon: Activity, roles: ['ADMIN', 'MANAGER'] },
      { path: '/reporting-collecte', label: 'Collecte', icon: BarChart3, roles: ['ADMIN', 'MANAGER'] },
      { path: '/reporting-rh', label: 'RH', icon: BarChart2, roles: ['ADMIN', 'RH'] },
      { path: '/reporting-production', label: 'Production', icon: PieChart, roles: ['ADMIN', 'MANAGER'] },
      { path: '/refashion', label: 'Refashion', icon: RefreshCw, roles: ['ADMIN', 'MANAGER'] },
      { path: '/reporting-metropole', label: 'Métropole Rouen', icon: BarChart3, roles: ['ADMIN', 'MANAGER'] },
    ],
  },
  {
    title: 'Administration',
    hubPath: '/hub-admin',
    items: [
      { path: '/users', label: 'Utilisateurs', icon: Lock, roles: ['ADMIN'] },
      { path: '/vehicles', label: 'Véhicules', icon: Car, roles: ['ADMIN'] },
      { path: '/vehicle-maintenance', label: 'Maintenance', icon: Settings, roles: ['ADMIN'] },
      { path: '/settings', label: 'Configuration', icon: Settings, roles: ['ADMIN'] },
      { path: '/referentiels', label: 'Référentiels', icon: ClipboardList, roles: ['ADMIN'] },
      { path: '/admin-predictive', label: 'Moteur prédictif', icon: Brain, roles: ['ADMIN'] },
      { path: '/rgpd', label: 'RGPD', icon: Lock, roles: ['ADMIN'] },
      { path: '/admin-cav', label: 'Gestion CAV', icon: Map, roles: ['ADMIN'] },
      { path: '/admin-sensors', label: 'Capteurs CAV', icon: Map, roles: ['ADMIN', 'MANAGER'] },
      { path: '/admin-db', label: 'Base de données', icon: Settings, roles: ['ADMIN'] },
      { path: '/admin-stock-original', label: 'Stock Original', icon: Scale, roles: ['ADMIN'] },
      { path: '/activity-log', label: 'Journal d\'activité', icon: ClipboardList, roles: ['ADMIN'] },
    ],
  },
];

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

  // Sync persisted collapse state
  useEffect(() => {
    persistedState.collapsed = collapsed;
    try { localStorage.setItem('solidata_sidebar_collapsed', collapsed ? '1' : '0'); } catch { /* noop */ }
  }, [collapsed]);

  // Sections visibles par rôle
  const filteredSections = useMemo(
    () => menuSections
      .map((section) => ({
        ...section,
        items: section.items.filter((item) => !item.roles || item.roles.includes(user?.role)),
      }))
      .filter((section) => section.items.length > 0),
    [user?.role],
  );

  // Charger alertes + compteurs sidebar
  useEffect(() => {
    api.get('/dashboard/kpis')
      .then((res) => {
        setAlerts(res.data?.alertes || []);
        // Pills compteurs (best-effort, silencieux si non dispo)
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
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/30 z-40 lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar (desktop visible / mobile en overlay slide) */}
      <div
        className={`${
          mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        } fixed lg:relative z-50 lg:z-auto h-full transition-transform duration-300`}
      >
        <Sidebar
          filteredSections={filteredSections}
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed((c) => !c)}
          onNavigate={handleMobileNav}
          counts={counts}
        />
      </div>

      {/* Main area (topbar + content) */}
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar
          menuSections={filteredSections}
          alerts={alerts}
          onMobileMenu={() => setMobileOpen((o) => !o)}
        />

        <main className="flex-1 overflow-y-auto min-h-0">
          <div className="p-4 sm:p-6 lg:p-6 max-w-[1600px] mx-auto">
            {children}
          </div>
        </main>
      </div>

      {/* Assistant IA (panel slide droite) */}
      <SolidataBot />
    </div>
  );
}
