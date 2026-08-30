import { useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MessageCircle, Info, ArrowLeft } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import Layout from '../components/Layout';
import EmptyState from '../components/EmptyState';
import useMessagerie from '../components/messagerie/useMessagerie';
import ConversationsList from '../components/messagerie/ConversationsList';
import FilConversation from '../components/messagerie/FilConversation';
import ComposerMessage from '../components/messagerie/ComposerMessage';
import { titreConversation } from '../components/messagerie/format';

/**
 * Page /messagerie — expérience complète type Slack : colonne conversations,
 * fil de discussion, composer. Voir le contrat figé
 * rapports/evolutions-2026-08-26/CONTRATS.md §3 pour le détail des règles
 * (temps réel, mentions = ouverture de conversation privée, etc.).
 */
export default function Messagerie() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const handleSelectedChange = useCallback(
    (id) => {
      setSearchParams(id ? { conversation: String(id) } : {}, { replace: true });
    },
    [setSearchParams]
  );

  const m = useMessagerie({ onSelectedChange: handleSelectedChange });

  // Synchronise la sélection avec l'URL — au premier chargement (deep-link
  // depuis un lien de notification) ET si le paramètre change alors que la
  // page est déjà montée (clic sur un lien "/messagerie?conversation=…"
  // pendant qu'on est déjà sur la page).
  const urlConvParam = searchParams.get('conversation');
  useEffect(() => {
    const idNum = urlConvParam ? Number(urlConvParam) : null;
    if (idNum && Number.isFinite(idNum) && idNum !== m.selectedId) {
      m.selectConversation(idNum);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlConvParam]);

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
    // La page vit DANS le gabarit (barre latérale + barre supérieure), comme
    // toutes les autres : l'enveloppe <Layout> manquait depuis la création du
    // module (2.40.0) — la messagerie s'affichait donc seule, sans navigation.
    // La hauteur ci-dessous était déjà calculée pour ce cadre : 100vh moins la
    // barre supérieure (h-14 = 3.5rem) et les marges verticales du <main>
    // (2 × 1.5rem) = 6.5rem. Rien d'autre n'a besoin de bouger.
    <Layout>
    <div className="flex flex-col" style={{ height: 'calc(100vh - 6.5rem)', minHeight: '520px' }}>
      <div className="flex items-center gap-3 pb-4 flex-shrink-0">
        <div className="p-2.5 rounded-xl bg-teal-50">
          <MessageCircle className="w-6 h-6 text-teal-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight">Messagerie</h1>
          <p className="text-slate-500 text-sm mt-0.5">Échangez avec vos collègues, vos chauffeurs et SolidataBot.</p>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex gap-4">
        <aside
          className={`${m.selectedId ? 'hidden md:flex' : 'flex'} w-full md:w-[22rem] flex-shrink-0 min-h-0 flex-col card-modern overflow-hidden`}
        >
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
        </aside>

        <section
          className={`${m.selectedId ? 'flex' : 'hidden md:flex'} flex-1 min-w-0 min-h-0 flex-col card-modern overflow-hidden`}
        >
          {m.selectedConversation ? (
            <>
              <header className="flex items-center gap-2 px-4 py-3 border-b border-slate-100 flex-shrink-0">
                <button
                  onClick={() => m.selectConversation(null)}
                  className="md:hidden p-1.5 -ml-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-50"
                  aria-label="Retour aux conversations"
                >
                  <ArrowLeft className="w-4.5 h-4.5" />
                </button>
                <h2 className="min-w-0 text-sm font-bold text-slate-900 truncate">
                  {titreConversation(m.selectedConversation, user?.id)}
                </h2>
              </header>

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

              {m.sendError && <p className="px-4 pt-2 text-xs text-red-600 flex-shrink-0">{m.sendError}</p>}

              {isSysteme ? (
                <div className="flex items-center gap-2 px-4 py-3 border-t border-slate-100 text-xs text-slate-400 bg-slate-50 flex-shrink-0">
                  <Info className="w-3.5 h-3.5 flex-shrink-0" /> Conversation en lecture seule — messages système de SOLIDATA.
                </div>
              ) : (
                <ComposerMessage onSend={m.envoyer} onMentionSelect={startWith} sending={m.sending} />
              )}
            </>
          ) : (
            <EmptyState
              icon={MessageCircle}
              title="Sélectionnez une conversation"
              description="Choisissez une conversation dans la liste, ou recherchez un collègue pour en démarrer une nouvelle."
            />
          )}
        </section>
      </div>
    </div>
    </Layout>
  );
}
