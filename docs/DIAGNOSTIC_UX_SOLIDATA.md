# Diagnostic UX — SOLIDATA ERP

## Contexte métier

**SOLIDATA** est un ERP pour une association de collecte de déchets textiles sur la métropole de Rouen, avec deux missions :

1. **Collecte & tri** : activité soumise à la réglementation d’un éco-organisme (tracabilité des flux, chaîne recyclage, réutilisation, réemploi).
2. **Insertion professionnelle** : recrutement et accompagnement de publics éloignés de l’emploi (parcours de compétences, insertion vers l’emploi durable).

---

## Étape 2 — Audit par persona

### 2.1 CIP (Conseillère en Insertion Professionnelle)

**Rôle** : Collecter les candidatures, suivre le parcours d’insertion jusqu’à l’intégration.

| Problème | Gravité | Recommandation |
|----------|---------|----------------|
| Menu éclaté (Recrutement / Gestion Équipe / Parcours insertion) : la CIP doit naviguer entre Candidats, PCM, Collaborateurs, Heures, Compétences, Parcours insertion. | Élevée | Regrouper sous une entrée type « Insertion & Recrutement » avec sous-menu ou onglets (Candidats, Parcours, PCM, Heures). |
| Kanban Candidats : pas de filtre par poste ou date, colonnes fixes. | Moyenne | Filtres (poste, date, statut), colonnes repliables sur mobile. |
| Pas de vue « à faire aujourd’hui » (entretiens, relances). | Moyenne | Bloc ou page « Aujourd’hui » : entretiens du jour, candidats à relancer. |
| Conversion candidat → employé via `window.confirm` / `alert`. | Faible | Remplacer par modal dédiée avec rappel des infos (contrat, date) et message de succès in-app. |
| Parcours insertion : page dense (radar, timeline, freins, actions), peu de hiérarchie visuelle. | Élevée | Découper en onglets ou étapes (Vue d’ensemble / Parcours / Freins & actions), cartes résumées en haut. |
| Infos manquantes : pas de rappel du prochain RDV ou de la prochaine action sur le dashboard. | Moyenne | Widget dashboard « Prochains RDV insertion » et « Actions à faire ». |

---

### 2.2 Manager de la filière collecte

**Rôle** : Préparer la collecte, affecter les équipes, préparer les tournées, entretien véhicules, suivi live, stock matière première.

| Problème | Gravité | Recommandation |
|----------|---------|----------------|
| Tournées : création en plusieurs étapes (wizard) mais pas de vue « semaine » ou calendrier. | Moyenne | Vue calendrier ou timeline des tournées + lien direct « Nouvelle tournée ». |
| Pas de lien explicite entre « Propositions (IA) » et « Tournées » (workflow peu lisible). | Moyenne | Enchaînement clair : Propositions → Validation → Création tournée ; breadcrumb ou étapes. |
| Véhicules et Live GPS dans des pages séparées : pas de vue unifiée « véhicule + tournée en cours ». | Élevée | Page ou section « Flotte » : liste véhicules avec indicateur « en tournée » et lien vers suivi live. |
| Stock MP : page dédiée mais pas de résumé sur le dashboard (alerte seuil). | Moyenne | Tuile dashboard « Stock MP » avec indicateur et lien vers détail. |
| Carte CAV et Remplissage CAV : deux entrées distinctes, potentiellement redondantes. | Faible | Fusionner ou clarifier (Carte = géoloc, Remplissage = taux + alertes). |

---

### 2.3 Collaborateur de collecte (terrain, smartphone)

**Rôle** : Découvrir sa tournée, utiliser l’outil comme GPS, déclarer l’état de la collecte.

| Problème | Gravité | Recommandation |
|----------|---------|----------------|
| Parcours mobile : VehicleSelect → Checklist → TourMap → QRScanner → FillLevel → etc. Pas de rappel du « prochain pas » après chaque écran. | Élevée | Barre d’étapes (déjà partielle) toujours visible + libellé « Prochaine étape : scanner le CAV ». |
| Texte trop long ou technique (ex. « Déclarer le niveau de remplissage ») pour des personnes en mobilité ou avec faible maîtrise du français. | Élevée | Prioriser icônes + libellés courts (« Remplissage », « Scanner », « Pesée »). Proposer pictogrammes (plein / vide / demi). |
| Usage potentiel en conduite : trop de lecture. | Élevée | Actions en gros boutons, voix (TTS) optionnelle pour « Prochain arrêt : … », réduction du texte à l’écran. |
| Pas de mode « vue liste » des CAV de la tournée en plus de la carte. | Moyenne | Onglet ou bascule Liste / Carte pour voir ordre des CAV sans carte. |
| Retour centre / pesée : parcours pas toujours évident (intermediate return vs fin de tournée). | Moyenne | Deux boutons explicites : « Retour au centre (fin) » et « Pesée puis continuer ». |

