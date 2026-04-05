const statusMappings = {
  // Candidats (recrutement)
  received: { label: 'Recu', color: 'bg-blue-100 text-blue-700', dot: 'bg-blue-500' },
  interview: { label: 'Entretien', color: 'bg-amber-100 text-amber-700', dot: 'bg-amber-500' },
  recruited: { label: 'Recrute', color: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500' },
  rejected: { label: 'Refuse', color: 'bg-red-100 text-red-700', dot: 'bg-red-500' },

  // Commandes logistiques
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

  // Facturation
  sent: { label: 'Envoyee', color: 'bg-blue-100 text-blue-700', dot: 'bg-blue-500' },
  paid: { label: 'Payee', color: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500' },
  overdue: { label: 'En retard', color: 'bg-red-100 text-red-700', dot: 'bg-red-500' },

  // Vehicules
  operationnel: { label: 'Operationnel', color: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500' },
  en_panne: { label: 'En panne', color: 'bg-red-100 text-red-700', dot: 'bg-red-500' },
  maintenance: { label: 'Maintenance', color: 'bg-amber-100 text-amber-700', dot: 'bg-amber-500' },

  // Stock / mouvements
  entree: { label: 'Entree', color: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500' },
  sortie: { label: 'Sortie', color: 'bg-red-100 text-red-700', dot: 'bg-red-500' },

  // Heures de travail
  travail: { label: 'Travail', color: 'bg-blue-100 text-blue-700', dot: 'bg-blue-500' },
  absence: { label: 'Absence', color: 'bg-amber-100 text-amber-700', dot: 'bg-amber-500' },
  conge: { label: 'Conge', color: 'bg-purple-100 text-purple-700', dot: 'bg-purple-500' },
  maladie: { label: 'Maladie', color: 'bg-red-100 text-red-700', dot: 'bg-red-500' },
  formation: { label: 'Formation', color: 'bg-indigo-100 text-indigo-700', dot: 'bg-indigo-500' },

  // Roles utilisateur
  ADMIN: { label: 'Admin', color: 'bg-purple-100 text-purple-700', dot: 'bg-purple-500' },
  MANAGER: { label: 'Manager', color: 'bg-blue-100 text-blue-700', dot: 'bg-blue-500' },
  RH: { label: 'RH', color: 'bg-teal-100 text-teal-700', dot: 'bg-teal-500' },
  COLLABORATEUR: { label: 'Collaborateur', color: 'bg-slate-100 text-slate-600', dot: 'bg-slate-400' },
  AUTORITE: { label: 'Autorite', color: 'bg-amber-100 text-amber-700', dot: 'bg-amber-500' },

  // Qualite produits finis
  A: { label: 'A', color: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500' },
  B: { label: 'B', color: 'bg-amber-100 text-amber-700', dot: 'bg-amber-500' },
  C: { label: 'C', color: 'bg-red-100 text-red-700', dot: 'bg-red-500' },

  // Tournees mode
  intelligent: { label: 'Intelligent', color: 'bg-purple-100 text-purple-700', dot: 'bg-purple-500' },
  standard: { label: 'Standard', color: 'bg-slate-100 text-slate-700', dot: 'bg-slate-400' },
  manual: { label: 'Manuel', color: 'bg-slate-100 text-slate-700', dot: 'bg-slate-400' },

  // Refashion DPAV
  submitted: { label: 'Soumis', color: 'bg-blue-100 text-blue-700', dot: 'bg-blue-500' },

  // Chaine tri / referentiels / booleens
  oui: { label: 'Oui', color: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500' },
  non: { label: 'Non', color: 'bg-red-100 text-red-700', dot: 'bg-red-500' },

  // Types clients exutoires
  recycleur: { label: 'Recycleur', color: 'bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500' },
  negociant: { label: 'Negociant', color: 'bg-blue-50 text-blue-700', dot: 'bg-blue-500' },
  industriel: { label: 'Industriel', color: 'bg-orange-50 text-orange-700', dot: 'bg-orange-500' },
  autre: { label: 'Autre', color: 'bg-slate-100 text-slate-600', dot: 'bg-slate-400' },

  // Expeditions
  shipped: { label: 'Expediee', color: 'bg-blue-100 text-blue-700', dot: 'bg-blue-500' },
  loading: { label: 'Chargement', color: 'bg-amber-100 text-amber-700', dot: 'bg-amber-500' },

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

export default function StatusBadge({ status, size = 'md', type, label: labelOverride }) {
  // Get base mapping
  const base = statusMappings[status];

  if (!base) {
    return (
      <span className={`inline-flex items-center rounded-full font-medium bg-slate-100 text-slate-500 ${sizeClasses[size]}`}>
        <span className={`rounded-full bg-slate-400 ${dotSizes[size]}`} />
        {labelOverride || status || 'Inconnu'}
      </span>
    );
  }

  // Apply type-specific label override if available
  const override = type && typeOverrides[type]?.[status];
  const label = labelOverride || override?.label || base.label;

  return (
    <span className={`inline-flex items-center rounded-full font-medium ${base.color} ${sizeClasses[size]}`}>
      <span className={`rounded-full ${base.dot} ${dotSizes[size]}`} />
      {label}
    </span>
  );
}
