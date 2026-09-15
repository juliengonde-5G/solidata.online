# Reconnaissance — documentation et reporting institutionnel du module Insertion (état au 12/09/2026)

> Agent de reconnaissance (lecture seule).

## Résumé exécutif
- Trois documents institutionnels (`docs/GUIDE_CIP_INSERTION.md`, `docs/NOTE_CERTIFICATEURS_INSERTION.md`, `docs/REFERENTIEL_PERFORMANCE_CIP.md`) font des **promesses aux organismes de contrôle** dont plusieurs ne sont pas tenues par le code : journalisation de TOUS les exports nominatifs (seul le tableau des freins l'est ; **FSE+ et Excel complet ne le sont pas**), durée des entretiens et agrégat d'heures d'accompagnement (aucune colonne de durée sur les entretiens, `duree_minutes` des actions jamais agrégé), **échelle des freins inversée** dans deux documents (docs : 1 = bloquant / code : 5 = bloquant), RSEi annoncé « séparé » alors que le module 28 est livré, AIPD et consultation CSE non tracées.
- **Reporting existant** : FSE+ trimestriel 24 colonnes (**requête d'heures suspecte sur `work_hours.start_time/end_time`, colonnes inexistantes → 0 ligne silencieusement**), tableau des freins 23/24 colonnes (journalisé, complétude), synthèse COPIL, Excel 4 feuilles, indicateurs conventionnels (dénominateur = bilans de sortie classés de l'année civile), ETP conventionnés + ASP (fait foi, 1 820 h), KPI Métropole (1 607 h), Reporting RH (calcul legacy `parcours_termines/total` **contradictoire** avec la nomenclature).
- **Éligibilité IAE = deux champs texte libre** ; BRSA/AAH uniquement via `ressources TEXT[]` déclaratives du diagnostic ; la seule source BRSA fiable est l'état ASP importé.
- **`employee_week_hours`** (heures réelles hebdo importées de la paie : `hours_worked`, `hours_expected`, `hours_contract`, `hours_absence`) **existe et n'est lue par rien** — c'est la brique naturelle du suivi 15-20 h.
- Exigences restées ouvertes du chantier de juillet : EXG-13 (entretien professionnel L.6315-1), EXG-19 (stats par partenaire), EXG-31 (vue salarié « Mon parcours »), REC-UX-11/13/15/16/18, EXG-47 (cibles : annexe 2 jamais fournie), trame CVG jamais fournie, EXG-49 AIPD, RES-12 CSE ; PCM : 5 arbitrages + 5 recommandations P4 (dont +35 points d'orientation métier par le PCM, rattachement par homonymie D21).

## 1. Documents institutionnels
### 1.1 `GUIDE_CIP_INSERTION.md` — 19 cas d'usage
Lundi matin (alertes 3 couleurs, ack partagé) · nouveau salarié (import de paie uniquement, liaison recrutement) · diagnostic 12 rubriques · portefeuille/Kolb · check-list 7 étapes · période d'essai · compétences ETI · préparation IA J-7 · bilan / action / renouvellement (dérogation > 24 mois) · PMSMP · sortie (4 catégories, STC/certificat/attestation FT, satisfaction, post-sortie +3 mois) · Pass IAE (J-7 mois / J-2 mois) · tableaux/exports · documents remis (2 gabarits) · FAQ + lexique · RSEi « séparé » (périmé).
### 1.2 `NOTE_CERTIFICATEURS_INSERTION.md` — destinataires DDETS 76, CD76, Convergence, labellisateur RSEi
Liste de contrôle « jour J » 22 lignes. Promesses : reconstitution sur pièces ; auteur + horodatage ; verrou/historique ; co-construction (validation compte + PDF remis + scan signé) ; **chaque export nominatif journalisé** ; nomenclature ASP/DREETS + note de bascule 2026 ; « objectif non paramétré » ; SOLIDATA prépare et contrôle, ne se substitue à aucune saisie officielle (ASP, emplois de l'inclusion, Immersion Facilitée) ; rapprochement mensuel ERP↔ASP ; NIR/IBAN/CAF exclus ; AES-256 santé/judiciaire ; conservation 2 ans puis anonymisation, FSE+ ≥ 5 ans ; IA préparatoire pseudonymisée ; mise en production conditionnée à AIPD + registre + CSE + tests + note d'information.
### 1.3 `REFERENTIEL_PERFORMANCE_CIP.md` — 19 indicateurs, 4 familles (A couverture réglementaire, B intensité dont **B5 volume d'heures d'accompagnement**, C qualité des parcours, D charge). 0,86 ETP CIP pour ~46 salariés.

## 2. Chantier `rapports/insertion-2026-07-22/`
48+1 EXG (O/A/S), 12 PROP, 19 REC-UX, 12 RES. Livré : PR1 v2.10.0, PR2 v2.11.0, lot 8 v2.12.0.
**Ouvert (vérifié dans le code)** : EXG-13 (0 occurrence `6315`), EXG-31 vue salarié, EXG-49/RES-01 AIPD, RES-12 CSE, RES-04 agrégat d'heures (pas de durée sur `insertion_milestones`), REC-UX-18 rythme par salarié (seul `insertion.rythme_bilans_mois` global), EXG-19 stats par partenaire, REC-UX-11/13/15/16, cibles conventionnelles (annexe 2 manquante), trame CVG (`cvg.statut = 'trame_en_attente'`), k-anonymat judiciaire, cloisonnement par atelier, doublon `periode_essai`, copies d'écran du guide.

## 3. Chantier `rapports/pcm-insertion-2026-08-29/` — non tranchés
Passation PCM après l'embauche (tranché **contre** en 2.45.0 avec 3 contreparties) ; indicateur « risque » (affichage assaini, calcul conservé) ; MFA FINANCE ; AIPD ; marques PCM/Kahler ; R12 bloc PCM structuré Base+Phase dans la fiche insertion ; R13 Phase dans `engine.js` ; R14 fusion `PCM_TYPES`/`PCM_KNOWLEDGE` ; R15 repassation ; **R16 +35 points d'orientation métier** ; D21 rattachement PCM par homonymie ; D22 deux vérités `has_pcm`.

## 4. Documentation applicative
`DOCUMENTATION_APPLICATIVE.md` §2.3.4 à jour. **`GUIDE_UTILISATEUR.md` §4.4 obsolète** (7 freins, jalons M1/M6/M12, échelle inversée, numéro 4.4 dupliqué). `CLAUDE.md` §9 « jalons M1/M6/M12, 7 freins » obsolète ; module 5 dit « 5 types » (6 depuis lot 8) ; RSEi/module 28 livré mais docs insertion le disent « séparé ».

## 5. Reporting existant — inventaire exact
### 5.1 Export FSE+ (`exports.js:351-483`, ADMIN/RH, CSV `;` BOM, 5 lignes méta)
Population : `contract_type='CDDI'` chevauchant le trimestre OU `insertion_start_date` antérieure. **24 colonnes** : ID · Civilité · Genre · Prénom · Nom · Type contrat · Début contrat · Fin contrat · Statut insertion · Début parcours · Fin parcours · Prescripteur (organisme) · Prescripteur (type) · Date prescription · **Heures travaillées (trimestre)** (⚠ `SUM(EXTRACT(EPOCH FROM (end_time - start_time))/3600)` sur `work_hours` qui n'a pas ces colonnes → `.catch(() => ({rows:[]}))` → 0 silencieux) · Sortie type · Classification · Sortie dynamique · Catégorie · SIRET employeur sortie · Durée contrat sortie · Date sortie · FSE+ entrée (JSON) · FSE+ sortie (JSON). **Non journalisé.** Questionnaire entrée : `statut_avant_entree`, `duree_sans_emploi`, `foyer_monoparental`, `sans_domicile_stable`, `commentaire`.
### 5.2 Tableau des freins 23 col. (`exports.js:660-870`, `utils/insertion-freins-export.js`, ADMIN/RH)
NOM · Prénom · Nationalité · Date d'entrée ACI · Fin PASS IAE · Heures par semaine · Genre · Date de naissance · RQTH · Niveau de formation · Ressources · Logement · Commune · Situation familiale · Frein linguistique · santé · logement · administratif · financier · [judiciaire si `sensibles=1`] · mobilité · PMSMP · Projet de formation · Emploi visé. Freins = dernière évaluation (LATERAL sur dernier entretien réalisé, repli axe par axe sur le diagnostic). Journal RGPD avant envoi ; complétude par colonne.
### 5.3 Synthèse COPIL (`/exports/insertion-synthese`, A/RH/M, non nominative) : général, ETP contrôle, typologies, entretiens, freins, sorties (+méthode), PMSMP, satisfaction, actions.
### 5.4 Excel complet (`/exports/insertion`, ADMIN/RH) : Informations + Salariés / Diagnostics CIP / Jalons / Plans d'action — **non journalisé** bien que nominatif avec freins.
### 5.5 Indicateurs conventionnels (`gatherAuditKpis`) : dénominateur = `bilan_sortie` réalisés classés, `completed_date` dans l'année civile ; `taux_dynamiques`, `taux_par_classification` ; définitions : emploi durable = CDI, CDD/intérim ≥ 6 mois, création ; transition = CDD/intérim < 6 mois, contrat aidé ; positive = formation qualifiante, autre SIAE ; autre. `sortie_type` réels : CDI, CDD, CDD_court, formation, creation_activite. Cibles `insertion.cible_*` nullables.
### 5.6 ETP + ASP (`effectifs.js`, `effectifs-engine.js`) : semaine ISO au mois du jeudi ; quotité = h/35 ; renouvellement présumé borné ; réalisé = prévisionnel × (1 − absences/5) ; ASP fait foi (journalisé en transaction) ; `effectifs.convention_<annee>`.
### 5.7 KPI Métropole (`metropole.js`, + AUTORITE) : `kpi-insertion` (ETP 1 607 h, formation, absentéisme, en parcours), `sortie-dynamique` (aligné nomenclature).
### 5.8 Reporting RH (`ReportingRH.jsx`) : `sortiesPositives = parcours_termines/total` — **contradictoire**.
### 5.9 Journalisation RGPD des exports : freins OUI ; FSE+ **NON** ; Excel complet **NON** ; ASP validation OUI.
### 5.10 Trois bases ETP : 35 h/sem (audit insertion), 1 607 h (RH, Métropole), 1 820 h (ASP).

## 6. Prescripteur / éligibilité
`prescripteur_orgas` 8 types ; `employees.prescripteur_id` + `date_prescription` + texte libre ; `cip_referent_user_id` ; `insertion_partenaires` 16 seedés. **Éligibilité = `eligibilite_criteres TEXT`** ; 0 occurrence QPV/ZRR/DELD/ASS/réfugié/senior comme critère ; `ressources TEXT[]` (RSA, APL, AF, CF, ASF, AAH, ARE, prime_activite, aucune — pas d'ASS) ; `rqth` ; `cddi_derogation_motif` (seul « senior_50 » contrôlé) ; tranches d'âge via `ageBracket` ; `fse_entree.duree_sans_emploi` = proxy DELD déclaratif ; `employees.city` sans croisement QPV.

## 7. Heures d'activité
| Objet | Colonne | Alimentation | Exposition |
|---|---|---|---|
| Quotité contractuelle | `employee_contracts.weekly_hours` (CHECK 0-48) / `employees.weekly_hours` | import paie | col. 6 export CDC, ETP |
| Heures journalières | `work_hours(date, hours_worked, overtime_hours, type)` | saisie RH | KPI RH/Métropole |
| **Heures hebdo réelles** | **`employee_week_hours`** (`iso_year, iso_week, hours_worked, hours_expected, hours_contract, hours_absence, hs_*`) | **import paie seul** (`collaborator-import.js:1070`) | **AUCUNE** |
| Absences | `employee_leaves` | import paie | moteur Effectifs |
| Badgeuse | module 33 (n'écrit ni `work_hours` ni `employee_week_hours`) | RFID | feuilles de temps, exports paie/IAE |
Manques : aucun seuil 15/20 h, aucun croisement BRSA × heures, quotité contractuelle ≠ activité constatée.

## 8. `CLAUDE.md` — vocabulaire §9 partiellement obsolète (7 freins, M1/M6/M12) ; module 28 Pilotage RSE livré et consolide `gatherAuditKpis`.

## 9. Écarts promis / livré (priorité)
1. Journalisation de tous les exports nominatifs (FSE+, Excel) — EXG-43.
2. Durée des entretiens + agrégat d'heures d'accompagnement — RES-04, B5.
3. **Échelle des freins inversée** dans le guide CIP et le guide utilisateur.
4. RSEi « séparé » alors que livré.
5. AIPD / CSE non tracés.
6. Rapprochement ASP livré côté Effectifs mais non relié à la synthèse COPIL.
7. CLAUDE.md §9 et GUIDE_UTILISATEUR §4.4 obsolètes.
8. Copies d'écran absentes.
9. « 5 types » → 6.
