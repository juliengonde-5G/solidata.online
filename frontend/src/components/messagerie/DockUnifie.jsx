import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { X, MessageCircle } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import useMessagerieSocket from './useMessagerieSocket';
import MessagerieDockPanel from './MessagerieDockPanel';
import PanneauNotifications from './PanneauNotifications';
import SolidataBot from '../SolidataBot';

// ══════════════════════════════════════════
// DOCK UNIFIÉ — un seul point d'entrée pour l'assistant IA, la messagerie
// interne et l'historique des notifications (demande client du 28/08/2026 :
// « fusionner solidata ia et messagerie et historique des notifs dans le même
// bouton »).
//
// L'application offrait TROIS portes pour la même intention — communiquer :
// le bouton « Assistant IA » de la barre supérieure, la cloche juste à côté,
// et la pastille flottante de la messagerie. Elles sont remplacées par un
// bouton unique (barre supérieure, cf. TopBar.jsx) portant UN badge — la
// somme des messages non lus et des notifications non lues — et ouvrant ce
// panneau à trois onglets.
//
// PLACEMENT : le panneau reprend la classe `.assistant-panel` (index.css),
// ancrée en HAUT À DROITE sur toute la hauteur. La barre latérale de
// navigation étant à gauche (256 px), elle n'est JAMAIS recouverte — c'est
// l'exigence explicite du client, déjà réglée pour la messagerie le 28/08.
//
// ÉTAT CONSERVÉ : les trois onglets restent montés tant que le panneau vit
// (masqués par `invisible`, jamais par `display:none` — un élément sans boîte
// de rendu a une hauteur de défilement nulle, et le fil de discussion
// reviendrait en haut à chaque changement d'onglet). On ne perd donc ni la
// conversation en cours avec le bot, ni la conversation ouverte.
// ══════════════════════════════════════════

export const ONGLET_ASSISTANT = 'assistant';
export const ONGLET_MESSAGES = 'messages';
export const ONGLET_NOTIFICATIONS = 'notifications';

const TOAST_DUREE_MS = 6000;

/**
 * Onglet ouvert par défaut : ce qui attend l'utilisateur d'abord, l'assistant
 * ensuite (lui n'attend rien, il répond).
 */
export function ongletParDefaut({ messagesNonLus = 0, notificationsNonLues = 0, messagerieActive = true } = {}) {
  if (messagerieActive && messagesNonLus > 0) return ONGLET_MESSAGES;
  if (notificationsNonLues > 0) return ONGLET_NOTIFICATIONS;
  return ONGLET_ASSISTANT;
}

