import { useState, useEffect, useCallback } from 'react';
import Layout from '../components/Layout';
import { Map, RefreshCw, Search, Landmark, Plus, X, AlertTriangle, CheckCircle2 } from 'lucide-react';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';

// Lot 10 (2026-08) — le référentiel communes couvre la Métropole Rouen Normandie
// ET des EPCI limitrophes (Eure 27 / Seine-Maritime 76) configurés par l'admin.
// La recherche d'EPCI passe par le backend (proxy geo.api.gouv.fr) : elle ne
// fonctionne que si le serveur a accès à Internet (cas de la production).
export default function AdminCommunes() {
  const { user } = useAuth();
  const isAdmin = (user?.base_role || user?.role) === 'ADMIN';

  const [communes, setCommunes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [q, setQ] = useState('');
  const [epciFilter, setEpciFilter] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [refreshResult, setRefreshResult] = useState(null);

  // EPCI suivis
  const [epcis, setEpcis] = useState([]);
  const [metropoleCode, setMetropoleCode] = useState('200023414');
  const [epciError, setEpciError] = useState(null);

  // Recherche d'EPCI (geo.api.gouv.fr via le backend)
  const [searchQ, setSearchQ] = useState('');
  const [searchDep, setSearchDep] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(null);

  const load = useCallback(async (opts = {}) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      const qv = opts.q ?? q;
      const ev = opts.epci ?? epciFilter;
      if (qv) params.set('q', qv);
      if (ev) params.set('epci', ev);
      const qs = params.toString();
      const r = await api.get('/communes' + (qs ? `?${qs}` : ''));
      setCommunes(r.data);
    } catch (e) { setError(e.response?.data?.error || e.message); }
    finally { setLoading(false); }
  }, [q, epciFilter]);

  const loadEpcis = useCallback(async () => {
    try {
      const r = await api.get('/communes/epcis');
      setEpcis(r.data.epcis || []);
      if (r.data.metropole_code) setMetropoleCode(r.data.metropole_code);
    } catch (e) { setEpciError(e.response?.data?.error || e.message); }
  }, []);

  useEffect(() => { load(); loadEpcis(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const refreshFromApi = async () => {
    setRefreshing(true);
    setError(null);
    setRefreshResult(null);
    try {
      const r = await api.post('/communes/refresh-epcis');
      setRefreshResult(r.data);
      await load();
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Erreur API geo.api.gouv.fr');
    } finally { setRefreshing(false); }
  };

  const searchEpcis = async () => {
    if (searchQ.trim().length < 2) { setSearchError('Saisis au moins 2 caractères.'); return; }
    setSearching(true);
    setSearchError(null);
    setSearchResults(null);
    try {
      const params = new URLSearchParams({ q: searchQ.trim() });
      if (searchDep) params.set('dep', searchDep);
      const r = await api.get(`/communes/epci-search?${params.toString()}`);
      setSearchResults(r.data.results || []);
    } catch (e) {
      setSearchError(e.response?.data?.error || e.message);
    } finally { setSearching(false); }
  };

  const addEpci = async (epci) => {
    setEpciError(null);
    try {
      const r = await api.post('/communes/epcis', { code: epci.code, nom: epci.nom });
      setEpcis(r.data.epcis || []);
      setSearchResults((prev) => prev ? prev.map((e) => e.code === epci.code ? { ...e, deja_suivi: true } : e) : prev);
    } catch (e) { setEpciError(e.response?.data?.error || e.message); }
  };

  const removeEpci = async (code) => {
    if (!window.confirm('Retirer cet EPCI de la liste suivie ? Les communes déjà importées resteront dans le référentiel, mais ne seront plus actualisées.')) return;
    setEpciError(null);
    try {
      const r = await api.delete(`/communes/epcis/${code}`);
      setEpcis(r.data.epcis || []);
    } catch (e) { setEpciError(e.response?.data?.error || e.message); }
  };

  const suiviCodes = new Set(epcis.map((e) => e.code));

  return (
    <Layout>
      <div className="min-h-[calc(100vh-60px)] bg-slate-50 p-8">
        <header className="flex items-center gap-4 mb-6">
          <Map className="w-7 h-7 text-blue-600" />
          <div>
            <h1 className="text-2xl font-bold text-slate-800">Référentiel communes (INSEE)</h1>
            <p className="text-sm text-slate-500">Métropole Rouen Normandie et communautés de communes limitrophes (27 / 76)</p>
          </div>
        </header>

        {error && <div className="bg-rose-50 text-rose-700 p-3 rounded mb-4 text-sm">{error}</div>}

        {/* ── EPCI suivis ─────────────────────────────────────────────── */}
        <div className="bg-white rounded-2xl shadow p-5 mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Landmark className="w-5 h-5 text-blue-600" />
            <h2 className="font-bold text-slate-800">EPCI suivis</h2>
            <span className="text-xs text-slate-400">— la synchronisation des communes porte sur ces intercommunalités</span>
          </div>

          {epciError && <div className="bg-rose-50 text-rose-700 p-2 rounded mb-3 text-sm">{epciError}</div>}

          <div className="flex flex-wrap gap-2 mb-4">
            {epcis.map((e) => (
              <span key={e.code}
                className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium border ${e.code === metropoleCode ? 'bg-blue-50 border-blue-200 text-blue-800' : 'bg-slate-50 border-slate-200 text-slate-700'}`}>
                {e.nom}
                <code className="text-[11px] text-slate-400 font-mono">{e.code}</code>
                {isAdmin && e.code !== metropoleCode && (
                  <button onClick={() => removeEpci(e.code)} title="Retirer cet EPCI"
                    className="text-slate-400 hover:text-rose-600">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </span>
            ))}
            {epcis.length === 0 && <span className="text-sm text-slate-400">Chargement…</span>}
          </div>

          {/* Recherche d'un EPCI à ajouter (ADMIN) */}
          {isAdmin && (
            <div className="border-t pt-4">
              <div className="text-sm font-semibold text-slate-700 mb-2">Ajouter une communauté de communes</div>
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <div className="relative flex-1 min-w-[220px] max-w-md">
                  <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
                  <input value={searchQ} onChange={(e) => setSearchQ(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && searchEpcis()}
                    placeholder="Nom de l'EPCI (ex. Caux, Andelle, Roumois…)"
                    className="w-full pl-10 pr-3 py-2 border rounded-lg" />
                </div>
                <select value={searchDep} onChange={(e) => setSearchDep(e.target.value)}
                  className="px-3 py-2 border rounded-lg text-sm bg-white">
                  <option value="">Tous départements</option>
                  <option value="27">Eure (27)</option>
                  <option value="76">Seine-Maritime (76)</option>
                </select>
                <button onClick={searchEpcis} disabled={searching}
                  className="px-4 py-2 rounded-lg bg-slate-800 text-white font-semibold text-sm hover:bg-slate-700 disabled:bg-slate-300">
                  {searching ? 'Recherche…' : 'Rechercher'}
                </button>
              </div>

              {searchError && (
                <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 text-amber-800 p-3 rounded-lg text-sm mb-2">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{searchError}</span>
                </div>
              )}

              {searchResults && searchResults.length === 0 && (
                <div className="text-sm text-slate-500">Aucun EPCI trouvé pour cette recherche.</div>
              )}
              {searchResults && searchResults.length > 0 && (
                <ul className="divide-y border rounded-lg overflow-hidden">
                  {searchResults.map((e) => (
                    <li key={e.code} className="flex items-center gap-3 px-3 py-2 bg-white hover:bg-slate-50">
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-slate-800 text-sm truncate">{e.nom}</div>
                        <div className="text-xs text-slate-400 font-mono">{e.code}{e.departements?.length > 0 && ` — dép. ${e.departements.join(', ')}`}</div>
                      </div>
                      {e.deja_suivi || suiviCodes.has(e.code) ? (
                        <span className="inline-flex items-center gap-1 text-emerald-700 text-xs font-semibold">
                          <CheckCircle2 className="w-4 h-4" /> Déjà suivi
                        </span>
                      ) : (
                        <button onClick={() => addEpci(e)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-bold hover:bg-blue-700">
                          <Plus className="w-3.5 h-3.5" /> Ajouter
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {/* ── Actions + filtres communes ──────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-3 mb-6">
          <div className="relative flex-1 min-w-[200px] max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
            <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && load()}
              placeholder="Rechercher une commune…"
              className="w-full pl-10 pr-3 py-2 border rounded-lg" />
          </div>
          <select value={epciFilter}
            onChange={(e) => { setEpciFilter(e.target.value); load({ epci: e.target.value }); }}
            className="px-3 py-2 border rounded-lg text-sm bg-white max-w-[260px]">
            <option value="">Tous les EPCI</option>
            {epcis.map((e) => <option key={e.code} value={e.code}>{e.nom}</option>)}
            <option value="none">(sans EPCI renseigné)</option>
          </select>
          <button onClick={() => load()} className="px-4 py-2 rounded-lg bg-slate-200 hover:bg-slate-300 font-semibold text-sm">Filtrer</button>
          <div className="flex-1" />
          <button onClick={refreshFromApi} disabled={refreshing}
            className="px-4 py-2 rounded-lg bg-blue-600 text-white font-bold text-sm flex items-center gap-2 hover:bg-blue-700 disabled:bg-slate-300">
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? 'Actualisation…' : 'Actualiser depuis l\'API'}
          </button>
        </div>

        {/* Récap du refresh, par EPCI */}
        {refreshResult && (
          <div className={`border rounded-xl p-4 mb-4 text-sm ${refreshResult.echecs > 0 ? 'bg-amber-50 border-amber-200 text-amber-900' : 'bg-emerald-50 border-emerald-200 text-emerald-800'}`}>
            <div className="font-semibold mb-2">
              Synchronisation geo.api.gouv.fr — {refreshResult.inserted} commune(s) créée(s), {refreshResult.updated} mise(s) à jour
              {refreshResult.echecs > 0 && ` — ${refreshResult.echecs} EPCI en échec`}
            </div>
            <ul className="space-y-1">
              {(refreshResult.epcis || []).map((e) => (
                <li key={e.code} className="flex items-center gap-2">
                  {e.erreur
                    ? <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                    : <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />}
                  <span className="font-medium">{e.nom}</span>
                  <code className="text-[11px] text-slate-500 font-mono">{e.code}</code>
                  {e.erreur
                    ? <span className="text-amber-800">— {e.erreur}</span>
                    : <span>— {e.communes_upsertees} commune(s) synchronisée(s) ({e.inserted} créées, {e.updated} mises à jour)</span>}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ── Tableau des communes ────────────────────────────────────── */}
        <div className="bg-white rounded-2xl shadow overflow-hidden">
          {loading && <div className="p-8 text-center text-slate-400">Chargement…</div>}
          {!loading && communes.length === 0 && (
            <div className="p-12 text-center">
              <Map className="w-16 h-16 text-slate-300 mx-auto mb-4" />
              <div className="text-xl font-bold text-slate-700 mb-2">Aucune commune chargée</div>
              <p className="text-sm text-slate-500 mb-6 max-w-md mx-auto">
                Clique sur <strong>« Actualiser depuis l'API »</strong> pour charger automatiquement les communes
                des EPCI suivis depuis <code className="px-1 bg-slate-100 rounded">geo.api.gouv.fr</code>.
              </p>
              <button onClick={refreshFromApi} disabled={refreshing}
                className="px-6 py-4 rounded-2xl bg-blue-600 text-white font-bold text-lg flex items-center gap-3 mx-auto hover:bg-blue-700 shadow-lg disabled:bg-slate-300">
                <RefreshCw className={`w-6 h-6 ${refreshing ? 'animate-spin' : ''}`} />
                {refreshing ? 'Chargement depuis geo.api.gouv.fr…' : 'Charger maintenant'}
              </button>
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
                    <td className="px-4 py-3 text-sm">
                      {c.epci_nom
                        ? (
                          <span className={c.is_metropole_rouen ? 'inline-flex items-center gap-1.5 text-blue-700' : 'text-slate-600'}>
                            {c.epci_nom}
                            {c.is_metropole_rouen && <span className="text-[10px] font-bold uppercase bg-blue-50 border border-blue-200 rounded px-1.5 py-0.5">Métropole</span>}
                          </span>
                        )
                        : <span className="text-slate-400">—</span>}
                    </td>
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
