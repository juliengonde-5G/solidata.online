// `React` est importé explicitement (et non seulement les hooks) : les tests
// rendent ce composant via react-dom/server sans le plugin JSX automatique
// (vitest.config.js), donc le JSX y est compilé en React.createElement.
// Même convention que components/DemoModeBanner.jsx.
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import MobileShell from '../components/MobileShell';
import PrimaryActionBar from '../components/PrimaryActionBar';
import StepConfirmScreen from '../components/StepConfirmScreen';
import SignaturePad from '../components/SignaturePad';
import { vibrateSuccess, vibrateError, vibrateTap } from '../services/haptic';
import { addPendingBordereau, deleteItem, newClientId, STORES } from '../services/db';
import { sendBordereau, getPendingCount } from '../services/sync';
import {
  MOTIF_AGENT_INDISPONIBLE,
  POIDS_INDICATIF_MAX_KG,
  validerBordereau,
} from '../services/decheterie';

/**
 * Bordereau de collecte en déchèterie — Métropole Rouen Normandie (2.50.0).
 *
 * Une déchèterie n'est pas une borne de rue : la Métropole exige un bordereau
 * papier signé par SON agent et par le chauffeur. Cet écran est la version
 * mobile de ce papier — c'est la seule pièce du parcours chauffeur qui engage
 * un TIERS, et la seule qui ne se refait jamais après coup : quand le camion
 * est reparti, l'agent n'est plus là.
 *
 * Trois temps, numérotés, dans l'ordre où ils se déroulent sur le quai :
 *   1. le poids indicatif, que le chauffeur estime ;
 *   2. la signature de l'agent, tant qu'il est devant lui ;
 *   3. la sienne.
 *
 * DEUX RÈGLES DE CONDUITE :
 *
 *  • LE POIDS EST INDICATIF. Il ne rejoint aucune pesée, aucun tonnage, aucun
 *    apprentissage — c'est écrit à l'écran, sinon un chauffeur consciencieux
 *    irait chercher une balance qu'il n'a pas.
 *
 *  • HORS LIGNE, ON N'EMPÊCHE RIEN. Le bordereau part en file avec ses
 *    signatures et le DIT (« sera envoyé dès que le réseau revient »). Bloquer
 *    ici reviendrait à renvoyer le chauffeur chercher du réseau avec un agent
 *    qui attend, ou à perdre la signature — la file est justement là pour ça.
 */
