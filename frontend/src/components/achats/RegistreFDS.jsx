import { useState, useEffect, useCallback, useRef } from 'react';
import { Plus, Pencil, Trash2, Paperclip, Download, Filter } from 'lucide-react';
import { Modal, LoadingSpinner, ConfirmDialog } from '../../components';
import api from '../../services/api';
import {
  fdsStatus, frDate, isoDate, apiErr, UPLOAD_ACCEPT, UPLOAD_MAX,
} from './achatsShared';

const EMPTY = {
  produit: '', fournisseur_id: '', reference: '', date_fds: '', date_revision: '', dangers: '', epi_requis: '',
};

function FdsForm({ initial, fournisseurs, onClose, onSaved }) {
  const [form, setForm] = useState(() => ({
    ...EMPTY, ...initial,
    fournisseur_id: initial?.fournisseur_id == null ? '' : String(initial.fournisseur_id),
    date_fds: isoDate(initial?.date_fds),
    date_revision: isoDate(initial?.date_revision),
    reference: initial?.reference || '', dangers: initial?.dangers || '', epi_requis: initial?.epi_requis || '',
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const set = (k, v) => setForm((s) => ({ ...s, [k]: v }));

  const save = async () => {
    if (!form.produit.trim()) { setError('Le nom du produit est obligatoire.'); return; }
    setSaving(true); setError(null);
    const payload = {
      produit: form.produit.trim(),
      fournisseur_id: form.fournisseur_id === '' ? null : parseInt(form.fournisseur_id, 10),
      reference: form.reference.trim() || null,
      date_fds: form.date_fds || null,
      date_revision: form.date_revision || null,
      dangers: form.dangers.trim() || null,
      epi_requis: form.epi_requis.trim() || null,
    };
    try {
      if (initial?.id) await api.put(`/achats/fds/${initial.id}`, payload);
      else await api.post('/achats/fds', payload);
      onSaved();
    } catch (err) {
      setError(apiErr(err, "Impossible d'enregistrer la FDS."));
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={initial?.id ? 'Modifier la FDS' : 'Nouvelle fiche de données de sécurité'}
      size="lg"
      footer={
        <>
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-sm text-slate-500 hover:text-slate-700">Annuler</button>
          <button type="button" onClick={save} disabled={saving} className="btn-primary text-sm px-4 py-1.5 disabled:opacity-50">
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <div role="alert" className="text-sm bg-red-50 border border-red-200 text-red-700 rounded-lg p-2.5">{error}</div>}
        {!initial?.id && <p className="text-[11px] text-slate-400">La pièce jointe (PDF de la FDS) se joint après enregistrement, depuis le registre.</p>}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="fd-produit">Produit <span className="text-red-500">*</span></label>
            <input id="fd-produit" value={form.produit} onChange={(e) => set('produit', e.target.value)}
              className="input-modern w-full text-sm" placeholder="Ex. Dégraissant industriel" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="fd-fournisseur">Fournisseur</label>
            <select id="fd-fournisseur" value={form.fournisseur_id} onChange={(e) => set('fournisseur_id', e.target.value)} className="input-modern w-full text-sm">
              <option value="">— Aucun —</option>
              {fournisseurs.map((fo) => <option key={fo.id} value={fo.id}>{fo.nom}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="fd-reference">Référence</label>
          <input id="fd-reference" value={form.reference} onChange={(e) => set('reference', e.target.value)}
            className="input-modern w-full text-sm" placeholder="Référence produit / n° de FDS" />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="fd-date">Date de la FDS</label>
            <input id="fd-date" type="date" value={form.date_fds} onChange={(e) => set('date_fds', e.target.value)} className="input-modern w-full text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="fd-revision">Date de révision</label>
            <input id="fd-revision" type="date" value={form.date_revision} onChange={(e) => set('date_revision', e.target.value)} className="input-modern w-full text-sm" />
            <p className="text-[11px] text-slate-400 mt-1">Sert de référence de fraîcheur (à défaut, la date de FDS).</p>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="fd-dangers">Dangers</label>
          <textarea id="fd-dangers" value={form.dangers} onChange={(e) => set('dangers', e.target.value)} rows={2}
            className="input-modern w-full text-sm" placeholder="Mentions de danger (H…), pictogrammes CLP…" />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="fd-epi">EPI requis</label>
          <textarea id="fd-epi" value={form.epi_requis} onChange={(e) => set('epi_requis', e.target.value)} rows={2}
            className="input-modern w-full text-sm" placeholder="Gants nitrile, lunettes, ventilation…" />
        </div>
      </div>
    </Modal>
  );
}

// Cellule fichier : téléchargement + upload (multipart), par ligne (pattern RegistrePreuves).
function FichierCell({ fds, canWrite, onChanged, onError }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);

  const download = async () => {
    try {
      const res = await api.get(`/achats/fds/${fds.id}/fichier`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = fds.fichier_original_name || `fds-${fds.id}`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (err) { onError(apiErr(err, 'Téléchargement impossible.')); }
  };

  const upload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > UPLOAD_MAX) { onError('Fichier trop volumineux (max 15 Mo).'); return; }
    setBusy(true); onError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      await api.post(`/achats/fds/${fds.id}/fichier`, fd);
      onChanged();
    } catch (err) { onError(apiErr(err, "Échec de l'envoi du fichier.")); }
    setBusy(false);
  };

  return (
    <div className="flex items-center gap-2">
      {fds.has_fichier ? (
        <button onClick={download} className="inline-flex items-center gap-1 text-xs text-emerald-700 hover:underline" title={fds.fichier_original_name || 'Télécharger'}>
          <Download className="w-3.5 h-3.5" /> Fiche
        </button>
      ) : (
        <span className="text-xs text-slate-300">—</span>
      )}
      {canWrite && (
        <>
          <button onClick={() => inputRef.current?.click()} disabled={busy}
            className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-emerald-600 disabled:opacity-50"
            title={fds.has_fichier ? 'Remplacer la fiche' : 'Joindre la fiche'}>
            <Paperclip className="w-3.5 h-3.5" /> {busy ? '…' : (fds.has_fichier ? 'Remplacer' : 'Joindre')}
          </button>
          <input ref={inputRef} type="file" accept={UPLOAD_ACCEPT} onChange={upload} className="hidden" />
        </>
      )}
    </div>
  );
}

// Badges de statut d'une FDS (miroir de l'oracle aggregateFds).
function StatutFdsBadges({ fds }) {
  const st = fdsStatus(fds);
  if (!st.aTraiter) {
    return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium">à jour</span>;
  }
  return (
    <span className="inline-flex flex-wrap gap-1">
      {st.sansFichier && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">fiche manquante</span>}
      {st.perimee && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 font-semibold">périmée</span>}
      {st.sansDate && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 font-medium">sans date</span>}
    </span>
  );
}

export default function RegistreFDS({ canWrite }) {
  const [rows, setRows] = useState([]);
  const [fournisseurs, setFournisseurs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filterFournisseur, setFilterFournisseur] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);

  const load = useCallback(() => {
    let alive = true;
    setLoading(true);
    const p = new URLSearchParams();
    if (filterFournisseur) p.append('fournisseur_id', filterFournisseur);
    api.get(`/achats/fds?${p}`)
      .then((r) => { if (alive) { setRows(Array.isArray(r.data) ? r.data : []); setError(null); } })
      .catch((err) => { if (alive) setError(apiErr(err)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [filterFournisseur]);

  useEffect(() => load(), [load]);

  // Liste des fournisseurs pour le formulaire + le filtre (indépendante du filtre courant).
  useEffect(() => {
    let alive = true;
    api.get('/achats/fournisseurs')
      .then((r) => { if (alive) setFournisseurs(Array.isArray(r.data) ? r.data : []); })
      .catch(() => { if (alive) setFournisseurs([]); });
    return () => { alive = false; };
  }, []);

  const remove = async (d) => {
    try {
      await api.delete(`/achats/fds/${d.id}`);
      setConfirmDel(null);
      load();
    } catch (err) { setError(apiErr(err)); setConfirmDel(null); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-lg font-semibold text-slate-800">Registre des fiches de données de sécurité</h2>
        {canWrite && (
          <button onClick={() => { setEditing(null); setFormOpen(true); }} className="btn-primary text-sm inline-flex items-center gap-1.5">
            <Plus className="w-4 h-4" /> Nouvelle FDS
          </button>
        )}
      </div>
      <p className="text-xs text-slate-400">Produits dangereux et leurs fiches de sécurité. Une fiche manquante ou périmée est signalée pour traitement.</p>

      {/* Filtre */}
      <div className="bg-white rounded-lg border p-3 flex items-center gap-3 flex-wrap">
        <Filter className="w-4 h-4 text-slate-400" aria-hidden="true" />
        <select value={filterFournisseur} onChange={(e) => setFilterFournisseur(e.target.value)} className="input-modern py-1.5 text-sm w-auto">
          <option value="">Tous fournisseurs</option>
          {fournisseurs.map((fo) => <option key={fo.id} value={fo.id}>{fo.nom}</option>)}
        </select>
        {filterFournisseur && <button onClick={() => setFilterFournisseur('')} className="text-xs text-emerald-700 underline">Réinitialiser</button>}
        <span className="ml-auto text-xs text-slate-400">{rows.length} FDS</span>
      </div>

      {error && (
        <div role="alert" className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm flex items-start gap-2">
          <span aria-hidden="true">⚠</span><span>{error}</span>
          <button onClick={() => setError(null)} className="ml-auto text-red-500" aria-label="Fermer">×</button>
        </div>
      )}

      {loading ? (
        <LoadingSpinner size="lg" message="Chargement du registre FDS…" />
      ) : rows.length === 0 ? (
        <div className="bg-white rounded-lg border p-8 text-center text-slate-400">
          <p className="text-sm">{filterFournisseur ? 'Aucune FDS pour ce fournisseur.' : 'Le registre des FDS est vide.'}</p>
          {canWrite && !filterFournisseur && <p className="text-xs mt-1">Déclarez chaque produit dangereux et joignez sa fiche de données de sécurité (PDF).</p>}
        </div>
      ) : (
        <div className="bg-white rounded-lg border overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500 border-b bg-slate-50">
                <th className="px-3 py-2 font-medium">Produit</th>
                <th className="px-3 py-2 font-medium">Fournisseur</th>
                <th className="px-3 py-2 font-medium">Dangers</th>
                <th className="px-3 py-2 font-medium">FDS / Révision</th>
                <th className="px-3 py-2 font-medium">Statut</th>
                <th className="px-3 py-2 font-medium">Pièce</th>
                {canWrite && <th className="px-3 py-2 font-medium text-right">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.id} className="border-b border-slate-100 hover:bg-slate-50 align-top">
                  <td className="px-3 py-2 min-w-[160px]">
                    <span className="font-medium text-slate-700">{d.produit}</span>
                    {d.reference && <div className="text-[11px] text-slate-400">Réf. {d.reference}</div>}
                    {d.epi_requis && <div className="text-[11px] text-slate-400 mt-0.5">EPI : {d.epi_requis}</div>}
                  </td>
                  <td className="px-3 py-2 text-slate-600">{d.fournisseur_nom || <span className="text-slate-300">—</span>}</td>
                  <td className="px-3 py-2 text-slate-600 min-w-[140px]">{d.dangers || <span className="text-slate-300">—</span>}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-xs text-slate-500">
                    <div>FDS : {d.date_fds ? frDate(d.date_fds) : '—'}</div>
                    <div>Rév. : {d.date_revision ? frDate(d.date_revision) : '—'}</div>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap"><StatutFdsBadges fds={d} /></td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <FichierCell fds={d} canWrite={canWrite} onChanged={load} onError={setError} />
                  </td>
                  {canWrite && (
                    <td className="px-3 py-2 whitespace-nowrap text-right">
                      <button onClick={() => { setEditing(d); setFormOpen(true); }} className="text-slate-400 hover:text-emerald-600 p-1" title="Modifier" aria-label="Modifier">
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button onClick={() => setConfirmDel(d)} className="text-slate-400 hover:text-red-600 p-1" title="Supprimer" aria-label="Supprimer">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {formOpen && (
        <FdsForm
          initial={editing}
          fournisseurs={fournisseurs}
          onClose={() => setFormOpen(false)}
          onSaved={() => { setFormOpen(false); load(); }}
        />
      )}

      <ConfirmDialog
        isOpen={!!confirmDel}
        title="Supprimer la FDS ?"
        message={confirmDel ? `La FDS du produit « ${confirmDel.produit} » et sa pièce jointe éventuelle seront supprimées.` : ''}
        confirmLabel="Supprimer"
        confirmVariant="danger"
        onConfirm={() => remove(confirmDel)}
        onCancel={() => setConfirmDel(null)}
      />
    </div>
  );
}
