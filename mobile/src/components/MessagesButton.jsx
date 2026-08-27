import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { fetchNonLus } from '../services/messagerie';
import { subscribeMessagerie } from '../services/messagerieSocket';

const POLL_MS = 30000;

/**
 * Bouton flottant « Messages » — point d'entrée vers l'écran Messages,
 * présent sur tous les écrans une fois authentifié (l'app mobile n'a pas de
 * barre de navigation persistante : ce bouton EST « la navigation mobile
 * existante » sur laquelle s'affiche le badge de non-lus, contrat §4/point 1).
 *
 * Positionné à l'opposé de la bulle SolidataBot (bottom-20 RIGHT) pour ne
 * jamais se superposer à elle — mêmes dimensions, même hauteur.
 *
 * Le compteur se met à jour par sondage (30 s, filet quand le socket est
 * indisponible hors couverture) ET en temps réel via Socket.IO — un
 * changement de non-lus (nouveau message OU accusé de lecture ailleurs)
 * redemande simplement le total : c'est un appel léger, et la seule source
 * qui ne puisse jamais se désynchroniser est le serveur lui-même.
 */
export default function MessagesButton() {
  const [total, setTotal] = useState(0);
  const navigate = useNavigate();
  const location = useLocation();
  const pollRef = useRef(null);

  let hasToken = false;
  try { hasToken = !!localStorage.getItem('mobile_token'); } catch { /* ignore */ }

  const refresh = useCallback(async () => {
    try {
      const { total: n } = await fetchNonLus();
      setTotal(n);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasToken, refresh]);

  // Le sondage/l'abonnement socket ci-dessus tournent quel que soit l'écran
  // (le badge doit rester juste au retour sur un autre écran) ; seul le
  // BOUTON s'efface sur sa propre destination — inutile de flotter au-dessus
  // de l'écran qu'il ouvre.
  if (!hasToken || location.pathname.startsWith('/messages')) return null;

  return (
    <button
      type="button"
      onClick={() => navigate('/messages')}
      className="fixed bottom-20 left-4 z-[9999] w-14 h-14 rounded-full bg-[var(--color-primary)] text-white shadow-lg active:scale-95 transition-all duration-200 flex items-center justify-center"
      aria-label={total > 0 ? `Messages — ${total} non lus` : 'Messages'}
      title="Messages"
    >
      <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
      </svg>
      {total > 0 && (
        <span
          className="absolute -top-1.5 -right-1.5 min-w-[22px] h-[22px] px-1 rounded-full bg-red-500 border-2 border-white text-white text-[11px] font-extrabold flex items-center justify-center"
          aria-hidden="true"
        >
          {total > 9 ? '9+' : total}
        </span>
      )}
    </button>
  );
}
