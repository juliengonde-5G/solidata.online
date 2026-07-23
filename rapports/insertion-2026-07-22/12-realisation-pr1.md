# Réalisation — PR 1 « Extension du module Insertion » (étapes 0-3)

- **Date** : 23 juillet 2026 — rapport de la phase D (vérification transversale)
- **Périmètre** : PR 1 de 3 du plan de codage (`05-plan-codage.md` §6 : étapes 0-3 + addendum §6bis) — modèle « entretiens », diagnostic refondu, objectifs/partenaires/actions, socle conformité IAE intégré au schéma
- **Phases** : A (schéma `init-db.js`) → B (backend) → C (frontend) → **D (écarts contractuels, vérification, documentation — ce rapport)**
- **Version** : 2.10.0 (entrée CLAUDE.md §12 du 23 juillet 2026)

---

## 1. Vérification finale (phase D)

| Contrôle | Avant PR 1 | Après phases A-C | Après phase D |
|---|---|---|---|
| Jest backend | 650/650 (v2.9.0) | 743/743 | **756/756 verts, 60 suites** (+106 sur la PR, dont 46 tests de contrat `tests/contract/insertion-contract.test.js`, +13 en phase D) |
| Build frontend | — | — | **Vite OK** (8,3 s, chunk `InsertionParcours` 129 kB lazy) |
| Mobile Vitest | 40/40 | — | **40/40** (aucun fichier mobile touché — non-régression confirmée) |
| Base neuve | — | prouvée en phase A | **re-prouvée en phase D sur PostgreSQL 16.13 réel** (§ 5) |

Le smoke test de déploiement (`scripts/tests/api-smoke.js`, hooké dans `deploy.sh update`) avait été étendu en phase B (T-RH-10/11/12 : actions-overview, partenaires, cohorte/stats) ; la phase D ajoute **T-RH-13 `/api/insertion/parametres`**.

**Greps de cohérence (phase D, tous verts)** :
- « ODS » : **0 occurrence** dans le code du module (backend + frontend).
- Noms du corpus (BEYECK, PERRIER, DESBOIS) : **0 occurrence** (src backend/frontend/tests).
- `'Bilan M+3'` en dur : uniquement (a) le CREATE TABLE historique + les UPDATE de migration d'`init-db.js`, (b) les **titres** d'échéancier d'`engine.computeMilestoneSchedule` (par conception : le type technique est `bilan_intermediaire`, le titre identifie l'occurrence — documenté dans l'en-tête de la fonction), (c) les tests (migration + rejet du type legacy en POST).
- `sortie_classification = 'positive'` : **plus aucune occurrence exécutable** hors migration init-db (le seul autre hit est un commentaire de routes.js ; les `'positive'` de finance.js/FinanceTresorerie.jsx sont le signe des flux de trésorerie, sans rapport).

---

## 2. Livré lot par lot

