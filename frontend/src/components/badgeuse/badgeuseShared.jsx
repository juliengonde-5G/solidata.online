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
// Types « historiques » (V1, saisie manuelle intégrale) + types v2
// (CDC_AFFICHAGE_V2.md §2, CONTRAT_API_DEVICE.md §3bis) : générateurs (contenu
// calculé côté serveur à chaque construction de playlist) et médias servis par
// le serveur (téléversement ou lien partagé téléchargé côté serveur — le poste
// ne fait jamais de requête vers un domaine externe).
export const TYPE_CONTENU_LABELS = {
  message: 'Message', image: 'Image', planning: 'Planning',
  compte_a_rebours: 'Compte à rebours', meteo: 'Météo',
  annonces: 'Annonces du jour (anniversaires)',
  actus: "Fil d'actualités",
  tournees: 'Tournées en cours',
  social: 'Réseaux sociaux',
  vak_live: 'Écran VAK (jours de VAK)',
  media: 'Média (image/vidéo)',
  lien: 'Lien partagé',
};

// Aide contextuelle affichée dans le formulaire de création (une phrase par
// type, jamais une donnée personnelle).
export const TYPE_CONTENU_HINTS = {
  message: 'Texte libre affiché tel quel sur le poste.',
  image: "Chemin d'un fichier déjà déployé sur le poste (V1, CSP img-src 'self').",
  planning: 'Planning affiché en texte libre (corps du message).',
  compte_a_rebours: 'Décompte affiché en texte libre (corps du message).',
  meteo: 'Bloc météo affiché en texte libre (corps du message).',
  annonces: "Anniversaires du jour (naissance et/ou entrée dans la structure) — prénom + initiale, salariés ayant donné leur accord uniquement. Généré côté serveur, rien à saisir ici.",
  actus: "Dernières brèves du fil d'actualités SOLIDATA (titre + résumé + source). Généré côté serveur.",
  tournees: 'Tournées en cours (véhicule, progression X/Y CAV) — jamais le nom du chauffeur. Généré côté serveur.',
  social: "Derniers posts des comptes Instagram/Facebook de la structure (réglage dans « Réseaux sociaux »). Généré côté serveur.",
  vak_live: 'Écran promotionnel injecté automatiquement les jours de VAK active (poids cumulé, jauge objectif). Généré côté serveur.',
  media: 'Image ou vidéo téléversée dans SOLIDATA — servie en local par le poste (hors ligne préservé).',
  lien: 'URL partagée : le serveur télécharge le contenu et le transforme en média — le poste ne contacte jamais un domaine externe.',
};

// Catégories de types (CDC_AFFICHAGE_V2.md §4) — pilotent le formulaire.
export const TYPES_LEGACY = ['message', 'image', 'planning', 'compte_a_rebours', 'meteo'];
export const TYPES_GENERATEURS = ['annonces', 'actus', 'tournees', 'social', 'vak_live'];
// Créés uniquement via les boutons dédiés (upload / partage de lien) — jamais
// depuis le sélecteur de type générique, jamais de corps/media_url saisis à la main.
export const TYPES_MEDIA_SERVEUR = ['media', 'lien'];

export const isGenerateurType = (type) => TYPES_GENERATEURS.includes(type);
export const isMediaServeurType = (type) => TYPES_MEDIA_SERVEUR.includes(type);

// Config JSONB simple (champs number) de chaque générateur — clés et bornes
// confirmées côté serveur (routes/badgeuse-device.js `nbConfig`) :
// nb_actus défaut 3 max 10, nb_posts défaut 5 max 20.
export const TYPE_CONTENU_CONFIG_FIELDS = {
  annonces: [],
  actus: [{ key: 'nb_actus', label: 'Nombre de brèves affichées', min: 1, max: 10, default: 3 }],
  tournees: [],
  social: [{ key: 'nb_posts', label: 'Nombre de posts affichés', min: 1, max: 20, default: 5 }],
  vak_live: [],
};

// Longueur maximale d'un gabarit de message (backend `GABARIT_MAX`,
// utils/badgeuse-settings.js) — distincte de la longueur d'une phrase de
// motivation (200 car., cf. plus bas).
export const MESSAGE_GABARIT_MAX = 120;

// Gabarits de messages de badgeage (CDC_AFFICHAGE_V2.md §1) — 7 moments.
export const MOMENTS_BADGEAGE = [
  { key: 'matin', label: 'Matin (entrée)' },
  { key: 'pause', label: 'Pause déjeuner (sortie)' },
  { key: 'retour', label: 'Retour de pause (entrée)' },
  { key: 'soir', label: 'Soir (sortie)' },
  { key: 'premier_jour', label: 'Premier jour' },
  { key: 'anniversaire', label: 'Anniversaire (naissance)' },
  { key: 'anniversaire_entreprise', label: "Anniversaire d'entrée dans la structure" },
];

