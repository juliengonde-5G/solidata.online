/**
 * Badge compact indiquant le statut local d'une action métier.
 *
 * Statuts :
 *   - 'sent'    : envoyé au serveur
 *   - 'pending' : conservé localement, sera envoyé automatiquement
 *   - 'retry'   : échec à renvoyer (erreur réseau persistante)
 *
 * Utilisé dans FillLevel, Incident, WeighIn, TourSummary pour rassurer
 * l'utilisateur sur la bonne prise en compte d'une action.
 */
const VARIANTS = {
  sent: {
    label: 'Envoyé',
    modifier: 'action-badge--sent',
    icon: (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    ),
  },
  pending: {
    label: 'En attente',
    modifier: 'action-badge--pending',
    icon: (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
    ),
  },
  retry: {
    label: 'À renvoyer',
    modifier: 'action-badge--retry',
    icon: (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 12a9 9 0 1 0 3-6.7" />
        <polyline points="3 4 3 10 9 10" />
      </svg>
    ),
  },
};

export default function OfflineActionBadge({ status = 'pending', label, className = '' }) {
  const v = VARIANTS[status] || VARIANTS.pending;
  return (
    <span className={`action-badge ${v.modifier} ${className}`.trim()} aria-label={label || v.label}>
      <span aria-hidden="true">{v.icon}</span>
      <span>{label || v.label}</span>
    </span>
  );
}
