# Logique de fonctionnement des stocks et inventaires — SOLIDATA

> Ce document décrit la logique métier et technique des deux modules de stock coexistant dans SOLIDATA.
> Dernière mise à jour : 11 avril 2026

---

## 1. Vue d'ensemble

SOLIDATA dispose de **deux systèmes de stock complémentaires** :

| Système | Route API | Pages frontend | Objectif |
|---------|-----------|----------------|----------|
| **Stock moderne** | `/api/stock` | `Stock.jsx` | Suivi par catégorie de tri (post-tri) |
| **Stock original** | `/api/stock-original` | `AdminStockOriginal.jsx`, `InventaireOriginal.jsx` | Suivi brut collecte (avant tri), déclarations Refashion |

Ils partagent les mêmes sources d'alimentation (tournées de collecte) mais servent des objectifs distincts.

---

## 2. Flux de matière global

```
COLLECTE (tours)
    │
    ├──► stock_original_movements (type='entree', poids brut)
    │    └── Traçabilité brute pour Refashion, verrouillage trimestriel
    │
    └──► (après tri)
         │
         ├──► stock_movements (type='entree', matiere_id)
         │    └── Stock trié par catégorie/matière
         │
         └──► expeditions / flux_sortants (type='sortie')
                  └── Envoi vers exutoires (recycleurs, fripiers...)
```

---

## 3. Module Stock Moderne (`/api/stock`)

### 3.1 Fichiers
- Backend : `backend/src/routes/stock.js`
- Frontend : `frontend/src/pages/Stock.jsx`

### 3.2 Tables utilisées

| Table | Rôle |
|-------|------|
| `stock_movements` | Tous les mouvements entrée/sortie |
| `matieres` | Référentiel des matières (catégorie, sous-catégorie, qualité) |
| `categories_sortantes` | Catégories issues du tri (nom, famille, is_active) |
| `inventory_batches` | En-têtes des inventaires physiques |
| `inventory_items` | Lignes détail des inventaires (1 ligne = 1 catégorie) |

### 3.3 Schéma `stock_movements`

| Colonne | Type | Description |
|---------|------|-------------|
| `id` | SERIAL PK | |
| `type` | VARCHAR | `'entree'` ou `'sortie'` |
| `date` | DATE | Date du mouvement |
| `poids_kg` | DOUBLE PRECISION | Poids net |
| `poids_brut_kg` | DOUBLE PRECISION | Poids brut (optionnel) |
| `tare_kg` | DOUBLE PRECISION | Tare (optionnel) |
| `matiere_id` | FK → matieres | Matière concernée |
| `destination` | VARCHAR | Exutoire ou destination |
| `origine` | VARCHAR | Source (tournée, retour, etc.) |
| `origine_type` | VARCHAR | `'pav'` ou `'association'` |
| `code_barre` | VARCHAR | Code-barres optionnel |
| `tour_id` | FK → tours | Tournée source (si applicable) |
| `vehicle_id` | FK → vehicles | Véhicule source |
| `created_by` | FK → users | Opérateur |
| `created_at` | TIMESTAMP | |

### 3.4 Endpoints

| Méthode | Endpoint | Rôle | Auth |
|---------|----------|------|------|
| GET | `/` | Liste mouvements (filtres: type, date_from, date_to, limit) | ADMIN/MANAGER |
| GET | `/summary` | Résumé par catégorie + totaux globaux | ADMIN/MANAGER |
| POST | `/` | Créer un mouvement | ADMIN/MANAGER |
| GET | `/matieres` | Lister les matières (référentiel) | ADMIN/MANAGER |
| POST | `/matieres` | Créer une matière | ADMIN/MANAGER |
| GET | `/reconciliation` | Vérifier cohérence tournées/stock | ADMIN/MANAGER |
| GET | `/inventories` | Lister les inventaires | ADMIN/MANAGER |
| POST | `/inventories` | Créer un inventaire (complet ou partiel) | ADMIN/MANAGER |
| GET | `/inventories/:id` | Détail d'un inventaire | ADMIN/MANAGER |
| PUT | `/inventories/:id/items` | Saisir quantités physiques | ADMIN/MANAGER |
| POST | `/inventories/:id/validate` | Valider l'inventaire | ADMIN |

### 3.5 Logique d'inventaire physique

#### Création
1. Type : `'partiel'` (quelques catégories) ou `'complet'` (toutes)
2. Code auto-généré : `INV-C-YYYYMMDD` ou `INV-P-YYYYMMDD`
3. Statut initial : `en_cours`
4. Calcul stock **théorique** par catégorie : `SUM(entrees) - SUM(sorties)` depuis `stock_movements`

#### Saisie
- L'opérateur entre le stock **physique** constaté pour chaque catégorie
- Calcul automatique de l'écart : `physique - théorique` (kg et %)

#### Validation (ADMIN)
- Passe le statut à `valide`
- Enregistre `validated_by` et `validated_at`
- Stock théorique figé à la date de validation

### 3.6 Réconciliation tournées/stock
`GET /api/stock/reconciliation`

