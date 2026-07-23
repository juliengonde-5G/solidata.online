# Revue d'audit — Extension du module Insertion (dispositif prévu, avant développement)

- **Mission** : contrôle du dispositif prévu (non codé) sous l'angle : conformité des pratiques d'accompagnement, obligations envers les bénéficiaires, qualité du reporting, démarche qualité — posture mixte instructeur DDETS (dialogue de gestion ACI) / auditeur qualité réseau de l'insertion.
- **Date** : 22 juillet 2026
- **Pièces examinées** : `00-cahier-des-charges.md` (demande + corpus), `01-cadrage-conformite.md` (référentiel EXG-01→48 + arbitrages §8), `04-plan-action-fonctionnel.md` (lots, décisions D1-D13, périmètre exclu §4), `05-plan-codage.md` (schéma, API, RGPD, tests) ; convention pluriannuelle ACI 2026-2028 n° C076ACI262800008 (art. 3, 5, 8, 10 à 12 relus dans le texte) ; annexe financière ACI076260005A0M0 ; 4 procédures internes du processus d'insertion ; formulaires internes (bilan d'entretien, renouvellement de contrat, satisfaction de sortie) ; sondages ciblés dans le code (`init-db.js`, module insertion, RGPD) pour vérifier l'exactitude des constats techniques invoqués par les plans.
- **Méthode** : contrôle sur pièces du référentiel d'exigences (complétude, exactitude des sources), contrôle de couverture EXG ↔ lots, test d'auditabilité (« un contrôleur peut-il reconstituer un parcours sur pièces ? »), confrontation aux trames internes déclarées (qui font foi) et à la convention. Aucune donnée nominative du corpus n'est reprise ici.

---

## 1. Avis global

### CONFORME SOUS RÉSERVES

**Si ce plan est implémenté tel quel, la structure sera en bien meilleure capacité de démontrer ses obligations qu'aujourd'hui (pratique Excel), et la trajectoire est la bonne — mais six réserves majeures doivent être levées avant développement.** Elles portent sur des points que le développement rendrait coûteux à corriger après coup (schéma, valeur probante) ou qui créeraient une non-conformité dès la mise en service (AIPD, FSE+).

Constats d'ensemble :

1. **Le référentiel de 48 exigences (rapport 01) est de bonne qualité** : sources réglementaires exactes et vérifiables (L.5132-15-1, L.5135-1 s., arrêté du 01/09/2021, référentiel CNIL 2023, règl. UE 2021/1060 et 2024/1689), lecture correcte de la convention (art. 3.1 auto-prescription, 3.3 PMSMP, 3.4 COPIL 2×/an, art. 5 DUI, art. 8 SI, art. 10 contrôle sur place — vérifiés dans le texte), lecture prudente et arithmétiquement juste de l'annexe financière. Les quatre angles morts du CDC identifiés (renouvellement, Pass IAE, écart des « 7 freins », post-sortie/qualité) sont réels et correctement comblés. **Il lui manque toutefois trois obligations** : l'AIPD (RES-01), la consultation du CSE (RES-12) et la « durée » des actions exigée par l'art. 5 (RES-04) ; et une formulation PMSMP est inexacte (RES-07).
2. **La couverture EXG ↔ lots est presque complète** : 46 exigences sur 48 sont tracées vers un lot. Deux défauts de traçabilité : EXG-29 (validations/signatures + PDF remis — priorité O) n'est rattachée à **aucun** lot (RES-03) ; EXG-13 est annoncée couverte par le Lot 4 mais absente du plan de codage (RES-11).
3. **Les partis pris contrôlés sont acceptables** :
   - *ERP = préparation/contrôle, saisie officielle sur ASP/emplois de l'inclusion* (EXG-10, périmètre exclu §4 du plan) : **acceptable et bien bordé**. C'est même la seule position tenable en l'absence d'API publique stable ; l'étiquetage à l'écran (« contrôle — saisie officielle : ASP ») est prévu. Le risque résiduel de divergence entre les deux saisies est traité par recommandation (rapprochement mensuel, mention sur les exports — §4).
   - *Objectifs conventionnels non codés en dur tant que non confirmés* (D12, EXG-47) : **suffisant et conforme à la doctrine « KPI honnêtes » de l'ERP**. Ma propre relecture de l'annexe financière confirme la cohérence arithmétique de l'hypothèse (82,60 = 54,30 + 17,40 + 10,90 ; base 46) — la confirmation par la direction sur le PDF original reste requise, avec une échéance : **avant le premier bilan annuel / dialogue de gestion** (recommandation R-04). Un tableau de bord qui affiche « objectif non paramétré » est préférable, aux yeux d'un contrôleur, à un chiffre inventé.
   - *Les 10 arbitrages listés (01 §8)* : **pertinents et bien posés**. Quatre sont bloquants avant développement (n° 1 radar, n° 3 FSE+, n° 7 judiciaire, n° 10 signatures — RES-06) ; il en manque un (traitement des réembauches / second parcours — RES-05) ; et l'AIPD n'a pas à être « arbitrée » : c'est une obligation (RES-01).
