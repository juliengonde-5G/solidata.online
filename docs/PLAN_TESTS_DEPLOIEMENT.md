# Plan de tests — Déploiement SOLIDATA ERP

**Rôle** : Chef de projet déploiement  
**Référence** : Cas d’usage et personae (CIP, Manager collecte, Collaborateur terrain, Manager structure, Admin, RH)  
**Objectif** : Valider la mise en production par tests techniques et tests de comportement.

---

## 1. Périmètre et stratégie

| Type | Objectif | Exécution |
|------|----------|-----------|
| **Tests techniques** | API, auth, routes, données, santé backend/frontend | Automatisés (scripts) + checklist manuelle |
| **Tests de comportement** | Parcours utilisateur par persona, critères d’acceptation | Manuels (scénarios pas à pas) |

**Environnements** : Préproduction (recette), Production (validation post-déploiement).

---

## 2. Tests techniques

### 2.1 Santé et disponibilité

| ID | Scénario | Précondition | Action | Résultat attendu | Statut |
|----|----------|--------------|--------|------------------|--------|
| T-SANTE-01 | Health check API | Backend démarré | `GET /api/health` | 200, `status: "ok"`, DB connectée, PostGIS présent | ☐ |
| T-SANTE-02 | Frontend accessible | Build OK | Ouvrir URL frontend | Page login ou redirection login, pas d’erreur console (critique) | ☐ |
| T-SANTE-03 | Mobile accessible | Build mobile OK | Ouvrir URL mobile | Page login, pas d’erreur console | ☐ |
| T-SANTE-04 | CORS | Backend + frontend | Requête depuis origine frontend | Pas d’erreur CORS, cookies/credentials acceptés | ☐ |

### 2.2 Authentification

| ID | Scénario | Action | Résultat attendu | Statut |
|----|----------|--------|------------------|--------|
| T-AUTH-01 | Login valide (web) | POST /api/auth/login (identifiant/mot de passe valides) | 200, token + user (role, first_name, last_name) | ☐ |
| T-AUTH-02 | Login invalide | POST /api/auth/login (mauvais mot de passe) | 401, message d’erreur explicite | ☐ |
| T-AUTH-03 | Accès protégé sans token | GET /api/candidates/kanban sans Authorization | 401 | ☐ |
| T-AUTH-04 | Accès protégé avec token valide | GET /api/candidates/kanban avec Bearer token | 200 (ou 403 si rôle insuffisant) | ☐ |
| T-AUTH-05 | Me (profil) | GET /api/auth/me avec token | 200, même user que login | ☐ |
| T-AUTH-06 | Login mobile (token mobile) | Login depuis l’app mobile, puis appel API mobile | Token mobile accepté, redirection vehicle-select ou équivalent | ☐ |

### 2.3 Autorisation par rôle

| ID | Rôle | Route (exemple) | Résultat attendu | Statut |
|----|------|----------------|------------------|--------|
| T-ROLE-01 | RH | GET /api/candidates/kanban | 200 | ☐ |
| T-ROLE-02 | RH | GET /api/employees | 200 | ☐ |
| T-ROLE-03 | MANAGER | GET /api/tours | 200 | ☐ |
| T-ROLE-04 | MANAGER | GET /api/vehicles | 200 | ☐ |
| T-ROLE-05 | ADMIN | GET /api/users | 200 | ☐ |
| T-ROLE-06 | Utilisateur sans rôle adéquat | GET /api/users avec rôle RH | 403 | ☐ |

### 2.4 Endpoints critiques par domaine

| Domaine | Endpoints à tester | Vérification minimale | Statut |
|---------|---------------------|------------------------|--------|
| Candidats | GET /api/candidates/kanban, GET /api/candidates/stats, POST /api/candidates | 200 ou 201, structure JSON cohérente | ☐ |
| Parcours insertion | GET /api/insertion, GET /api/insertion/milestones-overview | 200, pas d’erreur 500 | ☐ |
| Tournées | GET /api/tours, POST /api/tours/intelligent (body valide), GET /api/tours/my | 200/201, liste ou objet tournée | ☐ |
| Véhicules | GET /api/vehicles, GET /api/vehicles/available | 200, tableau | ☐ |
| CAV | GET /api/cav, GET /api/cav/map, GET /api/cav/fill-rate | 200 | ☐ |
| Historique / Dashboard | GET /api/historique/kpi | 200, collecte/trie/annees_disponibles | ☐ |
| Reporting | GET /api/reporting/collecte, GET /api/metropole/dashboard | 200 | ☐ |
| Stock | GET /api/stock, GET /api/stock/summary | 200 | ☐ |

### 2.5 Données et cohérence

