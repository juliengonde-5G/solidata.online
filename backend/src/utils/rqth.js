/**
 * Reconnaissance de la qualité de travailleur handicapé (RQTH) lue dans le
 * texte libre « Statut handicap » de l'import paie — règle UNIQUE (lot 2.60.0,
 * correctif M-02 de la revue de sécurité PR E, rapport 32).
 *
 * ═══ POURQUOI UNE LISTE BLANCHE ═══════════════════════════════════════════
 *
 * `employees.disability_status` est la colonne « Statut handicap » du classeur
 * Malibou (`services/collaborator-import.js`) : un TEXTE LIBRE, saisi par la
 * paie, sans liste fermée. Trois surfaces le lisaient comme une présence —
 * « tout texte non vide vaut RQTH » (tableau des freins, typologies du
 * pilotage) ou « tout texte qui n'est pas exactement "non" vaut RQTH » (le
 * document Convergence). Les deux règles comptaient comme reconnaissance de
 * handicap « Non concerné », « Non reconnu », « Pas de RQTH », « En cours »,
 * « Demande en cours », « Aucun handicap » — une donnée de SANTÉ (art. 9)
 * inventée, puis transmise à un tiers et PROPOSÉE à la CIP comme situation de
 * sortie.
 *
 * La règle s'inverse : seul un libellé qui DIT une reconnaissance compte
 * (« RQTH », « RQTH 2024 », « RQTH renouvelée », « Travailleur handicapé »,
 * « TH », « Reconnu », « Oui », « BOETH »…). Toute négation, toute démarche en
 * cours, tout texte inconnu rend `null` — INCONNU : ni compté, ni proposé.
 * On n'invente jamais une reconnaissance que le texte ne dit pas ; le prix est
 * une sous-estimation quand la paie écrit une forme que la liste ne connaît
 * pas, et c'est le bon côté de l'erreur pour une donnée d'art. 9 (la RQTH
 * saisie au diagnostic ou le critère d'éligibilité, eux, restent lus en
 * priorité par les appelants).
 */

'use strict';

/** Normalise : minuscules, sans accents, espaces réduits. */
function normaliser(texte) {
  return String(texte)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Négations et démarches inachevées : dès qu'un de ces marqueurs figure dans
 * le texte, la reconnaissance n'est PAS acquise (« Non reconnu », « NON RQTH »,
 * « Pas de RQTH », « RQTH en cours », « Demande en attente », « Refusée »,
 * « RQTH expirée »…).
 */
const NEGATION = /(^|[^a-z])(non|pas|aucun|aucune|sans|none|false|n\/a|nr|en cours|demande|attente|refus|refusee?|expiree?|echue?|a renouveler|instruction)([^a-z]|$)/;

/** Libellés qui DISENT une reconnaissance (début du texte). */
const RECONNAISSANCE = /^(oui|yes|vrai|true|rqth|th|travailleu(r|se)s? handicape(e)?s?|reconnu(e)?|reconnaissance|boeth|oeth|beneficiaire de l'?obligation d'?emploi)([^a-z]|$)/;

/**
 * @param {string|null|undefined} texte valeur de `disability_status`
 * @returns {true|null} `true` si le texte dit une reconnaissance ; `null` sinon
 *   (inconnu — jamais `false` : un texte libre ne prouve pas une absence)
 */
function rqthDepuisStatutHandicap(texte) {
  if (texte == null) return null;
  const t = normaliser(texte);
  if (t === '' || t === '-' || t === '0') return null;
  if (NEGATION.test(t)) return null;
  return RECONNAISSANCE.test(t) ? true : null;
}

module.exports = { rqthDepuisStatutHandicap };
