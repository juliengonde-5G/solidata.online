import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import SolidataBot from './SolidataBot';

// ══════════════════════════════════════════
// MENU CONFIG — Charte bleu pétrole, icônes plates
// ══════════════════════════════════════════
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
      { path: '/', label: 'Tableau de bord', icon: IconDashboard, roles: null },
      { path: '/news', label: 'Fil d\'actualité', icon: IconNews, roles: null },
    ],
  },
  {
    title: 'Recrutement',
    hubPath: '/hub-recrutement',
    items: [
      { path: '/candidates', label: 'Candidats', icon: IconCandidates, roles: ['ADMIN', 'RH', 'MANAGER'] },
      { path: '/pcm', label: 'Matrice PCM', icon: IconBrain, roles: ['ADMIN', 'RH'] },
    ],
  },
  {
    title: 'Gestion Équipe',
    hubPath: '/hub-equipe',
    items: [
      { path: '/employees', label: 'Collaborateurs', icon: IconTeam, roles: ['ADMIN', 'RH', 'MANAGER'] },
      { path: '/work-hours', label: 'Heures de travail', icon: IconClock, roles: ['ADMIN', 'RH'] },
      { path: '/skills', label: 'Compétences', icon: IconStar, roles: ['ADMIN', 'RH'] },
      { path: '/insertion', label: 'Parcours insertion', icon: IconHeart, roles: ['ADMIN', 'RH', 'MANAGER'] },
      { path: '/planning-hebdo', label: 'Planning hebdo', icon: IconList, roles: ['ADMIN', 'MANAGER'] },
      { path: '/pointage', label: 'Pointage', icon: IconBadge, roles: ['ADMIN', 'RH', 'MANAGER'] },
    ],
  },
  {
    title: 'Collecte',
    hubPath: '/hub-collecte',
    items: [
      { path: '/tours', label: 'Tournées', icon: IconTruck, roles: ['ADMIN', 'MANAGER'] },
      { path: '/collection-proposals', label: 'Propositions (IA)', icon: IconSparkles, roles: ['ADMIN', 'MANAGER'] },
      { path: '/cav-map', label: 'Carte CAV', icon: IconMap, roles: ['ADMIN', 'MANAGER'] },
      { path: '/fill-rate', label: 'Remplissage CAV', icon: IconChart, roles: ['ADMIN', 'MANAGER'] },
      { path: '/live-vehicles', label: 'Suivi GPS', icon: IconGPS, roles: ['ADMIN', 'MANAGER'] },
    ],
  },
  {
    title: 'Tri & Production',
    hubPath: '/hub-tri-production',
    items: [
      { path: '/production', label: 'Production', icon: IconFactory, roles: ['ADMIN', 'MANAGER'] },
      { path: '/chaine-tri', label: 'Chaînes de tri', icon: IconSort, roles: ['ADMIN', 'MANAGER'] },
      { path: '/stock', label: 'Stock MP', icon: IconBox, roles: ['ADMIN', 'MANAGER'] },
      { path: '/produits-finis', label: 'Produits finis', icon: IconTag, roles: ['ADMIN', 'MANAGER'] },
      { path: '/expeditions', label: 'Expéditions', icon: IconShip, roles: ['ADMIN', 'MANAGER'] },
    ],
  },
  {
    title: 'Logistique',
    hubPath: '/hub-exutoires',
    items: [
      { path: '/exutoires-commandes', label: 'Commandes', icon: IconList, roles: ['ADMIN', 'MANAGER'] },
      { path: '/exutoires-preparation', label: 'Préparation', icon: IconTruck, roles: ['ADMIN', 'MANAGER'] },
      { path: '/exutoires-gantt', label: 'Gantt Chargement', icon: IconChart, roles: ['ADMIN', 'MANAGER'] },
      { path: '/exutoires-facturation', label: 'Facturation', icon: IconMoney, roles: ['ADMIN', 'MANAGER'] },
      { path: '/exutoires-calendrier', label: 'Calendrier', icon: IconClock, roles: ['ADMIN', 'MANAGER'] },
      { path: '/exutoires-clients', label: 'Clients', icon: IconTeam, roles: ['ADMIN', 'MANAGER'] },
      { path: '/exutoires-tarifs', label: 'Grille Tarifaire', icon: IconMoney, roles: ['ADMIN', 'MANAGER'] },
    ],
  },
  {
    title: 'Finances',
    hubPath: '/finance',
    items: [
      { path: '/finance', label: 'Synthèse', icon: IconDashboard, roles: ['ADMIN', 'MANAGER'] },
      { path: '/finance/operations', label: 'Opérations', icon: IconFactory, roles: ['ADMIN', 'MANAGER'] },
      { path: '/finance/rentabilite', label: 'Rentabilité', icon: IconChartBar, roles: ['ADMIN', 'MANAGER'] },
      { path: '/finance/tresorerie', label: 'Trésorerie', icon: IconMoney, roles: ['ADMIN', 'MANAGER'] },
      { path: '/finance/pl', label: 'P&L Centre', icon: IconChartBar, roles: ['ADMIN', 'MANAGER'] },
      { path: '/finance/bilan', label: 'Bilan / CR', icon: IconChart, roles: ['ADMIN', 'MANAGER'] },
      { path: '/finance/controles', label: 'Contrôles', icon: IconStar, roles: ['ADMIN', 'MANAGER'] },
      { path: '/pennylane', label: 'Pennylane', icon: IconPennylane, roles: ['ADMIN', 'MANAGER'] },
    ],
  },
  {
    title: 'Reporting',
    hubPath: '/hub-reporting',
    items: [
      { path: '/reporting-collecte', label: 'Collecte', icon: IconChart, roles: ['ADMIN', 'MANAGER'] },
      { path: '/reporting-rh', label: 'RH', icon: IconChartPeople, roles: ['ADMIN', 'RH'] },
      { path: '/reporting-production', label: 'Production', icon: IconChartBar, roles: ['ADMIN', 'MANAGER'] },
      { path: '/refashion', label: 'Refashion', icon: IconRecycle, roles: ['ADMIN', 'MANAGER'] },
      { path: '/reporting-metropole', label: 'Métropole Rouen', icon: IconChart, roles: ['ADMIN', 'MANAGER'] },
    ],
  },
  {
    title: 'Administration',
    hubPath: '/hub-admin',
    items: [
      { path: '/users', label: 'Utilisateurs', icon: IconLock, roles: ['ADMIN'] },
      { path: '/vehicles', label: 'Véhicules', icon: IconVehicle, roles: ['ADMIN'] },
      { path: '/vehicle-maintenance', label: 'Maintenance', icon: IconGear, roles: ['ADMIN'] },
      { path: '/settings', label: 'Configuration', icon: IconGear, roles: ['ADMIN'] },
      { path: '/referentiels', label: 'Référentiels', icon: IconList, roles: ['ADMIN'] },
      { path: '/admin-predictive', label: 'Moteur prédictif', icon: IconBrain, roles: ['ADMIN'] },
      { path: '/rgpd', label: 'RGPD', icon: IconLock, roles: ['ADMIN'] },
      { path: '/admin-cav', label: 'Gestion CAV', icon: IconMap, roles: ['ADMIN'] },
      { path: '/admin-db', label: 'Base de données', icon: IconGear, roles: ['ADMIN'] },
      { path: '/activity-log', label: 'Journal d\'activité', icon: IconList, roles: ['ADMIN'] },
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
                    <svg className={`w-3.5 h-3.5 transition-transform ${expandedSections.includes(section.title) ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
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
                    <Icon className={`w-5 h-5 flex-shrink-0 ${isActive ? colors.icon : 'text-slate-400'}`} />
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
                <IconLogout className="w-5 h-5" />
              </button>
            </div>
          ) : (
            <button onClick={logout} className="w-full flex justify-center text-slate-400 hover:text-red-600 p-1.5 rounded-lg" title="Déconnexion">
              <IconLogout className="w-5 h-5" />
            </button>
          )}
        </div>
      </aside>

      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="fixed top-3 left-3 z-50 lg:hidden bg-white shadow-card rounded-xl p-2.5 border border-slate-200"
        aria-label={sidebarOpen ? 'Fermer le menu' : 'Ouvrir le menu'}
      >
        <svg className="w-5 h-5 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={sidebarOpen ? "M6 18L18 6M6 6l12 12" : "M4 6h16M4 12h16M4 18h16"} />
        </svg>
      </button>

      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="hidden lg:flex fixed z-50 bg-white shadow-card rounded-full p-2 border border-slate-200 transition-all hover:shadow-card-hover"
        style={{ top: '50%', left: sidebarOpen ? '252px' : '54px', transform: 'translateY(-50%)' }}
        aria-label={sidebarOpen ? 'Réduire le menu' : 'Agrandir le menu'}
      >
        <svg className={`w-4 h-4 text-slate-500 transition-transform ${sidebarOpen ? '' : 'rotate-180'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
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

// ══════════════════════════════════════════
// SVG ICONS — Simple, clean, colorable
// ══════════════════════════════════════════

function IconDashboard({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>;
}
function IconCandidates({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8m13 0a4 4 0 100-8m0 12v-2a4 4 0 00-3-3.87" /></svg>;
}
function IconBrain({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 2a7 7 0 00-7 7c0 2.38 1.19 4.47 3 5.74V17a2 2 0 002 2h4a2 2 0 002-2v-2.26c1.81-1.27 3-3.36 3-5.74a7 7 0 00-7-7z" /><path strokeLinecap="round" strokeWidth={1.8} d="M9 21h6" /></svg>;
}
function IconTeam({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197" /></svg>;
}
function IconClock({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" strokeWidth={1.8} /><path strokeLinecap="round" strokeWidth={1.8} d="M12 6v6l4 2" /></svg>;
}
function IconStar({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" /></svg>;
}
function IconSparkles({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
    </svg>
  );
}
function IconTruck({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10m10 0H3m10 0a2 2 0 104 0m-4 0a2 2 0 114 0m6-6h-2a1 1 0 00-1 1v5m3 0h-3m3 0a2 2 0 104 0m-4 0a2 2 0 114 0" /></svg>;
}
function IconVehicle({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10H8s-1.5 0-2.5 1.5L3 15v2c0 .6.4 1 1 1h2m0 0a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0" /></svg>;
}
function IconMap({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" /></svg>;
}
function IconGPS({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><circle cx="12" cy="11" r="3" strokeWidth={1.8} /></svg>;
}
function IconFactory({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0H5m14 0h2m-16 0H3m2-5h4m2 0h4m-8-4h4m2 0h4" /></svg>;
}
function IconSort({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 4h16M4 8h12M4 12h8M4 16h4m4-4l4 4m0 0l4-4m-4 4V4" /></svg>;
}
function IconBox({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" /></svg>;
}
function IconTag({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" /></svg>;
}
function IconShip({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12l-2 8h18l-2-8" /></svg>;
}
function IconChart({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>;
}
function IconChartPeople({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M16 8v8m-4-5v5m-4-2v2m-2 4h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>;
}
function IconChartBar({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z" /></svg>;
}
function IconRecycle({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>;
}
function IconMoney({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>;
}
function IconLock({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>;
}
function IconGear({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><circle cx="12" cy="12" r="3" strokeWidth={1.8} /></svg>;
}
function IconList({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" /></svg>;
}
function IconHeart({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" /></svg>;
}
function IconNews({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" /></svg>;
}
function IconBadge({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><rect x="4" y="2" width="16" height="20" rx="2" strokeWidth={1.8} /><circle cx="12" cy="10" r="3" strokeWidth={1.8} /><path strokeLinecap="round" strokeWidth={1.8} d="M8 17h8M10 5h4" /></svg>;
}
function IconPennylane({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>;
}
function IconLogout({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>;
}
