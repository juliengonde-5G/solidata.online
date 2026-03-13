# Cahier des Charges — Module Logistique des Exutoires

**Version :** 1.0
**Date :** 2026-03-13
**Projet :** SOLIDATA.online
**Module :** Logistique des Exutoires

---

## 1. Contexte et Objectifs

### 1.1 Contexte métier

SOLIDATA gère 3 flux de sortie (exutoires) :

| Flux | Description | Conditionnement |
|------|-------------|-----------------|
| **Original** | Brut de collecte (matière première). Part soit en chaîne de tri, soit en vente directe | Vrac ou balles |
| **CSR** (Combustible Solide de Récupération) | Rebut de la chaîne de tri, conditionné en curons | Curons |
| **Produits finis curons** | Produits issus du recyclage ne pouvant pas aller en réutilisation | Curons |

**Types de produits vendus :** Original, CSR, Effilo Blanc, Effilo Couleur, Jean, Coton Blanc, Coton Couleur.

### 1.2 Objectifs du module

- Gérer le cycle complet d'une sortie d'exutoire : commande → préparation → chargement → facturation
- Planifier l'occupation des lieux de chargement (diagramme de Gantt)
- Intégrer les tâches logistiques dans le planning collaborateurs
- Mettre à jour automatiquement les stocks via les pesées
- Générer un calendrier prévisionnel d'activité logistique

---

## 2. Périmètre fonctionnel

### 2.1 Cycle de vie d'une sortie d'exutoire

```
COMMANDE → PRÉPARATION → CHARGEMENT → EXPÉDIÉ → PESÉE CLIENT → FACTURÉ → CLÔTURÉ
```

Chaque sortie passe par ces statuts séquentiels. Un statut `ANNULÉ` est possible à tout moment avant `EXPÉDIÉ`.

---

## 3. Spécifications fonctionnelles détaillées

### 3.1 Module Commandes Clients

#### 3.1.1 Création de commande

| Champ | Type | Obligatoire | Description |
|-------|------|-------------|-------------|
| `reference` | String | Auto | Référence auto-générée : `CMD-YYYY-NNNN` |
| `client_id` | FK → clients | Oui | Client destinataire |
| `type_produit` | Enum | Oui | Original / CSR / Effilo Blc / Effilo Couleur / Jean / Coton Blanc / Coton Couleur |
| `date_commande` | Date | Oui | Date de la commande |
| `prix_tonne` | Decimal | Oui | Prix de vente à la tonne (pré-rempli depuis grille, ajustable) |
| `tonnage_prevu` | Decimal | Non | Tonnage estimé de la commande |
| `frequence` | Enum | Oui | `unique` / `hebdomadaire` / `bi_mensuel` / `mensuel` |
| `date_fin_recurrence` | Date | Non | Date de fin pour les commandes récurrentes |
| `notes` | Text | Non | Observations libres |
| `statut` | Enum | Auto | `en_attente` / `confirmee` / `en_preparation` / `chargee` / `expediee` / `facturee` / `cloturee` / `annulee` |

#### 3.1.2 Gestion des clients (nouveau référentiel)

| Champ | Type | Obligatoire | Description |
|-------|------|-------------|-------------|
| `id` | Serial | Auto | Identifiant unique |
| `raison_sociale` | String | Oui | Nom de l'entreprise |
| `siret` | String(14) | Non | N° SIRET |
| `adresse` | String | Oui | Adresse postale |
| `code_postal` | String(5) | Oui | Code postal |
| `ville` | String | Oui | Ville |
| `contact_nom` | String | Oui | Nom du contact principal |
| `contact_email` | String | Oui | Email de contact |
| `contact_telephone` | String | Non | Téléphone |
| `type_client` | Enum | Oui | `recycleur` / `negociant` / `industriel` / `autre` |
| `actif` | Boolean | Auto | Défaut : true |

#### 3.1.3 Grille tarifaire

