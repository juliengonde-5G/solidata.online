import { useEffect, useRef } from 'react';
import io from 'socket.io-client';

/**
 * Abonnement Socket.IO aux événements de la messagerie interne
 * (`messagerie:nouveau` / `messagerie:lu`, contrat §2.4). Même pattern que
 * `useCavSensorSocket` : la connexion est ouverte une seule fois par montage,
 * les callbacks sont toujours appelés dans leur dernière version (via ref)
 * pour éviter les fermetures obsolètes sans reconnecter à chaque render.
 *
 * L'envoi passe TOUJOURS par REST (source de vérité, rejouable) — ce hook
 * n'émet jamais rien, il ne fait qu'écouter. La reconnexion (perte réseau,
 * veille de l'onglet…) est gérée nativement par socket.io-client.
 *
 * @param {{ onNouveauMessage?: (payload) => void, onLu?: (payload) => void }} handlers
 */
export default function useMessagerieSocket({ onNouveauMessage, onLu } = {}) {
  const nouveauRef = useRef(onNouveauMessage);
  const luRef = useRef(onLu);
  nouveauRef.current = onNouveauMessage;
  luRef.current = onLu;

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    if (!token) return undefined;

    const socket = io(window.location.origin, {
      auth: { token },
      transports: ['websocket', 'polling'],
    });

    socket.on('messagerie:nouveau', (data) => {
      if (nouveauRef.current) nouveauRef.current(data);
    });
    socket.on('messagerie:lu', (data) => {
      if (luRef.current) luRef.current(data);
    });
    socket.on('connect_error', (err) => {
      // Flux d'appoint (le REST reste la source de vérité) : on journalise
      // pour diagnostic, sans bandeau bloquant — la reconnexion est automatique.
      console.error('[Messagerie] connexion temps réel indisponible :', err?.message || err);
    });

    return () => {
      socket.off('messagerie:nouveau');
      socket.off('messagerie:lu');
      socket.off('connect_error');
      socket.disconnect();
    };
  }, []);
}
