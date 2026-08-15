/**
 * Helpers partagés du module « Temps & Présence » (badgeuse) :
 * dictionnaires FR (sens, source, statuts, motifs), formateurs d'heure/date
 * (affichage systématique en heure de Paris — le stockage est en UTC côté
 * serveur, cf. MODELE_DONNEES.md §3), petits badges de statut réutilisés dans
 * les 7 onglets.
 *
 * Contrat d'API de référence : docs/badgeuse/MODELE_DONNEES.md §3.
 */
import { AlertTriangle, ArrowDownCircle, ArrowUpCircle, HelpCircle } from 'lucide-react';

// ── Dictionnaires FR (miroir des CHECK backend, MODELE_DONNEES.md §1) ────────
export const SENS_LABELS = { entree: 'Entrée', sortie: 'Sortie', inconnu: 'Inconnu' };
export const SOURCE_LABELS = { badge: 'Badge', manuel: 'Saisie manuelle', import: 'Import' };
export const STATUT_POINTAGE_LABELS = { brut: 'Brut', traite: 'Traité', orphelin: 'Orphelin' };
export const ORPHELIN_RAISON_LABELS = {
  badge_inconnu: 'Badge inconnu', hors_plage: 'Hors plage horaire', badge_inactif: 'Badge inactif',
};
export const STATUT_BADGE_LABELS = {
  actif: 'Actif', perdu: 'Perdu', vole: 'Volé', restitue: 'Restitué', desactive: 'Désactivé',
};
export const STATUT_FEUILLE_LABELS = {
  brouillon: 'Brouillon', validee_encadrant: 'Validée (encadrant)', validee_rh: 'Validée (RH)',
};
export const TYPE_CORRECTION_LABELS = { ajout: 'Ajout', modification: 'Modification', annulation: 'Annulation' };
export const TYPE_CONTENU_LABELS = {
  message: 'Message', image: 'Image', planning: 'Planning',
  compte_a_rebours: 'Compte à rebours', meteo: 'Météo',
};
export const CIBLE_DEVICE_LABELS = { pi5: 'Raspberry Pi 5', pi3: 'Raspberry Pi 3 B+ (secours)' };
export const EVENEMENT_HISTORIQUE_LABELS = {
  attribution: 'Attribution', perte: 'Déclaré perdu', vol: 'Déclaré volé',
  restitution: 'Restitution', desactivation: 'Désactivation', reactivation: 'Réactivation',
};

// Motifs de correction — liste FERMÉE (NOTE_RH §5.1). « autre » exige un détail.
export const MOTIFS_CORRECTION = [
  { value: 'oubli_badge', label: 'Badge oublié' },
  { value: 'badge_defaillant', label: 'Badge défaillant' },
  { value: 'mission_exterieure', label: 'Mission extérieure' },
  { value: 'rdv_accompagnement', label: 'Rendez-vous accompagnement' },
  { value: 'formation', label: 'Formation' },
  { value: 'autre', label: 'Autre (à préciser)' },
];
export const motifLabel = (m) => MOTIFS_CORRECTION.find((x) => x.value === m)?.label || m || '—';

// ── Formateurs ─────────────────────────────────────────────────────────────
export const apiErr = (err, fallback = 'Une erreur est survenue.') =>
  err?.response?.data?.error || err?.message || fallback;

// Lit un message d'erreur JSON depuis une réponse blob (export CSV en échec).
export async function blobErr(err, fallback) {
  try {
    const txt = await err?.response?.data?.text?.();
    if (txt) {
      const parsed = JSON.parse(txt);
      return parsed.error || fallback;
    }
  } catch { /* garde le message générique */ }
  return apiErr(err, fallback);
}

// Décimal → « 7 h 42 » (jamais de faux zéro : null/vide → « — »).
export function fmtHeure(v) {
  if (v == null || v === '') return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  let h = Math.floor(abs);
  let m = Math.round((abs - h) * 60);
  if (m === 60) { h += 1; m = 0; }
  return `${sign}${h} h ${String(m).padStart(2, '0')}`;
}

export function fmtDateTimeParis(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('fr-FR', {
    timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}
export function fmtDateParis(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric' });
}
export function fmtHeureParis(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
// Ancienneté relative (« il y a 3 min ») pour la supervision des postes.
export function fmtDepuis(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const secs = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000));
  if (secs < 60) return `il y a ${secs} s`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `il y a ${mins} min`;
  const heures = Math.round(mins / 60);
  if (heures < 48) return `il y a ${heures} h`;
  return `il y a ${Math.round(heures / 24)} j`;
}

// Date civile 'YYYY-MM-DD' d'un instant, vue depuis Paris (usage machine).
export function parisDateISO(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(d);
}

// Heure murale 'HH:MM' d'un instant, vue depuis Paris (usage machine).
export function parisTimeHM(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d);
}