// Valeurs par défaut affichées tant que le serveur n'a rien enregistré —
// mêmes gabarits que `BADGEUSE_SETTING_DEFAULTS` (utils/badgeuse-settings.js,
// clés `badgeuse.msg_*`) : simple repli d'affichage avant la première lecture.
export const DEFAULT_MESSAGES_BADGEAGE = {
  matin: 'Bonjour, {prenom} !',
  pause: 'Bon appétit, {prenom} !',
  retour: 'Bon après-midi, {prenom} !',
  soir: 'Bonne fin de journée, {prenom} !',
  premier_jour: 'Bienvenue chez Solidarité Textiles, {prenom} !',
  anniversaire: 'Joyeux anniversaire, {prenom} ! 🎉',
  anniversaire_entreprise: '{annees} an(s) avec nous, {prenom} — merci ! 🎉',
};

// Bornes horaires par défaut des moments (clés serveur `badgeuse.moment_*`) —
// SEULEMENT 5 bornes : le début de « retour » n'a pas de clé dédiée, il suit
// directement la fin de la pause (`pause_fin`).
export const DEFAULT_PLAGES_MOMENTS = {
  matin_fin: '11:30',
  pause_debut: '11:00',
  pause_fin: '14:00',
  retour_fin: '15:00',
  soir_debut: '14:00',
};

// Comptes sociaux de référence (settings `badgeuse.social_comptes`, seedés
// INACTIFS — l'identifiant Graph doit être renseigné par un ADMIN, rien n'est
// deviné depuis le nom d'utilisateur).
export const DEFAULT_SOCIAL_COMPTES = [
  { reseau: 'instagram', compte: 'fripandcorouen', graph_id: null, actif: false },
  { reseau: 'instagram', compte: 'vintiz.fr', graph_id: null, actif: false },
  { reseau: 'instagram', compte: 'fripandcostreet', graph_id: null, actif: false },
  { reseau: 'instagram', compte: 'fripandcofamily', graph_id: null, actif: false },
  { reseau: 'facebook', compte: 'fripandcorouen', graph_id: null, actif: false },
  { reseau: 'facebook', compte: 'SolidariteTextiles', graph_id: null, actif: false },
  { reseau: 'facebook', compte: 'vintiz.fr', graph_id: null, actif: false },
];
export const RESEAUX_LABELS = { instagram: 'Instagram', facebook: 'Facebook' };
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

/**
 * Message d'échec d'un TÉLÉVERSEMENT, en français et compréhensible.
 *
 * `apiErr` ne suffit pas ici : quand un intermédiaire réseau refuse un corps de
 * requête trop volumineux, il coupe la connexion pendant que le navigateur
 * émet encore. Axios n'a alors aucune réponse à lire et lève « Network Error »
 * — message que l'exploitant a effectivement vu en voulant ajouter une vidéo,
 * et qui ne lui apprend rien. Même problème avec la page 413 en HTML du proxy :
 * elle n'a pas de champ `error`, et l'utilisateur lisait « Request failed with
 * status code 413 ».
 *
 * @param {Error} err erreur axios
 * @param {number|null} maxMo plafond annoncé par le serveur, si connu
 * @param {number|null} tailleMo taille du fichier envoyé, si connue
 */
export function uploadErr(err, maxMo = null, tailleMo = null) {
  const plafond = Number.isFinite(Number(maxMo)) ? Number(maxMo) : null;
  const trop = plafond != null && Number.isFinite(Number(tailleMo)) && Number(tailleMo) > plafond;
  const limite = plafond != null ? ` (${plafond} Mo maximum)` : '';

  // Réponse applicative exploitable : elle est déjà en français, on la garde.
  const messageServeur = err?.response?.data?.error;
  if (typeof messageServeur === 'string' && messageServeur.trim()) return messageServeur;

  if (err?.response?.status === 413) {
    return `Fichier refusé par le serveur car trop volumineux${limite}. Compressez la vidéo ou raccourcissez-la, puis réessayez.`;
  }
  if (err?.code === 'ECONNABORTED') {
    return "L'envoi a dépassé le délai autorisé. Vérifiez la connexion, ou envoyez un fichier plus léger.";
  }
  // Aucune réponse HTTP : connexion coupée en cours d'envoi. La cause de loin
  // la plus fréquente est le plafond de taille, on le dit sans l'affirmer.
  if (!err?.response) {
    return trop
      ? `L'envoi a été interrompu : le fichier dépasse la limite autorisée${limite}.`
      : `L'envoi a été interrompu avant d'arriver au serveur${limite}. Cela arrive quand le fichier est trop lourd ou que la connexion est instable.`;
  }
  return apiErr(err, "Échec de l'envoi du média.");
}

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

// Poids kg → « 1 245 kg » (écran VAK live) — null-safe, jamais de faux zéro.
export function fmtKg(v) {
  if (v == null || v === '') return '—';
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return `${n.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} kg`;
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
  // Le contrat back-office du module (routes/badgeuse.js) joint le nom déjà
  // formaté sous la clé `nom` — PAS `employee_nom`. Sans ce repli, TOUS les
  // écrans du module (Journal, Feuilles de temps, Anomalies, Badges) tombaient
  // sur la branche de dernier recours et affichaient « Salarié #7 » à la place
  // de « DURAND Amel ». Les variantes préfixées restent lues en premier pour
  // les lignes qui portent plusieurs personnes (auteur, encadrant…).
  const direct = row?.[`${prefix}_nom`] || row?.[`${prefix}_name`]
    || (prefix === 'employee' ? row?.nom : undefined);
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