La table `grille_tarifaire` existante sera étendue pour supporter les prix négociés par client :

| Champ | Type | Description |
|-------|------|-------------|
| `id` | Serial | Identifiant |
| `type_produit` | Enum | Type de produit |
| `prix_reference_tonne` | Decimal | Prix de référence (grille de base) |
| `client_id` | FK → clients | NULL = prix par défaut, sinon prix négocié |
| `date_debut` | Date | Date de début de validité |
| `date_fin` | Date | Date de fin de validité (NULL = en cours) |

**Logique de résolution du prix :**
1. Chercher un prix spécifique client + produit valide à la date
2. Si absent, utiliser le prix de référence du produit
3. L'utilisateur peut toujours modifier manuellement le prix sur la commande

#### 3.1.4 Commandes récurrentes

Pour les commandes à fréquence non-unique :
- Le système génère automatiquement les commandes filles à chaque échéance
- Génération anticipée : 2 semaines avant la date prévue
- Chaque commande fille est indépendante et modifiable
- La commande mère conserve un lien `commande_parent_id`
- Possibilité de suspendre ou arrêter la récurrence

---

### 3.2 Module Préparation Expédition

#### 3.2.1 Fiche de préparation

| Champ | Type | Obligatoire | Description |
|-------|------|-------------|-------------|
| `commande_id` | FK → commandes | Oui | Commande associée |
| `transporteur` | String | Oui | Nom du transporteur |
| `date_livraison_remorque` | DateTime | Oui | Date et heure de livraison de la remorque |
| `date_expedition` | DateTime | Oui | Date et heure d'expédition prévue |
| `lieu_chargement` | Enum | Oui | `quai_chargement` / `garage_remorque` / `cours` |
| `collaborateurs_assignes` | Array FK → employees | Oui | Collaborateurs affectés au chargement |
| `pesee_interne` | Decimal | Non | Pesée avant départ (en tonnes) |
| `notes_preparation` | Text | Non | Instructions spéciales |
| `statut_preparation` | Enum | Auto | `planifiee` / `remorque_livree` / `en_chargement` / `prete` / `expediee` |

#### 3.2.2 Contraintes lieu de chargement

3 emplacements physiques avec capacité 1 remorque chacun :

| Lieu | Code | Capacité |
|------|------|----------|
| Quai de chargement | `quai_chargement` | 1 remorque |
| Garage remorque | `garage_remorque` | 1 remorque |
| Cours | `cours` | 1 remorque |

**Règle métier :** Aucun chevauchement autorisé sur un même lieu. La plage d'occupation = `date_livraison_remorque` → `date_expedition`.

---

### 3.3 Module Chargement

#### 3.3.1 Processus de chargement

1. **Réception remorque** : Le transporteur livre la remorque → statut `remorque_livree`
2. **Début chargement** : Les collaborateurs commencent → statut `en_chargement`
3. **Fin chargement** : Pesée interne effectuée → statut `prete`
4. **Départ** : Le transporteur part avec la remorque → statut `expediee`

À chaque changement de statut, l'horodatage est enregistré.

#### 3.3.2 Impact stock — Étape 1 : Déstockage provisoire

Lorsque le statut passe à `expediee` :
- Création d'un mouvement de stock de type `sortie` avec origine `exutoire`
- Quantité = `pesee_interne`
- Statut du mouvement = `provisoire`
- Le stock global est décrémenté de la pesée interne

---

### 3.4 Module Facturation & Contrôle Pesée

#### 3.4.1 Contrôle pesée client

Après réception par le client, un ticket de pesée séparé est envoyé :

