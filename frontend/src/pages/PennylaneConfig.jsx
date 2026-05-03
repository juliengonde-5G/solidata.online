import { useEffect, useState } from 'react';
import { Settings, KeyRound, CheckCircle2, XCircle, RefreshCw, Activity } from 'lucide-react';
import Layout from '../components/Layout';
import { LoadingSpinner, PageHeader, Section, useToast } from '../components';
import api from '../services/api';

export default function PennylaneConfig() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [status, setStatus] = useState(null);
  const [history, setHistory] = useState([]);
  const [form, setForm] = useState({
    api_key: '',
    company_id: '',
    is_active: false,
    sync_invoices: true,
    sync_suppliers: true,
    sync_journal: true,
  });

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const [statusRes, configRes, histRes] = await Promise.all([
        api.get('/pennylane/status').catch(() => ({ data: { configured: false, active: false } })),
        api.get('/pennylane/config').catch(() => ({ data: null })),
        api.get('/pennylane/sync/history').catch(() => ({ data: [] })),
      ]);
      setStatus(statusRes.data);
      if (configRes.data) {
        setForm({
          api_key: '',
          company_id: configRes.data.company_id || '',
          is_active: configRes.data.is_active || false,
          sync_invoices: configRes.data.sync_invoices ?? true,
          sync_suppliers: configRes.data.sync_suppliers ?? true,
          sync_journal: configRes.data.sync_journal ?? true,
        });
      }
      setHistory(histRes.data || []);
    } catch (err) {
      console.error(err);
      toast.error('Erreur de chargement');
    }
    setLoading(false);
  }

  async function save(e) {
    e.preventDefault();
    if (!form.company_id) { toast.error('ID société requis'); return; }
    setSaving(true);
    try {
      const payload = { ...form };
      if (!payload.api_key) delete payload.api_key;
      await api.put('/pennylane/config', payload);
      toast.success('Configuration enregistrée');
      setForm((f) => ({ ...f, api_key: '' }));
      await load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur enregistrement');
    }
    setSaving(false);
  }

  async function test() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await api.post('/pennylane/test');
      setTestResult(res.data);
      if (res.data?.connected) toast.success('Connexion OK');
      else toast.error(res.data?.error || 'Connexion échouée');
    } catch (err) {
      setTestResult({ connected: false, error: err.response?.data?.error || 'Erreur réseau' });
      toast.error('Erreur lors du test');
    }
    setTesting(false);
  }

  if (loading) return <Layout><LoadingSpinner size="lg" /></Layout>;

  const configured = !!status?.configured;
  const active = !!status?.active;

  return (
    <Layout>
      <div className="space-y-6">
        <PageHeader
          title="Configuration Pennylane"
          subtitle="Paramètres techniques de la connexion comptable"
          icon={Settings}
        />

        {/* Statut connexion */}
        <Section title="État de la connexion" icon={Activity}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <StatusTile
              label="Configuration"
              ok={configured}
              okLabel="Renseignée"
              koLabel="Manquante"
            />
            <StatusTile
              label="Connexion active"
              ok={active}
              okLabel="Activée"
              koLabel="Désactivée"
            />
            <div className="card-modern p-4 flex items-center justify-between">
              <span className="text-xs text-slate-500">Dernière synchro</span>
              <span className="text-sm font-medium text-slate-700">
                {status?.last_sync_at ? new Date(status.last_sync_at).toLocaleString('fr-FR') : '—'}
              </span>
            </div>
          </div>

          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={test}
              disabled={testing || !configured}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${testing ? 'animate-spin' : ''}`} />
              {testing ? 'Test en cours…' : 'Tester la connexion'}
            </button>
            {testResult && (
              <span className={`text-xs px-2 py-1 rounded ${testResult.connected ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                {testResult.connected ? `OK — ${testResult.company || 'Pennylane'}` : (testResult.error || 'Erreur')}
              </span>
            )}
          </div>
        </Section>

        {/* Formulaire config */}
        <Section title="Identifiants API" icon={KeyRound}>
          <form onSubmit={save} className="space-y-4 max-w-2xl">
            <div>
              <label className="text-xs text-slate-500 font-medium">Clé API Pennylane</label>
              <input
                type="password"
                placeholder="pl_api_..."
                value={form.api_key}
                onChange={(e) => setForm({ ...form, api_key: e.target.value })}
                className="input-modern mt-1"
                autoComplete="off"
              />
              <p className="text-[11px] text-slate-400 mt-1">Laissez vide pour conserver la clé existante. La clé est chiffrée AES-256 en base.</p>
            </div>
            <div>
              <label className="text-xs text-slate-500 font-medium">ID société Pennylane *</label>
              <input
                placeholder="ex: solidarite-textiles"
                value={form.company_id}
                onChange={(e) => setForm({ ...form, company_id: e.target.value })}
                className="input-modern mt-1"
                required
              />
            </div>
            <div className="space-y-2 pt-2 border-t border-slate-100">
              <h3 className="text-xs uppercase font-bold text-slate-400 tracking-wider">Options de synchronisation</h3>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} className="rounded" />
                Connexion active
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.sync_invoices} onChange={(e) => setForm({ ...form, sync_invoices: e.target.checked })} className="rounded" />
                Synchroniser les factures
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.sync_suppliers} onChange={(e) => setForm({ ...form, sync_suppliers: e.target.checked })} className="rounded" />
                Synchroniser les fournisseurs
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.sync_journal} onChange={(e) => setForm({ ...form, sync_journal: e.target.checked })} className="rounded" />
                Synchroniser le journal comptable
              </label>
            </div>
            <div className="flex gap-2 pt-2">
              <button type="submit" disabled={saving} className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-50">
                {saving ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </div>
          </form>
        </Section>

        {/* Historique sync */}
        <Section title="Historique des synchronisations" icon={Activity}>
          {history.length === 0 ? (
            <p className="text-sm text-slate-400 py-4 text-center">Aucune synchronisation enregistrée</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="text-left py-2 px-3">Date</th>
                  <th className="text-left py-2 px-3">Type</th>
                  <th className="text-left py-2 px-3">Direction</th>
                  <th className="text-right py-2 px-3">Enregistrements</th>
                  <th className="text-left py-2 px-3">Statut</th>
                </tr>
              </thead>
              <tbody>
                {history.slice(0, 30).map((h) => (
                  <tr key={h.id} className="border-b border-slate-100">
                    <td className="py-2 px-3 text-slate-600">
                      {h.started_at ? new Date(h.started_at).toLocaleString('fr-FR') : '—'}
                    </td>
                    <td className="py-2 px-3">{h.sync_type}</td>
                    <td className="py-2 px-3 text-slate-600">{h.direction || '—'}</td>
                    <td className="py-2 px-3 text-right">{h.records_count ?? '—'}</td>
                    <td className="py-2 px-3">
                      <span className={`text-xs px-2 py-0.5 rounded ${
                        h.status === 'success' ? 'bg-green-50 text-green-700'
                        : h.status === 'error' ? 'bg-red-50 text-red-700'
                        : 'bg-amber-50 text-amber-700'
                      }`}>
                        {h.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>
      </div>
    </Layout>
  );
}

function StatusTile({ label, ok, okLabel, koLabel }) {
  const Icon = ok ? CheckCircle2 : XCircle;
  return (
    <div className="card-modern p-4 flex items-center justify-between">
      <span className="text-xs text-slate-500">{label}</span>
      <span className={`flex items-center gap-1.5 text-sm font-medium ${ok ? 'text-green-600' : 'text-red-500'}`}>
        <Icon className="w-4 h-4" />
        {ok ? okLabel : koLabel}
      </span>
    </div>
  );
}
