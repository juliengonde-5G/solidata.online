import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plug, CheckCircle, XCircle, RefreshCw, Link as LinkIcon, Trash2, AlertTriangle, Zap, Info, Copy } from 'lucide-react';
import Layout from '../components/Layout';
import { LoadingSpinner, PageHeader, FormField, useToast } from '../components';
import api from '../services/api';

function formatDateTime(d) {
  return d ? new Date(d).toLocaleString('fr-FR') : '—';
}

export default function VakSumupConfig() {
  const toast = useToast();
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncLog, setSyncLog] = useState([]);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [resyncSince, setResyncSince] = useState('');
  const [resyncing, setResyncing] = useState(false);

  useEffect(() => {
    if (searchParams.get('connected')) toast.success('Connexion SumUp établie');
    if (searchParams.get('error')) toast.error(`Erreur OAuth : ${searchParams.get('error')}`);
    load();
  }, []);

  async function load() {
    setLoading(true);
    try {
      const [s, log] = await Promise.all([
        api.get('/vak/sumup/status'),
        api.get('/vak/sumup/sync-log?limit=20'),
      ]);
      setStatus(s.data);
      setSyncLog(log.data || []);
    } catch (err) {
      toast.error('Erreur chargement statut SumUp');
    }
    setLoading(false);
  }

  async function saveCredentials() {
    if (!clientId.trim() || !clientSecret.trim()) {
      toast.error('client_id et client_secret requis');
      return;
    }
    try {
      await api.put('/vak/sumup/credentials', { client_id: clientId, client_secret: clientSecret });
      toast.success('Credentials enregistrés (chiffrement automatique)');
      setClientId('');
      setClientSecret('');
      await load();
    } catch (err) {
      toast.error('Erreur enregistrement credentials');
    }
  }

  async function startOAuth() {
    try {
      const r = await api.get('/vak/sumup/auth-url');
      window.location.href = r.data.url;
    } catch (err) {
      toast.error(err.response?.data?.error || 'Impossible de générer l\'URL OAuth — vérifier les credentials');
    }
  }

  async function syncNow() {
    setSyncing(true);
    try {
      const r = await api.post('/vak/sumup/sync');
      toast.success(`Sync OK : ${r.data.inserted}/${r.data.received} transactions importées`);
      await load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur sync');
    }
    setSyncing(false);
  }

  async function resyncFrom() {
    if (!resyncSince) { toast.error('Choisis une date de début'); return; }
    setResyncing(true);
    try {
      const r = await api.post('/vak/sumup/sync', { since: resyncSince });
      toast.success(`Resync OK depuis ${resyncSince} : ${r.data.inserted}/${r.data.received} transactions importées`);
      await load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur resync');
    }
    setResyncing(false);
  }

  async function disconnect() {
    if (!window.confirm('Déconnecter SumUp ? Les tokens et webhook seront révoqués.')) return;
    try {
      await api.delete('/vak/sumup/disconnect');
      toast.success('Déconnecté');
      await load();
    } catch (err) {
      toast.error('Erreur déconnexion');
    }
  }

  async function registerWebhook() {
    try {
      const r = await api.post('/vak/sumup/register-webhook');
      toast.success(r.data.success ? 'Webhook enregistré côté SumUp' : 'Webhook : voir logs');
      await load();
    } catch (err) {
      toast.error('Erreur enregistrement webhook');
    }
  }

  function copyRedirectUri() {
    if (!status?.redirect_uri) return;
    navigator.clipboard.writeText(status.redirect_uri);
    toast.success('Redirect URI copié');
  }

  const statusBadge = (logStatus) => {
    const map = {
      success: 'bg-green-100 text-green-700',
      error: 'bg-red-100 text-red-700',
      running: 'bg-blue-100 text-blue-700',
    };
    return <span className={`text-xs px-2 py-0.5 rounded ${map[logStatus] || 'bg-slate-100 text-slate-600'}`}>{logStatus}</span>;
  };

  const logTypeLabel = {
    api_pull: 'Sync API',
    webhook: 'Webhook',
    oauth: 'OAuth',
    token_refresh: 'Refresh token',
  };

  if (loading) return <Layout><LoadingSpinner size="lg" message="Chargement..." /></Layout>;

  return (
    <Layout>
      <div className="p-4 sm:p-6 max-w-5xl">
        <PageHeader
          title="Configuration SumUp (VAK)"
          subtitle="Intégration de la caisse SumUp pour le suivi des Ventes au Kilo"
          icon={Plug}
        />

        {/* Bloc statut */}
        <div className={`rounded-card shadow-card p-5 mb-6 border-l-4 ${
          status?.connected && !status?.expired ? 'border-green-500 bg-green-50' :
          status?.connected ? 'border-amber-500 bg-amber-50' :
          'border-slate-400 bg-white'
        }`}>
          <div className="flex items-start justify-between flex-wrap gap-3">
            <div>
              <div className="flex items-center gap-2 mb-2">
                {status?.connected && !status?.expired
                  ? <><CheckCircle className="w-5 h-5 text-green-600" /><span className="font-semibold text-green-800">SumUp connecté</span></>
                  : status?.connected
                  ? <><AlertTriangle className="w-5 h-5 text-amber-600" /><span className="font-semibold text-amber-800">Connecté — token expiré</span></>
                  : <><XCircle className="w-5 h-5 text-slate-500" /><span className="font-semibold text-slate-700">Non connecté</span></>
                }
              </div>
              <div className="text-sm text-slate-600 space-y-1">
                <div>Credentials saisis : <strong>{status?.has_credentials ? 'oui' : 'non'}</strong></div>
                {status?.merchant_code && <div>Merchant code : <code className="bg-white px-1.5 py-0.5 rounded text-xs">{status.merchant_code}</code></div>}
                {status?.connected_at && <div>Connecté depuis : {formatDateTime(status.connected_at)}</div>}
                {status?.token_expires_at && <div>Token expire : {formatDateTime(status.token_expires_at)}</div>}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {status?.connected && (
                <>
                  <button onClick={syncNow} disabled={syncing}
                    className="inline-flex items-center gap-1.5 px-3 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 text-sm disabled:opacity-50">
                    {syncing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                    Sync maintenant
                  </button>
                  <button onClick={registerWebhook}
                    className="inline-flex items-center gap-1.5 px-3 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-800 text-sm">
                    <LinkIcon className="w-4 h-4" />Réenregistrer webhook
                  </button>
                  <button onClick={disconnect}
                    className="inline-flex items-center gap-1.5 px-3 py-2 bg-red-500 text-white rounded-lg hover:bg-red-600 text-sm">
                    <Trash2 className="w-4 h-4" />Déconnecter
                  </button>
                </>
              )}
              {status?.has_credentials && !status?.connected && (
                <button onClick={startOAuth}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 text-sm font-medium">
                  <Plug className="w-4 h-4" />Connecter SumUp
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Rattrapage historique (resync depuis une date) */}
        {status?.connected && (
          <div className="bg-white rounded-card shadow-card p-5 mb-6 border-l-4 border-amber-500">
            <div className="flex items-start gap-3 mb-3">
              <Info className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="font-semibold text-slate-800">Rattrapage de l'historique</h3>
                <p className="text-sm text-slate-600 mt-1">
                  Par défaut la sync ne remonte que 90 jours en arrière et ne redescend plus une fois passée.
                  Pour importer les ventes des <strong>VAK passées</strong> (depuis novembre 2026, première VAK SumUp),
                  saisis une date de début ci-dessous. Les transactions trouvées seront automatiquement rattachées
                  aux VAK qui couvrent leur date (créées sur la page <a href="/vak/sessions" className="underline text-orange-600">Sessions & Import</a>).
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-3 items-end">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Resynchroniser depuis</label>
                <input type="date" value={resyncSince} onChange={(e) => setResyncSince(e.target.value)}
                  className="border border-slate-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <button onClick={resyncFrom} disabled={resyncing || !resyncSince}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 text-sm font-medium disabled:opacity-50">
                {resyncing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                Lancer le rattrapage
              </button>
              <div className="flex gap-2 text-xs">
                <button type="button"
                  onClick={() => setResyncSince('2026-11-01')}
                  className="px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded text-slate-700">
                  1er nov. 2026
                </button>
                <button type="button"
                  onClick={() => setResyncSince(new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10))}
                  className="px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded text-slate-700">
                  -1 an
                </button>
                <button type="button"
                  onClick={() => setResyncSince(new Date(Date.now() - 180 * 86400000).toISOString().slice(0, 10))}
                  className="px-2 py-1 bg-slate-100 hover:bg-slate-200 rounded text-slate-700">
                  -6 mois
                </button>
              </div>
            </div>
            <p className="text-xs text-slate-500 mt-3">
              Astuce : si le rattrapage tire beaucoup de transactions, la requête peut prendre plusieurs dizaines de
              secondes. Surveille l'historique des synchronisations plus bas pour confirmer le bon déroulement.
            </p>
          </div>
        )}

        {/* Runbook OAuth */}
        {!status?.has_credentials && (
          <div className="bg-blue-50 border-l-4 border-blue-500 rounded-r-lg p-4 mb-6">
            <div className="flex gap-3">
              <Info className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-blue-900 space-y-2">
                <p className="font-semibold">Étapes pour activer la connexion SumUp :</p>
                <ol className="list-decimal pl-5 space-y-1">
                  <li>Crée un compte développeur sur <a href="https://developer.sumup.com" target="_blank" rel="noreferrer" className="underline">developer.sumup.com</a></li>
                  <li>Crée une nouvelle application <strong>Server-side OAuth</strong></li>
                  <li>
                    Renseigne le Redirect URI :
                    <code className="ml-1 px-1.5 py-0.5 bg-white rounded text-xs">{status?.redirect_uri || 'https://solidata.online/api/vak/sumup/callback'}</code>
                    <button onClick={copyRedirectUri} className="ml-1 text-blue-600 hover:text-blue-800" title="Copier">
                      <Copy className="w-3.5 h-3.5 inline-block" />
                    </button>
                  </li>
                  <li>Demande les scopes : <code>transactions.history</code>, <code>user.profile</code>, <code>user.app-settings</code></li>
                  <li>Copie le <strong>client_id</strong> et le <strong>client_secret</strong> ci-dessous, puis enregistre</li>
                  <li>Clique sur <strong>Connecter SumUp</strong> pour démarrer le flow OAuth</li>
                </ol>
              </div>
            </div>
          </div>
        )}

        {/* Formulaire credentials */}
        <div className="bg-white rounded-card shadow-card p-6 mb-6">
          <h2 className="text-lg font-semibold text-slate-800 mb-1">Credentials de l'application SumUp</h2>
          <p className="text-xs text-slate-500 mb-4">Stockés chiffrés (AES-256-GCM) dans la table settings. Le client_secret n'est jamais réaffiché après enregistrement.</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <FormField label="client_id" value={clientId} onChange={(e) => setClientId(e.target.value)}
              placeholder="sup_xxx…" hint="Visible dans developer.sumup.com" />
            <FormField type="password" label="client_secret" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)}
              placeholder="••••••••" hint="Re-générable côté SumUp si perdu" />
          </div>
          <div className="mt-4">
            <button onClick={saveCredentials}
              className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 text-sm font-medium">
              Enregistrer les credentials
            </button>
          </div>
        </div>

        {/* Historique syncs */}
        <div className="bg-white rounded-card shadow-card p-6">
          <h2 className="text-lg font-semibold text-slate-800 mb-4">Historique des synchronisations (20 dernières)</h2>
          {syncLog.length === 0 ? (
            <p className="text-slate-500 text-sm text-center py-4">Aucune synchronisation pour l'instant</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="text-left py-2 px-3">Démarrage</th>
                    <th className="text-left py-2 px-3">Type</th>
                    <th className="text-left py-2 px-3">Statut</th>
                    <th className="text-right py-2 px-3">Reçues</th>
                    <th className="text-right py-2 px-3">Insérées</th>
                    <th className="text-right py-2 px-3">Ignorées</th>
                    <th className="text-left py-2 px-3">Erreur</th>
                  </tr>
                </thead>
                <tbody>
                  {syncLog.map((l) => (
                    <tr key={l.id} className="border-b border-slate-100">
                      <td className="py-2 px-3 text-slate-600">{formatDateTime(l.started_at)}</td>
                      <td className="py-2 px-3">{logTypeLabel[l.sync_type] || l.sync_type}</td>
                      <td className="py-2 px-3">{statusBadge(l.status)}</td>
                      <td className="py-2 px-3 text-right">{l.nb_transactions_received || 0}</td>
                      <td className="py-2 px-3 text-right font-medium">{l.nb_transactions_inserted || 0}</td>
                      <td className="py-2 px-3 text-right text-slate-500">{l.nb_transactions_skipped || 0}</td>
                      <td className="py-2 px-3 text-xs text-red-600 truncate max-w-[300px]" title={l.error_message}>
                        {l.error_message || ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
