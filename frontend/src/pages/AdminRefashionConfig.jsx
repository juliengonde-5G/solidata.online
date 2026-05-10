import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { Euro, Plus, ShieldCheck } from 'lucide-react';
import api from '../services/api';

export default function AdminRefashionConfig() {
  const [taux, setTaux] = useState([]);
  const [current, setCurrent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ taux_euro_par_tonne: '', valid_from: '', valid_to: '', source_document: '', notes: '' });

  const load = async () => {
    setLoading(true);
    try {
      const [t, c] = await Promise.all([
        api.get('/refashion/taux'),
        api.get('/refashion/taux/current'),
      ]);
      setTaux(t.data);
      setCurrent(c.data);
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

  return (
    <Layout>
      <div className="min-h-[calc(100vh-60px)] bg-slate-50 p-8">
        <header className="flex items-center gap-4 mb-6">
          <ShieldCheck className="w-7 h-7 text-emerald-600" />
          <h1 className="text-2xl font-bold text-slate-800">Configuration Refashion</h1>
        </header>

        {error && <div className="bg-rose-50 text-rose-700 p-3 rounded mb-4 text-sm">{error}</div>}
        {loading && <div className="text-slate-400 mb-4">Chargement…</div>}

        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5 mb-6 flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-wider text-emerald-700 font-semibold flex items-center gap-2">
              <Euro className="w-4 h-4" /> Taux courant (aujourd'hui)
            </div>
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
      </div>
    </Layout>
  );
}
