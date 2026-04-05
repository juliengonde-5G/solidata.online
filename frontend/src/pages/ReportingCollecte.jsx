import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { LoadingSpinner } from '../components';
import api from '../services/api';

export default function ReportingCollecte() {
  const [period, setPeriod] = useState('month');
  const [dashboard, setDashboard] = useState(null);
  const [collecteData, setCollecteData] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadData(); }, [period]);

  const loadData = async () => {
    setLoading(true);
    try {
      const periodDays = period === 'week' ? 7 : period === 'month' ? 30 : period === 'quarter' ? 90 : 365;
      const groupBy = period === 'year' ? 'month' : 'day';

      const today = new Date();
      const dateFrom = new Date(today);
      dateFrom.setDate(today.getDate() - periodDays);
      const dateFromStr = dateFrom.toISOString().slice(0, 10);
      const dateToStr = today.toISOString().slice(0, 10);

      const [dashRes, collecteRes] = await Promise.all([
        api.get(`/reporting/dashboard?period=${periodDays}`),
        api.get(`/reporting/collecte?group_by=${groupBy}&date_from=${dateFromStr}&date_to=${dateToStr}`),
      ]);
      setDashboard(dashRes.data);
      setCollecteData(collecteRes.data);
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  if (loading) return <Layout><LoadingSpinner size="lg" message="Chargement..." /></Layout>;

  return (
    <Layout>
      <div className="p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Reporting Collecte</h1>
            <p className="text-gray-500">Tonnages, tournees et indicateurs de collecte</p>
          </div>
          <select value={period} onChange={e => setPeriod(e.target.value)} className="border rounded-lg px-3 py-2 text-sm">
            <option value="week">Cette semaine</option>
            <option value="month">Ce mois</option>
            <option value="quarter">Ce trimestre</option>
            <option value="year">Cette annee</option>
          </select>
        </div>

        {/* KPI Cards */}
        {dashboard && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <KPICard label="Tonnage collecte" value={`${dashboard.collecte?.tonnage_t || 0} t`} icon="♻️" color="text-primary" />
            <KPICard label="CO2 evite" value={`${dashboard.collecte?.co2_evite_kg || 0} kg`} icon="🌿" color="text-green-600" />
            <KPICard label="Tours realisees" value={dashboard.tours?.completed || 0} icon="🚛" color="text-orange-600" />
            <KPICard label="CAV actifs" value={dashboard.cav?.actifs || 0} icon="📍" color="text-teal-600" />
          </div>
        )}

        {/* Collecte table by period */}
        <div className="bg-white rounded-xl shadow-sm border mb-6">
          <div className="p-4 border-b">
            <h3 className="font-semibold text-slate-800">Collecte par periode</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50">
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Periode</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">Nb tournees</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">Total (kg)</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">Moyenne (kg)</th>
                </tr>
              </thead>
              <tbody>
                {collecteData.length === 0 ? (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400">Aucune donnee pour cette periode</td></tr>
                ) : (
                  collecteData.map((row, i) => (
                    <tr key={i} className="border-t hover:bg-gray-50">
                      <td className="px-4 py-3 font-medium">{row.periode}</td>
                      <td className="px-4 py-3 text-right">{row.nb_tours}</td>
                      <td className="px-4 py-3 text-right font-semibold text-primary">{Number(row.total_kg).toLocaleString('fr-FR')}</td>
                      <td className="px-4 py-3 text-right">{Number(row.avg_kg).toLocaleString('fr-FR')}</td>
                    </tr>
                  ))
                )}
              </tbody>
              {collecteData.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 bg-gray-50 font-semibold">
                    <td className="px-4 py-3">Total</td>
                    <td className="px-4 py-3 text-right">{collecteData.reduce((s, r) => s + parseInt(r.nb_tours || 0), 0)}</td>
                    <td className="px-4 py-3 text-right text-primary">
                      {collecteData.reduce((s, r) => s + parseFloat(r.total_kg || 0), 0).toLocaleString('fr-FR', { maximumFractionDigits: 1 })}
                    </td>
                    <td className="px-4 py-3 text-right">-</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>

        {/* Tours summary */}
        {dashboard && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white rounded-xl shadow-sm border p-4">
              <h3 className="font-semibold text-slate-800 mb-3">Resume des tournees</h3>
              <table className="w-full text-sm">
                <tbody>
                  <tr className="border-b">
                    <td className="py-2 text-gray-600">Total tournees</td>
                    <td className="py-2 text-right font-semibold">{dashboard.tours?.nb_tours || 0}</td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-2 text-gray-600">Completees</td>
                    <td className="py-2 text-right font-semibold text-primary">{dashboard.tours?.completed || 0}</td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-2 text-gray-600">Taux de completion</td>
                    <td className="py-2 text-right font-semibold">
                      {dashboard.tours?.nb_tours > 0
                        ? Math.round((dashboard.tours.completed / dashboard.tours.nb_tours) * 100)
                        : 0}%
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="bg-white rounded-xl shadow-sm border p-4">
              <h3 className="font-semibold text-slate-800 mb-3">CAV</h3>
              <table className="w-full text-sm">
                <tbody>
                  <tr className="border-b">
                    <td className="py-2 text-gray-600">CAV totaux</td>
                    <td className="py-2 text-right font-semibold">{dashboard.cav?.total || 0}</td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-2 text-gray-600">CAV actifs</td>
                    <td className="py-2 text-right font-semibold text-primary">{dashboard.cav?.actifs || 0}</td>
                  </tr>
                  <tr className="border-b">
                    <td className="py-2 text-gray-600">Tonnage total collecte</td>
                    <td className="py-2 text-right font-semibold">{dashboard.collecte?.tonnage_t || 0} t</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
}

function KPICard({ label, value, icon, color }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border p-4">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-lg">{icon}</span>
        <span className="text-xs text-gray-500">{label}</span>
      </div>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
    </div>
  );
}
