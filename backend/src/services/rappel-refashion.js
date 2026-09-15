/**
 * RAPPEL : CE QUI CHANGE ICI DOIT AUSSI CHANGER SUR L'EXTRANET REFASHION.
 * ═══════════════════════════════════════════════════════════════════════════
 * Demande client du 10/09/2026 : « à chaque modification d'un DPAV ou d'une
 * association, mettre une notification pour s'assurer que ces modifications ont
 * aussi été répercutées sur l'extranet Refashion ».
 *
 * LE PROBLÈME EST RÉEL ET N'EST PAS TECHNIQUE : Refashion n'expose aucune API
 * (la déclaration reste manuelle, cf. CLAUDE.md §10). SOLIDATA ne PEUT donc pas
 * synchroniser ; il peut seulement empêcher l'oubli. Une déclaration DPAV qui
 * diverge du réel, ou un point d'apport ajouté chez nous et jamais déclaré,
 * c'est une subvention calculée sur une base fausse — et cela ne se voit qu'à
 * l'audit, des mois plus tard.
 *
 * DEUX CANAUX, ET C'EST VOULU :
 *   1. À L'ÉCRAN, tout de suite : la personne qui vient d'enregistrer est la
 *      seule qui puisse aller sur l'extranet dans la minute. C'est le front qui
 *      le fait (il connaît le geste), pas ce module.
 *   2. DANS LA MESSAGERIE, ici : une trace datée, nominative, qui survit à la
 *      fermeture de l'onglet et que le responsable retrouve. Sans elle, le
 *      rappel disparaît avec le bandeau.
 *
 * PAS DE PUSH : une notification téléphone à chaque modification d'association
 * (il y en a plusieurs par semaine) serait ignorée au bout de trois jours, et
 * emporterait dans son mépris les push qui comptent vraiment (incident,
 * anomalie de checklist). Le canal doit rester proportionné à l'événement.
 *
 * JAMAIS BLOQUANT, JAMAIS D'ÉCHEC PROPAGÉ : un rappel qui ne part pas ne doit
 * pas empêcher d'enregistrer une DPAV. La fonction ne rend pas de promesse —
 * aucun appelant ne doit pouvoir se mettre à l'attendre par inadvertance.
 */
const pool = require('../config/database');

/** Qui reçoit le rappel. La déclaration Refashion est un acte de direction. */
const ROLES_RAPPEL = ['ADMIN'];

/** Clé de réglage : l'adresse de l'extranet, si la structure veut la ranger là. */
const CLE_URL_EXTRANET = 'refashion.extranet_url';

/**
 * Adresse de l'extranet Refashion, telle qu'elle est PARAMÉTRÉE — jamais
 * devinée. Aucune valeur par défaut en dur : une URL inventée enverrait
 * l'utilisateur sur une page morte, ce qui est pire que pas de lien du tout.
 * @returns {Promise<string|null>}
 */
async function lireUrlExtranet() {
  try {
    const r = await pool.query('SELECT value FROM settings WHERE key = $1', [CLE_URL_EXTRANET]);
    const v = r.rows[0]?.value;
    if (typeof v !== 'string') return null;
    const url = v.trim();
    return /^https?:\/\//i.test(url) ? url : null;
  } catch (_) {
    return null; // table absente, base non migrée : le rappel part sans lien.
  }
}

/**
 * Compose le texte du rappel. PURE — testée seule.
 *
 * @param {{objet: string, action: string, detail?: string|null, auteur?: string|null}} args
 *   - `objet` : « DPAV 2026 T2 », « Association Les Restos du Cœur »…
 *   - `action` : « enregistré », « modifiée », « supprimée »…
 * @returns {string}
 */
function composerRappel({ objet, action, detail = null, auteur = null }) {
  const parts = [`${objet} — ${action}`];
  if (detail) parts.push(detail);
  if (auteur) parts.push(`par ${auteur}`);
  return `${parts.join(' · ')}.\n`
    + 'À REPORTER SUR L\'EXTRANET REFASHION : cette modification n\'y est pas '
    + 'remontée automatiquement (Refashion n\'expose aucune interface de '
    + 'synchronisation). Tant qu\'elle n\'y est pas saisie, la déclaration et '
    + 'l\'activité réelle divergent.';
}

/**
 * Dépose le rappel dans la messagerie des destinataires.
 * @returns {void} — délibérément SANS promesse (cf. en-tête).
 */
function rappelerExtranetRefashion({ objet, action, detail = null, auteur = null, lien = null }) {
  try {
    const { envoyerMessageSystemeRoles } = require('./messagerie');
    if (typeof envoyerMessageSystemeRoles !== 'function') return;
    const texte = composerRappel({ objet, action, detail, auteur });
    Promise.resolve(lireUrlExtranet())
      .then((url) => envoyerMessageSystemeRoles(ROLES_RAPPEL, {
        texte: url ? `${texte}\nExtranet : ${url}` : texte,
        source: 'rappel_refashion',
        lien,
      }))
      .catch((err) => console.warn('[REFASHION] Rappel extranet non déposé :', err.message));
  } catch (err) {
    console.warn('[REFASHION] Service de messagerie absent, rappel non déposé :', err.message);
  }
}

/** Nom lisible de l'auteur d'une modification, pour la trace. PURE. */
function auteurDe(req) {
  const u = req?.user;
  if (!u) return null;
  const nom = [u.first_name, u.last_name].filter(Boolean).join(' ').trim();
  return nom || u.username || null;
}

module.exports = {
  ROLES_RAPPEL,
  CLE_URL_EXTRANET,
  composerRappel,
  rappelerExtranetRefashion,
  auteurDe,
};
