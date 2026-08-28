import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, MessageCircle, Maximize2, Info, ArrowLeft } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import EmptyState from '../EmptyState';
import useMessagerie from './useMessagerie';
import ConversationsList from './ConversationsList';
import FilConversation from './FilConversation';
import ComposerMessage from './ComposerMessage';
import { titreConversation } from './format';

/**
 * Panneau compact du dock : la même expérience que la page /messagerie
 * (mêmes composants ConversationsList/FilConversation/ComposerMessage,
 * partagés — pas de logique dupliquée), en plus petit, montée/démontée avec
 * le dock (donc sa propre connexion Socket.IO ne vit que pendant l'ouverture).
 */
export default function MessagerieDockPanel({ onClose }) {
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

  const isSysteme = m.selectedConversation?.type === 'systeme';

  return (
    <>
      <div className="fixed inset-0 bg-slate-900/20 z-40" onClick={onClose} aria-hidden="true" />
      <aside
        role="dialog"
        aria-label="Messagerie"
        className="fixed left-0 bottom-0 z-50 w-[min(380px,100vw)] h-[min(600px,calc(100vh-2rem))] bg-white rounded-tr-2xl sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden sm:left-5 sm:bottom-24"
      >
        <header className="flex items-center gap-2 px-3.5 py-3 border-b border-slate-100 flex-shrink-0">
          {m.selectedId && (
            <button
              onClick={() => m.selectConversation(null)}
              className="p-1.5 -ml-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-50"
              aria-label="Retour aux conversations"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}
          <h2 className="flex-1 min-w-0 text-sm font-bold text-slate-900 truncate">
            {m.selectedConversation ? titreConversation(m.selectedConversation, user?.id) : 'Messagerie'}
          </h2>
          <button
            onClick={() => navigate(m.selectedId ? `/messagerie?conversation=${m.selectedId}` : '/messagerie')}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-50"
            title="Ouvrir en plein écran"
            aria-label="Ouvrir en plein écran"
          >
            <Maximize2 className="w-4 h-4" />
          </button>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-50" aria-label="Fermer">
            <X className="w-4.5 h-4.5" />
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
      </aside>
    </>
  );
}
