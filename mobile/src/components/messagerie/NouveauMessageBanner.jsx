import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { subscribeMessagerie } from '../../services/messagerieSocket';
import { getConversationOuverte } from '../../services/messagerieViewState';
import { doitNotifier } from '../../services/messagerie';
import { vibrateSuccess } from '../../services/haptic';

const AUTO_MASQUE_MS = 7000;

/**
 * Bannière « Nouveau message » — pattern des bandeaux existants (démo,
 * synchro, contrat §4) : fixée en haut, elle NE RECOUVRE PAS l'en-tête —
 * elle publie sa hauteur réelle en `--message-banner-h` (glisse sous les
 * bandeaux démo/synchro déjà présents ; `index.css` en tient compte pour
 * `.screen-header`). Tap = ouvre le fil ; vibration à l'arrivée.
 *
 * Best effort : sans Socket.IO joignable (hors couverture), aucun toast —
 * le bouton flottant (badge non-lus) et l'écran Messages restent la source
 * de vérité, rechargée au retour en ligne.
 */
export default function NouveauMessageBanner() {
  const [notif, setNotif] = useState(null);
  const ref = useRef(null);
  const timerRef = useRef(null);
  const navigate = useNavigate();

  let hasToken = false;
  try { hasToken = !!localStorage.getItem('mobile_token'); } catch { /* ignore */ }
  let vehicleId = null;
  try { vehicleId = localStorage.getItem('selected_vehicle_id'); } catch { /* ignore */ }

  useEffect(() => {
    if (!hasToken || !vehicleId) return undefined;
    const onNouveau = (data) => {
      if (!doitNotifier(data, vehicleId, getConversationOuverte())) return;
      vibrateSuccess();
      setNotif({
        conversationId: data.conversation_id,
        auteur: data.message.auteur_nom || 'Un responsable',
        texte: data.message.texte,
      });
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setNotif(null), AUTO_MASQUE_MS);
    };
    const desabonner = subscribeMessagerie({ onNouveau });
    return () => {
      desabonner();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasToken, vehicleId]);

  useLayoutEffect(() => {
    const root = document.documentElement;
    if (!notif || !ref.current) {
      root.style.removeProperty('--message-banner-h');
      document.body.classList.remove('message-banner-on');
      return undefined;
    }
    const el = ref.current;
    const publier = () => root.style.setProperty('--message-banner-h', `${el.offsetHeight}px`);
    publier();
    document.body.classList.add('message-banner-on');
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(publier) : null;
    if (ro) ro.observe(el);
    return () => {
      if (ro) ro.disconnect();
      root.style.removeProperty('--message-banner-h');
      document.body.classList.remove('message-banner-on');
    };
  }, [notif]);

  if (!notif) return null;

  const ouvrir = () => {
    setNotif(null);
    navigate(`/messages?conversation=${notif.conversationId}`);
  };

  return (
    <div ref={ref} role="status" aria-live="polite" className="message-banner">
      <button
        type="button"
        onClick={ouvrir}
        className="w-full flex items-center gap-3 bg-teal-700 text-white text-left"
        style={{ paddingTop: 'calc(var(--safe-top) + 10px)' }}
      >
        <div className="flex-1 min-w-0 px-4 pb-3">
          <p className="text-[11px] uppercase tracking-wide font-extrabold text-teal-100">
            Nouveau message — {notif.auteur}
          </p>
          <p className="font-bold text-base leading-snug truncate">{notif.texte}</p>
        </div>
        <span aria-hidden="true" className="pr-4 pb-3 text-2xl flex-shrink-0">💬</span>
      </button>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setNotif(null); }}
        aria-label="Fermer la notification"
        className="absolute rounded-full bg-black/20 text-white flex items-center justify-center"
        style={{ top: 'calc(var(--safe-top) + 6px)', right: 6, width: 32, height: 32 }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
          <path d="M6 6l12 12M6 18L18 6" />
        </svg>
      </button>
    </div>
  );
}
