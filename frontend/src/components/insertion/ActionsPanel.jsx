import { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';
import QuickActionButton from './QuickActionButton';
import {
  ACTION_STATUS_LABELS, ACTION_CATEGORY_LABELS, ACTION_PRIORITY_LABELS,
  ACTION_PRIORITY_COLORS, DORA_RESULTAT_LABELS, AIDE_NATURE_LABELS, frDate,
} from './freins';

/**
 * Journal des actions CIP d'un salarié (GET /insertion/action-plans/:employeeId
 * — chaque ligne porte milestone_titre / objectif_titre / partenaire_nom).
 * Changement de statut et résultat en ligne ; badge « en retard » ;
 * « + Action » (modale rapide) pour l'ajout.
 *
 * milestoneId : limite l'affichage aux actions rattachées à cet entretien.
 * readOnly : consultation (onglet /employees — REC-UX-12).
 *
 * PR D lot 6 — deux blocs repliables par action : l'ORIENTATION DORA (le service
 * vers lequel la personne a été orientée, et son RÉSULTAT — c'est le résultat
 * que l'autorité demande, pas le fait d'avoir orienté) et l'AIDE MOBILISÉE
 * (nature, organisme, montant). Le montant reste FACULTATIF : une aide non
 * chiffrée ne vaut pas zéro euro, et un total qui additionnerait des zéros
 * inventés dirait au Département moins que ce qu'il finance réellement.
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
            {/* PR D — orientation DORA et aide mobilisée */}
            {!compact && <DoraAideBloc action={a} readOnly={readOnly} onSave={(patch) => update(a.id, patch)} />}

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

/**
 * Orientation DORA et aide mobilisée d'une action — bloc REPLIÉ par défaut.
 *
 * Replié, parce que la majorité des actions n'en portent pas et que le journal
 * des actions doit rester lisible d'un coup d'œil : il s'ouvre de lui-même
 * quand l'action porte déjà l'une des deux informations, pour qu'on ne puisse
 * pas passer à côté d'une orientation déjà saisie.
 */
