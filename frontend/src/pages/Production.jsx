import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import api from '../services/api';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';

export default function Production() {
  const [data, setData] = useState([]);
  const [dashboard, setDashboard] = useState(null);
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    effectif_reel: '', entree_ligne_kg: '', entree_recyclage_r3_kg: '',
    objectif_entree_ligne_kg: 1300, objectif_entree_r3_kg: 500, encadrant: '',
  });

  useEffect(() => { loadData(); }, [month]);

  const loadData = async () => {
    try {
      const [listRes, dashRes] = await Promise.all([
        api.get(`/production?month=${month}`),
        api.get(`/production/dashboard?month=${month}`),
      ]);
      setData(listRes.data);
      setDashboard(dashRes.data);
    } catch (err) { console.error(err); }
  };

  const createEntry = async (e) => {
    e.preventDefault();
    try {
      await api.post('/production', form);
      setShowForm(false);
      loadData();
    } catch (err) { console.error(err); }
  };

  const chartData = data.map(d => ({
    date: new Date(d.date).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }),
    ligne: d.entree_ligne_kg || 0,
    r3: d.entree_recyclage_r3_kg || 0,
    total: d.total_jour_t || 0,
  }));

  return (
    <Layout>
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-solidata-dark">Production</h1>
            <p className="text-gray-500">Suivi quotidien — KPI de production</p>
          </div>
          <div className="flex gap-2">
            <input type="month" value={month} onChange={e => setMonth(e.target.value)} className="border rounded-lg px-3 py-2 text-sm" />
            <button onClick={() => setShowForm(true)} className="bg-solidata-green text-white px-4 py-2 rounded-lg hover:bg-solidata-green-dark text-sm font-medium">
              + Saisie du jour
            </button>
          </div>
        </div>

        {/* Dashboard KPIs */}
        {dashboard && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <KPICard label="Total mois (t)" value={dashboard.total_month_t?.toFixed(1) || '0'} target={dashboard.objectif_mensuel_t} color="text-solidata-green" />
            <KPICard label="Moy. productivité" value={`${dashboard.avg_productivite?.toFixed(0) || '0'} kg/pers`} color="text-blue-600" />
            <KPICard label="Jours saisis" value={dashboard.nb_jours || 0} color="text-purple-600" />
            <KPICard label="Effectif moyen" value={dashboard.avg_effectif?.toFixed(1) || '0'} color="text-orange-600" />
          </div>
        )}

        {/* Chart */}
        <div className="bg-white rounded-xl shadow-sm border p-4 mb-6">
          <h3 className="font-semibold mb-3">Entrées quotidiennes (kg)</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} />
              <YAxis />
              <Tooltip />
              <ReferenceLine y={1300} stroke="#EF4444" strokeDasharray="5 5" label={{ value: 'Obj. 1300kg', fill: '#EF4444', fontSize: 10 }} />
              <Bar dataKey="ligne" name="Ligne qualité" fill="#8BC540" radius={[2, 2, 0, 0]} />
              <Bar dataKey="r3" name="Recyclage R3" fill="#6366F1" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Data Table */}
        <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left p-3 text-xs font-semibold text-gray-500">Date</th>
                <th className="text-left p-3 text-xs font-semibold text-gray-500">Effectif</th>
                <th className="text-left p-3 text-xs font-semibold text-gray-500">Entrée Ligne (kg)</th>
                <th className="text-left p-3 text-xs font-semibold text-gray-500">Obj. Ligne</th>
                <th className="text-left p-3 text-xs font-semibold text-gray-500">Entrée R3 (kg)</th>
                <th className="text-left p-3 text-xs font-semibold text-gray-500">Total (t)</th>
                <th className="text-left p-3 text-xs font-semibold text-gray-500">Productivité</th>
                <th className="text-left p-3 text-xs font-semibold text-gray-500">Encadrant</th>
              </tr>
            </thead>
            <tbody>
              {data.map(d => (
                <tr key={d.id} className="border-t hover:bg-gray-50">
                  <td className="p-3 text-sm font-medium">{new Date(d.date).toLocaleDateString('fr-FR')}</td>
                  <td className="p-3 text-sm">{d.effectif_reel}</td>
                  <td className="p-3 text-sm">
                    <span className={d.entree_ligne_kg >= d.objectif_entree_ligne_kg ? 'text-green-600 font-medium' : 'text-red-500'}>
                      {d.entree_ligne_kg}
                    </span>
                  </td>
                  <td className="p-3 text-sm text-gray-400">{d.objectif_entree_ligne_kg}</td>
                  <td className="p-3 text-sm">{d.entree_recyclage_r3_kg}</td>
                  <td className="p-3 text-sm font-medium">{d.total_jour_t?.toFixed(2)}</td>
                  <td className="p-3 text-sm">{d.productivite_kg_per?.toFixed(0)} kg/p</td>
                  <td className="p-3 text-sm text-gray-500">{d.encadrant || '—'}</td>
                </tr>
              ))}
              {data.length === 0 && (
                <tr><td colSpan="8" className="p-8 text-center text-gray-400">Aucune donnée pour ce mois</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Form */}
        {showForm && (
          <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
            <form onSubmit={createEntry} className="bg-white rounded-xl p-6 w-[440px] shadow-xl">
              <h2 className="text-lg font-bold mb-4">Saisie production</h2>
              <div className="space-y-3">
                <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" required />
                <input type="number" placeholder="Effectif réel *" value={form.effectif_reel} onChange={e => setForm({ ...form, effectif_reel: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" required />
                <div className="grid grid-cols-2 gap-3">
                  <input type="number" placeholder="Entrée ligne (kg)" value={form.entree_ligne_kg} onChange={e => setForm({ ...form, entree_ligne_kg: e.target.value })} className="border rounded-lg px-3 py-2 text-sm" />
                  <input type="number" placeholder="Objectif ligne" value={form.objectif_entree_ligne_kg} onChange={e => setForm({ ...form, objectif_entree_ligne_kg: e.target.value })} className="border rounded-lg px-3 py-2 text-sm" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <input type="number" placeholder="Entrée R3 (kg)" value={form.entree_recyclage_r3_kg} onChange={e => setForm({ ...form, entree_recyclage_r3_kg: e.target.value })} className="border rounded-lg px-3 py-2 text-sm" />
                  <input type="number" placeholder="Objectif R3" value={form.objectif_entree_r3_kg} onChange={e => setForm({ ...form, objectif_entree_r3_kg: e.target.value })} className="border rounded-lg px-3 py-2 text-sm" />
                </div>
                <input placeholder="Encadrant" value={form.encadrant} onChange={e => setForm({ ...form, encadrant: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" />
              </div>
              <div className="flex gap-2 mt-4">
                <button type="button" onClick={() => setShowForm(false)} className="flex-1 border rounded-lg py-2 text-sm">Annuler</button>
                <button type="submit" className="flex-1 bg-solidata-green text-white rounded-lg py-2 text-sm">Enregistrer</button>
              </div>
            </form>
          </div>
        )}
      </div>
    </Layout>
  );
}

function KPICard({ label, value, target, color }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border p-4">
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      {target && <p className="text-xs text-gray-400">Objectif : {target}t</p>}
    </div>
  );
}
