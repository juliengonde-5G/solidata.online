# Plan d'action fonctionnel — Extension du module Insertion (historique des entretiens)

- **Date** : 22 juillet 2026 — rédigé par l'orchestrateur de la mission
- **Entrées** : `00-cahier-des-charges.md` (demande), `01-cadrage-conformite.md` (48 exigences EXG-01→48 + arbitrages §8), `02-etude-recrutement.md` (PROP-01→12), `03-etat-des-lieux-technique.md` (existant + écarts)
- **Statut** : PROPOSITION — à valider par la direction avant codage (avec les revues 06 UX/CIP et 07 auditeur)
- **Périmètre** : volet 1 du CDC (parcours d'insertion). Le volet RSEi fait l'objet de `rapports/rsei-2026-07-22/`.

---

## 1. Vision cible en une page

Le module Insertion devient le **dossier unique d'accompagnement** de chaque salarié en insertion, organisé autour d'une **frise chronologique** :

```
RECRUTEMENT ──────────► PARCOURS ──────────────────────────────────────► SORTIE ──► POST-SORTIE
candidature             diagnostic    bilans internes    renouvellement   bilan      contact
entretien + tests       d'accueil     (fréquence CIP)    (formulaire      de sortie  3-6 mois
PCM                     (9 rubriques, (éval. du bilan     encadrant,      (synthèse, (situation
mises en situation      9 freins,     précédent, delta    avis, durée,    freins,    constatée)
embauche                objectifs,    des freins, plan    triple          actions    +
                        plan CIP)     d'action, RDV       validation)     restantes, questionnaire
                                      suivant obligé)                     documents) satisfaction
```

Chaque événement de la frise est un **entretien historisé** (daté, typé, signé, exportable en PDF), qui porte :
- le **snapshot des 9 freins** (toile d'araignée superposable, valeur « non évalué » honnête) ;
- l'**évaluation du bilan précédent** (objectifs et actions : OK / non OK, échéances respectées ou non) ;
- les **objectifs individualisés** (avec sous-objectifs, échéance, date butoir, origine salarié/CIP) ;
- le **plan d'action CIP** (catégorie, criticité, échéance, partenaire mobilisé, résultat) ;
- la **planification obligatoire du prochain entretien** ;
- une **préparation IA** (proposition éditable, pseudonymisée).

Au-dessus des fiches : un **tableau de bord** (indicateurs légaux + conventionnels paramétrés en settings), un **tableau transversal des actions CIP**, et le **tableau d'export des freins** (23 colonnes du CDC).

---

## 2. Décisions de conception structurantes

| # | Décision | Justification | Statut |
|---|----------|---------------|--------|
| D1 | **Étendre `insertion_milestones` en table des entretiens** (lever `UNIQUE(employee_id, milestone_type)`, remplacer le CHECK 5 types par un référentiel : `diagnostic_accueil`, `bilan_intermediaire` ×N, `renouvellement`, `bilan_sortie`, `suivi_post_sortie`) plutôt que créer une table parallèle | Conserve en place l'existant (EXG-48 : migration sans perte), réutilise les snapshots de freins, le radar, les alertes, l'effet de clôture du Bilan Sortie | Proposé |
| D2 | **Pas d'entité « parcours » (épisodes) en v1** : le parcours reste porté par `employees.insertion_status/start/end`. Un éventuel 2ᵉ parcours (réembauche après sortie) réutilise le même dossier ; les restitutions filtrent par année | Migration beaucoup plus légère ; cas rare ; extensible plus tard (`parcours_id` nullable prévu dans le modèle) | Proposé — limitation documentée |
| D3 | **Radar à 9 axes** : 7 existants (mobilité, santé, finances, famille, linguistique, administratif, numérique) + **logement** + **judiciaire** ; l'export CDC restitue les 7 freins demandés ; famille et numérique restent visibles en interne | Recommandation du cadrage (§4.3) : aucun historique perdu, export conforme | **Arbitrage direction n° 1** |
| D4 | **Référentiel unique des freins en code** (`freins-registry.js` backend + miroir frontend) consommé par schéma, moteur, IA, exports, anonymisation, radar | Les freins sont aujourd'hui câblés en dur dans ≥ 12 fichiers (03 §5.3) — l'ajout de 2 axes impose cette factorisation | Proposé |
| D5 | **Questionnaire d'accueil = colonnes structurées pour les données d'export/pilotage + JSONB pour le détail** (cases à cocher des rubriques) | Évite ~60 colonnes ; les 23 colonnes de l'export restent requêtables en SQL | Proposé |
| D6 | **Criticité = le champ `priority` existant relibellé « Criticité »** (haute/moyenne/basse) ; ajout de `partenaire_id` + `resultat` + `objectif_id` ; `milestone_id` devient nullable (journal d'actions au fil de l'eau) | Le CDC demande catégorie + criticité + échéance : tout existe sauf le rattachement libre et le partenaire (EXG-18/19) | Proposé |
| D7 | **Signatures = validations horodatées par compte + PDF remis au salarié** (pas de signature électronique qualifiée ; case « validé en présence du salarié ») | Cadrage §6.2.6 ; pattern PDF A4 existant | **Arbitrage direction n° 10** |
| D8 | **Sorties reclassées sur la nomenclature officielle** : `emploi_durable` / `emploi_transition` / `sortie_positive` / `autre` (migration mappée depuis le binaire actuel + types) | Sans cela les taux du dialogue de gestion sont incalculables (EXG-06) | Proposé |
| D9 | **Chiffrement applicatif (pattern PCM AES-256)** des textes libres santé et judiciaire | EXG-37/38 (art. 9 et 10 RGPD) | Proposé (coût modéré) |
| D10 | **Le frein judiciaire est masqué aux rôles MANAGER et exclu par défaut des exports** (variante « colonnes sensibles » ADMIN/RH sur demande explicite) | EXG-38 | **Arbitrage direction n° 7** (recommandé : exclu) |
| D11 | **La fiche unifiée = onglet « Parcours insertion » dans la fiche salarié `/employees`**, construit avec les mêmes composants React que `/insertion` (composants partagés extraits) | CDC « accès à la fiche individualisée » ; évite une 3ᵉ page ; `/insertion` reste l'espace de travail CIP | Proposé |
| D12 | **Objectifs conventionnels uniquement en `settings`**, affichage « objectif non paramétré » tant que la direction n'a pas confirmé les valeurs de l'annexe (46 / 82,60 / 54,30 / 17,40 / 10,90) | EXG-47 ; doctrine KPI honnêtes de l'ERP | **Arbitrage direction n° 2** |
| D13 | **NIR, IBAN, n° allocataire CAF : jamais stockés** ; ID France Travail : stocké si la direction valide | Doctrine minimisation + cadrage §6.2 | **Arbitrage direction n° 6** |

---

## 3. Lots fonctionnels

> Chaque lot est livrable et testable indépendamment, dans l'ordre. Les exigences couvertes (EXG-xx du rapport 01, PROP-xx du rapport 02) sont tracées. Priorité : 🅾 obligatoire / 🅰 attendu / 🆂 souhaitable.

### Lot 1 — Socle « entretiens historisés » 🅾
**Couvre : EXG-16, EXG-22, EXG-33, EXG-48 ; PROP-01 (partie init)**

- Levée des contraintes d'unicité, référentiel de types d'entretiens, migration des 5 types historiques (mapping documenté, zéro perte).
- N **bilans intermédiaires à fréquence libre** : création d'un bilan à toute date, planification du suivant **obligatoire à la clôture** (sauf sortie) — le « prochain RDV » devient un entretien `planifie` visible dans l'agenda.
- **Évaluation du bilan précédent** intégrée au formulaire de bilan : reprise automatique des objectifs et actions du bilan précédent avec statut à renseigner (OK / non OK + motif), delta des freins affiché.
- **Initialisation automatique** des jalons obligatoires : à la liaison candidat→collaborateur (link-employee) ET à l'entrée en parcours (import paie CDDI) ; **recalage automatique** après chaque bilan réalisé et chaque renouvellement de contrat ; **bouton « Recalculer les jalons »** sur la fiche.
- Alertes existantes (J-14/J-7/J-1/retard) branchées sur le nouveau modèle et **affichées** (elles ne sont visibles nulle part aujourd'hui).

### Lot 2 — Diagnostic d'accueil refondu 🅾
**Couvre : EXG-01, EXG-20, EXG-21, EXG-45, EXG-46 ; arbitrage D3**

- Questionnaire à **9 rubriques** fidèle à la trame interne, **adapté Solidarité Textiles** (postes tri/collecte/boutique/logistique, avantages ST à confirmer), commentaire CIP par rubrique, complété par : rubrique **linguistique** (CECRL simplifié + observation), rubrique **situation judiciaire** minimisée (niveau + impact organisationnel uniquement).
- Chaque rubrique **valorise son frein** (proposition de niveau 1-5 pré-calculée depuis les réponses, ajustable par la CIP — la CIP décide toujours).
- **Radar 9 axes** avec « non évalué » réellement non tracé (fin du biais « non évalué = 1 »).
- Rubrique IX (expression du salarié : attentes, difficultés, objectifs, aide souhaitée) → **alimente directement les objectifs du Lot 3** (origine « salarié »).
- Délai réglementaire : alerte « diagnostic non réalisé à 30 jours » (EXG-01).
- Pré-remplissage depuis le recrutement pour les salariés liés (freins signalés à l'embauche, projet, PCM) — **PROP-01**.

### Lot 3 — Objectifs & plan d'action CIP enrichi 🅾
**Couvre : EXG-17, EXG-18, EXG-19, EXG-34 (partiel)**

- **Objectifs individualisés** : objectif → sous-objectifs, échéance, date butoir, statut, origine (salarié / CIP), suivis de bilan en bilan (repris automatiquement tant que non atteints).
- **Actions CIP** : catégorie, criticité, échéance (enfin saisissable dans l'UI), **partenaire mobilisé** (référentiel administrable : CAF, France Travail, CPAM, ANTS, SOLIHA, bailleurs, OPCO, missions locales…), **résultat**, rattachement libre (jalon, objectif, ou au fil de l'eau).
- **Saisie < 1 minute** : formulaire court, valeurs par défaut, ajout depuis la fiche ET depuis le tableau transversal.
- **Tableau de synthèse des actions CIP** (toutes CIP, tous salariés) : filtres salarié / catégorie / criticité / partenaire / retard, tri par échéance — exigence explicite du CDC.

### Lot 4 — Conformité IAE 🅾
**Couvre : EXG-02, EXG-03, EXG-04, EXG-05, EXG-06, EXG-07, EXG-08, EXG-09, EXG-11, EXG-13 ; PROP-02, PROP-03 (base)**

- **Pass IAE** : n° + dates sur la fiche (recopiés depuis la fiche candidat si liaison), alerte à J-7 mois (fenêtre de prolongation), **bilan de prolongation généré** à partir des bilans saisis (PDF pour le prescripteur).
- **Dérogations CDDI > 24 mois** : motif obligatoire (formation / 50+ / RQTH / CDI inclusion) au-delà du plafond.
- **PMSMP** : CRUD complet avec bornes légales contrôlées (≤ 1 mois/convention, ≤ 60 j/12 mois), rappel de saisie dans l'outil officiel.
- **Renouvellement de contrat = entretien** : formulaire fidèle à la trame interne (rempli par l'encadrant → transmis à la CIP → triple validation encadrant/CIP/directeur), lié à la création du contrat de renouvellement ; liste « renouvellements à préparer » (fins de contrat < 6 semaines).
- **Sorties** : nomenclature officielle (durable/transition/positive/autre) + destination détaillée ; **bilan de sortie** avec synthèse d'évolution (deltas de freins), actions restantes, **check-list des documents remis** (STC, certificat, attestation France Travail).
- **Suivi post-sortie** : entretien auto-planifié à +3 mois (fenêtre 3-6), saisie de la situation constatée, reprise dans les statistiques annuelles.
- **Questionnaire de satisfaction de sortie** (trame interne, saisie assistée) + restitution agrégée anonyme (démarche qualité).
- **Éligibilité / auto-prescription** : critères retenus + localisation des justificatifs tracés côté candidat puis salarié (sans dupliquer les pièces).

### Lot 5 — Frise chronologique & fiche unifiée 🅾
**Couvre : EXG-15, EXG-30 ; PROP-04 ; décision D11**

- **Frise visuelle horizontale** (composant dédié) : contrats successifs (bandeaux), entretiens (points colorés par type/statut), objectifs (échéances/butoirs), PMSMP (segments), événements de recrutement (candidature, entretien, PCM, embauche) pour les salariés liés, sortie et post-sortie. Zoom/défilement, clic → détail.
- **Fiche salarié unifiée** : nouvel onglet « Parcours insertion » dans `/employees` (frise + entretiens + objectifs + actions + analyse IA), mêmes composants que `/insertion` (extraction en composants partagés).
- La vue liste de `/insertion` reste l'espace de travail quotidien de la CIP (file active, urgences).

### Lot 6 — Tableau de bord, exports & alertes 🅾
**Couvre : EXG-10, EXG-14, EXG-24, EXG-25, EXG-34, EXG-43, EXG-47 ; décisions D8, D12**

- **Tableau de bord insertion** (page `/insertion/audit` enrichie) : taux de sorties (3 catégories + dynamiques) vs **objectifs conventionnels paramétrés**, ETP réalisés vs conventionnés (approche par heures/contrats, étiquetée « contrôle — saisie officielle : ASP »), typologie des publics (RQTH, bRSA…, niveau de formation), délai moyen de réalisation du diagnostic, taux d'entretiens dans les délais, files actives par CIP, renouvellements/Pass à préparer, PMSMP et formations de l'année.
- **Tableau d'export des freins** : les 23 colonnes du CDC (XLSX + CSV), valeur des freins = **dernière évaluation en date**, variante par défaut **sans** frein judiciaire (D10), génération journalisée RGPD, + **variante agrégée non nominative** pour transmission externe (comités, DDETS, CD76).
- **Bloc alertes consolidé** (fiche + tableau de bord) : jalon en retard, prochain entretien non planifié, Pass IAE expirant, cumul CDDI ≥ 22 mois, renouvellement à préparer, action critique en retard, diagnostic > 30 j.
- **Export de synthèse comité de pilotage** (PDF/CSV agrégé, 2×/an).

### Lot 7 — Préparation IA des entretiens 🅾
**Couvre : EXG-23, EXG-42**

- « **Préparer cet entretien** » sur chaque entretien (tout type) : synthèse de situation, deltas de freins, objectifs en cours/en retard, actions en retard, points à aborder selon le type (accueil / bilan / renouvellement / sortie / post-sortie), questions suggérées — **pseudonymisé** (pattern existant), étiqueté « Proposition IA », éditable, **historisé** sur l'entretien.
- Génération anticipée optionnelle (J-7 avant un entretien planifié, via le scheduler) — paramétrable.
- Analyse IA de la fiche et de la cohorte : mises à jour pour le nouveau modèle (9 freins, objectifs, nomenclature sorties).

### Lot 8 — Espace encadrant technique & co-construction 🅰 (phase 2)
**Couvre : EXG-26, EXG-27, EXG-28, EXG-32 ; PROP-03 (complet), PROP-05**

- **Grilles de compétences métier par filière ST** (tri, collecte, logistique, boutique) administrables, notées /10 ou N/E par l'ETI avec observations et objectifs, évaluations périodiques datées et validées.
- **Volet « accompagnement social et professionnel » noté** (assiduité RDV, autonomie démarches, informatique, projet pro, CV/LM/TRE, enquêtes métiers, PMSMP — N/E exclu des moyennes).
- **SWOT d'entrée, besoins exprimés, COA** rattachés au parcours et repris dans les bilans.
- **Portefeuille de compétences** (centres d'intérêt, savoir-faire/être, compétences par domaine), **auto-évaluation CECRL**, **style d'apprentissage** (24 items → 4 profils, complément du PCM).
- **Entretien de période d'essai** (procédure interne) + **checklist d'embauche** (promesse, documents, formation au poste).
- Accès MANAGER (ETI) strictement limité : grilles, renouvellement, objectifs professionnels — jamais les détails santé/judiciaire/budget.

### Transverse (dans chaque lot) 🅾
**Couvre : EXG-35→44 ; décisions D9, D10, D13**

- **RGPD** : entrée au registre avant mise en production, matrice d'habilitations testée (tests de contrat), extension de l'anonymisation à chaque nouvelle table, chiffrement des textes santé/judiciaire, journalisation des exports nominatifs, note d'information salarié (+ mention IA — AI Act), purge paramétrée (2 ans après dernier contact).
- **Tests** : Jest unitaires + tests de contrat par endpoint réparé/créé (pattern vague 3), non-régression `/insertion/*`.
- **Documentation** : guide CIP (livrable 08), note certificateurs (09), CLAUDE.md et docs applicatives à jour.

---

## 4. Ce qui n'est PAS dans le périmètre proposé

- Interconnexions directes avec les emplois de l'inclusion / extranet ASP (pas d'API publique stable ; l'ERP **prépare** et contrôle, la saisie officielle reste sur les plateformes de l'État) — EXG-10 assumé ainsi.
- Signature électronique qualifiée (D7).
- Questionnaires FSE+ complets (EXG-12) tant que le cofinancement n'est pas confirmé (**arbitrage n° 3**).
- Vue salarié « Mon parcours » (EXG-31) — reportée, à décider (**arbitrage n° 9**).
- Entité « parcours multiples » (D2) — documentée comme évolution future.

## 5. Jalons de livraison proposés

| Étape | Contenu | Estimation |
|---|---|---|
| **PR 1** | Lots 1 + 2 + 3 (socle entretiens, diagnostic refondu, objectifs/actions) + transverse | ~2/3 de l'effort |
| **PR 2** | Lots 4 + 5 + 6 + 7 (conformité IAE, frise/fiche unifiée, tableau de bord/exports, IA) + doc | ~1/3 |
| **PR 3 (phase 2)** | Lot 8 (espace ETI, co-construction, période d'essai) | à cadrer après retours terrain |

Chaque PR : build Docker OK, suite Jest verte, smoke test, migration idempotente prouvée sur base neuve ET base existante, revue des habilitations.

## 6. Risques principaux

1. **Migration des contraintes d'unicité** (diagnostic/jalons) : risque de régression sur les `ON CONFLICT` existants → tests de non-régression dédiés + double exécution init-db.
2. **Effort transversal des 2 nouveaux freins** (≥ 12 points de code) → mitigé par le référentiel unique (D4), à faire en premier dans le Lot 2.
3. **Charge de saisie CIP** (~0,86 ETP CIP) : si l'outil est plus lourd qu'Excel, il ne sera pas adopté → revue UX/CIP (rapport 06) avant validation, pré-remplissages systématiques, saisie rapide testée.
4. **Données sensibles** (santé art. 9, judiciaire art. 10) : revue DPO avant mise en production (EXG-35), chiffrement, habilitations testées.
5. **Objectifs conventionnels non confirmés** : aucun chiffre en dur (D12) — le tableau de bord reste honnête tant que la direction n'a pas validé.