export default function DecheterieBordereau() {
  const navigate = useNavigate();
  const tourId = localStorage.getItem('current_tour_id');
  const cavId = localStorage.getItem('selected_cav_id');
  const cavName = localStorage.getItem('selected_cav_name');

  const [poidsKg, setPoidsKg] = useState(null);
  const [signatureAgent, setSignatureAgent] = useState(null);
  const [agentAbsentMotif, setAgentAbsentMotif] = useState(null);
  const [signatureChauffeur, setSignatureChauffeur] = useState(null);
  const [chargement, setChargement] = useState(false);
  const [erreur, setErreur] = useState('');
  const [confirme, setConfirme] = useState(null); // { status, message }

  // Le bordereau se rattache à un passage précis (tournée × point). Sans ces
  // deux repères il n'y a rien à documenter : on le dit et on renvoie à la
  // carte, plutôt que d'ouvrir un formulaire qui ne pourra jamais partir.
  const contexteManquant = !tourId || !cavId;
  useEffect(() => {
    if (contexteManquant) setErreur("Point introuvable. Revenez à la carte et rouvrez le point.");
  }, [contexteManquant]);

  const validation = useMemo(
    () => validerBordereau({ poidsKg, signatureAgent, agentAbsentMotif, signatureChauffeur }),
    [poidsKg, signatureAgent, agentAbsentMotif, signatureChauffeur],
  );

  /** Pose le poids en le bornant. Zéro est une valeur, pas une absence. */
  const poserPoids = (valeur) => {
    vibrateTap();
    const v = Math.max(0, Math.min(POIDS_INDICATIF_MAX_KG, Math.round(valeur * 10) / 10));
    setPoidsKg(v);
    setErreur('');
  };

  const saisirPoids = (texte) => {
    const brut = String(texte).replace(',', '.').trim();
    if (brut === '') { setPoidsKg(null); return; }
    const n = Number(brut);
    if (!Number.isFinite(n)) return;             // frappe illisible : on ignore
    setPoidsKg(Math.max(0, Math.min(POIDS_INDICATIF_MAX_KG, n)));
    setErreur('');
  };

  /** Bascule « l'agent n'est pas disponible » — réversible d'un même geste. */
  const basculerAgentAbsent = () => {
    vibrateTap();
    setErreur('');
    setAgentAbsentMotif((precedent) => {
      if (precedent === MOTIF_AGENT_INDISPONIBLE) return null;
      // Le pad est désactivé ET vidé : garder un paraphe sous « agent absent »
      // ferait mentir le document.
      setSignatureAgent(null);
      return MOTIF_AGENT_INDISPONIBLE;
    });
  };

  const agentAbsent = agentAbsentMotif === MOTIF_AGENT_INDISPONIBLE;

  const envoyer = async () => {
    if (contexteManquant) return;
    if (!validation.ok) {
      vibrateError();
      setErreur(validation.erreurs[0]);
      return;
    }
    setChargement(true);
    setErreur('');

    const item = {
      clientId: newClientId(),
      tourId,
      cavId,
      poidsKg,
      signatureAgent: agentAbsent ? null : signatureAgent,
      agentAbsentMotif: agentAbsent ? MOTIF_AGENT_INDISPONIBLE : null,
      signatureChauffeur,
    };

    // FILE D'ABORD, toujours : si l'envoi échoue — ou si l'application est
    // fermée dans la seconde qui suit —, les signatures sont déjà à l'abri.
    let pendingId = null;
    try {
      pendingId = await addPendingBordereau(item);
    } catch (e) {
      // Stockage local indisponible (navigation privée, quota) : on tente
      // quand même l'envoi direct plutôt que d'abandonner un document signé.
      console.warn('[BORDEREAU] mise en file impossible :', e?.message || e);
    }

    let status = 'pending';
    let message = null;
    if (navigator.onLine) {
      try {
        await sendBordereau(item);
        if (pendingId != null) await deleteItem(STORES.pendingBordereaux, pendingId).catch(() => {});
        status = 'sent';
      } catch (e) {
        const code = e?.response?.status;
        if (code >= 400 && code < 500 && code !== 401 && !e?.retryable) {
          // Refus DÉFINITIF du serveur : rejouer ne changerait rien. On purge
          // et on montre SON motif — « erreur » tout court laisserait le
          // chauffeur relancer indéfiniment.
          if (pendingId != null) await deleteItem(STORES.pendingBordereaux, pendingId).catch(() => {});
          status = 'retry';
          message = e?.response?.data?.error || 'Bordereau refusé par le serveur.';
        } else {
          status = 'pending';
        }
      }
    }

    await getPendingCount().catch(() => {});
    if (status === 'retry') vibrateError(); else vibrateSuccess();
    setChargement(false);
    setConfirme({ status, message });
  };

  /** Nettoyage identique à `finishAndReturn` de FillLevel, puis retour carte. */
  const terminer = () => {
    localStorage.removeItem('scanned_qr');
    localStorage.removeItem('selected_cav_id');
    localStorage.removeItem('selected_cav_name');
    localStorage.removeItem('qr_unavailable_reason');
    navigate('/tour-map');
  };

  const lignesResume = useMemo(() => {
    const lignes = [];
    if (cavName) lignes.push({ label: 'Point', value: cavName });
    if (poidsKg != null) lignes.push({ label: 'Poids indicatif', value: `${poidsKg} kg` });
    lignes.push({
      label: 'Agent déchèterie',
      value: agentAbsent ? 'Non disponible — signature non recueillie' : 'A signé',
    });
    lignes.push({ label: 'Chauffeur', value: signatureChauffeur ? 'A signé' : '—' });
    if (confirme?.message) lignes.push({ label: 'Réponse du serveur', value: confirme.message });
    return lignes;
  }, [cavName, poidsKg, agentAbsent, signatureChauffeur, confirme]);

  if (confirme) {
    return (
      <StepConfirmScreen
        title="Bordereau enregistré"
        cavName={cavName}
        status={confirme.status}
        summaryLines={lignesResume}
        primaryLabel="Point suivant"
        onPrimary={terminer}
        secondaryLabel={null}
        onCorrect={null}
        onAutoReturn={terminer}
        autoReturnMs={10000}
      />
    );
  }

  return (
    <MobileShell
      title="Bordereau déchèterie"
      subtitle={cavName || 'Métropole Rouen Normandie'}
      onBack={() => navigate('/tour-map')}
      usageHint="operational_stop"
      footer={
        <PrimaryActionBar
          primaryLabel="Valider le bordereau"
          onPrimary={envoyer}
          loading={chargement}
          disabled={contexteManquant || !validation.ok}
          error={erreur || null}
          pendingOffline={!navigator.onLine}
        />
      }
    >
      <div className="space-y-6">
        <div
          className="rounded-2xl px-4 py-3 text-[14px] font-semibold"
          style={{ background: '#FFF7ED', border: '2px solid #FED7AA', color: '#9A3412' }}
          role="status"
        >
          La Métropole demande un bordereau signé pour chaque passage en
          déchèterie. Remplissez les trois cadres ci-dessous, puis validez.
        </div>

        {/* ─── 1. Poids indicatif ────────────────────────────────────────── */}
        <section aria-labelledby="titre-poids">
          <h2 id="titre-poids" className="font-extrabold text-lg mb-1">1. Poids collecté (kg)</h2>
          <p className="text-[13px] font-semibold mb-3" style={{ color: '#B45309' }}>
            Poids indicatif pour la Métropole — ce n’est pas une pesée. Il
            n’entre ni dans le tonnage de la tournée ni dans le stock.
          </p>

          <div
            className="rounded-2xl px-3 py-3 mb-3"
            style={{ background: 'var(--color-surface)', border: '2px solid #E2E8F0' }}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => poserPoids((poidsKg ?? 0) - 50)}
                  disabled={poidsKg === null || poidsKg === 0}
                  aria-label="Cinquante kilos de moins"
                  className="font-extrabold active:scale-[0.95] transition-transform disabled:opacity-30"
                  style={{ minWidth: 88, minHeight: 88, borderRadius: 20, fontSize: 20, background: '#F1F5F9', border: '2px solid #CBD5E1', color: 'var(--color-text)' }}
                >
                  −50
                </button>
                <button
                  type="button"
                  onClick={() => poserPoids((poidsKg ?? 0) - 10)}
                  disabled={poidsKg === null || poidsKg === 0}
                  aria-label="Dix kilos de moins"
                  className="font-extrabold active:scale-[0.95] transition-transform disabled:opacity-30"
                  style={{ minWidth: 88, minHeight: 88, borderRadius: 20, fontSize: 20, background: '#F1F5F9', border: '2px solid #CBD5E1', color: 'var(--color-text)' }}
                >
                  −10
                </button>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => poserPoids((poidsKg ?? 0) + 10)}
                  aria-label="Dix kilos de plus"
                  className="font-extrabold text-white active:scale-[0.95] transition-transform"
                  style={{ minWidth: 88, minHeight: 88, borderRadius: 20, fontSize: 20, background: 'var(--color-primary)', border: '2px solid var(--color-primary)' }}
                >
                  +10
                </button>
                <button
                  type="button"
                  onClick={() => poserPoids((poidsKg ?? 0) + 50)}
                  aria-label="Cinquante kilos de plus"
                  className="font-extrabold text-white active:scale-[0.95] transition-transform"
                  style={{ minWidth: 88, minHeight: 88, borderRadius: 20, fontSize: 20, background: 'var(--color-primary)', border: '2px solid var(--color-primary)' }}
                >
                  +50
                </button>
              </div>
            </div>

            <div className="text-center mt-3" aria-live="polite">
              <div
                className="font-extrabold leading-none"
                style={{ fontSize: 56, color: poidsKg === null ? '#94A3B8' : 'var(--color-primary)' }}
              >
                {poidsKg === null ? '—' : poidsKg}
              </div>
              <div className="text-base font-bold text-[var(--color-text-secondary)] mt-1">
                {poidsKg === null ? 'à renseigner' : 'kg (estimation)'}
              </div>
            </div>
          </div>

          {/* Raccourcis : ils POSENT la valeur, on ajuste ensuite aux ±10/±50
              (même patron que le compteur de sacs d'AssociationStop). */}
          <div className="grid grid-cols-3 gap-2 mb-2">
            {[50, 100, 200].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => poserPoids(n)}
                aria-pressed={poidsKg === n}
                className="font-extrabold text-lg active:scale-[0.97] transition-transform"
                style={{
                  minHeight: 60, borderRadius: 16,
                  background: poidsKg === n ? 'var(--color-primary)' : 'var(--color-surface)',
                  color: poidsKg === n ? '#fff' : 'var(--color-text)',
                  border: `2px solid ${poidsKg === n ? 'var(--color-primary)' : '#E2E8F0'}`,
                }}
              >
                {n} kg
              </button>
            ))}
          </div>

          {/* Le clavier reste disponible : à 1 340 kg, les boutons ne suffisent
              plus, et forcer vingt-sept appuis serait absurde. */}
          <label className="flex items-center gap-3 rounded-2xl px-4 py-3"
            style={{ background: 'var(--color-surface)', border: '2px solid #E2E8F0' }}>
            <span className="text-[13px] font-bold text-[var(--color-text-secondary)] flex-shrink-0">
              Saisir au clavier
            </span>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              max={POIDS_INDICATIF_MAX_KG}
              value={poidsKg === null ? '' : String(poidsKg)}
              onChange={(e) => saisirPoids(e.target.value)}
              placeholder="kg"
              aria-label="Poids indicatif en kilogrammes"
              className="flex-1 bg-transparent outline-none text-right text-lg font-bold text-gray-900"
              style={{ minHeight: 44 }}
            />
            <span className="font-bold text-gray-500">kg</span>
          </label>
        </section>

        {/* ─── 2. Signature de l'agent ───────────────────────────────────── */}
        <section aria-labelledby="titre-agent">
          <h2 id="titre-agent" className="font-extrabold text-lg mb-1">
            2. Signature de l’agent de la déchèterie
          </h2>
          <p className="text-[13px] text-[var(--color-text-secondary)] mb-3">
            Faites signer l’agent sur l’écran, maintenant : une fois reparti,
            cette signature ne peut plus être recueillie.
          </p>

          <SignaturePad
            id="signature-agent"
            label="Signature de l’agent"
            value={signatureAgent}
            onChange={setSignatureAgent}
            disabled={agentAbsent}
          />

          <button
            type="button"
            onClick={basculerAgentAbsent}
            aria-pressed={agentAbsent}
            className="w-full font-extrabold text-[15px] mt-3 active:scale-[0.99] transition-transform"
            style={{
              minHeight: 60, borderRadius: 16,
              background: agentAbsent ? '#B45309' : 'var(--color-surface)',
              color: agentAbsent ? '#fff' : 'var(--color-text)',
              border: `2px solid ${agentAbsent ? '#B45309' : '#E2E8F0'}`,
            }}
          >
            {agentAbsent ? '✓ L’agent n’est pas disponible' : 'L’agent n’est pas disponible'}
          </button>
          {agentAbsent && (
            <p className="mt-2 text-[13px] font-semibold" style={{ color: '#B45309' }} role="status">
              Le bordereau portera la mention « Signature de l’agent non
              recueillie : agent indisponible ». Appuyez de nouveau sur le
              bouton si l’agent arrive.
            </p>
          )}
        </section>

        {/* ─── 3. Signature du chauffeur ─────────────────────────────────── */}
        <section aria-labelledby="titre-chauffeur">
          <h2 id="titre-chauffeur" className="font-extrabold text-lg mb-1">
            3. Votre signature
          </h2>
          <p className="text-[13px] text-[var(--color-text-secondary)] mb-3">
            Signez à votre tour pour clore le bordereau.
          </p>
          <SignaturePad
            id="signature-chauffeur"
            label="Signature du chauffeur"
            value={signatureChauffeur}
            onChange={setSignatureChauffeur}
          />
        </section>

        {!validation.ok && (
          <div
            className="rounded-2xl px-4 py-3 text-[14px] font-bold"
            style={{ background: '#FEF3C7', border: '2px solid #FDE68A', color: '#92400E' }}
            role="status"
          >
            <p className="mb-1">Il reste à faire :</p>
            <ul className="list-disc pl-5 space-y-1 font-semibold">
              {validation.erreurs.map((e) => <li key={e}>{e}</li>)}
            </ul>
          </div>
        )}

        {!navigator.onLine && (
          <p className="text-[13px] font-semibold" style={{ color: '#B45309' }}>
            Hors réseau : le bordereau et les deux signatures sont gardés sur le
            téléphone et partiront dès que le réseau revient. Rien n’est perdu.
          </p>
        )}
      </div>
    </MobileShell>
  );
}
