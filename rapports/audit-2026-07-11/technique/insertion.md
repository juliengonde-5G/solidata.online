# Audit technique — Module « Parcours d'insertion & accompagnement CIP »

**Date** : 11 juillet 2026
**Périmètre** : `backend/src/routes/insertion/` (index.js, routes.js, engine.js), `backend/src/routes/prescripteurs.js`, `backend/src/routes/exports.js` (export insertion), `backend/src/services/insertion-ai.js`, pages `frontend/src/pages/InsertionParcours.jsx` et `AuditInsertion.jsx`, schéma `backend/src/scripts/init-db.js`, jobs `backend/src/services/scheduler.js`.
**Note globale** : 6.5 / 10

---

## 1. Synthèse

Le module est **fonctionnel, cohérent avec les patterns du projet et globalement bien sécurisé**. La décomposition backend (moteur de connaissances / routes HTTP / migration) est propre, le SQL est intégralement paramétré, et la gestion de la résilience (dégradation par requête plutôt qu'échec global) est manifestement issue d'un retour d'expérience d'incidents de production. En contrepartie, le module porte une **dette structurelle notable** : double définition du schéma source de dérives déjà survenues, absence de validation d'entrée sur les deux plus gros écrivains, aucun test automatisé, et des fichiers surdimensionnés.

---

## 2. Qualité & cohérence

**Points solides.**
- Découpage `insertion/` en trois responsabilités claires : `engine.js` (base de connaissances PCM/métiers/freins + fonctions pures d'analyse), `routes.js` (contrôleurs HTTP), `index.js` (montage + migration). Les fonctions d'`engine.js` (`computeMilestoneSchedule`, `buildPistesMetiers`, `buildFreinsSociaux`, `buildTimeline`, `analyzeInsertion`) sont **pures et directement testables**.
- Ordonnancement des routes maîtrisé et commenté : `/freins-definitions`, `/cohorte/stats`, `/audit`, `/audit/ia` sont placées **avant** `/:employeeId` pour éviter la capture (routes.js l.57-58, 560, 831, 857).
- `computeMilestoneSchedule` est **partagé** entre les routes et le scheduler (`scheduler.js` l.170) : une seule source de vérité pour le calage des jalons sur la durée réelle du contrat. Bonne factorisation.
- Respect des conventions : Express Router, `authenticate`+`authorize`, `res.status().json({ error })`, hooks React, `api` axios, libellés en français.

**Faiblesses.**
- **Taille excessive** : `InsertionParcours.jsx` fait **1539 lignes / 89 Ko** et concentre plusieurs composants (modale bilan, `CohortePanel`, formulaire diagnostic, export PDF, page principale) dans un seul fichier. `engine.js` fait 1431 lignes. Maintenabilité et revue rendues difficiles.
- **Jointure fragile** : `GET /:employeeId` joint les postes sur le libellé texte — `LEFT JOIN positions p ON p.title = e.position` (routes.js l.869) — au lieu d'une FK `position_id` (qui existe par ailleurs). Sensible aux renommages/fautes de frappe et non indexé.
- **Logique métier heuristique fragile** : le scoring des pistes métiers (`buildPistesMetiers`, engine.js l.850-989) repose sur du `String.includes()` sur des tokens parfois très courts (ex. `data.famille.split(/[\s/]+/).some(f => interets.includes(f))`), avec des incréments magiques (+35, +10, −25…) non nommés. Résultats difficiles à prévoir et à tester.

---

## 3. Dette technique

- **Double définition du schéma (risque majeur, déjà matérialisé).** Les tables `insertion_diagnostics`, `insertion_milestones`, `cip_action_plans`, `insertion_interview_alerts` sont créées **à deux endroits** : le canonique `init-db.js` (l.2553-2766) **et** une IIFE d'auto-migration dans `insertion/index.js` (l.15-207). C'est exactement la cause racine documentée du bug de prod 2.3.2. Divergences concrètes constatées :
  - Le `CREATE TABLE` d'index.js omet les 6 colonnes `pcm_q_*` présentes dans init-db.js (colonnes **mortes** : aucune référence dans routes/frontend).
  - La contrainte `CHECK (milestone_type IN …)` d'index.js (l.161) ajoute `'Bilan M+2'`, **valeur vestige** jamais générée ni utilisée ailleurs dans le dépôt ; init-db.js ne la connaît pas.
  - index.js recrée les freins en `INTEGER` **sans** `CHECK`, alors qu'init-db.js impose `CHECK (frein_x BETWEEN 1 AND 5)` → contrainte présente ou non selon l'âge de la base.
  - La liste `addMsCol` d'index.js **ne couvre pas** `sortie_employeur_siret` ni `sortie_duree_contrat_mois`, pourtant écrites par `PUT /milestones/:id` (routes.js l.313-314, params $28/$29). Ces colonnes n'existent que via la migration d'init-db.js (l.1801-1805) : si init-db ne s'est pas exécuté, le PUT tombe en `42703`/500.
- **Migration en IIFE au chargement du module** : les ~200 lignes de migration d'index.js s'exécutent en async non-attendu au `require()`, hors séquencement vis-à-vis d'init-db, avec erreurs seulement en `console.warn`. Fragile ; ce code devrait vivre dans init-db.js.
- **Index dupliqué** : `employees(insertion_status)` est indexé deux fois — `idx_employees_insertion_status` (init-db l.2341) et `idx_employees_insertion` partiel (l.2976). Redondance à nettoyer.
- **N+1 / perf** : `GET /` (liste) utilise 5 sous-requêtes corrélées par ligne (routes.js l.70-90) ; `GET /:employeeId` enchaîne ~8 `await` **séquentiels** (l.864-970) alors qu'`insertion-ai.js` montre le bon pattern (`Promise.all`, l.83). Les boucles du scheduler (`checkInsertionMilestones`, `checkInsertionInterviewAlerts`) font une requête par salarié/jalon — acceptable vu la cadence batch, mais N+1.

---

## 4. Sécurité

- **SQL** : intégralement paramétré (`$1/$2`) sur tout le périmètre. La seule interpolation d'identifiant (fonction `addCol`/`addMsCol` de migration) est protégée par une **liste blanche regex** `SAFE_IDENT`/`SAFE_TYPE` (index.js l.50-53). Bien.
- **Autorisations** : garde de niveau routeur `authorize('ADMIN','RH','MANAGER')` (index.js l.210) ; les surfaces les plus sensibles sont **resserrées à ADMIN/RH** — export (`exports.js` l.524), `/audit/ia` (routes.js l.844), `/ia/profil|entretien|cohorte|diagnostic` (l.1041-1104). `prescripteurs.js` restreint correctement écriture (ADMIN/RH) et suppression (ADMIN).
- **Point de vigilance RGPD** : `GET /:employeeId` renvoie le **rapport PCM déchiffré** (routes.js l.910) **et les 7 freins santé/social** au rôle **MANAGER**. La route front correspond (App.jsx l.150, ProtectedRoute ADMIN/RH/MANAGER) — donc pas d'incohérence front/back — mais l'exposition de données individuelles sensibles à un rôle large mérite d'être **confirmée avec le métier** (principe de minimisation / besoin d'en connaître), d'autant que les agrégats et exports sont, eux, réservés à ADMIN/RH.
- **Fuite d'internes mineure** : `GET /audit` (routes.js l.838) et `exports/insertion` (exports.js l.680) renvoient `detail: err.message`. Faible sensibilité (ADMIN/RH), mais expose des messages internes ; les endpoints IA le font délibérément et de façon documentée.
- **Validation d'entrée insuffisante** (voir §5) — cofacteur de robustesse plutôt que d'exploitation directe.
- **Frontend** : l'export PDF (`document.write`, InsertionParcours l.597 / AuditInsertion l.219) échappe les valeurs via `esc()`. Correct, même si `esc()` d'InsertionParcours n'échappe pas les guillemets (l.620) — acceptable ici car les valeurs sont injectées en contenu de balise, pas en attribut.

---

## 5. Robustesse

**Bien pensé.**
- Pattern `soft()` de dégradation par requête dans `insertion-ai.js` (l.78), `gatherAuditKpis` (routes.js l.688) et `exports/insertion` (l.527) : une colonne absente n'annule pas toute l'analyse/l'export, et loggue sa cause. Approche mûre.
- Diagnosticabilité IA exemplaire : `handleIaError` avec `hint` ciblé 401/404/429 (routes.js l.1019), sonde isolée `GET /ia/diagnostic` (l.1041), timeouts front dédiés (120 s / 180 s) et bannières d'erreur jamais silencieuses. `auditGlobalReport` ne renvoie jamais un « faux » succès (repli `_raw`, `_tronque`).

**À renforcer.**
- **Aucune validation** sur les deux plus gros écrivains : `PUT /diagnostic/:employeeId` et `PUT /milestones/:id` consomment `req.body` brut. `express-validator` est importé (routes.js l.9) mais n'est câblé que sur `POST /milestones` et `POST /action-plans`. Conséquences : un frein hors 1-5 heurte le `CHECK` DB → **500 opaque** ; les enums `status`/`avis_global`/`sortie_classification` non contrôlés → violation de contrainte 500 ; pas de vérification d'existence de l'`employee_id` avant l'upsert diagnostic.
- **Écriture sur une requête GET** : `GET /:employeeId` auto-crée les jalons (`generateMilestones`, routes.js l.958-960). Anti-pattern REST ; non tracé par `autoLogActivity` (qui ne journalise que POST/PUT/DELETE) ; `generateMilestones` fait un SELECT-puis-INSERT **sans** `ON CONFLICT` (l.42-52) → deux GET concurrents peuvent lever `unique_violation` (capturé/dégradé, mais bruyant).
- **Pas de transaction** sur écriture multi-tables : `POST /milestones/:employeeId/initialize` fait `UPDATE employees` puis N `INSERT` de jalons sur `pool` sans transaction (l.437-446) → état partiel possible en cas d'échec intermédiaire.
- **Catch silencieux** : `GET /:employeeId` enchaîne plusieurs `catch (err) { /* table might not exist */ }` totalement muets (contrats l.883, candidat l.899, pcm l.918, équipe l.930, position l.940, plans l.970). Une erreur transitoire réelle (indispo DB passagère) est avalée et la section disparaît sans signal.

---

## 6. Testabilité

- **Aucun test** ne couvre le module : parmi les 25 fichiers `*.test.js`, aucun `insertion*.test.js` (candidats, billing, stock, sumup… sont testés, pas l'insertion). C'est le plus gros manque au regard du **ratio valeur/effort** : `engine.js` est un bloc de fonctions pures idéales à tester (`computeMilestoneSchedule` — contrat 6 mois vs 12 mois, bornes Sortie ; scoring `buildPistesMetiers` ; `buildFreinsSociaux` ; `buildTimeline`).
- Les agrégations SQL de `/cohorte/stats` et `/audit` sont complexes (`FULL OUTER JOIN`, `DISTINCT ON`, `FILTER`) et, d'après l'historique, seulement « prouvées » manuellement une fois. Elles justifient des **tests d'intégration** (base éphémère) pour prévenir les régressions.

---

## 7. Recommandations priorisées

| # | Priorité | Effort | Action |
|---|----------|--------|--------|
| 1 | **P1** | M | **Unifier le schéma** : supprimer l'IIFE de migration de `insertion/index.js` et déplacer toute création/migration dans `init-db.js` (source unique). Vérifier que `sortie_employeur_siret`/`sortie_duree_contrat_mois` y sont couvertes. Purger les vestiges (`'Bilan M+2'`, colonnes `pcm_q_*`) et l'index dupliqué `insertion_status`. |
| 2 | **P1** | S | **Valider les entrées** de `PUT /diagnostic` et `PUT /milestones` (freins entiers 1-5, enums `status`/`avis_global`/`sortie_classification`, `employee_id` entier existant) via `express-validator` + `validate`, déjà présents. |
| 3 | **P1** | M | **Tests** : unitaires sur `engine.js` (échéancier, scoring, freins, timeline) + intégration sur `/cohorte/stats` et `/audit`. |
| 4 | **P2** | S | **Retirer l'écriture du GET** `/:employeeId` : déclencher l'auto-init via un `POST` explicite, ou a minima passer `generateMilestones` en `ON CONFLICT DO NOTHING` dans une transaction. |
| 5 | **P2** | S | **Transaction** autour de `POST /initialize` (UPDATE employees + INSERT jalons). |
| 6 | **P2** | S | **Revue RGPD** de l'accès MANAGER aux données individuelles sensibles (PCM déchiffré, freins santé) — confirmer ou restreindre à ADMIN/RH. |
| 7 | **P2** | M | **Perf** : paralléliser les requêtes de `GET /:employeeId` (`Promise.all`) et réduire les sous-requêtes corrélées de `GET /`. |
| 8 | **P2** | L | **Refactor** `InsertionParcours.jsx` : extraire `CohortePanel`, la modale bilan et les helpers d'impression PDF en fichiers dédiés. |

---

## 8. Conclusion

Un module **abouti fonctionnellement**, avec une ingénierie de résilience et de diagnosticabilité au-dessus de la moyenne du dépôt, mais handicapé par une **dette accumulée** dont la plus risquée — la double définition du schéma — a déjà provoqué des incidents. Les corrections prioritaires (schéma unique, validation d'entrée, premiers tests) sont d'effort modéré et sécuriseraient durablement un module qui manipule des données personnelles particulièrement sensibles.
