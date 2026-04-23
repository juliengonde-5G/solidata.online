import { useEffect, useState, useCallback } from 'react';
import { Menu, Search, HelpCircle, Sparkles } from 'lucide-react';
import UserDropdown from './UserDropdown';
import NotificationBell from './NotificationBell';

// Émis par TopBar et écouté par SolidataBot pour ouvrir le panneau Assistant IA.
export const ASSISTANT_OPEN_EVENT = 'solidata:assistant-open';

export default function TopBar({ alerts, onMobileMenu }) {
  const [search, setSearch] = useState('');

  const openAssistant = useCallback(() => {
    window.dispatchEvent(new CustomEvent(ASSISTANT_OPEN_EVENT));
  }, []);

  // Raccourci ⌘K / Ctrl+K → focus search
  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        const el = document.getElementById('topbar-search-input');
        el?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <header className="h-14 bg-white border-b border-slate-200 flex items-center gap-3 px-3 sm:px-4 flex-shrink-0 z-20 shadow-topbar">
      {/* Mobile hamburger */}
      <button
        onClick={onMobileMenu}
        className="lg:hidden grid place-items-center w-9 h-9 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-50 transition"
        aria-label="Ouvrir le menu"
      >
        <Menu className="w-5 h-5" />
      </button>

      {/* Search ⌘K */}
      <div className="topbar-search">
        <Search className="w-4 h-4 text-slate-400" />
        <input
          id="topbar-search-input"
          type="search"
          placeholder="Rechercher candidat, tournée, stock…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Rechercher dans Solidata"
        />
        <kbd className="hidden sm:inline-flex">⌘K</kbd>
      </div>

      {/* Actions droite */}
      <div className="flex items-center gap-1.5 ml-auto">
        <button
          onClick={openAssistant}
          className="btn-chatbot"
          aria-label="Assistant IA"
          title="Assistant IA"
        >
          <span className="chatbot-avatar">
            <Sparkles className="w-3.5 h-3.5" />
          </span>
          <span className="hidden md:inline">Assistant IA</span>
          <span className="chatbot-dot" aria-hidden="true" />
        </button>

        <NotificationBell alerts={alerts} />

        <button
          className="hidden sm:grid place-items-center w-9 h-9 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-50 transition"
          title="Aide"
          aria-label="Aide"
          onClick={() => window.open('https://solidata.online/docs', '_blank', 'noopener')}
        >
          <HelpCircle className="w-5 h-5" />
        </button>

        <UserDropdown />
      </div>
    </header>
  );
}