Compare :
- `tours.total_weight_kg` (poids enregistré à la tournée)
- `stock_movements.poids_kg` (poids enregistré au retour)

Retourne par tournée : `{ status: 'ok' | 'manquant' | 'ecart', diff_kg }`

---

## 4. Module Stock Original (`/api/stock-original`)

### 4.1 Fichiers
- Backend : `backend/src/routes/stock-original.js`
- Frontend admin : `frontend/src/pages/AdminStockOriginal.jsx`
- Frontend opérationnel : `frontend/src/pages/InventaireOriginal.jsx`

### 4.2 Tables utilisées

| Table | Rôle |
|-------|------|
| `stock_original_movements` | Tous les mouvements bruts |
| `stock_period_locks` | Verrouillages trimestriels Refashion |
| `stock_original_audit` | Traçabilité complète des modifications |

### 4.3 Schéma `stock_original_movements`

| Colonne | Type | Description |
|---------|------|-------------|
| `id` | SERIAL PK | |
| `type` | VARCHAR | `'entree'`, `'sortie'`, `'regularisation'` |
| `date` | DATE | Date du mouvement |
| `poids_kg` | DOUBLE PRECISION | Poids net (peut être négatif pour régularisation) |
| `poids_brut_kg` | DOUBLE PRECISION | Poids brut (mode brut-tare) |
| `tare_kg` | DOUBLE PRECISION | Tare (mode brut-tare) |
| `origine` | VARCHAR | `collecte_pav`, `collecte_association`, `retour_vak`, `retour_magasin`, `apport_volontaire` |
| `destination` | VARCHAR | Destinataire (sorties) |
| `notes` | TEXT | Commentaire libre |
| `motif` | TEXT | Motif obligatoire pour les régularisations |
| `tour_id` | FK → tours | Tournée source |
| `vehicle_id` | FK → vehicles | Véhicule source |
| `batch_id` | INTEGER | Lot de tri source |
| `expedition_id` | INTEGER | Expédition source |
| `created_by` | FK → users | Opérateur |
| `created_at` | TIMESTAMP | |
| `updated_at` | TIMESTAMP | |

### 4.4 Endpoints

| Méthode | Endpoint | Rôle | Auth |
|---------|----------|------|------|
| GET | `/` | Liste mouvements (filtres: type, date_from, date_to, origine) | ADMIN/MANAGER |
| GET | `/summary` | Totaux: entrées, sorties, régularisations, stock actuel | ADMIN/MANAGER |
| GET | `/evolution` | Série temporelle (day/week/month) pour graphiques | ADMIN/MANAGER |
| GET | `/ledger` | Grand livre ligne-par-ligne avec solde cumulé | ADMIN/MANAGER |
| POST | `/pesee` | Pesée manuelle (entrée brute) | ADMIN/MANAGER |
| POST | `/regularisation` | Mouvement correctif ±kg | ADMIN |
| PUT | `/:id` | Modifier un mouvement | ADMIN |
| GET | `/locks` | Liste des verrouillages trimestriels | ADMIN |
| POST | `/locks` | Verrouiller un trimestre (déclaration Refashion) | ADMIN |
| DELETE | `/locks/:id` | Déverrouiller d'urgence | ADMIN |
| GET | `/audit/:movementId` | Historique des modifications d'un mouvement | ADMIN |

### 4.5 Logique de pesée manuelle

`POST /api/stock-original/pesee`

Deux modes de saisie :
- **Mode poids net** : saisie directe de `poids_kg`
- **Mode brut-tare** : `poids_brut_kg` et `tare_kg` → `poids_kg = poids_brut - tare`

Origines disponibles : `retour_vak`, `retour_magasin`, `apport_volontaire`.

La pesée est refusée si le trimestre correspondant à la date est verrouillé.

### 4.6 Logique de régularisation (ADMIN)

`POST /api/stock-original/regularisation`

- Motif obligatoire
- `poids_kg` peut être positif (ajout) ou négatif (retrait)
- Génère une ligne dans `stock_original_audit` avec `action='create'`

### 4.7 Grand livre (ledger)

`GET /api/stock-original/ledger`

Retourne tous les mouvements dans l'ordre chronologique avec :
- Colonne `solde_cumule` : stock cumulé après chaque mouvement
- Indicateurs de verrouillage par période
- Totaux par type (entrée, sortie, régularisation)

### 4.8 Verrouillage trimestriel (Refashion)

| Table | Rôle |
|-------|------|
| `stock_period_locks` | 1 ligne par trimestre verrouillé (year, quarter 1-4) |

#### Logique
1. Manager confirme la déclaration DPAV → `POST /api/stock-original/locks`
2. La période (ex: Q1 2026) est verrouillée
3. Toute tentative de création, modification ou suppression d'un mouvement sur cette période est refusée
4. Déverrouillage d'urgence possible : `DELETE /api/stock-original/locks/:id` (ADMIN seulement)

#### Vérification lors de la modification
Lors d'un `PUT /:id`, le backend vérifie **deux trimestres** :
- Le trimestre de la **date originale** du mouvement
- Le trimestre de la **nouvelle date** proposée

Si l'un ou l'autre est verrouillé, la modification est refusée.

