# Vague 2 — Rapport de réalisation : ouvrir l'application aux parties prenantes

**Date** : 12 juillet 2026 · Fait suite au [plan d'action](01-plan-action.md) (section Vague 2) et aux vagues [0](02-vague0-realisation.md) et [1](03-vague1-realisation.md).
**Méthode** : 8 agents d'implémentation en parallèle sur lots à fichiers quasi disjoints, commits de sécurisation, puis agent debug final.
**Résultat** : **36/36 items traités** (35 « fait », 1 constat déjà résolu en vague 1). Verdict debug : **prêt à committer**.
**Vérifications** : Jest backend **481/481** (40 suites, ~159 tests ajoutés) · build Vite OK · mobile Vitest **40/40** · séquence « base neuve » **prouvée sur PostgreSQL 16.13 + PostGIS** (init-db → migrate-exutoires → migrate-finance → init-db, puis passage idempotent zéro erreur).

## Arbitrages appliqués (défauts documentés, réversibles)

- **A5 — Portail auditeurs** : rôle AUTORITE ouvert en **lecture seule** sur Refashion et Métropole (pas de portail séparé).
- **A4 — QHSE** : module minimal **intégré** à SOLIDATA (pas d'outil externe).
- **A2 — Facturation interne** : retirée de l'interface, **tables et services conservés** (réactivable — le montage est commenté).
- **A3 — ai-agent/** : **décommissionné** (README de dépréciation, code conservé non déployé) — le chat intégré `chat.js` est le canal officiel.

## Ce qui a été livré

### Accès & rôles (items 52-54 + résiduel)
- **3 nouveaux rôles intégrés** : **DPO** (tout le module RGPD sans les pleins droits ADMIN), **FINANCE** (lecture seule stricte sur Finance/Pennylane — garde par méthode HTTP côté API, boutons d'écriture masqués côté UI), **QHSE** (incidents avec résolution, véhicules/checklists/maintenance, contrôles de pesée en lecture, exports Refashion). La contrainte SQL qui figeait 6 rôles est levée proprement (validation applicative, prouvé sur PG16) ; anti-escalade et garde-fou dernier ADMIN intacts ; **page d'accueil par rôle** (HomeRedirect).
- **Auditeur Refashion (AUTORITE)** : lecture de tout le module (DPAV, subventions, taux, exports CSV, journal d'audit), formulaires masqués, **attestation « stock verrouillé le … » sur chaque DPAV** (jointure au verrouillage trimestriel), **pièce justificative attachable aux taux de subvention** (upload ADMIN, téléchargement auditeur), section d'accueil « Audit & conformité ».
- **Auditeur Métropole (AUTORITE)** : FillRateMap accessible, **KPI insertion agrégés non nominatifs** (ETP 1607 h, absentéisme, formation), **délai moyen d'intervention sur incident CAV** (par type et par mois), badge mix CO2 mesuré/forfaitaire, **export CSV + « Revue de convention » PDF**.
- Menu Véhicules/Maintenance ouvert à MANAGER et QHSE.

### Module QHSE (item 58)
- **Registre accidents/presqu'accidents** : typologie (AT/trajet/presqu'accident/soin bénin), gravité, jours d'arrêt, mesures, statut déclaré→analysé→clos, **TF1 et TG calculés sur les heures réellement travaillées** ; minimisation RGPD (faits uniquement, note à l'écran, entrée au registre des traitements).
- **Habilitations à échéance** : CACES/SST/habilitation électrique datées avec badges d'expiration (rouge/ambre), **synchronisation du booléen du planning** (la table QHSE devient la source de vérité datée), job d'alerte hebdomadaire.
- **Dotations EPI** : par salarié, tailles, péremptions.
- Section QHSE au menu (ADMIN/MANAGER/QHSE), périmètre restant (DUERP, plan de prévention, causeries) affiché honnêtement.

### Atelier de tri (items 56-57)
- **L'atelier peut enfin saisir ses exécutions de tri** : page pensée atelier en 3 étapes (démarrer sur un lot, saisir les sorties par catégorie avec écart/perte en continu, compléter) branchée sur le backend transactionnel qui existait sans écran ; liste et reprise des exécutions du jour.
- **Administration des référentiels tri** : chaînes, opérations, postes, catégories sortantes (CRUD avec désactivation protégée, famille Refashion obligatoire — les vues DPAV en dépendent).

### Boutiques (item 55)
- **Cloisonnement RESP_BTQ** : table d'affectation utilisateur↔boutiques + middleware de scope sur toutes les routes boutique (403 hors périmètre, listes filtrées), UI d'affectation pour ADMIN.
- **BoutiquesPlanning enfin routée** (route + menu) ; **vue consolidée multi-boutiques** avec comparaison N-1 réelle pour la direction.

### Direction & CIP (items 60-61)
- **KPIs de la veille par défaut** (dernier jour ouvré) avec sélecteur veille/jour/semaine ; **widget d'alertes consolidées** (incidents ouverts, maintenance, jalons en retard, CAV pleins, fins de CDDI < 60 j, saturation stock — résilient, chaque ligne cliquable) ; seuil de stock matière paramétrable.
- **SolidataBot étendu** : 3 outils de lecture (synthèse finance, KPI insertion agrégés, synthèse ventes) avec **double filtrage par rôle** (exposition et exécution).
- **CIP** : agenda « Mes prochains entretiens (30 j) », **CIP référent par salarié** (+ filtre « mes salariés »), **objectif conventionné DREETS** (réalisé vs objectif), plan d'action inclus dans l'export PDF de la fiche.

### Mobile & communication (item 62 + résiduel)
- **Canal manager → chauffeur** : consigne envoyée depuis le suivi live des tournées, **bannière ambre FALC sur le mobile** (poll du contexte, « J'ai compris » avec accusé de lecture offline-first), badge lu/non lu côté manager.
- **Historique mobile enrichi** : le chauffeur voit ses tournées passées avec CAV collectés, incidents déclarés et pesées synchronisées (« ma pesée est bien passée »).
- Deep-link des push incidents : déjà correct depuis la vague 1 (constat classé sans objet).
- Recopie permis B/CACES au lien candidat↔collaborateur (jamais de rétrogradation).

### VAK (item 63)
- **Remboursements gérés sur les voies API et webhook** comme en CSV (helper partagé, compteurs live et KPI nets) — le CA affiché en direct n'est plus surévalué.
- **Taux d'écoulement** : après investigation, aucune source stock fiable rattachée à une VAK de détail → champ de saisie `kg_approvisionnes` sur la session (choix documenté) + KPI kg vendus nets / kg approvisionnés.

### Nettoyage (A2, A3, résiduels vague 1)
- **Billing retiré de l'UI** (page supprimée, route et montage débranchés avec note de réactivation, route d'export orpheline retirée) — BillingService/InvoiceRepository conservés (consommés par factures-exutoires).
- **ai-agent décommissionné** (README explicite ; aucun compose racine ni conf nginx ne le référençait — vérifié).
- Exutoires : raccourcis de statut restants bloqués avec explication (le flux nominal passe par la Préparation), **modal détail réparé** (champs alignés sur l'API réelle).
- CHECK `weekly_hours` élargi (0 < h ≤ 48) : les temps partiels réels 24/28/30 h ne sont plus écrasés à l'import.
- Facteurs saisonniers affichés (propositions, export training) branchés sur la résolution complète du moteur.
- **RECONSTRUCTION.md corrigé** : l'ordre empiriquement validé pour une base neuve est **init-db → migrate-exutoires → migrate-finance → init-db** (la note de la vague 1 inversait l'ordre — corrigée preuve à l'appui).

## Corrections de la passe debug

1. Rôle QHSE ajouté aux GET de `vehicles.js` (checklists, maintenance, documents) et `controles-pesee.js` (garde par méthode) — fin des 403 sur ses écrans.
2. Boutons d'écriture masqués pour FINANCE (FinanceOperations, Pennylane) — cohérence UX avec le verrou API.
3. **Sécurité** : la garde RGPD du chatbot (`self-scope` COLLABORATEUR) était contournable par un rôle personnalisé dérivé — résolue via `resolveBaseRole` (ferme un P1 de l'audit initial).
4. Doublon inter-lots `driver_messages` dans init-db supprimé (définition unique).
5. Sections `qhse`/`audit` ajoutées au catalogue de la matrice d'habilitations.
6. Landing du rôle QHSE arbitrée vers `/qhse/accidents`.

## Points résiduels documentés (backlog vague 3)

1. Menu « Seuils d'alerte » ADMIN-only vs route ADMIN/MANAGER (divergence pré-existante).
2. `state-machines.js` réserve la transition « annulée » à ADMIN/MANAGER : un RESP_BTQ ne peut pas annuler son propre brouillon (arbitrage propriétaire du moteur).
3. BoutiquesPlanning exploitable par RESP_BTQ quand `planning-hebdo.js` ouvrira ses GET en lecture filtrée.
4. Routes mobiles `-public` : pas de contre-vérification JWT↔véhicule (pattern historique assumé, données non sensibles).
5. Rôles personnalisés dérivés de RH non proposés comme CIP référents (limitation mineure).
6. **Reconstruction from scratch** : le premier passage d'init-db sort en erreur attendue → `deploy.sh` ne peut pas reconstruire seul une base vierge ; séquence manuelle documentée dans RECONSTRUCTION.md (sans impact sur les déploiements courants).

## Actions au déploiement

1. `deploy.sh update` habituel (base existante : migrations idempotentes).
2. Créer les comptes des nouveaux rôles (DPO, FINANCE, QHSE, AUTORITE pour les auditeurs) dans `/users`.
3. Affecter les responsables de boutique à leur boutique (nouvel écran d'affectation) — sans affectation, un RESP_BTQ ne voit plus aucune donnée.
4. Activer le seuil de stock (`stock_matiere_max`, livré désactivé en attendant calibrage).
5. Saisir l'objectif conventionné de sorties dynamiques (panneau cohorte insertion).
