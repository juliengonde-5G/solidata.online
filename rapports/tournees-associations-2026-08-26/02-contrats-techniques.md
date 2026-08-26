# Contrats techniques — chantier tournées associations

**Date** : 26 août 2026 · **Statut** : FIGÉ — référence commune des agents d'implémentation.
Toute divergence par rapport à ce document est un défaut, pas une variante. En cas d'ambiguïté :
ne pas improviser, implémenter au plus proche de la lettre et le signaler dans le rapport final.

Arbitrages retenus (CDC §6) : **1(b) forçable** · **2(a) planifiable si non renseigné** ·
**3(a) attente comptée en travail** · **4 tolérance 15 min** · **5(b) forçable** ·
**6(a) sélection explicite** · **7(b) apprentissage en extension (HORS PÉRIMÈTRE)**.

Base PostgreSQL 16 réelle disponible pour les preuves :
`DB_HOST=127.0.0.1 DB_PORT=5432 DB_NAME=solidata DB_USER=solidata_user DB_PASSWORD=changeme`
(225 CAV actifs, points association, véhicules 1-3, centre de tri seedé).

---

## 1. Schéma (propriété exclusive de l'agent A — `init-db.js` UNIQUEMENT)

> Le bloc dupliqué de `backend/src/index.js:510-587` est un vestige d'auto-réparation qui ne rejoue
> PAS les `ALTER TABLE`. **Ne rien y ajouter** : tout va dans `init-db.js`, migrations idempotentes.

```sql
ALTER TABLE association_points
  ADD COLUMN IF NOT EXISTS horaires_accessibilite JSONB,
  ADD COLUMN IF NOT EXISTS horaires_notes TEXT,
  ADD COLUMN IF NOT EXISTS duree_collecte_min INTEGER;

ALTER TABLE tour_association_point
  ADD COLUMN IF NOT EXISTS duree_prevue_min INTEGER;

CREATE TABLE IF NOT EXISTS association_collecte_demandes (
  id SERIAL PRIMARY KEY,
  association_point_id INTEGER NOT NULL REFERENCES association_points(id) ON DELETE CASCADE,
  date_souhaitee DATE NOT NULL,
  heure_debut TIME NOT NULL,
  heure_fin TIME,
  tolerance_min INTEGER,
  commentaire TEXT,
  annulee_le TIMESTAMP,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (association_point_id, date_souhaitee)
);
CREATE INDEX IF NOT EXISTS idx_assoc_demandes_date ON association_collecte_demandes(date_souhaitee);

-- APRÈS la création de la table ci-dessus (ordre imposé par la FK) :
ALTER TABLE tour_association_point
  ADD COLUMN IF NOT EXISTS demande_id INTEGER REFERENCES association_collecte_demandes(id) ON DELETE SET NULL;
```

### Forme du JSONB `horaires_accessibilite`
```json
{ "lundi": [{"debut":"09:00","fin":"12:00"},{"debut":"14:00","fin":"17:00"}],
  "mardi": [{"debut":"09:00","fin":"12:00"}], "mercredi": [], "jeudi": [], "vendredi": [],
  "samedi": [], "dimanche": [] }
```
Sémantique **non négociable** : colonne `NULL` = horaires **inconnus** (planification permise, mention
affichée) · objet présent, jour à `[]` ou absent = **fermé** ce jour-là.

---

## 2. Module PUR `backend/src/services/association-horaires.js` (agent A)

Aucun accès base, aucune horloge implicite. Exports EXACTS :

