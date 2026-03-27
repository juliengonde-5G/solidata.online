import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import api from '../services/api';
import { useAuth } from '../contexts/AuthContext';

export default function Pennylane() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const [status, setStatus] = useState(null);
  const [config, setConfig] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncingGL, setSyncingGL] = useState(false);
  const [syncingTx, setSyncingTx] = useState(false);
  const [syncingBal, setSyncingBal] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [syncResult, setSyncResult] = useState(null);
  const [balances, setBalances] = useState(null);
  const [showConfig, setShowConfig] = useState(false);
  const [configForm, setConfigForm] = useState({
    api_key: '', company_id: '', is_active: false,
    sync_invoices: true, sync_suppliers: true, sync_journal: true,
  });

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    try {
      const [statusRes, historyRes] = await Promise.all([
        api.get('/pennylane/status').catch(() => ({ data: { configured: false, active: false } })),
        api.get('/pennylane/sync/history').catch(() => ({ data: [] })),
      ]);
      setStatus(statusRes.data);
      setHistory(historyRes.data);
      if (isAdmin) {
        const configRes = await api.get('/pennylane/config').catch(() => ({ data: null }));
        setConfig(configRes.data);
        if (configRes.data) {
          setConfigForm(prev => ({
            ...prev,
            company_id: configRes.data.company_id || '',
            is_active: configRes.data.is_active || false,
            sync_invoices: configRes.data.sync_invoices ?? true,
            sync_suppliers: configRes.data.sync_suppliers ?? true,
            sync_journal: configRes.data.sync_journal ?? true,
          }));
        }
      }
    } catch (err) { console.error(err); }
    setLoading(false);
  };

  const testConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await api.post('/pennylane/test');
      setTestResult(res.data);
    } catch (err) {
      setTestResult({ connected: false, error: err.response?.data?.error || 'Erreur de connexion' });
    }
    setTesting(false);
  };

  const saveConfig = async (e) => {
    e.preventDefault();
    try {
      await api.put('/pennylane/config', configForm);
      setShowConfig(false);
      loadAll();
    } catch (err) {
      alert(err.response?.data?.error || 'Erreur lors de la sauvegarde');
    }
  };

  const syncInvoices = async () => {
    setSyncing(true); setSyncResult(null);
    try { const res = await api.post('/pennylane/sync/invoices'); setSyncResult({ type: 'Factures', ...res.data }); loadAll(); }
    catch (err) { setSyncResult({ type: 'Factures', error: err.response?.data?.error || 'Erreur' }); }
    setSyncing(false);
  };
  const syncGL = async () => {
    setSyncingGL(true); setSyncResult(null);
    try { const res = await api.post('/pennylane/sync/gl', { year: new Date().getFullYear() }); setSyncResult({ type: 'GL Analytique', ...res.data }); loadAll(); }
    catch (err) { setSyncResult({ type: 'GL Analytique', error: err.response?.data?.error || 'Erreur' }); }
    setSyncingGL(false);
  };
  const syncTransactions = async () => {
    setSyncingTx(true); setSyncResult(null);
    try { const res = await api.post('/pennylane/sync/transactions', { year: new Date().getFullYear() }); setSyncResult({ type: 'Transactions', ...res.data }); loadAll(); }
    catch (err) { setSyncResult({ type: 'Transactions', error: err.response?.data?.error || 'Erreur' }); }
    setSyncingTx(false);
  };
  const loadBalances = async () => {
    setSyncingBal(true); setSyncResult(null);
    try { const res = await api.get(`/pennylane/sync/balances?year=${new Date().getFullYear()}`); setBalances(res.data); setSyncResult({ type: 'Balances', message: `${res.data.accounts?.length || 0} compte(s) récupéré(s)` }); }
    catch (err) { setSyncResult({ type: 'Balances', error: err.response?.data?.error || 'Erreur' }); }
    setSyncingBal(false);
  };

  const formatDate = (d) => d ? new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

  if (loading) return <Layout><div className="p-6">Chargement...</div></Layout>;

  return (
    <Layout>
      <div className="p-6 max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-indigo-100 flex items-center justify-center">
              <IconPennylane className="w-6 h-6 text-indigo-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-800">Finances — Pennylane</h1>
              <p className="text-slate-500 text-sm">Connexion comptable avec Pennylane</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {status?.active ? (
              <span className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-green-100 text-green-700 text-sm font-medium">
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" /> Connecte
              </span>
            ) : (
              <span className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-100 text-gray-500 text-sm font-medium">
                <span className="w-2 h-2 rounded-full bg-gray-400" /> Deconnecte
              </span>
            )}
            {isAdmin && (
              <button onClick={() => setShowConfig(true)} className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-200">
                Configuration
              </button>
            )}
          </div>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl shadow-sm border p-5">
            <p className="text-xs text-slate-500 mb-1">Statut connexion</p>
            <p className={`text-lg font-bold ${status?.active ? 'text-green-600' : 'text-gray-400'}`}>
              {status?.active ? 'Active' : 'Inactive'}
            </p>
          </div>
          <div className="bg-white rounded-xl shadow-sm border p-5">
            <p className="text-xs text-slate-500 mb-1">Societe Pennylane</p>
            <p className="text-lg font-bold text-slate-800">{status?.company_id || '—'}</p>
          </div>
          <div className="bg-white rounded-xl shadow-sm border p-5">
            <p className="text-xs text-slate-500 mb-1">Derniere synchronisation</p>
            <p className="text-sm font-medium text-slate-700">{formatDate(status?.last_sync)}</p>
          </div>
          <div className="bg-white rounded-xl shadow-sm border p-5">
            <p className="text-xs text-slate-500 mb-1">Elements synchronises</p>
            <p className="text-lg font-bold text-indigo-600">{status?.total_mappings || 0}</p>
          </div>
        </div>

        {/* Actions */}
        <div className="bg-white rounded-xl shadow-sm border p-6">
          <h2 className="font-bold text-slate-800 mb-4">Actions de synchronisation</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
            <button onClick={testConnection} disabled={testing || !status?.configured} className="flex items-center gap-3 p-4 rounded-lg border-2 border-dashed border-slate-200 hover:border-indigo-300 hover:bg-indigo-50 transition disabled:opacity-50">
              <div className="w-10 h-10 rounded-lg bg-indigo-100 flex items-center justify-center"><IconPlug className="w-5 h-5 text-indigo-600" /></div>
              <div className="text-left"><p className="font-medium text-sm">{testing ? 'Test en cours...' : 'Tester la connexion'}</p><p className="text-xs text-slate-400">Vérifier l'API Pennylane</p></div>
            </button>
            <button onClick={syncInvoices} disabled={syncing || !status?.active} className="flex items-center gap-3 p-4 rounded-lg border-2 border-dashed border-slate-200 hover:border-green-300 hover:bg-green-50 transition disabled:opacity-50">
              <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center"><IconSync className="w-5 h-5 text-green-600" /></div>
              <div className="text-left"><p className="font-medium text-sm">{syncing ? 'Synchronisation...' : 'Factures → Pennylane'}</p><p className="text-xs text-slate-400">Pousser les factures</p></div>
            </button>
            <button onClick={() => window.open('https://app.pennylane.com', '_blank')} className="flex items-center gap-3 p-4 rounded-lg border-2 border-dashed border-slate-200 hover:border-purple-300 hover:bg-purple-50 transition">
              <div className="w-10 h-10 rounded-lg bg-purple-100 flex items-center justify-center"><IconExternal className="w-5 h-5 text-purple-600" /></div>
              <div className="text-left"><p className="font-medium text-sm">Ouvrir Pennylane</p><p className="text-xs text-slate-400">Accéder à l'interface</p></div>
            </button>
          </div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Import depuis Pennylane</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <button onClick={syncGL} disabled={syncingGL || !status?.active} className="flex items-center gap-3 p-4 rounded-lg border-2 border-dashed border-slate-200 hover:border-blue-300 hover:bg-blue-50 transition disabled:opacity-50">
              <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center"><IconDownload className="w-5 h-5 text-blue-600" /></div>
              <div className="text-left"><p className="font-medium text-sm">{syncingGL ? 'Import en cours...' : 'GL Analytique'}</p><p className="text-xs text-slate-400">Écritures comptables → Finance</p></div>
            </button>
            <button onClick={syncTransactions} disabled={syncingTx || !status?.active} className="flex items-center gap-3 p-4 rounded-lg border-2 border-dashed border-slate-200 hover:border-teal-300 hover:bg-teal-50 transition disabled:opacity-50">
              <div className="w-10 h-10 rounded-lg bg-teal-100 flex items-center justify-center"><IconDownload className="w-5 h-5 text-teal-600" /></div>
              <div className="text-left"><p className="font-medium text-sm">{syncingTx ? 'Import en cours...' : 'Trésorerie'}</p><p className="text-xs text-slate-400">Mouvements bancaires → Finance</p></div>
            </button>
            <button onClick={loadBalances} disabled={syncingBal || !status?.active} className="flex items-center gap-3 p-4 rounded-lg border-2 border-dashed border-slate-200 hover:border-amber-300 hover:bg-amber-50 transition disabled:opacity-50">
              <div className="w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center"><IconDownload className="w-5 h-5 text-amber-600" /></div>
              <div className="text-left"><p className="font-medium text-sm">{syncingBal ? 'Chargement...' : 'Balances comptables'}</p><p className="text-xs text-slate-400">Soldes par compte</p></div>
            </button>
          </div>
          {testResult && (
            <div className={`mt-4 p-4 rounded-lg ${testResult.connected ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
              <p className={`text-sm font-medium ${testResult.connected ? 'text-green-700' : 'text-red-700'}`}>{testResult.connected ? `Connexion réussie — ${testResult.company || testResult.message}` : `Échec — ${testResult.error}`}</p>
            </div>
          )}
          {syncResult && (
            <div className={`mt-4 p-4 rounded-lg ${syncResult.error ? 'bg-red-50 border border-red-200' : 'bg-green-50 border border-green-200'}`}>
              <p className={`text-sm font-medium ${syncResult.error ? 'text-red-700' : 'text-green-700'}`}>{syncResult.type} : {syncResult.error || syncResult.message || `${syncResult.count || 0} élément(s) synchronisé(s)`}</p>
            </div>
          )}
        </div>

        {/* Balances comptables */}
        {balances && (
          <div className="bg-white rounded-xl shadow-sm border p-6">
            <h2 className="font-bold text-slate-800 mb-4">Balances comptables {balances.year}</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <div className="bg-blue-50 rounded-lg p-3"><p className="text-xs text-blue-500">Total débit</p><p className="text-lg font-bold text-blue-700">{(balances.totals?.debit || 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} €</p></div>
              <div className="bg-red-50 rounded-lg p-3"><p className="text-xs text-red-500">Total crédit</p><p className="text-lg font-bold text-red-700">{(balances.totals?.credit || 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} €</p></div>
              <div className="bg-green-50 rounded-lg p-3"><p className="text-xs text-green-500">Solde</p><p className="text-lg font-bold text-green-700">{(balances.totals?.balance || 0).toLocaleString('fr-FR', { maximumFractionDigits: 0 })} €</p></div>
              <div className="bg-slate-50 rounded-lg p-3"><p className="text-xs text-slate-500">Comptes</p><p className="text-lg font-bold text-slate-700">{balances.accounts?.length || 0}</p></div>
            </div>
            {balances.classes && Object.entries(balances.classes).sort().map(([cls, data]) => (
              <div key={cls} className="flex items-center justify-between py-2 border-t text-sm">
                <span className="font-medium">Classe {cls}</span>
                <span className="text-slate-500">{data.count} comptes</span>
                <span className="text-blue-600">{data.debit.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} €</span>
                <span className="text-red-600">{data.credit.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} €</span>
                <span className={data.balance >= 0 ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}>{data.balance.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} €</span>
              </div>
            ))}
          </div>
        )}

        {/* Historique des syncs */}
        <div className="bg-white rounded-xl shadow-sm border p-6">
          <h2 className="font-bold text-slate-800 mb-4">Historique des synchronisations</h2>
          {history.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-6">Aucune synchronisation effectuee</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-500 uppercase bg-slate-50">
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Type</th>
                    <th className="px-3 py-2">Direction</th>
                    <th className="px-3 py-2">Statut</th>
                    <th className="px-3 py-2">Enregistrements</th>
                    <th className="px-3 py-2">Par</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map(h => (
                    <tr key={h.id} className="border-t">
                      <td className="px-3 py-2.5">{formatDate(h.started_at)}</td>
                      <td className="px-3 py-2.5 capitalize">{h.sync_type}</td>
                      <td className="px-3 py-2.5">
                        <span className={`px-2 py-0.5 rounded text-xs ${h.direction === 'push' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>
                          {h.direction === 'push' ? 'Solidata → PL' : 'PL → Solidata'}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                          h.status === 'completed' ? 'bg-green-100 text-green-700' :
                          h.status === 'in_progress' ? 'bg-yellow-100 text-yellow-700' :
                          h.status === 'partial' ? 'bg-orange-100 text-orange-700' :
                          'bg-red-100 text-red-700'
                        }`}>
                          {h.status === 'completed' ? 'OK' : h.status === 'in_progress' ? 'En cours' : h.status === 'partial' ? 'Partiel' : 'Erreur'}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">{h.records_count}</td>
                      <td className="px-3 py-2.5 text-slate-500">{h.user_name || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Modal configuration */}
      {showConfig && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
          <form onSubmit={saveConfig} className="bg-white rounded-xl p-6 w-full max-w-md shadow-xl">
            <h2 className="text-lg font-bold mb-4">Configuration Pennylane</h2>
            <div className="space-y-4">
              <div>
                <label className="text-xs text-slate-500 font-medium">Cle API Pennylane</label>
                <input
                  type="password"
                  placeholder="pl_api_..."
                  value={configForm.api_key}
                  onChange={e => setConfigForm({ ...configForm, api_key: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-sm mt-1"
                />
                <p className="text-[10px] text-slate-400 mt-1">Laissez vide pour conserver la cle existante</p>
              </div>
              <div>
                <label className="text-xs text-slate-500 font-medium">ID Societe Pennylane *</label>
                <input
                  placeholder="ex: solidarite-textiles"
                  value={configForm.company_id}
                  onChange={e => setConfigForm({ ...configForm, company_id: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-sm mt-1"
                  required
                />
              </div>
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={configForm.is_active} onChange={e => setConfigForm({ ...configForm, is_active: e.target.checked })} className="rounded" />
                  Connexion active
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={configForm.sync_invoices} onChange={e => setConfigForm({ ...configForm, sync_invoices: e.target.checked })} className="rounded" />
                  Synchroniser les factures
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={configForm.sync_suppliers} onChange={e => setConfigForm({ ...configForm, sync_suppliers: e.target.checked })} className="rounded" />
                  Synchroniser les fournisseurs
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={configForm.sync_journal} onChange={e => setConfigForm({ ...configForm, sync_journal: e.target.checked })} className="rounded" />
                  Synchroniser le journal comptable
                </label>
              </div>
            </div>
            <div className="flex gap-2 mt-6">
              <button type="button" onClick={() => setShowConfig(false)} className="flex-1 border rounded-lg py-2 text-sm">Annuler</button>
              <button type="submit" className="flex-1 bg-indigo-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-indigo-700">Enregistrer</button>
            </div>
          </form>
        </div>
      )}
    </Layout>
  );
}

// Icons
function IconPennylane({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>;
}
function IconPlug({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>;
}
function IconSync({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>;
}
function IconExternal({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>;
}
function IconDownload({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>;
}
