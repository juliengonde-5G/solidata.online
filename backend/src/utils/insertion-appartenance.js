/**
 * « Ce salarié est-il DE MON périmètre ? » — une seule réponse pour tout le
 * module insertion (correctif PR C, constat B-01 de la revue de sécurité).
 *
 * ═══ POURQUOI CE FICHIER ══════════════════════════════════════════════════
 *
 * `managerOwnsEmployee` (routes.js) garde l'ÉCRITURE du formulaire de
 * renouvellement depuis la revue Codex PR#74 : « sinon tout encadrant pourrait
 * écrire le renouvellement d'autrui ». La PR C a ouvert, à côté, deux surfaces
 * qui servent le LIEN PUBLIC de ce même formulaire (`GET /insertion/
 * renouvellements` et le bloc « Organisation du suivi » de `GET /insertion/
 * echeances`) sans aucune garde d'appartenance : un encadrant obtenait le jeton
 * d'un salarié dont il n'est pas le référent et écrivait son avis SANS ÊTRE
 * IDENTIFIÉ — c'est-à-dire le contournement exact de la garde, avec en prime une
 * écriture non attribuable sur une pièce qui fonde un renouvellement de CDDI.
 *
 * Poser la même règle une seconde fois, en SQL cette fois, aurait produit ce que
 * le module paie déjà deux fois (la tolérance de rendez-vous en double, l'alerte
 * FSE+ décalée d'un jour) : deux implémentations qui divergent au premier
 * correctif. Les requêtes de cohorte projettent donc les DEUX colonnes qui
 * portent la règle, et c'est cette fonction — la seule — qui tranche.
 */

'use strict';

/**
 * Colonnes à projeter pour pouvoir trancher. À joindre tel quel dans un SELECT
 * qui a `employees e` et `LEFT JOIN employees mgr ON mgr.id = e.manager_id`.
 */
const SQL_COLONNES_APPARTENANCE = 'e.cip_referent_user_id, mgr.user_id AS manager_user_id';

/**
 * Le salarié décrit par `row` relève-t-il de cet utilisateur ?
 * Vrai s'il en est le CIP référent ou l'encadrant (manager) — la règle
 * historique de `managerOwnsEmployee`, mot pour mot.
 *
 * @param {{cip_referent_user_id?: number|null, manager_user_id?: number|null}} row
 * @param {number|null|undefined} userId
 */
function estProprietaireEncadrant(row, userId) {
  if (!row || userId == null) return false;
  const uid = Number(userId);
  if (!Number.isFinite(uid)) return false;
  const cip = row.cip_referent_user_id;
  const mgr = row.manager_user_id;
  return (cip != null && Number(cip) === uid) || (mgr != null && Number(mgr) === uid);
}

/**
 * Ce rôle a-t-il le droit de RECEVOIR le lien public de l'encadrant pour ce
 * salarié ? ADMIN/RH toujours ; un MANAGER seulement s'il en est le référent.
 *
 * Le lien n'est pas une donnée du dossier : c'est un identifiant de connexion
 * valable 60 jours, sans compte. Le rendre à qui ne peut pas écrire le
 * formulaire reviendrait à lui donner par la porte de derrière ce que la garde
 * lui refuse en face.
 */
function peutVoirLienEti(baseRole, row, userId) {
  if (baseRole === 'ADMIN' || baseRole === 'RH') return true;
  if (baseRole !== 'MANAGER') return false;
  return estProprietaireEncadrant(row, userId);
}

module.exports = { SQL_COLONNES_APPARTENANCE, estProprietaireEncadrant, peutVoirLienEti };
