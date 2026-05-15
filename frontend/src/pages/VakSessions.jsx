import { useState, useEffect, useRef } from 'react';
import { Calendar, Plus, Edit3, Trash2, Upload, FileText, CheckCircle, XCircle, AlertTriangle, Info } from 'lucide-react';
import Layout from '../components/Layout';
import { LoadingSpinner, PageHeader, Modal, FormField, useToast } from '../components';
import useConfirm from '../hooks/useConfirm';
import api from '../services/api';

function formatEuro(v, decimals = 0) {
  return `${Number(v || 0).toLocaleString('fr-FR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })} €`;
}
function formatDate(d) {
  return d ? new Date(d).toLocaleDateString('fr-FR') : '—';
}

export default function VakSessions() {
  const toast = useToast();
  const { confirm, ConfirmDialogElement } = useConfirm();
  const [tab, setTab] = useState('sessions');
  const [vaks, setVaks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => { loadVaks(); }, []);

  async function loadVaks() {
    setLoading(true);
    try {
      const r = await api.get('/vak');
      setVaks(r.data || []);
    } catch (err) {
      toast.error('Erreur chargement VAK');
    }
    setLoading(false);
  }

  function openCreate() {
    setEditing({
      libelle: `VAK ${new Date().toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}`,
      date_debut: new Date().toISOString().slice(0, 10),
      date_fin: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10),
      lieu: 'Siège - Rouen',
      ca_objectif_ttc: '',
      poids_objectif_kg: '',
      notes: '',
    });
    setModalOpen(true);
  }

  function openEdit(v) {
    setEditing({
      ...v,
      date_debut: v.date_debut?.slice(0, 10),
      date_fin: v.date_fin?.slice(0, 10),
      ca_objectif_ttc: v.ca_objectif_ttc || '',
      poids_objectif_kg: v.poids_objectif_kg || '',
    });
    setModalOpen(true);
  }

  async function save() {
    if (!editing.libelle || !editing.date_debut || !editing.date_fin) {
      toast.error('Libellé, date début et date fin requis');
      return;
    }
    try {
      const payload = {
        libelle: editing.libelle,
        date_debut: editing.date_debut,
        date_fin: editing.date_fin,
        lieu: editing.lieu,
        ca_objectif_ttc: editing.ca_objectif_ttc || null,
        poids_objectif_kg: editing.poids_objectif_kg || null,
        notes: editing.notes,
      };
      if (editing.id) {
        await api.put(`/vak/${editing.id}`, payload);
        toast.success('VAK mise à jour');
      } else {
        await api.post('/vak', payload);
        toast.success('VAK créée');
      }
      setModalOpen(false);
      setEditing(null);
      await loadVaks();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur enregistrement');
    }
  }

  async function deleteVak(id, libelle) {
    const ok = await confirm({
      title: 'Supprimer cette VAK',
      message: `Supprimer "${libelle}" ? Toutes les ventes, tickets et imports rattachés seront supprimés.`,
      confirmLabel: 'Supprimer',
      confirmVariant: 'danger',
    });
    if (!ok) return;
    try {
      await api.delete(`/vak/${id}`);
      toast.success('VAK supprimée');
      await loadVaks();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur suppression');
    }
  }

  if (loading) return <Layout><LoadingSpinner size="lg" message="Chargement..." /></Layout>;

  return (
    <Layout>
      {ConfirmDialogElement}
      <div className="p-4 sm:p-6 max-w-6xl">
        <PageHeader
          title="Sessions VAK & Import"
          subtitle="Gestion des évènements Vente au Kilo et import de secours des rapports SumUp"
          icon={Calendar}
        />

        <div className="flex gap-2 mb-6 border-b border-slate-200">
          {[['sessions', 'Sessions VAK', Calendar], ['imports', 'Imports CSV (secours)', Upload]].map(([k, l, Icon]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition flex items-center gap-2 ${
                tab === k ? 'border-orange-500 text-orange-600' : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}>
              <Icon className="w-4 h-4" />{l}
            </button>
          ))}
        </div>

        {tab === 'sessions' && (
          <SessionsTab
            vaks={vaks}
            onCreate={openCreate}
            onEdit={openEdit}
            onDelete={deleteVak}
          />
        )}

        {tab === 'imports' && (
          <ImportsTab vaks={vaks} onReload={loadVaks} toast={toast} />
        )}
      </div>

      {modalOpen && editing && (
        <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)}
          title={editing.id ? 'Modifier la VAK' : 'Nouvelle VAK'}>
          <div className="space-y-4">
            <FormField label="Libellé" required value={editing.libelle}
              onChange={(e) => setEditing({ ...editing, libelle: e.target.value })} />
            <div className="grid grid-cols-2 gap-3">
              <FormField type="date" label="Date début" required value={editing.date_debut}
                onChange={(e) => setEditing({ ...editing, date_debut: e.target.value })} />
              <FormField type="date" label="Date fin" required value={editing.date_fin}
                onChange={(e) => setEditing({ ...editing, date_fin: e.target.value })} />
            </div>
            <FormField label="Lieu" value={editing.lieu}
              onChange={(e) => setEditing({ ...editing, lieu: e.target.value })} />
            <div className="grid grid-cols-2 gap-3">
              <FormField type="number" label="Objectif CA TTC (€)" value={editing.ca_objectif_ttc}
                onChange={(e) => setEditing({ ...editing, ca_objectif_ttc: e.target.value })} />
              <FormField type="number" label="Objectif poids (kg)" value={editing.poids_objectif_kg}
                onChange={(e) => setEditing({ ...editing, poids_objectif_kg: e.target.value })} />
            </div>
            <FormField type="textarea" label="Notes" value={editing.notes || ''}
              onChange={(e) => setEditing({ ...editing, notes: e.target.value })} />
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setModalOpen(false)}
                className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Annuler</button>
              <button onClick={save}
                className="px-4 py-2 text-sm bg-orange-500 text-white rounded-lg hover:bg-orange-600">Enregistrer</button>
            </div>
          </div>
        </Modal>
      )}
    </Layout>
  );
}

