# Test persona — Conseillère en Insertion Professionnelle (CIP)

**Date** : 11 juillet 2026
**Accès applicatif** : rôle RH (web, https://solidata.online)
**Périmètre** : module Insertion (`/insertion`, `/insertion/audit`) et ses dépendances (diagnostics, jalons, plans d'action, IA, exports)

---

## 1. Ma promesse

En tant que CIP, j'accompagne une trentaine de salariés en CDDI. L'application doit me permettre de savoir, en un coup d'œil et sans ressaisie, **qui a besoin de moi cette semaine** (entretien en retard, jalon à venir, fin de contrat proche), de **documenter mes diagnostics et bilans** (freins périphériques, projet professionnel) sans perdre ce que j'ai déjà écrit, et de **produire les preuves de mon activité** (jalons réalisés, sorties dynamiques, plans d'action) sous une forme exploitable par la DREETS et les financeurs. C'est mon référentiel : gain de temps sur le pilotage, fiabilité de la saisie, exportabilité vers l'extérieur.

## 2. Mon parcours dans l'application

**Navigation** — Le menu « RH et Insertion » (`frontend/src/components/Layout.jsx`, lignes 161-169) expose « Parcours d'insertion » et « Audit insertion », tous deux ouverts au rôle RH, cohérent avec les routes protégées de `frontend/src/App.jsx` (lignes 150-151, `roles={['ADMIN','RH','MANAGER']}`). Côté API, `backend/src/routes/insertion/index.js` (ligne 210) applique `authorize('ADMIN','RH','MANAGER')` à l'ensemble du module — j'ai donc bien les droits de lecture ET d'écriture sur diagnostics, jalons et plans d'action.

**Tableau de bord cohorte** — `CohortePanel` (`frontend/src/pages/InsertionParcours.jsx`, lignes 704-927) interroge `GET /insertion/cohorte/stats` (`backend/src/routes/insertion/routes.js`, lignes 562-676). J'y retrouve les jalons en retard, les jalons à venir sous 7 jours, les fins de contrat sous 60 jours et le taux de sorties dynamiques de l'année — chaque ligne est cliquable et m'ouvre directement la fiche du salarié concerné. C'est l'écran que j'utiliserais tous les matins.

**Alertes J-7/J-1/retard** — Un job planifié existe bien (`backend/src/services/scheduler.js`, fonction `checkInsertionInterviewAlerts`, lignes 217-271) : il crée des lignes dans `insertion_interview_alerts` et envoie même un e-mail/SMS automatique **au salarié** à J-1. Mais en cherchant dans tout le backend, aucune route ne relit jamais cette table (seules des écritures existent). Ce que je vois sur mon tableau de bord — « en retard » / « à venir 7 jours » — est recalculé en direct sur les échéances (`due_date`), pas les alertes elles-mêmes. Je n'ai donc aucune trace de ce qui a été effectivement envoyé, ni de canal dédié pour un rappel J-7/J-1 qui me serait destiné à moi.

**Diagnostic socio-professionnel (7 freins)** — L'onglet « Diagnostic CIP » s'appuie sur `FREINS_DEFINITIONS` (`backend/src/routes/insertion/engine.js`, lignes 230+), qui propose pour chaque frein des **questions indirectes** (ex. pour la mobilité : « racontez-moi votre trajet du matin ») plutôt qu'une notation brute — un vrai atout pédagogique pour ne pas braquer la personne en entretien. Le PUT `/insertion/diagnostic/:employeeId` est robuste : migration idempotente qui garantit l'existence de toutes les colonnes, et remonte un `hint` explicite en cas de base non à jour (`routes.js`, lignes 140-230).

**Bilan M+3 et jalons** — `BilanPanel` (`InsertionParcours.jsx`, lignes 207-500+) pré-remplit les freins et objectifs depuis le dernier jalon réalisé, affiche le radar d'évolution, et adapte le questionnaire au type de jalon via `CIP_QUESTIONNAIRES`. Les échéances sont calculées sur le contrat réel (`computeMilestoneSchedule`, `engine.js` ligne 1400) et non sur un calendrier M+1/6/12 rigide — plus de jalons fantômes après la fin d'un CDDI court. Le bloc « Bilan Sortie » capture classification positive/négative, type de sortie, employeur, SIRET et durée de contrat : exactement ce qu'exige un dossier de sortie dynamique.

**Plan d'action** — Créer une action (`POST /insertion/action-plans`) fonctionne, mais uniquement rattachée à un jalon (`milestone_id` obligatoire) : je ne peux pas créer une action indépendamment d'un bilan. Et surtout, `cohorte/stats` ne requête jamais `cip_action_plans` — je n'ai donc **aucune vue cohorte des actions en retard**, seulement salarié par salarié.

**IA (profil, entretien)** — Les endpoints `/insertion/ia/profil/:id` et `/insertion/ia/entretien/:id` (`routes.js`, lignes 1076-1105) sont réservés à `ADMIN/RH` — j'y ai accès. Le service `backend/src/services/insertion-ai.js` est soigné : extraction tolérante du JSON, timeouts dédiés (120 s côté frontend), messages d'erreur diagnostiqués (`handleIaError`), sonde `/ia/diagnostic` isolée pour tester juste la connectivité Claude.

**Audit Insertion annuel** — `frontend/src/pages/AuditInsertion.jsx` consomme `GET /insertion/audit` (accessible à RH) et `GET /insertion/audit/ia` (ADMIN/RH). C'est un vrai outil de pilotage : taux de réalisation des jalons par échéance, radar des 7 freins consolidé, sorties et statistiques, plans d'action en cours, rapport IA croisant chiffres et verbatims anonymisés, export PDF prêt à imprimer.

**Exports** — Le bouton « Exporter » du tableau de bord cohorte (`InsertionParcours.jsx`, lignes 721-748) télécharge un classeur Excel 5 feuilles ou un CSV ciblé via `GET /exports/insertion` (`backend/src/routes/exports.js`, ligne 524, `authorize('ADMIN','RH')`) — fonctionnel et bien pensé (requêtes résilientes via un helper `soft()`).

## 3. Ce que je retiens

### Forces
- Le parcours complet (tableau de bord → diagnostic → bilan → plan d'action → IA → audit → export) existe réellement et est accessible avec mon rôle RH, à chaque étage (nav, route, API).
- Jalons calés sur la durée réelle du contrat, pas sur un calendrier générique.
- Questionnaires de diagnostic construits autour de questions indirectes, pédagogiquement adaptés à un public en insertion.
- Garde-fou anti-perte de saisie (`confirmLeave`, `beforeunload`) sur diagnostic et bilan.
- IA bien conçue : messages d'erreur exploitables, sonde de diagnostic isolée, timeouts dédiés — on sent un produit qui a appris de ses propres incidents (cf. historique CLAUDE.md 2.4.3).
- Audit Insertion : le meilleur écran du module, pensé directement pour mon usage (direction + CIP).

### Faiblesses (irritants vérifiés)
- La liste de gauche « Salariés en parcours » (`InsertionParcours.jsx`, ligne 1054) est en réalité `GET /insertion` avec pour seul filtre `WHERE e.is_active = true` (`routes.js`, ligne 98) — **aucun filtre sur `insertion_status`**, ni recherche, ni tri. Sur une structure qui emploie aussi des permanents (collecte, tri, boutique), je dois parcourir tout l'effectif actif pour retrouver mes ~30 CDDI.
- Aucune vue cohorte des plans d'action en retard (uniquement salarié par salarié, ou agrégats non détaillés dans l'Audit annuel).
- La fiche PDF individuelle (`exportFicheParcoursPDF`, lignes 623-654) reprend situation, diagnostic, freins et jalons, mais pas le plan d'action en cours.

### Défaillances vérifiées dans le code
1. **[P1] Export FSE+ pour les financeurs invisible dans l'application.** `backend/src/routes/exports.js` (route `GET /fse-plus`, lignes ~409-518) construit un CSV trimestriel complet dédié au cofinancement européen (bénéficiaires CDDI, en-tête réglementaire). Une recherche exhaustive dans `frontend/src` ne retourne **aucune** occurrence de « fse-plus » : aucun bouton, aucune page ne l'appelle. Le seul moyen d'y accéder est de connaître et d'appeler directement l'URL API — inatteignable pour moi depuis le site.
2. **[P1] Ce même export omet des champs qu'il annonce lui-même comme obligatoires.** Le commentaire en tête de route (lignes 400-406) liste « SIRET employeur, ... genre, situation sociale » comme données requises, mais ni la requête SQL ni les en-têtes CSV (lignes 421-473) ne reprennent `sortie_employeur_siret`/`sortie_duree_contrat_mois` (colonnes ajoutées via `init-db.js`, lignes ~1801-1805, explicitement « pour reporting DREETS ») ni `employees.civility` (`init-db.js`, ligne 2414). Le SIRET que je saisis avec soin dans chaque bilan de sortie n'atteint donc jamais cet export.
3. **[P2] Aucune route de lecture sur `insertion_interview_alerts`.** Le mécanisme d'alerte J-7/J-1/retard écrit dans cette table (voir ci-dessus) mais rien ne la relit jamais côté API — la fonctionnalité annoncée dans ma mission (« traiter les alertes de jalons ») n'a pas d'écran dédié ; je ne fais que déduire l'équivalent depuis les échéances brutes du tableau de bord.

### Manques fonctionnels (métier)
- Pas d'agenda personnel des entretiens à venir (seulement des listes agrégées).
- Pas de notion de « CIP référent » par salarié : à plusieurs CIP, impossible de filtrer « mes salariés » — tout le monde voit tout.
- Pas de comparaison du taux de sorties dynamiques à un objectif conventionné DREETS (seul le taux brut est calculé, sans cible de référence).
- Pas de traçabilité fine des modifications de bilan au-delà de `created_by`/`updated_by` (pas de contre-signature ou de validation hiérarchique).

## 4. Verdict

**Promesse partiellement tenue** — **7/10**. Le cœur de mon métier quotidien (diagnostic, bilans, plan d'action, pilotage de cohorte, audit annuel) est réellement construit, accessible à mon rôle, et souvent bien pensé sur le plan métier. Mais la chaîne « preuve d'activité vers l'extérieur », qui est justement ce dont je suis redevable auprès de la DREETS et des financeurs, présente une vraie faille : un export dédié au cofinancement existe côté serveur mais reste inatteignable et incomplet, et le dispositif d'alerte de jalons n'a pas de vitrine pour le CIP qui doit les traiter.
