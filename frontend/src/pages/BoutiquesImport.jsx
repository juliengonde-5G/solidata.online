import { useState, useEffect, useRef } from 'react';
import { Upload, FileText, CheckCircle, XCircle, AlertTriangle, Trash2, Mail, Settings, RefreshCw } from 'lucide-react';
import Layout from '../components/Layout';
import { LoadingSpinner, useToast, PageHeader } from '../components';
import api from '../services/api';

export default function BoutiquesImport() {
  const toast = useToast();
  const fileInput = useRef(null);
  const [boutiques, setBoutiques] = useState([]);
  const [selectedBoutiqueId, setSelectedBoutiqueId] = useState('');
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [checkingMail, setCheckingMail] = useState(false);
  const [mailConfig, setMailConfig] = useState({});
  const [savingMailConfig, setSavingMailConfig] = useState(false);

  useEffect(() => { load(); }, []);
  useEffect(() => {
    if (selectedBoutiqueId) {
      loadBatches();
      const btq = boutiques.find(b => String(b.id) === String(selectedBoutiqueId));
      if (btq) {
        setMailConfig({
          logics_mail_folder: btq.logics_mail_folder || 'INBOX',
          logics_mail_subject_keyword: btq.logics_mail_subject_keyword || '',
          logics_mail_sender: btq.logics_mail_sender || '',
        });
      }
    }
  }, [selectedBoutiqueId, boutiques]);

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

  async function handleUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!selectedBoutiqueId) { toast.error('Sélectionnez une boutique'); return; }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('boutique_id', selectedBoutiqueId);
      const res = await api.post('/boutique-ventes/import', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      if (res.data.duplicate) {
        toast.warning(res.data.message || 'Fichier déjà importé');
      } else {
        toast.success(`Import réussi : ${res.data.nb_lignes_importees} lignes, ${res.data.nb_tickets} tickets, ${res.data.ca_total_ttc.toFixed(2)} €`);
      }
      await loadBatches();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur import');
    }
    setUploading(false);
    if (fileInput.current) fileInput.current.value = '';
  }

  async function checkMail() {
    setCheckingMail(true);
    try {
      await api.post('/boutique-ventes/check-email');
      toast.success("Vérification des mails lancée — les imports apparaîtront dans l'historique dans quelques instants");
      setTimeout(() => loadBatches(), 5000);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur vérification mail');
    }
    setCheckingMail(false);
  }

  async function saveMailConfig() {
    setSavingMailConfig(true);
    try {
      await api.put(`/boutiques/${selectedBoutiqueId}`, mailConfig);
      toast.success('Configuration mail sauvegardée');
      const res = await api.get('/boutiques?active=true');
      setBoutiques(res.data || []);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur sauvegarde');
    }
    setSavingMailConfig(false);
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
      <div className="p-4 sm:p-6 max-w-6xl">
        <PageHeader
          title="Import CSV des ventes"
          subtitle="Upload manuel et suivi des imports automatiques depuis la caisse LogicS"
          icon={Upload}
        />

        {/* Import automatique par mail */}
        <div className="bg-white rounded-card shadow-card p-6 mb-6 border-l-4 border-pink-500">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Mail className="w-5 h-5 text-pink-600" />
              <h2 className="text-lg font-semibold text-slate-800">Import automatique Logic'S</h2>
            </div>
            <button
              onClick={checkMail}
              disabled={checkingMail}
              className="flex items-center gap-2 bg-pink-600 hover:bg-pink-700 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${checkingMail ? 'animate-spin' : ''}`} />
              {checkingMail ? 'Vérification...' : 'Vérifier les mails maintenant'}
            </button>
          </div>
          <p className="text-sm text-slate-500 mb-4">
            Le serveur vérifie automatiquement les mails Logic'S chaque jour à <strong>20h</strong> et importe les CSV en arrière-plan.
            Utilisez le bouton ci-dessus pour forcer une vérification immédiate.
          </p>

          {/* Configuration email par boutique */}
          <details className="border border-slate-200 rounded-lg">
            <summary className="flex items-center gap-2 px-4 py-3 cursor-pointer text-sm font-medium text-slate-700 hover:bg-slate-50">
              <Settings className="w-4 h-4" />
              Configuration mail pour la boutique sélectionnée
            </summary>
            <div className="p-4 border-t border-slate-200 grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Dossier IMAP</label>
                <input
                  type="text"
                  value={mailConfig.logics_mail_folder || ''}
                  onChange={e => setMailConfig(c => ({ ...c, logics_mail_folder: e.target.value }))}
                  placeholder="INBOX"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                />
                <p className="text-xs text-slate-400 mt-1">Sous-dossier Outlook (ex : LogicS)</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Mot-clé dans le sujet</label>
                <input
                  type="text"
                  value={mailConfig.logics_mail_subject_keyword || ''}
                  onChange={e => setMailConfig(c => ({ ...c, logics_mail_subject_keyword: e.target.value }))}
                  placeholder="Ex : St-Sever"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                />
                <p className="text-xs text-slate-400 mt-1">Pour distinguer les mails de chaque boutique</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Email expéditeur (filtre)</label>
                <input
                  type="email"
                  value={mailConfig.logics_mail_sender || ''}
                  onChange={e => setMailConfig(c => ({ ...c, logics_mail_sender: e.target.value }))}
                  placeholder="noreply@logics.fr"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                />
                <p className="text-xs text-slate-400 mt-1">Optionnel — filtrer par expéditeur</p>
              </div>
              <div className="sm:col-span-3 flex justify-end">
                <button
                  onClick={saveMailConfig}
                  disabled={savingMailConfig}
                  className="bg-slate-700 hover:bg-slate-800 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                >
                  {savingMailConfig ? 'Sauvegarde...' : 'Sauvegarder la configuration'}
                </button>
              </div>
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
