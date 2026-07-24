# Réalisation — PR 2 « Extension du module Insertion » (étapes 4-8)

- **Date** : 23 juillet 2026 — rapport de réalisation et de vérification transversale
- **Périmètre** : PR 2 de 3 du plan de codage (`05-plan-codage.md` §6 : étapes 4-8 + addendum §6bis), sur le socle **PR 1 v2.10.0** (`12-realisation-pr1.md`) — conformité IAE opérationnelle, frise et fiche unifiée, tableau de bord et exports conventionnels, assistance IA par entretien, documentation finalisée
- **Version** : 2.11.0 (entrée CLAUDE.md §12 du 23 juillet 2026)

---

## 1. Vérification finale

| Contrôle | Après PR 1 (v2.10.0) | Après PR 2 (v2.11.0) |
|---|---|---|
| Jest backend | 756/756 (60 suites) | **818/818 verts, 62 suites** (+62 : contrats PMSMP/satisfaction/renouvellement/cibles/export-freins + règles de bornes PMSMP + valorisation « dernière évaluation ») |
| Build frontend | Vite OK | **Vite OK** (chunks lazy `RenouvellementETI`, `AdminInsertion`, composants `PmsmpPanel`/`SatisfactionForm`/`FriseParcours`) |
| Mobile Vitest | 40/40 | **40/40** (aucun fichier mobile touché — module web uniquement, non-régression confirmée) |
| Base neuve | re-prouvée en PR 1 | **re-prouvée sur PostgreSQL 16 réel** (double `init-db.js` idempotent ; PR 2 n'ajoute **aucune nouvelle table** — le schéma a été intégralement posé en PR 1 phase A) |

Le smoke test de déploiement (`scripts/tests/api-smoke.js`, hooké dans `deploy.sh update`) a été étendu aux nouvelles routes critiques (renouvellements, pmsmp, satisfaction-stats, cibles, exports/insertion-freins).

---

## 2. Livré lot par lot (étapes 4-7)

### Lot 4 — Conformité IAE (Pass IAE, PMSMP, renouvellement, sortie, post-sortie, satisfaction)

- **PMSMP opérationnelle** (EXG-05) : `GET /pmsmp/:employeeId`, `POST/PUT/DELETE /pmsmp` (ADMIN/RH) sur la table `insertion_pmsmp` (créée en PR 1) ; module de règles dédié **`pmsmp-rules.js`** — bornes légales **≤ 31 j par convention**, cumul **≤ 60 j sur 12 mois glissants apprécié par organisme d'accueil (SIRET)**, **≤ 2 conventions** avec un même accueil pour des objets différents → **refus 409 documenté** citant la règle enfreinte ; objet légal contrôlé (`decouvrir_metier`/`confirmer_projet`/`initier_recrutement`), case `saisie_outil_officiel` (Immersion Facilitée, art. 3.3). Front : `components/insertion/PmsmpPanel.jsx` (onglet Parcours).
- **Satisfaction de sortie** (EXG-14/qualité) : `POST /satisfaction/:employeeId` + `GET /satisfaction/:employeeId` (ADMIN/RH) sur `insertion_satisfaction_sortie` (unicité par parcours) ; **`GET /satisfaction-stats?year=`** — agrégats **non nominatifs** (moyennes par thème, taux de réponse). Front : `SatisfactionForm.jsx` relié au bilan de sortie.
- **Renouvellements CDDI** (REC-UX-06, bloquant PR 2) : `GET /renouvellements` (fins de contrat < 6 semaines + état du formulaire), `PUT /renouvellements/:milestoneId/formulaire` ; **écran encadrant dédié** `RenouvellementETI.jsx` (`/insertion/renouvellement/:milestoneId`, ADMIN/RH/MANAGER) accessible par **lien direct copiable** depuis la ligne du salarié (bouton « Copier le lien ») — « 1 écran = 1 salarié », trame assiduité/motivation/autonomie/participation/projet/motifs en boutons + avis (favorable/avec réserves/défavorable) + durée proposée (2/4/6 mois) + « Transmettre à la CIP » ; **triple validation** encadrant/CIP/directeur horodatée par compte (`validations` JSONB) ; badge cumul CDDI 22/24 + motif de dérogation exigé au-delà.
- **Bilan de prolongation Pass IAE** (EXG-02) : `GET /pass-iae/bilan/:employeeId` (ADMIN/RH) — PDF assemblé depuis les bilans déjà saisis (synthèse parcours + évolution des freins + actions), support pour le prescripteur habilité ; la demande elle-même reste sur la plateforme des emplois de l'inclusion (l'ERP prépare la pièce).
- **Sortie / post-sortie** : la clôture de sortie (catégorie 4 nomenclatures + check-list documents) et la planification automatique du suivi post-sortie à +3 mois, posées en PR 1, sont désormais complétées côté saisie de la **situation constatée** et reliées à la satisfaction et aux stats.

