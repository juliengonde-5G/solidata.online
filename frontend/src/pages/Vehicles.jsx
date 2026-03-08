import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import api from '../services/api';

const STATUS_COLORS = { available: 'bg-green-100 text-green-700', in_use: 'bg-blue-100 text-blue-700', maintenance: 'bg-orange-100 text-orange-700', out_of_service: 'bg-red-100 text-red-700' };
const STATUS_LABELS = { available: 'Disponible', in_use: 'En tournée', maintenance: 'Maintenance', out_of_service: 'Hors service' };

export default function Vehicles() {
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    registration: '', brand: '', model: '', type: 'camion', capacity_kg: 3500,
    next_maintenance: '', insurance_expiry: '',
  });

  useEffect(() => { loadVehicles(); }, []);

  const loadVehicles = async () => {
    try {
      const res = await api.get('/vehicles');
      setVehicles(res.data);
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  const createVehicle = async (e) => {
    e.preventDefault();
    try {
      await api.post('/vehicles', form);
      setShowForm(false);
      setForm({ registration: '', brand: '', model: '', type: 'camion', capacity_kg: 3500, next_maintenance: '', insurance_expiry: '' });
      loadVehicles();
    } catch (err) { console.error(err); }
  };

  if (loading) return <Layout><div className="p-6">Chargement...</div></Layout>;

  return (
    <Layout>
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-solidata-dark">Véhicules</h1>
            <p className="text-gray-500">Gestion de la flotte — {vehicles.length} véhicule{vehicles.length > 1 ? 's' : ''}</p>
          </div>
          <button onClick={() => setShowForm(true)} className="bg-solidata-green text-white px-4 py-2 rounded-lg hover:bg-solidata-green-dark text-sm font-medium">
            + Nouveau véhicule
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {vehicles.map(v => (
            <div key={v.id} className="bg-white rounded-xl shadow-sm border p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-solidata-green/10 flex items-center justify-center text-solidata-green text-lg">
                    {v.type === 'camion' ? '🚛' : v.type === 'utilitaire' ? '🚐' : '🚗'}
                  </div>
                  <div>
                    <h3 className="font-bold">{v.registration}</h3>
                    <p className="text-xs text-gray-400">{v.brand} {v.model}</p>
                  </div>
                </div>
                <span className={`px-2 py-1 rounded text-xs font-medium ${STATUS_COLORS[v.status] || ''}`}>
                  {STATUS_LABELS[v.status] || v.status}
                </span>
              </div>
              <div className="space-y-1 text-xs text-gray-600">
                <p><span className="text-gray-400">Capacité :</span> {v.capacity_kg} kg</p>
                <p><span className="text-gray-400">Type :</span> {v.type}</p>
                {v.next_maintenance && (
                  <p><span className="text-gray-400">Proch. maintenance :</span> {new Date(v.next_maintenance).toLocaleDateString('fr-FR')}</p>
                )}
                {v.insurance_expiry && (
                  <p><span className="text-gray-400">Assurance :</span> {new Date(v.insurance_expiry).toLocaleDateString('fr-FR')}</p>
                )}
              </div>
            </div>
          ))}
          {vehicles.length === 0 && (
            <div className="col-span-full bg-white rounded-xl shadow-sm border p-8 text-center text-gray-400">Aucun véhicule enregistré</div>
          )}
        </div>

        {/* Form */}
        {showForm && (
          <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
            <form onSubmit={createVehicle} className="bg-white rounded-xl p-6 w-[400px] shadow-xl">
              <h2 className="text-lg font-bold mb-4">Nouveau véhicule</h2>
              <div className="space-y-3">
                <input placeholder="Immatriculation *" value={form.registration} onChange={e => setForm({ ...form, registration: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" required />
                <div className="grid grid-cols-2 gap-3">
                  <input placeholder="Marque" value={form.brand} onChange={e => setForm({ ...form, brand: e.target.value })} className="border rounded-lg px-3 py-2 text-sm" />
                  <input placeholder="Modèle" value={form.model} onChange={e => setForm({ ...form, model: e.target.value })} className="border rounded-lg px-3 py-2 text-sm" />
                </div>
                <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm">
                  <option value="camion">Camion</option>
                  <option value="utilitaire">Utilitaire</option>
                  <option value="voiture">Voiture</option>
                </select>
                <div>
                  <label className="text-xs text-gray-500">Capacité (kg)</label>
                  <input type="number" value={form.capacity_kg} onChange={e => setForm({ ...form, capacity_kg: parseInt(e.target.value) || 0 })} className="w-full border rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Prochaine maintenance</label>
                  <input type="date" value={form.next_maintenance} onChange={e => setForm({ ...form, next_maintenance: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Expiration assurance</label>
                  <input type="date" value={form.insurance_expiry} onChange={e => setForm({ ...form, insurance_expiry: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>
              <div className="flex gap-2 mt-4">
                <button type="button" onClick={() => setShowForm(false)} className="flex-1 border rounded-lg py-2 text-sm">Annuler</button>
                <button type="submit" className="flex-1 bg-solidata-green text-white rounded-lg py-2 text-sm">Créer</button>
              </div>
            </form>
          </div>
        )}
      </div>
    </Layout>
  );
}
