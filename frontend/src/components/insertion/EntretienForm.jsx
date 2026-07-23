import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import api from '../../services/api';
import {
  visibleFreins, canSeeField, FREIN_LEVEL_COLORS, JUDICIAIRE_LEGAL_NOTICE,
  ENTRETIEN_TYPE_LABELS, SORTIE_CLASS_LABELS, entretienLabel, frDate, isAdminRh,
} from './freins';
import { FreinPicker } from './DiagnosticForm';
import RadarFreins from './RadarFreins';
import ActionsPanel from './ActionsPanel';
import ObjectifsPanel from './ObjectifsPanel';
import { SatisfactionModal } from './SatisfactionForm';
import { exportEntretienPDF } from './pdf-insertion';
import { getInsertionParametres, PARAMETRES_DEFAUTS, plusMois } from './parametres';
import { useAuth } from '../../contexts/AuthContext';

/**
 * Formulaire d'entretien (tout type) — sections dans l'ordre de la trame papier
 * (REC-UX-02) : Situation → Évaluation du précédent → Freins → Questionnaire →
 * Objectifs → Actions → Planification/Clôture.
 *
 *  - « Enregistrer » (brouillon, PUT partiel, autosave 30 s) SÉPARÉ de
 *    « Clôturer » (POST /milestones/:id/close — contrôles) ;
 *  - check-list « Prêt à clôturer » permanente dans le rail ;
 *  - refus de clôture (409) affiché en panneau latéral avec ancres (problems[]) ;
 *  - évaluation du précédent : UNE ligne par élément, 3 boutons Fait / En
 *    partie / Non fait, échéance respectée CALCULÉE, jamais saisie (REC-UX-03) ;
 *  - blocs conditionnels par type (renouvellement, bilan de sortie, post-sortie) ;
 *  - entretien verrouillé (locked_at) : lecture seule + réouverture ADMIN/RH ;
 *  - « Préparer avec l'IA » (GET /ia/entretien?milestoneId=) — proposition
 *    étiquetée, jamais imposée ;
 *  - PDF « exemplaire salarié » (FALC) / « exemplaire dossier » (REC-UX-09).
 */

const AUTOSAVE_MS = 30000;
const IA_TIMEOUT = 120000;

const VERDICTS = [['ok', 'Fait'], ['partiel', 'En partie'], ['non_ok', 'Non fait']];
const VERDICT_COLORS = { ok: 'bg-green-600 border-green-600 text-white', partiel: 'bg-amber-500 border-amber-500 text-white', non_ok: 'bg-red-600 border-red-600 text-white' };
// Lot 8 — décision de fin de période d'essai (periode_essai_decision).
const PE_DECISIONS = [
  ['confirme', 'Période d\'essai confirmée', 'bg-green-600 border-green-600'],
  ['a_revoir', 'À revoir', 'bg-amber-500 border-amber-500'],
  ['rompu', 'Période d\'essai rompue', 'bg-red-600 border-red-600'],
];
const PE_DECISION_LABELS = { confirme: 'Période d\'essai confirmée', rompu: 'Période d\'essai rompue', a_revoir: 'À revoir' };

