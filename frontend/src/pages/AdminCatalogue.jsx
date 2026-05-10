import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { Tag, Plus, ToggleLeft, ToggleRight, Trash2 } from 'lucide-react';
import api from '../services/api';

const TYPES = [
  { key: 'produits', label: 'Produits' },
  { key: 'categorie_eco_org', label: 'Catégories eco-org' },
  { key: 'genre', label: 'Genres' },
  { key: 'saison', label: 'Saisons' },
  { key: 'gamme', label: 'Gammes' },
];

export default function AdminCatalogue() {
  const [tab, setTab] = useState('produits');
  const [produits, setProduits] = useState([]);
  const [dimensions, setDimensions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({ nom: '', categorie_eco_org: '', valeur: '', ordre: 100 });

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [p, d] = await Promise.all([
        api.get('/etiquettes/admin/produits'),
        api.get('/etiquettes/admin/dimensions'),
      ]);
      setProduits(p.data || []);
      setDimensions(d.data || []);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const addProduit = async (e) => {
    e.preventDefault();
    if (!form.nom || !form.categorie_eco_org) return;
    try {
      await api.post('/etiquettes/admin/produits', { nom: form.nom, categorie_eco_org: form.categorie_eco_org });
      setForm({ ...form, nom: '' });
      load();
    } catch (e) { setError(e.response?.data?.error || e.message); }
  };

  const toggleProduit = async (p) => {
    try {
      await api.patch('/etiquettes/admin/produits', {
        nom: p.nom, categorie_eco_org: p.categorie_eco_org, is_active: !p.is_active,
      });
      load();
    } catch (e) { setError(e.response?.data?.error || e.message); }
  };

  const addDimension = async (e) => {
    e.preventDefault();
    if (!form.valeur || tab === 'produits') return;
    try {
      await api.post('/etiquettes/admin/dimensions', { type: tab, valeur: form.valeur, ordre: Number(form.ordre) || 100 });
      setForm({ ...form, valeur: '' });
      load();
    } catch (e) { setError(e.response?.data?.error || e.message); }
  };

  const toggleDimension = async (d) => {
    try {
      await api.patch(`/etiquettes/admin/dimensions/${d.id}`, { is_active: !d.is_active });
      load();
    } catch (e) { setError(e.response?.data?.error || e.message); }
  };

  const ecoOrgs = Array.from(new Set([
    ...produits.map(p => p.categorie_eco_org),
    ...dimensions.filter(d => d.type === 'categorie_eco_org' && d.is_active).map(d => d.valeur),
  ])).filter(Boolean).sort();

  return (
    <Layout>
      <div className="min-h-[calc(100vh-60px)] bg-slate-50 p-8">
        <header className="flex items-center gap-4 mb-6">
          <Tag className="w-7 h-7 text-emerald-600" />
          <h1 className="text-2xl font-bold text-slate-800">Catalogue produits</h1>
        </header>

        <nav className="bg-white rounded-2xl shadow p-2 inline-flex gap-1 mb-6 flex-wrap">
          {TYPES.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-4 py-2 rounded-xl font-semibold text-sm transition ${
                tab === t.key ? 'bg-emerald-600 text-white shadow' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >{t.label}</button>
          ))}
        </nav>

        {error && <div className="bg-rose-50 text-rose-700 p-3 rounded mb-4 text-sm">{error}</div>}
        {loading && <div className="text-slate-400 mb-4">Chargement…</div>}

        {tab === 'produits' && (
          <>
            <form onSubmit={addProduit} className="bg-white rounded-2xl shadow p-4 mb-6 flex flex-wrap gap-3 items-end">
              <div className="flex-1 min-w-[200px]">
                <label className="text-xs text-slate-600 font-semibold block mb-1">Nom produit</label>
                <input value={form.nom} onChange={e => setForm({ ...form, nom: e.target.value })}
                  placeholder="ex: Manteaux"
                  className="w-full px-3 py-2 border rounded-lg" />
              </div>
              <div className="flex-1 min-w-[200px]">
                <label className="text-xs text-slate-600 font-semibold block mb-1">Catégorie eco-org</label>
                <select value={form.categorie_eco_org} onChange={e => setForm({ ...form, categorie_eco_org: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg">
                  <option value="">— Choisir —</option>
                  {ecoOrgs.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <button type="submit" className="px-5 py-2 rounded-lg bg-emerald-600 text-white font-bold flex items-center gap-2 hover:bg-emerald-700">
                <Plus className="w-4 h-4" /> Ajouter
              </button>
            </form>

            <div className="bg-white rounded-2xl shadow overflow-hidden">
              <table className="w-full">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Produit</th>
                    <th className="px-4 py-3">Catégorie eco-org</th>
                    <th className="px-4 py-3 text-center">Actif</th>
                  </tr>
                </thead>
                <tbody>
                  {produits.map(p => (
                    <tr key={`${p.nom}-${p.categorie_eco_org}`} className="border-t hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-800">{p.nom}</td>
                      <td className="px-4 py-3 text-slate-600">{p.categorie_eco_org}</td>
                      <td className="px-4 py-3 text-center">
                        <button onClick={() => toggleProduit(p)} className="hover:scale-110 transition">
                          {p.is_active
                            ? <ToggleRight className="w-7 h-7 text-emerald-500" />
                            : <ToggleLeft className="w-7 h-7 text-slate-300" />}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {produits.length === 0 && (
                    <tr><td colSpan="3" className="px-4 py-8 text-center text-slate-400">Aucun produit</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}

        {tab !== 'produits' && (
          <>
            <form onSubmit={addDimension} className="bg-white rounded-2xl shadow p-4 mb-6 flex flex-wrap gap-3 items-end">
              <div className="flex-1 min-w-[200px]">
                <label className="text-xs text-slate-600 font-semibold block mb-1">Nouvelle valeur</label>
                <input value={form.valeur} onChange={e => setForm({ ...form, valeur: e.target.value })}
                  placeholder="ex: Mi-Saison"
                  className="w-full px-3 py-2 border rounded-lg" />
              </div>
              <div className="w-24">
                <label className="text-xs text-slate-600 font-semibold block mb-1">Ordre</label>
                <input type="number" value={form.ordre} onChange={e => setForm({ ...form, ordre: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg" />
              </div>
              <button type="submit" className="px-5 py-2 rounded-lg bg-emerald-600 text-white font-bold flex items-center gap-2 hover:bg-emerald-700">
                <Plus className="w-4 h-4" /> Ajouter
              </button>
            </form>

            <div className="bg-white rounded-2xl shadow overflow-hidden">
              <table className="w-full">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3 w-20">Ordre</th>
                    <th className="px-4 py-3">Valeur</th>
                    <th className="px-4 py-3 text-center">Actif</th>
                  </tr>
                </thead>
                <tbody>
                  {dimensions.filter(d => d.type === tab).map(d => (
                    <tr key={d.id} className="border-t hover:bg-slate-50">
                      <td className="px-4 py-3 text-slate-500 tabular-nums">{d.ordre}</td>
                      <td className="px-4 py-3 font-medium text-slate-800">{d.valeur}</td>
                      <td className="px-4 py-3 text-center">
                        <button onClick={() => toggleDimension(d)} className="hover:scale-110 transition">
                          {d.is_active
                            ? <ToggleRight className="w-7 h-7 text-emerald-500" />
                            : <ToggleLeft className="w-7 h-7 text-slate-300" />}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {dimensions.filter(d => d.type === tab).length === 0 && (
                    <tr><td colSpan="3" className="px-4 py-8 text-center text-slate-400">Aucune valeur</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}
