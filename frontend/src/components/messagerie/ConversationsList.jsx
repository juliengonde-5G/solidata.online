import { useState, useEffect, useRef, useMemo } from 'react';
import { Search, Bot, Bell, Truck, MessageCircle, Sparkles } from 'lucide-react';
import LoadingSpinner from '../LoadingSpinner';
import EmptyState from '../EmptyState';
import ErrorState from '../ErrorState';
import ContactRow from './ContactRow';
import { fetchContacts } from './messagerieApi';
import { formatHeure, normaliser, titreConversation, autreParticipant, initiales } from './format';

/**
 * Colonne "Conversations" : recherche (qui double comme point d'entrée pour
 * démarrer une nouvelle conversation avec un collègue/chauffeur — GET
 * /contacts?q=), badges non-lus, tri par dernier message (fourni par le
 * backend, réappliqué après toute mise à jour locale par le hook appelant),
 * et accès rapide à SolidataBot.
 */
export default function ConversationsList({
  conversations,
  loading,
  error,
  onReload,
  selectedId,
  onSelect,
  currentUserId,
  onStartBot,
  onStartWith,
  starting,
  startError,
}) {
  const [query, setQuery] = useState('');
  const [contactResults, setContactResults] = useState([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [contactsError, setContactsError] = useState(null);
  const debounceRef = useRef(null);

  const q = query.trim();
  const normQ = normaliser(q);

  const filtered = useMemo(() => {
    if (!normQ) return conversations;
    return conversations.filter((c) => normaliser(titreConversation(c, currentUserId)).includes(normQ));
  }, [conversations, normQ, currentUserId]);

  useEffect(() => {
    if (!q) {
      setContactResults([]);
      setContactsError(null);
      return undefined;
    }
    setContactsLoading(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const contacts = await fetchContacts(q);
        setContactResults(contacts);
        setContactsError(null);
      } catch (err) {
        console.error('[Messagerie] recherche contacts', err);
        setContactsError('Recherche de contacts indisponible pour le moment.');
        setContactResults([]);
      } finally {
        setContactsLoading(false);
      }
    }, 250);
    return () => clearTimeout(debounceRef.current);
  }, [q]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-3.5 pt-3.5 pb-2.5 flex-shrink-0 border-b border-slate-100">
        <h2 className="text-sm font-bold text-slate-800 mb-2">Conversations</h2>
        <div className="flex items-center gap-2 bg-slate-50 rounded-lg border border-slate-200 px-2.5 py-1.5 focus-within:border-primary focus-within:bg-white transition-colors">
          <Search className="w-4 h-4 text-slate-400 flex-shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher ou écrire à…"
            className="flex-1 bg-transparent border-none outline-none text-sm text-slate-800 placeholder-slate-400 min-w-0"
            aria-label="Rechercher une conversation ou un contact"
          />
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {startError && (
          <div className="mx-3 mt-2 text-xs text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
            {startError}
          </div>
        )}

        {!q && !loading && !error && (
          <button
            type="button"
            onClick={onStartBot}
            disabled={starting}
            className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left hover:bg-slate-50 transition-colors disabled:opacity-60 border-b border-slate-50"
          >
            <span className="chatbot-avatar w-8 h-8 flex-shrink-0">
              <Sparkles className="w-4 h-4" />
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-semibold text-slate-800">SolidataBot</span>
              <span className="block text-[11px] text-slate-400">Assistant IA — poser une question</span>
            </span>
          </button>
        )}

        {loading && <LoadingSpinner size="sm" />}

        {!loading && error && (
          <ErrorState
            variant="card"
            className="m-3"
            title="Conversations indisponibles"
            message={error}
            onRetry={onReload}
          />
        )}

        {!loading && !error && filtered.length === 0 && !q && (
          <EmptyState
            icon={MessageCircle}
            title="Aucune conversation"
            description="Recherchez un collègue ou un chauffeur pour démarrer une discussion."
          />
        )}

        {!loading &&
          !error &&
          filtered.map((c) => (
            <ConversationRow
              key={c.id}
              conversation={c}
              active={c.id === selectedId}
              currentUserId={currentUserId}
              onClick={() => onSelect(c.id)}
            />
          ))}

        {q && (
          <div className="border-t border-slate-100 mt-1 pt-1">
            <p className="px-3.5 pt-2 pb-1 text-[10.5px] font-bold text-slate-400 uppercase tracking-wider">
              Personnes
            </p>
            {contactsLoading && <p className="px-3.5 py-2 text-xs text-slate-400">Recherche…</p>}
            {contactsError && <p className="px-3.5 py-2 text-xs text-red-600">{contactsError}</p>}
            {!contactsLoading && !contactsError && contactResults.length === 0 && (
              <p className="px-3.5 py-2 text-xs text-slate-400">Aucun contact trouvé.</p>
            )}
            {contactResults.map((c) => (
              <ContactRow
                key={`${c.type}-${c.user_id ?? c.vehicle_id}`}
                contact={c}
                onClick={() => onStartWith(c)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ConversationRow({ conversation, active, currentUserId, onClick }) {
  const titre = titreConversation(conversation, currentUserId);
  const autre = autreParticipant(conversation, currentUserId);
  const dernier = conversation.dernier_message;
  const nonLus = Number(conversation.non_lus) || 0;

  let Icon = null;
  let avatarClass = 'bg-teal-500';
  if (conversation.type === 'bot') {
    Icon = Bot;
    avatarClass = 'bg-teal-500';
  } else if (conversation.type === 'systeme') {
    Icon = Bell;
    avatarClass = 'bg-amber-500';
  } else if (autre?.type === 'vehicule') {
    Icon = Truck;
    avatarClass = 'bg-slate-400';
  }

  let apercu = 'Aucun message';
  if (dernier) {
    const prefixe = dernier.auteur_type === 'utilisateur' && dernier.auteur_user_id === currentUserId ? 'Vous : ' : '';
    apercu = `${prefixe}${dernier.texte}`;
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-start gap-2.5 px-3.5 py-2.5 text-left border-l-2 transition-colors ${
        active ? 'bg-primary-surface border-primary' : 'border-transparent hover:bg-slate-50'
      }`}
    >
      <span className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0 ${avatarClass}`}>
        {Icon ? <Icon className="w-4 h-4" /> : initiales(titre)}
      </span>
      <span className="flex-1 min-w-0">
        <span className="flex items-center justify-between gap-2">
          <span className={`text-sm truncate ${nonLus > 0 ? 'font-bold text-slate-900' : 'font-medium text-slate-700'}`}>
            {titre}
          </span>
          {dernier && <span className="text-[10px] text-slate-400 flex-shrink-0">{formatHeure(dernier.created_at)}</span>}
        </span>
        <span className="flex items-center justify-between gap-2 mt-0.5">
          <span className={`text-xs truncate ${nonLus > 0 ? 'text-slate-600 font-medium' : 'text-slate-400'}`}>
            {apercu}
          </span>
          {nonLus > 0 && (
            <span className="flex-shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-white text-[10px] font-bold flex items-center justify-center">
              {nonLus > 99 ? '99+' : nonLus}
            </span>
          )}
        </span>
      </span>
    </button>
  );
}
