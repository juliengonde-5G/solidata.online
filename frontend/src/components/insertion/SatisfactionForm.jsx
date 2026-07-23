import { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';
import { frDate } from './freins';

/**
 * Questionnaire de satisfaction de sortie (EXG-09, PR 2) — à smileys.
 * Contrat backend :
 *   GET  /insertion/satisfaction/:employeeId → ligne | null ;
 *   POST /insertion/satisfaction/:employeeId (ADMIN/RH) → 201 (upsert par
 *        parcours : une ressaisie remplace la précédente — POST INTÉGRAL).
 * `reponses` JSONB : { clé de section: note 1-4 } (le backend agrège par clé).
 * Lecture seule après saisie, bouton « Modifier » (ADMIN/RH).
 */

// Sections de la trame — clés stables (agrégées anonymement par satisfaction-stats).
export const SATISFACTION_SECTIONS = [
  { key: 'accueil_integration', label: 'Accueil et intégration', question: "Comment s'est passée votre arrivée dans la structure ?" },
  { key: 'accompagnement', label: 'Accompagnement socio-professionnel', question: "L'accompagnement de la CIP vous a-t-il aidé ?" },
  { key: 'competences', label: 'Compétences acquises', question: 'Avez-vous appris des choses utiles pour la suite ?' },
  { key: 'conditions_travail', label: 'Conditions de travail', question: 'Les conditions de travail vous ont-elles convenu ?' },
  { key: 'bilan_personnel', label: 'Bilan personnel', question: 'Ce parcours vous a-t-il fait avancer personnellement ?' },
];

export const SATISFACTION_SECTION_LABELS = Object.fromEntries(SATISFACTION_SECTIONS.map((s) => [s.key, s.label]));

const SMILEYS = [
  { value: 1, emoji: '😞', label: 'Pas satisfait' },
  { value: 2, emoji: '😐', label: 'Moyennement' },
  { value: 3, emoji: '🙂', label: 'Satisfait' },
  { value: 4, emoji: '😄', label: 'Très satisfait' },
];

const SITUATIONS = [
  ['emploi', 'En emploi'],
  ['formation', 'En formation'],
  ['recherche_emploi', "En recherche d'emploi"],
  ['autre', 'Autre situation'],
];

function SmileyScale({ value, onChange, disabled, name }) {
  return (
    <div className="flex gap-2 flex-wrap" role="radiogroup" aria-label={name}>
      {SMILEYS.map((s) => (
        <button key={s.value} type="button" disabled={disabled}
          onClick={() => onChange(value === s.value ? null : s.value)}
          title={s.label} aria-pressed={value === s.value}
          className={`min-w-[52px] min-h-[48px] px-2 rounded-xl border-2 text-2xl transition flex flex-col items-center justify-center ${
            value === s.value ? 'border-teal-500 bg-teal-50 scale-105' : 'border-gray-200 bg-white hover:border-teal-300'
          } ${disabled ? 'opacity-60 cursor-default' : 'cursor-pointer'}`}>
          <span aria-hidden="true">{s.emoji}</span>
          <span className="text-[9px] text-gray-500 leading-tight">{s.label}</span>
        </button>
      ))}
    </div>
  );
}

export default function SatisfactionForm({ employeeId, milestoneId = null, canEdit = false, onSaved }) {
  const [row, setRow] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [form, setForm] = useState(null);

  const load = useCallback(() => {
    let alive = true;
    setLoading(true);
    api.get(`/insertion/satisfaction/${employeeId}`)
      .then((r) => {
        if (!alive) return;
        setRow(r.data || null);
        setError(null);
        setEditing(!r.data); // pas encore de réponse → saisie directe
      })
      .catch((err) => { if (alive) setError(err.response?.data?.error || err.message); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [employeeId]);

  useEffect(() => load(), [load]);

  // Formulaire initialisé depuis la ligne existante (ressaisie = POST intégral).
  useEffect(() => {
    const rep = (row?.reponses && typeof row.reponses === 'object') ? row.reponses : {};
    setForm({
      reponses: SATISFACTION_SECTIONS.reduce((acc, s) => {
        const v = Number(rep[s.key]);
        acc[s.key] = Number.isFinite(v) && v >= 1 && v <= 4 ? v : null;
        return acc;
      }, {}),
      satisfaction_globale: row?.satisfaction_globale ?? null,
      situation_sortie: row?.situation_sortie || '',
      suggestions: row?.suggestions || '',
      avis_transmis: row?.avis_transmis || '',
      date_reponse: row?.date_reponse ? String(row.date_reponse).slice(0, 10) : new Date().toISOString().slice(0, 10),
    });
  }, [row]);

  const submit = async () => {
    if (!form) return;
    setSaving(true); setError(null);
    try {
      const reponses = {};
      for (const [k, v] of Object.entries(form.reponses)) { if (v != null) reponses[k] = v; }
      const res = await api.post(`/insertion/satisfaction/${employeeId}`, {
        milestone_id: milestoneId || row?.milestone_id || null,
        date_reponse: form.date_reponse || null,
        reponses,
        satisfaction_globale: form.satisfaction_globale ?? null,
        situation_sortie: form.situation_sortie || null,
        suggestions: form.suggestions.trim() || null,
        avis_transmis: form.avis_transmis.trim() || null,
      });
      setRow(res.data);
      setEditing(false);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 3000);
      if (onSaved) onSaved(res.data);
    } catch (err) {
      setError(err.response?.data?.error || err.message);
    }
    setSaving(false);
  };

  if (loading || !form) return <p className="text-sm text-gray-400">Chargement du questionnaire…</p>;

  const readOnly = !editing || !canEdit;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h3 className="font-semibold text-gray-800">Questionnaire de satisfaction de sortie</h3>
          <p className="text-[11px] text-gray-400">
            Rempli avec le salarié à la sortie du parcours — une réponse par parcours (ressaisie possible).
            {row?.date_reponse ? ` Répondu le ${frDate(row.date_reponse)}.` : ''}
          </p>
        </div>
        {row && !editing && canEdit && (
          <button type="button" onClick={() => setEditing(true)}
            className="px-3 py-1.5 rounded-lg border border-teal-300 text-teal-700 text-xs font-medium hover:bg-teal-50">
            Modifier
          </button>
        )}
      </div>

      {error && <div className="text-xs bg-red-50 border border-red-200 text-red-700 rounded-lg p-2">{error}</div>}
      {savedFlash && <div className="text-xs bg-green-50 border border-green-200 text-green-700 rounded-lg p-2">✓ Questionnaire enregistré.</div>}
      {!row && !canEdit && (
        <p className="text-sm text-gray-400 border border-dashed rounded-lg p-3 text-center">
          Pas encore de questionnaire de satisfaction pour ce parcours (saisie ADMIN/RH).
        </p>
      )}

      {(row || canEdit) && (
        <div className="space-y-4">
          {SATISFACTION_SECTIONS.map((s) => (
            <div key={s.key} className="border rounded-lg p-3">
              <p className="text-sm font-medium text-gray-700">{s.label}</p>
              <p className="text-xs text-gray-400 mb-2">{s.question}</p>
              <SmileyScale name={s.label} value={form.reponses[s.key]} disabled={readOnly}
                onChange={(v) => setForm({ ...form, reponses: { ...form.reponses, [s.key]: v } })} />
            </div>
          ))}

          <div className="border rounded-lg p-3 bg-teal-50/40 border-teal-200">
            <p className="text-sm font-medium text-teal-800 mb-2">Satisfaction globale du parcours</p>
            <SmileyScale name="Satisfaction globale" value={form.satisfaction_globale} disabled={readOnly}
              onChange={(v) => setForm({ ...form, satisfaction_globale: v })} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Situation à la sortie</label>
              <div className="flex flex-wrap gap-1.5">
                {SITUATIONS.map(([v, l]) => (
                  <button key={v} type="button" disabled={readOnly}
                    onClick={() => setForm({ ...form, situation_sortie: form.situation_sortie === v ? '' : v })}
                    className={`px-3 py-2 rounded-lg border text-sm min-h-[40px] ${form.situation_sortie === v ? 'bg-teal-600 border-teal-600 text-white' : 'bg-white border-gray-300 text-gray-600'} ${readOnly ? 'opacity-60' : 'hover:border-teal-400'}`}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Date de réponse</label>
              <input type="date" value={form.date_reponse} disabled={readOnly}
                onChange={(e) => setForm({ ...form, date_reponse: e.target.value })} className="input-modern py-1.5" />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Suggestions pour améliorer le parcours</label>
              <textarea value={form.suggestions} disabled={readOnly} rows={2}
                onChange={(e) => setForm({ ...form, suggestions: e.target.value })} className="input-modern py-1 w-full" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Un avis à transmettre à l'équipe ?</label>
              <textarea value={form.avis_transmis} disabled={readOnly} rows={2}
                onChange={(e) => setForm({ ...form, avis_transmis: e.target.value })} className="input-modern py-1 w-full" />
            </div>
          </div>

          {editing && canEdit && (
            <div className="flex justify-end gap-2">
              {row && (
                <button type="button" onClick={() => { setEditing(false); setRow({ ...row }); }}
                  className="px-3 py-1.5 text-sm text-gray-500 hover:text-gray-700">Annuler</button>
              )}
              <button type="button" onClick={submit} disabled={saving}
                className="px-4 py-1.5 rounded-lg bg-teal-600 text-white text-sm font-medium hover:bg-teal-700 disabled:opacity-50">
                {saving ? 'Enregistrement…' : 'Enregistrer le questionnaire'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Modale autonome (utilisée depuis le bloc sortie d'EntretienForm). */
export function SatisfactionModal({ employeeId, milestoneId, canEdit, onClose }) {
  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center px-4 py-6 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl p-4 my-auto max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-end">
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg" aria-label="Fermer">×</button>
        </div>
        <SatisfactionForm employeeId={employeeId} milestoneId={milestoneId} canEdit={canEdit} />
      </div>
    </div>
  );
}
