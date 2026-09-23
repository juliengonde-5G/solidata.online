import { useState, useEffect, useMemo } from 'react';
import Layout from '../components/Layout';
import { Tag, Plus, ToggleLeft, ToggleRight, Grid3x3, Hash } from 'lucide-react';
import api from '../services/api';

const TYPES = [
  { key: 'combinaisons', label: 'Combinaisons' },
  { key: 'produits_v2', label: 'Produits (codification)' },
  { key: 'produits', label: 'Produits (ancien catalogue)' },
  { key: 'categorie_eco_org', label: 'Catégories eco-org' },
  { key: 'genre', label: 'Genres' },
  { key: 'saison', label: 'Saisons' },
  { key: 'gamme', label: 'Gammes' },
  { key: 'conteneurs', label: 'Conteneurs' },
];

/** Code hexadécimal 2 chiffres, comme dans la codification carton (2.57.0) —
 * même formule que `backend/src/utils/codification-etiquettes.js`. `null`
 * signifie « pas encore codifié » (une valeur peut exister sans code tant
 * qu'elle n'a jamais servi à une combinaison, ce n'est pas une anomalie). */
function codeHex(n) {
  return n == null ? null : n.toString(16).toUpperCase().padStart(2, '0');
}

export default function AdminCatalogue() {
  const [tab, setTab] = useState('combinaisons');
  const [produits, setProduits] = useState([]);
  const [dimensions, setDimensions] = useState([]);
  const [conteneurs, setConteneurs] = useState([]);
  // Référentiel ADMIN v2 (2.57.0) : tout, actif ou non, avec les codes et le
  // nombre de cartons déjà imprimés par combinaison — un seul appel sert à la
  // fois l'onglet Combinaisons et l'onglet Produits (codification).
  const [adminRef, setAdminRef] = useState({ gammes: [], categories: [], genres: [], saisons: [], produits: [], combinaisons: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({ nom: '', categorie_eco_org: '', valeur: '', ordre: 100 });
  const [refForm, setRefForm] = useState({});

  // Filtres de l'onglet Combinaisons (client-side, la liste tient en mémoire).
  const [filtreGamme, setFiltreGamme] = useState('');
  const [filtreCategorie, setFiltreCategorie] = useState('');
  const [filtreProduit, setFiltreProduit] = useState('');
  const [combiForm, setCombiForm] = useState({ gamme: '', categorie_eco_org: '', produit_id: '', genre: '', saison: '' });
  const [nouveauProduitNom, setNouveauProduitNom] = useState('');

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [p, d, c, ar] = await Promise.all([
        api.get('/etiquettes/admin/produits'),
        api.get('/etiquettes/admin/dimensions'),
        api.get('/referentiels/conteneurs').catch(() => ({ data: [] })),
        api.get('/etiquettes/admin/referentiel').catch(() => ({ data: null })),
      ]);
      setProduits(p.data || []);
      setDimensions(d.data || []);
      setConteneurs(c.data || []);
      if (ar.data) setAdminRef(ar.data);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally { setLoading(false); }
  };

  const addReferentiel = async (kind) => {
    if (!refForm.nom) return;
    try {
      await api.post(`/referentiels/${kind}`, refForm);
      setRefForm({});
      load();
    } catch (e) { setError(e.response?.data?.error || e.message); }
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

  // ── Produits (codification) ────────────────────────────────────────────
  const ajouterProduitV2 = async (e) => {
    e.preventDefault();
    setError(null);
    if (!nouveauProduitNom.trim()) return;
    try {
      await api.post('/etiquettes/admin/produits-v2', { nom: nouveauProduitNom.trim() });
      setNouveauProduitNom('');
      load();
    } catch (e2) {
      // 409 CODES_EPUISES (plus de code 1..255 libre) ou nom déjà existant :
      // le message serveur suffit, on ne le reformule pas.
      setError(e2.response?.data?.error || e2.message);
    }
  };

  const toggleProduitV2 = async (p) => {
    setError(null);
    try {
      await api.patch(`/etiquettes/admin/produits-v2/${p.id}`, { is_active: !p.is_active });
      load();
    } catch (e2) { setError(e2.response?.data?.error || e2.message); }
  };

  // ── Combinaisons ────────────────────────────────────────────────────────
  // Seules des valeurs ACTIVES et CODIFIÉES (code non nul) peuvent entrer
  // dans une combinaison — sinon le serveur refuse en 400 (§2.1). On filtre
  // donc les listes des selects en amont, pour ne jamais présenter un choix
  // que la validation refuserait de toute façon.
  const gammesCodifiees = useMemo(() => (adminRef.gammes || []).filter((g) => g.code != null && g.is_active !== false), [adminRef.gammes]);
  const categoriesCodifiees = useMemo(() => (adminRef.categories || []).filter((c) => c.code != null && c.is_active !== false), [adminRef.categories]);
  const genresCodifies = useMemo(() => (adminRef.genres || []).filter((g) => g.code != null && g.is_active !== false), [adminRef.genres]);
  const saisonsCodifiees = useMemo(() => (adminRef.saisons || []).filter((s) => s.code != null && s.is_active !== false), [adminRef.saisons]);
  const produitsCodifies = useMemo(() => (adminRef.produits || []).filter((p) => p.code != null && p.is_active !== false), [adminRef.produits]);

  const combinaisonsFiltrees = useMemo(() => (adminRef.combinaisons || []).filter((c) =>
    (!filtreGamme || c.gamme === filtreGamme)
    && (!filtreCategorie || c.categorie_eco_org === filtreCategorie)
    && (!filtreProduit || String(c.produit_id) === filtreProduit)
  ), [adminRef.combinaisons, filtreGamme, filtreCategorie, filtreProduit]);

  const ajouterCombinaison = async (e) => {
    e.preventDefault();
    setError(null);
    const { gamme, categorie_eco_org, produit_id, genre, saison } = combiForm;
    if (!gamme || !categorie_eco_org || !produit_id || !genre || !saison) {
      setError('Gamme, catégorie, produit, genre et saison sont tous requis pour créer une combinaison.');
      return;
    }
    try {
      await api.post('/etiquettes/admin/combinaisons', { gamme, categorie_eco_org, produit_id: Number(produit_id), genre, saison });
      setCombiForm({ gamme: '', categorie_eco_org: '', produit_id: '', genre: '', saison: '' });
      load();
    } catch (e2) {
      setError(e2.response?.data?.error || e2.message);
    }
  };

  const toggleCombinaison = async (c) => {
    setError(null);
    try {
      await api.patch(`/etiquettes/admin/combinaisons/${c.id}`, { is_active: !c.is_active });
      load();
    } catch (e2) { setError(e2.response?.data?.error || e2.message); }
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
          <h1 className="text-2xl font-bold text-slate-800">Catalogue & référentiels</h1>
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

        {tab === 'combinaisons' && (
          <>
            <div className="bg-white rounded-2xl shadow p-4 mb-4 flex flex-wrap gap-3 items-end">
              <div className="flex items-center gap-2 text-slate-500 mr-2">
                <Grid3x3 className="w-5 h-5" />
                <span className="text-xs font-semibold">Filtrer</span>
              </div>
              <select value={filtreGamme} onChange={e => setFiltreGamme(e.target.value)} className="px-3 py-2 border rounded-lg text-sm">
                <option value="">Toutes les gammes</option>
                {Array.from(new Set((adminRef.combinaisons || []).map(c => c.gamme))).sort().map(g => <option key={g} value={g}>{g}</option>)}
              </select>
              <select value={filtreCategorie} onChange={e => setFiltreCategorie(e.target.value)} className="px-3 py-2 border rounded-lg text-sm">
                <option value="">Toutes les catégories</option>
                {Array.from(new Set((adminRef.combinaisons || []).map(c => c.categorie_eco_org))).sort().map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <select value={filtreProduit} onChange={e => setFiltreProduit(e.target.value)} className="px-3 py-2 border rounded-lg text-sm">
                <option value="">Tous les produits</option>
                {Array.from(new Map((adminRef.combinaisons || []).map(c => [c.produit_id, c.produit])).entries()).sort((a, b) => (a[1] || '').localeCompare(b[1] || '')).map(([id, nom]) => <option key={id} value={id}>{nom}</option>)}
              </select>
              {(filtreGamme || filtreCategorie || filtreProduit) && (
                <button onClick={() => { setFiltreGamme(''); setFiltreCategorie(''); setFiltreProduit(''); }} className="text-xs text-slate-400 hover:text-slate-600 underline">
                  Réinitialiser les filtres
                </button>
              )}
              <span className="ml-auto text-xs text-slate-400">{combinaisonsFiltrees.length} combinaison(s)</span>
            </div>

            <form onSubmit={ajouterCombinaison} className="bg-white rounded-2xl shadow p-4 mb-6 flex flex-wrap gap-3 items-end">
              <SelectSimple label="Gamme" value={combiForm.gamme} onChange={v => setCombiForm({ ...combiForm, gamme: v })} options={gammesCodifiees.map(g => g.valeur)} />
              <SelectSimple label="Catégorie" value={combiForm.categorie_eco_org} onChange={v => setCombiForm({ ...combiForm, categorie_eco_org: v })} options={categoriesCodifiees.map(c => c.valeur)} />
              <SelectSimple label="Produit" value={combiForm.produit_id} onChange={v => setCombiForm({ ...combiForm, produit_id: v })}
                options={produitsCodifies.map(p => ({ value: p.id, label: p.nom }))} />
              <SelectSimple label="Genre" value={combiForm.genre} onChange={v => setCombiForm({ ...combiForm, genre: v })} options={genresCodifies.map(g => g.valeur)} />
              <SelectSimple label="Saison" value={combiForm.saison} onChange={v => setCombiForm({ ...combiForm, saison: v })} options={saisonsCodifiees.map(s => s.valeur)} />
              <button type="submit" className="px-5 py-2 rounded-lg bg-emerald-600 text-white font-bold flex items-center gap-2 hover:bg-emerald-700 h-[42px]">
                <Plus className="w-4 h-4" /> Ajouter
              </button>
            </form>
            <p className="text-xs text-slate-400 -mt-4 mb-4">Seules les valeurs actives ET codifiées peuvent composer une combinaison (sinon le serveur refuse).</p>

            <div className="bg-white rounded-2xl shadow overflow-hidden">
              <table className="w-full">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Gamme</th>
                    <th className="px-4 py-3">Catégorie</th>
                    <th className="px-4 py-3">Produit</th>
                    <th className="px-4 py-3">Genre</th>
                    <th className="px-4 py-3">Saison</th>
                    <th className="px-4 py-3 text-right">Cartons</th>
                    <th className="px-4 py-3 text-center">Actif</th>
                  </tr>
                </thead>
                <tbody>
                  {combinaisonsFiltrees.map(c => (
                    <tr key={c.id} className="border-t hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-800">{c.gamme}</td>
                      <td className="px-4 py-3 text-slate-600">{c.categorie_eco_org}</td>
                      <td className="px-4 py-3 text-slate-600">{c.produit}</td>
                      <td className="px-4 py-3 text-slate-600">{c.genre}</td>
                      <td className="px-4 py-3 text-slate-600">{c.saison}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-slate-500">{c.nb_cartons ?? 0}</td>
                      <td className="px-4 py-3 text-center">
                        <button onClick={() => toggleCombinaison(c)} className="hover:scale-110 transition" title="Ne supprime jamais une combinaison ayant servi — seulement activer/désactiver">
                          {c.is_active
                            ? <ToggleRight className="w-7 h-7 text-emerald-500" />
                            : <ToggleLeft className="w-7 h-7 text-slate-300" />}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {combinaisonsFiltrees.length === 0 && (
                    <tr><td colSpan="7" className="px-4 py-8 text-center text-slate-400">Aucune combinaison{(filtreGamme || filtreCategorie || filtreProduit) ? ' pour ce filtre' : ''}</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}

        {tab === 'produits_v2' && (
          <>
            <form onSubmit={ajouterProduitV2} className="bg-white rounded-2xl shadow p-4 mb-6 flex flex-wrap gap-3 items-end">
              <div className="flex-1 min-w-[240px]">
                <label className="text-xs text-slate-600 font-semibold block mb-1">Nom du produit</label>
                <input value={nouveauProduitNom} onChange={e => setNouveauProduitNom(e.target.value)}
                  placeholder="ex : Paréos"
                  className="w-full px-3 py-2 border rounded-lg" />
              </div>
              <button type="submit" className="px-5 py-2 rounded-lg bg-emerald-600 text-white font-bold flex items-center gap-2 hover:bg-emerald-700">
                <Plus className="w-4 h-4" /> Ajouter
              </button>
            </form>
            <p className="text-xs text-slate-400 -mt-4 mb-4">Le code (1 octet, 1..255) est attribué automatiquement — le plus petit libre. Le nom n'est plus modifiable une fois des cartons imprimés avec ce produit.</p>

            <div className="bg-white rounded-2xl shadow overflow-hidden">
              <table className="w-full">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3 w-20"><Hash className="w-4 h-4 inline" /> Code</th>
                    <th className="px-4 py-3">Produit</th>
                    <th className="px-4 py-3 text-center">Actif</th>
                  </tr>
                </thead>
                <tbody>
                  {(adminRef.produits || []).map(p => (
                    <tr key={p.id} className="border-t hover:bg-slate-50">
                      <td className="px-4 py-3 font-mono text-slate-500">{codeHex(p.code) ?? '—'}</td>
                      <td className="px-4 py-3 font-medium text-slate-800">{p.nom}</td>
                      <td className="px-4 py-3 text-center">
                        <button onClick={() => toggleProduitV2(p)} className="hover:scale-110 transition">
                          {p.is_active
                            ? <ToggleRight className="w-7 h-7 text-emerald-500" />
                            : <ToggleLeft className="w-7 h-7 text-slate-300" />}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {(adminRef.produits || []).length === 0 && (
                    <tr><td colSpan="3" className="px-4 py-8 text-center text-slate-400">Aucun produit codifié</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}

        {tab === 'produits' && (
          <>
            <p className="text-xs text-slate-400 mb-4">Ancien catalogue (`produits_catalogue`) — lecture seule depuis 2.57.0, remplacé par « Produits (codification) » et les combinaisons.</p>
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
                        {p.is_active
                          ? <ToggleRight className="w-7 h-7 text-emerald-300" />
                          : <ToggleLeft className="w-7 h-7 text-slate-200" />}
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

        {tab === 'conteneurs' && (
          <>
            <form onSubmit={(e) => { e.preventDefault(); addReferentiel(tab); }}
              className="bg-white rounded-2xl shadow p-4 mb-6 flex flex-wrap gap-3 items-end">
              <div className="flex-1 min-w-[200px]">
                <label className="text-xs text-slate-600 font-semibold block mb-1">Nom</label>
                <input value={refForm.nom || ''} onChange={e => setRefForm({ ...refForm, nom: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg" placeholder={tab === 'conteneurs' ? 'ex: Carton 60L' : 'Nom'} />
              </div>
              <button type="submit" className="px-5 py-2 rounded-lg bg-emerald-600 text-white font-bold flex items-center gap-2 hover:bg-emerald-700">
                <Plus className="w-4 h-4" /> Ajouter
              </button>
            </form>

            <div className="bg-white rounded-2xl shadow overflow-hidden">
              <table className="w-full">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Nom</th>
                    <th className="px-4 py-3 text-right">Capacité (L)</th>
                    <th className="px-4 py-3 text-right">Poids max (kg)</th>
                  </tr>
                </thead>
                <tbody>
                  {conteneurs.map(item => (
                    <tr key={item.id} className="border-t hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-800">{item.nom}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{item.capacite_litres ?? '—'}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{item.poids_max_kg ?? '—'}</td>
                    </tr>
                  ))}
                  {conteneurs.length === 0 && (
                    <tr><td colSpan="3" className="px-4 py-8 text-center text-slate-400">Aucun conteneur</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}

        {['categorie_eco_org', 'genre', 'saison', 'gamme'].includes(tab) && (
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
            <p className="text-xs text-slate-400 -mt-4 mb-4">Le code (hexadécimal) est attribué automatiquement au plus petit libre — une valeur déjà codifiée ne peut plus être renommée.</p>

            <div className="bg-white rounded-2xl shadow overflow-hidden">
              <table className="w-full">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3 w-20">Ordre</th>
                    <th className="px-4 py-3 w-20"><Hash className="w-4 h-4 inline" /> Code</th>
                    <th className="px-4 py-3">Valeur</th>
                    <th className="px-4 py-3 text-center">Actif</th>
                  </tr>
                </thead>
                <tbody>
                  {dimensions.filter(d => d.type === tab).map(d => (
                    <tr key={d.id} className="border-t hover:bg-slate-50">
                      <td className="px-4 py-3 text-slate-500 tabular-nums">{d.ordre}</td>
                      <td className="px-4 py-3 font-mono text-slate-500">{codeHex(d.code) ?? '—'}</td>
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
                    <tr><td colSpan="4" className="px-4 py-8 text-center text-slate-400">Aucune valeur</td></tr>
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

/** Petit select réutilisé par le formulaire d'ajout de combinaison — accepte
 * soit une liste de chaînes, soit une liste de `{value, label}` (produits). */
function SelectSimple({ label, value, onChange, options }) {
  const normalisees = (options || []).map((o) => (typeof o === 'object' ? o : { value: o, label: o }));
  return (
    <div className="min-w-[160px]">
      <label className="text-xs text-slate-600 font-semibold block mb-1">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm">
        <option value="">—</option>
        {normalisees.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}
