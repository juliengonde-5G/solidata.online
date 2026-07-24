import { useState, useEffect, useCallback } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell,
  PieChart, Pie,
} from 'recharts';
import { ShieldCheck, Download, RefreshCw, MessageSquare, Users } from 'lucide-react';
import { LoadingSpinner, ErrorState } from '../../components';
import api from '../../services/api';
import {
  SEUIL_ANONYMAT, TYPE_LABELS, TYPE_STYLES, STATUT_LABELS, CATEGORIE_LABELS,
  isNumericType, apiErr,
} from './enquetesShared';

const BAR_COLORS = ['#0d9488', '#0891b2', '#2563eb', '#7c3aed', '#c026d3', '#db2777', '#ea580c', '#65a30d'];
const OUINON_COLORS = { oui: '#059669', non: '#e11d48', non_renseigne: '#94a3b8' };

// Transforme une distribution {clé: compte} en tableau pour Recharts.
function distToArray(dist, numeric = false) {
  const entries = Object.entries(dist || {});
  if (numeric) entries.sort((a, b) => Number(a[0]) - Number(b[0]));
  else entries.sort((a, b) => b[1] - a[1]);
  return entries.map(([name, value]) => ({ name, value }));
}

/**
 * Restitution AGRÉGÉE d'une campagne, avec SEUIL D'ANONYMAT n ≥ 5.
 *
 * Le backend décide seul du masquage : si `sous_seuil` est vrai, la réponse ne
 * contient AUCUNE donnée par question. Ce composant se contente d'afficher un
 * bandeau d'anonymat préservé — aucun détail ne peut alors apparaître.
 */
