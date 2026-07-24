import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Pencil, Trash2, Paperclip, Download, Link2, ExternalLink, Filter } from 'lucide-react';
import { Modal, LoadingSpinner, ConfirmDialog } from '../../components';
import api from '../../services/api';
import {
  CriteresMultiSelect, CritereChips, frDate, isoDate, apiErr, UPLOAD_ACCEPT, UPLOAD_MAX,
} from './rseShared';

const PREUVE_TYPES = ['export', 'charte', 'compte-rendu', 'PV', 'note', 'enquête', 'rapport', 'émargement', 'attestation', 'convention', 'lettre', 'plan', 'autre'];
const EMPTY = { intitule: '', critere_codes: [], type: '', source: '', lien_interne: '', date_preuve: '', echeance_fraicheur: '' };

function PreuveForm({ initial, criteres, onClose, onSaved }) {
  const [form, setForm] = useState(() => ({
    ...EMPTY, ...initial,
    critere_codes: initial?.critere_codes || [],
    date_preuve: isoDate(initial?.date_preuve),
    echeance_fraicheur: isoDate(initial?.echeance_fraicheur),
    type: initial?.type || '', source: initial?.source || '', lien_interne: initial?.lien_interne || '',
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.intitule.trim()) { setError("L'intitulé est obligatoire."); return; }
    setSaving(true); setError(null);
    const payload = {
      intitule: form.intitule.trim(),
      critere_codes: form.critere_codes,
      type: form.type.trim() || null,
      source: form.source.trim() || null,
      lien_interne: form.lien_interne.trim() || null,
      date_preuve: form.date_preuve || null,
      echeance_fraicheur: form.echeance_fraicheur || null,
    };
    try {
      if (initial?.id) await api.put(`/rse/preuves/${initial.id}`, payload);
      else await api.post('/rse/preuves', payload);
      onSaved();
    } catch (err) {
      setError(apiErr(err, "Impossible d'enregistrer la preuve."));
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={initial?.id ? `Modifier la preuve ${initial.reference}` : 'Nouvelle preuve'}
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
        {!initial?.id && <p className="text-[11px] text-slate-400">La référence <strong>P-AAAA-NNN</strong> est générée automatiquement à l'enregistrement.</p>}

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="pr-intitule">Intitulé <span className="text-red-500">*</span></label>
          <input id="pr-intitule" value={form.intitule} onChange={(e) => set('intitule', e.target.value)}
            className="input-modern w-full text-sm" placeholder="Ex. Lettre de mission du référent RSE (signée)" />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Critères concernés</label>
          <CriteresMultiSelect value={form.critere_codes} onChange={(v) => set('critere_codes', v)} criteres={criteres} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="pr-type">Type</label>
            <input id="pr-type" list="pr-type-list" value={form.type} onChange={(e) => set('type', e.target.value)}
              className="input-modern w-full text-sm" placeholder="export, charte, PV…" />
            <datalist id="pr-type-list">{PREUVE_TYPES.map((t) => <option key={t} value={t} />)}</datalist>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="pr-source">Source</label>
            <input id="pr-source" value={form.source} onChange={(e) => set('source', e.target.value)}
              className="input-modern w-full text-sm" placeholder="Ex. SOLIDATA > Audit Insertion, registre, externe…" />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="pr-lien">Lien interne (deep-link ERP)</label>
          <input id="pr-lien" value={form.lien_interne} onChange={(e) => set('lien_interne', e.target.value)}
            className="input-modern w-full text-sm" placeholder="Ex. /insertion/audit ou /admin/refashion-exports" />
          <p className="text-[11px] text-slate-400 mt-1">Référencer plutôt que dupliquer : pointer l'écran/export ERP à re-générer en séance.</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="pr-date">Date de la preuve</label>
            <input id="pr-date" type="date" value={form.date_preuve} onChange={(e) => set('date_preuve', e.target.value)}
              className="input-modern w-full text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="pr-fraich">Échéance de fraîcheur</label>
            <input id="pr-fraich" type="date" value={form.echeance_fraicheur} onChange={(e) => set('echeance_fraicheur', e.target.value)}
              className="input-modern w-full text-sm" />
            <p className="text-[11px] text-slate-400 mt-1">Date à laquelle la preuve cessera d'être « fraîche » (&lt; 12 mois pour une preuve d'activité).</p>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// Cellule fichier : téléchargement + upload (multipart), par ligne.
function FichierCell({ preuve, canWrite, onChanged, onError }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);

  const download = async () => {
    try {
      const res = await api.get(`/rse/preuves/${preuve.id}/fichier`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = preuve.fichier_original_name || `preuve-${preuve.reference}`;
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
      await api.post(`/rse/preuves/${preuve.id}/fichier`, fd);
      onChanged();
    } catch (err) { onError(apiErr(err, "Échec de l'envoi du fichier.")); }
    setBusy(false);
  };

  return (
    <div className="flex items-center gap-2">
      {preuve.has_fichier ? (
        <button onClick={download} className="inline-flex items-center gap-1 text-xs text-emerald-700 hover:underline" title={preuve.fichier_original_name || 'Télécharger'}>
          <Download className="w-3.5 h-3.5" /> Pièce jointe
        </button>
      ) : (
        <span className="text-xs text-slate-300">—</span>
      )}
      {canWrite && (
        <>
          <button onClick={() => inputRef.current?.click()} disabled={busy}
            className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-emerald-600 disabled:opacity-50"
            title={preuve.has_fichier ? 'Remplacer la pièce jointe' : 'Joindre une pièce'}>
            <Paperclip className="w-3.5 h-3.5" /> {busy ? '…' : (preuve.has_fichier ? 'Remplacer' : 'Joindre')}
          </button>
          <input ref={inputRef} type="file" accept={UPLOAD_ACCEPT} onChange={upload} className="hidden" />
        </>
      )}
    </div>
  );
}

export default function RegistrePreuves({ criteres, canWrite }) {
  const [preuves, setPreuves] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState({ critere: '', perimees: false });
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);

  const load = useCallback(() => {
    let alive = true;
    setLoading(true);
    const p = new URLSearchParams();
    if (filters.critere) p.append('critere', filters.critere);
    if (filters.perimees) p.append('perimees', '1');
    api.get(`/rse/preuves?${p}`)
      .then((r) => { if (alive) { setPreuves(Array.isArray(r.data) ? r.data : []); setError(null); } })
      .catch((err) => { if (alive) setError(apiErr(err)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [filters]);

  useEffect(() => load(), [load]);

  const remove = async (p) => {
    try {
      await api.delete(`/rse/preuves/${p.id}`);
      setConfirmDel(null);
      load();
    } catch (err) { setError(apiErr(err)); setConfirmDel(null); }
  };

  const renderLien = (lien) => {
    if (!lien) return null;
    const ext = /^https?:\/\//i.test(lien);
    if (ext) {
      return <a href={lien} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-emerald-700 hover:underline"><ExternalLink className="w-3 h-3" />lien</a>;
    }
    return <Link to={lien} className="inline-flex items-center gap-0.5 text-emerald-700 hover:underline"><Link2 className="w-3 h-3" />{lien}</Link>;
  };

  const hasFilters = filters.critere || filters.perimees;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-lg font-semibold text-slate-800">Registre de preuves</h2>
        {canWrite && (
          <button onClick={() => { setEditing(null); setFormOpen(true); }} className="btn-primary text-sm inline-flex items-center gap-1.5">
            <Plus className="w-4 h-4" /> Nouvelle preuve
          </button>
        )}
      </div>

      {/* Filtres */}
      <div className="bg-white rounded-lg border p-3 flex items-center gap-3 flex-wrap">
        <Filter className="w-4 h-4 text-slate-400" aria-hidden="true" />
        <select value={filters.critere} onChange={(e) => setFilters((f) => ({ ...f, critere: e.target.value }))} className="input-modern py-1.5 text-sm w-auto">
          <option value="">Tous critères</option>
          {criteres.map((c) => <option key={c.code} value={c.code}>{c.code} — {c.intitule}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-sm text-slate-600 cursor-pointer select-none">
          <input type="checkbox" checked={filters.perimees} onChange={(e) => setFilters((f) => ({ ...f, perimees: e.target.checked }))} className="rounded border-slate-300" />
          Preuves périmées uniquement
        </label>
        {hasFilters && (
          <button onClick={() => setFilters({ critere: '', perimees: false })} className="text-xs text-emerald-700 underline">Réinitialiser</button>
        )}
        <span className="ml-auto text-xs text-slate-400">{preuves.length} preuve{preuves.length > 1 ? 's' : ''}</span>
      </div>

      {error && (
        <div role="alert" className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm flex items-start gap-2">
          <span aria-hidden="true">⚠</span><span>{error}</span>
          <button onClick={() => setError(null)} className="ml-auto text-red-500" aria-label="Fermer">×</button>
        </div>
      )}

      {loading ? (
        <LoadingSpinner size="lg" message="Chargement du registre…" />
      ) : preuves.length === 0 ? (
        <div className="bg-white rounded-lg border p-8 text-center text-slate-400">
          <p className="text-sm">{hasFilters ? 'Aucune preuve ne correspond à ces filtres.' : 'Le registre est vide.'}</p>
          {canWrite && !hasFilters && <p className="text-xs mt-1">Classez chaque preuve produite sous 5 jours ouvrés (règle du référent).</p>}
        </div>
      ) : (
        <div className="bg-white rounded-lg border overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500 border-b bg-slate-50">
                <th className="px-3 py-2 font-medium">Référence</th>
                <th className="px-3 py-2 font-medium">Intitulé</th>
                <th className="px-3 py-2 font-medium">Critères</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Date</th>
                <th className="px-3 py-2 font-medium">Fraîcheur</th>
                <th className="px-3 py-2 font-medium">Pièce</th>
                {canWrite && <th className="px-3 py-2 font-medium text-right">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {preuves.map((p) => (
                <tr key={p.id} className={`border-b border-slate-100 ${p.perimee ? 'bg-red-50/40' : 'hover:bg-slate-50'}`}>
                  <td className="px-3 py-2 whitespace-nowrap font-mono text-xs text-slate-500">{p.reference}</td>
                  <td className="px-3 py-2 min-w-[200px]">
                    <span className="text-slate-700">{p.intitule}</span>
                    {p.source && <p className="text-[11px] text-slate-400 mt-0.5">Source : {p.source}</p>}
                    {p.lien_interne && <p className="text-[11px] mt-0.5">{renderLien(p.lien_interne)}</p>}
                  </td>
                  <td className="px-3 py-2"><CritereChips codes={p.critere_codes} /></td>
                  <td className="px-3 py-2 whitespace-nowrap text-xs text-slate-500">{p.type || '—'}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-xs text-slate-500">{p.date_preuve ? frDate(p.date_preuve) : '—'}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {p.echeance_fraicheur ? (
                      p.perimee
                        ? <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 font-semibold">périmée</span>
                        : <span className="text-xs text-slate-500">jusqu'au {frDate(p.echeance_fraicheur)}</span>
                    ) : <span className="text-slate-300 text-xs">—</span>}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <FichierCell preuve={p} canWrite={canWrite} onChanged={load} onError={setError} />
                  </td>
                  {canWrite && (
                    <td className="px-3 py-2 whitespace-nowrap text-right">
                      <button onClick={() => { setEditing(p); setFormOpen(true); }} className="text-slate-400 hover:text-emerald-600 p-1" title="Modifier" aria-label="Modifier">
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button onClick={() => setConfirmDel(p)} className="text-slate-400 hover:text-red-600 p-1" title="Supprimer" aria-label="Supprimer">
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
        <PreuveForm
          initial={editing}
          criteres={criteres}
          onClose={() => setFormOpen(false)}
          onSaved={() => { setFormOpen(false); load(); }}
        />
      )}

      <ConfirmDialog
        isOpen={!!confirmDel}
        title="Supprimer la preuve ?"
        message={confirmDel ? `La preuve ${confirmDel.reference} et sa pièce jointe éventuelle seront supprimées.` : ''}
        confirmLabel="Supprimer"
        confirmVariant="danger"
        onConfirm={() => remove(confirmDel)}
        onCancel={() => setConfirmDel(null)}
      />
    </div>
  );
}