| Champ | Type | Description |
|-------|------|-------------|
| `commande_id` | FK | Commande associée |
| `pesee_client` | Decimal | Poids constaté par le client (tonnes) |
| `ecart_pesee` | Decimal | Auto : `pesee_interne - pesee_client` |
| `ecart_pourcentage` | Decimal | Auto : `(ecart / pesee_interne) × 100` |
| `ticket_pesee_pdf` | String (path) | Fichier PDF du ticket de pesée |
| `date_reception_ticket` | Date | Date de réception du ticket |
| `statut_controle` | Enum | `conforme` (écart ≤ 2%) / `ecart_acceptable` (2-5%) / `litige` (> 5%) |

**Seuils d'écart :**
- ≤ 2% : Conforme → validation automatique
- 2-5% : Écart acceptable → alerte, validation manuelle requise
- \> 5% : Litige → blocage, action managériale requise

#### 3.4.2 Impact stock — Étape 2 : Ajustement définitif

Lorsque le contrôle pesée est validé :
- Le mouvement de stock `provisoire` passe en `definitif`
- La quantité est ajustée à la `pesee_client` (valeur de référence pour la facturation)
- Si écart, un mouvement correctif est créé pour traçabilité

#### 3.4.3 Facturation

| Champ | Type | Description |
|-------|------|-------------|
| `commande_id` | FK | Commande associée |
| `facture_pdf` | String (path) | Fichier PDF de la facture client |
| `ocr_date` | Date | Date extraite par OCR |
| `ocr_tonnage` | Decimal | Tonnage extrait par OCR |
| `ocr_montant` | Decimal | Montant extrait par OCR |
| `montant_attendu` | Decimal | Auto : `pesee_client × prix_tonne` |
| `ecart_montant` | Decimal | Auto : `ocr_montant - montant_attendu` |
| `statut_facture` | Enum | `recue` / `conforme` / `ecart` / `validee` |

#### 3.4.4 Lecture OCR des factures PDF

**Technologie :** Tesseract.js (extraction texte) + expressions régulières pour parser :
- **Date** : formats `DD/MM/YYYY`, `DD-MM-YYYY`, `YYYY-MM-DD`
- **Tonnage** : nombre décimal suivi de `t`, `T`, `tonne(s)`, `kg` (converti)
- **Montant** : nombre décimal suivi de `€`, `EUR`, précédé de `Total`, `Montant`, `Net à payer`

L'utilisateur peut toujours corriger les valeurs extraites manuellement.

---

### 3.5 Planning Gantt — Occupation des lieux de chargement

#### 3.5.1 Vue Gantt

- **Axe Y** : Les 3 lieux de chargement (Quai / Garage / Cours)
- **Axe X** : Échelle temporelle (jour, semaine, mois)
- **Barres** : Chaque préparation/expédition est une barre colorée
  - Couleur par type de produit
  - Durée = `date_livraison_remorque` → `date_expedition`
- **Interactions** :
  - Clic sur une barre → détail de la commande
  - Drag & drop pour déplacer une réservation (avec contrôle de conflit)
  - Zoom jour/semaine/mois
- **Alertes visuelles** : Conflit d'occupation en rouge

#### 3.5.2 Données affichées par barre

- Référence commande
- Client
- Type de produit
- Transporteur
- Statut actuel (code couleur)

---

### 3.6 Planning Collaborateurs Logistique

#### 3.6.1 Intégration au planning existant

Le module s'intègre dans le planning collaborateurs existant (table `schedule`) :

- **Type d'activité ajouté :** `chargement_exutoire`
- **Données associées :**
  - Référence de la commande
  - Lieu de chargement
  - Créneau horaire (début chargement → fin chargement estimée)

#### 3.6.2 Affectation automatique

Quand une préparation est créée avec des collaborateurs assignés :
- Les créneaux sont automatiquement inscrits dans le planning
- Vérification de conflit avec les activités existantes (tri, collecte, etc.)
- Notification aux collaborateurs concernés

L'équipe logistique est composée de 2-3 collaborateurs polyvalents, sans rôles distincts.

---

### 3.7 Calendrier prévisionnel d'activité

#### 3.7.1 Génération automatique

