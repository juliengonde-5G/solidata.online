# Guide Utilisateur — SOLIDATA ERP

> **Pour** : Tous les utilisateurs de Solidarité Textile
> **Version** : 1.2.1 | **Date** : 24 mars 2026
>
> **Voir aussi les guides de formation par profil** :
> - [Formation Chauffeurs](FORMATION_CHAUFFEURS.md) — Guide visuel simplifié
> - [Formation Manager Collecte & Logistique](FORMATION_MANAGER_COLLECTE_LOGISTIQUE.md)
> - [Formation Manager Chaîne de Tri](FORMATION_MANAGER_CHAINE_TRI.md) — Guide pas-à-pas
> - [Formation Manager RH & Insertion](FORMATION_MANAGER_RH_INSERTION.md)

---

## Sommaire

1. [Premiers Pas](#1-premiers-pas)
2. [Navigation dans l'Application](#2-navigation)
3. [Recrutement](#3-recrutement) — Kanban, Plan de recrutement, Test PCM
4. [Gestion d'Équipe](#4-gestion-déquipe) — Collaborateurs, Heures, Insertion, Planning
5. [Collecte](#5-collecte) — Tournées, Carte CAV, GPS, Propositions IA
6. [Tri & Production](#6-tri--production) — Sessions, Stocks, Expéditions
7. [Exutoires & Logistique](#7-exutoires--logistique) — Commandes, Préparation, Pesée, Facturation, Gantt
8. [Reporting](#8-reporting) — Collecte, RH, Production, Refashion, Métropole
9. [Administration](#9-administration) — Utilisateurs, Véhicules, RGPD, Référentiels, Base de données
10. [Application Mobile](#10-application-mobile) — PWA chauffeur-collecteur
11. [FAQ](#11-faq)

---

## 1. Premiers Pas

### 1.1 Se Connecter

1. Ouvrez votre navigateur (Chrome, Firefox, Edge recommandés)
2. Accédez à **https://solidata.online**
3. Saisissez votre **nom d'utilisateur** et votre **mot de passe**
4. Cliquez sur **Connexion**

> Votre session reste active **8 heures**. Après cette durée, vous serez automatiquement reconnecté grâce au token de rafraîchissement (7 jours).

### 1.2 Rôles et Accès

Selon votre rôle, vous avez accès à différentes fonctionnalités :

| Rôle | Accès |
|------|-------|
| **ADMIN** | Tout (configuration, utilisateurs, RGPD, reporting complet) |
| **MANAGER** | Collecte, production, exutoires, plannings, reporting |
| **RH** | Recrutement, collaborateurs, insertion, compétences, heures |
| **COLLABORATEUR** | Son propre profil, ses heures, son parcours insertion |
| **AUTORITE** | Consultation des reportings uniquement |

### 1.3 Changer son Mot de Passe

Contactez un administrateur pour réinitialiser votre mot de passe. Un nouveau mot de passe temporaire vous sera communiqué.

---

## 2. Navigation

### 2.1 Menu Latéral

Le menu à gauche de l'écran est organisé en sections dépliables :

```
Accueil
  ├── Tableau de bord
  └── Fil d'actualité

Recrutement
  ├── Candidats (Kanban + Plan de recrutement)
  └── Matrice PCM

Gestion Équipe
  ├── Collaborateurs
  ├── Heures de travail
  ├── Compétences
  ├── Parcours insertion
  └── Planning hebdo

Collecte
  ├── Tournées
  ├── Propositions (IA)
  ├── Carte CAV
  ├── Remplissage CAV
  └── Suivi GPS

Tri & Production
  ├── Production
  ├── Chaînes de tri
  ├── Stock MP
  ├── Produits finis
  └── Expéditions

Exutoires
  ├── Commandes
  ├── Préparation
  ├── Gantt Chargement
  ├── Facturation
  ├── Calendrier
  ├── Clients
  └── Grille Tarifaire

Reporting
  ├── Collecte
  ├── RH
  ├── Production
  ├── Refashion
  └── Métropole Rouen

Administration
  ├── Utilisateurs
  ├── Véhicules
  ├── Configuration
  └── ...
```

Le menu peut être replié en cliquant sur le bouton en haut du menu pour gagner de l'espace sur petit écran.

### 2.2 Tableau de Bord

La page d'accueil affiche en un coup d'oeil :
- Les **tonnages collectés** (aujourd'hui, cette semaine, ce mois)
- Les **tournées en cours** et leur statut
- Les **alertes** importantes (stocks bas, retards, maintenance véhicules)
- Le **fil d'actualité** de l'équipe

---

## 3. Recrutement

### 3.1 Gestion des Candidats (Kanban)

La page Candidats présente un **tableau Kanban** avec 4 colonnes :

```
┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
│  REÇUS   │  │ENTRETIEN │  │ RECRUTÉS │  │ REFUSÉS  │
│  (bleu)  │  │ (violet) │  │  (vert)  │  │ (rouge)  │
│ ┌──────┐ │  │ ┌──────┐ │  │ ┌──────┐ │  │ ┌──────┐ │
│ │Carte │ │  │ │Carte │ │  │ │Carte │ │  │ │Carte │ │
│ │candi-│ │  │ │candi-│ │  │ │candi-│ │  │ │candi-│ │
│ │dat   │ │  │ │dat   │ │  │ │dat   │ │  │ │dat   │ │
│ └──────┘ │  │ └──────┘ │  │ └──────┘ │  │ └──────┘ │
└──────────┘  └──────────┘  └──────────┘  └──────────┘
```

Déplacez les candidats entre colonnes par **glisser-déposer** (drag & drop).

**Ajouter un candidat** :
1. Cliquez sur **+ Nouveau candidat**
2. Remplissez nom, prénom, email, téléphone, poste visé
3. Cliquez sur **Enregistrer**

**Uploader un CV** :
1. Ouvrez la fiche d'un candidat
2. Cliquez sur **Ajouter un CV**
3. Sélectionnez un fichier PDF, DOC ou DOCX (max 10 Mo)
4. Le système **analyse automatiquement** le CV et extrait les compétences détectées

**Changer le statut** :
1. Ouvrez la fiche candidat
2. Cliquez sur les boutons de statut colorés en bas de la fiche
3. L'historique du changement est automatiquement enregistré

**Convertir en employé** :
Pour un candidat au statut "Recruté", un bouton **Créer un employé** apparaît pour le basculer directement dans le module Gestion d'Équipe.

**Onglets conditionnels** :
Selon le statut du candidat, différents onglets apparaissent :
- **Reçu / Refusé** : Fiche, Historique
- **Entretien / Recruté** : Fiche, Historique, Mise en situation, Entretien structuré, PCM, Documents

### 3.2 Plan de Recrutement

1. Sur la page Candidats, cliquez sur l'onglet **Plan de recrutement** (à droite de "Kanban")
2. Le tableau affiche les **postes** en lignes et les **mois** en colonnes (6 mois glissants)
3. Saisissez le nombre de postes à pourvoir par mois
4. Le compteur affiche automatiquement : **recrutés / objectif**

### 3.3 Matrice PCM (Process Communication Model)

Le test PCM évalue le profil de personnalité des candidats à travers **20 questions** à 4 choix, réparties en 5 catégories (perception, style de management, canal de communication, motivation, stress).

**Lancer un test** :
1. Depuis la fiche candidat (onglet PCM), cliquez sur **Lancer test PCM**
2. Le candidat répond aux **20 questions** (une par une, barre de progression visible)
3. Le résultat affiche le profil complet avec **Base**, **Phase** et **Immeuble**

**Les 6 types de personnalité** :
| Type | Caractéristiques | Perception |
|------|-----------------|------------|
| **Analyseur** | Organisé, logique, responsable | Pensée factuelle |
| **Persévérant** | Engagé, observateur, consciencieux | Opinions, valeurs |
| **Empathique** | Chaleureux, sensible, compatissant | Émotions, ressenti |
| **Imagineur** | Imaginatif, calme, réfléchi | Réflexion intérieure |
| **Énergiseur** | Créatif, spontané, ludique | Réactions, humour |
| **Promoteur** | Adaptable, charmeur, persuasif | Actions, charme |

**Comprendre le résultat** :
- **Base** : votre type fondamental (stable dans le temps). C'est l'étage 1 de l'immeuble — votre fondation
- **Phase** : votre type actif actuel (peut évoluer avec les événements de vie). Détermine vos motivations et comportements sous stress
- **Immeuble PCM** : visualisation en bâtiment avec barres horizontales. La Base est toujours en bas (fondation), les autres types sont classés par intensité
- **Radar** : graphique à 6 axes montrant vos scores normalisés (0-100 %) pour chaque type

**Alertes RPS** :
Si le score de stress de votre Phase dépasse 75 %, une alerte de **Risques Psychosociaux** apparaît en rouge. Cela signale un niveau de stress élevé nécessitant attention.

**Exporter le profil** :
Depuis la page de résultats, deux boutons d'export sont disponibles :
1. **Export résultats** (vert) : génère un PDF A4 avec l'immeuble, les descriptions base/phase, le guide manager (comportements DO/DON'T), et les niveaux de stress
2. **Fiche technique** (gris) : génère un PDF A4 avec le tableau des scores bruts et le détail des 20 réponses groupées par catégorie

> Les deux exports s'ouvrent dans une fenêtre popup — utilisez **Ctrl+P** ou le bouton Imprimer pour sauvegarder en PDF.

---

## 4. Gestion d'Équipe

### 4.1 Collaborateurs

**Consulter un collaborateur** :
1. Menu → Gestion Équipe → **Collaborateurs**
2. Recherchez par nom ou filtrez par service/contrat
3. Cliquez sur une fiche pour voir les détails

**Informations disponibles** :
- Identité et coordonnées
- Type de contrat (CDI, CDD, CDDI, Stage, Alternance)
- Photo
- Compétences validées
- Historique des modifications

### 4.2 Heures de Travail

1. Menu → Gestion Équipe → **Heures de travail**
2. Sélectionnez la **semaine** souhaitée
3. Saisissez les heures par jour pour chaque collaborateur
4. Le **total hebdomadaire** et les **heures supplémentaires** se calculent automatiquement
5. Exportez en Excel si nécessaire

### 4.3 Compétences

1. Menu → Gestion Équipe → **Compétences**
2. Consultez la **matrice compétences × collaborateurs**
3. Référentiel de compétences : tri, collecte, mécanique, bureautique, etc.
4. Affectez des **niveaux** par collaborateur (débutant, intermédiaire, confirmé, expert)
5. Vue croisée pour identifier les forces et lacunes de l'équipe

### 4.4 Parcours Insertion (CDDI)

Pour les salariés en Contrat à Durée Déterminée d'Insertion :

**Créer un parcours** :
1. Menu → Gestion Équipe → **Parcours insertion**
2. Cliquez sur **Nouveau parcours**
3. Sélectionnez le salarié CDDI
4. Réalisez le **diagnostic initial** (évaluation des 7 freins périphériques)

**Les 7 freins périphériques** :
Le système évalue automatiquement les freins à l'emploi sur un radar :
- Logement, Mobilité, Santé, Administratif, Financier, Familial, Justice
- Notation de 1 (frein fort) à 5 (aucun frein)
- Visualisation en **graphique radar** pour identifier rapidement les points bloquants

**3 jalons obligatoires** :
Le parcours est jalonné de 3 évaluations planifiées automatiquement :
- **M1** (1 mois) : première évaluation — le salarié s'adapte-t-il ?
- **M6** (6 mois) : bilan intermédiaire — progression sur les freins
- **M12** (12 mois) : bilan final — objectifs atteints ?
Des alertes automatiques rappellent au CIP quand un jalon approche.

**Plans d'action CIP** :
Le Conseiller en Insertion Professionnelle peut définir des actions correctives pour chaque frein identifié (ex : aide au permis pour le frein mobilité, accompagnement Pôle emploi pour le frein administratif).

**Suivi de progression** :
- Un graphique montre l'**évolution des notes** dans le temps
- Les objectifs atteints sont marqués en vert
- Le bilan final est exportable pour les partenaires (DREETS, Conseil Départemental)

### 4.4 Planning Hebdomadaire

1. Menu → Gestion Équipe → **Planning hebdo**
2. Sélectionnez la semaine
3. Glissez-déposez les collaborateurs dans les créneaux
4. Les **conflits** (même personne affectée deux fois) sont signalés en rouge

---

## 5. Collecte

### 5.1 Tournées

**Créer une tournée** :
1. Menu → Collecte → **Tournées**
2. Cliquez sur **Nouvelle tournée**
3. Sélectionnez :
   - Le **chauffeur**
   - Le **véhicule**
   - Les **CAVs** (containers) à collecter
4. Définissez la **date**
5. Enregistrez

**Suivre une tournée en cours** :
- La tournée passe par les statuts : **Planifiée → En cours → Terminée**
- Le chauffeur terrain met à jour le statut depuis l'application mobile

### 5.2 Carte CAV

1. Menu → Collecte → **Carte CAV**
2. La carte Leaflet affiche tous les containers de collecte de la métropole
3. Les marqueurs sont colorés selon le taux de remplissage :
   - Vert : < 50 % (pas urgent)
   - Orange : 50-80 % (à planifier)
   - Rouge : > 80 % (urgent)
4. Cliquez sur un marqueur pour voir les détails et l'historique

### 5.3 Suivi GPS

1. Menu → Collecte → **Suivi GPS**
2. La carte affiche en temps réel la position de tous les véhicules en tournée
3. Les positions sont mises à jour **toutes les 10 secondes**
4. Cliquez sur un véhicule pour voir : chauffeur, tournée, vitesse, dernier point collecté

### 5.4 Propositions IA

Le moteur prédictif analyse les données historiques et le remplissage actuel pour **proposer des tournées optimisées** :
- Priorisation des CAVs les plus pleins
- Optimisation des trajets (distance minimale)
- Prise en compte des jours de collecte habituels

---

## 6. Tri & Production

### 6.1 Sessions de Production

**Démarrer une session** :
1. Menu → Tri & Production → **Production**
2. Cliquez sur **Nouvelle session**
3. Sélectionnez la **chaîne de tri** et les **opérateurs**
4. Au fur et à mesure du tri, saisissez les **poids par catégorie** :
   - Bon état (réemploi → boutiques Frip & Co)
   - Recyclable (effilochage, CSR)
   - Déchets (non valorisable)
5. Clôturez la session en fin de journée

**Catégories textiles** :
| Catégorie | Destination |
|-----------|-------------|
| Original (bon état) | Réemploi / Boutiques Frip & Co |
| CSR (Combustible Solide de Récupération) | Valorisation énergétique |
| Effiloché blanc | Recyclage fibre |
| Effiloché couleur | Recyclage fibre |
| Jean | Recyclage / Isolation |
| Coton blanc | Recyclage chiffon industriel |
| Coton couleur | Recyclage chiffon industriel |

### 6.2 Gestion des Stocks

1. Menu → Tri & Production → **Stock MP** ou **Produits finis**
2. Consultez les niveaux de stock par catégorie
3. Les mouvements (entrées/sorties) sont tracés automatiquement
4. Les **alertes stock bas** apparaissent sur le dashboard quand un seuil est atteint

---

## 7. Exutoires & Logistique

### 7.1 Clients

1. Menu → Exutoires → **Clients**
2. Créez ou consultez les fiches clients exutoires
3. Types de clients :
   - **Recycleur** : traitement matière
   - **Négociant** : revente en gros
   - **Industriel** : utilisation directe (chiffons, isolation)
   - **Autre**

### 7.2 Commandes

**Créer une commande** :
1. Menu → Exutoires → **Commandes**
2. Cliquez sur **Nouvelle commande**
3. Sélectionnez le **client**
4. Ajoutez les **produits** (type textile + quantité en tonnes)
5. Le **tarif** s'applique automatiquement depuis la grille tarifaire
6. Choisissez la **fréquence** : unique, hebdomadaire, bi-mensuelle, mensuelle
7. Enregistrez

**Suivi de commande** :
La commande passe par 8 statuts :

```
en_attente → confirmée → en_préparation → chargée → expédiée
                                                        ↓
                                           pesée_reçue → facturée → clôturée
```

Chaque changement de statut est tracé avec date et utilisateur.

### 7.3 Préparation d'Expédition

1. Menu → Exutoires → **Préparation**
2. Sélectionnez une commande confirmée
3. Définissez :
   - **Localisation** : quai de chargement, garage remorque, ou cours
   - **Équipe** : affectez les collaborateurs
4. Suivez la timeline :
   - Heure de réception de la remorque
   - Début du chargement
   - Fin du chargement
   - Heure de départ
5. Saisissez la **pesée interne** avant expédition

### 7.4 Contrôle de Pesée

Quand le client confirme le poids reçu :

1. Menu → Exutoires → **Commandes** → Commande concernée
2. Saisissez la **pesée du client**
3. Le système compare avec la pesée interne :
   - **Conforme** : écart < 2 %
   - **Écart acceptable** : 2-5 %
   - **Litige** : écart > 5 % → investigation nécessaire

### 7.5 Facturation

1. Menu → Exutoires → **Facturation**
2. Pour les commandes expédiées et pesées :
   - **Uploadez** la facture du client (PDF)
   - Le système effectue une **extraction OCR** automatique (montant, date, référence)
   - Vérifiez et validez le rapprochement

### 7.6 Calendrier Logistique

1. Menu → Exutoires → **Calendrier**
2. Vue mensuelle/hebdomadaire des commandes et expéditions prévues
3. **Alertes automatiques** :
   - Surcharge (trop de commandes une même semaine)
   - Préparation manquante (commande confirmée sans préparation)
   - Stock insuffisant pour honorer une commande

### 7.7 Gantt Chargement

1. Menu → Exutoires → **Gantt Chargement**
2. Planning visuel des chargements de la semaine
3. Identifiez les conflits de quai ou les chevauchements

### 7.8 Grille Tarifaire

1. Menu → Exutoires → **Grille Tarifaire**
2. Configurez les **prix par tonne** pour chaque client et chaque type de produit
3. Ces tarifs sont automatiquement appliqués lors de la création des commandes

---

## 8. Reporting

### 8.1 Types de Rapports

| Rapport | Données | Usage |
|---------|---------|-------|
| **Collecte** | Tonnages, nb tournées, rendement/tournée, évolution | Suivi opérationnel |
| **RH** | Effectif, turnover, heures, % insertion, compétences | Pilotage social |
| **Production** | Rendement tri, catégories, productivité/chaîne | Performance tri |
| **Refashion** | Données réglementaires éco-organisme | Reporting obligatoire |
| **Métropole Rouen** | Reporting collectivité territoriale | Convention territoriale |

### 8.2 Utiliser un Rapport

1. Menu → Reporting → Choisissez le type
2. Sélectionnez la **période** (jour, semaine, mois, année, personnalisée)
3. Consultez les **graphiques interactifs** (barres, lignes, camemberts)
4. Survolez les graphiques pour voir les valeurs précises
5. Cliquez sur **Exporter Excel** pour télécharger les données brutes

---

## 9. Administration

### 9.1 Gestion des Utilisateurs

*Réservé aux ADMIN*

1. Menu → Administration → **Utilisateurs**
2. **Créer un compte** : nom d'utilisateur + mot de passe + rôle
3. **Modifier** : changer le rôle ou réinitialiser le mot de passe
4. **Désactiver** : bloquer l'accès sans supprimer le compte

### 9.2 Véhicules

1. Menu → Administration → **Véhicules**
2. Gérez la flotte : immatriculation, type, kilométrage
3. Planifiez les **maintenances** : un véhicule en maintenance est indisponible pour les tournées

### 9.3 Véhicules et Maintenance

1. Menu → Administration → **Véhicules**
2. Gérez la flotte : immatriculation, type, kilométrage, tare (poids à vide)
3. Planifiez les **maintenances** : contrôle technique, vidange, pneus, freins
4. Un véhicule en maintenance est automatiquement **indisponible** pour les tournées
5. Des **alertes automatiques** rappellent les échéances de maintenance (km ou date)

### 9.4 RGPD

*Réservé aux ADMIN et RH*

- **Registre des traitements** : liste de tous les traitements de données personnelles
- **Export données** : exporter toutes les données d'un candidat ou employé (droit d'accès RGPD Art. 15)
- **Anonymisation** : supprimer les données personnelles d'une personne (droit à l'oubli RGPD Art. 17) — noms remplacés par "ANONYME", fichiers supprimés, dans une transaction ACID
- **Journal d'audit** : consulter l'historique de toutes les actions RGPD
- **Purge automatique** : les données de plus de 24 mois peuvent être purgées automatiquement

### 9.5 Fil d'Actualité

1. Menu → Accueil → **Fil d'actualité**
2. Publiez des articles pour toute l'équipe (texte libre, catégorisable)
3. Les articles peuvent être **épinglés** pour rester en haut du fil
4. Visible par tous les rôles

### 9.6 Référentiels

*Réservé aux ADMIN*

1. Menu → Administration → **Référentiels**
2. Gérez les données de base partagées :
   - Associations partenaires
   - Exutoires (destinataires produits triés)
   - Catalogue produits
   - Types de conteneurs
   - Postes de travail

### 9.7 Base de Données

*Réservé aux ADMIN*

1. Menu → Administration → **Base de données**
2. Outils de maintenance :
   - **Backup** : lancer une sauvegarde manuelle
   - **Restauration** : restaurer depuis un backup
   - **VACUUM** : optimiser les performances PostgreSQL
   - **Statistiques** : voir la taille des tables, nombre de lignes

---

## 10. Application Mobile

### 10.1 Installation

1. Ouvrez **Chrome** sur votre smartphone Android
2. Accédez à **https://m.solidata.online**
3. Connectez-vous
4. Chrome proposera d'**ajouter à l'écran d'accueil** → Acceptez
5. L'application s'installe comme une app classique

### 10.2 Effectuer une Tournée

**Étape 1 — Connexion et sélection**
1. Ouvrez l'app SOLIDATA Mobile
2. Connectez-vous avec vos identifiants
3. Sélectionnez votre **véhicule** et la **tournée du jour**

**Étape 2 — Checklist sécurité**
Avant de démarrer, cochez les 10 points de contrôle :
- Papiers du véhicule
- Permis de conduire
- Gilet de sécurité
- Chaussures de sécurité
- Feux et clignotants
- Pneumatiques
- Niveaux (huile, liquide refroidissement)
- Propreté cabine
- Extincteur
- Trousse de secours

> Tous les items doivent être cochés pour démarrer la tournée.

**Étape 3 — Collecte des containers**
Pour chaque container (CAV) de la tournée :

1. **Scanner le QR code** du container avec la caméra
   - Si le QR est illisible → appuyez sur **QR indisponible** et saisissez le code manuellement
2. **Évaluer le remplissage** (0 %, 25 %, 50 %, 75 %, 100 %)
3. **Signaler une anomalie** si nécessaire (débordement, dégradation, accès bloqué)
4. Passez au container suivant

**Étape 4 — Incidents**
En cas de problème pendant la tournée :
1. Appuyez sur le bouton **Incident**
2. Choisissez le type : panne véhicule, accident, problème container, environnement, autre
3. Décrivez le problème
4. Enregistrez

**Étape 5 — Retour au centre**
1. Appuyez sur **Retour centre**
2. Confirmez votre retour
3. Saisissez le **kilométrage** au compteur

**Étape 6 — Pesée**
1. Pesez le chargement (tare + brut)
2. Saisissez les valeurs
3. Le **poids net** se calcule automatiquement

**Étape 7 — Résumé**
L'écran final affiche le bilan de votre tournée :
- Nombre de containers collectés
- Poids total collecté
- Distance parcourue
- Durée de la tournée
- CO₂ économisé (chaque kg de textile collecté évite 1,493 kg de CO₂)

### 10.3 Fonctionnement Hors Ligne

L'application conserve vos données en mémoire si vous perdez temporairement le réseau. Lorsque la connexion revient, les données se synchronisent automatiquement.

> Attention : une coupure prolongée (> 30 min) peut nécessiter de ressaisir les dernières données.

### 10.4 Conseils Terrain

- **Soleil / reflets** : inclinez le téléphone pour éviter les reflets sur le QR code
- **Pluie** : protégez le téléphone, le scan QR fonctionne sous la pluie légère
- **Gants** : retirez vos gants pour l'écran tactile, ou utilisez des gants compatibles tactiles
- **Batterie** : le GPS consomme de la batterie — branchez le téléphone dans le véhicule

---

## 11. FAQ

### Connexion

**Q : J'ai oublié mon mot de passe**
R : Contactez un administrateur pour le réinitialiser.

**Q : Ma session a expiré**
R : Reconnectez-vous. Si le problème persiste, videz le cache du navigateur.

### Recrutement

**Q : Le CV n'est pas parsé correctement**
R : Seuls les PDF texte sont bien analysés. Les CV scannés (images) ont une extraction limitée. Privilégiez les CV au format texte.

**Q : Je ne vois pas l'onglet "Plan de recrutement"**
R : Vérifiez que vous êtes bien sur la page Candidats. L'onglet est à côté de "Kanban" en haut de la page.

### Collecte

**Q : Le QR code ne scanne pas**
R : Vérifiez la luminosité, nettoyez le QR s'il est sale. En dernier recours, utilisez "QR indisponible" pour saisir le code manuellement.

**Q : Le GPS ne fonctionne pas**
R : Autorisez la géolocalisation dans les paramètres du navigateur. Vérifiez que vous êtes en extérieur (le GPS fonctionne mal en intérieur).

### Exutoires

**Q : Comment créer une commande récurrente ?**
R : Lors de la création, choisissez la fréquence "Hebdomadaire", "Bi-mensuelle" ou "Mensuelle". Les commandes suivantes seront générées automatiquement.

**Q : L'OCR de la facture n'est pas précis**
R : L'OCR fonctionne mieux avec des factures numériques (PDF texte). Les factures scannées ou en biais donnent des résultats moins précis. Vérifiez et corrigez manuellement si nécessaire.

### Mobile

**Q : L'app ne s'installe pas sur mon téléphone**
R : Utilisez Chrome (pas Firefox ou Samsung Internet). Allez sur m.solidata.online et acceptez la proposition "Ajouter à l'écran d'accueil".

**Q : Les données sont perdues hors ligne**
R : Les données sont conservées en mémoire locale. Assurez-vous de ne pas fermer l'application pendant une coupure réseau.

---

## Support

En cas de problème technique :
1. Vérifiez cette FAQ
2. Contactez votre administrateur SOLIDATA
3. Signalez les bugs avec une capture d'écran et la description du problème

---

*Guide utilisateur SOLIDATA ERP v1.2.0 — Solidarité Textile, Rouen — 19 mars 2026*
