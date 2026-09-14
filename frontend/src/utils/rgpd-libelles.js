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
  PURGE_PCM_REPONSES: 'Purge manuelle — réponses détaillées au questionnaire PCM (30 jours)',
  PURGE_INSERTION: 'Purge manuelle — dossiers d’insertion clos',
  PURGE_GPS: 'Purge manuelle — positions GPS anciennes',
  PURGE_ARRETS_GPS: 'Purge manuelle — arrêts GPS de collecte',
  PURGE_BORDEREAUX_DECHETERIE: 'Purge manuelle — bordereaux de collecte en déchèterie (signatures)',
  PURGE_MESSAGERIE: 'Purge manuelle — messagerie interne',
  // PR C lot 7 — 10ᵉ purge : trace des rappels de rendez-vous envoyés aux salariés.
  PURGE_RAPPELS_RDV: 'Purge manuelle — rappels de rendez-vous envoyés aux salariés',
  PURGE_REFRESH_TOKENS: 'Purge manuelle — jetons de connexion expirés',

  // ── Purges — job planifié (préfixe AUTO_ = déclenchement automatique) ────
  AUTO_PURGE_24M: 'Purge automatique — candidatures non recrutées (24 mois)',
  AUTO_PURGE_PCM_90J: 'Purge automatique — tests PCM de personnes non recrutées (90 jours)',
  AUTO_PURGE_PCM_REPONSES: 'Purge automatique — réponses détaillées au questionnaire PCM (30 jours)',
  AUTO_PURGE_INSERTION: 'Purge automatique — dossiers d’insertion clos',
  AUTO_PURGE_GPS_90D: 'Purge automatique — positions GPS anciennes',
  AUTO_PURGE_ARRETS_GPS: 'Purge automatique — arrêts GPS de collecte',
  AUTO_PURGE_BORDEREAUX_DECHETERIE: 'Purge automatique — bordereaux de collecte en déchèterie (signatures)',
  AUTO_PURGE_MESSAGERIE: 'Purge automatique — messagerie interne',
  AUTO_PURGE_RAPPELS_RDV: 'Purge automatique — rappels de rendez-vous envoyés aux salariés',
  AUTO_PURGE_REFRESH_TOKENS: 'Purge automatique — jetons de connexion expirés',
  AUTO_PURGE_BADGEUSE: 'Purge automatique — module Temps & Présence (badgeuse)',

  // ── Administration base de données (routes/admin-db.js, services/db-backup.js) ──
  DB_BACKUP: 'Sauvegarde de la base de données',
  DB_RESTORE: 'Restauration de la base de données',
  DB_VACUUM: 'Optimisation de la base (VACUUM ANALYZE)',
  DB_PURGE: 'Purge d’une table technique',

  // ── PCM (routes/pcm.js) ───────────────────────────────────────────────────
  PCM_RAPPORT_CONSULTATION: 'Consultation d’un rapport PCM',
  // Restitution demandée par la personne elle-même depuis l'écran de fin de
  // test (art. 15). Le libellé dit QUI a reçu la donnée : ce n'est pas un agent
  // de la structure qui consulte un dossier, et confondre les deux au journal
  // rendrait la ligne illisible pour le DPO.
  PCM_RESTITUTION_CANDIDAT: 'Restitution de son résultat PCM au candidat (droit d’accès)',

  // ── Note de profil initial CIP (routes/insertion/routes.js) ──────────────
  INSERTION_NOTE_PROFIL_LECTURE: 'Lecture de la note de profil initial (CIP)',
  INSERTION_NOTE_PROFIL_GENERATION: 'Génération de la note de profil initial (CIP)',
  INSERTION_NOTE_PROFIL_COMMUNIQUEE: 'Prise de connaissance de la note de profil initial',
  INSERTION_NOTE_SUIVI_LECTURE: 'Consultation du journal de suivi (notes CIP)',
  INSERTION_NOTE_SUIVI_CREATION: 'Ajout d\'une note de suivi (CIP)',
  INSERTION_NOTE_SUIVI_MODIFICATION: 'Modification d\'une note de suivi (CIP)',
  INSERTION_NOTE_SUIVI_SUPPRESSION: 'Suppression d\'une note de suivi (CIP)',

  // ── Export insertion (routes/exports.js, routes/exports-fse.js) ───────────
  EXPORT_INSERTION_FREINS: 'Export des freins périphériques (23 colonnes)',
  EXPORT_INSERTION_FREINS_SENSIBLE: 'Export des freins périphériques — données sensibles (judiciaire)',
  // PR A — les deux exports nominatifs qui n'étaient PAS journalisés alors que
  // la note aux certificateurs l'affirmait (écart 03 § 9.1). Un export est la
  // seule opération qui fait sortir la donnée de l'outil : sans trace, aucune
  // réponse possible à « qui a eu cette liste et quand ».
  EXPORT_INSERTION_COMPLET: 'Export complet du module Insertion (Excel/CSV)',
  EXPORT_FSE_PLUS: 'Export FSE+ participants',

  // ── Dossier administratif d'insertion (routes/insertion/cadre.js, pieces.js) ──
  // Éligibilité IAE, Pass IAE, référent unique, statuts sociaux (BRSA,
  // catégorie France Travail). La CONSULTATION est journalisée au même titre
  // que l'écriture : ces champs disent la situation sociale d'une personne, et
  // savoir qui les a regardés fait partie de ce qu'on doit pouvoir prouver.
  INSERTION_CADRE_CONSULTATION: 'Consultation du dossier administratif d’insertion',
  INSERTION_CADRE_MODIFICATION: 'Modification du dossier administratif d’insertion',
  // Pièces dont la structure est SEULE dépositaire (entretien signé, convention
  // PMSMP, accusé de remise) — servies authentifiées, jamais sous /uploads.
  INSERTION_PIECE_DEPOT: 'Dépôt d’une pièce signée (insertion)',
  INSERTION_PIECE_CONSULTATION: 'Consultation d’une pièce signée (insertion)',
  INSERTION_PIECE_SUPPRESSION: 'Suppression d’une pièce signée (insertion)',

  // ── Cofinancement FSE+ (routes/insertion/fse.js, projets.js) ──────────────
  INSERTION_FSE_SORTIE_SAISIE: 'Saisie de la sortie FSE+ d’un participant',
  INSERTION_FSE_SIX_MOIS_SAISIE: 'Relevé de situation à 6 mois (FSE+)',
  INSERTION_PROJET_PARTICIPANT: 'Rattachement / retrait d’un participant à un projet cofinancé',

  // ── Cadre RSA — structure d'accueil (routes/insertion/rsa.js, PR B lot 3) ──
  // La structure n'est pas référent unique : elle ALIMENTE un référent externe.
  // Chaque geste qui fait SORTIR de l'information vers ce tiers laisse une
  // trace distincte — produire un aperçu, générer une fiche enregistrée, la
  // relire, attester de sa remise — parce que « qui a transmis quoi, à qui et
  // quand » est précisément ce à quoi la structure doit pouvoir répondre.
  INSERTION_ACTIVITE_CONSULTATION: 'Consultation du compteur d’activité hebdomadaire',
  INSERTION_ASSIDUITE_CONSULTATION: 'Consultation du relevé d’assiduité',
  INSERTION_FICHE_REFERENT_APERCU: 'Aperçu d’une fiche pour le référent (sans enregistrement)',
  INSERTION_FICHE_REFERENT_GENERATION: 'Génération d’une fiche pour le référent',
  INSERTION_FICHE_REFERENT_CONSULTATION: 'Consultation d’une fiche pour le référent déjà transmise',
  INSERTION_FICHE_REFERENT_REMISE: 'Remise d’une fiche pour le référent (référent et/ou personne concernée)',
  INSERTION_ACTUALISATION_FT_MAJ: 'Mise à jour du registre d’actualisation France Travail',

  // ── Temps d'accompagnement (routes/insertion/temps.js, PR B lot 4) ────────
  // La feuille de temps est une pièce de FINANCEMENT (cofinancement FSE+) :
  // sa signature et sa réouverture engagent, et l'export part vers l'extérieur.
  INSERTION_FEUILLE_TEMPS_VALIDATION: 'Validation d’une feuille de temps d’accompagnement',
  INSERTION_FEUILLE_TEMPS_REOUVERTURE: 'Réouverture d’une feuille de temps d’accompagnement (motif obligatoire)',
  EXPORT_FEUILLE_TEMPS: 'Export d’une feuille de temps d’accompagnement',

  // ── Section CIP (routes/insertion/echeances.js, eti-public.js, PR C lot 5) ─
  INSERTION_ECHEANCES_CONSULTATION: 'Consultation des échéances CIP (obligations et suivi)',
  INSERTION_ECHEANCE_REPORT: 'Report d’une obligation (48 h)',
  INSERTION_ETI_LIEN_GENERATION: 'Génération d’un lien public pour l’encadrant technique (renouvellement)',
  INSERTION_ETI_FORMULAIRE_JETON: 'Avis de l’encadrant transmis par lien public (sans compte)',

  // ── Documents du salarié et rappels (routes/insertion/salarie.js, PR C lot 7) ─
  // Ces documents SORTENT vers la personne : la génération et la remise sont
  // journalisées de façon bloquante ; le contenu, lui, n'est jamais au journal.
  INSERTION_DOC_SALARIE_APERCU: 'Aperçu d’un document pour le salarié (sans enregistrement)',
  INSERTION_DOC_SALARIE_GENERATION: 'Génération d’un document pour le salarié (Mon parcours / Mon Récap)',
  INSERTION_DOC_SALARIE_CONSULTATION: 'Consultation d’un document déjà remis au salarié',
  INSERTION_DOC_SALARIE_REMISE: 'Remise tracée d’un document au salarié',
  INSERTION_RAPPEL_CONSENTEMENT: 'Recueil ou retrait du consentement aux rappels de rendez-vous',
  INSERTION_RAPPEL_ENVOI: 'Envoi d’un rappel de rendez-vous au salarié (SMS / e-mail)',

  // ── Reporting autorité (routes/insertion/reporting.js, PR D lot 6) ────────
  // La synthèse est agrégée et non nominative ; c'est sa SORTIE de la structure
  // qui est tracée, jamais son contenu.
  INSERTION_DIALOGUE_GESTION_APERCU: 'Aperçu de la synthèse de dialogue de gestion (sans enregistrement)',
  INSERTION_DIALOGUE_GESTION_GENERATION: 'Génération enregistrée de la synthèse de dialogue de gestion',
  INSERTION_DIALOGUE_GESTION_CONSULTATION: 'Consultation d’une synthèse de dialogue de gestion déjà générée',
  EXPORT_DIALOGUE_GESTION: 'Export CSV de la synthèse de dialogue de gestion',
  EXPORT_INSERTION_FREINS_ENRICHI: 'Export du tableau des freins enrichi (cadre 2026)',
  // Message de vérification du contact, envoyé AU MOMENT du recueil pour que la
  // conseillère puisse demander « vous l’avez reçu ? » tant que la personne est
  // devant elle (correctif M-05 de la revue de sécurité PR C).
  INSERTION_RAPPEL_VERIFICATION: 'Vérification du contact choisi pour les rappels de rendez-vous',

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
  // Reprise d'une tournée TERMINÉE (ADMIN). Codes distincts de ceux du bureau
  // ci-dessus : corriger une journée close n'est pas la même chose que saisir
  // une journée en cours — le tonnage y est reconstruit et un écart de stock
  // reste à régulariser à la main. Le journal doit pouvoir les distinguer.
  TOURNEE_REPRISE_PESEE_AJOUTEE: 'Reprise — pesée ajoutée sur une tournée terminée',
  TOURNEE_REPRISE_PESEE_MODIFIEE: 'Reprise — pesée corrigée sur une tournée terminée',
  TOURNEE_REPRISE_PESEE_SUPPRIMEE: 'Reprise — pesée supprimée sur une tournée terminée',
  TOURNEE_REPRISE_VOLUME_MODIFIE: 'Reprise — volume déclaré corrigé sur une tournée terminée',
  TOURNEE_RETOUR_CENTRE_BUREAU: 'Retour au centre de tri posé depuis le bureau',
  // Bordereau de collecte en déchèterie (2.50.0). Le document porte DEUX
  // signatures manuscrites, dont celle d'un agent de la Métropole : chaque
  // ouverture du PDF laisse une trace, d'où un code de CONSULTATION distinct de
  // celui du compte rendu de tournée.
  BORDEREAU_DECHETERIE_CONSULTE: 'Consultation d’un bordereau de collecte en déchèterie',
  BORDEREAU_DECHETERIE_VALIDE: 'Validation d’un bordereau de collecte en déchèterie',

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
  pcm_answers: 'Réponses au questionnaire PCM',
  gps_positions: 'Positions GPS',
  tour_gps_stops: 'Arrêts GPS de collecte',
  tour_decheterie_bordereaux: 'Bordereaux de collecte en déchèterie',
  messagerie_messages: 'Messages (messagerie interne)',
  refresh_tokens: 'Jetons de connexion',
  insertion: 'Dossiers d’insertion',
  insertion_freins: 'Freins périphériques (insertion)',
  insertion_notes_profil: 'Notes de profil initial (CIP)',
  insertion_cadre: 'Dossier administratif d’insertion',
  insertion_rsa: 'Cadre RSA — alimentation du référent unique',
  insertion_temps: 'Temps d’accompagnement (feuilles de temps)',
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
