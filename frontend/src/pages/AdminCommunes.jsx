import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { Map, Plus, Upload, Search } from 'lucide-react';
import api from '../services/api';

export default function AdminCommunes() {
  const [communes, setCommunes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [q, setQ] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [form, setForm] = useState({ code_insee: '', nom: '', code_postal: '', epci_code: '', epci_nom: 'Métropole Rouen Normandie', population_insee: '', is_metropole_rouen: true });
  const [csvText, setCsvText] = useState('');
  const [importResult, setImportResult] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get('/communes' + (q ? `?q=${encodeURIComponent(q)}` : ''));
      setCommunes(r.data);
    } catch (e) { setError(e.response?.data?.error || e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const submit = async (e) => {
    e.preventDefault();
    try {
      await api.post('/communes', {
        ...form,
        population_insee: form.population_insee ? parseInt(form.population_insee) : null,
      });
      setShowForm(false);
      setForm({ code_insee: '', nom: '', code_postal: '', epci_code: '', epci_nom: 'Métropole Rouen Normandie', population_insee: '', is_metropole_rouen: true });
      load();
    } catch (e) { setError(e.response?.data?.error || e.message); }
  };

  const submitImport = async () => {
    try {
      const lines = csvText.trim().split('\n');
      if (lines.length < 2) { setError('CSV doit contenir au moins 2 lignes (header + data)'); return; }
      const header = lines[0].split(/[,;\t]/).map(h => h.trim().toLowerCase());
      const idx = (name) => header.indexOf(name);
      const rows = lines.slice(1).map(line => {
        const cols = line.split(/[,;\t]/).map(c => c.trim());
        return {
          code_insee: cols[idx('code_insee')] || cols[idx('insee')],
          nom: cols[idx('nom')] || cols[idx('commune')],
          code_postal: cols[idx('code_postal')] || cols[idx('cp')],
          epci_code: cols[idx('epci_code')],
          epci_nom: cols[idx('epci_nom')],
          population_insee: cols[idx('population_insee')] || cols[idx('population')]
            ? parseInt(cols[idx('population_insee')] || cols[idx('population')])
            : null,
          is_metropole_rouen: true,
        };
      }).filter(r => r.code_insee && r.nom);

      const res = await api.post('/communes/import', { rows });
      setImportResult(res.data);
      setCsvText('');
      load();
    } catch (e) { setError(e.response?.data?.error || e.message); }
  };

  return (
    <Layout>
      <div className="min-h-[calc(100vh-60px)] bg-slate-50 p-8">
        <header className="flex items-center gap-4 mb-6">
          <Map className="w-7 h-7 text-blue-600" />
          <h1 className="text-2xl font-bold text-slate-800">Référentiel communes — Métropole Rouen</h1>
        </header>

        {error && <div className="bg-rose-50 text-rose-700 p-3 rounded mb-4 text-sm">{error}</div>}

        <div className="flex flex-wrap items-center gap-3 mb-6">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
            <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && load()}
              placeholder="Rechercher une commune…"
              className="w-full pl-10 pr-3 py-2 border rounded-lg" />
          </div>
          <button onClick={load} className="px-4 py-2 rounded-lg bg-slate-200 hover:bg-slate-300 font-semibold text-sm">Filtrer</button>
          <div className="flex-1" />
          <button onClick={() => setShowImport(!showImport)} className="px-4 py-2 rounded-lg bg-white border font-semibold text-sm flex items-center gap-2 hover:bg-slate-100">
            <Upload className="w-4 h-4" /> Import CSV
          </button>
          <button onClick={() => setShowForm(!showForm)} className="px-4 py-2 rounded-lg bg-blue-600 text-white font-bold text-sm flex items-center gap-2 hover:bg-blue-700">
            <Plus className="w-4 h-4" /> Nouvelle commune
          </button>
        </div>

        {showImport && (
          <div className="bg-white rounded-2xl shadow p-5 mb-6">
            <h3 className="font-bold text-slate-700 mb-2">Import CSV</h3>
            <p className="text-sm text-slate-500 mb-3">Format attendu (séparateur , ; ou tab) : <code className="bg-slate-100 px-1 rounded">code_insee,nom,code_postal,epci_code,epci_nom,population_insee</code></p>
            <textarea value={csvText} onChange={e => setCsvText(e.target.value)}
              rows="6" placeholder="code_insee,nom,code_postal,epci_code,epci_nom,population_insee&#10;76540,Rouen,76000,200023414,Métropole Rouen Normandie,110988"
              className="w-full px-3 py-2 border rounded-lg font-mono text-sm" />
            <div className="flex gap-2 mt-3">
              <button onClick={submitImport} className="px-5 py-2 rounded-lg bg-blue-600 text-white font-bold hover:bg-blue-700">Importer</button>
              {importResult && <span className="text-sm text-emerald-700 font-semibold self-center">
                ✓ {importResult.inserted} créées, {importResult.updated} mises à jour
              </span>}
            </div>
          </div>
        )}

        {showForm && (
          <form onSubmit={submit} className="bg-white rounded-2xl shadow p-5 mb-6 grid gap-4 md:grid-cols-3">
            <div>
              <label className="text-xs font-semibold text-slate-600 block mb-1">Code INSEE (5)</label>
              <input required value={form.code_insee} onChange={e => setForm({ ...form, code_insee: e.target.value })}
                pattern="\d{5}" className="w-full px-3 py-2 border rounded-lg" placeholder="76540" />
            </div>
            <div className="md:col-span-2">
              <label className="text-xs font-semibold text-slate-600 block mb-1">Nom</label>
              <input required value={form.nom} onChange={e => setForm({ ...form, nom: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg" placeholder="Rouen" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600 block mb-1">Code postal</label>
              <input value={form.code_postal} onChange={e => setForm({ ...form, code_postal: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg" placeholder="76000" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600 block mb-1">Population</label>
              <input type="number" value={form.population_insee} onChange={e => setForm({ ...form, population_insee: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600 block mb-1">EPCI</label>
              <input value={form.epci_nom} onChange={e => setForm({ ...form, epci_nom: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg" />
            </div>
            <div className="md:col-span-3 flex gap-3 justify-end">
              <button type="button" onClick={() => setShowForm(false)} className="px-5 py-2 rounded-lg bg-slate-200 hover:bg-slate-300 font-semibold">Annuler</button>
              <button type="submit" className="px-5 py-2 rounded-lg bg-blue-600 text-white font-bold hover:bg-blue-700">Enregistrer</button>
            </div>
          </form>
        )}

        <div className="bg-white rounded-2xl shadow overflow-hidden">
          {loading && <div className="p-8 text-center text-slate-400">Chargement…</div>}
          {!loading && communes.length === 0 && (
            <div className="p-8 text-center text-slate-400">
              Aucune commune. Importe le référentiel INSEE COG via le bouton « Import CSV » ci-dessus.
            </div>
          )}
          {!loading && communes.length > 0 && (
            <table className="w-full">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3 w-24">INSEE</th>
                  <th className="px-4 py-3">Nom</th>
                  <th className="px-4 py-3 w-24">CP</th>
                  <th className="px-4 py-3">EPCI</th>
                  <th className="px-4 py-3 w-28 text-right">Population</th>
                </tr>
              </thead>
              <tbody>
                {communes.map(c => (
                  <tr key={c.code_insee} className="border-t hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-slate-600">{c.code_insee}</td>
                    <td className="px-4 py-3 font-medium text-slate-800">{c.nom}</td>
                    <td className="px-4 py-3 text-slate-600">{c.code_postal || '—'}</td>
                    <td className="px-4 py-3 text-slate-500 text-sm">{c.epci_nom || '—'}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-600">{c.population_insee?.toLocaleString('fr-FR') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </Layout>
  );
}
