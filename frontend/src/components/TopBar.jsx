import { Menu, Sparkles } from 'lucide-react';
import UserDropdown from './UserDropdown';

/**
 * Barre supérieure. Depuis la fusion demandée par le client (28/08/2026), elle
 * ne porte plus qu'UN SEUL point d'entrée de communication — assistant IA,
 * messagerie et historique des notifications — au lieu du bouton « Assistant
 * IA », de la cloche et de la pastille flottante de la messagerie. Son badge
 * est la somme des messages et des notifications non lus ; le panneau et ses
 * trois onglets vivent dans components/messagerie/DockUnifie.jsx, monté par
 * Layout.jsx.
 */
export default function TopBar({
  onMobileMenu,
  badgeCommunication = 0,
  onOuvrirDock,
  dockOuvert = false,
  avecMessagerie = true,
}) {
  // Le libellé ne promet que ce que le panneau contient : quand le module
  // « messagerie » est masqué pour le rôle, l'onglet Messages disparaît — le
  // bouton ne doit pas continuer d'annoncer des messages.
  const intitule = avecMessagerie
    ? 'Assistant IA, messages et notifications'
    : 'Assistant IA et notifications';

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

      {/* Actions droite */}
      <div className="flex items-center gap-1.5 ml-auto">
        <button
          onClick={() => onOuvrirDock?.()}
          className="btn-chatbot relative"
          aria-label={intitule}
          aria-expanded={dockOuvert}
          title={intitule}
        >
          <span className="chatbot-avatar">
            <Sparkles className="w-3.5 h-3.5" />
          </span>
          <span className="hidden md:inline">{avecMessagerie ? 'Assistant & messages' : 'Assistant IA'}</span>
          {badgeCommunication > 0 ? (
            <span className="min-w-[18px] h-[18px] px-1 bg-red-500 text-white text-[10px] font-bold rounded-full grid place-items-center">
              {badgeCommunication > 99 ? '99+' : badgeCommunication}
            </span>
          ) : (
            <span className="chatbot-dot" aria-hidden="true" />
          )}
        </button>

        <UserDropdown />
      </div>
    </header>
  );
}
