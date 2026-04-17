import { useEffect } from 'react';
import { useUsageMode } from '../contexts/UsageModeContext';

/**
 * Enveloppe commune pour les écrans mobile : header + zone de contenu avec padding safe.
 * Option : barre de progression des étapes (flux tournée).
 *
 * usageHint : suggestion de mode d'usage pour l'écran (ex. 'operational_stop').
 * Le provider l'utilise comme indice si le GPS ne tranche pas.
 */
export function MobileShell({
  title,
  subtitle,
  onBack,
  rightAction,
  belowHeader,
  footer,
  children,
  className = '',
  usageHint,
}) {
  const { setScreenHint } = useUsageMode();

  useEffect(() => {
    if (!usageHint) return undefined;
    setScreenHint(usageHint);
    return () => setScreenHint(null);
  }, [usageHint, setScreenHint]);

  return (
    <div className={`min-h-screen flex flex-col bg-[var(--color-surface-2)] ${className}`}>
      <header className="screen-header flex-shrink-0 flex flex-row items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="touch-target flex items-center justify-center rounded-xl text-white/90 hover:bg-white/10 active:bg-white/20 transition-colors -ml-1"
              aria-label="Retour"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}
          <div className="min-w-0">
            <h1 className="font-bold text-lg truncate">{title}</h1>
            {subtitle && <p className="text-white/80 text-sm truncate">{subtitle}</p>}
          </div>
        </div>
        {rightAction && <div className="flex-shrink-0">{rightAction}</div>}
      </header>
      {belowHeader && (
        <div className="flex-shrink-0 px-4 pt-3 pb-1 bg-[var(--color-surface-2)]">
          {belowHeader}
        </div>
      )}
      <div className="flex-1 overflow-y-auto px-4 pb-6 pt-4">
        {children}
      </div>
      {footer && <div className="flex-shrink-0">{footer}</div>}
    </div>
  );
}

/**
 * Indicateur d’étapes pour le flux tournée (Véhicule → Checklist → Carte → … → Résumé).
 */
const TOUR_STEPS = [
  { path: '/vehicle-select', label: 'Véhicule' },
  { path: '/checklist', label: 'Check' },
  { path: '/tour-map', label: 'Carte' },
  { path: '/identify-cav', label: 'Identifier' },
  { path: '/fill-level', label: 'Remplir' },
  { path: '/return-centre', label: 'Retour' },
  { path: '/weigh-in', label: 'Pesée' },
  { path: '/tour-summary', label: 'Résumé' },
];

export function TourStepBar({ currentPath }) {
  const currentIndex = TOUR_STEPS.findIndex(s => s.path === currentPath);
  const progress = currentIndex >= 0 ? ((currentIndex + 1) / TOUR_STEPS.length) * 100 : 0;
  const nextStep = currentIndex >= 0 && currentIndex < TOUR_STEPS.length - 1 ? TOUR_STEPS[currentIndex + 1] : null;

  return (
    <div className="px-4 py-3 bg-white/10 rounded-xl">
      <div className="flex justify-between items-center text-xs text-white/90 mb-1.5">
        <span>{Math.min(currentIndex + 1, TOUR_STEPS.length)} / {TOUR_STEPS.length}</span>
        <span className="font-medium">{TOUR_STEPS[currentIndex]?.label || '—'}</span>
      </div>
      <div className="h-2 bg-white/20 rounded-full overflow-hidden">
        <div
          className="h-full bg-white rounded-full transition-all duration-400"
          style={{ width: `${progress}%` }}
        />
      </div>
      {nextStep && (
        <p className="text-white/80 text-xs mt-1.5">Suivant : {nextStep.label}</p>
      )}
    </div>
  );
}

export default MobileShell;
