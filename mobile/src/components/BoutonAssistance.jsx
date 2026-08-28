// React explicite : vitest transforme le JSX en mode classique (pas de plugin
// @vitejs/plugin-react dans vitest.config.js) — même convention que DemoModeBanner.
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import SolidataBot from './SolidataBot';
import { fetchNonLus, fetchConversations } from '../services/messagerie';
import { subscribeMessagerie } from '../services/messagerieSocket';
import { vibrateTap } from '../services/haptic';
import {
  EVENEMENT_CONSIGNES, sommeNonLus, libelleBadge, repartitionNonLus,
  boutonVisible, lienNotifications,
} from '../services/assistance';

const POLL_MS = 30000;

/**
 * BOUTON UNIQUE D'ASSISTANCE — Assistant, Messages, Notifications.
 *
 * CE QU'IL REMPLACE (28/08/2026) : deux bulles rondes flottaient en bas de
 * l'écran, `MessagesButton` (à gauche) et `SolidataBot` (à droite), avec la
 * MÊME icône de bulle de conversation. Deux boutons identiques, c'est un
 * bouton de trop — et, pour le chauffeur, deux fois la messagerie. Ils sont
 * fusionnés ici : un seul bouton, un seul badge (le TOTAL des non-lus), un
 * panneau à trois grands choix.
 *
 * PLACEMENT — en bas à DROITE, la position que tenait la bulle de l'assistant :
 * à portée du pouce, et du côté que la carte de tournée dégageait déjà
 * (correctif du 25/08, « 50 % remp… » recouvert). Le côté GAUCHE, lui, n'avait
 * jamais été traité : la bulle de la messagerie recouvrait le DÉBUT de la ligne
 * d'adresse — sur la capture de recette du 28/08, « 67 Rue de Strasbourg »
 * perdait son numéro et « CAUDEBEC-LÈS-ELBEUF » son début. Un défaut jumeau du
 * premier, jamais signalé, qui disparaît en n'ayant plus qu'un bouton, à droite.
 *
 * Sa place n'est plus codée en dur dans l'écran : le bouton PUBLIE sa largeur
 * réelle (`--bouton-assistance-w`, marge comprise) et pose
 * `bouton-assistance-on` sur le body ; la carte de tournée réserve d'autant
 * (classe `.reserve-bouton-assistance`, index.css) — non plus sur la seule
 * ligne du taux de remplissage, mais sur TOUT le bloc bas, dont le contenu
 * varie (titre long, badges rendez-vous/horaires/photo, encart association).
 * Même mécanique que les bandeaux (`--sync-banner-h`, `--demo-banner-h`) :
 * une valeur mesurée ne devient jamais périmée.
 *
 * PANNEAU — feuille remontant du bas, choix à portée de pouce, trois lignes
 * hautes (≥ 72 px), fort contraste, libellés courts (FALC : gants, plein
 * soleil, pas de lecture fine). Il n'y a AUCUNE réécriture des trois
 * destinations : l'assistant reste `SolidataBot` (piloté ici par une prop),
 * les messages restent l'écran `/messages`, les notifications sont le fil
 * « SOLIDATA » de ce même écran.
 *
 * HORS LIGNE — le panneau s'ouvre toujours. Le détail par ligne peut manquer
 * (il vient du serveur) : on le dit alors explicitement plutôt que d'afficher
 * des zéros, et les trois destinations restent accessibles.
 */
