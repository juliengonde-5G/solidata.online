# Audit fonctionnel — Module Logistique Exutoires & Expéditions

**Date** : 11 juillet 2026
**Périmètre** : `backend/src/routes/{clients-exutoires,tarifs-exutoires,commandes-exutoires,preparations,controles-pesee,calendrier-logistique,expeditions,partners,state-machines}.js`, `backend/src/services/{state-machine,state-machines}.js`, pages `ExutoiresClients`, `ExutoiresTarifs`, `ExutoiresCommandes`, `ExutoiresPreparation`, `ExutoiresGantt`, `ExutoiresCalendrier`.
**Méthode** : lecture du code (routes, migrations `init-db.js`/`migrate-exutoires.js`, pages React). Le module adjacent « Contrôle facturation » (`factures-exutoires.js`) est cité ponctuellement car il partage la colonne `commandes_exutoires.statut`, mais reste hors périmètre strict.

## Résumé exécutif

Le module couvre un vrai cycle de négoce (client → commande → préparation → chargement → pesée croisée → clôture) avec un moteur de machine à états centralisé et un contrôle de pesée à seuils — une base solide pour une structure de cette taille. Mais la lecture du code révèle des défauts concrets et vérifiables : un tableau de bord direction dont deux KPI sont cassés en permanence (mismatch de noms de champs), une famille de produits sur trois (essuyage/tricot/mérinos) pour laquelle **aucun tarif ne peut être créé** (bug à trois niveaux : UI, validateur, contrainte SQL), et un raccourci de statut qui permet de faire « avancer » une commande sans jamais produire les mouvements de stock associés. Le moteur de state machine, présenté comme la pièce maîtresse de fiabilisation du workflow (V6.1), n'est en réalité branché que sur un seul des quatre workflows qu'il déclare.

## 1. Couverture fonctionnelle réelle

Le module permet aujourd'hui : un **référentiel clients** (`clients-exutoires.js`, CRUD + suppression douce) ; une **grille tarifaire** (`tarifs-exutoires.js`) avec résolution en cascade prix client → prix de référence, versionnée dans le temps ; des **commandes** (`commandes-exutoires.js`) à 9 statuts, multi-types de produit (colonne `TEXT[]`), génération de référence auto (`CMD-2026-0001`), et un calcul d'**émissions CO2 évitées** par type basé sur des facteurs Refashion/ADEME documentés dans le code — un vrai plus pour le reporting RSE ; une **préparation & chargement** (`preparations.js`) par lieu physique (quai/garage remorque/cours) avec détection de conflit de créneau, affectation de collaborateurs répercutée automatiquement dans le planning RH (`schedule`), horodatage de chaque étape et création automatique d'un mouvement de stock de sortie à l'expédition ; un **contrôle de pesée** (`controles-pesee.js`) avec upload du ticket PDF client et classification automatique conforme (≤2 %)/écart acceptable (≤5 %)/litige ; un **calendrier prévisionnel** (`calendrier-logistique.js`) sur 3 mois avec projection des commandes récurrentes, taux d'occupation par lieu et 4 types d'alertes ; une **vue Gantt** visuelle par lieu. La route **expéditions** (`expeditions.js`) enregistre des sorties liées aux catégories de tri avec sortie automatique de Stock Original, mais n'a plus de page consommatrice (voir §5).

## 2. Adéquation aux besoins des utilisateurs et parties prenantes

