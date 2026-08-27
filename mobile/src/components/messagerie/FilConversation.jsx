import { useEffect, useRef } from 'react';
import OfflineActionBadge from '../OfflineActionBadge';
import { estDeMoi } from '../../services/messagerie';

/** Heure courte FR (« 14:32 »). Ne lève jamais — une date illisible retombe sur `null`. */
function formatHeure(iso) {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return null;
  }
}

/**
 * Fil de messages — fond très contrasté pour la lecture en plein soleil
 * (bulles à fort contraste, jamais de gris clair sur blanc). Les messages
 * ENCORE en file locale (offline) sont fusionnés par l'appelant et portent
 * `pending: true` : ils s'affichent immédiatement (jamais d'attente
 * silencieuse) avec le badge « En attente » réutilisé du reste de l'app.
 *
 * `type === 'notification'` (consignes SOLIDATA/gestionnaire) : rendu
 * distinct en bandeau plutôt qu'en bulle de discussion.
 */
export default function FilConversation({ messages, vehicleId, conversationType }) {
  const finRef = useRef(null);

  useEffect(() => {
    finRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length]);

  if (!messages || messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center py-10">
        <p className="text-gray-400 text-sm text-center px-6">
          {conversationType === 'systeme'
            ? 'Aucune notification pour le moment.'
            : 'Aucun message pour le moment. Écrivez le premier.'}
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2.5" role="log" aria-live="polite">
      {messages.map((m) => {
        const cle = m.id != null ? `m-${m.id}` : `p-${m.clientId}`;
        if (m.type === 'notification') {
          return (
            <div
              key={cle}
              className="bg-amber-50 border-2 border-amber-200 rounded-2xl px-4 py-3"
              role="status"
            >
              <div className="flex items-center gap-2 mb-1">
                <span aria-hidden="true" className="text-base">📣</span>
                <span className="text-[11px] uppercase tracking-wide font-extrabold text-amber-700">
                  {m.auteur_nom || 'SOLIDATA'}
                </span>
              </div>
              <p className="font-bold text-amber-950 text-base leading-snug break-words">
                {m.texte}
              </p>
              {formatHeure(m.created_at) && (
                <p className="text-[11px] text-amber-700/80 mt-1">{formatHeure(m.created_at)}</p>
              )}
            </div>
          );
        }

        const mine = m.pending || estDeMoi(m, vehicleId);
        return (
          <div key={cle} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
            <div className="max-w-[85%]">
              {!mine && (
                <p className="text-[11px] font-bold text-gray-500 mb-0.5 px-1">
                  {m.auteur_nom || (m.auteur_type === 'bot' ? 'SolidataBot' : 'Interlocuteur')}
                </p>
              )}
              <div
                className={`px-4 py-2.5 rounded-2xl text-base leading-relaxed break-words ${
                  mine
                    ? 'bg-[var(--color-primary)] text-white rounded-br-md'
                    : 'bg-white text-gray-900 border-2 border-gray-200 rounded-bl-md shadow-sm'
                }`}
              >
                {m.texte}
              </div>
              <div className={`flex items-center gap-2 mt-1 px-1 ${mine ? 'justify-end' : 'justify-start'}`}>
                {formatHeure(m.created_at) && (
                  <span className="text-[11px] text-gray-400">{formatHeure(m.created_at)}</span>
                )}
                {m.pending && <OfflineActionBadge status="pending" label="En attente d'envoi" />}
              </div>
            </div>
          </div>
        );
      })}
      <div ref={finRef} />
    </div>
  );
}
