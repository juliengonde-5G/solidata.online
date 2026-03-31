import { useState, useEffect, useCallback } from 'react';
import Layout from '../components/Layout';
import api from '../services/api';
import { PageHeader, KPICard, LoadingSpinner } from '../components';

// ══════════════════════════════════════════
// FINANCE P&L — Compte de Resultat
// Par centre, avec budget vs reel, groupes depliables
// ══════════════════════════════════════════

const MONTHS = ['Jan', 'Fev', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aou', 'Sep', 'Oct', 'Nov', 'Dec'];

const fmt = (v) => v != null ? Number(v).toLocaleString('fr-FR', { maximumFractionDigits: 0 }) : '—';
const fmtK = (v) => {
  if (v == null) return '—';
  const n = Number(v);
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} k`;
  return fmt(v);
};

export default function FinancePL() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [centre, setCentre] = useState('all');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expandedGroups, setExpandedGroups] = useState({});

  const years = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (centre !== 'all') params.centre = centre;
      const res = await api.get(`/finance/gl/${year}/pl`, { params });
      setData(res.data);
    } catch (err) {
      console.error('Erreur chargement P&L:', err);
    }
    setLoading(false);
  }, [year, centre]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const toggleGroup = (key) => {
    setExpandedGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const kpis = data?.kpis || {};
  const centres = data?.centres || [];
  const groups = data?.groups || [];

  return (
    <Layout>
      <div className="space-y-6">
        <PageHeader
          title="Compte de Resultat"
          subtitle="P&L par centre et par famille"
          icon={IconPL}
          breadcrumb={[
            { label: 'Accueil', path: '/' },
            { label: 'Finance', path: '/finance' },
            { label: 'Compte de Resultat' },
          ]}
          actions={
            <div className="flex items-center gap-3">
              <select
                value={centre}
                onChange={(e) => setCentre(e.target.value)}
                className="px-3 py-2 rounded-xl border border-slate-200 text-sm font-medium text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
              >
                <option value="all">Tous les centres</option>
                {centres.map((c) => (
                  <option key={c.id || c.code} value={c.code}>{c.label || c.code}</option>
                ))}
              </select>
              <select
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                className="px-3 py-2 rounded-xl border border-slate-200 text-sm font-medium text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
              >
                {years.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
          }
        />

        {/* KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <KPICard title="Produits (classe 7)" value={fmtK(kpis.produits)} unit="EUR" icon={IconUp} accent="emerald" loading={loading}
            trend={kpis.produits_trend ? { direction: kpis.produits_trend > 0 ? 'up' : 'down', value: Math.abs(kpis.produits_trend) } : undefined}
          />
          <KPICard title="Charges (classe 6)" value={fmtK(kpis.charges)} unit="EUR" icon={IconDown} accent="red" loading={loading} />
          <KPICard title="Resultat" value={fmtK(kpis.resultat)} unit="EUR" icon={IconPL} accent="primary" loading={loading}
            trend={kpis.resultat_trend ? { direction: kpis.resultat_trend > 0 ? 'up' : 'down', value: Math.abs(kpis.resultat_trend) } : undefined}
          />
        </div>

        {/* Tableau P&L */}
        <div className="card-modern p-6">
          <h3 className="text-base font-semibold text-slate-800 mb-4">Detail par affectation analytique</h3>

          {loading ? (
            <div className="flex items-center justify-center py-16"><LoadingSpinner /></div>
          ) : groups.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-8">Aucune donnee disponible pour cette selection</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full text-sm whitespace-nowrap">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="text-left px-4 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wider sticky left-0 bg-slate-50 min-w-[200px]">
                      Categorie
                    </th>
                    {MONTHS.map((m) => (
                      <th key={m} className="text-right px-3 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wider min-w-[80px]">{m}</th>
                    ))}
                    <th className="text-right px-4 py-3 font-semibold text-slate-800 text-xs uppercase tracking-wider bg-slate-100 min-w-[90px]">Total</th>
                    <th className="text-right px-4 py-3 font-semibold text-blue-700 text-xs uppercase tracking-wider bg-blue-50 min-w-[90px]">Budget</th>
                    <th className="text-right px-4 py-3 font-semibold text-amber-700 text-xs uppercase tracking-wider bg-amber-50 min-w-[90px]">Ecart</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map((group) => (
                    <PLGroup
                      key={group.key}
                      group={group}
                      expanded={!!expandedGroups[group.key]}
                      onToggle={() => toggleGroup(group.key)}
                    />
                  ))}
                  {/* Ligne Resultat */}
                  {data?.totals && (
                    <tr className="border-t-2 border-slate-300 bg-teal-50/50 font-bold">
                      <td className="px-4 py-3 text-slate-900 sticky left-0 bg-teal-50/50">RESULTAT NET</td>
                      {(data.totals.months || []).map((v, i) => (
                        <td key={i} className={`text-right px-3 py-3 ${v < 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                          {fmt(v)}
                        </td>
                      ))}
                      <td className={`text-right px-4 py-3 bg-slate-100 ${data.totals.total < 0 ? 'text-red-800' : 'text-emerald-800'}`}>
                        {fmt(data.totals.total)}
                      </td>
                      <td className="text-right px-4 py-3 bg-blue-50 text-blue-800">{fmt(data.totals.budget)}</td>
                      <td className={`text-right px-4 py-3 bg-amber-50 ${data.totals.ecart < 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                        {fmt(data.totals.ecart)}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}

// ══════════════════════════════════════════
// P&L Group (collapsible)
// ══════════════════════════════════════════

function PLGroup({ group, expanded, onToggle }) {
  const isRevenue = group.class === '7' || group.type === 'revenue';

  return (
    <>
      {/* Group header */}
      <tr
        onClick={onToggle}
        className={`border-b border-slate-200 cursor-pointer hover:bg-slate-50 ${isRevenue ? 'bg-emerald-50/30' : 'bg-red-50/20'}`}
      >
        <td className={`px-4 py-3 font-semibold sticky left-0 ${isRevenue ? 'bg-emerald-50/30 text-emerald-800' : 'bg-red-50/20 text-red-800'}`}>
          <span className="flex items-center gap-2">
            <svg className={`w-4 h-4 text-slate-400 transition-transform ${expanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            {group.label}
          </span>
        </td>
        {(group.months || []).map((v, i) => (
          <td key={i} className={`text-right px-3 py-3 font-medium ${isRevenue ? 'text-emerald-700' : 'text-red-700'}`}>
            {fmt(v)}
          </td>
        ))}
        <td className={`text-right px-4 py-3 font-bold bg-slate-100 ${isRevenue ? 'text-emerald-800' : 'text-red-800'}`}>
          {fmt(group.total)}
        </td>
        <td className="text-right px-4 py-3 font-medium bg-blue-50 text-blue-700">{fmt(group.budget)}</td>
        <td className={`text-right px-4 py-3 font-medium bg-amber-50 ${(group.ecart || 0) < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
          {fmt(group.ecart)}
        </td>
      </tr>
      {/* Expanded lines */}
      {expanded && group.lines?.map((line, li) => (
        <tr key={li} className="border-b border-slate-50 hover:bg-slate-50/50">
          <td className="pl-10 pr-4 py-2 text-slate-600 text-xs sticky left-0 bg-white">{line.label}</td>
          {(line.months || []).map((v, i) => (
            <td key={i} className="text-right px-3 py-2 text-xs text-slate-500">{fmt(v)}</td>
          ))}
          <td className="text-right px-4 py-2 text-xs font-medium bg-slate-50 text-slate-700">{fmt(line.total)}</td>
          <td className="text-right px-4 py-2 text-xs bg-blue-50/50 text-blue-600">{fmt(line.budget)}</td>
          <td className={`text-right px-4 py-2 text-xs bg-amber-50/50 ${(line.ecart || 0) < 0 ? 'text-red-500' : 'text-emerald-500'}`}>
            {fmt(line.ecart)}
          </td>
        </tr>
      ))}
    </>
  );
}

// ══════════════════════════════════════════
// SVG Icons
// ══════════════════════════════════════════

function IconPL({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>;
}
function IconUp({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>;
}
function IconDown({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6" /></svg>;
}