Pour le **responsable logistique/commercial**, l'ergonomie bureau (kanban, formulaires, filtres) est adaptée — ce module ne s'adresse pas à un public éloigné du numérique sur le terrain, contrairement à la collecte mobile. Toutes les routes exigent `ADMIN`/`MANAGER` (`router.use(authenticate, authorize('ADMIN', 'MANAGER'))`, répété à l'identique dans 7 fichiers), cohérent avec un poste administratif.

Pour la **direction**, le module affiche en théorie de bons leviers de pilotage (tonnage prévu, CA prévisionnel, CO2 évité, alertes de charge). En pratique, une partie de ces KPI est cassée côté écran (§5, constat n°1) : la direction ne peut pas s'y fier en l'état.

Pour les **clients exutoires**, aucun accès direct n'est prévu : ni portail de suivi, ni notification automatique de changement de statut, ni document généré. Tout passe par un contact hors-ERP — défendable pour peu de clients récurrents, mais un écart avec les standards B2B (§3).

Les exigences **Refashion/Métropole/DREETS** relèvent surtout d'autres modules ; le seul point de contact réglementaire ici est le calcul CO2 évité, correctement sourcé.

## 3. Benchmark marché

Les éditeurs spécialisés (AMCS Enterprise Management, CAP Collecte sur Microsoft Dynamics 365, WAM Software, Odoo/NetSuite adaptés recyclage) structurent le même flux commande → traitement → expédition → facturation, mais avec trois différenciateurs absents ici : (1) **intégration directe du pont-bascule** (lecture automatique du poids depuis la balance) contre une saisie manuelle + upload PDF côté SOLIDATA ; (2) **portail client et documents automatisés** (bon de livraison, facture) — SOLIDATA a fait le choix inverse, assumé côté facturation puisque le module « Contrôle facturation » adjacent est explicitement un outil de rapprochement et non de génération, cohérent avec une facturation réelle faite sur Pennylane ; (3) **automatisation des commandes récurrentes**, ici limitée à une simple projection visuelle (§5). Sur le socle qu'il couvre, le module n'a pas à rougir de la comparaison — la machine à états déclarative et le contrôle de pesée à seuils sont des choix pertinents, peu courants dans un ERP interne développé en propre. L'écart se situe sur l'automatisation et l'ouverture externe.

## 4. Forces

- Moteur de state machine générique bien conçu : transitions déclaratives, contrôle de rôle par transition, audit centralisé (`state_transitions_audit`), verrou pessimiste (`FOR UPDATE`) contre les races conditions (`commandes-exutoires.js`, ligne 340).
- Contrôle de pesée à seuils (2 %/5 %) fidèle à la pratique réelle du secteur du recyclage.
- Planification physique multi-lieux avec détection de conflit en temps réel et alertes proactives (surcharge, semaine vide, stock insuffisant).
- Intégration native avec le planning RH (`schedule`) lors de l'affectation de collaborateurs — évite une double saisie.
- Calcul CO2 évité sourcé (Refashion/ADEME), utile pour le reporting RSE.
- Suppression douce cohérente (`actif=false`) sur clients et partenaires, historique préservé ; SQL paramétré partout dans le périmètre revu ; confirmations systématiques avant action destructive (`useConfirm`).

## 5. Faiblesses, manques et irritants UX

**Constat n°1 (critique) — KPI direction cassés.** `GET /commandes-exutoires/stats` renvoie `{ total_tonnage_prevu, total_ca_prevu }`, mais `ExutoiresCommandes.jsx` lit `stats.tonnage_prevu` et `stats.ca_previsionnel` (noms différents). Les cartes « Tonnage prévu » et « CA prévisionnel » du kanban affichent donc en permanence « — », sans erreur visible.

**Constat n°2 (critique) — tarification impossible pour 3 familles produit sur 8.** La refonte des gammes (`init-db.js`, migration « V1.8.2 ») a remplacé `effilo_blanc/effilo_couleur` par `essuyage/tricot/merinos` dans le CHECK de `commandes_exutoires.type_produit`. Mais `tarifs_exutoires` n'a jamais été migré : son CHECK (`migrate-exutoires.js`, ligne 41) et le validateur `body('type_produit').isIn([...])` de `tarifs-exutoires.js` (ligne 80) acceptent toujours l'ancienne liste, et le formulaire `ExutoiresTarifs.jsx` ne propose même pas ces 3 types dans son menu déroulant. Aucun prix de référence ni négocié ne peut donc être enregistré pour essuyage/tricot/mérinos ; chaque commande de ce type impose une saisie manuelle du prix, sans traçabilité tarifaire.

**Constat n°3 (critique) — raccourci de statut qui court-circuite les effets de bord métier.** Le bouton d'action rapide de `ExutoiresCommandes.jsx` (`STATUS_TRANSITIONS`) autorise, via le moteur de state machine, les transitions `confirmee→en_preparation` et `chargee→expediee` directement depuis la fiche commande — exactement les statuts que produit normalement la création d'une préparation (`preparations.js`, statut posé par SQL direct) et son passage à `expediee` (qui, lui, **crée le mouvement de stock de sortie**). Utiliser le raccourci fait donc avancer la commande sans jamais créer de préparation ni de mouvement de stock : risque de dérive silencieuse de l'inventaire.

**Le moteur de state machine n'est réellement branché que sur un workflow.** `preparation_expedition`, `controle_pesee` et `facture_exutoire` sont déclarés dans `state-machines.js` mais ne correspondent à aucun statut réel en base (`preparations_expedition.statut_preparation` a 5 valeurs différentes de la machine déclarée ; `controles_pesee.statut_controle` inclut `valide`, absent de la machine ; les statuts de facture réellement écrits — `rapprochement_manuel`, `ecart_valide` — n'existent pas non plus dans la machine). Les routes correspondantes ne les appellent jamais : les transitions se font par `UPDATE` SQL direct, sans garde de séquence ni audit centralisé.

