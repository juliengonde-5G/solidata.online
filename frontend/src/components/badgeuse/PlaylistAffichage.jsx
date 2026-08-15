import { useState, useEffect, useCallback, useMemo } from 'react';
import { MonitorPlay, Plus, Pencil, Trash2, ShieldAlert, Eye } from 'lucide-react';
import api from '../../services/api';
import { LoadingSpinner, ErrorState, EmptyState, Modal, ConfirmDialog, useToast } from '../../components';
import { apiErr, fmtDateParis, TYPE_CONTENU_LABELS } from './badgeuseShared';

const TYPES = Object.entries(TYPE_CONTENU_LABELS).map(([value, label]) => ({ value, label }));

function emptyForm() {
  return { type: 'message', titre: '', corps: '', duree_sec: 10, ordre: 0, visible_du: '', visible_au: '', actif: true };
}

// ── Modale de création/édition d'un contenu ──────────────────────────────────
function ContenuForm({ open, onClose, onSaved, editing }) {
  const toast = useToast();
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setForm(editing ? {
      type: editing.type || 'message', titre: editing.titre || '', corps: editing.corps || '',
      duree_sec: editing.duree_sec ?? 10, ordre: editing.ordre ?? 0,
      visible_du: editing.visible_du ? String(editing.visible_du).slice(0, 10) : '',
      visible_au: editing.visible_au ? String(editing.visible_au).slice(0, 10) : '',
      actif: editing.actif !== false,
    } : emptyForm());
    setError(null);
  }, [open, editing]);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.titre.trim()) { setError('Le titre est requis.'); return; }
    const duree = parseInt(form.duree_sec, 10);
    if (!Number.isFinite(duree) || duree < 5 || duree > 60) { setError('La durée doit être comprise entre 5 et 60 secondes.'); return; }
    setSaving(true); setError(null);
    try {
      const payload = {
        type: form.type, titre: form.titre.trim(), corps: form.corps.trim() || null,
        duree_sec: duree, ordre: parseInt(form.ordre, 10) || 0,
        visible_du: form.visible_du || null, visible_au: form.visible_au || null,
        actif: form.actif,
      };
      if (editing) await api.put(`/badgeuse/contenus/${editing.id}`, payload);
      else await api.post('/badgeuse/contenus', payload);
      toast.success(editing ? 'Contenu modifié.' : 'Contenu créé.');
      onSaved();
    } catch (err) { setError(apiErr(err, 'Enregistrement du contenu impossible.')); setSaving(false); }
  };

  return (
    <Modal isOpen={open} onClose={onClose} title={editing ? 'Modifier le contenu' : 'Nouveau contenu'} size="md"
      footer={<>
        <button type="button" onClick={onClose} className="btn-secondary text-sm" disabled={saving}>Annuler</button>
        <button type="submit" form="contenu-form" disabled={saving} className="btn-primary text-sm disabled:opacity-50">{saving ? 'Enregistrement…' : 'Enregistrer'}</button>
      </>}>
      <form id="contenu-form" onSubmit={submit} className="space-y-3">
        {error && <div role="alert" className="text-sm bg-red-50 border border-red-200 text-red-700 rounded-lg p-2">{error}</div>}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Type</label>
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className="input-modern py-2 text-sm w-full">
              {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Ordre d'affichage</label>
            <input type="number" value={form.ordre} onChange={(e) => setForm({ ...form, ordre: e.target.value })} className="input-modern py-2 text-sm w-full" />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Titre</label>
          <input value={form.titre} onChange={(e) => setForm({ ...form, titre: e.target.value })} className="input-modern py-2 text-sm w-full" maxLength={200} required />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Corps du message</label>
          <textarea value={form.corps} onChange={(e) => setForm({ ...form, corps: e.target.value })} rows={3} className="input-modern py-2 text-sm w-full" />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Durée (s)</label>
            <input type="number" min={5} max={60} value={form.duree_sec} onChange={(e) => setForm({ ...form, duree_sec: e.target.value })} className="input-modern py-2 text-sm w-full" required />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Visible du</label>
            <input type="date" value={form.visible_du} onChange={(e) => setForm({ ...form, visible_du: e.target.value })} className="input-modern py-2 text-sm w-full" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Visible au</label>
            <input type="date" value={form.visible_au} onChange={(e) => setForm({ ...form, visible_au: e.target.value })} className="input-modern py-2 text-sm w-full" min={form.visible_du || undefined} />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={form.actif} onChange={(e) => setForm({ ...form, actif: e.target.checked })} className="rounded border-slate-300" /> Contenu actif
        </label>
      </form>
    </Modal>
  );
}

