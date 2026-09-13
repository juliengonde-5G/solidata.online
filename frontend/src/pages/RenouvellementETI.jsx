import { useState, useEffect, useCallback } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import api from '../services/api';
import { frDate } from '../components/insertion/freins';
import { formatEmployeeName } from '../utils/names';
import FormulaireETI, { projeterFormulaireEti } from '../components/insertion/FormulaireETI';

/**
 * Écran ETI de renouvellement — VOIE AUTHENTIFIÉE
 * (`/insertion/renouvellement/:milestoneId`).
 *
 * ═══ CE QUE CET ÉCRAN EST DEVENU (PR C lot 5) ═════════════════════════════
 * Il était la seule voie, et c'était le défaut : son destinataire — un
 * encadrant d'atelier sans compte — tombait sur la page de connexion quand la
 * CIP lui envoyait « le lien ». La voie normale est désormais le LIEN PUBLIC
 * `/eti/renouvellement/:token`, produit d'un clic depuis l'espace CIP.
 *
 * Cet écran-ci reste, et il est utile : un encadrant QUI A un compte peut
 * saisir son avis sans jeton, et les liens déjà copiés continuent de mener
 * quelque part. Il commence donc par le DIRE — « ce lien est réservé aux
 * comptes ; pour un encadrant sans compte, copiez le lien public » — plutôt
 * que de laisser la CIP envoyer une adresse qui ne s'ouvrira pas.
 *
 * Le formulaire lui-même est le composant PARTAGÉ `FormulaireETI` : les deux
 * écrans posent exactement les mêmes questions, et il n'existe qu'une trame.
 */

