import { useState, useEffect, useRef, useCallback } from 'react';
import { Sparkles, X, Trash2, Send, Mic, ArrowRight } from 'lucide-react';
import api from '../services/api';
import { ASSISTANT_OPEN_EVENT } from './TopBar';

// ══════════════════════════════════════════
// SolidataBot — Assistant IA, panel slide-in droite
// Ouverture déclenchée par TopBar via événement custom + bouton flottant fallback
// ══════════════════════════════════════════

const MAX_MSG_LENGTH = 500;
const FALLBACK_SUGGESTIONS = [
  { icon: '📊', text: 'Générer le rapport mensuel' },
  { icon: '🚚', text: 'Où en est la tournée Rouen-Nord ?' },
  { icon: '💶', text: 'Pourquoi la marge a augmenté ?' },
  { icon: '👤', text: 'Candidats à relancer aujourd\'hui' },
];

export default function SolidataBot() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId, setSessionId] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(true);
  const [hasNewMessage, setHasNewMessage] = useState(false);
  const [isListening, setIsListening] = useState(false);

  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const recognitionRef = useRef(null);

  // ── Ouverture déclenchée par TopBar ──────────────────────────────────
  useEffect(() => {
    const handler = () => {
      setIsOpen(true);
      setHasNewMessage(false);
    };
    window.addEventListener(ASSISTANT_OPEN_EVENT, handler);
    return () => window.removeEventListener(ASSISTANT_OPEN_EVENT, handler);
  }, []);

  // ── Charger suggestions ──────────────────────────────────────────────
  useEffect(() => {
    if (isOpen && suggestions.length === 0) {
      api.get('/chat/suggestions')
        .then((res) => setSuggestions(res.data.suggestions || FALLBACK_SUGGESTIONS))
        .catch(() => setSuggestions(FALLBACK_SUGGESTIONS));
    }
  }, [isOpen, suggestions.length]);

  // ── Scroll bottom + focus input à l'ouverture ────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  useEffect(() => {
    if (isOpen) setTimeout(() => inputRef.current?.focus(), 250);
  }, [isOpen]);

  // ── Esc ferme ───────────────────────────────────────────────────────
  useEffect(() => {
    const handleEsc = (e) => { if (e.key === 'Escape' && isOpen) setIsOpen(false); };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [isOpen]);

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
      if (!isOpen) setHasNewMessage(true);
    } catch (err) {
      const errorText = err.response?.data?.error || 'Erreur de connexion. Réessaie ! 🔄';
      setMessages((prev) => [...prev, { id: Date.now() + 1, role: 'bot', text: errorText, time: new Date(), isError: true }]);
    } finally {
      setIsLoading(false);
    }
  }, [input, isLoading, sessionId, isOpen, speak]);

  const clearChat = () => { setMessages([]); setSessionId(''); setShowSuggestions(true); };
  const formatTime = (d) => new Date(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

  return (
    <>
      {/* Overlay */}
      <div className={`assistant-overlay ${isOpen ? 'open' : ''}`} onClick={() => setIsOpen(false)} aria-hidden="true" />

      {/* Bouton flottant fallback (mobile/tablette quand topbar pas visible) */}
      {!isOpen && (
        <button
          onClick={() => { setIsOpen(true); setHasNewMessage(false); }}
          className="fixed bottom-5 right-5 z-30 w-14 h-14 rounded-full text-white shadow-elevated transition-all hover:scale-105 lg:hidden grid place-items-center"
          style={{ background: 'linear-gradient(135deg, var(--color-primary-light), var(--color-primary-dark))' }}
          aria-label="Ouvrir l'assistant SolidataBot"
        >
          <Sparkles className="w-6 h-6" />
          {hasNewMessage && <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full animate-pulse" />}
        </button>
      )}

      {/* Panel slide-in droite */}
      <aside
        className={`assistant-panel ${isOpen ? 'open' : ''}`}
        role="dialog"
        aria-label="Assistant Solidata"
        aria-hidden={!isOpen}
      >
        {/* Header */}
        <header className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 flex-shrink-0">
          <div className="chatbot-avatar w-9 h-9">
            <Sparkles className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-bold text-slate-900 leading-tight">Assistant Solidata</h2>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
              <span className="text-[11px] text-emerald-700 font-medium">En ligne · répond en ~3s</span>
            </div>
          </div>
          <button
            onClick={clearChat}
            className="grid place-items-center w-9 h-9 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-50 transition"
            title="Effacer la conversation"
            aria-label="Effacer"
          >
            <Trash2 className="w-4 h-4" />
          </button>
          <button
            onClick={() => setIsOpen(false)}
            className="grid place-items-center w-9 h-9 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-50 transition"
            title="Fermer (Esc)"
            aria-label="Fermer"
          >
            <X className="w-5 h-5" />
          </button>
        </header>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-slate-50/40" role="log" aria-live="polite">
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
                <div className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
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
            <div className="flex-1 flex items-end bg-slate-50 rounded-xl border border-slate-200 focus-within:border-primary focus-within:bg-white focus-within:ring-2 focus-within:ring-primary/15 transition-all">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value.slice(0, MAX_MSG_LENGTH))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
                }}
                placeholder="Écris ta question…"
                rows={1}
                className="flex-1 bg-transparent border-none outline-none resize-none px-4 py-2.5 text-sm text-slate-800 placeholder-slate-400 max-h-24"
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
      </aside>
    </>
  );
}
