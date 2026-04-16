import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { LogOut, ChevronLeft } from 'lucide-react';

const ICON_STROKE = 1.8;

const MODULE_COLORS = {
  'Accueil':          { active: 'bg-teal-50 text-teal-700 border-l-4 border-teal-500 font-semibold', icon: 'text-teal-500', header: 'text-teal-600' },
  'Recrutement':      { active: 'bg-blue-50 text-blue-700 border-l-4 border-blue-500 font-semibold', icon: 'text-blue-500', header: 'text-blue-600' },
  'Gestion Équipe':   { active: 'bg-emerald-50 text-emerald-700 border-l-4 border-emerald-500 font-semibold', icon: 'text-emerald-500', header: 'text-emerald-600' },
  'Collecte':         { active: 'bg-teal-50 text-teal-700 border-l-4 border-teal-500 font-semibold', icon: 'text-teal-500', header: 'text-teal-600' },
  'Tri & Production': { active: 'bg-amber-50 text-amber-700 border-l-4 border-amber-500 font-semibold', icon: 'text-amber-500', header: 'text-amber-600' },
  'Logistique':       { active: 'bg-purple-50 text-purple-700 border-l-4 border-purple-500 font-semibold', icon: 'text-purple-500', header: 'text-purple-600' },
  'Boutiques':        { active: 'bg-pink-50 text-pink-700 border-l-4 border-pink-500 font-semibold', icon: 'text-pink-500', header: 'text-pink-600' },
  'Finances':         { active: 'bg-indigo-50 text-indigo-700 border-l-4 border-indigo-500 font-semibold', icon: 'text-indigo-500', header: 'text-indigo-600' },
  'Reporting':        { active: 'bg-rose-50 text-rose-700 border-l-4 border-rose-500 font-semibold', icon: 'text-rose-500', header: 'text-rose-600' },
  'Administration':   { active: 'bg-slate-100 text-slate-700 border-l-4 border-slate-500 font-semibold', icon: 'text-slate-500', header: 'text-slate-600' },
};
const defaultColors = { active: 'bg-primary-surface text-primary-dark border-l-4 border-primary font-semibold', icon: 'text-primary', header: 'text-primary' };

export default function ContentSidebar({ section, onClose, onNavigate }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  if (!section) return null;

  const colors = MODULE_COLORS[section.title] || defaultColors;

  const handleNav = (path) => {
    navigate(path);
    if (onNavigate) onNavigate();
  };

  return (
    <aside className="w-60 flex-shrink-0 bg-white border-r border-slate-100 flex flex-col h-full overflow-hidden">
      {/* Section header */}
      <div className="h-14 px-4 flex items-center justify-between border-b border-slate-100 flex-shrink-0">
        <span className={`text-xs font-semibold uppercase tracking-wider ${colors.header}`}>
          {section.title}
        </span>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition"
          title="Masquer le menu"
        >
          <ChevronLeft className="w-4 h-4" strokeWidth={2} />
        </button>
      </div>

      {/* Menu items */}
      <nav className="flex-1 overflow-y-auto py-2 px-2">
        {section.items.map(item => {
          const isActive = location.pathname === item.path;
          const Icon = item.icon;
          return (
            <button
              key={item.path}
              onClick={() => handleNav(item.path)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm rounded-lg mb-0.5 transition-all border-l-[3px] border-transparent ${
                isActive ? colors.active : 'text-slate-600 hover:bg-slate-50'
              }`}
              title={item.label}
            >
              <Icon className={`w-5 h-5 flex-shrink-0 ${isActive ? colors.icon : 'text-slate-400'}`} strokeWidth={ICON_STROKE} />
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* User profile */}
      <div className="border-t border-slate-100 p-3 flex-shrink-0 bg-slate-50/50">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-primary rounded-full flex items-center justify-center shadow-sm flex-shrink-0">
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
          <button
            onClick={logout}
            className="text-slate-400 hover:text-red-600 transition p-1.5 rounded-lg hover:bg-red-50"
            title="Déconnexion"
          >
            <LogOut className="w-5 h-5" strokeWidth={ICON_STROKE} />
          </button>
        </div>
      </div>
    </aside>
  );
}
