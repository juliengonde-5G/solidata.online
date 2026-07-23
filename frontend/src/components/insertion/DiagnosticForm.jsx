import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import api from '../../services/api';
import {
  visibleFreins, canSeeField, FREIN_LEVEL_COLORS, JUDICIAIRE_LEGAL_NOTICE,
} from './freins';
import { exportDiagnosticPDF } from './pdf-insertion';

/**
 * Diagnostic d'accueil — STEPPER une rubrique à la fois (REC-UX-01) :
 *  - sommaire latéral cliquable + barre de progression ;
 *  - SAUVEGARDE AUTOMATIQUE : à chaque changement d'étape + debounce 30 s
 *    (PUT /insertion/diagnostic/:id PARTIEL, statut_saisie='en_cours') ;
 *  - bandeau « Brouillon enregistré à HH:MM », reprise à la première rubrique
 *    non complétée, saisie possible en 2 séances ;
 *  - étape finale « Terminer le diagnostic » (statut_saisie='complet').
 * Freins : boutons Non évalué / 1-5 (REC-UX-19), suggestion pré-calculée en
 * surbrillance, aide contextuelle (/freins-definitions), encadré légal pour
 * l'axe Judiciaire (niveau + impact organisationnel uniquement).
 * Mode relecture (REC-UX-17) : gros caractères, notes internes masquées.
 */

const AUTOSAVE_MS = 30000;

// ── Petits contrôles de saisie ──

function BoolPicker({ value, onChange, labels = ['Oui', 'Non'] }) {
  return (
    <div className="flex gap-1.5">
      {[[true, labels[0]], [false, labels[1]]].map(([v, l]) => (
        <button key={String(v)} type="button" onClick={() => onChange(value === v ? null : v)}
          className={`px-3 py-1 rounded-lg border text-sm transition ${value === v ? 'bg-teal-600 border-teal-600 text-white' : 'bg-white border-gray-300 text-gray-600 hover:border-teal-400'}`}>
          {l}
        </button>
      ))}
    </div>
  );
}

function ChoicePicker({ value, onChange, options }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(([v, l]) => (
        <button key={v} type="button" onClick={() => onChange(value === v ? null : v)}
          className={`px-3 py-1 rounded-lg border text-sm transition ${value === v ? 'bg-teal-600 border-teal-600 text-white' : 'bg-white border-gray-300 text-gray-600 hover:border-teal-400'}`}>
          {l}
        </button>
      ))}
    </div>
  );
}

function CheckGroup({ value = [], onChange, options }) {
  const arr = Array.isArray(value) ? value : [];
  const toggle = (v) => onChange(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(([v, l]) => (
        <button key={v} type="button" onClick={() => toggle(v)}
          className={`px-3 py-1.5 rounded-lg border text-sm transition ${arr.includes(v) ? 'bg-teal-50 border-teal-400 text-teal-800' : 'bg-white border-gray-300 text-gray-600 hover:border-teal-400'}`}>
          {arr.includes(v) ? '☑ ' : '☐ '}{l}
        </button>
      ))}
    </div>
  );
}

function FieldRow({ label, children, hint }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-600 mb-1">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-gray-400 mt-0.5">{hint}</p>}
    </div>
  );
}

/**
 * Rangée de saisie d'un niveau de frein : 6 boutons [Non évalué | 1..5]
 * (REC-UX-19 — fin des sliders ambigus). `suggestion` surligne le bouton
 * proposé ; la CIP confirme ou corrige d'un clic.
 * Exporté : réutilisé par EntretienForm.
 */
export function FreinPicker({ value, onChange, suggestion = null, compact = false }) {
  return (
    <div className="flex items-center gap-1 flex-wrap">
      <button type="button" onClick={() => onChange(null)}
        className={`px-2 py-1 rounded-lg border text-xs transition ${value == null ? 'bg-slate-600 border-slate-600 text-white' : 'bg-white border-gray-300 text-gray-500 hover:border-gray-400'}`}>
        Non évalué
      </button>
      {[1, 2, 3, 4, 5].map((n) => {
        const active = value === n;
        const suggested = !active && value == null && suggestion === n;
        return (
          <button key={n} type="button" onClick={() => onChange(active ? null : n)}
            title={suggested ? 'Niveau suggéré d\'après les réponses — cliquez pour confirmer' : undefined}
            className={`${compact ? 'w-8' : 'w-9'} py-1 rounded-lg border text-sm font-medium transition ${
              active ? `${FREIN_LEVEL_COLORS[n]} border-current` :
              suggested ? 'bg-teal-50 border-teal-500 text-teal-700 ring-2 ring-teal-200' :
              'bg-white border-gray-300 text-gray-600 hover:border-teal-400'
            }`}>
            {n}
          </button>
        );
      })}
      {suggestion != null && value == null && <span className="text-[10px] text-teal-600 ml-1">suggestion : {suggestion}</span>}
    </div>
  );
}

