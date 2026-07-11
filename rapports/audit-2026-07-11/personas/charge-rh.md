# Audit persona — Chargé RH

**Date** : 11 juillet 2026
**Rôle applicatif testé** : RH (web)
**Périmètre** : import paie Malibou, fiches salariés, contrats/visites médicales, heures & pointage, planning hebdo, compétences, KPI RH, recrutement

---

## 1. Promesse

En tant que Chargé RH d'une structure d'insertion d'une soixantaine de salariés majoritairement en CDDI, avec une paie externalisée (Malibou), j'attends de SOLIDATA qu'il me permette : (1) de synchroniser en un geste mensuel ma base collaborateurs avec l'export de paie, sans ressaisie ni doublon ; (2) de suivre les obligations administratives et légales de chaque salarié (contrat, avenant, visite médicale, titre de séjour) avec des alertes proactives ; et (3) de produire des indicateurs RH fiables (ETP, absentéisme, formation) pour mes obligations de reporting IAE/DREETS, tout en pilotant mon recrutement (kanban, entretiens, liaison au parcours d'insertion).

## 2. Parcours testé

**Import mensuel Malibou.** C'est ici que mon audit s'arrête net. La page `AdminCollaboratorsImport.jsx` est bien la seule interface d'import (xlsx/csv), mais elle est protégée en `ProtectedRoute roles={['ADMIN']}` (`frontend/src/App.jsx:228`) et n'apparaît dans le menu que pour ADMIN (`frontend/src/components/Layout.jsx:276`, section « Utilitaires »). Côté API, les trois endpoints qu'elle appelle sont eux aussi verrouillés `authorize('ADMIN')` sans RH : `/employees/import/csv`, `/employees/import/xlsx` et `/employees/import/dedupe-ghosts` (`backend/src/routes/employees.js:776, 809, 848`). Aucun lien vers cette page n'existe non plus depuis `Employees.jsx`. Concrètement, avec mon rôle RH, je ne peux ni voir le menu, ni ouvrir l'URL (redirection immédiate vers `/`), ni appeler l'API : je dépends entièrement d'un compte ADMIN pour le geste mensuel qui ouvre, dans mon métier, tout le reste du processus.

**Vérifier les fiches salariés (doublons, données).** La liste et la fiche détail (`GET /employees`, `GET /employees/:id`) me sont ouvertes, ainsi que l'édition complète (`PUT /employees/:id`, `backend/src/routes/employees.js:101-157`) — nom, coordonnées, état civil, titre de séjour, salaire brut, etc., tous les champs importés de Malibou sont éditables depuis une seule fiche (`Employees.jsx`). En revanche, l'outil de nettoyage des doublons (`POST /import/dedupe-ghosts`) est ADMIN uniquement et n'a pas d'équivalent en lecture seule pour moi : je n'ai aucun moyen applicatif de repérer une fiche fantôme avant de la signaler.

**Contrats et avenants.** Ce module fonctionne bien : `GET/POST /employees/:id/contracts` m'est ouvert, l'origine (« embauche » vs « renouvellement ») est déduite automatiquement, et le contrat courant resynchronise la fiche salarié (`backend/src/routes/employees.js:689-721`). C'est un point fort réel de mon parcours.

**Visites médicales.** Le backend est complet : liste des échéances en retard/imminentes/à planifier (`GET /employees/visite-medicale/alertes`, `backend/src/routes/employees.js:900-926`), enregistrement du résultat (`PUT /:id/visite-medicale`) et reprogrammation de l'échéance (`PUT /:id/visite-medicale/programmer`), les trois ouverts à RH. Mais aucune de ces trois routes n'est appelée depuis le frontend (recherche exhaustive dans `frontend/src`) : seul le champ brut `visite_medicale_date` est exposé dans le formulaire d'édition générique d'`Employees.jsx`, sans le résultat ni la date d'échéance. Pire, `services/collaborator-import.js:430-456` (création d'un nouveau collaborateur à l'import) ne renseigne jamais `visite_medicale_due_date` — seul un backfill ponctuel dans `init-db.js:2521-2527` l'avait fait, une fois, pour les fiches déjà en base à contract_start+90 jours. Tout salarié embauché depuis n'apparaîtra donc jamais dans la liste des alertes, sauf appel manuel d'une route que je ne peux pas déclencher depuis l'interface.

**Heures travaillées & pointage.** Le pointage badge (bornes Raspberry Pi) alimente automatiquement `work_hours` en type `normal` — robuste. Ma saisie manuelle via `WorkHours.jsx`, en revanche, propose un menu `normal/overtime/absence/conge/maladie` (`frontend/src/pages/WorkHours.jsx:58`) alors que le backend n'accepte que `normal/training/absence/sick/holiday` et bascule silencieusement tout le reste sur `normal` (`backend/src/routes/employees.js:418`). Une maladie ou un congé saisis à la main disparaissent donc dans le calcul des jours travaillés.

**Planning hebdo des 4 filières.** Complètement hors de portée : menu masqué (`Layout.jsx:182`), route frontend limitée à `ADMIN, MANAGER` (`App.jsx:152`), et le routeur backend entier verrouillé au même niveau (`planning-hebdo.js:8` : `router.use(authenticate, authorize('ADMIN','MANAGER'))`). Je n'ai aucune visibilité sur l'affectation hebdomadaire des salariés aux filières tri/collecte/logistique/boutique.

**Compétences.** La page `Skills.jsx` charge pour chaque salarié `GET /candidates/${emp.candidate_id || emp.id}/skills` (`frontend/src/pages/Skills.jsx:42`). Or `candidate_skills` est indexée par `candidate_id`, une séquence indépendante de `employees.id` (`backend/src/routes/candidates/individual.js:205`). Comme la majorité de mes salariés (import Malibou direct, pas de recrutement associé) ont `candidate_id` nul, la page interroge en réalité les compétences du *candidat* dont l'id coïncide numériquement avec celui du salarié — donnée non pertinente ou carrément celle d'une autre personne. De plus la matrice est strictement en lecture seule (aucun gestionnaire de clic dans tout le fichier) alors que `PUT /candidates/:id/skills/:skillName` existe et fonctionne — mais n'est appelé nulle part dans le frontend, tous rôles confondus.

**KPI RH.** `ReportingRH.jsx` agrège proprement ETP (base 1607h), absentéisme et formation via `employees/kpi/{etp,absenteisme,formation}`, tous ouverts à RH. Mais ces trois indicateurs souffrent du même défaut de saisie évoqué plus haut : `kpi/formation` (`employees.js:976-992`) et `kpi/etp` comptent le type `training`, jamais atteignable depuis l'interface (0 occurrence de « training » dans tout `frontend/src`) ; `kpi/absenteisme` compte `absence`/`sick`, alors que « Maladie » saisie à la main devient `normal`. Les trois chiffres que je dois remonter à la DREETS/ASP sont donc structurellement optimistes.

**Recrutement.** C'est la partie la plus aboutie : kanban (`/candidates/kanban`), trame d'entretien structurée, fiches de mise en situation, et surtout la liaison candidat↔collaborateur (`link-employee`/`unlink-employee`/`employee-matches`, `backend/src/routes/candidates/conversion.js`) avec garde-fous anti-doublon (409 si déjà lié) et pont automatique vers le profil PCM du parcours d'insertion. Tout est câblé côté `Candidates.jsx` et `Employees.jsx` (bouton « Lier une fiche de recrutement », badges de score de correspondance).

Enfin, en page d'accueil, la tuile « Reporting » m'est proposée (`Dashboard.jsx` roles incluent RH) mais pointe vers `/performance`, route réservée à `ADMIN, MANAGER` (`App.jsx:190`) : un clic me ramène silencieusement à l'accueil.

## 3. Remontée

**Forces** : liaison recrutement↔collaborateur bien pensée et bien câblée ; gestion des contrats/avenants fiable ; import Malibou idempotent et résilient (SAVEPOINT par ligne) côté backend ; fiche salarié riche (20+ champs) éditable en un seul écran ; kanban et trames d'entretien de recrutement complets.

**Faiblesses / défaillances vérifiées** : import Malibou et dédoublonnage inaccessibles au rôle RH (front + API) ; taxonomie `work_hours.type` incohérente entre l'IHM de saisie et les règles de calcul, cassant l'absentéisme et rendant la formation impossible à renseigner ; alertes de visite médicale non exposées et jamais réamorcées pour les nouveaux embauchés ; page Compétences non fiable (mauvaise clé de jointure) et non éditable ; planning hebdo totalement hors périmètre RH ; tuile Reporting menant à une impasse.

**Manques fonctionnels** : pas de suivi structuré des formations obligatoires (SST, CACES, habilitations) avec échéances ; pas d'alerte fin de contrat CDDI côté RH ; pas d'alerte sur le renouvellement des titres de séjour malgré le champ existant.

## 4. Verdict

**Verdict : partielle.** Le recrutement et la gestion administrative de base (fiches, contrats) tiennent la promesse ; en revanche l'étape d'entrée du processus mensuel (import) m'est fermée, et deux des trois KPI RH nommément attendus (absentéisme, formation) reposent sur une saisie manuelle dont la nomenclature ne correspond pas à celle utilisée pour les calculer.

**Note : 5/10**
