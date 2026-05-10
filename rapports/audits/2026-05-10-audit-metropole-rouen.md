# Audit Métropole Rouen Normandie — collecte et emploi

> 📌 **Mise à jour 2026-05-10 (post-sprints P0/P1/P2)** : couverture passée de 60 % à **88 %**. Référentiel INSEE des 71 communes Métropole disponible via API, KPI taux de sortie dynamique exposés, motif de non-collecte tracé, mix valorisation CO2 observé. Voir `2026-05-10-audit-suivi-sprints.md`.

**Date** : 2026-05-10
**Auditeur** : Métropole Rouen Normandie — service Économie circulaire et Insertion
**Périmètre** : Solidarité Textiles — collecte territoire métropole + structure d'insertion par l'activité économique (SIAE)
**Objectif** : vérifier que `solidata.online` permet de **documenter et justifier l'ensemble des informations relatives à la collecte textile et à l'emploi/insertion** sur le territoire de la Métropole (71 communes, ~700 000 habitants).

---

## 1. Synthèse exécutive

| Bloc | Couverture | Niveau de risque |
|---|---|---|
| Reporting collecte (volume, géo, fréquence) | 70 % | MOYEN |
| Mesure du détournement / valorisation | 50 % | **ÉLEVÉ** |
| Référentiel EPCI / communes / INSEE | 30 % | **ÉLEVÉ** |
| Parcours d'insertion (M1/M3/M6/M10/sortie) | 90 % | FAIBLE |
| Emploi (CDDI, heures, formation, absentéisme) | 70 % | MOYEN |
| Taux de sortie dynamique vs fin de contrat | 60 % | MOYEN |

**Verdict global** : la base technique est solide (modules collecte, insertion, RH fonctionnels). **Deux blocages principaux** :
1. **Référentiel territorial EPCI manquant** : les CAV sont rattachés à une commune en texte libre, sans code INSEE ni regroupement EPCI. Le reporting territorial agrégé est donc fragile.
2. **KPIs de sortie d'insertion incomplets** : les données existent (`milestones.sortie_classification`, `sortie_type`) mais ne sont pas agrégées en taux de sortie dynamique sur la page reporting.

---

## 2. Périmètre du contrôle

La Métropole subventionne et conventionne la SIAE sur deux axes :

- **Axe environnemental** : tonnages textiles collectés, taux de captation par habitant (objectif Refashion : 3,6 kg/hab/an), taux de valorisation, CO₂ évité.
- **Axe social** : nombre de CDDI en parcours, durée moyenne du parcours, taux de sortie dynamique (emploi durable / formation qualifiante), accompagnement levée des freins périphériques.

Le présent rapport couvre les deux axes et identifie les pièces que la Métropole peut exiger lors d'une revue annuelle de convention.

---

## 3. Cartographie des données — Axe environnemental

### 3.1 Collecte — passages CAV et tonnages

- Tables clés : `tours`, `tour_cav`, `tour_weights`, `cav`, `vehicles`, `gps_positions`, `tonnage_history`, `incidents`.
- Routes API : `/api/tours`, `/api/cav`, `/api/metropole/dashboard`, `/api/metropole/cav`, `/api/reporting/dashboard`.
- Page UI : `/reporting-metropole` (Carte CAV + histogramme + KPIs CO₂).
- Fichier backend : `backend/src/routes/metropole.js`.

Par tournée, le système trace :
- la date, le véhicule, le chauffeur (`tours.driver_employee_id`),
- le poids total collecté (`tours.total_weight_kg`),
- la liste des CAV planifiés et le statut de chaque passage (`tour_cav.status` ∈ `planned/collected/skipped`),
- le niveau de remplissage observé (`tour_cav.fill_level` 0-5),
- les incidents (`incidents.type` ∈ `cav_problem/breakdown/accident`),
- la trace GPS (`gps_positions`, 10 s par défaut).

✅ **Conforme** pour la traçabilité opérationnelle.

⚠️ **Gaps** :
- **Pas de motif de non-collecte** (CAV bouchée, fermée, accès impossible, propriétaire absent) → information remontée seulement via `notes` libres.
- **Pas de taux de service mensuel** par CAV exposé en KPI (% CAV collectés vs total actifs par mois).
- **Fréquence théorique** vs **fréquence réelle** par CAV non comparée — donnée présente dans `tour_cav.fill_level` mais pas agrégée.

### 3.2 Référentiel territorial

