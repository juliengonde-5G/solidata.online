import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import useMessagerieSocket from './useMessagerieSocket';
import {
  fetchConversations,
  createConversation,
  fetchMessages,
  postMessage,
  markConversationRead,
} from './messagerieApi';

const PAGE_SIZE = 50;

/** Tri "dernier_message_at DESC NULLS LAST" reproduit côté client (mêmes
 *  règles que le backend), nécessaire après toute mise à jour locale
 *  (message reçu en direct, nouvelle conversation démarrée…). */
function trierConversations(list) {
  return [...list].sort((a, b) => {
    const da = a.dernier_message?.created_at || null;
    const db = b.dernier_message?.created_at || null;
    if (!da && !db) return 0;
    if (!da) return 1;
    if (!db) return -1;
    return new Date(db) - new Date(da);
  });
}

/**
 * Contrôleur complet de la messagerie : conversations, fil de la conversation
 * sélectionnée, envoi, accusés de lecture, création de conversation, et
 * synchronisation temps réel. Utilisé identiquement par la page `/messagerie`
 * et par l'onglet « Messages » du dock unifié — chaque instance ouvre sa
 * propre connexion Socket.IO.
 *
 * @param {{ onSelectedChange?: (id: number|null) => void }} [options]
 */
export default function useMessagerie({ onSelectedChange } = {}) {
  const { user } = useAuth();

  const [conversations, setConversations] = useState([]);
  const [conversationsLoading, setConversationsLoading] = useState(true);
  const [conversationsError, setConversationsError] = useState(null);

  const [selectedId, setSelectedIdState] = useState(null);
  const [messages, setMessages] = useState([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [messagesError, setMessagesError] = useState(null);
  const [aPlus, setAPlus] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderLoadedTick, setOlderLoadedTick] = useState(0);

  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(null);

  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState(null);

  const selectedIdRef = useRef(null);
  selectedIdRef.current = selectedId;
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const totalNonLus = useMemo(
    () => conversations.reduce((s, c) => s + (Number(c.non_lus) || 0), 0),
    [conversations]
  );

  // ── Chargement des conversations ─────────────────────────────────────
  const chargerConversations = useCallback(async () => {
    setConversationsLoading(true);
    setConversationsError(null);
    try {
      const list = await fetchConversations();
      setConversations(trierConversations(list));
    } catch (err) {
      console.error('[Messagerie] chargement conversations', err);
      setConversationsError(err.response?.data?.error || 'Impossible de charger vos conversations.');
    } finally {
      setConversationsLoading(false);
    }
  }, []);

  useEffect(() => {
    chargerConversations();
  }, [chargerConversations]);

  // ── Accusé de lecture (arrière-plan, jamais bloquant) ────────────────
  const marquerLu = useCallback((conversationId, dernierLuMessageId) => {
    if (!conversationId || !dernierLuMessageId) return;
    setConversations((prev) =>
      prev.map((c) => (c.id === conversationId ? { ...c, non_lus: 0 } : c))
    );
    markConversationRead(conversationId, dernierLuMessageId).catch((err) => {
      // Action de fond non bloquante : journalisée, sans bandeau — un accusé
      // de lecture manqué se rattrapera au prochain message ou changement d'onglet.
      console.error('[Messagerie] accusé de lecture', err);
    });
  }, []);

  // ── Chargement du fil d'une conversation ─────────────────────────────
  const chargerMessages = useCallback(
    async (conversationId) => {
      setMessagesLoading(true);
      setMessagesError(null);
      setMessages([]);
      setAPlus(false);
      try {
        const { messages: msgs, aPlus: plus } = await fetchMessages(conversationId, { limit: PAGE_SIZE });
        setMessages(msgs);
        setAPlus(plus);
        const dernier = msgs[msgs.length - 1];
        if (dernier) marquerLu(conversationId, dernier.id);
      } catch (err) {
        console.error('[Messagerie] chargement messages', err);
        setMessagesError(
          err.response?.status === 403
            ? "Vous n'avez pas accès à cette conversation."
            : 'Impossible de charger les messages de cette conversation.'
        );
      } finally {
        setMessagesLoading(false);
      }
    },
    [marquerLu]
  );

  const rechargerMessages = useCallback(() => {
    if (selectedIdRef.current) chargerMessages(selectedIdRef.current);
  }, [chargerMessages]);

  const selectConversation = useCallback(
    (id) => {
      setSelectedIdState(id);
      onSelectedChange?.(id);
      if (id) {
        chargerMessages(id);
      } else {
        setMessages([]);
        setAPlus(false);
        setMessagesError(null);
      }
    },
    [chargerMessages, onSelectedChange]
  );

  // ── Pagination "messages précédents" (préserve la position visuelle,
  //    cf. FilConversation) ─────────────────────────────────────────────
  const chargerMessagesPrecedents = useCallback(async () => {
    if (!aPlus || loadingOlder || !selectedIdRef.current || messagesRef.current.length === 0) return;
    setLoadingOlder(true);
    try {
      const oldestId = messagesRef.current[0].id;
      const { messages: older, aPlus: plus } = await fetchMessages(selectedIdRef.current, {
        avantId: oldestId,
        limit: PAGE_SIZE,
      });
      setMessages((prev) => {
        const ids = new Set(prev.map((m) => m.id));
        return [...older.filter((m) => !ids.has(m.id)), ...prev];
      });
      setAPlus(plus);
      setOlderLoadedTick((t) => t + 1);
    } catch (err) {
      console.error('[Messagerie] chargement messages précédents', err);
      setMessagesError('Impossible de charger les messages précédents.');
    } finally {
      setLoadingOlder(false);
    }
  }, [aPlus, loadingOlder]);

  const ajouterMessageSiAbsent = useCallback((msg) => {
    if (!msg) return;
    setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]));
  }, []);

  // ── Envoi ─────────────────────────────────────────────────────────────
  const envoyer = useCallback(
    async (texte) => {
      const conversationId = selectedIdRef.current;
      if (!conversationId) return;
      setSending(true);
      setSendError(null);
      try {
        const res = await postMessage(conversationId, texte);
        ajouterMessageSiAbsent(res.message);
        if (res.reponse_bot) ajouterMessageSiAbsent(res.reponse_bot);
        if (!res.reponse_bot && res.bot_erreur) {
          setSendError(`SolidataBot n'a pas pu répondre (${res.bot_erreur}) — votre message a bien été envoyé.`);
        }
        setConversations((prev) =>
          trierConversations(
            prev.map((c) => (c.id === conversationId ? { ...c, dernier_message: res.message, non_lus: 0 } : c))
          )
        );
      } catch (err) {
        console.error('[Messagerie] envoi message', err);
        setSendError(err.response?.data?.error || "Le message n'a pas pu être envoyé. Réessayez.");
        throw err;
      } finally {
        setSending(false);
      }
    },
    [ajouterMessageSiAbsent]
  );

  // ── Démarrer / retrouver une conversation directe ou bot ─────────────
  const demarrerConversation = useCallback(
    async (destinataire) => {
      setStarting(true);
      setStartError(null);
      try {
        const conv = await createConversation(destinataire);
        setConversations((prev) => {
          const existe = prev.some((c) => c.id === conv.id);
          const next = existe ? prev.map((c) => (c.id === conv.id ? { ...c, ...conv } : c)) : [...prev, conv];
          return trierConversations(next);
        });
        selectConversation(conv.id);
        return conv;
      } catch (err) {
        console.error('[Messagerie] création conversation', err);
        setStartError(
          err.response?.status === 404
            ? "Ce contact n'est plus disponible."
            : err.response?.data?.error || "Impossible d'ouvrir cette conversation."
        );
        throw err;
      } finally {
        setStarting(false);
      }
    },
    [selectConversation]
  );

  // ── Temps réel ────────────────────────────────────────────────────────
  const onNouveauMessage = useCallback(
    (payload) => {
      if (!payload?.message) return;
      const { conversation_id: convId, message, non_lus_conversation } = payload;

      if (convId === selectedIdRef.current) {
        ajouterMessageSiAbsent(message);
        marquerLu(convId, message.id);
      }

      setConversations((prev) => {
        const existe = prev.some((c) => c.id === convId);
        if (!existe) {
          // Conversation inconnue du front (créée ailleurs, ex. mention
          // reçue) : on la recharge plutôt que d'en inventer la forme.
          chargerConversations();
          return prev;
        }
        const next = prev.map((c) =>
          c.id === convId
            ? {
                ...c,
                dernier_message: message,
                non_lus: convId === selectedIdRef.current ? 0 : (non_lus_conversation ?? c.non_lus),
              }
            : c
        );
        return trierConversations(next);
      });
    },
    [ajouterMessageSiAbsent, marquerLu, chargerConversations]
  );

  const onLu = useCallback((payload) => {
    if (!payload) return;
    const { conversation_id: convId, dernier_lu_message_id: dernierLu } = payload;
    // Le payload serveur ne porte pas l'identité du lecteur : on ne prétend
    // pas savoir si c'est l'autre participant, donc aucun indicateur "vu par"
    // n'est affiché — on recale seulement MON propre compteur (sync multi-onglets).
    setConversations((prev) =>
      prev.map((c) => {
        if (c.id !== convId) return c;
        const dernierMsgId = c.dernier_message?.id;
        if (dernierMsgId != null && dernierLu != null && dernierLu >= dernierMsgId) {
          return { ...c, non_lus: 0 };
        }
        return c;
      })
    );
  }, []);

  useMessagerieSocket({ onNouveauMessage, onLu });

  const selectedConversation = useMemo(
    () => conversations.find((c) => c.id === selectedId) || null,
    [conversations, selectedId]
  );

  return {
    user,

    conversations,
    conversationsLoading,
    conversationsError,
    reloadConversations: chargerConversations,
    totalNonLus,

    selectedId,
    selectedConversation,
    selectConversation,

    messages,
    messagesLoading,
    messagesError,
    aPlus,
    loadingOlder,
    olderLoadedTick,
    chargerMessagesPrecedents,
    rechargerMessages,

    sending,
    sendError,
    envoyer,

    starting,
    startError,
    demarrerConversation,
  };
}