**Suppression d'une préparation planifiée = commande orpheline.** `DELETE /preparations/:id` ne touche pas `commandes_exutoires.statut` ; le message de confirmation affiché (« la commande reviendra à l'étape précédente ») est donc inexact. La commande reste bloquée en `en_preparation` sans préparation associée, et le formulaire de création ne liste que les commandes `confirmee` — aucun chemin UI ne permet de la débloquer.

**Gestion d'erreur silencieuse généralisée.** Les 6 pages du périmètre ne font que `console.error(err)` dans leurs handlers. Un refus de transition (409 avec message clair côté `state-machine.js`) ou un conflit de créneau ignoré passent inaperçus pour l'utilisateur, qui ne comprend pas pourquoi rien ne se passe.

**Commandes récurrentes non actionnables.** La colonne `commande_parent_id` existe en base mais n'est utilisée nulle part dans le code applicatif ; la récurrence n'est qu'une projection visuelle dans `calendrier-logistique.js`, sans bouton pour matérialiser la prochaine occurrence.

**Autres manques (P2)** : catalogue de types de produit dupliqué et divergent entre au moins 4 fichiers front (`ExutoiresPreparation.jsx` et `ExutoiresGantt.jsx` affichent encore l'ancienne nomenclature) ; le composant `KanbanBoard` supporte le glisser-déposer (`dnd`) mais `ExutoiresCommandes.jsx` ne le câble pas ; `GET /api/state-machines/*` (y compris l'historique d'audit avec noms d'utilisateurs) n'exige qu'une authentification, sans restriction de rôle, contrairement au reste du module ; répartition strictement égale du tonnage/CO2 entre types en cas de commande multi-types, non documentée à l'utilisateur ; aucun document généré (bon de commande/livraison) ni notification client automatique ; la route `expeditions.js` n'a plus de page frontend consommatrice depuis la suppression de `/expeditions` (v1.8.0) ; le référentiel unifié `partners` (censé fusionner exutoires/clients/boutiques) n'est alimenté que par un backfill ponctuel — les routes commandes/factures continuent d'écrire exclusivement via `client_id`.

## 6. Recommandations priorisées

| # | Recommandation | Priorité | Effort |
|---|---|---|---|
| 1 | Corriger le mismatch de champs KPI (`total_tonnage_prevu`/`total_ca_prevu` vs `tonnage_prevu`/`ca_previsionnel`) sur `ExutoiresCommandes.jsx` | P0 | S |
| 2 | Migrer `tarifs_exutoires` (CHECK SQL + validateur + menu déroulant front) vers la nomenclature actuelle (essuyage/tricot/mérinos), à l'identique de `commandes_exutoires` | P0 | M |
| 3 | Retirer ou sécuriser le raccourci de statut qui saute la préparation/pesée réelle (bloquer `confirmee→en_preparation` et `chargee→expediee` sans préparation/pesée existante) | P0 | M |
| 4 | Faire remonter les erreurs API à l'utilisateur (bandeau/toast) sur les 6 pages, en réutilisant les messages déjà produits par le moteur de state machine | P1 | S |
| 5 | Réaligner ou retirer les machines déclaratives non branchées (`preparation_expedition`, `controle_pesee`, `facture_exutoire`) | P1 | L |
| 6 | Corriger le cycle « suppression de préparation » : renvoyer la commande à `confirmee` ou permettre sa reprise depuis l'UI | P1 | S |
| 7 | Ajouter un bouton « matérialiser la prochaine occurrence » sur les commandes récurrentes projetées | P1 | M |
| 8 | Centraliser le catalogue de types de produit (référentiel partagé front, un seul fichier source) | P2 | S |
| 9 | Décider du sort de `routes/expeditions.js` (reconnecter une page ou retirer proprement) et clarifier `partners` vs `client_id` | P2 | M |
| 10 | Étudier une notification automatique (email) au client exutoire aux étapes clés (confirmation, expédition) | P2 | M |

---
*Sources : lecture directe de `backend/src/routes/`, `backend/src/services/`, `backend/src/scripts/init-db.js`, `backend/src/scripts/migrate-exutoires.js`, `frontend/src/pages/`. Benchmark marché : connaissance sectorielle + recherches ponctuelles (AMCS, CAP Collecte/Dynamics 365, solutions ERP recyclage généralistes).*
