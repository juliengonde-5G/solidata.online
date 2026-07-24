# Réalisation — Indicateurs égalité F/H + Plan de formation (RSEI-08 + RSEI-12)

- **Date** : 24 juillet 2026
- **Actions** : RSEI-08 et RSEI-12 du plan `rapports/rsei-2026-07-22/03-plan-action-rsei.md` (§2.1)
- **Objet** : deux évolutions légères du module RH, **dernières briques logicielles du volet RSEi**. RSEI-08 outille le critère **2.2 « Promotion de l'égalité et de la diversité »** ; RSEI-12 outille le critère **2.1 « Emplois et compétences »**. Toutes deux alimentent les métriques VSME B8/B10.
- **Version** : 2.19.0.

## Périmètre livré

**RSEI-08 — Indicateurs d'égalité femmes/hommes**
- Backend : `GET /api/employees/kpi/egalite-fh?annee=` (ADMIN/RH/MANAGER, **agrégats non nominatifs**) — effectif F/H et part de femmes, **permanents vs parcours**, répartition **par équipe** (proxy filière), **part de femmes dans l'encadrement** (salarié désigné `manager_id` d'au moins un actif), **accès à la formation par sexe** (heures `work_hours` type `training` + heures moyennes par femme / par homme, `null` si effectif nul — jamais 0 inventé).
- Le sexe est **estimé à partir de la civilité** (Mme/Mlle → F, autre civilité renseignée → H, sinon « non renseigné ») : la base ne porte aucun champ « sexe » déclaratif, l'indicateur est documenté comme une estimation.
- Frontend : section « Égalité femmes/hommes » dans `ReportingRH.jsx` (cartes KPI, tableau par équipe, formation par sexe, note de méthode).

**RSEI-12 — Plan de formation**
- Schéma : `formation_actions` (`init-db.js` idempotent, prouvé sur PostgreSQL 16 UTF8) — **non nominative** : compteurs `nb_participants_prevus`/`realises`, aucun `employee_id` (aucune surface RGPD nouvelle ; les heures individuelles restent dans `work_hours`). 4 enums (type / origine / public / statut). Couvre permanents ET parcours (`public_cible`).
- Backend : `GET/POST/PATCH/DELETE /api/employees/formation/actions` (+ filtres année/statut) et `GET /api/employees/formation/bilan?annee=` (planifié vs réalisé, taux de réalisation, heures et coûts prévus vs réalisés, répartition par public). **Routes en 2 segments** (`/formation/actions`, `/formation/bilan`) pour ne pas être captées par la route `GET /:id`.
- Frontend : page `PlanFormation.jsx` (`/rh/formation`, sidebar « Gestion du personnel », icône GraduationCap ; lecture ADMIN/RH/MANAGER, suppression ADMIN/RH) — bilan + tableau + modal de saisie.

## Doctrines de conception

1. **Jamais de valeur inventée** : parts et heures moyennes `null` (« — ») quand l'effectif est nul ; le taux de réalisation du plan est `null` si aucune action n'est engagée.
2. **Non nominatif** : les deux surfaces ne manipulent que des agrégats / compteurs. Le plan de formation ne stocke aucun individu.
3. **Estimation assumée** : la répartition F/H repose sur la civilité, faute de champ « sexe » — présentée comme telle, jamais comme une donnée déclarée.

## Vérification

- **Jest 992/992** (73 suites, +10 : schéma `formation_actions`, garde `gesHasObservations`, `documentStatut`…) ; **build Vite OK**.
- **Migration idempotente prouvée sur PostgreSQL 16.13 UTF8 réel** ; SQL des deux endpoints **validé sur données seedées** (effectif 40 % de femmes, encadrement, formation F=10,5 h/H=2 h, bilan 3 actions dont 50 % de réalisation).
- Aucune dépendance npm ajoutée ; collision de route `GET /:id` écartée (routes formation en 2 segments).

## Le volet RSEi est complet côté logiciel

Modules livrés : Pilotage RSE (RSEI-10), Énergie & GES (RSEI-11), Enquêtes (RSEI-13), Achats responsables (RSEI-17), générateurs avancés (RSEI-18), évolutions QHSE (RSEI-06/07) et RH (RSEI-08/12). **Reste hors logiciel (direction)** : recevabilité ACI (RSEI-00), nomination du référent, projet d'entreprise, socles CSE/DUERP/formation, charte égalité. L'**export VSME B1-B11 autonome** (RSEI-09) reste un chantier optionnel — les métriques B3/B6/B8/B9/B10 sont déjà exposées par les modules Énergie & GES et RH.

## Déploiement

`bash deploy/scripts/deploy.sh update` — migration automatique et idempotente ; **aucun paramétrage requis**.
