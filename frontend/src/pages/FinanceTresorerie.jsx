import { useState, useEffect, useCallback } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Landmark, List } from 'lucide-react';
import Layout from '../components/Layout';
import api from '../services/api';
import { PageHeader, KPICard, DataTable, LoadingSpinner, Section } from '../components';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ComposedChart, Cell, ReferenceLine,
} from 'recharts';

// ══════════════════════════════════════════
// FINANCE TRESORERIE — Suivi tresorerie
// Position, waterfall, flux par categorie
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

export default function FinanceTresorerie() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expandedGroups, setExpandedGroups] = useState({});

  const years = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/finance/gl/${year}/tresorerie`);
      setData(res.data);
    } catch (err) {
      console.error('Erreur chargement tresorerie:', err);
    }
    setLoading(false);
  }, [year]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const toggleGroup = (key) => {
    setExpandedGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const kpis = data?.kpis || {};
  const waterfallData = data?.waterfall || [];
  const monthlyData = data?.monthly || [];
  const cashFlowGroups = data?.cash_flow || [];

  const monthlyChartData = MONTHS.map((m, i) => ({
    mois: m,
    encaissements: monthlyData[i]?.encaissements || 0,
    decaissements: monthlyData[i]?.decaissements || 0,
    solde: monthlyData[i]?.solde || 0,
  }));

  return (
    <Layout>
      <div className="space-y-6">
        <PageHeader
          title="Tresorerie"
          subtitle="Position et flux de tresorerie"
          icon={Landmark}
          breadcrumb={[
            { label: 'Accueil', path: '/' },
            { label: 'Finance', path: '/finance' },
            { label: 'Tresorerie' },
          ]}
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

        {/* KPI Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <KPICard title="Position actuelle" value={fmtK(kpis.position)} unit="EUR" icon={Landmark} accent="primary" loading={loading}
            trend={kpis.position_trend ? { direction: kpis.position_trend > 0 ? 'up' : 'down', value: Math.abs(kpis.position_trend) } : undefined}
          />
          <KPICard title="Encaissements YTD" value={fmtK(kpis.encaissements)} unit="EUR" icon={ArrowDown} accent="emerald" loading={loading} />
          <KPICard title="Decaissements YTD" value={fmtK(kpis.decaissements)} unit="EUR" icon={ArrowUp} accent="red" loading={loading} />
          <KPICard title="Variation" value={fmtK(kpis.variation)} unit="EUR" icon={ArrowUpDown} accent="amber" loading={loading} />
        </div>

        {/* Graphiques */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Waterfall */}
          <Section title="Cascade de tresorerie">
            {loading ? (
              <div className="flex items-center justify-center h-64"><LoadingSpinner /></div>
            ) : waterfallData.length === 0 ? (
              <div className="flex items-center justify-center h-64 text-sm text-slate-400">Pas de donnees</div>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={waterfallData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} />
                  <YAxis tick={{ fontSize: 12, fill: '#64748b' }} tickFormatter={(v) => fmtK(v)} />
                  <Tooltip
                    formatter={(value) => [fmt(value) + ' EUR']}
                    contentStyle={{ borderRadius: '12px', border: '1px solid #e2e8f0' }}
                  />
                  <Bar dataKey="invisible" stackId="a" fill="transparent" />
                  <Bar dataKey="value" stackId="a" radius={[4, 4, 0, 0]}>
                    {waterfallData.map((entry, index) => (
                      <Cell key={index} fill={entry.type === 'positive' ? '#10b981' : entry.type === 'negative' ? '#ef4444' : '#0d9488'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </Section>

          {/* Mensuel double axe */}
          <Section title="Flux mensuels et solde">
            {loading ? (
              <div className="flex items-center justify-center h-64"><LoadingSpinner /></div>
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <ComposedChart data={monthlyChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="mois" tick={{ fontSize: 12, fill: '#64748b' }} />
                  <YAxis yAxisId="left" tick={{ fontSize: 12, fill: '#64748b' }} tickFormatter={(v) => fmtK(v)} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12, fill: '#64748b' }} tickFormatter={(v) => fmtK(v)} />
                  <Tooltip
                    formatter={(value, name) => [
                      fmt(value) + ' EUR',
                      name === 'encaissements' ? 'Encaissements' : name === 'decaissements' ? 'Decaissements' : 'Solde',
                    ]}
                    contentStyle={{ borderRadius: '12px', border: '1px solid #e2e8f0' }}
                  />
                  <Legend formatter={(v) => v === 'encaissements' ? 'Encaissements' : v === 'decaissements' ? 'Decaissements' : 'Solde'} />
                  <ReferenceLine yAxisId="left" y={0} stroke="#94a3b8" strokeDasharray="3 3" />
                  <Bar yAxisId="left" dataKey="encaissements" fill="#10b981" radius={[4, 4, 0, 0]} />
                  <Bar yAxisId="left" dataKey="decaissements" fill="#ef4444" radius={[4, 4, 0, 0]} />
                  <Line yAxisId="right" type="monotone" dataKey="solde" stroke="#0d9488" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </Section>
        </div>

        {/* Tableau flux par categorie */}
        <Section title="Flux de tresorerie par categorie" icon={List}>
          {loading ? (
            <LoadingSpinner />
          ) : cashFlowGroups.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-8">Aucune donnee disponible</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="text-left px-4 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wider">Categorie</th>
                    {MONTHS.map((m) => (
                      <th key={m} className="text-right px-3 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wider">{m}</th>
                    ))}
                    <th className="text-right px-4 py-3 font-semibold text-slate-800 text-xs uppercase tracking-wider bg-slate-100">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {cashFlowGroups.map((group) => (
                    <CashFlowGroup
                      key={group.key}
                      group={group}
                      expanded={!!expandedGroups[group.key]}
                      onToggle={() => toggleGroup(group.key)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </div>
    </Layout>
  );
}

// ══════════════════════════════════════════
// Cash Flow Group (collapsible)
// ══════════════════════════════════════════

function CashFlowGroup({ group, expanded, onToggle }) {
  const total = (group.months || []).reduce((s, v) => s + (v || 0), 0);

  return (
    <>
      <tr
        onClick={onToggle}
        className="border-b border-slate-100 cursor-pointer hover:bg-slate-50 font-medium"
      >
        <td className="px-4 py-3 flex items-center gap-2">
          <svg className={`w-4 h-4 text-slate-400 transition-transform ${expanded ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          <span className="text-slate-800">{group.label}</span>
        </td>
        {(group.months || MONTHS.map(() => 0)).map((v, i) => (
          <td key={i} className={`text-right px-3 py-3 ${v < 0 ? 'text-red-600' : 'text-slate-700'}`}>
            {fmt(v)}
          </td>
        ))}
        <td className={`text-right px-4 py-3 font-bold bg-slate-50 ${total < 0 ? 'text-red-700' : 'text-slate-800'}`}>
          {fmt(total)}
        </td>
      </tr>
      {expanded && group.lines?.map((line, li) => {
        const lineTotal = (line.months || []).reduce((s, v) => s + (v || 0), 0);
        return (
          <tr key={li} className="border-b border-slate-50 bg-slate-50/30">
            <td className="pl-10 pr-4 py-2 text-slate-500 text-xs">{line.label}</td>
            {(line.months || MONTHS.map(() => 0)).map((v, i) => (
              <td key={i} className={`text-right px-3 py-2 text-xs ${v < 0 ? 'text-red-500' : 'text-slate-500'}`}>
                {fmt(v)}
              </td>
            ))}
            <td className={`text-right px-4 py-2 text-xs font-medium bg-slate-50 ${lineTotal < 0 ? 'text-red-600' : 'text-slate-600'}`}>
              {fmt(lineTotal)}
            </td>
          </tr>
        );
      })}
    </>
  );
}

