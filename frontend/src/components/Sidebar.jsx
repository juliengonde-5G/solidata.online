import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  LayoutGrid, Truck, Users, Settings, ChevronDown, ChevronLeft,
} from 'lucide-react';

const NAV_SCROLL_KEY = 'solidata_nav_scroll_top';

// 4 parents arborescents qui regroupent les 10 sections existantes
// (mapping confirmé en plan-mode)
const NAV_TREE = [
  { id: 'pilotage',   label: 'Pilotage',   icon: LayoutGrid, sections: ['Accueil', 'Reporting', 'Finances'] },
  { id: 'operations', label: 'Opérations', icon: Truck,      sections: ['Collecte', 'Tri & Production', 'Logistique', 'Boutiques'] },
  { id: 'equipes',    label: 'Équipes',    icon: Users,      sections: ['Recrutement', 'Gestion Équipe'] },
  { id: 'systeme',    label: 'Système',    icon: Settings,   sections: ['Administration'] },
];

const SECTION_TO_PARENT = NAV_TREE.reduce((acc, p) => {
  p.sections.forEach((s) => { acc[s] = p.id; });
  return acc;
}, {});

function readJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}

export default function Sidebar({ filteredSections, collapsed, onToggleCollapse, onNavigate, counts = {} }) {
  const location = useLocation();
  const navRef = useRef(null);

  // Restaurer le scroll de la nav après re-mount de Layout (évite le retour en haut à chaque clic)
  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    const saved = parseInt(sessionStorage.getItem(NAV_SCROLL_KEY) || '0', 10);
    if (saved > 0) el.scrollTop = saved;
    const onScroll = () => {
      try { sessionStorage.setItem(NAV_SCROLL_KEY, String(el.scrollTop)); } catch { /* noop */ }
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // Map titre section → données filtrées (sections vides retirées par Layout via filteredSections)
  const sectionByTitle = useMemo(() => {
    const map = {};
    filteredSections.forEach((s) => { map[s.title] = s; });
    return map;
  }, [filteredSections]);

  // Détecter le parent contenant la route active
  const activeParent = useMemo(() => {
    for (const section of filteredSections) {
      if (section.hubPath && (section.hubPath === location.pathname ||
          (section.hubPath !== '/' && location.pathname.startsWith(section.hubPath)))) {
        return SECTION_TO_PARENT[section.title];
      }
      if (section.items.some((it) => it.path === location.pathname ||
          (it.path !== '/' && location.pathname.startsWith(it.path)))) {
        return SECTION_TO_PARENT[section.title];
      }
    }
    return null;
  }, [filteredSections, location.pathname]);

  // État d'ouverture des parents (persisté)
  const [openMap, setOpenMap] = useState(() => readJSON('solidata_nav_open', {
    pilotage: true, operations: true, equipes: true, systeme: false,
  }));
  useEffect(() => {
    try { localStorage.setItem('solidata_nav_open', JSON.stringify(openMap)); } catch { /* noop */ }
  }, [openMap]);

  // Auto-expand du parent actif quand on navigue
  useEffect(() => {
    if (activeParent) setOpenMap((m) => (m[activeParent] ? m : { ...m, [activeParent]: true }));
  }, [activeParent]);

  const toggleParent = useCallback((id) => {
    if (collapsed) {
      onToggleCollapse(); // expand sidebar d'abord
      setOpenMap((m) => ({ ...m, [id]: true }));
      return;
    }
    setOpenMap((m) => ({ ...m, [id]: !m[id] }));
  }, [collapsed, onToggleCollapse]);

  // Sélectionne l'item dont le path est le préfixe le plus long de l'URL courante,
  // parmi tous les items de toutes les sections visibles. Évite que `/boutiques`
  // ET `/boutiques/planning` soient simultanément "actifs" sur /boutiques/planning.
  const activePath = useMemo(() => {
    const allPaths = filteredSections.flatMap((s) => s.items.map((it) => it.path));
    let best = null;
    for (const p of allPaths) {
      if (p === '/') {
        if (location.pathname === '/' && (!best || best.length < 1)) best = p;
        continue;
      }
      if (location.pathname === p || location.pathname.startsWith(p + '/')) {
        if (!best || p.length > best.length) best = p;
      }
    }
    return best;
  }, [filteredSections, location.pathname]);

  const isItemActive = useCallback((path) => path === activePath, [activePath]);

  return (
    <aside
      className="flex flex-col flex-shrink-0 bg-white border-r border-slate-200 shadow-sidebar h-full transition-[width] duration-200 sticky top-0 z-30"
      style={{ width: collapsed ? '4.25rem' : '15.5rem' }}
    >
      {/* ── Brand ─────────────────────────────────────────────── */}
      <div className={`flex items-center border-b border-slate-100 ${collapsed ? 'justify-center px-2 py-4' : 'gap-3 px-3.5 py-4'}`}>
        <Link
          to="/"
          className="flex items-center justify-center flex-shrink-0 w-10 h-10 rounded-lg bg-white hover:bg-slate-50 transition-colors"
          title="Solidarité Textiles — Tableau de bord"
          aria-label="Tableau de bord"
        >
          <img src="/logo.png" alt="Solidarité Textiles" className="w-9 h-9 object-contain" />
        </Link>
        {!collapsed && (
          <Link to="/" className="flex-1 min-w-0 group" aria-label="Tableau de bord">
            <div className="text-sm font-extrabold text-slate-900 tracking-wide truncate group-hover:text-teal-700 transition-colors">Solidarité Textiles</div>
            <div className="text-[11px] text-slate-500 truncate">ERP SOLIDATA</div>
          </Link>
        )}
        {!collapsed && (
          <button
            onClick={onToggleCollapse}
            className="grid place-items-center w-7 h-7 rounded-md border border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition"
            title="Réduire la barre latérale"
            aria-label="Réduire"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* ── Toggle flottant en mode collapsed ─────────────────── */}
      {collapsed && (
        <button
          onClick={onToggleCollapse}
          className="absolute top-4 -right-3 grid place-items-center w-6 h-6 rounded-md border border-slate-200 bg-white text-slate-500 shadow-card hover:text-slate-800 z-10"
          title="Étendre la barre latérale"
          aria-label="Étendre"
        >
          <ChevronLeft className="w-3.5 h-3.5 rotate-180" />
        </button>
      )}

      {/* ── Nav arborescente ─────────────────────────────────── */}
      <nav ref={navRef} className="flex-1 overflow-y-auto overflow-x-hidden px-2.5 py-3">
        {NAV_TREE.map((parent) => {
          // ne montrer que les sections visibles (filtrage par rôle)
          const childSections = parent.sections
            .map((title) => sectionByTitle[title])
            .filter(Boolean);

          if (childSections.length === 0) return null;

          const isOpen = !!openMap[parent.id];
          const hasActive = activeParent === parent.id;
          const ParentIcon = parent.icon;

          return (
            <div key={parent.id} className="mb-1">
              <button
                onClick={() => toggleParent(parent.id)}
                className={`w-full flex items-center gap-3 px-2.5 py-2.5 rounded-button text-left transition-colors ${
                  hasActive ? 'nav-parent-active' : 'text-slate-700 hover:bg-slate-50 hover:text-slate-900'
                } ${collapsed ? 'justify-center' : ''}`}
                title={collapsed ? parent.label : undefined}
                aria-expanded={isOpen}
              >
                <ParentIcon className={`w-[18px] h-[18px] flex-shrink-0 ${hasActive ? 'text-primary-dark' : 'text-slate-500'}`} />
                {!collapsed && (
                  <>
                    <span className="flex-1 text-[13px] font-semibold tracking-tight">{parent.label}</span>
                    <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform ${isOpen ? '' : '-rotate-90'}`} />
                  </>
                )}
              </button>

              {/* Children */}
              {!collapsed && isOpen && (
                <div className="ml-3.5 mt-1 pl-2 border-l border-slate-100 space-y-3">
                  {childSections.map((section) => (
                    <div key={section.title}>
                      {childSections.length > 1 && (
                        <div className="px-2.5 pt-2 pb-1 text-[10.5px] font-bold uppercase tracking-wider text-slate-400">
                          {section.title}
                        </div>
                      )}
                      <div className="space-y-0.5">
                        {section.items.map((item) => {
                          const Icon = item.icon;
                          const active = isItemActive(item.path);
                          const pill = counts[item.path];
                          return (
                            <Link
                              key={item.path}
                              to={item.path}
                              onClick={onNavigate}
                              className={`flex items-center gap-2.5 px-2.5 py-2 rounded-button text-[13px] transition-colors ${
                                active
                                  ? 'nav-item-active'
                                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900 font-medium'
                              }`}
                            >
                              <Icon className="w-4 h-4 flex-shrink-0" />
                              <span className="flex-1 truncate">{item.label}</span>
                              {pill != null && pill > 0 && (
                                <span className={active ? 'nav-pill' : 'nav-pill nav-pill-accent'}>{pill}</span>
                              )}
                            </Link>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
