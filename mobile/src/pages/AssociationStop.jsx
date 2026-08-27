import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import MobileShell from '../components/MobileShell';
import StepConfirmScreen from '../components/StepConfirmScreen';
import InfosPointAssociation from '../components/InfosPointAssociation';
import { vibrateSuccess, vibrateError, vibrateTap } from '../services/haptic';
import { authedFetch } from '../services/authedFetch';
import { addPendingCollect, deleteItem, newClientId, STORES } from '../services/db';
import { sendCollect } from '../services/sync';
import { libellePoint } from '../services/pointLabel';
import { texteRdv, infoHorairesJour } from '../services/pointHoraires';
import {
  poserArrivee, lireArrivee, effacerArrivee,
  dureeSurPlaceMin, formatDuree, formatHeure,
} from '../services/arriveeAssociation';

/**
 * Arrêt chez une association — « je suis arrivé », puis « je repars ».
 *
 * Une association n'est pas une borne de rue : pas de QR code à scanner, et
 * surtout rien à regarder « dedans ». Lui demander un niveau de remplissage
 * revenait à faire deviner au chauffeur une réponse qu'il ne pouvait pas
 * connaître. La question posée ici est celle qu'il peut réellement trancher :
 * COMBIEN A-T-ON CHARGÉ ?
 *
 * Les deux déclarations donnent la durée réelle de l'arrêt — la donnée que le
 * module fait ajuster à la main depuis la 2.38.0 sans jamais la mesurer — et
 * font juger les rendez-vous sur l'heure d'ARRIVÉE, pas sur celle du départ.
 *
 * Hors ligne, tout continue : l'arrivée est gardée sur l'appareil et repart
 * avec le départ, dans le même envoi rejouable.
 */

// COMBIEN DE SACS ? (demande client, 08/2026)
//
// L'écran demandait auparavant un volume approximatif (« un quart », « la
// moitié » du camion). Deux problèmes : c'était une estimation à l'œil, et
// surtout elle ne servait qu'à ranger le passage dans une case 0-4. Le poids
// de la journée, lui, était ensuite réparti à parts égales entre les
// associations visitées — deux sacs chez l'une et quarante chez l'autre
// produisaient la même ligne d'historique.
//
// Les sacs, eux, se COMPTENT en déchargeant. Le serveur en tire à la fois la
// clé de répartition du poids pesé et le niveau 0-4 de l'apprentissage : le
// chauffeur ne devine plus rien, il rapporte ce qu'il a fait.
//
// Raccourcis : ils POSENT la valeur (ils ne s'ajoutent pas). Quatorze sacs se
// saisissent en « 10 » puis quatre « + » — cinq gestes au lieu de quatorze, ce
// qui compte avec des gants et un camion à refermer.
const RACCOURCIS_SACS = [5, 10, 20];
const MAX_SACS = 5000;

