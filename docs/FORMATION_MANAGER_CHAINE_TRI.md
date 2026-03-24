# Formation — Manager Chaîne de Tri

> **SOLIDATA ERP** — Guide Pas à Pas
> **Version** : 1.2.1 | **Date** : 24 mars 2026
> **Pour** : Responsable de la chaîne de tri

---

## Comment utiliser ce guide

- Chaque étape est **numérotée** (1, 2, 3...)
- Les boutons à cliquer sont en **gras**
- Les menus sont indiqués avec des flèches : Menu → Tri → Production
- Les cases □ sont des checklists à cocher
- En cas de problème → voir la section **Aide** à la fin

---

## Partie 1 — Se Connecter et Naviguer

### 1.1 Se Connecter à SOLIDATA

1. Ouvrir le navigateur internet (Chrome, Firefox, ou Edge)
2. Taper dans la barre d'adresse en haut : **solidata.online**
3. Appuyer sur la touche Entrée
4. Écrire votre **nom d'utilisateur** dans le premier champ
5. Écrire votre **mot de passe** dans le deuxième champ
6. Cliquer sur le bouton **Connexion**

```
┌─────────────────────────────────────┐
│         SOLIDATA — Connexion        │
│                                     │
│  Nom d'utilisateur : [___________]  │
│  Mot de passe :      [___________]  │
│                                     │
│         [ Connexion ]               │
└─────────────────────────────────────┘
```

> Si ça ne marche pas :
> - Vérifiez que vous avez bien tapé le mot de passe
> - Vérifiez les majuscules/minuscules
> - Demandez à l'administrateur si besoin

### 1.2 Le Menu (à gauche de l'écran)

Le menu est une barre à **gauche** de l'écran.
Cliquez sur une section pour la **déplier** et voir les sous-menus.

**Vos sections principales :**

```
┌────────────────────────────┐
│  Accueil                   │  ← Tableau de bord général
│    ├── Tableau de bord     │
│    └── Fil d'actualité     │
│                            │
│  Tri & Production          │  ← VOTRE ESPACE PRINCIPAL
│    ├── Production          │  ← Saisie quotidienne
│    ├── Chaînes de tri      │  ← Voir les chaînes
│    ├── Stock MP            │  ← Matières premières
│    ├── Produits finis      │  ← Produits triés
│    └── Expéditions         │  ← Envois vers clients
│                            │
│  Reporting                 │  ← Résultats
│    └── Production          │  ← Vos chiffres
└────────────────────────────┘
```

---

## Partie 2 — La Production du Jour (QUOTIDIEN)

### 2.1 Saisir la Production du Jour

**C'est l'action la plus importante. À faire chaque soir.**

**Chemin** : Menu → Tri & Production → **Production**

1. Cliquer sur **Tri & Production** dans le menu à gauche
2. Cliquer sur **Production**
3. Cliquer sur le bouton **Nouvelle saisie** (en haut à droite)
4. Remplir les champs :

```
┌─────────────────────────────────────────────────┐
│           Saisie Production du Jour              │
│                                                   │
│  Date :        [  Aujourd'hui  ]                  │
│                                                   │
│  Effectif :    [ ___ ] personnes au tri           │
│  (combien de personnes ont trié aujourd'hui)      │
│                                                   │
│  Tonnage :     [ ___ ] kg triés                   │
│  (combien de kg ont été triés en tout)            │
│                                                   │
│  ═══════════════════════════════════              │
│  Productivité : XXX kg/personne (calculé auto)   │
│  ═══════════════════════════════════              │
│                                                   │
│         [ Enregistrer ]                           │
└─────────────────────────────────────────────────┘
```

5. Cliquer sur **Enregistrer**

> **La productivité** se calcule automatiquement :
> Productivité = Tonnage trié ÷ Effectif
> Exemple : 1200 kg ÷ 8 personnes = 150 kg/personne

### 2.2 Voir l'Historique

Toujours sur la page **Production** :
- Le tableau en bas montre les **saisies des jours passés**
- Vous pouvez **filtrer par mois** avec le sélecteur de date
- Les **graphiques** montrent l'évolution du tonnage et de la productivité

### 2.3 Comprendre les Indicateurs

| Indicateur | Ce que ça veut dire | Bon résultat |
|-----------|-------------------|-------------|
| **Effectif** | Nombre de personnes qui ont trié | Selon le planning |
| **Tonnage** | Poids total trié dans la journée (kg) | Selon objectifs |
| **Productivité** | Kg triés par personne | 150-200 kg/pers |
| **Taux CSR** | % de rebut (ce qui ne peut pas être réutilisé) | ≤ 30% |

---

## Partie 3 — Les Chaînes de Tri

### 3.1 Les 2 Chaînes (schéma simplifié)

Il y a **2 chaînes** qui travaillent en même temps :

