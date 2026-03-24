# Formation — Manager Collecte & Logistique

> **SOLIDATA ERP** — Guide Complet
> **Version** : 1.2.1 | **Date** : 24 mars 2026
> **Pour** : Responsable de la collecte et de la logistique exutoires

---

## Sommaire

1. [Gestion de la Collecte](#partie-1--gestion-de-la-collecte)
2. [Logistique Exutoires](#partie-2--logistique-exutoires)
3. [Reporting](#partie-3--reporting)
4. [Bonnes Pratiques](#partie-4--bonnes-pratiques)

---

## Partie 1 — Gestion de la Collecte

### 1.1 Tableau de Bord Collecte

**Accès** : Menu → Collecte → Tournées

Le tableau de bord affiche :
- **Tonnage collecté** : jour / semaine / mois
- **Nombre de tournées** actives et terminées
- **Taux de remplissage moyen** des CAV
- **Alertes** : CAV pleins non collectés, incidents en cours

**Filtres disponibles** :
- Par période (date début / date fin)
- Par véhicule
- Par chauffeur
- Par statut (planifiée, en cours, terminée)

### 1.2 Créer une Tournée

**3 modes de création** :

#### Mode Intelligent (IA) — Recommandé
1. Menu → Collecte → **Propositions (IA)**
2. Le système analyse les remplissages prédits de tous les CAV
3. Il propose les CAV à collecter en priorité
4. Il optimise l'itinéraire (distance minimale)
5. **Accepter** la proposition ou **Modifier** les CAV sélectionnés
6. Valider → La tournée est créée

#### Mode Standard (Itinéraire prédéfini)
1. Menu → Collecte → Tournées → **Nouvelle tournée**
2. Sélectionner **Tournée standard**
3. Choisir un itinéraire prédéfini dans la liste
4. Affecter un véhicule et un chauffeur
5. Valider

#### Mode Manuel (Libre)
1. Menu → Collecte → Tournées → **Nouvelle tournée**
2. Sélectionner **Tournée manuelle**
3. Cliquer sur les CAV souhaités sur la carte
4. Réordonner si nécessaire (glisser-déposer)
5. Affecter un véhicule et un chauffeur
6. Valider

### 1.3 Suivi GPS en Temps Réel

**Accès** : Menu → Collecte → **Suivi GPS**

- Carte interactive avec la position des véhicules en tournée
- Mise à jour toutes les **10 secondes** (via Socket.IO)
- Codes couleur :
  - **Vert** : En route, tournée en cours
  - **Jaune** : Arrêt (collecte en cours ou pause)
  - **Rouge** : Problème signalé (incident)
- Cliquer sur un véhicule pour voir :
  - Chauffeur affecté
  - Tournée en cours
  - CAV collectés / restants
  - Heure de début

### 1.4 Carte CAV et Remplissage

#### Carte des CAV
**Accès** : Menu → Collecte → **Carte CAV**

- Affiche les ~30 CAV géolocalisés sur une carte Leaflet
- Cliquer sur un CAV pour voir : adresse, dernière collecte, tonnage moyen

#### Carte de Remplissage
**Accès** : Menu → Collecte → **Remplissage CAV**

- Carte avec codes couleur par niveau de remplissage :
  - **Rouge** : Plein (niveau 4-5) → Collecte urgente
  - **Orange** : À moitié (niveau 2-3) → Planifier
  - **Vert** : Vide/bas (niveau 0-1) → Pas urgent
- **Prédictions IA** : date estimée du prochain remplissage complet
- Facteurs pris en compte : saison, météo, événements locaux, historique

### 1.5 Propositions IA

**Accès** : Menu → Collecte → **Propositions (IA)**

Le moteur d'IA génère des propositions de tournées :
1. Analyse les niveaux de remplissage (observés + prédits)
2. Priorise les CAV les plus pleins
3. Optimise la distance parcourue
4. Propose un planning

**Actions possibles** :
- **Accepter** → Crée la tournée automatiquement
- **Modifier** → Ajuster les CAV, l'ordre, le chauffeur
- **Refuser** → Le feedback améliore les futures propositions

> Le feedback (accepté/modifié/refusé) alimente la boucle d'apprentissage de l'IA. Plus vous utilisez le système, plus les propositions s'affinent.

### 1.6 Gestion des Véhicules

**Accès** : Menu → Administration → **Véhicules**

Pour chaque véhicule :
- **Fiche** : immatriculation, modèle, capacité (kg), kilométrage
- **Tare** : poids à vide (pour calcul du poids net collecté)
- **Alertes maintenance** :
  - Vidange (tous les X km)
  - Contrôle technique (date d'échéance)
  - Pneus (usure)
  - Freins (usure)
- **Historique** : interventions passées, coûts

### 1.7 Gestion des Incidents

Les chauffeurs signalent les incidents via l'app mobile :
- **CAV cassé** → Programmer une réparation
- **CAV inaccessible** → Vérifier (travaux, stationnement)
- **CAV volé/manquant** → Déclarer, remplacer
- **Panne véhicule** → Envoyer un autre véhicule ou dépanneuse
- **Accident** → Protocole sécurité

---

## Partie 2 — Logistique Exutoires

### 2.1 Vue d'Ensemble

La logistique exutoires gère la **vente et l'expédition des produits triés** vers les 37 clients.

```
Commande → Confirmée → Préparation → Prête → Chargement → Expédiée → Pesée → Facturée → Clôturée
```

**7 écrans dédiés** : Commandes, Clients, Tarifs, Préparation, Gantt, Facturation, Calendrier

### 2.2 Gestion des Clients

**Accès** : Menu → Exutoires → **Clients**

Pour chaque client :
- Nom, adresse, contact
- Types de produits acceptés (VAK, CSR, effilochage, chiffons...)
- Historique des commandes et factures
- Conditions tarifaires

**37 clients** répartis en catégories :
- **Recycleurs** : Gebetex, Ecotri...
- **Négociants export** : Alunited, Eurofrip, Limbotex...
- **Industriels** : So TOWT (CSR)...

### 2.3 Grille Tarifaire

**Accès** : Menu → Exutoires → **Grille Tarifaire**

- Prix par **type de produit** (VAK, CSR, effilochage, chiffons...)
- Décliné par **trimestre** et par **année**
- Possibilité de tarifs spécifiques par client
- Historique des évolutions tarifaires

### 2.4 Créer une Commande

**Accès** : Menu → Exutoires → **Commandes** → bouton **+ Nouvelle commande**

1. **Sélectionner le client** (liste déroulante)
2. **Choisir les types de produits** (multi-sélection)
3. **Indiquer le tonnage estimé** (en kg ou tonnes)
4. **Fixer le prix/tonne** (pré-rempli depuis la grille tarifaire)
5. **Date de livraison souhaitée**
6. **Observations** éventuelles
7. Cliquer **Enregistrer**

La commande passe au statut **"En attente"**.

### 2.5 Suivi des Commandes

**8 statuts** avec actions possibles :

| Statut | Action pour passer au suivant |
|--------|------------------------------|
| **En attente** | Confirmer la commande |
| **Confirmée** | Lancer la préparation |
| **En préparation** | Terminer la préparation |
| **Prête** | Planifier le chargement |
| **En chargement** | Marquer comme expédiée |
| **Expédiée** | Saisir la pesée client |
| **Pesée client** | Valider la facturation |
| **Facturée** | Clôturer |

### 2.6 Préparer une Expédition

**Accès** : Menu → Exutoires → **Préparation**

1. Sélectionner la commande à préparer
2. **Choisir le lieu de chargement** :
   - Quai (×1)
   - Garage Remorque (×1)
   - Cours (×1)
3. **Fixer la date et l'heure** de chargement
4. **Affecter les collaborateurs** au chargement
5. **Indiquer le transporteur**
6. Valider

Le système **détecte automatiquement les conflits** :
- Si un emplacement est déjà occupé à la même heure → alerte

### 2.7 Planning Gantt

**Accès** : Menu → Exutoires → **Gantt Chargement**

Vue visuelle des 3 emplacements de chargement :

```
         Lundi     Mardi     Mercredi    Jeudi     Vendredi
Quai     [████████]                      [███████████████]
Garage              [██████████████]
Cours    [████]                [████████████]
```

- Chaque barre = une préparation planifiée
- Couleur par statut (préparé, en chargement, terminé)
- Cliquer sur une barre pour voir les détails
- Les conflits sont signalés en rouge

### 2.8 Contrôle Pesée

Deux pesées sont comparées pour chaque expédition :

| Pesée | Lieu | Responsable |
|-------|------|-------------|
| Pesée départ | Centre de tri | Solidarité Textiles |
| Pesée arrivée | Chez le client | Client exutoire |

**Règles d'écart** :

| Écart | Résultat | Action |
|-------|----------|--------|
| **≤ 2%** | ✅ Validé automatiquement | Aucune |
| **2% - 5%** | ⚠️ Avertissement | Vérification recommandée |
| **> 5%** | 🔴 Alerte | Investigation obligatoire |

### 2.9 Facturation Exutoires

**Accès** : Menu → Exutoires → **Facturation**

1. Sélectionner la commande à facturer
2. **OCR automatique** : télécharger le PDF de la facture client
   - Le système extrait automatiquement les montants (Tesseract.js)
3. **Rapprochement** : comparaison automatique facture ↔ commande
   - Tonnage déclaré vs facturé
   - Prix/tonne convenu vs facturé
   - Montant HT/TVA/TTC
4. **Validation** : confirmer ou contester

### 2.10 Calendrier Logistique

**Accès** : Menu → Exutoires → **Calendrier**

- Vue **mensuelle** de toutes les expéditions
- Filtres : par client, par type de produit, par statut
- Codes couleur par statut
- Cliquer sur un jour pour voir le détail des expéditions

---

## Partie 3 — Reporting

### 3.1 Reporting Collecte

**Accès** : Menu → Reporting → **Collecte**

| Indicateur | Description |
|-----------|-------------|
| Tonnage collecté | Par jour, semaine, mois |
| Nombre de tournées | Réalisées vs planifiées |
| Taux de remplissage | Moyen par CAV |
| Performance chauffeur | Tonnage/tournée par chauffeur |
| Km parcourus | Distance totale par période |
| IA : précision prédictions | Écart prédit vs observé |

### 3.2 Reporting Métropole

**Accès** : Menu → Reporting → **Métropole Rouen**

Données automatiquement compilées pour les rapports à la Métropole :
- Tonnage collecté par commune
- Nombre de CAV par commune
- Taux de valorisation

---

## Partie 4 — Bonnes Pratiques

### Routine Quotidienne

| Heure | Action | Écran |
|-------|--------|-------|
| **8h00** | Consulter les propositions IA | Propositions |
| **8h15** | Créer/valider les tournées du jour | Tournées |
| **8h30-17h** | Suivre le GPS des véhicules | Suivi GPS |
| **Journée** | Traiter les incidents signalés | Tournées |
| **17h00** | Valider les tournées terminées | Tournées |
| **17h30** | Vérifier les pesées du jour | Commandes |

### Routine Hebdomadaire

| Jour | Action | Écran |
|------|--------|-------|
| **Lundi** | Planifier les expéditions de la semaine | Gantt |
| **Mercredi** | Vérifier les alertes maintenance véhicules | Véhicules |
| **Vendredi** | Valider les factures en attente | Facturation |
| **Vendredi** | Consulter le reporting hebdo | Reporting Collecte |

### Routine Mensuelle

| Quand | Action | Écran |
|-------|--------|-------|
| **Début de mois** | Exporter le reporting mensuel collecte | Reporting |
| **Début de mois** | Analyser les KPI (tonnage, tours, remplissage) | Reporting |
| **Mi-mois** | Vérifier la grille tarifaire | Grille Tarifaire |
| **Fin de mois** | Bilan des expéditions et CA exutoires | Facturation |

### Conseils

1. **Privilégiez le mode intelligent** pour les tournées — l'IA s'améliore avec le feedback
2. **Vérifiez les conflits** sur le Gantt avant de planifier un chargement
3. **Traitez les écarts de pesée > 2%** rapidement — ils peuvent cacher un problème
4. **Exportez les reportings** régulièrement pour les réunions d'équipe
5. **Suivez les alertes maintenance** — un véhicule en panne = une tournée annulée

---

*Guide de formation — SOLIDATA ERP v1.2.1*
*Dernière mise à jour : 24 mars 2026*
