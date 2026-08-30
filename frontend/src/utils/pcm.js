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
 * NOTICE D'INFORMATION PRÉALABLE (2.45.0) — affichée AVANT la première question.
 *
 * POURQUOI ELLE EXISTE. Le client a écarté la recommandation de déplacer la
 * passation après l'embauche (audit PCM §6.3 a) : le test reste dans le
 * parcours de recrutement. En contrepartie, l'information de la personne
 * devient une obligation tenue par le logiciel et non par l'usage. L'écran de
 * passation ne disait ni la finalité, ni les destinataires, ni la durée de
 * conservation, ni les droits (audit, défaut D6) — deux phrases rassurantes
 * (« pas de bonne ou mauvaise réponse », « vos réponses restent
 * confidentielles ») en tenaient lieu.
 *
 * COMMENT ELLE EST ÉCRITE. En FALC : phrases courtes, une idée par phrase,
 * mots du quotidien, pas de sigle non expliqué, pas de tournure impersonnelle.
 * Le public de la structure est éloigné de l'écrit ; une notice juridiquement
 * complète mais illisible n'informe personne, et l'audit relève que
 * l'illettrisme concerne une part réelle des personnes accompagnées.
 *
 * CE QU'ELLE NE FAIT PAS : elle ne recueille pas un consentement. La base
 * légale déclarée au registre est l'intérêt légitime ; ce que la personne
 * confirme, c'est d'avoir LU. Le texte ne promet donc pas de « donner son
 * accord » — il dit ce qui est fait, et ce qu'elle peut demander.
 *
 * Structure exploitée telle quelle par l'écran (une carte par bloc). La mention
 * de méthode n'y est PAS recopiée : elle vit dans PCM_MENTION_METHODE et
 * l'écran l'affiche à côté — une mise en garde en double exemplaire finit par
 * diverger.
 */
export const PCM_NOTICE_INFORMATION = {
  titre: 'Avant de commencer, quelques informations',
  chapeau: 'Prenez le temps de lire. Si une phrase n’est pas claire, demandez à la personne qui vous a envoyé ce lien.',
  blocs: [
    {
      cle: 'finalite',
      titre: 'À quoi sert ce questionnaire',
      points: [
        'Il aide à mieux se parler : la façon dont vous aimez qu’on s’adresse à vous, ce qui vous met à l’aise au travail.',
        'Il sert de point de départ à une discussion avec vous.',
      ],
    },
    {
      cle: 'hors_finalite',
      titre: 'À quoi il ne sert pas',
      points: [
        'Ce n’est pas un examen. Il n’y a pas de bonne ni de mauvaise réponse.',
        'Ce n’est pas un test médical. Il ne dit rien de votre santé.',
        'Il ne sert pas à choisir qui est embauché. Le résultat ne décide de rien.',
      ],
    },
    {
      cle: 'destinataires',
      titre: 'Qui voit le résultat',
      points: [
        'Les personnes des ressources humaines, et la personne qui vous accompagnera si vous êtes embauché.',
        'Le résultat ne va pas à votre futur chef d’équipe.',
        'Il n’est jamais envoyé à quelqu’un en dehors de la structure.',
      ],
    },
    {
      cle: 'conservation',
      titre: 'Combien de temps c’est gardé',
      points: [
        'Vos réponses aux 20 questions sont effacées 30 jours après le test. Cela vaut pour tout le monde.',
        'Si vous n’êtes pas embauché, tout le test est effacé 90 jours après le test.',
        'Si vous êtes embauché, le résultat est gardé dans votre dossier, et effacé avec lui.',
      ],
    },
    {
      cle: 'droits',
      titre: 'Vos droits',
      points: [
        'Vous pouvez demander à voir ce qui est écrit sur vous.',
        'Vous pouvez demander à le corriger, ou à le faire effacer.',
        'À la fin du test, vous pouvez imprimer votre résultat pour le garder.',
        'Pour cela, parlez-en à la personne qui vous a envoyé ce lien.',
      ],
    },
  ],
  /** Case à cocher — la formulation dit « lu », pas « j'accepte ». */
  confirmation: 'J’ai lu ces informations.',
  /** Texte du refus, à afficher SANS reproche : ne pas répondre est un droit. */
  refus: {
    titre: 'Vous pouvez ne pas répondre',
    corps: 'Vous n’êtes pas obligé de faire ce questionnaire. Fermez simplement cette page. '
      + 'Prévenez la personne qui vous a envoyé le lien : elle prendra le relais. '
      + 'Cela ne vous sera pas reproché.',
  },
};

/**
 * Les mêmes informations, en une phrase suivie, pour les documents qui se lisent
 * SEULS — le résultat que le candidat emporte (frontend/src/utils/pcm-pdf.js).
 *
 * DÉRIVÉES de la notice ci-dessus, jamais recopiées : c'est le seul moyen qu'un
 * délai modifié à un endroit ne laisse pas l'autre annoncer l'ancien. La clé de
 * bloc (`cle`) sert d'ancrage plutôt que le titre français, qu'une relecture de
 * confort pourrait reformuler sans savoir qu'il est load-bearing.
 */
function joindreBloc(cle) {
  const bloc = PCM_NOTICE_INFORMATION.blocs.find((b) => b.cle === cle);
  return bloc ? bloc.points.join(' ') : '';
}

export const PCM_MENTION_CONSERVATION = joindreBloc('conservation');
export const PCM_MENTION_DROITS = joindreBloc('droits');

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
