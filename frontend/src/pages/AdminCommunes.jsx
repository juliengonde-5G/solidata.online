import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { Map, RefreshCw, Search } from 'lucide-react';
import api from '../services/api';

export default function AdminCommunes() {
  const [communes, setCommunes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [q, setQ] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [refreshResult, setRefreshResult] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.get('/communes' + (q ? `?q=${encodeURIComponent(q)}` : ''));
      setCommunes(r.data);
    } catch (e) { setError(e.response?.data?.error || e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const refreshFromInsee = async () => {
    setRefreshing(true);
    setError(null);
    setRefreshResult(null);
    try {
      const r = await api.post('/communes/refresh-metropole');
      setRefreshResult(r.data);
      await load();
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Erreur API geo.api.gouv.fr');
    } finally { setRefreshing(false); }
  };

  // auto-refresh si la liste est vide au premier chargement
  useEffect(() => {
    if (!loading && communes.length === 0 && !refreshResult && !error) {
      refreshFromInsee();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

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
          <button onClick={refreshFromInsee} disabled={refreshing}
            className="px-4 py-2 rounded-lg bg-blue-600 text-white font-bold text-sm flex items-center gap-2 hover:bg-blue-700 disabled:bg-slate-300">
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? 'Actualisation…' : 'Actualiser depuis API INSEE'}
          </button>
        </div>

        {refreshResult && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 mb-4 text-sm text-emerald-800">
            ✓ Synchronisation API INSEE — {refreshResult.inserted} créées, {refreshResult.updated} mises à jour ({refreshResult.total} communes Métropole)
          </div>
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
