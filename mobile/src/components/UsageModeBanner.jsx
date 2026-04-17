import { useUsageMode } from '../contexts/UsageModeContext';
import { USAGE_MODES } from '../services/usageMode';

const VARIANTS = {
  [USAGE_MODES.DRIVING]: {
    label: 'Conduite',
    shortLabel: 'Route',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M5 11l1.5-4.5A2 2 0 0 1 8.4 5h7.2a2 2 0 0 1 1.9 1.5L19 11" />
        <rect x="3" y="11" width="18" height="7" rx="2" />
        <circle cx="7.5" cy="17.5" r="1.2" />
        <circle cx="16.5" cy="17.5" r="1.2" />
      </svg>
    ),
    modifier: 'usage-banner--driving',
  },
  [USAGE_MODES.SHORT_STOP]: {
    label: 'Arrêt court',
    shortLabel: 'Arrêt',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="6" y="5" width="4" height="14" rx="1" />
        <rect x="14" y="5" width="4" height="14" rx="1" />
      </svg>
    ),
    modifier: 'usage-banner--short-stop',
  },
  [USAGE_MODES.OPERATIONAL_STOP]: {
    label: 'Collecte',
    shortLabel: 'Collecte',
    icon: (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M5 7h14l-1 12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 7z" />
        <path d="M9 7V5a3 3 0 0 1 6 0v2" />
      </svg>
    ),
    modifier: 'usage-banner--operational',
  },
};

/**
 * Pastille visuelle compacte exposant le mode d'usage courant.
 *
 * Props :
 *   - compact   : n'affiche que l'icône (utile dans un header contraint)
 *   - onDark    : variante lisible sur fond primaire (ex. header teal)
 *   - className : classes supplémentaires
 */
export default function UsageModeBanner({ compact = false, onDark = false, className = '' }) {
  const { mode } = useUsageMode();
  const variant = VARIANTS[mode] || VARIANTS[USAGE_MODES.OPERATIONAL_STOP];
  const classes = [
    'usage-banner',
    onDark ? 'usage-banner--on-dark' : variant.modifier,
    className,
  ].filter(Boolean).join(' ');

  return (
    <span className={classes} role="status" aria-live="polite" aria-label={`Mode ${variant.label}`}>
      <span className="usage-banner-icon">{variant.icon}</span>
      {!compact && <span>{variant.shortLabel}</span>}
    </span>
  );
}