### Lot 5 — Frise + fiche unifiée

- **`FriseParcours.jsx`** (REC-UX-05) : rendu horizontal en **couloirs superposés** — Contrats (bandeaux), Entretiens (points : plein = réalisé, creux = planifié, couleur par type), Objectifs, PMSMP ; **cases à cocher par couloir** (objectifs masqués par défaut), **regroupement automatique** des événements trop proches (pastille « ×N » dépliable, `CLUSTER_PX`), sur `GET /timeline/:employeeId` enrichi (multi-contrats). La **liste chronologique** verticale reste la vue de référence.

### Lot 6 — Tableau de bord conventionnel + exports

- **Indicateurs conventionnels** en tête de `AuditInsertion.jsx` (« Pilotage & indicateurs », EXG-10/24/47) : **3 taux de sorties par catégorie vs cibles paramétrées**, **ETP réalisés « contrôle ERP »** (étiqueté — la saisie ASP fait foi), **typologies publics** non nominatives, **délai moyen de diagnostic** vs cible, réalisation des jalons par échéance, cartographie 9 freins, satisfaction/post-sortie ; rapport IA direction ; export PDF A4.
- **Cibles conventionnelles** : `GET/PUT /cibles` (ADMIN/RH) — stockées en **`settings`** (`INSERTION_CIBLE_KEYS` : `insertion.cible_etp_conventionnes`, `cible_taux_dynamiques`, `cible_taux_durable`, `cible_taux_transition`, `cible_taux_positive`) ; **doctrine « objectif non paramétré »** : un champ vide efface la cible, la carte l'affiche honnêtement (jamais de valeur inventée). Formulaire éditable dans AuditInsertion.
- **Export 23 colonnes CDC** (EXG-43) : `GET /exports/insertion-freins?format=xlsx|csv&sensibles=0|1` (ADMIN/RH) — colonnes du cahier des charges, **valorisation « dernière évaluation en date »** par `LATERAL` (dernier entretien réalisé avec freins, repli sur le diagnostic), **frein judiciaire exclu par défaut** (`sensibles=0`, EXG-38 ; `sensibles=1` réservé ADMIN/RH et journalisé distinctement `EXPORT_INSERTION_FREINS_SENSIBLE`), **chaque génération journalisée dans `rgpd_audit_log`** avant l'envoi du fichier ; `GET /exports/insertion-freins/completude` (taux de renseigné par colonne, filtres année/statut/CIP).
- **Synthèse comité** (EXG-14) : `GET /exports/insertion-synthese?year=` — agrégée **non nominative** (PDF/CSV). Export FSE+ aligné sur la nomenclature de sorties.

### Lot 7 — Assistance IA + AdminInsertion + transverse RGPD

- **AdminInsertion.jsx** (`/admin/insertion`, ADMIN) : référentiel partenaires, seuils d'alerte, option IA automatique J-7.
- **IA de préparation par entretien** (persistée `ia_preparation`, `?milestoneId=`, pseudonymisation systématique) — socle posé en PR 1, confirmé.
- **Anonymisation étendue aux tables du parcours** (`services/anonymization.js`) : pseudonymisation/purge d'`insertion_objectifs` (titre→placeholder, description→NULL), `insertion_pmsmp` (entreprise→placeholder ; SIRET/tuteur/bilan/convention_ref→NULL ; dates/objet conservés en agrégats), `insertion_satisfaction_sortie` (verbatims→NULL) ; **purge intégrale des snapshots `insertion_milestones_history`** du salarié (revue Codex PR#73 — le RGPD prime sur l'audit interne, les snapshots contenant la ligne complète avant anonymisation) ; **FSE+ (`fse_entree`/`fse_sortie`) volontairement conservé** sur les lignes vivantes (piste d'audit ≥ 5 ans, exclu de l'anonymisation à 2 ans).

