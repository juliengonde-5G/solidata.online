import { useState, useCallback, useRef, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { MessageCircle, X } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import useNonLusBadge from './useNonLusBadge';
import useMessagerieSocket from './useMessagerieSocket';
import MessagerieDockPanel from './MessagerieDockPanel';

const TOAST_DUREE_MS = 6000;

/**
 * Pastille flottante globale de la messagerie (montée dans Layout.jsx, à
 * côté — mais visuellement distincte — du widget SolidataBot) : badge de
 * non-lus temps réel, panneau compact, et toast discret à la réception d'un
 * message hors de la page /messagerie (contrat §3).
 *
 * Position bas-GAUCHE, volontairement à l'opposé du bouton flottant de
 * secours de SolidataBot (bas-droite, mobile uniquement) pour qu'ils ne se
 * chevauchent jamais, à n'importe quelle taille d'écran.
 */
export default function MessagerieDock() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const toastTimerRef = useRef(null);

  const surPageMessagerie = location.pathname.startsWith('/messagerie');
  const { total } = useNonLusBadge();

  const onNouveauMessage = useCallback(
    (payload) => {
      if (!payload?.message) return;
      const { message, conversation_id: convId } = payload;
      const estDeMoi = message.auteur_type === 'utilisateur' && message.auteur_user_id === user?.id;
      // Ni ma propre écriture, ni redondant avec une UI de messagerie déjà
      // ouverte (page dédiée ou panneau du dock).
      if (estDeMoi || surPageMessagerie || open) return;

      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      const auteur =
        message.auteur_nom ||
        (message.auteur_type === 'bot' ? 'SolidataBot' : message.auteur_type === 'systeme' ? 'SOLIDATA' : 'Nouveau message');
      setToast({ conversationId: convId, texte: message.texte, auteur });
      toastTimerRef.current = setTimeout(() => setToast(null), TOAST_DUREE_MS);
    },
    [user?.id, surPageMessagerie, open]
  );

  useMessagerieSocket({ onNouveauMessage });

  useEffect(
    () => () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    },
    []
  );

  function ouvrirToast() {
    if (toast) navigate(`/messagerie?conversation=${toast.conversationId}`);
    setToast(null);
    setOpen(false);
  }

  // La page dédiée couvre déjà toute l'expérience : pas de bouton/panneau
  // redondant par-dessus (le badge/toast restent actifs partout ailleurs).
  if (surPageMessagerie) return null;

  return (
    <>
      {toast && (
        <button
          onClick={ouvrirToast}
          className="fixed bottom-24 left-5 z-40 max-w-[320px] flex items-start gap-2.5 bg-white border border-slate-200 shadow-elevated rounded-xl px-4 py-3 text-left hover:border-primary transition-colors animate-fade-in"
        >
          <span className="chatbot-avatar w-8 h-8 flex-shrink-0">
            <MessageCircle className="w-4 h-4" />
          </span>
          <span className="min-w-0">
            <span className="block text-xs font-bold text-slate-800 truncate">{toast.auteur}</span>
            <span className="block text-xs text-slate-500 truncate">{toast.texte}</span>
          </span>
        </button>
      )}

      <button
        onClick={() => setOpen((o) => !o)}
        className="fixed bottom-5 left-5 z-40 w-14 h-14 rounded-full text-white shadow-elevated transition-all hover:scale-105 grid place-items-center"
        style={{ background: 'linear-gradient(135deg, var(--color-primary-light), var(--color-primary-dark))' }}
        aria-label={open ? 'Fermer la messagerie' : 'Ouvrir la messagerie'}
        title="Messagerie"
      >
        {open ? <X className="w-6 h-6" /> : <MessageCircle className="w-6 h-6" />}
        {!open && total > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center ring-2 ring-white">
            {total > 99 ? '99+' : total}
          </span>
        )}
      </button>

      {open && <MessagerieDockPanel onClose={() => setOpen(false)} />}
    </>
  );
}
