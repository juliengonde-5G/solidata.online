import {
  LayoutDashboard, UserPlus, Users, Truck, Factory,
  Ship, CircleDollarSign, BarChart3, Settings, Store,
} from 'lucide-react';

const ICON_STROKE = 1.8;

const MODULE_ICONS = [
  { key: 'Accueil', icon: LayoutDashboard, color: 'teal' },
  { key: 'Recrutement', icon: UserPlus, color: 'blue' },
  { key: 'Gestion Équipe', icon: Users, color: 'emerald' },
  { key: 'Collecte', icon: Truck, color: 'teal' },
  { key: 'Tri & Production', icon: Factory, color: 'amber' },
  { key: 'Logistique', icon: Ship, color: 'purple' },
  { key: 'Boutiques', icon: Store, color: 'pink' },
  { key: 'Finances', icon: CircleDollarSign, color: 'indigo' },
  { key: 'Reporting', icon: BarChart3, color: 'rose' },
  { key: 'Administration', icon: Settings, color: 'slate' },
];

const ACTIVE_COLORS = {
  teal: 'border-teal-500 text-teal-600 bg-teal-50',
  blue: 'border-blue-500 text-blue-600 bg-blue-50',
  emerald: 'border-emerald-500 text-emerald-600 bg-emerald-50',
  amber: 'border-amber-500 text-amber-600 bg-amber-50',
  purple: 'border-purple-500 text-purple-600 bg-purple-50',
  indigo: 'border-indigo-500 text-indigo-600 bg-indigo-50',
  rose: 'border-rose-500 text-rose-600 bg-rose-50',
  pink: 'border-pink-500 text-pink-600 bg-pink-50',
  slate: 'border-slate-500 text-slate-600 bg-slate-100',
};

export default function IconSidebar({ activeSection, visibleSections, onSelectSection }) {
  return (
    <aside className="w-[60px] flex-shrink-0 bg-white border-r border-slate-200 flex flex-col h-full z-30">
      {/* Logo */}
      <div className="flex items-center justify-center h-14 border-b border-slate-100 flex-shrink-0">
        <img src="/logo.png" alt="Solidata" className="w-8 h-8 rounded-lg object-contain" />
      </div>

      {/* Module icons */}
      <nav className="flex-1 flex flex-col items-center gap-1 py-3 overflow-y-auto">
        {MODULE_ICONS.filter(m => visibleSections.includes(m.key)).map(({ key, icon: Icon, color }) => {
          const isActive = activeSection === key;
          const activeStyle = ACTIVE_COLORS[color] || ACTIVE_COLORS.teal;

          return (
            <button
              key={key}
              onClick={() => onSelectSection(key)}
              className={`w-10 h-10 flex items-center justify-center rounded-xl transition-all border-l-[3px] ${
                isActive
                  ? activeStyle
                  : 'border-transparent text-slate-400 hover:text-slate-600 hover:bg-slate-50'
              }`}
              title={key}
            >
              <Icon className="w-5 h-5" strokeWidth={ICON_STROKE} />
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