export default function ResultatsEnquete({ campagneId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(() => {
    if (!campagneId) return;
    let alive = true;
    setLoading(true);
    api.get(`/enquetes/campagnes/${campagneId}/resultats`)
      .then((r) => { if (alive) { setData(r.data); setError(null); } })
      .catch((err) => { if (alive) setError(apiErr(err)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [campagneId]);

  useEffect(() => load(), [load]);

  const exportCsv = async () => {
    setExporting(true); setError(null);
    try {
      const res = await api.get(`/enquetes/campagnes/${campagneId}/resultats/export`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `enquete_resultats_${campagneId}_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (err) { setError(apiErr(err, "Échec de l'export CSV.")); }
    setExporting(false);
  };

  if (loading) return <LoadingSpinner size="lg" message="Chargement des résultats…" />;
  if (error) return <ErrorState variant="card" title="Résultats indisponibles" message={error} onRetry={load} />;
  if (!data) return null;

  const camp = data.campagne || {};
  const n = data.n ?? 0;

  return (
    <div className="space-y-4">
      {/* En-tête */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold text-slate-800">{camp.titre}</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            {camp.modele_titre}{camp.categorie ? ` · ${CATEGORIE_LABELS[camp.categorie] || camp.categorie}` : ''}
            {camp.statut ? ` · ${STATUT_LABELS[camp.statut] || camp.statut}` : ''}
            {camp.anonyme ? ' · anonyme' : ' · nominatif'}
          </p>
          <p className="text-sm text-slate-600 mt-1 inline-flex items-center gap-1.5">
            <Users className="w-4 h-4 text-slate-400" /> <strong>{n}</strong> réponse{n > 1 ? 's' : ''} collectée{n > 1 ? 's' : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="btn-ghost text-sm inline-flex items-center gap-1.5" title="Actualiser">
            <RefreshCw className="w-4 h-4" /> Actualiser
          </button>
          {!data.sous_seuil && (
            <button onClick={exportCsv} disabled={exporting} className="btn-ghost text-sm inline-flex items-center gap-1.5 disabled:opacity-50">
              <Download className="w-4 h-4" /> {exporting ? 'Export…' : 'Exporter (CSV)'}
            </button>
          )}
        </div>
      </div>

      {/* SEUIL D'ANONYMAT — aucun détail restitué sous 5 réponses */}
      {data.sous_seuil ? (
        <div className="rounded-2xl border-2 border-teal-200 bg-teal-50 p-6 text-center">
          <div className="w-14 h-14 rounded-full bg-teal-100 flex items-center justify-center mx-auto mb-3">
            <ShieldCheck className="w-7 h-7 text-teal-600" />
          </div>
          <h3 className="text-base font-semibold text-teal-800">Résultats masqués — anonymat préservé</h3>
          <p className="text-sm text-teal-700 mt-1 max-w-md mx-auto">
            Moins de {data.seuil ?? SEUIL_ANONYMAT} réponses ({n} pour l'instant). Aucun détail n'est affiché tant que le seuil d'anonymat n'est pas atteint,
            afin qu'aucune réponse individuelle ne puisse être identifiée.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {(data.questions || []).map((q) => <QuestionResult key={q.question_id} q={q} anonyme={data.anonyme} />)}
          {(data.questions || []).length === 0 && (
            <p className="text-sm text-slate-400 bg-white border rounded-lg p-6 text-center">Ce questionnaire ne comporte aucune question exploitable.</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Restitution d'une question ───────────────────────────────────────────────
function QuestionResult({ q, anonyme }) {
  return (
    <div className="bg-white rounded-xl border p-4">
      <div className="flex items-start justify-between gap-2 flex-wrap mb-2">
        <h3 className="text-sm font-semibold text-slate-800">{q.libelle}</h3>
        <div className="flex items-center gap-2">
          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${TYPE_STYLES[q.type] || 'bg-slate-100 text-slate-600'}`}>{TYPE_LABELS[q.type] || q.type}</span>
          <span className="text-[11px] text-slate-400">{q.n_reponses ?? 0} rép.</span>
        </div>
      </div>

      {isNumericType(q.type) ? (
        <NumericResult q={q} />
      ) : q.type === 'oui_non' ? (
        <OuiNonResult q={q} />
      ) : q.type === 'texte' ? (
        <TexteResult q={q} anonyme={anonyme} />
      ) : (
        <ChoixResult q={q} />
      )}
    </div>
  );
}

function NumericResult({ q }) {
  const chartData = distToArray(q.distribution, true);
  return (
    <div>
      <div className="flex flex-wrap gap-4 mb-3">
        <Stat label="Moyenne" value={q.moyenne != null ? q.moyenne : '—'} highlight />
        <Stat label="Minimum" value={q.min != null ? q.min : '—'} />
        <Stat label="Maximum" value={q.max != null ? q.max : '—'} />
      </div>
      {chartData.length === 0 ? (
        <p className="text-sm text-slate-400 py-4">Aucune valeur.</p>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="name" fontSize={12} />
            <YAxis allowDecimals={false} fontSize={11} />
            <Tooltip formatter={(v) => [`${v} réponse${v > 1 ? 's' : ''}`, 'Effectif']} />
            <Bar dataKey="value" fill="#0d9488" radius={[4, 4, 0, 0]} name="Effectif" />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

function OuiNonResult({ q }) {
  const data = distToArray(q.distribution).map((d) => ({ ...d, color: OUINON_COLORS[d.name] || '#94a3b8' }));
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return <p className="text-sm text-slate-400 py-4">Aucune réponse.</p>;
  return (
    <div className="flex items-center gap-4 flex-wrap">
      <ResponsiveContainer width={180} height={180}>
        <PieChart>
          <Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label={(e) => `${Math.round((e.value / total) * 100)}%`}>
            {data.map((d) => <Cell key={d.name} fill={d.color} />)}
          </Pie>
          <Tooltip formatter={(v, n) => [`${v} (${Math.round((v / total) * 100)}%)`, cap(n)]} />
        </PieChart>
      </ResponsiveContainer>
      <ul className="text-sm space-y-1">
        {data.map((d) => (
          <li key={d.name} className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: d.color }} aria-hidden="true" />
            <span className="text-slate-700 capitalize">{cap(d.name)}</span>
            <span className="text-slate-400">— {d.value} ({Math.round((d.value / total) * 100)}%)</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ChoixResult({ q }) {
  const chartData = distToArray(q.distribution);
  if (chartData.length === 0) return <p className="text-sm text-slate-400 py-4">Aucune réponse.</p>;
  const height = Math.max(160, chartData.length * 40 + 40);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
        <XAxis type="number" allowDecimals={false} fontSize={11} />
        <YAxis type="category" dataKey="name" width={140} fontSize={12} />
        <Tooltip formatter={(v) => [`${v} réponse${v > 1 ? 's' : ''}`, 'Effectif']} />
        <Bar dataKey="value" radius={[0, 4, 4, 0]} name="Effectif">
          {chartData.map((d, i) => <Cell key={d.name} fill={BAR_COLORS[i % BAR_COLORS.length]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function TexteResult({ q, anonyme }) {
  const mots = q.nuage_mots || [];
  const maxCount = mots.reduce((mx, m) => Math.max(mx, m.count || 0), 0) || 1;
  const verbatims = q.reponses_texte || [];
  return (
    <div className="space-y-3">
      {mots.length > 0 ? (
        <div className="flex flex-wrap gap-x-3 gap-y-1 items-baseline">
          {mots.map((m) => (
            <span key={m.mot} className="text-teal-800 leading-tight" style={{ fontSize: `${0.8 + (m.count / maxCount) * 1.2}rem`, opacity: 0.5 + (m.count / maxCount) * 0.5 }} title={`${m.count} occurrence${m.count > 1 ? 's' : ''}`}>
              {m.mot}
            </span>
          ))}
        </div>
      ) : (
        <p className="text-sm text-slate-400">Aucun mot significatif.</p>
      )}

      {anonyme && verbatims.length > 0 && (
        <div>
          <p className="text-xs font-medium text-slate-500 mb-1 inline-flex items-center gap-1"><MessageSquare className="w-3.5 h-3.5" /> Verbatims ({verbatims.length})</p>
          <ul className="space-y-1.5 max-h-56 overflow-y-auto">
            {verbatims.map((t, i) => (
              <li key={i} className="text-sm text-slate-700 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2">« {t} »</li>
            ))}
          </ul>
        </div>
      )}
      {!anonyme && verbatims.length === 0 && mots.length > 0 && (
        <p className="text-[11px] text-slate-400">Les verbatims bruts ne sont pas affichés (modèle non anonyme).</p>
      )}
    </div>
  );
}

function Stat({ label, value, highlight }) {
  return (
    <div className={`rounded-lg border px-3 py-1.5 ${highlight ? 'border-teal-200 bg-teal-50' : 'border-slate-200 bg-white'}`}>
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`text-lg font-bold ${highlight ? 'text-teal-700' : 'text-slate-800'}`}>{value}</div>
    </div>
  );
}

function cap(s) {
  const str = String(s || '').replace(/_/g, ' ');
  return str.charAt(0).toUpperCase() + str.slice(1);
}
