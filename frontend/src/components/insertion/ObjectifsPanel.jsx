import { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';
import {
  OBJECTIF_STATUT_LABELS, OBJECTIF_STATUT_COLORS, frDate,
} from './freins';

/**
 * Objectifs individualisés du parcours — arbre à 2 niveaux maximum
 * (objectif → sous-objectifs, REC-UX-16), échéance + date butoir, origine
 * salarié / CIP, entretien d'origine. Écriture ADMIN/RH (contrat backend :
 * POST/PUT/DELETE /insertion/objectifs réservés A/RH), lecture pour les autres.
 */

const ORIGINE_BADGE = {
  salarie: ['Exprimé par le salarié', 'bg-sky-100 text-sky-700'],
  cip: ['Proposé par la CIP', 'bg-teal-50 text-teal-700'],
};

function ObjectifForm({ employeeId, parentId = null, initial = null, onDone, onCancel }) {
  const [form, setForm] = useState({
    titre: initial?.titre || '',
    description: initial?.description || '',
    origine: initial?.origine || 'cip',
    echeance: initial?.echeance ? String(initial.echeance).slice(0, 10) : '',
    date_butoir: initial?.date_butoir ? String(initial.date_butoir).slice(0, 10) : '',
    statut: initial?.statut || 'en_cours',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const submit = async () => {
    if (!form.titre.trim()) { setError('Le titre est obligatoire.'); return; }
    setSaving(true); setError(null);
    try {
      if (initial?.id) {
        await api.put(`/insertion/objectifs/${initial.id}`, {
          titre: form.titre.trim(), description: form.description || null, origine: form.origine,
          echeance: form.echeance || null, date_butoir: form.date_butoir || null, statut: form.statut,
        });
      } else {
        await api.post('/insertion/objectifs', {
          employee_id: employeeId, parent_id: parentId, titre: form.titre.trim(),
          description: form.description || null, origine: form.origine,
          echeance: form.echeance || null, date_butoir: form.date_butoir || null, statut: form.statut,
        });
      }
      onDone();
    } catch (err) {
      setError(err.response?.data?.error || err.message);
      setSaving(false);
    }
  };

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2">
      {error && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded p-1.5">{error}</div>}
      <input value={form.titre} onChange={(e) => setForm({ ...form, titre: e.target.value })}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
        placeholder={parentId ? 'Sous-objectif (une étape concrète)…' : "Objectif (ex. : Obtenir le permis B)…"}
        className="input-modern py-1 w-full text-sm" autoFocus />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div>
          <label className="block text-[11px] text-gray-400 mb-0.5">Origine</label>
          <select value={form.origine} onChange={(e) => setForm({ ...form, origine: e.target.value })} className="input-modern py-1 text-xs w-full">
            <option value="cip">CIP</option>
            <option value="salarie">Salarié</option>
          </select>
        </div>
        <div>
          <label className="block text-[11px] text-gray-400 mb-0.5">Statut</label>
          <select value={form.statut} onChange={(e) => setForm({ ...form, statut: e.target.value })} className="input-modern py-1 text-xs w-full">
            {Object.entries(OBJECTIF_STATUT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[11px] text-gray-400 mb-0.5">Échéance</label>
          <input type="date" value={form.echeance} onChange={(e) => setForm({ ...form, echeance: e.target.value })} className="input-modern py-1 text-xs w-full" />
        </div>
        <div>
          <label className="block text-[11px] text-gray-400 mb-0.5" title="Date au-delà de laquelle l'objectif doit être requestionné">Date butoir</label>
          <input type="date" value={form.date_butoir} onChange={(e) => setForm({ ...form, date_butoir: e.target.value })} className="input-modern py-1 text-xs w-full" />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="px-2.5 py-1 text-xs text-gray-500 hover:text-gray-700">Annuler</button>
        <button type="button" onClick={submit} disabled={saving} className="px-3 py-1 rounded bg-teal-600 text-white text-xs font-medium hover:bg-teal-700 disabled:opacity-50">
          {saving ? '…' : (initial?.id ? 'Enregistrer' : 'Ajouter')}
        </button>
      </div>
    </div>
  );
}

function ObjectifRow({ obj, canEdit, onStatut, onEdit, onDelete, onAddSub, isChild = false }) {
  const [origLabel, origClass] = ORIGINE_BADGE[obj.origine] || ORIGINE_BADGE.cip;
  const enRetard = obj.echeance && obj.statut !== 'atteint' && obj.statut !== 'abandonne' && new Date(obj.echeance) < new Date();
  const butoirDepasse = obj.date_butoir && obj.statut !== 'atteint' && obj.statut !== 'abandonne' && new Date(obj.date_butoir) < new Date();
  return (
    <div className={`rounded-lg border p-2.5 ${isChild ? 'ml-6 bg-white border-slate-100' : 'bg-white border-slate-200'}`}>
      <div className="flex items-start gap-2 flex-wrap">
        <div className="flex-1 min-w-[180px]">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`font-medium text-sm ${obj.statut === 'atteint' ? 'text-green-700' : 'text-gray-800'}`}>{obj.titre}</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${origClass}`}>{origLabel}</span>
            {obj.milestone_titre && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500" title="Entretien d'origine">↤ {obj.milestone_titre}</span>}
          </div>
          {obj.description && <p className="text-xs text-gray-500 mt-0.5">{obj.description}</p>}
          <div className="flex items-center gap-2 mt-1 text-[11px] text-gray-400 flex-wrap">
            {obj.echeance && (
              <span className={enRetard ? 'text-red-600 font-medium' : ''}>Échéance : {frDate(obj.echeance)}{enRetard ? ' (dépassée)' : ''}</span>
            )}
            {obj.date_butoir && (
              <span className={butoirDepasse ? 'text-red-600 font-medium' : ''}>Butoir : {frDate(obj.date_butoir)}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {canEdit ? (
            <select value={obj.statut} onChange={(e) => onStatut(obj, e.target.value)}
              className={`text-xs rounded px-1.5 py-0.5 border-0 cursor-pointer ${OBJECTIF_STATUT_COLORS[obj.statut] || ''}`}>
              {Object.entries(OBJECTIF_STATUT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          ) : (
            <span className={`text-xs px-1.5 py-0.5 rounded ${OBJECTIF_STATUT_COLORS[obj.statut] || ''}`}>{OBJECTIF_STATUT_LABELS[obj.statut] || obj.statut}</span>
          )}
          {canEdit && (
            <>
              <button type="button" onClick={() => onEdit(obj)} className="text-[11px] text-gray-400 hover:text-teal-700" title="Modifier">✎</button>
              <button type="button" onClick={() => onDelete(obj)} className="text-[11px] text-gray-400 hover:text-red-600" title="Supprimer">🗑</button>
            </>
          )}
        </div>
      </div>
      {canEdit && !isChild && (
        <button type="button" onClick={() => onAddSub(obj)} className="mt-1 text-[11px] text-gray-400 hover:text-teal-700 underline">
          + sous-objectif
        </button>
      )}
    </div>
  );
}

export default function ObjectifsPanel({ employeeId, canEdit = false, onChanged, compact = false }) {
  const [objectifs, setObjectifs] = useState([]);
  const [error, setError] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addingSubOf, setAddingSubOf] = useState(null);
  const [editing, setEditing] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const load = useCallback(() => {
    let alive = true;
    api.get(`/insertion/objectifs/${employeeId}`)
      .then((r) => { if (alive) { setObjectifs(Array.isArray(r.data) ? r.data : []); setError(null); } })
      .catch((err) => { if (alive) setError(err.response?.data?.error || err.message); })
      .finally(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, [employeeId]);

  useEffect(() => load(), [load]);

  const refresh = () => { load(); if (onChanged) onChanged(); };

  const changeStatut = async (obj, statut) => {
    try {
      await api.put(`/insertion/objectifs/${obj.id}`, { statut });
      setObjectifs((list) => list.map((o) => (o.id === obj.id ? { ...o, statut } : o)));
      if (onChanged) onChanged();
    } catch (err) { setError(err.response?.data?.error || err.message); }
  };

  const doDelete = async (obj) => {
    try {
      await api.delete(`/insertion/objectifs/${obj.id}`);
      setConfirmDelete(null);
      refresh();
    } catch (err) { setError(err.response?.data?.error || err.message); }
  };

  const parents = objectifs.filter((o) => !o.parent_id);
  const childrenOf = (id) => objectifs.filter((o) => o.parent_id === id);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="font-semibold text-gray-700 text-sm">Objectifs du parcours ({parents.length})</h4>
        {canEdit && !adding && (
          <button type="button" onClick={() => { setAdding(true); setEditing(null); setAddingSubOf(null); }}
            className="text-xs px-2.5 py-1 rounded-lg bg-teal-600 text-white font-medium hover:bg-teal-700">
            + Objectif
          </button>
        )}
      </div>

      {error && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg p-2">{error}</div>}

      {adding && (
        <ObjectifForm employeeId={employeeId} onDone={() => { setAdding(false); refresh(); }} onCancel={() => setAdding(false)} />
      )}

      {loaded && parents.length === 0 && !adding && (
        <div className="text-center text-sm text-gray-400 py-4 border border-dashed rounded-lg">
          <p>Aucun objectif défini pour ce parcours.</p>
          <p className="text-xs mt-1">Les objectifs exprimés par le salarié lors du diagnostic (rubrique « Expression du salarié ») ont vocation à apparaître ici.</p>
          {canEdit && (
            <button type="button" onClick={() => setAdding(true)} className="mt-2 text-xs px-3 py-1.5 rounded-lg bg-teal-600 text-white font-medium hover:bg-teal-700">
              Définir un premier objectif
            </button>
          )}
        </div>
      )}

      <div className="space-y-2">
        {(compact ? parents.filter((p) => !['atteint', 'abandonne'].includes(p.statut)) : parents).map((p) => (
          <div key={p.id} className="space-y-1.5">
            {editing?.id === p.id ? (
              <ObjectifForm employeeId={employeeId} initial={p} onDone={() => { setEditing(null); refresh(); }} onCancel={() => setEditing(null)} />
            ) : (
              <ObjectifRow obj={p} canEdit={canEdit} isChild={false}
                onStatut={changeStatut}
                onEdit={setEditing}
                onDelete={setConfirmDelete}
                onAddSub={setAddingSubOf} />
            )}
            {addingSubOf?.id === p.id && (
              <div className="ml-6">
                <ObjectifForm employeeId={employeeId} parentId={p.id} onDone={() => { setAddingSubOf(null); refresh(); }} onCancel={() => setAddingSubOf(null)} />
              </div>
            )}
            {childrenOf(p.id).map((c) => (
              editing?.id === c.id ? (
                <div key={c.id} className="ml-6">
                  <ObjectifForm employeeId={employeeId} initial={c} onDone={() => { setEditing(null); refresh(); }} onCancel={() => setEditing(null)} />
                </div>
              ) : (
                <ObjectifRow key={c.id} obj={c} canEdit={canEdit} isChild
                  onStatut={changeStatut}
                  onEdit={setEditing}
                  onDelete={setConfirmDelete}
                  onAddSub={() => {}} />
              )
            ))}
          </div>
        ))}
      </div>

      {confirmDelete && (
        <div className="text-xs bg-red-50 border border-red-200 rounded-lg p-2 flex items-center gap-2 flex-wrap">
          <span className="text-red-700 flex-1">Supprimer « {confirmDelete.titre} »{childrenOf(confirmDelete.id).length ? ' et ses sous-objectifs' : ''} ?</span>
          <button type="button" onClick={() => doDelete(confirmDelete)} className="px-2 py-0.5 rounded bg-red-600 text-white font-medium">Supprimer</button>
          <button type="button" onClick={() => setConfirmDelete(null)} className="px-2 py-0.5 text-gray-500">Annuler</button>
        </div>
      )}
    </div>
  );
}
