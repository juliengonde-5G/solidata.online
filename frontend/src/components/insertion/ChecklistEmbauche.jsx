import { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';

/**
 * Check-list d'embauche / intégration (Lot 8 — EXG-30 / PROP-05).
 * 7 étapes (promesse, contrat, mutuelle, charte, livret, règlement, formation
 * au poste) : case « fait » + date + responsable. Barre de complétude.
 * Écriture ADMIN/RH (canEdit) ; MANAGER en lecture (le PUT est refusé côté
 * serveur, mais on désactive aussi les contrôles ici).
 *
 * Backend : GET/PUT /insertion/checklist-embauche/:employeeId (upsert fusion).
 */

const STEP_LABELS = {
  promesse_embauche: "Promesse d'embauche",
  contrat_signe: 'Contrat signé',
  mutuelle: 'Mutuelle / prévoyance',
  charte_insertion: "Charte d'insertion",
  livret_accueil: "Livret d'accueil remis",
  reglement_interieur: 'Règlement intérieur',
  formation_poste: 'Formation au poste',
};

export default function ChecklistEmbauche({ employeeId, canEdit = false, defaultOpen = false }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(defaultOpen);

  const load = useCallback(() => {
    api.get(`/insertion/checklist-embauche/${employeeId}`)
      .then((r) => { setData(r.data); setError(null); })
      .catch((err) => setError(err.response?.data?.error || err.message));
  }, [employeeId]);
  useEffect(() => load(), [load]);

  const steps = data?.steps || Object.keys(STEP_LABELS);
  const items = data?.items || {};
  const doneCount = steps.filter((s) => items[s]?.fait).length;
  const pct = steps.length ? Math.round((doneCount / steps.length) * 100) : 0;

  // Met à jour l'état local sans requête (frappe au clavier).
  const setLocalStep = (step, patch) => setData((d) => ({
    ...d, items: { ...d.items, [step]: { ...(d.items?.[step] || { fait: false, date: null, responsable: null }), ...patch } },
  }));

  // Enregistre un seul step (fusion serveur — les autres sont conservés).
  const saveStep = async (step, patch) => {
    if (!canEdit) return;
    const cur = items[step] || { fait: false, date: null, responsable: null };
    const next = { ...cur, ...patch };
    setData((d) => ({ ...d, items: { ...d.items, [step]: next } })); // optimiste
    setSaving(true); setError(null);
    try {
      await api.put(`/insertion/checklist-embauche/${employeeId}`, { items: { [step]: next } });
    } catch (err) {
      setError(err.response?.data?.error || err.message);
      load(); // resynchronise en cas d'échec
    }
    setSaving(false);
  };

  return (
    <div className="border border-gray-200 rounded-lg">
      <button type="button" onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left">
        <span className="font-medium text-gray-700 flex items-center gap-2">
          <span className="text-slate-400">{open ? '▾' : '▸'}</span>
          Accueil / intégration
        </span>
        <span className="flex items-center gap-2">
          <span className="text-xs text-gray-400">{doneCount}/{steps.length}</span>
          <span className="w-24 bg-gray-200 rounded-full h-1.5 hidden sm:block">
            <span className={`block h-1.5 rounded-full ${pct === 100 ? 'bg-green-500' : 'bg-teal-500'}`} style={{ width: `${pct}%` }} />
          </span>
        </span>
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-1.5">
          {error && <div className="text-xs bg-red-50 border border-red-200 text-red-700 rounded-lg p-2">{error}</div>}
          {!data && !error && <p className="text-xs text-gray-400">Chargement…</p>}
          {steps.map((step) => {
            const it = items[step] || {};
            return (
              <div key={step} className={`flex items-center gap-2 flex-wrap p-1.5 rounded ${it.fait ? 'bg-green-50/60' : ''}`}>
                <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer flex-1 min-w-[160px]">
                  <input type="checkbox" checked={!!it.fait} disabled={!canEdit || saving}
                    onChange={(e) => saveStep(step, { fait: e.target.checked, date: e.target.checked && !it.date ? new Date().toISOString().slice(0, 10) : it.date })}
                    className="rounded border-gray-300 w-4 h-4" />
                  {STEP_LABELS[step] || step}
                </label>
                {(it.fait || canEdit) && (
                  <>
                    <input type="date" value={it.date ? String(it.date).slice(0, 10) : ''} disabled={!canEdit}
                      onChange={(e) => saveStep(step, { date: e.target.value || null })}
                      className="input-modern py-0.5 text-xs w-36" />
                    <input value={it.responsable || ''} disabled={!canEdit} maxLength={150}
                      onChange={(e) => setLocalStep(step, { responsable: e.target.value })}
                      onBlur={(e) => saveStep(step, { responsable: e.target.value })}
                      placeholder="Responsable" className="input-modern py-0.5 text-xs w-32" />
                  </>
                )}
              </div>
            );
          })}
          {!canEdit && <p className="text-[11px] text-gray-400">Consultation — la saisie est réservée aux profils ADMIN/RH.</p>}
        </div>
      )}
    </div>
  );
}
