import { useState, useEffect, useCallback, useMemo } from 'react';
import api from '../../services/api';
import { LoadingSpinner } from '../';
import { useAuth } from '../../contexts/AuthContext';
import {
  COMPETENCE_FILIERES, COMPETENCE_FILIERE_LABELS, COMPETENCE_STATUT_LABELS, frDate, isAdminRh,
} from './freins';

/**
 * Grille de compétences métier par filière (Lot 8 — EXG-26/27).
 * Pensée pour l'encadrant technique (ETI) peu à l'aise au clavier :
 *  - une LIGNE par item avec de gros boutons de note 0-10 + « N/E » ;
 *  - observation / objectif courts, repliés ;
 *  - moyenne calculée en direct (N/E honnête, jamais compté) ;
 *  - « Enregistrer (brouillon) » vs « Valider » (validations salarié / ETI / CIP
 *    horodatées) ;
 *  - historique des évaluations avec comparaison de moyenne.
 *
 * Backend : GET/POST/PUT/DELETE /insertion/competences[…], référentiel
 * GET /insertion/competence-referentiels?filiere=&actifs=1.
 * Aucune donnée art. 9/10 → accessible ADMIN/RH/MANAGER (suppression ADMIN/RH).
 */

// Moyenne d'une grille en excluant les N/E (miroir engine.competenceAverage).
function moyenneScores(scores) {
  const notes = (scores || [])
    .filter((s) => s && s.non_evalue !== true && s.note != null && s.note !== '')
    .map((s) => Number(s.note))
    .filter((n) => !Number.isNaN(n));
  if (notes.length === 0) return { moyenne: null, n: 0, ne: (scores || []).length };
  return { moyenne: Math.round((notes.reduce((a, b) => a + b, 0) / notes.length) * 10) / 10, n: notes.length, ne: (scores || []).length - notes.length };
}

const noteColor = (n) => (n == null ? 'bg-slate-600 border-slate-600 text-white'
  : n <= 3 ? 'bg-red-100 text-red-700 border-red-300'
    : n <= 6 ? 'bg-amber-100 text-amber-700 border-amber-300'
      : 'bg-green-100 text-green-700 border-green-300');

// Rangée de saisie d'un item : boutons 0-10 + N/E, observation/objectif repliés.
function ScoreRow({ label, sc, onChange, readOnly }) {
  const [open, setOpen] = useState(!!(sc.observation || sc.objectif));
  const ne = sc.non_evalue === true || sc.note == null || sc.note === '';
  const noteVal = ne ? null : Number(sc.note);
  return (
    <div className="border-b border-gray-100 py-2 last:border-b-0">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <span className="text-sm text-gray-700 flex-1 min-w-[140px]">{label}</span>
        <div className="flex items-center gap-1 flex-wrap">
          <button type="button" disabled={readOnly} onClick={() => onChange({ non_evalue: true, note: null })}
            title="Non évalué — exclu de la moyenne"
            className={`px-2 py-1 rounded-lg border text-xs font-medium transition ${ne ? 'bg-slate-600 border-slate-600 text-white' : 'bg-white border-gray-300 text-gray-500 hover:border-gray-400'} disabled:opacity-60`}>
            N/E
          </button>
          {Array.from({ length: 11 }, (_, i) => i).map((n) => {
            const active = !ne && noteVal === n;
            return (
              <button key={n} type="button" disabled={readOnly}
                onClick={() => onChange(active ? { non_evalue: true, note: null } : { non_evalue: false, note: n })}
                className={`w-7 py-1 rounded-lg border text-xs font-medium transition ${active ? noteColor(n) + ' border-current' : 'bg-white border-gray-300 text-gray-600 hover:border-teal-400'} disabled:opacity-60`}>
                {n}
              </button>
            );
          })}
        </div>
      </div>
      <div className="mt-1">
        <button type="button" onClick={() => setOpen((o) => !o)} className="text-[11px] text-teal-700 hover:underline">
          {open ? '− observation / objectif' : '+ observation / objectif'}
        </button>
        {open && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1">
            <input value={sc.observation || ''} disabled={readOnly} onChange={(e) => onChange({ observation: e.target.value })}
              placeholder="Observation" className="input-modern py-1 text-xs w-full" />
            <input value={sc.objectif || ''} disabled={readOnly} onChange={(e) => onChange({ objectif: e.target.value })}
              placeholder="Objectif de progression" className="input-modern py-1 text-xs w-full" />
          </div>
        )}
      </div>
    </div>
  );
}

