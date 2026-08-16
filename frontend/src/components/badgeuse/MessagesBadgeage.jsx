/**
 * Messages de badgeage (CDC_AFFICHAGE_V2.md §1/§4) : gabarits des 7 messages
 * (4 moments + premier jour + 2 festifs), plages horaires des moments, vivier
 * de phrases de motivation, interrupteurs motivation_active/festif_actif.
 * Écriture ADMIN/RH via le PUT /badgeuse/parametres existant (ADR-0002 : les
 * clés vivent dans la même grille que le reste des règles de gestion).
 *
 * Contrat confirmé (utils/badgeuse-settings.js BADGEUSE_SETTING_DEFAULTS +
 * validateAffichageSetting) :
 *   - gabarits : clés `msg_<moment>` (matin/pause/retour/soir/premier_jour/
 *     anniversaire/anniversaire_entreprise) — `{prenom}` OBLIGATOIRE et
 *     `{annees}` pour l'ancienneté, 120 caractères max, jamais vide (le
 *     serveur REFUSE le lot entier sinon — le formulaire bloque en amont).
 *   - plages horaires (HH:MM strict) : `moment_matin_fin`, `moment_pause_debut`,
 *     `moment_pause_fin`, `moment_retour_fin`, `moment_soir_debut` — SEULEMENT
 *     5 bornes, le début de « retour » suit directement la fin de la pause.
 *   - `phrases_motivation` : tableau JSON, 30 phrases max, 200 caractères max
 *     chacune (mêmes bornes appliquées côté serveur).
 *   - `motivation_active` / `festif_actif` : booléens.
 */
import { useState, useEffect, useCallback } from 'react';
import { MessageSquare, Save, ShieldAlert, Sparkles, Cake } from 'lucide-react';
import api from '../../services/api';
import { LoadingSpinner, ErrorState, useToast } from '../../components';
import {
  apiErr, MOMENTS_BADGEAGE, DEFAULT_MESSAGES_BADGEAGE, DEFAULT_PLAGES_MOMENTS, MESSAGE_GABARIT_MAX,
} from './badgeuseShared';

const PHRASE_MAX = 200;
const PHRASES_MAX_COUNT = 30;