À partir des commandes enregistrées (uniques + récurrentes), le système génère un calendrier prévisionnel :

- **Vue mensuelle** avec les expéditions prévues
- **Vue hebdomadaire** détaillée
- **Indicateurs :**
  - Nombre d'expéditions par semaine
  - Tonnage prévu par semaine/mois
  - Chiffre d'affaires prévisionnel (tonnage × prix)
  - Taux d'occupation des lieux de chargement (%)
  - Charge de travail collaborateurs (heures prévues)

#### 3.7.2 Alertes prévisionnelles

- Surcharge d'un lieu de chargement (> 80% occupation sur une semaine)
- Semaine sans expédition planifiée
- Stock insuffisant pour honorer une commande à venir (comparaison stock actuel vs tonnage prévu)
- Collaborateurs insuffisants pour les chargements prévus

---

## 4. Modèle de données

### 4.1 Nouvelles tables

```sql
-- Référentiel clients exutoires
CREATE TABLE clients_exutoires (
    id SERIAL PRIMARY KEY,
    raison_sociale VARCHAR(255) NOT NULL,
    siret VARCHAR(14),
    adresse TEXT NOT NULL,
    code_postal VARCHAR(5) NOT NULL,
    ville VARCHAR(100) NOT NULL,
    contact_nom VARCHAR(100) NOT NULL,
    contact_email VARCHAR(255) NOT NULL,
    contact_telephone VARCHAR(20),
    type_client VARCHAR(20) NOT NULL DEFAULT 'recycleur'
        CHECK (type_client IN ('recycleur', 'negociant', 'industriel', 'autre')),
    actif BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Grille tarifaire étendue (prix négociés par client)
CREATE TABLE tarifs_exutoires (
    id SERIAL PRIMARY KEY,
    type_produit VARCHAR(30) NOT NULL
        CHECK (type_produit IN ('original', 'csr', 'effilo_blanc', 'effilo_couleur', 'jean', 'coton_blanc', 'coton_couleur')),
    prix_reference_tonne DECIMAL(10,2) NOT NULL,
    client_id INTEGER REFERENCES clients_exutoires(id),
    date_debut DATE NOT NULL,
    date_fin DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Commandes exutoires
CREATE TABLE commandes_exutoires (
    id SERIAL PRIMARY KEY,
    reference VARCHAR(20) NOT NULL UNIQUE,
    client_id INTEGER NOT NULL REFERENCES clients_exutoires(id),
    type_produit VARCHAR(30) NOT NULL
        CHECK (type_produit IN ('original', 'csr', 'effilo_blanc', 'effilo_couleur', 'jean', 'coton_blanc', 'coton_couleur')),
    date_commande DATE NOT NULL,
    prix_tonne DECIMAL(10,2) NOT NULL,
    tonnage_prevu DECIMAL(10,3),
    frequence VARCHAR(20) NOT NULL DEFAULT 'unique'
        CHECK (frequence IN ('unique', 'hebdomadaire', 'bi_mensuel', 'mensuel')),
    date_fin_recurrence DATE,
    commande_parent_id INTEGER REFERENCES commandes_exutoires(id),
    notes TEXT,
    statut VARCHAR(20) NOT NULL DEFAULT 'en_attente'
        CHECK (statut IN ('en_attente', 'confirmee', 'en_preparation', 'chargee', 'expediee', 'pesee_recue', 'facturee', 'cloturee', 'annulee')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Préparations expédition
CREATE TABLE preparations_expedition (
    id SERIAL PRIMARY KEY,
    commande_id INTEGER NOT NULL REFERENCES commandes_exutoires(id),
    transporteur VARCHAR(255) NOT NULL,
    date_livraison_remorque TIMESTAMP NOT NULL,
    date_expedition TIMESTAMP NOT NULL,
    lieu_chargement VARCHAR(20) NOT NULL
        CHECK (lieu_chargement IN ('quai_chargement', 'garage_remorque', 'cours')),
    pesee_interne DECIMAL(10,3),
    notes_preparation TEXT,
    statut_preparation VARCHAR(20) NOT NULL DEFAULT 'planifiee'
        CHECK (statut_preparation IN ('planifiee', 'remorque_livree', 'en_chargement', 'prete', 'expediee')),
    heure_reception_remorque TIMESTAMP,
    heure_debut_chargement TIMESTAMP,
    heure_fin_chargement TIMESTAMP,
    heure_depart TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Collaborateurs assignés aux préparations
CREATE TABLE preparation_collaborateurs (
    id SERIAL PRIMARY KEY,
    preparation_id INTEGER NOT NULL REFERENCES preparations_expedition(id) ON DELETE CASCADE,
    employee_id INTEGER NOT NULL REFERENCES employees(id),
    UNIQUE(preparation_id, employee_id)
);

-- Contrôle pesée client
CREATE TABLE controles_pesee (
    id SERIAL PRIMARY KEY,
    commande_id INTEGER NOT NULL REFERENCES commandes_exutoires(id),
    pesee_client DECIMAL(10,3) NOT NULL,
    ecart_pesee DECIMAL(10,3),
    ecart_pourcentage DECIMAL(5,2),
    ticket_pesee_pdf VARCHAR(500),
    date_reception_ticket DATE NOT NULL,
    statut_controle VARCHAR(20) NOT NULL DEFAULT 'conforme'
        CHECK (statut_controle IN ('conforme', 'ecart_acceptable', 'litige', 'valide')),
    validee_par INTEGER REFERENCES users(id),
    date_validation TIMESTAMP,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Factures exutoires (contrôle OCR)
CREATE TABLE factures_exutoires (
    id SERIAL PRIMARY KEY,
    commande_id INTEGER NOT NULL REFERENCES commandes_exutoires(id),
    facture_pdf VARCHAR(500),
    ocr_date DATE,
    ocr_tonnage DECIMAL(10,3),
    ocr_montant DECIMAL(12,2),
    montant_attendu DECIMAL(12,2),
    ecart_montant DECIMAL(12,2),
    statut_facture VARCHAR(20) NOT NULL DEFAULT 'recue'
        CHECK (statut_facture IN ('recue', 'conforme', 'ecart', 'validee')),
    validee_par INTEGER REFERENCES users(id),
    date_validation TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Historique des statuts (audit trail)
CREATE TABLE historique_commandes_exutoires (
    id SERIAL PRIMARY KEY,
    commande_id INTEGER NOT NULL REFERENCES commandes_exutoires(id),
    ancien_statut VARCHAR(20),
    nouveau_statut VARCHAR(20) NOT NULL,
    utilisateur_id INTEGER REFERENCES users(id),
    commentaire TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 4.2 Index

```sql
CREATE INDEX idx_commandes_exutoires_client ON commandes_exutoires(client_id);
CREATE INDEX idx_commandes_exutoires_statut ON commandes_exutoires(statut);
CREATE INDEX idx_commandes_exutoires_date ON commandes_exutoires(date_commande);
CREATE INDEX idx_commandes_exutoires_type ON commandes_exutoires(type_produit);
CREATE INDEX idx_commandes_exutoires_parent ON commandes_exutoires(commande_parent_id);
CREATE INDEX idx_preparations_lieu_dates ON preparations_expedition(lieu_chargement, date_livraison_remorque, date_expedition);
CREATE INDEX idx_preparations_commande ON preparations_expedition(commande_id);
CREATE INDEX idx_controles_commande ON controles_pesee(commande_id);
CREATE INDEX idx_factures_commande ON factures_exutoires(commande_id);
CREATE INDEX idx_tarifs_produit_client ON tarifs_exutoires(type_produit, client_id, date_debut);
CREATE INDEX idx_historique_commande ON historique_commandes_exutoires(commande_id);
```

---

## 5. Architecture technique

### 5.1 Backend — Nouvelles routes API

| Route | Méthode | Description | Rôles |
|-------|---------|-------------|-------|
| `/api/clients-exutoires` | GET | Lister les clients | ADMIN, MANAGER |
| `/api/clients-exutoires` | POST | Créer un client | ADMIN, MANAGER |
| `/api/clients-exutoires/:id` | PUT | Modifier un client | ADMIN, MANAGER |
| `/api/clients-exutoires/:id` | DELETE | Désactiver un client | ADMIN |
| `/api/tarifs-exutoires` | GET | Lister la grille tarifaire | ADMIN, MANAGER |
| `/api/tarifs-exutoires` | POST | Ajouter un tarif | ADMIN, MANAGER |
| `/api/tarifs-exutoires/:id` | PUT | Modifier un tarif | ADMIN, MANAGER |
| `/api/tarifs-exutoires/prix` | GET | Résoudre le prix (client + produit + date) | ADMIN, MANAGER |
| `/api/commandes-exutoires` | GET | Lister les commandes (filtres : statut, client, produit, période) | ADMIN, MANAGER |
| `/api/commandes-exutoires` | POST | Créer une commande | ADMIN, MANAGER |
| `/api/commandes-exutoires/:id` | GET | Détail d'une commande | ADMIN, MANAGER |
| `/api/commandes-exutoires/:id` | PUT | Modifier une commande | ADMIN, MANAGER |
| `/api/commandes-exutoires/:id/statut` | PATCH | Changer le statut | ADMIN, MANAGER |
| `/api/commandes-exutoires/:id/annuler` | PATCH | Annuler une commande | ADMIN, MANAGER |
| `/api/preparations` | GET | Lister les préparations (filtres : lieu, date, statut) | ADMIN, MANAGER |
| `/api/preparations` | POST | Créer une préparation | ADMIN, MANAGER |
| `/api/preparations/:id` | PUT | Modifier une préparation | ADMIN, MANAGER |
| `/api/preparations/:id/statut` | PATCH | Changer le statut de préparation | ADMIN, MANAGER |
| `/api/preparations/gantt` | GET | Données Gantt (par période) | ADMIN, MANAGER |
| `/api/preparations/conflits` | GET | Vérifier conflits lieu de chargement | ADMIN, MANAGER |
| `/api/controles-pesee` | POST | Enregistrer un contrôle pesée | ADMIN, MANAGER |
| `/api/controles-pesee/:id/valider` | PATCH | Valider un contrôle | ADMIN, MANAGER |
| `/api/factures-exutoires` | POST | Upload et OCR d'une facture | ADMIN, MANAGER |
| `/api/factures-exutoires/:id` | PUT | Corriger les données OCR | ADMIN, MANAGER |
| `/api/factures-exutoires/:id/valider` | PATCH | Valider une facture | ADMIN, MANAGER |
| `/api/calendrier-logistique` | GET | Calendrier prévisionnel (période) | ADMIN, MANAGER |
| `/api/calendrier-logistique/alertes` | GET | Alertes prévisionnelles | ADMIN, MANAGER |
| `/api/planning-logistique` | GET | Planning collaborateurs logistique | ADMIN, MANAGER |

### 5.2 Backend — Fichiers à créer

```
backend/src/routes/
├── clients-exutoires.js        # CRUD clients
├── tarifs-exutoires.js         # Grille tarifaire
├── commandes-exutoires.js      # Commandes + récurrence
├── preparations.js             # Préparations + Gantt
├── controles-pesee.js          # Pesée client + stock
├── factures-exutoires.js       # Factures + OCR
└── calendrier-logistique.js    # Calendrier prévisionnel + alertes

