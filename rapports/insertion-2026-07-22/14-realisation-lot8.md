# Réalisation — PR 3 « Extension du module Insertion » (lot 8 : espace encadrant technique)

- **Date** : 23 juillet 2026 — rapport de réalisation et de vérification
- **Périmètre** : PR 3 de 3 du plan de codage (`05-plan-codage.md` addendum §6bis — lot 8), sur le socle **PR 1 v2.10.0** (`12-realisation-pr1.md`) et **PR 2 v2.11.0** (`13-realisation-pr2.md`) : espace encadrant technique complet — grilles de compétences métier, co-construction du diagnostic, entretien de période d'essai, check-list d'embauche
- **Version** : 2.12.0 (entrée CLAUDE.md §12 du 23 juillet 2026)
- **Conclusion** : le lot 8 **complète l'extension Insertion (lots 1-8)**. Le seul chantier restant, le **volet RSE de l'insertion (RSEi / module Pilotage RSE)**, relève d'une **mission séparée** et n'est pas couvert ici.

---

## 1. Vérification finale

| Contrôle | Après PR 2 (v2.11.0) | Après lot 8 (v2.12.0) |
|---|---|---|
| Jest backend | 818/818 (62 suites) | **838/838 verts, 62 suites** (+20 : contrats compétences/référentiel/checklist/période d'essai + moyenne « N/E » exclue + style d'apprentissage Kolb déterministe) |
| Build frontend | Vite OK | **Vite OK** (composants `CompetencesETI`, `ChecklistEmbauche`, `PortefeuilleCompetences`, `StyleApprentissage`) |
| Mobile Vitest | 40/40 | **40/40** (aucun fichier mobile touché — module web uniquement, non-régression confirmée) |
| Base neuve / migration | re-prouvée en PR 1/PR 2 | **re-prouvée sur PostgreSQL 16 réel** (double `init-db.js` idempotent ; la migration lot 8 crée les 4 tables, élargit le CHECK `milestone_type` à 6 types et seede 34 items sans doublon) |

---

## 2. Livré (lot 8)

### 2.1 Grilles de compétences métier (EXG-26/27)

- **Référentiel administrable par filière** (`insertion_competence_referentiels`, CHECK `filiere IN ('tri','collecte','logistique','boutique','transverse')`, `UNIQUE(filiere, rubrique, item)`) : `GET /competence-referentiels?filiere=&actifs=1` (module) + `POST/PUT/DELETE /competence-referentiels` (ADMIN) ; édition dans **AdminInsertion** (`/admin/insertion`).
- **Seed de départ de 34 items** (idempotent `ON CONFLICT DO NOTHING`, jamais réécrit après personnalisation) : transverse « Comportement » (7) + « Accompagnement social et professionnel » (7, volet EXG-27) ; « Activités métier » par filière — tri (5), collecte (5), logistique (5), boutique (5).
- **Évaluations périodiques** (`insertion_competence_evaluations` + `insertion_competence_scores`) : note /10 par item **ou « non évalué » exclu de la moyenne** (miroir `engine.competenceAverage` côté front `moyenneScores`), snapshot dénormalisé `rubrique/item` (FK `referentiel_id` en `SET NULL` — l'historique survit à la suppression d'un item), statut `brouillon`/`valide`, **triple validation salarié/ETI/CIP** horodatée (`validations` JSONB). Routes `GET/POST/PUT /competences[/:id]` (saisie ADMIN/RH/MANAGER), `DELETE /competences/:id` (ADMIN/RH).
- **Composant `CompetencesETI`** (onglet « Compétences » de la fiche) pensé pour l'encadrant peu à l'aise au clavier : une ligne par item, gros boutons 0-10 + « N/E », observation/objectif repliés, moyenne calculée en direct, historique avec delta de moyenne (↗/↘). Les évaluations validées alimentent aussi le PDF dossier (`pdf-insertion.js`).

### 2.2 Co-construction au diagnostic (EXG-28 / EXG-32)

