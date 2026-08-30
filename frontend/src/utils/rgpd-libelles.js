/**
 * Libellés du journal d'audit RGPD (`rgpd_audit_log`) — SOURCE UNIQUE.
 *
 * Chaque route ou job qui touche des données personnelles écrit une ligne dans
 * `rgpd_audit_log` avec un code technique (`action`, ex. `AUTO_PURGE_24M`) et un
 * type d'entité (`entity_type`, ex. `candidate`). Ces codes sont pensés pour le
 * code, pas pour l'écran : l'onglet « Journal d'audit » de /rgpd les affichait
 * bruts, ce qui obligeait un DPO à deviner ce que signifie `AUTO_PURGE_24M` ou
 * `BADGEUSE_ORPHELIN_RATTACHEMENT`. C'est exactement la configuration déjà
 * corrigée ailleurs par un module partagé (`utils/incidents.js` en 2.39.0,
 * `utils/tours.js` en 2.41.0, `utils/pcm.js` en 2.43.0) — d'où ce fichier plutôt
 * qu'un dictionnaire recopié à chaque écran.
 *
 * Convention maison (chantier « conformité RGPD outillée », 2.44.0) : le
 * préfixe `AUTO_` marque un déclenchement PLANIFIÉ (job scheduler), son absence
 * marque un déclenchement HUMAIN (bouton manuel). Les deux versions d'une même
 * purge partagent la même racine (ex. `AUTO_PURGE_GPS_90D` / `PURGE_GPS`) mais
 * restent deux codes distincts : ce fichier les libelle chacun séparément, pour
 * que le journal dise QUI a agi, pas seulement QUOI.
 *
 * Garde anti-dérive : `backend/tests/unit/rgpd-audit-libelles.test.js` relit le
 * code source backend, extrait tous les codes `action` réellement écrits dans
 * `rgpd_audit_log`, et échoue si l'un d'eux n'a pas son libellé ici. Un code
 * nouvellement ajouté côté backend doit donc être ajouté ICI dans la foulée.
 */

/** Libellés FR des codes `rgpd_audit_log.action`. */
export const RGPD_ACTION_LABELS = {
  // ── Registre des traitements, droits des personnes (routes/rgpd.js) ──────
  CREATE: 'Création d’une fiche de traitement',
  EXPORT_DATA: 'Export des données (droit d’accès, art. 15)',
  ANONYMIZE: 'Anonymisation (droit à l’effacement, art. 17)',
  CONSENT_GRANTED: 'Consentement accordé',
  CONSENT_REVOKED: 'Consentement retiré',

  // ── Purges — bouton manuel (sans préfixe = déclenchement humain) ─────────
  PURGE_EXPIRED: 'Purge manuelle — candidatures non recrutées (24 mois)',
  PURGE_PCM_NON_RECRUTE: 'Purge manuelle — tests PCM de personnes non recrutées (90 jours)',
  PURGE_INSERTION: 'Purge manuelle — dossiers d’insertion clos',
  PURGE_GPS: 'Purge manuelle — positions GPS anciennes',
  PURGE_ARRETS_GPS: 'Purge manuelle — arrêts GPS de collecte',
  PURGE_MESSAGERIE: 'Purge manuelle — messagerie interne',
  PURGE_REFRESH_TOKENS: 'Purge manuelle — jetons de connexion expirés',

  // ── Purges — job planifié (préfixe AUTO_ = déclenchement automatique) ────
  AUTO_PURGE_24M: 'Purge automatique — candidatures non recrutées (24 mois)',
  AUTO_PURGE_PCM_90J: 'Purge automatique — tests PCM de personnes non recrutées (90 jours)',
  AUTO_PURGE_INSERTION: 'Purge automatique — dossiers d’insertion clos',
  AUTO_PURGE_GPS_90D: 'Purge automatique — positions GPS anciennes',
  AUTO_PURGE_ARRETS_GPS: 'Purge automatique — arrêts GPS de collecte',
  AUTO_PURGE_MESSAGERIE: 'Purge automatique — messagerie interne',
  AUTO_PURGE_REFRESH_TOKENS: 'Purge automatique — jetons de connexion expirés',
  AUTO_PURGE_BADGEUSE: 'Purge automatique — module Temps & Présence (badgeuse)',

  // ── Administration base de données (routes/admin-db.js, services/db-backup.js) ──
  DB_BACKUP: 'Sauvegarde de la base de données',
  DB_RESTORE: 'Restauration de la base de données',
  DB_VACUUM: 'Optimisation de la base (VACUUM ANALYZE)',
  DB_PURGE: 'Purge d’une table technique',

  // ── PCM (routes/pcm.js) ───────────────────────────────────────────────────
  PCM_RAPPORT_CONSULTATION: 'Consultation d’un rapport PCM',

  // ── Note de profil initial CIP (routes/insertion/routes.js) ──────────────
  INSERTION_NOTE_PROFIL_LECTURE: 'Lecture de la note de profil initial (CIP)',
  INSERTION_NOTE_PROFIL_GENERATION: 'Génération de la note de profil initial (CIP)',
  INSERTION_NOTE_PROFIL_COMMUNIQUEE: 'Prise de connaissance de la note de profil initial',

  // ── Export insertion (routes/exports.js) ──────────────────────────────────
  EXPORT_INSERTION_FREINS: 'Export des freins périphériques (23 colonnes)',
  EXPORT_INSERTION_FREINS_SENSIBLE: 'Export des freins périphériques — données sensibles (judiciaire)',

  // ── Effectifs ETP / états ASP (routes/effectifs.js) ───────────────────────
  ASP_IMPORT: 'Import d’un état ASP mensuel',
  ASP_LIAISON: 'Liaison salarié ↔ état ASP',
  ASP_LIAISON_SUPPRESSION: 'Suppression d’une liaison salarié ↔ état ASP',
  ETP_ASP_VALIDATION: 'Validation ASP mensuelle',
  ETP_ASP_SUPPRESSION: 'Suppression d’une validation ASP',

  // ── Badgeuse — module 33, Temps & Présence (routes/badgeuse.js, routes/badgeuse-device.js) ──
  BADGEUSE_CONSULTATION: 'Consultation de données de pointage',
  BADGEUSE_EXPORT_PAIE: 'Export paie (badgeuse)',
  BADGEUSE_EXPORT_IAE: 'Export heures IAE / ASP (badgeuse)',
  BADGEUSE_ORPHELIN_RATTACHEMENT: 'Rattachement d’un pointage orphelin',
  BADGEUSE_FEUILLE_VALIDATION: 'Validation d’une feuille de temps',
  BADGEUSE_FEUILLE_DEVALIDATION: 'Dévalidation d’une feuille de temps',
  BADGEUSE_OPTIN_FESTIF: 'Consentement à l’affichage des anniversaires (opt-in)',
  BADGEUSE_CODE_APPAIRAGE: 'Émission d’un code d’appairage de poste',
  BADGEUSE_DEVICE_SUPPRESSION: 'Suppression d’un poste de pointage',
  BADGEUSE_APPAIRAGE_CONSOMME: 'Appairage d’un poste de pointage consommé',

  // ── Tournées — consultation et saisie bureau (routes/tours/*) ────────────
  RAPPORT_TOURNEE_CONSULTE: 'Consultation du compte rendu de tournée',
  TOURNEE_PESEE_AJOUTEE: 'Pesée ajoutée depuis le bureau',
  TOURNEE_PESEE_MODIFIEE: 'Pesée modifiée depuis le bureau',
  TOURNEE_PESEE_SUPPRIMEE: 'Pesée supprimée depuis le bureau',
  TOURNEE_POINT_COLLECTE_BUREAU: 'Point marqué collecté depuis le bureau',
  TOURNEE_RETOUR_CENTRE_BUREAU: 'Retour au centre de tri posé depuis le bureau',

  // ── Scripts d'exploitation (backend/src/scripts/*.js — exécution manuelle en conteneur) ──
  COLLECTES_REPRISE_IMPORT: 'Import de reprise — historique des collectes',
  TOURS_PURGE: 'Purge des tournées réalisées',
  CAV_HISTORIQUE_PURGE: 'Purge de l’historique de remplissage des CAV',
  CAV_REMPLISSAGE_RESET: 'Remise à zéro du remplissage des CAV',
  PRODUCTION_REPRISE_IMPORT: 'Import de reprise — historique de production',
};