function parsePhrases(v) {
  if (Array.isArray(v)) return v.filter((s) => typeof s === 'string');
  if (typeof v === 'string' && v.trim()) {
    try {
      const p = JSON.parse(v);
      if (Array.isArray(p)) return p.filter((s) => typeof s === 'string');
    } catch { /* pas du JSON : traité comme texte brut ci-dessous */ }
    return v.split('\n').map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

function fromApi(data = {}) {
  const d = data.parametres || data || {};
  const messages = {};
  MOMENTS_BADGEAGE.forEach(({ key }) => {
    messages[key] = d[`msg_${key}`] ?? DEFAULT_MESSAGES_BADGEAGE[key] ?? '';
  });
  return {
    messages,
    plages: {
      matin_fin: d.moment_matin_fin || DEFAULT_PLAGES_MOMENTS.matin_fin,
      pause_debut: d.moment_pause_debut || DEFAULT_PLAGES_MOMENTS.pause_debut,
      pause_fin: d.moment_pause_fin || DEFAULT_PLAGES_MOMENTS.pause_fin,
      retour_fin: d.moment_retour_fin || DEFAULT_PLAGES_MOMENTS.retour_fin,
      soir_debut: d.moment_soir_debut || DEFAULT_PLAGES_MOMENTS.soir_debut,
    },
    phrasesText: parsePhrases(d.phrases_motivation).join('\n'),
    motivationActive: d.motivation_active !== false,
    festifActif: d.festif_actif !== false,
  };
}

export default function MessagesBadgeage({ canWrite }) {
  const toast = useToast();
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    api.get('/badgeuse/parametres')
      .then((r) => { setForm(fromApi(r.data || {})); setError(null); })
      .catch((err) => setError(apiErr(err, 'Chargement des messages de badgeage impossible.')))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const setMessage = (key, v) => setForm((f) => ({ ...f, messages: { ...f.messages, [key]: v } }));
  const setPlage = (key, v) => setForm((f) => ({ ...f, plages: { ...f.plages, [key]: v } }));

  const phrases = (form?.phrasesText || '').split('\n').map((s) => s.trim()).filter(Boolean);
  const phrasesTropLongues = phrases.filter((p) => p.length > PHRASE_MAX).length;
  const tropDePhrases = phrases.length > PHRASES_MAX_COUNT;
  const gabaritsSansPrenom = form
    ? MOMENTS_BADGEAGE.filter(({ key }) => !(form.messages[key] || '').includes('{prenom}'))
    : [];
  const gabaritsVides = form ? MOMENTS_BADGEAGE.filter(({ key }) => !(form.messages[key] || '').trim()) : [];

  const save = async () => {
    // Le serveur refuse le LOT ENTIER si un seul gabarit est invalide
    // (validateAffichageSettings) — on bloque donc ici en amont, avec un
    // message qui pointe précisément le ou les champs en cause.
    if (gabaritsVides.length > 0) { setSaveError(`Gabarit vide : ${gabaritsVides.map((m) => m.label).join(', ')}.`); return; }
    if (gabaritsSansPrenom.length > 0) { setSaveError(`Il manque {prenom} dans : ${gabaritsSansPrenom.map((m) => m.label).join(', ')}.`); return; }
    if (tropDePhrases) { setSaveError(`Le vivier est limité à ${PHRASES_MAX_COUNT} phrases (${phrases.length} saisies).`); return; }
    if (phrasesTropLongues > 0) { setSaveError(`${phrasesTropLongues} phrase(s) dépassent ${PHRASE_MAX} caractères.`); return; }
    setSaving(true); setSaveError(null);
    try {
      const payload = {
        motivation_active: form.motivationActive,
        festif_actif: form.festifActif,
        phrases_motivation: phrases,
        moment_matin_fin: form.plages.matin_fin,
        moment_pause_debut: form.plages.pause_debut,
        moment_pause_fin: form.plages.pause_fin,
        moment_retour_fin: form.plages.retour_fin,
        moment_soir_debut: form.plages.soir_debut,
      };
      MOMENTS_BADGEAGE.forEach(({ key }) => { payload[`msg_${key}`] = form.messages[key]; });
      await api.put('/badgeuse/parametres', payload);
      toast.success('Messages de badgeage enregistrés.');
      load();
    } catch (err) { setSaveError(apiErr(err, 'Enregistrement impossible.')); }
    finally { setSaving(false); }
  };

  if (loading) return <LoadingSpinner size="lg" message="Chargement des messages de badgeage…" />;
  if (error) return <ErrorState variant="card" title="Messages indisponibles" message={error} onRetry={load} />;
  if (!form) return null;

  const disabled = !canWrite || saving;

  return (
    <div className="space-y-5">
      {!canWrite && (
        <p className="text-xs text-slate-400">Lecture seule — la modification des messages de badgeage est réservée aux rôles ADMIN / RH.</p>
      )}

      <div role="note" className="rounded-lg border border-amber-200 bg-amber-50 text-amber-800 text-xs px-3 py-2 flex items-start gap-2">
        <ShieldAlert className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <span>Les phrases sont génériques — jamais liées au profil PCM (arbitrage de conformité, ADR-0004 §2). Identité affichée : prénom + initiale uniquement, inchangé (ADR-0004 §1).</span>
      </div>

      <div className="bg-white rounded-xl border p-4">
        <h3 className="font-semibold text-slate-800 flex items-center gap-2 mb-1"><MessageSquare className="w-4 h-4 text-teal-600" /> Gabarits des messages</h3>
        <p className="text-xs text-slate-400 mb-4">
          <code className="mx-1">{'{prenom}'}</code> obligatoire dans chaque gabarit (le serveur refuse l'enregistrement sinon) ;
          <code className="mx-1">{'{annees}'}</code> disponible pour l'ancienneté (anniversaire d'entreprise). {MESSAGE_GABARIT_MAX} caractères max.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
          {MOMENTS_BADGEAGE.map(({ key, label }) => {
            const val = form.messages[key] || '';
            const manquePrenom = val && !val.includes('{prenom}');
            return (
              <div key={key}>
                <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
                <input value={val} onChange={(e) => setMessage(key, e.target.value)} disabled={disabled} maxLength={MESSAGE_GABARIT_MAX}
                  className="input-modern py-2 text-sm w-full disabled:bg-slate-50 disabled:text-slate-400" />
                {manquePrenom && <p className="text-[11px] text-amber-600 mt-1">Ce gabarit ne contient pas {'{prenom}'}.</p>}
              </div>
            );
          })}
        </div>
      </div>

      <div className="bg-white rounded-xl border p-4">
        <h3 className="font-semibold text-slate-800 mb-1">Plages horaires des moments</h3>
        <p className="text-xs text-slate-400 mb-4">Détermine le message affiché selon le sens du badgeage (entrée/sortie) et l'heure murale Paris. Le retour de pause commence à la fin de la pause.</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Fin du matin (entrée avant)</label>
            <input type="time" value={form.plages.matin_fin} onChange={(e) => setPlage('matin_fin', e.target.value)} disabled={disabled} className="input-modern py-2 text-sm w-full disabled:bg-slate-50 disabled:text-slate-400" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Pause déjeuner (sortie entre)</label>
            <div className="flex items-center gap-2">
              <input type="time" value={form.plages.pause_debut} onChange={(e) => setPlage('pause_debut', e.target.value)} disabled={disabled} className="input-modern py-2 text-sm w-full disabled:bg-slate-50 disabled:text-slate-400" />
              <span className="text-slate-400 text-sm">à</span>
              <input type="time" value={form.plages.pause_fin} onChange={(e) => setPlage('pause_fin', e.target.value)} disabled={disabled} className="input-modern py-2 text-sm w-full disabled:bg-slate-50 disabled:text-slate-400" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Retour de pause (entrée jusqu'à)</label>
            <input type="time" value={form.plages.retour_fin} onChange={(e) => setPlage('retour_fin', e.target.value)} disabled={disabled} className="input-modern py-2 text-sm w-full disabled:bg-slate-50 disabled:text-slate-400" />
            <p className="text-[11px] text-slate-400 mt-1">Démarre à la fin de la pause ({form.plages.pause_fin || '—'}).</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Soir (sortie après)</label>
            <input type="time" value={form.plages.soir_debut} onChange={(e) => setPlage('soir_debut', e.target.value)} disabled={disabled} className="input-modern py-2 text-sm w-full disabled:bg-slate-50 disabled:text-slate-400" />
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border p-4">
        <h3 className="font-semibold text-slate-800 flex items-center gap-2 mb-1"><Sparkles className="w-4 h-4 text-teal-600" /> Vivier de phrases de motivation</h3>
        <p className="text-xs text-slate-400 mb-3">Une phrase par ligne, rotation quotidienne déterministe côté poste — {PHRASES_MAX_COUNT} phrases max, {PHRASE_MAX} caractères max chacune.</p>
        <textarea value={form.phrasesText} onChange={(e) => setForm((f) => ({ ...f, phrasesText: e.target.value }))} disabled={disabled}
          rows={8} className="input-modern py-2 text-sm w-full font-mono disabled:bg-slate-50 disabled:text-slate-400"
          placeholder={'Belle journée à toute l\'équipe !\nMerci pour votre engagement.\n…'} />
        <div className="flex items-center justify-between mt-1">
          <span className={`text-xs ${tropDePhrases ? 'text-red-600' : 'text-slate-400'}`}>{phrases.length} / {PHRASES_MAX_COUNT} phrases</span>
          {phrasesTropLongues > 0 && <span className="text-xs text-red-600">{phrasesTropLongues} phrase(s) trop longue(s)</span>}
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-700 mt-4">
          <input type="checkbox" checked={form.motivationActive} onChange={(e) => setForm((f) => ({ ...f, motivationActive: e.target.checked }))} disabled={disabled} className="rounded border-slate-300" />
          Afficher une phrase de motivation à l'overlay de badgeage
        </label>
      </div>

      <div className="bg-white rounded-xl border p-4">
        <h3 className="font-semibold text-slate-800 flex items-center gap-2 mb-3"><Cake className="w-4 h-4 text-teal-600" /> Écran festif</h3>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={form.festifActif} onChange={(e) => setForm((f) => ({ ...f, festifActif: e.target.checked }))} disabled={disabled} className="rounded border-slate-300" />
          Activer l'écran festif (anniversaires) au badgeage
        </label>
        <p className="text-xs text-slate-400 mt-2">
          N'affecte que les salariés ayant donné leur accord — case « Anniversaires à l'écran » dans l'onglet Badges (ADR-0004 §4).
        </p>
      </div>

      {canWrite && (
        <div className="flex items-center justify-end gap-3">
          {saveError && <span role="alert" className="text-sm text-red-600 mr-auto">{saveError}</span>}
          <button onClick={save} disabled={saving} className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-50">
            <Save className="w-4 h-4" /> {saving ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      )}
    </div>
  );
}