4. **Les reports en phase 2/3** : l'espace ETI (Lot 8) ne crée pas de non-conformité immédiate mais impose de clarifier le circuit du formulaire de renouvellement en attendant (RES-10) ; le report FSE+ est **le seul report potentiellement non conforme** — si un cofinancement existe, le recueil des données participants se fait à l'entrée et n'est pas rattrapable (RES-06) ; le report de la vue salarié est sans risque (le droit d'accès s'exerce par le PDF remis et le module RGPD existant).
5. **Enjeu** : l'art. 12 de la convention subordonne le renouvellement du conventionnement à la présentation du bilan de l'art. 5 et aux contrôles. La qualité probante de ce module conditionne donc directement la reconduction 2029 — d'où l'exigence particulière portée ici sur l'intégrité des pièces (RES-02, RES-03).

---

## 2. Réserves

Gravité : **MAJEURE** = à lever avant développement ; **mineure** = à lever avant mise en production.

### RES-01 (MAJEURE) — L'AIPD obligatoire est absente du dispositif

- **Constat** : aucune des 48 exigences ni aucun livrable ne prévoit d'analyse d'impact relative à la protection des données (art. 35 RGPD). Or le traitement projeté cumule : finalité d'**accompagnement social** de personnes en difficulté — type de traitement figurant **explicitement dans la liste CNIL des traitements pour lesquels une AIPD est requise** (délibération n° 2018-327) — données d'art. 9 (santé) et d'art. 10 (judiciaire), personnes vulnérables, évaluation systématique (notation des freins 1-5), et assistance IA. Plusieurs critères CEPD sont réunis : l'AIPD n'est pas optionnelle. La « revue DPO » d'EXG-35 (registre) ne la remplace pas.
- **Exigence de correction** : ajouter une exigence transverse (EXG-49) : AIPD **engagée avant le développement** (ses conclusions peuvent modifier la conception : chiffrement, durées, flux IA, habilitations), validée par le DPO **avant mise en production**, référencée dans l'entrée registre. À inscrire au « Transverse » du plan fonctionnel et comme critère de passage de la PR 2. Le formalisme peut rester proportionné (le rapport 01 §6 en fournit déjà l'essentiel de la matière).

### RES-02 (MAJEURE) — Aucune garantie d'intégrité des entretiens clôturés et validés

- **Constat** : le plan de codage prévoit `created_by`/`updated_by` et des validations horodatées (JSONB `validations`), mais **aucun verrouillage après clôture/validation, aucun historique des modifications** d'un entretien. Un bilan « réalisé et validé » resterait modifiable par `PUT /milestones/:id` sans trace du contenu antérieur ni caducité des validations. Pour un contrôleur, la valeur probante d'une validation horodatée est nulle si le contenu validé peut changer après coup ; en contrôle sur place (art. 10), c'est la première chose testée. Le pattern nécessaire existe pourtant déjà dans l'ERP (`refashion_dpav_history` : snapshot JSONB par INSERT/UPDATE — vérifié dans `init-db.js`).
- **Exigence de correction** : au Lot 1 (`POST /milestones/:id/close`, EXG-16/29) : (a) gel du contenu à la clôture ; (b) réouverture possible uniquement par action explicite, **motivée et journalisée** (qui, quand, motif), entraînant la **caducité des validations** (à refaire) ; (c) table d'historique par snapshot (pattern DPAV) sur `insertion_milestones` — a minima sur les entretiens à l'état `realise`. Étendre le critère d'acceptation d'EXG-29 en conséquence.

