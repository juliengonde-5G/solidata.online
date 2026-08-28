import { useState, useEffect, useRef, useCallback } from 'react';
import { Trash2, Send, Mic, ArrowRight } from 'lucide-react';
import api from '../services/api';

// ══════════════════════════════════════════
// SolidataBot — Assistant IA
//
// Depuis la fusion des trois points d'entrée (assistant, messagerie,
// notifications) en un bouton unique, ce composant n'est plus un widget
// autonome : il est le CONTENU de l'onglet « Assistant IA » du dock unifié
// (components/messagerie/DockUnifie.jsx), qui fournit le panneau, l'overlay,
// la fermeture (Esc) et le bouton d'ouverture.
//
// Tout le reste est inchangé : suggestions, envoi, dictée vocale, synthèse
// vocale de la réponse, indicateur « réfléchit… », effacement de la
// conversation, limite de longueur.
// ══════════════════════════════════════════

const MAX_MSG_LENGTH = 500;
const FALLBACK_SUGGESTIONS = [
  { icon: '📊', text: 'Générer le rapport mensuel' },
  { icon: '🚚', text: 'Où en est la tournée Rouen-Nord ?' },
  { icon: '💶', text: 'Pourquoi la marge a augmenté ?' },
  { icon: '👤', text: 'Candidats à relancer aujourd\'hui' },
];

/**
 * @param {{ actif?: boolean, onReponse?: () => void }} props
 *  - `actif` : l'onglet est visible (déclenche le focus et le chargement des
 *    suggestions — inutile tant que le panneau est fermé).
 *  - `onReponse` : appelé à chaque réponse du bot, pour que le dock puisse
 *    signaler une réponse arrivée pendant qu'un autre onglet était affiché.
 */