// ── Suggestions de niveau — REPLI LOCAL uniquement (phase D écart 1b : la
// source de vérité est le serveur, qui renvoie `suggestions_freins` dans la
// réponse du PUT /insertion/diagnostic ; ce pré-calcul ne sert qu'avant la
// première sauvegarde ou si le serveur ne renvoie rien). Jamais imposé — la
// CIP décide. ──
function computeSuggestions(d) {
  const s = {};
  if (d.logement_statut === 'sans_abri') s.logement = 5;
  else if (d.logement_statut === 'heberge') s.logement = 4;
  else if (d.logement_satisfaction === false) s.logement = 3;
  else if (d.logement_statut) s.logement = 1;
  if (d.permis_b_statut === 'non' && d.vehicule === false) s.mobilite = 4;
  else if (['code_en_cours', 'conduite_en_cours'].includes(d.permis_b_statut)) s.mobilite = 3;
  else if (d.permis_b_statut === 'oui' && d.vehicule) s.mobilite = 1;
  if (d.difficultes_financieres && d.credits_en_cours) s.finances = 4;
  else if (d.difficultes_financieres) s.finances = 3;
  else if (d.difficultes_financieres === false) s.finances = 1;
  if (d.piece_identite_validite && new Date(d.piece_identite_validite) < new Date()) s.administratif = 4;
  if (d.cecrl_niveau === 'A1') s.linguistique = 4;
  else if (d.cecrl_niveau === 'A2') s.linguistique = 3;
  else if (d.cecrl_niveau === 'B1') s.linguistique = 2;
  else if (['B2', 'C1', 'C2'].includes(d.cecrl_niveau)) s.linguistique = 1;
  if (d.contre_indications) s.sante = 3;
  return s;
}

// ── Définition des rubriques (étapes) — champs = whitelist du PUT backend ──
const STEPS = [
  { id: 'parcours', label: 'Parcours & famille', fields: ['parcours_anterieur', 'situation_familiale', 'nb_enfants', 'enfants_a_charge'] },
  { id: 'logement', label: 'Logement', fields: ['logement_statut', 'logement_satisfaction', 'commentaire_logement'] },
  { id: 'droits', label: 'Droits & administratif', fields: ['piece_identite_validite', 'allocataire_caf', 'ressources', 'commentaire_droits'] },
  { id: 'sante', label: 'Santé', fields: ['mutuelle_statut', 'rqth', 'rqth_fin', 'contre_indications', 'suivi_sante', 'commentaire_sante'], sensible: true },
  { id: 'budget', label: 'Budget', fields: ['difficultes_financieres', 'credits_en_cours', 'commentaire_budget'] },
  { id: 'mobilite', label: 'Mobilité', fields: ['permis_b_statut', 'vehicule', 'moyen_transport', 'commentaire_mobilite'] },
  { id: 'linguistique', label: 'Français & langues', fields: ['cecrl_niveau', 'commentaire_linguistique'] },
  { id: 'situation_pro', label: 'Situation professionnelle', fields: ['autre_employeur', 'autre_employeur_heures', 'souhait_complement_heures'] },
  { id: 'projet', label: 'Projet professionnel', fields: ['niveau_formation', 'metiers_souhaites', 'pret_a_se_former', 'cpf_accessible', 'projet_formation', 'emploi_vise', 'commentaire_projet'] },
  { id: 'expression', label: 'Expression du salarié', fields: ['attentes_parcours', 'difficultes_exprimees', 'objectifs_exprimes', 'aide_souhaitee'] },
  { id: 'fse', label: 'Données FSE+ (entrée)', fields: ['fse_entree'] },
  { id: 'freins', label: 'Freins & synthèse', fields: [] }, // complétude calculée sur les scores
];

const isFilled = (v) => v != null && v !== '' && !(Array.isArray(v) && v.length === 0)
  && !(typeof v === 'object' && !Array.isArray(v) && Object.values(v).every((x) => x == null || x === ''));

