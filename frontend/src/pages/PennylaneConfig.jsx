import { useEffect, useState } from 'react';
import { Settings, KeyRound, CheckCircle2, XCircle, RefreshCw, Activity, Stethoscope } from 'lucide-react';
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
  // Diagnostic de la remontée des factures (lot L7).
  const [diag, setDiag] = useState(null);
  const [diagErr, setDiagErr] = useState('');
  const [diagBusy, setDiagBusy] = useState(false);
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

  /**
   * Interroge Pennylane SANS filtre de date, sur une page courte.
   * C'est le seul moyen de trancher, EN PRODUCTION, entre « le dossier
   * comptable ne contient pas de facture client », « elles sont à l'état
   * brouillon » et « la clé API n'a pas l'habilitation ». Hors production,
   * aucune clé réelle n'existe : le diagnostic ne peut donc pas être joué.
   */
  async function diagnostiquerFactures() {
    setDiagBusy(true);
    setDiag(null);
    setDiagErr('');
    try {
      const res = await api.get('/pennylane/sync/diagnostic-invoices');
      setDiag(res.data);
    } catch (err) {
      console.error(err);
      setDiagErr(err.response?.data?.error || 'Le diagnostic des factures a échoué.');
    }
    setDiagBusy(false);
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
            {/* `/pennylane/status` renvoie `last_sync` — la tuile lisait
                `last_sync_at`, une clé qui n'existe pas dans la réponse, et
                affichait donc « — » en permanence. */}
            <div className="card-modern p-4 flex items-center justify-between">
              <span className="text-xs text-slate-500">Dernière synchro</span>
              <span className="text-sm font-medium text-slate-700">
                {status?.last_sync ? new Date(status.last_sync).toLocaleString('fr-FR') : '—'}
              </span>
            </div>
          </div>

          {/* Les factures ont leur PROPRE curseur : le confondre avec la synchro
              générale est exactement ce qui bloquait leur import. */}
          <div className="mt-3 card-modern p-4 flex items-center justify-between">
            <span className="text-xs text-slate-500">Dernier import des factures clients</span>
            <span className="text-sm font-medium text-slate-700">
              {status?.last_invoice_sync
                ? new Date(status.last_invoice_sync).toLocaleDateString('fr-FR')
                : <span className="text-slate-400 italic">jamais — le prochain import remontera de 90 jours</span>}
            </span>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={test}
              disabled={testing || !configured}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${testing ? 'animate-spin' : ''}`} />
              {testing ? 'Test en cours…' : 'Tester la connexion'}
            </button>
            <button
              type="button"
              onClick={diagnostiquerFactures}
              disabled={diagBusy || !configured}
              title="Interroge Pennylane SANS filtre de date et affiche ce qui revient vraiment"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 disabled:opacity-50"
            >
              <Stethoscope className={`w-4 h-4 ${diagBusy ? 'animate-pulse' : ''}`} />
              {diagBusy ? 'Diagnostic…' : 'Diagnostic factures'}
            </button>
            {testResult && (
              <span className={`text-xs px-2 py-1 rounded ${testResult.connected ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                {testResult.connected ? `OK — ${testResult.company || 'Pennylane'}` : (testResult.error || 'Erreur')}
              </span>
            )}
          </div>

          {/* Résultat du diagnostic : ce que Pennylane renvoie RÉELLEMENT. */}
          {diagErr && (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              <p className="font-semibold">Diagnostic impossible</p>
              <p className="mt-1">{diagErr}</p>
            </div>
          )}
          {diag && (
            <div className={`mt-3 rounded-lg border p-3 text-sm ${
              diag.recuperees_sur_cette_page === 0
                ? 'border-amber-200 bg-amber-50 text-amber-900'
                : 'border-emerald-200 bg-emerald-50 text-emerald-900'
            }`}>
              <p className="font-semibold">
                Diagnostic — {diag.recuperees_sur_cette_page} facture(s) sur la première page,
                sans aucun filtre de date
              </p>
              {diag.raison && <p className="mt-2 text-xs leading-relaxed">{diag.raison}</p>}
              {diag.total_estime != null && (
                <p className="mt-1 text-xs opacity-80">Total estimé côté Pennylane : {diag.total_estime}.</p>
              )}
              {diag.total_estime_note && <p className="mt-1 text-xs opacity-80">{diag.total_estime_note}</p>}
              {diag.exemples?.length > 0 && (
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left opacity-70">
                        <th className="py-1 pr-3 font-medium">N° facture</th>
                        <th className="py-1 pr-3 font-medium">Date</th>
                        <th className="py-1 pr-3 font-medium">Statut</th>
                        <th className="py-1 pr-3 font-medium">Montant</th>
                        <th className="py-1 font-medium">Client</th>
                      </tr>
                    </thead>
                    <tbody>
                      {diag.exemples.map((e) => (
                        <tr key={e.id} className="border-t border-black/5">
                          <td className="py-1 pr-3 font-mono">{e.invoice_number || '—'}</td>
                          <td className="py-1 pr-3">{e.date ? new Date(e.date).toLocaleDateString('fr-FR') : '—'}</td>
                          <td className="py-1 pr-3">{e.draft ? 'Brouillon' : (e.status || '—')}</td>
                          <td className="py-1 pr-3">{e.amount != null ? `${e.amount} €` : '—'}</td>
                          <td className="py-1">{e.customer || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {diag.curseur_factures && (
                <p className="mt-2 text-xs opacity-80">
                  Curseur des factures : {diag.curseur_factures.date
                    ? new Date(diag.curseur_factures.date).toLocaleDateString('fr-FR')
                    : 'aucun'} ({diag.curseur_factures.source}).
                </p>
              )}
            </div>
          )}
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
