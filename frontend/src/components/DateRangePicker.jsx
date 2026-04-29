import { useEffect, useMemo, useRef, useState } from 'react';
import { Calendar, ChevronDown } from 'lucide-react';

/**
 * Sélecteur de date pratique avec :
 *   - presets rapides (Aujourd'hui, Hier, 7j, 30j, Mois en cours, Mois dernier, Année)
 *   - mode "Date unique" ou "Plage" via toggle
 *   - inputs date natifs alignés
 *
 * Usage :
 *   <DateRangePicker
 *     mode="range"                      // "single" | "range"
 *     value={{ from, to }}              // ISO YYYY-MM-DD
 *     onChange={(range) => ...}
 *     allowSingleToggle                 // affiche le toggle date unique / plage
 *     align="left"                      // "left" | "right" — alignement du popover
 *   />
 */

function isoDay(d) {
  const x = new Date(d);
  x.setHours(12, 0, 0, 0); // anti-décalage TZ
  return x.toISOString().slice(0, 10);
}

function today() { return isoDay(new Date()); }
function offsetDays(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return isoDay(d);
}
function startOfMonth(year, month) { return isoDay(new Date(year, month, 1)); }
function endOfMonth(year, month) { return isoDay(new Date(year, month + 1, 0)); }

function presetsForRange() {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  return [
    { key: 'today',     label: "Aujourd'hui", from: today(),         to: today() },
    { key: 'yesterday', label: 'Hier',        from: offsetDays(-1),  to: offsetDays(-1) },
    { key: '7d',        label: '7 derniers jours',  from: offsetDays(-6), to: today() },
    { key: '30d',       label: '30 derniers jours', from: offsetDays(-29), to: today() },
    { key: 'thisMonth', label: 'Mois en cours',    from: startOfMonth(y, m), to: today() },
    { key: 'lastMonth', label: 'Mois dernier',     from: startOfMonth(y, m - 1), to: endOfMonth(y, m - 1) },
    { key: 'thisYear',  label: 'Année en cours',   from: isoDay(new Date(y, 0, 1)), to: today() },
  ];
}

function presetsForSingle() {
  return [
    { key: 'today',     label: "Aujourd'hui", from: today(),        to: today() },
    { key: 'yesterday', label: 'Hier',        from: offsetDays(-1), to: offsetDays(-1) },
    { key: 'd-2',       label: 'Avant-hier',  from: offsetDays(-2), to: offsetDays(-2) },
    { key: 'd-7',       label: 'Il y a 1 semaine', from: offsetDays(-7), to: offsetDays(-7) },
  ];
}

function formatLabel({ from, to }, mode) {
  if (!from) return 'Sélectionner…';
  const fmt = (iso) => {
    const [y, m, d] = iso.split('-');
    return `${d}/${m}/${y}`;
  };
  if (mode === 'single' || from === to) return fmt(from);
  return `${fmt(from)} → ${fmt(to)}`;
}

export default function DateRangePicker({
  mode: initialMode = 'range',
  value,
  onChange,
  allowSingleToggle = false,
  align = 'left',
  className = '',
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState(initialMode);
  const [draft, setDraft] = useState(value || { from: today(), to: today() });
  const ref = useRef(null);

  useEffect(() => { if (value) setDraft(value); }, [value?.from, value?.to]);

  useEffect(() => {
    if (!open) return;
    const onClickAway = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onEsc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClickAway);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onClickAway);
      document.removeEventListener('keydown', onEsc);
    };
  }, [open]);

  const presets = useMemo(() => mode === 'single' ? presetsForSingle() : presetsForRange(), [mode]);

  const apply = (next) => {
    setDraft(next);
    if (onChange) onChange(next);
  };

  const handleFrom = (v) => {
    const next = mode === 'single' ? { from: v, to: v } : { from: v, to: draft.to && draft.to >= v ? draft.to : v };
    apply(next);
  };
  const handleTo = (v) => {
    const next = { from: draft.from && draft.from <= v ? draft.from : v, to: v };
    apply(next);
  };

  return (
    <div ref={ref} className={`relative inline-block ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-2 border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white hover:border-slate-400 transition"
      >
        <Calendar className="w-4 h-4 text-slate-500" />
        <span className="text-slate-700">{formatLabel(draft, mode)}</span>
        <ChevronDown className="w-4 h-4 text-slate-400" />
      </button>

      {open && (
        <div
          className={`absolute z-50 mt-1 ${align === 'right' ? 'right-0' : 'left-0'} w-[320px] bg-white border border-slate-200 rounded-xl shadow-lg p-3`}
        >
          {allowSingleToggle && (
            <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-0.5 mb-3 text-xs">
              <button
                onClick={() => { setMode('single'); apply({ from: draft.from, to: draft.from }); }}
                className={`flex-1 px-2 py-1.5 rounded-md transition ${mode === 'single' ? 'bg-white shadow text-slate-800 font-medium' : 'text-slate-500 hover:text-slate-700'}`}
              >
                Date unique
              </button>
              <button
                onClick={() => setMode('range')}
                className={`flex-1 px-2 py-1.5 rounded-md transition ${mode === 'range' ? 'bg-white shadow text-slate-800 font-medium' : 'text-slate-500 hover:text-slate-700'}`}
              >
                Plage
              </button>
            </div>
          )}

          <div className="space-y-2 mb-3">
            <div>
              <label className="block text-[10px] uppercase tracking-wide font-medium text-slate-500 mb-1">
                {mode === 'single' ? 'Date' : 'Du'}
              </label>
              <input
                type="date"
                value={draft.from || ''}
                onChange={(e) => handleFrom(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-primary"
              />
            </div>
            {mode === 'range' && (
              <div>
                <label className="block text-[10px] uppercase tracking-wide font-medium text-slate-500 mb-1">Au</label>
                <input
                  type="date"
                  value={draft.to || ''}
                  onChange={(e) => handleTo(e.target.value)}
                  min={draft.from || undefined}
                  className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-primary"
                />
              </div>
            )}
          </div>

          <div className="border-t border-slate-100 pt-2 grid grid-cols-2 gap-1">
            {presets.map((p) => {
              const active = draft.from === p.from && draft.to === p.to;
              return (
                <button
                  key={p.key}
                  onClick={() => apply({ from: p.from, to: p.to })}
                  className={`text-left px-2 py-1.5 rounded-md text-xs transition ${active ? 'bg-primary/10 text-primary font-medium' : 'text-slate-600 hover:bg-slate-50'}`}
                >
                  {p.label}
                </button>
              );
            })}
          </div>

          <div className="flex justify-end mt-2 pt-2 border-t border-slate-100">
            <button
              onClick={() => setOpen(false)}
              className="text-xs text-slate-500 hover:text-slate-700 px-2 py-1"
            >
              Fermer
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