- `cav.commune` : VARCHAR texte libre, saisi manuellement.
- `cav.population_commune` : INTEGER optionnel, pour le calcul kg/hab/an.
- `cav.communaute_communes` : VARCHAR (v1.4.2), inutilisé pour l'instant côté reporting.
- `cav.geom` : géométrie PostGIS (point + index GiST).
- Table `refashion_communes` : agrégation trimestrielle par commune en texte libre.

🚩 **Pas de référentiel INSEE** :
- pas de `cav.code_insee_commune` (5 chiffres),
- pas de table `epci_communes` qui rattacherait chaque commune à son EPCI officiel,
- la Métropole Rouen Normandie est composée de 71 communes — l'agrégation par EPCI demande un mapping manuel à chaque fois.

**Action requise** : créer une table `referentiel_communes (code_insee, nom, code_postal, epci_code, epci_nom, population_inseelet)` alimentée depuis le fichier officiel INSEE COG, et faire pointer `cav.code_insee` vers cette table.

### 3.3 Indicateurs environnementaux exposés

Le dashboard `/reporting-metropole` calcule :
- **Volume collecté mensuel** (somme `tour_weights.weight_kg`)
- **Taux de captation** (kg/hab/an) avec objectif Refashion 3,6 kg/hab/an
- **CO₂ évité** : formule `metropole.js:32-40` avec mix valorisation moyen (40 % réemploi, 35 % recyclage, 15 % chiffons, 10 % CSR) et facteurs ADEME hardcodés (réemploi 3,169 / CSR 0,121 / recyclage 0,5-0,75 t CO₂/t).
- **Carte CAV interactive** (Leaflet) avec prédiction de remplissage J-15 à J+15 (`ml_fill_predictions`).
- **Historique 12 mois glissants**.

⚠️ **Limites** :
- Le **mix de valorisation est hardcodé** : la SIAE ne peut pas remonter le mix réel observé (qui peut varier selon la saison ou la matière entrante).
- Le **bilan détourné** (matière qui ne va pas en ordures ménagères) est calculé par déduction (collecte − vente original = détourné) et pas par sommation des flux valorisés réels.
- Pas de **décomposition par filière** au reporting Métropole (réemploi détaillé / recyclage par matière / CSR / refus).

### 3.4 Lien collecte ↔ valorisation

Le détail des sorties valorisées est dans le module **Refashion** (cf. rapport `2026-05-10-audit-refashion.md`). La Métropole peut consommer indirectement les mêmes données :

| KPI Métropole | Source | Statut |
|---|---|---|
| Tonnage collecté année N | `SUM(tour_weights.weight_kg) WHERE year=N` | ✅ |
| Tonnage détourné des ordures ménagères | À calculer (`stock_original_movements`) | Indirect |
| Taux de captation par habitant par commune | `tour_cav` + `cav.commune` + `cav.population_commune` | ⚠️ pas exposé en UI |
| Taux de valorisation matière | À calculer (`colisages` + `categories_sortantes`) | ⚠️ pas exposé en UI |
| Émissions CO₂ évitées | `/api/metropole/dashboard` | ✅ |

---

## 4. Cartographie des données — Axe social

### 4.1 Insertion — parcours et jalons

- Table `insertion_diagnostics` : 46 colonnes (freins 1-7 sur 5 niveaux, questionnaire CIP, PCM, Explorama).
- Table `insertion_milestones` : jalons M+0, M+3, M+6, M+10, Sortie avec `statut` (`a_planifier/planifie/realise/reporte`), scores freins, avis global, classification sortie.
- Table `cip_action_plans` : plans d'action par jalon, 4 statuts, 3 priorités.
- Champ `employees.insertion_status` ∈ `en_parcours/sorti/rupture`.
- Champ `employees.insertion_start_date` : date d'entrée en parcours.
- Route `/api/insertion/*`, page `/insertion-parcours`.

✅ **Conforme** — couverture exhaustive du parcours réglementaire SIAE (CDDI max 24 mois, jalons IAE M+1/M+6/M+12 alignés).

Les **7 freins périphériques** suivis (typologie CIP) :
1. Mobilité
2. Santé
3. Finances
4. Famille
5. Linguistique
6. Administratif
7. Numérique

Chaque jalon enregistre un score 0-5 par frein → radar d'évolution disponible dans la page parcours.

### 4.2 Sortie d'insertion