function DoraAideBloc({ action, readOnly, onSave }) {
  const aDeja = !!(action.dora_service || action.dora_url || action.dora_resultat
    || action.aide_nature || action.aide_organisme || action.aide_montant != null);
  const [ouvert, setOuvert] = useState(aDeja);
  const [form, setForm] = useState(null);
  const [erreur, setErreur] = useState(null);

  const ouvrirEdition = () => {
    setErreur(null);
    setForm({
      dora_service: action.dora_service || '',
      dora_url: action.dora_url || '',
      dora_resultat: action.dora_resultat || '',
      aide_nature: action.aide_nature || '',
      aide_organisme: action.aide_organisme || '',
      aide_montant: action.aide_montant != null ? String(action.aide_montant) : '',
    });
  };

  const enregistrer = async () => {
    // Contrôle AVANT l'appel, pour rendre le motif dans le bloc plutôt que de
    // laisser remonter un 400 générique. Le serveur revérifie : c'est lui qui
    // fait foi (le contrôle de saisie est un confort, pas une garantie).
    if (form.dora_url && !/^https:\/\//i.test(form.dora_url.trim())) {
      setErreur("Le lien DORA doit commencer par « https:// ».");
      return;
    }
    const montant = form.aide_montant.trim().replace(',', '.');
    if (montant !== '' && (Number.isNaN(Number(montant)) || Number(montant) < 0)) {
      setErreur('Le montant doit être un nombre positif, ou rester vide.');
      return;
    }
    setErreur(null);
    await onSave({
      dora_service: form.dora_service.trim() || null,
      dora_url: form.dora_url.trim() || null,
      dora_resultat: form.dora_resultat || null,
      aide_nature: form.aide_nature || null,
      aide_organisme: form.aide_organisme.trim() || null,
      // Vide = NON CHIFFRÉE, jamais 0 € : c'est la distinction que le bloc
      // « Aides mobilisées » de la synthèse de dialogue de gestion imprime.
      aide_montant: montant === '' ? null : Number(montant),
    });
    setForm(null);
  };

  if (form) {
    return (
      <div className="mt-1.5 rounded-lg border border-indigo-200 bg-indigo-50/50 p-2 space-y-2">
        {erreur && <div className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded p-1.5">{erreur}</div>}
        <div>
          <p className="text-[10px] font-semibold text-indigo-700 uppercase mb-1">Orientation DORA</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
            <input value={form.dora_service} onChange={(e) => setForm({ ...form, dora_service: e.target.value })}
              placeholder="Service (ex. auto-école sociale)" maxLength={150} className="input-modern py-1 text-xs" />
            <input value={form.dora_url} onChange={(e) => setForm({ ...form, dora_url: e.target.value })}
              placeholder="https://dora.inclusion.beta.gouv.fr/…" className="input-modern py-1 text-xs" />
            <select value={form.dora_resultat} onChange={(e) => setForm({ ...form, dora_resultat: e.target.value })}
              className="input-modern py-1 text-xs">
              <option value="">Résultat non renseigné</option>
              {Object.entries(DORA_RESULTAT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
        </div>
        <div>
          <p className="text-[10px] font-semibold text-indigo-700 uppercase mb-1">Aide mobilisée</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
            <select value={form.aide_nature} onChange={(e) => setForm({ ...form, aide_nature: e.target.value })}
              className="input-modern py-1 text-xs">
              <option value="">Aucune aide</option>
              {Object.entries(AIDE_NATURE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <input value={form.aide_organisme} onChange={(e) => setForm({ ...form, aide_organisme: e.target.value })}
              placeholder="Organisme financeur" maxLength={150} className="input-modern py-1 text-xs" />
            <input type="number" min="0" step="0.01" value={form.aide_montant}
              onChange={(e) => setForm({ ...form, aide_montant: e.target.value })}
              placeholder="Montant € (facultatif)" className="input-modern py-1 text-xs" />
          </div>
          <p className="text-[10px] text-gray-400 mt-0.5">
            Montant laissé vide = <strong>aide non chiffrée</strong>. Ce n'est pas 0 € : la synthèse transmise
            au Département distingue les deux.
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => setForm(null)} className="text-xs px-2 py-1 text-gray-500 hover:text-gray-700">Annuler</button>
          <button type="button" onClick={enregistrer} className="text-xs px-2.5 py-1 rounded bg-indigo-600 text-white">Enregistrer</button>
        </div>
      </div>
    );
  }

  if (!aDeja && readOnly) return null;

  return (
    <div className="mt-1">
      <button type="button" onClick={() => setOuvert((v) => !v)}
        className="text-[11px] text-indigo-600 hover:underline">
        {ouvert ? '− ' : '+ '}Orientation DORA / aide mobilisée{aDeja ? '' : ' (non renseignées)'}
      </button>
      {ouvert && (
        <div className="mt-1 text-[11px] text-gray-600 space-y-0.5 pl-2 border-l-2 border-indigo-100">
          <p>
            <span className="text-gray-400">DORA :</span>{' '}
            {action.dora_service || action.dora_url ? (
              <>
                {action.dora_service || 'service non nommé'}
                {action.dora_url && (
                  <> — <a href={action.dora_url} target="_blank" rel="noopener noreferrer" className="text-indigo-600 underline">lien</a></>
                )}
                {action.dora_resultat && <> — <strong>{DORA_RESULTAT_LABELS[action.dora_resultat]}</strong></>}
              </>
            ) : <span className="text-gray-300">aucune orientation</span>}
          </p>
          <p>
            <span className="text-gray-400">Aide :</span>{' '}
            {action.aide_nature ? (
              <>
                {AIDE_NATURE_LABELS[action.aide_nature] || action.aide_nature}
                {action.aide_organisme && <> — {action.aide_organisme}</>}
                {action.aide_montant != null
                  ? <> — <strong>{action.aide_montant} €</strong></>
                  : <span className="text-gray-400"> — montant non chiffré</span>}
              </>
            ) : <span className="text-gray-300">aucune aide</span>}
          </p>
          {!readOnly && (
            <button type="button" onClick={ouvrirEdition} className="text-[11px] text-indigo-600 hover:underline">
              Modifier
            </button>
          )}
        </div>
      )}
    </div>
  );
}
