import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { Euro, Plus, FileText, ShieldCheck } from 'lucide-react';
import api from '../services/api';

export default function AdminRefashionConfig() {
  const [tab, setTab] = useState('taux');
  const [taux, setTaux] = useState([]);
  const [current, setCurrent] = useState(null);
  const [agrements, setAgrements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ taux_euro_par_tonne: '', valid_from: '', valid_to: '', source_document: '', notes: '' });
  const [agrForm, setAgrForm] = useState({});

  const load = async () => {
    setLoading(true);
    try {
      const [t, c, a] = await Promise.all([
        api.get('/refashion/taux'),
        api.get('/refashion/taux/current'),
        api.get('/refashion/exutoires-agrement'),
      ]);
      setTaux(t.data);
      setCurrent(c.data);
      setAgrements(a.data);
    } catch (e) { setError(e.response?.data?.error || e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const submitTaux = async (e) => {
    e.preventDefault();
    try {
      await api.post('/refashion/taux', {
        ...form,
        taux_euro_par_tonne: parseFloat(form.taux_euro_par_tonne),
        valid_to: form.valid_to || null,
      });
      setShowForm(false);
      setForm({ taux_euro_par_tonne: '', valid_from: '', valid_to: '', source_document: '', notes: '' });
      load();
    } catch (e) { setError(e.response?.data?.error || e.message); }
  };

  const editAgrement = async (id, payload) => {
    try {
      await api.patch(`/refashion/exutoires/${id}/agrement`, payload);
      setAgrForm({ ...agrForm, [id]: undefined });
      load();
    } catch (e) { setError(e.response?.data?.error || e.message); }
  };

  return (
    <Layout>
      <div className="min-h-[calc(100vh-60px)] bg-slate-50 p-8">
        <header className="flex items-center gap-4 mb-6">
          <ShieldCheck className="w-7 h-7 text-emerald-600" />
          <h1 className="text-2xl font-bold text-slate-800">Configuration Refashion</h1>
        </header>

        <nav className="bg-white rounded-2xl shadow p-2 inline-flex gap-1 mb-6">
          <button onClick={() => setTab('taux')}
            className={`px-4 py-2 rounded-xl font-semibold text-sm flex items-center gap-2 ${
              tab === 'taux' ? 'bg-emerald-600 text-white shadow' : 'text-slate-600 hover:bg-slate-100'
            }`}>
            <Euro className="w-4 h-4" /> Taux de subvention (conventions)
          </button>
          <button onClick={() => setTab('agrement')}
            className={`px-4 py-2 rounded-xl font-semibold text-sm flex items-center gap-2 ${
              tab === 'agrement' ? 'bg-emerald-600 text-white shadow' : 'text-slate-600 hover:bg-slate-100'
            }`}>
            <FileText className="w-4 h-4" /> Agrément exutoires
          </button>
        </nav>

        {error && <div className="bg-rose-50 text-rose-700 p-3 rounded mb-4 text-sm">{error}</div>}
        {loading && <div className="text-slate-400 mb-4">Chargement…</div>}

        {tab === 'taux' && (
          <>
            <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5 mb-6 flex items-center justify-between">
              <div>
                <div className="text-xs uppercase tracking-wider text-emerald-700 font-semibold">Taux courant (aujourd'hui)</div>
                <div className="text-4xl font-extrabold text-emerald-700 mt-1">
                  {current?.taux_euro_par_tonne != null ? `${current.taux_euro_par_tonne} €/t` : '—'}
                </div>
                <div className="text-sm text-emerald-700/70 mt-1">par tonne entrant à la chaîne de tri</div>
              </div>
              <button onClick={() => setShowForm(true)}
                className="px-5 py-3 rounded-xl bg-emerald-600 text-white font-bold flex items-center gap-2 hover:bg-emerald-700">
                <Plus className="w-5 h-5" /> Nouvelle convention / avenant
              </button>
            </div>

            {showForm && (
              <form onSubmit={submitTaux} className="bg-white rounded-2xl shadow p-6 mb-6 grid gap-4 md:grid-cols-2">
                <div>
                  <label className="text-xs font-semibold text-slate-600 block mb-1">Taux €/t entrant</label>
                  <input type="number" step="0.01" required value={form.taux_euro_par_tonne}
                    onChange={e => setForm({ ...form, taux_euro_par_tonne: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg" placeholder="ex: 193.00" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-600 block mb-1">Document source</label>
                  <input value={form.source_document}
                    onChange={e => setForm({ ...form, source_document: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg" placeholder="ex: Convention 2024" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-600 block mb-1">Valide à partir du</label>
                  <input type="date" required value={form.valid_from}
                    onChange={e => setForm({ ...form, valid_from: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-600 block mb-1">Valide jusqu'au (optionnel)</label>
                  <input type="date" value={form.valid_to}
                    onChange={e => setForm({ ...form, valid_to: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg" />
                </div>
                <div className="md:col-span-2">
                  <label className="text-xs font-semibold text-slate-600 block mb-1">Notes</label>
                  <textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg" rows="2" />
                </div>
                <div className="md:col-span-2 flex gap-3 justify-end">
                  <button type="button" onClick={() => setShowForm(false)} className="px-5 py-2 rounded-lg bg-slate-200 hover:bg-slate-300 font-semibold">Annuler</button>
                  <button type="submit" className="px-5 py-2 rounded-lg bg-emerald-600 text-white font-bold hover:bg-emerald-700">Enregistrer</button>
                </div>
              </form>
            )}

            <div className="bg-white rounded-2xl shadow overflow-hidden">
              <h2 className="px-6 py-4 border-b font-bold text-slate-700">Historique des conventions et avenants</h2>
              <table className="w-full">
                <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Taux €/t</th>
                    <th className="px-4 py-3">Valide du</th>
                    <th className="px-4 py-3">Valide jusqu'au</th>
                    <th className="px-4 py-3">Document</th>
                    <th className="px-4 py-3">Saisi par</th>
                  </tr>
                </thead>
                <tbody>
                  {taux.map(t => (
                    <tr key={t.id} className="border-t hover:bg-slate-50">
                      <td className="px-4 py-3 font-bold text-slate-800 tabular-nums">{t.taux_euro_par_tonne} €</td>
                      <td className="px-4 py-3 text-slate-600">{t.valid_from}</td>
                      <td className="px-4 py-3 text-slate-600">{t.valid_to || <span className="text-emerald-600 font-semibold">en cours</span>}</td>
                      <td className="px-4 py-3 text-slate-600">{t.source_document || '—'}</td>
                      <td className="px-4 py-3 text-slate-400 text-xs">{t.created_by_username || '—'}</td>
                    </tr>
                  ))}
                  {taux.length === 0 && (
                    <tr><td colSpan="5" className="px-4 py-8 text-center text-slate-400">
                      Aucun taux paramétré. Ajoute la convention en vigueur pour activer le calcul de subvention.
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}

        {tab === 'agrement' && (
          <div className="bg-white rounded-2xl shadow overflow-hidden">
            <h2 className="px-6 py-4 border-b font-bold text-slate-700">
              Exutoires — agrément Refashion ({agrements.filter(a => a.agrement_refashion).length}/{agrements.length} agréés)
            </h2>
            <table className="w-full">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Exutoire</th>
                  <th className="px-4 py-3 text-center">Agréé</th>
                  <th className="px-4 py-3">N° agrément</th>
                  <th className="px-4 py-3">Du</th>
                  <th className="px-4 py-3">Au</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {agrements.map(a => {
                  const edit = agrForm[a.id] !== undefined;
                  const val = agrForm[a.id] || a;
                  return (
                    <tr key={a.id} className="border-t hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-slate-800">{a.nom}</td>
                      <td className="px-4 py-3 text-center">
                        <input type="checkbox" checked={!!val.agrement_refashion}
                          onChange={e => setAgrForm({ ...agrForm, [a.id]: { ...val, agrement_refashion: e.target.checked } })}
                          className="w-5 h-5 accent-emerald-600" />
                      </td>
                      <td className="px-4 py-3">
                        <input value={val.agrement_numero || ''}
                          onChange={e => setAgrForm({ ...agrForm, [a.id]: { ...val, agrement_numero: e.target.value } })}
                          className="px-2 py-1 border rounded text-sm w-32" />
                      </td>
                      <td className="px-4 py-3">
                        <input type="date" value={val.agrement_date_debut?.slice(0, 10) || ''}
                          onChange={e => setAgrForm({ ...agrForm, [a.id]: { ...val, agrement_date_debut: e.target.value } })}
                          className="px-2 py-1 border rounded text-sm" />
                      </td>
                      <td className="px-4 py-3">
                        <input type="date" value={val.agrement_date_fin?.slice(0, 10) || ''}
                          onChange={e => setAgrForm({ ...agrForm, [a.id]: { ...val, agrement_date_fin: e.target.value } })}
                          className="px-2 py-1 border rounded text-sm" />
                      </td>
                      <td className="px-4 py-3">
                        {edit && (
                          <button onClick={() => editAgrement(a.id, val)}
                            className="px-3 py-1 rounded bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700">
                            Enregistrer
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Layout>
  );
}