```js
const JOURS = ['lundi','mardi','mercredi','jeudi','vendredi','samedi','dimanche'];
const TOLERANCE_RDV_DEFAUT_MIN = 15;

minutesDepuisHHMM('09:30')            // → 570 ; null si format invalide
hhmmDepuisMinutes(570)                // → '09:30' ; minutes >= 1440 → 'HH:MM (+1 j)'
jourDeDate('2026-08-31')              // → 'lundi'  (parsing UTC strict : Date.UTC(y, m-1, d).getUTCDay())

validerHoraires(brut)
// → { valide: bool, erreurs: string[], normalise: object|null }
// Règles : clés ∈ JOURS ; valeur = tableau ; chaque plage {debut,fin} en 'HH:MM' strict
// (regex ^([01]\d|2[0-3]):[0-5]\d$) ; debut < fin ; plages d'un même jour NON chevauchantes
// (triées à la normalisation) ; brut null/undefined → { valide:true, normalise:null }.
// `normalise` porte TOUJOURS les 7 jours (jours absents → []).

plagesDuJour(horaires, '2026-08-31')  // → [[540,720],[840,1020]] | [] (fermé) | null (inconnu)
joursFermes(horaires)                 // → ['mercredi','samedi','dimanche'] ; [] si horaires null
tientDansPlages(debutMin, finMin, plages)         // → bool ; plages null → true (inconnu ≠ interdit)
premierCreneauCompatible(dureeMin, plages, apresMin = 0)  // → minutes | null
fenetreEffective({ heure_debut, heure_fin, tolerance_min }, toleranceParDefaut)
// → { debutMin, finMin } ; heure_fin null → fin = debut ; tolérance appliquée des deux côtés.
// Accepte 'HH:MM' et 'HH:MM:SS' (PostgreSQL TIME).
```

---

## 3. Extension du moteur `backend/src/services/tour-time-engine.js` (agent B)

Le moteur RESTE PUR. Rétro-compatibilité stricte : un point sans les champs nouveaux se comporte
**exactement** comme aujourd'hui — les tests existants doivent passer sans modification.

### Champs de point (ajouts, tous optionnels)
```js
windows: [[540,720],[840,1020]] | null   // minutes d'HORLOGE depuis minuit ; null = inconnu
anchor:  { debutMin: 630, finMin: 660 } | null
```
`normalizePoint` les recopie tels quels (coercition défensive : tableau de paires finies, sinon `null`).

### Option (ajout)
```js
attenteCompteTravail: true   // défaut true (arbitrage 3a)
```

### Heure d'horloge simulée
`clockMin(s, o) = o.startHour * 60 + elapsed(s)` — même référentiel que `lunchDue`.

### Comportement dans `applyPoint`, à l'arrivée sur un point (ORDRE IMPOSÉ)
1. **Ancrage** — si `anchor` :
   - `clock < anchor.debutMin` → entrée timeline `{type:'attente', name, arrivee_min, depart_min}`
     de `(anchor.debutMin - clock)` minutes ; imputée `workMinutes` si `attenteCompteTravail`,
     sinon `pauseMinutes`. L'horloge avance d'autant.
   - `clock > anchor.finMin` (après attente éventuelle) → violation `rdv_manque`.
2. **Accessibilité** — si `windows` non `null` : `tientDansPlages(clock, clock + serviceMinutes, windows)`
   faux → violation `hors_horaires`. **Aucune attente n'est jamais générée par `windows` seul.**
3. Service et trajets : mécanique actuelle, inchangée.

### Sorties (ajouts)
```js
// timeline : nouveau type d'entrée
{ type:'attente', name, arrivee_min, depart_min }

// estimation : deux clés nouvelles
duree_attente_min: 0,
violations: [
  { type:'hors_horaires', point_id, point_type, name, arrivee_min, fin_service_min,
    plages: [[540,720]], prochain_creneau_min: 840|null },
  { type:'rdv_manque', point_id, point_type, name, arrivee_min, fenetre: {debutMin, finMin} }
]
```
`violations` vaut **toujours** un tableau (vide = conforme). `arrivee_min` reste en minutes écoulées
depuis le départ (contrat existant) ; les champs `*Min`/`prochain_creneau_min` sont en minutes
d'horloge. Ne PAS mélanger les deux référentiels.

`planWithBudget` : un point porteur d'une violation n'est pas éliminé d'office (la route décide) ;
la sélection gloutonne reste pilotée par le seul budget.

---

## 4. API (agents A pour les demandes, C2 pour les tournées)

### 4.1 Fiche association — `routes/association-points.js` (agent A)
`POST /` et `PUT /:id` acceptent en plus : `horaires_accessibilite` (validé par `validerHoraires`,
400 `{ error, code:'HORAIRES_INVALIDES', erreurs:[…] }`), `horaires_notes`, `duree_collecte_min`
(entier 1-480 ou null).
`GET /` et `GET /:id` exposent en plus : `horaires_accessibilite`, `horaires_notes`,
`duree_collecte_min`, `horaires_renseignes` (bool), `jours_fermes` (string[]).

