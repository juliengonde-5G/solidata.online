/**
 * Libellés et code couleur des bordereaux de collecte en déchèterie —
 * SOURCE UNIQUE (même doctrine que utils/tours.js et utils/incidents.js).
 *
 * `tour_decheterie_bordereaux.statut` est contraint en base à deux valeurs
 * techniques (cf. init-db.js : a_valider, valide). Elles ne doivent jamais
 * atteindre l'écran telles quelles.
 */

/** Doit couvrir le CHECK de `tour_decheterie_bordereaux.statut`. */
export const BORDEREAU_STATUT_META = {
  a_valider: {
    label: 'À valider',
    classe: 'bg-amber-100 text-amber-800 font-semibold',
  },
  valide: {
    label: 'Validé',
    classe: 'bg-emerald-100 text-emerald-700 font-semibold',
  },
};

/**
 * Repli sur la valeur brute plutôt que sur un tiret : si un statut inconnu
 * apparaît un jour, mieux vaut le voir en clair qu'un « — » qu'on lirait
 * comme une donnée absente.
 */
export const libelleStatutBordereau = (statut) => BORDEREAU_STATUT_META[statut]?.label || statut || '—';

/** Classes du badge. Un statut inconnu reste lisible, en gris neutre. */
export const classeStatutBordereau = (statut) =>
  BORDEREAU_STATUT_META[statut]?.classe || 'bg-slate-100 text-slate-600';

/**
 * Motifs d'absence de signature (liste fermée, cf. contrat backend §2.1 et
 * §2.5) — `signature_agent_absente_motif` / `signature_chauffeur_absente_motif`.
 */
export const MOTIF_SIGNATURE_ABSENTE_LABELS = {
  agent_indisponible: 'Agent de déchèterie indisponible',
  anonymisation: 'Signature retirée (anonymisation)',
};

export const libelleMotifSignatureAbsente = (motif) =>
  MOTIF_SIGNATURE_ABSENTE_LABELS[motif] || motif || null;
