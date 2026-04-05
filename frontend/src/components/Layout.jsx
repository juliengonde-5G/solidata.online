import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import SolidataBot from './SolidataBot';
import {
  LayoutDashboard, Newspaper, UserPlus, Brain, Users, Clock, Star, Heart,
  ClipboardList, IdCard, Truck, Sparkles, Map, BarChart3, MapPin, Factory,
  ArrowUpDown, Package, Tag, Ship, CircleDollarSign, PieChart, BarChart2,
  RefreshCw, Lock, Settings, Car, LogOut, ChevronDown, ChevronLeft, Menu, X,
} from 'lucide-react';

// ══════════════════════════════════════════
// MENU CONFIG — Charte bleu pétrole, icônes Lucide
// ══════════════════════════════════════════
const ICON_STROKE = 1.8;
const hoverClass = 'hover:bg-slate-50';

// Couleurs par module — chaque section a son identité visuelle
const MODULE_COLORS = {
  'Accueil':          { active: 'bg-teal-50 text-teal-700 border-l-4 border-teal-500 font-semibold', icon: 'text-teal-500', header: 'text-teal-600' },
  'Recrutement':      { active: 'bg-blue-50 text-blue-700 border-l-4 border-blue-500 font-semibold', icon: 'text-blue-500', header: 'text-blue-600' },
  'Gestion Équipe':   { active: 'bg-emerald-50 text-emerald-700 border-l-4 border-emerald-500 font-semibold', icon: 'text-emerald-500', header: 'text-emerald-600' },
  'Collecte':         { active: 'bg-teal-50 text-teal-700 border-l-4 border-teal-500 font-semibold', icon: 'text-teal-500', header: 'text-teal-600' },
  'Tri & Production': { active: 'bg-amber-50 text-amber-700 border-l-4 border-amber-500 font-semibold', icon: 'text-amber-500', header: 'text-amber-600' },
  'Logistique':       { active: 'bg-purple-50 text-purple-700 border-l-4 border-purple-500 font-semibold', icon: 'text-purple-500', header: 'text-purple-600' },
  'Finances':         { active: 'bg-indigo-50 text-indigo-700 border-l-4 border-indigo-500 font-semibold', icon: 'text-indigo-500', header: 'text-indigo-600' },
  'Reporting':        { active: 'bg-rose-50 text-rose-700 border-l-4 border-rose-500 font-semibold', icon: 'text-rose-500', header: 'text-rose-600' },
  'Administration':   { active: 'bg-slate-100 text-slate-700 border-l-4 border-slate-500 font-semibold', icon: 'text-slate-500', header: 'text-slate-600' },
};
const defaultColors = { active: 'bg-primary-surface text-primary-dark border-l-4 border-primary font-semibold', icon: 'text-primary', header: 'text-primary' };

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
      { path: '/activity-log', label: 'Journal d\'activité', icon: ClipboardList, roles: ['ADMIN'] },
    ],
  },
];

