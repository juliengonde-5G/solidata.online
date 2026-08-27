import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import MobileShell from '../components/MobileShell';
import ReponsesRapides from '../components/messagerie/ReponsesRapides';
import FilConversation from '../components/messagerie/FilConversation';
import {
  fetchConversations, fetchThread, fetchContacts, openConversation, markRead,
  dernierMessageId,
} from '../services/messagerie';
import { addPendingMessage, getPendingMessages } from '../services/db';
import { syncPendingMessages } from '../services/sync';
import { subscribeMessagerie } from '../services/messagerieSocket';
import { setConversationOuverte } from '../services/messagerieViewState';
import { vibrateTap } from '../services/haptic';

const TEXTE_MAX = 4000;

/** Heure si aujourd'hui, sinon date courte FR (« 26/08 »). Ne lève jamais. */
function formatQuand(iso) {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    const auj = new Date();
    const meme = d.toDateString() === auj.toDateString();
    return meme
      ? d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
  } catch {
    return null;
  }
}

function iconePourType(type) {
  if (type === 'systeme') return '📣';
  if (type === 'bot') return '🤖';
  return '💬';
}

/**
 * Écran Messages (lot L3, mode conduite) : liste des conversations du
 * chauffeur (SOLIDATA + consignes + DMs), fil lisible en plein soleil,
 * réponses rapides + saisie libre optionnelle, envoi jamais bloquant.
 *
 * Vue interne à trois états — pas de sous-routes, pour ne rien perdre de
 * l'état de la liste en revenant du fil (comme les autres flux à étapes de
 * l'app, ex. TourMap/StepConfirmScreen).
 */