### 4.9 Audit trail

Chaque opération (create, update, delete) sur `stock_original_movements` génère une ligne dans `stock_original_audit` :

| Champ | Description |
|-------|-------------|
| `movement_id` | Mouvement concerné |
| `action` | `'create'` / `'update'` / `'delete'` |
| `field_name` | Champ modifié (pour les updates) |
| `old_value` | Valeur avant modification |
| `new_value` | Valeur après modification |
| `user_id` | Utilisateur responsable |
| `created_at` | Timestamp |

---

## 5. Interfaces utilisateur

### 5.1 Stock Moderne — `Stock.jsx`

**Onglet Stock :**
- Cartes par catégorie (catégorie, solde actuel en kg, barre de progression)
- Tableau des mouvements (date, catégorie, type, poids, source, notes)
- Bouton "+ Mouvement de stock" → modal de saisie

**Onglet Inventaire :**
- Liste des inventaires (code, date, type, statut, écart %)
- Détail inventaire : tableau catégorie / stock théorique / stock physique / écart / notes
- Édition des quantités physiques (si statut `en_cours`)
- Boutons : "Enregistrer saisies" et "Valider l'inventaire"

### 5.2 Admin Stock Original — `AdminStockOriginal.jsx`

**Onglet Journal de stock :**
- KPIs : nombre lignes, total entrées/sorties/régularisations, solde final
- Filtres date + Export CSV
- Grand livre (10 colonnes) : #, Date, Type, Origine/Réf, Entrée, Sortie, Régularisation, Solde cumulé, Notes, Par

**Onglet Régularisation :**
- Formulaire : date, poids ±kg, motif (obligatoire), notes
- Liste des dernières régularisations (vert si +, rouge si -)

**Onglet Modifications :**
- Tableau mouvements avec bouton Modifier (si période non verrouillée)
- Modal d'édition + historique audit champ par champ

**Onglet Verrouillage :**
- Grille 2 années × 4 trimestres
- Statut visuel : verrouillé (vert) / libre (gris)
- Bouton "Confirmer déclaration Refashion" (lock) ou "Déverrouiller" (unlock urgence)

### 5.3 Inventaire Original — `InventaireOriginal.jsx`

**Onglet Historique :**
- Tableau mouvements avec filtres (type, origine, date)

**Onglet Pesée manuelle :**
- Formulaire : date, origine, toggle mode poids net / brut-tare
- Affichage dynamique du poids net calculé
- Panel "Dernières pesées"

**Onglet Inventaire permanent :**
- KPIs : stock actuel, total entrées/sorties/régularisations
- Sélecteur de période (30/90/365 jours)
- Graphique composé : barres (entrées/sorties) + ligne (stock cumulé)

---

## 6. Liens entre les modules de stock

### Alimentation automatique depuis les tournées
À la complétion d'une tournée (`status = completed`), le module tournées crée automatiquement :

```javascript
// stock.js / execution.js
INSERT INTO stock_movements (type, date, poids_kg, origine, origine_type, tour_id, vehicle_id)
    VALUES ('entree', NOW(), <total_weight_kg>, 'collecte_pav', 'pav', <tour_id>, <vehicle_id>)

INSERT INTO stock_original_movements (type, date, poids_kg, origine, tour_id, vehicle_id)
    VALUES ('entree', NOW(), <total_weight_kg>, 'collecte_pav', <tour_id>, <vehicle_id>)
```

### Alimentation depuis les expéditions
Lors de la création d'une expédition (`expeditions.js`) :
```javascript
INSERT INTO stock_original_movements (type, date, poids_kg, origine, expedition_id)
    VALUES ('sortie', NOW(), <poids_total>, 'expedition', <expedition_id>)
```

### Alimentation depuis le tri
Les opérations de tri (tri.js) créent des `stock_movements` entrants par catégorie sortante.

---

## 7. Récapitulatif des tables

| Table | Module | Rôle |
|-------|--------|------|
| `stock_movements` | Stock moderne | Mouvements triés par matière/catégorie |
| `matieres` | Stock moderne | Référentiel matières |
| `categories_sortantes` | Stock moderne | Catégories issues du tri |
| `inventory_batches` | Stock moderne | En-têtes inventaires physiques |
| `inventory_items` | Stock moderne | Lignes inventaires physiques |
| `stock_original_movements` | Stock original | Mouvements bruts de collecte |
| `stock_period_locks` | Stock original | Verrouillage trimestriel Refashion |
| `stock_original_audit` | Stock original | Audit trail modifications |
| `flux_sortants` | Finance | Comptabilité matière (vente/recyclage/VAK) |

---

## 8. Sécurité et traçabilité

- **Authentification** : tous les endpoints stock nécessitent `ADMIN` ou `MANAGER`
- **Activity logger** : chaque action est loggée dans `activity_log` (action='stock' ou 'stock_original')
- **Audit trail stock original** : traçabilité complète champ par champ, accessible par ADMIN
- **Verrouillage trimestriel** : protection des données déclarées à Refashion
- **Requêtes paramétrées** : `$1, $2...` — pas d'injection SQL possible