| ID | Scénario | Action | Résultat attendu | Statut |
|----|----------|--------|------------------|--------|
| T-DATA-01 | Dashboard KPI | GET /api/historique/kpi | Données numériques cohérentes (pas de null explosif) | ☐ |
| T-DATA-02 | Kanban candidats | GET /api/candidates/kanban | Colonnes (received, preselected, …) avec tableaux de candidats | ☐ |
| T-DATA-03 | Mes tournées (mobile) | GET /api/tours/my avec token chauffeur | Liste des tournées du jour ou vide | ☐ |

### 2.6 Sécurité et limites

| ID | Scénario | Action | Résultat attendu | Statut |
|----|----------|--------|------------------|--------|
| T-SEC-01 | Rate limit login | N requêtes POST /api/auth/login (N > 30 en 15 min) | 429 ou message « Trop de tentatives » | ☐ |
| T-SEC-02 | Injection (exemple) | Login avec `' OR '1'='1` | 401, pas de connexion | ☐ |

---

## 3. Tests de comportement (par persona)

Les tests ci‑dessous sont à exécuter **manuellement** en préproduction avec des comptes de test par rôle.  
**Critère de succès** : le parcours décrit peut être réalisé de bout en bout sans blocage et les écrans affichent les informations attendues.

---

### 3.1 CIP (Conseillère en Insertion Professionnelle)

**Compte** : utilisateur avec rôle `RH` (ou profil dédié CIP si existant).

| ID | Scénario | Étapes | Résultat attendu | Statut |
|----|----------|--------|------------------|--------|
| B-CIP-01 | Connexion et accès au recrutement | 1. Login 2. Vérifier menu (Candidats, Matrice PCM visibles) 3. Cliquer Candidats | Page Candidats (Kanban) s’affiche, pas de 403 | ☐ |
| B-CIP-02 | Consultation du Kanban candidats | 1. Ouvrir Candidats 2. Vérifier colonnes (Reçus, Présélectionnés, Entretien, …) 3. Cliquer un candidat | Détail candidat (fiche) s’ouvre, infos cohérentes | ☐ |
| B-CIP-03 | Déplacement d’un candidat (drag & drop ou action) | 1. Déplacer un candidat d’une colonne à une autre (ex. Reçu → Présélectionné) | Statut mis à jour, pas d’erreur, rafraîchissement visible | ☐ |
| B-CIP-04 | Ajout d’un candidat | 1. Cliquer « Ajouter candidat » 2. Remplir nom, prénom, email, téléphone, poste 3. Enregistrer | Candidat créé, présent dans le Kanban | ☐ |
| B-CIP-05 | Conversion candidat → employé | 1. Ouvrir un candidat recruté (ou statut « Recrutés ») 2. Lancer conversion en employé 3. Renseigner type contrat, date début | Message de succès, employé créé (visible dans Collaborateurs) | ☐ |
| B-CIP-06 | Accès Parcours insertion | 1. Menu « Parcours insertion » 2. Sélectionner un collaborateur | Page parcours (radar, timeline, freins, actions) s’affiche sans erreur | ☐ |
| B-CIP-07 | Accès Heures de travail | 1. Menu « Heures de travail » | Liste ou tableau des heures, pas de crash | ☐ |
| B-CIP-08 | Accès Matrice PCM | 1. Menu « Matrice PCM » | Page PCM accessible (sessions, types, etc.) | ☐ |

---

### 3.2 Manager de la filière collecte

**Compte** : utilisateur avec rôle `MANAGER` (ou ADMIN).

| ID | Scénario | Étapes | Résultat attendu | Statut |
|----|----------|--------|------------------|--------|
| B-MGR-01 | Connexion et accès Collecte | 1. Login 2. Menu Tournées, Carte CAV, Suivi GPS visibles | Pas de 403, menu cohérent | ☐ |
| B-MGR-02 | Création d’une tournée (wizard) | 1. Tournées → « Nouvelle tournée » 2. Choisir date, véhicule, chauffeur, mode (IA/Standard/Manuel) 3. Valider génération | Tournée créée, visible dans la liste des tournées | ☐ |
| B-MGR-03 | Consultation liste tournées | 1. Tournées 2. Vérifier colonnes (Date, Véhicule, Chauffeur, Mode, CAV, Poids, Statut) | Données cohérentes, actions (détail, statut) utilisables | ☐ |
| B-MGR-04 | Passage tournée « En cours » | 1. Sélectionner une tournée planifiée 2. Changer statut en « En cours » | Statut mis à jour, visible en liste et détail | ☐ |
| B-MGR-05 | Carte CAV | 1. Menu Carte CAV 2. Vérifier affichage carte et points CAV | Carte s’affiche, pas d’erreur carte (Leaflet, etc.) | ☐ |
| B-MGR-06 | Remplissage CAV | 1. Menu Remplissage CAV 2. Vérifier indicateurs / carte de remplissage | Données ou message « pas de données » propre | ☐ |
| B-MGR-07 | Suivi GPS (live) | 1. Menu Suivi GPS 2. Si une tournée est en cours avec véhicule connecté : position visible | Carte ou liste des véhicules en tournée, pas de crash | ☐ |
| B-MGR-08 | Véhicules | 1. Menu Véhicules (admin) ou lien depuis Tournées 2. Liste véhicules, maintenance si présent | Liste affichée, actions disponibles | ☐ |
| B-MGR-09 | Propositions (IA) | 1. Menu Propositions (IA) 2. Choisir date / contexte 3. Vérifier propositions | Page s’affiche, propositions ou message clair | ☐ |
| B-MGR-10 | Stock MP | 1. Menu Stock MP 2. Consulter stock / résumé | Données ou état vide cohérent | ☐ |

