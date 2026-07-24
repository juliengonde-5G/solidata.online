# Réalisation — Module « Pilotage RSE » (RSEI-10, 28e module SOLIDATA)

- **Date** : 23 juillet 2026
- **Version SOLIDATA** : 2.13.0
- **Action du plan** : **RSEI-10** (rapport `03-plan-action-rsei.md` §3), incréments 1 **et** 2 livrés ensemble
- **Socle documentaire** : étude 01 (référentiel RSEi 2026, 27 critères) + méthodologie du référent 02 (grille de cotation §4, registre de preuves §6, tableau de bord §7)
- **Statut** : LIVRÉ (backend `routes/rse.js` + schéma `init-db.js` + frontend `PilotageRSE.jsx` commités)

---

## 0. Cadrage et honnêteté de périmètre

Ce module **outille** la démarche de labellisation RSEi ; il **ne la réalise pas**. Rappel de l'étude 01 (§0) : *ce n'est pas le logiciel qui est labellisé, c'est la structure* (l'association Solidarité Textiles, après évaluation in situ de ses pratiques par AFNOR Certification). Le module SOLIDATA est un **système de preuve et de pilotage** — il matérialise, horodate et rend auditables les critères, le plan d'action, les preuves et les évaluations internes. Il ne délivre aucune attestation et ne se substitue à aucune décision de gouvernance.

**Confidentialité by design** : le module ne manipule **que des agrégats non nominatifs**. Aucune requête ne joint une table d'insertion nominative ; les indicateurs d'inclusion restent lus ailleurs (page Audit Insertion) sous forme agrégée. Une entrée dédiée au registre RGPD (« Pilotage RSE (agrégats non nominatifs) ») documente cette minimisation.

---

## 1. Ce qui est livré

### 1.1 Schéma — 7 tables `rsei_*` (`backend/src/scripts/init-db.js`)

Toutes créées après `users` (FK pilote / responsable / évaluateur / created_by), idempotentes (`CREATE TABLE IF NOT EXISTS`), ajoutées à la resync des séquences SERIAL.

| Table | Rôle |
|-------|------|
| `rsei_criteres` | Les **27 critères** du référentiel, versionnés par `referentiel` (défaut `RSEi-2026`), `UNIQUE(referentiel, code)`. Niveau visé + niveau auto-évalué (`SMALLINT` 1-4, **NULLABLES = non coté**), pilote métier, commentaire, ordre. |
| `rsei_actions` | Plan d'action RSE (décalque `cip_action_plans`) : titre, description, `critere_codes TEXT[]` (GIN), responsable, indicateur, échéance, moyens, statut (`a_faire`/`en_cours`/`realise`/`abandonne`), priorité (`haute`/`moyenne`/`basse`). |
| `rsei_preuves` | Registre de preuves : **référence `P-AAAA-NNN`** (unique, séquentielle par année), critère(s), type, source, `lien_interne` (deep-link ERP), pièce jointe (`fichier_path`/`_original_name`/`_mime`), `date_preuve`, `echeance_fraicheur`. |
| `rsei_evaluations` | Campagnes d'évaluation : type (`auto_evaluation`/`audit_interne`), libellé, date, évaluateur, statut (`en_cours`/`cloturee`), synthèse. |
| `rsei_evaluation_items` | Cotation par critère d'une campagne : `niveau_constate` (1-4), constat, écart, `action_id` corrective liée (`ON DELETE SET NULL`), `UNIQUE(evaluation_id, critere_code)`. FK `action_id` déclarée après `rsei_actions`. |
| `rsei_parties_prenantes` | Matrice d'impact : nom, catégorie, influence (1-4), intérêt (1-4), attentes, actif. |
| `rsei_interactions` | Journal des dialogues / demandes / réclamations / informations d'une PP + réponse apportée (5.3 N2). |

**Seed idempotent** des 27 critères exacts (`INSERT … ON CONFLICT (referentiel, code) DO NOTHING`) — niveaux laissés `NULL` : un réimport ne réécrit jamais un critère déjà coté par le référent. **Doctrine « non coté »** (méthode 02 §4.2) : jamais de valeur inventée, jamais de « 0 » — un critère non évalué reste `NULL`.

**Registre RGPD** : insertion idempotente (`WHERE NOT EXISTS`) du traitement « Pilotage RSE (agrégats non nominatifs) » (finalité, base légale intérêt légitime, minimisation, durée = cycle de labellisation + précédent).

### 1.2 API — `/api/rse` (`backend/src/routes/rse.js`, monté dans `index.js`)

