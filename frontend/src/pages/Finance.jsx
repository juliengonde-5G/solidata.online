import { useState, useEffect, useCallback } from 'react';
import {
  AlertTriangle, BarChart3, Calculator, CircleDollarSign, Euro, Factory,
  Landmark, Scale, ShieldCheck, Target, TrendingDown, TrendingUp, Truck, Upload,
} from 'lucide-react';
import Layout from '../components/Layout';
import api from '../services/api';
import { PageHeader, KPICard, LoadingSpinner, Section, ModuleCard } from '../components';
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
  { path: '/pennylane', title: 'Pennylane', description: 'Synchroniser GL, transactions, balances', icon: Upload, color: 'blue' },
  { path: '/finance/operations', title: 'Donnees Operationnelles', description: 'Volumes, couts, marges par centre', icon: Calculator, color: 'emerald' },
  { path: '/finance/rentabilite', title: 'Rentabilite Matiere', description: 'Cout complet collecte / tri, PV moyen, marge par qualite', icon: TrendingUp, color: 'teal' },
  { path: '/finance/tresorerie', title: 'Tresorerie', description: 'Position, encaissements, decaissements', icon: Landmark, color: 'teal' },
  { path: '/finance/pl', title: 'Compte de Resultat', description: 'P&L par centre analytique', icon: BarChart3, color: 'amber' },
  { path: '/finance/bilan', title: 'Bilan & Ratios', description: 'Actif, passif, SIG, seuil de rentabilite', icon: Scale, color: 'purple' },
  { path: '/finance/controles', title: 'Controles', description: 'Verifications automatiques', icon: ShieldCheck, color: 'red' },
];

export default function Finance() {
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

  const budgetMonthly = kpis?.budget_monthly || [];
  const chartData = MONTHS.map((m, i) => ({
    mois: m,
    ca: monthlyData[i]?.ca || 0,
    resultat: monthlyData[i]?.resultat || 0,
    budget_ca: budgetMonthly[i]?.produits || 0,
    budget_resultat: (budgetMonthly[i]?.produits || 0) - (budgetMonthly[i]?.charges || 0),
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
          subtitle="Synthèse dirigeant"
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
          <KPICard title="CA YTD" value={fmtK(kpis?.ca_ytd)} unit="EUR" icon={Euro} accent="emerald" loading={loading} />
          <KPICard title="Charges YTD" value={fmtK(kpis?.charges_ytd)} unit="EUR" icon={TrendingDown} accent="red" loading={loading} />
          <KPICard title="Résultat" value={fmtK(kpis?.resultat)} unit="EUR" icon={BarChart3} accent="emerald" loading={loading}
            trend={kpis?.resultat_trend ? { direction: kpis.resultat_trend > 0 ? 'up' : 'down', value: Math.abs(kpis.resultat_trend) } : undefined}
          />
          <KPICard title="Trésorerie" value={fmtK(kpis?.tresorerie)} unit="EUR" icon={Landmark} accent="primary" loading={loading} />
          <KPICard title="BFR" value={fmtK(kpis?.bfr)} unit="EUR" icon={Calculator} accent="amber" loading={loading} />
          <KPICard title="Coût / tonne collecte" value={fmt(kpis?.cout_tonne_collecte)} unit="EUR/t" icon={Truck} accent="slate" loading={loading} />
          <KPICard title="Coût / tonne trié" value={fmt(kpis?.cout_tonne_trie)} unit="EUR/t" icon={Factory} accent="slate" loading={loading} />
          <KPICard title="Marge globale" value={fmtPct(kpis?.marge_globale)} icon={TrendingUp} accent="emerald" loading={loading}
            trend={kpis?.marge_trend ? { direction: kpis.marge_trend > 0 ? 'up' : 'down', value: Math.abs(kpis.marge_trend) } : undefined}
          />
        </div>

        {/* Budget */}
        <Section title={`Budget ${year}`} icon={Target}>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
            <KPICard title="Budget Produits" value={fmtK(kpis?.budget_produits_annuel)} unit="EUR" icon={Target} accent="emerald" loading={loading} />
            <KPICard title="Budget Charges" value={fmtK(kpis?.budget_charges_annuel)} unit="EUR" icon={Target} accent="red" loading={loading} />
            <KPICard title="Résultat budgété" value={fmtK(kpis?.budget_resultat_annuel)} unit="EUR" icon={Target} accent="primary" loading={loading} />
            <KPICard
              title="Écart CA vs budget YTD"
              value={fmtK(kpis?.ecart_produits_ytd)}
              unit="EUR"
              icon={kpis?.ecart_produits_ytd >= 0 ? TrendingUp : TrendingDown}
              accent={kpis?.ecart_produits_ytd >= 0 ? 'emerald' : 'red'}
              loading={loading}
            />
            <KPICard
              title="Conso. charges YTD"
              value={fmtPct(kpis?.taux_consommation_charges)}
              icon={Calculator}
              accent={kpis?.taux_consommation_charges > 105 ? 'red' : 'amber'}
              loading={loading}
            />
          </div>
        </Section>

        {/* Graphiques */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Section title="CA et Résultat mensuel" icon={BarChart3}>
            {loading ? (
              <div className="flex items-center justify-center h-64"><LoadingSpinner /></div>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="mois" tick={{ fontSize: 12, fill: '#64748b' }} />
                  <YAxis tick={{ fontSize: 12, fill: '#64748b' }} tickFormatter={(v) => fmtK(v)} />
                  <Tooltip
                    formatter={(value, name) => {
                      const labels = { ca: 'CA', resultat: 'Resultat', budget_ca: 'Budget CA', budget_resultat: 'Budget Resultat' };
                      return [fmt(value) + ' EUR', labels[name] || name];
                    }}
                    labelStyle={{ color: '#334155', fontWeight: 600 }}
                    contentStyle={{ borderRadius: '12px', border: '1px solid #e2e8f0' }}
                  />
                  <Legend
                    formatter={(v) => ({ ca: 'CA', resultat: 'Resultat', budget_ca: 'Budget CA', budget_resultat: 'Budget Resultat' }[v] || v)}
                  />
                  <Bar dataKey="ca" fill="#0d9488" radius={[4, 4, 0, 0]} name="ca" />
                  <Line type="monotone" dataKey="resultat" stroke="#f59e0b" strokeWidth={2} dot={false} name="resultat" />
                  <Line type="monotone" dataKey="budget_ca" stroke="#3b82f6" strokeWidth={2} strokeDasharray="4 4" dot={false} name="budget_ca" />
                  <Line type="monotone" dataKey="budget_resultat" stroke="#94a3b8" strokeWidth={2} strokeDasharray="4 4" dot={false} name="budget_resultat" />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </Section>

          <Section title="Évolution de la trésorerie" icon={Landmark}>
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
          </Section>
        </div>

        {/* Liens sous-pages */}
        <div>
          <h2 className="text-lg font-bold text-slate-800 mb-4 tracking-tight">Modules Finance</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {SUB_PAGES.map((page) => (
              <ModuleCard key={page.path} {...page} />
            ))}
          </div>
        </div>
      </div>
    </Layout>
  );
}
