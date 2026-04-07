import { useState, useEffect } from 'react';
import { BookOpen } from 'lucide-react';
import Layout from '../components/Layout';
import { LoadingSpinner, DataTable, Modal } from '../components';
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
  const [loadingBalances, setLoadingBalances] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [showConfig, setShowConfig] = useState(false);
  const [balances, setBalances] = useState(null);
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
    setSyncing(true);
    try {
      const res = await api.post('/pennylane/sync/invoices');
      alert(res.data.message);
      loadAll();
    } catch (err) {
      alert(err.response?.data?.error || 'Erreur synchronisation');
    }
    setSyncing(false);
  };

  const [glDiag, setGlDiag] = useState(null);

  const syncGL = async () => {
    setSyncingGL(true);
    setGlDiag(null);
    try {
      const res = await api.post('/pennylane/sync/gl');
      setGlDiag(res.data);
      loadAll();
    } catch (err) {
      alert(err.response?.data?.error || 'Erreur import GL analytique');
    }
    setSyncingGL(false);
  };

  const syncTransactions = async () => {
    setSyncingTx(true);
    try {
      const res = await api.post('/pennylane/sync/transactions');
      alert(res.data.message);
      loadAll();
    } catch (err) {
      alert(err.response?.data?.error || 'Erreur import transactions');
    }
    setSyncingTx(false);
  };

  const fetchBalances = async () => {
    setLoadingBalances(true);
    setBalances(null);
    try {
      const res = await api.get('/pennylane/sync/balances');
      setBalances(res.data);
    } catch (err) {
      alert(err.response?.data?.error || 'Erreur chargement balances');
    }
    setLoadingBalances(false);
  };

  const formatDate = (d) => d ? new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  const formatAmount = (n) => typeof n === 'number' ? n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';

  if (loading) return <Layout><LoadingSpinner size="lg" message="Chargement..." /></Layout>;

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
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Test connexion */}
            <button
              onClick={testConnection}
              disabled={testing || !status?.configured}
              className="flex items-center gap-3 p-4 rounded-lg border-2 border-dashed border-slate-200 hover:border-indigo-300 hover:bg-indigo-50 transition disabled:opacity-50"
            >
              <div className="w-10 h-10 rounded-lg bg-indigo-100 flex items-center justify-center">
                <IconPlug className="w-5 h-5 text-indigo-600" />
              </div>
              <div className="text-left">
                <p className="font-medium text-sm">{testing ? 'Test en cours...' : 'Tester la connexion'}</p>
                <p className="text-xs text-slate-400">Verifier l'API Pennylane</p>
              </div>
            </button>

            {/* Push factures */}
            <button
              onClick={syncInvoices}
              disabled={syncing || !status?.active}
              className="flex items-center gap-3 p-4 rounded-lg border-2 border-dashed border-slate-200 hover:border-green-300 hover:bg-green-50 transition disabled:opacity-50"
            >
              <div className="w-10 h-10 rounded-lg bg-green-100 flex items-center justify-center">
                <IconSync className="w-5 h-5 text-green-600" />
              </div>
              <div className="text-left">
                <p className="font-medium text-sm">{syncing ? 'Synchronisation...' : 'Synchroniser factures'}</p>
                <p className="text-xs text-slate-400">Pousser vers Pennylane</p>
              </div>
            </button>

            {/* Pull GL analytique */}
            <button
              onClick={syncGL}
              disabled={syncingGL || !status?.active}
              className="flex items-center gap-3 p-4 rounded-lg border-2 border-dashed border-slate-200 hover:border-amber-300 hover:bg-amber-50 transition disabled:opacity-50"
            >
              <div className="w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center">
                <IconDownload className="w-5 h-5 text-amber-600" />
              </div>
              <div className="text-left">
                <p className="font-medium text-sm">{syncingGL ? 'Import en cours...' : 'GL Analytique'}</p>
                <p className="text-xs text-slate-400">Importer le grand livre</p>
              </div>
            </button>

            {/* Pull transactions */}
            <button
              onClick={syncTransactions}
              disabled={syncingTx || !status?.active}
              className="flex items-center gap-3 p-4 rounded-lg border-2 border-dashed border-slate-200 hover:border-cyan-300 hover:bg-cyan-50 transition disabled:opacity-50"
            >
              <div className="w-10 h-10 rounded-lg bg-cyan-100 flex items-center justify-center">
                <IconDownload className="w-5 h-5 text-cyan-600" />
              </div>
              <div className="text-left">
                <p className="font-medium text-sm">{syncingTx ? 'Import en cours...' : 'Tresorerie'}</p>
                <p className="text-xs text-slate-400">Importer les transactions</p>
              </div>
            </button>

            {/* Balances comptables */}
            <button
              onClick={fetchBalances}
              disabled={loadingBalances || !status?.active}
              className="flex items-center gap-3 p-4 rounded-lg border-2 border-dashed border-slate-200 hover:border-violet-300 hover:bg-violet-50 transition disabled:opacity-50"
            >
              <div className="w-10 h-10 rounded-lg bg-violet-100 flex items-center justify-center">
                <IconDownload className="w-5 h-5 text-violet-600" />
              </div>
              <div className="text-left">
                <p className="font-medium text-sm">{loadingBalances ? 'Chargement...' : 'Balances comptables'}</p>
                <p className="text-xs text-slate-400">Consulter les soldes</p>
              </div>
            </button>

            {/* Ouvrir Pennylane */}
            <button
              onClick={() => window.open('https://app.pennylane.com', '_blank')}
              className="flex items-center gap-3 p-4 rounded-lg border-2 border-dashed border-slate-200 hover:border-purple-300 hover:bg-purple-50 transition"
            >
              <div className="w-10 h-10 rounded-lg bg-purple-100 flex items-center justify-center">
                <IconExternal className="w-5 h-5 text-purple-600" />
              </div>
              <div className="text-left">
                <p className="font-medium text-sm">Ouvrir Pennylane</p>
                <p className="text-xs text-slate-400">Acceder a l'interface</p>
              </div>
            </button>
          </div>

          {/* Test result */}
          {testResult && (
            <div className={`mt-4 p-4 rounded-lg ${testResult.connected ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
              <p className={`text-sm font-medium ${testResult.connected ? 'text-green-700' : 'text-red-700'}`}>
                {testResult.connected ? `Connexion reussie — ${testResult.company || testResult.message}` : `Echec — ${testResult.error}`}
              </p>
            </div>
          )}

          {/* GL Diagnostic */}
          {glDiag && (
            <div className="mt-4 p-4 rounded-lg bg-slate-50 border border-slate-200 space-y-3">
              <p className="text-sm font-medium text-slate-800">{glDiag.message}</p>
              {glDiag.diagnostic && (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                    <div className="bg-white rounded p-2"><span className="text-slate-500">Lignes en base</span><p className="font-bold">{glDiag.diagnostic.en_base?.total || 0}</p></div>
                    <div className="bg-white rounded p-2"><span className="text-slate-500">Total Debit</span><p className="font-bold">{formatAmount(glDiag.diagnostic.en_base?.sum_debit)}</p></div>
                    <div className="bg-white rounded p-2"><span className="text-slate-500">Total Credit</span><p className="font-bold">{formatAmount(glDiag.diagnostic.en_base?.sum_credit)}</p></div>
                    <div className="bg-white rounded p-2"><span className="text-slate-500">Montants a 0</span><p className="font-bold text-red-600">{glDiag.diagnostic.en_base?.zero_amounts || 0}</p></div>
                    <div className="bg-white rounded p-2"><span className="text-slate-500">Classe 6 (charges)</span><p className="font-bold">{glDiag.diagnostic.en_base?.class6 || 0}</p></div>
                    <div className="bg-white rounded p-2"><span className="text-slate-500">Classe 7 (produits)</span><p className="font-bold">{glDiag.diagnostic.en_base?.class7 || 0}</p></div>
                    <div className="bg-white rounded p-2"><span className="text-slate-500">Sans compte</span><p className="font-bold text-red-600">{glDiag.diagnostic.en_base?.no_account || 0}</p></div>
                  </div>
                  <details className="text-xs">
                    <summary className="cursor-pointer text-slate-500 hover:text-slate-700">Voir structure brute Pennylane</summary>
                    <pre className="mt-2 bg-white p-3 rounded border overflow-x-auto text-[10px] leading-relaxed">
                      {JSON.stringify(glDiag.diagnostic.exemple_brut, null, 2)}
                    </pre>
                    <p className="mt-1 text-slate-400">Cles disponibles : {(glDiag.diagnostic.cles_pennylane || []).join(', ')}</p>
                  </details>
                </>
              )}
              <button onClick={() => setGlDiag(null)} className="text-xs text-slate-400 hover:text-slate-600 underline">Fermer</button>
            </div>
          )}
        </div>

        {/* Balances comptables */}
        {balances && (
          <div className="bg-white rounded-xl shadow-sm border p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold text-slate-800">Balances comptables Pennylane</h2>
              <div className="flex items-center gap-4 text-xs text-slate-500">
                <span>{balances.total_accounts} compte(s)</span>
                <span>Mis a jour : {formatDate(balances.fetched_at)}</span>
                <button onClick={() => setBalances(null)} className="text-slate-400 hover:text-slate-600 text-xs underline">Fermer</button>
              </div>
            </div>

            {/* Totaux */}
            <div className="grid grid-cols-3 gap-4 mb-4">
              <div className="bg-green-50 rounded-lg p-3 text-center">
                <p className="text-xs text-green-600 mb-1">Total Debit</p>
                <p className="text-lg font-bold text-green-700">{formatAmount(balances.totals?.debit)}</p>
              </div>
              <div className="bg-red-50 rounded-lg p-3 text-center">
                <p className="text-xs text-red-600 mb-1">Total Credit</p>
                <p className="text-lg font-bold text-red-700">{formatAmount(balances.totals?.credit)}</p>
              </div>
              <div className="bg-indigo-50 rounded-lg p-3 text-center">
                <p className="text-xs text-indigo-600 mb-1">Solde</p>
                <p className="text-lg font-bold text-indigo-700">{formatAmount(balances.totals?.balance)}</p>
              </div>
            </div>

            {/* Table des comptes */}
            {balances.accounts?.length > 0 && (
              <div className="overflow-x-auto max-h-96 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0">
                    <tr className="text-left text-xs text-slate-500 uppercase bg-slate-50">
                      <th className="px-3 py-2">Compte</th>
                      <th className="px-3 py-2">Libelle</th>
                      <th className="px-3 py-2 text-right">Debit</th>
                      <th className="px-3 py-2 text-right">Credit</th>
                      <th className="px-3 py-2 text-right">Solde</th>
                    </tr>
                  </thead>
                  <tbody>
                    {balances.accounts.map((acc, i) => (
                      <tr key={i} className="border-t hover:bg-slate-50">
                        <td className="px-3 py-2 font-mono text-xs">{acc.account_number}</td>
                        <td className="px-3 py-2 text-slate-700 truncate max-w-[200px]">{acc.account_label}</td>
                        <td className="px-3 py-2 text-right text-green-700">{acc.debit ? formatAmount(acc.debit) : ''}</td>
                        <td className="px-3 py-2 text-right text-red-700">{acc.credit ? formatAmount(acc.credit) : ''}</td>
                        <td className={`px-3 py-2 text-right font-medium ${acc.balance >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                          {formatAmount(acc.balance)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Historique des syncs */}
        <div className="bg-white rounded-xl shadow-sm border p-6">
          <h2 className="font-bold text-slate-800 mb-4">Historique des synchronisations</h2>
          {(() => {
            const historyColumns = [
              { key: 'started_at', label: 'Date', sortable: true, render: (h) => formatDate(h.started_at) },
              { key: 'sync_type', label: 'Type', render: (h) => <span className="capitalize">{h.sync_type}</span> },
              { key: 'direction', label: 'Direction', render: (h) => (
                <span className={`px-2 py-0.5 rounded text-xs ${h.direction === 'push' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>
                  {h.direction === 'push' ? 'Solidata → PL' : 'PL → Solidata'}
                </span>
              )},
              { key: 'status', label: 'Statut', render: (h) => (
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                  h.status === 'completed' ? 'bg-green-100 text-green-700' :
                  h.status === 'in_progress' ? 'bg-yellow-100 text-yellow-700' :
                  h.status === 'partial' ? 'bg-orange-100 text-orange-700' :
                  'bg-red-100 text-red-700'
                }`}>
                  {h.status === 'completed' ? 'OK' : h.status === 'in_progress' ? 'En cours' : h.status === 'partial' ? 'Partiel' : 'Erreur'}
                </span>
              )},
              { key: 'records_count', label: 'Enregistrements', sortable: true },
              { key: 'user_name', label: 'Par', render: (h) => <span className="text-slate-500">{h.user_name || '—'}</span> },
            ];
            return (
              <DataTable
                columns={historyColumns}
                data={history}
                loading={false}
                emptyIcon={BookOpen}
                emptyMessage="Aucune synchronisation effectuee"
                dense
              />
            );
          })()}
        </div>
      </div>

      {/* Modal configuration */}
      <Modal isOpen={showConfig} onClose={() => setShowConfig(false)} title="Configuration Pennylane" size="sm">
        <form onSubmit={saveConfig}>
          <div className="space-y-4">
            <div>
              <label className="text-xs text-slate-500 font-medium">Cle API Pennylane</label>
              <input
                type="password"
                placeholder="pl_api_..."
                value={configForm.api_key}
                onChange={e => setConfigForm({ ...configForm, api_key: e.target.value })}
                className="input-modern mt-1"
              />
              <p className="text-[10px] text-slate-400 mt-1">Laissez vide pour conserver la cle existante</p>
            </div>
            <div>
              <label className="text-xs text-slate-500 font-medium">ID Societe Pennylane *</label>
              <input
                placeholder="ex: solidarite-textiles"
                value={configForm.company_id}
                onChange={e => setConfigForm({ ...configForm, company_id: e.target.value })}
                className="input-modern mt-1"
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
      </Modal>
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
function IconDownload({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>;
}
function IconExternal({ className }) {
  return <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>;
}
