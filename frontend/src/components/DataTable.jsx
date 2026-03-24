import { useState, useMemo } from 'react';

function SkeletonRows({ columns, rows = 5 }) {
  return Array.from({ length: rows }, (_, rowIdx) => (
    <tr key={rowIdx} className="border-b border-slate-100">
      {columns.map((col, colIdx) => (
        <td key={colIdx} className="px-4 py-3">
          <div className="h-4 bg-slate-200 rounded animate-pulse" style={{ width: col.width || '80%' }} />
        </td>
      ))}
    </tr>
  ));
}

export default function DataTable({
  columns,
  data,
  loading,
  emptyMessage = 'Aucune donnee a afficher',
  onRowClick,
  pagination,
}) {
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState('asc');

  const sortedData = useMemo(() => {
    if (!data || !sortKey) return data || [];
    const col = columns.find(c => c.key === sortKey);
    if (!col) return data;

    return [...data].sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];
      if (aVal == null) return 1;
      if (bVal == null) return -1;
      const cmp = typeof aVal === 'number'
        ? aVal - bVal
        : String(aVal).localeCompare(String(bVal), 'fr');
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [data, sortKey, sortDir, columns]);

  const handleSort = (key, sortable) => {
    if (!sortable) return;
    if (sortKey === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const isEmpty = !loading && (!sortedData || sortedData.length === 0);

  return (
    <div>
      {/* Table with horizontal scroll */}
      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              {columns.map((col) => (
                <th
                  key={col.key}
                  onClick={() => handleSort(col.key, col.sortable)}
                  className={`text-left px-4 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wider whitespace-nowrap
                    ${col.sortable ? 'cursor-pointer hover:text-teal-600 select-none' : ''}
                  `}
                  style={col.width ? { width: col.width } : undefined}
                >
                  <span className="flex items-center gap-1">
                    {col.label}
                    {col.sortable && sortKey === col.key && (
                      <svg
                        className={`w-3 h-3 transition-transform ${sortDir === 'desc' ? 'rotate-180' : ''}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
                      </svg>
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <SkeletonRows columns={columns} />
            ) : isEmpty ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-16 text-center text-slate-400">
                  <div className="flex flex-col items-center gap-2">
                    <svg className="w-10 h-10 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                    </svg>
                    <span className="text-sm">{emptyMessage}</span>
                  </div>
                </td>
              </tr>
            ) : (
              sortedData.map((row, rowIdx) => (
                <tr
                  key={row.id || rowIdx}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={`border-b border-slate-100 transition-colors
                    ${rowIdx % 2 === 1 ? 'bg-slate-50/50' : ''}
                    ${onRowClick ? 'cursor-pointer hover:bg-teal-50/50' : 'hover:bg-slate-50/50'}
                  `}
                >
                  {columns.map((col) => (
                    <td key={col.key} className="px-4 py-3">
                      {col.render ? col.render(row) : row[col.key]}
                    </td>
                  ))}
                </tr>
              ))
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
              className="px-3 py-1.5 rounded-[10px] text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              Prec.
            </button>
            {(() => {
              const totalPages = Math.ceil(pagination.total / pagination.pageSize);
              const maxButtons = 5;
              let start = Math.max(1, pagination.page - Math.floor(maxButtons / 2));
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
                    className={`w-8 h-8 rounded-[10px] text-sm font-medium transition
                      ${pageNum === pagination.page
                        ? 'bg-teal-600 text-white'
                        : 'text-slate-600 hover:bg-slate-100'
                      }
                    `}
                  >
                    {pageNum}
                  </button>
                );
              });
            })()}
            <button
              onClick={() => pagination.onPageChange(pagination.page + 1)}
              disabled={pagination.page >= Math.ceil(pagination.total / pagination.pageSize)}
              className="px-3 py-1.5 rounded-[10px] text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              Suiv.
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
