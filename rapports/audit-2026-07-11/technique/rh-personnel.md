# Audit technique — Module « Gestion RH, temps & planning »

**Date :** 11 juillet 2026
**Périmètre :** `backend/src/routes/{employees.js, teams.js, pointage.js, planning-hebdo.js}`, `backend/src/services/{collaborator-import.js, holidays.js}`, pages `Employees`, `Skills`, `WorkHours`, `PlanningHebdo`, `Pointage`, `AdminCollaboratorsImport`, schéma `init-db.js`.
**Note globale : 5,5 / 10**

---

## 1. Synthèse

Le module est fonctionnel et globalement conforme aux patterns du projet (Express Router, `authenticate`/`authorize`, SQL 100 % paramétré, pages React à hooks). Le service d'import collaborateurs est la pièce la plus soignée (upsert idempotent, résilience par SAVEPOINT, minimisation RGPD). En regard, on relève **une faille de contrôle d'accès exposant des données personnelles sensibles**, plusieurs **divergences schéma ↔ code** (colonnes fantômes, code mort), des **écritures multi-tables non transactionnelles**, une **incohérence de rôles**, et une **absence totale de tests** sur un domaine pourtant sensible (paie, données IAE).

---

## 2. Points forts

- **SQL entièrement paramétré** : aucune injection détectée. Le `UPDATE` dynamique de `employees.js` (l. 129-149) construit ses `SET` depuis une **whitelist fixe** `allowed`, valeurs en `$i` — pattern correct.
- **Upload durci** : photo via `imageFilter` + extension nettoyée `[^a-z0-9.]` + nom `photo_${Date.now()}` (pas d'`originalname`) + limite 5 Mo ; import tableur en `memoryStorage` + `spreadsheetFilter` + 10 Mo, erreurs Multer converties en 400 propre (`runUpload`, l. 41-44). Pas de path-traversal.
- **Import idempotent et résilient** (`collaborator-import.js`) : appariement `malibou_id` → nom/prénom normalisé, fusion non destructive par `COALESCE`, **SAVEPOINT par ligne** (l. 339-466) isolant une ligne fautive sans avorter la transaction, 2ᵉ passe pour résoudre `manager_id`. Transaction explicite côté route (BEGIN/COMMIT/ROLLBACK).
- **Minimisation RGPD** assumée : NIR / IBAN / BIC volontairement non importés (commentaire l. 2406-2408 de `init-db.js`).
- **Migrations idempotentes** : `ADD COLUMN IF NOT EXISTS`, `DO $$ … EXCEPTION WHEN duplicate_column`, conversion VARCHAR→TEXT conditionnée (l. 2443-2459). Constantes nommées dans `pointage.js` (`ANTI_DOUBLON_SECONDS`, `MAX_BADGEAGES_PAR_JOUR`).

---

## 3. Constats critiques

### P0 — Exposition de données personnelles via `GET /api/teams/:id`
`teams.js` (l. 9, 29-39) : le routeur n'applique que `router.use(authenticate)` ; les GET n'ont **aucun `authorize`**. Or `GET /:id` renvoie `SELECT * FROM employees WHERE team_id = $1` — soit **toutes les colonnes** dont `gross_salary`, `siret`, `residence_permit_number`, `birth_date`, `address`, `personal_email`, `disability_status`. N'importe quel compte authentifié (y compris `COLLABORATEUR`, `RESP_BTQ` et surtout `AUTORITE`, rôle externe) peut ainsi énumérer salaires et titres de séjour de tous les salariés. À rapprocher du fait que `GET /api/employees` est, lui, correctement restreint à `ADMIN/RH/MANAGER` : la route `teams` contourne ce contrôle. **Correctif : `authorize('ADMIN','RH','MANAGER')` sur les GET + projection de colonnes non sensibles.**

### P1 — WorkHours : colonnes fantômes + coercition silencieuse du type
`WorkHours.jsx` (l. 62-64) affiche `start_time`, `end_time`, `break_minutes` — colonnes **inexistantes** dans `work_hours` (schéma l. 326-337 : seulement `hours_worked`, `overtime_hours`, `type`, `notes`). Le `GET /:id/hours` renvoie `wh.*` : ces colonnes sont donc toujours vides et `{h.break_minutes}min` rend « undefinedmin ». En outre le sélecteur de type propose `overtime/conge/maladie` (l. 58) alors que le POST (`employees.js` l. 418) fait `['normal','training','absence','sick','holiday'].includes(type) ? type : 'normal'` : une saisie « congé » ou « maladie » est **silencieusement enregistrée en `normal`** → perte d'information et faussage des compteurs d'absence.

### P1 — `planning-hebdo /affecter` non transactionnel
`planning-hebdo.js` (l. 224-317) enchaîne, hors transaction, plusieurs `DELETE` puis un `INSERT … ON CONFLICT` (l. 288, 293, 303). Un échec entre le `DELETE` des demi-journées et l'`INSERT`, ou deux requêtes concurrentes sur le même agent/jour, laissent le planning **partiellement effacé**. La suite check-dispo → check-absence → check-compétence → écriture devrait être encapsulée dans un `BEGIN/COMMIT` avec verrou.

### P1 — Requête absentéisme : filtre impossible (code mort)
`employees.js` (l. 572) calcule `absences_planifiees` via `s.status IN ('absence','maladie','sick')` sur `schedule`. Or `schedule.status` est contraint par CHECK à `('work','training','rest','leave','vak')` (schéma l. 315) : ces valeurs **ne peuvent jamais exister**. La colonne `absences_planifiees` et l'`ecart_planning` sont donc structurellement faux (toujours 0/trompeurs), ce qui rend la comparaison « prévu vs réel » du reporting RH non fiable.

### P1 — Incohérence d'habilitation : RH exclu du planning hebdo
`planning-hebdo.js` (l. 8) : `router.use(authenticate, authorize('ADMIN','MANAGER'))`. Toutes les autres surfaces RH (`/schedule`, `/work-hours`, résumés) autorisent `ADMIN/RH/MANAGER`. Le rôle **RH ne peut donc pas construire le planning hebdomadaire**, alors que c'est typiquement sa fonction. Incohérence du modèle de rôles à trancher.

### P1 — Conflation « dernière visite médicale » ↔ visite post-embauche
À l'import (`collaborator-import.js` l. 281 puis mapping param `$22`/`$23` de l'UPDATE/INSERT), le champ Malibou `Dernière visite médicale` (`last_medical_visit`) alimente la colonne `visite_medicale_date`, qui sert au **suivi de la visite d'information et de prévention obligatoire** (art. R4624-10, alerte `GET /visite-medicale/alertes` filtrant `WHERE visite_medicale_date IS NULL`, `employees.js` l. 915). Renseigner une visite antérieure **fait disparaître le salarié de l'alerte de conformité** — risque de manquer une visite légalement due.

