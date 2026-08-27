import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Loader2 } from 'lucide-react';
import { fetchContacts } from './messagerieApi';
import ContactRow from './ContactRow';

const MAX_LEN = 4000;

/**
 * Zone de saisie : Entrée envoie, Maj+Entrée revient à la ligne, et "@"
 * déclenche une autocomplétion de contacts navigable au clavier. Sélectionner
 * un contact OUVRE/CRÉE la conversation directe avec lui — c'est la
 * sémantique "@utilisateur = message privé" du contrat (§3), pas une
 * insertion de texte : dans ce module toute conversation est 1-à-1
 * (directe/bot/systeme), il n'y a pas de salon où @mentionner quelqu'un au
 * milieu d'un fil.
 */
export default function ComposerMessage({ onSend, onMentionSelect, sending = false, placeholder = 'Écrivez un message…' }) {
  const [text, setText] = useState('');
  const [mentionQuery, setMentionQuery] = useState(null);
  const [mentionResults, setMentionResults] = useState([]);
  const [mentionLoading, setMentionLoading] = useState(false);
  const [mentionActive, setMentionActive] = useState(0);
  const textareaRef = useRef(null);
  const debounceRef = useRef(null);

  useEffect(() => {
    if (mentionQuery === null) {
      setMentionResults([]);
      return undefined;
    }
    setMentionLoading(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const contacts = await fetchContacts(mentionQuery);
        setMentionResults(contacts);
        setMentionActive(0);
      } catch (err) {
        console.error('[Messagerie] autocomplete @', err);
        setMentionResults([]);
      } finally {
        setMentionLoading(false);
      }
    }, 200);
    return () => clearTimeout(debounceRef.current);
  }, [mentionQuery]);

  function detecterMention(value, curseur) {
    const avant = value.slice(0, curseur);
    const m = avant.match(/(?:^|\s)@([^\s@]*)$/);
    return m ? m[1] : null;
  }

  function autoResize(el) {
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }

  function handleChange(e) {
    const value = e.target.value.slice(0, MAX_LEN);
    setText(value);
    setMentionQuery(detecterMention(value, e.target.selectionStart));
    autoResize(e.target);
  }

  const fermerMention = useCallback(() => {
    setMentionQuery(null);
    setMentionResults([]);
  }, []);

  async function selectionnerMention(contact) {
    fermerMention();
    setText('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.focus();
    }
    try {
      await onMentionSelect?.(contact);
    } catch {
      // L'échec (contact indisponible, réseau…) est déjà porté par le bandeau
      // d'erreur du composant parent — rien de plus à faire ici.
    }
  }

  async function envoyer() {
    const trimmed = text.trim();
    if (!trimmed || sending) return;
    try {
      await onSend(trimmed);
      setText('');
      if (textareaRef.current) textareaRef.current.style.height = 'auto';
    } catch {
      // Le texte est volontairement conservé pour ne rien perdre ; l'erreur
      // détaillée s'affiche via le bandeau du parent (sendError du hook).
    }
  }

  function handleKeyDown(e) {
    if (mentionQuery !== null && mentionResults.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionActive((i) => (i + 1) % mentionResults.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionActive((i) => (i - 1 + mentionResults.length) % mentionResults.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        selectionnerMention(mentionResults[mentionActive]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        fermerMention();
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      envoyer();
    }
    // Maj+Entrée : comportement par défaut du textarea (retour à la ligne).
  }

  const mentionOuverte = mentionQuery !== null && (mentionLoading || mentionResults.length > 0);

  return (
    <div className="relative border-t border-slate-200 bg-white px-3 py-3 flex-shrink-0">
      {mentionOuverte && (
        <div className="absolute left-3 right-3 bottom-full mb-2 bg-white border border-slate-200 rounded-xl shadow-elevated max-h-56 overflow-y-auto z-10">
          <p className="px-3 pt-2 pb-1 text-[10.5px] font-bold text-slate-400 uppercase tracking-wider">
            Écrire à… (ouvre une conversation privée)
          </p>
          {mentionLoading && mentionResults.length === 0 && (
            <p className="px-3 py-2 text-xs text-slate-400">Recherche…</p>
          )}
          {mentionResults.map((c, i) => (
            <ContactRow
              key={`${c.type}-${c.user_id ?? c.vehicle_id}`}
              contact={c}
              active={i === mentionActive}
              onClick={() => selectionnerMention(c)}
              onMouseEnter={() => setMentionActive(i)}
            />
          ))}
        </div>
      )}

      <div className="flex items-end gap-2">
        <div className="flex-1 flex items-end bg-slate-50 rounded-xl border border-slate-200 focus-within:border-primary focus-within:bg-white focus-within:ring-2 focus-within:ring-primary/15 transition-all">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            rows={1}
            maxLength={MAX_LEN}
            disabled={sending}
            className="flex-1 bg-transparent border-none outline-none resize-none px-4 py-2.5 text-sm text-slate-800 placeholder-slate-400 max-h-[140px] disabled:opacity-60"
            aria-label="Message"
            style={{ height: 'auto', minHeight: '40px' }}
          />
        </div>
        <button
          type="button"
          onClick={envoyer}
          disabled={!text.trim() || sending}
          className="w-10 h-10 text-white rounded-xl flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed transition-all flex-shrink-0"
          style={{ background: 'linear-gradient(135deg, var(--color-primary), var(--color-primary-dark))' }}
          aria-label="Envoyer"
          title="Envoyer (Entrée)"
        >
          {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </button>
      </div>
      <p className="text-[10px] text-slate-400 mt-1.5 px-1">
        Entrée pour envoyer · Maj+Entrée pour un retour à la ligne · @ pour écrire à quelqu'un
        {text.length > 3000 && (
          <span className="ml-1 text-slate-500">
            · {text.length}/{MAX_LEN}
          </span>
        )}
      </p>
    </div>
  );
}