/** Libellés FR des `rgpd_audit_log.entity_type` les plus fréquents. */
export const RGPD_ENTITY_LABELS = {
  registre: 'Registre des traitements',
  candidate: 'Candidat',
  candidates: 'Candidats',
  employee: 'Salarié',
  employees: 'Salariés',
  database: 'Base de données',
  pcm_sessions: 'Sessions PCM',
  pcm_reports: 'Rapports PCM',
  gps_positions: 'Positions GPS',
  tour_gps_stops: 'Arrêts GPS de collecte',
  messagerie_messages: 'Messages (messagerie interne)',
  refresh_tokens: 'Jetons de connexion',
  insertion: 'Dossiers d’insertion',
  insertion_freins: 'Freins périphériques (insertion)',
  insertion_notes_profil: 'Notes de profil initial (CIP)',
  tours: 'Tournées',
  cav: 'Conteneurs d’apport volontaire (CAV)',
  production_daily: 'Production quotidienne',
  etp_asp_mensuel: 'États ASP mensuels',
  etp_asp_liaisons: 'Liaisons salarié ↔ état ASP',
  badgeuse_pointages: 'Pointages (badgeuse)',
  badgeuse_corrections: 'Corrections de pointage (badgeuse)',
  badgeuse_feuilles_temps: 'Feuilles de temps (badgeuse)',
  badgeuse_devices: 'Postes de pointage (badgeuse)',
};

/**
 * Libellé FR d'un code `action`. Repli sur le code brut (jamais une chaîne
 * vide) : un code qui n'aurait pas encore son libellé ici doit rester lisible
 * à l'écran plutôt que de disparaître — c'est le signe qu'il manque un import
 * plus haut dans ce fichier, pas une raison de masquer l'information au DPO.
 */
export function libelleActionRgpd(code) {
  if (!code) return '—';
  return RGPD_ACTION_LABELS[code] || code;
}

/** Même doctrine que ci-dessus, pour `entity_type`. */
export function libelleEntiteRgpd(type) {
  if (!type) return '—';
  return RGPD_ENTITY_LABELS[type] || type;
}
