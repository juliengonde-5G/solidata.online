# Alignement opérationnel — Tournées associations dans SOLIDATA

**Date** : 26 août 2026 · **Statut** : proposition à valider (aucun code modifié)
**Répond à** : `00-cahier-des-charges.md` (règles RG-A/B/C, exigences EXG-ASSO-01…17, arbitrages 1-7)

Ce document traduit le cahier des charges en modifications concrètes du logiciel : schéma, moteur,
API, écrans web, mobile — puis propose un phasage en trois lots livrables indépendamment. Toutes
les références à l'existant sont issues de la reconnaissance du 26/08/2026 (fichier:ligne vérifiés).

---

## 1. Prérequis : remettre le socle d'aplomb (lot 1)

Trois défauts constatés rendent les nouvelles règles inopérantes s'ils ne sont pas corrigés d'abord.

### 1.1 Échelle de positions unifiée (EXG-ASSO-02 — collision PROUVÉE)

Les fonctions de position de `backend/src/routes/tours/arrets.js` (`positionSuivante`,
`insererApresDernierPointTraite`, `poserPauseDejeuner`, `poserRetoursAutomatiques`,
`avancerRetourCentre`) ne lisent et ne décalent que `tour_cav` + `tour_arret_technique`. Sur une
tournée association (points dans `tour_association_point`), preuve sur PostgreSQL 16 réel du
26/08/2026 : départ du centre **et** premier point tous deux en position 1, **retour de fin en
position 2** (devant les points restants), pause en collision potentielle. L'ordre affiché au
chauffeur est faux.

**Correctif** : chaque requête de position de `arrets.js` intègre `tour_association_point` dans son
UNION (lecture du max, décalages `position >= $2`). Aucun changement d'API — le mobile fusionne
déjà `arrets` et `cavs` par numéro de position, il redevient simplement juste. Tests de contrat +
preuve sur base réelle rejouée (le scénario de la preuve devient un test).

### 1.2 Édition en direct des tournées association (EXG-ASSO-03)

`live-edit.js` (`chargerProgramme`, `/programme/ordre`, `/programme/cav` ajout/retrait) n'opère que
sur `tour_cav` : une tournée association n'affiche que ses arrêts techniques, sans aucun point.

**Correctif** : `chargerProgramme` ajoute la branche `tour_association_point` (kind
`'association'`), les mutations acceptent ce kind (ajout d'un point association depuis le
référentiel, retrait, réordonnancement). Le calcul d'impact (`impact.js`) fonctionne déjà pour les
points association (`chargerPointsTournee` a la branche association) — seule la surface d'édition
manquait.

### 1.3 Clôture : écrire enfin l'historique association (EXG-ASSO-04)

`completion-effects.js` ne lit que `tour_cav` : `tonnage_history_association` et
`association_learning_feedback` existent, sont **lues** (carte, prédiction jamais branchée) mais ne
sont **jamais écrites**. « Dernière collecte » et « poids moyen 90 j » de la carte des associations
sont structurellement vides.

**Correctif** : à la clôture d'une tournée association, répartir `total_weight_kg` sur les points
`collected` de `tour_association_point` (même règle de répartition que les CAV) →
`tonnage_history_association` ; écrire `association_learning_feedback` quand un `fill_level` a été
saisi. Même garde démo, même idempotence que l'existant. Script de rattrapage optionnel pour les
tournées association déjà closes (dry-run par défaut), sur le modèle de
`rattraper-pesees-intermediaires.js`.

---

## 2. Modèle de données

Toutes les migrations sont idempotentes, dans `init-db.js` (convention projet).

### 2.1 Fiche association — `association_points` (lot 1)

```sql
ALTER TABLE association_points
  ADD COLUMN IF NOT EXISTS horaires_accessibilite JSONB,      -- null = non renseigné
  ADD COLUMN IF NOT EXISTS horaires_notes TEXT,               -- « sonner au portail », « fermé en août »…
  ADD COLUMN IF NOT EXISTS duree_collecte_min INTEGER;        -- null = réglage global (timePerCav)
```

Forme du JSONB (alignée sur le pattern `weekly_schedule` de l'import paie, en plus général —
liste de plages plutôt que matin/après-midi figés) :

```json
{
  "lundi":    [{"debut": "09:00", "fin": "12:00"}, {"debut": "14:00", "fin": "17:00"}],
  "mardi":    [{"debut": "09:00", "fin": "12:00"}],
  "mercredi": [],
  "jeudi":    [{"debut": "09:00", "fin": "17:00"}],
  "vendredi": [{"debut": "09:00", "fin": "12:00"}],
  "samedi":   [],
  "dimanche": []
}
```

