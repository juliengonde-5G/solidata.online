# Cahier des charges fonctionnel — Planification des tournées associations

**Projet** : SOLIDATA ERP — module Collecte, volet tournées associations
**Date** : 26 août 2026
**Statut** : proposé à validation (aucun code modifié à ce stade)
**Documents liés** : `01-alignement-operationnel.md` (traduction logicielle), `docs/LOGIQUE_TOURNEES.md` §5.4 (existant)

---

## 1. Contexte et objet

Solidarité Textiles collecte du textile auprès de deux familles de points : les **CAV** (bornes de rue,
en libre accès permanent) et les **associations partenaires** (locaux tenus par des personnes, avec
des horaires, des interlocuteurs et des volumes très variables). Le module de planification traite
aujourd'hui les deux familles de la même façon : un point association est planifiable à toute heure,
sa durée de collecte est le forfait unique des CAV (10 min), et aucune demande de passage à heure
fixe ne peut être enregistrée.

Trois règles de gestion nouvelles, exprimées par le client le 26/08/2026, font l'objet de ce cahier
des charges :

1. Une association a des **horaires d'ouverture ou d'accessibilité**. Cette information entre dans la
   fiche de l'association, et la planification de cette association est **bloquée en dehors de ces
   horaires**.
2. Une association peut faire la **demande d'une collecte avec un horaire précis**. Le passage de la
   collecte est alors planifié précisément selon cette contrainte.
3. La **durée de collecte** dans une association est très variable. Au moment de la programmation,
   le logiciel **propose d'ajuster le temps d'arrêt**.

## 2. Définitions