---

### 3.3 Collaborateur de collecte (terrain, smartphone)

**Compte** : utilisateur « chauffeur » (affecté à une tournée ou véhicule).

| ID | Scénario | Étapes | Résultat attendu | Statut |
|----|----------|--------|------------------|--------|
| B-COL-01 | Connexion mobile | 1. Ouvrir app mobile 2. Login (identifiant / mot de passe) | Redirection vers « Choisir véhicule » ou équivalent | ☐ |
| B-COL-02 | Choix du véhicule / tournée | 1. Page « Choisir votre véhicule » 2. Sélectionner une tournée du jour 3. Démarrer | Passage à l’étape Checklist (ou Carte) | ☐ |
| B-COL-03 | Barre d’étapes | 1. Vérifier la barre (Véhicule, Check, Carte, Scan, Remplir, Retour, Pesée, Résumé) 2. Vérifier « Suivant : … » | Libellés courts visibles, étape courante et prochaine claires | ☐ |
| B-COL-04 | Checklist départ | 1. Compléter checklist (si présente) 2. Valider | Passage à l’écran Carte (tournée) | ☐ |
| B-COL-05 | Carte tournée et GPS | 1. Écran Carte 2. Vérifier position et CAV 3. Bouton « Aller au CAV » ou équivalent | Carte affichée, pas de crash, navigation possible | ☐ |
| B-COL-06 | Scan QR CAV | 1. Aller à Scan 2. Scanner un QR (ou saisie manuelle si dispo) | CAV reconnu, statut « collecté » mis à jour | ☐ |
| B-COL-07 | Remplissage (niveau) | 1. Écran Remplissage 2. Choisir niveau (plein / demi / vide ou équivalent) 3. Valider | Donnée enregistrée, retour carte ou prochain CAV | ☐ |
| B-COL-08 | Pesée (retour ou intermédiaire) | 1. Declencher pesée (retour centre ou intermédiaire) 2. Saisir poids si demandé 3. Valider | Pesée enregistrée, flux suivant cohérent | ☐ |
| B-COL-09 | Retour centre / fin tournée | 1. Choisir « Retour au centre » ou « Fin de tournée » 2. Valider | Tournée passée en terminée ou en attente de clôture | ☐ |
| B-COL-10 | Résumé tournée | 1. Accéder au Résumé 2. Vérifier CAV collectés, poids, etc. | Résumé lisible, pas d’erreur | ☐ |

---

### 3.4 Manager de la structure (vision 360°)

**Compte** : ADMIN ou MANAGER avec accès global.

| ID | Scénario | Étapes | Résultat attendu | Statut |
|----|----------|--------|------------------|--------|
| B-STR-01 | Dashboard principal | 1. Login 2. Page d’accueil (tableau de bord) | Tuiles KPI (collecte, trié, CO₂, produits), inventaire si dispo, comparaison annuelle | ☐ |
| B-STR-02 | Navigation rapide Collecte | 1. Depuis le dashboard ou menu : Tournées, Suivi GPS, Stock | Accès aux 3 sans erreur | ☐ |
| B-STR-03 | Navigation rapide Production | 1. Production, Chaînes de tri, Stock MP, Produits finis | Pages accessibles, données ou vides cohérents | ☐ |
| B-STR-04 | Navigation rapide Insertion | 1. Parcours insertion, Collaborateurs, Candidats | Accès possible, pas de 403 pour le rôle | ☐ |
| B-STR-05 | Fil d’actualité | 1. Menu Fil d’actualité | Liste des actualités ou message approprié | ☐ |
| B-STR-06 | Reporting (syntheses) | 1. Reporting Collecte, Reporting RH, Reporting Production, Métropole Rouen | Chaque page se charge, indicateurs ou exports visibles | ☐ |

