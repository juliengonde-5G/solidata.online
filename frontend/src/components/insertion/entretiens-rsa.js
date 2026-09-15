/**
 * Types d'entretien du cadre RSA — PR B, lot 3.
 *
 * Deux types s'ajoutent aux six existants, et ils traduisent la position de la
 * structure : Solidarité Textiles est **structure d'accueil**, pas référent
 * unique (décision de direction du 12/09/2026).
 *
 *  - « Point avec le référent » : le dialogue avec le professionnel EXTÉRIEUR
 *    qui tient le contrat d'engagements réciproques. Il avait lieu — par
 *    téléphone, dans un couloir — et ne laissait aucune trace. Sa MODALITÉ est
 *    la donnée qui compte : *tripartite* veut dire que la personne était là,
 *    *bilatérale* que deux professionnels ont parlé d'elle sans elle. C'est
 *    cette distinction que l'autorité regarde quand elle demande si la personne
 *    est associée à son propre suivi.
 *
 *  - « Entretien de conciliation (protection des droits) » : la réforme du RSA
 *    ouvre un droit de contestation avant sanction. Le formulaire COMMENCE par
 *    les MOTIFS LÉGITIMES (08 § 10) — la question posée est « qu'est-ce qui
 *    vous en a empêché ? », jamais « pourquoi n'avez-vous pas obéi ? ».
 *
 * Pourquoi ce fichier plutôt qu'un ajout à `freins.js` : ce dernier n'est pas
 * dans le périmètre du lot 3 (contrat 15 § 1). Les six libellés historiques
 * restent servis par `ENTRETIEN_TYPE_LABELS` ; ce module ne fait que l'étendre.
 */

import { ENTRETIEN_TYPE_LABELS } from './freins';

/** Codes des deux types ajoutés par la PR B. */
export const TYPES_RSA = ['point_etape_referent', 'conciliation'];

/** Libellés français des 8 types — source unique pour l'écran de la CIP. */
export const TYPE_LABELS_RSA = {
  ...ENTRETIEN_TYPE_LABELS,
  point_etape_referent: 'Point avec le référent',
  conciliation: 'Entretien de conciliation (protection des droits)',
};

/** Libellé d'un entretien : titre saisi > libellé du type > code brut. */
export function libelleEntretienRsa(ms) {
  if (!ms) return '';
  return ms.titre || TYPE_LABELS_RSA[ms.milestone_type] || ms.milestone_type;
}

/**
 * Modalité du point avec le référent. Le libellé dit ce que la modalité
 * SIGNIFIE et non son seul nom : « tripartite » ne parle qu'aux initiés.
 */
export const REFERENT_MODALITES = [
  { value: 'tripartite', label: 'Tripartite — la personne est présente' },
  { value: 'bilaterale', label: 'Bilatérale — entre professionnels' },
];

/**
 * Motifs LÉGITIMES d'une conciliation — liste fermée, miroir du serveur
 * (`routes/insertion/routes.js` et la migration). Aucun n'est médical :
 * « Un problème de santé » ne dit rien d'un état de santé, et c'est le but.
 */
export const CONCILIATION_MOTIFS = [
  { value: 'sante', label: 'Un problème de santé' },
  { value: 'garde_enfant', label: 'Une garde d’enfant' },
  { value: 'transport', label: 'Un problème de transport' },
  { value: 'demarche_administrative', label: 'Une démarche administrative' },
  { value: 'formation_emploi', label: 'Une formation ou une démarche d’emploi' },
  { value: 'deuil_famille', label: 'Un deuil ou un événement familial' },
  { value: 'autre', label: 'Autre motif' },
];

/** Issues possibles d'une conciliation. */
export const CONCILIATION_ISSUES = [
  { value: 'maintien', label: 'Maintien du parcours en l’état' },
  { value: 'reprise', label: 'Reprise avec aménagement' },
  { value: 'orientation', label: 'Réorientation vers un autre accompagnement' },
  { value: 'sans_suite', label: 'Sans suite' },
];

export const MODALITE_LABELS = Object.fromEntries(REFERENT_MODALITES.map((m) => [m.value, m.label]));
export const MOTIF_LABELS = Object.fromEntries(CONCILIATION_MOTIFS.map((m) => [m.value, m.label]));
export const ISSUE_LABELS = Object.fromEntries(CONCILIATION_ISSUES.map((m) => [m.value, m.label]));

/** Moments auxquels une fiche pour le référent est produite. */
export const MOMENTS_FICHE = [
  { value: 'entree', label: 'Entrée en parcours' },
  { value: 'renouvellement', label: 'Renouvellement de contrat' },
  { value: 'sortie', label: 'Sortie de parcours' },
  { value: 'demande', label: 'À la demande du référent' },
];

/** Modes de remise d'une fiche au référent. */
export const MODES_REMISE = [
  { value: 'mail', label: 'Courriel' },
  { value: 'courrier', label: 'Courrier' },
  { value: 'main_propre', label: 'En main propre' },
  { value: 'plateforme', label: 'Dépôt sur une plateforme' },
];

export const MOMENT_LABELS = Object.fromEntries(MOMENTS_FICHE.map((m) => [m.value, m.label]));
export const MODE_REMISE_LABELS = Object.fromEntries(MODES_REMISE.map((m) => [m.value, m.label]));

/** Libellés des types de référent unique (destinataire d'une fiche). */
export const DESTINATAIRE_LABELS = {
  cms: 'CMS (Département)',
  france_travail: 'France Travail',
  structure: 'Solidarité Textiles (structure)',
  autre: 'Autre organisme',
  non_determine: 'Non déterminé',
};
