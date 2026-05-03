import { useState, useEffect, useCallback } from 'react';
import { FileCheck, RefreshCw, AlertTriangle, CheckCircle2, Link2, Unlink2, Search, ExternalLink } from 'lucide-react';
import Layout from '../components/Layout';
import { LoadingSpinner, PageHeader, Section, Modal, useToast } from '../components';
import api from '../services/api';

const STATUT_LABELS = {
  recue: 'Reçue',
  conforme: 'Conforme',
  ecart: 'Écart détecté',
  validee: 'Validée',
  rapprochement_manuel: 'Rapprochée manuellement',
  ecart_valide: 'Écart validé',
};

const STATUT_COLORS = {
  recue: 'bg-slate-100 text-slate-700',
  conforme: 'bg-emerald-100 text-emerald-700',
  ecart: 'bg-amber-100 text-amber-700',
  validee: 'bg-emerald-100 text-emerald-700',
  rapprochement_manuel: 'bg-blue-100 text-blue-700',
  ecart_valide: 'bg-emerald-100 text-emerald-700',
};

function formatEuro(v) {
  if (v == null || isNaN(v)) return '—';
  return `${Number(v).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}
function formatT(v) {
  if (v == null || isNaN(v)) return '—';
  return `${Number(v).toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} t`;
}
function formatDate(v) {
  if (!v) return '—';
  return new Date(v).toLocaleDateString('fr-FR');
}

export default function ExutoiresControleFacturation() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [stats, setStats] = useState(null);
  const [factures, setFactures] = useState([]);
  const [orphans, setOrphans] = useState([]);
  const [filter, setFilter] = useState('all'); // all / unmatched / ecart / validated
  const [search, setSearch] = useState('');
  const [linkModal, setLinkModal] = useState(null); // facture object
  const [candidates, setCandidates] = useState([]);
  const [candidatesLoading, setCandidatesLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [statsRes, facturesRes, orphansRes] = await Promise.all([
        api.get('/factures-exutoires/stats'),
        api.get('/factures-exutoires?' + (filter === 'unmatched' ? 'matched=false' : filter === 'validated' ? 'statut=ecart_valide' : '')),
        api.get('/factures-exutoires/orphan-commandes'),
      ]);
      setStats(statsRes.data);
      setFactures(facturesRes.data || []);
      setOrphans(orphansRes.data || []);
    } catch (err) {
      console.error(err);
      toast.error('Erreur chargement');
    }
    setLoading(false);
  }, [filter, toast]);

  useEffect(() => { load(); }, [load]);

  const sync = async () => {
    setSyncing(true);
    try {
      const r = await api.post('/pennylane/sync/customer-invoices', {});
      toast.success(r.data?.message || 'Synchronisation terminée');
      await load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur de synchronisation Pennylane');
    }
    setSyncing(false);
  };

  const openLinkModal = async (facture) => {
    setLinkModal(facture);
    setCandidates([]);
    setCandidatesLoading(true);
    try {
      const r = await api.get(`/factures-exutoires/candidates-for/${facture.id}`);
      setCandidates(r.data || []);
    } catch (err) { console.error(err); }
    setCandidatesLoading(false);
  };

  const linkCommande = async (factureId, commandeId) => {
    try {
      await api.post(`/factures-exutoires/${factureId}/link-commande`, { commande_id: commandeId });
      toast.success('Facture rapprochée et commande clôturée');
      setLinkModal(null);
      await load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur de rapprochement');
    }
  };

  const unlinkFacture = async (factureId) => {
    if (!window.confirm('Délier cette facture de sa commande ? La commande retournera au statut « expediee ».')) return;
    try {
      await api.post(`/factures-exutoires/${factureId}/unlink`, {});
      toast.success('Facture déliée');
      await load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur');
    }
  };

  const validateEcart = async (factureId) => {
    try {
      await api.post(`/factures-exutoires/${factureId}/validate-ecart`, {});
      toast.success('Écart validé');
      await load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur');
    }
  };

  const filtered = factures.filter((f) => {
    if (filter === 'ecart' && (Math.abs(Number(f.ecart_quantite_pct) || 0) <= (stats?.tolerance_pct || 5))) return false;
    if (search) {
      const s = search.toLowerCase();
      return (f.pennylane_invoice_number || '').toLowerCase().includes(s)
        || (f.pennylane_customer_name || '').toLowerCase().includes(s)
        || (f.commande_reference || '').toLowerCase().includes(s);
    }
    return true;
  });

  const tolerance = stats?.tolerance_pct ?? 5;

  return (
    <Layout>
      <div className="space-y-6">
        <PageHeader
          title="Contrôle facturation"
          subtitle="Rapprochement des factures Pennylane avec les commandes — alerte non-bloquante en cas d'écart de pesée"
          icon={FileCheck}
          actions={
            <button
              onClick={sync}
              disabled={syncing}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
              {syncing ? 'Synchro…' : 'Synchroniser Pennylane'}
            </button>
          }
        />

        {/* KPIs */}
        {stats && (
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <KpiTile label="Factures importées" value={stats.total} color="slate" />
            <KpiTile label="À rapprocher" value={stats.unmatched} color={stats.unmatched > 0 ? 'amber' : 'emerald'} />
            <KpiTile label={`Écarts > ${tolerance}%`} value={stats.with_ecart} color={stats.with_ecart > 0 ? 'red' : 'emerald'} />
            <KpiTile label="Écarts validés" value={stats.validated} color="emerald" />
            <KpiTile label="Commandes orphelines" value={stats.orphan_commandes} color={stats.orphan_commandes > 0 ? 'amber' : 'emerald'} />
          </div>
        )}

        {/* Filtres + recherche */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-1.5">
            {[
              { k: 'all', l: 'Toutes' },
              { k: 'unmatched', l: 'À rapprocher' },
              { k: 'ecart', l: `Écart > ${tolerance}%` },
              { k: 'validated', l: 'Validées' },
            ].map((f) => (
              <button
                key={f.k}
                onClick={() => setFilter(f.k)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                  filter === f.k ? 'bg-primary text-white shadow-sm' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                {f.l}
              </button>
            ))}
          </div>
          <div className="relative ml-auto">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="N° facture, client, commande…"
              className="pl-9 pr-3 py-1.5 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-primary"
            />
          </div>
        </div>

        {/* Tableau factures */}
        {loading ? (
          <LoadingSpinner />
        ) : filtered.length === 0 ? (
          <div className="card-modern p-12 text-center">
            <FileCheck className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <p className="text-sm text-slate-500">
              {factures.length === 0 ? 'Aucune facture importée. Lancez la synchronisation Pennylane.' : 'Aucune facture ne correspond aux filtres.'}
            </p>
          </div>
        ) : (
          <div className="card-modern overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-slate-500 bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="text-left py-2 px-3">N° facture</th>
                    <th className="text-left py-2 px-3">Date</th>
                    <th className="text-left py-2 px-3">Client</th>
                    <th className="text-left py-2 px-3">Commande</th>
                    <th className="text-right py-2 px-3">Montant HT</th>
                    <th className="text-right py-2 px-3">Qté facturée</th>
                    <th className="text-right py-2 px-3">Pesée client</th>
                    <th className="text-right py-2 px-3">Écart</th>
                    <th className="text-left py-2 px-3">Statut</th>
                    <th className="text-right py-2 px-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((f) => {
                    const ecartPct = Number(f.ecart_quantite_pct) || 0;
                    const isEcart = f.commande_id && Math.abs(ecartPct) > tolerance;
                    return (
                      <tr key={f.id} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="py-2 px-3 font-mono font-semibold text-slate-700">{f.pennylane_invoice_number}</td>
                        <td className="py-2 px-3 text-slate-500">{formatDate(f.date_facture)}</td>
                        <td className="py-2 px-3">{f.pennylane_customer_name || '—'}</td>
                        <td className="py-2 px-3">
                          {f.commande_reference ? (
                            <span className="font-medium text-slate-700">{f.commande_reference}</span>
                          ) : (
                            <span className="text-xs text-amber-600 italic">non rapprochée</span>
                          )}
                        </td>
                        <td className="py-2 px-3 text-right font-medium tabular-nums">{formatEuro(f.montant_ht)}</td>
                        <td className="py-2 px-3 text-right tabular-nums">{formatT(f.quantite_facturee)}</td>
                        <td className="py-2 px-3 text-right tabular-nums text-slate-500">{formatT(f.pesee_client_kg)}</td>
                        <td className="py-2 px-3 text-right">
                          {f.commande_id ? (
                            <span className={`text-xs font-bold tabular-nums ${
                              isEcart ? 'text-red-600' : 'text-emerald-600'
                            }`}>
                              {ecartPct > 0 ? '+' : ''}{ecartPct.toFixed(1)} %
                              {isEcart && <AlertTriangle className="w-3 h-3 inline ml-1" />}
                            </span>
                          ) : (
                            <span className="text-xs text-slate-400">—</span>
                          )}
                        </td>
                        <td className="py-2 px-3">
                          <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded ${STATUT_COLORS[f.statut_facture] || 'bg-slate-100 text-slate-600'}`}>
                            {STATUT_LABELS[f.statut_facture] || f.statut_facture}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-right">
                          <div className="inline-flex gap-1.5">
                            {!f.commande_id && (
                              <button
                                onClick={() => openLinkModal(f)}
                                className="text-xs px-2 py-1 rounded bg-blue-50 text-blue-700 hover:bg-blue-100 inline-flex items-center gap-1"
                              >
                                <Link2 className="w-3 h-3" /> Rapprocher
                              </button>
                            )}
                            {f.commande_id && isEcart && f.statut_facture !== 'ecart_valide' && (
                              <button
                                onClick={() => validateEcart(f.id)}
                                className="text-xs px-2 py-1 rounded bg-emerald-50 text-emerald-700 hover:bg-emerald-100 inline-flex items-center gap-1"
                              >
                                <CheckCircle2 className="w-3 h-3" /> Valider l'écart
                              </button>
                            )}
                            {f.commande_id && (
                              <button
                                onClick={() => unlinkFacture(f.id)}
                                className="text-xs px-2 py-1 rounded text-red-600 hover:bg-red-50 inline-flex items-center gap-1"
                                title="Délier la facture (ADMIN)"
                              >
                                <Unlink2 className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Section commandes orphelines */}
        {orphans.length > 0 && (
          <Section title="Commandes expédiées sans facture rapprochée" icon={AlertTriangle} subtitle={`${orphans.length} commande${orphans.length > 1 ? 's' : ''} en attente de facturation Pennylane`}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="text-left py-2 px-3">Référence</th>
                    <th className="text-left py-2 px-3">Date</th>
                    <th className="text-left py-2 px-3">Client</th>
                    <th className="text-left py-2 px-3">Type</th>
                    <th className="text-right py-2 px-3">Pesée client</th>
                    <th className="text-right py-2 px-3">Prix/t</th>
                    <th className="text-left py-2 px-3">Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {orphans.map((o) => (
                    <tr key={o.id} className="border-b border-slate-100">
                      <td className="py-2 px-3 font-mono font-semibold">{o.reference}</td>
                      <td className="py-2 px-3 text-slate-500">{formatDate(o.date_commande)}</td>
                      <td className="py-2 px-3">{o.client_nom}</td>
                      <td className="py-2 px-3 text-xs text-slate-500">{o.type_produit}</td>
                      <td className="py-2 px-3 text-right tabular-nums">{formatT(o.pesee_client_t)}</td>
                      <td className="py-2 px-3 text-right tabular-nums">{formatEuro(o.prix_tonne)}</td>
                      <td className="py-2 px-3">
                        <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-amber-100 text-amber-700">
                          {o.statut}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        )}
      </div>

      {/* Modal rapprochement manuel */}
      {linkModal && (
        <Modal
          isOpen={!!linkModal}
          onClose={() => setLinkModal(null)}
          title={`Rapprocher la facture ${linkModal.pennylane_invoice_number}`}
          size="lg"
        >
          <div className="space-y-4">
            <div className="bg-slate-50 rounded-lg p-3 text-sm grid grid-cols-2 gap-2">
              <div><span className="text-slate-500">Client :</span> <strong>{linkModal.pennylane_customer_name}</strong></div>
              <div><span className="text-slate-500">Date :</span> <strong>{formatDate(linkModal.date_facture)}</strong></div>
              <div><span className="text-slate-500">Montant HT :</span> <strong>{formatEuro(linkModal.montant_ht)}</strong></div>
              <div><span className="text-slate-500">Quantité :</span> <strong>{formatT(linkModal.quantite_facturee)}</strong></div>
            </div>

            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Sélectionner la commande à rapprocher ({candidates.length})
            </h3>

            {candidatesLoading ? (
              <LoadingSpinner />
            ) : candidates.length === 0 ? (
              <p className="text-sm text-slate-400 italic text-center py-4">Aucune commande candidate</p>
            ) : (
              <div className="max-h-96 overflow-y-auto rounded-lg border border-slate-200">
                <table className="w-full text-sm">
                  <thead className="text-[10px] uppercase text-slate-500 bg-slate-50 sticky top-0 border-b border-slate-200">
                    <tr>
                      <th className="text-left py-1.5 px-2">Réf</th>
                      <th className="text-left py-1.5 px-2">Date</th>
                      <th className="text-left py-1.5 px-2">Client</th>
                      <th className="text-left py-1.5 px-2">Type</th>
                      <th className="text-right py-1.5 px-2">Pesée</th>
                      <th className="text-right py-1.5 px-2">Prix/t</th>
                      <th className="text-right py-1.5 px-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {candidates.map((c) => (
                      <tr key={c.id} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="py-1.5 px-2 font-mono">{c.reference}</td>
                        <td className="py-1.5 px-2 text-slate-500">{formatDate(c.date_commande)}</td>
                        <td className="py-1.5 px-2">{c.client_nom}</td>
                        <td className="py-1.5 px-2 text-xs">{c.type_produit}</td>
                        <td className="py-1.5 px-2 text-right tabular-nums">{formatT(c.pesee_client_t)}</td>
                        <td className="py-1.5 px-2 text-right tabular-nums">{formatEuro(c.prix_tonne)}</td>
                        <td className="py-1.5 px-2 text-right">
                          <button
                            onClick={() => linkCommande(linkModal.id, c.id)}
                            className="text-xs px-2 py-1 rounded bg-primary text-white hover:bg-primary-dark"
                          >
                            Lier
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </Modal>
      )}
    </Layout>
  );
}

function KpiTile({ label, value, color }) {
  const styles = {
    slate: { bg: 'bg-slate-50', text: 'text-slate-700' },
    emerald: { bg: 'bg-emerald-50', text: 'text-emerald-700' },
    amber: { bg: 'bg-amber-50', text: 'text-amber-700' },
    red: { bg: 'bg-red-50', text: 'text-red-700' },
  }[color] || { bg: 'bg-slate-50', text: 'text-slate-700' };

  return (
    <div className={`card-modern p-4 ${styles.bg}`}>
      <p className="text-xs font-medium text-slate-600 mb-1">{label}</p>
      <p className={`text-2xl font-extrabold ${styles.text}`}>{value}</p>
    </div>
  );
}