export default function SolidataBot({ actif = false, onReponse }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(true);
  const [isListening, setIsListening] = useState(false);

  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const recognitionRef = useRef(null);
  const onReponseRef = useRef(onReponse);
  onReponseRef.current = onReponse;

  // ── Charger suggestions (à la première ouverture de l'onglet) ────────
  useEffect(() => {
    if (actif && suggestions.length === 0) {
      api.get('/chat/suggestions')
        .then((res) => setSuggestions(res.data.suggestions || FALLBACK_SUGGESTIONS))
        .catch(() => setSuggestions(FALLBACK_SUGGESTIONS));
    }
  }, [actif, suggestions.length]);

  // ── Scroll bottom + focus input à l'ouverture ────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  useEffect(() => {
    if (actif) setTimeout(() => inputRef.current?.focus(), 250);
  }, [actif]);

  // ── Speech-to-Text ───────────────────────────────────────────────────
  const initSpeech = useCallback(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return null;
    const recognition = new SR();
    recognition.lang = 'fr-FR';
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.onresult = (e) => {
      let transcript = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        transcript += e.results[i][0].transcript;
      }
      setInput(transcript);
      if (e.results[e.results.length - 1].isFinal) {
        setIsListening(false);
        if (transcript.trim()) setTimeout(() => sendMessage(transcript.trim()), 300);
      }
    };
    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => setIsListening(false);
    return recognition;
  }, []);

  const toggleMic = useCallback(() => {
    if (isListening) { recognitionRef.current?.stop(); setIsListening(false); return; }
    if (!recognitionRef.current) recognitionRef.current = initSpeech();
    if (recognitionRef.current) {
      try { recognitionRef.current.start(); setIsListening(true); } catch { /* ignore */ }
    }
  }, [isListening, initSpeech]);

  // ── TTS ──────────────────────────────────────────────────────────────
  const speak = useCallback((text) => {
    if (!('speechSynthesis' in window)) return;
    const clean = text
      .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '')
      .replace(/\*\*/g, '').replace(/\n/g, '. ').trim();
    if (!clean) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(clean);
    u.lang = 'fr-FR';
    u.rate = 0.95;
    const voices = window.speechSynthesis.getVoices();
    const fr = voices.find((v) => v.lang.startsWith('fr'));
    if (fr) u.voice = fr;
    window.speechSynthesis.speak(u);
  }, []);

  // ── Send message ─────────────────────────────────────────────────────
  const sendMessage = useCallback(async (text) => {
    const msg = (text || input).trim().slice(0, MAX_MSG_LENGTH);
    if (!msg || isLoading) return;
    setShowSuggestions(false);
    setInput('');

    setMessages((prev) => [...prev, { id: Date.now(), role: 'user', text: msg, time: new Date() }]);
    setIsLoading(true);

    try {
      const res = await api.post('/chat', { message: msg, session_id: sessionId });
      const { reply, session_id: sid } = res.data;
      if (sid) setSessionId(sid);
      setMessages((prev) => [...prev, { id: Date.now() + 1, role: 'bot', text: reply, time: new Date() }]);
      speak(reply);
      onReponseRef.current?.();
    } catch (err) {
      const errorText = err.response?.data?.error || 'Erreur de connexion. Réessaie ! 🔄';
      setMessages((prev) => [...prev, { id: Date.now() + 1, role: 'bot', text: errorText, time: new Date(), isError: true }]);
      onReponseRef.current?.();
    } finally {
      setIsLoading(false);
    }
  }, [input, isLoading, sessionId, speak]);

  const clearChat = () => { setMessages([]); setSessionId(''); setShowSuggestions(true); };
  const formatTime = (d) => new Date(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="flex flex-col h-full min-h-0 min-w-0">
      {/* Bandeau d'état + effacement (l'identité et la fermeture sont portées
          par l'en-tête du dock) */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-100 flex-shrink-0">
        <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse flex-shrink-0" />
        <span className="text-[11px] text-emerald-700 font-medium flex-1 min-w-0 truncate">
          En ligne · répond en ~3s
        </span>
        <button
          onClick={clearChat}
          className="grid place-items-center w-8 h-8 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-50 transition flex-shrink-0"
          title="Effacer la conversation"
          aria-label="Effacer la conversation"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 min-w-0 overflow-y-auto px-4 py-4 space-y-3 bg-slate-50/40" role="log" aria-live="polite">
        {messages.length === 0 && (
          <div className="text-sm text-slate-700 leading-relaxed bg-white rounded-2xl p-4 border border-slate-100 shadow-card">
            Bonjour 👋 Je suis l'assistant Solidata. Je peux t'aider à générer un rapport, trouver un candidat, analyser une tournée, ou naviguer dans l'appli.
          </div>
        )}

        {showSuggestions && messages.length === 0 && suggestions.length > 0 && (
          <div className="space-y-2 pt-1">
            <p className="text-[10.5px] font-bold text-slate-400 uppercase tracking-wider px-1">Suggestions</p>
            {suggestions.map((s, i) => (
              <button
                key={i}
                onClick={() => sendMessage(s.text)}
                className="w-full flex items-center gap-3 px-3.5 py-2.5 bg-white rounded-xl border border-slate-200 hover:border-primary hover:bg-primary-surface transition-all text-left group"
              >
                <span className="text-base flex-shrink-0">{s.icon}</span>
                <span className="text-[13px] text-slate-700 group-hover:text-primary-dark font-medium flex-1">{s.text}</span>
                <ArrowRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-primary-dark flex-shrink-0" />
              </button>
            ))}
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className="max-w-[85%]">
              <div className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap break-words ${
                msg.role === 'user'
                  ? 'rounded-br-md text-white'
                  : msg.isError
                    ? 'bg-red-50 text-red-700 border border-red-200 rounded-bl-md'
                    : 'bg-white text-slate-800 shadow-card border border-slate-100 rounded-bl-md'
              }`}
              style={msg.role === 'user' ? { background: 'linear-gradient(135deg, var(--color-primary), var(--color-primary-dark))' } : undefined}>
                {msg.text}
              </div>
              <p className={`text-[10px] mt-1 text-slate-400 ${msg.role === 'user' ? 'text-right' : ''}`}>
                {formatTime(msg.time)}
              </p>
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex items-center gap-2">
            <div className="bg-white px-4 py-3 rounded-2xl rounded-bl-md shadow-card border border-slate-100">
              <div className="flex gap-1.5">
                <span className="w-2 h-2 bg-slate-300 rounded-full animate-bounce" />
                <span className="w-2 h-2 bg-slate-300 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 bg-slate-300 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Footer input */}
      <footer className="border-t border-slate-200 bg-white px-3 py-3 flex-shrink-0">
        {isListening && (
          <div className="flex items-center gap-2 mb-2 px-3 py-2 bg-amber-50 rounded-lg text-sm text-amber-700">
            <span className="w-2.5 h-2.5 bg-red-500 rounded-full animate-pulse" />
            Écoute en cours…
            <button onClick={toggleMic} className="ml-auto text-amber-600 hover:text-amber-800 font-medium">Stop</button>
          </div>
        )}
        <div className="flex items-end gap-2">
          <div className="flex-1 min-w-0 flex items-end bg-slate-50 rounded-xl border border-slate-200 focus-within:border-primary focus-within:bg-white focus-within:ring-2 focus-within:ring-primary/15 transition-all">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value.slice(0, MAX_MSG_LENGTH))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
              }}
              placeholder="Écris ta question…"
              rows={1}
              className="flex-1 min-w-0 bg-transparent border-none outline-none resize-none px-4 py-2.5 text-sm text-slate-800 placeholder-slate-400 max-h-24"
              aria-label="Message pour l'assistant"
              style={{ height: 'auto', minHeight: '40px' }}
              onInput={(e) => {
                e.target.style.height = 'auto';
                e.target.style.height = `${Math.min(e.target.scrollHeight, 96)}px`;
              }}
            />
            {(window.SpeechRecognition || window.webkitSpeechRecognition) && (
              <button
                onClick={toggleMic}
                className={`p-2 mr-1 mb-0.5 rounded-lg transition ${isListening ? 'text-red-500 bg-red-50' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'}`}
                aria-label={isListening ? 'Arrêter le micro' : 'Dicter un message'}
                title="Micro"
              >
                <Mic className="w-4.5 h-4.5" />
              </button>
            )}
          </div>
          <button
            onClick={() => sendMessage()}
            disabled={!input.trim() || isLoading}
            className="w-10 h-10 text-white rounded-xl flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed transition-all flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, var(--color-primary), var(--color-primary-dark))' }}
            aria-label="Envoyer"
            title="Envoyer"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
        <p className="text-[10.5px] text-slate-400 text-center mt-2">Propulsé par Claude · tes données restent privées</p>
      </footer>
    </div>
  );
}