- **Colonnes ajoutées à `insertion_diagnostics`** (non sensibles → visibles de l'encadrant, aucun ajout à `MANAGER_HIDDEN_FIELDS`) : `swot_atouts/faiblesses/opportunites/menaces`, `besoins_exprimes`, `coa_texte`, `portefeuille_interets`/`portefeuille_competences` (JSONB), `savoir_faire`/`savoir_etre`, `style_apprentissage` (enum 4 profils, CHECK) + `style_apprentissage_reponses` (JSONB). Le CECRL (`cecrl_niveau`) était déjà en place (PR 1).
- **`PortefeuilleCompetences`** (étape « Portefeuille & AFOM » du `DiagnosticForm`) : centres d'intérêt + compétences par 6 domaines (cases), savoir-faire/être, **analyse AFOM/SWOT**, besoins exprimés, **COA** (choix d'orientation).
- **`StyleApprentissage`** (étape « Style d'apprentissage ») : questionnaire **Kolb 24 items A/B** → profil `adaptateur`/`divergeur`/`assimilateur`/`convergeur` calculé de façon **déterministe** (miroir exact `engine.computeLearningStyle`), **jamais partiel** (profil envoyé `null` tant que les 24 items ne sont pas renseignés), avec implications pédagogiques affichées pour l'encadrant.

### 2.3 Entretien de période d'essai (EXG-30 / PROP-03)

- **Type `periode_essai`** ajouté au CHECK `milestone_type` (6 types) + colonnes `periode_essai_form` (JSONB) et `periode_essai_decision` (`confirme`/`rompu`/`a_revoir`, CHECK).
- **Auto-créé à la liaison candidat→collaborateur** (`candidates/conversion.js` → `ensurePeriodeEssaiMilestone`) : échéance = début de contrat + `insertion.periode_essai_jours` (défaut 30), **idempotent** (un par parcours).
- **`EntretienForm` dédié** : formulaire court à deux étapes (décision + avis, **hors** freins/objectifs/actions) ; la décision est **requise pour clôturer**.
- **Effet de clôture** (`applyPeriodeEssaiEffect`) : décision « rompu » sur un entretien réalisé → parcours clos proprement (`insertion_status='abandon'` + date de sortie, idempotent) ; « confirme »/« a_revoir » → le parcours continue.

### 2.4 Check-list d'embauche (EXG-30 / PROP-05)

- **`insertion_checklist_embauche`** (une par salarié, `employee_id UNIQUE`, `items` JSONB) : 7 étapes (`promesse_embauche`, `contrat_signe`, `mutuelle`, `charte_insertion`, `livret_accueil`, `reglement_interieur`, `formation_poste`), chacune `{ fait, date, responsable }`.
- **Routes** `GET/PUT /checklist-embauche/:employeeId` (lecture module, écriture **upsert par fusion** ADMIN/RH — un step enregistré ne touche pas les autres).
- **Pré-cochée à la liaison** depuis `recruitment_documents` (charte d'insertion / livret d'accueil déjà remis au recrutement) — `conversion.js`, best effort, idempotent.
- **Composant `ChecklistEmbauche`** : bloc repliable « Accueil / intégration » de l'onglet Synthèse, barre de complétude.

### 2.5 Transverse RGPD / anonymisation

`services/anonymization.js` étendu (résilient au schéma — `tableExists`/`existingColumns` avant chaque UPDATE) : verbatims/JSONB nominatifs de co-construction du diagnostic effacés (`swot_*`, `besoins_exprimes`, `coa_texte`, `savoir_faire/etre`, `portefeuille_*`, `style_apprentissage_reponses`) — **`style_apprentissage` catégoriel conservé** (agrégat de cohorte, même doctrine que les scores de freins) ; `insertion_competence_evaluations` (synthèse/validations effacées, **note conservée en agrégat**), `insertion_competence_scores` (observation/objectif effacés) ; `insertion_checklist_embauche` (`items` → `'{}'`, la ligne subsiste comme marqueur).

---

## 3. Exigences couvertes (lot 8)

- **EXG-26** (grilles de compétences métier par filière), **EXG-27** (volet accompagnement social/professionnel noté, « non évalué » hors moyenne), **EXG-28** (AFOM/SWOT, besoins, COA), **EXG-30** (entretien de période d'essai + check-list d'embauche), **EXG-32** (portefeuille de compétences, CECRL, style d'apprentissage Kolb).
- **PROP-03** (chaînon recrutement → accompagnement : période d'essai auto-créée), **PROP-05** (check-list d'intégration pré-cochée du recrutement).

---

## 4. Vérification adversariale (verte)

1. **Périmètre honnête** — l'ensemble lots 1-8 est livré ; seul le **volet RSEi (module Pilotage RSE)** reste hors périmètre, décrit comme mission séparée dans toute la documentation (guide CIP, note certificateurs, référentiel de performance, CLAUDE.md). Aucun élément RSEi n'est présenté comme livré.
2. **Cohérence** — **0 occurrence** des noms du corpus (BEYECK/SIANGA/PERRIER/DESBOIS/HONORE/FRANCK) et **0 libellé « ODS »** dans le code du lot (backend + frontend + tests) ni dans les docs mises à jour.
3. **RGPD** — les nouvelles tables sont couvertes par l'anonymisation (verbatims effacés, catégoriel/notes conservés en agrégat) ; les données santé/judiciaire/budget restent masquées pour le rôle encadrant (les grilles de compétences n'en contiennent pas).

---

## 5. Points d'attention non bloquants

- **Accès aux compétences non cloisonné par équipe.** La saisie/consultation des grilles de compétences est ouverte à ADMIN/RH/**MANAGER** sans restriction par atelier : un encadrant/manager peut voir les évaluations d'un salarié qui n'est pas dans son équipe. Choix **assumé** — ces grilles ne portent **aucune donnée art. 9/10** (santé/judiciaire/budget restent masqués) — et **documenté** (guide CIP cas 7 et FAQ, note certificateurs §5/§7). Un cloisonnement par équipe pourra être ajouté ultérieurement si le besoin se confirme.
- **Entretien de période d'essai créable manuellement sans verrou d'unicité.** L'auto-création à la liaison est idempotente (un par parcours), mais l'UI n'empêche pas d'ajouter un second entretien `periode_essai` à la main. Sans incidence fonctionnelle (chaque entretien reste indépendant) ; à surveiller pour éviter les doublons de saisie.
- Rappel PR 2 (toujours ouvert) : moyennes de freins de l'agrégat COPIL incluant l'axe judiciaire pour ADMIN/RH (k-anonymat faible sur très petites cohortes) — seuil d'effectif minimal à étudier avec le DPO.

---

## 6. Migration et preuve

- **4 nouvelles tables** : `insertion_competence_referentiels`, `insertion_competence_evaluations`, `insertion_competence_scores`, `insertion_checklist_embauche` (`CREATE TABLE IF NOT EXISTS`, index créés).
- **Colonnes ajoutées** (idempotent `ADD COLUMN IF NOT EXISTS`) : `insertion_diagnostics` (12 colonnes de co-construction) ; `insertion_milestones` (`periode_essai_form`, `periode_essai_decision`).
- **CHECK `milestone_type` élargi à 6 types** par DO-block scannant `pg_constraint` (drop des CHECK sans `periode_essai`, re-création gardée) — sûr sur base neuve (le bloc PR 1 pose 5 valeurs, ce bloc l'élargit) comme sur base déjà migrée.
- **Seed 34 items** du référentiel `ON CONFLICT (filiere, rubrique, item) DO NOTHING` (un item renommé/désactivé par l'utilisateur n'est jamais réécrit).
- **Idempotence** re-prouvée : double exécution `init-db.js` verte sur PostgreSQL 16 réel (ordre RECONSTRUCTION.md : init-db → migrate-exutoires → migrate-finance → init-db ×2).

---

## 7. Déploiement

- **`bash deploy/scripts/deploy.sh update`** standard (rebuild backend + frontend ; init-db idempotent au restart applique la migration lot 8). **Aucun paramétrage requis** : le référentiel de compétences est seedé (éditable ensuite dans AdminInsertion), `insertion.periode_essai_jours` a un défaut de 30 en code.
- **À communiquer** (CIP, encadrants, direction) :
  1. **Grilles de compétences** : l'encadrant technique note la montée en compétences au poste dans l'onglet « Compétences » (référentiel par filière administrable) ; triple validation salarié/ETI/CIP.
  2. **Diagnostic enrichi** : portefeuille de compétences, analyse AFOM et style d'apprentissage sont désormais des étapes du diagnostic (co-construction avec le salarié).
  3. **Période d'essai** : un entretien de période d'essai est posé automatiquement à la liaison recrutement ; la décision « rompue » clôt le parcours.
  4. **Check-list d'embauche** : suivi des pièces des premiers jours dans l'onglet Synthèse, pré-cochée des documents remis au recrutement.

---

*Rapport établi le 23 juillet 2026. Documentation mise à jour en parallèle : `docs/GUIDE_CIP_INSERTION.md` (5 nouveaux pas-à-pas, « phase 2 » ramenée au seul volet RSEi), `docs/NOTE_CERTIFICATEURS_INSERTION.md` (espace encadrant technique = preuve de co-construction, §7 point 4 reclassé « livré »), `docs/REFERENTIEL_PERFORMANCE_CIP.md` (indicateur complémentaire C6 « progression des compétences »), `docs/DOCUMENTATION_APPLICATIVE.md` §2.3.4, CLAUDE.md §5/§6/§12.*
