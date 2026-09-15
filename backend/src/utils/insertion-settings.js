/**
 * Lecture des réglages du module Insertion (extension 2026-07 PR1).
 * Aucune valeur métier en dur dans le code (plan 05 §0.3) : tout passe par la
 * table `settings` (préfixe insertion.*) avec des DÉFAUTS documentés ici.
 *
 * Clés :
 *  - insertion.objectif_sorties_dynamiques : % cible DREETS (existant, géré
 *    par routes.js /objectif-sorties) ;
 *  - insertion.delai_diagnostic_jours      : délai cible du diagnostic
 *    d'accueil après l'embauche (défaut 30 — arbitrage j du rapport 11) ;
 *  - insertion.alerte_pass_iae_mois        : 1er seuil d'alerte avant la fin
 *    du Pass IAE, en mois (défaut 7 ; le 2e seuil est fixé à 2 mois) ;
 *  - insertion.ia_preparation_auto         : génération automatique de la note
 *    de préparation IA à J-7 d'un entretien planifié (défaut 'false') ;
 *  - insertion.echeance_action_defaut_jours : échéance proposée par défaut à
 *    la création d'une action CIP, en jours (défaut 14 — REC-UX-18) ;
 *  - insertion.rythme_bilans_mois          : rythme usuel des bilans, en mois —
 *    sert à proposer la date du prochain entretien à la clôture (défaut 2 —
 *    REC-UX-18) ;
 *  - insertion.renouvellement_anticipation_jours : fenêtre d'anticipation des
 *    renouvellements de CDDI (GET /insertion/renouvellements — défaut 42 j =
 *    6 semaines, EXG-04 / PR 2) ;
 *  - insertion.retention_months            : rétention RGPD des dossiers
 *    d'insertion sortis avant anonymisation (défaut 24 mois après la fin du
 *    parcours + dernier contact — référentiel CNIL 2023, EXG-40 / PR 2) ;
 *  - insertion.post_sortie_mois            : délai du suivi post-sortie, en
 *    mois après le bilan de sortie (défaut 6). Le +3 mois historique était un
 *    choix d'outil : l'indicateur de RÉSULTAT que l'autorité et le FSE+
 *    mesurent se relève à +6 mois — un jalon posé à +3 ne documente rien de ce
 *    qui est demandé (plan 07 § 3, lot 0.3) ;
 *  - insertion.alerte_sortie_fse_j1        : 1er seuil d'alerte « sortie FSE+
 *    non renseignée », en jours après la fin du contrat (défaut 15) ;
 *  - insertion.alerte_sortie_fse_j2        : 2e seuil, plus pressant (défaut
 *    25). Les deux bornent la fenêtre où la donnée de sortie est encore
 *    recueillable auprès de la personne : passé ce délai elle ne se rattrape
 *    pas, d'où deux rappels et non un seul ;
 *  - insertion.cer_heures_min / _max        : fourchette d'activité hebdo
 *    attendue d'un bénéficiaire du RSA (défauts 15 et 20 — le plafond est
 *    informatif, il ne déclenche jamais d'alerte) ;
 *  - insertion.semaines_sous_seuil_consecutives : nombre de semaines
 *    consécutives sous le plancher qui déclenchent l'alerte (défaut 2) ;
 *  - insertion.point_etape_referent_mois    : périodicité attendue d'un point
 *    avec le référent unique ou d'une fiche remise (défaut 3 mois) ;
 *  - insertion.feuille_temps_cloture_jour   : jour du mois suivant à partir
 *    duquel une feuille de temps non validée est signalée (défaut 10) ;
 *  - insertion.duree_entretien_defaut      : durée PROPOSÉE à la clôture d'un
 *    entretien, en minutes, par type technique (JSON). C'est une proposition
 *    ajustable, jamais une durée imposée : l'agrégat d'heures d'accompagnement
 *    (indicateur B5) doit refléter le temps réellement passé.
 * Les clés sont exposées au frontend par GET /api/insertion/parametres
 * (à l'exception des clés de purge/scheduler, consommées côté serveur).
 *
 * Cibles conventionnelles (EXG-47/D12, PR 2) — clés insertion.cible_* et
 * insertion.effectif_reference : NULLABLES SANS DÉFAUT (null = « objectif non
 * paramétré », jamais de valeur inventée) ; gérées par GET/PUT
 * /api/insertion/cibles (routes.js), donc absentes du dictionnaire ci-dessous.
 */
const pool = require('../config/database');

