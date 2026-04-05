import { useState, useEffect } from 'react';
import { Package, Plus } from 'lucide-react';
import Layout from '../components/Layout';
import { DataTable, LoadingSpinner } from '../components';
import api from '../services/api';

const QUALITE_COLORS = { A: 'bg-green-100 text-green-700', B: 'bg-yellow-100 text-yellow-700', C: 'bg-red-100 text-red-700' };

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

  if (loading) return <Layout><LoadingSpinner size="lg" message="Chargement des produits finis..." /></Layout>;

  const columns = [
    { key: 'barcode', label: 'Code-barres', sortable: true, render: (p) => <span className="font-mono text-sm">{p.barcode || '—'}</span> },
    { key: 'produit_nom', label: 'Produit', sortable: true, render: (p) => p.produit_nom || '—' },
    { key: 'poids_kg', label: 'Poids (kg)', sortable: true, render: (p) => <span className="font-medium">{p.poids_kg}</span> },
    {
      key: 'qualite',
      label: 'Qualité',
      sortable: true,
      render: (p) => (
        <span className={`px-2 py-1 rounded text-xs font-medium ${QUALITE_COLORS[p.qualite] || ''}`}>
          {p.qualite}
        </span>
      ),
    },
    { key: 'created_at', label: 'Date', sortable: true, render: (p) => <span className="text-xs text-slate-500">{new Date(p.created_at).toLocaleDateString('fr-FR')}</span> },
    {
      key: 'is_shipped',
      label: 'Statut',
      sortable: true,
      render: (p) => (
        <span className={`px-2 py-1 rounded text-xs font-medium ${p.is_shipped ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-700'}`}>
          {p.is_shipped ? 'Expédié' : 'En stock'}
        </span>
      ),
    },
  ];

  return (
    <Layout>
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Produits finis</h1>
            <p className="text-slate-500">Articles triés et conditionnés</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setView('list')} className={`px-3 py-1.5 rounded-lg text-sm ${view === 'list' ? 'bg-primary text-white' : 'bg-slate-100'}`}>Liste</button>
            <button onClick={() => setView('summary')} className={`px-3 py-1.5 rounded-lg text-sm ${view === 'summary' ? 'bg-primary text-white' : 'bg-slate-100'}`}>Synthèse</button>
            <button onClick={() => setShowForm(true)} className="btn-primary text-sm">
              <Plus className="w-4 h-4 mr-2" strokeWidth={1.8} />
              Ajouter
            </button>
          </div>
        </div>

        {view === 'summary' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
            {summary.map(s => (
              <div key={s.gamme || s.categorie} className="card-modern p-4">
                <h3 className="font-semibold">{s.gamme || s.categorie || 'Non classé'}</h3>
                <div className="mt-2 space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Articles</span>
                    <span className="font-medium">{s.count || 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Poids total</span>
                    <span className="font-medium">{parseFloat(s.total_kg || 0).toFixed(0)} kg</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {view === 'list' && (
          <DataTable
            columns={columns}
            data={products}
            loading={loading}
            emptyIcon={Package}
            emptyMessage="Aucun produit fini"
          />
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
                <button type="submit" className="flex-1 btn-primary text-sm">Créer</button>
              </div>
            </form>
          </div>
        )}
      </div>
    </Layout>
  );
}
