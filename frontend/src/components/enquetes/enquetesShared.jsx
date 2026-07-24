/**
 * Helpers partagés du module « Enquêtes » (RSEI-13).
 *
 * Vocabulaire métier (catégories, types de question, statuts de campagne),
 * styles de badges, normalisation des options et petits utilitaires. Le seuil
 * d'anonymat (n ≥ 5) est rappelé ici pour rester cohérent avec le backend
 * (enquetes.js : SEUIL_ANONYMAT = 5) — aucun détail n'est restitué en deçà.
 */

// Seuil d'anonymat : miroir de enquetes.js. Purement informatif côté front —
// c'est le backend qui masque réellement les résultats sous ce seuil.
export const SEUIL_ANONYMAT = 5;

// ── Catégories de modèle (backend CATEGORIES) ────────────────────────────────
export const CATEGORIES = ['qvct', 'satisfaction', 'integration', 'sensibilisation', 'parties_prenantes', 'autre'];
export const CATEGORIE_LABELS = {
  qvct: 'QVCT (conditions de travail)',
  satisfaction: 'Satisfaction',
  integration: 'Intégration (M1)',
  sensibilisation: 'Sensibilisation',
  parties_prenantes: 'Parties prenantes',
  autre: 'Autre',
};

// ── Types de question (backend TYPES_QUESTION) ───────────────────────────────
export const TYPES_QUESTION = ['echelle', 'note_10', 'choix_unique', 'choix_multiple', 'oui_non', 'texte'];
export const TYPE_LABELS = {
  echelle: 'Échelle (1 à 5)',
  note_10: 'Note (0 à 10)',
  choix_unique: 'Choix unique',
  choix_multiple: 'Choix multiple',
  oui_non: 'Oui / Non',
  texte: 'Texte libre',
};
export const TYPE_STYLES = {
  echelle: 'bg-teal-100 text-teal-700',
  note_10: 'bg-cyan-100 text-cyan-700',
  choix_unique: 'bg-blue-100 text-blue-700',
  choix_multiple: 'bg-indigo-100 text-indigo-700',
  oui_non: 'bg-emerald-100 text-emerald-700',
  texte: 'bg-slate-100 text-slate-600',
};
// Bornes des échelles numériques.
export const ECHELLE_MIN = 1;
export const ECHELLE_MAX = 5;
export const NOTE_MIN = 0;
export const NOTE_MAX = 10;

// Seuls les choix (unique/multiple) portent des options saisissables.
export const needsOptions = (type) => type === 'choix_unique' || type === 'choix_multiple';
// Types dont la restitution est numérique (moyenne / min / max).
export const isNumericType = (type) => type === 'echelle' || type === 'note_10';

// ── Statuts de campagne (backend STATUTS_CAMPAGNE + TRANSITIONS) ─────────────
export const STATUT_LABELS = { brouillon: 'Brouillon', ouverte: 'Ouverte', close: 'Clôturée' };
export const STATUT_STYLES = {
  brouillon: 'bg-slate-100 text-slate-600',
  ouverte: 'bg-emerald-100 text-emerald-700',
  close: 'bg-gray-100 text-gray-500',
};
// Transitions forward-only : brouillon → ouverte → close.
export const TRANSITIONS = { brouillon: ['ouverte'], ouverte: ['close'], close: [] };
export const nextStatut = (statut) => (TRANSITIONS[statut] || [])[0] || null;
export const STATUT_ACTION_LABELS = { ouverte: 'Ouvrir les réponses', close: 'Clôturer' };

// ── Normalisation des options (string | {value,label}) → {value,label} ───────
export function normalizeOptions(options) {
  if (!Array.isArray(options)) return [];
  return options
    .map((o) => {
      if (o == null) return null;
      if (typeof o === 'string' || typeof o === 'number') return { value: String(o), label: String(o) };
      const value = o.value ?? o.label ?? '';
      const label = o.label ?? o.value ?? '';
      return { value: String(value), label: String(label) };
    })
    .filter((o) => o && o.value !== '');
}

// ── Petits helpers ───────────────────────────────────────────────────────────
export const apiErr = (err, fallback = 'Une erreur est survenue.') =>
  err?.response?.data?.error || err?.message || fallback;

export const frDate = (d) => {
  if (!d) return '—';
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString('fr-FR');
};
export const frDateTime = (d) => {
  if (!d) return '—';
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? '—' : dt.toLocaleString('fr-FR');
};
export const isoDate = (d) => (d ? String(d).slice(0, 10) : '');

// Jeton d'unicité anti-double-clic (facultatif côté backend). Généré une fois
// par saisie ; renouvelé à chaque « Nouvelle réponse » (usage kiosque partagé).
export function newJeton() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch { /* noop */ }
  return `j-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
