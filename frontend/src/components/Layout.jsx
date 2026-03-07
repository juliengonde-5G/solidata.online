import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const menuSections = [
  {
    title: 'Accueil',
    items: [
      { path: '/', label: 'Tableau de bord', icon: '📊', roles: null },
    ],
  },
  {
    title: 'Recrutement',
    items: [
      { path: '/candidates', label: 'Candidats', icon: '👥', roles: ['ADMIN', 'RH', 'MANAGER'] },
      { path: '/pcm', label: 'Matrice PCM', icon: '🧠', roles: ['ADMIN', 'RH'] },
    ],
  },
  {
    title: 'Gestion Équipe',
    items: [
      { path: '/employees', label: 'Employés', icon: '🏢', roles: ['ADMIN', 'RH', 'MANAGER'] },
      { path: '/work-hours', label: 'Heures de travail', icon: '⏱️', roles: ['ADMIN', 'RH'] },
      { path: '/skills', label: 'Compétences', icon: '🎯', roles: ['ADMIN', 'RH'] },
    ],
  },
  {
    title: 'Tournées Collecte',
    items: [
      { path: '/tours', label: 'Tournées', icon: '🚛', roles: ['ADMIN', 'MANAGER'] },
      { path: '/vehicles', label: 'Véhicules', icon: '🚗', roles: ['ADMIN', 'MANAGER'] },
      { path: '/cav-map', label: 'Carte CAV', icon: '🗺️', roles: ['ADMIN', 'MANAGER'] },
      { path: '/live-vehicles', label: 'Suivi GPS', icon: '📡', roles: ['ADMIN', 'MANAGER'] },
    ],
  },
  {
    title: 'Gestion Tri',
    items: [
      { path: '/production', label: 'Production', icon: '⚙️', roles: ['ADMIN', 'MANAGER'] },
      { path: '/chaine-tri', label: 'Chaînes de tri', icon: '🔄', roles: ['ADMIN', 'MANAGER'] },
      { path: '/stock', label: 'Stock MP', icon: '📦', roles: ['ADMIN', 'MANAGER'] },
      { path: '/produits-finis', label: 'Produits finis', icon: '🏷️', roles: ['ADMIN', 'MANAGER'] },
      { path: '/expeditions', label: 'Expéditions', icon: '📤', roles: ['ADMIN', 'MANAGER'] },
    ],
  },
  {
    title: 'Reporting',
    items: [
      { path: '/reporting', label: 'Dashboard', icon: '📈', roles: ['ADMIN', 'MANAGER', 'AUTORITE'] },
      { path: '/refashion', label: 'Refashion', icon: '♻️', roles: ['ADMIN', 'MANAGER'] },
      { path: '/billing', label: 'Facturation', icon: '💰', roles: ['ADMIN', 'MANAGER'] },
    ],
  },
  {
    title: 'Paramètres',
    items: [
      { path: '/users', label: 'Utilisateurs', icon: '🔐', roles: ['ADMIN'] },
      { path: '/settings', label: 'Configuration', icon: '⚙️', roles: ['ADMIN'] },
      { path: '/referentiels', label: 'Référentiels', icon: '📋', roles: ['ADMIN'] },
      { path: '/messaging', label: 'Messagerie', icon: '✉️', roles: ['ADMIN'] },
    ],
  },
];

export default function Layout({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [expandedSections, setExpandedSections] = useState(['Accueil']);
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

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
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className={`${sidebarOpen ? 'w-64' : 'w-16'} bg-white border-r border-gray-200 flex flex-col transition-all duration-300 flex-shrink-0`}>
        {/* Logo */}
        <div className="p-4 border-b border-gray-100 flex items-center gap-3">
          <img src="/logo.png" alt="Solidata" className="w-8 h-8 rounded-lg flex-shrink-0 object-contain" />
          {sidebarOpen && <img src="/logo-text.png" alt="Solidata" className="h-6 object-contain" />}
        </div>

        {/* Menu */}
        <nav className="flex-1 overflow-y-auto py-2">
          {filteredSections.map(section => (
            <div key={section.title} className="mb-1">
              {sidebarOpen && (
                <button
                  onClick={() => toggleSection(section.title)}
                  className="w-full px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider flex items-center justify-between hover:text-gray-600"
                >
                  {section.title}
                  <span className="text-[10px]">{expandedSections.includes(section.title) ? '▼' : '▶'}</span>
                </button>
              )}
              {(expandedSections.includes(section.title) || !sidebarOpen) && section.items.map(item => (
                <button
                  key={item.path}
                  onClick={() => navigate(item.path)}
                  className={`w-full flex items-center gap-3 px-4 py-2 text-sm transition-colors ${
                    location.pathname === item.path
                      ? 'bg-solidata-green/10 text-solidata-green font-medium border-r-2 border-solidata-green'
                      : 'text-gray-600 hover:bg-gray-50'
                  }`}
                  title={item.label}
                >
                  <span className="text-base flex-shrink-0">{item.icon}</span>
                  {sidebarOpen && <span>{item.label}</span>}
                </button>
              ))}
            </div>
          ))}
        </nav>

        {/* User profile footer */}
        <div className="border-t border-gray-100 p-3">
          {sidebarOpen ? (
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-solidata-green/20 rounded-full flex items-center justify-center">
                <span className="text-solidata-green text-xs font-bold">
                  {user?.first_name?.[0]}{user?.last_name?.[0]}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-700 truncate">
                  {user?.first_name} {user?.last_name}
                </p>
                <p className="text-xs text-gray-400">{user?.role}</p>
              </div>
              <button onClick={logout} className="text-gray-400 hover:text-red-500 transition" title="Déconnexion">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
              </button>
            </div>
          ) : (
            <button onClick={logout} className="w-full flex justify-center text-gray-400 hover:text-red-500" title="Déconnexion">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </button>
          )}
        </div>
      </aside>

      {/* Toggle button */}
      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="fixed top-4 left-2 z-50 md:hidden bg-white shadow rounded-lg p-2"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