La sortie est tracée dans `insertion_milestones` :
- `sortie_classification` ∈ `positive/negative`
- `sortie_type` ∈ `CDI / CDD / formation / création / IAE / abandon / fin`

**Définition Métropole / DREETS** d'une sortie dynamique : `sortie_type` ∈ {`CDI`, `CDD>6 mois`, `formation qualifiante`, `création d'entreprise`}.

⚠️ **Gaps** :
- Le **taux de sortie dynamique** n'est pas exposé en KPI agrégé. Il faut le construire à la requête.
- Pas de distinction `CDD<6 mois` vs `CDD>6 mois` dans `sortie_type` → réduit la précision du taux dynamique conforme à la grille IAE.
- Pas de tracking de la **destination employeur** (nom + SIRET) après sortie → conforme à la simple grille DREETS mais insuffisant pour un suivi qualitatif post-sortie demandé par certaines conventions.

### 4.3 Emploi — CDDI, heures, contrats

- Table `employees` + `employee_contracts` (`contract_type`, `start_date`, `end_date`, `is_current`).
- Table `work_hours` (`hours_worked`, `overtime_hours`, `type` ∈ `normal/training/absence/sick/holiday`, `validated_by`).
- Table `teams` (filières : `tri`, `collecte`, `logistique`, `btq_st_sever`, `btq_lhopital`, `administration`).

Couverture :
- Heures travaillées normales et supplémentaires.
- Heures de formation (`type='training'`) — non agrégées en UI.
- Absences (`type='absence'/'sick'/'holiday'`).
- Validation par responsable (`validated_by`).

⚠️ **Gaps** :
- **Pas de calcul automatique** de l'ETP (équivalent temps plein) annuel par salarié.
- **Pas de KPI** « heures de formation par salarié / an » exposé.
- **Pas de KPI** absentéisme par équipe / par mois.
- **Durée moyenne du parcours** (M+0 → sortie) calculable mais non exposée.

---

## 5. Requêtes prêtes pour la Métropole

### Tonnage collecté par commune — année courante
```sql
SELECT c.commune,
       SUM(tw.weight_kg)/1000.0 AS tonnage_t,
       COUNT(DISTINCT t.id) AS nb_tournees,
       AVG(c.population_commune) AS pop,
       ROUND((SUM(tw.weight_kg)/1000.0) / NULLIF(AVG(c.population_commune),0) * 1000.0, 3) AS kg_par_hab
FROM tours t
JOIN tour_weights tw ON tw.tour_id = t.id
JOIN tour_cav tc ON tc.tour_id = t.id
JOIN cav c ON tc.cav_id = c.id
WHERE EXTRACT(YEAR FROM t.date) = 2026
  AND tc.status = 'collected'
GROUP BY c.commune
ORDER BY tonnage_t DESC;
```

### Taux de service CAV — mois courant
```sql
SELECT EXTRACT(MONTH FROM t.date) AS mois,
       COUNT(*) FILTER (WHERE tc.status='collected') AS collectes,
       COUNT(*) FILTER (WHERE tc.status='skipped')   AS sautes,
       ROUND(100.0 * COUNT(*) FILTER (WHERE tc.status='collected')::numeric
             / NULLIF(COUNT(*), 0), 1) AS taux_service_pct
FROM tours t JOIN tour_cav tc ON tc.tour_id = t.id
WHERE EXTRACT(YEAR FROM t.date) = 2026
GROUP BY mois ORDER BY mois;
```

### Parcours en cours et leur ancienneté
```sql
SELECT e.first_name || ' ' || e.last_name AS nom,
       e.insertion_start_date,
       AGE(CURRENT_DATE, e.insertion_start_date) AS anciennete,
       e.insertion_status,
       t.name AS equipe
FROM employees e LEFT JOIN teams t ON e.team_id = t.id
WHERE e.insertion_status = 'en_parcours'
ORDER BY e.insertion_start_date;
```

### Taux de sortie dynamique — année courante
```sql
WITH sorties AS (
  SELECT im.employee_id, im.sortie_type, im.sortie_classification, im.date_realisation
  FROM insertion_milestones im
  WHERE im.type = 'sortie'
    AND im.statut = 'realise'
    AND EXTRACT(YEAR FROM im.date_realisation) = 2026
)
SELECT COUNT(*) AS total_sorties,
       COUNT(*) FILTER (WHERE sortie_type IN ('CDI','CDD','formation','creation')) AS dynamiques,
       ROUND(100.0 * COUNT(*) FILTER (WHERE sortie_type IN ('CDI','CDD','formation','creation'))::numeric
             / NULLIF(COUNT(*), 0), 1) AS taux_dynamique_pct
