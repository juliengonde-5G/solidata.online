import { useState, useEffect } from 'react';
import { Package, Plus } from 'lucide-react';
import Layout from '../components/Layout';
import { DataTable, LoadingSpinner, StatusBadge, Modal, PageHeader } from '../components';
import api from '../services/api';

const EMPTY_FORM = { poste_id: '', produit_idx: '', genre: '', saison: '', gamme: '', poids_kg: '' };

export default function ProduitsFinis() {
  const [products, setProducts] = useState([]);
  const [summary, setSummary] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('list');
  const [showForm, setShowForm] = useState(false);
  // Voie manuelle harmonisée avec la voie étiquette : poste + catalogue dérivé,
  // code-barres généré côté serveur (item 32). On réutilise les référentiels
  // du module Étiquettes (options + dimensions + postes).
  const [postes, setPostes] = useState([]);
  const [options, setOptions] = useState([]);
  const [dimensions, setDimensions] = useState({ categorie_eco_org: [], genre: [], saison: [], gamme: [] });
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [submitError, setSubmitError] = useState(null);
  const [submitSuccess, setSubmitSuccess] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    try {
      const [prodRes, sumRes, postesRes, optRes, dimRes] = await Promise.all([
        api.get('/produits-finis'),
        api.get('/produits-finis/summary'),
        api.get('/etiquettes/postes'),
        api.get('/etiquettes/options'),
        api.get('/etiquettes/dimensions'),
      ]);
      setProducts(prodRes.data);
      setSummary(sumRes.data);
      setPostes(postesRes.data || []);
      setOptions(optRes.data || []);
      setDimensions(dimRes.data || { categorie_eco_org: [], genre: [], saison: [], gamme: [] });
      setForm(f => ({
        ...f,
        poste_id: f.poste_id || (postesRes.data?.[0]?.id ?? ''),
      }));
    } catch (err) {
      setSubmitError(err.response?.data?.error || 'Erreur lors du chargement des produits finis.');
    }
    setLoading(false);
  };

  const openForm = () => {
    setSubmitError(null);
    setSubmitSuccess(null);
    setForm({
      ...EMPTY_FORM,
      poste_id: postes[0]?.id ?? '',
      genre: dimensions.genre?.[0] || '',
      saison: dimensions.saison?.[0] || 'Sans Saison',
      gamme: dimensions.gamme?.[0] || '',
    });
    setShowForm(true);
  };

  const createProduct = async (e) => {
    e.preventDefault();
    setSubmitError(null);
    setSubmitSuccess(null);
    const opt = options[Number(form.produit_idx)];
    if (!form.poste_id || !opt || !form.genre || !form.gamme || !form.poids_kg) {
      setSubmitError('Poste, produit, genre, gamme et poids sont requis.');
      return;
    }
    setSubmitting(true);
    try {
      const { data } = await api.post('/produits-finis', {
        poste_id: form.poste_id,
        produit: opt.nom,
        categorie_eco_org: opt.categorie_eco_org,
        genre: form.genre,
        saison: form.saison || 'Sans Saison',
        gamme: form.gamme,
        poids_kg: parseFloat(form.poids_kg),
      });
      setSubmitSuccess(`Produit fini créé — code-barres généré : ${data.code_barre}`);
      setForm(f => ({ ...EMPTY_FORM, poste_id: f.poste_id, genre: f.genre, saison: f.saison, gamme: f.gamme }));
      loadData();
    } catch (err) {
      setSubmitError(err?.response?.data?.error || 'Erreur lors de la création du produit fini');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <Layout><LoadingSpinner size="lg" message="Chargement des produits finis..." /></Layout>;

  const columns = [
    { key: 'code_barre', label: 'Code-barres', sortable: true, render: (p) => <span className="font-mono text-sm">{p.code_barre || '—'}</span> },
    { key: 'produit_nom', label: 'Produit', sortable: true, render: (p) => p.produit_nom || p.produit || '—' },
    { key: 'poids_kg', label: 'Poids (kg)', sortable: true, render: (p) => <span className="font-medium">{p.poids_kg}</span> },
    {
      key: 'gamme',
      label: 'Gamme',
      sortable: true,
      render: (p) => <StatusBadge status={p.gamme} size="sm" />,
    },
    { key: 'source', label: 'Origine', render: (p) => <span className="text-xs text-slate-500">{{ etiquette: 'Étiquette', manuel: 'Manuel', balance: 'Balance' }[p.source] || '—'}</span> },
    { key: 'date_fabrication', label: 'Fabriqué le', sortable: true, render: (p) => <span className="text-xs text-slate-500">{p.date_fabrication ? new Date(p.date_fabrication).toLocaleDateString('fr-FR') : '—'}</span> },
    {
      key: 'is_shipped',
      label: 'Statut',
      sortable: true,
      render: (p) => <StatusBadge status={p.is_shipped ? 'shipped' : 'pending'} size="sm" label={p.is_shipped ? 'Expediee' : 'En stock'} />,
    },
  ];

  const filteredProduits = form.produit_idx !== '' ? options[Number(form.produit_idx)] : null;

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
              <button onClick={openForm} className="btn-primary text-sm">
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
                    <span className="font-medium">{s.nb_produits ?? s.count ?? 0}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Poids total</span>
                    <span className="font-medium">{parseFloat(s.poids_total_kg ?? s.total_kg ?? 0).toFixed(0)} kg</span>
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

        {/* Form manuel — mêmes champs que la voie étiquette, code-barres généré */}
        <Modal isOpen={showForm} onClose={() => setShowForm(false)} title="Nouveau produit fini" size="sm"
          footer={<>
            <button type="button" onClick={() => setShowForm(false)} className="flex-1 btn-ghost">Fermer</button>
            <button type="submit" form="produits-finis-form" disabled={submitting} className="flex-1 btn-primary text-sm">{submitting ? '…' : 'Créer'}</button>
          </>}
        >
          <form id="produits-finis-form" onSubmit={createProduct} className="space-y-3">
            {submitError && (
              <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {submitError}
              </div>
            )}
            {submitSuccess && (
              <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
                {submitSuccess}
              </div>
            )}
            <p className="text-xs text-slate-400">Le code-barres est généré automatiquement (poste + compteur), comme à l'étiquetage.</p>
            <select value={form.poste_id} onChange={e => setForm({ ...form, poste_id: e.target.value })} className="input-modern" required aria-label="Poste">
              <option value="">Poste *</option>
              {postes.map(p => <option key={p.id} value={p.id}>{p.nom}</option>)}
            </select>
            <select value={form.produit_idx} onChange={e => setForm({ ...form, produit_idx: e.target.value })} className="input-modern" required aria-label="Produit catalogue">
              <option value="">Produit *</option>
              {options.map((o, i) => <option key={o.id} value={i}>{o.nom} — {o.categorie_eco_org}</option>)}
            </select>
            {filteredProduits && (
              <p className="text-xs text-slate-500">Catégorie : <span className="font-medium">{filteredProduits.categorie_eco_org}</span></p>
            )}
            <div className="grid grid-cols-3 gap-2">
              <select value={form.genre} onChange={e => setForm({ ...form, genre: e.target.value })} className="input-modern" required aria-label="Genre">
                <option value="">Genre *</option>
                {(dimensions.genre || []).map(g => <option key={g} value={g}>{g}</option>)}
              </select>
              <select value={form.saison} onChange={e => setForm({ ...form, saison: e.target.value })} className="input-modern" aria-label="Saison">
                <option value="">Saison</option>
                {(dimensions.saison || []).map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <select value={form.gamme} onChange={e => setForm({ ...form, gamme: e.target.value })} className="input-modern" required aria-label="Gamme">
                <option value="">Gamme *</option>
                {(dimensions.gamme || []).map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
            <input type="number" step="0.1" min="0" placeholder="Poids (kg) *" value={form.poids_kg} onChange={e => setForm({ ...form, poids_kg: e.target.value })} className="input-modern" required aria-label="Poids en kg" />
          </form>
        </Modal>
      </div>
    </Layout>
  );
}
