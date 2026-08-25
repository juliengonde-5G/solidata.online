import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { syncEvents, getPendingCount, syncAll } from '../services/sync';

/**
 * Bandeau global d'état de synchronisation.
 *
 * Affiché UNIQUEMENT quand l'utilisateur doit savoir quelque chose :
 *   - hors ligne
 *   - synchronisation en cours
 *   - erreur
 *   - éléments locaux en attente
 * En nominal (online + 0 pending + idle), le bandeau n'apparaît pas.
 *
 * Placé en haut de l'écran sous la safe-area, en `position: fixed`.
 *
 * Étant fixe, il SORT du flux : sans réservation de place, il recouvrait
 * purement et simplement l'en-tête de la page (constaté sur la carte de
 * tournée — le numéro de tournée et l'avancement passaient sous le bandeau,
 * les deux textes se superposant et devenant illisibles). Le cas avait été
 * traité pour le bandeau de mode démo, jamais dans le cas général.
 *
 * Il publie donc sa hauteur réelle dans `--sync-banner-h` et pose la classe
 * `sync-banner-on` sur le body : le contenu applicatif se décale d'autant.
 */
export default function SyncStatusBanner() {
  const [state, setState] = useState(navigator.onLine ? 'idle' : 'offline');
  const [counts, setCounts] = useState({ total: 0 });
  const ref = useRef(null);

  useEffect(() => {
    const onState = (e) => setState(e.detail?.state || 'idle');
    const onPending = (e) => setCounts(e.detail?.counts || { total: 0 });
    syncEvents.addEventListener('state', onState);
    syncEvents.addEventListener('pending', onPending);
    getPendingCount();
    return () => {
      syncEvents.removeEventListener('state', onState);
      syncEvents.removeEventListener('pending', onPending);
    };
  }, []);

  const pending = counts.total || 0;
  const effectiveState = (() => {
    if (state === 'offline') return 'offline';
    if (state === 'syncing') return 'syncing';
    if (state === 'error') return 'error';
    if (pending > 0) return 'pending';
    return 'idle';
  })();

  const visible = effectiveState !== 'idle';

  // Réservation de la place occupée par le bandeau. La hauteur est MESURÉE
  // (safe-area et retour à la ligne compris) plutôt que devinée : une valeur
  // codée en dur redeviendrait fausse au premier changement de libellé.
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (!visible || !ref.current) {
      root.style.removeProperty('--sync-banner-h');
      document.body.classList.remove('sync-banner-on');
      return undefined;
    }
    const el = ref.current;
    const publier = () => root.style.setProperty('--sync-banner-h', `${el.offsetHeight}px`);
    publier();
    document.body.classList.add('sync-banner-on');
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(publier) : null;
    if (ro) ro.observe(el);
    return () => {
      if (ro) ro.disconnect();
      root.style.removeProperty('--sync-banner-h');
      document.body.classList.remove('sync-banner-on');
    };
  });

  if (!visible) return null;

  const labels = {
    offline: pending > 0
      ? `Hors ligne — ${pending} action${pending > 1 ? 's' : ''} enregistrée${pending > 1 ? 's' : ''}`
      : 'Hors ligne — rien n\u2019est perdu',
    syncing: 'Envoi en cours…',
    error: 'Erreur de synchronisation',
    pending: `${pending} action${pending > 1 ? 's' : ''} en attente d\u2019envoi`,
  };

  const icons = {
    offline: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M1 1l22 22" />
        <path d="M16.7 16.7A11.9 11.9 0 0 1 12 18c-3.3 0-6.3-1.3-8.5-3.5" />
        <path d="M5 12.5a7 7 0 0 1 3-1.9" />
        <path d="M19 12.5a7 7 0 0 0-3-1.9" />
      </svg>
    ),
    syncing: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="animate-spin" aria-hidden="true">
        <path d="M21 12a9 9 0 1 1-6.2-8.6" />
      </svg>
    ),
    error: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <line x1="12" y1="8" x2="12" y2="13" />
        <circle cx="12" cy="16.5" r="0.8" fill="currentColor" />
      </svg>
    ),
    pending: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
    ),
  };

  const canRetry = effectiveState === 'error' || (effectiveState === 'pending' && navigator.onLine);

  return (
    <div
      ref={ref}
      className={`sync-banner sync-banner--${effectiveState}`}
      role={effectiveState === 'error' ? 'alert' : 'status'}
      aria-live="polite"
    >
      <span aria-hidden="true">{icons[effectiveState]}</span>
      <span className="flex-1 truncate">{labels[effectiveState]}</span>
      {canRetry && (
        <button
          type="button"
          onClick={() => syncAll()}
          className="text-xs font-semibold underline"
        >
          Réessayer
        </button>
      )}
    </div>
  );
}