---

## 4. Dette technique & robustesse (P2)

- **Surfaces d'écriture dupliquées.** Deux API heures coexistent : l'alias `/:id/hours` (POST/validate) et `/work-hours` (POST/validate), toutes deux en upsert `ON CONFLICT (employee_id, date)` — duplication assumée « compat R1/R2 » (l. 334-339) mais jamais consolidée. Trois chemins d'écriture du planning : `/schedule`, `/schedule/bulk` (`employees.js`) et `/affecter` (`planning-hebdo.js`).
- **Parsing dupliqué front/back.** `AdminCollaboratorsImport.jsx` (l. 19-98) réimplémente `parseFRDate`, `normalizeHeader`, `ouiNon` — équivalents de `toISODate`, `normalizeHeader`, `toBool` du service. Deux mapping d'en-têtes à maintenir en parallèle (voie CSV parsée au client, voie XLSX au serveur) → risque de divergence.
- **`Skills.jsx` : N+1 + mauvaise entité + modèle fragmenté.** `loadEmployees` (l. 35-52) émet **une requête `/candidates/:id/skills` par employé** (56 requêtes pour 56 salariés). Le fallback `emp.candidate_id || emp.id` interroge `candidates/<id_employé>` quand le salarié n'est pas lié → entité erronée. De plus les compétences salarié vivent dans `employees.skills` (TEXT[]) + `has_permis_b`/`has_caces`, pas dans `candidate_skills` : la matrice est le plus souvent vide ou fausse.
- **Valeurs magiques.** Seuil d'heures sup codé en dur `- 7` (`pointage.js` l. 155) ; boutiques figées `'btq_st_sever'`/`'btq_lhopital'` et postes entièrement hardcodés (`planning-hebdo.js` l. 57-126) ; `weekly_hours` bridé à `[26,35]` à l'import (l. 505) alors que la colonne est un `DOUBLE` libre.
- **Fuseau horaire du pointage.** `date = new Date().toISOString().slice(0,10)` (UTC) alors que `event_time` = `NOW()` (fuseau serveur). Un badgeage en soirée près de minuit (Paris = UTC+1/+2) peut être rattaché au mauvais jour — même famille de bug que celui corrigé sur la VAK.
- **Gestion d'erreurs frontend pauvre.** Nombreux `catch (err) { console.error(err); }` sans retour utilisateur (`WorkHours.jsx`, `Pointage.jsx`, `Skills.jsx`) ; `alert()` pour les erreurs de planning/liaison (`PlanningHebdo.jsx` l. 163, `Employees.jsx` l. 130,143).
- **`PUT /:id/availability` (`employees.js` l. 747-763)** : `DELETE` puis boucle d'`INSERT` hors transaction, sans validation des valeurs `day_off` (CHECK `lundi..dimanche`) → une valeur invalide provoque un 500 en milieu de boucle après avoir déjà purgé les jours existants.
- **Projection `SELECT e.*`** (`employees.js` l. 53) : expose salaire, titre de séjour et coordonnées au rôle `MANAGER` — à restreindre par projection selon le besoin réel.
- **Commentaire obsolète** : « route DELETE /clear déplacée… voir ligne ~539 » (l. 890) alors qu'elle est l. 621. Dérive documentaire mineure.