### 4.2 Demandes de collecte — `routes/association-demandes.js` (agent A, monté `/api/association-demandes`)
Lecture ADMIN/MANAGER, écriture ADMIN/MANAGER. Statut **DÉRIVÉ EN SQL, jamais stocké** :

| Condition (dans l'ordre) | `statut` |
|---|---|
| `annulee_le` non null | `annulee` |
| aucun `tour_association_point.demande_id` = id | `a_planifier` |
| passage rattaché, tournée `status <> 'completed'` | `planifiee` |
| tournée close, `collected_at` dans la fenêtre effective | `honoree` |
| sinon (close hors fenêtre, sautée) | `non_honoree` |

```
GET  /association-demandes?du=&au=&statut=&association_point_id=
POST /association-demandes        { association_point_id, date_souhaitee, heure_debut, heure_fin?,
                                    tolerance_min?, commentaire? }   → 409 DEMANDE_DOUBLON
PUT  /association-demandes/:id    (refusé 409 si statut honoree/non_honoree)
POST /association-demandes/:id/annuler   { motif? }
```
Ligne renvoyée : `{ id, association_point_id, association_nom, date_souhaitee, heure_debut,
heure_fin, tolerance_min, commentaire, statut, tour_id, created_at }`.

### 4.3 Estimation et création — `routes/tours/crud.js` (agent C2)
`POST /tours/estimate` accepte en plus de l'existant :
```js
association_points: [{ id, duree_min }]   // prioritaire sur association_point_ids
demande_ids: [1, 2]
```
et renvoie en plus : `violations`, `ordre_suggere` (tableau d'ids | `null`).

`POST /tours/association` accepte `points: [{id, duree_min}]` (rétro-compatible avec
`association_point_ids`) et `demande_ids`. Écrit `tour_association_point.duree_prevue_min` et
`demande_id`. Deux refus nouveaux, tous deux **forçables par `force:true` avec trace dans
`ai_explanation`**, exactement comme `DUREE_MAX_DEPASSEE` :

```js
409 { error, code:'ASSOCIATION_HORS_HORAIRES', estimation,
      violations:[{ point_id, name, heure_prevue:'11:40', plages:['09:00-12:00','14:00-17:00'],
                    prochain_creneau:'14:00'|null }] }
409 { error, code:'RDV_NON_TENABLE', estimation, ordre_suggere:[…]|null,
      violations:[{ demande_id, point_id, name, heure_prevue:'11:05', fenetre:'10:15-10:45' }] }
```
Ordre de contrôle : `DUREE_MAX_DEPASSEE` d'abord, puis `RDV_NON_TENABLE`, puis
`ASSOCIATION_HORS_HORAIRES` (un seul 409 renvoyé, le premier rencontré).

### 4.4 Cascade des durées (agent C2 — `smart-tour.js`, `planned-passage.js`)
```
duree_prevue_min (passage)  →  duree_collecte_min (fiche)  →  cfg.timePerCav (global, 10)
```
Chaque niveau ne s'applique que si le précédent est `null`. **Aucune valeur inventée.**

### 4.5 Réglages (agent C2 — `predictions.js` SCORING_CONFIG)
`rdvToleranceMin: 15` · `attenteCompteTravail: true`.

---

## 5. Répartition des fichiers — PROPRIÉTÉ EXCLUSIVE

Un agent ne modifie QUE ses fichiers. Un besoin hors périmètre se signale dans le rapport final, il
ne se code pas.

| Agent | Fichiers |
|---|---|
| **A** schéma & référentiel | `backend/src/scripts/init-db.js` · `backend/src/services/association-horaires.js` (neuf) · `backend/src/routes/association-points.js` · `backend/src/routes/association-demandes.js` (neuf) · `backend/src/index.js` (montage du routeur, UNE ligne) · tests `backend/tests/unit/association-horaires.test.js`, `backend/tests/contract/association-demandes-contract.test.js` |
| **B** moteur pur | `backend/src/services/tour-time-engine.js` · tests `backend/tests/unit/tour-time-engine-*.test.js` |
| **C1** socle tournées | `backend/src/routes/tours/arrets.js` · `live-edit.js` · `completion-effects.js` · tests associés |
| **C2** estimation & création | `backend/src/routes/tours/crud.js` · `smart-tour.js` · `planned-passage.js` · `predictions.js` · `backend/src/services/reoptimize-service.js` · tests associés |
| **D1** fiche association (web) | `frontend/src/pages/AdminAssociations.jsx` · `frontend/src/components/associations/HorairesHebdo.jsx` (neuf) |
| **D2** planification (web) | `frontend/src/pages/Tours.jsx` · `frontend/src/pages/PlanningTournees.jsx` · `frontend/src/pages/AdminPredictive.jsx` · `frontend/src/pages/LiveVehicles.jsx` · `frontend/src/components/tours/CreateTourModal.jsx` · `CavPicker.jsx` |
| **E** mobile | `mobile/src/pages/TourMap.jsx` · `mobile/src/pages/FillLevel.jsx` · tests mobile |

`CLAUDE.md`, `docs/`, `rapports/` : réservés à l'orchestrateur.

---

## 6. Règles de fabrication (toutes valables pour tous les agents)

1. **Français** pour l'UI et les commentaires ; noms de variables backend en anglais tolérés.
2. **SQL paramétré** ($1, $2…), `authenticate` + `authorize` sur toute route sensible.
3. **Migrations idempotentes** dans `init-db.js` uniquement.
4. **Aucune dépendance npm nouvelle.**
5. **Jamais de valeur inventée** : une information absente vaut `null` + motif exposé, jamais un
   zéro rassurant ni un défaut silencieux.
6. **Tests** : moteur et modules purs testés sans base ; routes testées en contrat
   (`jest.mock('../../src/config/database')`, `mockQuery` routé par regex SQL, JWT réel, supertest).
   Les fabriques de mock Jest ne peuvent référencer que des variables préfixées `mock`.
7. **Ne jamais casser l'existant** : les tests actuels doivent passer sans être modifiés. Si l'un
   d'eux échoue, c'est le code neuf qui est en cause, pas le test.
8. Rapport final attendu : ce qui a été fait, fichier par fichier ; ce qui a été prouvé et comment ;
   ce qui a été laissé de côté et pourquoi ; toute divergence au présent contrat.

---

## 7. Errata du contrat (constatés à l'implémentation)

Ces points ont été relevés par les agents en cours de chantier. Ils sont consignés ici
plutôt que corrigés en amont : le contrat reste la trace de ce qui a été demandé, l'errata
la trace de ce qui a dû être ajusté.

1. **Chemin erroné** — le §5 annonçait `backend/src/services/reoptimize-service.js` ; le
   fichier réel est `backend/src/routes/tours/reoptimize-service.js`. L'agent C2 a modifié
   le bon fichier.
2. **Trou de découpage** — `backend/src/routes/tours/index.js`, qui sert les payloads
   mobiles, n'était attribué à aucun agent : les champs `horaires_jour` et `rdv` attendus
   par le mobile n'auraient été produits par personne. Comblé par l'orchestrateur et prouvé
   sur base réelle par le vrai handler Express.
3. **Tolérance de rendez-vous en double** — le §4.2 confie la dérivation du statut à
   l'agent A (constante du module pur) et le §4.5 le réglage `rdvToleranceMin` à l'agent C2 :
   les deux n'étaient pas reliés. Une tolérance portée à 30 min planifiait des rendez-vous
   « tenables » qui ressortaient « non honorés » dans la liste des demandes, jugés sur 15.
   Recousu en passe de debug : le réglage d'administration fait foi, la constante est le repli.
4. **`GET /tours/association-routes/:id/points`** — supposé non enrichi par l'agent D2 ;
   il l'était en réalité (`SELECT ap.*` remonte les colonnes nouvelles). La provenance de la
   durée est donc affichable dans la modale, et l'a été en passe de debug.
5. **Index sur `tour_association_point(demande_id)`** — absent du DDL du §1, ajouté en passe
   de debug : c'est la colonne sur laquelle filtre le `LATERAL` de dérivation du statut.
6. **`predicted_fill_rate` sur `tour_association_point`** — n'existe pas ; aucune prédiction
   n'est relevée à la planification d'une tournée association. L'agent C1 rejoue donc le
   moteur avant l'écriture des tonnages et écarte son repli (50 % sans historique), qui n'est
   pas une prédiction. Limitation documentée, non comblée : elle relève d'une évolution du
   modèle, pas de ce chantier.