### Correctifs de revue Codex de la PR 1 consolidés

- **Freins « non évalué » à NULL honnête** : jamais 1 par défaut, exclus des moyennes et du radar (déjà amorcé PR 1, verrouillé par contrat en PR 2).
- **Purge de l'historique probant** à l'anonymisation (`insertion_milestones_history`, ci-dessus).
- **Bornage par `parcours_num`** des lectures de diagnostic et des freins de cohorte (un parcours = un jeu de données ; `COALESCE(d.parcours_num,1)=COALESCE(e.parcours_num,1)`), pour ne pas mélanger deux parcours d'une même personne.

---

## 3. Exigences couvertes (PR 2)

- **EXG** : 02 (bilan de prolongation Pass IAE PDF — complète le stockage/alertes PR 1), 05 (PMSMP + bornes légales), 08 (post-sortie : saisie situation constatée), 10/24 (tableau de bord conventionnel : taux vs cibles, ETP contrôle, typologies, délai diagnostic), 14 (satisfaction + synthèse comité agrégée), 43 (export 23 colonnes journalisé RGPD, judiciaire exclu par défaut), 47 (cibles conventionnelles paramétrées, « objectif non paramétré ») ; EXG-35→44 complétés (journalisation des exports nominatifs, anonymisation étendue aux nouvelles tables).
- **REC-UX** : 05 (FriseParcours en couloirs + regroupement + couloirs masquables), 06 (écran ETI RenouvellementETI). Renommage des entrées de menu (« Espace CIP (insertion) », « Pilotage & indicateurs ») effectué.
- **RES (rapport 11 § 2)** : RES-03 complété (pièce signée scannée rattachable), RES-04 (agrégats de durée d'accompagnement au tableau de bord).

---

## 4. Vérification adversariale (3 dimensions vertes)

1. **Périmètre honnête** — greps de cohérence : le lot 8 (grilles de compétences ETI, portefeuille de compétences, style d'apprentissage, entretien de période d'essai, check-list d'embauche) est **absent du code** (aucune route, aucune page, aucun composant) et **décrit comme « phase 2 »** dans toute la documentation finalisée ; aucune fonctionnalité phase 2 n'est présentée comme livrée.
2. **RGPD** — masquage par rôle (MANAGER : jamais judiciaire/santé/budget), chiffrement AES-256 des textes sensibles, journalisation `rgpd_audit_log` de chaque export nominatif (dont variante sensible distincte), anonymisation étendue aux tables du parcours + purge de l'historique probant, conservation FSE+ ≥ 5 ans documentée ; matrice d'habilitations couverte par les tests de contrat.
3. **Cohérence** — **0 occurrence** des noms du corpus (BEYECK/SIANGA/PERRIER/DESBOIS/HONORE/FRANCK) et **0 libellé « ODS »** dans le code du module (backend + frontend + tests).

---

## 5. Point d'attention non bloquant

**Moyenne du frein judiciaire en agrégat COPIL.** Les moyennes de freins présentées dans les agrégats de pilotage (`GET /cohorte/stats`, `GET /audit`) incluent l'axe judiciaire **pour les rôles ADMIN/RH** (un MANAGER ne le voit jamais — l'axe est retiré du radar et des restitutions à son niveau). Sur de **très petites cohortes**, une moyenne peut théoriquement approcher un cas individuel (**k-anonymat faible**). La restitution **externe** reste agrégée et non nominative, et le frein judiciaire est **exclu par défaut** des exports. Piste de durcissement (non bloquante) : appliquer un **seuil d'effectif minimal** (k ≥ 5) au calcul des moyennes de l'axe judiciaire, à étudier avec le DPO. Consigné ici et dans la note aux certificateurs (§ 5).

---

## 6. Migrations et preuve

- **Aucune nouvelle table en PR 2** : le schéma (dont `insertion_pmsmp`, `insertion_satisfaction_sortie`, `insertion_milestones_history`, `insertion_alert_acks`) a été intégralement posé en PR 1 phase A. Les cibles conventionnelles sont stockées dans `settings` (clés `insertion.cible_*`), pas dans une table dédiée.
- **Idempotence** re-prouvée : double exécution `init-db.js` verte sur PostgreSQL 16 réel (ordre RECONSTRUCTION.md : init-db → migrate-exutoires → migrate-finance → init-db ×2). L'anonymisation étendue est **résiliente au schéma** (`tableExists`/`existingColumns` avant chaque UPDATE/DELETE) — sûre sur bases anciennes.

---

## 7. Résiduels confirmés — phase 2 (PR 3) et volet séparé

| Résiduel | Statut |
|---|---|
| **Espace ETI — grilles de compétences métier** (évaluation poste par poste : tri/collecte/logistique/boutique) | **Phase 2** — non livré (l'écran de renouvellement encadrant, lui, est livré) |
| **Portefeuille de compétences** du salarié + **auto-évaluation CECRL** structurée | **Phase 2** — au-delà de l'observation linguistique du diagnostic déjà en place |
| **Style d'apprentissage** (repère pédagogique) | **Phase 2** |
| **Entretien de période d'essai** (point à 1 mois formalisé) | **Phase 2** |
| **Check-list d'embauche** (suivi des pièces/étapes des premiers jours) | **Phase 2** |
| **Volet RSE de l'insertion (RSEi)** | **Mission séparée** — hors périmètre de cette extension |
| Seuil d'effectif minimal (k-anonymat) sur la moyenne du frein judiciaire | Amélioration non bloquante (§ 5) |

---

## 8. Consignes de déploiement

- **`bash deploy/scripts/deploy.sh update`** standard (rebuild backend + frontend ; init-db idempotent au restart applique les migrations — rappel : PR 2 n'ajoute aucune table). **Aucun paramétrage requis** : tous les réglages ont des défauts en code.
- **À saisir par la direction quand les documents sont disponibles** (sans quoi les cartes affichent honnêtement « objectif non paramétré ») :
  1. **Cibles conventionnelles** (taux de sorties dynamiques/durable/transition/positive, ETP conventionnés) depuis l'annexe financière de la convention — écran « Paramétrer les cibles » d'AuditInsertion (ADMIN/RH).
  2. **Trame de reporting Convergence (CVG)** : les indicateurs génériques (freins, sorties, actions logement/santé/global) sont déjà couverts ; le paramétrage fin du bloc CVG attend la trame officielle demandée à la direction.
- **Comportements nouveaux à communiquer** (CIP, encadrants, direction) :
  1. **PMSMP** : les immersions se saisissent dans l'ERP avec contrôle automatique des bornes légales (31 j / 60 j par organisme) ; la case « Immersion Facilitée » sera regardée en contrôle.
  2. **Renouvellement** : l'encadrant remplit son volet sur un **écran dédié** ouvert par le lien que la CIP lui envoie (il n'a pas à naviguer dans le module) ; **triple validation** encadrant/CIP/directeur.
  3. **Satisfaction de sortie** : questionnaire proposé au bilan de sortie, restitué uniquement en agrégats anonymes.
  4. **Pilotage & indicateurs** : nouveaux **indicateurs conventionnels** en tête ; l'ETP y est un « contrôle ERP » — la saisie ASP fait foi.
  5. **Export 23 colonnes** : chaque génération est **journalisée** ; le frein judiciaire n'y figure que sur la variante `sensibles=1` (ADMIN/RH). Pour toute transmission externe, utiliser la synthèse **agrégée**.
  6. **Frise du parcours** : nouvelle lecture en couloirs (masquables, regroupement « ×N ») ; la liste chronologique reste disponible.
- **Prérequis hors code (direction/DPO)** : AIPD à finaliser avant l'usage en production des champs art. 9/10 ; note d'information diffusée ; consultation du CSE — inchangés depuis la PR 1.

---

*Rapport établi le 23 juillet 2026. Documentation finalisée en parallèle : `docs/GUIDE_CIP_INSERTION.md`, `docs/NOTE_CERTIFICATEURS_INSERTION.md`, `docs/REFERENTIEL_PERFORMANCE_CIP.md` (brouillons de conception `08`/`09`/`10` conservés pour traçabilité). CLAUDE.md §5/§11/§12 et `docs/DOCUMENTATION_APPLICATIVE.md` §2.3.4 mis à jour.*
