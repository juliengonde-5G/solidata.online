/**
 * SolidataBot — Chat Frontend
 * Mobile-first, Speech-to-Text (Web Speech API), TTS, accessibilité ARIA
 */

(function () {
    'use strict';

    // ── Config ──────────────────────────────────────────────────────────
    const API_URL = '/chat';
    const TOKEN_KEY = 'solidatabot_token';
    const SESSION_KEY = 'solidatabot_session';
    const THEME_KEY = 'solidatabot_theme';
    const MAX_MSG_LENGTH = 500;

    // ── DOM refs ────────────────────────────────────────────────────────
    const $messages = document.getElementById('chat-messages');
    const $input = document.getElementById('chat-input');
    const $btnSend = document.getElementById('btn-send');
    const $btnMic = document.getElementById('btn-mic');
    const $btnMicStop = document.getElementById('btn-mic-stop');
    const $micStatus = document.getElementById('mic-status');
    const $typing = document.getElementById('typing-indicator');
    const $btnTheme = document.getElementById('btn-theme');
    const $btnClear = document.getElementById('btn-clear');
    const $ttsControls = document.getElementById('tts-controls');
    const $btnTtsStop = document.getElementById('btn-tts-stop');

    // ── State ───────────────────────────────────────────────────────────
    let sessionId = localStorage.getItem(SESSION_KEY) || '';
    let isSending = false;
    let recognition = null;
    let isRecording = false;
    let synth = window.speechSynthesis;

    // ── Auth Token ──────────────────────────────────────────────────────
    function getToken() {
        // Check URL param first (for embedding in ERP iframe)
        const params = new URLSearchParams(window.location.search);
        const urlToken = params.get('token');
        if (urlToken) {
            localStorage.setItem(TOKEN_KEY, urlToken);
            return urlToken;
        }
        return localStorage.getItem(TOKEN_KEY) || '';
    }

    // ── Theme ───────────────────────────────────────────────────────────
    function initTheme() {
        const saved = localStorage.getItem(THEME_KEY);
        if (saved) {
            document.documentElement.setAttribute('data-theme', saved);
            $btnTheme.textContent = saved === 'dark' ? '☀️' : '🌙';
        } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
            document.documentElement.setAttribute('data-theme', 'dark');
            $btnTheme.textContent = '☀️';
        }
    }

    function toggleTheme() {
        const current = document.documentElement.getAttribute('data-theme');
        const next = current === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem(THEME_KEY, next);
        $btnTheme.textContent = next === 'dark' ? '☀️' : '🌙';
    }

    // ── Messages ────────────────────────────────────────────────────────
    function addMessage(text, sender, isError) {
        const wrapper = document.createElement('div');
        wrapper.className = `message ${sender}-message`;
        wrapper.setAttribute('role', 'article');

        const avatar = document.createElement('div');
        avatar.className = 'message-avatar';
        avatar.setAttribute('aria-hidden', 'true');
        avatar.textContent = sender === 'bot' ? '🤖' : '👤';

        const bubble = document.createElement('div');
        bubble.className = 'message-bubble' + (isError ? ' error-bubble' : '');
        bubble.innerHTML = formatMessage(text);

        const time = document.createElement('div');
        time.className = 'message-time';
        time.textContent = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

        bubble.appendChild(time);
        wrapper.appendChild(avatar);
        wrapper.appendChild(bubble);

        $messages.appendChild(wrapper);
        scrollToBottom();

        // TTS pour les réponses bot
        if (sender === 'bot' && !isError) {
            speakText(text);
        }
    }

    function formatMessage(text) {
        // Simple markdown-like formatting
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/\n/g, '<br>');
    }

    function scrollToBottom() {
        requestAnimationFrame(() => {
            $messages.scrollTop = $messages.scrollHeight;
        });
    }

    function showTyping(show) {
        $typing.hidden = !show;
        $typing.setAttribute('aria-hidden', show ? 'false' : 'true');
        if (show) scrollToBottom();
    }

    // ── API call ────────────────────────────────────────────────────────
    async function sendMessage(text) {
        if (isSending || !text.trim()) return;
        isSending = true;

        const sanitized = text.trim().substring(0, MAX_MSG_LENGTH);
        addMessage(sanitized, 'user');
        $input.value = '';
        $input.style.height = 'auto';
        updateSendBtn();
        showTyping(true);

        const token = getToken();
        if (!token) {
            showTyping(false);
            addMessage('Tu dois te connecter pour utiliser SolidataBot. 🔐', 'bot', true);
            isSending = false;
            return;
        }

        try {
            const resp = await fetch(API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify({
                    message: sanitized,
                    session_id: sessionId,
                }),
            });

            showTyping(false);

            if (resp.status === 429) {
                addMessage('Trop de messages ! Attends un peu. ⏳', 'bot', true);
            } else if (resp.status === 401) {
                addMessage('Session expirée. Reconnecte-toi. 🔐', 'bot', true);
                localStorage.removeItem(TOKEN_KEY);
            } else if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                addMessage(err.error || 'Erreur serveur. Réessaie ! 🔄', 'bot', true);
            } else {
                const data = await resp.json();
                sessionId = data.session_id || sessionId;
                localStorage.setItem(SESSION_KEY, sessionId);
                addMessage(data.reply, 'bot');
            }
        } catch (e) {
            showTyping(false);
            addMessage('Pas de connexion réseau. Vérifie ton WiFi ! 📡', 'bot', true);
        }

        isSending = false;
    }

    // ── Input handling ──────────────────────────────────────────────────
    function updateSendBtn() {
        $btnSend.disabled = !$input.value.trim();
    }

    function autoResize() {
        $input.style.height = 'auto';
        $input.style.height = Math.min($input.scrollHeight, 120) + 'px';
    }

    $input.addEventListener('input', () => {
        updateSendBtn();
        autoResize();
    });

    $input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if ($input.value.trim()) sendMessage($input.value);
        }
    });

    $btnSend.addEventListener('click', () => {
        if ($input.value.trim()) sendMessage($input.value);
    });

    // ── Quick actions ───────────────────────────────────────────────────
    $messages.addEventListener('click', (e) => {
        const btn = e.target.closest('.quick-btn');
        if (btn) {
            const msg = btn.getAttribute('data-msg');
            if (msg) sendMessage(msg);
        }
    });

    // ── Speech-to-Text (Web Speech API) ─────────────────────────────────
    function initSpeechRecognition() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            $btnMic.hidden = true;
            return;
        }

        recognition = new SpeechRecognition();
        recognition.lang = 'fr-FR';
        recognition.continuous = false;
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;

        recognition.onresult = (event) => {
            let transcript = '';
            for (let i = event.resultIndex; i < event.results.length; i++) {
                transcript += event.results[i][0].transcript;
            }
            $input.value = transcript;
            updateSendBtn();
            autoResize();

            // Si résultat final, envoyer automatiquement
            if (event.results[event.results.length - 1].isFinal) {
                stopRecording();
                if (transcript.trim()) {
                    setTimeout(() => sendMessage(transcript), 300);
                }
            }
        };

        recognition.onerror = (event) => {
            console.warn('Speech recognition error:', event.error);
            stopRecording();
            if (event.error === 'not-allowed') {
                addMessage('Autorise le micro dans les paramètres de ton navigateur. 🎤', 'bot', true);
            }
        };

        recognition.onend = () => {
            stopRecording();
        };
    }

    function startRecording() {
        if (!recognition) return;
        try {
            recognition.start();
            isRecording = true;
            $btnMic.classList.add('recording');
            $micStatus.hidden = false;
            $input.placeholder = 'Parle...';
        } catch (e) {
            console.warn('Could not start recognition:', e);
        }
    }

    function stopRecording() {
        if (!recognition) return;
        try { recognition.stop(); } catch (e) { /* ignore */ }
        isRecording = false;
        $btnMic.classList.remove('recording');
        $micStatus.hidden = true;
        $input.placeholder = 'Écris ton message...';
    }

    $btnMic.addEventListener('click', () => {
        if (isRecording) {
            stopRecording();
        } else {
            startRecording();
        }
    });

    $btnMicStop.addEventListener('click', () => {
        stopRecording();
    });

    // ── Text-to-Speech ──────────────────────────────────────────────────
    function speakText(text) {
        if (!synth || !('speechSynthesis' in window)) return;

        // Clean text for TTS (remove emojis, markdown)
        const clean = text
            .replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '')
            .replace(/\*\*/g, '')
            .replace(/\n/g, '. ')
            .trim();

        if (!clean) return;

        synth.cancel(); // Stop any current speech
        const utterance = new SpeechSynthesisUtterance(clean);
        utterance.lang = 'fr-FR';
        utterance.rate = 0.95;
        utterance.pitch = 1;

        // Try to pick a French voice
        const voices = synth.getVoices();
        const frVoice = voices.find(v => v.lang.startsWith('fr'));
        if (frVoice) utterance.voice = frVoice;

        utterance.onstart = () => {
            $ttsControls.hidden = false;
        };
        utterance.onend = () => {
            $ttsControls.hidden = true;
        };
        utterance.onerror = () => {
            $ttsControls.hidden = true;
        };

        synth.speak(utterance);
    }

    $btnTtsStop.addEventListener('click', () => {
        synth.cancel();
        $ttsControls.hidden = true;
    });

    // ── Clear conversation ──────────────────────────────────────────────
    $btnClear.addEventListener('click', () => {
        if (!confirm('Effacer toute la conversation ?')) return;
        // Keep only the welcome message
        const welcome = $messages.querySelector('.bot-message');
        $messages.innerHTML = '';
        if (welcome) $messages.appendChild(welcome);
        sessionId = '';
        localStorage.removeItem(SESSION_KEY);
    });

    // ── Theme toggle ────────────────────────────────────────────────────
    $btnTheme.addEventListener('click', toggleTheme);

    // ── Init ────────────────────────────────────────────────────────────
    initTheme();
    initSpeechRecognition();
    scrollToBottom();

    // Load voices (async on some browsers)
    if (synth) {
        synth.onvoiceschanged = () => synth.getVoices();
    }

    // Focus input on load (desktop)
    if (window.innerWidth >= 640) {
        $input.focus();
    }

})();
