import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import api from '../services/api';

export default function ProduitsFinis() {
  const [products, setProducts] = useState([]);
  const [summary, setSummary] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('list');
  const [showForm, setShowForm] = useState(false);
  const [catalogue, setCatalogue] = useState([]);
  const [form, setForm] = useState({
    produit_catalogue_id: '', barcode: '', poids_kg: '', qualite: 'A', notes: '',
  });

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const [prodRes, sumRes, catRes] = await Promise.all([
        api.get('/produits-finis'),
        api.get('/produits-finis/summary'),
        api.get('/referentiels/catalogue'),
      ]);
      setProducts(prodRes.data);
      setSummary(sumRes.data);
      setCatalogue(catRes.data);
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  const createProduct = async (e) => {
    e.preventDefault();
    try {
      await api.post('/produits-finis', form);
      setShowForm(false);
      setForm({ produit_catalogue_id: '', barcode: '', poids_kg: '', qualite: 'A', notes: '' });
      loadData();
    } catch (err) { console.error(err); }
  };

  if (loading) return <Layout><div className="p-6">Chargement...</div></Layout>;

  return (
    <Layout>
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-solidata-dark">Produits finis</h1>
            <p className="text-gray-500">Articles triés et conditionnés</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setView('list')} className={`px-3 py-1.5 rounded-lg text-sm ${view === 'list' ? 'bg-solidata-green text-white' : 'bg-gray-100'}`}>Liste</button>
            <button onClick={() => setView('summary')} className={`px-3 py-1.5 rounded-lg text-sm ${view === 'summary' ? 'bg-solidata-green text-white' : 'bg-gray-100'}`}>Synthèse</button>
            <button onClick={() => setShowForm(true)} className="bg-solidata-green text-white px-4 py-2 rounded-lg hover:bg-solidata-green-dark text-sm font-medium">
              + Ajouter
            </button>
          </div>
        </div>

        {view === 'summary' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
            {summary.map(s => (
              <div key={s.gamme || s.categorie} className="bg-white rounded-xl shadow-sm border p-4">
                <h3 className="font-semibold">{s.gamme || s.categorie || 'Non classé'}</h3>
                <div className="mt-2 space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Articles</span>
                    <span className="font-medium">{s.count || 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Poids total</span>
                    <span className="font-medium">{parseFloat(s.total_kg || 0).toFixed(0)} kg</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {view === 'list' && (
          <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left p-3 text-xs font-semibold text-gray-500">Code-barres</th>
                  <th className="text-left p-3 text-xs font-semibold text-gray-500">Produit</th>
                  <th className="text-left p-3 text-xs font-semibold text-gray-500">Poids (kg)</th>
                  <th className="text-left p-3 text-xs font-semibold text-gray-500">Qualité</th>
                  <th className="text-left p-3 text-xs font-semibold text-gray-500">Date</th>
                  <th className="text-left p-3 text-xs font-semibold text-gray-500">Statut</th>
                </tr>
              </thead>
              <tbody>
                {products.map(p => (
                  <tr key={p.id} className="border-t hover:bg-gray-50">
                    <td className="p-3 text-sm font-mono">{p.barcode || '—'}</td>
                    <td className="p-3 text-sm">{p.produit_nom || '—'}</td>
                    <td className="p-3 text-sm">{p.poids_kg}</td>
                    <td className="p-3">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${
                        p.qualite === 'A' ? 'bg-green-100 text-green-700' :
                        p.qualite === 'B' ? 'bg-yellow-100 text-yellow-700' :
                        'bg-red-100 text-red-700'
                      }`}>
                        {p.qualite}
                      </span>
                    </td>
                    <td className="p-3 text-xs text-gray-500">{new Date(p.created_at).toLocaleDateString('fr-FR')}</td>
                    <td className="p-3">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${p.is_shipped ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-700'}`}>
                        {p.is_shipped ? 'Expédié' : 'En stock'}
                      </span>
                    </td>
                  </tr>
                ))}
                {products.length === 0 && (
                  <tr><td colSpan="6" className="p-8 text-center text-gray-400">Aucun produit fini</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Form */}
        {showForm && (
          <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
            <form onSubmit={createProduct} className="bg-white rounded-xl p-6 w-[400px] shadow-xl">
              <h2 className="text-lg font-bold mb-4">Nouveau produit fini</h2>
              <div className="space-y-3">
                <select value={form.produit_catalogue_id} onChange={e => setForm({ ...form, produit_catalogue_id: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" required>
                  <option value="">Produit catalogue *</option>
                  {catalogue.map(c => <option key={c.id} value={c.id}>{c.nom}</option>)}
                </select>
                <input placeholder="Code-barres" value={form.barcode} onChange={e => setForm({ ...form, barcode: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" />
                <input type="number" step="0.1" placeholder="Poids (kg)" value={form.poids_kg} onChange={e => setForm({ ...form, poids_kg: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" />
                <select value={form.qualite} onChange={e => setForm({ ...form, qualite: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm">
                  <option value="A">Qualité A — Premium</option>
                  <option value="B">Qualité B — Standard</option>
                  <option value="C">Qualité C — Déclassé</option>
                </select>
                <textarea placeholder="Notes" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className="w-full border rounded-lg px-3 py-2 text-sm" rows="2" />
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
