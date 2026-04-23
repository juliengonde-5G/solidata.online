import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarRange } from 'lucide-react';
import Layout from '../components/Layout';
import { LoadingSpinner, PageHeader } from '../components';
import api from '../services/api';

const LIEUX = {
  quai_chargement: 'Quai de chargement',
  garage_remorque: 'Garage remorque',
  cours: 'Cours',
};

const TYPES_COULEURS = {
  original: '#f59e0b',
  csr: '#ef4444',
  effilo_blanc: '#3b82f6',
  effilo_couleur: '#8b5cf6',
  jean: '#6366f1',
  coton_blanc: '#14b8a6',
  coton_couleur: '#ec4899',
};

const TYPES_PRODUIT = {
  original: 'Original',
  csr: 'CSR',
  effilo_blanc: 'Effilo Blanc',
  effilo_couleur: 'Effilo Couleur',
  jean: 'Jean',
  coton_blanc: 'Coton Blanc',
  coton_couleur: 'Coton Couleur',
};

const STATUTS_LABELS = {
  planifiee: 'Planifiée',
  en_attente: 'En attente',
  confirmee: 'Confirmée',
  en_preparation: 'En préparation',
  chargee: 'Chargée',
  expediee: 'Expédiée',
  annulee: 'Annulée',
};

// ── Date helpers ──────────────────────────────────────────────────────────────

function startOfDay(d) {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function getMonday(d) {
  const r = new Date(d);
  const day = r.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  r.setDate(r.getDate() + diff);
  r.setHours(0, 0, 0, 0);
  return r;
}

function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function endOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
}

function formatDate(d) {
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatDateISO(d) {
  return d.toISOString().slice(0, 10);
}

function formatHour(h) {
  return `${h}h`;
}

function daysInRange(start, end) {
  const days = [];
  let cur = new Date(start);
  while (cur <= end) {
    days.push(new Date(cur));
    cur = addDays(cur, 1);
  }
  return days;
}

// ── View range computation ────────────────────────────────────────────────────

function computeViewRange(currentDate, viewMode) {
  if (viewMode === 'jour') {
    const s = new Date(currentDate);
    s.setHours(6, 0, 0, 0);
    const e = new Date(currentDate);
    e.setHours(20, 0, 0, 0);
    return { viewStart: s, viewEnd: e };
  }
  if (viewMode === 'semaine') {
    const monday = getMonday(currentDate);
    const sunday = addDays(monday, 6);
    sunday.setHours(23, 59, 59, 999);
    return { viewStart: monday, viewEnd: sunday };
  }
  // mois
  return { viewStart: startOfMonth(currentDate), viewEnd: endOfMonth(currentDate) };
}

// ── Bar position calculator ───────────────────────────────────────────────────

function getBarStyle(item, viewStart, viewEnd) {
  const start = new Date(item.date_debut);
  const end = new Date(item.date_fin);
  const totalMs = viewEnd - viewStart;
  if (totalMs <= 0) return { left: '0%', width: '1%' };
  const leftPct = Math.max(0, ((start - viewStart) / totalMs) * 100);
  const widthPct = Math.min(100 - leftPct, ((end - start) / totalMs) * 100);
  return {
    left: `${leftPct}%`,
    width: `${Math.max(widthPct, 1)}%`,
  };
}

// ── Overlap detection ─────────────────────────────────────────────────────────

function detectOverlaps(items) {
  const overlapping = new Set();
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];
      const aStart = new Date(a.date_debut);
      const aEnd = new Date(a.date_fin);
      const bStart = new Date(b.date_debut);
      const bEnd = new Date(b.date_fin);
      if (aStart < bEnd && bStart < aEnd) {
        overlapping.add(a.id);
        overlapping.add(b.id);
      }
    }
  }
  return overlapping;
}

// ── Period label ──────────────────────────────────────────────────────────────

