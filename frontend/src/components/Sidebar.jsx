import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronDown, ChevronLeft } from 'lucide-react';

const NAV_SCROLL_KEY = 'solidata_nav_scroll_top';
const OPEN_STORAGE_KEY = 'solidata_nav_open_v2';

function readJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}

// Construit un chemin canonique pour identifier un nœud groupe (ex: "operations/collecte/programmation")
function nodeKey(parents, node) {
  return [...parents, node.id || slug(node.label)].join('/');
}

function slug(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// True si une URL match au moins un descendant de "node"
function containsActivePath(node, pathname) {
  if (node.path) {
    if (node.path === '/') return pathname === '/';
    return pathname === node.path || pathname.startsWith(node.path + '/');
  }
  if (node.children) return node.children.some((c) => containsActivePath(c, pathname));
  return false;
}

// Remonte la liste des clés de groupes contenant l'URL active (pour auto-expand)
function activeKeysFor(tree, pathname) {
  const out = [];
  const walk = (node, parents) => {
    if (node.children) {
      const k = nodeKey(parents, node);
      if (containsActivePath(node, pathname)) {
        out.push(k);
        node.children.forEach((c) => walk(c, [...parents, node.id || slug(node.label)]));
      }
    }
  };
  tree.forEach((root) => walk(root, []));
  return out;
}

// Trouve le best-match path pour highlight (suffixe le plus long)
function findActivePath(tree, pathname) {
  const allPaths = [];
  const collect = (n) => { if (n.path) allPaths.push(n.path); if (n.children) n.children.forEach(collect); };
  tree.forEach(collect);
  let best = null;
  for (const p of allPaths) {
    if (p === '/') {
      if (pathname === '/') { if (!best || best.length < 1) best = p; }
      continue;
    }
    if (pathname === p || pathname.startsWith(p + '/')) {
      if (!best || p.length > best.length) best = p;
    }
  }
  return best;
}

export default function Sidebar({ tree, collapsed, onToggleCollapse, onNavigate, counts = {} }) {
  const location = useLocation();
  const navRef = useRef(null);

  // Restaurer scroll
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

  // Path actif (best match)
  const activePath = useMemo(() => findActivePath(tree, location.pathname), [tree, location.pathname]);

  // État ouvert/fermé par clé canonique
  const [openMap, setOpenMap] = useState(() => readJSON(OPEN_STORAGE_KEY, {}));
  useEffect(() => {
    try { localStorage.setItem(OPEN_STORAGE_KEY, JSON.stringify(openMap)); } catch { /* noop */ }
  }, [openMap]);

  // Auto-expand des ancêtres de la route active
  useEffect(() => {
    const keys = activeKeysFor(tree, location.pathname);
    if (keys.length === 0) return;
    setOpenMap((m) => {
      const next = { ...m };
      let changed = false;
      keys.forEach((k) => { if (!next[k]) { next[k] = true; changed = true; } });
      return changed ? next : m;
    });
  }, [tree, location.pathname]);

  const toggleNode = useCallback((key) => {
    if (collapsed) {
      onToggleCollapse();
      setOpenMap((m) => ({ ...m, [key]: true }));
      return;
    }
    setOpenMap((m) => ({ ...m, [key]: !m[key] }));
  }, [collapsed, onToggleCollapse]);

  return (
    <aside
      className="flex flex-col flex-shrink-0 bg-white border-r border-slate-200 shadow-sidebar h-full transition-[width] duration-200 sticky top-0 z-30"
      style={{ width: collapsed ? '4.25rem' : '16rem' }}
    >
      {/* Brand */}
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

      <nav ref={navRef} className="flex-1 overflow-y-auto overflow-x-hidden px-2 py-3">
        {tree.map((node) => (
          <NavNode
            key={node.id || slug(node.label)}
            node={node}
            depth={0}
            parents={[]}
            collapsed={collapsed}
            openMap={openMap}
            onToggle={toggleNode}
            activePath={activePath}
            counts={counts}
            onNavigate={onNavigate}
          />
        ))}
      </nav>
    </aside>
  );
}

// ───────────────────────────────────────────
// Composant récursif : groupe ou lien
// ───────────────────────────────────────────
function NavNode({ node, depth, parents, collapsed, openMap, onToggle, activePath, counts, onNavigate }) {
  const Icon = node.icon;
  const isGroup = !!node.children;
  const key = nodeKey(parents, node);
  const isOpen = !!openMap[key];

  if (isGroup) {
    const hasActive = node.children.some((c) => isNodeActive(c, activePath));
    return (
      <div className={depth === 0 ? 'mb-1' : ''}>
        <button
          onClick={() => onToggle(key)}
          className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-button text-left transition-colors ${
            depth === 0
              ? (hasActive ? 'nav-parent-active' : 'text-slate-700 hover:bg-slate-50 hover:text-slate-900')
              : (hasActive ? 'text-primary-dark font-semibold' : 'text-slate-600 hover:bg-slate-50')
          } ${collapsed && depth === 0 ? 'justify-center' : ''}`}
          title={collapsed ? node.label : undefined}
          aria-expanded={isOpen}
        >
          {Icon && (
            <Icon className={`flex-shrink-0 ${depth === 0 ? 'w-[18px] h-[18px]' : 'w-4 h-4'} ${hasActive ? 'text-primary-dark' : 'text-slate-500'}`} />
          )}
          {!collapsed && (
            <>
              <span className={`flex-1 truncate ${depth === 0 ? 'text-[13px] font-semibold tracking-tight' : 'text-[12.5px] font-medium'}`}>
                {node.label}
              </span>
              <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform ${isOpen ? '' : '-rotate-90'}`} />
            </>
          )}
        </button>

        {!collapsed && isOpen && (
          <div className={depth === 0 ? 'ml-3.5 mt-1 pl-2 border-l border-slate-100 space-y-0.5' : 'ml-3 mt-0.5 pl-2 border-l border-slate-100 space-y-0.5'}>
            {node.children.map((child) => (
              <NavNode
                key={(child.id || slug(child.label)) + '|' + (child.path || '')}
                node={child}
                depth={depth + 1}
                parents={[...parents, node.id || slug(node.label)]}
                collapsed={collapsed}
                openMap={openMap}
                onToggle={onToggle}
                activePath={activePath}
                counts={counts}
                onNavigate={onNavigate}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  // Lien terminal
  const active = node.path === activePath;
  const pill = counts[node.path];
  return (
    <Link
      to={node.path}
      onClick={onNavigate}
      className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-button text-[13px] transition-colors ${
        active ? 'nav-item-active' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900 font-medium'
      }`}
      title={collapsed ? node.label : undefined}
    >
      {Icon && <Icon className="w-4 h-4 flex-shrink-0" />}
      {!collapsed && (
        <>
          <span className="flex-1 truncate">{node.label}</span>
          {pill != null && pill > 0 && (
            <span className={active ? 'nav-pill' : 'nav-pill nav-pill-accent'}>{pill}</span>
          )}
        </>
      )}
    </Link>
  );
}

function isNodeActive(node, activePath) {
  if (!activePath) return false;
  if (node.path) return node.path === activePath;
  if (node.children) return node.children.some((c) => isNodeActive(c, activePath));
  return false;
}
