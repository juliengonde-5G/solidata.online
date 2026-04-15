import { useState, useMemo } from 'react';
import { Search, Plus, MoreHorizontal, LayoutGrid, List, ArrowUp, ArrowDown, Minus } from 'lucide-react';

/**
 * KanbanBoard — Layout partagé pour pages kanban (Candidats, Commandes…).
 *
 * Inspiré du visuel ticket board moderne : sidebar gauche (vues + catégories
 * + priorité), barre de KPI en haut (avec delta), barre de recherche,
 * et grille de colonnes kanban avec compteurs et actions par colonne.
 *
 * Props
 * -----
 *  - title, subtitle            : titre principal de la page
 *  - headerActions              : JSX aligné à droite (boutons export/nouveau…)
 *  - kpis                       : tableau de { label, value, unit?, delta?: { direction, value, text }, accent }
 *  - sidebar                    : { views: Section, categories?: Section, priorities?: Section }
 *                                   Section = { title, items: [{ key, label, count?, icon? }], active, onSelect }
 *  - search                     : { value, onChange, placeholder }
 *  - columns                    : tableau de { key, label, count, accent, onAdd? }
 *  - itemsByColumn              : { [columnKey]: Item[] } (items arbitraires)
 *  - renderCard                 : (item, column) => JSX
 *  - onCardClick                : (item, columnKey) => void
 *  - dnd                        : { onDragStart, onDragEnd, onDragOverCol, onDragLeaveCol, onDropCol, draggedId, dragOverColumn }
 *  - emptyState                 : JSX rendu sous le board quand aucun item
 *  - extraTopBar                : JSX entre KPIs et colonnes (ex : zone de dépôt CV)
 */
