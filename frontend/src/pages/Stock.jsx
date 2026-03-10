import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import api from '../services/api';

export default function Stock() {
  const [summary, setSummary] = useState([]);
  const [movements, setMovements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [categories, setCategories] = useState([]);
  const [form, setForm] = useState({
    categorie_sortante_id: '', type: 'entree', quantity_kg: '', source: '', notes: '',
  });

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const [sumRes, movRes, catRes] = await Promise.all([
        api.get('/stock/summary'),
        api.get('/stock?limit=100'),
        api.get('/tri/categories'),
      ]);
      setSummary(sumRes.data?.byCategory || sumRes.data || []);
      setMovements(movRes.data);
      setCategories(catRes.data);
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  const createMovement = async (e) => {
    e.preventDefault();
    try {
      await api.post('/stock', {
        type: form.type,
        date: new Date().toISOString().split('T')[0],
        poids_kg: parseFloat(form.quantity_kg),
        matiere_id: form.categorie_sortante_id || null,
        destination: form.source || null,
        notes: form.notes || null,
      });
      setShowForm(false);
      loadData();
    } catch (err) { console.error(err); }
  };

  if (loading) return <Layout><div className="p-6">Chargement...</div></Layout>;

  const totalStock = summary.reduce((acc, s) => acc + (parseFloat(s.solde_kg || s.stock_kg) || 0), 0);

  return (
    <Layout>
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-solidata-dark">Gestion des stocks</h1>
            <p className="text-gray-500">Stock total : {(totalStock / 1000).toFixed(1)} tonnes</p>
          </div>
          <button onClick={() => setShowForm(true)} className="bg-solidata-green text-white px-4 py-2 rounded-lg hover:bg-solidata-green-dark text-sm font-medium">
            + Mouvement de stock
          </button>
        </div>

        {/* Summary by Category */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 mb-6">
          {summary.map(s => (
            <div key={s.categorie_id || s.categorie} className="bg-white rounded-xl shadow-sm border p-4">
              <p className="text-xs text-gray-500 truncate">{s.categorie_nom || s.categorie}</p>
              <p className="text-xl font-bold text-solidata-dark">{parseFloat(s.solde_kg || s.stock_kg || 0).toFixed(0)} <span className="text-xs font-normal text-gray-400">kg</span></p>
              <div className="mt-1 h-1.5 bg-gray-100 rounded-full">
                <div className="h-1.5 bg-solidata-green rounded-full" style={{ width: `${Math.min((parseFloat(s.solde_kg || s.stock_kg) / Math.max(totalStock, 1)) * 100 * 4, 100)}%` }}></div>
              </div>
            </div>
          ))}
        </div>

        {/* Movements Table */}
        <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
          <div className="p-3 border-b bg-gray-50">
            <h3 className="font-semibold text-sm">Derniers mouvements</h3>
          </div>
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left p-3 text-xs font-semibold text-gray-500">Date</th>
                <th className="text-left p-3 text-xs font-semibold text-gray-500">Catégorie</th>
                <th className="text-left p-3 text-xs font-semibold text-gray-500">Type</th>
                <th className="text-left p-3 text-xs font-semibold text-gray-500">Quantité (kg)</th>
                <th className="text-left p-3 text-xs font-semibold text-gray-500">Source</th>
                <th className="text-left p-3 text-xs font-semibold text-gray-500">Notes</th>
              </tr>
            </thead>
            <tbody>
              {movements.map(m => (
                <tr key={m.id} className="border-t hover:bg-gray-50">
                  <td className="p-3 text-sm">{new Date(m.date || m.created_at).toLocaleDateString('fr-FR')}</td>
                  <td className="p-3 text-sm">{m.matiere_categorie || m.categorie_nom || '—'}</td>
                  <td className="p-3">
                    <span className={`px-2 py-1 rounded text-xs font-medium ${m.type === 'entree' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      {m.type === 'entree' ? 'Entrée' : 'Sortie'}
                    </span>
                  </td>
                  <td className="p-3 text-sm font-medium">{m.poids_kg || m.quantity_kg}</td>
                  <td className="p-3 text-sm text-gray-500">{m.origine || m.destination || '—'}</td>
                  <td className="p-3 text-sm text-gray-400 max-w-[200px] truncate">{m.notes || '—'}</td>
                </tr>
              ))}
              {movements.length === 0 && (
                <tr><td colSpan="6" className="p-8 text-center text-gray-400">Aucun mouvement de stock</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Form */}
        {showForm && (
          <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
            <form onSubmit={createMovement} className="bg-white rounded-xl p-6 w-[400px] shadow-xl">
              <h2 className="text-lg font-bold mb-4">Mouvement de stock</h2>
              <div className="space-y-3">
                <select value={form.categorie_sortante_id} onChange={e => setForm({ ...form, categorie_sortante_id: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" required>
                  <option value="">Catégorie *</option>
                  {categories.map(c => <option key={c.id} value={c.id}>{c.nom}</option>)}
                </select>
                <select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm">
                  <option value="entree">Entrée</option>
                  <option value="sortie">Sortie</option>
                </select>
                <input type="number" placeholder="Quantité (kg) *" value={form.quantity_kg} onChange={e => setForm({ ...form, quantity_kg: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" required />
                <input placeholder="Source" value={form.source} onChange={e => setForm({ ...form, source: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" />
                <textarea placeholder="Notes" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" rows="2" />
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
