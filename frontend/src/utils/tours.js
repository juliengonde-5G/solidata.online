/**
 * Libellés et code couleur des états de tournée — SOURCE UNIQUE.
 *
 * `tours.status` est contraint en base à six valeurs techniques (cf. init-db.js :
 * planned, in_progress, paused, returning, completed, cancelled). Elles ne
 * doivent jamais atteindre l'écran telles quelles : un gestionnaire qui lit
 * « completed » dans son historique de tournées ne sait pas s'il regarde une
 * tournée réussie, close d'office ou abandonnée.
 *
 * Ces libellés vivaient en constante locale de « Collecte en direct » pendant
 * que l'historique affichait la valeur brute — exactement la divergence corrigée
 * pour les incidents en 2.39.0 (utils/incidents.js). D'où ce module partagé.
 *
 * LE CODE COULEUR PORTE UN SENS, il n'est pas décoratif :
 *   vert   = la tournée est allée à son terme ;
 *   bleu   = elle est en cours, quelqu'un est sur la route ;
 *   indigo = le camion rentre au centre (étape distincte : la pesée arrive) ;
 *   ambre  = elle est en pause, donc en attente d'une reprise ;
 *   rouge  = elle a été annulée, aucun tonnage n'en sortira ;
 *   gris   = elle est seulement planifiée, rien n'a commencé.
 */

/** Doit couvrir le CHECK de `tours.status` (cf. init-db.js). */
export const TOUR_STATUS_META = {
  planned: {
    label: 'Planifiée',
    classe: 'bg-slate-100 text-slate-600',
    puce: '#94A3B8',
  },
  in_progress: {
    label: 'En cours',
    classe: 'bg-blue-100 text-blue-700 font-semibold',
    puce: '#2563EB',
  },
  paused: {
    label: 'En pause',
    classe: 'bg-amber-100 text-amber-700',
    puce: '#D97706',
  },
  returning: {
    label: 'Retour au centre',
    classe: 'bg-indigo-100 text-indigo-700 font-semibold',
    puce: '#4338CA',
  },
  // « Complétée » à la demande du client (l'écran affichait « Completed »),
  // accordé au féminin — c'est une tournée.
  completed: {
    label: 'Complétée',
    classe: 'bg-emerald-100 text-emerald-700 font-semibold',
    puce: '#059669',
  },
  cancelled: {
    label: 'Annulée',
    classe: 'bg-red-100 text-red-700',
    puce: '#DC2626',
  },
};

/**
 * Repli sur la valeur brute plutôt que sur un tiret : si un statut inconnu
 * apparaît un jour, mieux vaut le voir en clair — c'est le signe qu'un libellé
 * manque ici — que de le masquer derrière un « — » qu'on lirait comme une
 * donnée absente. Même doctrine que utils/incidents.js.
 */
export const libelleStatutTournee = (statut) => TOUR_STATUS_META[statut]?.label || statut || '—';

/** Classes du badge. Un statut inconnu reste lisible, en gris neutre. */
export const classeStatutTournee = (statut) =>
  TOUR_STATUS_META[statut]?.classe || 'bg-slate-100 text-slate-600';

/**
 * Lien de carte vers un point GPS. Google Maps est retenu (demande client
 * 27/08/2026) : c'est l'outil déjà utilisé par les chauffeurs pour naviguer
 * (mobile TourMap), et le gestionnaire qui ouvre un point depuis son historique
 * y retrouve la vue satellite et le Street View — ce qu'OpenStreetMap ne donne
 * pas. Les FONDS de carte de l'application restent inchangés (CARTO/OSM) : il
 * ne s'agit ici que des liens « ouvrir ce point ».
 *
 * `null` — et jamais un lien vers l'océan Atlantique — quand les coordonnées
 * sont absentes ou illisibles : au point 0,0 il n'y a rien à voir.
 */
export function lienCarteGps(latitude, longitude) {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat === 0 && lng === 0) return null;
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}
