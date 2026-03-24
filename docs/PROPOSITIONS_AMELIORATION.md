# Propositions d'Amélioration — SOLIDATA ERP

> **Version** : 1.2.1 | **Date** : 24 mars 2026
> **Objectif** : Rendre l'application plus accessible et facile à utiliser pour tous les collaborateurs

---

## 1. Améliorations UX Prioritaires

### 1.1 Mode Simplifié pour les Collaborateurs

**Constat** : Les collaborateurs en insertion (CDDI) ont souvent une pratique limitée de l'informatique. L'interface actuelle, conçue pour les managers, peut être intimidante.

**Proposition** :
- Créer un **mode simplifié** activable par rôle (COLLABORATEUR)
- Interface épurée avec **gros boutons**, **icônes visuelles**, et **texte minimal**
- Limiter l'affichage aux seules fonctions nécessaires :
  - Mes heures de travail
  - Mon parcours d'insertion
  - Mon profil
  - Fil d'actualités
- Navigation par **onglets en bas de l'écran** (style mobile) plutôt que sidebar

**Effort** : Moyen | **Impact** : Fort

### 1.2 Tutoriel Intégré (Onboarding)

**Constat** : Les nouveaux utilisateurs découvrent l'interface sans guidance.

**Proposition** :
- Ajouter un **tutoriel interactif** à la première connexion
- Bulles explicatives pointant les éléments clés ("Cliquez ici pour...")
- Différent selon le rôle (chauffeur ≠ manager RH ≠ manager tri)
- Possibilité de relancer le tutoriel depuis les Paramètres
- Librairie suggérée : `react-joyride` (léger, compatible React 18)

**Effort** : Faible | **Impact** : Fort

### 1.3 Aide Contextuelle

**Constat** : Chaque page nécessite une compréhension du vocabulaire métier et des process.

**Proposition** :
- Ajouter un bouton **?** sur chaque page
- Panneau latéral avec :
  - Explication de la page en langage simple
  - Étapes clés ("Comment faire...")
  - Glossaire des termes utilisés
  - Lien vers la formation correspondante

**Effort** : Moyen | **Impact** : Fort

---

## 2. Améliorations pour les Chauffeurs (Mobile)

### 2.1 Interface Ultra-Simplifiée

**Constat** : Les chauffeurs ont une pratique réduite du français écrit et de l'informatique.

**Proposition** :
- Remplacer le texte par des **icônes parlantes** partout où possible
- Utiliser des **codes couleur systématiques** :
  - 🟢 Vert = OK / Validé / Plein
  - 🟡 Jaune = Attention / En cours
  - 🔴 Rouge = Problème / Urgent
- Augmenter la taille des boutons tactiles (min 48px → 64px)
- Ajouter des **retours sonores** en plus du haptique (bip de confirmation)
- Support **multi-langue** (français simplifié + pictogrammes)

**Effort** : Moyen | **Impact** : Fort

### 2.2 Mode Hors-Ligne Amélioré

**Constat** : Les zones de collecte peuvent avoir une couverture réseau limitée.

**Proposition** :
- Stocker la tournée du jour en **IndexedDB** au démarrage
- Permettre la saisie des niveaux de remplissage et pesées **hors-ligne**
- Synchroniser automatiquement quand le réseau revient
- Indicateur visuel clair : 🟢 En ligne | 🔴 Hors ligne (données sauvegardées)

**Effort** : Élevé | **Impact** : Fort

### 2.3 Navigation Vocale

**Constat** : Les chauffeurs conduisent et ne peuvent pas lire l'écran.

**Proposition** :
- Intégrer la **synthèse vocale** (Web Speech API) pour :
  - Annoncer le prochain CAV ("Prochain conteneur : Rue Victor Hugo")
  - Confirmer les actions ("Niveau enregistré")
  - Alerter en cas de problème
- Bouton "mains libres" pour passer en mode vocal

**Effort** : Moyen | **Impact** : Fort

---

## 3. Améliorations pour le Manager Chaîne de Tri

### 3.1 Dashboard Visuel Production

**Constat** : Le manager tri a besoin de voir d'un coup d'œil l'état de la production.

**Proposition** :
- Créer un **tableau de bord dédié tri** avec :
  - Jauge visuelle du tonnage du jour vs objectif
  - Diagramme de la chaîne avec statut en temps réel par poste
  - Alertes visuelles (stock bas, retard, poste non affecté)
  - Compteur de productivité en direct
- Affichable sur un **écran mural** dans l'atelier (mode kiosk)

**Effort** : Moyen | **Impact** : Fort

### 3.2 Saisie Rapide par Code-Barres

**Constat** : La saisie manuelle des poids et mouvements de stock est fastidieuse.

