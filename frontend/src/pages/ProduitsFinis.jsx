import { useState, useEffect } from 'react';
import { Package, Plus } from 'lucide-react';
import Layout from '../components/Layout';
import { DataTable, LoadingSpinner, StatusBadge, Modal, PageHeader } from '../components';
import api from '../services/api';

export default function ProduitsFinis() {
  const [products, setProducts] = useState([]);
  const [summary, setSummary] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('list');
  const [showForm, setShowForm] = useState(false);
  const [catalogue, setCatalogue] = useState([]);
  const [form, setForm] = useState({
    catalogue_id: '', code_barre: '', poids_kg: '', gamme: 'A', date_fabrication: '',
  });
  const [submitError, setSubmitError] = useState(null);

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
    setSubmitError(null);
    try {
      await api.post('/produits-finis', form);
      setShowForm(false);
      setForm({ catalogue_id: '', code_barre: '', poids_kg: '', gamme: 'A', date_fabrication: '' });
      loadData();
    } catch (err) {
      const msg = err?.response?.data?.error || 'Erreur lors de la création du produit fini';
      setSubmitError(msg);
      console.error(err);
    }
  };

  if (loading) return <Layout><LoadingSpinner size="lg" message="Chargement des produits finis..." /></Layout>;

  const columns = [
    { key: 'code_barre', label: 'Code-barres', sortable: true, render: (p) => <span className="font-mono text-sm">{p.code_barre || '—'}</span> },
    { key: 'produit_nom', label: 'Produit', sortable: true, render: (p) => p.produit_nom || '—' },
    { key: 'poids_kg', label: 'Poids (kg)', sortable: true, render: (p) => <span className="font-medium">{p.poids_kg}</span> },
    {
      key: 'gamme',
      label: 'Gamme',
      sortable: true,
      render: (p) => <StatusBadge status={p.gamme} size="sm" />,
    },
    { key: 'date_fabrication', label: 'Fabriqué le', sortable: true, render: (p) => <span className="text-xs text-slate-500">{p.date_fabrication ? new Date(p.date_fabrication).toLocaleDateString('fr-FR') : '—'}</span> },
    {
      key: 'is_shipped',
      label: 'Statut',
      sortable: true,
      render: (p) => <StatusBadge status={p.is_shipped ? 'shipped' : 'pending'} size="sm" label={p.is_shipped ? 'Expediee' : 'En stock'} />,
    },
  ];

  return (
    <Layout>
      <div className="p-6">
        <PageHeader
          title="Produits finis"
          subtitle="Articles triés et conditionnés"
          icon={Package}
          actions={
            <div className="flex gap-2">
              <button onClick={() => setView('list')} className={`px-3 py-1.5 rounded-lg text-sm ${view === 'list' ? 'bg-primary text-white' : 'bg-slate-100'}`}>Liste</button>
              <button onClick={() => setView('summary')} className={`px-3 py-1.5 rounded-lg text-sm ${view === 'summary' ? 'bg-primary text-white' : 'bg-slate-100'}`}>Synthèse</button>
              <button onClick={() => setShowForm(true)} className="btn-primary text-sm">
                <Plus className="w-4 h-4 mr-2" strokeWidth={1.8} />
                Ajouter
              </button>
            </div>
          }
        />

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
        <Modal isOpen={showForm} onClose={() => setShowForm(false)} title="Nouveau produit fini" size="sm"
          footer={<>
            <button type="button" onClick={() => setShowForm(false)} className="flex-1 btn-ghost">Annuler</button>
            <button type="submit" form="produits-finis-form" className="flex-1 btn-primary text-sm">Créer</button>
          </>}
        >
          <form id="produits-finis-form" onSubmit={createProduct} className="space-y-3">
            {submitError && (
              <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {submitError}
              </div>
            )}
            <select value={form.catalogue_id} onChange={e => setForm({ ...form, catalogue_id: e.target.value })} className="input-modern" required aria-label="Produit catalogue">
              <option value="">Produit catalogue *</option>
              {catalogue.map(c => <option key={c.id} value={c.id}>{c.nom}</option>)}
            </select>
            <input placeholder="Code-barres *" value={form.code_barre} onChange={e => setForm({ ...form, code_barre: e.target.value })} className="input-modern" required aria-label="Code-barres" />
            <input type="number" step="0.1" min="0" placeholder="Poids (kg) *" value={form.poids_kg} onChange={e => setForm({ ...form, poids_kg: e.target.value })} className="input-modern" required aria-label="Poids en kg" />
            <select value={form.gamme} onChange={e => setForm({ ...form, gamme: e.target.value })} className="input-modern" aria-label="Gamme du produit">
              <option value="A">Gamme A — Premium</option>
              <option value="B">Gamme B — Standard</option>
              <option value="C">Gamme C — Déclassé</option>
            </select>
            <input type="date" value={form.date_fabrication} onChange={e => setForm({ ...form, date_fabrication: e.target.value })} className="input-modern" aria-label="Date de fabrication" />
          </form>
        </Modal>
      </div>
    </Layout>
  );
}