### RES-03 (MAJEURE) — Preuve de co-construction : le maillon « signature du salarié / remise » est trop faible et n'est rattaché à aucun lot

- **Constat** : (a) **EXG-29 (priorité O) n'apparaît dans la liste « Couvre » d'aucun lot** du plan fonctionnel — seule une mention indirecte figure au §3.3 du plan de codage (gabarits PDF) ; (b) la validation « salarié » prévue est `mode:'presence'` — c'est-à-dire **une case cochée par la CIP**, le salarié n'ayant pas de compte (vue salarié reportée, arbitrage n° 9) ; (c) la **remise du PDF au salarié n'est pas tracée** (ni date ni mode), alors que les trames internes (bilan à double signature, renouvellement à triple signature — vérifiées) et le droit d'accès en font un point de contrôle central ; (d) aucun moyen de **rattacher le document signé** (scan) à l'entretien, alors que l'infrastructure d'upload existe (Multer + filtres).
- **Exigence de correction** : rattacher explicitement EXG-29 au Lot 1 (bilans/diagnostic) et au Lot 4 (renouvellement, sortie) ; ajouter au modèle : trace de remise (date + mode : remis en main propre / envoyé) et **pièce jointe facultative « exemplaire signé »** sur l'entretien ; trancher l'arbitrage n° 10 en « validation par compte + PDF signé papier + scan rattaché » (recommandé par le cadrage lui-même). Sans compte salarié, c'est la seule combinaison qui tient en contrôle.

### RES-04 (MAJEURE) — La « durée » des actions d'accompagnement (art. 5 de la convention) est absente du modèle de données

- **Constat** : l'art. 5 impose de rendre compte de « la **nature, l'objet, la durée** des actions de suivi individualisé et d'accompagnement ». Le dispositif couvre la nature (catégorie), l'objet (titre/description), la date, le partenaire et le résultat — **aucun champ de durée** n'existe, ni sur les entretiens (`insertion_milestones`) ni sur les actions (`cip_action_plans`), ni d'agrégat « volume d'accompagnement » dans la synthèse (EXG-14). Le rapport 01 cite pourtant l'art. 5 verbatim (§2.1.1) sans en tirer l'exigence. La structure resterait sur des estimations pour le DUI et le dialogue de gestion.
- **Exigence de correction** : ajouter au schéma dès les Lots 1 et 3 (le coût est nul avant développement) : `duree_minutes` sur l'entretien réalisé (saisie rapide, valeurs par défaut par type) et durée optionnelle sur l'action ; agréger dans la synthèse annuelle et l'export COPIL (Lot 6 / EXG-14) un volume d'heures d'accompagnement par salarié et global. Compléter EXG-18 et EXG-14.

### RES-05 (MAJEURE) — L'unicité absolue diagnostic / bilan de sortie / satisfaction rend un second parcours indémontrable (réembauche)

