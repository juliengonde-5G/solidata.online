import { Plus, Trash2, Copy } from 'lucide-react';

/**
 * HorairesHebdo — éditeur d'horaires d'accessibilité hebdomadaires d'un point
 * association (chantier tournées associations, 26/08/2026 — RG-A1 / RG-A2 / RG-C1,
 * cf. rapports/tournees-associations-2026-08-26/{00-cahier-des-charges,02-contrats-techniques}.md).
 *
 * Contrat de la valeur (§1 du contrat technique) :
 *   - `null`                                  → horaires INCONNUS. La fiche n'a jamais été
 *     renseignée : la planification reste autorisée (RG-A2), ce n'est ni « ouvert »
 *     ni « fermé », juste une information absente.
 *   - { lundi:[{debut,fin}], mardi:[], ... }   → horaires RENSEIGNÉS. Un jour absent de
 *     l'objet ou porteur d'un tableau vide `[]` est FERMÉ ce jour-là (RG-A1) — la
 *     planification y sera bloquée par le serveur.
 * Forme stricte d'une plage : { debut:'HH:MM', fin:'HH:MM' } (24h, zéro-paddé).
 *
 * CE COMPOSANT NE DOIT JAMAIS LAISSER CES DEUX ÉTATS SE RESSEMBLER À L'ÉCRAN :
 * l'interrupteur du haut (« Horaires connus » / « Horaires non renseignés ») est
 * la seule chose qui distingue « je ne sais pas » de « c'est fermé tous les jours ».
 *
 * Props :
 *   - value    : le JSONB (object) ou null — entièrement piloté par le parent
 *   - onChange : (nextValueOrNull) => void
 *   - disabled : lecture seule (optionnel, défaut false)
 *
 * La validation affichée ici (début < fin, plages non chevauchantes) est un MIROIR
 * indicatif de la validation serveur (services/association-horaires.js › validerHoraires,
 * propriété exclusive de l'agent A — non importable depuis le frontend). Le serveur
 * reste l'autorité finale : un refus 400 HORAIRES_INVALIDES doit être affiché par
 * l'appelant tel quel, jamais remplacé par ce miroir côté saisie.
 */

export const JOURS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];

export const JOUR_LABELS = {
  lundi: 'Lundi', mardi: 'Mardi', mercredi: 'Mercredi', jeudi: 'Jeudi',
  vendredi: 'Vendredi', samedi: 'Samedi', dimanche: 'Dimanche',
};

export const JOUR_ABBR = {
  lundi: 'lun', mardi: 'mar', mercredi: 'mer', jeudi: 'jeu',
  vendredi: 'ven', samedi: 'sam', dimanche: 'dim',
};

