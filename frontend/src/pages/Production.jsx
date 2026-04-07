import { useState, useEffect } from 'react';
import { Factory, Plus } from 'lucide-react';
import Layout from '../components/Layout';
import { DataTable, Modal } from '../components';
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

  const columns = [
    { key: 'date', label: 'Date', sortable: true, render: (d) => <span className="font-medium">{new Date(d.date).toLocaleDateString('fr-FR')}</span> },
    { key: 'effectif_reel', label: 'Effectif', sortable: true },
    {
      key: 'entree_ligne_kg',
      label: 'Entrée Ligne (kg)',
      sortable: true,
      render: (d) => (
        <span className={d.entree_ligne_kg >= d.objectif_entree_ligne_kg ? 'text-green-600 font-medium' : 'text-red-500'}>
          {d.entree_ligne_kg}
        </span>
      ),
    },
    { key: 'objectif_entree_ligne_kg', label: 'Obj. Ligne', render: (d) => <span className="text-slate-400">{d.objectif_entree_ligne_kg}</span> },
    { key: 'entree_recyclage_r3_kg', label: 'Entrée R3 (kg)', sortable: true },
    { key: 'total_jour_t', label: 'Total (t)', sortable: true, render: (d) => <span className="font-medium">{d.total_jour_t?.toFixed(2)}</span> },
    { key: 'productivite', label: 'Productivité', sortable: true, render: (d) => `${d.productivite_kg_per?.toFixed(0)} kg/p` },
    { key: 'encadrant', label: 'Encadrant', render: (d) => <span className="text-slate-500">{d.encadrant || '—'}</span> },
  ];

  return (
    <Layout>
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Production</h1>
            <p className="text-slate-500">Suivi quotidien — KPI de production</p>
          </div>
          <div className="flex gap-2">
            <input type="month" value={month} onChange={e => setMonth(e.target.value)} className="input-modern w-auto" />
            <button onClick={() => setShowForm(true)} className="btn-primary text-sm">
              <Plus className="w-4 h-4 mr-2" strokeWidth={1.8} />
              Saisie du jour
            </button>
          </div>
        </div>

        {/* Dashboard KPIs */}
        {dashboard && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <KPICard label="Total mois (t)" value={dashboard.total_month_t?.toFixed(1) || '0'} target={dashboard.objectif_mensuel_t} color="text-primary" />
            <KPICard label="Moy. productivité" value={`${dashboard.avg_productivite?.toFixed(0) || '0'} kg/pers`} color="text-blue-600" />
            <KPICard label="Jours saisis" value={dashboard.nb_jours || 0} color="text-purple-600" />
            <KPICard label="Effectif moyen" value={dashboard.avg_effectif?.toFixed(1) || '0'} color="text-orange-600" />
          </div>
        )}

        {/* Chart */}
        <div className="card-modern p-4 mb-6">
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
        <DataTable
          columns={columns}
          data={data}
          loading={false}
          emptyIcon={Factory}
          emptyMessage="Aucune donnée pour ce mois"
          dense
        />

        {/* Form */}
        <Modal isOpen={showForm} onClose={() => setShowForm(false)} title="Saisie production" size="sm"
          footer={<>
            <button type="button" onClick={() => setShowForm(false)} className="flex-1 btn-ghost">Annuler</button>
            <button type="submit" form="production-form" className="flex-1 btn-primary text-sm">Enregistrer</button>
          </>}
        >
          <form id="production-form" onSubmit={createEntry} className="space-y-3">
            <input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} className="input-modern" required />
            <input type="number" placeholder="Effectif réel *" value={form.effectif_reel} onChange={e => setForm({ ...form, effectif_reel: e.target.value })} className="input-modern" required />
            <div className="grid grid-cols-2 gap-3">
              <input type="number" placeholder="Entrée ligne (kg)" value={form.entree_ligne_kg} onChange={e => setForm({ ...form, entree_ligne_kg: e.target.value })} className="input-modern" />
              <input type="number" placeholder="Objectif ligne" value={form.objectif_entree_ligne_kg} onChange={e => setForm({ ...form, objectif_entree_ligne_kg: e.target.value })} className="input-modern" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <input type="number" placeholder="Entrée R3 (kg)" value={form.entree_recyclage_r3_kg} onChange={e => setForm({ ...form, entree_recyclage_r3_kg: e.target.value })} className="input-modern" />
              <input type="number" placeholder="Objectif R3" value={form.objectif_entree_r3_kg} onChange={e => setForm({ ...form, objectif_entree_r3_kg: e.target.value })} className="input-modern" />
            </div>
            <input placeholder="Encadrant" value={form.encadrant} onChange={e => setForm({ ...form, encadrant: e.target.value })} className="input-modern" />
          </form>
        </Modal>
      </div>
    </Layout>
  );
}

function KPICard({ label, value, target, color }) {
  return (
    <div className="card-modern p-4">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      {target && <p className="text-xs text-slate-400">Objectif : {target}t</p>}
    </div>
  );
}
