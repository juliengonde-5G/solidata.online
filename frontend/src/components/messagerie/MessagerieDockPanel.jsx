import { useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { MessageCircle, Maximize2, Info, ArrowLeft } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import EmptyState from '../EmptyState';
import useMessagerie from './useMessagerie';
import ConversationsList from './ConversationsList';
import FilConversation from './FilConversation';
import ComposerMessage from './ComposerMessage';
import { titreConversation } from './format';

/**
 * Contenu de l'onglet « Messages » du dock unifié : la même expérience que la
 * page /messagerie (mêmes composants ConversationsList/FilConversation/
 * ComposerMessage, partagés — pas de logique dupliquée), en plus petit.
 *
 * Le panneau, l'overlay et la fermeture appartiennent désormais au dock
 * (DockUnifie.jsx) : ce composant ne se positionne plus lui-même, il remplit
 * la place que l'onglet lui donne.
 *
 * `conversationDemandee` permet d'ouvrir directement une conversation depuis
 * l'extérieur (clic sur le toast d'un nouveau message).
 */
export default function MessagerieDockPanel({ conversationDemandee = null, onConversationOuverte }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const m = useMessagerie();

  const startBot = useCallback(() => m.demarrerConversation({ type: 'bot' }).catch(() => {}), [m]);
  const startWith = useCallback(
    (contact) => {
      const destinataire =
        contact.type === 'vehicule'
          ? { type: 'vehicule', vehicle_id: contact.vehicle_id }
          : { type: 'utilisateur', user_id: contact.user_id };
      return m.demarrerConversation(destinataire).catch(() => {});
    },
    [m]
  );

  // Ouverture pilotée de l'extérieur (toast). `selectConversation` est stable
  // le temps d'un montage ; on ne réagit qu'au changement de la demande pour
  // ne pas repositionner la sélection à chaque rendu.
  const selectRef = useRef(m.selectConversation);
  selectRef.current = m.selectConversation;
  useEffect(() => {
    if (!conversationDemandee) return;
    selectRef.current(conversationDemandee);
    onConversationOuverte?.();
  }, [conversationDemandee, onConversationOuverte]);

  const isSysteme = m.selectedConversation?.type === 'systeme';

  return (
    <div className="flex flex-col h-full min-h-0 min-w-0">
      {/* Sous-en-tête : le titre n'apparaît QUE sur une conversation ouverte —
          hors conversation, `ConversationsList` porte déjà son propre titre
          « Conversations », et l'afficher deux fois de suite était le genre de
          doublon qu'on ne voit qu'à l'écran. */}
      <header className="flex items-center gap-2 px-3.5 py-2 border-b border-slate-100 flex-shrink-0">
        {m.selectedId ? (
          <>
            <button
              onClick={() => m.selectConversation(null)}
              className="p-1.5 -ml-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-50 flex-shrink-0"
              aria-label="Retour aux conversations"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <h3 className="flex-1 min-w-0 text-sm font-bold text-slate-900 truncate">
              {titreConversation(m.selectedConversation, user?.id)}
            </h3>
          </>
        ) : (
          <span className="flex-1" />
        )}
        <button
          onClick={() => navigate(m.selectedId ? `/messagerie?conversation=${m.selectedId}` : '/messagerie')}
          className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-50 flex-shrink-0"
          title="Ouvrir en plein écran"
          aria-label="Ouvrir en plein écran"
        >
          {/* Hors conversation, le libellé accompagne l'icône : la barre
              porterait sinon un pictogramme seul au-dessus du vide. */}
          {!m.selectedId && <span className="text-[11px] font-semibold">Plein écran</span>}
          <Maximize2 className="w-4 h-4" />
        </button>
      </header>

      {/* `min-w-0` est indispensable : un élément flex a `min-width: auto`
          par défaut, si bien qu'il refuse de rétrécir sous la largeur de son
          contenu. Sans lui, une ligne un peu longue (« Aucun message pour
          l'instant. Écrivez le premier ! ») ne revient pas à la ligne et
          sort du panneau. */}
      <div className="flex-1 min-h-0 min-w-0 flex flex-col">
        {!m.selectedId ? (
          <ConversationsList
            conversations={m.conversations}
            loading={m.conversationsLoading}
            error={m.conversationsError}
            onReload={m.reloadConversations}
            selectedId={m.selectedId}
            onSelect={m.selectConversation}
            currentUserId={user?.id}
            onStartBot={startBot}
            onStartWith={startWith}
            starting={m.starting}
            startError={m.startError}
          />
        ) : m.selectedConversation ? (
          <>
            <FilConversation
              className="flex-1 min-h-0"
              conversationId={m.selectedId}
              messages={m.messages}
              loading={m.messagesLoading}
              error={m.messagesError}
              aPlus={m.aPlus}
              loadingOlder={m.loadingOlder}
              onLoadOlder={m.chargerMessagesPrecedents}
              olderLoadedTick={m.olderLoadedTick}
              currentUser={user}
              botThinking={m.sending && m.selectedConversation.type === 'bot'}
            />
            {m.sendError && <p className="px-3.5 pt-2 text-xs text-red-600 flex-shrink-0">{m.sendError}</p>}
            {isSysteme ? (
              <div className="flex items-center gap-2 px-3.5 py-2.5 border-t border-slate-100 text-[11px] text-slate-400 bg-slate-50 flex-shrink-0">
                <Info className="w-3.5 h-3.5 flex-shrink-0" /> Lecture seule — messages système.
              </div>
            ) : (
              <ComposerMessage onSend={m.envoyer} onMentionSelect={startWith} sending={m.sending} placeholder="Écrire…" />
            )}
          </>
        ) : (
          <EmptyState icon={MessageCircle} title="Conversation introuvable" />
        )}
      </div>
    </div>
  );
}
