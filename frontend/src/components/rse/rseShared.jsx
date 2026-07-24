import { useState, useEffect } from 'react';
import api from '../../services/api';

/**
 * Helpers partagés du module « Pilotage RSE » (RSEI-10) :
 * vocabulaire métier (Initial/Engagé/Confirmé/Exemplaire), couleurs de
 * maturité, petits composants réutilisés par les onglets (sélecteur de niveau,
 * multi-sélecteur de critères, sélecteur d'utilisateur) et le hook de liste
 * d'utilisateurs assignables.
 *
 * Doctrine « jamais de valeur inventée » : un niveau non coté est NULL et
 * s'affiche « non coté » (jamais 0).
 */

// ── Vocabulaire de la grille de cotation (rapport 02 §4.2) ────────────────────
export const NIVEAUX = [1, 2, 3, 4];
export const NIVEAU_LABELS = { 1: 'Initial', 2: 'Engagé', 3: 'Confirmé', 4: 'Exemplaire' };

export const CHAPITRE_LABELS = {
  1: "Projet d'entreprise, gouvernance & stratégie",
  2: 'Management des ressources humaines',
  3: "Mission d'inclusion",
  4: 'Management des enjeux environnementaux',
  5: 'Mesure, analyse & amélioration',
};

export const ACTION_STATUT_LABELS = {
  a_faire: 'À faire', en_cours: 'En cours', realise: 'Réalisé', abandonne: 'Abandonné',
};
export const ACTION_STATUT_STYLES = {
  a_faire: 'bg-slate-100 text-slate-600',
  en_cours: 'bg-blue-100 text-blue-700',
  realise: 'bg-emerald-100 text-emerald-700',
  abandonne: 'bg-gray-100 text-gray-400',
};
export const PRIORITE_LABELS = { haute: 'Haute', moyenne: 'Moyenne', basse: 'Basse' };
export const PRIORITE_STYLES = {
  haute: 'bg-red-100 text-red-700', moyenne: 'bg-amber-100 text-amber-700', basse: 'bg-slate-100 text-slate-500',
};

export const EVAL_TYPE_LABELS = { auto_evaluation: 'Auto-évaluation', audit_interne: 'Audit interne' };
export const EVAL_STATUT_LABELS = { en_cours: 'En cours', cloturee: 'Clôturée' };

export const INTERACTION_TYPE_LABELS = {
  dialogue: 'Dialogue', demande: 'Demande', reclamation: 'Réclamation', information: 'Information',
};
export const INTERACTION_TYPE_STYLES = {
  dialogue: 'bg-teal-100 text-teal-700',
  demande: 'bg-blue-100 text-blue-700',
  reclamation: 'bg-red-100 text-red-700',
  information: 'bg-slate-100 text-slate-600',
};

// Catégories suggérées de parties prenantes (champ libre — datalist).
export const PP_CATEGORIES = [
  'Financeur', 'Prescripteur', 'Client', 'Collectivité', 'Fournisseur',
  'Partenaire', 'Salariés', 'Bénévoles', 'Institution', 'Autre',
];
export const INFLUENCE_INTERET_LABELS = { 1: 'Faible', 2: 'Modéré', 3: 'Fort', 4: 'Majeur' };

// Uploads du registre de preuves : aligné sur documentFilter (backend).
export const UPLOAD_ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx';
export const UPLOAD_MAX = 15 * 1024 * 1024; // 15 Mo (limite multer)

// ── Couleurs de maturité (heatmap : gris = non coté, dégradé 1→4) ────────────
export function niveauCellClasses(n) {
  switch (n) {
    case 1: return 'bg-rose-600 text-white border-rose-700';
    case 2: return 'bg-amber-500 text-white border-amber-600';
    case 3: return 'bg-lime-600 text-white border-lime-700';
    case 4: return 'bg-emerald-600 text-white border-emerald-700';
    default: return 'bg-gray-100 text-gray-400 border-gray-200';
  }
}
export function niveauBadgeClasses(n) {
  switch (n) {
    case 1: return 'bg-rose-100 text-rose-700';
    case 2: return 'bg-amber-100 text-amber-700';
    case 3: return 'bg-lime-100 text-lime-700';
    case 4: return 'bg-emerald-100 text-emerald-700';
    default: return 'bg-gray-100 text-gray-400';
  }
}
export const niveauDotColor = (n) => ({ 1: '#e11d48', 2: '#f59e0b', 3: '#65a30d', 4: '#059669' }[n] || '#cbd5e1');

// ── Petits helpers ────────────────────────────────────────────────────────────
export const frDate = (d) => {
  if (!d) return '—';
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString('fr-FR');
};
export const isoDate = (d) => (d ? String(d).slice(0, 10) : '');
export const todayISO = () => new Date().toISOString().slice(0, 10);
export const apiErr = (err, fallback = 'Une erreur est survenue.') =>
  err?.response?.data?.error || err?.message || fallback;