const INSERTION_SETTING_DEFAULTS = {
  'insertion.delai_diagnostic_jours': 30,
  'insertion.alerte_pass_iae_mois': 7,
  'insertion.ia_preparation_auto': false,
  'insertion.echeance_action_defaut_jours': 14,
  'insertion.rythme_bilans_mois': 2,
  'insertion.renouvellement_anticipation_jours': 42,
  'insertion.retention_months': 24,
  // Lot 8 (PR3) — durée de la période d'essai en jours (échéance de l'entretien
  // de période d'essai créé à la liaison candidat→collaborateur, EXG-30). Lue
  // côté serveur (conversion.js), non exposée par GET /insertion/parametres.
  'insertion.periode_essai_jours': 30,
  // 2.43.0 — note de profil initial CIP : génération AUTOMATIQUE à la liaison
  // candidat→collaborateur. Défaut TRUE (demande client : l'analyse doit être
  // SYSTÉMATIQUE, pas à la demande) — contrairement à ia_preparation_auto qui
  // reste opt-in. Sans ANTHROPIC_API_KEY le déclencheur est un no-op silencieux.
  'insertion.note_profil_auto': true,
  // PR A lot 0 — suivi post-sortie porté de +3 à +6 mois (décision de la
  // direction, plan 07 § 3). Borné 1-12 à la lecture : une valeur aberrante en
  // base ne doit pas poser un jalon à une date absurde dans le dossier.
  'insertion.post_sortie_mois': 6,
  // PR A lot 0 — alertes « sortie FSE+ non renseignée » (job du lot 2).
  'insertion.alerte_sortie_fse_j1': 15,
  'insertion.alerte_sortie_fse_j2': 25,
  // ── PR B (2.53.0) — cadre RSA et temps d'accompagnement ──────────────────
  //
  // `cer_heures_min` / `cer_heures_max` : la fourchette d'activité hebdomadaire
  // attendue d'un bénéficiaire du RSA (loi pour le plein emploi). Le PLANCHER
  // sert d'indicateur ; le PLAFOND est informatif et ne déclenche JAMAIS
  // d'alerte — dépasser 20 h en CDDI n'est pas un manquement, c'est un contrat
  // de travail. Paramétrables parce que la fourchette est fixée par convention
  // départementale et peut différer d'un territoire à l'autre.
  'insertion.cer_heures_min': 15,
  'insertion.cer_heures_max': 20,
  // Nombre de semaines CONSÉCUTIVES sous le plancher qui déclenchent l'alerte.
  // Deux, et non une : une semaine basse arrive (un pont, une semaine de
  // reprise, un mois de paie importé à moitié). Alerter dès la première
  // fabriquerait un signal que plus personne ne regarderait.
  'insertion.semaines_sous_seuil_consecutives': 2,
  // Périodicité attendue d'un contact avec le référent unique — un « Point avec
  // le référent » tenu OU une fiche effectivement remise. Les deux valent
  // alimentation : ne compter que les entretiens ferait apparaître « jamais de
  // point » sur un dossier où une fiche part chaque trimestre.
  'insertion.point_etape_referent_mois': 3,
  // Jour du mois suivant à partir duquel une feuille de temps non validée est
  // signalée (lot 4). Ce n'est pas une date limite opposable à l'intervenant :
  // c'est le moment où le retard devient visible dans l'écran.
  'insertion.feuille_temps_cloture_jour': 10,
  // ── PR C lot 5 — section CIP ──
  // Validité du lien public remis à l'encadrant technique (amendement CIP :
  // 60 j, le bloc « renouvellements » anticipe à 42 j — le lien doit survivre
  // à l'entretien qu'il prépare, pas indéfiniment).
  'insertion.eti_token_validite_jours': 60,
  // Durée d'un report d'obligation (« À traiter cette semaine ») : 48 h, motif
  // obligatoire au 2e report — jamais un acquittement 7 j, ce sont les lignes
  // que l'autorité contrôle.
  'insertion.report_echeance_heures': 48,
  // Un parcours terminé reste dans la file active tant que la sortie FSE+ et le
  // relevé à 6 mois peuvent être dus (6 mois + 1 de marge).
  'insertion.file_active_terminees_mois': 7,
  // Catégorie France Travail « G » (en attente d'orientation) depuis plus de N
  // jours → ligne ORANGE (jamais rouge : seul le référent peut la changer).
  'insertion.categorie_g_alerte_jours': 30,
  // ── PR C lot 7 — le salarié ──
  // Heure de Paris de l'envoi des rappels de rendez-vous J-1 (SMS / e-mail
  // Brevo, sur consentement tracé). Le tick horaire du scheduler compare
  // l'heure MURALE de Paris à cette valeur (DST géré), jamais getHours().
  'insertion.rappel_rdv_heure_envoi': 18,
  // Rétention de la trace des rappels envoyés (destinataire masqué) — purge
  // `purgeRappelsRdv` du registre PURGES_RGPD. Le lot 7 le disait lui-même :
  // rien n'exige de garder un an la preuve qu'un SMS de rappel est parti. La
  // valeur est ramenée à 90 jours — de quoi traiter une réclamation — au titre
  // de la minimisation (point 4 des arbitrages de la revue de sécurité) ; la
  // direction peut la relever dans `settings` si elle le décide.
  'insertion.rappels_retention_jours': 90,
  // ── PR D lot 6 — reporting autorité ──
  // Année pour laquelle la synthèse de dialogue de gestion imprime les DEUX
  // méthodes de dénominateur des sorties côte à côte (décision 9 : la
  // méthode historique « bilans classés seuls » et la méthode « toutes les fins
  // de parcours »). Hors de cette année, seule la seconde est produite.
  'insertion.sorties_methode_double_annee': 2026,
  // Effectif sous lequel un agrégat de la synthèse n'est pas rendu (k-anonymat,
  // même seuil que les enquêtes) : un document qui sort de la structure ne doit
  // pas permettre de reconnaître une personne par recoupement.
  'insertion.k_anonymat_min': 5,
  // Base unique des documents de conventionnement (repli si l'annexe financière
  // `effectifs.convention_<annee>` ne porte pas d'heures annuelles par ETP).
  'insertion.heures_annuelles_etp': 1820,
  // « Mon Récap » est fait pour CIRCULER (la personne peut le remettre à un
  // employeur). Deux libellés y disaient plus que ce que la personne croit
  // partager : « Entretien de conciliation (protection des droits) » — la
  // procédure contradictoire qui précède une décision RSA défavorable — et
  // « Point avec le référent ». Ils sont regroupés sous « Entretien
  // d'accompagnement », et la raison sociale de l'entreprise d'accueil d'une
  // PMSMP (un ESAT, un établissement de soins) n'est pas imprimée.
  // Réglage RÉVERSIBLE : la direction peut rétablir le détail en posant
  // `insertion.recap_neutralise` à `false` (arbitrage M-10, revue de sécurité).
  'insertion.recap_neutralise': true,
  // PR A lot 0 — durées d'entretien proposées par type technique (minutes).
  // Défaut d'objet : la lecture accepte une surcharge en JSON dans `settings`
  // et retombe sur ce défaut si le JSON est illisible (jamais un objet vide,
  // qui ferait disparaître toute proposition de l'écran de clôture).
  'insertion.duree_entretien_defaut': {
    diagnostic_accueil: 90,
    bilan_intermediaire: 45,
    periode_essai: 30,
    renouvellement: 30,
    bilan_sortie: 60,
    suivi_post_sortie: 15,
    // PR B lot 3 — un point avec le référent se tient rarement en moins d'une
    // heure (trois agendas à faire coïncider) ; une conciliation est plus
    // courte, mais jamais expédiée.
    point_etape_referent: 60,
    conciliation: 45,
  },
};