export default function KanbanBoard({
  title,
  subtitle,
  headerActions,
  kpis = [],
  sidebar,
  search,
  columns = [],
  itemsByColumn = {},
  renderCard,
  onCardClick,
  dnd,
  emptyState,
  extraTopBar,
}) {
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const totalItems = useMemo(
    () => columns.reduce((acc, c) => acc + (itemsByColumn[c.key]?.length || 0), 0),
    [columns, itemsByColumn]
  );

  return (
    <div className="flex h-full min-h-[calc(100vh-4rem)] bg-slate-50/60">
      {/* ── Sidebar gauche ─────────────────────────────────────── */}
      {sidebar && sidebarOpen && (
        <aside className="w-60 flex-shrink-0 border-r border-slate-200 bg-white/80 backdrop-blur-sm px-4 py-5 overflow-y-auto hidden lg:block">
          {sidebar.views && <SidebarSection section={sidebar.views} />}
          {sidebar.categories && <SidebarSection section={sidebar.categories} />}
          {sidebar.priorities && <SidebarSection section={sidebar.priorities} />}
        </aside>
      )}

      {/* ── Contenu principal ──────────────────────────────────── */}
      <div className="flex-1 min-w-0 overflow-hidden flex flex-col">
        <div className="px-4 lg:px-6 pt-5 pb-3">
          {/* En-tête */}
          <div className="flex items-start justify-between gap-3 mb-5">
            <div className="flex items-center gap-3 min-w-0">
              {sidebar && (
                <button
                  type="button"
                  onClick={() => setSidebarOpen((v) => !v)}
                  className="lg:hidden p-2 -ml-2 rounded-lg hover:bg-slate-100"
                  aria-label="Afficher le menu"
                >
                  <LayoutGrid className="w-5 h-5 text-slate-500" />
                </button>
              )}
              <div className="min-w-0">
                <h1 className="text-2xl font-bold text-slate-900 tracking-tight truncate">{title}</h1>
                {subtitle && <p className="text-sm text-slate-500 mt-0.5 truncate">{subtitle}</p>}
              </div>
            </div>
            {headerActions && <div className="flex items-center gap-2 flex-shrink-0">{headerActions}</div>}
          </div>

          {/* Barre KPI */}
          {kpis.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              {kpis.map((kpi, i) => (
                <KpiTile key={kpi.key || i} {...kpi} />
              ))}
            </div>
          )}

          {/* Extra zone (ex : dropzone CV) */}
          {extraTopBar && <div className="mb-4">{extraTopBar}</div>}

          {/* Recherche + actions secondaires */}
          {search && (
            <div className="flex items-center justify-between gap-3 mb-4">
              <div className="relative flex-1 max-w-xl">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="search"
                  value={search.value}
                  onChange={(e) => search.onChange(e.target.value)}
                  placeholder={search.placeholder || 'Rechercher…'}
                  className="w-full pl-9 pr-3 py-2 bg-white border border-slate-200 rounded-lg text-sm placeholder:text-slate-400 focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 transition"
                />
              </div>
              <span className="text-xs text-slate-500 whitespace-nowrap">
                {totalItems} {totalItems > 1 ? 'éléments' : 'élément'}
              </span>
            </div>
          )}
        </div>

        {/* ── Grille kanban ────────────────────────────────────── */}
        <div className="flex-1 min-h-0 px-4 lg:px-6 pb-6 overflow-x-auto">
          <div className="flex gap-4 h-full min-w-max">
            {columns.map((col) => {
              const items = itemsByColumn[col.key] || [];
              const isDragOver = dnd?.dragOverColumn === col.key;
              return (
                <div
                  key={col.key}
                  className={`flex-shrink-0 w-[280px] lg:w-[300px] h-full flex flex-col rounded-xl transition-all ${
                    isDragOver ? 'bg-primary/5 ring-2 ring-primary/40' : 'bg-slate-100/50'
                  }`}
                  onDragOver={dnd ? (e) => dnd.onDragOverCol(e, col.key) : undefined}
                  onDragLeave={dnd ? (e) => dnd.onDragLeaveCol(e, col.key) : undefined}
                  onDrop={dnd ? (e) => dnd.onDropCol(e, col.key) : undefined}
                >
                  {/* Header colonne */}
                  <div className="flex items-center justify-between px-3 py-3 flex-shrink-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`w-1.5 h-1.5 rounded-full ${col.accent || 'bg-slate-400'}`} />
                      <h3 className="text-sm font-semibold text-slate-700 truncate">{col.label}</h3>
                      <span className="text-xs font-medium text-slate-400 bg-white px-1.5 py-0.5 rounded">
                        {items.length}
                      </span>
                    </div>
                    <div className="flex items-center gap-0.5 flex-shrink-0">
                      {col.onAdd && (
                        <button
                          type="button"
                          onClick={col.onAdd}
                          className="p-1 rounded hover:bg-white/80 text-slate-400 hover:text-primary transition"
                          aria-label={`Ajouter dans ${col.label}`}
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                      )}
                      {col.onMenu && (
                        <button
                          type="button"
                          onClick={col.onMenu}
                          className="p-1 rounded hover:bg-white/80 text-slate-400"
                          aria-label={`Options de ${col.label}`}
                        >
                          <MoreHorizontal className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Cards */}
                  <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-3 space-y-2">
                    {items.length === 0 ? (
                      <div className="text-center py-10 text-xs text-slate-400 select-none">
                        Aucun élément
                      </div>
                    ) : (
                      items.map((item) => {
                        const id = item.id ?? item.key;
                        const isDragged = dnd?.draggedId === id;
                        return (
                          <div
                            key={id}
                            draggable={!!dnd}
                            onDragStart={dnd ? (e) => dnd.onDragStart(e, id) : undefined}
                            onDragEnd={dnd ? dnd.onDragEnd : undefined}
                            onClick={() => onCardClick && onCardClick(item, col.key)}
                            className={`bg-white rounded-lg border border-slate-200 p-3 shadow-sm hover:shadow-md hover:border-slate-300 cursor-pointer transition-all ${
                              isDragged ? 'opacity-40 scale-[0.98]' : ''
                            } ${dnd ? 'active:cursor-grabbing' : ''}`}
                          >
                            {renderCard ? renderCard(item, col) : <DefaultCard item={item} />}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {totalItems === 0 && emptyState && <div className="mt-6">{emptyState}</div>}
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────
// Sous-composants
// ────────────────────────────────────────────────────────────────

function SidebarSection({ section }) {
  if (!section || !section.items?.length) return null;
  return (
    <div className="mb-6">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mb-2 px-2">
        {section.title}
      </h3>
      <ul className="space-y-0.5">
        {section.items.map((item) => {
          const active = section.active === item.key;
          const Icon = item.icon;
          return (
            <li key={item.key}>
              <button
                type="button"
                onClick={() => section.onSelect && section.onSelect(item.key)}
                className={`w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-sm transition ${
                  active
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                <span className="flex items-center gap-2 min-w-0">
                  {Icon && <Icon className={`w-4 h-4 flex-shrink-0 ${active ? 'text-white' : 'text-slate-400'}`} />}
                  <span className="truncate">{item.label}</span>
                </span>
                {item.count != null && (
                  <span className={`text-xs font-medium flex-shrink-0 ${active ? 'text-white/80' : 'text-slate-400'}`}>
                    {item.count}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function KpiTile({ label, value, unit, delta, accent = 'slate' }) {
  const accentMap = {
    slate: 'text-slate-900',
    blue: 'text-blue-700',
    green: 'text-emerald-700',
    amber: 'text-amber-700',
    red: 'text-red-700',
    purple: 'text-purple-700',
    orange: 'text-orange-700',
  };
  const valueColor = accentMap[accent] || accentMap.slate;
  return (
    <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 shadow-sm">
      <p className="text-[11px] uppercase tracking-wider font-semibold text-slate-400">{label}</p>
      <div className="flex items-baseline gap-1.5 mt-1">
        <span className={`text-2xl font-bold tracking-tight ${valueColor}`}>{value}</span>
        {unit && <span className="text-xs font-medium text-slate-400">{unit}</span>}
      </div>
      {delta && <DeltaPill delta={delta} />}
    </div>
  );
}

function DeltaPill({ delta }) {
  const dir = delta.direction || 'flat';
  const color = dir === 'up' ? 'text-emerald-600' : dir === 'down' ? 'text-red-600' : 'text-slate-400';
  const Icon = dir === 'up' ? ArrowUp : dir === 'down' ? ArrowDown : Minus;
  return (
    <div className={`flex items-center gap-1 mt-1 text-[11px] font-medium ${color}`}>
      <Icon className="w-3 h-3" />
      <span>{delta.value}</span>
      {delta.text && <span className="text-slate-400 font-normal">{delta.text}</span>}
    </div>
  );
}

function DefaultCard({ item }) {
  return (
    <div>
      <p className="font-medium text-sm text-slate-800 truncate">{item.title || item.label || item.name}</p>
      {item.subtitle && <p className="text-xs text-slate-500 mt-0.5 truncate">{item.subtitle}</p>}
    </div>
  );
}
