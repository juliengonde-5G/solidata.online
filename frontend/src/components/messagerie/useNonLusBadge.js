import { useState, useEffect, useCallback } from 'react';
import useMessagerieSocket from './useMessagerieSocket';
import { fetchNonLus } from './messagerieApi';

/**
 * Compteur global de messages non lus, léger (n'implique PAS de charger la
 * liste complète des conversations) — utilisé par le badge du bouton unique
 * de la barre supérieure, qui doit rester à jour panneau fermé.
 *
 * Se resynchronise auprès du serveur (source de vérité) à chaque événement
 * temps réel plutôt que d'estimer un delta local : un delta pourrait dériver
 * si un autre onglet/appareil marque des messages lus entre-temps.
 *
 * `actif` (défaut true) : quand le module « messagerie » est masqué pour le
 * rôle, on n'interroge rien et on ne connecte rien — un compteur portant sur
 * des conversations que l'utilisateur ne peut pas ouvrir n'aurait aucun sens.
 */
export default function useNonLusBadge({ actif = true } = {}) {
  const [total, setTotal] = useState(0);
  const [error, setError] = useState(null);

  const recharger = useCallback(() => {
    if (!actif) return;
    fetchNonLus()
      .then((r) => {
        setTotal(Number(r.total) || 0);
        setError(null);
      })
      .catch((err) => {
        console.error('[Messagerie] compteur non-lus', err);
        setError('Compteur de messages indisponible.');
      });
  }, [actif]);

  useEffect(() => {
    recharger();
  }, [recharger]);

  const onEvenement = useCallback(() => {
    recharger();
  }, [recharger]);

  useMessagerieSocket({ actif, onNouveauMessage: onEvenement, onLu: onEvenement });

  return { total: actif ? total : 0, error };
}
