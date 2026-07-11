# Audit fonctionnel — Module « Parcours d'insertion & accompagnement CIP »

**Date** : 11 juillet 2026
**Périmètre** : `backend/src/routes/insertion/` (index.js, routes.js, engine.js), `backend/src/routes/prescripteurs.js`, `backend/src/routes/exports.js` (export insertion + export FSE+), `backend/src/services/insertion-ai.js`, `backend/src/services/scheduler.js` (jobs jalons), pages `frontend/src/pages/InsertionParcours.jsx` et `frontend/src/pages/AuditInsertion.jsx`.
**Méthode** : lecture intégrale du code des fichiers cités, complétée par deux recherches web ciblées sur l'écosystème IAE (Plateforme de l'inclusion / Extranet IAE ASP, catégories de freins périphériques reconnues par le secteur) pour calibrer le benchmark.

---

## 1. Couverture fonctionnelle réelle

Le module couvre un vrai cycle d'accompagnement CIP, pas une simple fiche statique :

- **Diagnostic d'accueil** (`insertion_diagnostics`) : parcours antérieur, 7 freins périphériques notés 1‑5 (mobilité, santé, finances, famille, linguistique, administratif, numérique) chacun avec détail texte et « causes », observations professionnelles, préférences (Explorama), hypothèses métiers du CIP. La grille de diagnostic (`FREINS_DEFINITIONS` dans `engine.js`) embarque pour chaque frein des questions d'entretien indirectes et un catalogue d'actions de levée — un vrai contenu métier, pas un simple champ libre.
- **Jalons du parcours** (`insertion_milestones`) : Diagnostic accueil, Bilan M+3/M+6/M+10, Bilan Sortie, avec questionnaire CIP dédié par jalon (`CIP_QUESTIONNAIRES`), évaluation des freins à chaque bilan, avis global, et pour la sortie : classification positive/négative, type de sortie, employeur/SIRET, durée de contrat (champs ajoutés pour le reporting DREETS).
- **Échéancier intelligent** : `computeMilestoneSchedule()` (`engine.js`) cale les jalons sur la durée réelle du contrat (pas de jalon après la fin d'un CDDI court), réutilisé à la fois par les routes et par le scheduler (`checkInsertionMilestones`, `backend/src/services/scheduler.js`), ce qui évite la duplication de logique.
- **Plans d'action CIP** (`cip_action_plans`) rattachés à un jalon, avec catégorie/priorité/statut.
- **Analyse assistée** : un moteur algorithmique gratuit (`analyzeInsertion`, `buildAIRecommendations`) calcule pistes métiers, fiche synthèse, alertes et recommandations sans appel API, complété par 4 endpoints IA Claude à la demande (profil, entretien, cohorte, audit — `insertion-ai.js`), avec une sonde `/ia/diagnostic` isolée pour diagnostiquer les pannes IA (clé, modèle, réseau).
- **Pilotage de cohorte** : `GET /cohorte/stats` agrège en SQL pur (sans IA) retards, jalons à venir, salariés à risque de fin de contrat, freins moyens, taux de sorties dynamiques — exposé dans `CohortePanel` (page d'accueil du module).
- **Page « Audit Insertion »** (`AuditInsertion.jsx` + `GET /insertion/audit` et `/audit/ia`) : tableau de bord direction (KPI, taux de réalisation par jalon, radar des 7 freins, sorties, plans d'action) et rapport IA de situation globale croisant chiffres et verbatims anonymisés — avec export PDF fidèle à l'écran.
- **Exports** : extraction Excel multi-feuilles et CSV complète (`GET /exports/insertion`, ADMIN/RH), et export FSE+ dédié (`GET /exports/fse-plus`) au format attendu par le cofinanceur européen.
- **Référentiel prescripteurs** (`prescripteurs.js`) : CRUD complet + endpoint d'affectation à un salarié, table `prescripteur_orgas` (PE/FT/Mission Locale/CD/CCAS/Cap Emploi…).

L'ensemble forme un socle fonctionnel nettement plus riche qu'un simple suivi de dossier : diagnostic structuré, jalons réglementaires, pilotage de cohorte et reporting direction cohabitent dans un même module.

## 2. Adéquation aux besoins des utilisateurs et parties prenantes

**CIP au quotidien** : le formulaire de diagnostic/bilan est long (7 freins + 4 sections de questionnaire + bilan + sortie) mais bien géré en sections repliables avec badges de remplissage (`Collapsible`, `InsertionParcours.jsx`), pré-remplissage des freins/objectifs depuis le bilan précédent, garde-fou de saisie non enregistrée (`dirty` + `beforeunload`). C'est un outil pensé pour un usage bureau du CIP, pas pour le bénéficiaire lui-même — cohérent avec le secteur (le salarié en réinsertion n'a pas vocation à saisir ses propres freins dans l'ERP).

**Direction** : la page Audit Insertion répond directement au besoin de pilotage stratégique (taux de réalisation des jalons, sorties dynamiques, freins dominants) avec export PDF prêt à diffuser — un vrai différenciateur par rapport à un simple outil de suivi de dossiers.

**DREETS/ASP et prescripteurs** : c'est le point le plus fragile. Le champ prescripteur existe en double : un champ libre `employees.prescripteur` (modifiable dans `Employees.jsx`) et une relation structurée `employees.prescripteur_id → prescripteur_orgas` pensée spécifiquement pour le reporting (commentaire explicite dans `init-db.js` : « Permet le reporting Pôle Emploi / FSE+ »). Or **aucune page ni appel frontend n'utilise `prescripteurs.js`** (recherche exhaustive dans `frontend/src/` : zéro résultat) : impossible de créer un organisme prescripteur ou d'affecter la relation structurée depuis l'interface. Conséquence directe : l'export `GET /exports/fse-plus` (`backend/src/routes/exports.js`), qui sélectionne exclusivement `po.nom`/`po.type` via cette relation, produira une colonne « Prescripteur » vide pour la quasi-totalité des bénéficiaires en production — alors même que le champ libre existe et est renseigné par les RH. C'est un export réglementaire trimestriel obligatoire vis-à-vis du cofinanceur FSE+ qui part structurellement incomplet.

Autre point de vigilance réglementaire : le KPI « taux de sorties dynamiques » (`cohorte/stats`, `audit`) repose sur `sortie_classification` (positive/négative), saisi indépendamment de `sortie_type` (CDI/CDD>6 mois/formation…) dans `BilanPanel` — aucun code ne dérive l'un de l'autre. Les requêtes SQL excluent en outre silencieusement toute sortie sans classification renseignée (`sortie_classification IS NOT NULL`). Le taux affiché à la direction et potentiellement à la DREETS dépend donc d'une discipline de double-saisie non garantie, sur un indicateur qui est précisément celui que ces parties prenantes surveillent le plus.

## 3. Benchmark marché

Le secteur IAE dispose d'un système de référence unique et obligatoire : la **Plateforme de l'inclusion** (emplois.inclusion.beta.gouv.fr) et l'**Extranet IAE 2.0 de l'ASP**, qui centralisent PASS IAE, prescriptions et — de plus en plus — la remontée automatique des données de sortie vers la DREETS/ASP. Une recherche ciblée confirme que l'automatisation des échanges Plateforme ↔ Extranet IAE progresse pour limiter la double saisie entre systèmes. Or **aucune trace** (recherche `pass_iae`, `plateforme.*inclusion`, `extranet.*iae` sur tout le dépôt) d'intégration, d'export compatible ou même de champ « numéro PASS IAE » dans SOLIDATA. Le module se positionne donc comme un **outil d'accompagnement interne enrichi** (diagnostic, IA, pilotage) plutôt que comme un système de déclaration — ce qui est un choix défendable, mais qui implique que le CIP saisit deux fois ses observations (une fois ici pour le suivi qualitatif/IA, une fois sur la Plateforme pour la valeur légale) sans qu'aucun pont ne soit documenté.

Sur le contenu du diagnostic, les 7 freins suivis sont cohérents avec les catégories qu'on retrouve dans la littérature du secteur (mobilité, santé, finances, administratif, numérique), mais **en omettent deux réputées fréquentes** : le **logement** (cité à ~14 % des bénéficiaires IAE dans les données sectorielles) et les **freins judiciaires** (~37 %, l'un des plus fréquents). Le logement n'apparaît qu'en question libre au bilan M+10 (trop tardif pour agir tôt), et le volet judiciaire n'existe nulle part dans le schéma. Face aux logiciels de suivi socioprofessionnel du secteur ESS (souvent construits autour de référentiels de freins plus larges incluant logement et justice), SOLIDATA est légèrement en retrait sur ce point précis, malgré une modélisation par ailleurs plus riche que la moyenne (niveaux 1‑5, questions indirectes, catalogue d'actions).

## 4. Forces et faiblesses

**Forces observées dans le code** :
- Grille de freins avec vrai contenu métier (questions indirectes, actions de levée) plutôt qu'un champ texte générique.
- Échéancier des jalons calé sur la durée réelle du contrat, factorisé entre routes et scheduler.
- Résilience technique soignée : requêtes secondaires isolées (`soft()`), erreurs IA traduites en indices exploitables (modèle/clé/quota) plutôt qu'en 500 opaques, sonde de diagnostic IA dédiée.
- Double niveau d'IA (recommandations algorithmiques gratuites toujours actives + Claude à la demande) qui dégrade proprement sans budget IA.
- Pilotage de cohorte et audit direction réels, pas seulement du suivi individuel.
- Liaison PCM (recrutement) → insertion désormais fiable via la FK `employees.candidate_id` plutôt qu'un rapprochement par nom.

**Faiblesses et manques constatés** :
- Export FSE+ à colonne prescripteur structurellement vide (aucune UI pour la relation `prescripteur_orgas`).
- KPI « sortie dynamique » non sécurisé par une cohérence type/classification.
- RGPD : ni l'anonymisation (`POST /rgpd/anonymize/employee/:id`) ni le droit d'accès (`GET /rgpd/export/employee/:id`, `backend/src/routes/rgpd.js`) ne couvrent `insertion_diagnostics`, `insertion_milestones` ou `cip_action_plans` — pourtant les données les plus sensibles du système (santé, précarité, statut administratif, commentaires de sortie nominatifs).
- La table `insertion_interview_alerts`, alimentée par le scheduler (retard/planification/rappel J‑7/J‑1), n'est exposée par **aucune route ni aucun écran** ; seule l'alerte J‑1 déclenche un envoi réel (email/SMS au salarié). Les autres types d'alerte sont écrits en base sans être jamais consultés.
- La liste « Salariés en parcours » de `InsertionParcours.jsx` interroge en réalité tous les salariés actifs (`WHERE e.is_active = true`, sans filtre sur `insertion_status`), sans champ de recherche — libellé trompeur pour une structure avec du personnel permanent hors dispositif.
- Le renouvellement d'un contrat CDDI (fréquent, jusqu'à 24 mois) ne redéclenche pas le calcul des jalons manquants (M+6/M+10 apparaissant après extension) : seul un nouveau clic manuel sur « Initialiser jalons » les ajoute, sans qu'aucun signal n'invite le CIP à le faire.
- Aucun test unitaire ne couvre la logique métier du moteur (`computeMilestoneSchedule`, scoring des freins/métiers) malgré un historique de correctifs répétés sur cette même logique (changelog CLAUDE.md, versions 2.2.0 à 2.5.0).
- Quelques champs de la charge utile d'analyse sont morts ou orphelins (`score_global` toujours `null`, `adequation_poste` calculé mais jamais affiché, endpoint `GET /milestones-overview` jamais appelé par le frontend) — trace de dette technique sans impact utilisateur direct.

