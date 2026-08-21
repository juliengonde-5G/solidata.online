import { Store, Wrench, Fuel, Recycle, Building2, Coffee, MapPinned } from 'lucide-react';

/**
 * arretCategories — référentiel partagé des catégories d'arrêt technique
 * (magasin, entretien, carburant, dechetterie, administratif, pause, autre).
 * Source unique consommée par TourProgrammePanel (icône dans la liste),
 * AddArretModal (sélecteur de lieu) et AdminLieuxTechniques (CRUD référentiel)
 * — évite de dupliquer la liste des catégories à 3 endroits.
 */
export const ARRET_CATEGORIES = [
  { value: 'magasin', label: 'Magasin', icon: Store, color: 'text-indigo-600', bg: 'bg-indigo-100' },
  { value: 'entretien', label: 'Entretien', icon: Wrench, color: 'text-amber-600', bg: 'bg-amber-100' },
  { value: 'carburant', label: 'Carburant', icon: Fuel, color: 'text-orange-600', bg: 'bg-orange-100' },
  { value: 'dechetterie', label: 'Déchèterie', icon: Recycle, color: 'text-emerald-600', bg: 'bg-emerald-100' },
  { value: 'administratif', label: 'Administratif', icon: Building2, color: 'text-slate-600', bg: 'bg-slate-100' },
  { value: 'pause', label: 'Pause', icon: Coffee, color: 'text-blue-600', bg: 'bg-blue-100' },
  { value: 'autre', label: 'Autre', icon: MapPinned, color: 'text-slate-500', bg: 'bg-slate-100' },
];

export function getArretCategoryMeta(value) {
  return ARRET_CATEGORIES.find((c) => c.value === value) || ARRET_CATEGORIES[ARRET_CATEGORIES.length - 1];
}
