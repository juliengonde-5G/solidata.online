import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { LoadingSpinner } from '../components';
import api from '../services/api';

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

  return (
    <Layout>
      <div className="p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Reporting Production</h1>
            <p className="text-gray-500">KPI de production et tri</p>
          </div>
          <input
            type="month"
            value={month}
            onChange={e => setMonth(e.target.value)}
            className="input-modern w-auto"
          />
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <KPICard label="Total mois" value={`${summary.total_mois_t || 0} t`} icon="🏭" color="text-primary" />
          <KPICard label="Objectif mensuel" value={`${objectif} t`} icon="🎯" color="text-blue-600" />
          <KPICard
            label="Atteinte objectif"
            value={`${atteinte}%`}
            icon={atteinte >= 100 ? '✅' : '⚠️'}
            color={atteinte >= 100 ? 'text-primary' : atteinte >= 80 ? 'text-orange-500' : 'text-red-500'}
          />
          <KPICard label="Productivite moy." value={`${summary.productivite_moyenne || 0} kg/pers`} icon="📊" color="text-purple-600" />
        </div>

        {/* Summary table */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <div className="card-modern p-4">
            <h3 className="font-semibold text-slate-800 mb-3">Resume du mois</h3>
            <table className="w-full text-sm">
              <tbody>
                <tr className="border-b">
                  <td className="py-2 text-gray-600">Jours travailles</td>
                  <td className="py-2 text-right font-semibold">{summary.jours_travailles || 0}</td>
                </tr>
                <tr className="border-b">
                  <td className="py-2 text-gray-600">Effectif moyen</td>
                  <td className="py-2 text-right font-semibold">{summary.effectif_moyen || 0}</td>
                </tr>
                <tr className="border-b">
                  <td className="py-2 text-gray-600">Total entree ligne</td>
                  <td className="py-2 text-right font-semibold">{Number(summary.total_entree_ligne_kg || 0).toLocaleString('fr-FR')} kg</td>
                </tr>
                <tr className="border-b">
                  <td className="py-2 text-gray-600">Total entree R3</td>
                  <td className="py-2 text-right font-semibold">{Number(summary.total_entree_r3_kg || 0).toLocaleString('fr-FR')} kg</td>
                </tr>
                <tr className="border-b">
                  <td className="py-2 text-gray-600">Productivite moyenne</td>
                  <td className="py-2 text-right font-semibold">{summary.productivite_moyenne || 0} kg/pers</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Progress toward target */}
          <div className="card-modern p-4">
            <h3 className="font-semibold text-slate-800 mb-3">Progression vers objectif</h3>
            <div className="flex flex-col items-center justify-center h-full gap-4 py-4">
              <div className="relative w-40 h-40">
                <svg className="w-40 h-40 transform -rotate-90" viewBox="0 0 120 120">
                  <circle cx="60" cy="60" r="50" fill="none" stroke="#e5e7eb" strokeWidth="12" />
                  <circle
                    cx="60" cy="60" r="50" fill="none"
                    stroke={atteinte >= 100 ? '#8BC540' : atteinte >= 80 ? '#F59E0B' : '#EF4444'}
                    strokeWidth="12"
                    strokeDasharray={`${Math.min(atteinte, 100) * 3.14} 314`}
                    strokeLinecap="round"
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-3xl font-bold">{atteinte}%</span>
                  <span className="text-xs text-gray-500">atteint</span>
                </div>
              </div>
              <div className="text-center text-sm text-gray-600">
                <p><span className="font-semibold text-slate-800">{summary.total_mois_t || 0} t</span> / {objectif} t</p>
              </div>
            </div>
          </div>
        </div>

        {/* Daily KPI table */}
        <div className="card-modern">
          <div className="p-4 border-b">
            <h3 className="font-semibold text-slate-800">Detail journalier</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50">
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Date</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">Effectif</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">Entree ligne (kg)</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">Obj. ligne</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">Entree R3 (kg)</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">Obj. R3</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">Total jour (t)</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">Productivite</th>
                </tr>
              </thead>
              <tbody>
                {daily.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">Aucune donnee pour ce mois</td></tr>
                ) : (
                  daily.map((row, i) => {
                    const ligneOk = parseFloat(row.entree_ligne_kg) >= parseFloat(row.objectif_entree_ligne_kg || 0);
                    const r3Ok = parseFloat(row.entree_recyclage_r3_kg) >= parseFloat(row.objectif_entree_r3_kg || 0);
                    return (
                      <tr key={i} className="border-t hover:bg-gray-50">
                        <td className="px-4 py-3 font-medium">{new Date(row.date).toLocaleDateString('fr-FR')}</td>
                        <td className="px-4 py-3 text-right">{row.effectif_reel}</td>
                        <td className={`px-4 py-3 text-right font-semibold ${ligneOk ? 'text-primary' : 'text-red-500'}`}>
                          {Number(row.entree_ligne_kg).toLocaleString('fr-FR')}
                        </td>
                        <td className="px-4 py-3 text-right text-gray-400">{Number(row.objectif_entree_ligne_kg).toLocaleString('fr-FR')}</td>
                        <td className={`px-4 py-3 text-right font-semibold ${r3Ok ? 'text-primary' : 'text-red-500'}`}>
                          {Number(row.entree_recyclage_r3_kg).toLocaleString('fr-FR')}
                        </td>
                        <td className="px-4 py-3 text-right text-gray-400">{Number(row.objectif_entree_r3_kg).toLocaleString('fr-FR')}</td>
                        <td className="px-4 py-3 text-right font-semibold text-primary">{row.total_jour_t}</td>
                        <td className="px-4 py-3 text-right">{row.productivite_kg_per} kg/pers</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
              {daily.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 bg-gray-50 font-semibold">
                    <td className="px-4 py-3">Moyennes / Totaux</td>
                    <td className="px-4 py-3 text-right">{summary.effectif_moyen}</td>
                    <td className="px-4 py-3 text-right">{Number(summary.total_entree_ligne_kg || 0).toLocaleString('fr-FR')}</td>
                    <td className="px-4 py-3 text-right">-</td>
                    <td className="px-4 py-3 text-right">{Number(summary.total_entree_r3_kg || 0).toLocaleString('fr-FR')}</td>
                    <td className="px-4 py-3 text-right">-</td>
                    <td className="px-4 py-3 text-right text-primary">{summary.total_mois_t} t</td>
                    <td className="px-4 py-3 text-right">{summary.productivite_moyenne} kg/pers</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      </div>
    </Layout>
  );
}

function KPICard({ label, value, icon, color }) {
  return (
    <div className="card-modern p-4">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-lg">{icon}</span>
        <span className="text-xs text-gray-500">{label}</span>
      </div>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
    </div>
  );
}