| Terme | Définition |
|---|---|
| **Point association** | Ligne du référentiel `association_points` : un local partenaire où l'équipage collecte du textile. |
| **Tournée association** | Tournée `tours.collection_type = 'association'` : uniquement des points association (jamais mélangée avec des CAV sur un même véhicule/jour — garde existante). |
| **Horaires d'accessibilité** | Plages horaires hebdomadaires pendant lesquelles l'équipage peut être reçu (ouverture du local, présence d'un référent, accès au quai…). |
| **Demande de collecte (rendez-vous)** | Demande formulée par une association d'un passage un jour donné, à une heure précise ou dans un créneau. |
| **Durée d'arrêt** | Temps passé sur place par l'équipage (hors trajet), consommé par le moteur de temps comme `serviceMinutes`. |
| **Fenêtre effective d'un rendez-vous** | [heure début − tolérance ; heure fin + tolérance]. Un passage prévu dans cette fenêtre honore le rendez-vous. |

## 3. État des lieux (reconnaissance du 26/08/2026, 3 agents, références vérifiées)

### 3.1 Ce qui existe et fonctionne

- **Référentiel complet** : `association_points` (adresse, contact, statut actif / inactif /
  temporairement indisponible, géocodage BAN, carte) géré dans `/admin-associations`
  (ADMIN/MANAGER, suppression ADMIN).
- **Modèles de tournées association** : `standard_route_association` avec CRUD complet,
  composition ordonnée (CavPicker mode association), estimation stockée, onglet dédié de
  `/route-templates`.
- **Création outillée** : `POST /tours/association` (véhicule + date + liste ordonnée de points),
  estimation par le moteur de temps commun (budget 6 h, pause déjeuner, refus 409
  `DUREE_MAX_DEPASSEE` forçable et tracé), depuis la page Tours (sélection libre) et depuis le
  planning (via modèle, depuis la 2.37.3).
- **Parcours mobile complet** : les points association arrivent au chauffeur sous la même forme
  que les CAV (clé `cavs`), collecte sans scan QR ni photo obligatoire, motif de non-collecte
  dans `notes`.
- **Heures prévues par point** : `planned_passage_time` est calculé et stocké aussi pour les
  points association (`planned-passage.js`), affiché en Collecte en direct.

### 3.2 Limites et défauts constatés (fondent les prérequis du lot 1)

| # | Constat | Référence |
|---|---|---|
| L1 | **Aucune notion d'horaire d'accessibilité** nulle part : ni colonne sur `association_points`, ni fenêtre horaire dans le moteur (`normalizePoint` n'accepte que id/type/name/lat/lng/serviceMinutes/weightKg). Grep négatif sur tout le dépôt (`time_window`, `plage_horaire`, `creneau`). | `tour-time-engine.js:164-175` |
| L2 | **Durée de service unique** : tout point association reçoit `timePerCav` (défaut 10 min, réglage global partagé avec les CAV). Aucun temps appris (les temps appris `cav_collection_times` n'existent que pour les CAV ; `planned-passage.js` passe explicitement une map vide pour les associations). | `smart-tour.js:366-368`, `planned-passage.js:153-155` |
| L3 | **Poids jamais estimé** pour un point association (0 kg, avertissement explicite « jamais de valeur inventée ») → les retours de vidage ne sont pas anticipés sur ces tournées. Comportement assumé, rappelé ici pour périmètre. | `smart-tour.js:352-365` |
| L4 | **`tonnage_history_association` et `association_learning_feedback` ne sont JAMAIS écrites** : les effets de clôture ne lisent que `tour_cav`. Conséquences : « dernière collecte » et « poids moyen 90 j » de la carte restent vides ; `predictAssociationFillRate` est du code jamais appelé, sur des tables jamais alimentées. | `completion-effects.js:37-48`, `predictions.js:561,742` |
| L5 | **Édition en direct inopérante** sur une tournée association : `/programme` ne lit que `tour_cav` — les points association ne sont ni affichés ni modifiables (ajout, retrait, réordonnancement impossibles). | `live-edit.js:69-99` |
| L6 | **Collision de positions PROUVÉE sur base réelle** : les arrêts au centre (départ/pause/fin, 2.37.x) sont numérotés sans voir `tour_association_point`. Sur une tournée association de 4 points, le programme résultant est : départ **et** point n°1 tous deux en position 1, **fin de tournée en position 2** (devant les points restants), pause en 5. L'ordre affiché au chauffeur est faux. | `arrets.js` (positionSuivante, poserRetoursAutomatiques) — preuve PostgreSQL 16 du 26/08/2026 |
| L7 | Sur la page Tours, la sélection des points association est une liste de **cases à cocher sans ordre** (tri alphabétique), et **aucune case cochée = toutes les associations actives incluses** par défaut. | `Tours.jsx:140,228,594-638` |
| L8 | `tour_association_point` n'a **pas d'horodatage d'arrivée** (`collected_at` seul) : la durée réelle passée sur place n'est mesurable nulle part aujourd'hui. | `init-db.js:5037-5060` |

Ces limites ne sont pas toutes dans le périmètre des trois règles nouvelles, mais L5, L6 et L7
conditionnent directement leur bon fonctionnement : on ne peut pas « planifier précisément un
passage » sur un programme dont l'ordre affiché est faux et qu'on ne peut pas retoucher.

## 4. Règles de gestion

### RG-A — Horaires d'accessibilité (règle client n°1)

- **RG-A1.** La fiche association porte des horaires d'accessibilité hebdomadaires : pour chaque
  jour (lundi → dimanche), zéro, une ou plusieurs plages `début–fin` (ex. lundi 09:00–12:00 et
  14:00–17:00). Un jour sans plage est un jour **fermé**.
- **RG-A2.** Des horaires **non renseignés** (fiche jamais complétée) signifient « information
  inconnue », pas « ouvert en permanence » ni « fermé » : la planification reste permise, et
  l'écran le dit (« horaires non renseignés »). *Jamais de valeur inventée* : on ne bloque pas sur
  une information qui n'existe pas. → arbitrage n°2 si le client préfère l'inverse.
- **RG-A3.** À l'estimation et à la création d'une tournée association, pour chaque point dont les
  horaires sont renseignés, l'intervalle **[heure d'arrivée prévue ; arrivée + durée d'arrêt]**
  doit être contenu dans une plage du jour de la tournée. Sinon la création est **refusée**
  (409 `ASSOCIATION_HORS_HORAIRES`) avec, point par point : l'heure prévue, les plages du jour,
  et le premier créneau compatible s'il en existe un.
- **RG-A4.** Le refus est **forçable par le gestionnaire** (ADMIN/MANAGER), avec trace dans la
  tournée — les heures prévues restent des estimations, et le gestionnaire peut savoir des choses
  que le logiciel ignore (accord téléphonique ponctuel). → arbitrage n°1 si le client veut un
  blocage absolu.
- **RG-A5.** Un jour entièrement fermé rend le point non planifiable ce jour-là (le refus RG-A3
  s'applique quelle que soit l'heure).
- **RG-A6.** Les horaires n'annulent pas le statut existant `temporairement_indisponible` : les
  deux mécanismes se cumulent (le statut dit « n'y allez pas du tout », les horaires disent
  « allez-y aux bonnes heures »).
- **RG-A7.** Les modèles de tournées n'ont pas de date : le contrôle s'applique à
  l'**instanciation** du modèle. L'écran des modèles affiche à titre informatif les jours de
  fermeture des points composant le modèle.
- **RG-A8.** L'écran chauffeur affiche, sur chaque point association, les horaires du jour
  (« Aujourd'hui : 9h–12h / 14h–17h », FALC) — information, pas blocage : une fois la tournée
  partie, c'est l'équipage qui gère.

### RG-B — Demande de collecte à horaire précis (règle client n°2)

- **RG-B1.** Le gestionnaire peut enregistrer une **demande de collecte** : association, date
  souhaitée, horaire précis (heure exacte, ou créneau début–fin), tolérance en minutes
  (défaut : réglage global, proposé ±15 min), commentaire. La saisie est faite par le
  gestionnaire (les demandes arrivent par téléphone ou mail) — pas de portail association en v1.
- **RG-B2.** Les demandes non planifiées sont **visibles au planning** (panneau dédié) et mises en
  avant à la création d'une tournée association du jour concerné (le point est signalé, l'heure
  affichée, la demande rattachée au passage créé).
- **RG-B3.** Un passage rattaché à une demande est **ancré** : son heure d'arrivée prévue doit
  tomber dans la fenêtre effective. Si l'équipage arriverait en avance, le moteur insère une
  **attente** explicite dans la chronologie (comptée dans la journée — arbitrage n°3 sur son
  imputation travail/hors travail). S'il arriverait après la fenêtre, le rendez-vous est déclaré
  **non tenable** : refus 409 `RDV_NON_TENABLE` détaillé (forçable avec trace — arbitrage n°5).
- **RG-B4.** À l'estimation, si l'ordre soumis ne tient pas le rendez-vous, le serveur **propose un
  ordre qui le tient** quand il en existe un (le point ancré est déplacé à la position
  chronologiquement compatible) plutôt que de refuser sèchement.
- **RG-B5.** La ré-optimisation en cours de tournée **ne déplace jamais** un point ancré hors de sa
  fenêtre (point épinglé).
- **RG-B6.** Le chauffeur voit le rendez-vous sur l'étape (« Rendez-vous à 10:30 », FALC).
- **RG-B7.** Le devenir de la demande est **dérivé, jamais saisi** : à planifier (aucun passage
  rattaché), planifiée (passage rattaché, tournée non close), honorée (collectée dans la fenêtre
  effective), non honorée (collectée hors fenêtre, sautée, ou tournée close sans passage),
  annulée (seul état posé à la main). La suppression de la tournée fait retomber la demande
  « à planifier » sans perte.
- **RG-B8.** Une même association peut avoir plusieurs demandes (dates différentes). Deux demandes
  le même jour sur la même association sont refusées à la saisie (doublon).

### RG-C — Durée d'arrêt ajustable (règle client n°3)

- **RG-C1.** La fiche association porte une **durée de collecte par défaut** (minutes). Non
  renseignée, le réglage global actuel s'applique (« Temps par CAV », 10 min — inchangé).
- **RG-C2.** À la programmation d'une tournée association (page Tours, modal du planning, modèles),
  chaque point sélectionné affiche sa durée **pré-remplie et ajustable pour cette tournée**.
  L'estimation (durée totale, heure de retour, jauge 6 h) se recalcule en direct.
- **RG-C3.** La cascade de résolution de la durée d'un passage est : **ajustement de la tournée**
  > **durée de la fiche** > **réglage global**. Chaque niveau ne s'applique que si le précédent
  est vide — aucune valeur inventée, la provenance est affichable.
- **RG-C4.** La durée ajustée est celle que consomme le moteur de temps (budget 6 h, heure de
  retour, heures prévues par point, contrôle d'horaires RG-A3 et d'ancrage RG-B3).
- **RG-C5.** *(Extension, hors lots fermes — arbitrage n°7)* Les durées réelles passées sur place
  sont mesurées et apprises par association (comme les temps appris des CAV), et remplacent le
  défaut de la fiche dans la cascade (ajustement tournée > appris > fiche > global) une fois un
  minimum d'observations atteint.

## 5. Exigences traçables

| Exigence | Description | Règle | Lot |
|---|---|---|---|
| EXG-ASSO-01 | Colonnes horaires + durée + notes sur la fiche association, éditeur hebdomadaire dans AdminAssociations | RG-A1, RG-C1 | 1 |
| EXG-ASSO-02 | Échelle de positions **unifiée** points association ↔ arrêts au centre (correctif L6, prouvé) | prérequis | 1 |
| EXG-ASSO-03 | Édition en direct (/programme) opérante sur les tournées association (correctif L5) | prérequis | 1 |
| EXG-ASSO-04 | Clôture : écrire `tonnage_history_association` (+ feedback si niveau saisi) — correctif L4 | dette | 1 |
| EXG-ASSO-05 | Cascade de durées (tournée > fiche > global) consommée par estimation, création, heures prévues | RG-C2-C4 | 1 |
| EXG-ASSO-06 | Sélection **ordonnée** des points association page Tours (CavPicker), durées ajustables, fin du « rien coché = tout inclus » (L7 — arbitrage n°6) | RG-C2 | 1 |
| EXG-ASSO-07 | Moteur : fenêtres d'accessibilité par point, violations signalées dans l'estimation | RG-A3 | 2 |
| EXG-ASSO-08 | Refus 409 `ASSOCIATION_HORS_HORAIRES` détaillé, forçable et tracé | RG-A3, RG-A4 | 2 |
| EXG-ASSO-09 | Avertissements d'horaires dans l'estimation live et badges (fiche, sélection, modèles) | RG-A2, RG-A7 | 2 |
| EXG-ASSO-10 | Horaires du jour sur l'écran chauffeur (FALC) | RG-A8 | 2 |
| EXG-ASSO-11 | Table des demandes de collecte + CRUD + anti-doublon | RG-B1, RG-B8 | 3 |
| EXG-ASSO-12 | Panneau « Demandes à planifier » au planning + mise en avant à la création | RG-B2 | 3 |
| EXG-ASSO-13 | Moteur : ancrage (attente explicite, fenêtre effective), 409 `RDV_NON_TENABLE`, suggestion d'ordre | RG-B3, RG-B4 | 3 |
| EXG-ASSO-14 | Points ancrés épinglés dans la ré-optimisation | RG-B5 | 3 |
| EXG-ASSO-15 | Rendez-vous affiché au chauffeur (FALC) | RG-B6 | 3 |
| EXG-ASSO-16 | Statuts de demande dérivés (honorée / non honorée à la clôture) | RG-B7 | 3 |
| EXG-ASSO-17 | Apprentissage des durées réelles par association | RG-C5 | ext. |

## 6. Points d'arbitrage (à trancher avant implémentation)

| # | Question | Options | Recommandation |
|---|---|---|---|
| 1 | Le blocage hors horaires est-il **forçable** ? | (a) refus absolu ; (b) forçable ADMIN/MANAGER avec trace | **(b)** — les heures prévues sont des estimations ; cohérent avec le forçage existant du dépassement de durée |
| 2 | Association **sans horaires renseignés** ? | (a) planifiable, avec mention explicite ; (b) bloquée tant que non renseigné | **(a)** — bloquer sur une information absente paralyserait le module au premier jour |
| 3 | L'**attente** avant un rendez-vous compte-t-elle dans le temps de travail (budget 6 h) ? | (a) oui, comme du travail ; (b) non, comme la pause | **(a)** — l'équipage est en service ; piloté par réglage pour rester réversible |
| 4 | **Tolérance** de rendez-vous par défaut ±15 min (réglable dans Administration → Moteur prédictif) ? | valeur libre | **±15 min** |
| 5 | Un rendez-vous **non tenable** à la planification est-il forçable ? | (a) refus absolu ; (b) forçable avec trace | **(b)** — même logique que l'arbitrage 1 ; le gestionnaire peut avoir renégocié par téléphone |
| 6 | Page Tours : supprimer le comportement « aucune case cochée = **toutes** les associations incluses » ? | (a) oui, sélection explicite requise ; (b) conserver | **(a)** — 30 points embarqués par mégarde est un vrai risque |
| 7 | **Apprentissage des durées réelles** : dans le lot 3 ou en extension ultérieure ? | (a) lot 3 ; (b) extension | **(b)** — livrer d'abord la cascade manuelle, mesurer, apprendre ensuite |

## 7. Hors périmètre (explicitement)

- **Portail de saisie côté association** (demande en ligne) : long terme, rejoint la piste « API
  ouverte partenaires » de la feuille de route générale.
- **Estimation du poids collecté par association** : le poids reste non estimé (0 kg, avertissement
  explicite) tant qu'aucun historique fiable n'existe — l'alimentation de
  `tonnage_history_association` (EXG-ASSO-04) est le préalable qui rendra une estimation possible
  un jour, pas cette évolution-ci.
- **Optimisation d'ordre complète sous fenêtres horaires** (TSP à fenêtres dans `tour-optimizer`) :
  la v1 se limite au contrôle + suggestion simple (RG-B4) ; l'optimisation fine est une extension.
- **Re-contrôle dynamique en cours de tournée** (retard qui fait sortir un passage de ses
  horaires) : un avertissement en Collecte en direct est envisageable en extension ; rien de
  bloquant en roulage.

---

*Rédigé sur la base de la reconnaissance multi-agents du 26/08/2026 (3 rapports, références
fichier:ligne vérifiées) et d'une preuve sur PostgreSQL 16 réel pour le constat L6.*