export const userLabel = (u) =>
  (`${u?.first_name || ''} ${u?.last_name || ''}`.trim()) || u?.username || (u?.id != null ? `#${u.id}` : '—');

// ── Hook : utilisateurs assignables (pilote / responsable / évaluateur) ───────
// Endpoint dédié GET /rse/assignable-users (ouvert aux rôles de lecture du
// module, dont REF_RSE) : tous les permanents actifs. Repli sur
// /insertion/cip-referents puis liste vide (les sélecteurs conservent alors la
// valeur courante — voir UserSelect).
export function useAssignableUsers() {
  const [users, setUsers] = useState([]);
  const [restricted, setRestricted] = useState(false);
  useEffect(() => {
    let alive = true;
    api.get('/rse/assignable-users')
      .then((r) => { if (alive) setUsers(Array.isArray(r.data) ? r.data : []); })
      .catch(() => api.get('/insertion/cip-referents')
        .then((r) => { if (alive) { setUsers(Array.isArray(r.data) ? r.data : []); setRestricted(true); } })
        .catch(() => { if (alive) { setUsers([]); setRestricted(true); } }));
    return () => { alive = false; };
  }, []);
  return { users, restricted };
}

// ── Sélecteur d'utilisateur (préserve la valeur courante hors liste) ──────────
export function UserSelect({ value, onChange, users, currentName, placeholder = 'Non attribué', disabled, id }) {
  const has = value != null && users.some((u) => String(u.id) === String(value));
  return (
    <select
      id={id}
      value={value ?? ''}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value === '' ? null : parseInt(e.target.value, 10))}
      className="input-modern w-full py-1.5 text-sm"
    >
      <option value="">{placeholder}</option>
      {value != null && !has && currentName && <option value={value}>{currentName} (actuel)</option>}
      {users.map((u) => <option key={u.id} value={u.id}>{userLabel(u)}</option>)}
    </select>
  );
}

// ── Sélecteur de niveau (4 gros boutons 1-4 + « Non coté ») ───────────────────
export function LevelPicker({ value, onChange, disabled = false, allowClear = true, size = 'md' }) {
  const pad = size === 'sm' ? 'px-2 py-1 text-xs' : 'px-3 py-2 text-sm';
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Choix du niveau de maturité">
      {NIVEAUX.map((n) => {
        const active = value === n;
        return (
          <button
            key={n}
            type="button"
            disabled={disabled}
            aria-pressed={active}
            onClick={() => onChange(active && allowClear ? null : n)}
            className={`rounded-lg border font-medium ${pad} transition ${active ? niveauCellClasses(n) : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'} ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
          >
            <span className="font-bold">{n}</span> <span className={active ? '' : 'text-slate-400'}>{NIVEAU_LABELS[n]}</span>
          </button>
        );
      })}
      {allowClear && (
        <button
          type="button"
          disabled={disabled}
          aria-pressed={value == null}
          onClick={() => onChange(null)}
          className={`rounded-lg border ${pad} ${value == null ? 'bg-slate-100 text-slate-600 border-slate-300' : 'bg-white text-slate-400 border-slate-200 hover:text-slate-600'} ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
        >
          Non coté
        </button>
      )}
    </div>
  );
}

// ── Multi-sélecteur des critères servis (groupé par chapitre) ─────────────────
export function CriteresMultiSelect({ value = [], onChange, criteres = [], id }) {
  const set = new Set((value || []).map(String));
  const toggle = (code) => {
    const next = new Set(set);
    if (next.has(code)) next.delete(code); else next.add(code);
    onChange(Array.from(next));
  };
  const byCh = {};
  for (const c of criteres) (byCh[c.chapitre] = byCh[c.chapitre] || []).push(c);
  const chapitres = Object.keys(byCh).sort();
  return (
    <div id={id} className="border border-slate-200 rounded-lg max-h-48 overflow-y-auto p-2 space-y-2 bg-white">
      {criteres.length === 0 && <p className="text-xs text-slate-400">Chargement des critères…</p>}
      {chapitres.map((ch) => (
        <div key={ch}>
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">
            Ch. {ch} — {CHAPITRE_LABELS[ch]}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1">
            {byCh[ch].map((c) => (
              <label key={c.code} className="flex items-start gap-1.5 text-xs text-slate-600 cursor-pointer">
                <input type="checkbox" checked={set.has(c.code)} onChange={() => toggle(c.code)} className="mt-0.5 rounded border-slate-300" />
                <span><strong className="text-slate-700">{c.code}</strong> {c.intitule}</span>
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Puces des codes de critères (affichage compact en tableau) ────────────────
export function CritereChips({ codes }) {
  if (!codes || codes.length === 0) return <span className="text-slate-300">—</span>;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {codes.map((c) => (
        <span key={c} className="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-medium">{c}</span>
      ))}
    </span>
  );
}