export default function DockUnifie({
  ouvert = false,
  onglet = ONGLET_ASSISTANT,
  onChangerOnglet,
  onFermer,
  onOuvrir,
  alertes = [],
  messagesNonLus = 0,
  notifications,
  messagerieActive = true,
  conversationDemandee = null,
  onConversationOuverte,
}) {
  const { user } = useAuth();
  const location = useLocation();
  const [toast, setToast] = useState(null);
  const [reponseAssistant, setReponseAssistant] = useState(false);
  // La messagerie n'est montée qu'à la première consultation : inutile
  // d'ouvrir une connexion temps réel et de charger les conversations pour
  // quelqu'un qui ne fait que consulter ses notifications.
  const [messagerieMontee, setMessagerieMontee] = useState(false);
  const toastTimerRef = useRef(null);

  const surPageMessagerie = location.pathname.startsWith('/messagerie');

  useEffect(() => {
    if (ouvert && onglet === ONGLET_MESSAGES && messagerieActive) setMessagerieMontee(true);
  }, [ouvert, onglet, messagerieActive]);

  // Réponse du bot arrivée alors qu'un autre onglet était affiché : on la
  // signale sur l'onglet plutôt que de la laisser passer inaperçue.
  useEffect(() => {
    if (ouvert && onglet === ONGLET_ASSISTANT) setReponseAssistant(false);
  }, [ouvert, onglet]);

  const onNouvelleReponse = useCallback(() => {
    setReponseAssistant((deja) => deja || onglet !== ONGLET_ASSISTANT || !ouvert);
  }, [onglet, ouvert]);

  // ── Esc ferme ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!ouvert) return undefined;
    const handleEsc = (e) => { if (e.key === 'Escape') onFermer?.(); };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [ouvert, onFermer]);

  // ── Toast à la réception d'un message (hors page /messagerie) ───────
  const onNouveauMessage = useCallback(
    (payload) => {
      if (!payload?.message) return;
      const { message, conversation_id: convId } = payload;
      const estDeMoi = message.auteur_type === 'utilisateur' && message.auteur_user_id === user?.id;
      // Ni ma propre écriture, ni redondant avec une messagerie déjà sous les
      // yeux (page dédiée ou onglet Messages ouvert).
      if (estDeMoi || surPageMessagerie || (ouvert && onglet === ONGLET_MESSAGES)) return;

      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      const auteur =
        message.auteur_nom ||
        (message.auteur_type === 'bot' ? 'SolidataBot' : message.auteur_type === 'systeme' ? 'SOLIDATA' : 'Nouveau message');
      setToast({ conversationId: convId, texte: message.texte, auteur });
      toastTimerRef.current = setTimeout(() => setToast(null), TOAST_DUREE_MS);
    },
    [user?.id, surPageMessagerie, ouvert, onglet]
  );

  useMessagerieSocket({ actif: messagerieActive, onNouveauMessage });

  useEffect(
    () => () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    },
    []
  );

  function ouvrirToast() {
    if (toast) onOuvrir?.(ONGLET_MESSAGES, toast.conversationId);
    setToast(null);
  }

  const notifsNonLues = notifications?.nonLues || 0;

  // Libellés SANS pictogramme : mesuré à 1440×900, « Notifications » + son
  // badge dépassait la largeur d'un tiers de panneau (380 px moins le bouton
  // de fermeture) dès qu'on ajoutait une icône — le libellé s'affichait
  // « Notificat… ». Trois mots pleins valent mieux que trois icônes et un mot
  // coupé.
  const listeOnglets = [
    { id: ONGLET_ASSISTANT, label: 'Assistant IA', badge: 0, point: reponseAssistant },
    ...(messagerieActive
      ? [{ id: ONGLET_MESSAGES, label: 'Messages', badge: messagesNonLus, point: false }]
      : []),
    { id: ONGLET_NOTIFICATIONS, label: 'Notifications', badge: notifsNonLues, point: false },
  ];

  const classePanneau = (id) =>
    `absolute inset-0 flex flex-col ${onglet === id ? '' : 'invisible pointer-events-none'}`;

  return (
    <>
      {/* Toast : jamais sur la page /messagerie, qui montre déjà tout. */}
      {toast && !surPageMessagerie && (
        <button
          onClick={ouvrirToast}
          className="fixed bottom-5 right-5 z-40 max-w-[320px] flex items-start gap-2.5 bg-white border border-slate-200 shadow-elevated rounded-xl px-4 py-3 text-left hover:border-primary transition-colors animate-fade-in"
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

      <div className={`assistant-overlay ${ouvert ? 'open' : ''}`} onClick={onFermer} aria-hidden="true" />

      <aside
        className={`assistant-panel ${ouvert ? 'open' : ''}`}
        role="dialog"
        aria-label="Assistant IA, messages et notifications"
        aria-hidden={!ouvert}
      >
        {/* Barre d'onglets — porte aussi la fermeture, pour ne pas empiler
            deux bandeaux dans un panneau de 380 px. */}
        <div className="flex items-stretch border-b border-slate-200 flex-shrink-0" role="tablist" aria-label="Sections">
          {listeOnglets.map((t) => {
            const actif = onglet === t.id;
            return (
              <button
                key={t.id}
                role="tab"
                aria-selected={actif}
                onClick={() => onChangerOnglet?.(t.id)}
                className={`relative flex-1 min-w-0 flex items-center justify-center gap-1.5 px-1 py-3 text-[11.5px] font-semibold transition-colors border-b-2 ${
                  actif
                    ? 'border-primary text-primary-dark bg-primary-surface/50'
                    : 'border-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-50'
                }`}
              >
                <span className="truncate">{t.label}</span>
                {t.badge > 0 && (
                  <span className="flex-shrink-0 min-w-[17px] h-[17px] px-1 bg-red-500 text-white text-[9.5px] font-bold rounded-full grid place-items-center">
                    {t.badge > 99 ? '99+' : t.badge}
                  </span>
                )}
                {t.point && !t.badge && (
                  <span className="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-red-500" aria-label="Nouvelle réponse" />
                )}
              </button>
            );
          })}
          <button
            onClick={onFermer}
            className="flex-shrink-0 grid place-items-center w-9 border-l border-slate-100 text-slate-400 hover:text-slate-700 hover:bg-slate-50 transition"
            title="Fermer (Esc)"
            aria-label="Fermer"
          >
            <X className="w-4.5 h-4.5" />
          </button>
        </div>

        <div className="relative flex-1 min-h-0 min-w-0">
          <div className={classePanneau(ONGLET_ASSISTANT)} role="tabpanel" aria-label="Assistant IA">
            <SolidataBot actif={ouvert && onglet === ONGLET_ASSISTANT} onReponse={onNouvelleReponse} />
          </div>

          {messagerieActive && messagerieMontee && (
            <div className={classePanneau(ONGLET_MESSAGES)} role="tabpanel" aria-label="Messages">
              <MessagerieDockPanel
                conversationDemandee={conversationDemandee}
                onConversationOuverte={onConversationOuverte}
              />
            </div>
          )}

          <div className={classePanneau(ONGLET_NOTIFICATIONS)} role="tabpanel" aria-label="Notifications">
            <PanneauNotifications
              alertes={alertes}
              estNonLue={notifications?.estNonLue}
              onMarquerLu={notifications?.marquerToutLu}
              actif={ouvert && onglet === ONGLET_NOTIFICATIONS}
            />
          </div>
        </div>
      </aside>
    </>
  );
}