/**
 * Lit une clé insertion.* avec son défaut. Résilient : toute erreur (table
 * absente, valeur invalide) retombe sur le défaut.
 * @param {string} key clé complète (ex. 'insertion.delai_diagnostic_jours')
 * @returns {Promise<number|boolean|string|null>}
 */
async function readInsertionSetting(key) {
  const def = INSERTION_SETTING_DEFAULTS[key] ?? null;
  try {
    const r = await pool.query('SELECT value FROM settings WHERE key = $1', [key]);
    const v = r.rows[0]?.value;
    if (v == null || v === '') return def;
    if (typeof def === 'number') {
      const n = parseFloat(v);
      return Number.isNaN(n) ? def : n;
    }
    if (typeof def === 'boolean') {
      return ['true', '1', 'oui', 'yes'].includes(String(v).trim().toLowerCase());
    }
    // Défaut OBJET (ex. insertion.duree_entretien_defaut) : la valeur est
    // stockée en JSON. Un JSON illisible retombe sur le défaut plutôt que de
    // remonter une chaîne que l'appelant traiterait comme un objet.
    if (def && typeof def === 'object') {
      if (typeof v === 'object') return v;
      try {
        const parsed = JSON.parse(v);
        return parsed && typeof parsed === 'object' ? parsed : def;
      } catch (_) { return def; }
    }
    return v;
  } catch (_) {
    return def;
  }
}

/**
 * Délai du suivi post-sortie, en mois, BORNÉ à [1 ; 12].
 *
 * Le bornage vit ici, à côté du défaut, plutôt que chez chaque appelant : une
 * valeur aberrante saisie en base (0, -3, 240) poserait sinon un jalon à une
 * date absurde dans le dossier d'un salarié — et un jalon daté n'est pas une
 * statistique qu'on corrige après coup, c'est un rendez-vous qu'on manque.
 * Hors bornes ou illisible → le défaut (6), jamais une valeur inventée.
 * @returns {Promise<number>} entier de 1 à 12
 */
async function readPostSortieMois() {
  const def = INSERTION_SETTING_DEFAULTS['insertion.post_sortie_mois'];
  const v = await readInsertionSetting('insertion.post_sortie_mois');
  const n = Math.round(Number(v));
  if (!Number.isFinite(n) || n < 1 || n > 12) return def;
  return n;
}

module.exports = { readInsertionSetting, readPostSortieMois, INSERTION_SETTING_DEFAULTS };
