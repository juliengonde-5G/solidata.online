/**
 * Liste + visionneuse des bordereaux de collecte en déchèterie (Métropole
 * Rouen Normandie) — composant PARTAGÉ entre la fiche de tournée
 * (`GET /tours/:id/bordereaux`) et la fiche CAV (`GET /cav/:id/bordereaux`).
 *
 * Chaque bordereau est une pièce signée (agent de la déchèterie + chauffeur) :
 * le poids affiché est INDICATIF (jamais versé dans les pesées de la
 * tournée), et le document lui-même ne se lit ni ne se télécharge qu'à la
 * demande (aperçu et téléchargement passent tous deux par un blob PDF, comme
 * la vignette de la badgeuse et les pièces jointes RSE — voir
 * `components/badgeuse/PrevisualisationContenu.jsx` et
 * `components/rse/RegistrePreuves.jsx`).
 *
 * La VALIDATION (ADMIN/MANAGER) ajoute au PDF la mention « Validé par
 * Solidarité textiles sur Solidata le JJ/MM/AAAA » et fige poids + signatures
 * — irréversible côté document, d'où la confirmation explicite.
 */
import { useCallback, useEffect, useState } from 'react';
import { FileText, Eye, Download, CheckCircle2 } from 'lucide-react';
import Modal from '../Modal';
import ErrorState from '../ErrorState';
import useConfirm from '../../hooks/useConfirm';
import { useToast } from '../Toast';
import api from '../../services/api';
import {
  classeStatutBordereau, libelleStatutBordereau, libelleMotifSignatureAbsente,
} from '../../utils/bordereaux';

const fmtDate = (iso) => {
  if (!iso) return null;
  // Date SEULE (pas d'heure) : traitée comme les autres dates civiles de
  // l'application (cf. tour.date sur Tours.jsx), sans recalage de fuseau.
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('fr-FR');
};

