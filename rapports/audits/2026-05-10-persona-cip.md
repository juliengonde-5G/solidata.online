# Persona CIP — Audit opérationnel parcours d'insertion

**Date** : 2026-05-10
**Persona** : Conseillère en Insertion Professionnelle (CIP)
**Périmètre** : 4 axes — recrutement, intégration, suivi parcours, sortie

> ⚠️ **Notes de réconciliation** : ce rapport a été rédigé en exploration et identifie des gaps déjà résolus par les sprints P0/P1/P2 du même jour. Les corrections suivantes s'appliquent :
> - Le gap « SIRET employeur post-sortie » est **résolu (P2-C)** : ALTER `insertion_milestones.sortie_employeur_siret VARCHAR(14)` + champ UI dans `InsertionParcours.jsx`.
> - Le gap « durée contrat (mois) » est **résolu (P2-C)** : ALTER `insertion_milestones.sortie_duree_contrat_mois SMALLINT` + champ UI.
> - Le gap « taux sortie dynamique non exposé » est **résolu (P0-E)** : endpoint `/api/metropole/sortie-dynamique?annee=` + carte KPI dans `/reporting-metropole`.
> - La distinction CDD<6 / CDD>6 mois existe déjà dans `sortie_type` (valeurs `CDD` et `CDD_court` dans le `<select>`).
>
> Le score **Axe 4 — Sortie** passe de 70 % à **~95 %** post-réconciliation.

## Synthèse exécutive

| Axe | Couverture | Friction quotidienne |
|---|---|---|
| **Axe 1 — Recrutement** | 85 % | Faible |
| **Axe 2 — Intégration** | 90 % | Faible |
| **Axe 3 — Suivi du parcours** | 95 % | Très faible |
| **Axe 4 — Sortie** | 95 % (post-P2) | Faible |

**Verdict** : application **très fonctionnelle pour insertion**. L'Axe 3 (suivi de parcours) est le point fort avec radar 7 freins + jalons obligatoires + plans d'action IA.

## Axe 1 — Recrutement

**Pages & endpoints** : `Candidates.jsx` (Kanban 4 colonnes) + `backend/src/routes/candidates/*`. Tables : `candidates`, `recruitment_interviews`, `mise_en_situation`, `recruitment_documents`, `recruitment_plan`, `candidate_skills`, `skill_keywords`.

**Workflow** : Reçus → Entretien (date, lieu, interviewer) → Mise en situation (3 fiches : Collecte/Manutention, Craquage, Qualité, score conforme/faible/recale) → Embauche (conversion auto en `employees` via `POST /candidates/:id/convert-to-employee`).

**Couverture** ✅ : Kanban drag-drop, traçabilité `candidate_history`, intégration PCM (test 20 questions, 6 types), CV parsing keyword-based via `skill_keywords`.

**Gaps** :
- Pas d'alerte rappel planification entretien
- CV parsing par regex (pas IA fine-tunée) → skills métier critiques parfois oubliées
- Pas de formulaire pré-positionnement CIP

## Axe 2 — Intégration (M+1 obligatoire)

**Pages & endpoints** : `InsertionParcours.jsx` (52 KB) + `backend/src/routes/insertion/{routes,engine,index}.js`. Table `insertion_diagnostics` (46 colonnes).

**Workflow** : Liste salariés actifs avec badges urgency (rouge <30j sortie) → fiche parcours → diagnostic M+0 : 7 freins (1-5 + détails + causes), questionnaire CIP 6 questions, observations terrain, Explorama (intérêts/rejets/environnement), plans d'action initiaux.

**Couverture** ✅ : reflet réglementaire complet du livret d'accueil. 46 colonnes structurées.

**Gaps** :
- Pas d'alerte automatique J+15 pour rappel diagnostic obligatoire
- Plans d'action IA-suggérés à valider manuellement (lenteur)

## Axe 3 — Suivi du parcours (M+3/M+6/M+10)

**Pages & endpoints** : `InsertionParcours.jsx` (tab Jalons) + `insertion/engine.js`. Tables `insertion_milestones`, `cip_action_plans`.

**Workflow** : Timeline verticale SVG (5 jalons), pour chaque jalon : status (a_planifier/planifie/realise/reporte), 7 scores freins, 4 sections CIP (intégration, compétences, projet pro, socialisation), bilan pro/social, avis global (très_positif/positif/mitigé/insuffisant). Radar 7 freins en évolution (Diagnostic → Sortie). IA `analyzeInsertion()` propose actions.

**Couverture** ✅✅ : excellent. Couverture complète des jalons réglementaires + IA prédictive.

**Gap mineur** : table `insertion_interview_alerts` existe mais scheduler de rappel J-7/J-1 non documenté.

## Axe 4 — Sortie de la structure

**Pages & endpoints** : `InsertionParcours.jsx` (tab Sortie) + `PUT /api/insertion/milestones/:id`. Table `insertion_milestones.sortie_*`.

**Workflow post-P2-C** :
- À l'approche fin CDDI → urgency badge
- Bilan sortie : `sortie_classification` ∈ {positive/negative}, `sortie_type` (CDI / CDD>6 / CDD<6 / formation / création / autre IAE / abandon / fin contrat), `sortie_employeur` + **SIRET (14 chiffres, P2-C)**, `sortie_formation`, **`sortie_duree_contrat_mois` (P2-C)**, `sortie_commentaires`.
- Archivage : `employees.insertion_status = 'sorti'`.

**KPI exposés post-P0-E** : taux de sortie dynamique annuel sur `/reporting-metropole` (dynamiques = CDI + CDD + formation + création / total sorties).

**Couverture post-réconciliation** : **95 %**.

**Gap résiduel** : tracking employeur post-sortie 60 j (table `sortie_employeur_followup`) non implémenté — utile pour Métropole reporting qualitatif.

## Top 5 améliorations résiduelles

| # | Action | Effort | Priorité |
|---|---|---|---|
| 1 | Cron BullMQ `insertion-milestone-alerts` (J-14, J-7, J-1 sur jalons à planifier) | 1h30 | P1 |
| 2 | Enum strict `sortie_type` (remplace VARCHAR libre) avec radio buttons | 1h | P2 |
| 3 | Table `sortie_employeur_followup` (maintien à 60 j post-sortie) | 2h | P2 |
| 4 | Formulaire pré-diagnostic (KPSI screening) modal avant diagnostic complet | 2h | P3 |
| 5 | Améliorer parsing CV via IA Claude (vs regex actuel) | 4h | P3 |
