import { useMemo, useState } from 'react';

/**
 * Toile d'araignée des freins (radar SVG) — 9 axes (8 pour un MANAGER : le
 * backend retire l'axe Judiciaire, le composant s'adapte au nombre d'axes reçu).
 *
 * Données : { axes: [labels], series: [{ label, date?, data: [valeur 1-5 ou null] }] }
 * (contrat GET /insertion/milestones/:employeeId/radar).
 *
 * « Null honnête » : un frein NON ÉVALUÉ n'est pas tracé (pas de point, trait
 * interrompu) — jamais ramené à 1.
 *
 * REC-UX-11 : 3 séries affichées par défaut (diagnostic initial + 2 dernières),
 * sélecteur pour le reste, tableau des deltas en regard (la vue de travail).
 */

const RADAR_COLORS = ['#8B5CF6', '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#EC4899', '#0EA5E9', '#84CC16'];

// Indices de séries affichées par défaut : la première (diagnostic initial
// s'il existe) + les 2 dernières — 3 maximum.
function defaultVisible(series) {
  const n = series.length;
  if (n <= 3) return series.map((_, i) => i);
  const set = new Set([0, n - 2, n - 1]);
  return [...set].sort((a, b) => a - b);
}

function Delta({ prev, cur }) {
  if (cur == null || prev == null) return <span className="text-gray-300">—</span>;
  if (cur < prev) return <span className="text-green-600 font-semibold" title="Amélioration">↘ {prev - cur}</span>;
  if (cur > prev) return <span className="text-red-600 font-semibold" title="Aggravation">↗ +{cur - prev}</span>;
  return <span className="text-gray-400" title="Stable">=</span>;
}

export default function RadarFreins({ data, showDeltas = true, showSelector = true, size = 300 }) {
  const series = data?.series || [];
  const axes = data?.axes || [];
  const [visible, setVisible] = useState(() => defaultVisible(series));
  // Resynchronise la sélection si les données changent (autre salarié).
  const seriesKey = series.map((s) => s.label + (s.date || '')).join('|');
  const [lastKey, setLastKey] = useState(seriesKey);
  if (seriesKey !== lastKey) { setLastKey(seriesKey); setVisible(defaultVisible(series)); }

  const shown = useMemo(() => visible.filter((i) => i < series.length), [visible, series.length]);

  if (!axes.length || series.length === 0) {
    return (
      <div className="text-center text-sm text-gray-400 py-6">
        Pas encore d'évaluation de freins. La toile d'araignée se construira au fil
        du diagnostic d'accueil et des bilans.
      </div>
    );
  }

  const cx = size / 2, cy = size / 2, r = size * 0.36;
  const n = axes.length;
  const angleStep = (2 * Math.PI) / n;
  const getPoint = (index, value) => {
    const angle = angleStep * index - Math.PI / 2;
    const dist = (value / 5) * r;
    return { x: cx + dist * Math.cos(angle), y: cy + dist * Math.sin(angle) };
  };

  // Trace une série en RESPECTANT les null : segments uniquement entre deux
  // points évalués consécutifs (trait interrompu sur un « non évalué »).
  const seriesSegments = (dataArr) => {
    const segs = [];
    for (let i = 0; i < n; i++) {
      const a = dataArr[i], b = dataArr[(i + 1) % n];
      if (a != null && b != null) {
        const p1 = getPoint(i, a);
        const p2 = getPoint((i + 1) % n, b);
        segs.push([p1, p2]);
      }
    }
    return segs;
  };

  const toggle = (i) => setVisible((v) => (v.includes(i) ? v.filter((x) => x !== i) : [...v, i].sort((a, b) => a - b)));

  const last = series[series.length - 1];
  const prev = series.length > 1 ? series[series.length - 2] : null;

  return (
    <div className="flex flex-col lg:flex-row gap-4 items-start">
      <div className="flex flex-col items-center">
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Toile d'araignée des freins">
          {[1, 2, 3, 4, 5].map((level) => (
            <polygon key={level}
              points={axes.map((_, i) => { const p = getPoint(i, level); return `${p.x},${p.y}`; }).join(' ')}
              fill="none" stroke="#e5e7eb" strokeWidth={level === 5 ? 1.5 : 0.5} />
          ))}
          {axes.map((_, i) => {
            const p = getPoint(i, 5);
            return <line key={`ax-${i}`} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke="#e5e7eb" strokeWidth="0.5" />;
          })}
          {axes.map((label, i) => {
            const p = getPoint(i, 5.9);
            return (
              <text key={`lb-${i}`} x={p.x} y={p.y} textAnchor="middle" dominantBaseline="middle" fontSize="10" fill="#6b7280">
                {label}
              </text>
            );
          })}
          {shown.map((si) => {
            const s = series[si];
            const color = RADAR_COLORS[si % RADAR_COLORS.length];
            const isLast = si === series.length - 1;
            return (
              <g key={`s-${si}`}>
                {seriesSegments(s.data).map(([p1, p2], k) => (
                  <line key={k} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}
                    stroke={color} strokeWidth="2" strokeDasharray={isLast || shown.length === 1 ? undefined : '4 3'} />
                ))}
                {s.data.map((v, i) => {
                  if (v == null) return null;
                  const p = getPoint(i, v);
                  return <circle key={`p-${i}`} cx={p.x} cy={p.y} r="3" fill={color} />;
                })}
              </g>
            );
          })}
        </svg>
        <p className="text-[11px] text-gray-400 -mt-1">Toile d'araignée — 1 = pas de difficulté, 5 = bloquant. Un frein non évalué n'est pas tracé.</p>
        {showSelector && (
          <div className="flex flex-wrap gap-1.5 mt-2 justify-center">
            {series.map((s, i) => {
              const on = shown.includes(i);
              const color = RADAR_COLORS[i % RADAR_COLORS.length];
              return (
                <button key={i} type="button" onClick={() => toggle(i)}
                  className={`text-[11px] px-2 py-0.5 rounded-full border transition ${on ? 'text-white' : 'bg-white text-gray-500 border-gray-300 hover:border-gray-400'}`}
                  style={on ? { backgroundColor: color, borderColor: color } : undefined}
                  title={s.date ? `Évalué le ${new Date(s.date).toLocaleDateString('fr-FR')}` : undefined}>
                  {s.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {showDeltas && last && (
        <div className="flex-1 min-w-[220px] w-full">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-gray-500 border-b">
                <th className="py-1 pr-2 font-medium">Frein</th>
                <th className="py-1 pr-2 font-medium">Niveau actuel</th>
                <th className="py-1 font-medium">Évolution</th>
              </tr>
            </thead>
            <tbody>
              {axes.map((label, i) => {
                const cur = last.data[i];
                const before = prev ? prev.data[i] : null;
                return (
                  <tr key={label} className="border-b border-gray-100">
                    <td className="py-1 pr-2 text-gray-700">{label}</td>
                    <td className="py-1 pr-2">
                      {cur == null ? <span className="text-gray-400 italic">non évalué</span> : (
                        <span className={`px-1.5 py-0.5 rounded font-medium ${cur <= 2 ? 'bg-green-100 text-green-700' : cur === 3 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}`}>{cur}/5</span>
                      )}
                    </td>
                    <td className="py-1"><Delta prev={before} cur={cur} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="text-[11px] text-gray-400 mt-1.5">
            Évolution : dernière évaluation ({last.label}) vs précédente{prev ? ` (${prev.label})` : ''}. ↘ = le frein diminue (mieux).
          </p>
        </div>
      )}
    </div>
  );
}