const fmtDateHeure = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso
    : `${d.toLocaleDateString('fr-FR')} à ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
};

/** Un blob d'erreur ne se lit pas comme du JSON : on rapporte ce qu'on sait
 *  sûrement (le code HTTP), jamais un message inventé. */
const messageErreurBlob = (err) => {
  const statut = err?.response?.status;
  if (statut) return `Le serveur a répondu ${statut}.`;
  return err?.message || 'Serveur injoignable.';
};

export default function BordereauxDecheterie({ endpoint, peutValider, onValide, titre }) {
  const { confirm, ConfirmDialogElement } = useConfirm();
  const toast = useToast();

  const [bordereaux, setBordereaux] = useState(null); // null = pas encore chargé
  const [erreur, setErreur] = useState(null);
  const [chargement, setChargement] = useState(false);
  const [validationEnCours, setValidationEnCours] = useState(null); // id en cours de validation
  const [telechargementEnCours, setTelechargementEnCours] = useState(null); // id en cours de téléchargement

  const [voir, setVoir] = useState(null); // { id, numero } | null
  const [voirUrl, setVoirUrl] = useState(null);
  const [voirErreur, setVoirErreur] = useState(null);
  const [voirChargement, setVoirChargement] = useState(false);

  const charger = useCallback(async () => {
    setChargement(true);
    setErreur(null);
    try {
      const { data } = await api.get(endpoint);
      setBordereaux(Array.isArray(data?.bordereaux) ? data.bordereaux : []);
    } catch (err) {
      setBordereaux(null);
      setErreur(err?.response?.data?.error || "Les bordereaux n'ont pas pu être chargés.");
    } finally {
      setChargement(false);
    }
  }, [endpoint]);

  useEffect(() => { charger(); }, [charger]);

  // Aperçu PDF : blob → URL d'objet, révoquée au changement/démontage —
  // même patron que useApercuMedia (badgeuse) et FichierCell (RSE).
  useEffect(() => {
    if (!voir) return undefined;
    let vivant = true;
    let objectUrl = null;
    setVoirUrl(null);
    setVoirErreur(null);
    setVoirChargement(true);
    api.get(`/tours/bordereaux/${voir.id}/pdf`, { responseType: 'blob', timeout: 60000 })
      .then((res) => {
        if (!vivant) return;
        objectUrl = URL.createObjectURL(res.data);
        setVoirUrl(objectUrl);
      })
      .catch((err) => {
        if (vivant) setVoirErreur(messageErreurBlob(err));
      })
      .finally(() => {
        if (vivant) setVoirChargement(false);
      });
    return () => {
      vivant = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [voir]);

  const telecharger = async (b) => {
    setTelechargementEnCours(b.id);
    try {
      const res = await api.get(`/tours/bordereaux/${b.id}/pdf`, { responseType: 'blob', timeout: 60000 });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = `bordereau-${b.numero}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(messageErreurBlob(err));
    } finally {
      setTelechargementEnCours(null);
    }
  };

  const valider = async (b) => {
    const ok = await confirm({
      title: `Valider le bordereau ${b.numero} ?`,
      message: 'Cette validation ajoute au bordereau la mention « Validé par Solidarité textiles sur Solidata le '
        + `${fmtDate(new Date().toISOString())} ». Le poids et les signatures ne sont plus modifiables.`,
      confirmLabel: 'Valider',
      confirmVariant: 'primary',
    });
    if (!ok) return;
    setValidationEnCours(b.id);
    try {
      await api.post(`/tours/bordereaux/${b.id}/valider`);
      toast.success(`Bordereau ${b.numero} validé.`);
      await charger();
      onValide?.();
    } catch (err) {
      if (err?.response?.status === 409) {
        toast.error('Ce bordereau a déjà été validé.');
        await charger();
      } else {
        toast.error(err?.response?.data?.error || 'La validation a échoué.');
      }
    } finally {
      setValidationEnCours(null);
    }
  };

  const nbAValider = (bordereaux || []).filter((b) => b.statut === 'a_valider').length;

  return (
    <div>
      {chargement && bordereaux === null && (
        <p className="text-xs text-slate-400 italic">Chargement des bordereaux…</p>
      )}

      {erreur && !chargement && (
        <ErrorState variant="card" title="Impossible de charger les bordereaux" message={erreur} onRetry={charger} />
      )}

      {bordereaux !== null && !erreur && (
        <>
          {peutValider && nbAValider > 0 && (
            <div className="mb-2 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800 font-semibold">
              {nbAValider} bordereau{nbAValider > 1 ? 'x' : ''} déchèterie à valider.
            </div>
          )}
          {!peutValider && (
            <p className="text-[10px] text-slate-400 mb-2">
              Validation depuis la fiche de tournée (ADMIN/MANAGER).
            </p>
          )}

          {bordereaux.length === 0 ? (
            <p className="text-xs text-slate-400 italic">
              Aucun bordereau de collecte déchèterie pour {titre || 'ce point ou cette tournée'}.
            </p>
          ) : (
            <div className="space-y-1.5">
              {bordereaux.map((b) => (
                <div key={b.id} className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2 min-w-0">
                      <span className="font-semibold text-slate-700">{b.numero}</span>
                      <span className="text-slate-500 truncate">{b.decheterie_libelle || b.cav_nom || '—'}</span>
                      <span className="text-slate-400">{fmtDate(b.date_enlevement)}</span>
                      <span className="font-semibold text-slate-700">
                        {b.poids_indicatif_kg != null ? `${b.poids_indicatif_kg} kg (indicatif)` : '— kg (indicatif)'}
                      </span>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] ${classeStatutBordereau(b.statut)}`}>
                        {libelleStatutBordereau(b.statut)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <button
                        type="button"
                        onClick={() => setVoir({ id: b.id, numero: b.numero })}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-300 text-slate-600 hover:bg-white text-[11px] font-semibold"
                        title="Voir le bordereau"
                      >
                        <Eye className="w-3.5 h-3.5" /> Voir
                      </button>
                      <button
                        type="button"
                        onClick={() => telecharger(b)}
                        disabled={telechargementEnCours === b.id}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-300 text-slate-600 hover:bg-white text-[11px] font-semibold disabled:opacity-50 disabled:cursor-wait"
                        title="Télécharger le bordereau"
                      >
                        <Download className="w-3.5 h-3.5" />
                        {telechargementEnCours === b.id ? '…' : 'Télécharger'}
                      </button>
                      {peutValider && b.statut === 'a_valider' && (
                        <button
                          type="button"
                          onClick={() => valider(b)}
                          disabled={validationEnCours === b.id}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded bg-teal-600 hover:bg-teal-700 text-white text-[11px] font-semibold disabled:opacity-50 disabled:cursor-wait"
                          title="Valider le bordereau"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          {validationEnCours === b.id ? 'Validation…' : 'Valider'}
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-slate-400">
                    {b.signature_agent_absente_motif && (
                      <span className="text-amber-600">
                        {libelleMotifSignatureAbsente(b.signature_agent_absente_motif)}
                      </span>
                    )}
                    {b.signature_chauffeur_absente_motif && (
                      <span className="text-amber-600">
                        {libelleMotifSignatureAbsente(b.signature_chauffeur_absente_motif)}
                      </span>
                    )}
                    {b.statut === 'valide' && (
                      <span>
                        Validé par {b.valide_par_nom || 'un gestionnaire'} le {fmtDateHeure(b.valide_le) || '—'}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <Modal
        isOpen={!!voir}
        onClose={() => setVoir(null)}
        title={voir ? `Bordereau ${voir.numero}` : ''}
        size="xl"
      >
        {voirChargement && (
          <p className="text-xs text-slate-400 italic">Chargement du document…</p>
        )}
        {voirErreur && !voirChargement && (
          <ErrorState variant="card" title="Document indisponible" message={voirErreur} />
        )}
        {voirUrl && !voirChargement && (
          <iframe
            title={`Bordereau ${voir?.numero}`}
            src={voirUrl}
            className="w-full h-[70vh] rounded-lg border border-slate-200"
          />
        )}
      </Modal>

      {ConfirmDialogElement}
    </div>
  );
}
