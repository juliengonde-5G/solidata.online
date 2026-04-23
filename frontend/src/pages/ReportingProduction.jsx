import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { LoadingSpinner, KPICard, PageHeader, Section } from '../components';
import api from '../services/api';
import {
  BarChart, Bar, LineChart, Line, ComposedChart,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { Factory, Target, Zap, Users, BarChart3 } from 'lucide-react';

// ══════════════════════════════════════════
// REPORTING PRODUCTION — enrichi avec graphiques industriels
// ══════════════════════════════════════════

export default function ReportingProduction() {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadData(); }, [month]);

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/production/dashboard?month=${month}`);
      setDashboard(res.data);
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  if (loading) return <Layout><LoadingSpinner size="lg" message="Chargement..." /></Layout>;

  const summary = dashboard?.summary || {};
  const daily = dashboard?.daily || [];
  const objectif = dashboard?.objectif_mensuel_t || 0;
  const atteinte = dashboard?.atteinte_pct || 0;

  // Rendement matiere
  const totalEntreeKg = parseFloat(summary.total_entree_ligne_kg || 0) + parseFloat(summary.total_entree_r3_kg || 0);
  const totalSortieKg = parseFloat(summary.total_mois_t || 0) * 1000;
  const rendement = totalEntreeKg > 0 ? Math.round(totalSortieKg / totalEntreeKg * 100) : 0;

  // Chart data
  const chartData = daily.map(r => ({
    date: new Date(r.date).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }),
    ligne: parseFloat(r.entree_ligne_kg || 0),
    r3: parseFloat(r.entree_recyclage_r3_kg || 0),
    objectif_ligne: parseFloat(r.objectif_entree_ligne_kg || 0),
    productivite: parseFloat(r.productivite_kg_per || 0),
    effectif: parseFloat(r.effectif_reel || 0),
    total_t: parseFloat(r.total_jour_t || 0),
  }));

  const prodMoyenne = parseFloat(summary.productivite_moyenne || 0);

  // Gauge SVG
  const gaugeColor = atteinte >= 100 ? '#10b981' : atteinte >= 80 ? '#f59e0b' : '#ef4444';
  const gaugeAngle = Math.min(atteinte, 100) * 3.14;

  return (
    <Layout>
      <div className="space-y-6">
        <PageHeader
          title="Reporting Production"
          subtitle="KPI de production, tri et productivité"
          icon={Factory}
          actions={
            <input type="month" value={month} onChange={e => setMonth(e.target.value)} className="input-modern w-auto" />
          }
        />

        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
          <KPICard title="Total mois" value={(summary.total_mois_t || 0).toString()} unit="t" icon={Factory} accent="primary" />
          <KPICard title="Objectif" value={objectif.toString()} unit="t" icon={Target} accent="slate" />
          <KPICard
            title="Atteinte"
            value={`${atteinte}`}
            unit="%"
            icon={Target}
            accent={atteinte >= 100 ? 'emerald' : atteinte >= 80 ? 'amber' : 'red'}
          />
          <KPICard title="Productivité" value={`${summary.productivite_moyenne || 0}`} unit="kg/pers" icon={Zap} accent="amber" />
          <KPICard title="Effectif moy." value={`${summary.effectif_moyen || 0}`} icon={Users} accent="slate" />
          <KPICard title="Rendement" value={`${rendement}`} unit="%" icon={BarChart3} accent="primary" />
        </div>

        {/* Charts row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Stacked bar: ligne + R3 */}
          <Section title="Entrées journalières (Ligne + R3)" className="lg:col-span-2">
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v) => `${Number(v).toLocaleString('fr-FR')} kg`} />
                  <Legend />
                  <Bar dataKey="ligne" name="Ligne R1&R2" stackId="a" fill="#0D9488" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="r3" name="R3 Recyclage" stackId="a" fill="#F59E0B" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-slate-400 text-center py-12">Aucune donnée</p>
            )}
          </Section>

          {/* Gauge */}
          <Section title="Progression objectif" bodyClassName="flex flex-col items-center justify-center">
            <div className="relative w-40 h-40">
              <svg className="w-40 h-40 transform -rotate-90" viewBox="0 0 120 120">
                <circle cx="60" cy="60" r="50" fill="none" stroke="#e5e7eb" strokeWidth="10" />
                <circle cx="60" cy="60" r="50" fill="none" stroke={gaugeColor} strokeWidth="10"
                  strokeDasharray={`${gaugeAngle} 314`} strokeLinecap="round"
                  style={{ transition: 'stroke-dasharray 0.6s ease' }} />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-3xl font-bold text-slate-800">{atteinte}%</span>
                <span className="text-xs text-slate-500">atteint</span>
              </div>
            </div>
            <p className="text-sm text-slate-600 mt-3">
              <span className="font-semibold">{summary.total_mois_t || 0} t</span> / {objectif} t
            </p>
          </Section>
        </div>

        {/* Productivite trend */}
        {chartData.length > 2 && (
          <Section title="Productivité journalière (kg/pers)">
            <ResponsiveContainer width="100%" height={220}>
              <ComposedChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v) => `${Number(v).toLocaleString('fr-FR')}`} />
                <ReferenceLine y={prodMoyenne} stroke="#94a3b8" strokeDasharray="5 5" label={{ value: `Moy: ${prodMoyenne}`, position: 'right', fontSize: 11 }} />
                <Bar dataKey="productivite" name="Productivité" fill="#6366F1" radius={[3, 3, 0, 0]} opacity={0.7} />
                <Line type="monotone" dataKey="effectif" name="Effectif" stroke="#EC4899" strokeWidth={2} yAxisId={0} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </Section>
        )}

        {/* Table */}
        <Section title="Détail journalier" padded={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50">
                  <th className="text-left px-4 py-3 font-medium text-slate-600">Date</th>
                  <th className="text-right px-4 py-3 font-medium text-slate-600">Effectif</th>
                  <th className="text-right px-4 py-3 font-medium text-slate-600">Entrée ligne</th>
                  <th className="text-right px-4 py-3 font-medium text-slate-600">Obj. ligne</th>
                  <th className="text-right px-4 py-3 font-medium text-slate-600">Entrée R3</th>
                  <th className="text-right px-4 py-3 font-medium text-slate-600">Obj. R3</th>
                  <th className="text-right px-4 py-3 font-medium text-slate-600">Total (t)</th>
                  <th className="text-right px-4 py-3 font-medium text-slate-600">Productivité</th>
                </tr>
              </thead>
              <tbody>
                {daily.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-400">Aucune donnée</td></tr>
                ) : (
                  daily.map((row, i) => {
                    const ligneOk = parseFloat(row.entree_ligne_kg) >= parseFloat(row.objectif_entree_ligne_kg || 0);
                    const r3Ok = parseFloat(row.entree_recyclage_r3_kg) >= parseFloat(row.objectif_entree_r3_kg || 0);
                    return (
                      <tr key={i} className="border-t border-slate-100 hover:bg-slate-50">
                        <td className="px-4 py-3 font-medium text-slate-800">{new Date(row.date).toLocaleDateString('fr-FR')}</td>
                        <td className="px-4 py-3 text-right text-slate-600">{row.effectif_reel}</td>
                        <td className={`px-4 py-3 text-right font-semibold ${ligneOk ? 'text-emerald-600' : 'text-red-500'}`}>
                          {Number(row.entree_ligne_kg).toLocaleString('fr-FR')}
                        </td>
                        <td className="px-4 py-3 text-right text-slate-400">{Number(row.objectif_entree_ligne_kg).toLocaleString('fr-FR')}</td>
                        <td className={`px-4 py-3 text-right font-semibold ${r3Ok ? 'text-emerald-600' : 'text-red-500'}`}>
                          {Number(row.entree_recyclage_r3_kg).toLocaleString('fr-FR')}
                        </td>
                        <td className="px-4 py-3 text-right text-slate-400">{Number(row.objectif_entree_r3_kg).toLocaleString('fr-FR')}</td>
                        <td className="px-4 py-3 text-right font-semibold text-primary">{row.total_jour_t}</td>
                        <td className="px-4 py-3 text-right text-slate-600">{row.productivite_kg_per} kg/p</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
              {daily.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
                    <td className="px-4 py-3">Totaux</td>
                    <td className="px-4 py-3 text-right">{summary.effectif_moyen}</td>
                    <td className="px-4 py-3 text-right">{Number(summary.total_entree_ligne_kg || 0).toLocaleString('fr-FR')}</td>
                    <td className="px-4 py-3 text-right text-slate-400">-</td>
                    <td className="px-4 py-3 text-right">{Number(summary.total_entree_r3_kg || 0).toLocaleString('fr-FR')}</td>
                    <td className="px-4 py-3 text-right text-slate-400">-</td>
                    <td className="px-4 py-3 text-right text-primary">{summary.total_mois_t} t</td>
                    <td className="px-4 py-3 text-right">{summary.productivite_moyenne} kg/p</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </Section>
      </div>
    </Layout>
  );
}
