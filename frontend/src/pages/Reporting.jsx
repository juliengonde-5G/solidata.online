import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { LoadingSpinner } from '../components';
import api from '../services/api';
import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

const COLORS = ['#8BC540', '#3B82F6', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#6366F1', '#14B8A6'];

export default function Reporting() {
  const [dashboard, setDashboard] = useState(null);
  const [collecteData, setCollecteData] = useState([]);
  const [period, setPeriod] = useState('month');
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadData(); }, [period]);

  const loadData = async () => {
    try {
      const [dashRes, collecteRes] = await Promise.all([
        api.get('/reporting/dashboard'),
        api.get(`/reporting/collecte?period=${period}`),
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
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Reporting</h1>
            <p className="text-gray-500">Tableau de bord et indicateurs</p>
          </div>
          <select value={period} onChange={e => setPeriod(e.target.value)} className="input-modern w-auto">
            <option value="week">Cette semaine</option>
            <option value="month">Ce mois</option>
            <option value="quarter">Ce trimestre</option>
            <option value="year">Cette année</option>
          </select>
        </div>

        {/* KPI Cards */}
        {dashboard && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <KPICard label="Tonnage collecté" value={`${dashboard.collecte_tonnage?.toFixed(1) || 0}t`} icon="♻️" color="text-primary" />
            <KPICard label="CO₂ économisé" value={`${dashboard.co2_saved?.toFixed(0) || 0} kg`} icon="🌿" color="text-green-600" />
            <KPICard label="Candidatures" value={dashboard.candidates_count || 0} icon="👥" color="text-blue-600" />
            <KPICard label="Collaborateurs" value={dashboard.employees_count || 0} icon="🏢" color="text-purple-600" />
            <KPICard label="Tours réalisées" value={dashboard.tours_completed || 0} icon="🚛" color="text-orange-600" />
            <KPICard label="CAV actifs" value={dashboard.cav_active || 0} icon="📍" color="text-teal-600" />
            <KPICard label="CA facturé" value={`${(dashboard.billing_total || 0).toFixed(0)}€`} icon="💰" color="text-yellow-600" />
            <KPICard label="Production (t)" value={`${(dashboard.production_total_t || 0).toFixed(1)}t`} icon="🏭" color="text-indigo-600" />
          </div>
        )}

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Collecte Chart */}
          <div className="bg-white rounded-xl shadow-sm border p-4">
            <h3 className="font-semibold mb-3">Collecte par période (kg)</h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={collecteData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="period" tick={{ fontSize: 10 }} />
                <YAxis />
                <Tooltip />
                <Bar dataKey="total_kg" name="Poids (kg)" fill="#8BC540" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Tours Status */}
          {dashboard?.tours_by_status && (
            <div className="bg-white rounded-xl shadow-sm border p-4">
              <h3 className="font-semibold mb-3">Répartition des tournées</h3>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={Object.entries(dashboard.tours_by_status).map(([k, v]) => ({ name: k, value: v }))}
                    cx="50%" cy="50%" outerRadius={100}
                    dataKey="value" label={({ name, value }) => `${name}: ${value}`}
                  >
                    {Object.keys(dashboard.tours_by_status).map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Production Trend */}
          {dashboard?.production_trend && (
            <div className="bg-white rounded-xl shadow-sm border p-4">
              <h3 className="font-semibold mb-3">Tendance production (t/jour)</h3>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={dashboard.production_trend}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                  <YAxis />
                  <Tooltip />
                  <Line type="monotone" dataKey="total_jour_t" name="Total (t)" stroke="#8BC540" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="productivite" name="Productivité" stroke="#6366F1" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Candidates by Status */}
          {dashboard?.candidates_by_status && (
            <div className="bg-white rounded-xl shadow-sm border p-4">
              <h3 className="font-semibold mb-3">Candidatures par statut</h3>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={Object.entries(dashboard.candidates_by_status).map(([k, v]) => ({ name: k, value: v }))}
                    cx="50%" cy="50%" outerRadius={100}
                    dataKey="value" label={({ name, value }) => `${name}: ${value}`}
                  >
                    {Object.keys(dashboard.candidates_by_status).map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
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
