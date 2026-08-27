import { useState, useEffect, useCallback } from 'react';
import useMessagerieSocket from './useMessagerieSocket';
import { fetchNonLus } from './messagerieApi';

/**
 * Compteur global de messages non lus, léger (n'implique PAS de charger la
 * liste complète des conversations) — utilisé par la pastille du dock, qui
 * doit rester à jour même quand le panneau est fermé.
 *
 * Se resynchronise auprès du serveur (source de vérité) à chaque événement
 * temps réel plutôt que d'estimer un delta local : un delta pourrait dériver
 * si un autre onglet/appareil marque des messages lus entre-temps.
 */
export default function useNonLusBadge() {
  const [total, setTotal] = useState(0);
  const [error, setError] = useState(null);

  const recharger = useCallback(() => {
    fetchNonLus()
      .then((r) => {
        setTotal(Number(r.total) || 0);
        setError(null);
      })
      .catch((err) => {
        console.error('[MessagerieDock] compteur non-lus', err);
        setError('Compteur de messages indisponible.');
      });
  }, []);

  useEffect(() => {
    recharger();
  }, [recharger]);

  const onEvenement = useCallback(() => {
    recharger();
  }, [recharger]);

  useMessagerieSocket({ onNouveauMessage: onEvenement, onLu: onEvenement });

  return { total, error };
}
