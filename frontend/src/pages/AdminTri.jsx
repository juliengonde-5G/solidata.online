import { useState, useEffect, useCallback } from 'react';
import Layout from '../components/Layout';
import { Modal } from '../components';
import { Factory, Plus, ToggleLeft, ToggleRight, Pencil, ListChecks } from 'lucide-react';
import api from '../services/api';

const TABS = [
  { key: 'chaines', label: 'Chaînes' },
  { key: 'operations', label: 'Opérations' },
  { key: 'postes', label: 'Postes' },
  { key: 'categories', label: 'Catégories sortantes' },
];

// Familles Refashion (aligné sur le CHECK backend + vues DPAV vague 1).
const FAMILLES_REFASHION = [
  { value: 'reutilisation', label: 'Réutilisation' },
  { value: 'recyclage', label: 'Recyclage' },
  { value: 'csr', label: 'CSR' },
  { value: 'elimination', label: 'Élimination' },
  { value: 'retour', label: 'Retour' },
];
const FAMILLE_BADGE = {
  reutilisation: 'bg-emerald-100 text-emerald-700',
  recyclage: 'bg-blue-100 text-blue-700',
  csr: 'bg-amber-100 text-amber-700',
  elimination: 'bg-rose-100 text-rose-700',
  retour: 'bg-slate-200 text-slate-700',
};
const familleLabel = (v) => FAMILLES_REFASHION.find((f) => f.value === v)?.label || v || '—';

const inputCls = 'w-full px-3 py-2 border rounded-lg text-sm';
const labelCls = 'text-xs text-slate-600 font-semibold block mb-1';

