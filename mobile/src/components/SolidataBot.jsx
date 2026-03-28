import { useState, useEffect, useRef, useCallback } from 'react';
import api from '../services/api';

// ══════════════════════════════════════════
// SolidataBot — Widget chat IA (mobile fullscreen)
// ══════════════════════════════════════════

const MAX_MSG_LENGTH = 500;

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
  const panelRef = useRef(null);

  // ── Charger suggestions ──────────────────────────────────────────────
  useEffect(() => {
    if (isOpen && suggestions.length === 0) {
      api.get('/chat/suggestions')
        .then(res => setSuggestions(res.data.suggestions || []))
        .catch(() => {
          setSuggestions([
            { icon: '📦', text: 'Quel est le stock actuel ?' },
            { icon: '🚛', text: 'Stats collecte du jour' },
            { icon: '📅', text: 'Mon planning cette semaine' },
            { icon: '⏰', text: 'Mes heures cette semaine' },
            { icon: '📍', text: 'Liste des CAV actifs' },
          ]);
        });
    }
  }, [isOpen, suggestions.length]);

  // ── Scroll to bottom ─────────────────────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  // ── Focus input on open ──────────────────────────────────────────────
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 200);
    }
  }, [isOpen]);

  // ── Close on Escape ──────────────────────────────────────────────────
  useEffect(() => {
    const handleEsc = (e) => {
      if (e.key === 'Escape' && isOpen) setIsOpen(false);
    };
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
        if (transcript.trim()) {
          setTimeout(() => sendMessage(transcript.trim()), 300);
        }
      }
    };
    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => setIsListening(false);
    return recognition;
  }, []);

  const toggleMic = useCallback(() => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }
    if (!recognitionRef.current) {
      recognitionRef.current = initSpeech();
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.start();
        setIsListening(true);
      } catch (e) { /* ignore */ }
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
    const fr = voices.find(v => v.lang.startsWith('fr'));
    if (fr) u.voice = fr;
    window.speechSynthesis.speak(u);
  }, []);

  // ── Send message ─────────────────────────────────────────────────────
  const sendMessage = useCallback(async (text) => {
    const msg = (text || input).trim().slice(0, MAX_MSG_LENGTH);
    if (!msg || isLoading) return;

    setShowSuggestions(false);
    setInput('');

    const userMsg = { id: Date.now(), role: 'user', text: msg, time: new Date() };
    setMessages(prev => [...prev, userMsg]);
    setIsLoading(true);

    try {
      const res = await api.post('/chat', { message: msg, session_id: sessionId });
      const { reply, session_id: sid } = res.data;
      if (sid) setSessionId(sid);

      const botMsg = { id: Date.now() + 1, role: 'bot', text: reply, time: new Date() };
      setMessages(prev => [...prev, botMsg]);
      speak(reply);

      if (!isOpen) setHasNewMessage(true);
    } catch (err) {
      const errorText = err.response?.data?.error || 'Erreur de connexion. Réessaie ! 🔄';
      setMessages(prev => [...prev, {
        id: Date.now() + 1, role: 'bot', text: errorText, time: new Date(), isError: true,
      }]);
    } finally {
      setIsLoading(false);
    }
  }, [input, isLoading, sessionId, isOpen, speak]);

  // ── Clear conversation ───────────────────────────────────────────────
  const clearChat = () => {
    setMessages([]);
    setSessionId('');
    setShowSuggestions(true);
  };

  // ── Handle open ──────────────────────────────────────────────────────
  const handleOpen = () => {
    setIsOpen(true);
    setHasNewMessage(false);
  };

  // ── Format time ──────────────────────────────────────────────────────
  const formatTime = (d) => new Date(d).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <>
      {/* ── Floating button (bulle) ── */}
      {!isOpen && (
        <button
          onClick={handleOpen}
          className="fixed bottom-20 right-4 z-[9999] w-12 h-12 rounded-full bg-[#2D8C4E] text-white shadow-lg active:scale-95 transition-all duration-200 flex items-center justify-center"
          aria-label="Ouvrir l'assistant SolidataBot"
          title="SolidataBot — Assistant IA"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          {hasNewMessage && (
            <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full animate-pulse" />
          )}
        </button>
      )}

      {/* ── Chat panel (fullscreen on mobile) ── */}
      {isOpen && (
        <div
          ref={panelRef}
          className="fixed bottom-0 right-0 z-[9999] w-full h-full bg-white shadow-2xl flex flex-col overflow-hidden border border-slate-200/60"
          role="dialog"
          aria-label="SolidataBot — Assistant IA"
        >
          {/* ── Header ── */}
          <div className="bg-[#2D8C4E] text-white px-4 py-3 flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 bg-white/20 rounded-full flex items-center justify-center">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <div>
                <h2 className="font-bold text-sm leading-tight">SolidataBot</h2>
                <div className="flex items-center gap-1.5">
                  <span className="w-2 h-2 bg-green-300 rounded-full animate-pulse" />
                  <span className="text-xs text-green-100">En ligne</span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={clearChat}
                className="p-2 hover:bg-white/10 rounded-lg transition"
                aria-label="Effacer la conversation"
                title="Effacer"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
              <button
                onClick={() => setIsOpen(false)}
                className="p-2 hover:bg-white/10 rounded-lg transition"
                aria-label="Fermer"
                title="Fermer"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* ── Messages ── */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50/50" role="log" aria-live="polite">
            {/* Welcome + suggestions */}
            {messages.length === 0 && (
              <div className="text-center py-6">
                <div className="w-16 h-16 bg-[#2D8C4E]/10 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-[#2D8C4E]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                </div>
                <h3 className="font-bold text-slate-800 mb-1">Salut ! Je suis SolidataBot</h3>
                <p className="text-sm text-slate-500 mb-5">Ton assistant Solidarité Textiles. Pose-moi une question !</p>
              </div>
            )}

            {/* Suggestions */}
            {showSuggestions && suggestions.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider px-1">Suggestions</p>
                <div className="grid grid-cols-1 gap-2">
                  {suggestions.map((s, i) => (
                    <button
                      key={i}
                      onClick={() => sendMessage(s.text)}
                      className="flex items-center gap-3 px-4 py-3 bg-white rounded-xl border border-slate-200 active:border-[#2D8C4E] active:bg-[#2D8C4E]/5 transition-all text-left group"
                    >
                      <span className="text-lg flex-shrink-0">{s.icon}</span>
                      <span className="text-sm text-slate-700 font-medium">{s.text}</span>
                      <svg className="w-4 h-4 text-slate-300 ml-auto flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Message bubbles */}
            {messages.map(msg => (
              <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] ${msg.role === 'user' ? '' : 'flex gap-2'}`}>
                  {msg.role === 'bot' && (
                    <div className="w-7 h-7 bg-[#2D8C4E]/10 rounded-full flex items-center justify-center flex-shrink-0 mt-1">
                      <svg className="w-4 h-4 text-[#2D8C4E]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                      </svg>
                    </div>
                  )}
                  <div>
                    <div className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
                      msg.role === 'user'
                        ? 'bg-[#2D8C4E] text-white rounded-br-md'
                        : msg.isError
                          ? 'bg-red-50 text-red-700 border border-red-200 rounded-bl-md'
                          : 'bg-white text-slate-800 shadow-sm border border-slate-100 rounded-bl-md'
                    }`}>
                      {msg.text}
                    </div>
                    <p className={`text-[10px] mt-1 ${msg.role === 'user' ? 'text-right' : ''} text-slate-400`}>
                      {formatTime(msg.time)}
                    </p>
                  </div>
                </div>
              </div>
            ))}

            {/* Typing indicator */}
            {isLoading && (
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 bg-[#2D8C4E]/10 rounded-full flex items-center justify-center flex-shrink-0">
                  <svg className="w-4 h-4 text-[#2D8C4E]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                </div>
                <div className="bg-white px-4 py-3 rounded-2xl rounded-bl-md shadow-sm border border-slate-100">
                  <div className="flex gap-1.5">
                    <span className="w-2 h-2 bg-slate-300 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-2 h-2 bg-slate-300 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-2 h-2 bg-slate-300 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* ── Input area ── */}
          <div className="border-t border-slate-200 bg-white px-3 py-3 flex-shrink-0">
            {isListening && (
              <div className="flex items-center gap-2 mb-2 px-3 py-2 bg-amber-50 rounded-lg text-sm text-amber-700">
                <span className="w-2.5 h-2.5 bg-red-500 rounded-full animate-pulse" />
                Ecoute en cours...
                <button onClick={toggleMic} className="ml-auto text-amber-600 hover:text-amber-800 font-medium">Stop</button>
              </div>
            )}
            <div className="flex items-end gap-2">
              <div className="flex-1 flex items-end bg-slate-50 rounded-xl border border-slate-200 focus-within:border-[#2D8C4E] focus-within:ring-1 focus-within:ring-[#2D8C4E]/20 transition-all">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value.slice(0, MAX_MSG_LENGTH))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      sendMessage();
                    }
                  }}
                  placeholder="Écris ton message..."
                  rows={1}
                  className="flex-1 bg-transparent border-none outline-none resize-none px-4 py-2.5 text-sm text-slate-800 placeholder-slate-400 max-h-24"
                  aria-label="Message pour SolidataBot"
                  style={{ height: 'auto', minHeight: '40px' }}
                  onInput={(e) => {
                    e.target.style.height = 'auto';
                    e.target.style.height = Math.min(e.target.scrollHeight, 96) + 'px';
                  }}
                />
                {/* Mic button */}
                {(window.SpeechRecognition || window.webkitSpeechRecognition) && (
                  <button
                    onClick={toggleMic}
                    className={`p-2 mr-1 mb-0.5 rounded-lg transition ${isListening ? 'text-red-500 bg-red-50' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'}`}
                    aria-label={isListening ? 'Arrêter le micro' : 'Dicter un message'}
                    title="Micro"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                    </svg>
                  </button>
                )}
              </div>
              {/* Send button */}
              <button
                onClick={() => sendMessage()}
                disabled={!input.trim() || isLoading}
                className="w-10 h-10 bg-[#2D8C4E] text-white rounded-xl flex items-center justify-center hover:bg-[#246f3e] disabled:opacity-40 disabled:cursor-not-allowed transition-all flex-shrink-0"
                aria-label="Envoyer"
                title="Envoyer"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19V5m0 0l-7 7m7-7l7 7" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
