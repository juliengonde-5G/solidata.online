/**
 * PrimaryActionBar — barre basse ancrée avec une seule action principale claire.
 *
 * Usage dans MobileShell : passer en `footer`. Le shell gère alors le flux
 * (flex-shrink-0) et la zone de contenu scrollable au-dessus.
 * Usage sur écran sans shell (ex. TourMap) : placer en bas d'un flex column, ou
 * activer `fixed` pour un positionnement viewport.
 *
 * États :
 *   - normal           : primaire cliquable
 *   - disabled         : primaire grisé
 *   - loading          : spinner + libellé modifié
 *   - pendingOffline   : bandeau ambre "envoi différé"
 *   - error            : bandeau rouge
 */
export default function PrimaryActionBar({
  primaryLabel,
  primaryIcon = null,
  onPrimary,
  disabled = false,
  loading = false,
  pendingOffline = false,
  error = null,
  secondaryLabel,
  secondaryIcon = null,
  onSecondary,
  loadingLabel = 'Enregistrement…',
  fixed = false,
  className = '',
}) {
  const isDisabled = disabled || loading;
  const label = loading ? loadingLabel : primaryLabel;

  const classes = [
    'primary-action-bar',
    fixed ? 'primary-action-bar--fixed' : '',
    className,
  ].filter(Boolean).join(' ');

  return (
    <div className={classes}>
      {error && (
        <div className="primary-action-hint primary-action-hint--error" role="alert">{error}</div>
      )}
      {pendingOffline && !error && (
        <div className="primary-action-hint primary-action-hint--pending" role="status">
          Sera envoyé à la reconnexion
        </div>
      )}
      <div className="primary-action-row">
        {secondaryLabel && onSecondary && (
          <button
            type="button"
            onClick={onSecondary}
            disabled={loading}
            aria-label={secondaryLabel}
            className="btn-secondary-mobile flex items-center justify-center gap-1.5 px-4 flex-shrink-0"
          >
            {secondaryIcon && <span aria-hidden="true">{secondaryIcon}</span>}
            <span>{secondaryLabel}</span>
          </button>
        )}
        <button
          type="button"
          onClick={onPrimary}
          disabled={isDisabled}
          aria-label={primaryLabel}
          className="btn-primary-mobile py-4 text-base flex items-center justify-center gap-2"
        >
          {loading && (
            <span
              className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"
              aria-hidden="true"
            />
          )}
          {!loading && primaryIcon && <span aria-hidden="true">{primaryIcon}</span>}
          <span>{label}</span>
        </button>
      </div>
    </div>
  );
}