export default function Messages() {
  const [view, setView] = useState('liste'); // 'liste' | 'fil' | 'nouveau'
  const [conversations, setConversations] = useState([]);
  const [loadingListe, setLoadingListe] = useState(true);
  const [erreurListe, setErreurListe] = useState('');

  const [selected, setSelected] = useState(null);
  const [messages, setMessages] = useState([]);
  const [chargementFil, setChargementFil] = useState(false);
  const [erreurFil, setErreurFil] = useState('');
  const [texteLibre, setTexteLibre] = useState('');
  const [envoiEnCours, setEnvoiEnCours] = useState(false);

  const [contacts, setContacts] = useState([]);
  const [chargementContacts, setChargementContacts] = useState(false);
  const [erreurContacts, setErreurContacts] = useState('');

  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const urlAppliqueeRef = useRef(false);

  let vehicleId = null;
  try { vehicleId = localStorage.getItem('selected_vehicle_id'); } catch { /* ignore */ }

  const chargerConversations = useCallback(async () => {
    try {
      const liste = await fetchConversations();
      setConversations(liste);
      setErreurListe('');
      return liste;
    } catch (err) {
      setErreurListe('Impossible de charger vos messages. Vérifiez la connexion.');
      console.error('[MESSAGES]', err);
      return null;
    } finally {
      setLoadingListe(false);
    }
  }, []);

  const chargerFil = useCallback(async (conversationId) => {
    setChargementFil(true);
    setErreurFil('');
    let serveur = [];
    try {
      const res = await fetchThread(conversationId, { limit: 100 });
      serveur = res.messages;
      // Accusé de lecture — best effort, jamais bloquant pour l'affichage.
      const dernierId = dernierMessageId(serveur);
      if (dernierId != null) markRead(conversationId, dernierId).catch(() => {});
    } catch (err) {
      setErreurFil('Hors ligne — dernier fil connu affiché.');
      console.error('[MESSAGES] fil', err);
    }
    const enAttente = await getPendingMessages(conversationId).catch(() => []);
    const pendantes = enAttente.map((p) => ({
      id: null,
      clientId: p.clientId,
      auteur_type: 'chauffeur',
      auteur_vehicle_id: vehicleId != null ? Number(vehicleId) : null,
      texte: p.texte,
      type: 'texte',
      created_at: p.createdAt,
      pending: true,
    }));
    setMessages([...serveur, ...pendantes]);
    setChargementFil(false);
  }, [vehicleId]);

  const ouvrirConversation = (conv) => {
    setSelected(conv);
    setView('fil');
    setConversationOuverte(conv.id);
    chargerFil(conv.id);
  };

  const revenirListe = () => {
    setView('liste');
    setSelected(null);
    setMessages([]);
    setTexteLibre('');
    setConversationOuverte(null);
    chargerConversations();
  };

  useEffect(() => {
    chargerConversations();
  }, [chargerConversations]);

  // Ouverture directe depuis un lien (bannière « nouveau message »,
  // ?conversation=<id>) — une seule fois, puis le paramètre est retiré de
  // l'URL pour qu'un retour arrière ne le rejoue pas.
  useEffect(() => {
    if (urlAppliqueeRef.current) return;
    const brut = searchParams.get('conversation');
    if (!brut) return;
    const id = parseInt(brut, 10);
    if (!Number.isInteger(id)) return;
    urlAppliqueeRef.current = true;
    (async () => {
      const liste = conversations.length > 0 ? conversations : await chargerConversations();
      const trouvee = (liste || []).find((c) => c.id === id);
      if (trouvee) ouvrirConversation(trouvee);
      setSearchParams({}, { replace: true });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations, searchParams, chargerConversations, setSearchParams]);

  useEffect(() => () => setConversationOuverte(null), []);

  // Fil ouvert : les réponses arrivées en direct (Socket.IO) s'ajoutent tout
  // de suite, sans attendre qu'on quitte l'écran et qu'on y revienne.
  // Best effort — sans socket joignable, le fil reste juste celui chargé à
  // l'ouverture (rien de perdu, juste pas instantané).
  useEffect(() => {
    if (view !== 'fil' || !selected) return undefined;
    const onNouveau = (data) => {
      if (!data || data.conversation_id !== selected.id) return;
      const m = data.message;
      setMessages((prev) => (prev.some((x) => x.id != null && x.id === m.id) ? prev : [...prev, m]));
      if (m.id != null) markRead(selected.id, m.id).catch(() => {});
    };
    return subscribeMessagerie({ onNouveau });
  }, [view, selected]);

  const envoyerTexte = async (texte) => {
    const contenu = (texte || '').trim().slice(0, TEXTE_MAX);
    if (!contenu || !selected || envoiEnCours) return;
    vibrateTap();
    setEnvoiEnCours(true);
    setTexteLibre('');
    try {
      await addPendingMessage({ conversationId: selected.id, texte: contenu });
      // Affichage optimiste immédiat (file locale relue), puis tentative
      // d'envoi réel — jamais l'inverse : le message ne doit JAMAIS
      // disparaître de l'écran si le réseau coupe entre les deux.
      const enAttente = await getPendingMessages(selected.id).catch(() => []);
      setMessages((prev) => {
        const sansAncienPending = prev.filter((m) => !m.pending);
        return [...sansAncienPending, ...enAttente.map((p) => ({
          id: null,
          clientId: p.clientId,
          auteur_type: 'chauffeur',
          auteur_vehicle_id: vehicleId != null ? Number(vehicleId) : null,
          texte: p.texte,
          type: 'texte',
          created_at: p.createdAt,
          pending: true,
        }))];
      });
      await syncPendingMessages().catch(() => {});
      await chargerFil(selected.id);
    } finally {
      setEnvoiEnCours(false);
    }
  };

  const ouvrirNouveauMessage = async () => {
    setView('nouveau');
    setChargementContacts(true);
    setErreurContacts('');
    try {
      const liste = await fetchContacts();
      setContacts(liste);
    } catch (err) {
      setErreurContacts('Impossible de charger la liste des responsables.');
      console.error('[MESSAGES] contacts', err);
    } finally {
      setChargementContacts(false);
    }
  };

  const choisirContact = async (contact) => {
    try {
      const conv = await openConversation({ type: 'utilisateur', user_id: contact.user_id });
      setConversations((prev) => {
        if (prev.some((c) => c.id === conv.id)) return prev;
        return [conv, ...prev];
      });
      ouvrirConversation(conv);
    } catch (err) {
      setErreurContacts("Impossible d'ouvrir la conversation. Réessayez.");
      console.error('[MESSAGES] ouverture', err);
    }
  };

  const totalNonLus = useMemo(
    () => conversations.reduce((acc, c) => acc + (c.non_lus || 0), 0),
    [conversations]
  );

  // ── Vue « fil » ───────────────────────────────────────────────────────
  if (view === 'fil' && selected) {
    const estSysteme = selected.type === 'systeme';
    return (
      <div className="h-screen flex flex-col bg-[var(--color-surface-2)]">
        <header className="screen-header flex-shrink-0 flex flex-row items-center gap-3">
          <button
            type="button"
            onClick={revenirListe}
            className="touch-target flex items-center justify-center rounded-xl text-white/90 hover:bg-white/10 active:bg-white/20 transition-colors -ml-1"
            aria-label="Retour à la liste des messages"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="font-bold text-lg truncate">{selected.titre_affiche || 'Message'}</h1>
            {estSysteme && <p className="text-white/80 text-xs">Notifications de l'application</p>}
          </div>
        </header>

        {erreurFil && (
          <div className="bg-amber-50 border-b border-amber-200 text-amber-800 text-sm px-4 py-2 flex-shrink-0">
            {erreurFil}
          </div>
        )}

        {chargementFil && messages.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">Chargement…</div>
        ) : (
          <FilConversation messages={messages} vehicleId={vehicleId} conversationType={selected.type} />
        )}

        {estSysteme ? (
          <div className="primary-action-bar flex-shrink-0">
            <p className="text-sm text-gray-500 text-center py-2">
              Les notifications SOLIDATA ne reçoivent pas de réponse — pour parler à un responsable,
              revenez à la liste et choisissez « Écrire à un responsable ».
            </p>
          </div>
        ) : (
          <div className="primary-action-bar flex-shrink-0 space-y-3">
            <ReponsesRapides onSelect={envoyerTexte} disabled={envoiEnCours} />
            <div className="flex items-end gap-2">
              <textarea
                value={texteLibre}
                onChange={(e) => setTexteLibre(e.target.value.slice(0, TEXTE_MAX))}
                placeholder="Écrire un message (facultatif)…"
                rows={1}
                className="input-mobile flex-1 resize-none"
                style={{ minHeight: 56 }}
                aria-label="Message libre"
              />
              <button
                type="button"
                onClick={() => envoyerTexte(texteLibre)}
                disabled={envoiEnCours || !texteLibre.trim()}
                aria-label="Envoyer le message"
                className="touch-target flex-shrink-0 flex items-center justify-center rounded-2xl bg-[var(--color-primary)] text-white disabled:opacity-40"
                style={{ minWidth: 56, minHeight: 56 }}
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19V5m0 0l-7 7m7-7l7 7" />
                </svg>
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ── Vue « nouveau message » ──────────────────────────────────────────
  if (view === 'nouveau') {
    return (
      <MobileShell title="Écrire à un responsable" onBack={() => setView('liste')}>
        {erreurContacts && (
          <div className="mb-4 rounded-2xl bg-red-50 border border-red-200 p-4">
            <p className="text-sm font-semibold text-red-800">{erreurContacts}</p>
          </div>
        )}
        {chargementContacts ? (
          <div className="flex flex-col items-center justify-center py-12 text-gray-400">
            <div className="animate-spin rounded-full h-10 w-10 border-2 border-[var(--color-primary)] border-t-transparent mb-3" />
            <span className="text-sm">Chargement…</span>
          </div>
        ) : contacts.length === 0 ? (
          <p className="text-gray-500 text-sm text-center py-8">
            Aucun responsable disponible pour le moment.
          </p>
        ) : (
          <div className="space-y-2.5">
            {contacts.map((c) => (
              <button
                key={c.user_id}
                type="button"
                onClick={() => choisirContact(c)}
                className="touch-target w-full flex items-center gap-3 bg-white text-left active:scale-[0.99] transition-transform"
                style={{ borderRadius: 20, padding: 16, boxShadow: '0 2px 6px rgba(15,23,42,0.06)' }}
              >
                <span
                  className="w-12 h-12 flex-shrink-0 flex items-center justify-center text-xl rounded-2xl"
                  style={{ background: 'var(--color-primary-surface, #F0FDFA)' }}
                  aria-hidden="true"
                >
                  👤
                </span>
                <span className="font-bold text-gray-900 text-base">{c.nom}</span>
              </button>
            ))}
          </div>
        )}
      </MobileShell>
    );
  }

  // ── Vue « liste » (défaut) ───────────────────────────────────────────
  return (
    <MobileShell
      title="Messages"
      subtitle={totalNonLus > 0 ? `${totalNonLus} non lu${totalNonLus > 1 ? 's' : ''}` : null}
      onBack={() => navigate(-1)}
    >
      <button
        type="button"
        onClick={ouvrirNouveauMessage}
        className="btn-primary-mobile mb-4 flex items-center justify-center gap-2"
      >
        <span aria-hidden="true" className="text-lg">✏️</span>
        Écrire à un responsable
      </button>

      {erreurListe && (
        <div className="mb-4 rounded-2xl bg-red-50 border border-red-200 p-4">
          <p className="text-sm font-semibold text-red-800">{erreurListe}</p>
          <button
            type="button"
            onClick={() => { setLoadingListe(true); chargerConversations(); }}
            className="mt-2 text-sm font-bold text-red-700 underline"
          >
            Réessayer
          </button>
        </div>
      )}

      {loadingListe ? (
        <div className="flex flex-col items-center justify-center py-12 text-gray-400">
          <div className="animate-spin rounded-full h-10 w-10 border-2 border-[var(--color-primary)] border-t-transparent mb-3" />
          <span className="text-sm">Chargement…</span>
        </div>
      ) : conversations.length === 0 && !erreurListe ? (
        <p className="text-gray-500 text-sm text-center py-8">Aucun message pour le moment.</p>
      ) : (
        <div className="space-y-2.5">
          {conversations.map((conv) => {
            const dernier = conv.dernier_message;
            const nonLu = (conv.non_lus || 0) > 0;
            return (
              <button
                key={conv.id}
                type="button"
                onClick={() => ouvrirConversation(conv)}
                className="touch-target w-full flex items-center gap-3 bg-white text-left active:scale-[0.99] transition-transform"
                style={{
                  borderRadius: 20,
                  padding: 16,
                  boxShadow: nonLu ? '0 4px 14px rgba(13,148,136,0.18)' : '0 2px 6px rgba(15,23,42,0.06)',
                  border: nonLu ? '2px solid var(--color-primary)' : '2px solid transparent',
                }}
              >
                <span
                  className="w-12 h-12 flex-shrink-0 flex items-center justify-center text-xl rounded-2xl"
                  style={{ background: '#F1F5F9' }}
                  aria-hidden="true"
                >
                  {iconePourType(conv.type)}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className={`text-base truncate ${nonLu ? 'font-extrabold text-gray-900' : 'font-semibold text-gray-700'}`}>
                      {conv.titre_affiche}
                    </p>
                    {formatQuand(dernier?.created_at) && (
                      <span className="text-[11px] text-gray-400 flex-shrink-0">
                        {formatQuand(dernier.created_at)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-0.5">
                    <p className="text-sm text-gray-500 truncate">
                      {dernier ? dernier.texte : 'Pas encore de message'}
                    </p>
                    {nonLu && (
                      <span
                        className="flex-shrink-0 min-w-[22px] h-[22px] px-1.5 rounded-full bg-[var(--color-primary)] text-white text-[11px] font-extrabold flex items-center justify-center"
                        aria-label={`${conv.non_lus} messages non lus`}
                      >
                        {conv.non_lus > 9 ? '9+' : conv.non_lus}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </MobileShell>
  );
}