export default function RenouvellementETI() {
  const { milestoneId } = useParams();
  const [searchParams] = useSearchParams();
  const msId = parseInt(milestoneId, 10);

  const [info, setInfo] = useState(null);
  const [initial, setInitial] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [transmitted, setTransmitted] = useState(false);
  const [locked, setLocked] = useState(false);

  // Lien public : servi par /insertion/renouvellements s'il existe déjà, sinon
  // produit à la demande. « Copier » ne doit jamais copier l'adresse de CET
  // écran : c'est le défaut qu'on corrige.
  const [lienPublic, setLienPublic] = useState(null);
  const [lienExpire, setLienExpire] = useState(null);
  const [lienBusy, setLienBusy] = useState(false);
  const [lienCopie, setLienCopie] = useState(false);
  const [lienErreur, setLienErreur] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setLoadError(null);
    try {
      let entry = null;
      try {
        const r = await api.get('/insertion/renouvellements');
        entry = (r.data?.renouvellements || []).find((x) => x.entretien && x.entretien.id === msId) || null;
      } catch { /* la fiche milestone reste tentable via ?salarie= */ }

      const employeeId = entry?.employee_id || parseInt(searchParams.get('salarie'), 10) || null;
      let milestone = null;
      if (employeeId) {
        try {
          const ms = await api.get(`/insertion/milestones/${employeeId}`);
          milestone = (Array.isArray(ms.data) ? ms.data : []).find((m) => m.id === msId) || null;
        } catch { /* pré-remplissage indisponible — la saisie reste possible */ }
      }
      if (!entry && !milestone) {
        setLoadError("Formulaire introuvable : le lien est peut-être périmé, ou l'entretien de renouvellement n'existe plus. Demandez un nouveau lien à la CIP.");
        setLoading(false);
        return;
      }

      setInfo({
        nom: entry ? formatEmployeeName(entry.last_name, entry.first_name) : 'Salarié',
        contract_end: entry?.contract_end || null,
        jours_restants: entry?.jours_restants ?? null,
        titre: milestone?.titre || entry?.entretien?.titre || 'Renouvellement',
      });
      setLocked(milestone?.locked_at != null || entry?.entretien?.verrouille === true);
      setLienPublic(entry?.entretien?.lien_eti || null);
      setLienExpire(entry?.entretien?.eti_expire_le || null);

      // Le blob `renouvellement_form` est écrit par DEUX formulaires : celui-ci
      // et la trame INTERNE de renouvellement que la CIP remplit dans la fiche
      // (dont « Motifs / commentaires » est un texte libre). Pré-remplir cet
      // écran avec le blob entier montrait le commentaire de la conseillère à
      // l'encadrant — et le lui faisait RENVOYER comme s'il était le sien. Même
      // règle que l'écran public, qui projette côté serveur (correctif B-02).
      const brut = (milestone?.renouvellement_form && typeof milestone.renouvellement_form === 'object')
        ? milestone.renouvellement_form : {};
      const deLEti = brut.rempli_par === 'eti';
      setInitial({
        formulaire: deLEti ? projeterFormulaireEti(brut) : {},
        avis: deLEti ? (milestone?.renouvellement_avis ?? entry?.entretien?.renouvellement_avis ?? null) : null,
        duree_mois: deLEti ? (milestone?.renouvellement_duree_mois ?? entry?.entretien?.renouvellement_duree_mois ?? null) : null,
      });
    } catch (err) {
      setLoadError(err.response?.data?.error || err.message);
    }
    setLoading(false);
  }, [msId, searchParams]);

  useEffect(() => { load(); }, [load]);

  const copierLienPublic = async () => {
    setLienBusy(true); setLienErreur(null);
    try {
      let url = lienPublic;
      if (!url) {
        const r = await api.post(`/insertion/renouvellements/${msId}/lien-eti`);
        url = r.data.lien;
        setLienPublic(url);
        setLienExpire(r.data.expire_le);
      }
      try {
        await navigator.clipboard.writeText(url);
        setLienCopie(true);
        setTimeout(() => setLienCopie(false), 2500);
      } catch {
        // Presse-papiers refusé (page non sécurisée, navigateur ancien) : le
        // lien reste affiché en clair juste en dessous, sélectionnable.
        setLienErreur('Copie automatique impossible — sélectionnez le lien ci-dessous.');
      }
    } catch (err) {
      setLienErreur(err.response?.data?.error || err.message);
    }
    setLienBusy(false);
  };

  const transmit = async (charge) => {
    setSaving(true); setSaveError(null);
    try {
      await api.put(`/insertion/renouvellements/${msId}/formulaire`, charge);
      setTransmitted(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      const d = err.response?.data;
      if (err.response?.status === 409) {
        setLocked(true);
        setSaveError(d?.error || 'Cet entretien est verrouillé — le formulaire ne peut plus être modifié.');
      } else if (d?.champs_refuses) {
        setSaveError(`${d.error} (champs refusés : ${d.champs_refuses.join(', ')})`);
      } else {
        setSaveError(d?.error || err.message);
      }
    }
    setSaving(false);
  };

  const readOnly = locked || transmitted;

  return (
    <div className="min-h-screen bg-slate-50 py-6 px-4">
      <div className="max-w-2xl mx-auto space-y-5">
        {loading && <p className="text-center text-gray-500 py-10 text-lg">Chargement du formulaire…</p>}

        {loadError && (
          <div className="bg-red-50 border-2 border-red-200 text-red-700 rounded-2xl p-5 text-base">
            {loadError}
            <div className="mt-3"><Link to="/insertion" className="text-sm underline text-red-600">Retour à l'espace CIP</Link></div>
          </div>
        )}

        {!loading && !loadError && info && (
          <>
            <header className="text-center space-y-1">
              <p className="text-sm font-semibold text-teal-700 uppercase tracking-wide">Solidarité Textiles — avis de l'encadrant</p>
              <h1 className="text-2xl font-bold text-gray-800">Renouvellement de contrat</h1>
              <p className="text-lg text-gray-700">
                <span className="font-semibold">{info.nom}</span>
                {info.contract_end && <> — fin de contrat le <span className="font-semibold">{frDate(info.contract_end)}</span></>}
                {info.jours_restants != null && <span className="text-amber-700"> (dans {info.jours_restants} jours)</span>}
              </p>
            </header>

            {/* Encart d'orientation — il n'existe que parce que cette page a été
                envoyée pendant des mois à des gens qui ne pouvaient pas l'ouvrir. */}
            {!readOnly && (
              <section className="bg-sky-50 border-2 border-sky-200 rounded-2xl p-4 space-y-2">
                <p className="text-sm text-sky-900">
                  <strong>Cette page est réservée aux personnes qui ont un compte SOLIDATA.</strong> Pour
                  un encadrant qui n'en a pas, copiez le <strong>lien public</strong> et envoyez-le lui :
                  il ouvrira le même formulaire sans connexion.
                </p>
                <div className="flex items-center gap-2 flex-wrap">
                  <button type="button" onClick={copierLienPublic} disabled={lienBusy}
                    className="min-h-[44px] px-4 rounded-xl bg-sky-700 text-white text-sm font-semibold hover:bg-sky-800 disabled:opacity-50">
                    {lienBusy ? 'Préparation…' : lienCopie ? '✓ Lien copié' : lienPublic ? 'Copier le lien public' : 'Créer et copier le lien public'}
                  </button>
                  {lienExpire && <span className="text-xs text-sky-800">valable jusqu'au {frDate(lienExpire)}</span>}
                </div>
                {lienPublic && (
                  <p className="text-xs text-sky-900 break-all bg-white border border-sky-200 rounded-lg p-2 select-all">{lienPublic}</p>
                )}
                {lienErreur && <p className="text-xs text-red-700">{lienErreur}</p>}
              </section>
            )}

            {transmitted && (
              <div className="bg-green-50 border-2 border-green-300 rounded-2xl p-5 text-center space-y-1">
                <p className="text-3xl" aria-hidden="true">✅</p>
                <p className="text-lg font-bold text-green-800">Merci ! Votre avis a été transmis à la CIP.</p>
                <p className="text-sm text-green-700">Vous pouvez fermer cette page. La CIP complète son volet et organise la suite.</p>
              </div>
            )}
            {locked && !transmitted && (
              <div className="bg-slate-100 border-2 border-slate-300 rounded-2xl p-4 text-center text-base text-slate-700">
                🔒 Cet entretien de renouvellement est clôturé : le formulaire est en lecture seule.
              </div>
            )}
            {saveError && (
              <div className="bg-red-50 border-2 border-red-300 text-red-700 rounded-2xl p-4 text-base">{saveError}</div>
            )}

            <FormulaireETI
              initial={initial}
              readOnly={readOnly}
              saving={saving}
              onTransmit={transmit}
              onErreurLocale={setSaveError}
            />

            <p className="text-center">
              <Link to="/insertion" className="text-xs text-gray-400 hover:text-gray-600 underline">Retour à l'espace CIP</Link>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