**Proposition** :
- Scanner un code-barres pour **pré-remplir** le formulaire
- Associer chaque lot (LOT-xxxxx) à un QR code imprimable
- Scanner le QR → le système affiche le lot, l'opération en cours, et propose la saisie de sortie
- Utiliser un lecteur code-barres USB connecté au PC de l'atelier

**Effort** : Faible | **Impact** : Fort

### 3.3 Raccourcis Rapides

**Constat** : Le manager tri répète les mêmes opérations chaque jour.

**Proposition** :
- Ajouter des **boutons d'accès rapide** sur le dashboard :
  - "Saisir la production du jour" (1 clic)
  - "Voir le stock MP" (1 clic)
  - "Dernières expéditions" (1 clic)
- Réduire le nombre de clics pour les opérations courantes de 4-5 à 1-2

**Effort** : Faible | **Impact** : Moyen

---

## 4. Améliorations pour le Manager RH & Insertion

### 4.1 Alertes Proactives

**Constat** : Les échéances insertion (jalons M1/M6/M12) et contrats peuvent être oubliées.

**Proposition** :
- **Notifications push** (navigateur) pour :
  - Jalon insertion à programmer (7 jours avant)
  - Contrat CDDI arrivant à échéance (30 jours avant)
  - Entretien non programmé depuis X semaines
  - Plan d'action CIP en retard
- Widget "Alertes du jour" en haut du dashboard RH

**Effort** : Moyen | **Impact** : Fort

### 4.2 Tableau de Bord Insertion Enrichi

**Constat** : Le suivi des parcours d'insertion nécessite de naviguer fiche par fiche.

**Proposition** :
- Vue **synthétique** de tous les parcours actifs :
  - Tableau avec colonnes : Collaborateur | Début CDDI | Prochain jalon | Radar moyen | Actions en retard
  - Tri par urgence (prochain jalon le plus proche en premier)
  - Code couleur : 🟢 En bonne voie | 🟡 Attention | 🔴 En difficulté
- Export PDF pour les bilans avec les partenaires

**Effort** : Moyen | **Impact** : Fort

### 4.3 Modèles de Plans d'Action

**Constat** : Les CIP recréent les mêmes types de plans d'action pour des freins similaires.

**Proposition** :
- Créer une **bibliothèque de plans d'action types** :
  - Frein Mobilité → [Inscription auto-école, Aide au permis, Covoiturage, Transport en commun]
  - Frein Logement → [Demande logement social, Aide au 1er loyer, Colocation solidaire]
  - Frein Santé → [Orientation médecin traitant, Bilan de santé, CPAM]
  - etc.
- Le CIP sélectionne un modèle et l'adapte (au lieu de tout réécrire)

**Effort** : Faible | **Impact** : Moyen

---

## 5. Améliorations pour le Manager Collecte & Logistique

### 5.1 Carte Enrichie des CAV

**Constat** : La carte CAV pourrait être plus interactive et informative.

**Proposition** :
- Ajouter sur la carte :
  - **Historique de remplissage** au survol (mini-graphe 7 jours)
  - **Date de prochaine collecte prévue** (IA)
  - **Photos récentes** du CAV (problèmes signalés)
  - **Itinéraire optimisé** affiché directement sur la carte
- Filtre par statut (plein, à moitié, vide, en panne)

**Effort** : Moyen | **Impact** : Moyen

### 5.2 Planning Drag & Drop Exutoires

**Constat** : La planification des chargements pourrait être plus intuitive.

**Proposition** :
- Gantt entièrement **glisser-déposer** :
  - Déplacer une préparation d'un jour à l'autre
  - Changer d'emplacement (quai ↔ garage ↔ cours) par glisser-déposer
  - Redimensionner pour ajuster la durée
  - Confirmation instantanée des conflits
- Vue "semaine" en plus de la vue "jour"

**Effort** : Moyen | **Impact** : Moyen

### 5.3 Notifications Chauffeur en Temps Réel

**Constat** : La communication entre le manager et les chauffeurs en tournée est limitée.

**Proposition** :
- Envoyer des **messages instantanés** au chauffeur via l'app mobile :
  - "Priorité : aller au CAV Rue Victor Hugo en premier"
  - "Éviter la zone centre (travaux)"
  - "Revenir au centre pour pause"
- Le chauffeur reçoit une notification push + vibration

**Effort** : Moyen | **Impact** : Fort

---

## 6. Améliorations Transversales

### 6.1 Thème Sombre

**Constat** : Certains utilisateurs travaillent dans des environnements sombres (atelier tri).

