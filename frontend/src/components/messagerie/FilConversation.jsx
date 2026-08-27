import { useRef, useState, useLayoutEffect } from 'react';
import { Link } from 'react-router-dom';
import { Bell, Bot, ExternalLink, ArrowDown } from 'lucide-react';
import LoadingSpinner from '../LoadingSpinner';
import ErrorState from '../ErrorState';
import { formatHeure, libelleJour } from './format';

const SEUIL_PRES_DU_BAS_PX = 120;
const SEUIL_CHARGER_PLUS_PX = 80;

/**
 * Fil de discussion : groupement par jour, "mes messages" à droite,
 * auto-scroll intelligent (ne tire l'utilisateur vers le bas que s'il y est
 * déjà, sinon affiche un bouton "Nouveaux messages"), et chargement des
 * messages précédents en préservant la position visuelle de lecture.
 */
export default function FilConversation({
  conversationId,
  messages,
  loading,
  error,
  aPlus,
  loadingOlder,
  onLoadOlder,
  olderLoadedTick,
  currentUser,
  botThinking = false,
  className = '',
}) {
  const containerRef = useRef(null);
  const nearBottomRef = useRef(true);
  const [showJump, setShowJump] = useState(false);

  const prevConvIdRef = useRef(conversationId);
  const prevTickRef = useRef(olderLoadedTick);
  const prevScrollHeightRef = useRef(0);
  const prevLastIdRef = useRef(null);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const convChanged = prevConvIdRef.current !== conversationId;
    const olderLoaded = !convChanged && prevTickRef.current !== olderLoadedTick;
    const lastId = messages.length ? messages[messages.length - 1].id : null;
    const appended = !convChanged && !olderLoaded && lastId !== null && lastId !== prevLastIdRef.current;

    if (convChanged) {
      el.scrollTop = el.scrollHeight;
      setShowJump(false);
      nearBottomRef.current = true;
    } else if (olderLoaded) {
      // On vient de préfixer des messages plus anciens : on compense le
      // décalage de hauteur pour que le lecteur reste sur ce qu'il lisait.
      const diff = el.scrollHeight - prevScrollHeightRef.current;
      el.scrollTop = el.scrollTop + diff;
    } else if (appended) {
      if (nearBottomRef.current || botThinking) {
        el.scrollTop = el.scrollHeight;
        setShowJump(false);
      } else {
        setShowJump(true);
      }
    }

    prevConvIdRef.current = conversationId;
    prevTickRef.current = olderLoadedTick;
    prevScrollHeightRef.current = el.scrollHeight;
    prevLastIdRef.current = lastId;
  }, [messages, conversationId, olderLoadedTick, botThinking]);

  function handleScroll() {
    const el = containerRef.current;
    if (!el) return;
    nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < SEUIL_PRES_DU_BAS_PX;
    if (nearBottomRef.current) setShowJump(false);
    if (el.scrollTop < SEUIL_CHARGER_PLUS_PX && aPlus && !loadingOlder) onLoadOlder?.();
  }

  function allerEnBas() {
    const el = containerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    setShowJump(false);
  }

  const estDeMoi = (m) => m.auteur_type === 'utilisateur' && m.auteur_user_id === currentUser?.id;

  const groupes = [];
  let jourCourant = null;
  let groupeCourant = null;
  for (const m of messages) {
    const jour = libelleJour(m.created_at);
    if (jour !== jourCourant) {
      jourCourant = jour;
      groupeCourant = { jour, items: [] };
      groupes.push(groupeCourant);
    }
    groupeCourant.items.push(m);
  }

  return (
    <div className={`relative flex flex-col min-h-0 ${className}`}>
      <div
        ref={containerRef}
        onScroll={handleScroll}
        role="log"
        aria-live="polite"
        className="flex-1 min-h-0 overflow-y-auto px-4 py-3 bg-slate-50/40"
      >
        {error && (
          <ErrorState variant="card" title="Messages indisponibles" message={error} className="my-2" />
        )}

        {!error && loading && messages.length === 0 && <LoadingSpinner size="sm" />}

        {!loading && !error && messages.length === 0 && (
          <div className="py-10 text-center text-sm text-slate-400">
            Aucun message pour l'instant. Écrivez le premier !
          </div>
        )}

        {aPlus && (
          <div className="flex justify-center py-1">
            <button
              type="button"
              onClick={onLoadOlder}
              disabled={loadingOlder}
              className="text-xs font-medium text-teal-700 hover:text-teal-800 disabled:opacity-50"
            >
              {loadingOlder ? 'Chargement…' : 'Charger les messages précédents'}
            </button>
          </div>
        )}

        {groupes.map((g) => (
          <div key={g.jour}>
            <div className="flex items-center justify-center my-3">
              <span className="text-[11px] font-semibold text-slate-400 bg-slate-100 rounded-full px-3 py-1">
                {g.jour}
              </span>
            </div>
            {g.items.map((m) => (
              <MessageRow key={m.id} message={m} mine={estDeMoi(m)} />
            ))}
          </div>
        ))}

        {botThinking && (
          <div className="flex justify-start mb-2">
            <div className="bg-white px-4 py-3 rounded-2xl rounded-bl-md shadow-card border border-slate-100 inline-flex gap-1.5">
              <span className="w-2 h-2 bg-slate-300 rounded-full animate-bounce" />
              <span className="w-2 h-2 bg-slate-300 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <span className="w-2 h-2 bg-slate-300 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        )}
      </div>

      {showJump && (
        <button
          type="button"
          onClick={allerEnBas}
          className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5 bg-slate-800 text-white text-xs font-medium px-3 py-1.5 rounded-full shadow-elevated hover:bg-slate-900 transition-all"
        >
          <ArrowDown className="w-3.5 h-3.5" /> Nouveaux messages
        </button>
      )}
    </div>
  );
}

function MessageRow({ message, mine }) {
  const heure = formatHeure(message.created_at);

  if (message.type === 'notification') {
    return (
      <div className="flex justify-center my-2">
        <div className="max-w-[92%] w-full sm:w-auto flex items-start gap-2 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-3.5 py-2.5 text-sm">
          <Bell className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="leading-snug">{message.texte}</p>
            <div className="flex items-center justify-between gap-2 mt-1">
              <span className="text-[10.5px] text-amber-600">{heure}</span>
              {message.lien && message.lien.startsWith('/') && (
                <Link
                  to={message.lien}
                  className="text-[11px] font-semibold text-amber-800 hover:text-amber-900 underline inline-flex items-center gap-1"
                >
                  Ouvrir <ExternalLink className="w-3 h-3" />
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const estBot = message.auteur_type === 'bot';

  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'} mb-2`}>
      <div className="max-w-[80%]">
        {estBot && (
          <div className="flex items-center gap-1.5 mb-1 ml-1">
            <span className="chatbot-avatar w-5 h-5">
              <Bot className="w-3 h-3" />
            </span>
            <span className="text-[10.5px] font-semibold text-slate-400">SolidataBot</span>
          </div>
        )}
        <div
          className={`px-3.5 py-2 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap break-words ${
            mine
              ? 'text-white rounded-br-md'
              : 'bg-white text-slate-800 shadow-card border border-slate-100 rounded-bl-md'
          }`}
          style={mine ? { background: 'linear-gradient(135deg, var(--color-primary), var(--color-primary-dark))' } : undefined}
        >
          {message.texte}
        </div>
        <p className={`text-[10px] mt-1 text-slate-400 ${mine ? 'text-right mr-1' : 'ml-1'}`}>{heure}</p>
      </div>
    </div>
  );
}