Sémantique (RG-A1/A2) : **JSONB null = horaires inconnus** (planification permise, mention
affichée) ; **JSONB présent** = la semaine fait foi, un jour à `[]` ou absent = fermé. Validation
serveur : jours ∈ {lundi…dimanche}, `HH:MM` strictes (regex du pattern badgeuse), `debut < fin`,
plages non chevauchantes ; refus 400 sinon.

### 2.2 Passage — `tour_association_point` (lot 1 puis 3)

```sql
ALTER TABLE tour_association_point
  ADD COLUMN IF NOT EXISTS duree_prevue_min INTEGER,          -- lot 1 : ajustement pour CETTE tournée
  ADD COLUMN IF NOT EXISTS demande_id INTEGER REFERENCES association_collecte_demandes(id) ON DELETE SET NULL;  -- lot 3
```

### 2.3 Demandes de collecte — nouvelle table (lot 3)

```sql
CREATE TABLE IF NOT EXISTS association_collecte_demandes (
  id SERIAL PRIMARY KEY,
  association_point_id INTEGER NOT NULL REFERENCES association_points(id) ON DELETE CASCADE,
  date_souhaitee DATE NOT NULL,
  heure_debut TIME NOT NULL,          -- horaire précis : heure_fin NULL
  heure_fin TIME,                     -- créneau : [heure_debut ; heure_fin]
  tolerance_min INTEGER,              -- null = réglage global collecte (défaut proposé 15)
  commentaire TEXT,
  annulee_le TIMESTAMP,               -- seul état posé à la main (avec motif dans commentaire)
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (association_point_id, date_souhaitee)               -- RG-B8 anti-doublon
);
```

**Statut dérivé, jamais stocké** (RG-B7 — aucune divergence possible entre un statut écrit et la
réalité de la tournée) :

| Lecture | Statut |
|---|---|
| `annulee_le` non null | annulée |
| aucun `tour_association_point.demande_id` ne pointe la demande | à planifier |
| passage rattaché, tournée non close | planifiée |
| tournée close, `collected_at` dans la fenêtre effective | honorée |
| tournée close, hors fenêtre / point sauté / passage supprimé sans replanification passée la date | non honorée |

Fenêtre effective = `[heure_debut − tolérance ; COALESCE(heure_fin, heure_debut) + tolérance]`,
tolérance = `tolerance_min` sinon réglage global. La suppression d'une tournée remet la demande
« à planifier » mécaniquement (FK `SET NULL`), sans aucun code de rattrapage.

### 2.4 Réglages (scoring config existante, AdminPredictive)

- `rdvToleranceMin` (défaut **15**) — tolérance de rendez-vous par défaut (arbitrage n°4).
- `attenteCompteTravail` (défaut **true**) — imputation de l'attente (arbitrage n°3, réversible
  sans code).

---

## 3. Moteur de temps (`services/tour-time-engine.js`) — extension PURE

Le moteur reste pur (E/S injectées) ; deux champs optionnels par point, un type d'entrée nouveau,
un bloc de violations. Tout point sans ces champs se comporte exactement comme aujourd'hui
(rétro-compatibilité totale, tests existants inchangés).

### 3.1 Entrées par point

```js
{ id, type, name, lat, lng, serviceMinutes, weightKg,
  windows: [[540, 720], [840, 1020]] | null,   // plages du JOUR, en minutes d'horloge (RG-A)
  anchor:  { debutMin: 630, finMin: 660 } | null }  // fenêtre effective du RDV (RG-B)
```

La conversion horaires-hebdo → plages du jour (et fenêtre effective du RDV) se fait chez
l'appelant (`smart-tour.js`), le moteur ne connaissant ni le calendrier ni la table des demandes —
même partage des rôles que `routeLeg`.

### 3.2 Comportement dans `applyPoint`

L'heure d'horloge simulée existe déjà (`startHour*60 + elapsed`) — c'est elle qui décide la pause.
À l'arrivée sur un point :

1. **Ancrage** (`anchor`) : arrivée avant `debutMin` → entrée timeline `{type:'attente', name,
   arrivee_min, depart_min}` jusqu'à l'ouverture, imputée travail ou hors travail selon
   `attenteCompteTravail`. Arrivée après `finMin` → violation `{type:'rdv_manque',
   association_point_id, prevu_min, fenetre}` (le moteur SIGNALE, la route DÉCIDE).