**Proposition** :
- Ajouter un **mode sombre** activable dans les paramètres utilisateur
- Utiliser les CSS variables déjà en place (--color-bg, --primary)
- Basculement automatique selon l'heure (optionnel)

**Effort** : Faible | **Impact** : Faible

### 6.2 Recherche Globale

**Constat** : Trouver une information spécifique nécessite de savoir dans quel module chercher.

**Proposition** :
- Ajouter une **barre de recherche globale** (Ctrl+K / ⌘+K) :
  - Rechercher un collaborateur, un candidat, un CAV, une commande, un lot...
  - Résultats groupés par type avec lien direct
  - Historique des recherches récentes

**Effort** : Moyen | **Impact** : Moyen

### 6.3 Export Excel Universel

**Constat** : Les managers ont besoin d'extraire des données dans Excel régulièrement.

**Proposition** :
- Ajouter un bouton **"Exporter en Excel"** sur chaque tableau de l'application
- Format .xlsx avec mise en forme (en-têtes, filtres)
- Choix des colonnes à exporter
- Librairie : `xlsx` (déjà disponible en dépendance potentielle)

**Effort** : Faible | **Impact** : Fort

### 6.4 Raccourcis Clavier

**Constat** : Les managers power-users gagneraient en productivité.

**Proposition** :
- Raccourcis pour les actions fréquentes :
  - `N` : Nouveau (candidat, tournée, commande selon la page)
  - `S` : Sauvegarder
  - `Esc` : Annuler / Fermer
  - `←/→` : Navigation entre onglets
- Afficher les raccourcis dans une aide accessible par `?`

**Effort** : Faible | **Impact** : Faible

---

## 7. Récapitulatif et Priorisation

### Priorité Haute (Impact fort, effort raisonnable)

| # | Amélioration | Profil | Effort | Impact |
|---|-------------|--------|--------|--------|
| 1 | Tutoriel intégré (onboarding) | Tous | Faible | Fort |
| 2 | Aide contextuelle par page | Tous | Moyen | Fort |
| 3 | Mode simplifié collaborateurs | Collaborateurs | Moyen | Fort |
| 4 | Interface ultra-simplifiée mobile | Chauffeurs | Moyen | Fort |
| 5 | Alertes proactives insertion | RH | Moyen | Fort |
| 6 | Export Excel universel | Managers | Faible | Fort |
| 7 | Dashboard visuel tri | Tri | Moyen | Fort |
| 8 | Notifications chauffeur temps réel | Collecte | Moyen | Fort |

### Priorité Moyenne

| # | Amélioration | Profil | Effort | Impact |
|---|-------------|--------|--------|--------|
| 9 | Saisie rapide code-barres | Tri | Faible | Fort |
| 10 | Tableau de bord insertion enrichi | RH | Moyen | Fort |
| 11 | Raccourcis rapides tri | Tri | Faible | Moyen |
| 12 | Carte CAV enrichie | Collecte | Moyen | Moyen |
| 13 | Planning drag & drop exutoires | Logistique | Moyen | Moyen |
| 14 | Modèles plans d'action CIP | RH | Faible | Moyen |
| 15 | Recherche globale | Tous | Moyen | Moyen |

### Priorité Basse (Nice to have)

| # | Amélioration | Profil | Effort | Impact |
|---|-------------|--------|--------|--------|
| 16 | Mode hors-ligne amélioré | Chauffeurs | Élevé | Fort |
| 17 | Navigation vocale | Chauffeurs | Moyen | Fort |
| 18 | Thème sombre | Tous | Faible | Faible |
| 19 | Raccourcis clavier | Power users | Faible | Faible |

---

## 8. Plan d'Implémentation Suggéré

### Phase 1 — Quick Wins (1-2 semaines)
- Export Excel universel (#6)
- Raccourcis rapides tri (#11)
- Saisie rapide code-barres (#9)
- Modèles plans d'action CIP (#14)

### Phase 2 — Accessibilité (2-4 semaines)
- Tutoriel intégré (#1)
- Aide contextuelle (#2)
- Mode simplifié collaborateurs (#3)

### Phase 3 — Expérience Mobile (2-3 semaines)
- Interface ultra-simplifiée mobile (#4)
- Notifications chauffeur temps réel (#8)

### Phase 4 — Pilotage Avancé (2-4 semaines)
- Alertes proactives insertion (#5)
- Dashboard visuel tri (#7)
- Tableau de bord insertion enrichi (#10)

### Phase 5 — Optimisation (2-3 semaines)
- Carte CAV enrichie (#12)
- Planning drag & drop (#13)
- Recherche globale (#15)

---

*Ce document est un support d'aide à la décision. Les priorités doivent être validées avec les managers opérationnels et ajustées en fonction des retours terrain.*
