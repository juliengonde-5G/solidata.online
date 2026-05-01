import { AlertTriangle, RefreshCw } from 'lucide-react';

/**
 * ErrorState — affichage standardisé pour les erreurs de chargement /
 * échec d'API. Doit être utilisé partout où l'on faisait
 * `catch (err) { console.error(err); }` silencieusement.
 *
 * Props :
 *  - title : titre court (string)
 *  - message : description (string ou ReactNode)
 *  - onRetry : callback bouton "Réessayer" (optionnel)
 *  - variant : 'inline' (par défaut, dans une page) | 'card' (encadré rouge clair)
 */
export default function ErrorState({
  title = 'Une erreur est survenue',
  message = "Le chargement a échoué. Vérifiez votre connexion et réessayez.",
  onRetry,
  variant = 'inline',
  className = '',
}) {
  const wrapperClass = variant === 'card'
    ? 'rounded-xl border border-red-200 bg-red-50 p-4'
    : 'flex flex-col items-center justify-center text-center py-10 px-4';

  return (
    <div role="alert" aria-live="polite" className={`${wrapperClass} ${className}`}>
      <AlertTriangle
        className={variant === 'card' ? 'h-5 w-5 text-red-600 mb-2' : 'h-10 w-10 text-red-500 mb-3'}
        aria-hidden="true"
        strokeWidth={1.8}
      />
      <h3 className={variant === 'card' ? 'text-sm font-semibold text-red-700' : 'text-base font-semibold text-slate-800'}>
        {title}
      </h3>
      {message && (
        <p className={variant === 'card' ? 'text-sm text-red-700 mt-1' : 'text-sm text-slate-600 mt-1 max-w-md'}>
          {typeof message === 'string' ? message : message}
        </p>
      )}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-white border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" strokeWidth={1.8} />
          Réessayer
        </button>
      )}
    </div>
  );
}