### Étape 0 — Schéma + registre des freins (phase A)
- **`insertion_milestones` requalifiée** (EXG-16/48) : 5 libellés français figés → 5 types techniques (`diagnostic_accueil`, `bilan_intermediaire`, `renouvellement`, `bilan_sortie`, `suivi_post_sortie`), backfill des titres AVANT renommage (libellés d'origine conservés), DROP des contraintes par scan `pg_constraint` (ordre critique documenté dans init-db), fin de l'unicité `(employee_id, milestone_type)` → **index uniques partiels accueil/sortie par (employee_id, parcours_num)**, index `(employee_id, due_date)`.
- **Nouvelles colonnes entretien** : `titre`, `parcours_num` (RES-05), `previous_milestone_id`, `previous_review` JSONB, `validations` JSONB, `ia_preparation(+_at)`, `contract_id`, `renouvellement_form/avis/duree_mois`, `sortie_documents` (EXG-07), `post_sortie_situation/commentaire` (EXG-08), `remise_salarie` (RES-03), `fse_sortie` (EXG-12), `locked_at` (RES-02), `frein_logement`, `frein_judiciaire`.
- **Sorties 4 catégories** (D8/EXG-06) : CHECK `emploi_durable`/`emploi_transition`/`sortie_positive`/`autre`, mapping par `sortie_type`, ancien binaire conservé dans `sortie_classification_legacy` (migration idempotente `WHERE IN ('positive','negative')`).
- **`insertion_diagnostics`** : `parcours_num` + `UNIQUE(employee_id, parcours_num)` (RES-05), ~45 colonnes structurées des 12 rubriques de la trame officielle, `questionnaire_detail`/`fse_entree` JSONB (D5, §6bis-1), `statut_saisie` (REC-UX-01), 2 nouveaux freins + détails.
- **`employees`/`candidates`** : Pass IAE (n° + période — EXG-02), dérogation CDDI (motifs légaux), éligibilité (critères + localisation des justificatifs), `france_travail_id`, `parcours_num` ; côté candidat : `prescripteur_id`, Pass IAE, éligibilité (PROP-02).
- **5 tables satellites** : `insertion_objectifs` (sous-objectifs), `insertion_partenaires` (+ seed idempotent 16 partenaires), `insertion_pmsmp` (EXG-05 — schéma seul, UI PR 2), `insertion_satisfaction_sortie` (unicité par parcours), `insertion_milestones_history` (RES-02, pattern refashion_dpav_history).
- `cip_action_plans` : `milestone_id` nullable, `objectif_id`, `partenaire_id`, `resultat`, `duree_minutes` (RES-04), `created_by`.
- Registre RGPD : entrée « Accompagnement socio-professionnel des salariés en insertion » (art. 9/10, durées, mesures — seed idempotent). CHECK `insertion_interview_alerts.alert_type` élargi (`pass_iae_7m`/`pass_iae_2m`).
- **`freins-registry.js`** : source unique des **9 axes** (7 historiques + logement + judiciaire), flags `sensible` (art9/art10), ordre radar/export CDC — miroir front `components/insertion/freins.js`.

### Étape 1 — API entretiens (phase B)
- `POST /milestones` (types techniques, titre auto « Bilan n° N », lien contrat, upsert accueil/sortie), `PUT /milestones/:id` (fin du COALESCE intégral : champs présents seulement, null explicite ; **refus 409 si verrouillé** ; snapshot `update` sur un réalisé), **`POST /milestones/:id/close`** (REC-UX-02/03 : contrôles freins/previous_review/prochain entretien/catégorie+documents de sortie, verrou `locked_at`, snapshot `close`, effet de clôture parcours préservé, `resyncMilestones` post-commit — EXG-16/22), `POST /milestones/:id/reopen` (ADMIN/RH, motif obligatoire, snapshot `reopen`, validations caduques), `POST /:employeeId/resync-milestones` (EXG-22), `GET /alertes/:employeeId` (consolidées : retards, à-planifier, Pass IAE, cumul CDDI 22/24, diagnostic > délai, actions critiques, alertes scheduler enfin lues — EXG-01/02), radar 9 axes à null honnête, `PUT /:employeeId/cip-referent`, `GET /cip-referents` (rôles custom résolus).
- `engine.computeMilestoneSchedule` : échéancier calé contrat réel, types techniques ; timeline multi-contrats (fin du `is_current` seul).
- **Scheduler** : `checkPassIaeExpiring` (J-7 mois/J-2 mois), `checkRenouvellementsAPreparer` (< 6 semaines), `createPostSortieFollowups` (+3 mois — EXG-08), option `insertion.ia_preparation_auto` (J-7) ; jobs existants adaptés au nouveau modèle.
- **Liaison recrutement** (`conversion.js`, PROP-01/02) : recopie prescripteur/Pass IAE/éligibilité, jalons auto (`generateMilestones`), squelette de diagnostic du parcours courant.

### Étape 2 — Diagnostic refondu (phase B + C)
- `PUT /diagnostic/:employeeId` : upsert par (employee_id, parcours_num), écriture **partielle** (stepper), **chiffrement applicatif AES-256** des champs sensibles (`utils/field-crypto.js` — commentaire santé, détails frein santé, détail judiciaire — D9), erreurs diagnosticables (SQLSTATE + hint).
- **Masquage par rôle** (`masking.js`, EXG-35→44) : un MANAGER ne voit ni n'écrit JAMAIS `frein_judiciaire*`, les détails santé, `commentaire_budget` (retrait des clés, pas de null ambigu) — appliqué aux diagnostics, entretiens, listes, radar (axe absent).
- **`DiagnosticForm`** (REC-UX-01/17/19) : stepper 12 rubriques, sauvegarde auto 30 s + à chaque étape, reprise du brouillon, mode relecture (gros caractères, notes internes masquées), `FreinPicker` 6 boutons (Non évalué/1-5) avec suggestion surlignée, encadré légal judiciaire, PDF salarié/dossier.

### Étape 3 — Objectifs, partenaires, actions (phase B + C)
- CRUD `/objectifs` (garde sous-objectif 1 niveau, écriture A/RH, lecture module), `/partenaires` (lecture module, écriture A/RH, catégories contrôlées), **`GET /actions-overview`** (filtres salarié/catégorie/criticité/partenaire/retard/statut/« mes salariés », pagination bornée).
- **Page `/insertion/actions` (ActionsCIP.jsx)** : tableau transversal trié par échéance + **« + Action » global ≤ 30 s** (REC-UX-04 : 2 champs obligatoires, récents d'abord, Entrée = valider).
- `InsertionParcours` recomposée : onglets Synthèse / Diagnostic / Entretiens & bilans / Objectifs & actions / Freins / Assistant IA ; **bloc « Aujourd'hui / Cette semaine »** en tête (REC-UX-07), retards regroupés par salarié (REC-UX-08), objectif conventionné DREETS éditable ; `EntretienForm` (Enregistrer ≠ Clôturer, check-list « Prêt à clôturer », refus 409 avec ancres, previous_review en 1 geste — REC-UX-02/03) ; onglet lecture seule « Parcours insertion » sur la fiche Employees (REC-UX-12) ; PDF exemplaire salarié FALC / dossier + trace de remise (REC-UX-09, RES-03).

### Phase D — écarts contractuels comblés (§ 3) + REC-UX-18 + documentation

---

## 3. Phase D — détail des 4 écarts comblés + paramétrage

| # | Écart signalé par la phase C | Livré |
|---|---|---|
| 1a | Agenda cohorte sans titre/heure/drapeau IA | `GET /cohorte/stats` : les jalons (retards / à venir / agenda 30 j) portent `titre`, `interview_date`, `ia_preparation_ready` (`ia_preparation IS NOT NULL`) ; front (`AgendaBloc`) : libellé réel, **heure du rendez-vous** quand elle est posée, badge **« Préparation IA prête »** (REC-UX-07) |
| 1b | Suggestions de freins calculées seulement côté client | `PUT /diagnostic/:employeeId` renvoie **`suggestions_freins`** `{axe: niveau}` calculé serveur sur la ligne complète après upsert — règles simples documentées dans `computeSuggestionsFreins()` (sans_abri→logement 5, hébergé→4 ; difficultés+crédits→finances 4 ; ni permis ni véhicule ni TC→mobilité 4 (TC dispo→3) ; pièce d'identité expirée→administratif 4 ; CECRL A1→linguistique 4 ; contre-indications→santé 3 ; monoparental→famille 3 ; **jamais de suggestion sur l'axe judiciaire — art. 10**) ; `DiagnosticForm` consomme les suggestions serveur (pré-calcul local conservé en repli avant première sauvegarde) |
| 1c | Acquittement d'alertes en localStorage (non partagé, non audité) | Table **`insertion_alert_acks`** (employee_id, alert_type, acked_by, acked_until, created_at — CREATE TABLE IF NOT EXISTS + index) ; **`POST /alertes/:employeeId/ack { type, jusqu_au }`** (rôles du module, 400 si date passée, 404 salarié inconnu, 201 + ligne journalisée) ; `GET /alertes/:employeeId` filtre les types acquittés non expirés et renvoie **`acquittees`** séparément (`total` = actives) ; `AlertesBloc` bascule sur l'endpoint (« Vu · 7 j » partagé entre CIP) — clôt le volet « journalisé » de REC-UX-08 |
| 1d | Alias `positives`/`negatives` encore servis | Retirés de `GET /cohorte/stats` **et** `GET /audit` après grep front : seul `AuditInsertion.jsx` les consommait encore → migré sur `dynamiques`/`autres` (5 points : cartes, PDF, encarts) ; au passage la page passe au **registre 9 freins** (corrige un frein dominant logement/judiciaire qui s'affichait « undefined ») ; `DashboardExecutif`/`ReportingRH` consomment d'autres endpoints (non concernés) |
| 2 | REC-UX-18 (valeurs en dur : +14 j, « dans 2 mois ») | Clés settings **`insertion.echeance_action_defaut_jours`** (défaut 14) et **`insertion.rythme_bilans_mois`** (défaut 2) lues par `readInsertionSetting` ; nouvel endpoint **`GET /insertion/parametres`** (tous rôles module, défauts documentés) ; front : module partagé `components/insertion/parametres.js` (cache mémoire, défauts en repli) consommé par **QuickActionButton** (échéance d'action) et **EntretienForm** (date proposée du prochain entretien à la clôture + libellé dynamique « Proposé : dans N mois ») — le rythme *par salarié* reste en PR 2 |

**Tests ajoutés en phase D (13, dans `insertion-contract.test.js`)** : ack (validation date passée/type manquant, 404, 201 avec journalisation de l'auteur, MANAGER autorisé), alertes acquittées (séparation actives/acquittees + total), cohorte/stats (nouveaux champs jalons ; sorties sans alias — cohorte ET audit), suggestions_freins (3 scénarios de règles + objet vide + jamais judiciaire), parametres (défauts + surcharge settings + parsing nombre/booléen).

---

## 4. Exigences couvertes (PR 1)

- **EXG** : 01 (délai diagnostic + alerte), 02 (Pass IAE stocké + alertes ; bilan de prolongation PDF → PR 2), 06 (nomenclature 4 catégories + taux + objectif paramétré), 07 (clôture sortie : catégorie + check-list documents), 08 (post-sortie : type + job de création ; écran de saisie dédié complété en PR 2), 12 (FSE+ : fse_entree/fse_sortie + export trimestriel), 16 (bilans multiples + pré-chargement + prochain entretien obligatoire), 22 (jalons auto + resync + bouton), 48 (migration sans perte — prouvée sur base peuplée en phase A) ; EXG-35→44 partiellement (chiffrement, masquage, minimisation, registre — journalisation des exports nominatifs et purge paramétrée → PR 2 avec l'export 23 colonnes).
- **REC-UX** : 01 (stepper + autosave), 02 (Enregistrer/Clôturer), 03 (previous_review 1 geste, échéance calculée), 04 (+ Action ≤ 30 s), 07 (bloc Aujourd'hui/Cette semaine — complété heure + badge IA en phase D), 08 (3 niveaux + regroupement + acquittement **journalisé** en phase D ; seuils réglables AdminInsertion → PR 2), 09 (2 gabarits PDF), 12 (fiche Employees en lecture, un seul chemin d'édition), 17 (mode relecture), 18 (settings — phase D ; rythme par salarié → PR 2), 19 (6 boutons freins + suggestion surlignée).
- **RES (rapport 11 § 2)** : RES-02 (verrou + historique + réouverture tracée), RES-03 (remise PDF tracée `remise_salarie` ; pièce signée scannée → PR 2), RES-04 (duree_minutes ; agrégats annuels → PR 2), RES-05 (parcours_num partout). RES-01 (AIPD) : prérequis direction/DPO, hors code — à suivre au déploiement.

---

## 5. Migrations et preuve (phase D, PostgreSQL 16.13 réel)

Séquence **base neuve** rejouée intégralement (ordre documenté RECONSTRUCTION.md) :
1. `init-db.js` — 1er passage : pose users/employees + ~tout le schéma, **erreur finale attendue** sur `clients_exutoires` (dépendance croisée documentée) ;
2. `migrate-exutoires.js` puis `migrate-finance.js` — OK ;
3. `init-db.js` — **2 passages complets successifs verts** (« Base de données initialisée avec succès ») = idempotence de tout le bloc PR1 (DO blocks à scan `pg_constraint` compris).

Vérifications de schéma sur la base réelle : `insertion_alert_acks` complète (colonnes, FKs CASCADE/users, index `idx_insertion_alert_acks_emp`), 16 partenaires seedés, index partiels `idx_milestones_accueil_unique`/`idx_milestones_sortie_unique` + `idx_milestones_emp_due`, CHECK `insertion_milestones_milestone_type_check` (5 types techniques). **Preuve fonctionnelle** : la requête exacte du GET /alertes (acquittements non expirés) retourne l'ack à +7 j et exclut l'ack expiré ; DELETE employé → CASCADE propre. La preuve **base legacy peuplée** (5 types historiques + binaire positive/negative) faite en phase A fait foi — la phase D n'a ajouté qu'une table neuve sans migration de données.

---

## 6. Écarts résiduels reportés en PR 2 (vérifiés dans le code au 23/07)

| Résiduel | Constat |
|---|---|
| **REC-UX-05 — FriseParcours** (couloirs superposés, regroupement) | Composant absent ; la liste chronologique verticale (`TimelineView`) sert de vue de référence |
| **REC-UX-06 — écran ETI `RenouvellementETI`** (bloquant PR 2) | Ni route ni page ; `renouvellement_form` prêt côté schéma/PUT |
| **Export 23 colonnes CDC** (`/exports/insertion-freins`, LATERAL dernière évaluation, `sensibles=0/1`, journal `rgpd_audit_log` — EXG-43) + synthèse comité (`/exports/insertion-synthese`) | Absents (l'export Excel 5 feuilles/CSV existant reste disponible) |
| **Tableau de bord conventionnel AuditInsertion** (3 taux vs cibles, ETP « contrôle », typologies publics, délai diagnostic — EXG-10/24) + formulaire cibles | Non livré ; AuditInsertion migrée dynamiques/autres + 9 freins en phase D, sans le bloc conventionnel |
| **PMSMP / satisfaction UI + API** (`GET/POST /pmsmp` avec bornes 31 j/60 j, `POST /satisfaction/:employeeId`, `GET /satisfaction-stats`) | Tables créées (phase A), **aucune route ni écran** |
| `GET /renouvellements` (fins de contrat < 6 semaines + état formulaire) | Absent (le job scheduler alimente les alertes, pas de vue dédiée) |
| **AdminInsertion** `/admin/insertion` (partenaires, seuils, IA auto) | Absent — les partenaires s'administrent par l'API, les seuils par settings |
| Anonymisation/purge étendues aux nouvelles tables + `insertion.retention_months` + exclusion FSE+ (piste d'audit ≥ 5 ans) | `services/anonymization.js` non étendu aux tables PR1 |
| Rythme de suivi **par salarié** (REC-UX-18 complet), pièce signée scannée (RES-03), agrégats annuels de durée (RES-04), gabarit PDF « bilan de prolongation Pass IAE » (EXG-02) | Reportés |
| Renommage des entrées de menu « Espace CIP » / « Pilotage & indicateurs » (REC-UX-07) | Libellés actuels conservés |

---

## 7. Consignes de déploiement

- **`bash deploy/scripts/deploy.sh update`** standard (rebuild backend + frontend, init-db au restart applique les migrations PR1 + la table `insertion_alert_acks` idempotente). **Aucun paramétrage requis** : tous les réglages ont des défauts en code (`insertion.delai_diagnostic_jours` 30, `insertion.alerte_pass_iae_mois` 7, `insertion.echeance_action_defaut_jours` 14, `insertion.rythme_bilans_mois` 2, `insertion.ia_preparation_auto` off, objectif sorties dynamiques éditable dans l'UI).
- **À communiquer aux CIP** :
  1. Les bilans deviennent **illimités et à date libre** (« Bilan n° N ») ; les anciens M+3/M+6/M+10 sont conservés avec leur titre.
  2. **« Enregistrer » ≠ « Clôturer »** : la clôture contrôle la trame, exige le prochain entretien planifié et **verrouille** l'entretien (réouverture ADMIN/RH avec motif — tracée).
  3. Le diagnostic se fait en **plusieurs séances** (brouillon auto-sauvegardé, reprise à la rubrique suivante) ; les niveaux de freins sont **suggérés** depuis les réponses, jamais imposés ; « Non évalué » est un état légitime.
  4. Les sorties se classent désormais en **4 catégories officielles** (le taux « dynamiques » remplace l'ancien positif/négatif) — saisir la catégorie ET la check-list des documents remis avant clôture.
  5. Les alertes « Vu · 7 j » sont **partagées entre collègues** (acquitter = acquitter pour tout le monde ; l'auteur est journalisé).
  6. Managers : les données judiciaires/santé/budget sont **invisibles par conception** (pas un bug).
- **Prérequis hors code (direction/DPO)** : AIPD (RES-01) à finaliser avant l'usage des champs art. 9/10 en production ; décision de peuplement du référentiel partenaires (16 seedés, complétables dans l'UI d'actions).
