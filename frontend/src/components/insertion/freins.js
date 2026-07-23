/**
 * Miroir frontend du registre UNIQUE des freins périphériques
 * (backend/src/routes/insertion/freins-registry.js — extension insertion 2026-07 PR1).
 *
 * 9 axes : les 7 freins historiques d'abord (compatibilité radar/séries),
 * puis les 2 axes du CDC (logement, judiciaire).
 *
 * ⚠ Masquage MANAGER : le backend RETIRE les clés sensibles des réponses
 * (frein_judiciaire*, détails santé, commentaire_budget). Le front ne doit
 * JAMAIS supposer leur présence — utiliser visibleFreins()/MANAGER_HIDDEN_FIELDS.
 */

export const FREINS = [
  { key: 'mobilite', column: 'frein_mobilite', label: 'Mobilité', short: 'Mobilité', sensible: null, legacy: true, color: '#3B82F6' },
  { key: 'sante', column: 'frein_sante', label: 'Santé', short: 'Santé', sensible: 'art9', legacy: true, color: '#EF4444' },
  { key: 'finances', column: 'frein_finances', label: 'Finances', short: 'Finances', sensible: null, legacy: true, color: '#F59E0B' },
  { key: 'famille', column: 'frein_famille', label: 'Famille', short: 'Famille', sensible: null, legacy: true, color: '#EC4899' },
  { key: 'linguistique', column: 'frein_linguistique', label: 'Linguistique', short: 'Langue', sensible: null, legacy: true, color: '#8B5CF6' },
  { key: 'administratif', column: 'frein_administratif', label: 'Administratif', short: 'Administratif', sensible: null, legacy: true, color: '#0EA5E9' },
  { key: 'numerique', column: 'frein_numerique', label: 'Numérique', short: 'Numérique', sensible: null, legacy: true, color: '#10B981' },
  { key: 'logement', column: 'frein_logement', label: 'Logement', short: 'Logement', sensible: null, legacy: false, color: '#84CC16' },
  { key: 'judiciaire', column: 'frein_judiciaire', label: 'Judiciaire', short: 'Judiciaire', sensible: 'art10', legacy: false, color: '#64748B' },
];

export const FREIN_KEYS = FREINS.map((f) => f.key);

// Libellé par clé et par colonne (pour les données backend qui parlent en colonnes).
export const FREIN_LABEL_BY_KEY = Object.fromEntries(FREINS.map((f) => [f.key, f.label]));
export const FREIN_LABEL_BY_COLUMN = Object.fromEntries(FREINS.map((f) => [f.column, f.label]));

// Couleurs de niveau 1-5 (badges) — 1 = pas de difficulté, 5 = bloquant.
export const FREIN_LEVEL_COLORS = {
  1: 'bg-green-100 text-green-700',
  2: 'bg-green-50 text-green-600',
  3: 'bg-yellow-100 text-yellow-700',
  4: 'bg-orange-100 text-orange-700',
  5: 'bg-red-100 text-red-700',
};

// Clés que le backend retire pour un MANAGER (masking.js) : ne jamais tenter
// de les afficher ni de les envoyer quand le rôle de base est MANAGER.
export const MANAGER_HIDDEN_FIELDS = [
  'commentaire_sante', 'frein_sante_detail', 'frein_sante_causes',
  'frein_judiciaire', 'frein_judiciaire_detail', 'frein_judiciaire_causes',
  'commentaire_budget',
];

/** Les axes de freins visibles pour un rôle de base donné (MANAGER : sans judiciaire). */
export function visibleFreins(baseRole) {
  return baseRole === 'MANAGER' ? FREINS.filter((f) => f.key !== 'judiciaire') : FREINS;
}

/** true si l'utilisateur (rôle de base) peut voir/éditer ce champ du diagnostic. */
export function canSeeField(field, baseRole) {
  if (baseRole !== 'MANAGER') return true;
  return !MANAGER_HIDDEN_FIELDS.includes(field) && !String(field).startsWith('frein_judiciaire');
}