2. **Accessibilité** (`windows`) : l'intervalle `[arrivée ; arrivée + serviceMinutes]` doit tenir
   dans une plage ; sinon violation `{type:'hors_horaires', …, prochain_creneau_min|null}`.
   **Aucune attente automatique** sur simple horaire d'ouverture : arriver à 11h55 devant un local
   qui rouvre à 14h ne doit pas fabriquer 2 h d'attente silencieuse — seul le rendez-vous ancre.

L'estimation expose `violations: []` (vide = conforme) et la timeline peut contenir des entrées
`attente`. `heure_fin_estimee`, budget, pause : mécanique inchangée.

### 3.3 Cascade des durées (RG-C3, dans `smart-tour.js` / `planned-passage.js`)

```
serviceMinutes = duree_prevue_min (passage)  →  duree_collecte_min (fiche)  →  timePerCav (global)
```

`estimateFixedRoute` accepte la durée portée par le point (`p.duree_prevue_min`,
`p.duree_collecte_min`) ; `POST /tours/estimate` accepte `association_points:
[{id, duree_min}]` en plus de `association_point_ids` (compatibilité conservée).
L'extension apprentissage (EXG-ASSO-17) s'insérera entre « passage » et « fiche » sans toucher
au reste.

### 3.4 Suggestion d'ordre sous rendez-vous (RG-B4, `smart-tour.js`)

Heuristique v1, volontairement simple : points ancrés triés par fenêtre croissante ; chaque point
libre inséré à la position minimisant le détour **sous test de faisabilité** (simulation
`buildTimeline`, n petit sur ces tournées). Retournée comme `ordre_suggere` quand l'ordre soumis
viole un ancrage et qu'une solution existe. L'optimisation fine (2-opt sous fenêtres dans
`tour-optimizer`) reste une extension explicitement hors v1.

---

## 4. API

### 4.1 Fiche association (`routes/association-points.js`, lot 1)

- `POST /` et `PUT /:id` acceptent `horaires_accessibilite`, `horaires_notes`,
  `duree_collecte_min` (validation §2.1, 400 détaillé).
- `GET /` et `GET /:id` les exposent, plus deux champs calculés : `jours_fermes` (badges) et
  `horaires_renseignes` (booléen — pour la mention RG-A2).

### 4.2 Estimation et création (lots 1-3)

- `POST /tours/estimate` : accepte les durées par point (lot 1) ; renvoie `violations` (lot 2) et
  `ordre_suggere` + entrées `attente` (lot 3). L'écran d'estimation live affiche tout cela **avant**
  la soumission — le 409 devient l'exception, pas la découverte.
- `POST /tours/association` :
  - lot 1 : accepte `points: [{id, duree_min}]` (rétro-compatible avec `association_point_ids`),
    stocke `duree_prevue_min` ;
  - lot 2 : **409 `ASSOCIATION_HORS_HORAIRES`** si violations `hors_horaires` (payload : par point,
    heure prévue, plages du jour, prochain créneau) ; `force:true` tracé dans `ai_explanation`
    (même mécanique que `DUREE_MAX_DEPASSEE`) — arbitrage n°1 ;
  - lot 3 : accepte `demande_ids` à rattacher ; **409 `RDV_NON_TENABLE`** (payload : demande,
    heure prévue, fenêtre effective, `ordre_suggere` s'il existe) ; forçable tracé — arbitrage n°5.
- Instanciation d'un modèle : mêmes contrôles (le contrôle est dans la route de création, pas dans
  le modèle — RG-A7).

### 4.3 Demandes de collecte (`routes/association-points.js` ou module dédié, lot 3)

- `GET /association-demandes?du=&au=&statut=` (ADMIN/MANAGER) — statuts DÉRIVÉS en SQL.
- `POST /association-demandes` (ADMIN/MANAGER) — anti-doublon 409 sur `(point, date)`.
- `PUT /association-demandes/:id` — modification tant que non honorée.
- `POST /association-demandes/:id/annuler` — pose `annulee_le`.
- La clôture de tournée (completion-effects) n'écrit RIEN sur la demande : honorée/non honorée se
  lisent (RG-B7).

### 4.4 Ré-optimisation (lot 3)

`reoptimize-service.js` reçoit la liste des points épinglés (passages à `demande_id` non null) et
les exclut des permutations (RG-B5) — même mécanique que l'exclusion des points déjà collectés.

---

## 5. Écrans web

