import { useEffect, useState, useRef, useCallback } from 'react';
import { authedFetch } from '../services/authedFetch';
import { addPendingMessageRead, getAckedMessageIds } from '../services/db';
import { syncAll } from '../services/sync';
import { vibrateError } from '../services/haptic';

/**
 * Bannière globale « consigne du responsable » (canal manager → chauffeur, item 62).
 *
 * Le responsable logistique envoie une consigne depuis la Collecte en direct
 * (web) : consigne du jour, CAV ajouté, danger signalé… Le mobile la récupère
 * par polling (toutes les 15 s + au retour au premier plan / à la reconnexion)
 * et l'affiche EN HAUT DE L'APP, quel que soit l'écran, jusqu'à ce que le
 * chauffeur tape « J'ai compris ».
 *
 * Offline-first : l'accusé de lecture est mis en file (pendingMessageReads) puis
 * rejoué par la synchro — aucun accusé perdu si le réseau est coupé au moment
 * du tap. Texte volontairement grand et simple (FALC), fort contraste ambre
 * pour la lecture en extérieur, boutons larges (gants).
 */
const POLL_MS = 15000;

export default function DriverMessageBanner() {
  const [messages, setMessages] = useState([]);
  const [ackedIds, setAckedIds] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const seenIdsRef = useRef(new Set());

  let vehicleId = null;
  try { vehicleId = localStorage.getItem('selected_vehicle_id'); } catch { /* ignore */ }

  const refresh = useCallback(async () => {
    let vId = null;
    try { vId = localStorage.getItem('selected_vehicle_id'); } catch { /* ignore */ }
    if (!vId) return;
    // Consignes déjà acquittées localement (accusé encore en file de synchro) :
    // on les masque même si le serveur les renvoie encore comme non lues.
    let acked = new Set();
    try { acked = new Set(await getAckedMessageIds()); } catch { /* ignore */ }
    setAckedIds(acked);
    try {
      const res = await authedFetch(`/api/tours/vehicle/${vId}/messages-public`);
      if (!res.ok) return;
      const data = await res.json();
      const list = Array.isArray(data.messages) ? data.messages : [];
      // Vibration si une consigne réellement nouvelle apparaît (jamais à chaque poll).
      const hasFresh = list.some((m) => !seenIdsRef.current.has(m.id) && !acked.has(m.id));
      list.forEach((m) => seenIdsRef.current.add(m.id));
      if (hasFresh) vibrateError();
      setMessages(list);
    } catch { /* réseau coupé : on conserve l'affichage courant */ }
  }, []);

  useEffect(() => {
    if (!vehicleId) return undefined;
    refresh();
    const iv = setInterval(refresh, POLL_MS);
    const onWake = () => { if (document.visibilityState === 'visible') refresh(); };
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', onWake);
    return () => {
      clearInterval(iv);
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', onWake);
    };
  }, [vehicleId, refresh]);

  // Consigne affichée : la plus ancienne non acquittée localement. En acquitter
  // une révèle la suivante.
  const visible = messages.filter((m) => !ackedIds.has(m.id));
  const current = visible[0] || null;
  const remaining = visible.length;

  const acknowledge = async () => {
    if (!current || busy) return;
    setBusy(true);
    try {
      await addPendingMessageRead({ messageId: current.id });
      setAckedIds((prev) => { const n = new Set(prev); n.add(current.id); return n; });
      // Tentative d'envoi immédiat ; sinon rejoué par la file offline.
      syncAll().catch(() => {});
    } catch { /* ignore : l'accusé reste en file, sera rejoué */ }
    finally { setBusy(false); }
  };

  if (!current) return null;

  const when = current.created_at
    ? new Date(current.created_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <div
      role="alertdialog"
      aria-live="assertive"
      aria-label="Consigne du responsable"
      className="fixed top-0 left-0 right-0"
      style={{ zIndex: 9990 }}
    >
      <div
        className="bg-amber-400 text-amber-950 shadow-lg border-b-4 border-amber-600"
        style={{ paddingTop: 'calc(var(--safe-top) + 10px)' }}
      >
        <div className="px-4 pb-4">
          <div className="flex items-center gap-2 mb-2">
            <span aria-hidden="true" className="text-2xl">📣</span>
            <span className="font-extrabold uppercase tracking-wide text-sm">
              Message du responsable
            </span>
            {remaining > 1 && (
              <span className="ml-auto text-xs font-bold bg-amber-600 text-white rounded-full px-2 py-0.5">
                1 / {remaining}
              </span>
            )}
          </div>
          <p className="font-bold leading-snug break-words" style={{ fontSize: '20px' }}>
            {current.message}
          </p>
          {when && <p className="text-xs mt-1 text-amber-900/80">Reçu à {when}</p>}
          <button
            type="button"
            onClick={acknowledge}
            disabled={busy}
            className="mt-3 w-full rounded-2xl bg-amber-950 text-white font-extrabold py-4 text-lg active:bg-amber-900 disabled:opacity-60"
            style={{ minHeight: 56 }}
          >
            {busy ? '…' : "J'ai compris"}
          </button>
        </div>
      </div>
    </div>
  );
}