export default function EntretienForm({
  milestone, employeeId, employee = {}, allMilestones = [], onSaved, onClosed, onCloseForm, onDirtyChange,
}) {
  const { user } = useAuth();
  const adminRh = isAdminRh(user);
  const baseRole = user?.base_role || user?.role;
  const freins = visibleFreins(baseRole);
  const locked = !!milestone.locked_at;
  const readOnly = locked;

  const [form, setForm] = useState({ ...milestone });
  const [template, setTemplate] = useState(null);
  const [radarData, setRadarData] = useState(null);
  const [objectifs, setObjectifs] = useState([]);
  const [actions, setActions] = useState([]);
  const [step, setStep] = useState(0);
  const [savedAt, setSavedAt] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [problems, setProblems] = useState(null);
  const [closeModal, setCloseModal] = useState(false);
  const [closing, setClosing] = useState(false);
  const [relecture, setRelecture] = useState(false);
  const [satisfactionOpen, setSatisfactionOpen] = useState(false);
  const [reopenMotif, setReopenMotif] = useState('');
  const [reopenAsking, setReopenAsking] = useState(false);
  const [ia, setIa] = useState(milestone.ia_preparation || null);
  const [iaLoading, setIaLoading] = useState(false);
  const [iaError, setIaError] = useState(null);
  const pendingRef = useRef({});
  const timerRef = useRef(null);

  const type = milestone.milestone_type;
  const titre = entretienLabel(milestone);

  // Entretien précédent : chaînage explicite sinon dernier réalisé avant celui-ci.
  const prevMilestone = useMemo(() => {
    if (form.previous_milestone_id) {
      const p = allMilestones.find((m) => m.id === form.previous_milestone_id);
      if (p) return p;
    }
    return allMilestones
      .filter((m) => m.id !== milestone.id && m.status === 'realise')
      .sort((a, b) => new Date(b.completed_date || b.due_date) - new Date(a.completed_date || a.due_date))[0] || null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allMilestones, milestone.id, form.previous_milestone_id]);

  useEffect(() => {
    api.get(`/insertion/interview-template/${type}`).then((r) => setTemplate(r.data)).catch(() => setTemplate(null));
    api.get(`/insertion/milestones/${employeeId}/radar`).then((r) => setRadarData(r.data)).catch(() => {});
    api.get(`/insertion/objectifs/${employeeId}`).then((r) => setObjectifs(Array.isArray(r.data) ? r.data : [])).catch(() => setObjectifs([]));
    api.get(`/insertion/action-plans/${employeeId}`).then((r) => setActions(Array.isArray(r.data) ? r.data : [])).catch(() => setActions([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [milestone.id, employeeId, type]);

  // Pré-remplissage des freins depuis la dernière évaluation (pratique conservée).
  useEffect(() => {
    const hasFreins = freins.some((f) => milestone[f.column] != null);
    if (!hasFreins && prevMilestone && !readOnly) {
      setForm((f) => {
        const next = { ...f };
        let changed = false;
        freins.forEach((fr) => {
          if (next[fr.column] == null && prevMilestone[fr.column] != null) {
            next[fr.column] = prevMilestone[fr.column];
            pendingRef.current[fr.column] = prevMilestone[fr.column];
            changed = true;
          }
        });
        if (changed && onDirtyChange) onDirtyChange(true);
        return next;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [milestone.id, prevMilestone?.id]);

  // ── Évaluation du précédent : lignes = objectifs + actions de l'entretien
  // précédent, fusionnées avec le previous_review déjà stocké (REC-UX-03). ──
  const reviewRows = useMemo(() => {
    if (!prevMilestone) return [];
    const stored = Array.isArray(form.previous_review) ? form.previous_review : [];
    const byKey = new Map(stored.map((r) => [`${r.kind}:${r.id}`, r]));
    const rows = [];
    for (const o of objectifs.filter((o) => o.milestone_id === prevMilestone.id)) {
      const st = byKey.get(`objectif:${o.id}`) || {};
      rows.push({ kind: 'objectif', id: o.id, label: o.titre, echeance: o.echeance, verdict: st.verdict || null, commentaire: st.commentaire || '' });
    }
    for (const a of actions.filter((a) => a.milestone_id === prevMilestone.id)) {
      const st = byKey.get(`action:${a.id}`) || {};
      rows.push({ kind: 'action', id: a.id, label: a.action_label, echeance: a.echeance, verdict: st.verdict || null, commentaire: st.commentaire || '' });
    }
    // Repli : objectifs texte libre du bilan précédent (pas d'objectif structuré).
    if (rows.length === 0 && prevMilestone.objectifs_prochaine_periode) {
      const st = byKey.get('objectif:texte') || {};
      rows.push({ kind: 'objectif', id: 'texte', label: prevMilestone.objectifs_prochaine_periode, echeance: null, verdict: st.verdict || null, commentaire: st.commentaire || '' });
    }
    return rows;
  }, [prevMilestone, objectifs, actions, form.previous_review]);

  // Échéance respectée : CALCULÉE (référence = date de réalisation ou aujourd'hui).
  const refDate = form.completed_date ? new Date(form.completed_date) : new Date();
  const echeanceTenue = (row) => (row.echeance == null ? null : new Date(row.echeance) >= refDate);

  const setReviewRow = (row, patch) => {
    const next = reviewRows.map((r) => (r.kind === row.kind && r.id === row.id ? { ...r, ...patch } : r))
      .map((r) => ({ ...r, echeance_respectee: echeanceTenue(r) }));
    setField('previous_review', next);
  };

  // ── Autosave / écriture partielle ──
  const markDirty = useCallback((d) => { if (onDirtyChange) onDirtyChange(d); }, [onDirtyChange]);

  const flush = useCallback(async () => {
    if (readOnly) return true;
    const pending = pendingRef.current;
    if (Object.keys(pending).length === 0) return true;
    setSaving(true); setError(null);
    try {
      await api.put(`/insertion/milestones/${milestone.id}`, pending);
      pendingRef.current = {};
      setSavedAt(new Date());
      markDirty(false);
      if (onSaved) onSaved({ silent: true });
      setSaving(false);
      return true;
    } catch (err) {
      const d = err.response?.data;
      setError((d?.error || err.message) + (d?.hint ? ` — ${d.hint}` : ''));
      setSaving(false);
      return false;
    }
  }, [milestone.id, markDirty, onSaved, readOnly]);

  const setField = (field, value) => {
    if (readOnly) return;
    setForm((f) => ({ ...f, [field]: value }));
    pendingRef.current[field] = value;
    markDirty(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => flush(), AUTOSAVE_MS);
  };
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  // ── Étapes (ordre de la trame papier, blocs conditionnels par type) ──
  const steps = useMemo(() => {
    // Période d'essai (Lot 8) : formulaire court et focalisé (décision + avis),
    // précède le diagnostic social — pas de freins/objectifs/actions.
    if (type === 'periode_essai') {
      return [{ id: 'periode_essai', label: "Période d'essai" }, { id: 'cloture', label: 'Clôture' }];
    }
    const s = [{ id: 'situation', label: 'Situation' }];
    if (prevMilestone) s.push({ id: 'precedent', label: 'Depuis le dernier bilan' });
    s.push({ id: 'freins', label: 'Freins (toile)' });
    if (template) s.push({ id: 'questionnaire', label: 'Questionnaire' });
    s.push({ id: 'objectifs', label: 'Objectifs' });
    s.push({ id: 'actions', label: 'Actions' });
    if (type === 'renouvellement') s.push({ id: 'renouvellement', label: 'Avis de renouvellement' });
    if (type === 'bilan_sortie') s.push({ id: 'sortie', label: 'Sortie & documents' });
    s.push({ id: 'cloture', label: 'Clôture' });
    return s;
  }, [prevMilestone, template, type]);
  const cur = steps[Math.min(step, steps.length - 1)];
  const goToStep = async (i) => { await flush(); setStep(Math.max(0, Math.min(steps.length - 1, i))); };
  const goToStepId = (id) => { const i = steps.findIndex((s) => s.id === id); if (i >= 0) goToStep(i); };

  // ── Check-list « Prêt à clôturer » (REC-UX-02) ──
  const [assumeFreins, setAssumeFreins] = useState(false);
  const missingFreins = freins.filter((f) => form[f.column] == null);
  const nextPlanned = allMilestones.find((m) => m.id !== milestone.id && m.status === 'planifie');
  const checklist = useMemo(() => {
    // Période d'essai (Lot 8) : seule la décision est requise pour clôturer.
    if (type === 'periode_essai') {
      return [{
        id: 'decision',
        label: form.periode_essai_decision ? `Décision : ${PE_DECISION_LABELS[form.periode_essai_decision]}` : "Décision de période d'essai à prendre",
        ok: !!form.periode_essai_decision, step: 'periode_essai',
      }];
    }
    const items = [
      { id: 'situation', label: 'Situation renseignée', ok: !!(form.bilan_professionnel || form.bilan_social || form.post_sortie_situation), step: 'situation' },
    ];
    if (prevMilestone) {
      const done = reviewRows.filter((r) => r.verdict).length;
      items.push({ id: 'precedent', label: `Dernier bilan : ${done}/${reviewRows.length} éléments statués`, ok: reviewRows.length > 0 && done === reviewRows.length, step: 'precedent' });
    }
    items.push({
      id: 'freins',
      label: missingFreins.length === 0 ? `Freins : ${freins.length} évalués` : `Freins : ${freins.length - missingFreins.length} évalués, ${missingFreins.length} restants`,
      ok: missingFreins.length === 0 || assumeFreins, step: 'freins',
    });
    if (type === 'bilan_sortie') {
      items.push({ id: 'sortie', label: 'Catégorie de sortie choisie', ok: !!form.sortie_classification, step: 'sortie' });
      items.push({ id: 'docs', label: 'Documents de sortie pointés', ok: form.sortie_documents != null, step: 'sortie' });
    }
    if (!['bilan_sortie', 'suivi_post_sortie'].includes(type)) {
      items.push({ id: 'next', label: 'Prochain entretien planifié', ok: !!nextPlanned, step: 'cloture' });
    }
    return items;
  }, [form, prevMilestone, reviewRows, missingFreins.length, assumeFreins, nextPlanned, type, freins.length]);
  const checklistOk = checklist.filter((c) => c.ok).length;

  // ── Clôture contrôlée ──
  // Date du prochain entretien proposée = aujourd'hui + rythme de bilans
  // paramétré (insertion.rythme_bilans_mois, défaut 2 — REC-UX-18).
  const [rythmeMois, setRythmeMois] = useState(PARAMETRES_DEFAUTS.rythme_bilans_mois);
  const [nextForm, setNextForm] = useState({ milestone_type: 'bilan_intermediaire', due_date: plusMois(PARAMETRES_DEFAUTS.rythme_bilans_mois), interview_date: '' });
  useEffect(() => {
    getInsertionParametres().then((p) => {
      const m = Number(p.rythme_bilans_mois) || PARAMETRES_DEFAUTS.rythme_bilans_mois;
      setRythmeMois(m);
      // N'écrase la proposition que si l'utilisateur n'y a pas touché.
      setNextForm((f) => (f.due_date === plusMois(PARAMETRES_DEFAUTS.rythme_bilans_mois) ? { ...f, due_date: plusMois(m) } : f));
    });
  }, []);
  const [presence, setPresence] = useState(Array.isArray(milestone.validations) && milestone.validations.some((v) => v.mode === 'presence'));

  const doClose = async () => {
    setClosing(true); setProblems(null); setError(null);
    try {
      // 1. Le contrôle de clôture lit la BASE : on pousse d'abord le brouillon
      // (previous_review avec échéances calculées, freins, validations…).
      if (presence && !readOnly) {
        pendingRef.current.validations = [
          { role: 'salarie', at: new Date().toISOString(), mode: 'presence' },
          { role: 'cip', user_id: user?.id, at: new Date().toISOString(), mode: 'compte' },
        ];
      }
      const flushed = await flush();
      if (!flushed) { setClosing(false); return; }
      // 2. Clôture contrôlée.
      const body = { completed_date: form.completed_date || new Date().toISOString().slice(0, 10) };
      if (assumeFreins) body.assume_freins_non_evalues = true;
      if (!nextPlanned && !['bilan_sortie', 'suivi_post_sortie', 'periode_essai'].includes(type) && nextForm.milestone_type && nextForm.due_date) {
        body.next = { milestone_type: nextForm.milestone_type, due_date: nextForm.due_date };
        if (nextForm.interview_date) body.next.interview_date = nextForm.interview_date;
      }
      const res = await api.post(`/insertion/milestones/${milestone.id}/close`, body);
      setCloseModal(false);
      markDirty(false);
      if (onClosed) onClosed(res.data);
    } catch (err) {
      const d = err.response?.data;
      if (err.response?.status === 409 && Array.isArray(d?.problems)) {
        setProblems(d.problems);
        setCloseModal(false);
      } else {
        setError(d?.error || err.message);
      }
    }
    setClosing(false);
  };

  const doReopen = async () => {
    if (!reopenMotif.trim()) return;
    setError(null);
    try {
      await api.post(`/insertion/milestones/${milestone.id}/reopen`, { motif: reopenMotif.trim() });
      setReopenAsking(false);
      if (onSaved) onSaved({ reload: true });
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
  };

  const runIa = async () => {
    setIaLoading(true); setIaError(null);
    try {
      const r = await api.get(`/insertion/ia/entretien/${employeeId}?milestoneId=${milestone.id}`, { timeout: IA_TIMEOUT });
      setIa(r.data);
    } catch (err) {
      const d = err.response?.data;
      setIaError((d?.error || err.message) + (d?.hint ? ` — ${d.hint}` : ''));
    }
    setIaLoading(false);
  };

  const pdf = (variante) => {
    exportEntretienPDF({
      employee, milestone: { ...form },
      previousFreins: prevMilestone || null,
      actions: actions.filter((a) => a.milestone_id === milestone.id),
      variante,
    });
    // Trace de remise de l'exemplaire salarié (remise_salarie JSONB).
    if (variante === 'salarie' && !readOnly) {
      const trace = { ...(form.remise_salarie || {}), pdf_genere_at: new Date().toISOString(), par_user_id: user?.id };
      setField('remise_salarie', trace);
      flush();
    }
  };

  const problemStepFor = (code) => ({
    freins_non_evalues: 'freins',
    previous_review_manquante: 'precedent',
    sortie_classification_manquante: 'sortie',
    sortie_documents_manquants: 'sortie',
    prochain_entretien_manquant: 'cloture',
  }[code] || 'situation');

  const requestCloseForm = () => {
    if (Object.keys(pendingRef.current).length > 0
      && !window.confirm('Des modifications de cet entretien ne sont pas enregistrées. Fermer sans enregistrer ?')) return;
    markDirty(false);
    onCloseForm();
  };

  const docs = form.sortie_documents || {};
  const setDoc = (k, v) => setField('sortie_documents', { ...docs, [k]: v });
  const renou = form.renouvellement_form || {};
  const setRenou = (k, v) => setField('renouvellement_form', { ...renou, [k]: v });
  // Lot 8 — entretien de période d'essai : avis encadrant / CIP (periode_essai_form).
  const pef = form.periode_essai_form || {};
  const setPef = (k, v) => setField('periode_essai_form', { ...pef, [k]: v });

  return (
    <div className={`bg-white border rounded-lg ${relecture ? 'text-lg' : ''}`}>
      {/* ── En-tête ── */}
      <div className="border-b px-4 py-3 space-y-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <button type="button" onClick={requestCloseForm} className="text-gray-400 hover:text-gray-600 text-sm">← Retour</button>
            <h3 className="text-base font-bold text-gray-800">{titre}</h3>
            {locked && <span className="text-xs px-2 py-0.5 rounded-full bg-slate-700 text-white" title={`Clôturé le ${frDate(milestone.locked_at)}`}>🔒 Clôturé le {frDate(milestone.locked_at)}</span>}
            {!locked && form.status === 'realise' && <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700">Réalisé (non verrouillé)</span>}
          </div>
          <div className="flex items-center gap-2 text-xs">
            <label className="flex items-center gap-1.5 text-gray-500 cursor-pointer select-none" title="Gros caractères, notes internes masquées — pour relire ensemble avant validation">
              <input type="checkbox" checked={relecture} onChange={(e) => setRelecture(e.target.checked)} className="rounded border-gray-300" />
              Mode relecture
            </label>
            {adminRh && !locked && (
              <button type="button" onClick={runIa} disabled={iaLoading}
                className="px-2.5 py-1 rounded-lg bg-violet-600 text-white font-medium hover:bg-violet-700 disabled:opacity-50">
                {iaLoading ? 'Préparation…' : (ia ? 'Préparation IA ✓ (relancer)' : "Préparer avec l'IA")}
              </button>
            )}
            <button type="button" onClick={() => pdf('salarie')} className="px-2.5 py-1 rounded-lg border border-teal-300 text-teal-700 font-medium hover:bg-teal-50">PDF salarié</button>
            <button type="button" onClick={() => pdf('dossier')} className="px-2.5 py-1 rounded-lg border border-slate-300 text-slate-600 font-medium hover:bg-slate-50">PDF dossier</button>
          </div>
        </div>
        <div className="flex items-center gap-3 flex-wrap text-sm">
          <label className="flex items-center gap-1.5 text-gray-600">
            Date de l'entretien
            <input type="datetime-local" value={form.interview_date ? String(form.interview_date).substring(0, 16) : ''}
              onChange={(e) => setField('interview_date', e.target.value || null)} disabled={readOnly} className="input-modern py-1 text-xs" />
          </label>
          <label className="flex items-center gap-1.5 text-gray-600">
            Réalisé le
            <input type="date" value={form.completed_date ? String(form.completed_date).slice(0, 10) : ''}
              onChange={(e) => setField('completed_date', e.target.value || null)} disabled={readOnly} className="input-modern py-1 text-xs" />
          </label>
          <label className="flex items-center gap-1.5 text-gray-600 cursor-pointer select-none">
            <input type="checkbox" checked={presence} onChange={(e) => setPresence(e.target.checked)} disabled={readOnly} className="rounded border-gray-300" />
            Relu avec le salarié (validation en présence)
          </label>
          <span className="text-[11px] text-gray-400 ml-auto">
            {readOnly ? 'Lecture seule' : saving ? 'Enregistrement…' : savedAt ? `💾 Brouillon enregistré à ${savedAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : 'Sauvegarde automatique'}
          </span>
        </div>
        {error && (
          <div className="text-xs bg-red-50 border border-red-200 text-red-700 rounded-lg p-2 flex items-start gap-2">
            <span aria-hidden="true">⚠</span><span>{error}</span>
            <button type="button" onClick={() => setError(null)} className="ml-auto text-red-500" aria-label="Fermer">×</button>
          </div>
        )}
        {locked && (
          <div className="text-xs bg-slate-50 border border-slate-200 text-slate-600 rounded-lg p-2 flex items-center gap-2 flex-wrap">
            <span>Cet entretien est clôturé et verrouillé (état probant). Toute modification passe par une réouverture tracée.</span>
            {adminRh ? (
              reopenAsking ? (
                <span className="flex items-center gap-1.5 flex-wrap">
                  <input value={reopenMotif} onChange={(e) => setReopenMotif(e.target.value)} placeholder="Motif de réouverture (obligatoire)…" className="input-modern py-0.5 text-xs w-64" autoFocus />
                  <button type="button" onClick={doReopen} disabled={!reopenMotif.trim()} className="px-2 py-0.5 rounded bg-amber-600 text-white disabled:opacity-50">Réouvrir</button>
                  <button type="button" onClick={() => setReopenAsking(false)} className="text-gray-500">Annuler</button>
                </span>
              ) : (
                <button type="button" onClick={() => setReopenAsking(true)} className="px-2 py-0.5 rounded border border-amber-300 text-amber-700 hover:bg-amber-50">Réouvrir cet entretien…</button>
              )
            ) : (
              <span className="text-gray-400">Demandez la réouverture à un compte ADMIN ou RH.</span>
            )}
          </div>
        )}
        {/* Refus de clôture : check-list des problèmes, ancrée (REC-UX-02) */}
        {problems && (
          <div className="text-xs bg-red-50 border border-red-300 rounded-lg p-3 space-y-1.5">
            <p className="font-semibold text-red-700">Clôture refusée — il reste à faire :</p>
            {problems.map((p, i) => (
              <div key={i} className="flex items-start gap-2">
                <span className="text-red-500">●</span>
                <span className="flex-1 text-red-700">{p.message}</span>
                <button type="button" onClick={() => { setProblems(null); goToStepId(problemStepFor(p.code)); }}
                  className="underline text-red-700 hover:text-red-900 flex-shrink-0">Y aller</button>
              </div>
            ))}
            <button type="button" onClick={() => setProblems(null)} className="text-gray-400 underline">Masquer</button>
          </div>
        )}
        {iaError && <div className="text-xs bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-2">{iaError}</div>}
        {ia && (
          <details className="text-xs bg-violet-50 border border-violet-200 rounded-lg" open>
            <summary className="cursor-pointer select-none px-3 py-2 font-semibold text-violet-800">
              Proposition IA — préparation de l'entretien (à adapter, jamais imposée)
              {form.ia_preparation_at ? ` · générée le ${frDate(form.ia_preparation_at)}` : ''}
            </summary>
            <div className="px-3 pb-3 space-y-1.5">
              {ia.intro_conseillee && <p><span className="font-semibold text-violet-700">Introduction :</span> {ia.intro_conseillee}</p>}
              {ia.questions_cles?.length > 0 && (
                <ul className="list-disc list-inside space-y-0.5">
                  {ia.questions_cles.map((q, i) => <li key={i}>{q.question}{q.conseil_pcm ? <span className="text-gray-400 italic"> — {q.conseil_pcm}</span> : null}</li>)}
                </ul>
              )}
              {ia.freins_a_aborder?.length > 0 && (
                <p><span className="font-semibold text-violet-700">Freins à aborder :</span> {ia.freins_a_aborder.map((f) => (typeof f === 'string' ? f : f.frein)).join(', ')}</p>
              )}
              {ia.points_vigilance?.length > 0 && !relecture && (
                <p className="text-amber-800"><span className="font-semibold">Vigilances (interne) :</span> {ia.points_vigilance.join(' · ')}</p>
              )}
              {ia.conclusion_conseillee && <p><span className="font-semibold text-violet-700">Conclusion :</span> {ia.conclusion_conseillee}</p>}
            </div>
          </details>
        )}
      </div>

      <div className="flex flex-col md:flex-row">
        {/* ── Rail d'étapes + check-list de clôture ── */}
        <nav className="md:w-52 border-b md:border-b-0 md:border-r p-2 flex md:flex-col gap-1 overflow-x-auto flex-shrink-0">
          {steps.map((s, i) => (
            <button key={s.id} type="button" onClick={() => goToStep(i)}
              className={`px-2.5 py-1.5 rounded-lg text-left text-xs whitespace-nowrap md:whitespace-normal transition ${i === Math.min(step, steps.length - 1) ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>
              {i + 1}. {s.label}
            </button>
          ))}
          {!readOnly && (
            <div className="hidden md:block mt-3 border-t pt-2 space-y-1">
              <p className="text-[11px] font-semibold text-slate-500">Prêt à clôturer : {checklistOk}/{checklist.length}</p>
              <div className="w-full bg-gray-200 rounded-full h-1.5">
                <div className={`h-1.5 rounded-full transition-all ${checklistOk === checklist.length ? 'bg-green-500' : 'bg-amber-400'}`}
                  style={{ width: `${(checklistOk / Math.max(1, checklist.length)) * 100}%` }} />
              </div>
              {checklist.map((c) => (
                <button key={c.id} type="button" onClick={() => goToStepId(c.step)}
                  className={`block w-full text-left text-[11px] ${c.ok ? 'text-green-700' : 'text-gray-400 hover:text-gray-600'}`}>
                  {c.ok ? '✓' : '○'} {c.label}
                </button>
              ))}
            </div>
          )}
        </nav>

        {/* ── Contenu de l'étape ── */}
        <div className="flex-1 p-4 space-y-4 min-w-0">
          <h4 className="font-semibold text-gray-700">Étape {Math.min(step, steps.length - 1) + 1}/{steps.length} — {cur.label}</h4>

          {cur.id === 'situation' && (
            <div className="space-y-3">
              {type === 'diagnostic_accueil' && (
                <p className="text-xs text-teal-700 bg-teal-50 border border-teal-200 rounded-lg p-2">
                  Le contenu du diagnostic d'accueil se remplit dans l'onglet « Diagnostic ». Utilisez cet écran pour la planification, les freins du jour et la clôture.
                </p>
              )}
              {type === 'suivi_post_sortie' && (
                <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 space-y-2">
                  <label className="block text-sm font-medium text-purple-800">Situation constatée (post-sortie)</label>
                  <div className="flex flex-wrap gap-1.5">
                    {[['emploi_durable', 'Emploi durable'], ['emploi_transition', 'Emploi de transition'], ['formation', 'En formation'], ['recherche_emploi', "Recherche d'emploi"], ['autre', 'Autre'], ['injoignable', 'Injoignable']].map(([v, l]) => (
                      <button key={v} type="button" disabled={readOnly} onClick={() => setField('post_sortie_situation', form.post_sortie_situation === v ? null : v)}
                        className={`px-3 py-1 rounded-lg border text-sm ${form.post_sortie_situation === v ? 'bg-purple-600 border-purple-600 text-white' : 'bg-white border-gray-300 text-gray-600 hover:border-purple-400'}`}>
                        {l}
                      </button>
                    ))}
                  </div>
                  <textarea value={form.post_sortie_commentaire || ''} onChange={(e) => setField('post_sortie_commentaire', e.target.value)} disabled={readOnly}
                    placeholder="Précisions sur la situation constatée…" rows={2} className="input-modern py-1 w-full text-sm" />
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Situation professionnelle (au poste)</label>
                  <textarea value={form.bilan_professionnel || ''} onChange={(e) => setField('bilan_professionnel', e.target.value)} disabled={readOnly} rows={3} className="input-modern py-1 w-full" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Situation sociale / administrative</label>
                  <textarea value={form.bilan_social || ''} onChange={(e) => setField('bilan_social', e.target.value)} disabled={readOnly} rows={3} className="input-modern py-1 w-full" />
                </div>
              </div>
              {!relecture && (
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Nouveaux éléments / observations (interne)</label>
                  <textarea value={form.observations || ''} onChange={(e) => setField('observations', e.target.value)} disabled={readOnly} rows={2} className="input-modern py-1 w-full" />
                </div>
              )}
            </div>
          )}

          {cur.id === 'precedent' && prevMilestone && (
            <div className="space-y-3">
              <p className="text-xs text-gray-500">
                Éléments repris automatiquement de « {entretienLabel(prevMilestone)} »
                ({frDate(prevMilestone.completed_date || prevMilestone.due_date)}). Un clic par ligne — l'échéance respectée est calculée, rien à saisir.
              </p>
              {reviewRows.length === 0 && (
                <p className="text-sm text-gray-400 border border-dashed rounded-lg p-3">
                  Le bilan précédent n'a ni objectif ni action rattachés : rien à statuer.
                </p>
              )}
              {reviewRows.map((row) => {
                const tenue = echeanceTenue(row);
                return (
                  <div key={`${row.kind}:${row.id}`} className="border rounded-lg p-2.5 space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">{row.kind === 'action' ? 'Action CIP' : 'Objectif'}</span>
                      <span className="text-sm text-gray-800 flex-1 min-w-[160px]">« {row.label} »</span>
                      {row.echeance && (
                        <span className={`text-[11px] px-1.5 py-0.5 rounded ${tenue ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
                          échéance {frDate(row.echeance)} ({tenue ? 'tenue' : 'passée'})
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {VERDICTS.map(([v, l]) => (
                        <button key={v} type="button" disabled={readOnly} onClick={() => setReviewRow(row, { verdict: row.verdict === v ? null : v })}
                          className={`px-3 py-1 rounded-lg border text-sm transition ${row.verdict === v ? VERDICT_COLORS[v] : 'bg-white border-gray-300 text-gray-600 hover:border-gray-400'}`}>
                          {l}
                        </button>
                      ))}
                      <details className="text-xs text-gray-400 ml-1">
                        <summary className="cursor-pointer select-none hover:text-gray-600">+ commentaire</summary>
                        <input value={row.commentaire || ''} onChange={(e) => setReviewRow(row, { commentaire: e.target.value })} disabled={readOnly}
                          placeholder="Pourquoi ? (facultatif)" className="input-modern py-1 text-xs mt-1 w-64" />
                      </details>
                    </div>
                  </div>
                );
              })}
              {reviewRows.some((r) => ['non_ok', 'partiel'].includes(r.verdict)) && (
                <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
                  Les éléments « Non fait » / « En partie » sont à reprendre à l'étape Objectifs (report vers la prochaine période).
                </p>
              )}
            </div>
          )}

          {cur.id === 'freins' && (
            <div className="space-y-3">
              <p className="text-xs text-gray-500">Freins repris de la dernière évaluation — ajustez ce qui a bougé. « Non évalué » = non abordé ce jour.</p>
              <div className="space-y-2">
                {freins.map((f) => (
                  <div key={f.key} className="flex items-center justify-between gap-2 flex-wrap bg-gray-50 rounded-lg p-2">
                    <span className="text-sm font-medium text-gray-700 w-28">{f.label}
                      {form[f.column] != null && <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded ${FREIN_LEVEL_COLORS[form[f.column]]}`}>{form[f.column]}/5</span>}
                    </span>
                    {readOnly ? (
                      <span className="text-xs text-gray-500">{form[f.column] != null ? `${form[f.column]}/5` : 'non évalué'}</span>
                    ) : (
                      <FreinPicker value={form[f.column] ?? null} onChange={(v) => setField(f.column, v)} compact />
                    )}
                  </div>
                ))}
              </div>
              {freins.some((f) => f.key === 'judiciaire') && form.frein_judiciaire != null && (
                <p className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">{JUDICIAIRE_LEGAL_NOTICE}</p>
              )}
              {radarData && radarData.series.length > 0 && (
                <div className="border rounded-lg p-3">
                  <RadarFreins data={radarData} />
                </div>
              )}
            </div>
          )}

          {cur.id === 'questionnaire' && template && (
            <div className="space-y-3">
              <p className="text-sm text-gray-500">{template.description}</p>
              {template.sections.map((section, si) => (
                <div key={si} className="bg-gray-50 rounded-lg p-3 space-y-2">
                  <h5 className="font-medium text-gray-700 text-sm">{section.titre}</h5>
                  {!relecture && section.questions.map((q, qi) => (
                    <p key={qi} className="text-xs text-gray-500 italic ml-2">– {q}</p>
                  ))}
                  <textarea value={form[section.champ] || ''} onChange={(e) => setField(section.champ, e.target.value)} disabled={readOnly}
                    placeholder={`Réponses et observations pour « ${section.titre} »…`} className="input-modern py-1 w-full" rows={3} />
                </div>
              ))}
            </div>
          )}

          {cur.id === 'objectifs' && (
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Objectifs réalisés depuis le dernier point</label>
                  <textarea value={form.objectifs_realises || ''} onChange={(e) => setField('objectifs_realises', e.target.value)} disabled={readOnly} rows={2} className="input-modern py-1 w-full" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Objectifs pour la prochaine période</label>
                  <textarea value={form.objectifs_prochaine_periode || ''} onChange={(e) => setField('objectifs_prochaine_periode', e.target.value)} disabled={readOnly} rows={2} className="input-modern py-1 w-full" />
                </div>
              </div>
              <div className="border-t pt-3">
                <ObjectifsPanel employeeId={employeeId} canEdit={adminRh && !readOnly} compact
                  onChanged={() => api.get(`/insertion/objectifs/${employeeId}`).then((r) => setObjectifs(Array.isArray(r.data) ? r.data : [])).catch(() => {})} />
              </div>
            </div>
          )}

          {cur.id === 'actions' && (
            <ActionsPanel employeeId={employeeId} employeeName={`${employee.first_name || ''} ${employee.last_name || ''}`}
              milestoneId={milestone.id} readOnly={readOnly}
              onChanged={() => api.get(`/insertion/action-plans/${employeeId}`).then((r) => setActions(Array.isArray(r.data) ? r.data : [])).catch(() => {})} />
          )}

          {cur.id === 'periode_essai' && (
            <div className="space-y-4">
              <p className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-2">
                Entretien de fin de période d'essai — point de bascule officiel vers l'accompagnement. La décision est
                obligatoire pour clôturer. « Rompue » clôt le parcours ; « confirmée » ou « à revoir » le poursuit.
              </p>

              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1.5">Décision de fin de période d'essai</label>
                <div className="flex flex-wrap gap-2">
                  {PE_DECISIONS.map(([v, l, color]) => (
                    <button key={v} type="button" disabled={readOnly}
                      onClick={() => setField('periode_essai_decision', form.periode_essai_decision === v ? null : v)}
                      className={`px-4 py-2.5 rounded-lg border text-sm font-medium transition ${
                        form.periode_essai_decision === v ? `${color} text-white` : 'bg-white border-gray-300 text-gray-600 hover:border-gray-400'
                      } disabled:opacity-60`}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-white border rounded-lg p-3">
                {[['integration', 'Intégration dans l\'équipe'], ['consignes', 'Compréhension des consignes'], ['assiduite', 'Assiduité / ponctualité']].map(([k, label]) => (
                  <div key={k}>
                    <p className="text-xs font-medium text-gray-500 mb-1">{label}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {[['bonne', 'Bonne'], ['moyenne', 'Moyenne'], ['insuffisante', 'Insuffisante']].map(([v, l]) => (
                        <button key={v} type="button" disabled={readOnly} onClick={() => setPef(k, pef[k] === v ? null : v)}
                          className={`px-2.5 py-1 rounded-lg border text-xs ${pef[k] === v ? 'bg-teal-600 border-teal-600 text-white' : 'bg-white border-gray-300 text-gray-600 hover:border-teal-400'} disabled:opacity-60`}>
                          {l}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Avis de l'encadrant technique</label>
                  <textarea value={pef.avis_encadrant || ''} onChange={(e) => setPef('avis_encadrant', e.target.value)} disabled={readOnly} rows={3} className="input-modern py-1 w-full" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Avis de la CIP</label>
                  <textarea value={pef.avis_cip || ''} onChange={(e) => setPef('avis_cip', e.target.value)} disabled={readOnly} rows={3} className="input-modern py-1 w-full" />
                </div>
              </div>
            </div>
          )}

          {cur.id === 'renouvellement' && (
            <div className="space-y-3 bg-amber-50/40 border border-amber-200 rounded-lg p-3">
              <p className="text-xs text-amber-800">Trame interne de renouvellement — remplie avec l'encadrant technique, transmise à la CIP.</p>
              {[['assiduite', 'Assiduité / ponctualité'], ['motivation', 'Motivation'], ['autonomie', 'Autonomie au poste'], ['participation', "Participation à l'accompagnement"]].map(([k, label]) => (
                <div key={k} className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-sm text-gray-700">{label}</span>
                  <div className="flex gap-1.5">
                    {[['bonne', 'Bonne'], ['moyenne', 'Moyenne'], ['insuffisante', 'Insuffisante']].map(([v, l]) => (
                      <button key={v} type="button" disabled={readOnly} onClick={() => setRenou(k, renou[k] === v ? null : v)}
                        className={`px-3 py-1 rounded-lg border text-sm ${renou[k] === v ? 'bg-amber-600 border-amber-600 text-white' : 'bg-white border-gray-300 text-gray-600 hover:border-amber-400'}`}>
                        {l}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Motifs / commentaires</label>
                <textarea value={renou.commentaires || ''} onChange={(e) => setRenou('commentaires', e.target.value)} disabled={readOnly} rows={2} className="input-modern py-1 w-full" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 border-t border-amber-200 pt-3">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Avis de renouvellement</label>
                  <div className="flex flex-wrap gap-1.5">
                    {[['favorable', 'Favorable'], ['favorable_reserves', 'Favorable avec réserves'], ['defavorable', 'Défavorable']].map(([v, l]) => (
                      <button key={v} type="button" disabled={readOnly} onClick={() => setField('renouvellement_avis', form.renouvellement_avis === v ? null : v)}
                        className={`px-3 py-1 rounded-lg border text-sm ${form.renouvellement_avis === v
                          ? (v === 'defavorable' ? 'bg-red-600 border-red-600 text-white' : v === 'favorable_reserves' ? 'bg-amber-500 border-amber-500 text-white' : 'bg-green-600 border-green-600 text-white')
                          : 'bg-white border-gray-300 text-gray-600'}`}>
                        {l}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1">Durée proposée</label>
                  <div className="flex flex-wrap gap-1.5 items-center">
                    {[2, 4, 6].map((m) => (
                      <button key={m} type="button" disabled={readOnly} onClick={() => setField('renouvellement_duree_mois', form.renouvellement_duree_mois === m ? null : m)}
                        className={`px-3 py-1 rounded-lg border text-sm ${form.renouvellement_duree_mois === m ? 'bg-teal-600 border-teal-600 text-white' : 'bg-white border-gray-300 text-gray-600'}`}>
                        {m} mois
                      </button>
                    ))}
                    <input type="number" min="1" max="24" placeholder="autre"
                      value={[2, 4, 6].includes(form.renouvellement_duree_mois) ? '' : (form.renouvellement_duree_mois ?? '')}
                      onChange={(e) => setField('renouvellement_duree_mois', e.target.value === '' ? null : parseInt(e.target.value, 10))}
                      disabled={readOnly} className="input-modern py-1 w-20 text-sm" />
                  </div>
                </div>
              </div>
            </div>
          )}

          {cur.id === 'sortie' && (
            <div className="space-y-3 bg-purple-50/40 border border-purple-200 rounded-lg p-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Catégorie de sortie (nomenclature IAE)</label>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(SORTIE_CLASS_LABELS).map(([v, l]) => (
                    <button key={v} type="button" disabled={readOnly} onClick={() => setField('sortie_classification', form.sortie_classification === v ? null : v)}
                      className={`px-3 py-1 rounded-lg border text-sm ${form.sortie_classification === v ? 'bg-purple-600 border-purple-600 text-white' : 'bg-white border-gray-300 text-gray-600 hover:border-purple-400'}`}>
                      {l}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-gray-400 mt-1">Emploi durable, emploi de transition et sortie positive comptent comme « sorties dynamiques ».</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Type de sortie</label>
                  <select value={form.sortie_type || ''} onChange={(e) => setField('sortie_type', e.target.value || null)} disabled={readOnly} className="input-modern py-1 w-full">
                    <option value="">Sélectionner…</option>
                    <option value="CDI">CDI</option>
                    <option value="CDD">CDD &gt; 6 mois</option>
                    <option value="CDD_court">CDD &lt; 6 mois</option>
                    <option value="interim">Intérim</option>
                    <option value="formation">Formation qualifiante</option>
                    <option value="creation_activite">Création d'activité</option>
                    <option value="autre_IAE">Autre structure IAE</option>
                    <option value="sans_suite">Sans suite / abandon</option>
                    <option value="fin_contrat">Fin de contrat sans solution</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Employeur / organisme</label>
                  <input value={form.sortie_employeur || ''} onChange={(e) => setField('sortie_employeur', e.target.value)} disabled={readOnly} className="input-modern py-1 w-full" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">SIRET (optionnel)</label>
                  <input pattern="\d{14}" maxLength="14" value={form.sortie_employeur_siret || ''}
                    onChange={(e) => setField('sortie_employeur_siret', e.target.value)} disabled={readOnly} className="input-modern py-1 w-full" placeholder="14 chiffres" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Durée du contrat (mois)</label>
                  <input type="number" min="0" max="60" value={form.sortie_duree_contrat_mois ?? ''}
                    onChange={(e) => setField('sortie_duree_contrat_mois', e.target.value === '' ? null : parseInt(e.target.value, 10))} disabled={readOnly} className="input-modern py-1 w-full" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Documents remis au salarié (check-list obligatoire à la clôture)</label>
                <div className="flex flex-wrap gap-2">
                  {[['stc', 'Solde de tout compte'], ['certificat_travail', 'Certificat de travail'], ['attestation_france_travail', 'Attestation France Travail']].map(([k, l]) => (
                    <label key={k} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm cursor-pointer ${docs[k] ? 'bg-green-50 border-green-300 text-green-800' : 'bg-white border-gray-300 text-gray-600'}`}>
                      <input type="checkbox" checked={!!docs[k]} onChange={(e) => setDoc(k, e.target.checked)} disabled={readOnly} className="rounded border-gray-300" />
                      {l}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Commentaires de sortie</label>
                <textarea value={form.sortie_commentaires || ''} onChange={(e) => setField('sortie_commentaires', e.target.value)} disabled={readOnly} rows={2} className="input-modern py-1 w-full" />
              </div>
              {/* Questionnaire de satisfaction de sortie (EXG-09) — rempli AVEC le
                  salarié pendant le bilan ; consultable même une fois verrouillé. */}
              <div className="border-t border-purple-200 pt-2 flex items-center justify-between gap-2 flex-wrap">
                <p className="text-xs text-purple-800">
                  Questionnaire de satisfaction de sortie — à remplir avec le salarié (smileys).
                </p>
                <button type="button" onClick={() => setSatisfactionOpen(true)}
                  className="px-3 py-1.5 rounded-lg border border-purple-300 text-purple-700 text-xs font-medium hover:bg-purple-50">
                  {adminRh && !locked ? 'Remplir le questionnaire…' : 'Voir le questionnaire…'}
                </button>
              </div>
            </div>
          )}

          {cur.id === 'cloture' && (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Avis global</label>
                <div className="flex gap-2 flex-wrap">
                  {[['tres_positif', 'Très positif', 'bg-green-600'], ['positif', 'Positif', 'bg-green-400'], ['mitige', 'Mitigé', 'bg-yellow-500'], ['insuffisant', 'Insuffisant', 'bg-red-500']].map(([val, label, color]) => (
                    <button key={val} type="button" disabled={readOnly} onClick={() => setField('avis_global', form.avis_global === val ? null : val)}
                      className={`px-3 py-1 rounded text-sm text-white ${form.avis_global === val ? color : 'bg-gray-300'}`}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="border rounded-lg p-3 space-y-1.5">
                <p className="text-sm font-semibold text-gray-700">Check-list de clôture — {checklistOk}/{checklist.length}</p>
                {checklist.map((c) => (
                  <div key={c.id} className={`text-sm flex items-center gap-2 ${c.ok ? 'text-green-700' : 'text-gray-500'}`}>
                    <span>{c.ok ? '✓' : '○'}</span><span>{c.label}</span>
                    {!c.ok && <button type="button" onClick={() => goToStepId(c.step)} className="text-xs text-teal-700 underline">compléter</button>}
                  </div>
                ))}
                {type !== 'periode_essai' && missingFreins.length > 0 && (
                  <label className="flex items-center gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2 cursor-pointer">
                    <input type="checkbox" checked={assumeFreins} onChange={(e) => setAssumeFreins(e.target.checked)} disabled={readOnly} className="rounded border-gray-300" />
                    J'assume la non-évaluation de : {missingFreins.map((f) => f.label).join(', ')} (non abordés ce jour).
                  </label>
                )}
              </div>
              {!readOnly && (
                <p className="text-xs text-gray-400">
                  « Enregistrer » conserve un brouillon modifiable. « Clôturer » vérifie la trame, planifie le prochain entretien et verrouille l'entretien (état probant).
                </p>
              )}
            </div>
          )}

          {/* Navigation + actions bas de page */}
          <div className="flex items-center justify-between border-t pt-3 flex-wrap gap-2">
            <button type="button" onClick={() => goToStep(step - 1)} disabled={step === 0}
              className="px-3 py-1.5 rounded-lg border text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40">
              ◄ Étape précédente
            </button>
            <div className="flex items-center gap-2">
              {!readOnly && (
                <button type="button" onClick={() => flush()} disabled={saving}
                  className="px-3 py-1.5 rounded-lg border border-blue-300 text-blue-700 text-sm font-medium hover:bg-blue-50 disabled:opacity-50">
                  {saving ? 'Enregistrement…' : 'Enregistrer le brouillon'}
                </button>
              )}
              {!readOnly && (
                <button type="button" onClick={() => setCloseModal(true)}
                  className="px-3 py-1.5 rounded-lg bg-green-700 text-white text-sm font-medium hover:bg-green-800">
                  Clôturer {type === 'bilan_sortie' ? 'le bilan de sortie' : "l'entretien"}…
                </button>
              )}
            </div>
            {step < steps.length - 1 ? (
              <button type="button" onClick={() => goToStep(step + 1)}
                className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700">
                Étape suivante ►
              </button>
            ) : <span className="w-28" />}
          </div>
        </div>
      </div>

      {/* ── Questionnaire de satisfaction de sortie (modale) ── */}
      {satisfactionOpen && (
        <SatisfactionModal
          employeeId={employeeId}
          milestoneId={milestone.id}
          canEdit={adminRh && !locked}
          onClose={() => setSatisfactionOpen(false)}
        />
      )}

      {/* ── Modale de clôture (REC-UX-02) ── */}
      {closeModal && (
        <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center px-4" onClick={() => setCloseModal(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-gray-800">Clôturer « {titre} »</h3>
            <div className="space-y-1">
              {checklist.map((c) => (
                <div key={c.id} className={`text-sm flex items-center gap-2 ${c.ok ? 'text-green-700' : 'text-red-600'}`}>
                  <span>{c.ok ? '✓' : '●'}</span><span>{c.label}</span>
                </div>
              ))}
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Date de réalisation</label>
              <input type="date" value={form.completed_date ? String(form.completed_date).slice(0, 10) : new Date().toISOString().slice(0, 10)}
                onChange={(e) => setField('completed_date', e.target.value)} className="input-modern py-1" />
            </div>
            {!nextPlanned && !['bilan_sortie', 'suivi_post_sortie', 'periode_essai'].includes(type) && (
              <div className="border rounded-lg p-3 space-y-2 bg-teal-50/40">
                <p className="text-xs font-semibold text-teal-800">Prochain entretien (obligatoire pour clôturer)</p>
                <div className="grid grid-cols-2 gap-2">
                  <select value={nextForm.milestone_type} onChange={(e) => setNextForm({ ...nextForm, milestone_type: e.target.value })} className="input-modern py-1 text-sm">
                    {['bilan_intermediaire', 'renouvellement', 'bilan_sortie'].map((t) => (
                      <option key={t} value={t}>{ENTRETIEN_TYPE_LABELS[t]}</option>
                    ))}
                  </select>
                  <input type="date" value={nextForm.due_date} onChange={(e) => setNextForm({ ...nextForm, due_date: e.target.value })} className="input-modern py-1 text-sm" />
                </div>
                <p className="text-[11px] text-gray-400">Proposé : dans {rythmeMois} mois (rythme de suivi usuel — ajustez librement).</p>
              </div>
            )}
            {nextPlanned && (
              <p className="text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg p-2">
                Prochain entretien déjà planifié : {entretienLabel(nextPlanned)} — {frDate(nextPlanned.due_date)}.
              </p>
            )}
            <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input type="checkbox" checked={presence} onChange={(e) => setPresence(e.target.checked)} className="rounded border-gray-300" />
              Relu avec le salarié (validation en présence)
            </label>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setCloseModal(false)} className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700">Annuler</button>
              <button type="button" onClick={doClose} disabled={closing}
                className="px-4 py-1.5 rounded-lg bg-green-700 text-white text-sm font-medium hover:bg-green-800 disabled:opacity-50">
                {closing ? 'Clôture…' : 'Clôturer et planifier'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