- **Constat** : le plan de codage crée des **index uniques partiels par salarié** (`WHERE milestone_type='diagnostic_accueil'`, idem `bilan_sortie`) et `UNIQUE(employee_id)` sur `insertion_satisfaction_sortie`, en cohérence avec la décision D2 (« pas d'entité parcours en v1, un 2ᵉ parcours réutilise le même dossier »). Conséquence concrète : un salarié sorti puis **réembauché** (cas réel en ACI, avec nouveau Pass IAE) ne pourrait avoir **ni nouveau diagnostic d'accueil, ni nouveau bilan de sortie, ni nouvelle enquête de satisfaction**. Pour ces dossiers, la structure serait dans l'incapacité de démontrer EXG-01 (diagnostic du nouveau parcours) et fausserait EXG-06/07 (sorties). La « limitation documentée » de D2 ne suffit pas : c'est une non-conformité programmée, même minoritaire.
- **Exigence de correction** : au Lot 1, **scoper l'unicité par parcours** sans forcément créer l'entité complète : par exemple unicité de (employee_id, `insertion_start_date` courant) ou colonne `parcours_no` incrémentée à chaque réentrée en parcours, portée par les jalons et la satisfaction ; lever `UNIQUE(employee_id)` sur la satisfaction au profit d'une unicité par jalon de sortie. Documenter le comportement des restitutions annuelles pour les doubles parcours.

### RES-06 (MAJEURE) — Quatre arbitrages sont bloquants et doivent être tranchés avant la PR 1 ; le FSE+ ne peut pas être « reporté » si le cofinancement existe

- **Constat** : le plan conditionne à raison le codage à des arbitrages, mais ne hiérarchise pas leur urgence. Or : l'arbitrage n° 1 (radar 9 axes) conditionne la migration du schéma et le registre des freins ; le n° 7 (frein judiciaire) conditionne schéma, chiffrement et exports ; le n° 10 (signatures) conditionne le modèle de validation (cf. RES-03) ; et surtout le n° 3 (**FSE+**) : si un cofinancement FSE+ existe (directement ou via le CD76), le questionnaire participant doit être recueilli **à l'entrée** de chaque participant — un report en phase 2 créerait des trous de collecte définitivement irrattrapables et une inéligibilité potentielle des dépenses (piste d'audit, règl. UE 2021/1060). Le périmètre exclu §4 du plan fonctionnel présente ce point comme un simple report.
- **Exigence de correction** : obtenir **avant développement** la décision écrite de la direction sur les arbitrages n° 1, 3, 7 et 10 (les six autres peuvent attendre la recette). Pour le n° 3 : vérification factuelle immédiate (annexe financière, conventions CD76) ; si FSE+ avéré, réintégrer EXG-12 au Lot 4 (questionnaires entrée/sortie + archivage séparé) dès la PR 2 au plus tard.

### RES-07 (mineure) — PMSMP : assiette du plafond de 60 jours inexacte et règle des « 2 conventions » non implémentée

- **Constat** : le cadrage (§2.1.6) écrit « cumul ≤ 60 jours sur 12 mois **chez un même bénéficiaire** » — formulation fautive : le plafond réglementaire s'apprécie pour un même bénéficiaire **chez un même organisme d'accueil** (D.5135-* ; Q/R DGEFP PMSMP). Le plan de codage (§1.4) implémente « cumul ≤ 60 j sur 12 mois glissants » **sans préciser l'assiette** : contrôlé tous organismes confondus, il serait plus strict que la règle et produirait des blocages indus (409) sur des parcours licites. Par ailleurs, la règle « 2 conventions maximum avec la même structure d'accueil (objets différents) », citée par le cadrage, n'est **pas implémentée**.
- **Exigence de correction** (Lot 4 / EXG-05) : corriger la formulation du cadrage ; contrôler le cumul par (salarié × organisme d'accueil — clé SIRET) sur 12 mois glissants ; ajouter le contrôle « 2 conventions même accueil, objets différents » ; sourcer les règles en commentaire de code ; messages d'avertissement pédagogiques (citer la règle). Conserver `saisie_outil_officiel` (art. 3.3) comme case de conformité — bon réflexe du plan.

### RES-08 (mineure) — Dérogation CDDI > 24 mois : le critère « impossible d'enregistrer » est inapplicable à la voie d'import paie

- **Constat** : EXG-03 exige « impossible d'enregistrer un contrat portant le cumul > 24 mois sans motif ». Or les contrats entrent majoritairement par l'**import paie Malibou** (doctrine ERP : seule la paie crée les collaborateurs/contrats) : bloquer l'import casserait la chaîne RH ; ne pas le bloquer rend le critère faux. Le plan de codage ne définit pas le comportement sur cette voie.
- **Exigence de correction** (Lot 4 / EXG-03) : distinguer les deux voies — saisie manuelle : bloquant ; import : **non bloquant avec alerte « dérogation à régulariser »** dans le bloc alertes et une file de régularisation visible tant que le motif + la date de décision ne sont pas saisis. Reformuler le critère d'acceptation d'EXG-03 en conséquence.

### RES-09 (mineure) — Taux de sorties : dénominateur et sous-motifs « autre » non spécifiés ; rupture de série à la migration

- **Constat** : le plan aligne la nomenclature (durable / transition / positive / autre — D8) mais ne définit ni le **dénominateur** des taux (« sorties constatées » au sens ASP : lesquelles ? période ? motifs neutralisés éventuels ?) ni les **sous-motifs** de la catégorie « autre » (chômage, inactivité, rupture, etc.) attendus dans le suivi « au fil de l'eau » (art. 8). Par ailleurs, la migration mappée recalcule rétroactivement des classifications : les taux recalculés pourront différer des chiffres déjà transmis les années passées.
- **Exigence de correction** (Lot 6 / EXG-06) : documenter dans le code et à l'écran la règle de calcul (numérateur, dénominateur, période, référence méthodologique ASP/DREETS) ; sous-typer « autre » ; conserver `sortie_classification_legacy` (déjà prévu — bien) **et** annoter dans le tableau de bord tout indicateur portant sur des exercices antérieurs à la migration (« changement de méthode 2026 »).

### RES-10 (mineure) — Habilitations d'écriture non spécifiées endpoint par endpoint ; circuit du renouvellement flou tant que l'espace ETI (Lot 8) n'existe pas

- **Constat** : la matrice du cadrage (§6.2.3) est bonne au niveau des rôles, mais le plan de codage ne précise pas les rôles d'**écriture** des endpoints modifiés (`PUT /milestones/:id` notamment). Or le formulaire de renouvellement est « rempli par l'encadrant » (trame interne) alors que l'espace ETI est reporté en phase 2 : qui saisit quoi en PR 2 ? Si MANAGER peut écrire sur `PUT /milestones/:id`, il ne doit pouvoir toucher **que** le bloc renouvellement (jamais les freins santé/judiciaire/budget ni les textes du diagnostic).
- **Exigence de correction** : avant développement des routes, décliner la matrice en **matrice par endpoint × champ** (écriture MANAGER restreinte au bloc `renouvellement_*` + validations `eti` ; sinon, circuit transitoire documenté : formulaire papier ETI retranscrit par la CIP avec mention de l'origine) ; la couvrir par les tests de contrat déjà prévus (EXG-39).

### RES-11 (mineure) — EXG-13 annoncée couverte par le Lot 4 mais absente du plan de codage

- **Constat** : le Lot 4 liste EXG-13 (« vaut entretien professionnel » L.6315-1 + alerte 22 mois) dans son en-tête « Couvre », mais ni le contenu du lot ni le plan de codage (schéma, endpoints, scheduler) n'en portent la moindre trace. La traçabilité annoncée est donc fausse — c'est précisément le type d'écart documentaire qu'un audit de suivi relèvera.
- **Exigence de correction** : soit implémenter (un booléen `vaut_entretien_professionnel` sur l'entretien + un job d'alerte à 22 mois — coût faible), soit retirer EXG-13 de la couverture du Lot 4 et la déclarer explicitement non couverte en v1 (priorité S : acceptable si assumé).

### RES-12 (mineure) — Information/consultation du CSE non prévue

- **Constat** : l'introduction d'un module traitant systématiquement des données personnelles (dont sensibles) des salariés, avec assistance IA, relève de l'information/consultation du CSE (L.2312-8 — introduction de nouvelles technologies / organisation ; et art. 26 §7 du règlement IA pour l'information des représentants des travailleurs avant mise en service d'un système à haut risque dans l'emploi). Le cadrage mentionne l'information des salariés (EXG-41, §6.4) mais pas l'instance représentative.
- **Exigence de correction** : ajouter au transverse (aux côtés d'EXG-41) : consultation/information du CSE **avant mise en production**, tracée (ordre du jour + avis) ; mentionner l'assistance IA. À articuler avec la note d'information salariés.

### RES-13 (mineure) — Contact post-sortie : base juridique et information de la personne non documentées

- **Constat** : le suivi post-sortie 3-6 mois (EXG-08, procédure interne) s'exerce **après la fin du contrat** : la base « exécution du contrat » ne porte plus, et l'art. 8 de la convention ne vise que la situation à la sortie. Le cadrage effleure le sujet (consentement pour les traitements « au-delà du suivi conventionnel ») sans trancher pour ce cas précis.
- **Exigence de correction** : documenter la base retenue (intérêt légitime lié au bilan annuel conventionnel, recommandé) dans le registre et l'AIPD ; informer la personne **au moment de la sortie** (mention sur le PDF de bilan de sortie : contact à venir, droit d'opposition) ; consigner l'opposition éventuelle (l'entretien post-sortie passe alors à « non réalisable — opposition »).

---

## 3. Points forts (du point de vue d'un contrôleur, par rapport à la pratique Excel actuelle)

1. **Un référentiel d'exigences opposable** : 48 exigences numérotées, sourcées (loi, convention, documents internes), chacune avec un critère d'acceptation vérifiable — le développement lui-même devient contrôlable. C'est rare et précieux ; la présente revue a pu s'y adosser.
2. **La preuve de l'art. 5 enfin outillée** : journal d'actions daté avec partenaire mobilisé et résultat, entretiens historisés typés, auteur systématique (`created_by`), frise chronologique — un contrôleur reconstitue un parcours sur pièces sans dépendre de la mémoire de la CIP (sous réserve RES-02/03/04).
3. **Des échéances réglementaires pilotées et non subies** : alertes diagnostic > 30 j, Pass IAE à J-7 mois (fenêtre de prolongation), renouvellements < 6 semaines, cumul CDDI ≥ 22 mois, action critique en retard. C'est ce qui distingue, en dialogue de gestion, une structure qui pilote d'une structure qui subit.
4. **La nomenclature officielle des sorties** remplace un binaire positive/negative incalculable (vérifié dans le schéma actuel) ; migration mappée, valeur historique conservée (`_legacy`), définition unifiée du « dynamique » propagée aux exports FSE+ et Métropole.
5. **Le Pass IAE entre dans le système** (n°, dates, alerte) avec **génération du bilan de prolongation** pour le prescripteur — aujourd'hui totalement hors outil, alors que c'est le support obligatoire des prolongations.
6. **Un positionnement honnête vis-à-vis des plateformes de l'État** : l'ERP prépare et contrôle, la saisie officielle reste ASP/emplois de l'inclusion, et l'écran le dit. Pas de « double vérité » : c'est exactement ce qu'il faut répondre à un contrôle.
7. **Des KPI honnêtes** : refus de coder en dur des objectifs conventionnels non confirmés, affichage « objectif non paramétré », valeurs cibles en `settings`. La lecture de l'annexe financière est prudente et signalée comme hypothèse — bonne pratique.
8. **RGPD par conception, réel et vérifiable** : minimisation effective (NIR/IBAN/n° CAF exclus du schéma), art. 9/10 réduits à l'impact professionnel et chiffrés (pattern AES-256 existant), frein judiciaire masqué hors ADMIN/RH et exclu par défaut des exports, journalisation des exports nominatifs (`rgpd_audit_log` vérifié existant), purge à 2 ans après dernier contact (référentiel CNIL 2023), pseudonymisation systématique des appels IA, habilitations couvertes par des tests automatisés.
9. **Fidélité aux pratiques déclarées** : les trames internes (bilan à double signature, renouvellement encadrant→CIP→directeur avec avis et durée 2/4/6 mois, satisfaction à 4 niveaux avec situation à la sortie) sont reprises champ à champ — vérification faite sur les formulaires sources. La cohérence « ce qu'on déclare / ce qu'on fait / ce que l'outil trace » est le cœur d'un audit qualité : elle est ici assurée par construction.
10. **L'IA à sa juste place** : préparation d'entretien pseudonymisée, étiquetée « Proposition », éditable, historisée ; aucun scoring imposé (les niveaux de freins proposés restent à la main de la CIP) ; anticipation de l'AI Act. Aucune décision automatisée produisant des effets juridiques.
11. **Migration sans perte et testée** : reprise des 5 jalons historiques, double exécution d'init-db prouvée, tests de contrat, recette bout-en-bout scriptée du parcours complet — le passé reste lisible, l'avenir est vérifiable.

---

## 4. Recommandations (hors réserves)

- **R-01 — Export « dossier individuel complet »** : un PDF unique par salarié (diagnostic + tous entretiens + objectifs + actions + PMSMP + sortie + validations) en un clic. C'est la pièce n° 1 demandée en contrôle sur place et un vecteur commode du droit d'accès. Les gabarits par pièce prévus (§3.3 du plan de codage) en fournissent les briques.
- **R-02 — Mention sur les exports eux-mêmes** : imprimer sur chaque export/PDF « Document de travail ERP — les saisies officielles (ASP / emplois de l'inclusion / Immersion Facilitée) font foi », pas seulement à l'écran, pour qu'un export transmis ne soit jamais pris pour une déclaration officielle.
- **R-03 — Rapprochement mensuel ETP** : un écran de contrôle heures ERP ↔ état mensuel de présence validé ASP (écart par salarié), à consulter avant les récapitulatifs des 5ᵉ, 10ᵉ et dernier mois (art. 8) — transforme l'« étiquette contrôle » en contrôle effectif.
- **R-04 — Échéance de paramétrage des cibles** : faire confirmer les objectifs conventionnels (46 / 82,60 / 54,30 / 17,40 / 10,90) et les saisir en `settings` **avant le premier bilan annuel** de la convention (dialogue de gestion début 2027) ; consigner date et source de la confirmation.
- **R-05 — Indicateurs de qualité d'accompagnement** au tableau de bord : nombre d'entretiens réalisés par salarié et par an, délai moyen entre deux bilans, taux de rendez-vous honorés — questions récurrentes de l'instructeur au dialogue de gestion, calculables sans saisie supplémentaire.
- **R-06 — Discipline des textes libres** : étendre l'aide à la saisie prévue pour le judiciaire (« ne jamais saisir la nature des faits ») aux champs santé, et prévoir un rappel de qualification dans le guide CIP (livrable 08) : le chiffrement protège la donnée, pas la collecte excessive.
- **R-07 — Versionner la note d'information RGPD** et référencer sa version dans le pied de page de chaque PDF généré (preuve de l'information délivrée à la date T).
- **R-08 — Sous-traitance IA** : faire vérifier par le DPO l'encadrement du transfert hors UE du fournisseur IA (clauses contractuelles/décision d'adéquation) et le refléter dans l'entrée registre et l'AIPD.
- **R-09 — Note méthodologique de bascule** : au premier bilan annuel produit avec le nouvel outil, joindre une note signalant le changement d'outil et de nomenclature (2026) pour expliquer d'éventuels écarts avec les séries antérieures (complète RES-09).
- **R-10 — Boucler la boucle qualité** : formaliser une revue annuelle (résultats satisfaction + post-sortie + indicateurs) débouchant sur un plan d'amélioration daté — matière attendue par la démarche qualité et le label RSEi (à articuler avec la mission `rsei-2026-07-22`).
- **R-11 — Paramètres réglementaires vérifiés au fil de l'eau** : la fenêtre de prolongation du Pass IAE (7 mois retenus) et les seuils d'alerte sont paramétrables — bonne conception ; prévoir une vérification de ces valeurs sur la documentation des emplois de l'inclusion au moment du développement puis à chaque évolution de doctrine.

---

## 5. Liste de contrôle « jour J » — test d'auditabilité

Les pièces et démonstrations qu'un contrôleur (DREETS/CD76, art. 10 de la convention, ou auditeur qualité) demanderait lors d'un contrôle sur place, et où le futur module les fournit. Les mentions ⚠ signalent une dépendance à une réserve.

| # | Pièce / démonstration demandée | Où le module la fournit | Observations |
|---|---|---|---|
| 1 | Liste des salariés en insertion de l'année (entrées, sorties, contrats, ETP) | Export insertion (ADMIN/RH) + tableau 23 colonnes — génération journalisée | Variante agrégée pour toute transmission |
| 2 | Dossier tiré au sort : diagnostic d'accueil daté, délai vs embauche | Fiche salarié › onglet Diagnostic + PDF ; alerte > 30 j (EXG-01) | ⚠ RES-05 pour un second parcours |
| 3 | Éligibilité IAE : Pass (n°, dates), critères d'auto-prescription, localisation des justificatifs | En-tête de fiche (Pass IAE) + champs éligibilité (EXG-02/11) | Pièces conservées sur la plateforme de l'inclusion — l'ERP référence, ne duplique pas |
| 4 | Historique complet des entretiens datés, typés, avec contenu | Frise chronologique + onglet Entretiens & bilans + PDF par entretien (EXG-15/16) | ⚠ RES-02 : intégrité post-validation |
| 5 | Preuve de co-construction : signatures/validations du salarié, remise des documents | Bloc validations + PDF remis + exemplaire signé rattaché | ⚠ RES-03 (à corriger avant dev) |
| 6 | Journal des actions d'accompagnement : nature, objet, date, durée, partenaire, résultat (art. 5) | Page Actions CIP + export CSV filtrable (EXG-18/19) | ⚠ RES-04 pour la durée |
| 7 | Objectifs individualisés et leur suivi (échéances, dates butoirs, statuts, origine salarié/CIP) | Onglet Objectifs & actions (EXG-17) | L'origine « salarié » matérialise la co-construction |
| 8 | Justification d'un renouvellement de CDDI (formulaire encadrant, avis, durée, triple validation) | Jalon Renouvellement + PDF (EXG-04) | ⚠ RES-10 : circuit ETI transitoire |
| 9 | Motif de dérogation d'un parcours > 24 mois + date de décision | Fiche : badge cumul CDDI + motif (EXG-03) | ⚠ RES-08 : voie import |
| 10 | PMSMP : conventions, objets légaux, bornes respectées, saisie dans l'outil officiel (art. 3.3) | Table PMSMP de la fiche + segments de frise (EXG-05) | ⚠ RES-07 : assiette du 60 j ; Cerfa au dossier |
| 11 | Bilan de sortie : synthèse, évolution des freins, catégorie de sortie, documents remis (STC, certificat, attestation France Travail) | Jalon Bilan de sortie + check-list + PDF (EXG-07) | Clôture impossible sans catégorie ni check-list |
| 12 | Tableau des sorties de l'année et taux (durable/transition/positive/dynamiques) vs objectifs négociés | Tableau de bord insertion + export synthèse (EXG-06/24) | ⚠ RES-09 : dénominateur documenté ; « objectif non paramétré » tant que non confirmé |
| 13 | ETP réalisés vs conventionnés (24,76) ; états de présence | Bloc « contrôle » du tableau de bord + module pointage/heures | La saisie ASP fait foi — étiquette explicite (EXG-10) |
| 14 | Typologie des publics à l'entrée (bRSA, AAH, RQTH, niveaux de formation, QPV…) | Bloc typologies + export agrégé non nominatif (EXG-10) | Nomenclature officielle des niveaux |
| 15 | Preuve du suivi post-sortie 3-6 mois | Jalon post-sortie (situation constatée, date) — EXG-08 | ⚠ RES-13 : information/opposition |
| 16 | Enquêtes de satisfaction de sortie et leur exploitation | Saisie liée au jalon Sortie + restitution annuelle anonymisée (EXG-09) | Boucle qualité — cf. R-10 |
| 17 | Synthèse pour comités de pilotage (2×/an, art. 3.4) et bilan annuel | Export synthèse agrégé PDF/CSV (EXG-14) | Les comptes rendus de séance restent hors ERP |
| 18 | Registre RGPD, AIPD, note d'information remise, consultation CSE | Module RGPD : entrée registre + AIPD + note versionnée | ⚠ RES-01/12 |
| 19 | Journal des consultations sensibles et des exports nominatifs (qui, quand, quoi) | `rgpd_audit_log` + journal d'activité (EXG-43) | Existant, vérifié dans le schéma |
| 20 | Démonstration que l'IA n'a pas décidé (art. 22 RGPD / AI Act) | Notes « Proposition IA » historisées et éditées, pseudonymisation, note d'information | EXG-23/42 — montrer un exemple édité par la CIP |

**Conclusion du test d'auditabilité** : une fois les réserves RES-01 à RES-06 levées, un contrôleur reconstitue un parcours complet sur pièces depuis le module, sans retraitement Excel — ce qui constituerait un net progrès par rapport à la situation actuelle et une base solide pour le dialogue de gestion et le renouvellement de la convention (art. 12).

---

*Revue établie au titre du volet « audit et contrôle » de la mission (persona chargé·e de mission audit DDETS / réseau qualité). Prochaine étape : levée des réserves majeures dans les plans 04/05 (et le référentiel 01 pour RES-01/04/07), puis validation direction avant PR 1.*