| Écran | Évolution | Lot |
|---|---|---|
| **AdminAssociations** (fiche) | Bloc « Accessibilité » : éditeur hebdomadaire de plages (nouveau composant réutilisable `HorairesHebdo`), notes, durée de collecte par défaut. Badges liste : « Fermé mer/sam/dim », « Horaires non renseignés ». | 1 (badges avertissement lot 2) |
| **Tours** (mode association) | La liste à cocher devient une **sélection ordonnée** via `CavPicker mode="association"` (déjà utilisé par les modèles) ; durée ajustable par point pré-remplie (fiche → global, provenance affichée) ; estimation live avec jauge 6 h ; suppression du « rien coché = tout inclus » (arbitrage n°6). | 1 |
| **CreateTourModal** (planning) | Les points du modèle association chargés s'affichent avec durée ajustable ; avertissements horaires dans l'aperçu d'estimation. | 1-2 |
| **RouteTemplates** (modèles) | Info : jours de fermeture des points du modèle (« 2 points fermés le lundi »). | 2 |
| **PlanningTournees** | Panneau « Demandes de collecte » de la semaine (statut dérivé, clic → création pré-remplie) ; badge RDV sur les cartes de tournée. | 3 |
| **LiveVehicles** (Collecte en direct) | Sur les points association : heure prévue déjà là ; ajout badge « RDV 10:30 » + écart quand la tournée roule ; **édition en direct enfin opérante** (prérequis 1.2). | 1 (édition), 3 (RDV) |
| **AdminPredictive** | Deux réglages : tolérance RDV (min), imputation de l'attente. | 3 |

## 6. Mobile chauffeur (FALC)

| Élément | Évolution | Lot |
|---|---|---|
| Carte du point (TourMap) | Ligne « Aujourd'hui : 9h–12h / 14h–17h » quand les horaires sont renseignés ; rien sinon (pas de fausse assurance). | 2 |
| Étape avec rendez-vous | Bandeau « Rendez-vous à 10:30 » sur la carte du point et l'écran de collecte ; le point ancré est signalé dans la liste. | 3 |
| Ordre du programme | Redevient JUSTE sur les tournées association (prérequis 1.1) — départ, pause et fin aux bonnes places. | 1 |

Aucun nouveau geste chauffeur : l'information s'affiche, la collecte ne change pas.

## 7. Phasage proposé

| Lot | Contenu | Livre | Prérequis |
|---|---|---|---|
| **Lot 1 — Socle & durées** | Prérequis 1.1/1.2/1.3 (positions, live-edit, clôture) + schéma fiche + cascade de durées + UI fiche & sélection ordonnée + estimation live | RG-C en entier, saisie RG-A1 (les horaires se saisissent dès le lot 1, le blocage arrive au lot 2) | arbitrage 6 |
| **Lot 2 — Horaires bloquants** | Moteur `windows` + violations, 409 forçable tracé, avertissements live, badges, mobile horaires du jour | RG-A en entier | arbitrages 1, 2 |
| **Lot 3 — Rendez-vous** | Table demandes + CRUD + panneau planning, ancrage moteur (attente), 409 RDV, épinglage ré-optimisation, mobile RDV, statuts dérivés | RG-B en entier | arbitrages 3, 4, 5 |
| **Extensions** (sur décision) | Apprentissage durées réelles (arbitrage 7), optimisation d'ordre sous fenêtres, avertissement dynamique en roulage, portail associations | RG-C5 + hors périmètre §7 du CDC | — |

Chaque lot suit la méthode habituelle du projet : migrations idempotentes rejouées sur PostgreSQL
réel, moteur pur testé sans base, tests de contrat sur les routes, preuve du parcours complet sur
base réelle, builds web + mobile, entrée de changelog, `deploy.sh update` sans commande manuelle.

## 8. Ce que cette proposition refuse de faire (doctrine)

- **Pas d'attente inventée** : seule une demande explicite (rendez-vous) fait attendre l'équipage ;
  un horaire d'ouverture seul signale, il ne fabrique pas du temps mort silencieux.
- **Pas de blocage sur l'inconnu** : des horaires non renseignés ne bloquent rien et se voient.
- **Pas de statut de demande stocké** : dérivé de la réalité de la tournée, il ne peut pas mentir.
- **Pas de poids association estimé** : 0 kg assumé tant que l'historique (enfin alimenté au
  lot 1) n'existe pas en quantité exploitable.
- **Pas d'optimisation sous fenêtres prématurée** : contrôle + suggestion d'abord ; l'optimisation
  fine viendra quand l'usage réel aura montré qu'elle manque.