```
╔═══════════════════════════════════════════════════════════════════╗
║                                                                   ║
║   CHAÎNE QUALITÉ (5 étapes)                                      ║
║   ═══════════════════════════                                     ║
║                                                                   ║
║   Étape 1        Étape 2        Étape 3        Étape 4           ║
║   CRACKAGE 1  →  CRACKAGE 2  →  RECYCLAGE  →  RÉUTILISATION     ║
║   (ouvrir les     (2ème tri)     (CSR, effilo,   (homme,          ║
║    sacs, 1er                      chiffons)       femme,          ║
║    tri)                                           enfant)         ║
║                                                      │            ║
║                                                      ▼            ║
║                                                  Étape 5          ║
║                                                  TRIAGE FIN       ║
║                                                  (tri très        ║
║                                                   précis)         ║
║                                                      │            ║
║                                                      ▼            ║
║                                               114 PRODUITS        ║
║                                                  FINIS            ║
╠═══════════════════════════════════════════════════════════════════╣
║                                                                   ║
║   CHAÎNE RECYCLAGE (1 étape)                                     ║
║   ════════════════════════════                                    ║
║                                                                   ║
║   Tout va directement au RECYCLAGE                                ║
║   → Balles CSR, Effilochage, Chiffons                             ║
║   (pas de réutilisation)                                          ║
║                                                                   ║
╚═══════════════════════════════════════════════════════════════════╝
```

### 3.2 Les 9 Postes de Travail

| Poste | Où | Ce qu'on fait |
|-------|-----|--------------|
| **Crack 1** | Chaîne Qualité | On ouvre les sacs, on fait le premier tri |
| **Crack 2** | Chaîne Qualité | On trie plus précisément les textiles |
| **R1** | Chaîne Qualité | Recyclage : on sépare ce qui ne peut pas être réutilisé |
| **R2** | Chaîne Qualité | Recyclage : pareil que R1 (deuxième poste) |
| **Reu** | Chaîne Qualité | On sépare les vêtements par genre (homme/femme/enfant) |
| **Triage 1** | Chaîne Qualité | Tri final très précis (premier poste) |
| **Triage 2** | Chaîne Qualité | Tri final très précis (deuxième poste) |
| **R3** | Recyclage | Recyclage direct (premier poste) |
| **R4** | Recyclage | Recyclage direct (deuxième poste) |

### 3.3 Voir les Chaînes dans SOLIDATA

**Chemin** : Menu → Tri & Production → **Chaînes de tri**

1. Cliquer sur **Tri & Production** dans le menu
2. Cliquer sur **Chaînes de tri**
3. Vous voyez la **liste des chaînes** :
   - Chaîne Qualité
   - Chaîne Recyclage Exclusif
4. **Cliquer sur une chaîne** pour voir le détail :
   - Les opérations (étapes)
   - Les postes de travail
   - Les types de sorties

---

## Partie 4 — Le Stock

### 4.1 Stock Matières Premières

**Chemin** : Menu → Tri & Production → **Stock MP**

C'est le stock des textiles **avant le tri**. Ce sont les matières qui arrivent des collectes.

**Ce que vous voyez :**
- **Entrées** : Ce qui arrive des tournées de collecte (pesée)
- **Sorties** : Ce qui part vers les chaînes de tri
- **Solde** : Ce qui reste en stock

### 4.2 Enregistrer un Mouvement de Stock

1. Aller sur la page **Stock MP**
2. Cliquer sur **Nouveau mouvement**
3. Choisir le **type** :
   - **Entrée** : Des textiles arrivent (depuis une collecte)
   - **Sortie** : Des textiles partent vers le tri
4. Indiquer la **catégorie** de matière
5. Indiquer le **poids** (en kg)
6. Cliquer sur **Enregistrer**

### 4.3 Produits Finis

**Chemin** : Menu → Tri & Production → **Produits finis**

C'est le stock des produits **après le tri**. Il y a **114 produits différents**.