---

## 5. Testabilité

**Aucun test** ne couvre le module (vérifié : pas de fichier `employees/teams/pointage/planning/collaborator-import` sous `backend/tests/`). Les preuves « sur Postgres réel » citées dans l'historique CLAUDE.md étaient des scripts ad hoc non intégrés. Priorités :
1. `collaborator-import.js` — parsing (`toISODate`, `toBool`, `resolveTeamType`) et upsert idempotent (création vs mise à jour, non-régression du réimport, isolement SAVEPOINT). Code le plus complexe et le plus à risque, aujourd'hui sans filet.
2. Calcul d'heures `pointage.calculateAndInsertWorkHours` (appariement entrée/sortie, cas impairs, heures sup).
3. `computeHoursFromSlots` + coercition de type de `POST /:id/hours`.

---

## 6. Recommandations priorisées

| # | Priorité | Effort | Action |
|---|----------|--------|--------|
| 1 | P0 | S | Ajouter `authorize('ADMIN','RH','MANAGER')` sur les GET de `teams.js` et projeter les colonnes employés non sensibles (retirer salaire / titre de séjour). |
| 2 | P1 | S | Aligner `WorkHours.jsx` sur le schéma réel (retirer start/end/pause ou persister ces créneaux) et exposer/valider un vrai jeu de `type` cohérent avec le CHECK. |
| 3 | P1 | S | Encapsuler `planning-hebdo /affecter` (et `PUT /availability`) dans une transaction avec verrou. |
| 4 | P1 | S | Corriger ou retirer le calcul `absences_planifiees` (utiliser `work_hours.type` ou aligner les statuts de `schedule`). |
| 5 | P1 | S | Trancher l'habilitation planning : inclure `RH` dans `planning-hebdo` (ou documenter l'exclusion). |
| 6 | P1 | M | Dissocier « dernière visite médicale » (info Malibou) de `visite_medicale_date` (suivi post-embauche) pour ne pas masquer l'alerte de conformité. |
| 7 | P2 | M | Écrire les tests unitaires import/upsert + calcul d'heures. |
| 8 | P2 | M | Mutualiser le parsing CSV front/back et fusionner les surfaces `work-hours`/`schedule` redondantes. |

---

*Constats fondés sur la lecture du code aux dates indiquées. Aucun fichier existant n'a été modifié.*