export const todayISO = () => new Date().toISOString().slice(0, 10);
export const currentPeriode = () => new Date().toISOString().slice(0, 7); // YYYY-MM
export function offsetDaysISO(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

// Nom d'un salarié depuis une ligne d'API — le contrat back-office joint
// généralement un champ `<prefix>_nom` déjà formaté (« NOM Prénom ») ; on
// tolère aussi first_name/last_name séparés en repli, jamais une ligne vide.
export function formatLastName(nom) { return String(nom == null ? '' : nom).toUpperCase(); }
export function formatEmployeeName(last, first) {
  const l = formatLastName(last).trim();
  const f = String(first == null ? '' : first).trim();
  return [l, f].filter(Boolean).join(' ');
}
export function employeeName(row, prefix = 'employee') {
  const direct = row?.[`${prefix}_nom`] || row?.[`${prefix}_name`];
  if (direct) return direct;
  const last = row?.[`${prefix}_last_name`] ?? (prefix === 'employee' ? row?.last_name : undefined);
  const first = row?.[`${prefix}_first_name`] ?? (prefix === 'employee' ? row?.first_name : undefined);
  if (last || first) return formatEmployeeName(last, first);
  const id = row?.[`${prefix}_id`];
  return id != null ? `Salarié #${id}` : '—';
}

// ── Badges de statut (petits composants réutilisés dans les 7 onglets) ──────
export function SensBadge({ sens }) {
  if (sens === 'entree') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
        <ArrowDownCircle className="w-3.5 h-3.5" aria-hidden="true" /> Entrée
      </span>
    );
  }
  if (sens === 'sortie') {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-orange-100 text-orange-700">
        <ArrowUpCircle className="w-3.5 h-3.5" aria-hidden="true" /> Sortie
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">
      <HelpCircle className="w-3.5 h-3.5" aria-hidden="true" /> Inconnu
    </span>
  );
}

export function StatutPointageBadge({ statut }) {
  const map = {
    brut: 'bg-slate-100 text-slate-600',
    traite: 'bg-emerald-100 text-emerald-700',
    orphelin: 'bg-red-100 text-red-700',
  };
  return (
    <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full ${map[statut] || 'bg-slate-100 text-slate-500'}`}>
      {STATUT_POINTAGE_LABELS[statut] || statut || '—'}
    </span>
  );
}

// Indicateur ⚠ chaîne d'intégrité rompue (chaine_valide === false).
export function ChaineWarning({ chaineValide }) {
  if (chaineValide !== false) return null;
  return (
    <span className="inline-flex items-center gap-1 text-amber-600" title="Rupture détectée dans la chaîne d'intégrité de ce pointage">
      <AlertTriangle className="w-4 h-4" aria-hidden="true" />
      <span className="sr-only">Chaîne d'intégrité rompue</span>
    </span>
  );
}

export function StatutBadgeChip({ statut }) {
  const map = {
    actif: 'bg-emerald-100 text-emerald-700',
    perdu: 'bg-red-100 text-red-700',
    vole: 'bg-red-100 text-red-700',
    restitue: 'bg-slate-100 text-slate-600',
    desactive: 'bg-slate-100 text-slate-500',
  };
  return (
    <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full ${map[statut] || 'bg-slate-100 text-slate-500'}`}>
      {STATUT_BADGE_LABELS[statut] || statut || '—'}
    </span>
  );
}

export function StatutFeuilleChip({ statut }) {
  const map = {
    brouillon: 'bg-slate-100 text-slate-600',
    validee_encadrant: 'bg-amber-100 text-amber-700',
    validee_rh: 'bg-emerald-100 text-emerald-700',
  };
  return (
    <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full ${map[statut] || 'bg-slate-100 text-slate-500'}`}>
      {STATUT_FEUILLE_LABELS[statut] || statut || 'Brouillon'}
    </span>
  );
}

export function EnLigneBadge({ enLigne }) {
  return enLigne ? (
    <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> En ligne
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-700">
      <span className="w-1.5 h-1.5 rounded-full bg-red-500" /> Hors ligne
    </span>
  );
}

// Un poste est « en ligne » si son dernier heartbeat est plus récent que le
// seuil de silence PARAMÉTRÉ (`badgeuse.supervision_silence_minutes`, BO-09) —
// c'est le serveur qui tranche, via le champ `online` de GET /devices. Le repli
// local (15 min, valeur par défaut documentée de la grille) ne sert qu'aux
// réponses anciennes qui ne portent pas ce champ.
export function isDeviceOnline(device) {
  if (typeof device?.online === 'boolean') return device.online;
  if (typeof device?.en_ligne === 'boolean') return device.en_ligne;
  if (!device?.dernier_heartbeat) return false;
  const d = new Date(device.dernier_heartbeat);
  if (Number.isNaN(d.getTime())) return false;
  return (Date.now() - d.getTime()) / 1000 < 15 * 60;
}