FROM sorties;
```

### Heures de formation par salarié — année
```sql
SELECT e.first_name || ' ' || e.last_name AS nom,
       SUM(wh.hours_worked) AS heures_formation
FROM work_hours wh
JOIN employees e ON wh.employee_id = e.id
WHERE wh.type = 'training'
  AND EXTRACT(YEAR FROM wh.date) = 2026
GROUP BY e.id, nom
ORDER BY heures_formation DESC;
```

### Absentéisme par équipe — mois courant
```sql
SELECT t.name AS equipe,
       SUM(CASE WHEN wh.type IN ('absence','sick') THEN wh.hours_worked ELSE 0 END) AS h_absences,
       SUM(wh.hours_worked) AS h_total,
       ROUND(100.0 * SUM(CASE WHEN wh.type IN ('absence','sick') THEN wh.hours_worked ELSE 0 END)::numeric
             / NULLIF(SUM(wh.hours_worked), 0), 1) AS taux_absenteisme_pct
FROM work_hours wh
JOIN employees e ON wh.employee_id = e.id
JOIN teams t ON e.team_id = t.id
WHERE EXTRACT(YEAR FROM wh.date) = 2026
  AND EXTRACT(MONTH FROM wh.date) = EXTRACT(MONTH FROM CURRENT_DATE)
GROUP BY t.name
ORDER BY taux_absenteisme_pct DESC;
```

---

## 6. Plan d'action recommandé

| Priorité | Action | Effort | Impact |
|---|---|---|---|
| **P0** | Créer `referentiel_communes` (INSEE COG) + `cav.code_insee_commune` FK | 0,5 j | Reporting territorial fiable |
| **P0** | Exposer en page `/reporting-metropole` : taux de sortie dynamique, taux de service CAV, kg/hab/commune | 1 j | Pièce de convention |
| **P1** | Ajouter motif de non-collecte (`tour_cav.skip_reason` enum) | 0,3 j | Diagnostic CAV |
| **P1** | KPI heures formation / ETP / absentéisme dans `/reporting-rh` | 0,5 j | Pièce DREETS |
| **P2** | Distinction `CDD<6 mois` vs `CDD>6 mois` dans `sortie_type` | 0,2 j | Précision DREETS |
| **P2** | Tracking destination employeur post-sortie | 0,5 j | Suivi qualitatif |
| **P2** | Mix valorisation observé (vs hardcodé) pour CO₂ évité | 0,5 j | Précision bilan |

**Total** : ~3,5 j d'effort pour atteindre une couverture audit-ready de **90 %**.

---

## 7. Documents à fournir à la Métropole

1. **Bilan annuel collecte** : tonnage par commune, taux de captation, CO₂ évité, fréquence de service par CAV.
2. **Bilan d'insertion** : nb de parcours, taux de sortie dynamique, répartition par filière et par type de sortie.
3. **Bilan emploi** : ETP CDDI, ETP encadrement, heures de formation, taux d'absentéisme.
4. **Liste des CAV** avec géolocalisation, propriétaire, dates d'installation.
5. **Historique mensuel 24 mois** (déjà calculable depuis `tonnage_history`).
6. **Audit RGPD** : consentements collectés, audit log accès aux données salariés (déjà couvert par `rgpd_audit_log`).

---

## 8. Annexe — références techniques

**Routes backend** : `backend/src/routes/metropole.js`, `tours.js`, `cav.js`, `insertion/routes.js`, `employees.js`, `work-hours.js`, `reporting.js`.

**Pages frontend** : `ReportingMetropole.jsx`, `ReportingCollecte.jsx`, `ReportingRH.jsx`, `InsertionParcours.jsx`, `Employees.jsx`, `WorkHours.jsx`, `Tours.jsx`, `FillRateMap.jsx`.

**Tables principales** : `tours`, `tour_cav`, `tour_weights`, `cav`, `tonnage_history`, `gps_positions`, `incidents`, `employees`, `employee_contracts`, `work_hours`, `teams`, `insertion_diagnostics`, `insertion_milestones`, `cip_action_plans`.

**Documentation existante** : `docs/LOGIQUE_TOURNEES.md`, `docs/FORMATION_MANAGER_COLLECTE_LOGISTIQUE.md`, `docs/FORMATION_MANAGER_RH_INSERTION.md`.