// Rendu de prévisualisation 16:9, au plus proche du kiosque en veille (BO-08).
function Previsualisation16x9({ contenu }) {
  if (!contenu) {
    return (
      <div className="aspect-video w-full rounded-xl bg-slate-900 flex items-center justify-center text-slate-500 text-sm">
        Sélectionnez un contenu pour le prévisualiser
      </div>
    );
  }
  return (
    <div className="aspect-video w-full rounded-xl bg-gradient-to-br from-slate-900 to-slate-800 flex flex-col items-center justify-center text-center px-10 py-8 overflow-hidden">
      <span className="text-[11px] uppercase tracking-widest text-teal-400 font-semibold mb-3">{TYPE_CONTENU_LABELS[contenu.type] || contenu.type}</span>
      <h2 className="text-white font-bold leading-tight" style={{ fontSize: 'clamp(1.5rem, 4vw, 2.75rem)' }}>{contenu.titre || 'Sans titre'}</h2>
      {contenu.corps && (
        <p className="text-slate-300 mt-4 max-w-2xl" style={{ fontSize: 'clamp(0.9rem, 1.8vw, 1.25rem)' }}>{contenu.corps}</p>
      )}
      <span className="text-slate-500 text-xs mt-6">{contenu.duree_sec || 10} s à l'écran</span>
    </div>
  );
}

