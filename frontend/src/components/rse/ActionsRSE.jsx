import { useState, useEffect, useCallback } from 'react';
import { Plus, Pencil, Trash2, Download, Filter } from 'lucide-react';
import { Modal, LoadingSpinner, ConfirmDialog } from '../../components';
import api from '../../services/api';
import {
  ACTION_STATUT_LABELS, ACTION_STATUT_STYLES, PRIORITE_LABELS, PRIORITE_STYLES,
  CriteresMultiSelect, CritereChips, UserSelect, frDate, isoDate, apiErr,
} from './rseShared';

const EMPTY = {
  titre: '', description: '', critere_codes: [], responsable_user_id: null,
  indicateur: '', echeance: '', moyens: '', statut: 'a_faire', priorite: 'moyenne',
};

function ActionForm({ initial, criteres, users, restricted, onClose, onSaved }) {
  const [form, setForm] = useState(() => ({
    ...EMPTY,
    ...initial,
    critere_codes: initial?.critere_codes || [],
    echeance: isoDate(initial?.echeance),
    responsable_user_id: initial?.responsable_user_id ?? null,
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.titre.trim()) { setError('Le titre est obligatoire.'); return; }
    setSaving(true); setError(null);
    const payload = {
      titre: form.titre.trim(),
      description: form.description.trim() || null,
      critere_codes: form.critere_codes,
      responsable_user_id: form.responsable_user_id,
      indicateur: form.indicateur.trim() || null,
      echeance: form.echeance || null,
      moyens: form.moyens.trim() || null,
      statut: form.statut,
      priorite: form.priorite,
    };
    try {
      if (initial?.id) await api.put(`/rse/actions/${initial.id}`, payload);
      else await api.post('/rse/actions', payload);
      onSaved();
    } catch (err) {
      setError(apiErr(err, "Impossible d'enregistrer l'action."));
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={initial?.id ? "Modifier l'action" : 'Nouvelle action RSE'}
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

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="act-titre">Titre <span className="text-red-500">*</span></label>
          <input id="act-titre" value={form.titre} onChange={(e) => set('titre', e.target.value)}
            className="input-modern w-full text-sm" placeholder="Ex. Formaliser la charte égalité-diversité" />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="act-desc">Description</label>
          <textarea id="act-desc" value={form.description} onChange={(e) => set('description', e.target.value)}
            rows={2} className="input-modern w-full text-sm" />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">Critères servis</label>
          <CriteresMultiSelect value={form.critere_codes} onChange={(v) => set('critere_codes', v)} criteres={criteres} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="act-resp">Responsable</label>
            <UserSelect id="act-resp" value={form.responsable_user_id} onChange={(v) => set('responsable_user_id', v)}
              users={users} currentName={initial?.responsable_nom} placeholder="Non attribué" />
            {restricted && <p className="text-[11px] text-amber-600 mt-1">Liste d'utilisateurs restreinte (réservée à l'administrateur).</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="act-ech">Échéance</label>
            <input id="act-ech" type="date" value={form.echeance} onChange={(e) => set('echeance', e.target.value)}
              className="input-modern w-full text-sm" />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="act-ind">Indicateur de suivi</label>
          <input id="act-ind" value={form.indicateur} onChange={(e) => set('indicateur', e.target.value)}
            className="input-modern w-full text-sm" placeholder="Ex. Charte signée et diffusée" />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="act-moy">Moyens</label>
          <input id="act-moy" value={form.moyens} onChange={(e) => set('moyens', e.target.value)}
            className="input-modern w-full text-sm" placeholder="Budget, temps, appui externe…" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="act-statut">Statut</label>
            <select id="act-statut" value={form.statut} onChange={(e) => set('statut', e.target.value)} className="input-modern w-full text-sm">
              {Object.entries(ACTION_STATUT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1" htmlFor="act-prio">Priorité</label>
            <select id="act-prio" value={form.priorite} onChange={(e) => set('priorite', e.target.value)} className="input-modern w-full text-sm">
              {Object.entries(PRIORITE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
        </div>
      </div>
    </Modal>
  );
}

export default function ActionsRSE({ criteres, users, restricted, canWrite }) {
  const [actions, setActions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState({ statut: '', critere: '', responsable_user_id: '' });
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [confirmDel, setConfirmDel] = useState(null);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(() => {
    let alive = true;
    setLoading(true);
    const p = new URLSearchParams();
    if (filters.statut) p.append('statut', filters.statut);
    if (filters.critere) p.append('critere', filters.critere);
    if (filters.responsable_user_id) p.append('responsable_user_id', filters.responsable_user_id);
    api.get(`/rse/actions?${p}`)
      .then((r) => { if (alive) { setActions(Array.isArray(r.data) ? r.data : []); setError(null); } })
      .catch((err) => { if (alive) setError(apiErr(err)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [filters]);

  useEffect(() => load(), [load]);

  const quickStatus = async (a, statut) => {
    try {
      await api.put(`/rse/actions/${a.id}`, { statut });
      setActions((list) => list.map((x) => (x.id === a.id ? { ...x, statut } : x)));
    } catch (err) { setError(apiErr(err)); }
  };

  const remove = async (a) => {
    try {
      await api.delete(`/rse/actions/${a.id}`);
      setConfirmDel(null);
      load();
    } catch (err) { setError(apiErr(err)); setConfirmDel(null); }
  };

  const exportCsv = async () => {
    setExporting(true); setError(null);
    try {
      const res = await api.get('/rse/actions/export?format=csv', { responseType: 'blob' });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `plan_action_rse_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (err) { setError(apiErr(err, "Échec de l'export CSV.")); }
    setExporting(false);
  };

  const hasFilters = filters.statut || filters.critere || filters.responsable_user_id;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-lg font-semibold text-slate-800">Plan d'action RSE</h2>
        <div className="flex items-center gap-2">
          <button onClick={exportCsv} disabled={exporting} className="btn-ghost text-sm inline-flex items-center gap-1.5 disabled:opacity-50">
            <Download className="w-4 h-4" /> {exporting ? 'Export…' : 'Exporter (CSV)'}
          </button>
          {canWrite && (
            <button onClick={() => { setEditing(null); setFormOpen(true); }} className="btn-primary text-sm inline-flex items-center gap-1.5">
              <Plus className="w-4 h-4" /> Nouvelle action
            </button>
          )}
        </div>
      </div>

      {/* Filtres */}
      <div className="bg-white rounded-lg border p-3 flex items-center gap-2 flex-wrap">
        <Filter className="w-4 h-4 text-slate-400" aria-hidden="true" />
        <select value={filters.statut} onChange={(e) => setFilters((f) => ({ ...f, statut: e.target.value }))} className="input-modern py-1.5 text-sm w-auto">
          <option value="">Tous statuts</option>
          {Object.entries(ACTION_STATUT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={filters.critere} onChange={(e) => setFilters((f) => ({ ...f, critere: e.target.value }))} className="input-modern py-1.5 text-sm w-auto">
          <option value="">Tous critères</option>
          {criteres.map((c) => <option key={c.code} value={c.code}>{c.code} — {c.intitule}</option>)}
        </select>
        <select value={filters.responsable_user_id} onChange={(e) => setFilters((f) => ({ ...f, responsable_user_id: e.target.value }))} className="input-modern py-1.5 text-sm w-auto">
          <option value="">Tous responsables</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.first_name} {u.last_name}</option>)}
        </select>
        {hasFilters && (
          <button onClick={() => setFilters({ statut: '', critere: '', responsable_user_id: '' })} className="text-xs text-emerald-700 underline">Réinitialiser</button>
        )}
        <span className="ml-auto text-xs text-slate-400">{actions.length} action{actions.length > 1 ? 's' : ''}</span>
      </div>

      {error && (
        <div role="alert" className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm flex items-start gap-2">
          <span aria-hidden="true">⚠</span><span>{error}</span>
          <button onClick={() => setError(null)} className="ml-auto text-red-500" aria-label="Fermer">×</button>
        </div>
      )}

      {loading ? (
        <LoadingSpinner size="lg" message="Chargement du plan d'action…" />
      ) : actions.length === 0 ? (
        <div className="bg-white rounded-lg border p-8 text-center text-slate-400">
          <p className="text-sm">{hasFilters ? 'Aucune action ne correspond à ces filtres.' : 'Aucune action pour le moment.'}</p>
          {canWrite && !hasFilters && <p className="text-xs mt-1">Le plan d'action RSE structure la démarche : ajoutez une première action.</p>}
        </div>
      ) : (
        <div className="bg-white rounded-lg border overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500 border-b bg-slate-50">
                <th className="px-3 py-2 font-medium">Échéance</th>
                <th className="px-3 py-2 font-medium">Action</th>
                <th className="px-3 py-2 font-medium">Critères</th>
                <th className="px-3 py-2 font-medium">Responsable</th>
                <th className="px-3 py-2 font-medium">Priorité</th>
                <th className="px-3 py-2 font-medium">Statut</th>
                {canWrite && <th className="px-3 py-2 font-medium text-right">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {actions.map((a) => (
                <tr key={a.id} className={`border-b border-slate-100 ${a.en_retard ? 'bg-red-50/50' : 'hover:bg-slate-50'}`}>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {a.echeance ? (
                      <span className={a.en_retard ? 'text-red-600 font-semibold' : 'text-slate-600'}>
                        {frDate(a.echeance)}
                        {a.en_retard && <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-700">retard</span>}
                      </span>
                    ) : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-3 py-2 min-w-[220px]">
                    <span className={a.statut === 'realise' ? 'line-through text-slate-400' : 'text-slate-700'}>{a.titre}</span>
                    {a.indicateur && <p className="text-[11px] text-slate-400 mt-0.5">Indicateur : {a.indicateur}</p>}
                  </td>
                  <td className="px-3 py-2"><CritereChips codes={a.critere_codes} /></td>
                  <td className="px-3 py-2 whitespace-nowrap text-xs text-slate-500">{a.responsable_nom || '—'}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${PRIORITE_STYLES[a.priorite] || ''}`}>{PRIORITE_LABELS[a.priorite] || a.priorite}</span>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {canWrite ? (
                      <select value={a.statut} onChange={(e) => quickStatus(a, e.target.value)}
                        className={`text-xs border rounded px-1.5 py-1 ${ACTION_STATUT_STYLES[a.statut] || 'bg-white'}`} aria-label="Statut">
                        {Object.entries(ACTION_STATUT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </select>
                    ) : (
                      <span className={`text-[11px] px-2 py-0.5 rounded-full ${ACTION_STATUT_STYLES[a.statut] || ''}`}>{ACTION_STATUT_LABELS[a.statut]}</span>
                    )}
                  </td>
                  {canWrite && (
                    <td className="px-3 py-2 whitespace-nowrap text-right">
                      <button onClick={() => { setEditing(a); setFormOpen(true); }} className="text-slate-400 hover:text-emerald-600 p-1" title="Modifier" aria-label="Modifier">
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button onClick={() => setConfirmDel(a)} className="text-slate-400 hover:text-red-600 p-1" title="Supprimer" aria-label="Supprimer">
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
        <ActionForm
          initial={editing}
          criteres={criteres}
          users={users}
          restricted={restricted}
          onClose={() => setFormOpen(false)}
          onSaved={() => { setFormOpen(false); load(); }}
        />
      )}

      <ConfirmDialog
        isOpen={!!confirmDel}
        title="Supprimer l'action ?"
        message={confirmDel ? `« ${confirmDel.titre} » sera définitivement supprimée.` : ''}
        confirmLabel="Supprimer"
        confirmVariant="danger"
        onConfirm={() => remove(confirmDel)}
        onCancel={() => setConfirmDel(null)}
      />
    </div>
  );
}