function minutesDepuisHHMM(hhmm) {
  if (typeof hhmm !== 'string') return null;
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

function plageVide() {
  return { debut: '', fin: '' };
}

function semaineVide() {
  const obj = {};
  JOURS.forEach((j) => { obj[j] = []; });
  return obj;
}

/** Résumé lisible d'un jour : "Fermé" ou "09:00–12:00, 14:00–17:00". Utilisable en lecture seule (fiche, détail). */
export function formatPlagesJour(plages) {
  const arr = Array.isArray(plages) ? plages : [];
  if (arr.length === 0) return 'Fermé';
  return arr.map((p) => `${p?.debut || '?'}–${p?.fin || '?'}`).join(', ');
}

/**
 * Erreurs de saisie d'un jour : un message par plage (index aligné), null = pas d'erreur.
 * Miroir des règles serveur : plage complète en HH:MM, début < fin, non-chevauchement
 * des plages d'un même jour.
 */
function validerPlagesJour(plages) {
  const arr = Array.isArray(plages) ? plages : [];
  const erreurs = new Array(arr.length).fill(null);
  const bornes = arr.map((p) => ({
    debut: minutesDepuisHHMM(p?.debut),
    fin: minutesDepuisHHMM(p?.fin),
  }));

  arr.forEach((p, i) => {
    if (!p?.debut || !p?.fin) {
      erreurs[i] = 'Indiquez une heure de début et une heure de fin.';
    } else if (bornes[i].debut === null || bornes[i].fin === null) {
      erreurs[i] = 'Heure invalide.';
    } else if (bornes[i].debut >= bornes[i].fin) {
      erreurs[i] = "L'heure de début doit être avant l'heure de fin.";
    }
  });

  for (let i = 0; i < arr.length; i += 1) {
    if (erreurs[i]) continue;
    for (let j = i + 1; j < arr.length; j += 1) {
      if (erreurs[j]) continue;
      const a = bornes[i];
      const b = bornes[j];
      if (a.debut < b.fin && b.debut < a.fin) {
        erreurs[i] = 'Chevauche une autre plage de ce jour.';
        erreurs[j] = 'Chevauche une autre plage de ce jour.';
      }
    }
  }

  return erreurs;
}

export default function HorairesHebdo({ value, onChange, disabled = false }) {
  const renseigne = value != null && typeof value === 'object' && !Array.isArray(value);

  const activer = () => { if (!disabled) onChange(semaineVide()); };
  const reinitialiser = () => { if (!disabled) onChange(null); };

  const plagesDe = (jour) => (renseigne && Array.isArray(value[jour]) ? value[jour] : []);

  const setPlagesJour = (jour, plages) => {
    if (!renseigne) return;
    onChange({ ...value, [jour]: plages });
  };

  const ajouterPlage = (jour) => setPlagesJour(jour, [...plagesDe(jour), plageVide()]);

  const retirerPlage = (jour, idx) => setPlagesJour(jour, plagesDe(jour).filter((_, i) => i !== idx));

  const modifierPlage = (jour, idx, champ, val) => {
    setPlagesJour(jour, plagesDe(jour).map((p, i) => (i === idx ? { ...p, [champ]: val } : p)));
  };

  const copierSurSemaine = (jour) => {
    if (!renseigne) return;
    const source = plagesDe(jour);
    const next = {};
    JOURS.forEach((j) => { next[j] = source.map((p) => ({ ...p })); });
    onChange(next);
  };

  return (
    <div className="space-y-3">
      {/* Interrupteur explicite — cœur de RG-A2 : "non renseigné" et "fermé tous
          les jours" ne doivent jamais se confondre. Le second bouton sert aussi
          de retour explicite vers l'état non renseigné. */}
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Horaires connus ou non renseignés">
        <button
          type="button"
          disabled={disabled}
          aria-pressed={renseigne}
          onClick={activer}
          className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
            renseigne ? 'bg-orange-600 text-white border-orange-600' : 'bg-white text-slate-600 border-slate-300 hover:border-slate-400'
          } ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
        >
          Horaires connus
        </button>
        <button
          type="button"
          disabled={disabled}
          aria-pressed={!renseigne}
          onClick={reinitialiser}
          className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
            !renseigne ? 'bg-slate-600 text-white border-slate-600' : 'bg-white text-slate-500 border-slate-300 hover:border-slate-400'
          } ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
        >
          Horaires non renseignés
        </button>
      </div>

      {!renseigne ? (
        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3 text-xs text-slate-500">
          Information inconnue — <strong>la planification reste autorisée</strong>. Cliquez sur
          « Horaires connus » pour saisir les jours et créneaux d'accessibilité de ce point.
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="text-[11px] text-slate-400">
              Un jour sans aucune plage est <strong className="text-orange-600">fermé</strong> — la planification y sera bloquée.
            </p>
            <button
              type="button"
              disabled={disabled}
              onClick={reinitialiser}
              className="text-[11px] text-slate-400 hover:text-slate-600 underline decoration-dotted disabled:opacity-60 disabled:cursor-not-allowed"
            >
              Revenir à « non renseigné »
            </button>
          </div>

          {JOURS.map((jour) => {
            const plages = plagesDe(jour);
            const erreurs = validerPlagesJour(plages);
            const ferme = plages.length === 0;
            return (
              <div key={jour} className={`rounded-lg border p-2.5 ${ferme ? 'border-slate-200 bg-slate-50' : 'border-slate-200 bg-white'}`}>
                <div className="flex items-center flex-wrap gap-2 mb-1.5">
                  <span className="text-sm font-medium text-slate-700 w-[5.5rem] flex-shrink-0">{JOUR_LABELS[jour]}</span>
                  {ferme && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-200 text-slate-600 font-medium">Fermé</span>
                  )}
                  <div className="flex-1" />
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => ajouterPlage(jour)}
                    className="text-xs text-primary hover:underline flex items-center gap-1 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    <Plus className="w-3.5 h-3.5" aria-hidden="true" /> Ajouter une plage
                  </button>
                  {plages.length > 0 && (
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => copierSurSemaine(jour)}
                      title="Copier les horaires de ce jour sur toute la semaine"
                      className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      <Copy className="w-3.5 h-3.5" aria-hidden="true" /> Copier sur toute la semaine
                    </button>
                  )}
                </div>

                {plages.map((p, idx) => (
                  <div key={idx} className="sm:pl-[6rem] mb-1.5 last:mb-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <input
                        type="time"
                        value={p.debut || ''}
                        disabled={disabled}
                        onChange={(e) => modifierPlage(jour, idx, 'debut', e.target.value)}
                        aria-label={`${JOUR_LABELS[jour]} — début de la plage ${idx + 1}`}
                        aria-invalid={erreurs[idx] ? 'true' : undefined}
                        className={`input-modern py-1 text-sm w-28 ${erreurs[idx] ? 'border-red-400 focus:ring-red-400' : ''}`}
                      />
                      <span className="text-slate-400 text-xs" aria-hidden="true">à</span>
                      <input
                        type="time"
                        value={p.fin || ''}
                        disabled={disabled}
                        onChange={(e) => modifierPlage(jour, idx, 'fin', e.target.value)}
                        aria-label={`${JOUR_LABELS[jour]} — fin de la plage ${idx + 1}`}
                        aria-invalid={erreurs[idx] ? 'true' : undefined}
                        className={`input-modern py-1 text-sm w-28 ${erreurs[idx] ? 'border-red-400 focus:ring-red-400' : ''}`}
                      />
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => retirerPlage(jour, idx)}
                        aria-label={`Retirer la plage ${idx + 1} du ${JOUR_LABELS[jour].toLowerCase()}`}
                        className="text-slate-400 hover:text-red-500 disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    </div>
                    {erreurs[idx] && (
                      <p role="alert" className="text-[11px] text-red-600 mt-0.5">{erreurs[idx]}</p>
                    )}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