backend/src/services/
├── ocr.service.js              # Extraction OCR (Tesseract.js)
├── recurrence.service.js       # Génération commandes récurrentes
└── stock-exutoires.service.js  # Mouvements stock (provisoire/définitif)
```

### 5.3 Frontend — Pages à créer

```
frontend/src/pages/
├── ExutoiresCommandes.jsx       # Liste + création commandes
├── ExutoiresPreparation.jsx     # Préparation expédition
├── ExutoiresGantt.jsx           # Diagramme Gantt lieux de chargement
├── ExutoiresFacturation.jsx     # Contrôle pesée + factures OCR
├── ExutoiresCalendrier.jsx      # Calendrier prévisionnel
├── ExutoiresClients.jsx         # Référentiel clients
└── ExutoiresTarifs.jsx          # Grille tarifaire
```

### 5.4 Dépendances à ajouter

| Package | Usage | Côté |
|---------|-------|------|
| `tesseract.js` | Extraction texte OCR des factures PDF | Backend |
| `pdf-parse` | Extraction texte des PDF | Backend |
| `frappe-gantt` ou composant React Gantt | Diagramme de Gantt interactif | Frontend |

---

## 6. Navigation et intégration UI

### 6.1 Menu principal — Nouvelle section

```
📦 Exutoires
├── Commandes
├── Préparation & Chargement
├── Gantt Chargement
├── Facturation & Pesée
├── Calendrier Logistique
├── Clients
└── Grille Tarifaire
```

### 6.2 Intégration avec les modules existants

| Module existant | Interaction |
|-----------------|-------------|
| **Stock** | Déstockage provisoire au chargement, ajustement définitif à la pesée client |
| **Planning collaborateurs** | Ajout automatique des créneaux de chargement dans le planning |
| **Facturation** | Les factures exutoires sont distinctes des factures internes existantes (contrôle fournisseur vs émission) |
| **Reporting** | Nouveaux KPI : tonnage sorti, CA exutoires, taux d'écart pesée |
| **Expéditions** | Lien possible avec les expéditions existantes pour traçabilité |

---

## 7. Règles métier clés

1. **Conflit lieu** : Impossible de planifier 2 préparations sur le même lieu avec chevauchement temporel
2. **Pesée double** : Déstock provisoire (pesée interne) → ajustement définitif (pesée client)
3. **Seuils écart pesée** : ≤2% conforme, 2-5% alerte, >5% litige
4. **Prix résolution** : Client spécifique > Grille de base > Saisie manuelle
5. **Récurrence** : Génération automatique J-14, commande fille indépendante
6. **Statuts séquentiels** : Pas de retour en arrière sauf annulation
7. **OCR** : Extraction automatique + correction manuelle toujours possible
8. **Planning** : Les créneaux chargement apparaissent dans le planning général des collaborateurs

---

## 8. Livrables et ordre de déploiement

| Phase | Composants | Dépendances |
|-------|-----------|-------------|
| **1** | Tables SQL + Référentiel clients + Grille tarifaire | Aucune |
| **2** | Commandes (CRUD + récurrence) | Phase 1 |
| **3** | Préparations + Gantt + Planning collaborateurs | Phase 2 |
| **4** | Chargement + Déstockage provisoire | Phase 3 |
| **5** | Contrôle pesée + Ajustement stock définitif | Phase 4 |
| **6** | Factures OCR + Validation | Phase 5 |
| **7** | Calendrier prévisionnel + Alertes | Phase 2 |
| **8** | Intégration reporting | Toutes phases |

---

## 9. Points d'attention

- **Performance OCR** : Tesseract.js fonctionne côté serveur, prévoir un traitement asynchrone pour ne pas bloquer l'API
- **Conflits Gantt** : Vérification en temps réel lors de la création/modification d'une préparation
- **Stock négatif** : Alerte si un déstockage rendrait le stock négatif (sans bloquer, car le stock est estimatif)
- **Sécurité fichiers** : Les PDF uploadés (tickets pesée, factures) sont stockés dans un répertoire sécurisé, non accessible directement
