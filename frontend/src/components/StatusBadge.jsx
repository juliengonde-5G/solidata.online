const statusMappings = {
  // Candidats (recrutement)
  received: { label: 'Recu', color: 'bg-blue-100 text-blue-700', dot: 'bg-blue-500' },
  interview: { label: 'Entretien', color: 'bg-amber-100 text-amber-700', dot: 'bg-amber-500' },
  recruited: { label: 'Recrute', color: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500' },
  rejected: { label: 'Refuse', color: 'bg-red-100 text-red-700', dot: 'bg-red-500' },

  // Commandes exutoires
  draft: { label: 'Brouillon', color: 'bg-slate-100 text-slate-600', dot: 'bg-slate-400' },
  pending: { label: 'En attente', color: 'bg-amber-100 text-amber-700', dot: 'bg-amber-500' },
  confirmed: { label: 'Confirmee', color: 'bg-blue-100 text-blue-700', dot: 'bg-blue-500' },
  prepared: { label: 'Preparee', color: 'bg-indigo-100 text-indigo-700', dot: 'bg-indigo-500' },
  weighed: { label: 'Pesee', color: 'bg-purple-100 text-purple-700', dot: 'bg-purple-500' },
  validated: { label: 'Validee', color: 'bg-teal-100 text-teal-700', dot: 'bg-teal-500' },
  invoiced: { label: 'Facturee', color: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500' },
  closed: { label: 'Cloturee', color: 'bg-slate-100 text-slate-600', dot: 'bg-slate-400' },
  cancelled: { label: 'Annulee', color: 'bg-red-100 text-red-700', dot: 'bg-red-500' },

  // Tournees
  planned: { label: 'Planifiee', color: 'bg-blue-100 text-blue-700', dot: 'bg-blue-500' },
  in_progress: { label: 'En cours', color: 'bg-amber-100 text-amber-700', dot: 'bg-amber-500' },
  completed: { label: 'Terminee', color: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500' },

  // Generiques
  active: { label: 'Actif', color: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500' },
  inactive: { label: 'Inactif', color: 'bg-slate-100 text-slate-500', dot: 'bg-slate-400' },
  warning: { label: 'Attention', color: 'bg-amber-100 text-amber-700', dot: 'bg-amber-500' },
  error: { label: 'Erreur', color: 'bg-red-100 text-red-700', dot: 'bg-red-500' },
};

// Type-specific overrides for when the same status key needs different labels
const typeOverrides = {
  candidat: {
    received: { label: 'Recu' },
    interview: { label: 'Entretien' },
    recruited: { label: 'Recrute' },
    rejected: { label: 'Refuse' },
  },
  commande: {
    pending: { label: 'En attente' },
    confirmed: { label: 'Confirmee' },
  },
  tournee: {
    planned: { label: 'Planifiee' },
    in_progress: { label: 'En cours' },
    completed: { label: 'Terminee' },
  },
};

const sizeClasses = {
  sm: 'text-xs px-2 py-0.5 gap-1',
  md: 'text-xs px-2.5 py-1 gap-1.5',
};

const dotSizes = {
  sm: 'w-1.5 h-1.5',
  md: 'w-2 h-2',
};

export default function StatusBadge({ status, size = 'md', type }) {
  // Get base mapping
  const base = statusMappings[status];

  if (!base) {
    return (
      <span className={`inline-flex items-center rounded-full font-medium bg-slate-100 text-slate-500 ${sizeClasses[size]}`}>
        <span className={`rounded-full bg-slate-400 ${dotSizes[size]}`} />
        {status || 'Inconnu'}
      </span>
    );
  }

  // Apply type-specific label override if available
  const override = type && typeOverrides[type]?.[status];
  const label = override?.label || base.label;

  return (
    <span className={`inline-flex items-center rounded-full font-medium ${base.color} ${sizeClasses[size]}`}>
      <span className={`rounded-full ${base.dot} ${dotSizes[size]}`} />
      {label}
    </span>
  );
}
