import { useState, useMemo } from 'react';
import { twMerge } from 'tailwind-merge';
import { Inbox, ChevronUp } from 'lucide-react';

/* ──────────────────────────────────────────────
   Skeleton rows (loading state)
   ────────────────────────────────────────────── */
function SkeletonRows({ columns, rows = 5, dense }) {
  const cellPad = dense ? 'px-4 py-2' : 'px-4 py-3';
  return Array.from({ length: rows }, (_, rowIdx) => (
    <tr key={rowIdx} className="border-b border-slate-100">
      {columns.map((col, colIdx) => (
        <td key={colIdx} className={cellPad}>
          <div
            className="h-4 bg-slate-200 rounded animate-pulse"
            style={{ width: col.width || '80%' }}
          />
        </td>
      ))}
    </tr>
  ));
}

/* ──────────────────────────────────────────────
   Empty state (intégré dans la table)
   ────────────────────────────────────────────── */
function TableEmptyState({ colSpan, icon: Icon, message, action }) {
  const EmptyIcon = Icon || Inbox;
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-16 text-center text-slate-400">
        <div className="flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center">
            <EmptyIcon className="w-6 h-6 text-slate-400" strokeWidth={1.5} />
          </div>
          <span className="text-sm">{message}</span>
          {action && (
            <button
              onClick={action.onClick}
              className="btn-primary text-sm mt-1"
            >
              {action.label}
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

/* ══════════════════════════════════════════════
   DataTable — composant de reference Lot 1
   ══════════════════════════════════════════════
   Props :
   - columns       : [{ key, label, sortable?, render?, width?, align? }]
   - data          : array of row objects
   - loading       : boolean
   - emptyMessage  : string (default: 'Aucune donnee a afficher')
   - emptyIcon     : Lucide icon component (default: Inbox)
   - emptyAction   : { label, onClick } — CTA dans l'etat vide
   - onRowClick    : (row) => void
   - selectedId    : id de la ligne selectionnee (highlight)
   - dense         : boolean — mode compact (py-2 au lieu de py-3)
   - pagination    : { page, pageSize, total, onPageChange }
   - className     : classes supplementaires sur le conteneur
   ══════════════════════════════════════════════ */
export default function DataTable({
  columns,
  data,
  loading,
  emptyMessage = 'Aucune donnee a afficher',
  emptyIcon,
  emptyAction,
  onRowClick,
  selectedId,
  dense = false,
  pagination,
  className,
}) {
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState('asc');

  const sortedData = useMemo(() => {
    if (!data || !sortKey) return data || [];
    const col = columns.find((c) => c.key === sortKey);
    if (!col) return data;

    return [...data].sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];
      if (aVal == null) return 1;
      if (bVal == null) return -1;
      const cmp =
        typeof aVal === 'number'
          ? aVal - bVal
          : String(aVal).localeCompare(String(bVal), 'fr');
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [data, sortKey, sortDir, columns]);

  const handleSort = (key, sortable) => {
    if (!sortable) return;
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const isEmpty = !loading && (!sortedData || sortedData.length === 0);

  // Padding adaptatif selon le mode dense
  const cellPad = dense ? 'px-4 py-2' : 'px-4 py-3';
  const headPad = dense ? 'px-4 py-2' : 'px-4 py-3';

  return (
    <div className={className}>
      {/* Table avec scroll horizontal */}
      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              {columns.map((col) => (
                <th
                  key={col.key}
                  onClick={() => handleSort(col.key, col.sortable)}
                  className={twMerge(
                    `text-left font-semibold text-slate-600 text-xs uppercase tracking-wider whitespace-nowrap`,
                    headPad,
                    col.align === 'right' && 'text-right',
                    col.align === 'center' && 'text-center',
                    col.sortable && 'cursor-pointer hover:text-teal-600 select-none'
                  )}
                  style={col.width ? { width: col.width } : undefined}
                >
                  <span className="inline-flex items-center gap-1">
                    {col.label}
                    {col.sortable && sortKey === col.key && (
                      <ChevronUp
                        className={`w-3 h-3 transition-transform ${sortDir === 'desc' ? 'rotate-180' : ''}`}
                        strokeWidth={2}
                      />
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <SkeletonRows columns={columns} dense={dense} />
            ) : isEmpty ? (
              <TableEmptyState
                colSpan={columns.length}
                icon={emptyIcon}
                message={emptyMessage}
                action={emptyAction}
              />
            ) : (
              sortedData.map((row, rowIdx) => {
                const isSelected = selectedId != null && row.id === selectedId;
                return (
                  <tr
                    key={row.id || rowIdx}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    className={twMerge(
                      'border-b border-slate-100 transition-colors',
                      rowIdx % 2 === 1 && 'bg-slate-50/50',
                      onRowClick
                        ? 'cursor-pointer hover:bg-teal-50/50'
                        : 'hover:bg-slate-50/50',
                      isSelected && 'bg-teal-50 border-l-4 border-l-teal-500'
                    )}
                  >
                    {columns.map((col) => (
                      <td
                        key={col.key}
                        className={twMerge(
                          cellPad,
                          col.align === 'right' && 'text-right',
                          col.align === 'center' && 'text-center'
                        )}
                      >
                        {col.render ? col.render(row) : row[col.key]}
                      </td>
                    ))}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pagination && pagination.total > 0 && (
        <div className="flex items-center justify-between mt-4 text-sm">
          <span className="text-slate-500">
            {pagination.total} resultat{pagination.total > 1 ? 's' : ''}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => pagination.onPageChange(pagination.page - 1)}
              disabled={pagination.page <= 1}
              className="px-3 py-1.5 rounded-button text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              Prec.
            </button>
            {(() => {
              const totalPages = Math.ceil(
                pagination.total / pagination.pageSize
              );
              const maxButtons = 5;
              let start = Math.max(
                1,
                pagination.page - Math.floor(maxButtons / 2)
              );
              let end = Math.min(totalPages, start + maxButtons - 1);
              if (end - start + 1 < maxButtons) {
                start = Math.max(1, end - maxButtons + 1);
              }
              return Array.from({ length: end - start + 1 }, (_, i) => {
                const pageNum = start + i;
                return (
                  <button
                    key={pageNum}
                    onClick={() => pagination.onPageChange(pageNum)}
                    className={twMerge(
                      'w-8 h-8 rounded-button text-sm font-medium transition',
                      pageNum === pagination.page
                        ? 'bg-teal-600 text-white'
                        : 'text-slate-600 hover:bg-slate-100'
                    )}
                  >
                    {pageNum}
                  </button>
                );
              });
            })()}
            <button
              onClick={() => pagination.onPageChange(pagination.page + 1)}
              disabled={
                pagination.page >=
                Math.ceil(pagination.total / pagination.pageSize)
              }
              className="px-3 py-1.5 rounded-button text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              Suiv.
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
