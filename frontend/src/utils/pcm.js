/**
 * Mentions et libellés du module PCM — SOURCE UNIQUE.
 *
 * Le test de personnalité s'affiche sur QUATRE surfaces qui ne se parlaient
 * pas : la fiche praticien (/pcm) et ses deux exports PDF, l'écran de passation
 * du candidat, l'onglet PCM de la fiche collaborateur et celui du dossier
 * candidat. C'est exactement la configuration qui a produit les divergences de
 * libellés corrigées ailleurs par un module partagé (utils/incidents.js en
 * 2.39.0, utils/tours.js en 2.41.0) — d'où ce fichier plutôt que six copies.
 *
 * Il porte les deux corrections de fond de l'audit du module PCM (2.43.0,
 * rapports/pcm-insertion-2026-08-29/01-audit-module-pcm.md, recommandations
 * R1 à R3). Ce sont des mentions de MÉTHODE : elles doivent être identiques
 * partout, y compris sur les PDF — qui sont précisément les documents qui
 * circulent hors de l'application.
 */

/**
 * R2 — encart de méthode.
 *
 * L'outil affirmait plus qu'il ne mesure : 20 items transparents, non validés,
 * auto-administrés sans surveillance, dont 7 seulement décident du type de
 * base. Aucune mise en garde n'existait — ni à l'écran candidat, ni sur la
 * fiche profil, ni dans les deux PDF exportés. Le parcours de formation de
 * référence, lui, place l'avertissement AVANT l'exercice.
 *
 * Texte unique, à afficher tel quel (pas de reformulation par surface : une
 * mise en garde qui varie d'un écran à l'autre cesse d'en être une).
 */
export const PCM_MENTION_METHODE =
  'Questionnaire interne d’aide au dialogue (20 questions), inspiré du modèle '
  + 'Process Communication. Il ne s’agit pas de l’inventaire de personnalité validé '
  + 'et propriétaire du modèle. Ce résultat est une hypothèse de lecture, pas un '
  + 'diagnostic ni une mesure validée : il ne doit jamais fonder seul une décision '
  + 'de recrutement ou d’orientation.';

/**
 * R1 — remplacement de l'« Alerte Risques Psychosociaux ».
 *
 * L'indicateur `pcm_reports.risk_alert` ne mesure pas une détresse : il vérifie
 * que les 3 réponses de la catégorie « stress » désignent le type de Phase —
 * or ces mêmes réponses pèsent 12 des 34,5 points qui DÉTERMINENT cette Phase.
 * Le test est circulaire, et l'audit a mesuré 32 % de déclenchements sur
 * 20 000 jeux de réponses aléatoires (et, à l'inverse, aucun déclenchement pour
 * un répondant parfaitement cohérent qui saute deux questions).
 *
 * Il était affiché en rouge, sous le libellé « Alerte Risques Psychosociaux »,
 * dans un dossier de recrutement — un qualificatif de santé apposé à un
 * candidat sur la foi d'un artefact. On garde l'information (elle dit quelque
 * chose de la façon de répondre) en la nommant pour ce qu'elle est, et on la
 * présente comme une information de lecture : ton informatif, jamais l'alarme.
 *
 * Le calcul et la colonne en base sont INCHANGÉS — refonder l'indicateur est un
 * chantier distinct, ouvert au rapport d'audit.
 */
export const PCM_LIBELLE_COHERENCE = 'Réponses « stress » très cohérentes avec la phase';

/** Court, pour les colonnes de tableau (le libellé complet ne tient pas). */
export const PCM_LIBELLE_COHERENCE_COURT = 'Réponses très cohérentes';

/** Accompagne SYSTÉMATIQUEMENT le libellé ci-dessus. Sans elle, il se relit comme une alerte. */
export const PCM_MENTION_COHERENCE =
  'Cet indicateur reflète la cohérence des réponses, pas un état de santé. '
  + 'Il ne doit fonder aucune décision.';

/**
 * R3 — « Fiabilité » n'est pas une fiabilité.
 *
 * La valeur affichée est l'écart relatif entre le 1ᵉʳ et le 2ᵉ type
 * ((top − second) / top × 100) : ni une consistance interne, ni une erreur de
 * mesure. L'appeler « fiabilité » laissait croire à une garantie de justesse —
 * d'autant qu'avec une base plafonnée à 23 points, 1 point d'écart suffit à
 * dépasser le seuil d'indétermination de 8 %.
 */
export const PCM_LIBELLE_ECART = 'Écart avec le 2e type';

/** Badge posé quand l'écart au 2ᵉ type est sous le seuil : le profil ne tranche pas. */
export const PCM_BADGE_PEU_MARQUE = 'Profil peu marqué';

/**
 * D7 — pourquoi il n'y a pas de profil à l'écran.
 *
 * Les deux onglets PCM (fiche collaborateur, dossier candidat) chargeaient le
 * profil avec `.catch(() => setPcmProfile(null))` et affichaient ensuite
 * « Aucun profil PCM enregistré ». Trois situations très différentes se
 * retrouvaient donc sous la même phrase :
 *   - un MANAGER, habilité sur /employees mais pas sur /pcm, recevait un 403 ;
 *   - un rapport illisible renvoyait un 422 PCM_ILLISIBLE, pourtant conçu côté
 *     serveur avec un message explicite et une marche à suivre ;
 *   - et seul le troisième cas était une vraie absence.
 *
 * Affirmer une absence qu'on n'a pas constatée est précisément ce que
 * `masking.js` s'interdit côté serveur (« l'absence de la clé signale non
 * habilité, ≠ non renseigné »). Cette fonction rend l'erreur à sa cause.
 *
 * @returns {null|{ton:'info'|'alerte', message:string}} `null` = absence RÉELLE
 *          (404, ou aucune fiche de recrutement liée) : l'appelant affiche son
 *          message « aucun profil » habituel.
 */
export function motifProfilPcmIndisponible(err) {
  const st = err?.response?.status;
  const d = err?.response?.data;

  if (st === 403) {
    return { ton: 'info', message: "Vous n'êtes pas habilité à consulter le profil PCM." };
  }
  if (st === 422 && d?.code === 'PCM_ILLISIBLE') {
    // Message SERVEUR : il porte le diagnostic (clé retirée, réponses perdues)
    // et la marche à suivre. Le reformuler ici le priverait des deux.
    return {
      ton: 'alerte',
      message: [d.error, d.detail, d.hint && `(${d.hint})`].filter(Boolean).join(' — '),
    };
  }
  if (st === 404) return null; // il n'y a réellement pas de profil

  // Panne réseau, 500, ou toute réponse qu'on ne sait pas lire : on NE DIT PAS
  // « aucun profil ». Rien ne permet de l'affirmer, et c'est le défaut qu'on
  // corrige. On dit ce qu'on sait : le chargement a échoué.
  return {
    ton: 'alerte',
    message: `Le profil PCM n'a pas pu être chargé (${st || 'réseau'}). Réessayez ; s'il persiste, signalez-le.`,
  };
}

/**
 * Échappement HTML pour les fenêtres d'impression (les PDF sont composés par
 * concaténation de chaînes, sans React pour échapper à notre place).
 */
export function echapperHtml(texte) {
  return String(texte == null ? '' : texte)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
