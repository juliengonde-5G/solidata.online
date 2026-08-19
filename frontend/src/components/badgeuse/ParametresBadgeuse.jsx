import { useState, useEffect, useCallback } from 'react';
import { Sliders, Save, ShieldAlert, ShieldCheck, Info } from 'lucide-react';
import api from '../../services/api';
import { LoadingSpinner, ErrorState, useToast } from '../../components';
import { apiErr, fmtDateTimeParis } from './badgeuseShared';

// Grille de règles de gestion NOTE_RH §3 — défauts = recommandations RH
// (ADR-0002). AUCUNE valeur n'est en dur ici : tout vient de GET /parametres.
//
// CONTRAT (routes/badgeuse.js) : la réponse est
// `{ parametres, defauts, regles_validees:{validees,le,par}, motifs_correction }`
// et les bornes de plage sont DEUX clés distinctes (`plage_acceptation_debut`
// et `plage_acceptation_fin`). L'écran lisait la racine de la réponse et
// envoyait une clé `plage_acceptation` agrégée que le PUT filtrait : les
// valeurs enregistrées n'étaient jamais relues, et la plage n'était jamais
// écrite. C'est le même défaut que QA-05 (« paramètre affiché sans effet »).

const RETENTIONS = [
  { key: 'retention_pointages_mois', label: 'Pointages bruts', unite: 'mois' },
  { key: 'retention_feuilles_mois', label: 'Feuilles de temps', unite: 'mois' },
  { key: 'retention_badges_apres_restitution_jours', label: 'Badges après restitution', unite: 'jours' },
  { key: 'retention_contenus_apres_expiration_jours', label: "Contenus d'affichage expirés", unite: 'jours' },
  { key: 'retention_journal_acces_mois', label: "Journal des accès RH", unite: 'mois' },
];

/**
 * Réponse de GET /parametres → état du formulaire. On lit `data.parametres`
 * (et non la racine), sinon TOUS les champs retombaient sur leurs valeurs de
 * repli et l'écran n'affichait jamais la grille réellement enregistrée.
 */
function fromApi(data = {}) {
  const d = data.parametres || data || {};
  return {
    pointages_par_jour: d.pointages_par_jour ?? 4,
    arrondi_minutes: d.arrondi_minutes ?? 5,
    arrondi_sens: d.arrondi_sens || 'avantage_salarie',
    tolerance_retard_minutes: d.tolerance_retard_minutes ?? 5,
    badge_avant_heure_compte: !!d.badge_avant_heure_compte,
    pause_deduite_minutes: d.pause_deduite_minutes ?? 45,
    pause_deduite_seuil_heures: d.pause_deduite_seuil_heures ?? 6,
    journee_max_heures: d.journee_max_heures ?? 10,
    plage_debut: d.plage_acceptation_debut || '05:00',
    plage_fin: d.plage_acceptation_fin || '21:00',
    affichage_cumul_hebdo: !!d.affichage_cumul_hebdo,
    overlay_duree_sec: d.overlay_duree_sec ?? 5,
    anti_rebond_sec: d.anti_rebond_sec ?? 8,
    regularisation_delai_jours: d.regularisation_delai_jours ?? 5,
    supervision_silence_minutes: d.supervision_silence_minutes ?? 15,
    supervision_alerte_emails: d.supervision_alerte_emails || '',
    media_upload_max_mo: d.media_upload_max_mo ?? 50,
  };
}