---

### 3.5 Administration / Reporting collectivité

**Compte** : ADMIN.

| ID | Scénario | Étapes | Résultat attendu | Statut |
|----|----------|--------|------------------|--------|
| B-ADM-01 | Reporting Collecte | 1. Reporting → Collecte 2. Vérifier graphiques / tableaux 3. Exporter si bouton présent | Données cohérentes, export sans erreur | ☐ |
| B-ADM-02 | Reporting Métropole Rouen | 1. Reporting → Métropole Rouen 2. Vérifier KPIs (collecte, CAV, évolution) | Page chargée, indicateurs lisibles | ☐ |
| B-ADM-03 | Reporting RH | 1. Reporting RH 2. Vérifier indicateurs insertion / effectifs | Données ou message clair | ☐ |
| B-ADM-04 | Refashion | 1. Menu Refashion 2. Consulter DPAV / communes / subventions si présent | Page utilisable | ☐ |
| B-ADM-05 | Exports (si disponibles) | 1. Depuis une page de reporting : Exporter PDF / Excel | Fichier téléchargé ou message d’erreur explicite | ☐ |
| B-ADM-06 | Gestion utilisateurs | 1. Administration → Utilisateurs 2. Liste, création ou édition d’un utilisateur (test) | CRUD utilisateur fonctionnel | ☐ |
| B-ADM-07 | Configuration / Référentiels | 1. Configuration, Référentiels 2. Lecture des paramètres ou listes | Pas de 500, données ou vides | ☐ |
| B-ADM-08 | RGPD | 1. Menu RGPD 2. Consulter pages dédiées | Accès et contenu conformes à l’usage prévu | ☐ |
| B-ADM-09 | Admin CAV / Admin DB | 1. Gestion CAV, Base de données (si droits) 2. Actions limitées (lecture ou config) | Pas de crash, droits respectés | ☐ |

---

### 3.6 Gestionnaire de personnel (RH)

**Compte** : RH (ou ADMIN).

| ID | Scénario | Étapes | Résultat attendu | Statut |
|----|----------|--------|------------------|--------|
| B-RH-01 | Candidats et postes | 1. Candidats 2. Vérifier postes ouverts / listes 3. Créer un poste si possible | Données cohérentes, création poste OK | ☐ |
| B-RH-02 | Collaborateurs | 1. Menu Collaborateurs 2. Liste, fiche d’un collaborateur 3. Modifier une info (test) | Liste et fiche OK, modification enregistrée | ☐ |
| B-RH-03 | Heures de travail | 1. Heures de travail 2. Saisie ou validation d’heures (selon écran) | Données affichées, saisie/validation sans erreur | ☐ |
| B-RH-04 | Compétences | 1. Menu Compétences 2. Consulter / associer compétences | Page utilisable | ☐ |
| B-RH-05 | Parcours insertion (vue RH) | 1. Parcours insertion 2. Sélectionner un collaborateur 3. Consulter parcours | Données insertion visibles | ☐ |
| B-RH-06 | Matrice PCM (envoi lien test) | 1. Matrice PCM 2. Créer ou ouvrir une session 3. Récupérer lien test candidat | Lien généré, page PCM test accessible sans login | ☐ |
| B-RH-07 | Reporting RH | 1. Reporting RH 2. Vérifier indicateurs | Données ou message clair | ☐ |

---

## 4. Récapitulatif et livrables

- **Tests techniques** : exécuter le script `scripts/tests/api-smoke.js` (voir ci‑dessous) en préproduction + compléter les checklists §2.
- **Tests de comportement** : exécuter les scénarios §3 avec les comptes de test (RH, MANAGER, ADMIN, chauffeur), cocher les statuts et noter les anomalies.
- **Livrables** :
  - Rapport de recette (liste des tests passés / échoués, blocants / non blocants).
  - Liste des bugs ou écarts (ticket ou document partagé).
  - Validation « Go / No Go » déploiement signée par le chef de projet et le maître d’ouvrage.

---

## 5. Script de tests techniques (smoke API)

Un script Node exécutable est fourni : **`scripts/tests/api-smoke.js`**.

- **Prérequis** : Node.js, backend accessible (URL configurable).
- **Usage** :  
  `BASE_URL=https://recette.solidata.online node scripts/tests/api-smoke.js`  
  Optionnel : `API_USER=... API_PASSWORD=...` pour les tests authentifiés.
- **Contenu** : health check, login, GET /api/auth/me, GET /api/historique/kpi, GET /api/candidates/kanban (avec token), GET /api/tours (avec token MANAGER/ADMIN). Chaque étape affiche OK ou FAIL.

Exécuter ce script en préproduction après chaque déploiement pour valider rapidement la couche API.