export default function DiagnosticForm({ employeeId, employee = {}, diagnostic, freinsDefinitions, baseRole, onSaved, onDirtyChange }) {
  const [draft, setDraft] = useState(() => ({ ...(diagnostic || {}) }));
  const [step, setStep] = useState(0);
  const [savedAt, setSavedAt] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [relecture, setRelecture] = useState(false);
  // Suggestions calculées par le SERVEUR (renvoyées par le PUT — écart 1b) ;
  // prioritaires sur le pré-calcul local.
  const [serverSuggestions, setServerSuggestions] = useState(() => diagnostic?.suggestions_freins || null);
  const pendingRef = useRef({});
  const timerRef = useRef(null);
  const freins = visibleFreins(baseRole);

  // Reprise : première rubrique sans aucune réponse (après la dernière remplie).
  useEffect(() => {
    const d = diagnostic || {};
    setDraft({ ...d });
    setServerSuggestions(d.suggestions_freins || null);
    pendingRef.current = {};
    let resume = 0;
    for (let i = 0; i < STEPS.length - 1; i++) {
      const filled = STEPS[i].fields.some((f) => isFilled(d[f]));
      if (filled) resume = Math.min(i + 1, STEPS.length - 1);
    }
    setStep(d.statut_saisie === 'complet' ? 0 : resume);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId]);

  const markDirty = useCallback((dirty) => { if (onDirtyChange) onDirtyChange(dirty); }, [onDirtyChange]);

  const flush = useCallback(async (extra = {}) => {
    const pending = pendingRef.current;
    if (Object.keys(pending).length === 0 && Object.keys(extra).length === 0) return true;
    setSaving(true); setError(null);
    try {
      const payload = { ...pending, statut_saisie: draft.statut_saisie === 'complet' ? 'complet' : 'en_cours', ...extra };
      const res = await api.put(`/insertion/diagnostic/${employeeId}`, payload);
      pendingRef.current = {};
      setSavedAt(new Date());
      markDirty(false);
      if (res.data?.statut_saisie) setDraft((f) => ({ ...f, statut_saisie: res.data.statut_saisie }));
      if (res.data?.suggestions_freins) setServerSuggestions(res.data.suggestions_freins);
      if (onSaved) onSaved(res.data);
      setSaving(false);
      return true;
    } catch (err) {
      setError((err.response?.data?.error || err.message) + (err.response?.data?.hint ? ` — ${err.response.data.hint}` : ''));
      setSaving(false);
      return false;
    }
  }, [employeeId, draft.statut_saisie, markDirty, onSaved]);

  // Autosave 30 s après la dernière modification.
  const setField = (field, value) => {
    setDraft((f) => ({ ...f, [field]: value }));
    pendingRef.current[field] = value;
    markDirty(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => flush(), AUTOSAVE_MS);
  };
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const goTo = async (i) => { await flush(); setStep(Math.max(0, Math.min(STEPS.length - 1, i))); };

  const terminer = async () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    const ok = await flush({ statut_saisie: 'complet' });
    if (ok) setDraft((f) => ({ ...f, statut_saisie: 'complet' }));
  };

  // Suggestions serveur si présentes, complétées par le pré-calcul local en
  // repli (avant la première sauvegarde, ou serveur muet).
  const suggestions = useMemo(
    () => ({ ...computeSuggestions(draft), ...(serverSuggestions || {}) }),
    [draft, serverSuggestions]
  );

  const filledCount = (st) => st.id === 'freins'
    ? freins.filter((f) => draft[f.column] != null).length
    : st.fields.filter((f) => canSeeField(f, baseRole)).filter((f) => isFilled(draft[f])).length;
  const totalCount = (st) => st.id === 'freins'
    ? freins.length
    : st.fields.filter((f) => canSeeField(f, baseRole)).length;
  const progressPct = Math.round(
    (STEPS.reduce((a, st) => a + (filledCount(st) > 0 ? 1 : 0), 0) / STEPS.length) * 100
  );

  const cur = STEPS[step];
  const fse = draft.fse_entree || {};
  const setFse = (k, v) => setField('fse_entree', { ...fse, [k]: v });

  // Champs internes masqués en mode relecture (co-construction avec le salarié).
  const hideInternal = relecture;

  return (
    <div className={`bg-white rounded-lg border ${relecture ? 'text-lg' : ''}`}>
      {/* En-tête : progression + brouillon + actions */}
      <div className="border-b px-4 py-3 space-y-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <h3 className="font-semibold text-gray-800 text-base">Diagnostic d'accueil</h3>
            {draft.statut_saisie === 'complet' ? (
              <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">Terminé</span>
            ) : (
              <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">En cours — reprenez quand vous voulez</span>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs">
            <label className="flex items-center gap-1.5 text-gray-500 cursor-pointer select-none" title="Gros caractères, notes internes masquées — pour relire ensemble à l'écran">
              <input type="checkbox" checked={relecture} onChange={(e) => setRelecture(e.target.checked)} className="rounded border-gray-300" />
              Mode relecture
            </label>
            <button type="button" onClick={() => exportDiagnosticPDF({ employee, diagnostic: draft, variante: 'salarie' })}
              className="px-2.5 py-1 rounded-lg border border-teal-300 text-teal-700 font-medium hover:bg-teal-50">PDF salarié</button>
            <button type="button" onClick={() => exportDiagnosticPDF({ employee, diagnostic: draft, variante: 'dossier' })}
              className="px-2.5 py-1 rounded-lg border border-slate-300 text-slate-600 font-medium hover:bg-slate-50">PDF dossier</button>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex-1 bg-gray-200 rounded-full h-1.5">
            <div className="bg-teal-500 h-1.5 rounded-full transition-all" style={{ width: `${progressPct}%` }} />
          </div>
          <span className="text-[11px] text-gray-400 whitespace-nowrap">
            {saving ? 'Enregistrement…' : savedAt ? `💾 Brouillon enregistré à ${savedAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : 'Sauvegarde automatique à chaque étape'}
          </span>
        </div>
        {error && (
          <div className="text-xs bg-red-50 border border-red-200 text-red-700 rounded-lg p-2 flex items-start gap-2">
            <span aria-hidden="true">⚠</span><span>{error}</span>
            <button type="button" onClick={() => flush()} className="ml-auto underline">Réessayer</button>
          </div>
        )}
      </div>

      <div className="flex flex-col md:flex-row">
        {/* Sommaire latéral */}
        <nav className="md:w-56 border-b md:border-b-0 md:border-r p-2 flex md:flex-col gap-1 overflow-x-auto flex-shrink-0">
          {STEPS.map((st, i) => {
            const n = filledCount(st), t = totalCount(st);
            return (
              <button key={st.id} type="button" onClick={() => goTo(i)}
                className={`flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg text-left text-xs whitespace-nowrap md:whitespace-normal transition ${
                  i === step ? 'bg-teal-600 text-white' : 'text-gray-600 hover:bg-gray-100'
                }`}>
                <span>{i + 1}. {st.label}</span>
                <span className={`text-[10px] px-1.5 rounded-full ${i === step ? 'bg-white/20' : n === t && t > 0 ? 'bg-green-100 text-green-700' : n > 0 ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-400'}`}>
                  {n}/{t}
                </span>
              </button>
            );
          })}
        </nav>

        {/* Rubrique courante */}
        <div className="flex-1 p-4 space-y-4 min-w-0">
          <div className="flex items-baseline justify-between">
            <h4 className="font-semibold text-gray-700">Étape {step + 1}/{STEPS.length} — {cur.label}</h4>
            <span className="text-[11px] text-gray-400">Le diagnostic peut se faire en 2 séances (fenêtre de 30 j).</span>
          </div>

          {cur.id === 'parcours' && (
            <div className="space-y-3">
              <FieldRow label="Ce que la personne a fait avant d'arriver (parcours antérieur)">
                <textarea value={draft.parcours_anterieur || ''} onChange={(e) => setField('parcours_anterieur', e.target.value)} rows={3} className="input-modern py-1 w-full" />
              </FieldRow>
              <FieldRow label="Situation familiale">
                <ChoicePicker value={draft.situation_familiale} onChange={(v) => setField('situation_familiale', v)}
                  options={[['celibataire', 'Célibataire'], ['en_couple', 'En couple'], ['marie', 'Marié·e'], ['divorce', 'Divorcé·e'], ['veuf', 'Veuf·ve']]} />
              </FieldRow>
              <div className="grid grid-cols-2 gap-3">
                <FieldRow label="Nombre d'enfants">
                  <input type="number" min="0" max="15" value={draft.nb_enfants ?? ''} onChange={(e) => setField('nb_enfants', e.target.value === '' ? null : parseInt(e.target.value, 10))} className="input-modern py-1 w-24" />
                </FieldRow>
                <FieldRow label="Enfants à charge">
                  <BoolPicker value={draft.enfants_a_charge} onChange={(v) => setField('enfants_a_charge', v)} />
                </FieldRow>
              </div>
            </div>
          )}

          {cur.id === 'logement' && (
            <div className="space-y-3">
              <FieldRow label="Statut du logement">
                <ChoicePicker value={draft.logement_statut} onChange={(v) => setField('logement_statut', v)}
                  options={[['locataire_social', 'Locataire (social)'], ['locataire_prive', 'Locataire (privé)'], ['proprietaire', 'Propriétaire'], ['heberge', 'Hébergé·e chez un tiers'], ['sans_abri', 'Sans logement stable']]} />
              </FieldRow>
              <FieldRow label="La personne se sent-elle bien dans son logement ?">
                <BoolPicker value={draft.logement_satisfaction} onChange={(v) => setField('logement_satisfaction', v)} />
              </FieldRow>
              <FieldRow label="Commentaire CIP — logement">
                <textarea value={draft.commentaire_logement || ''} onChange={(e) => setField('commentaire_logement', e.target.value)} rows={2} className="input-modern py-1 w-full" />
              </FieldRow>
            </div>
          )}

          {cur.id === 'droits' && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <FieldRow label="Pièce d'identité valide jusqu'au">
                  <input type="date" value={draft.piece_identite_validite ? String(draft.piece_identite_validite).slice(0, 10) : ''} onChange={(e) => setField('piece_identite_validite', e.target.value || null)} className="input-modern py-1" />
                </FieldRow>
                <FieldRow label="Allocataire CAF">
                  <BoolPicker value={draft.allocataire_caf} onChange={(v) => setField('allocataire_caf', v)} />
                </FieldRow>
              </div>
              <FieldRow label="Ressources perçues">
                <CheckGroup value={draft.ressources} onChange={(v) => setField('ressources', v)}
                  options={[['RSA', 'RSA'], ['APL', 'APL'], ['AF', 'Allocations familiales'], ['CF', 'Complément familial'], ['ASF', 'ASF'], ['AAH', 'AAH'], ['ARE', 'ARE (chômage)'], ['prime_activite', "Prime d'activité"], ['aucune', 'Aucune']]} />
              </FieldRow>
              <FieldRow label="Commentaire CIP — droits & administratif">
                <textarea value={draft.commentaire_droits || ''} onChange={(e) => setField('commentaire_droits', e.target.value)} rows={2} className="input-modern py-1 w-full" />
              </FieldRow>
            </div>
          )}

          {cur.id === 'sante' && (
            <div className="space-y-3">
              <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
                Données de santé (article 9 RGPD) : ne consigner que ce qui est utile à l'accompagnement. Les commentaires sont chiffrés en base.
              </p>
              <FieldRow label="Mutuelle">
                <ChoicePicker value={draft.mutuelle_statut} onChange={(v) => setField('mutuelle_statut', v)}
                  options={[['entreprise', "Mutuelle d'entreprise"], ['personnelle', 'Mutuelle personnelle'], ['css', 'Complémentaire santé solidaire'], ['aucune', 'Aucune']]} />
              </FieldRow>
              <div className="grid grid-cols-2 gap-3">
                <FieldRow label="RQTH">
                  <BoolPicker value={draft.rqth} onChange={(v) => setField('rqth', v)} />
                </FieldRow>
                {draft.rqth && (
                  <FieldRow label="RQTH — fin de validité">
                    <input type="date" value={draft.rqth_fin ? String(draft.rqth_fin).slice(0, 10) : ''} onChange={(e) => setField('rqth_fin', e.target.value || null)} className="input-modern py-1" />
                  </FieldRow>
                )}
                <FieldRow label="Contre-indications au poste">
                  <BoolPicker value={draft.contre_indications} onChange={(v) => setField('contre_indications', v)} />
                </FieldRow>
                <FieldRow label="Suivi santé en cours">
                  <BoolPicker value={draft.suivi_sante} onChange={(v) => setField('suivi_sante', v)} />
                </FieldRow>
              </div>
              {canSeeField('commentaire_sante', baseRole) && !hideInternal && (
                <FieldRow label="Commentaire CIP — santé (chiffré, jamais visible d'un manager)">
                  <textarea value={draft.commentaire_sante || ''} onChange={(e) => setField('commentaire_sante', e.target.value)} rows={2} className="input-modern py-1 w-full" />
                </FieldRow>
              )}
            </div>
          )}

          {cur.id === 'budget' && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <FieldRow label="Difficultés financières">
                  <BoolPicker value={draft.difficultes_financieres} onChange={(v) => setField('difficultes_financieres', v)} />
                </FieldRow>
                <FieldRow label="Crédits en cours">
                  <BoolPicker value={draft.credits_en_cours} onChange={(v) => setField('credits_en_cours', v)} />
                </FieldRow>
              </div>
              {canSeeField('commentaire_budget', baseRole) && !hideInternal && (
                <FieldRow label="Commentaire CIP — budget">
                  <textarea value={draft.commentaire_budget || ''} onChange={(e) => setField('commentaire_budget', e.target.value)} rows={2} className="input-modern py-1 w-full" />
                </FieldRow>
              )}
            </div>
          )}

          {cur.id === 'mobilite' && (
            <div className="space-y-3">
              <FieldRow label="Permis B">
                <ChoicePicker value={draft.permis_b_statut} onChange={(v) => setField('permis_b_statut', v)}
                  options={[['oui', 'Oui'], ['non', 'Non'], ['code_en_cours', 'Code en cours'], ['conduite_en_cours', 'Conduite en cours']]} />
              </FieldRow>
              <FieldRow label="Véhicule personnel">
                <BoolPicker value={draft.vehicule} onChange={(v) => setField('vehicule', v)} />
              </FieldRow>
              <FieldRow label="Moyens de transport utilisés">
                <CheckGroup value={draft.moyen_transport} onChange={(v) => setField('moyen_transport', v)}
                  options={[['voiture', 'Voiture'], ['transports_commun', 'Transports en commun'], ['velo', 'Vélo'], ['deux_roues', 'Deux-roues'], ['a_pied', 'À pied'], ['covoiturage', 'Covoiturage']]} />
              </FieldRow>
              <FieldRow label="Commentaire CIP — mobilité">
                <textarea value={draft.commentaire_mobilite || ''} onChange={(e) => setField('commentaire_mobilite', e.target.value)} rows={2} className="input-modern py-1 w-full" />
              </FieldRow>
            </div>
          )}

          {cur.id === 'linguistique' && (
            <div className="space-y-3">
              <FieldRow label="Niveau de français (CECRL)" hint="A1 = grand débutant … C2 = maîtrise complète.">
                <ChoicePicker value={draft.cecrl_niveau} onChange={(v) => setField('cecrl_niveau', v)}
                  options={[['A1', 'A1'], ['A2', 'A2'], ['B1', 'B1'], ['B2', 'B2'], ['C1', 'C1'], ['C2', 'C2']]} />
              </FieldRow>
              <FieldRow label="Commentaire CIP — langue (compréhension, écrit, oral…)">
                <textarea value={draft.commentaire_linguistique || ''} onChange={(e) => setField('commentaire_linguistique', e.target.value)} rows={2} className="input-modern py-1 w-full" />
              </FieldRow>
            </div>
          )}

          {cur.id === 'situation_pro' && (
            <div className="space-y-3">
              <FieldRow label="Autre employeur en parallèle">
                <BoolPicker value={draft.autre_employeur} onChange={(v) => setField('autre_employeur', v)} />
              </FieldRow>
              {draft.autre_employeur && (
                <FieldRow label="Heures hebdomadaires chez l'autre employeur">
                  <input type="number" min="0" max="48" step="0.5" value={draft.autre_employeur_heures ?? ''} onChange={(e) => setField('autre_employeur_heures', e.target.value === '' ? null : parseFloat(e.target.value))} className="input-modern py-1 w-28" />
                </FieldRow>
              )}
              <FieldRow label="Souhaite un complément d'heures">
                <BoolPicker value={draft.souhait_complement_heures} onChange={(v) => setField('souhait_complement_heures', v)} />
              </FieldRow>
            </div>
          )}

          {cur.id === 'projet' && (
            <div className="space-y-3">
              <FieldRow label="Niveau de formation atteint">
                <ChoicePicker value={draft.niveau_formation} onChange={(v) => setField('niveau_formation', v)}
                  options={[['infra3', 'Infra niveau 3 (sans diplôme)'], ['niv3', 'Niveau 3 (CAP/BEP)'], ['niv4', 'Niveau 4 (Bac)'], ['niv5', 'Niveau 5 (Bac+2)'], ['niv6plus', 'Niveau 6 et + (Bac+3…)']]} />
              </FieldRow>
              <div className="grid grid-cols-2 gap-3">
                <FieldRow label="Métiers souhaités">
                  <input value={draft.metiers_souhaites || ''} onChange={(e) => setField('metiers_souhaites', e.target.value)} className="input-modern py-1 w-full" />
                </FieldRow>
                <FieldRow label="Emploi visé">
                  <input value={draft.emploi_vise || ''} onChange={(e) => setField('emploi_vise', e.target.value)} className="input-modern py-1 w-full" />
                </FieldRow>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <FieldRow label="Prêt·e à se former">
                  <ChoicePicker value={draft.pret_a_se_former} onChange={(v) => setField('pret_a_se_former', v)}
                    options={[['oui', 'Oui'], ['non', 'Non'], ['a_discuter', 'À discuter']]} />
                </FieldRow>
                <FieldRow label="CPF mobilisable">
                  <BoolPicker value={draft.cpf_accessible} onChange={(v) => setField('cpf_accessible', v)} />
                </FieldRow>
              </div>
              <FieldRow label="Projet de formation">
                <textarea value={draft.projet_formation || ''} onChange={(e) => setField('projet_formation', e.target.value)} rows={2} className="input-modern py-1 w-full" />
              </FieldRow>
              <FieldRow label="Commentaire CIP — projet professionnel">
                <textarea value={draft.commentaire_projet || ''} onChange={(e) => setField('commentaire_projet', e.target.value)} rows={2} className="input-modern py-1 w-full" />
              </FieldRow>
            </div>
          )}

          {cur.id === 'expression' && (
            <div className="space-y-3">
              <p className="text-[11px] text-sky-700 bg-sky-50 border border-sky-200 rounded-lg p-2">
                Avec les mots du salarié — ces réponses alimentent ses objectifs de parcours (« origine salarié »).
              </p>
              {[['attentes_parcours', "Qu'attendez-vous de votre parcours ici ?"],
                ['difficultes_exprimees', 'Quelles difficultés voulez-vous régler en priorité ?'],
                ['objectifs_exprimes', 'Quels sont vos objectifs (travail, vie quotidienne) ?'],
                ['aide_souhaitee', "De quelle aide avez-vous besoin ?"]].map(([k, label]) => (
                <FieldRow key={k} label={label}>
                  <textarea value={draft[k] || ''} onChange={(e) => setField(k, e.target.value)} rows={2} className="input-modern py-1 w-full" />
                </FieldRow>
              ))}
            </div>
          )}

          {cur.id === 'fse' && (
            <div className="space-y-3">
              <p className="text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg p-2">
                Questionnaire participant FSE+ (entrée dans l'opération). Les réponses déjà saisies dans les autres rubriques
                (niveau de formation, ressources, logement, situation familiale, RQTH) sont réutilisées automatiquement — seuls les items restants sont à compléter.
              </p>
              <FieldRow label="Situation juste avant l'entrée">
                <ChoicePicker value={fse.statut_avant_entree} onChange={(v) => setFse('statut_avant_entree', v)}
                  options={[['demandeur_emploi', "Demandeur d'emploi"], ['inactif', 'Inactif (ni emploi ni recherche)'], ['emploi', 'En emploi'], ['formation', 'En formation']]} />
              </FieldRow>
              <FieldRow label="Durée sans emploi avant l'entrée">
                <ChoicePicker value={fse.duree_sans_emploi} onChange={(v) => setFse('duree_sans_emploi', v)}
                  options={[['moins_6_mois', '< 6 mois'], ['6_12_mois', '6-12 mois'], ['12_24_mois', '12-24 mois'], ['plus_24_mois', '> 24 mois']]} />
              </FieldRow>
              <div className="grid grid-cols-2 gap-3">
                <FieldRow label="Foyer monoparental">
                  <BoolPicker value={fse.foyer_monoparental} onChange={(v) => setFse('foyer_monoparental', v)} />
                </FieldRow>
                <FieldRow label="Sans domicile stable à l'entrée">
                  <BoolPicker value={fse.sans_domicile_stable} onChange={(v) => setFse('sans_domicile_stable', v)} />
                </FieldRow>
              </div>
              <FieldRow label="Commentaire (FSE+)">
                <textarea value={fse.commentaire || ''} onChange={(e) => setFse('commentaire', e.target.value)} rows={2} className="input-modern py-1 w-full" />
              </FieldRow>
            </div>
          )}

          {cur.id === 'freins' && (
            <div className="space-y-3">
              <p className="text-xs text-gray-500">
                Évaluez chaque frein de 1 (pas de difficulté) à 5 (bloquant). Laissez « Non évalué » si le sujet n'a pas été abordé —
                un frein non évalué n'est jamais compté. La suggestion surlignée vient des réponses du questionnaire : vous décidez.
              </p>
              {freins.map((f) => {
                const def = freinsDefinitions?.[f.key];
                const detailField = `${f.column}_detail`;
                const showDetail = canSeeField(detailField, baseRole) && !(hideInternal && f.sensible);
                return (
                  <div key={f.key} className="bg-gray-50 rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <h5 className="font-medium text-gray-700">{f.label}
                        {draft[f.column] != null && <span className={`ml-2 text-xs px-1.5 py-0.5 rounded ${FREIN_LEVEL_COLORS[draft[f.column]]}`}>{draft[f.column]}/5</span>}
                      </h5>
                      <FreinPicker value={draft[f.column] ?? null} onChange={(v) => setField(f.column, v)} suggestion={suggestions[f.key] ?? null} />
                    </div>
                    {f.key === 'judiciaire' && (
                      <p className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">{JUDICIAIRE_LEGAL_NOTICE}</p>
                    )}
                    {def?.niveaux && draft[f.column] != null && (
                      <p className="text-[11px] text-gray-400 italic">{draft[f.column]} = {def.niveaux[draft[f.column]]}</p>
                    )}
                    {def?.questions_indirectes && !relecture && (
                      <details className="text-[11px] text-gray-400">
                        <summary className="cursor-pointer select-none hover:text-gray-600">Questions pour aborder le sujet</summary>
                        <ul className="ml-4 mt-1 space-y-0.5 italic">
                          {def.questions_indirectes.map((qi, i) => <li key={i}>– {qi.q}</li>)}
                        </ul>
                      </details>
                    )}
                    {showDetail && (
                      <textarea value={draft[detailField] || ''} onChange={(e) => setField(detailField, e.target.value)}
                        placeholder={f.key === 'judiciaire' ? 'Impact organisationnel uniquement (disponibilités, rendez-vous extérieurs, aménagements)…' : `Observations ${f.label.toLowerCase()}…`}
                        className="input-modern py-1 text-xs w-full" rows={2} />
                    )}
                  </div>
                );
              })}

              {!hideInternal && (
                <details className="border border-slate-200 rounded-lg">
                  <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium text-slate-600">Observations en situation de travail (interne)</summary>
                  <div className="p-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {[['obs_points_forts', 'Points forts observés'], ['obs_difficultes', 'Difficultés observées'],
                      ['obs_comportement_equipe', 'Comportement en équipe'], ['obs_autonomie_ponctualite', 'Autonomie / ponctualité'],
                      ['pref_aime_faire', 'Ce que la personne aime faire'], ['pref_ne_veut_plus', "Ce qu'elle ne veut plus faire"]].map(([k, label]) => (
                      <div key={k}>
                        <label className="block text-xs text-gray-500 mb-1">{label}</label>
                        <textarea value={draft[k] || ''} onChange={(e) => setField(k, e.target.value)} rows={2} className="input-modern py-1 w-full" />
                      </div>
                    ))}
                  </div>
                </details>
              )}

              <div className="flex items-center justify-between border-t pt-3">
                <p className="text-xs text-gray-400">
                  {freins.filter((f) => draft[f.column] != null).length}/{freins.length} freins évalués.
                </p>
                <button type="button" onClick={terminer} disabled={saving}
                  className="px-4 py-2 rounded-lg bg-teal-600 text-white text-sm font-medium hover:bg-teal-700 disabled:opacity-50">
                  {draft.statut_saisie === 'complet' ? 'Diagnostic terminé ✓ (réenregistrer)' : 'Terminer le diagnostic'}
                </button>
              </div>
            </div>
          )}

          {/* Navigation bas de rubrique */}
          <div className="flex items-center justify-between border-t pt-3">
            <button type="button" onClick={() => goTo(step - 1)} disabled={step === 0}
              className="px-3 py-1.5 rounded-lg border text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40">
              ◄ Étape précédente
            </button>
            <button type="button" onClick={() => flush()} disabled={saving}
              className="px-3 py-1.5 rounded-lg border border-teal-300 text-teal-700 text-sm font-medium hover:bg-teal-50 disabled:opacity-50">
              {saving ? 'Enregistrement…' : 'Enregistrer le brouillon'}
            </button>
            {step < STEPS.length - 1 ? (
              <button type="button" onClick={() => goTo(step + 1)}
                className="px-3 py-1.5 rounded-lg bg-teal-600 text-white text-sm font-medium hover:bg-teal-700">
                Étape suivante ►
              </button>
            ) : <span className="w-28" />}
          </div>
        </div>
      </div>
    </div>
  );
}
