import { useState, useEffect, useCallback, useMemo } from 'react';
import { MonitorPlay, Plus, Pencil, Trash2, ShieldAlert, Eye, UploadCloud, Link2, Scale } from 'lucide-react';
import api from '../../services/api';
import { LoadingSpinner, ErrorState, EmptyState, Modal, ConfirmDialog, useToast } from '../../components';
import {
  apiErr, fmtDateParis, TYPE_CONTENU_LABELS, TYPE_CONTENU_HINTS, TYPE_CONTENU_CONFIG_FIELDS,
  TYPES_LEGACY, TYPES_GENERATEURS, isGenerateurType, isMediaServeurType, ChampVakUniquement,
} from './badgeuseShared';
import PrevisualisationContenu from './PrevisualisationContenu';
import UploadMediaModal from './UploadMediaModal';
import PartagerLienModal from './PartagerLienModal';

// Types proposés à la création libre (§4 CDC) : les 5 historiques + les 5
// générateurs. `media`/`lien` sont créés UNIQUEMENT via leurs boutons dédiés
// (téléversement / partage de lien), jamais depuis ce sélecteur.
const TYPES_LEGACY_OPTIONS = TYPES_LEGACY.map((v) => ({ value: v, label: TYPE_CONTENU_LABELS[v] }));
const TYPES_GENERATEURS_OPTIONS = TYPES_GENERATEURS.map((v) => ({ value: v, label: TYPE_CONTENU_LABELS[v] }));

function defaultConfigFor(type) {
  const fields = TYPE_CONTENU_CONFIG_FIELDS[type] || [];
  const cfg = {};
  fields.forEach((f) => { cfg[f.key] = f.default; });
  return cfg;
}

function parseConfig(v, type) {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    try { const p = JSON.parse(v); if (p && typeof p === 'object') return p; } catch { /* repli défauts */ }
  }
  return defaultConfigFor(type);
}

function emptyForm() {
  return {
    type: 'message', titre: '', corps: '', media_url: '', duree_sec: 10, ordre: 0,
    visible_du: '', visible_au: '', actif: true, config: {}, vak_uniquement: false,
  };
}

