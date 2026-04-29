import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { LoadingSpinner, KPICard, PageHeader, Section, DateRangePicker } from '../components';
import api from '../services/api';
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { Truck, Leaf, MapPin, Target, BarChart3 } from 'lucide-react';

// ══════════════════════════════════════════
// REPORTING COLLECTE — enrichi avec graphiques
// ══════════════════════════════════════════

const STATUS_COLORS = { completed: '#0D9488', in_progress: '#F59E0B', cancelled: '#EF4444', planned: '#6366F1' };

function defaultRange(days = 30) {
  const to = new Date();
  const from = new Date();
  from.setDate(to.getDate() - (days - 1));
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

export default function ReportingCollecte() {
  const [range, setRange] = useState(() => defaultRange(30));
  const [dashboard, setDashboard] = useState(null);
  const [collecteData, setCollecteData] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadData(); }, [range.from, range.to]);

  const loadData = async () => {
    setLoading(true);
    try {
      const periodDays = Math.max(1, Math.round((new Date(range.to) - new Date(range.from)) / 86400000) + 1);
      // Plus de 100 jours → on agrège par mois pour ne pas exploser le graphique.
      const groupBy = periodDays > 100 ? 'month' : 'day';
      const [dashRes, collecteRes] = await Promise.all([
        api.get(`/reporting/dashboard?period=${periodDays}`),
        api.get(`/reporting/collecte?group_by=${groupBy}&date_from=${range.from}&date_to=${range.to}`),
      ]);
      setDashboard(dashRes.data);
      setCollecteData(collecteRes.data);
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  if (loading) return <Layout><LoadingSpinner size="lg" message="Chargement..." /></Layout>;

  const totalKg = collecteData.reduce((s, r) => s + parseFloat(r.total_kg || 0), 0);
  const totalTours = collecteData.reduce((s, r) => s + parseInt(r.nb_tours || 0), 0);
  const avgKgTour = totalTours > 0 ? Math.round(totalKg / totalTours) : 0;
  const co2Evite = Math.round(totalKg * 1.567 / 1000);
  const tauxCompletion = dashboard?.tours?.nb_tours > 0 ? Math.round((dashboard.tours.completed / dashboard.tours.nb_tours) * 100) : 0;

  // Chart data
  const chartData = collecteData.map(r => ({
    periode: r.periode.length > 10 ? r.periode.slice(5) : r.periode.slice(5),
    kg: parseFloat(r.total_kg || 0),
    tours: parseInt(r.nb_tours || 0),
    avg: parseFloat(r.avg_kg || 0),
  }));

  // Tours by status for donut
  const toursByStatus = dashboard ? [
    { name: 'Terminées', value: parseInt(dashboard.tours?.completed || 0), color: STATUS_COLORS.completed },
    { name: 'En cours', value: Math.max(0, parseInt(dashboard.tours?.nb_tours || 0) - parseInt(dashboard.tours?.completed || 0)), color: STATUS_COLORS.in_progress },
  ].filter(d => d.value > 0) : [];

  return (
    <Layout>
      <div className="space-y-6">
        <PageHeader
          title="Reporting Collecte"
          subtitle="Tonnages, tournées et indicateurs de collecte"
          icon={Truck}
          actions={
            <DateRangePicker
              mode="range"
              allowSingleToggle
              value={range}
              onChange={setRange}
              align="right"
            />
          }
        />

        {/* KPI Cards */}
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <KPICard title="Tonnage collecté" value={`${(totalKg / 1000).toFixed(1)}`} unit="t" icon={Truck} accent="primary" />
          <KPICard title="CO2 évité" value={co2Evite} unit="kg" icon={Leaf} accent="emerald" />
          <KPICard title="Tours réalisées" value={dashboard?.tours?.completed || 0} icon={Target} accent="amber" />
          <KPICard title="Kg moyen/tour" value={avgKgTour.toLocaleString('fr-FR')} unit="kg" icon={BarChart3} accent="primary" />
          <KPICard title="CAV actifs" value={dashboard?.cav?.actifs || 0} icon={MapPin} accent="slate" />
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Bar chart tonnage */}
          <Section title="Tonnage collecté par période" className="lg:col-span-2">
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="periode" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v) => `${Number(v).toLocaleString('fr-FR')} kg`} />
                  <Bar dataKey="kg" name="Tonnage (kg)" fill="#0D9488" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-slate-400 text-center py-12">Aucune donnée</p>
            )}
          </Section>

          {/* Donut tours par statut */}
          <Section title="Taux de complétion">
            <div className="flex flex-col items-center">
              <div className="relative">
                <ResponsiveContainer width={180} height={180}>
                  <PieChart>
                    <Pie data={toursByStatus} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={55} outerRadius={80} paddingAngle={3}>
                      {toursByStatus.map((d, i) => <Cell key={i} fill={d.color} />)}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-2xl font-bold text-slate-800">{tauxCompletion}%</span>
                </div>
              </div>
              <div className="flex gap-4 mt-3">
                {toursByStatus.map((d, i) => (
                  <div key={i} className="flex items-center gap-1.5 text-xs text-slate-600">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: d.color }} />
                    {d.name} ({d.value})
                  </div>
                ))}
              </div>
            </div>
          </Section>
        </div>

        {/* Trend line chart */}
        {chartData.length > 2 && (
          <Section title="Tendance kg moyen par tour">
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="periode" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v) => `${Number(v).toLocaleString('fr-FR')} kg`} />
                <Line type="monotone" dataKey="avg" name="Moy. kg/tour" stroke="#F59E0B" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </Section>
        )}

        {/* Table */}
        <Section title="Détail par période" padded={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50">
                  <th className="text-left px-4 py-3 font-medium text-slate-600">Période</th>
                  <th className="text-right px-4 py-3 font-medium text-slate-600">Nb tournées</th>
                  <th className="text-right px-4 py-3 font-medium text-slate-600">Total (kg)</th>
                  <th className="text-right px-4 py-3 font-medium text-slate-600">Moyenne (kg)</th>
                </tr>
              </thead>
              <tbody>
                {collecteData.length === 0 ? (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-400">Aucune donnée pour cette période</td></tr>
                ) : (
                  collecteData.map((row, i) => (
                    <tr key={i} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-800">{row.periode}</td>
                      <td className="px-4 py-3 text-right text-slate-600">{row.nb_tours}</td>
                      <td className="px-4 py-3 text-right font-semibold text-primary">{Number(row.total_kg).toLocaleString('fr-FR')}</td>
                      <td className="px-4 py-3 text-right text-slate-600">{Number(row.avg_kg).toLocaleString('fr-FR')}</td>
                    </tr>
                  ))
                )}
              </tbody>
              {collecteData.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
                    <td className="px-4 py-3">Total</td>
                    <td className="px-4 py-3 text-right">{totalTours}</td>
                    <td className="px-4 py-3 text-right text-primary">{totalKg.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}</td>
                    <td className="px-4 py-3 text-right">{avgKgTour.toLocaleString('fr-FR')}</td>
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
