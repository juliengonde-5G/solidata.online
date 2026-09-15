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