export default function BoutonAssistance() {
  const [nonLusMessagerie, setNonLusMessagerie] = useState(0);
  const [consignes, setConsignes] = useState(0);
  const [ouvert, setOuvert] = useState(false);
  const [assistantOuvert, setAssistantOuvert] = useState(false);
  const [repartition, setRepartition] = useState(() => repartitionNonLus(null));

  const navigate = useNavigate();
  const location = useLocation();
  const pollRef = useRef(null);
  const boutonRef = useRef(null);

  let hasToken = false;
  try { hasToken = !!localStorage.getItem('mobile_token'); } catch { /* ignore */ }

  // ── Badge : total des non-lus ───────────────────────────────────────────
  const refresh = useCallback(async () => {
    try {
      const { total } = await fetchNonLus();
      setNonLusMessagerie(total);
    } catch { /* hors ligne — on garde le dernier total connu */ }
  }, []);

  useEffect(() => {
    if (!hasToken) return undefined;
    refresh();
    pollRef.current = setInterval(refresh, POLL_MS);
    const onWake = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', onWake);
    const desabonner = subscribeMessagerie({ onNouveau: refresh, onLu: refresh });
    return () => {
      clearInterval(pollRef.current);
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', onWake);
      desabonner();
    };
  }, [hasToken, refresh]);

  // Consignes du responsable : publiées par DriverMessageBanner, qui sonde
  // déjà l'endpoint. On ne double pas la requête — voir EVENEMENT_CONSIGNES.
  useEffect(() => {
    const onConsignes = (e) => setConsignes(e.detail?.enAttente || 0);
    window.addEventListener(EVENEMENT_CONSIGNES, onConsignes);
    return () => window.removeEventListener(EVENEMENT_CONSIGNES, onConsignes);
  }, []);

  const total = sommeNonLus({ messagerie: nonLusMessagerie, consignes });
  const badge = libelleBadge(total);
  const visible = boutonVisible({ authentifie: hasToken, chemin: location.pathname });

  // ── Réservation de la place occupée par le bouton ───────────────────────
  // Largeur RÉELLE mesurée (jamais devinée), marge de droite comprise.
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (!visible || !boutonRef.current) {
      root.style.removeProperty('--bouton-assistance-w');
      document.body.classList.remove('bouton-assistance-on');
      return undefined;
    }
    const el = boutonRef.current;
    const publier = () => {
      const droite = window.innerWidth - el.getBoundingClientRect().right;
      root.style.setProperty('--bouton-assistance-w', `${Math.round(el.offsetWidth + Math.max(droite, 0))}px`);
    };
    publier();
    document.body.classList.add('bouton-assistance-on');
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(publier) : null;
    if (ro) ro.observe(el);
    window.addEventListener('resize', publier);
    return () => {
      if (ro) ro.disconnect();
      window.removeEventListener('resize', publier);
      root.style.removeProperty('--bouton-assistance-w');
      document.body.classList.remove('bouton-assistance-on');
    };
  }, [visible]);

  // ── Ouverture du panneau ────────────────────────────────────────────────
  const ouvrirPanneau = async () => {
    vibrateTap();
    setOuvert(true);
    // Détail par ligne : best effort. Un échec laisse `disponible: false`,
    // le panneau le dit — il ne montre jamais un « 0 » qu'il ne sait pas.
    try {
      setRepartition(repartitionNonLus(await fetchConversations()));
    } catch {
      setRepartition(repartitionNonLus(null));
    }
  };

  const fermerPanneau = () => setOuvert(false);

  const allerVers = (chemin) => {
    setOuvert(false);
    navigate(chemin);
  };

  const ouvrirAssistant = () => {
    setOuvert(false);
    setAssistantOuvert(true);
  };

  if (!hasToken) return null;

  return (
    <>
      {/* L'assistant reste le composant existant : il est simplement PILOTÉ
          d'ici (plus de bulle flottante à lui). Zéro réécriture du chat. */}
      <SolidataBot ouvert={assistantOuvert} onFermer={() => setAssistantOuvert(false)} />

      {visible && !ouvert && !assistantOuvert && (
        <button
          ref={boutonRef}
          type="button"
          onClick={ouvrirPanneau}
          className="fixed bottom-20 right-4 z-[9999] rounded-full bg-[var(--color-primary)] text-white shadow-lg active:scale-95 transition-all duration-200 flex items-center justify-center"
          style={{ width: 60, height: 60 }}
          aria-label={badge ? `Aide et messages — ${total} non lus` : 'Aide et messages'}
          title="Aide et messages"
        >
          <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          {badge && (
            <span
              className="absolute -top-1.5 -right-1.5 min-w-[24px] h-[24px] px-1 rounded-full bg-red-500 border-2 border-white text-white text-xs font-extrabold flex items-center justify-center"
              aria-hidden="true"
            >
              {badge}
            </span>
          )}
        </button>
      )}

      {ouvert && (
        <>
          <button
            type="button"
            onClick={fermerPanneau}
            aria-hidden="true"
            tabIndex={-1}
            className="fixed inset-0 z-[9998] bg-black/50 cursor-default"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Aide et messages"
            className="fixed bottom-0 left-0 right-0 z-[9999] bg-white shadow-2xl"
            style={{
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              paddingBottom: 'calc(var(--safe-bottom) + 12px)',
            }}
          >
            <div className="flex justify-center pt-2.5">
              <div className="w-10 h-1 rounded-full bg-gray-300" />
            </div>
            <div className="flex items-center justify-between gap-3 px-4 pt-2 pb-3">
              <h2 className="font-extrabold text-gray-900 text-lg">Aide et messages</h2>
              <button
                type="button"
                onClick={fermerPanneau}
                aria-label="Fermer"
                className="touch-target flex items-center justify-center rounded-2xl text-gray-500 active:bg-gray-100"
              >
                <svg className="w-7 h-7" fill="none" stroke="currentColor" strokeWidth={2.4} viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" d="M6 6l12 12M6 18L18 6" />
                </svg>
              </button>
            </div>

            <div className="px-4 pb-3 space-y-2.5">
              <LigneAssistance
                emoji="🤖"
                titre="Assistant"
                sousTitre="Poser une question à SolidataBot"
                onClick={ouvrirAssistant}
              />
              <LigneAssistance
                emoji="💬"
                titre="Messages"
                sousTitre="Écrire au responsable"
                badge={repartition.disponible ? libelleBadge(repartition.nonLusMessages) : null}
                onClick={() => allerVers('/messages')}
              />
              <LigneAssistance
                emoji="📣"
                titre="Notifications"
                sousTitre="Consignes et alertes reçues"
                badge={repartition.disponible
                  ? libelleBadge(repartition.nonLusNotifications + consignes)
                  : null}
                onClick={() => allerVers(lienNotifications(repartition.conversationSystemeId))}
              />
            </div>

            {!repartition.disponible && (
              <p className="px-4 pb-3 text-sm text-gray-500">
                Détail non chargé — vérifiez la connexion. Les trois accès restent utilisables.
              </p>
            )}
          </div>
        </>
      )}
    </>
  );
}

/** Une des trois entrées du panneau : cible tactile large, badge à droite. */
function LigneAssistance({ emoji, titre, sousTitre, badge = null, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="touch-target w-full flex items-center gap-3 bg-white text-left active:scale-[0.99] transition-transform"
      style={{
        borderRadius: 20,
        padding: 14,
        minHeight: 76,
        border: '2px solid var(--color-border)',
        boxShadow: '0 2px 6px rgba(15,23,42,0.06)',
      }}
    >
      <span
        className="w-12 h-12 flex-shrink-0 flex items-center justify-center text-2xl rounded-2xl"
        style={{ background: '#F0FDFA' }}
        aria-hidden="true"
      >
        {emoji}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block font-extrabold text-gray-900 text-lg leading-tight">{titre}</span>
        <span className="block text-sm text-gray-500 leading-snug">{sousTitre}</span>
      </span>
      {badge && (
        <span
          className="flex-shrink-0 min-w-[28px] h-7 px-2 rounded-full bg-red-500 text-white text-sm font-extrabold flex items-center justify-center"
          aria-label={`${badge} non lus`}
        >
          {badge}
        </span>
      )}
    </button>
  );
}