## 5. Recommandations priorisées

| # | Priorité | Recommandation | Effort |
|---|----------|-----------------|--------|
| 1 | **P0** | Construire l'UI de gestion des prescripteurs (liste/création + affectation à un salarié) et faire retomber l'export FSE+ sur `employees.prescripteur` (COALESCE) si `prescripteur_id` est vide, pour que la déclaration trimestrielle ne parte plus avec une colonne vide | S/M |
| 2 | **P1** | Dériver `sortie_classification` par défaut depuis `sortie_type` (avec forçage manuel possible) et empêcher la clôture d'un Bilan Sortie « réalisé » sans classification, pour fiabiliser le taux de sorties dynamiques | S |
| 3 | **P1** | Étendre l'anonymisation et le droit d'accès RGPD (`rgpd.js`) aux tables `insertion_diagnostics`, `insertion_milestones`, `cip_action_plans` | M |
| 4 | **P1** | Rebrancher `generateMilestones`/`computeMilestoneSchedule` sur les mises à jour de `employee_contracts` (renouvellement CDDI), avec signal visuel si des jalons sont potentiellement obsolètes | M |
| 5 | **P1** | Ajouter des tests unitaires ciblant `engine.js` (échéancier, scoring freins/métiers), zone à régressions répétées | M |
| 6 | **P2** | Documenter/clarifier la position du module vis-à-vis de la Plateforme de l'inclusion et de l'Extranet IAE ASP, pour limiter la double saisie et sécuriser la cohérence des sorties dynamiques déclarées | L |
| 7 | **P2** | Filtrer la liste des salariés du module sur le statut d'insertion (ou a minima l'étiqueter correctement) et ajouter une recherche | S |
| 8 | **P2** | Ajouter logement et situation judiciaire comme freins structurés, conformément aux catégories usuelles du secteur, et nettoyer les champs orphelins (`score_global`, endpoint `milestones-overview`) | M |

---

*Rapport rédigé à partir de la lecture du code réel du périmètre listé ci-dessus. Aucune modification n'a été apportée au dépôt.*
