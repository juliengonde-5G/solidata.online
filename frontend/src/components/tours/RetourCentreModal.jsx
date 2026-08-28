import { useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Factory, AlertTriangle } from 'lucide-react';
import api from '../../services/api';

/**
 * RetourCentreModal — pose un retour au centre de tri sur une tournée en cours.
 *
 * Demande client (08/2026) : « sur tournée en direct rajouter un bouton
 * + Retour au centre de tri au même niveau que + Ajouter un point de collecte ».
 *
 * Trois motifs, trois situations bien distinctes, d'où le choix explicite :
 * le camion est plein et repart ensuite, l'équipe déjeune au centre, ou la
 * journée s'arrête. Le serveur les traite par la MÊME mécanique que le geste
 * « je rentre » du chauffeur : l'étape se place devant lui, sans doublon.
 *
 * Props :
 *  - tourId  : id de la tournée
 *  - onClose : () => void
 *  - onAdded : (points) => void — programme à jour renvoyé par le serveur
 */

const MOTIFS = [
  {
    valeur: 'vidage',
    titre: 'Camion plein — vidage',
    aide: "L'équipage rentre décharger, puis repart terminer sa tournée. La pesée s'ouvre à l'arrivée.",
  },
  {
    valeur: 'pause_dejeuner',
    titre: 'Pause déjeuner au centre',
    aide: 'Retour au centre entre midi et 13 h. La pause ne compte pas dans le temps de travail.',
  },
  {
    valeur: 'fin_tournee',
    titre: 'Fin de tournée',
    aide: "Dernier retour de la journée : pesée finale puis clôture.",
  },
];

export default function RetourCentreModal({ tourId, onClose, onAdded }) {
  const [motif, setMotif] = useState('vidage');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [resultat, setResultat] = useState(null);

  const submit = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await api.post(`/tours/${tourId}/programme/retour-centre`, { motif });
      onAdded(res.data.points);
      setResultat(res.data);
    } catch (err) {
      const code = err.response?.data?.code;
      setError(
        code === 'TOURNEE_NON_MODIFIABLE'
          ? "Cette tournée n'est plus modifiable."
          : (err.response?.data?.error || "L'ajout du retour au centre a échoué.")
      );
    } finally {
      setSaving(false);
    }
  };

  // Portail vers <body> : au-dessus d'une carte Leaflet (calques à z-index 400,
  // contrôles à 800), une modale rendue dans le flux passe dessous.
  return createPortal(
    <div className="fixed inset-0 bg-black/40 z-[2000] flex items-start justify-center p-4 overflow-y-auto" role="dialog" aria-modal="true">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md my-6">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <h3 className="font-semibold text-slate-800 text-sm flex items-center gap-2">
            <Factory className="w-4 h-4 text-slate-500" />
            Ajouter un retour au centre de tri
          </h3>
          <button type="button" onClick={onClose} aria-label="Fermer" className="text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <p className="text-xs text-slate-500">
            L'étape est placée <strong>devant le chauffeur</strong>, juste après le dernier point
            qu'il a traité : les points restants sont décalés d'un cran, aucun n'est perdu.
          </p>

          <fieldset className="space-y-2">
            <legend className="text-xs text-slate-500 mb-1">Motif du retour *</legend>
            {MOTIFS.map((m) => (
              <label
                key={m.valeur}
                className={`flex gap-2 items-start rounded-lg border px-3 py-2 cursor-pointer transition ${
                  motif === m.valeur ? 'border-teal-500 bg-teal-50' : 'border-slate-200 hover:bg-slate-50'}`}
              >
                <input
                  type="radio"
                  name={`motif-retour-${tourId}`}
                  value={m.valeur}
                  checked={motif === m.valeur}
                  onChange={() => setMotif(m.valeur)}
                  className="mt-0.5"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-slate-800">{m.titre}</span>
                  <span className="block text-[11px] text-slate-500">{m.aide}</span>
                </span>
              </label>
            ))}
          </fieldset>

          {/* Une fin de tournée n'est pas une étape de plus : elle solde la
              journée. Le dire AVANT le clic, pas après. */}
          {motif === 'fin_tournee' && (
            <div className="flex gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              <span>
                Les autres retours au centre encore prévus (pause déjeuner notamment) seront marqués
                « non effectués ». Les points de collecte non faits, eux, restent au programme.
              </span>
            </div>
          )}

          {error && (
            <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-2 py-1.5" role="alert">
              {error}
            </div>
          )}

          {resultat && !error && (
            <div className="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-2 py-1.5">
              {resultat.deja_present
                ? `Un retour de ce motif était déjà prévu : il a été avancé en position ${resultat.position}, devant le chauffeur.`
                : `Retour ajouté au programme en position ${resultat.position} — ${resultat.destination?.name || 'centre de tri'}.`}
              {' '}Le chauffeur a été prévenu.
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-slate-100 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-200 text-slate-700 text-sm hover:bg-slate-50">
            Fermer
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={saving}
            className="btn-primary text-sm px-4 py-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Ajout…' : 'Ajouter au programme'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