// ── Onglet Paramètres (ADR-0002) ──────────────────────────────────────────────
export default function ParametresBadgeuse({ canWrite }) {
  const toast = useToast();
  const [raw, setRaw] = useState(null);
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    api.get('/badgeuse/parametres')
      .then((r) => { setRaw(r.data || {}); setForm(fromApi(r.data || {})); setError(null); })
      .catch((err) => setError(apiErr(err, 'Chargement des paramètres impossible.')))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    setSaving(true); setSaveError(null);
    try {
      // Les clés doivent correspondre EXACTEMENT au dictionnaire
      // BADGEUSE_SETTING_DEFAULTS : le PUT ignore silencieusement toute clé
      // inconnue (garde anti-« règle fantôme »).
      const payload = {
        pointages_par_jour: parseInt(form.pointages_par_jour, 10),
        arrondi_minutes: parseInt(form.arrondi_minutes, 10),
        arrondi_sens: form.arrondi_sens,
        tolerance_retard_minutes: parseInt(form.tolerance_retard_minutes, 10),
        badge_avant_heure_compte: form.badge_avant_heure_compte,
        pause_deduite_minutes: parseInt(form.pause_deduite_minutes, 10),
        pause_deduite_seuil_heures: parseFloat(form.pause_deduite_seuil_heures),
        journee_max_heures: parseFloat(form.journee_max_heures),
        plage_acceptation_debut: form.plage_debut,
        plage_acceptation_fin: form.plage_fin,
        affichage_cumul_hebdo: form.affichage_cumul_hebdo,
        overlay_duree_sec: parseInt(form.overlay_duree_sec, 10),
        anti_rebond_sec: parseInt(form.anti_rebond_sec, 10),
        regularisation_delai_jours: parseInt(form.regularisation_delai_jours, 10),
        supervision_silence_minutes: parseInt(form.supervision_silence_minutes, 10),
        supervision_alerte_emails: String(form.supervision_alerte_emails || '').trim(),
        media_upload_max_mo: parseInt(form.media_upload_max_mo, 10),
      };
      const res = await api.put('/badgeuse/parametres', payload);
      setRaw(res.data || raw);
      if (res.data) setForm(fromApi(res.data));
      toast.success('Paramètres enregistrés et marqués comme arbitrés.');
    } catch (err) { setSaveError(apiErr(err, 'Enregistrement impossible.')); }
    finally { setSaving(false); }
  };

  if (loading) return <LoadingSpinner size="lg" message="Chargement des paramètres…" />;
  if (error) return <ErrorState variant="card" title="Paramètres indisponibles" message={error} onRetry={load} />;
  if (!form) return null;

  // Le marqueur d'arbitrage vit dans `regles_validees:{validees,le,par}` — lu
  // à plat, il était toujours indéfini et le bandeau « non arbitré » restait
  // affiché même après validation par la Direction (ADR-0002 §3).
  const regles = raw?.regles_validees || {};
  const arbitrees = !!(regles.validees || regles.le);
  const disabled = !canWrite || saving;

  return (
    <div className="space-y-5">
      {arbitrees ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-800 text-sm px-3 py-2 flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 flex-shrink-0" />
          <span>Règles arbitrées par la Direction le {fmtDateTimeParis(regles.le)}{regles.par ? ` (utilisateur n°${regles.par})` : ''}.</span>
        </div>
      ) : (
        <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 text-amber-800 text-sm px-3 py-2 flex items-start gap-2">
          <ShieldAlert className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span><strong>Règles par défaut (recommandations RH)</strong> — à faire arbitrer par la Direction avant la mise en production (NOTE_RH §3, ADR-0002). Le pilote peut démarrer sur ces valeurs, mais l'état « non arbitré » reste visible tant que personne ne les a validées.</span>
        </div>
      )}
      {!canWrite && (
        <p className="text-xs text-slate-400">Lecture seule — la modification des règles de gestion est réservée aux rôles ADMIN / RH.</p>
      )}

      <div className="bg-white rounded-xl border p-4">
        <h3 className="font-semibold text-slate-800 flex items-center gap-2 mb-4"><Sliders className="w-4 h-4 text-teal-600" /> Règles de gestion (NOTE_RH §3)</h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Pointages par jour</label>
            <select value={form.pointages_par_jour} onChange={(e) => set('pointages_par_jour', e.target.value)} disabled={disabled} className="input-modern py-2 text-sm w-full disabled:bg-slate-50 disabled:text-slate-400">
              <option value={2}>2 (entrée / sortie)</option>
              <option value={4}>4 (avec pause méridienne)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Arrondi des pointages</label>
            <div className="flex gap-2">
              <select value={form.arrondi_minutes} onChange={(e) => set('arrondi_minutes', e.target.value)} disabled={disabled} className="input-modern py-2 text-sm flex-1 disabled:bg-slate-50 disabled:text-slate-400">
                <option value={0}>Aucun</option>
                <option value={5}>5 min</option>
                <option value={15}>15 min</option>
              </select>
              <select value={form.arrondi_sens} onChange={(e) => set('arrondi_sens', e.target.value)} disabled={disabled || Number(form.arrondi_minutes) === 0} className="input-modern py-2 text-sm flex-1 disabled:bg-slate-50 disabled:text-slate-400">
                <option value="avantage_salarie">À l'avantage du salarié</option>
                <option value="reel">Au réel</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Tolérance de retard sans effet paie (min)</label>
            <input type="number" min={0} step={1} value={form.tolerance_retard_minutes} onChange={(e) => set('tolerance_retard_minutes', e.target.value)} disabled={disabled} className="input-modern py-2 text-sm w-full disabled:bg-slate-50 disabled:text-slate-400" />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Badgeage avant l'heure planifiée</label>
            <select value={form.badge_avant_heure_compte ? '1' : '0'} onChange={(e) => set('badge_avant_heure_compte', e.target.value === '1')} disabled={disabled} className="input-modern py-2 text-sm w-full disabled:bg-slate-50 disabled:text-slate-400">
              <option value="0">Non compté (recommandation)</option>
              <option value="1">Compté</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Pause déduite automatiquement (min)</label>
            <input type="number" min={0} step={5} value={form.pause_deduite_minutes} onChange={(e) => set('pause_deduite_minutes', e.target.value)} disabled={disabled} className="input-modern py-2 text-sm w-full disabled:bg-slate-50 disabled:text-slate-400" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Seuil journée pour déduction de pause (h)</label>
            <input type="number" min={0} step={0.5} value={form.pause_deduite_seuil_heures} onChange={(e) => set('pause_deduite_seuil_heures', e.target.value)} disabled={disabled} className="input-modern py-2 text-sm w-full disabled:bg-slate-50 disabled:text-slate-400" />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Durée maximale d'une journée avant alerte (h)</label>
            <input type="number" min={1} step={0.5} value={form.journee_max_heures} onChange={(e) => set('journee_max_heures', e.target.value)} disabled={disabled} className="input-modern py-2 text-sm w-full disabled:bg-slate-50 disabled:text-slate-400" />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Plage horaire d'acceptation des pointages</label>
            <div className="flex items-center gap-2">
              <input type="time" value={form.plage_debut} onChange={(e) => set('plage_debut', e.target.value)} disabled={disabled} className="input-modern py-2 text-sm flex-1 disabled:bg-slate-50 disabled:text-slate-400" />
              <span className="text-slate-400 text-sm">à</span>
              <input type="time" value={form.plage_fin} onChange={(e) => set('plage_fin', e.target.value)} disabled={disabled} className="input-modern py-2 text-sm flex-1 disabled:bg-slate-50 disabled:text-slate-400" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Durée de l'overlay de confirmation (s)</label>
            <input type="number" min={3} max={8} step={1} value={form.overlay_duree_sec} onChange={(e) => set('overlay_duree_sec', Math.min(8, Math.max(3, Number(e.target.value) || 3)))} disabled={disabled} className="input-modern py-2 text-sm w-full disabled:bg-slate-50 disabled:text-slate-400" />
            <p className="text-[11px] text-slate-400 mt-1">Plafonné à 8 s côté serveur (exigence juridique, non modifiable).</p>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Anti-rebond (s)</label>
            <input type="number" min={1} step={1} value={form.anti_rebond_sec} onChange={(e) => set('anti_rebond_sec', e.target.value)} disabled={disabled} className="input-modern py-2 text-sm w-full disabled:bg-slate-50 disabled:text-slate-400" />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Délai de signalement d'une régularisation (jours ouvrés)</label>
            <input type="number" min={0} step={1} value={form.regularisation_delai_jours} onChange={(e) => set('regularisation_delai_jours', e.target.value)} disabled={disabled} className="input-modern py-2 text-sm w-full disabled:bg-slate-50 disabled:text-slate-400" />
            <p className="text-[11px] text-slate-400 mt-1">
              Au-delà, une correction saisie est signalée « hors délai » à son auteur — sans jamais être refusée (NOTE_RH §5.1). 0 désactive le signalement.
            </p>
          </div>
        </div>

        {/* Exploitation (BO-09) — réglages techniques, PAS des règles de
            gestion RH : ils ne sont pas soumis à l'arbitrage de la Direction,
            mais ils ne doivent pas non plus rester codés en dur (QA-11). */}
        <div className="mt-5 pt-4 border-t border-slate-100">
          <h4 className="text-sm font-semibold text-slate-700 mb-3">Postes et écran d'information (exploitation)</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Seuil de silence d'un poste (min)</label>
              <input type="number" min={1} step={1} value={form.supervision_silence_minutes}
                onChange={(e) => set('supervision_silence_minutes', e.target.value)} disabled={disabled}
                className="input-modern py-2 text-sm w-full disabled:bg-slate-50 disabled:text-slate-400" />
              <p className="text-[11px] text-slate-400 mt-1">
                Au-delà, le poste est affiché « hors ligne » et l'alerte e-mail part (BO-09). Recommandation : 15 min.
              </p>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Destinataires de l'alerte (e-mails séparés par des virgules)</label>
              <input type="text" value={form.supervision_alerte_emails}
                onChange={(e) => set('supervision_alerte_emails', e.target.value)} disabled={disabled}
                placeholder="rh@exemple.fr, direction@exemple.fr"
                className="input-modern py-2 text-sm w-full disabled:bg-slate-50 disabled:text-slate-400" />
              <p className="text-[11px] text-slate-400 mt-1">
                Vide : l'alerte part aux administrateurs de SOLIDATA. Au plus un e-mail par poste toutes les 6 heures.
              </p>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Taille maximale d'un média d'affichage (Mo)</label>
              <input type="number" min={1} max={500} step={1} value={form.media_upload_max_mo}
                onChange={(e) => set('media_upload_max_mo', e.target.value)} disabled={disabled}
                className="input-modern py-2 text-sm w-full disabled:bg-slate-50 disabled:text-slate-400" />
              <p className="text-[11px] text-slate-400 mt-1">
                Plafond des images et vidéos téléversées dans l'onglet Affichage. <strong>Ne dépassez pas 50 Mo</strong> sans avoir
                relevé <code>client_max_body_size</code> côté serveur web : au-delà, l'envoi serait coupé en cours de route.
              </p>
            </div>
          </div>
        </div>

        {/* Affichage du cumul hebdo — avertissement juridique */}
        <div className="mt-4 rounded-lg border border-slate-200 p-3">
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <input type="checkbox" checked={form.affichage_cumul_hebdo} onChange={(e) => set('affichage_cumul_hebdo', e.target.checked)} disabled={disabled} className="rounded border-slate-300" />
            Afficher le cumul d'heures de la semaine sur l'écran du poste
          </label>
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded px-2 py-1 mt-2 flex items-start gap-1.5">
            <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
            Recommandation RH : <strong>désactivé</strong>. Confidentialité au point de passage — la consultation du cumul se fait dans l'espace personnel SOLIDATA, pas sur un écran partagé (note juridique §3.5).
          </p>
        </div>

        {canWrite && (
          <div className="flex items-center justify-end gap-3 mt-5 pt-4 border-t border-slate-100">
            {saveError && <span role="alert" className="text-sm text-red-600 mr-auto">{saveError}</span>}
            <button onClick={save} disabled={saving} className="btn-primary text-sm inline-flex items-center gap-1.5 disabled:opacity-50">
              <Save className="w-4 h-4" /> {saving ? 'Enregistrement…' : 'Enregistrer et marquer comme arbitrées'}
            </button>
          </div>
        )}
      </div>

      {/* Durées de conservation — exigences de conformité, lecture seule ici */}
      <div className="bg-white rounded-xl border p-4">
        <h3 className="font-semibold text-slate-800 mb-1">Durées de conservation</h3>
        <p className="text-xs text-slate-400 mb-3">Exigences de conformité (note juridique RGPD §3.7), appliquées automatiquement par la purge planifiée — non arbitrables ici.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
          {RETENTIONS.map((r) => (
            <div key={r.key} className="flex items-center justify-between border-b border-slate-50 py-1.5">
              <span className="text-slate-600">{r.label}</span>
              <span className="font-medium text-slate-800">{raw?.[r.key] ?? '—'} {r.unite}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
