import { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';
import QuickActionButton from './QuickActionButton';
import {
  ACTION_STATUS_LABELS, ACTION_CATEGORY_LABELS, ACTION_PRIORITY_LABELS,
  ACTION_PRIORITY_COLORS, frDate,
} from './freins';

/**
 * Journal des actions CIP d'un salarié (GET /insertion/action-plans/:employeeId
 * — chaque ligne porte milestone_titre / objectif_titre / partenaire_nom).
 * Changement de statut et résultat en ligne ; badge « en retard » ;
 * « + Action » (modale rapide) pour l'ajout.
 *
 * milestoneId : limite l'affichage aux actions rattachées à cet entretien.
 * readOnly : consultation (onglet /employees — REC-UX-12).
 */
export default function ActionsPanel({ employeeId, employeeName = '', milestoneId = null, readOnly = false, compact = false, onChanged }) {
  const [actions, setActions] = useState([]);
  const [error, setError] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [editingResult, setEditingResult] = useState(null); // {id, resultat}

  const load = useCallback(() => {
    let alive = true;
    api.get(`/insertion/action-plans/${employeeId}`)
      .then((r) => { if (alive) { setActions(Array.isArray(r.data) ? r.data : []); setError(null); } })
      .catch((err) => { if (alive) setError(err.response?.data?.error || err.message); })
      .finally(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, [employeeId]);

  useEffect(() => load(), [load]);

  const refresh = () => { load(); if (onChanged) onChanged(); };

  const update = async (id, updates) => {
    try {
      const res = await api.put(`/insertion/action-plans/${id}`, updates);
      setActions((list) => list.map((a) => (a.id === id ? { ...a, ...res.data } : a)));
      if (onChanged) onChanged();
    } catch (err) { setError(err.response?.data?.error || err.message); }
  };

  const isLate = (a) => a.echeance && ['a_faire', 'en_cours'].includes(a.status) && new Date(a.echeance) < new Date();

  let list = milestoneId ? actions.filter((a) => a.milestone_id === milestoneId) : actions;
  const doneCount = list.filter((a) => ['realise', 'abandonne'].includes(a.status)).length;
  if (!showDone) list = list.filter((a) => !['realise', 'abandonne'].includes(a.status));
  // Tri : en retard d'abord, puis par échéance croissante (sans échéance en dernier).
  list = [...list].sort((a, b) => {
    const la = isLate(a) ? 0 : 1, lb = isLate(b) ? 0 : 1;
    if (la !== lb) return la - lb;
    if (a.echeance && b.echeance) return new Date(a.echeance) - new Date(b.echeance);
    return a.echeance ? -1 : (b.echeance ? 1 : 0);
  });

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h4 className="font-semibold text-gray-700 text-sm">
          {milestoneId ? 'Actions liées à cet entretien' : 'Journal des actions'} ({list.length})
        </h4>
        <div className="flex items-center gap-2">
          {doneCount > 0 && (
            <label className="flex items-center gap-1 text-[11px] text-gray-500 cursor-pointer select-none">
              <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} className="rounded border-gray-300" />
              Afficher les terminées ({doneCount})
            </label>
          )}
          {!readOnly && (
            <QuickActionButton defaultEmployeeId={employeeId} defaultEmployeeName={employeeName}
              defaultMilestoneId={milestoneId} onCreated={refresh} className="!py-1 !text-xs" />
          )}
        </div>
      </div>

      {error && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg p-2">{error}</div>}

      {loaded && list.length === 0 && (
        <div className="text-center text-sm text-gray-400 py-4 border border-dashed rounded-lg">
          <p>Aucune action en cours{milestoneId ? ' pour cet entretien' : ''}.</p>
          {!readOnly && <p className="text-xs mt-1">Le bouton « + Action » permet de noter une démarche en moins de 30 secondes.</p>}
        </div>
      )}

      <div className="space-y-1.5">
        {list.map((a) => (
          <div key={a.id} className={`rounded-lg border p-2 text-sm ${isLate(a) ? 'border-red-200 bg-red-50/50' : 'border-slate-200 bg-white'}`}>
            <div className="flex items-center gap-2 flex-wrap">
              {!readOnly ? (
                <select value={a.status} onChange={(e) => update(a.id, { status: e.target.value })}
                  className="text-xs border rounded px-1 py-0.5 bg-white">
                  {Object.entries(ACTION_STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              ) : (
                <span className="text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">{ACTION_STATUS_LABELS[a.status] || a.status}</span>
              )}
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${ACTION_PRIORITY_COLORS[a.priority] || ''}`} title="Criticité">
                {ACTION_PRIORITY_LABELS[a.priority] || a.priority}
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700">{ACTION_CATEGORY_LABELS[a.category] || a.category}</span>
              <span className={`flex-1 min-w-[140px] ${a.status === 'realise' ? 'line-through text-gray-400' : 'text-gray-800'}`}>{a.action_label}</span>
              {a.echeance && (
                <span className={`text-[11px] ${isLate(a) ? 'text-red-600 font-semibold' : 'text-gray-400'}`}>
                  {isLate(a) ? '⚠ en retard · ' : ''}{frDate(a.echeance)}
                </span>
              )}
            </div>
            {(a.partenaire_nom || a.objectif_titre || (!milestoneId && a.milestone_titre)) && !compact && (
              <div className="flex items-center gap-2 mt-1 text-[10px] text-gray-400 flex-wrap">
                {a.partenaire_nom && <span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-600">Partenaire : {a.partenaire_nom}</span>}
                {a.objectif_titre && <span className="px-1.5 py-0.5 rounded bg-teal-50 text-teal-600">Objectif : {a.objectif_titre}</span>}
                {!milestoneId && a.milestone_titre && <span className="px-1.5 py-0.5 rounded bg-slate-50 text-slate-500">Entretien : {a.milestone_titre}</span>}
              </div>
            )}
            {/* Résultat (visible dès qu'il existe ; éditable au clic hors lecture seule) */}
            {editingResult?.id === a.id ? (
              <div className="flex items-center gap-2 mt-1.5">
                <input value={editingResult.resultat} onChange={(e) => setEditingResult({ ...editingResult, resultat: e.target.value })}
                  onKeyDown={(e) => { if (e.key === 'Enter') { update(a.id, { resultat: editingResult.resultat || null }); setEditingResult(null); } if (e.key === 'Escape') setEditingResult(null); }}
                  placeholder="Résultat de la démarche…" className="input-modern py-1 text-xs flex-1" autoFocus />
                <button type="button" onClick={() => { update(a.id, { resultat: editingResult.resultat || null }); setEditingResult(null); }}
                  className="text-xs px-2 py-1 rounded bg-teal-600 text-white">OK</button>
              </div>
            ) : (a.resultat || !readOnly) && !compact ? (
              <button type="button" disabled={readOnly}
                onClick={() => !readOnly && setEditingResult({ id: a.id, resultat: a.resultat || '' })}
                className={`mt-1 text-[11px] text-left w-full ${a.resultat ? 'text-gray-600' : 'text-gray-300 hover:text-gray-500'} ${readOnly ? 'cursor-default' : ''}`}>
                {a.resultat ? `Résultat : ${a.resultat}` : '+ noter un résultat'}
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
