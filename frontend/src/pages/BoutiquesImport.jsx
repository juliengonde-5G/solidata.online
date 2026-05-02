import { useState, useEffect, useRef } from 'react';
import { Upload, FileText, CheckCircle, XCircle, AlertTriangle, Trash2, Zap } from 'lucide-react';
import Layout from '../components/Layout';
import { LoadingSpinner, useToast, PageHeader } from '../components';
import useConfirm from '../hooks/useConfirm';
import api from '../services/api';

export default function BoutiquesImport() {
  const { confirm, ConfirmDialogElement } = useConfirm();
  const toast = useToast();
  const fileInput = useRef(null);
  const [boutiques, setBoutiques] = useState([]);
  const [selectedBoutiqueId, setSelectedBoutiqueId] = useState('');
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (selectedBoutiqueId) loadBatches();
  }, [selectedBoutiqueId]);

  async function load() {
    setLoading(true);
    try {
      const res = await api.get('/boutiques?active=true');
      setBoutiques(res.data || []);
      if (res.data?.length > 0) setSelectedBoutiqueId(String(res.data[0].id));
    } catch (e) {
      toast.error('Erreur chargement boutiques');
    }
    setLoading(false);
  }

  async function loadBatches() {
    try {
      const res = await api.get(`/boutique-ventes/batches?boutique_id=${selectedBoutiqueId}`);
      setBatches(res.data || []);
    } catch (e) { console.error(e); }
  }

  async function postImport(file, force) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('boutique_id', selectedBoutiqueId);
    if (force) formData.append('force', 'true');
    return api.post('/boutique-ventes/import', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120000,
    });
  }

  async function handleUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!selectedBoutiqueId) { toast.error('Sélectionnez une boutique'); return; }
    setUploading(true);
    try {
      let res = await postImport(file, false);
      let data = res.data || {};
      if (data.duplicate) {
        if (data.reason === 'file_hash') {
          toast.warning(data.message || 'Fichier déjà importé (hash identique)');
        } else if (data.reason === 'date_overlap') {
          const c = data.conflict || {};
          const ok = await confirm({
            title: 'Import déjà existant',
            message: `Un import existe déjà pour cette boutique sur la période ${c.date_debut} → ${c.date_fin} (fichier: ${c.filename}). Écraser malgré tout ? L'ancien batch sera conservé en historique mais les ventes/tickets en doublon de période seront ajoutés.`,
            confirmLabel: 'Forcer l\'import',
            confirmVariant: 'danger',
          });
          if (ok) {
            res = await postImport(file, true);
            data = res.data || {};
            const ca = Number(data.ca_total_ttc || 0).toFixed(2);
            toast.success(`Import forcé : ${data.nb_lignes_importees ?? 0} lignes, ${data.nb_tickets ?? 0} tickets, ${ca} €`);
          } else {
            toast.warning('Import annulé (doublon de période)');
          }
        } else {
          toast.warning(data.message || 'Doublon détecté');
        }
      } else {
        const ca = Number(data.ca_total_ttc || 0).toFixed(2);
        toast.success(`Import réussi : ${data.nb_lignes_importees ?? 0} lignes, ${data.nb_tickets ?? 0} tickets, ${ca} €`);
      }
    } catch (err) {
      toast.error(err.response?.data?.error || err.message || 'Erreur import');
    } finally {
      // Toujours rafraîchir la liste et libérer l'input, même si le toast lève une erreur.
      try { await loadBatches(); } catch (_) { /* silencieux */ }
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function deleteBatch(id) {
    if (!confirm('Supprimer ce batch et toutes ses ventes ?')) return;
    try {
      await api.delete(`/boutique-ventes/batches/${id}`);
      toast.success('Batch supprimé');
      await loadBatches();
    } catch (e) {
      toast.error('Erreur suppression');
    }
  }

  const statutBadge = (statut) => {
    const map = {
      termine: { color: 'bg-green-100 text-green-700', icon: CheckCircle, label: 'Terminé' },
      en_cours: { color: 'bg-blue-100 text-blue-700', icon: FileText, label: 'En cours' },
      erreur: { color: 'bg-red-100 text-red-700', icon: XCircle, label: 'Erreur' },
      doublon: { color: 'bg-amber-100 text-amber-700', icon: AlertTriangle, label: 'Doublon' },
    };
    const s = map[statut] || map.en_cours;
    const Icon = s.icon;
    return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${s.color}`}><Icon className="w-3 h-3" />{s.label}</span>;
  };

  if (loading) return <Layout><LoadingSpinner size="lg" message="Chargement..." /></Layout>;

  return (
    <Layout>
      {ConfirmDialogElement}
      <div className="p-4 sm:p-6 max-w-6xl">
        <PageHeader
          title="Import CSV des ventes"
          subtitle="Upload manuel et suivi des imports automatiques depuis la caisse LogicS"
          icon={Upload}
        />

        {/* Import automatique via Power Automate */}
        <div className="bg-white rounded-card shadow-card p-6 mb-6 border-l-4 border-pink-500">
          <div className="flex items-center gap-2 mb-3">
            <Zap className="w-5 h-5 text-pink-600" />
            <h2 className="text-lg font-semibold text-slate-800">Import automatique via Power Automate</h2>
          </div>
          <p className="text-sm text-slate-600 mb-2">
            Les CSV Logic'S sont reçus en temps réel via le webhook
            <code className="mx-1 px-1.5 py-0.5 bg-slate-100 rounded text-xs">POST /api/boutique-ventes/webhook-email</code>
            alimenté par un flux Microsoft Power Automate. Aucune intervention manuelle requise.
          </p>
          <p className="text-xs text-slate-500">
            Un scan de secours du dossier CSV s'exécute aussi chaque soir à 20h pour rattraper les fichiers déposés en local. Les imports apparaissent dans l'historique ci-dessous.
          </p>
          <details className="mt-3 text-xs text-slate-600">
            <summary className="cursor-pointer font-medium text-slate-700 hover:text-slate-900">
              ⚠ Erreur Power Automate « base64 expects ... type 'Null' » ?
            </summary>
            <div className="mt-2 pl-3 border-l-2 border-amber-300 space-y-3">
              <p>
                Cette erreur vient toujours du flow Power Automate : l'expression
                <code className="mx-1 px-1 bg-slate-100 rounded">base64(...)</code> reçoit Null parce que la
                pièce jointe référencée n'existe pas / n'est pas trouvée à ce point du flow.
              </p>
              <p className="font-semibold text-slate-700">✅ Body HTTP correct (à coller dans l'action HTTP, à l'intérieur du « Apply to each » sur les attachments) :</p>
              <pre className="bg-slate-900 text-slate-100 rounded p-2 text-[11px] overflow-x-auto whitespace-pre">{`POST https://solidata.online/api/boutique-ventes/webhook-email
Headers:
  Content-Type: application/json
  X-Webhook-Secret: <ton secret>

Body:
{
  "boutique_code": "st_sever",
  "filename": "@{items('Apply_to_each')?['name']}",
  "content_base64": "@{items('Apply_to_each')?['contentBytes']}"
}`}</pre>
              <p>
                <strong>Pas de <code>base64(...)</code> autour de <code>contentBytes</code></strong> — le connecteur Outlook fournit déjà la valeur en base64.
                Wrapper avec <code>base64()</code> double l'encodage et plante si la pièce jointe est absente.
              </p>
              <p className="font-semibold text-slate-700">Alternative encore plus simple (pas besoin de Apply_to_each) :</p>
              <pre className="bg-slate-900 text-slate-100 rounded p-2 text-[11px] overflow-x-auto whitespace-pre">{`{
  "boutique_code": "st_sever",
  "attachments": "@{triggerOutputs()?['body/attachments']}"
}`}</pre>
              <p>
                Le webhook accepte désormais aussi cette forme native Outlook : il itère lui-même sur les pièces jointes,
                ne garde que les <code>.csv</code> et lance l'import. Plus aucune expression <code>base64()</code> dans le flow.
              </p>
              <p>Vérifications complémentaires :</p>
              <ul className="list-disc pl-5 space-y-1">
                <li>Le déclencheur filtre bien les mails <em>avec pièce jointe</em> (<code>Has Attachment = Yes</code>).</li>
                <li>Le path <code>contentBytes</code> est sensible à la casse — selon la version du connecteur, c'est <code>contentBytes</code> ou <code>ContentBytes</code> ; les deux sont gérés côté serveur.</li>
              </ul>
              <p>En mode dégradé, dépose le CSV via le formulaire « Import manuel » ci-dessous : le scan auto du soir prendra le relais.</p>
            </div>
          </details>
        </div>

        <div className="bg-white rounded-card shadow-card p-6 mb-6">
          <h2 className="text-lg font-semibold text-slate-800 mb-4">Import manuel</h2>
          <div className="flex flex-col sm:flex-row gap-4 items-end">
            <div className="flex-1">
              <label className="block text-sm font-medium text-slate-600 mb-1">Boutique</label>
              <select
                value={selectedBoutiqueId}
                onChange={(e) => setSelectedBoutiqueId(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-pink-500"
              >
                {boutiques.map(b => <option key={b.id} value={b.id}>{b.nom}</option>)}
              </select>
            </div>
            <div className="flex-1">
              <label className="block text-sm font-medium text-slate-600 mb-1">Fichier CSV (séparateur « ; »)</label>
              <input
                ref={fileInput}
                type="file"
                accept=".csv,text/csv"
                onChange={handleUpload}
                disabled={uploading}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            {uploading && <span className="text-pink-600 text-sm font-medium">Import en cours...</span>}
          </div>
          <p className="text-xs text-slate-500 mt-3">
            Format attendu : <code>Rayon;Date;ID Article;Article;Quantite;Prix U. TTC;Total HT;Total TTC;Montant TVA;Taux TVA</code>. Un fichier déjà importé (hash identique) sera rejeté comme doublon.
          </p>
        </div>

        <div className="bg-white rounded-card shadow-card p-6">
          <h2 className="text-lg font-semibold text-slate-800 mb-4">Historique des imports</h2>
          {batches.length === 0 ? (
            <p className="text-slate-500 text-sm text-center py-6">Aucun import pour cette boutique</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="text-left py-2 px-3">Date</th>
                    <th className="text-left py-2 px-3">Fichier</th>
                    <th className="text-left py-2 px-3">Période</th>
                    <th className="text-right py-2 px-3">Lignes</th>
                    <th className="text-right py-2 px-3">Tickets</th>
                    <th className="text-right py-2 px-3">CA TTC</th>
                    <th className="text-center py-2 px-3">Statut</th>
                    <th className="text-center py-2 px-3">Source</th>
                    <th className="text-right py-2 px-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {batches.map(b => (
                    <tr key={b.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="py-2 px-3 text-slate-600">{new Date(b.created_at).toLocaleString('fr-FR')}</td>
                      <td className="py-2 px-3 text-slate-700 truncate max-w-[220px]" title={b.filename}>{b.filename}</td>
                      <td className="py-2 px-3 text-slate-500 text-xs">
                        {b.date_debut && b.date_fin ? `${new Date(b.date_debut).toLocaleDateString('fr-FR')} → ${new Date(b.date_fin).toLocaleDateString('fr-FR')}` : '—'}
                      </td>
                      <td className="py-2 px-3 text-right">{b.nb_lignes_importees}{b.nb_lignes_erreur > 0 && <span className="text-red-600 ml-1">({b.nb_lignes_erreur} err)</span>}</td>
                      <td className="py-2 px-3 text-right">{b.nb_tickets_reconstitues}</td>
                      <td className="py-2 px-3 text-right font-medium">{Number(b.ca_total_ttc).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €</td>
                      <td className="py-2 px-3 text-center">{statutBadge(b.statut)}</td>
                      <td className="py-2 px-3 text-center text-xs text-slate-500">{b.source}</td>
                      <td className="py-2 px-3 text-right">
                        <button onClick={() => deleteBatch(b.id)} className="text-red-500 hover:text-red-700 p-1" title="Supprimer">
                          <Trash2 className="w-4 h-4" />
                        </button>
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