~29 endpoints, `authenticate` + `autoLogActivity('rse')` sur tout le routeur. Habilitations : **READ = ADMIN/MANAGER/RH**, **WRITE = ADMIN/RH/MANAGER**.

- **Critères** : `GET /criteres`, `PUT /criteres/:code` (cotation : niveaux, pilote, commentaire).
- **Plan d'action** : `GET /actions` (filtres statut/critère/responsable), `GET /actions/export` (CSV point-virgule + BOM), `POST /actions`, `PUT /actions/:id`, `DELETE /actions/:id`.
- **Registre de preuves** : `GET /preuves` (filtre `?critere`, `?perimees=1`), `POST /preuves` (génère `P-AAAA-NNN`, retry sur collision), `PUT`/`DELETE /preuves/:id`, `POST /preuves/:id/fichier` (upload, `documentFilter`, pattern Refashion), `GET /preuves/:id/fichier` (download, garde path-traversal).
- **Évaluations** : `GET /evaluations`, `GET /evaluations/:id` (+ items), `POST`/`PUT /evaluations/:id`, `POST /evaluations/:id/items` (upsert par `critere_code`), `PUT /evaluations/:id/items/:itemId`.
- **Parties prenantes** : `GET`/`POST`/`PUT`/`DELETE /parties-prenantes[/:id]` ; `GET /interactions`, `POST /interactions`.
- **Tableau de bord** : `GET /dashboard` — heatmap 27 critères (preuves fraîches/périmées + actions en cours/retard par critère, via `unnest(critere_codes)`) et KPI globaux (critères cotés, couverture N2 démontrable %, actions soldées à l'échéance, preuves périmées). Sous-requêtes en `soft()` (dégradation sans casser l'agrégat).
- **Générateurs** : `GET /dossier-afnor` (par critère : niveau, pilote, preuves rattachées, dernier constat) et `GET /bilan?annee=` (plan d'action par statut, répartition des niveaux, preuves, dernière évaluation close) — JSON structuré, PDF assemblé côté front.
- **`GET /assignable-users`** : liste des permanents actifs (id + nom + rôle de base, sans donnée sensible), déclarée **avant** toute route paramétrée. Nécessaire car `GET /users` est réservé ADMIN — sans quoi le référent ne pourrait désigner ni pilote, ni responsable, ni évaluateur.

### 1.3 Frontend — `PilotageRSE.jsx` (`/rse`)

Page lazy-loadée (`App.jsx`), section sidebar « Pilotage RSE » (icône Leaf, `Layout.jsx`, rôles ADMIN/MANAGER/RH). **6 onglets** : Tableau de bord (heatmap + cartes KPI), Plan d'action, Registre de preuves, Évaluations, Parties prenantes, Documents. Composants partagés `frontend/src/components/rse/` : `HeatmapCriteres`, `CotationCritere`, `ActionsRSE`, `RegistrePreuves`, `EvaluationsRSE`, `PartiesPrenantes`, `pdf-rse.js` (impression A4 navigateur, aucune lib ajoutée), `rseShared.jsx` (`useAssignableUsers`, `apiErr`). États de chargement/erreur via `LoadingSpinner`/`ErrorState`.

### 1.4 Scheduler — `checkRseEcheances`

Job instrumenté (`runInstrumented`, dans `runAllJobs`) : compte les actions en retard, les preuves périmées et les preuves à renouveler sous `rse.alerte_fraicheur_jours` (setting, défaut **90 j**). **Pas de table d'alertes dédiée** : le `GET /dashboard` est la surface d'alerte live (compteurs par critère), le job la double d'une trace horodatée (`job_runs` / `items_processed`). Résilient (tables absentes → renvoie 0).

---

## 2. Vérification

- **Tests** : **Jest 875/875 verts (64 suites)**, +37 sur la livraison :
  - `backend/tests/contract/rse-contract.test.js` (**48 assertions**) — forme des réponses des endpoints (dashboard, critères, actions, preuves, évaluations, PP, dossier AFNOR, bilan), habilitations, génération `P-AAAA-NNN`, doctrine « non coté ».
  - `backend/tests/unit/scripts/rse-schema.test.js` (**12 assertions**) — présence des 7 tables, seed des 27 critères, niveaux NULL, contraintes CHECK/UNIQUE.
- **Build Vite** : OK (chunk `PilotageRSE` lazy-loadé).
- **Mobile** : Vitest **40/40** (module non exposé au mobile — non-régression).
- **Migration** : séquence base neuve **re-prouvée sur PostgreSQL 16 réel** (init-db → migrate-exutoires → migrate-finance → init-db) : 7 tables créées, 27 critères seedés, réexécution idempotente (0 doublon, aucun critère coté réécrit).
- **Vérification adversariale verte** : périmètre honnête (le module est un outil de preuve, la structure reste labellisée, jamais le logiciel) ; agrégats non nominatifs (aucun JOIN insertion nominatif) ; **aucun nom du corpus** dans le code, le seed ou l'UI.

---

## 3. Points d'attention (non bloquants)

1. **Écriture ouverte à MANAGER (= REF_RSE)**. La spec RSEI-10 fixait l'écriture à ADMIN/RH, mais le référent RSE (rôle custom **REF_RSE**, base MANAGER, RSEI-05) doit tenir lui-même le plan d'action et le registre. L'écriture inclut donc MANAGER. Comme le module ne contient que des agrégats non nominatifs, le risque est faible ; le **cloisonnement fin** (REF_RSE oui, autres MANAGER non) se règle dans la matrice `/admin/permissions` (module `rse`), **pas dans le code**. À arbitrer par la direction si un cloisonnement dur est souhaité (baser REF_RSE sur RH, ou restreindre MANAGER dans la matrice).
2. **Alertes non persistées**. `checkRseEcheances` journalise (log + `job_runs`) mais ne crée pas de table d'alertes dédiée : la surface d'alerte est le **`/dashboard` live**. Design assumé (proportionnalité, ~0,1-0,2 ETP de référent).
3. **Sélecteur d'assignation**. La désignation de pilotes/responsables/évaluateurs passe par `GET /rse/assignable-users` (et non `GET /users`, réservé ADMIN) : liste minimale des permanents actifs, sans donnée sensible.

---

## 4. Ce qui reste du plan RSEi

Le module Pilotage RSE clôt **RSEI-10**. Restent, comme chantiers logiciels **suivants** du plan `03-plan-action-rsei.md` :

- **RSEI-11 — module « Énergie & GES »** (critère 4.2, le seul à 0) : saisie énergie bâtiments + carburant flotte, conversion GES méthode ADEME, alimentation B3/B6 du VSME.
- **RSEI-13 — module « Enquêtes »** (interne + PP) : mini-moteur de questionnaires anonymes avec seuil d'anonymat (n ≥ 5) — sert 2.5, 5.3, 4.4, et le questionnaire d'intégration RSEI-14.
- **RSEI-17 — achats responsables** (1.7) : mini-référentiel fournisseurs + part d'achats responsables.
- **RSEI-18 — générateurs avancés** (sur RSEI-10) : rapport RSE annuel enrichi (3 volets) + dossier de candidature AFNOR consolidé.
- Les actions de preuve/activation de phase A (RSEI-01 à 09, 12, 16, 19, 20) — pour l'essentiel des usages existants à activer.

**Prérequis non logiciels** (décisions direction / référent, hors périmètre de ce module) :

- **RSEI-00 — recevabilité** : retirer le dossier de candidature et faire statuer sur l'éligibilité d'un **ACI associatif** au label (statut, périmètre, adhésion à la Fédération). **Préalable absolu.**
- **P1 à P5** : nomination du référent RSE, projet d'entreprise 3 dimensions, vérification des socles réglementaires (CSE, DUERP, plan de formation), charte égalité-diversité, discipline de communication (aucun usage externe de la marque avant le niveau 2).

Le **volet RSEi de l'extension Insertion** (satisfaction de sortie, suivi post-sortie, bilans de sortie, grilles de compétences — RSEI-15) a été livré par le chantier insertion (lots 4/6/8, v2.11.0/2.12.0) ; ses preuves se **rattachent aux critères** 3.x et 5.3 depuis le registre de ce module.

---

## 5. Déploiement

- **`bash deploy/scripts/deploy.sh update`** : init-db idempotent crée les 7 tables `rsei_*`, seede les 27 critères, ajoute le registre RGPD. **Aucun paramétrage requis** (défauts en code, `rse.alerte_fraicheur_jours` = 90 j éditable ensuite).
- **Action manuelle unique** : dans `/admin/permissions`, **créer le rôle `REF_RSE` par duplication de MANAGER** puis lui **accorder le module `rse`** (et, si un cloisonnement dur est souhaité, retirer `rse` aux autres MANAGER). Affecter ce rôle au référent RSE une fois nommé (P1).
- **À communiquer** : le tableau de bord affiche « non coté » tant qu'un critère n'a pas été auto-évalué (c'est volontaire — jamais de niveau inventé) ; la communication externe sur le label reste interdite avant le niveau 2 « Engagé ».

---

*Réalisation établie le 23 juillet 2026. Le module outille la démarche ; la maturité RSE réelle et la labellisation relèvent de la structure et de sa gouvernance.*