export default function Layout({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const getActiveSection = useCallback(() => {
    for (const section of menuSections) {
      if (section.items.some(item => item.path === location.pathname)) {
        return section.title;
      }
    }
    return 'Accueil';
  }, [location.pathname]);

  const [expandedSections, setExpandedSections] = useState(() => [getActiveSection()]);

  // Auto-expand the section containing the active route on navigation
  useEffect(() => {
    const active = getActiveSection();
    setExpandedSections(prev => prev.includes(active) ? prev : [...prev, active]);
  }, [location.pathname, getActiveSection]);

  const toggleSection = (title) => {
    setExpandedSections(prev =>
      prev.includes(title) ? prev.filter(t => t !== title) : [...prev, title]
    );
  };

  const filteredSections = menuSections.map(section => ({
    ...section,
    items: section.items.filter(item => !item.roles || item.roles.includes(user?.role)),
  })).filter(section => section.items.length > 0);

  return (
    <div className="flex h-screen bg-[var(--color-bg)]">
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/20 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} aria-hidden="true" />
      )}

      {/* Sidebar — design system bleu pétrole */}
      <aside className={`
        ${sidebarOpen ? 'w-64 translate-x-0' : 'w-0 -translate-x-full lg:w-[4.5rem] lg:translate-x-0'}
        fixed lg:relative z-50 lg:z-auto
        bg-white border-r border-slate-200/80 flex flex-col transition-all duration-300 h-full overflow-hidden shadow-sidebar
      `}>
        <div className="p-4 border-b border-slate-100 flex items-center justify-center flex-shrink-0 min-h-[60px]">
          {sidebarOpen ? (
            <img src="/logo-text.png" alt="Solidata" className="h-8 object-contain" />
          ) : (
            <img src="/logo.png" alt="Solidata" className="w-9 h-9 rounded-card object-contain" />
          )}
        </div>

        <nav className="flex-1 overflow-y-auto py-3 px-2">
          {filteredSections.map(section => (
            <div key={section.title} className="mb-2">
              {sidebarOpen && (
                <div className="flex items-center gap-0.5">
                  {section.hubPath && section.hubPath !== '/' ? (
                    <button
                      onClick={() => { navigate(section.hubPath); if (window.innerWidth < 1024) setSidebarOpen(false); }}
                      className={`flex-1 px-2.5 py-2 text-[11px] font-semibold uppercase tracking-wider flex items-center rounded-lg transition text-left ${(MODULE_COLORS[section.title] || defaultColors).header} hover:opacity-80`}
                      title={`Vue d'ensemble ${section.title}`}
                    >
                      <span>{section.title}</span>
                    </button>
                  ) : (
                    <span className={`flex-1 px-2.5 py-2 text-[11px] font-semibold uppercase tracking-wider ${(MODULE_COLORS[section.title] || defaultColors).header}`}>
                      {section.title}
                    </span>
                  )}
                  <button
                    onClick={() => toggleSection(section.title)}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-primary hover:bg-primary-surface/50 transition"
                  >
                    <ChevronDown
                      className={`w-3.5 h-3.5 transition-transform ${expandedSections.includes(section.title) ? 'rotate-180' : ''}`}
                      strokeWidth={2}
                    />
                  </button>
                </div>
              )}
              {(expandedSections.includes(section.title) || !sidebarOpen) && section.items.map(item => {
                const isActive = location.pathname === item.path;
                const Icon = item.icon;
                const colors = MODULE_COLORS[section.title] || defaultColors;
                return (
                  <button
                    key={item.path}
                    onClick={() => { navigate(item.path); if (window.innerWidth < 1024) setSidebarOpen(false); }}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm rounded-lg mb-0.5 transition-all border-l-[3px] border-transparent ${
                      isActive ? colors.active : `text-slate-600 ${hoverClass}`
                    }`}
                    title={item.label}
                  >
                    <Icon className={`w-5 h-5 flex-shrink-0 ${isActive ? colors.icon : 'text-slate-400'}`} strokeWidth={ICON_STROKE} />
                    {sidebarOpen && <span className="truncate">{item.label}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="border-t border-slate-100 p-3 flex-shrink-0 bg-slate-50/50">
          {sidebarOpen ? (
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-primary rounded-full flex items-center justify-center shadow-sm">
                <span className="text-white text-xs font-semibold">
                  {user?.first_name?.[0]}{user?.last_name?.[0]}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-800 truncate">
                  {user?.first_name} {user?.last_name}
                </p>
                <p className="text-[11px] text-slate-500 font-medium">{user?.role}</p>
              </div>
              <button onClick={logout} className="text-slate-400 hover:text-red-600 transition p-1.5 rounded-lg hover:bg-red-50" title="Déconnexion">
                <LogOut className="w-5 h-5" strokeWidth={ICON_STROKE} />
              </button>
            </div>
          ) : (
            <button onClick={logout} className="w-full flex justify-center text-slate-400 hover:text-red-600 p-1.5 rounded-lg" title="Déconnexion">
              <LogOut className="w-5 h-5" strokeWidth={ICON_STROKE} />
            </button>
          )}
        </div>
      </aside>

      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="fixed top-3 left-3 z-50 lg:hidden bg-white shadow-card rounded-xl p-2.5 border border-slate-200"
        aria-label={sidebarOpen ? 'Fermer le menu' : 'Ouvrir le menu'}
      >
        {sidebarOpen
          ? <X className="w-5 h-5 text-slate-600" strokeWidth={2} />
          : <Menu className="w-5 h-5 text-slate-600" strokeWidth={2} />
        }
      </button>

      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="hidden lg:flex fixed z-50 bg-white shadow-card rounded-full p-2 border border-slate-200 transition-all hover:shadow-card-hover"
        style={{ top: '50%', left: sidebarOpen ? '252px' : '54px', transform: 'translateY(-50%)' }}
        aria-label={sidebarOpen ? 'Réduire le menu' : 'Agrandir le menu'}
      >
        <ChevronLeft
          className={`w-4 h-4 text-slate-500 transition-transform ${sidebarOpen ? '' : 'rotate-180'}`}
          strokeWidth={2}
        />
      </button>

      <main className="flex-1 overflow-y-auto lg:ml-0 min-h-0">
        <div className="p-4 sm:p-6 lg:p-6 max-w-[1600px] mx-auto">
          {children}
        </div>
      </main>

      {/* SolidataBot — Agent IA conversationnel */}
      <SolidataBot />
    </div>
  );
}