**Les produits sont classés par :**
- **Catégorie** : vêtements, chaussures, accessoires, linge...
- **Genre** : homme, femme, enfant (layette)
- **Saison** : été, hiver
- **Gamme** :
  - **BTQ** = Boutique (sera vendu en boutique solidaire)
  - **VAK** = Export (sera envoyé à l'étranger)
  - **CHIF** = Chiffons (pour l'industrie)
  - **Pvak** = Vrac export

---

## Partie 5 — Les Expéditions

### 5.1 Voir les Expéditions

**Chemin** : Menu → Tri & Production → **Expéditions**

Ici vous voyez **tous les envois** vers les clients (exutoires).

Pour chaque expédition :
- **Client** : qui reçoit les produits
- **Type de produit** : ce qui est envoyé
- **Poids** : combien de kg
- **Date** : quand c'est parti
- **Statut** : en cours, livré, etc.

---

## Partie 6 — Le Reporting Production

### 6.1 Voir vos Résultats

**Chemin** : Menu → Reporting → **Production**

1. Cliquer sur **Reporting** dans le menu
2. Cliquer sur **Production**
3. Vous voyez :

| Indicateur | Ce que ça montre |
|-----------|-----------------|
| **Tonnage trié** | Combien de kg triés par période |
| **Productivité** | Kg par personne par jour |
| **Taux de CSR** | Pourcentage de rebut |
| **Évolution** | Graphique avec les tendances |

4. **Filtrer par mois** : Utilisez le sélecteur de date en haut
5. **Comparer** : Vous pouvez comparer avec les mois précédents

---

## Partie 7 — Bonnes Pratiques

### Routine Quotidienne (Chaque Jour)

```
┌──────────────────────────────────────────────────────┐
│                CHAQUE JOUR                            │
│                                                       │
│  □ MATIN : Vérifier le stock de matières premières    │
│            (Menu → Tri → Stock MP)                    │
│                                                       │
│  □ MATIN : Affecter les postes de travail             │
│            (qui va où sur les chaînes)                │
│                                                       │
│  □ SOIR  : Saisir la production du jour               │
│            (Menu → Tri → Production → Nouvelle saisie)│
│                                                       │
│  □ SOIR  : Vérifier les mouvements de stock           │
│            (entrées et sorties du jour)                │
└──────────────────────────────────────────────────────┘
```

### Routine Hebdomadaire (Chaque Semaine)

```
┌──────────────────────────────────────────────────────┐
│                CHAQUE SEMAINE                         │
│                                                       │
│  □ Consulter le reporting production                  │
│    (Menu → Reporting → Production)                    │
│                                                       │
│  □ Vérifier les produits finis en stock               │
│    (Menu → Tri → Produits finis)                      │
│                                                       │
│  □ Vérifier les expéditions prévues                   │
│    (Menu → Tri → Expéditions)                         │
└──────────────────────────────────────────────────────┘
```

### Routine Mensuelle (Chaque Mois)

```
┌──────────────────────────────────────────────────────┐
│                CHAQUE MOIS                            │
│                                                       │
│  □ Exporter le rapport mensuel de production          │
│                                                       │
│  □ Analyser les tendances (tonnage, productivité)     │
│                                                       │
│  □ Ajuster les objectifs si nécessaire                │
└──────────────────────────────────────────────────────┘
```

---

## Partie 8 — Aide et Dépannage

### Problèmes Fréquents

| Problème | Solution |
|----------|----------|
| **"Je ne trouve pas le menu"** | Le menu est la barre à **gauche** de l'écran. Cliquer dessus pour déplier. |
| **"Le bouton ne marche pas"** | Vérifier que **tous les champs** sont remplis (les champs obligatoires ont une *). |
| **"Les chiffres ne s'affichent pas"** | Actualiser la page : appuyer sur **F5** ou cliquer sur le bouton ↻ du navigateur. |
| **"Je suis déconnecté"** | Retaper votre nom d'utilisateur et mot de passe, puis cliquer sur **Connexion**. |
| **"L'écran est blanc"** | Vérifier que vous êtes connecté à internet. |
| **"Je me suis trompé dans la saisie"** | Vous pouvez modifier une saisie en cliquant dessus dans le tableau. |
| **"Je ne sais plus mon mot de passe"** | Demandez à l'administrateur de le réinitialiser. |

### Raccourcis Utiles

| Action | Comment faire |
|--------|-------------|
| Actualiser la page | Appuyer sur **F5** |
| Revenir en arrière | Appuyer sur la **flèche ←** du navigateur |
| Sélectionner tout dans un champ | Cliquer dans le champ + **Ctrl+A** |

### Contacts

- **Problème technique** (l'application ne marche pas) → Contacter l'administrateur
- **Question sur les données** (chiffres, stock) → Contacter le responsable logistique
- **Question sur le planning** → Contacter le responsable RH

---

## Aide-Mémoire (à imprimer)

```
╔═══════════════════════════════════════════════════════════╗
║              AIDE-MÉMOIRE — MANAGER TRI                   ║
╠═══════════════════════════════════════════════════════════╣
║                                                           ║
║  SE CONNECTER :                                           ║
║  → solidata.online → Nom + Mot de passe → Connexion      ║
║                                                           ║
║  SAISIR LA PRODUCTION :                                   ║
║  → Menu → Tri & Production → Production                   ║
║  → Nouvelle saisie → Effectif + Tonnage → Enregistrer     ║
║                                                           ║
║  VOIR LE STOCK :                                          ║
║  → Menu → Tri & Production → Stock MP                     ║
║                                                           ║
║  VOIR LES CHAÎNES :                                       ║
║  → Menu → Tri & Production → Chaînes de tri               ║
║                                                           ║
║  VOIR LES RÉSULTATS :                                     ║
║  → Menu → Reporting → Production                          ║
║                                                           ║
║  PROBLÈME ?                                               ║
║  → Actualiser (F5) — Se reconnecter — Appeler l'admin     ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
```

---

*Guide de formation pas à pas — SOLIDATA ERP v1.2.1*
*Dernière mise à jour : 24 mars 2026*