// Encadré légal de l'axe judiciaire (art. 10 RGPD) — affiché à la saisie.
export const JUDICIAIRE_LEGAL_NOTICE =
  'Données relevant de l\'article 10 du RGPD : consigner UNIQUEMENT le niveau du frein et son impact '
  + 'sur l\'organisation du travail (disponibilités, rendez-vous extérieurs, aménagements). '
  + 'Ne jamais mentionner la nature des faits, la qualification pénale ni le contenu d\'une décision de justice.';

// ── Vocabulaire des entretiens (miroir engine.js — jamais « milestone » à l'écran) ──
export const ENTRETIEN_TYPES = ['diagnostic_accueil', 'bilan_intermediaire', 'renouvellement', 'bilan_sortie', 'suivi_post_sortie'];
export const ENTRETIEN_TYPE_LABELS = {
  diagnostic_accueil: "Diagnostic d'accueil",
  bilan_intermediaire: 'Bilan de suivi',
  renouvellement: 'Renouvellement',
  bilan_sortie: 'Bilan de sortie',
  suivi_post_sortie: 'Suivi post-sortie',
};

/** Libellé d'affichage d'un entretien : titre saisi > libellé du type > type brut. */
export function entretienLabel(ms) {
  if (!ms) return '';
  return ms.titre || ENTRETIEN_TYPE_LABELS[ms.milestone_type] || ms.milestone_type;
}

export const ENTRETIEN_STATUS_LABELS = {
  a_planifier: 'À planifier',
  planifie: 'Planifié',
  realise: 'Réalisé',
  reporte: 'Reporté',
};
export const ENTRETIEN_STATUS_COLORS = {
  a_planifier: 'bg-gray-100 text-gray-600 border-gray-300',
  planifie: 'bg-blue-100 text-blue-700 border-blue-300',
  realise: 'bg-green-100 text-green-700 border-green-300',
  reporte: 'bg-orange-100 text-orange-700 border-orange-300',
};

// ── Sorties (nouvelle nomenclature D8/EXG-06) ──
export const SORTIE_CLASSES = ['emploi_durable', 'emploi_transition', 'sortie_positive', 'autre'];
export const SORTIE_CLASS_LABELS = {
  emploi_durable: 'Emploi durable',
  emploi_transition: 'Emploi de transition',
  sortie_positive: 'Sortie positive',
  autre: 'Autre sortie',
};

// ── Actions CIP ──
export const ACTION_STATUS_LABELS = { a_faire: 'À faire', en_cours: 'En cours', realise: 'Réalisée', abandonne: 'Abandonnée' };
export const ACTION_CATEGORY_LABELS = { competence: 'Compétence', insertion: 'Insertion', socialisation: 'Socialisation', frein: 'Levée de frein' };
export const ACTION_PRIORITY_LABELS = { haute: 'Haute', moyenne: 'Moyenne', basse: 'Basse' };
export const ACTION_PRIORITY_COLORS = {
  haute: 'bg-red-100 text-red-700',
  moyenne: 'bg-yellow-100 text-yellow-700',
  basse: 'bg-gray-100 text-gray-600',
};

// ── Objectifs individualisés ──
export const OBJECTIF_STATUTS = ['a_venir', 'en_cours', 'atteint', 'partiellement_atteint', 'abandonne', 'reporte'];
export const OBJECTIF_STATUT_LABELS = {
  a_venir: 'À venir',
  en_cours: 'En cours',
  atteint: 'Atteint',
  partiellement_atteint: 'En partie',
  abandonne: 'Abandonné',
  reporte: 'Reporté',
};
export const OBJECTIF_STATUT_COLORS = {
  a_venir: 'bg-slate-100 text-slate-600',
  en_cours: 'bg-blue-100 text-blue-700',
  atteint: 'bg-green-100 text-green-700',
  partiellement_atteint: 'bg-amber-100 text-amber-700',
  abandonne: 'bg-gray-200 text-gray-500',
  reporte: 'bg-orange-100 text-orange-700',
};

/** Date en français (jj/mm/aaaa) — tolère null. */
export const frDate = (d) => (d ? new Date(d).toLocaleDateString('fr-FR') : '—');

/** true si le rôle de base est habilité ADMIN/RH (écritures objectifs, IA…). */
export function isAdminRh(user) {
  return ['ADMIN', 'RH'].includes(user?.base_role || user?.role);
}
