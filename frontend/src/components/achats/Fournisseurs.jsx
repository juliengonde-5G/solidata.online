import { useState, useEffect, useCallback } from 'react';
import { Plus, Pencil, Trash2, Filter, CheckCircle2 } from 'lucide-react';
import { Modal, LoadingSpinner, ConfirmDialog } from '../../components';
import api from '../../services/api';
import {
  CATEGORIES, categorieLabel, STATUT_FLAGS, StatutBadges, isResponsable, apiErr,
} from './achatsShared';

const EMPTY = {
  nom: '', siret: '', categorie: 'autre', local: false, inclusif: false,
  demarche_rse: false, labellise: false, label_detail: '', commune: '', actif: true, notes: '',
};

function FournisseurForm({ initial, onClose, onSaved }) {
  const [form, setForm] = useState(() => ({ ...EMPTY, ...initial }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const set = (k, v) => setForm((s) => ({ ...s, [k]: v }));

  const save = async () => {
    if (!form.nom.trim()) { setError('Le nom du fournisseur est obligatoire.'); return; }
    setSaving(true); setError(null);
    const payload = {
      nom: form.nom.trim(),
      siret: form.siret.trim() || null,
      categorie: form.categorie,
      local: !!form.local,
      inclusif: !!form.inclusif,
      demarche_rse: !!form.demarche_rse,
      labellise: !!form.labellise,
      label_detail: form.label_detail.trim() || null,
      commune: form.commune.trim() || null,
      actif: !!form.actif,
      notes: form.notes.trim() || null,
    };
    try {
      if (initial?.id) await api.put(`/achats/fournisseurs/${initial.id}`, payload);
      else await api.post('/achats/fournisseurs', payload);
      onSaved();
    } catch (err) {
      setError(apiErr(err, "Impossible d'enregistrer le fournisseur."));
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={initial?.id ? 'Modifier le fournisseur' : 'Nouveau fournisseur'}
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

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="fo-nom">Nom <span className="text-red-500">*</span></label>
            <input id="fo-nom" value={form.nom} onChange={(e) => set('nom', e.target.value)}
              className="input-modern w-full text-sm" placeholder="Raison sociale du fournisseur" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="fo-categorie">Famille d'achat</label>
            <select id="fo-categorie" value={form.categorie} onChange={(e) => set('categorie', e.target.value)} className="input-modern w-full text-sm">
              {CATEGORIES.map((c) => <option key={c} value={c}>{categorieLabel(c)}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="fo-siret">SIRET</label>
            <input id="fo-siret" value={form.siret} onChange={(e) => set('siret', e.target.value)}
              className="input-modern w-full text-sm" placeholder="14 chiffres" maxLength={20} />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="fo-commune">Commune</label>
            <input id="fo-commune" value={form.commune} onChange={(e) => set('commune', e.target.value)}
              className="input-modern w-full text-sm" placeholder="Ex. Rouen" />
          </div>
        </div>

        <fieldset className="border border-slate-200 rounded-lg p-3">
          <legend className="text-xs font-semibold text-slate-500 px-1">Statut « responsable »</legend>
          <div className="grid grid-cols-2 gap-2">
            {STATUT_FLAGS.map((s) => (
              <label key={s.key} className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer select-none">
                <input type="checkbox" checked={!!form[s.key]} onChange={(e) => set(s.key, e.target.checked)} className="rounded border-slate-300" />
                {s.label}
              </label>
            ))}
          </div>
          <div className="mt-2 text-xs">
            {isResponsable(form)
              ? <span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle2 className="w-3.5 h-3.5" /> Fournisseur responsable (au moins un statut coché)</span>
              : <span className="text-slate-400">Fournisseur standard — aucun statut coché.</span>}
          </div>
        </fieldset>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="fo-label">Détail du label / de la démarche</label>
          <input id="fo-label" value={form.label_detail} onChange={(e) => set('label_detail', e.target.value)}
            className="input-modern w-full text-sm" placeholder="Ex. ESUS, Ecovadis, label local, ISO 26000…" />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="fo-notes">Notes</label>
          <textarea id="fo-notes" value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={2}
            className="input-modern w-full text-sm" placeholder="Commentaire libre" />
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer select-none">
          <input type="checkbox" checked={!!form.actif} onChange={(e) => set('actif', e.target.checked)} className="rounded border-slate-300" />
          Fournisseur actif
        </label>
      </div>
    </Modal>
  );
}

export default function Fournisseurs({ canWrite }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState({ famille: '', responsable: false, actif: '' });
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);

  const load = useCallback(() => {
    let alive = true;
    setLoading(true);
    const p = new URLSearchParams();
    if (filters.famille) p.append('famille', filters.famille);
    if (filters.responsable) p.append('responsable', '1');
    if (filters.actif === 'actif') p.append('actif', '1');
    if (filters.actif === 'inactif') p.append('actif', '0');
    api.get(`/achats/fournisseurs?${p}`)
      .then((r) => { if (alive) { setRows(Array.isArray(r.data) ? r.data : []); setError(null); } })
      .catch((err) => { if (alive) setError(apiErr(err)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [filters]);

  useEffect(() => load(), [load]);

  const remove = async (fo) => {
    try {
      await api.delete(`/achats/fournisseurs/${fo.id}`);
      setConfirmDel(null);
      load();
    } catch (err) { setError(apiErr(err)); setConfirmDel(null); }
  };

  const hasFilters = filters.famille || filters.responsable || filters.actif;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-lg font-semibold text-slate-800">Référentiel fournisseurs</h2>
        {canWrite && (
          <button onClick={() => { setEditing(null); setFormOpen(true); }} className="btn-primary text-sm inline-flex items-center gap-1.5">
            <Plus className="w-4 h-4" /> Nouveau fournisseur
          </button>
        )}
      </div>

      {/* Filtres */}
      <div className="bg-white rounded-lg border p-3 flex items-center gap-3 flex-wrap">
        <Filter className="w-4 h-4 text-slate-400" aria-hidden="true" />
        <select value={filters.famille} onChange={(e) => setFilters((f) => ({ ...f, famille: e.target.value }))} className="input-modern py-1.5 text-sm w-auto">
          <option value="">Toutes familles</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{categorieLabel(c)}</option>)}
        </select>
        <select value={filters.actif} onChange={(e) => setFilters((f) => ({ ...f, actif: e.target.value }))} className="input-modern py-1.5 text-sm w-auto">
          <option value="">Actifs et inactifs</option>
          <option value="actif">Actifs</option>
          <option value="inactif">Inactifs</option>
        </select>
        <label className="flex items-center gap-1.5 text-sm text-slate-600 cursor-pointer select-none">
          <input type="checkbox" checked={filters.responsable} onChange={(e) => setFilters((f) => ({ ...f, responsable: e.target.checked }))} className="rounded border-slate-300" />
          Responsables uniquement
        </label>
        {hasFilters && (
          <button onClick={() => setFilters({ famille: '', responsable: false, actif: '' })} className="text-xs text-emerald-700 underline">Réinitialiser</button>
        )}
        <span className="ml-auto text-xs text-slate-400">{rows.length} fournisseur{rows.length > 1 ? 's' : ''}</span>
      </div>

      {error && (
        <div role="alert" className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm flex items-start gap-2">
          <span aria-hidden="true">⚠</span><span>{error}</span>
          <button onClick={() => setError(null)} className="ml-auto text-red-500" aria-label="Fermer">×</button>
        </div>
      )}

      {loading ? (
        <LoadingSpinner size="lg" message="Chargement des fournisseurs…" />
      ) : rows.length === 0 ? (
        <div className="bg-white rounded-lg border p-8 text-center text-slate-400">
          <p className="text-sm">{hasFilters ? 'Aucun fournisseur ne correspond à ces filtres.' : 'Le référentiel fournisseurs est vide.'}</p>
          {canWrite && !hasFilters && <p className="text-xs mt-1">Ajoutez vos fournisseurs et cochez leurs statuts responsables (local, inclusif, démarche RSE, labellisé).</p>}
        </div>
      ) : (
        <div className="bg-white rounded-lg border overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500 border-b bg-slate-50">
                <th className="px-3 py-2 font-medium">Fournisseur</th>
                <th className="px-3 py-2 font-medium">Famille</th>
                <th className="px-3 py-2 font-medium">Statuts</th>
                <th className="px-3 py-2 font-medium">Responsable</th>
                <th className="px-3 py-2 font-medium">Actif</th>
                {canWrite && <th className="px-3 py-2 font-medium text-right">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((fo) => (
                <tr key={fo.id} className={`border-b border-slate-100 ${fo.actif ? 'hover:bg-slate-50' : 'bg-slate-50/50 text-slate-400'}`}>
                  <td className="px-3 py-2 min-w-[180px]">
                    <span className="font-medium text-slate-700">{fo.nom}</span>
                    <div className="text-[11px] text-slate-400">
                      {fo.commune ? fo.commune : null}
                      {fo.commune && fo.siret ? ' · ' : null}
                      {fo.siret ? `SIRET ${fo.siret}` : null}
                    </div>
                    {fo.label_detail && <div className="text-[11px] text-slate-400 mt-0.5">{fo.label_detail}</div>}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-slate-600">{categorieLabel(fo.categorie)}</td>
                  <td className="px-3 py-2"><StatutBadges fournisseur={fo} /></td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {fo.responsable
                      ? <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-semibold">Responsable</span>
                      : <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500">Standard</span>}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {fo.actif
                      ? <span className="text-xs text-emerald-600">Actif</span>
                      : <span className="text-xs text-slate-400">Inactif</span>}
                  </td>
                  {canWrite && (
                    <td className="px-3 py-2 whitespace-nowrap text-right">
                      <button onClick={() => { setEditing(fo); setFormOpen(true); }} className="text-slate-400 hover:text-emerald-600 p-1" title="Modifier" aria-label="Modifier">
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button onClick={() => setConfirmDel(fo)} className="text-slate-400 hover:text-red-600 p-1" title="Supprimer" aria-label="Supprimer">
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
        <FournisseurForm
          initial={editing}
          onClose={() => setFormOpen(false)}
          onSaved={() => { setFormOpen(false); load(); }}
        />
      )}

      <ConfirmDialog
        isOpen={!!confirmDel}
        title="Supprimer le fournisseur ?"
        message={confirmDel ? `« ${confirmDel.nom} » sera supprimé du référentiel. Les FDS liées seront conservées (fournisseur détaché).` : ''}
        confirmLabel="Supprimer"
        confirmVariant="danger"
        onConfirm={() => remove(confirmDel)}
        onCancel={() => setConfirmDel(null)}
      />
    </div>
  );
}