// ── Modale de création/édition d'un contenu (types historiques + générateurs ;
// les entrées media/lien existantes s'y éditent en métadonnées seules) ──────
function ContenuForm({ open, onClose, onSaved, editing }) {
  const toast = useToast();
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setForm({
        type: editing.type || 'message', titre: editing.titre || '', corps: editing.corps || '',
        media_url: editing.media_url || '',
        duree_sec: editing.duree_sec ?? 10, ordre: editing.ordre ?? 0,
        visible_du: editing.visible_du ? String(editing.visible_du).slice(0, 10) : '',
        visible_au: editing.visible_au ? String(editing.visible_au).slice(0, 10) : '',
        actif: editing.actif !== false,
        config: parseConfig(editing.config, editing.type),
        vak_uniquement: !!editing.vak_uniquement,
      });
    } else {
      setForm(emptyForm());
    }
    setError(null);
  }, [open, editing]);

  const changeType = (type) => {
    setForm((f) => ({ ...f, type, config: isGenerateurType(type) ? defaultConfigFor(type) : {} }));
  };
  const setConfigField = (key, v) => setForm((f) => ({ ...f, config: { ...f.config, [key]: v } }));

  const verrouTypeMedia = editing && isMediaServeurType(editing.type);
  const generateur = isGenerateurType(form.type);
  const configFields = TYPE_CONTENU_CONFIG_FIELDS[form.type] || [];

  const submit = async (e) => {
    e.preventDefault();
    if (!generateur && !form.titre.trim()) { setError('Le titre est requis.'); return; }
    const duree = parseInt(form.duree_sec, 10);
    if (!Number.isFinite(duree) || duree < 5 || duree > 60) { setError('La durée doit être comprise entre 5 et 60 secondes.'); return; }
    setSaving(true); setError(null);
    try {
      const payload = {
        type: form.type, titre: form.titre.trim() || null,
        corps: (!generateur && !verrouTypeMedia) ? (form.corps.trim() || null) : null,
        media_url: (!generateur && !verrouTypeMedia && form.type === 'image') ? (form.media_url.trim() || null) : null,
        duree_sec: duree, ordre: parseInt(form.ordre, 10) || 0,
        visible_du: form.visible_du || null, visible_au: form.visible_au || null,
        actif: form.actif,
        config: generateur ? form.config : null,
        vak_uniquement: !!form.vak_uniquement,
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
            {verrouTypeMedia ? (
              <div className="input-modern py-2 text-sm w-full bg-slate-50 text-slate-500">{TYPE_CONTENU_LABELS[form.type] || form.type}</div>
            ) : (
              <select value={form.type} onChange={(e) => changeType(e.target.value)} className="input-modern py-2 text-sm w-full">
                <optgroup label="Contenus manuels">
                  {TYPES_LEGACY_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </optgroup>
                <optgroup label="Générateurs (contenu calculé côté serveur)">
                  {TYPES_GENERATEURS_OPTIONS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </optgroup>
              </select>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Ordre d'affichage</label>
            <input type="number" value={form.ordre} onChange={(e) => setForm({ ...form, ordre: e.target.value })} className="input-modern py-2 text-sm w-full" />
          </div>
        </div>

        {TYPE_CONTENU_HINTS[form.type] && (
          <p className="text-[11px] text-slate-400 -mt-1">{TYPE_CONTENU_HINTS[form.type]}</p>
        )}

        {/* Média téléversé ou lien rapatrié : le FICHIER est figé (le remplacer
            reviendrait à changer de contenu), mais son titre, lui, se modifie —
            c'est le seul texte que l'écran affiche sous le visuel, et il porte
            souvent le nom brut du fichier au moment du téléversement.
            L'encadré promettait déjà « seuls le titre, la durée… sont
            modifiables ici » : le champ, lui, n'était pas rendu. */}
        {verrouTypeMedia && (
          <div className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg p-2">
            {editing.type === 'lien' && editing.source_url ? <>Lien source : <span className="font-mono break-all">{editing.source_url}</span></> : null}
            {editing.fichier ? <div>Fichier : {editing.fichier}</div> : null}
            <p className="mt-1">Le fichier ne se remplace pas ici (téléversez un nouveau média) — le titre, la durée, l'ordre, la fenêtre de validité et l'état actif se modifient.</p>
          </div>
        )}
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">Titre {generateur && '(facultatif)'}</label>
          <input value={form.titre} onChange={(e) => setForm({ ...form, titre: e.target.value })} className="input-modern py-2 text-sm w-full" maxLength={200} required={!generateur} />
        </div>

        {!generateur && !verrouTypeMedia && (
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Corps du message</label>
            <textarea value={form.corps} onChange={(e) => setForm({ ...form, corps: e.target.value })} rows={3} className="input-modern py-2 text-sm w-full" />
          </div>
        )}
        {!generateur && !verrouTypeMedia && form.type === 'image' && (
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">URL de l'image</label>
            <input type="text" value={form.media_url} onChange={(e) => setForm({ ...form, media_url: e.target.value })}
              className="input-modern py-2 text-sm w-full" maxLength={300} placeholder="consignes-tri.png (fichier déployé sur le poste)" required />
            <p className="text-[11px] text-slate-400 mt-1">
              V1 : le kiosque n'affiche que des images HÉBERGÉES SUR LE POSTE (CSP verrouillée
              <code className="mx-1">img-src 'self'</code> — défense en profondeur) : chemin relatif d'un fichier
              déployé dans <code className="mx-1">ui/</code> (ex. <code>consignes-tri.png</code>). Une URL distante
              ne s'affichera pas. Aucune donnée personnelle, aucune photo de personne — exigence de conformité.
              Pour un média hébergé sur SOLIDATA, utilisez plutôt « Téléverser un média ».
            </p>
          </div>
        )}

        {generateur && configFields.length > 0 && (
          <div className="grid grid-cols-2 gap-3 rounded-lg border border-slate-200 p-3">
            {configFields.map((f) => (
              <div key={f.key}>
                <label className="block text-xs font-medium text-slate-600 mb-1">{f.label}</label>
                <input type="number" min={f.min} max={f.max} value={form.config[f.key] ?? f.default}
                  onChange={(e) => setConfigField(f.key, parseInt(e.target.value, 10) || f.default)}
                  className="input-modern py-2 text-sm w-full" />
              </div>
            ))}
          </div>
        )}
        {generateur && configFields.length === 0 && (
          <p className="text-xs text-slate-400 italic">Aucun réglage supplémentaire — contenu entièrement calculé côté serveur.</p>
        )}

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
        <ChampVakUniquement value={form.vak_uniquement} onChange={(v) => setForm({ ...form, vak_uniquement: v })} />

        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={form.actif} onChange={(e) => setForm({ ...form, actif: e.target.checked })} className="rounded border-slate-300" /> Contenu actif
        </label>
      </form>
    </Modal>
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
  const [uploadOpen, setUploadOpen] = useState(false);
  const [lienOpen, setLienOpen] = useState(false);
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
        <span>Aucune donnée personnelle dans ces contenus — l'écran de veille est une finalité de communication interne dissociée du pointage (photo, nom complet, statut de contrat ou de parcours interdits). Les générateurs (annonces, tournées…) respectent les mêmes règles côté serveur.</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        {/* Liste */}
        <div className="lg:col-span-3 bg-white rounded-xl border p-4">
          <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
            <h3 className="font-semibold text-slate-800 flex items-center gap-2"><MonitorPlay className="w-4 h-4 text-teal-600" /> Contenus de la playlist</h3>
            {canWrite && (
              <div className="flex items-center gap-2 flex-wrap">
                <button onClick={() => setModal({ open: true, editing: null })} className="btn-primary text-sm inline-flex items-center gap-1.5">
                  <Plus className="w-4 h-4" /> Nouveau contenu
                </button>
                <button onClick={() => setUploadOpen(true)} className="btn-secondary text-sm inline-flex items-center gap-1.5">
                  <UploadCloud className="w-4 h-4" /> Téléverser un média
                </button>
                <button onClick={() => setLienOpen(true)} className="btn-secondary text-sm inline-flex items-center gap-1.5">
                  <Link2 className="w-4 h-4" /> Partager un lien
                </button>
              </div>
            )}
          </div>
          {contenus.length === 0 ? (
            <EmptyState icon={MonitorPlay} title="Playlist vide" description="Ajoutez un premier contenu (message, image, annonces, média…) pour l'écran de veille." />
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
                      <td className="py-2 px-2 font-medium text-slate-700 max-w-[220px] truncate" title={c.titre}>{c.titre || '—'}</td>
                      <td className="py-2 px-2 text-right text-slate-500">{c.duree_sec || 10} s</td>
                      <td className="py-2 px-2 text-slate-500 whitespace-nowrap text-xs">
                        {c.vak_uniquement ? (
                          <span className="inline-flex items-center gap-1 text-orange-700 bg-orange-50 border border-orange-200 rounded-full px-2 py-0.5" title="Diffusé uniquement les jours de Vente au Kilo (dates du module VAK)">
                            <Scale className="w-3 h-3" aria-hidden="true" /> Jours de VAK
                          </span>
                        ) : (c.visible_du || c.visible_au
                          ? `${c.visible_du ? fmtDateParis(c.visible_du) : '…'} → ${c.visible_au ? fmtDateParis(c.visible_au) : '…'}`
                          : 'permanent')}
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
          <PrevisualisationContenu contenu={selected} />
          <p className="text-[11px] text-slate-400 mt-2">
            Rendu approximatif du kiosque en veille — la mise en page réelle dépend du poste. Pour les générateurs
            (annonces, actus, tournées, réseaux sociaux, VAK), la donnée affichée ici est un exemple : la vraie
            donnée est calculée côté serveur pour le poste.
          </p>
        </div>
      </div>

      <ContenuForm open={modal.open} editing={modal.editing} onClose={() => setModal({ open: false, editing: null })}
        onSaved={() => { setModal({ open: false, editing: null }); load(); }} />

      <UploadMediaModal open={uploadOpen} onClose={() => setUploadOpen(false)}
        onUploaded={() => { setUploadOpen(false); load(); }} />

      <PartagerLienModal open={lienOpen} onClose={() => setLienOpen(false)}
        onShared={() => { setLienOpen(false); load(); }} />

      <ConfirmDialog isOpen={!!confirmDelete} onCancel={() => setConfirmDelete(null)} onConfirm={doDelete}
        title="Supprimer le contenu" message={confirmDelete ? `Supprimer « ${confirmDelete.titre || TYPE_CONTENU_LABELS[confirmDelete.type] || confirmDelete.type} » de la playlist ? Action définitive.` : ''}
        confirmLabel="Supprimer" confirmVariant="danger" />
    </div>
  );
}