export default function AssociationStop() {
  const navigate = useNavigate();
  const tourId = localStorage.getItem('current_tour_id');
  const pointId = localStorage.getItem('selected_cav_id');

  const [point, setPoint] = useState(null);
  const [arrivee, setArrivee] = useState(() => lireArrivee(tourId, pointId));
  const [maintenant, setMaintenant] = useState(() => new Date());
  // `null` = pas encore déclaré (le départ est refusé), `0` = déclaré « rien
  // chargé ». Les deux ne se confondent jamais, jusque dans la base.
  const [nbSacs, setNbSacs] = useState(null);
  const [notes, setNotes] = useState('');
  const [notesOuvert, setNotesOuvert] = useState(false);
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState('');
  const [confirme, setConfirme] = useState(null);   // { status }

  // Compteur « sur place depuis » : rafraîchi à la minute, pas à la seconde —
  // un chiffre qui saute sans cesse sous les yeux d'un chauffeur est du bruit.
  useEffect(() => {
    const id = setInterval(() => setMaintenant(new Date()), 30000);
    return () => clearInterval(id);
  }, []);

  const chargerPoint = useCallback(async () => {
    try {
      const res = await authedFetch(`/api/tours/${tourId}/public`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const p = (data.cavs || []).find((c) => String(c.cav_id) === String(pointId));
      if (p) {
        setPoint(p);
        // Le serveur fait foi quand il connaît déjà l'arrivée (déclarée depuis
        // un autre appareil, ou avant un rechargement de l'application).
        if (p.arrived_at && !lireArrivee(tourId, pointId)) {
          poserArrivee(tourId, pointId, new Date(p.arrived_at));
          setArrivee(new Date(p.arrived_at).toISOString());
        }
      }
    } catch {
      // Hors ligne : l'écran fonctionne quand même, avec ce que l'appareil sait.
      setPoint((prev) => prev || null);
    }
  }, [tourId, pointId]);

  useEffect(() => { chargerPoint(); }, [chargerPoint]);

  const titre = useMemo(() => (point ? libellePoint(point).titre : null), [point]);
  const surPlace = dureeSurPlaceMin(arrivee, maintenant);
  const rdvTexte = texteRdv(point?.rdv);
  const horaires = infoHorairesJour(point?.horaires_jour);
  const dureePrevue = point?.duree_prevue_min ?? null;
  // Dépassement signalé seulement quand les deux termes existent : sans durée
  // prévue, il n'y a rien à dépasser.
  const depasse = dureePrevue != null && surPlace != null && surPlace > dureePrevue;

  const declarerArrivee = async () => {
    vibrateTap();
    const iso = poserArrivee(tourId, pointId);
    setArrivee(iso);
    setMaintenant(new Date());
    // Envoi immédiat pour que le gestionnaire voie l'arrivée en direct. Un
    // échec ne bloque rien : l'heure est gardée sur l'appareil et repartira
    // avec le départ.
    try {
      await authedFetch(`/api/tours/${tourId}/association/${pointId}/arrivee-public`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ arrivee_at: iso }),
      });
    } catch { /* hors ligne — l'arrivée voyagera avec le départ */ }
  };

  /** Pose le compteur en le bornant, et efface l'erreur « à renseigner ». */
  const poserSacs = (valeur) => {
    vibrateTap();
    setNbSacs(Math.max(0, Math.min(MAX_SACS, valeur)));
    setErreur('');
  };

  const declarerDepart = async () => {
    if (nbSacs === null) {
      setErreur('Indiquez le nombre de sacs chargés avant de partir (0 si vous n’avez rien chargé).');
      vibrateError();
      return;
    }
    setChargement(true);
    setErreur('');
    const payload = {
      clientId: newClientId(),
      tourId,
      cavId: pointId,
      // Le NIVEAU de remplissage n'est plus envoyé d'ici : le serveur le dérive
      // du nombre de sacs, selon des bornes que le métier peut ajuster. Une
      // valeur devinée par le chauffeur et une valeur calculée n'auraient pas
      // la même signification dans l'historique d'apprentissage.
      nbSacs,
      notes,
      // Pas de QR code chez une association : le dire franchement plutôt que
      // de faire passer le passage pour scanné.
      qrScanned: false,
      arriveeAt: arrivee || null,
    };

    // Toujours en file d'abord : aucune collecte ne se perd, même si l'envoi rate.
    const pendingId = await addPendingCollect(payload);
    let status = 'pending';
    if (navigator.onLine) {
      try {
        await sendCollect(payload);
        await deleteItem(STORES.pendingCollects, pendingId);
        status = 'sent';
      } catch (e) {
        if (e?.response?.status >= 400 && e?.response?.status < 500) {
          await deleteItem(STORES.pendingCollects, pendingId);
          status = 'retry';
        }
      }
    }
    effacerArrivee(tourId, pointId);
    vibrateSuccess();
    setChargement(false);
    setConfirme({ status });
  };

  /** Camion plein : on déclare le retour au centre AVANT de quitter l'écran. */
  const retourCentre = async () => {
    setChargement(true);
    try {
      const res = await authedFetch(`/api/tours/${tourId}/retour-centre-public`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ motif: 'vidage' }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      navigate('/tour-map');
    } catch {
      // Hors ligne on le DIT, au lieu d'ouvrir une pesée pour un camion qui
      // n'est pas rentré (même règle que la carte de tournée).
      setErreur("Retour au centre non enregistré (réseau). Réessayez, ou passez par le bouton « Pesée » de la carte.");
      setChargement(false);
    }
  };

  if (confirme) {
    const lignes = [];
    if (nbSacs !== null) {
      lignes.push({
        label: 'Chargé',
        value: nbSacs === 0 ? 'Rien collecté' : `${nbSacs} sac${nbSacs > 1 ? 's' : ''}`,
      });
    }
    if (surPlace != null) lignes.push({ label: 'Temps sur place', value: formatDuree(surPlace) });
    if (notes) lignes.push({ label: 'Note', value: notes });
    return (
      <StepConfirmScreen
        title="Départ enregistré"
        cavName={titre}
        status={confirme.status}
        summaryLines={lignes}
        primaryLabel="Association suivante"
        onPrimary={() => navigate('/tour-map')}
        secondaryLabel="Camion plein — retour au centre"
        onCorrect={retourCentre}
        onAutoReturn={() => navigate('/tour-map')}
        autoReturnMs={10000}
      />
    );
  }

  return (
    <MobileShell
      title={titre || 'Association'}
      subtitle={arrivee ? 'Sur place' : 'À l’arrivée'}
      onBack={() => navigate('/tour-map')}
      usageHint="operational_stop"
      footer={
        <div className="primary-action-bar" style={{ display: 'grid', gap: 10 }}>
          {!arrivee ? (
            <button
              type="button"
              onClick={declarerArrivee}
              className="w-full font-extrabold text-lg text-white bg-[var(--color-primary)] active:scale-[0.98] transition-transform"
              style={{ minHeight: 76, borderRadius: 18, boxShadow: '0 8px 22px rgba(13,148,136,0.28)' }}
            >
              Déclarer mon arrivée
            </button>
          ) : (
            <button
              type="button"
              onClick={declarerDepart}
              disabled={chargement}
              className="w-full font-extrabold text-lg text-white bg-[var(--color-primary)] active:scale-[0.98] transition-transform disabled:opacity-50"
              style={{ minHeight: 76, borderRadius: 18, boxShadow: '0 8px 22px rgba(13,148,136,0.28)' }}
            >
              {chargement ? 'Enregistrement…' : 'Déclarer mon départ'}
            </button>
          )}
        </div>
      }
    >
      {erreur && (
        <div
          role="alert"
          className="mb-4 rounded-2xl px-4 py-3 text-base font-bold"
          style={{ background: '#FEE2E2', border: '2px solid #FCA5A5', color: '#991B1B' }}
        >
          {erreur}
        </div>
      )}

      {/* Ce que le chauffeur doit avoir sous les yeux EN ARRIVANT : à qui
          s'adresser, comment entrer. Rien ne s'affiche s'il n'y a rien à dire. */}
      <InfosPointAssociation point={point} />

      {rdvTexte && (
        <div
          className="mb-3 rounded-2xl px-4 py-3 text-base font-bold"
          style={{ background: '#EEF2FF', border: '2px solid #C7D2FE', color: '#3730A3' }}
        >
          📅 {rdvTexte}
        </div>
      )}
      {horaires && (
        <div
          className="mb-3 rounded-2xl px-4 py-2 text-sm font-bold"
          style={{
            background: horaires.etat === 'ferme' ? '#F1F5F9' : '#ECFDF5',
            border: `2px solid ${horaires.etat === 'ferme' ? '#CBD5E1' : '#A7F3D0'}`,
            color: horaires.etat === 'ferme' ? '#475569' : '#065F46',
          }}
        >
          {horaires.texte}
        </div>
      )}

      {arrivee && (
        <div
          className="mb-4 rounded-2xl px-4 py-3"
          style={{
            background: depasse ? '#FFFBEB' : 'var(--color-surface)',
            border: `2px solid ${depasse ? '#FDE68A' : '#E2E8F0'}`,
          }}
        >
          <p className="text-sm text-[var(--color-text-secondary)]">
            Arrivée déclarée à <b>{formatHeure(arrivee)}</b>
          </p>
          <p className="text-2xl font-extrabold" style={{ color: depasse ? '#B45309' : 'var(--color-primary)' }}>
            Sur place depuis {formatDuree(surPlace) || '—'}
          </p>
          {/* Le temps prévu n'est PAS une limite : c'est ce qui a servi à
              construire la journée. On le rappelle, on ne le reproche pas. */}
          {dureePrevue != null && (
            <p className="text-sm text-[var(--color-text-secondary)]">
              Temps prévu au programme : {formatDuree(dureePrevue)}
              {depasse ? ' — la suite de la journée va décaler' : ''}
            </p>
          )}
        </div>
      )}

      {arrivee && (
        <>
          <h2 className="font-bold text-lg mb-1">Combien de sacs avez-vous chargés ?</h2>
          <p className="text-sm text-[var(--color-text-secondary)] mb-3">
            Comptez les sacs en les chargeant. C’est ce nombre qui permet de
            savoir combien cette association a réellement apporté.
          </p>

          {/* Compteur : deux grandes cibles et un chiffre lisible à bout de
              bras. Aucun clavier n'est imposé — on saisit avec des gants, dans
              un local mal éclairé, souvent une main occupée. */}
          <div
            className="mb-3 rounded-2xl px-3 py-3"
            style={{ background: 'var(--color-surface)', border: '2px solid #E2E8F0' }}
          >
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => poserSacs((nbSacs ?? 0) - 1)}
                disabled={nbSacs === null || nbSacs === 0}
                aria-label="Un sac de moins"
                className="font-extrabold active:scale-[0.95] transition-transform disabled:opacity-30"
                style={{
                  minWidth: 88, minHeight: 88, borderRadius: 20, fontSize: 40,
                  background: '#F1F5F9', border: '2px solid #CBD5E1', color: 'var(--color-text)',
                }}
              >
                −
              </button>

              <div className="text-center flex-1" aria-live="polite">
                <div
                  className="font-extrabold leading-none"
                  style={{ fontSize: 56, color: nbSacs === null ? '#94A3B8' : 'var(--color-primary)' }}
                >
                  {nbSacs === null ? '—' : nbSacs}
                </div>
                <div className="text-base font-bold text-[var(--color-text-secondary)] mt-1">
                  {nbSacs === null
                    ? 'à renseigner'
                    : (nbSacs > 1 ? 'sacs' : 'sac')}
                </div>
              </div>

              <button
                type="button"
                onClick={() => poserSacs((nbSacs ?? 0) + 1)}
                aria-label="Un sac de plus"
                className="font-extrabold text-white active:scale-[0.95] transition-transform"
                style={{
                  minWidth: 88, minHeight: 88, borderRadius: 20, fontSize: 40,
                  background: 'var(--color-primary)', border: '2px solid var(--color-primary)',
                }}
              >
                +
              </button>
            </div>
          </div>

          {/* Raccourcis : ils POSENT la valeur, on ajuste ensuite au « + ». */}
          <div className="grid grid-cols-3 gap-2 mb-2">
            {RACCOURCIS_SACS.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => poserSacs(n)}
                aria-pressed={nbSacs === n}
                className="font-extrabold text-lg active:scale-[0.97] transition-transform"
                style={{
                  minHeight: 60, borderRadius: 16,
                  background: nbSacs === n ? 'var(--color-primary)' : 'var(--color-surface)',
                  color: nbSacs === n ? '#fff' : 'var(--color-text)',
                  border: `2px solid ${nbSacs === n ? 'var(--color-primary)' : '#E2E8F0'}`,
                }}
              >
                {n} sacs
              </button>
            ))}
          </div>

          {/* « Rien » doit rester atteignable d'un seul geste : une association
              qui n'avait rien à donner est une information, pas une absence de
              réponse — et elle ne se confond jamais avec « non déclaré ». */}
          <button
            type="button"
            onClick={() => poserSacs(0)}
            aria-pressed={nbSacs === 0}
            className="w-full font-extrabold text-lg mb-4 active:scale-[0.99] transition-transform"
            style={{
              minHeight: 60, borderRadius: 16,
              background: nbSacs === 0 ? '#B45309' : 'var(--color-surface)',
              color: nbSacs === 0 ? '#fff' : 'var(--color-text)',
              border: `2px solid ${nbSacs === 0 ? '#B45309' : '#E2E8F0'}`,
            }}
          >
            Rien collecté (0 sac)
          </button>

          <button
            type="button"
            onClick={() => setNotesOuvert((o) => !o)}
            className="w-full text-left px-4 py-3 rounded-2xl font-bold"
            style={{ background: 'var(--color-surface)', border: '2px solid #E2E8F0', minHeight: 56 }}
          >
            {notesOuvert ? '− ' : '+ '}Ajouter une remarque
          </button>
          {notesOuvert && (
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Ex. : local fermé côté rue, passer par la cour"
              className="w-full mt-2 px-4 py-3 rounded-2xl text-base"
              style={{ border: '2px solid #E2E8F0', background: 'var(--color-surface)' }}
            />
          )}
        </>
      )}

      {!arrivee && (
        <p className="text-base text-[var(--color-text-secondary)]">
          Prévenez l’application dès que vous êtes sur place : c’est ce qui permet
          de savoir combien de temps dure réellement une collecte chez cette
          association, et de tenir les rendez-vous des prochaines fois.
        </p>
      )}
    </MobileShell>
  );
}