function SessionsTab({ vaks, onCreate, onEdit, onDelete }) {
  return (
    <>
      <div className="flex justify-between items-center mb-4">
        <p className="text-sm text-slate-600">
          {vaks.length} {vaks.length > 1 ? 'sessions' : 'session'} enregistrée{vaks.length > 1 ? 's' : ''}
        </p>
        <button onClick={onCreate}
          className="inline-flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 text-sm font-medium">
          <Plus className="w-4 h-4" />Nouvelle VAK
        </button>
      </div>

      {vaks.length === 0 ? (
        <div className="bg-white rounded-card shadow-card p-12 text-center">
          <Calendar className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-slate-500 mb-3">Aucune VAK enregistrée pour l'instant.</p>
          <button onClick={onCreate}
            className="inline-flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 text-sm font-medium">
            <Plus className="w-4 h-4" />Créer la première VAK
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-card shadow-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-slate-500 border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="text-left py-3 px-4">Libellé</th>
                <th className="text-left py-3 px-4">Période</th>
                <th className="text-left py-3 px-4">Lieu</th>
                <th className="text-right py-3 px-4">CA réalisé</th>
                <th className="text-right py-3 px-4">Objectif</th>
                <th className="text-right py-3 px-4">% atteinte</th>
                <th className="text-right py-3 px-4">Poids</th>
                <th className="text-right py-3 px-4">Tickets</th>
                <th className="text-right py-3 px-4"></th>
              </tr>
            </thead>
            <tbody>
              {vaks.map((v) => {
                const obj = Number(v.ca_objectif_ttc || 0);
                const real = Number(v.ca_realise || 0);
                const pct = obj > 0 ? (real / obj) * 100 : null;
                return (
                  <tr key={v.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="py-3 px-4 font-medium text-slate-800">{v.libelle}</td>
                    <td className="py-3 px-4 text-slate-600">
                      {formatDate(v.date_debut)} → {formatDate(v.date_fin)}
                    </td>
                    <td className="py-3 px-4 text-slate-500">{v.lieu}</td>
                    <td className="py-3 px-4 text-right font-semibold">{formatEuro(real)}</td>
                    <td className="py-3 px-4 text-right text-slate-500">{obj > 0 ? formatEuro(obj) : '—'}</td>
                    <td className={`py-3 px-4 text-right font-medium ${pct === null ? 'text-slate-400' : pct >= 100 ? 'text-green-600' : pct >= 80 ? 'text-amber-600' : 'text-red-600'}`}>
                      {pct !== null ? `${pct.toFixed(0)}%` : '—'}
                    </td>
                    <td className="py-3 px-4 text-right">{Number(v.poids_realise || 0).toFixed(1)} kg</td>
                    <td className="py-3 px-4 text-right">{v.nb_tickets || 0}</td>
                    <td className="py-3 px-4 text-right">
                      <button onClick={() => onEdit(v)} className="text-slate-500 hover:text-orange-600 p-1" title="Modifier">
                        <Edit3 className="w-4 h-4" />
                      </button>
                      <button onClick={() => onDelete(v.id, v.libelle)} className="text-slate-500 hover:text-red-600 p-1 ml-1" title="Supprimer">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function ImportsTab({ vaks, onReload, toast }) {
  const fileInput = useRef(null);
  const [selectedVakId, setSelectedVakId] = useState(vaks[0]?.id ? String(vaks[0].id) : '');
  const [batches, setBatches] = useState([]);
  const [uploading, setUploading] = useState(false);

  useEffect(() => { if (vaks.length > 0 && !selectedVakId) setSelectedVakId(String(vaks[0].id)); }, [vaks]);
  useEffect(() => { if (selectedVakId) loadBatches(); }, [selectedVakId]);

  async function loadBatches() {
    try {
      const r = await api.get(`/vak/${selectedVakId}/csv-batches`);
      setBatches(r.data || []);
    } catch (_) { /* silent */ }
  }

  async function handleUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!selectedVakId) { toast.error('Sélectionnez une VAK'); return; }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await api.post(`/vak/${selectedVakId}/import-csv`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 120000,
      });
      const d = r.data || {};
      if (d.duplicate) {
        toast.warning(d.message || 'Doublon détecté');
      } else {
        toast.success(`Import : ${d.nb_lignes_importees ?? 0} lignes, ${d.nb_tickets ?? 0} tickets, ${Number(d.ca_total_ttc || 0).toFixed(2)} €`);
      }
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur import');
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
      await loadBatches();
      await onReload();
    }
  }

  async function deleteBatch(id) {
    try {
      await api.delete(`/vak/csv-batches/${id}`);
      toast.success('Batch supprimé');
      await loadBatches();
      await onReload();
    } catch (err) {
      toast.error('Erreur suppression');
    }
  }

  const statutBadge = (statut) => {
    const map = {
      termine: { color: 'bg-green-100 text-green-700', icon: CheckCircle, label: 'Terminé' },
      en_cours: { color: 'bg-blue-100 text-blue-700', icon: FileText, label: 'En cours' },
      erreur: { color: 'bg-red-100 text-red-700', icon: XCircle, label: 'Erreur' },
    };
    const s = map[statut] || map.en_cours;
    const Icon = s.icon;
    return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${s.color}`}><Icon className="w-3 h-3" />{s.label}</span>;
  };

  return (
    <>
      <div className="bg-blue-50 border-l-4 border-blue-500 rounded-r-lg p-4 mb-6 flex gap-3">
        <Info className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
        <div className="text-sm text-blue-900">
          <strong>Source principale = API SumUp</strong>. Cet import CSV sert uniquement au rattrapage
          historique (VAK antérieures à la mise en service de l'intégration) ou en mode dégradé.
          Pour l'usage courant, configure SumUp dans <a href="/admin/vak/sumup-config" className="underline font-medium">Config SumUp</a>.
        </div>
      </div>

      <div className="bg-white rounded-card shadow-card p-6 mb-6">
        <h2 className="text-lg font-semibold text-slate-800 mb-4">Import manuel d'un rapport SumUp</h2>
        <div className="flex flex-col sm:flex-row gap-4 items-end">
          <div className="flex-1">
            <label className="block text-sm font-medium text-slate-600 mb-1">VAK cible</label>
            <select
              value={selectedVakId}
              onChange={(e) => setSelectedVakId(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-orange-500"
            >
              <option value="">— Sélectionner une VAK —</option>
              {vaks.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.libelle} ({formatDate(v.date_debut)} → {formatDate(v.date_fin)})
                </option>
              ))}
            </select>
          </div>
          <div className="flex-1">
            <label className="block text-sm font-medium text-slate-600 mb-1">Fichier CSV SumUp</label>
            <input
              ref={fileInput}
              type="file"
              accept=".csv,text/csv"
              onChange={handleUpload}
              disabled={uploading || !selectedVakId}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          {uploading && <span className="text-orange-600 text-sm font-medium">Import en cours...</span>}
        </div>
        <p className="text-xs text-slate-500 mt-3">
          Format attendu : <code>Date,Type,Réf. transaction,Moyen de paiement,Quantité,Unité,Description,Catégorie,…</code>
          (17 colonnes, séparateur virgule, décimales virgule, date "DD mois YYYY HH:MM"). Hash SHA-256 anti-doublon.
        </p>
      </div>

      <div className="bg-white rounded-card shadow-card p-6">
        <h2 className="text-lg font-semibold text-slate-800 mb-4">Historique des imports pour cette VAK</h2>
        {batches.length === 0 ? (
          <p className="text-slate-500 text-sm text-center py-6">Aucun import pour cette VAK</p>
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
                  <th className="text-right py-2 px-3">Poids</th>
                  <th className="text-center py-2 px-3">Statut</th>
                  <th className="text-right py-2 px-3"></th>
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => (
                  <tr key={b.id} className="border-b border-slate-100">
                    <td className="py-2 px-3 text-slate-600">{new Date(b.created_at).toLocaleString('fr-FR')}</td>
                    <td className="py-2 px-3 text-slate-700 truncate max-w-[220px]" title={b.filename}>{b.filename}</td>
                    <td className="py-2 px-3 text-slate-500 text-xs">
                      {b.date_debut && b.date_fin ? `${formatDate(b.date_debut)} → ${formatDate(b.date_fin)}` : '—'}
                    </td>
                    <td className="py-2 px-3 text-right">
                      {b.nb_lignes_importees}
                      {b.nb_lignes_erreur > 0 && <span className="text-red-600 ml-1">({b.nb_lignes_erreur} err)</span>}
                    </td>
                    <td className="py-2 px-3 text-right">{b.nb_tickets_reconstitues}</td>
                    <td className="py-2 px-3 text-right font-medium">{formatEuro(b.ca_total_ttc, 2)}</td>
                    <td className="py-2 px-3 text-right">{Number(b.poids_total_kg || 0).toFixed(1)} kg</td>
                    <td className="py-2 px-3 text-center">{statutBadge(b.statut)}</td>
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
    </>
  );
}
