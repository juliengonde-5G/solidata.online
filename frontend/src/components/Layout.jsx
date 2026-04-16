import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import SolidataBot from './SolidataBot';
import IconSidebar from './IconSidebar';
import ContentSidebar from './ContentSidebar';
import TopBar from './TopBar';
import {
  LayoutDashboard, Newspaper, UserPlus, Brain, Users, Clock, Star, Heart,
  ClipboardList, IdCard, Truck, Sparkles, Map, BarChart3, MapPin, Factory,
  ArrowUpDown, Package, Tag, Ship, CircleDollarSign, PieChart, BarChart2,
  RefreshCw, Lock, Settings, Car, LogOut, ChevronDown, ChevronLeft, Menu, X,
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

export default function Layout({ children }) {
  const { user } = useAuth();
  const location = useLocation();
  const [contentSidebarOpen, setContentSidebarOpen] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [alerts, setAlerts] = useState([]);

  // Filter sections by role
  const filteredSections = menuSections.map(section => ({
    ...section,
    items: section.items.filter(item => !item.roles || item.roles.includes(user?.role)),
  })).filter(section => section.items.length > 0);

  const visibleSectionTitles = filteredSections.map(s => s.title);

  // Determine active section from current path
  const getActiveSection = useCallback(() => {
    for (const section of filteredSections) {
      if (section.items.some(item => item.path === location.pathname)) {
        return section.title;
      }
    }
    return 'Accueil';
  }, [location.pathname, filteredSections]);

  const [activeSection, setActiveSection] = useState(getActiveSection);

  // Update active section when path changes
  useEffect(() => {
    setActiveSection(getActiveSection());
  }, [location.pathname, getActiveSection]);

  // Load alerts for notification bell
  useEffect(() => {
    api.get('/dashboard/kpis')
      .then(res => setAlerts(res.data?.alertes || []))
      .catch(() => {});
  }, []);

  const activeSectionData = filteredSections.find(s => s.title === activeSection);

  const handleSelectSection = (sectionTitle) => {
    setActiveSection(sectionTitle);
    setContentSidebarOpen(true);
  };

  const handleMobileNav = () => {
    if (window.innerWidth < 1024) setMobileMenuOpen(false);
  };

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
        fixed lg:relative z-50 lg:z-auto flex h-full transition-transform duration-300
      `}>
        {/* Icon sidebar — always visible on desktop */}
        <IconSidebar
          activeSection={activeSection}
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
          onToggleSidebar={() => setContentSidebarOpen(!contentSidebarOpen)}
          onMobileMenu={() => setMobileMenuOpen(!mobileMenuOpen)}
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