// Ligne de validation horodatée (salarié / ETI / CIP).
function ValidationRow({ k, label, validations, onToggle, readOnly }) {
  const v = validations?.[k];
  return (
    <label className={`flex items-center gap-2 text-sm cursor-pointer ${v ? 'text-green-700' : 'text-gray-600'} ${readOnly ? 'cursor-default' : ''}`}>
      <input type="checkbox" checked={!!v} disabled={readOnly} onChange={(e) => onToggle(k, e.target.checked)} className="rounded border-gray-300" />
      {label}{v?.at && <span className="text-[11px] text-gray-400">— {new Date(v.at).toLocaleDateString('fr-FR')}</span>}
    </label>
  );
}

const todayISO = () => new Date().toISOString().slice(0, 10);

export default function CompetencesETI({ employeeId, employee = {}, canEdit = false }) {
  const { user } = useAuth();
  const adminRh = isAdminRh(user);
  const [evaluations, setEvaluations] = useState(null);
  const [error, setError] = useState(null);
  const [referentiel, setReferentiel] = useState([]);
  const [refError, setRefError] = useState(null);
  const [editing, setEditing] = useState(null); // { id?, filiere, periode, date_evaluation, statut, synthese, validations, scoresByRef:{}, orphans:[] }
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  const defaultFiliere = employee.filiere && COMPETENCE_FILIERES.includes(employee.filiere) ? employee.filiere : 'tri';

  const load = useCallback(() => {
    api.get(`/insertion/competences/${employeeId}`)
      .then((r) => { setEvaluations(Array.isArray(r.data) ? r.data : []); setError(null); })
      .catch((err) => { setEvaluations([]); setError(err.response?.data?.error || err.message); });
  }, [employeeId]);
  useEffect(() => load(), [load]);

  // Charge le référentiel actif de la filière en cours d'édition.
  useEffect(() => {
    if (!editing?.filiere) return;
    setRefError(null);
    api.get(`/insertion/competence-referentiels?filiere=${editing.filiere}&actifs=1`)
      .then((r) => setReferentiel(Array.isArray(r.data) ? r.data : []))
      .catch((err) => { setReferentiel([]); setRefError(err.response?.data?.error || err.message); });
  }, [editing?.filiere]);

  const startNew = () => setEditing({
    id: null, filiere: defaultFiliere, periode: '', date_evaluation: todayISO(),
    statut: 'brouillon', synthese: '', validations: {}, scoresByRef: {}, orphans: [],
  });

  const startEdit = (ev) => {
    const scoresByRef = {};
    const orphans = [];
    for (const s of ev.scores || []) {
      if (s.referentiel_id != null) scoresByRef[s.referentiel_id] = { note: s.note, non_evalue: s.non_evalue, observation: s.observation, objectif: s.objectif };
      else orphans.push({ rubrique: s.rubrique, item: s.item, note: s.note, non_evalue: s.non_evalue, observation: s.observation, objectif: s.objectif });
    }
    setEditing({
      id: ev.id, filiere: ev.filiere || defaultFiliere, periode: ev.periode || '',
      date_evaluation: ev.date_evaluation ? String(ev.date_evaluation).slice(0, 10) : todayISO(),
      statut: ev.statut || 'brouillon', synthese: ev.synthese || '',
      validations: ev.validations && typeof ev.validations === 'object' ? ev.validations : {},
      scoresByRef, orphans,
    });
  };

  // Référentiel groupé par rubrique (ordre serveur préservé).
  const grouped = useMemo(() => {
    const map = new Map();
    for (const it of referentiel) {
      if (!map.has(it.rubrique)) map.set(it.rubrique, []);
      map.get(it.rubrique).push(it);
    }
    return [...map.entries()];
  }, [referentiel]);

  // Scores courants (pour la moyenne live) = référentiel + orphelins.
  const currentScores = useMemo(() => {
    if (!editing) return [];
    const fromRef = referentiel.map((it) => editing.scoresByRef[it.id] || { non_evalue: true, note: null });
    return [...fromRef, ...(editing.orphans || [])];
  }, [editing, referentiel]);
  const liveMoy = moyenneScores(currentScores);

  const setScore = (refId, patch) => setEditing((e) => ({
    ...e, scoresByRef: { ...e.scoresByRef, [refId]: { ...(e.scoresByRef[refId] || {}), ...patch } },
  }));
  const setOrphan = (idx, patch) => setEditing((e) => ({
    ...e, orphans: e.orphans.map((o, i) => (i === idx ? { ...o, ...patch } : o)),
  }));

  const toggleValidation = (k, on) => setEditing((e) => {
    const v = { ...(e.validations || {}) };
    if (on) v[k] = { at: new Date().toISOString(), user_id: user?.id || null };
    else delete v[k];
    return { ...e, validations: v };
  });

  const buildScores = () => {
    const out = [];
    for (const it of referentiel) {
      const sc = editing.scoresByRef[it.id];
      if (!sc) continue; // item non touché : on n'envoie que ce qui a été renseigné
      const ne = sc.non_evalue === true || sc.note == null || sc.note === '';
      out.push({ referentiel_id: it.id, note: ne ? null : Number(sc.note), non_evalue: ne, observation: sc.observation || null, objectif: sc.objectif || null });
    }
    for (const o of editing.orphans || []) {
      const ne = o.non_evalue === true || o.note == null || o.note === '';
      out.push({ rubrique: o.rubrique, item: o.item, note: ne ? null : Number(o.note), non_evalue: ne, observation: o.observation || null, objectif: o.objectif || null });
    }
    return out;
  };

  const save = async (statut) => {
    setSaving(true); setSaveError(null);
    try {
      const body = {
        employee_id: employeeId, filiere: editing.filiere, periode: editing.periode || null,
        date_evaluation: editing.date_evaluation || null, statut,
        synthese: editing.synthese || null, validations: editing.validations || {},
        scores: buildScores(),
      };
      if (editing.id) await api.put(`/insertion/competences/${editing.id}`, body);
      else await api.post('/insertion/competences', body);
      setEditing(null);
      load();
    } catch (err) {
      setSaveError(err.response?.data?.error || err.message);
    }
    setSaving(false);
  };

  const remove = async (ev) => {
    if (!window.confirm('Supprimer définitivement cette évaluation de compétences ?')) return;
    setError(null);
    try { await api.delete(`/insertion/competences/${ev.id}`); load(); }
    catch (err) { setError(err.response?.data?.error || err.message); }
  };

  if (evaluations === null) return <LoadingSpinner size="md" message="Chargement des compétences…" />;

  // ── Éditeur ──
  if (editing) {
    const canValidate = editing.validations?.salarie && editing.validations?.eti && editing.validations?.cip;
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h3 className="font-semibold text-gray-800">{editing.id ? 'Modifier l\'évaluation' : 'Nouvelle évaluation de compétences'}</h3>
          <button type="button" onClick={() => setEditing(null)} className="text-xs text-gray-500 hover:underline">← Retour à la liste</button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Filière</label>
            <select value={editing.filiere} onChange={(e) => setEditing({ ...editing, filiere: e.target.value })} className="input-modern py-1.5 w-full">
              {COMPETENCE_FILIERES.map((f) => <option key={f} value={f}>{COMPETENCE_FILIERE_LABELS[f]}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Période</label>
            <input value={editing.periode} maxLength={20} onChange={(e) => setEditing({ ...editing, periode: e.target.value })}
              placeholder="ex. M+3, 2026-T2" className="input-modern py-1.5 w-full" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Date d'évaluation</label>
            <input type="date" value={editing.date_evaluation} onChange={(e) => setEditing({ ...editing, date_evaluation: e.target.value })} className="input-modern py-1.5 w-full" />
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap bg-teal-50 border border-teal-200 rounded-lg p-2.5">
          <span className="text-sm text-teal-800 font-medium">Moyenne (N/E exclu) :</span>
          <span className="text-lg font-bold text-teal-700">{liveMoy.moyenne != null ? `${liveMoy.moyenne}/10` : '—'}</span>
          <span className="text-[11px] text-teal-600">{liveMoy.n} noté(s){liveMoy.ne ? `, ${liveMoy.ne} non évalué(s)` : ''}</span>
        </div>

        {refError && <div className="text-xs bg-red-50 border border-red-200 text-red-700 rounded-lg p-2">Référentiel indisponible : {refError}</div>}
        {referentiel.length === 0 && !refError && (
          <p className="text-sm text-gray-500 border border-dashed rounded-lg p-3 text-center">
            Aucune compétence dans le référentiel pour la filière « {COMPETENCE_FILIERE_LABELS[editing.filiere]} ».
            {adminRh && ' Un administrateur peut le compléter dans Réglages insertion.'}
          </p>
        )}

        {grouped.map(([rubrique, items]) => (
          <div key={rubrique} className="bg-white rounded-lg border p-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{rubrique}</p>
            {items.map((it) => (
              <ScoreRow key={it.id} label={it.item} sc={editing.scoresByRef[it.id] || {}}
                onChange={(patch) => setScore(it.id, patch)} readOnly={!canEdit} />
            ))}
          </div>
        ))}

        {editing.orphans?.length > 0 && (
          <div className="bg-white rounded-lg border p-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Éléments hors référentiel actuel</p>
            {editing.orphans.map((o, i) => (
              <ScoreRow key={i} label={`${o.rubrique ? o.rubrique + ' — ' : ''}${o.item || 'Item'}`} sc={o}
                onChange={(patch) => setOrphan(i, patch)} readOnly={!canEdit} />
            ))}
          </div>
        )}

        <div>
          <label className="block text-xs text-gray-500 mb-1">Synthèse de l'encadrant</label>
          <textarea value={editing.synthese} disabled={!canEdit} onChange={(e) => setEditing({ ...editing, synthese: e.target.value })} rows={2} className="input-modern py-1 w-full" />
        </div>

        <div className="bg-gray-50 rounded-lg p-3 space-y-1">
          <p className="text-xs font-semibold text-gray-600 mb-1">Validations (horodatées)</p>
          <ValidationRow k="salarie" label="Vu avec le salarié" validations={editing.validations} onToggle={toggleValidation} readOnly={!canEdit} />
          <ValidationRow k="eti" label="Encadrant technique" validations={editing.validations} onToggle={toggleValidation} readOnly={!canEdit} />
          <ValidationRow k="cip" label="CIP" validations={editing.validations} onToggle={toggleValidation} readOnly={!canEdit} />
          {!canValidate && <p className="text-[11px] text-gray-400">Les 3 validations permettent de « Valider » l'évaluation (sinon elle reste en brouillon).</p>}
        </div>

        {saveError && <div className="text-xs bg-red-50 border border-red-200 text-red-700 rounded-lg p-2">{saveError}</div>}

        {canEdit && (
          <div className="flex items-center justify-end gap-2 flex-wrap">
            <button type="button" onClick={() => save('brouillon')} disabled={saving}
              className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50 disabled:opacity-50">
              {saving ? 'Enregistrement…' : 'Enregistrer (brouillon)'}
            </button>
            <button type="button" onClick={() => save('valide')} disabled={saving}
              title={canValidate ? undefined : 'Astuce : cochez les 3 validations avant de valider'}
              className="px-4 py-2 rounded-lg bg-teal-600 text-white text-sm font-medium hover:bg-teal-700 disabled:opacity-50">
              {saving ? '…' : 'Valider'}
            </button>
          </div>
        )}
      </div>
    );
  }

  // ── Liste + historique ──
  const prevMoy = evaluations.length > 1 ? evaluations[1].moyenne : null;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h3 className="font-semibold text-gray-800">Compétences métier (encadrant technique)</h3>
          <p className="text-[11px] text-gray-400">Notes /10 par item, « N/E » exclu de la moyenne. Sans donnée santé/judiciaire.</p>
        </div>
        {canEdit && (
          <button type="button" onClick={startNew}
            className="px-3 py-1.5 rounded-lg bg-teal-600 text-white text-xs font-medium hover:bg-teal-700 whitespace-nowrap">
            + Nouvelle évaluation
          </button>
        )}
      </div>

      {error && <div className="text-xs bg-red-50 border border-red-200 text-red-700 rounded-lg p-2">{error}</div>}

      {evaluations.length === 0 ? (
        <p className="text-sm text-gray-400 border border-dashed rounded-lg p-4 text-center">
          Aucune évaluation de compétences pour ce salarié.
          {canEdit ? ' Créez la première avec « + Nouvelle évaluation ».' : ''}
        </p>
      ) : (
        <div className="space-y-2">
          {evaluations.map((ev, i) => {
            const delta = i === 0 && prevMoy != null && ev.moyenne != null ? Math.round((ev.moyenne - prevMoy) * 10) / 10 : null;
            return (
              <div key={ev.id} className="bg-white rounded-lg border p-3">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="min-w-0">
                    <span className="font-medium text-gray-800">{COMPETENCE_FILIERE_LABELS[ev.filiere] || ev.filiere || 'Filière ?'}</span>
                    {ev.periode && <span className="text-xs text-gray-500 ml-2">{ev.periode}</span>}
                    <span className="text-xs text-gray-400 ml-2">{frDate(ev.date_evaluation)}</span>
                    {(ev.evaluateur_first || ev.evaluateur_last) && (
                      <span className="text-[11px] text-gray-400 ml-2">par {ev.evaluateur_first || ''} {ev.evaluateur_last || ''}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-xs px-2 py-0.5 rounded ${ev.statut === 'valide' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                      {COMPETENCE_STATUT_LABELS[ev.statut] || ev.statut}
                    </span>
                    <span className="text-sm font-bold text-teal-700">{ev.moyenne != null ? `${ev.moyenne}/10` : '—'}</span>
                    {delta != null && delta !== 0 && (
                      <span className={`text-xs font-medium ${delta > 0 ? 'text-green-600' : 'text-red-600'}`}>
                        {delta > 0 ? '↗' : '↘'} {delta > 0 ? '+' : ''}{delta}
                      </span>
                    )}
                    <button type="button" onClick={() => startEdit(ev)} className="text-xs text-teal-700 hover:underline">
                      {canEdit ? 'Modifier' : 'Consulter'}
                    </button>
                    {adminRh && <button type="button" onClick={() => remove(ev)} className="text-xs text-red-500 hover:underline">Supprimer</button>}
                  </div>
                </div>
                {ev.synthese && <p className="text-xs text-gray-600 mt-1.5 whitespace-pre-wrap">{ev.synthese}</p>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
