import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import api from '../services/api';
import { PageHeader, KPICard, LoadingSpinner, EmptyState } from '../components';
import {
  ComposedChart, Bar, Line, LineChart, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts';

// ══════════════════════════════════════════
// FINANCE — Synthese Dirigeant
// KPIs globaux + Alertes + Graphiques CA/Tresorerie
// ══════════════════════════════════════════

const MONTHS = ['Jan', 'Fev', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aou', 'Sep', 'Oct', 'Nov', 'Dec'];

const fmt = (v) => {
  if (v == null) return '—';
  return Number(v).toLocaleString('fr-FR', { maximumFractionDigits: 0 });
};

const fmtK = (v) => {
  if (v == null) return '—';
  const n = Number(v);
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} k`;
  return fmt(v);
};

const fmtPct = (v) => {
  if (v == null) return '—';
  return `${Number(v).toLocaleString('fr-FR', { maximumFractionDigits: 1 })}%`;
};

const SUB_PAGES = [
  { path: '/pennylane', label: 'Pennylane', description: 'Synchroniser GL, transactions, balances', icon: IconUpload, color: 'blue' },
  { path: '/finance/operations', label: 'Donnees Operationnelles', description: 'Volumes, couts, marges par centre', icon: IconCalc, color: 'emerald' },
  { path: '/finance/tresorerie', label: 'Tresorerie', description: 'Position, encaissements, decaissements', icon: IconBank, color: 'teal' },
  { path: '/finance/pl', label: 'Compte de Resultat', description: 'P&L par centre, budget vs reel', icon: IconPL, color: 'amber' },
  { path: '/finance/bilan', label: 'Bilan & Ratios', description: 'Actif, passif, SIG, seuil de rentabilite', icon: IconBalance, color: 'purple' },
  { path: '/finance/controles', label: 'Controles', description: 'Verifications automatiques', icon: IconShield, color: 'rose' },
];

const COLOR_MAP = {
  blue: 'bg-blue-50 text-blue-600 border-blue-200',
  emerald: 'bg-emerald-50 text-emerald-600 border-emerald-200',
  teal: 'bg-teal-50 text-teal-600 border-teal-200',
  amber: 'bg-amber-50 text-amber-600 border-amber-200',
  purple: 'bg-purple-50 text-purple-600 border-purple-200',
  rose: 'bg-rose-50 text-rose-600 border-rose-200',
};

export default function Finance() {
  const navigate = useNavigate();
  const [year, setYear] = useState(new Date().getFullYear());
  const [kpis, setKpis] = useState(null);
  const [loading, setLoading] = useState(true);

  const years = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/finance/kpis/${year}`);
      setKpis(res.data);
    } catch (err) {
      console.error('Erreur chargement KPI finance:', err);
    }
    setLoading(false);
  }, [year]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const alerts = kpis?.alertes || [];
  const monthlyData = kpis?.monthly || [];
  const treasuryData = kpis?.tresorerie_evolution || [];

  const chartData = MONTHS.map((m, i) => ({
    mois: m,
    ca: monthlyData[i]?.ca || 0,
    resultat: monthlyData[i]?.resultat || 0,
  }));

  const treasuryChartData = MONTHS.map((m, i) => ({
    mois: m,
    solde: treasuryData[i]?.solde || 0,
  }));

  return (
    <Layout>
      <div className="space-y-6">
        <PageHeader
          title="Finance"
          subtitle="Synthese dirigeant"
          icon={IconFinance}
          breadcrumb={[{ label: 'Accueil', path: '/' }, { label: 'Finance' }]}
          actions={
            <select
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              className="px-3 py-2 rounded-xl border border-slate-200 text-sm font-medium text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
            >
              {years.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          }
        />

        {/* Alertes */}
        {alerts.length > 0 && (
          <div className="space-y-2">
            {alerts.map((alerte, i) => (
              <div
                key={i}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm ${
                  alerte.type === 'error'
                    ? 'bg-red-50 border border-red-200 text-red-800'
                    : alerte.type === 'warning'
                    ? 'bg-amber-50 border border-amber-200 text-amber-800'
                    : 'bg-blue-50 border border-blue-200 text-blue-800'
                }`}
              >
                <IconAlert className={`w-5 h-5 flex-shrink-0 ${
                  alerte.type === 'error' ? 'text-red-500' : alerte.type === 'warning' ? 'text-amber-500' : 'text-blue-500'
                }`} />
                <span>{alerte.message}</span>
              </div>
            ))}
          </div>
        )}

        {/* KPI Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <KPICard title="CA YTD" value={fmtK(kpis?.ca_ytd)} unit="EUR" icon={IconEuro} accent="primary" loading={loading} />
          <KPICard title="Charges YTD" value={fmtK(kpis?.charges_ytd)} unit="EUR" icon={IconDown} accent="red" loading={loading} />
          <KPICard title="Resultat" value={fmtK(kpis?.resultat)} unit="EUR" icon={IconPL} accent="emerald" loading={loading}
            trend={kpis?.resultat_trend ? { direction: kpis.resultat_trend > 0 ? 'up' : 'down', value: Math.abs(kpis.resultat_trend) } : undefined}
          />
          <KPICard title="Tresorerie" value={fmtK(kpis?.tresorerie)} unit="EUR" icon={IconBank} accent="primary" loading={loading} />
          <KPICard title="BFR" value={fmtK(kpis?.bfr)} unit="EUR" icon={IconCalc} accent="amber" loading={loading} />
          <KPICard title="Cout / tonne collecte" value={fmt(kpis?.cout_tonne_collecte)} unit="EUR/t" icon={IconTruck} accent="slate" loading={loading} />
          <KPICard title="Cout / tonne trie" value={fmt(kpis?.cout_tonne_trie)} unit="EUR/t" icon={IconFactory} accent="slate" loading={loading} />
          <KPICard title="Marge globale" value={fmtPct(kpis?.marge_globale)} icon={IconChart} accent="emerald" loading={loading}
            trend={kpis?.marge_trend ? { direction: kpis.marge_trend > 0 ? 'up' : 'down', value: Math.abs(kpis.marge_trend) } : undefined}
          />
        </div>

        {/* Graphiques */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* CA + Resultat mensuel */}
          <div className="card-modern p-6">
            <h3 className="text-base font-semibold text-slate-800 mb-4">CA et Resultat mensuel</h3>
            {loading ? (
              <div className="flex items-center justify-center h-64"><LoadingSpinner /></div>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="mois" tick={{ fontSize: 12, fill: '#64748b' }} />
                  <YAxis tick={{ fontSize: 12, fill: '#64748b' }} tickFormatter={(v) => fmtK(v)} />
                  <Tooltip
                    formatter={(value, name) => [fmt(value) + ' EUR', name === 'ca' ? 'CA' : 'Resultat']}
                    labelStyle={{ color: '#334155', fontWeight: 600 }}
                    contentStyle={{ borderRadius: '12px', border: '1px solid #e2e8f0' }}
                  />
                  <Legend formatter={(v) => v === 'ca' ? 'CA' : 'Resultat'} />
                  <Bar dataKey="ca" fill="#0d9488" radius={[4, 4, 0, 0]} name="ca" />
                  <Line type="monotone" dataKey="resultat" stroke="#f59e0b" strokeWidth={2} dot={false} name="resultat" />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Evolution Tresorerie */}
          <div className="card-modern p-6">
            <h3 className="text-base font-semibold text-slate-800 mb-4">Evolution de la tresorerie</h3>
            {loading ? (
              <div className="flex items-center justify-center h-64"><LoadingSpinner /></div>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={treasuryChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="mois" tick={{ fontSize: 12, fill: '#64748b' }} />
                  <YAxis tick={{ fontSize: 12, fill: '#64748b' }} tickFormatter={(v) => fmtK(v)} />
                  <Tooltip
                    formatter={(value) => [fmt(value) + ' EUR', 'Solde']}
                    contentStyle={{ borderRadius: '12px', border: '1px solid #e2e8f0' }}
                  />
                  <Line type="monotone" dataKey="solde" stroke="#0d9488" strokeWidth={2} fill="#ccfbf1" dot={{ r: 3 }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Liens sous-pages */}
        <div>
          <h2 className="text-lg font-semibold text-slate-800 mb-4">Modules Finance</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {SUB_PAGES.map((page) => {
              const Icon = page.icon;
              const colors = COLOR_MAP[page.color];
              return (
                <button
                  key={page.path}
                  onClick={() => navigate(page.path)}
                  className="card-modern p-5 text-left group hover:shadow-md transition-all"
                >
                  <div className="flex items-start justify-between mb-3">
                    <span className={`w-10 h-10 rounded-xl flex items-center justify-center ${colors.split(' ').slice(0, 2).join(' ')}`}>
                      <Icon className={`w-5 h-5 ${colors.split(' ')[1]}`} />
                    </span>
                    <svg className="w-5 h-5 text-slate-300 group-hover:text-slate-500 group-hover:translate-x-0.5 transition-all" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                  <h3 className="font-semibold text-slate-800 mb-1">{page.label}</h3>
                  <p className="text-xs text-slate-500">{page.description}</p>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </Layout>
  );
}

// ══════════════════════════════════════════
// SVG Icons
// ══════════════════════════════════════════

function IconFinance({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>;
}
function IconEuro({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M14.121 15.536c-1.171 1.952-3.07 1.952-4.242 0-1.172-1.953-1.172-5.119 0-7.072 1.171-1.952 3.07-1.952 4.242 0M8 10.5h4m-4 3h4" /></svg>;
}
function IconDown({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M13 17h8m0 0V9m0 8l-8-8-4 4-6-6" /></svg>;
}
function IconBank({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 21h18M3 10h18M5 6l7-3 7 3M4 10v11m16-11v11M8 14v3m4-3v3m4-3v3" /></svg>;
}
function IconCalc({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>;
}
function IconPL({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>;
}
function IconBalance({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" /></svg>;
}
function IconShield({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>;
}
function IconUpload({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>;
}
function IconTruck({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10m10 0H3m10 0a2 2 0 104 0m-4 0a2 2 0 114 0m6-6h-2a1 1 0 00-1 1v5m3 0h-3m3 0a2 2 0 104 0m-4 0a2 2 0 114 0" /></svg>;
}
function IconFactory({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0H5m14 0h2m-16 0H3m2-5h4m2 0h4m-8-4h4m2 0h4" /></svg>;
}
function IconChart({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>;
}
function IconAlert({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>;
}