export default function AdminTri() {
  const [tab, setTab] = useState('chaines');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const [chaines, setChaines] = useState([]);
  const [operations, setOperations] = useState([]);
  const [postes, setPostes] = useState([]);
  const [categories, setCategories] = useState([]);

  const [selChaine, setSelChaine] = useState(''); // pour l'onglet Opérations
  const [selOperation, setSelOperation] = useState(''); // pour l'onglet Postes
  const [allOperations, setAllOperations] = useState([]); // liste plate (sélecteur Postes)

  const [addForm, setAddForm] = useState({});
  const [editItem, setEditItem] = useState(null); // { _kind, ...champs }

  const loadChaines = useCallback(async () => {
    try {
      const res = await api.get('/tri/chaines');
      setChaines(res.data || []);
    } catch (e) { setError(e.response?.data?.error || 'Chargement des chaînes impossible'); }
  }, []);

  const loadAllOperations = useCallback(async () => {
    try {
      const res = await api.get('/tri/operations');
      setAllOperations(res.data || []);
    } catch { /* silencieux : sélecteur vide */ }
  }, []);

  const loadOperations = useCallback(async (chaineId) => {
    if (!chaineId) { setOperations([]); return; }
    try {
      const res = await api.get(`/tri/operations?chaine_id=${chaineId}`);
      setOperations(res.data || []);
    } catch (e) { setError(e.response?.data?.error || 'Chargement des opérations impossible'); }
  }, []);

  const loadPostes = useCallback(async (operationId) => {
    if (!operationId) { setPostes([]); return; }
    try {
      const res = await api.get(`/tri/postes?operation_id=${operationId}`);
      setPostes(res.data || []);
    } catch (e) { setError(e.response?.data?.error || 'Chargement des postes impossible'); }
  }, []);

  const loadCategories = useCallback(async () => {
    try {
      const res = await api.get('/tri/admin/categories');
      setCategories(res.data || []);
    } catch (e) { setError(e.response?.data?.error || 'Chargement des catégories impossible'); }
  }, []);

  useEffect(() => { loadChaines(); loadAllOperations(); }, [loadChaines, loadAllOperations]);
  useEffect(() => { if (tab === 'categories') loadCategories(); }, [tab, loadCategories]);
  useEffect(() => { if (tab === 'operations') loadOperations(selChaine); }, [tab, selChaine, loadOperations]);
  useEffect(() => { if (tab === 'postes') loadPostes(selOperation); }, [tab, selOperation, loadPostes]);

  const switchTab = (k) => { setTab(k); setAddForm({}); setError(null); };

  // ─── Créations ───
  const createChaine = async (e) => {
    e.preventDefault();
    if (!addForm.nom) return;
    setBusy(true); setError(null);
    try {
      await api.post('/tri/chaines', { nom: addForm.nom, description: addForm.description || null });
      setAddForm({}); await loadChaines();
    } catch (e2) { setError(e2.response?.data?.error || 'Création impossible'); }
    finally { setBusy(false); }
  };

  const createOperation = async (e) => {
    e.preventDefault();
    if (!selChaine || !addForm.nom || !addForm.code) { setError('Chaîne, nom et code requis.'); return; }
    setBusy(true); setError(null);
    try {
      await api.post('/tri/operations', {
        chaine_id: parseInt(selChaine),
        numero: addForm.numero ? parseInt(addForm.numero) : null,
        nom: addForm.nom, code: addForm.code,
        est_obligatoire: addForm.est_obligatoire !== false,
        description: addForm.description || null,
      });
      setAddForm({}); await loadOperations(selChaine); await loadAllOperations();
    } catch (e2) { setError(e2.response?.data?.error || 'Création impossible'); }
    finally { setBusy(false); }
  };

  const createPoste = async (e) => {
    e.preventDefault();
    if (!selOperation || !addForm.nom || !addForm.code) { setError('Opération, nom et code requis.'); return; }
    setBusy(true); setError(null);
    try {
      await api.post('/tri/postes', {
        operation_id: parseInt(selOperation),
        nom: addForm.nom, code: addForm.code,
        est_obligatoire: addForm.est_obligatoire !== false,
        permet_doublure: !!addForm.permet_doublure,
        competences_requises: (addForm.competences || '').split(',').map((s) => s.trim()).filter(Boolean),
      });
      setAddForm({}); await loadPostes(selOperation);
    } catch (e2) { setError(e2.response?.data?.error || 'Création impossible'); }
    finally { setBusy(false); }
  };

  const createCategorie = async (e) => {
    e.preventDefault();
    if (!addForm.nom || !addForm.famille_refashion) { setError('Nom et famille Refashion requis.'); return; }
    setBusy(true); setError(null);
    try {
      await api.post('/tri/categories-sortantes', {
        nom: addForm.nom,
        famille: addForm.famille || familleLabel(addForm.famille_refashion),
        famille_refashion: addForm.famille_refashion,
        ordre: addForm.ordre ? parseInt(addForm.ordre) : 100,
      });
      setAddForm({}); await loadCategories();
    } catch (e2) { setError(e2.response?.data?.error || 'Création impossible'); }
    finally { setBusy(false); }
  };

  // ─── Activation / désactivation (pas de suppression dure) ───
  // On renvoie le jeu complet de champs pour ne rien écraser (les PUT positionnent
  // description/ordre sans COALESCE).
  const toggleActive = async (kind, item) => {
    setError(null);
    const next = !(item.is_active !== false);
    try {
      if (kind === 'chaine') {
        await api.put(`/tri/chaines/${item.id}`, { nom: item.nom, description: item.description, is_active: next });
        await loadChaines();
      } else if (kind === 'operation') {
        await api.put(`/tri/operations/${item.id}`, {
          numero: item.numero, nom: item.nom, code: item.code,
          est_obligatoire: item.est_obligatoire, description: item.description, is_active: next,
        });
        await loadOperations(selChaine); await loadAllOperations();
      } else if (kind === 'poste') {
        await api.put(`/tri/postes/${item.id}`, {
          nom: item.nom, code: item.code, est_obligatoire: item.est_obligatoire,
          permet_doublure: item.permet_doublure, competences_requises: item.competences_requises || [],
          is_active: next,
        });
        await loadPostes(selOperation);
      } else if (kind === 'categorie') {
        await api.put(`/tri/categories-sortantes/${item.id}`, {
          nom: item.nom, famille: item.famille, famille_refashion: item.famille_refashion,
          ordre: item.ordre, is_active: next,
        });
        await loadCategories();
      }
    } catch (e) { setError(e.response?.data?.error || 'Modification impossible'); }
  };

  // ─── Édition (modale) ───
  const saveEdit = async () => {
    if (!editItem) return;
    setBusy(true); setError(null);
    const it = editItem;
    try {
      if (it._kind === 'chaine') {
        await api.put(`/tri/chaines/${it.id}`, { nom: it.nom, description: it.description, is_active: it.is_active });
        await loadChaines();
      } else if (it._kind === 'operation') {
        await api.put(`/tri/operations/${it.id}`, {
          numero: it.numero, nom: it.nom, code: it.code,
          est_obligatoire: it.est_obligatoire, description: it.description, is_active: it.is_active,
        });
        await loadOperations(selChaine); await loadAllOperations();
      } else if (it._kind === 'poste') {
        await api.put(`/tri/postes/${it.id}`, {
          nom: it.nom, code: it.code, est_obligatoire: it.est_obligatoire,
          permet_doublure: it.permet_doublure,
          competences_requises: (it._competences || '').split(',').map((s) => s.trim()).filter(Boolean),
          is_active: it.is_active,
        });
        await loadPostes(selOperation);
      } else if (it._kind === 'categorie') {
        if (!it.famille_refashion) { setError('Famille Refashion requise.'); setBusy(false); return; }
        await api.put(`/tri/categories-sortantes/${it.id}`, {
          nom: it.nom, famille: it.famille || familleLabel(it.famille_refashion),
          famille_refashion: it.famille_refashion, ordre: it.ordre, is_active: it.is_active,
        });
        await loadCategories();
      }
      setEditItem(null);
    } catch (e) { setError(e.response?.data?.error || 'Enregistrement impossible'); }
    finally { setBusy(false); }
  };

  const ActiveToggle = ({ kind, item }) => (
    <button onClick={() => toggleActive(kind, item)} className="hover:scale-110 transition" title={item.is_active !== false ? 'Désactiver' : 'Activer'}>
      {item.is_active !== false ? <ToggleRight className="w-7 h-7 text-emerald-500" /> : <ToggleLeft className="w-7 h-7 text-slate-300" />}
    </button>
  );
  const EditBtn = ({ onClick }) => (
    <button onClick={onClick} className="text-slate-500 hover:text-primary" title="Modifier"><Pencil className="w-4 h-4" /></button>
  );

  const chaineNom = (id) => chaines.find((c) => c.id === id)?.nom || `#${id}`;

  return (
    <Layout>
      <div className="min-h-[calc(100vh-60px)] bg-slate-50 p-8">
        <header className="flex items-center gap-4 mb-2">
          <ListChecks className="w-7 h-7 text-primary" />
          <h1 className="text-2xl font-bold text-slate-800">Référentiel du tri</h1>
        </header>
        <p className="text-sm text-slate-500 mb-6">Chaînes, opérations, postes et catégories sortantes. La désactivation remplace la suppression (préserve la traçabilité et les vues DPAV).</p>

        <nav className="bg-white rounded-2xl shadow p-2 inline-flex gap-1 mb-6 flex-wrap">
          {TABS.map((t) => (
            <button key={t.key} onClick={() => switchTab(t.key)}
              className={`px-4 py-2 rounded-xl font-semibold text-sm transition ${tab === t.key ? 'bg-primary text-white shadow' : 'text-slate-600 hover:bg-slate-100'}`}
            >{t.label}</button>
          ))}
        </nav>

        {error && <div className="bg-rose-50 text-rose-700 p-3 rounded mb-4 text-sm">{error}</div>}

        {/* ─── CHAÎNES ─── */}
        {tab === 'chaines' && (
          <>
            <form onSubmit={createChaine} className="bg-white rounded-2xl shadow p-4 mb-6 flex flex-wrap gap-3 items-end">
              <div className="flex-1 min-w-[200px]">
                <label className={labelCls}>Nom de la chaîne</label>
                <input value={addForm.nom || ''} onChange={(e) => setAddForm({ ...addForm, nom: e.target.value })} className={inputCls} placeholder="ex: Qualité" />
              </div>
              <div className="flex-1 min-w-[240px]">
                <label className={labelCls}>Description</label>
                <input value={addForm.description || ''} onChange={(e) => setAddForm({ ...addForm, description: e.target.value })} className={inputCls} placeholder="optionnel" />
              </div>
              <button type="submit" disabled={busy} className="px-5 py-2 rounded-lg bg-primary text-white font-bold flex items-center gap-2 disabled:opacity-50">
                <Plus className="w-4 h-4" /> Ajouter
              </button>
            </form>
            <div className="bg-white rounded-2xl shadow overflow-hidden">
              <table className="w-full">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr><th className="px-4 py-3">Nom</th><th className="px-4 py-3">Description</th><th className="px-4 py-3 text-center">Opérations</th><th className="px-4 py-3 text-center">Postes</th><th className="px-4 py-3 text-center">Actif</th><th className="px-4 py-3 text-center">Modifier</th></tr>
                </thead>
                <tbody>
                  {chaines.map((c) => (
                    <tr key={c.id} className="border-t hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-800">{c.nom}</td>
                      <td className="px-4 py-3 text-slate-600 text-sm">{c.description || '—'}</td>
                      <td className="px-4 py-3 text-center tabular-nums">{c.nb_operations ?? 0}</td>
                      <td className="px-4 py-3 text-center tabular-nums">{c.nb_postes ?? 0}</td>
                      <td className="px-4 py-3 text-center"><ActiveToggle kind="chaine" item={c} /></td>
                      <td className="px-4 py-3 text-center"><EditBtn onClick={() => setEditItem({ _kind: 'chaine', ...c })} /></td>
                    </tr>
                  ))}
                  {chaines.length === 0 && <tr><td colSpan="6" className="px-4 py-8 text-center text-slate-400">Aucune chaîne</td></tr>}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* ─── OPÉRATIONS ─── */}
        {tab === 'operations' && (
          <>
            <div className="mb-4">
              <label className={labelCls}>Chaîne</label>
              <select value={selChaine} onChange={(e) => setSelChaine(e.target.value)} className={`${inputCls} max-w-sm`}>
                <option value="">— Choisir une chaîne —</option>
                {chaines.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
              </select>
            </div>
            {selChaine && (
              <>
                <form onSubmit={createOperation} className="bg-white rounded-2xl shadow p-4 mb-6 flex flex-wrap gap-3 items-end">
                  <div className="w-24"><label className={labelCls}>N°</label><input type="number" value={addForm.numero || ''} onChange={(e) => setAddForm({ ...addForm, numero: e.target.value })} className={inputCls} /></div>
                  <div className="flex-1 min-w-[180px]"><label className={labelCls}>Nom</label><input value={addForm.nom || ''} onChange={(e) => setAddForm({ ...addForm, nom: e.target.value })} className={inputCls} placeholder="ex: Crackage 1" /></div>
                  <div className="w-36"><label className={labelCls}>Code</label><input value={addForm.code || ''} onChange={(e) => setAddForm({ ...addForm, code: e.target.value })} className={inputCls} placeholder="CRACK1" /></div>
                  <label className="flex items-center gap-2 text-sm text-slate-700 pb-2"><input type="checkbox" checked={addForm.est_obligatoire !== false} onChange={(e) => setAddForm({ ...addForm, est_obligatoire: e.target.checked })} /> Obligatoire</label>
                  <button type="submit" disabled={busy} className="px-5 py-2 rounded-lg bg-primary text-white font-bold flex items-center gap-2 disabled:opacity-50"><Plus className="w-4 h-4" /> Ajouter</button>
                </form>
                <div className="bg-white rounded-2xl shadow overflow-hidden">
                  <table className="w-full">
                    <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                      <tr><th className="px-4 py-3 w-16">N°</th><th className="px-4 py-3">Nom</th><th className="px-4 py-3">Code</th><th className="px-4 py-3 text-center">Obligatoire</th><th className="px-4 py-3 text-center">Postes</th><th className="px-4 py-3 text-center">Actif</th><th className="px-4 py-3 text-center">Modifier</th></tr>
                    </thead>
                    <tbody>
                      {operations.map((o) => (
                        <tr key={o.id} className="border-t hover:bg-slate-50">
                          <td className="px-4 py-3 tabular-nums text-slate-500">{o.numero}</td>
                          <td className="px-4 py-3 font-medium text-slate-800">{o.nom}</td>
                          <td className="px-4 py-3 font-mono text-slate-600 text-sm">{o.code}</td>
                          <td className="px-4 py-3 text-center">{o.est_obligatoire ? 'Oui' : 'Non'}</td>
                          <td className="px-4 py-3 text-center tabular-nums">{o.nb_postes ?? 0}</td>
                          <td className="px-4 py-3 text-center"><ActiveToggle kind="operation" item={o} /></td>
                          <td className="px-4 py-3 text-center"><EditBtn onClick={() => setEditItem({ _kind: 'operation', ...o })} /></td>
                        </tr>
                      ))}
                      {operations.length === 0 && <tr><td colSpan="7" className="px-4 py-8 text-center text-slate-400">Aucune opération</td></tr>}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        )}

        {/* ─── POSTES ─── */}
        {tab === 'postes' && (
          <>
            <div className="mb-4">
              <label className={labelCls}>Opération</label>
              <select value={selOperation} onChange={(e) => setSelOperation(e.target.value)} className={`${inputCls} max-w-md`}>
                <option value="">— Choisir une opération —</option>
                {allOperations.map((o) => <option key={o.id} value={o.id}>{chaineNom(o.chaine_id)} · {o.numero}. {o.nom}</option>)}
              </select>
            </div>
            {selOperation && (
              <>
                <form onSubmit={createPoste} className="bg-white rounded-2xl shadow p-4 mb-6 flex flex-wrap gap-3 items-end">
                  <div className="flex-1 min-w-[180px]"><label className={labelCls}>Nom du poste</label><input value={addForm.nom || ''} onChange={(e) => setAddForm({ ...addForm, nom: e.target.value })} className={inputCls} placeholder="ex: Craquage poste 1" /></div>
                  <div className="w-40"><label className={labelCls}>Code</label><input value={addForm.code || ''} onChange={(e) => setAddForm({ ...addForm, code: e.target.value })} className={inputCls} placeholder="CRACK1_P1" /></div>
                  <div className="flex-1 min-w-[180px]"><label className={labelCls}>Compétences (séparées par ,)</label><input value={addForm.competences || ''} onChange={(e) => setAddForm({ ...addForm, competences: e.target.value })} className={inputCls} placeholder="CACES, permis B" /></div>
                  <label className="flex items-center gap-2 text-sm text-slate-700 pb-2"><input type="checkbox" checked={addForm.est_obligatoire !== false} onChange={(e) => setAddForm({ ...addForm, est_obligatoire: e.target.checked })} /> Obligatoire</label>
                  <label className="flex items-center gap-2 text-sm text-slate-700 pb-2"><input type="checkbox" checked={!!addForm.permet_doublure} onChange={(e) => setAddForm({ ...addForm, permet_doublure: e.target.checked })} /> Doublure</label>
                  <button type="submit" disabled={busy} className="px-5 py-2 rounded-lg bg-primary text-white font-bold flex items-center gap-2 disabled:opacity-50"><Plus className="w-4 h-4" /> Ajouter</button>
                </form>
                <div className="bg-white rounded-2xl shadow overflow-hidden">
                  <table className="w-full">
                    <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                      <tr><th className="px-4 py-3">Nom</th><th className="px-4 py-3">Code</th><th className="px-4 py-3 text-center">Oblig.</th><th className="px-4 py-3 text-center">Doublure</th><th className="px-4 py-3">Compétences</th><th className="px-4 py-3 text-center">Actif</th><th className="px-4 py-3 text-center">Modifier</th></tr>
                    </thead>
                    <tbody>
                      {postes.map((p) => (
                        <tr key={p.id} className="border-t hover:bg-slate-50">
                          <td className="px-4 py-3 font-medium text-slate-800">{p.nom}</td>
                          <td className="px-4 py-3 font-mono text-slate-600 text-sm">{p.code}</td>
                          <td className="px-4 py-3 text-center">{p.est_obligatoire ? 'Oui' : 'Non'}</td>
                          <td className="px-4 py-3 text-center">{p.permet_doublure ? 'Oui' : 'Non'}</td>
                          <td className="px-4 py-3 text-slate-600 text-sm">{(p.competences_requises || []).join(', ') || '—'}</td>
                          <td className="px-4 py-3 text-center"><ActiveToggle kind="poste" item={p} /></td>
                          <td className="px-4 py-3 text-center"><EditBtn onClick={() => setEditItem({ _kind: 'poste', ...p, _competences: (p.competences_requises || []).join(', ') })} /></td>
                        </tr>
                      ))}
                      {postes.length === 0 && <tr><td colSpan="7" className="px-4 py-8 text-center text-slate-400">Aucun poste</td></tr>}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        )}

        {/* ─── CATÉGORIES SORTANTES ─── */}
        {tab === 'categories' && (
          <>
            <form onSubmit={createCategorie} className="bg-white rounded-2xl shadow p-4 mb-6 flex flex-wrap gap-3 items-end">
              <div className="w-24"><label className={labelCls}>Ordre</label><input type="number" value={addForm.ordre || ''} onChange={(e) => setAddForm({ ...addForm, ordre: e.target.value })} className={inputCls} placeholder="100" /></div>
              <div className="flex-1 min-w-[200px]"><label className={labelCls}>Nom</label><input value={addForm.nom || ''} onChange={(e) => setAddForm({ ...addForm, nom: e.target.value })} className={inputCls} placeholder="ex: Effilochage Coton" /></div>
              <div className="min-w-[180px]">
                <label className={labelCls}>Famille Refashion *</label>
                <select value={addForm.famille_refashion || ''} onChange={(e) => setAddForm({ ...addForm, famille_refashion: e.target.value })} className={inputCls}>
                  <option value="">— Choisir —</option>
                  {FAMILLES_REFASHION.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                </select>
              </div>
              <div className="flex-1 min-w-[160px]"><label className={labelCls}>Famille (libellé)</label><input value={addForm.famille || ''} onChange={(e) => setAddForm({ ...addForm, famille: e.target.value })} className={inputCls} placeholder="auto si vide" /></div>
              <button type="submit" disabled={busy} className="px-5 py-2 rounded-lg bg-primary text-white font-bold flex items-center gap-2 disabled:opacity-50"><Plus className="w-4 h-4" /> Ajouter</button>
            </form>
            <div className="bg-white rounded-2xl shadow overflow-hidden">
              <table className="w-full">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr><th className="px-4 py-3 w-20">Ordre</th><th className="px-4 py-3">Nom</th><th className="px-4 py-3">Famille Refashion</th><th className="px-4 py-3">Libellé</th><th className="px-4 py-3 text-center">Actif</th><th className="px-4 py-3 text-center">Modifier</th></tr>
                </thead>
                <tbody>
                  {categories.map((c) => (
                    <tr key={c.id} className="border-t hover:bg-slate-50">
                      <td className="px-4 py-3 tabular-nums text-slate-500">{c.ordre ?? '—'}</td>
                      <td className="px-4 py-3 font-medium text-slate-800">{c.nom}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${FAMILLE_BADGE[c.famille_refashion] || 'bg-slate-100 text-slate-500'}`}>{familleLabel(c.famille_refashion)}</span>
                      </td>
                      <td className="px-4 py-3 text-slate-600 text-sm">{c.famille || '—'}</td>
                      <td className="px-4 py-3 text-center"><ActiveToggle kind="categorie" item={c} /></td>
                      <td className="px-4 py-3 text-center"><EditBtn onClick={() => setEditItem({ _kind: 'categorie', ...c })} /></td>
                    </tr>
                  ))}
                  {categories.length === 0 && <tr><td colSpan="6" className="px-4 py-8 text-center text-slate-400">Aucune catégorie</td></tr>}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* ─── MODALE D'ÉDITION ─── */}
        <Modal
          isOpen={!!editItem}
          onClose={() => setEditItem(null)}
          title="Modifier"
          footer={
            <>
              <button onClick={() => setEditItem(null)} className="px-4 py-2 rounded-lg text-sm font-medium bg-gray-100 text-gray-600">Annuler</button>
              <button onClick={saveEdit} disabled={busy} className="px-5 py-2 rounded-lg text-sm font-bold bg-primary text-white disabled:opacity-50">{busy ? 'Enregistrement…' : 'Enregistrer'}</button>
            </>
          }
        >
          {editItem && editItem._kind === 'chaine' && (
            <div className="space-y-3">
              <div><label className={labelCls}>Nom</label><input value={editItem.nom || ''} onChange={(e) => setEditItem({ ...editItem, nom: e.target.value })} className={inputCls} /></div>
              <div><label className={labelCls}>Description</label><input value={editItem.description || ''} onChange={(e) => setEditItem({ ...editItem, description: e.target.value })} className={inputCls} /></div>
              <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={editItem.is_active !== false} onChange={(e) => setEditItem({ ...editItem, is_active: e.target.checked })} /> Active</label>
            </div>
          )}
          {editItem && editItem._kind === 'operation' && (
            <div className="space-y-3">
              <div><label className={labelCls}>Numéro</label><input type="number" value={editItem.numero ?? ''} onChange={(e) => setEditItem({ ...editItem, numero: e.target.value === '' ? null : parseInt(e.target.value) })} className={inputCls} /></div>
              <div><label className={labelCls}>Nom</label><input value={editItem.nom || ''} onChange={(e) => setEditItem({ ...editItem, nom: e.target.value })} className={inputCls} /></div>
              <div><label className={labelCls}>Code</label><input value={editItem.code || ''} onChange={(e) => setEditItem({ ...editItem, code: e.target.value })} className={inputCls} /></div>
              <div><label className={labelCls}>Description</label><input value={editItem.description || ''} onChange={(e) => setEditItem({ ...editItem, description: e.target.value })} className={inputCls} /></div>
              <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={editItem.est_obligatoire !== false} onChange={(e) => setEditItem({ ...editItem, est_obligatoire: e.target.checked })} /> Obligatoire</label>
              <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={editItem.is_active !== false} onChange={(e) => setEditItem({ ...editItem, is_active: e.target.checked })} /> Active</label>
            </div>
          )}
          {editItem && editItem._kind === 'poste' && (
            <div className="space-y-3">
              <div><label className={labelCls}>Nom</label><input value={editItem.nom || ''} onChange={(e) => setEditItem({ ...editItem, nom: e.target.value })} className={inputCls} /></div>
              <div><label className={labelCls}>Code</label><input value={editItem.code || ''} onChange={(e) => setEditItem({ ...editItem, code: e.target.value })} className={inputCls} /></div>
              <div><label className={labelCls}>Compétences (séparées par ,)</label><input value={editItem._competences || ''} onChange={(e) => setEditItem({ ...editItem, _competences: e.target.value })} className={inputCls} /></div>
              <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={editItem.est_obligatoire !== false} onChange={(e) => setEditItem({ ...editItem, est_obligatoire: e.target.checked })} /> Obligatoire</label>
              <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={!!editItem.permet_doublure} onChange={(e) => setEditItem({ ...editItem, permet_doublure: e.target.checked })} /> Permet la doublure</label>
              <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={editItem.is_active !== false} onChange={(e) => setEditItem({ ...editItem, is_active: e.target.checked })} /> Actif</label>
            </div>
          )}
          {editItem && editItem._kind === 'categorie' && (
            <div className="space-y-3">
              <div><label className={labelCls}>Nom</label><input value={editItem.nom || ''} onChange={(e) => setEditItem({ ...editItem, nom: e.target.value })} className={inputCls} /></div>
              <div>
                <label className={labelCls}>Famille Refashion *</label>
                <select value={editItem.famille_refashion || ''} onChange={(e) => setEditItem({ ...editItem, famille_refashion: e.target.value })} className={inputCls}>
                  <option value="">— Choisir —</option>
                  {FAMILLES_REFASHION.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                </select>
              </div>
              <div><label className={labelCls}>Famille (libellé)</label><input value={editItem.famille || ''} onChange={(e) => setEditItem({ ...editItem, famille: e.target.value })} className={inputCls} /></div>
              <div><label className={labelCls}>Ordre</label><input type="number" value={editItem.ordre ?? ''} onChange={(e) => setEditItem({ ...editItem, ordre: e.target.value === '' ? null : parseInt(e.target.value) })} className={inputCls} /></div>
              <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={editItem.is_active !== false} onChange={(e) => setEditItem({ ...editItem, is_active: e.target.checked })} /> Active</label>
            </div>
          )}
        </Modal>
      </div>
    </Layout>
  );
}
