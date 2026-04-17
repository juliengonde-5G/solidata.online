import { useEffect, useRef, useState } from 'react';
import OfflineActionBadge from './OfflineActionBadge';
import PrimaryActionBar from './PrimaryActionBar';

/**
 * Écran de confirmation d'étape après une action métier importante.
 *
 * Affiche :
 *   - check vert
 *   - titre court ("Collecte enregistrée", "Incident signalé", …)
 *   - résumé (CAV, niveau, anomalie, type d'incident, etc.)
 *   - statut local (envoyé / en attente / à renvoyer) via OfflineActionBadge
 *   - compte à rebours visuel avant retour automatique
 *   - bouton de correction pendant une fenêtre courte
 *   - action principale explicite (suivante)
 *
 * Pensé comme un composant plein écran réutilisable (pas une route). La page
 * appelante le rend tant que l'utilisateur est dans la fenêtre de
 * confirmation. Retour auto via `onAutoReturn` au bout de `autoReturnMs`.
 */
export default function StepConfirmScreen({
  title = 'Action enregistrée',
  status = 'sent', // 'sent' | 'pending' | 'retry'
  cavName,
  summaryLines = [], // [{ label, value }]
  autoReturnMs = 8000,
  primaryLabel = 'Continuer',
  onPrimary,
  secondaryLabel = 'Corriger',
  onCorrect,
  onAutoReturn,
}) {
  const [remainingMs, setRemainingMs] = useState(autoReturnMs);
  const startRef = useRef(Date.now());

  useEffect(() => {
    if (!autoReturnMs) return undefined;
    const id = setInterval(() => {
      const elapsed = Date.now() - startRef.current;
      const left = Math.max(0, autoReturnMs - elapsed);
      setRemainingMs(left);
      if (left <= 0) {
        clearInterval(id);
        if (onAutoReturn) onAutoReturn();
      }
    }, 200);
    return () => clearInterval(id);
  }, [autoReturnMs, onAutoReturn]);

  const seconds = Math.ceil(remainingMs / 1000);
  const progress = autoReturnMs ? ((autoReturnMs - remainingMs) / autoReturnMs) * 100 : 0;

  return (
    <div className="min-h-screen flex flex-col bg-[var(--color-surface-2)]">
      <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
        <div className="w-20 h-20 rounded-full bg-emerald-500 flex items-center justify-center mb-4 shadow-lg">
          <svg className="w-12 h-12 text-white" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24" aria-hidden="true">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
        {cavName && (
          <p className="text-gray-600 mt-1 font-semibold">{cavName}</p>
        )}

        <div className="mt-3">
          <OfflineActionBadge status={status} />
        </div>

        {summaryLines.length > 0 && (
          <div className="w-full max-w-sm mt-6 card-mobile divide-y divide-gray-100">
            {summaryLines.map((line, i) => (
              <div key={i} className="px-4 py-3 flex items-center justify-between text-sm">
                <span className="text-gray-500">{line.label}</span>
                <span className="font-semibold text-gray-900 text-right">{line.value}</span>
              </div>
            ))}
          </div>
        )}

        {autoReturnMs > 0 && onAutoReturn && (
          <div className="w-full max-w-sm mt-6">
            <p className="text-xs text-gray-500 mb-1.5">
              Retour automatique dans {seconds}s
            </p>
            <div className="h-1.5 rounded-full bg-gray-200 overflow-hidden">
              <div
                className="h-full bg-[var(--color-primary)] transition-all duration-200 ease-linear"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}
      </div>

      <PrimaryActionBar
        primaryLabel={primaryLabel}
        onPrimary={onPrimary || onAutoReturn}
        secondaryLabel={onCorrect ? secondaryLabel : null}
        onSecondary={onCorrect || null}
      />
    </div>
  );
}