---

### 2.4 Manager de la structure (vision 360°)

**Rôle** : Vision globale collecte, affectation équipes (collecte / tri / logistique), suivi collecte, production (chaîne de tri), avancée insertion.

| Problème | Gravité | Recommandation |
|----------|---------|----------------|
| Pas de tableau de bord « 360 » dédié : il faut enchaîner Dashboard, Tournées, Live, Production, Insertion. | Élevée | Page « Vue Structure » ou dashboard enrichi : blocs Collecte du jour, Tri / Production, Insertion (résumés) + liens rapides. |
| Affectation des équipes : répartis entre Collaborateurs, Tournées, Production ; pas de vue « qui fait quoi aujourd’hui ». | Élevée | Vue « Planning du jour » : collecte (qui, véhicule, tournée) / tri / logistique avec indicateurs. |
| Indicateurs insertion (nombre en parcours, sorties positives) pas agrégés sur le dashboard principal. | Moyenne | Tuiles ou graphiques « Insertion » sur le dashboard (parcours actifs, embauches, à suivre). |

---

### 2.5 Administration / Reporting collectivité

**Rôle** : Justifier l’impact (insertion & emploi, émissions évitées, volume collecte, remplissage CAV en temps réel).

| Problème | Gravité | Recommandation |
|----------|---------|----------------|
| Trois dimensions (insertion, CO₂, collecte/CAV) réparties dans plusieurs pages (Reporting RH, Reporting Collecte, Métropole, Refashion). | Élevée | Page « Reporting Collectivité » ou « Synthèse impact » : 3 blocs (Insertion, Émissions évitées, Collecte & CAV) avec KPIs et liens vers rapports détaillés. |
| Exports / rapports imprimables pas mis en avant. | Moyenne | Boutons « Exporter PDF » / « Rapport annuel » visibles sur chaque reporting. |
| Remplissage CAV temps réel : page dédiée (FillRateMap) à intégrer dans la synthèse. | Moyenne | Widget ou iframe « Remplissage CAV live » sur la page de synthèse. |

---

### 2.6 Gestionnaire de personnel (RH)

**Rôle** : Recrutement, suivi candidatures, affectations, temps de travail (à la journée), parcours de personnalité.

| Problème | Gravité | Recommandation |
|----------|---------|----------------|
| Recrutement et candidatures : même entrée que la CIP (Candidats + PCM) ; pas de vue « postes à pourvoir » en premier plan. | Moyenne | Vue « Postes ouverts » avec nombre de candidatures par poste ; lien vers Kanban par poste. |
| Heures de travail : page dédiée mais pas de résumé « heures du mois » ou alertes (dépassement, non-saisie). | Moyenne | Tuile dashboard « Heures du mois » ou lien depuis Dashboard avec indicateur. |
| Parcours personnalité (PCM) : page Matrice séparée ; lien avec le parcours insertion pas évident. | Faible | Depuis la fiche collaborateur / candidat : lien « Profil PCM » et résumé (type, forces). |

---

## Synthèse des actions prioritaires

1. **Navigation** : Regrouper les entrées par rôle (Insertion, Collecte, Production, Reporting, Admin) et proposer un dashboard « Vue Structure » pour le manager.
2. **Dashboard** : Enrichir avec widgets « Aujourd’hui » (RDV, tournées), Stock MP, Heures, Insertion, et lien « Synthèse impact » pour la collectivité.
3. **Mobile** : Réduire le texte, privilégier icônes et libellés courts ; gros boutons ; barre d’étapes + « Prochaine étape » ; clarifier Retour centre / Pesée.
4. **Reporting** : Page « Synthèse impact » avec les 3 dimensions (insertion, CO₂, collecte/CAV) et exports visibles.
5. **Cohérence visuelle** : Charte graphique unique (bleu pétrole, gris, blanc cassé), composants réutilisables (cartes, tuiles, boutons), responsive et accessible.

---

## Étape 3 — Charte graphique (résumé)

- **Couleurs** : Bleu pétrole (primaire), gris clair (surfaces), blanc cassé (fond), accent secondaire pour états (succès, alerte, erreur).
- **Typographie** : Sans-serif (ex. Plus Jakarta Sans), hiérarchie claire (titres, corps, légendes).
- **Composants** : Cartes avec bords arrondis 12–16 px, ombres légères, survol discret ; tuiles KPI homogènes ; menu latéral avec sections repliables.
- **Responsive** : Menu latéral repliable / drawer sur mobile ; tableaux en cartes ou liste sur petit écran.
- **Mobile (terrain)** : Zones tactiles ≥ 44 px, libellés courts, icônes, contraste suffisant (WCAG).

Cette charte est détaillée en variables CSS et Tailwind dans le design system (voir `frontend/src/index.css` et `frontend/tailwind.config.js`).
