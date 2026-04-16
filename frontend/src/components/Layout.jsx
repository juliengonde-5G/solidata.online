import { useState, useEffect, useCallback, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import SolidataBot from './SolidataBot';
import IconSidebar from './IconSidebar';
import ContentSidebar from './ContentSidebar';
import TopBar from './TopBar';
import {
  LayoutDashboard, Newspaper, UserPlus, Brain, Users, Clock, Star, Heart,
  ClipboardList, IdCard, Truck, Sparkles, Map, BarChart3, MapPin, Factory,
  ArrowUpDown, Package, Tag, Ship, CircleDollarSign, PieChart, BarChart2,
  RefreshCw, Lock, Settings, Car,
  Handshake, Warehouse, Scale, Activity,
} from 'lucide-react';
import api from '../services/api';

// ══════════════════════════════════════════
// MENU CONFIG
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
      { path: '/tours', label: 'Tournées', icon: Truck, roles: ['ADMIN', 'MANAGER'] },
      { path: '/collection-proposals', label: 'Propositions (IA)', icon: Sparkles, roles: ['ADMIN', 'MANAGER'] },
      { path: '/cav-map', label: 'Carte CAV', icon: Map, roles: ['ADMIN', 'MANAGER'] },
      { path: '/fill-rate', label: 'Remplissage CAV', icon: BarChart3, roles: ['ADMIN', 'MANAGER'] },
      { path: '/live-vehicles', label: 'Suivi GPS', icon: MapPin, roles: ['ADMIN', 'MANAGER'] },
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
      { path: '/admin-db', label: 'Base de données', icon: Settings, roles: ['ADMIN'] },
      { path: '/admin-stock-original', label: 'Stock Original', icon: Scale, roles: ['ADMIN'] },
      { path: '/activity-log', label: 'Journal d\'activité', icon: ClipboardList, roles: ['ADMIN'] },
    ],
  },
];

// ══════════════════════════════════════════
// Persist sidebar state across Layout re-mounts
// (Layout re-mounts on every page navigation because each page wraps in <Layout>)
// ══════════════════════════════════════════
const persistedState = { contentOpen: true, mobileOpen: false };

// Map hub paths to their section titles for proper active section detection
const HUB_PATH_MAP = {};
menuSections.forEach(s => {
  if (s.hubPath && s.hubPath !== '/') {
    HUB_PATH_MAP[s.hubPath] = s.title;
  }
  // Also map sub-paths that start with a known prefix (e.g. /finance/import → Finances)
  s.items.forEach(item => {
    HUB_PATH_MAP[item.path] = s.title;
  });
});

function findActiveSection(pathname, filteredSections) {
  // 1. Exact match on item path
  for (const section of filteredSections) {
    if (section.items.some(item => item.path === pathname)) {
      return section.title;
    }
  }
  // 2. Match on hub path
  for (const section of filteredSections) {
    if (section.hubPath && section.hubPath === pathname) {
      return section.title;
    }
  }
  // 3. Match on path prefix (e.g. /finance/import → Finances)
  for (const section of filteredSections) {
    if (section.hubPath && section.hubPath !== '/' && pathname.startsWith(section.hubPath)) {
      return section.title;
    }
    for (const item of section.items) {
      if (pathname.startsWith(item.path) && item.path !== '/') {
        return section.title;
      }
    }
  }
  return 'Accueil';
}

export default function Layout({ children }) {
  const { user } = useAuth();
  const location = useLocation();

  // Use persisted state so sidebar doesn't reset on re-mount
  const [contentSidebarOpen, setContentSidebarOpen] = useState(persistedState.contentOpen);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [alerts, setAlerts] = useState([]);

  // Sync persisted state
  useEffect(() => { persistedState.contentOpen = contentSidebarOpen; }, [contentSidebarOpen]);

  // Stabilize filteredSections with useMemo
  const filteredSections = useMemo(() =>
    menuSections.map(section => ({
      ...section,
      items: section.items.filter(item => !item.roles || item.roles.includes(user?.role)),
    })).filter(section => section.items.length > 0),
    [user?.role]
  );

  const visibleSectionTitles = useMemo(() => filteredSections.map(s => s.title), [filteredSections]);

  // Active section derived from URL (for icon highlight)
  const urlSection = useMemo(
    () => findActiveSection(location.pathname, filteredSections),
    [location.pathname, filteredSections]
  );

  // Selected section = user can click icons to switch, but follows URL on navigation
  const [selectedSection, setSelectedSection] = useState(urlSection);

  // When URL changes, sync selected section to match
  useEffect(() => {
    setSelectedSection(urlSection);
  }, [urlSection]);

  // Load alerts for notification bell (only once)
  useEffect(() => {
    api.get('/dashboard/kpis')
      .then(res => setAlerts(res.data?.alertes || []))
      .catch(() => {});
  }, []);

  const activeSectionData = filteredSections.find(s => s.title === selectedSection);

  // Click icon: if same section and content open → close; otherwise switch and open
  const handleSelectSection = useCallback((sectionTitle) => {
    if (sectionTitle === selectedSection && contentSidebarOpen) {
      setContentSidebarOpen(false);
    } else {
      setSelectedSection(sectionTitle);
      setContentSidebarOpen(true);
    }
  }, [selectedSection, contentSidebarOpen]);

  const handleMobileNav = useCallback(() => {
    if (window.innerWidth < 1024) setMobileMenuOpen(false);
  }, []);

  return (
    <div className="flex h-screen bg-[var(--color-bg)]">
      {/* Mobile overlay */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/20 z-40 lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* === SIDEBARS (desktop: always visible / mobile: overlay) === */}
      <div className={`
        ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        fixed lg:relative z-50 lg:z-auto flex h-full flex-shrink-0 transition-transform duration-300
      `}>
        {/* Icon sidebar — always visible on desktop */}
        <IconSidebar
          activeSection={selectedSection}
          visibleSections={visibleSectionTitles}
          onSelectSection={handleSelectSection}
        />

        {/* Content sidebar — collapsible */}
        {contentSidebarOpen && activeSectionData && (
          <ContentSidebar
            section={activeSectionData}
            onClose={() => setContentSidebarOpen(false)}
            onNavigate={handleMobileNav}
          />
        )}
      </div>

      {/* === MAIN AREA (top bar + content) === */}
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar
          menuSections={filteredSections}
          alerts={alerts}
          sidebarOpen={contentSidebarOpen}
          onToggleSidebar={() => setContentSidebarOpen(prev => !prev)}
          onMobileMenu={() => setMobileMenuOpen(prev => !prev)}
        />

        <main className="flex-1 overflow-y-auto min-h-0">
          <div className="p-4 sm:p-6 lg:p-6 max-w-[1600px] mx-auto">
            {children}
          </div>
        </main>
      </div>

      {/* SolidataBot — Agent IA conversationnel */}
      <SolidataBot />
    </div>
  );
}
