# Vague 0 — Rapport de réalisation

**Date** : 11 juillet 2026 · Fait suite au [plan d'action](01-plan-action.md) (section Vague 0).
**Méthode** : 7 agents d'implémentation en parallèle sur des lots à fichiers disjoints, puis 1 agent de debug final (revue intégrale du diff, cohérences inter-lots, tests, build).
**Résultat** : **26/26 items « fait »** (les 25 items du plan + 1 bonus). Verdict debug : **prêt à committer**.
**Commits** : `caa989a` (7 lots) + commit de corrections debug (deploy.sh, AdminCAV.jsx).

## Vérifications

- **Jest backend : 216/216 tests verts** (22 suites) sur l'état post-modifications.
- **Build Vite frontend : succès** (re-vérifié après la passe debug).
- `bash -n` OK sur deploy.sh ; `node --check` OK sur les 17 fichiers backend/scripts touchés.
- Diff `1bcc539..caa989a` revu fichier par fichier : correspondance exacte avec les déclarations des 7 lots, aucun débordement de périmètre, aucun conflit inter-lots.
- Cohérences vérifiées : enum d'heures identique front/back/CHECK SQL et consommé par les KPI ; chaîne `must_change_password` complète (init-db → login/me/password → AuthContext, flux chauffeur mobile intact) ; contrats `/commandes-exutoires/stats` et FinanceOperations GET↔PUT alignés ; rôles RH/MANAGER triple-alignés backend/routes/menu ; les 7 chemins corrigés du smoke test correspondent à des routes réellement montées.

## Ce qui a été livré

### Sécurité comptes (items 1, 2, 4)
- **Fin d'admin/admin123** : mot de passe admin initial aléatoire (crypto, 32 hex) affiché une seule fois dans un encadré au démarrage, colonne `users.must_change_password` (migration idempotente), **écran bloquant de changement de mot de passe** au premier login (overlay global dans AuthContext, min 10 caractères, purge des refresh tokens). Filet de rattrapage pour les installations existantes : tout login réussi avec « admin123 » force le changement. Docs mises à jour (RECONSTRUCTION.md, DEPLOIEMENT.md, deploy.sh).
- **Garde-fou dernier ADMIN** : `PUT /users/:id` refuse (409) de désactiver ou rétrograder le dernier compte ADMIN intégré actif.
- **Compte désactivé** : le refresh token d'un compte désactivé est refusé (401) et supprimé ; la désactivation purge les refresh tokens.

### Données de pilotage (items 6, 7, 8, 9, 10, 12)
- **Types d'heures** : fin du rabattement silencieux sur « normal » — validation stricte (400 si type inconnu), sélecteur aligné sur l'enum réellement consommé par les KPI (`normal/training/absence/sick/holiday`, libellés français). *Choix documenté : l'option « Heures sup. » du sélecteur est retirée (les heures sup passent par la colonne numérique `overtime_hours`, jamais par le type).*
- **R3/R4** : champs de saisie réels dans la feuille de production (pré-remplissage, verrouillage à la clôture) ; les indicateurs `resultat_*_ok` sont recalculés sur les vraies entrées.
- **HT/TTC boutiques** : base unique **HT** (les objectifs sont saisis en HT et `total_ht` est fiablement alimenté par le CSV LogicS) sur budget, % d'atteinte, KPI et graphes ; la table rayons, dont l'endpoint n'expose que du TTC, est relibellée honnêtement « CA TTC ».
- **Clôture de tournée idempotente** : garde atomique `AND status <> 'completed'` — plus aucune duplication de stock/tonnage/feedback au double-clic ; boutons désactivés pendant l'appel.
- **Mix paiement VAK** : classification frontend alignée sur les libellés normalisés backend (« CB »/« Espèces »), dans VakPerformance et VakJournee.
- **KPI Subvention Refashion** : renvoie `null` + « En attente de saisie des subventions Refashion » au lieu d'un faux 0 € (corrige au passage un 500 latent).

### Écrans cassés réparés (items 15, 16, 17, 18, 19, 20, 21)
- **FinanceOperations** : contrat GET/PUT rétabli de bout en bout (`{auto, overrides, results}`, persistance réelle dans `financial_operational_data`, rétro-compatible) — l'écran affiche et sauvegarde enfin.
- **FinanceTresorerie** : catégories taguées `type`/`class` côté backend — les sections Revenus/Dépenses et le solde net se remplissent.
- **FinanceControles** : « Actualiser » re-fetch la vraie route, « Exporter » génère un CSV client (`;` + BOM) ; bandeaux d'erreur ajoutés.
- **Pennylane** : le bouton mort « Synchroniser factures » est rebranché sur la route PULL réelle (`/sync/customer-invoices`) et relibellé « Importer les factures clients ».
- **Billing** : export PDF réparé (le `window.open` vers l'API perdait le Bearer → 401) via le pattern d'impression A4 du projet.
- **KPI kanban exutoires** : mapping frontend aligné sur les champs réels des stats.
- **Export CSV Refashion** : téléchargement via l'instance axios authentifiée (fini le faux CSV contenant l'erreur 401), erreurs affichées.
- **BoutiquesImport** : la suppression de batch attend réellement la confirmation.

### Chaînes métier (items 13, 14)
- **/metropole/sortie-dynamique réparé** : requête réécrite sur le schéma réel (`milestone_type='Bilan Sortie'`, `status='realise'`), définition « sortie dynamique » **unifiée avec le module insertion** (`sortie_classification='positive'`).
- **Clôture du parcours d'insertion** : la réalisation du jalon « Bilan Sortie » clôt le parcours (`insertion_status='termine'` + `insertion_end_date`), de façon idempotente, avec réouverture gérée si le bilan est dé-réalisé — fin du double comptage des cohortes.

### Accès & navigation (items 23, 24, 25)
- **Import de paie Malibou ouvert au rôle RH** (3 routes backend + ProtectedRoute + menu).
- **Dashboard exécutif** (ADMIN/MANAGER) et **Seuils d'alerte** (ADMIN) enfin présents dans la navigation ; `authorize` ajouté sur `/dashboard/executive`.
- **CAV/capteurs** : le backend était déjà largement ouvert aux MANAGER (constat partiellement invalidé — vérifié) ; la page AdminCAV et la génération de QR le sont désormais aussi ; DELETE reste ADMIN ; « Carte des CAV » remontée au premier niveau du menu Collecte.

### Divers (items 5, 11, 22)
- **Require cassé du prédictif** corrigé (`../routes/tours/predictions`, sans dépendance circulaire) — `/predictive/ia/ajustements` ne plante plus en 500.
- **`estimated_fill_rate` fantôme** : retiré de l'API publique partenaires ; le feedback d'apprentissage capteur utilise la dernière **vraie** prédiction (`ml_fill_predictions`) ou n'écrit rien.
- **Smoke test de déploiement** : **7 chemins 404 corrigés** (les 4 identifiés à l'audit + 3 chemins finance également faux découverts à la vérification systématique) ; les 18 autres endpoints vérifiés existants.

### Corrections de la passe debug
- `deploy/scripts/deploy.sh` n'affiche plus « Mot de passe : admin123 » (message devenu faux) — il pointe vers l'encadré des logs de démarrage.
- `AdminCAV.jsx` : le bouton « Supprimer » n'est rendu que pour ADMIN (évite un 403 au MANAGER, à qui reste la désactivation).

## Points résiduels documentés par l'agent debug (backlog)

À intégrer aux vagues suivantes — **aucun ne bloque la vague 0** :

| # | Point | Affectation |
|---|---|---|
| 1 | Min. mot de passe 10 uniquement sur le self-service ; POST /users et reset admin restent à 6 | Vague 3 (politique mdp) |
| 2 | Chemin **mobile** de clôture de tournée (`/status-public`) toujours non idempotent | Vague 1 (item 47/consolidation jumeaux) |
| 3 | `/finance/kpis` et `/rentabilite` lisent la clé legacy `tonnes_au_tri` au lieu de `tonnes_triees` persistée par Opérations | Vague 1-B |
| 4 | HT/TTC résiduel dans BoutiquesObjectifs.jsx et BoutiquesVentes.jsx (hors périmètre du lot) | Vague 1 (suite item 8) |
| 5 | `/boutique-ventes/analytics/rayons` n'expose pas `ca_ht` (table rayons ≠ KPI HT) | Vague 1 (suite item 8) |
| 6 | `ReportingMetropole.jsx` avale encore les erreurs du KPI sortie dynamique (`catch(()=>null)`) | Vague 1-C |
| 7 | `predictive-ai.js` injecte encore `estimated_fill_rate` dans le contexte LLM + défaut `CLAUDE_MODEL` déprécié | Vague 1-E |
| 8 | Boucle feedback capteur conservatrice : dépend de la génération régulière de `ml_fill_predictions` | Vague 1-E |
| 9 | Smoke test authentifié SKIPpé tant que `API_USER`/`API_PASSWORD` absents du `.env` prod | **Action serveur immédiate** |
| 10 | Historique `work_hours` pré-correctif tout en « normal » (KPI passés sous-évalués) ; carte résumé n'affiche pas sick/holiday/training | Vague 1-C (note de lecture) |
| 11 | Route `/api/exports/invoice/:id` devenue orpheline après le fix Billing | Vague 3 (nettoyage, selon arbitrage A2) |
| 12 | `must_change_password` non posé à la création d'utilisateur ni au reset admin | Vague 3 (politique mdp) |

## Actions serveur au déploiement

1. `bash deploy/scripts/deploy.sh update` (rebuild backend + frontend).
2. Renseigner `API_USER`/`API_PASSWORD` dans `/opt/solidata.online/.env` pour activer la section authentifiée du smoke test.
3. Sur base existante : au premier login en `admin123`, le changement de mot de passe est exigé automatiquement (prévoir de communiquer aux utilisateurs concernés).
