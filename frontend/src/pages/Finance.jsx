import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle, BarChart3, Calculator, CircleDollarSign, Euro, Factory,
  Landmark, Scale, ShieldCheck, TrendingDown, TrendingUp, Truck, Upload,
} from 'lucide-react';
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
  { path: '/pennylane', label: 'Pennylane', description: 'Synchroniser GL, transactions, balances', icon: Upload, color: 'blue' },
  { path: '/finance/operations', label: 'Donnees Operationnelles', description: 'Volumes, couts, marges par centre', icon: Calculator, color: 'emerald' },
  { path: '/finance/rentabilite', label: 'Rentabilite Matiere', description: 'Cout complet collecte / tri, PV moyen, marge par qualite', icon: TrendingUp, color: 'teal' },
  { path: '/finance/tresorerie', label: 'Tresorerie', description: 'Position, encaissements, decaissements', icon: Landmark, color: 'teal' },
  { path: '/finance/pl', label: 'Compte de Resultat', description: 'P&L par centre analytique', icon: BarChart3, color: 'amber' },
  { path: '/finance/bilan', label: 'Bilan & Ratios', description: 'Actif, passif, SIG, seuil de rentabilite', icon: Scale, color: 'purple' },
  { path: '/finance/controles', label: 'Controles', description: 'Verifications automatiques', icon: ShieldCheck, color: 'rose' },
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
          icon={CircleDollarSign}
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
                <AlertTriangle className={`w-5 h-5 flex-shrink-0 ${
                  alerte.type === 'error' ? 'text-red-500' : alerte.type === 'warning' ? 'text-amber-500' : 'text-blue-500'
                }`} />
                <span>{alerte.message}</span>
              </div>
            ))}
          </div>
        )}

        {/* KPI Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <KPICard title="CA YTD" value={fmtK(kpis?.ca_ytd)} unit="EUR" icon={Euro} accent="primary" loading={loading} />
          <KPICard title="Charges YTD" value={fmtK(kpis?.charges_ytd)} unit="EUR" icon={TrendingDown} accent="red" loading={loading} />
          <KPICard title="Resultat" value={fmtK(kpis?.resultat)} unit="EUR" icon={BarChart3} accent="emerald" loading={loading}
            trend={kpis?.resultat_trend ? { direction: kpis.resultat_trend > 0 ? 'up' : 'down', value: Math.abs(kpis.resultat_trend) } : undefined}
          />
          <KPICard title="Tresorerie" value={fmtK(kpis?.tresorerie)} unit="EUR" icon={Landmark} accent="primary" loading={loading} />
          <KPICard title="BFR" value={fmtK(kpis?.bfr)} unit="EUR" icon={Calculator} accent="amber" loading={loading} />
          <KPICard title="Cout / tonne collecte" value={fmt(kpis?.cout_tonne_collecte)} unit="EUR/t" icon={Truck} accent="slate" loading={loading} />
          <KPICard title="Cout / tonne trie" value={fmt(kpis?.cout_tonne_trie)} unit="EUR/t" icon={Factory} accent="slate" loading={loading} />
          <KPICard title="Marge globale" value={fmtPct(kpis?.marge_globale)} icon={TrendingUp} accent="emerald" loading={loading}
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