// ── Onglet Affichage (BO-08) ──────────────────────────────────────────────────
export default function PlaylistAffichage({ canWrite }) {
  const toast = useToast();
  const [contenus, setContenus] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [modal, setModal] = useState({ open: false, editing: null });
  const [confirmDelete, setConfirmDelete] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    api.get('/badgeuse/contenus')
      .then((r) => {
        const d = r.data;
        const list = Array.isArray(d) ? d : (d.contenus || d.rows || d.items || []);
        setContenus([...list].sort((a, b) => (a.ordre ?? 0) - (b.ordre ?? 0)));
        setError(null);
      })
      .catch((err) => setError(apiErr(err, 'Chargement de la playlist impossible.')))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const selected = useMemo(() => contenus.find((c) => c.id === selectedId) || contenus[0] || null, [contenus, selectedId]);

  const doDelete = async () => {
    if (!confirmDelete) return;
    try {
      await api.delete(`/badgeuse/contenus/${confirmDelete.id}`);
      toast.success('Contenu supprimé.');
      setConfirmDelete(null);
      load();
    } catch (err) { toast.error(apiErr(err, 'Suppression impossible.')); }
  };

  if (loading) return <LoadingSpinner size="lg" message="Chargement de la playlist…" />;
  if (error) return <ErrorState variant="card" title="Playlist indisponible" message={error} onRetry={load} />;

  return (
    <div className="space-y-5">
      <div role="note" className="rounded-lg border border-amber-200 bg-amber-50 text-amber-800 text-xs px-3 py-2 flex items-start gap-2">
        <ShieldAlert className="w-4 h-4 flex-shrink-0 mt-0.5" aria-hidden="true" />
        <span>Aucune donnée personnelle dans ces contenus — l'écran de veille est une finalité de communication interne dissociée du pointage (photo, nom complet, statut de contrat ou de parcours interdits).</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Liste */}
        <div className="lg:col-span-3 bg-white rounded-xl border p-4">
          <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
            <h3 className="font-semibold text-slate-800 flex items-center gap-2"><MonitorPlay className="w-4 h-4 text-teal-600" /> Contenus de la playlist</h3>
            {canWrite && (
              <button onClick={() => setModal({ open: true, editing: null })} className="btn-primary text-sm inline-flex items-center gap-1.5">
                <Plus className="w-4 h-4" /> Nouveau contenu
              </button>
            )}
          </div>
          {contenus.length === 0 ? (
            <EmptyState icon={MonitorPlay} title="Playlist vide" description="Ajoutez un premier contenu (message, image, planning…) pour l'écran de veille." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase text-slate-500 border-b border-slate-200">
                  <tr>
                    <th className="text-left py-2 px-2">Ordre</th>
                    <th className="text-left py-2 px-2">Type</th>
                    <th className="text-left py-2 px-2">Titre</th>
                    <th className="text-right py-2 px-2">Durée</th>
                    <th className="text-left py-2 px-2">Fenêtre</th>
                    <th className="text-center py-2 px-2">Actif</th>
                    <th className="text-right py-2 px-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {contenus.map((c) => (
                    <tr key={c.id} className={`border-b border-slate-50 cursor-pointer ${selected?.id === c.id ? 'bg-teal-50/60' : 'hover:bg-slate-50/60'}`} onClick={() => setSelectedId(c.id)}>
                      <td className="py-2 px-2 text-slate-500">{c.ordre ?? 0}</td>
                      <td className="py-2 px-2 text-slate-600">{TYPE_CONTENU_LABELS[c.type] || c.type}</td>
                      <td className="py-2 px-2 font-medium text-slate-700 max-w-[220px] truncate" title={c.titre}>{c.titre}</td>
                      <td className="py-2 px-2 text-right text-slate-500">{c.duree_sec || 10} s</td>
                      <td className="py-2 px-2 text-slate-500 whitespace-nowrap text-xs">
                        {c.visible_du || c.visible_au ? `${c.visible_du ? fmtDateParis(c.visible_du) : '…'} → ${c.visible_au ? fmtDateParis(c.visible_au) : '…'}` : 'permanent'}
                      </td>
                      <td className="py-2 px-2 text-center">{c.actif !== false ? <span className="text-emerald-600">Oui</span> : <span className="text-slate-400">Non</span>}</td>
                      <td className="py-2 px-2 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => setSelectedId(c.id)} className="text-slate-400 hover:text-teal-700 p-1" title="Prévisualiser" aria-label="Prévisualiser"><Eye className="w-4 h-4" /></button>
                        {canWrite && (
                          <>
                            <button onClick={() => setModal({ open: true, editing: c })} className="text-slate-400 hover:text-teal-700 p-1" title="Modifier" aria-label="Modifier"><Pencil className="w-4 h-4" /></button>
                            <button onClick={() => setConfirmDelete(c)} className="text-slate-400 hover:text-red-600 p-1" title="Supprimer" aria-label="Supprimer"><Trash2 className="w-4 h-4" /></button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Prévisualisation 16:9 */}
        <div className="lg:col-span-2 bg-white rounded-xl border p-4">
          <h3 className="font-semibold text-slate-800 mb-3">Aperçu écran (16:9)</h3>
          <Previsualisation16x9 contenu={selected} />
          <p className="text-[11px] text-slate-400 mt-2">Rendu approximatif du kiosque en veille — la mise en page réelle dépend du poste.</p>
        </div>
      </div>

      <ContenuForm open={modal.open} editing={modal.editing} onClose={() => setModal({ open: false, editing: null })}
        onSaved={() => { setModal({ open: false, editing: null }); load(); }} />

      <ConfirmDialog isOpen={!!confirmDelete} onCancel={() => setConfirmDelete(null)} onConfirm={doDelete}
        title="Supprimer le contenu" message={confirmDelete ? `Supprimer « ${confirmDelete.titre} » de la playlist ? Action définitive.` : ''}
        confirmLabel="Supprimer" confirmVariant="danger" />
    </div>
  );
}
