/**
 * Helpers partagés du module « Énergie & GES » (RSEI-11) :
 * libellés des postes / types (alignés sur les CHECK backend), couleurs de
 * poste pour les graphes, petits formateurs et composants réutilisés (cartes
 * KPI, badge de dérive, bandeau d'avertissement facteurs).
 *
 * Doctrine « jamais de valeur inventée » : une donnée manquante s'affiche
 * « — » ou « facteur à renseigner », JAMAIS 0. Voir tco2eLabel().
 */

// ── Mois (aligné sur BoutiquesObjectifs / VAK) ────────────────────────────────
export const MOIS = ['Janv', 'Févr', 'Mars', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sept', 'Oct', 'Nov', 'Déc'];

// ── Libellés des postes / types (miroir des CHECK backend) ────────────────────
export const POSTE_LABELS = {
  electricite: 'Électricité', gaz: 'Gaz', eau: 'Eau', autre: 'Autre',
  gazole: 'Gazole', essence: 'Essence', gnv: 'GNV', electrique: 'Électrique', adblue: 'AdBlue',
};
export const posteLabel = (p) => POSTE_LABELS[p] || p || '—';

// Types de compteur (energie_compteurs.type) et unité conseillée par défaut.
export const TYPES_COMPTEUR = [
  { value: 'electricite', label: 'Électricité', unite: 'kWh' },
  { value: 'gaz', label: 'Gaz', unite: 'kWh' },
  { value: 'eau', label: 'Eau', unite: 'm3' },
  { value: 'autre', label: 'Autre', unite: 'kWh' },
];

// Types de carburant (carburant_pleins.type_carburant).
export const TYPES_CARBURANT = [
  { value: 'gazole', label: 'Gazole' },
  { value: 'essence', label: 'Essence' },
  { value: 'gnv', label: 'GNV' },
  { value: 'electrique', label: 'Électrique' },
  { value: 'adblue', label: 'AdBlue' },
  { value: 'autre', label: 'Autre' },
];

// Couleurs des postes pour les barres Recharts.
export const POSTE_COLORS = {
  electricite: '#3b82f6', gaz: '#f59e0b', eau: '#06b6d4', autre: '#94a3b8',
  gazole: '#0f766e', essence: '#dc2626', gnv: '#7c3aed', electrique: '#10b981', adblue: '#64748b',
};

// Source du CA de référence de l'intensité (backend resolveCA).
export const CA_SOURCE_LABELS = {
  settings: 'CA paramétré (réglages)',
  gl: 'Grand Livre (comptes 70/74)',
  operationnel: 'CA opérationnel (boutiques + VAK + exutoires)',
};
export const caSourceLabel = (s) => CA_SOURCE_LABELS[s] || 'source inconnue';

// ── Formateurs (jamais de faux zéro) ──────────────────────────────────────────
export const apiErr = (err, fallback = 'Une erreur est survenue.') =>
  err?.response?.data?.error || err?.message || fallback;

export const num = (v) => {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

export const fmtNum = (v, digits = 0) => {
  const n = num(v);
  return n == null ? '—' : n.toLocaleString('fr-FR', { maximumFractionDigits: digits });
};
export const fmtEur = (v) => {
  const n = num(v);
  return n == null ? '—' : `${n.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} €`;
};
export const fmtUnite = (v, unite, digits = 0) => {
  const n = num(v);
  return n == null ? '—' : `${n.toLocaleString('fr-FR', { maximumFractionDigits: digits })} ${unite || ''}`.trim();
};
// tCO2e : null (facteur manquant) → libellé honnête, jamais 0.
export const tco2eLabel = (v, facteurManquant) => {
  if (facteurManquant || v == null) return 'facteur à renseigner';
  return `${Number(v).toLocaleString('fr-FR', { maximumFractionDigits: 3 })} tCO2e`;
};

export const frDate = (d) => {
  if (!d) return '—';
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString('fr-FR');
};
export const isoDate = (d) => (d ? String(d).slice(0, 10) : '');
export const todayISO = () => new Date().toISOString().slice(0, 10);

export const yearsList = (n = 6) => {
  const y = new Date().getFullYear();
  return Array.from({ length: n }, (_, i) => y - i);
};

// ── Carte KPI (même look que PilotageRSE / AuditInsertion) ─────────────────────
export function StatCard({ icon: Icon, label, value, sub, tone = 'teal' }) {
  const tones = {
    teal: 'bg-teal-50 text-teal-700 border-teal-100',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    blue: 'bg-blue-50 text-blue-700 border-blue-100',
    amber: 'bg-amber-50 text-amber-700 border-amber-100',
    red: 'bg-red-50 text-red-700 border-red-100',
    slate: 'bg-slate-50 text-slate-700 border-slate-100',
  };
  return (
    <div className={`rounded-xl border p-4 ${tones[tone] || tones.teal}`}>
      <div className="flex items-center gap-2 text-xs font-medium opacity-80">{Icon && <Icon className="w-4 h-4" />}{label}</div>
      <div className="mt-1 text-2xl font-bold">{value ?? '—'}</div>
      {sub && <div className="text-xs opacity-70 mt-0.5">{sub}</div>}
    </div>
  );
}

// ── Badge de dérive de consommation (rouge si dérive) ─────────────────────────
export function DeriveBadge({ derive, seuil }) {
  if (derive) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700"
        title={seuil != null ? `Dernière conso > moyenne + ${seuil} %` : 'Consommation en hausse anormale'}>
        Dérive
      </span>
    );
  }
  return <span className="inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">Stable</span>;
}

// ── Bandeau d'avertissement « facteurs indicatifs » ───────────────────────────
export function FacteursWarning({ message }) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 text-amber-800 text-xs px-3 py-2 flex items-start gap-2" role="note">
      <span aria-hidden="true">⚠</span>
      <span>{message || 'Émissions calculées avec des facteurs indicatifs et paramétrables (ADEME Base Empreinte), à ajuster par la structure. Ne prétendent pas à l\'exactitude réglementaire.'}</span>
    </div>
  );
}