function periodLabel(currentDate, viewMode) {
  if (viewMode === 'jour') {
    return currentDate.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }
  if (viewMode === 'semaine') {
    const mon = getMonday(currentDate);
    const sun = addDays(mon, 6);
    return `${formatDate(mon)} — ${formatDate(sun)}`;
  }
  return currentDate.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function ExutoiresGantt() {
  const [viewMode, setViewMode] = useState('semaine');
  const [currentDate, setCurrentDate] = useState(startOfDay(new Date()));
  const [ganttData, setGanttData] = useState({ quai_chargement: [], garage_remorque: [], cours: [] });
  const [selectedItem, setSelectedItem] = useState(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [loading, setLoading] = useState(true);
  const routerNavigate = useNavigate();

  const { viewStart, viewEnd } = computeViewRange(currentDate, viewMode);

  // ── Data loading ────────────────────────────────────────────────────────────

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/preparations/gantt', {
        params: { date_from: formatDateISO(viewStart), date_to: formatDateISO(viewEnd) },
      });
      const data = res.data;
      // Normalize: API may return flat array or grouped object
      if (Array.isArray(data)) {
        const grouped = { quai_chargement: [], garage_remorque: [], cours: [] };
        data.forEach((item) => {
          const lieu = item.lieu_chargement || 'quai_chargement';
          if (grouped[lieu]) grouped[lieu].push(item);
          else grouped.quai_chargement.push(item);
        });
        setGanttData(grouped);
      } else {
        setGanttData({
          quai_chargement: data.quai_chargement || [],
          garage_remorque: data.garage_remorque || [],
          cours: data.cours || [],
        });
      }
    } catch (err) {
      console.error('Erreur chargement gantt:', err);
      setGanttData({ quai_chargement: [], garage_remorque: [], cours: [] });
    } finally {
      setLoading(false);
    }
  }, [viewStart.getTime(), viewEnd.getTime()]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Close tooltip on outside click
  useEffect(() => {
    const handler = (e) => {
      if (selectedItem && !e.target.closest('.gantt-tooltip') && !e.target.closest('.gantt-bar')) {
        setSelectedItem(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [selectedItem]);

  // ── Navigation ──────────────────────────────────────────────────────────────

  function navigate(dir) {
    setCurrentDate((prev) => {
      if (viewMode === 'jour') return addDays(prev, dir);
      if (viewMode === 'semaine') return addDays(prev, dir * 7);
      const d = new Date(prev);
      d.setMonth(d.getMonth() + dir);
      return d;
    });
  }

  function goToday() {
    setCurrentDate(startOfDay(new Date()));
  }

  // ── Timeline columns ───────────────────────────────────────────────────────

  function renderTimelineHeader() {
    if (viewMode === 'jour') {
      const hours = [];
      for (let h = 6; h <= 20; h++) hours.push(h);
      return (
        <div className="flex border-b border-gray-200" style={{ minWidth: hours.length * 60 }}>
          {hours.map((h) => (
            <div
              key={h}
              className="flex-1 text-center text-xs text-gray-500 py-1 border-r border-gray-100"
              style={{ minWidth: 60 }}
            >
              {formatHour(h)}
            </div>
          ))}
        </div>
      );
    }

    if (viewMode === 'semaine') {
      const days = daysInRange(viewStart, viewEnd);
      return (
        <div className="flex border-b border-gray-200" style={{ minWidth: days.length * 120 }}>
          {days.map((d, i) => {
            const isToday = formatDateISO(d) === formatDateISO(new Date());
            return (
              <div
                key={i}
                className={`flex-1 text-center text-xs py-1 border-r border-gray-100 ${
                  isToday ? 'bg-blue-50 font-semibold text-blue-700' : 'text-gray-500'
                }`}
                style={{ minWidth: 120 }}
              >
                <div>{d.toLocaleDateString('fr-FR', { weekday: 'short' })}</div>
                <div>{d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}</div>
              </div>
            );
          })}
        </div>
      );
    }

    // mois
    const days = daysInRange(viewStart, viewEnd);
    return (
      <div className="flex border-b border-gray-200" style={{ minWidth: days.length * 32 }}>
        {days.map((d, i) => {
          const isToday = formatDateISO(d) === formatDateISO(new Date());
          const isWeekend = d.getDay() === 0 || d.getDay() === 6;
          return (
            <div
              key={i}
              className={`flex-1 text-center text-xs py-1 border-r border-gray-100 ${
                isToday ? 'bg-blue-50 font-semibold text-blue-700' : isWeekend ? 'bg-gray-50 text-gray-400' : 'text-gray-500'
              }`}
              style={{ minWidth: 32 }}
            >
              {d.getDate()}
            </div>
          );
        })}
      </div>
    );
  }

  function getGridMinWidth() {
    if (viewMode === 'jour') return 14 * 60;   // 14 hours * 60px
    if (viewMode === 'semaine') return 7 * 120; // 7 days * 120px
    const days = daysInRange(viewStart, viewEnd);
    return days.length * 32;
  }

  // ── Grid lines (vertical) ──────────────────────────────────────────────────

  function renderGridLines() {
    if (viewMode === 'jour') {
      const hours = [];
      for (let h = 6; h <= 20; h++) hours.push(h);
      return (
        <div className="absolute inset-0 flex pointer-events-none" style={{ minWidth: getGridMinWidth() }}>
          {hours.map((h) => (
            <div key={h} className="flex-1 border-r border-gray-100" style={{ minWidth: 60 }} />
          ))}
        </div>
      );
    }
    if (viewMode === 'semaine') {
      const days = daysInRange(viewStart, viewEnd);
      return (
        <div className="absolute inset-0 flex pointer-events-none" style={{ minWidth: getGridMinWidth() }}>
          {days.map((d, i) => {
            const isToday = formatDateISO(d) === formatDateISO(new Date());
            return (
              <div
                key={i}
                className={`flex-1 border-r border-gray-100 ${isToday ? 'bg-blue-50/30' : ''}`}
                style={{ minWidth: 120 }}
              />
            );
          })}
        </div>
      );
    }
    const days = daysInRange(viewStart, viewEnd);
    return (
      <div className="absolute inset-0 flex pointer-events-none" style={{ minWidth: getGridMinWidth() }}>
        {days.map((d, i) => {
          const isWeekend = d.getDay() === 0 || d.getDay() === 6;
          const isToday = formatDateISO(d) === formatDateISO(new Date());
          return (
            <div
              key={i}
              className={`flex-1 border-r border-gray-100 ${isToday ? 'bg-blue-50/30' : isWeekend ? 'bg-gray-50/50' : ''}`}
              style={{ minWidth: 32 }}
            />
          );
        })}
      </div>
    );
  }

  // ── Now indicator ───────────────────────────────────────────────────────────

  function renderNowLine() {
    const now = new Date();
    if (now < viewStart || now > viewEnd) return null;
    const pct = ((now - viewStart) / (viewEnd - viewStart)) * 100;
    return (
      <div
        className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-10 pointer-events-none"
        style={{ left: `${pct}%` }}
      >
        <div className="w-2 h-2 bg-red-500 rounded-full -ml-[3px] -mt-1" />
      </div>
    );
  }

  // ── Bar click handler ───────────────────────────────────────────────────────

  function handleBarClick(e, item) {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    setTooltipPos({ x: rect.left + rect.width / 2, y: rect.top });
    setSelectedItem(item);
  }

  // ── Render lane ─────────────────────────────────────────────────────────────

  function renderLane(lieuKey) {
    const items = ganttData[lieuKey] || [];
    const overlaps = detectOverlaps(items);

    return (
      <div className="relative" style={{ height: 64, minWidth: getGridMinWidth() }}>
        {renderGridLines()}
        {renderNowLine()}
        {items.map((item) => {
          const style = getBarStyle(item, viewStart, viewEnd);
          const color = TYPES_COULEURS[item.type_produit] || '#9ca3af';
          const isOverlap = overlaps.has(item.id);
          const isPlanifiee = item.statut === 'planifiee';
          const label = `${item.commande_reference || ''} ${item.client_nom || ''}`.trim();

          return (
            <div
              key={item.id}
              className="gantt-bar absolute top-2 cursor-pointer rounded shadow-sm transition-transform hover:scale-[1.02] hover:shadow-md"
              style={{
                left: style.left,
                width: style.width,
                height: 28,
                backgroundColor: color,
                opacity: isPlanifiee ? 0.6 : 1,
                border: isOverlap ? '2px solid #ef4444' : '1px solid rgba(0,0,0,0.1)',
                zIndex: 5,
              }}
              title={label}
              onClick={(e) => handleBarClick(e, item)}
            >
              <div className="px-1.5 py-0.5 text-white text-xs font-medium truncate leading-tight" style={{ lineHeight: '24px' }}>
                {label || '—'}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // ── Tooltip / detail card ───────────────────────────────────────────────────

  function renderTooltip() {
    if (!selectedItem) return null;
    const item = selectedItem;
    const color = TYPES_COULEURS[item.type_produit] || '#9ca3af';

    return (
      <div
        className="gantt-tooltip fixed z-50 bg-white rounded-lg shadow-xl border border-gray-200 p-4 w-80"
        style={{
          left: Math.min(tooltipPos.x - 160, window.innerWidth - 340),
          top: Math.max(tooltipPos.y - 220, 10),
        }}
      >
        <div className="flex items-center gap-2 mb-3">
          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
          <h4 className="font-semibold text-gray-900 text-sm">{item.commande_reference || '—'}</h4>
          <button
            onClick={() => setSelectedItem(null)}
            className="ml-auto text-gray-400 hover:text-gray-600"
          >
            &times;
          </button>
        </div>

        <div className="space-y-1.5 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-500">Client</span>
            <span className="font-medium text-gray-800">{item.client_nom || '—'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Type produit</span>
            <span className="font-medium text-gray-800">{TYPES_PRODUIT[item.type_produit] || item.type_produit || '—'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Transporteur</span>
            <span className="font-medium text-gray-800">{item.transporteur || '—'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Statut</span>
            <span className="font-medium text-gray-800">{STATUTS_LABELS[item.statut] || item.statut || '—'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Début</span>
            <span className="font-medium text-gray-800">
              {item.date_debut ? new Date(item.date_debut).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Fin</span>
            <span className="font-medium text-gray-800">
              {item.date_fin ? new Date(item.date_fin).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Lieu</span>
            <span className="font-medium text-gray-800">{LIEUX[item.lieu_chargement] || item.lieu_chargement || '—'}</span>
          </div>
        </div>

        {item.id && (
          <div className="mt-3 pt-3 border-t border-gray-100">
            <button
              onClick={() => { setSelectedItem(null); routerNavigate('/exutoires-preparation'); }}
              className="inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800 font-medium"
            >
              Voir la préparation &rarr;
            </button>
          </div>
        )}
      </div>
    );
  }

  // ── Legend ───────────────────────────────────────────────────────────────────

  function renderLegend() {
    return (
      <div className="flex flex-wrap items-center gap-4 mt-4 px-1">
        {Object.entries(TYPES_PRODUIT).map(([key, label]) => (
          <div key={key} className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded" style={{ backgroundColor: TYPES_COULEURS[key] }} />
            <span className="text-xs text-gray-600">{label}</span>
          </div>
        ))}
        <div className="flex items-center gap-1.5 ml-4">
          <div className="w-3 h-3 rounded border-2 border-red-500 bg-gray-200" />
          <span className="text-xs text-gray-600">Conflit (chevauchement)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-gray-400 opacity-60" />
          <span className="text-xs text-gray-600">Planifiée</span>
        </div>
      </div>
    );
  }

  // ── Main render ─────────────────────────────────────────────────────────────

  const viewModes = [
    { key: 'jour', label: 'Jour' },
    { key: 'semaine', label: 'Semaine' },
    { key: 'mois', label: 'Mois' },
  ];

  const totalItems = Object.values(ganttData).reduce((s, arr) => s + arr.length, 0);

  return (
    <Layout>
      <div className="p-6 max-w-full">
        {/* Header */}
        <PageHeader
          title="Planning Gantt — Lieux de chargement"
          icon={CalendarRange}
        />

        {/* Controls bar */}
        <div className="flex flex-wrap items-center gap-4 mb-6 card-modern p-3">
          {/* View mode buttons */}
          <div className="flex rounded-lg border border-gray-300 overflow-hidden">
            {viewModes.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setViewMode(key)}
                className={`px-4 py-1.5 text-sm font-medium transition-colors ${
                  viewMode === key
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Navigation */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate(-1)}
              className="px-3 py-1.5 text-sm bg-white border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-600"
            >
              &lt; Pr&eacute;c&eacute;dent
            </button>
            <span className="text-sm font-medium text-gray-700 min-w-[200px] text-center">
              {periodLabel(currentDate, viewMode)}
            </span>
            <button
              onClick={() => navigate(1)}
              className="px-3 py-1.5 text-sm bg-white border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-600"
            >
              Suivant &gt;
            </button>
          </div>

          {/* Today button */}
          <button
            onClick={goToday}
            className="px-3 py-1.5 text-sm bg-blue-50 text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-100 font-medium"
          >
            Aujourd&apos;hui
          </button>

          {/* Counter */}
          <span className="ml-auto text-sm text-gray-500">
            {loading ? 'Chargement du Gantt...' : `${totalItems} pr\u00e9paration${totalItems > 1 ? 's' : ''}`}
          </span>
        </div>

        {/* Gantt Chart */}
        <div className="card-modern overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
            </div>
          ) : (
            <div className="flex">
              {/* Left sidebar: lane labels */}
              <div className="flex-shrink-0 border-r border-gray-200" style={{ width: 200 }}>
                {/* Spacer for timeline header */}
                <div className="h-10 border-b border-gray-200 bg-gray-50" />
                {Object.entries(LIEUX).map(([key, label]) => (
                  <div
                    key={key}
                    className="flex items-center px-3 text-sm font-medium text-gray-700 border-b border-gray-100 bg-gray-50/50"
                    style={{ height: 64 }}
                  >
                    {label}
                  </div>
                ))}
              </div>

              {/* Right: scrollable timeline */}
              <div className="flex-1 overflow-x-auto">
                {/* Timeline header */}
                <div className="h-10 bg-gray-50 border-b border-gray-200" style={{ minWidth: getGridMinWidth() }}>
                  {renderTimelineHeader()}
                </div>

                {/* Lanes */}
                {Object.keys(LIEUX).map((lieuKey) => (
                  <div key={lieuKey} className="border-b border-gray-100">
                    {renderLane(lieuKey)}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Legend */}
        {renderLegend()}

        {/* Empty state */}
        {!loading && totalItems === 0 && (
          <div className="text-center py-8 text-gray-500 text-sm">
            Aucune pr&eacute;paration sur cette p&eacute;riode.
          </div>
        )}
      </div>

      {/* Detail tooltip */}
      {renderTooltip()}
    </Layout>
  );
}
