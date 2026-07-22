# Cadrage & conformité — Extension du module Insertion (historique des entretiens)

- **Mission** : agent « garant du cahier des charges » (respect réglementaire, preuve de la promesse du logiciel, pratiques et usages du métier de CIP en ACI)
- **Date** : 22 juillet 2026
- **Références** : `rapports/insertion-2026-07-22/00-cahier-des-charges.md` (demande verbatim), corpus documentaire (20 documents), code existant (`backend/src/routes/insertion/*`, `backend/src/scripts/init-db.js`), CLAUDE.md
- **Statut** : livrable d'étude — à valider par la direction AVANT tout plan de codage
- **⚠ RGPD** : les documents 12-13 du corpus (structure sœur R'PUR) ne sont exploités que pour leur structure ; aucune donnée nominative n'est reprise ici.

---

## 0. Synthèse exécutive

Le CDC client est **globalement bien aligné** avec les obligations d'un ACI conventionné : il place le diagnostic d'accueil, les bilans, le bilan de sortie et le tableau de bord au centre — c'est exactement la mécanique attendue par la DREETS au dialogue de gestion (art. 5 de la convention C076ACI262800008). Mais il présente **quatre angles morts** que ce rapport comble :

1. **Le jalon « renouvellement de contrat » est absent du CDC** alors qu'il est un pivot du parcours (formulaire interne avec avis encadrant, triple signature encadrant/CIP/directeur) et le support obligatoire de la **prolongation du Pass IAE** au-delà de 24 mois (bilan du parcours + actions envisagées transmis au prescripteur habilité).
2. **Le Pass IAE n'existe nulle part dans l'ERP** (aucune colonne `pass_iae`), alors que le CDC exige la colonne « Fin PASS IAE » dans l'export et que la convention (art. 8) impose la tenue des fiches salariés sur la Plateforme des emplois de l'inclusion.
3. **Les « 7 freins actuels » cités par le CDC ne sont pas les 7 freins actuels du logiciel.** Le radar existant couvre mobilité, santé, finances, **famille**, linguistique, administratif, **numérique** ; l'export exigé demande linguistique, santé, **logement**, administratif, financier, **judiciaire**, mobilité. Deux axes à créer (logement, judiciaire), deux axes existants à arbitrer (famille, numérique). Le frein **judiciaire** relève de l'art. 10 RGPD (infractions/condamnations) : précautions maximales.
4. **Le suivi post-sortie (3 à 6 mois) et la boucle qualité (questionnaire de satisfaction de sortie)**, formalisés dans les procédures internes, ne sont pas repris par le CDC — ils sont pourtant la matière première du bilan annuel DREETS et du label RSEi.

La matrice d'exigences (§ 7) compte **48 exigences numérotées** ; c'est le contrat que le plan de codage devra couvrir.

---

## 1. Méthode et corpus examiné

| Volet | Sources |
|---|---|
| Demande client | CDC verbatim (section A du document 00) |
| Réglementaire | Code du travail L.5132-1 à L.5132-17, L.5132-15-1 (CDDI), L.5135-1 s. (PMSMP), L.6315-1 (entretien professionnel) ; doctrine Plateforme de l'inclusion / emplois de l'inclusion ; référentiel CNIL secteur social et médico-social (durées de conservation, 2023) ; règlement (UE) 2021/1060 (FSE+) — vérifiés en ligne au 22/07/2026, sources en § 9 |
| Conventionnel | Convention pluriannuelle ACI 2026-2028 n° C076ACI262800008 (Préfet 76 + CD76 + Solidarité Emploi Textile en Normandie) ; annexe financière ACI076260005A0M0 |
| Documents internes (font foi pour les trames) | 4 procédures du processus d'insertion (recrutement, accompagnement, suivi, retour à l'emploi), Fiche Diagnostique 9 rubriques (origine « ODS »), Livret de parcours, formulaires bilan d'entretien / renouvellement / satisfaction de sortie, règlement intérieur, livret d'accueil |
| Pratique observée (structure uniquement) | Classeurs de suivi et de bilan de parcours R'PUR : grilles de compétences /10 par filière, volet accompagnement noté, SWOT, COA, journal d'actions avec partenaires, évaluations par tranches de 6 mois, triple signature |
| Existant logiciel | Tables `insertion_diagnostics`, `insertion_milestones` (5 types figés, UNIQUE par type), `cip_action_plans`, `insertion_interview_alerts` ; moteur `engine.js` (`computeMilestoneSchedule`, `computeCddiCumulativeMonths`, `resyncMilestones`, 7 freins, questionnaires par jalon) ; pages `InsertionParcours.jsx`, `AuditInsertion.jsx` ; services `insertion-ai.js` + `pii-pseudonymize.js` + `anonymization.js` ; module RGPD |

---

## 2. Vérification réglementaire et conventionnelle

### 2.1 Rappel du cadre applicable (état 2026)

1. **Accompagnement obligatoire** — L.5132-1 s. : l'IAE « met en œuvre des modalités spécifiques d'accueil et d'accompagnement ». La convention (préambule + art. 3.2) impose « un parcours d'insertion, au travers d'un accueil et d'un accompagnement spécifiques, notamment au moyen de l'action des encadrants techniques et des conseillers en insertion » + mobilisation de formations et de PMSMP. Le **contenu** (diagnostic, entretiens, bilans) n'est pas détaillé par la loi : il est engagé via le **Dossier Unique d'Instruction** (art. 5 : « nature, objet, durée des actions de suivi individualisé et d'accompagnement ») — ce que la structure y déclare devient opposable au dialogue de gestion. L'ERP doit donc **prouver** ces actions (traçabilité datée).
2. **Diagnostic socio-professionnel** — il intervient à deux moments : (a) à l'**éligibilité** (prescripteur habilité ou auto-prescription par la SIAE : diagnostic + critères administratifs — niveau 1, ou 3 critères de niveau 2 pour un ACI — avec conservation des justificatifs, arrêté du 1/09/2021, contrôle a posteriori R.5132-1-12 à R.5132-1-17, art. 3.1 de la convention) ; (b) en **début de parcours** (diagnostic d'accueil approfondi, standard professionnel formalisé par la trame interne 9 rubriques). Depuis la loi « plein emploi » (2023-1196), le **diagnostic global** France Travail structure aussi l'amont ; la Plateforme de l'inclusion déploie un outil « Diagnostic Parcours IAE / DSP » — la trame ERP doit rester compatible avec ces référentiels (freins par domaines).
3. **CDDI** — L.5132-15-1 : 4 mois minimum, renouvelable dans la limite de **24 mois** ; dérogations : achèvement d'une **formation en cours**, salariés de **50 ans et plus** ou **RQTH** rencontrant des difficultés particulières (prolongations annuelles jusqu'à **60 mois** en ACI), **CDI inclusion** (57 ans et plus — l'annexe financière de la structure en comporte vraisemblablement 1, à confirmer). Le badge « durée cumulée CDDI 20/23 mois » existe déjà dans l'ERP ; il faut y adjoindre le **motif de dérogation** au-delà de 24 mois.
4. **Pass IAE** — délivré via les emplois de l'inclusion, **validité 24 mois** (décomptée à partir de la première embauche), prolongeable par un **prescripteur habilité** sur présentation par la SIAE d'un **bilan du parcours + actions envisagées** (demande possible au plus tôt 7 mois avant l'échéance, au plus tard le dernier jour). La fiche salarié ASP doit être renseignée et validée **dès l'embauche** (art. 8 de la convention). → Le module doit stocker n° et dates du Pass, alerter avant échéance, et produire le bilan de prolongation à partir des bilans saisis.
5. **États mensuels de présence ASP** — art. 4.2 et 8 : versement de l'aide au poste conditionné aux états mensuels (pré-remplis DSN), avec **récapitulatifs aux 5ᵉ, 10ᵉ et dernier mois** de l'annexe. La saisie officielle reste sur l'extranet ASP ; l'ERP (pointage/heures) peut fournir un état de contrôle.
6. **PMSMP** — L.5135-1 s. : convention Cerfa 13912*05, objets légaux (découvrir un métier / confirmer un projet / initier un recrutement), **1 mois maximum par convention**, cumul ≤ **60 jours sur 12 mois** chez un même bénéficiaire, 2 conventions maximum avec la même structure d'accueil (objets différents) ; art. 3.3 de la convention : saisie dans **l'outil dédié** (aujourd'hui Immersion Facilitée) et **maintien du CDDI** (pas de suspension).
7. **Sorties et indicateurs** — nomenclature ASP/DREETS des **sorties dynamiques** = **emploi durable** (CDI, CDD/intérim ≥ 6 mois, création d'entreprise…) + **emploi de transition** (CDD/intérim < 6 mois, contrats aidés) + **sorties positives** (formation qualifiante, autre SIAE…), calculées sur les sorties constatées. Références historiques nationales : 60 % dynamiques / 25 % durable, mais **les objectifs opposables sont ceux négociés dans l'annexe « objectifs négociés »** de la convention (voir § 2.3). L'ERP a déjà `sortie_classification (positive/negative)` + `sortie_type` : la **nomenclature doit être alignée sur les 3 catégories officielles** (la classification binaire actuelle ne permet pas de calculer les taux du dialogue de gestion).
8. **Indicateurs « au fil de l'eau »** — art. 8 : typologies des salariés, situation à la sortie, nombre d'ETI et de CIP, formations, PMSMP, marchés publics. + art. 3.4 : **comité de pilotage au moins 2×/an**. + art. 5 : bilan annuel (support du dialogue de gestion).
9. **FSE+** — si un cofinancement FSE+ existe (à confirmer : l'annexe financière lisible ne montre pas de ligne FSE+, mais un cofinancement CD76 et des recettes éco-organismes REFASHION/ECOMAISON) : questionnaire participant à l'entrée et à la sortie (règlement UE 2021/1060 + annexes FSE+, saisie « Ma démarche FSE+ »), conservation des pièces en piste d'audit (≥ 5 ans après le dernier paiement, art. 82 du règlement — durée distincte de la base active RGPD, voir § 6.3). L'ERP dispose déjà d'un export « FSE+ » dans le CohortePanel : à mettre en cohérence.
10. **Obligations employeur transverses** — entretien professionnel biennal (L.6315-1) applicable aux CDDI ; visites médicales (déjà suivies) ; règlement intérieur remis à l'embauche (déjà pratiqué).
11. **« Convergence »** — le CDC demande un persona « chargé de mission Audit chez Convergence ou à la DDETS ». Convergence France porte les programmes d'accompagnement renforcé en ACI (« Premières Heures en Chantier », « Collectif Vers l'accompagnement Global »), avec leurs propres exigences de reporting. **À confirmer par la direction** : la structure participe-t-elle (ou candidate-t-elle) à l'un de ces programmes, ou « Convergence » désigne-t-il ici un autre organisme ? Le tableau de bord devra, le cas échéant, intégrer leurs indicateurs.

### 2.2 Couverture par le CDC — verdict par obligation

| Obligation | Dans le CDC ? | Complément apporté par ce rapport |
|---|---|---|
| Diagnostic de début de parcours | ✅ (« obligation réglementaire », conditionne le parcours) | Préciser le délai interne (≤ 1 mois, cohérent avec le moteur existant M+1) + rattacher l'éligibilité/auto-prescription (EXG-11) |
| Entretiens/bilans réguliers | ✅ (fréquence libre CIP) | Lever les contraintes du schéma actuel (5 types figés, 1 bilan par type max) — EXG-16 |
| Renouvellement CDDI justifié | ❌ absent | Jalon « renouvellement » avec formulaire encadrant + triple signature — EXG-04 |
| Pass IAE (suivi, prolongation) | ⚠ seulement la colonne « Fin PASS IAE » de l'export | Stockage n°/dates + alerte + bilan de prolongation généré — EXG-02 |
| CDDI 24 mois + dérogations | ❌ absent | Motif de dérogation tracé au-delà de 24 mois — EXG-03 (badge existant) |
| Bilan/entretien de sortie | ✅ (« entretien obligatoire ») | Check-list documents de sortie (STC, certificat, attestation France Travail) — EXG-07 |
| Nomenclature sorties dynamiques | ⚠ implicite (« indicateurs de notre convention ») | Alignement sur les 3 catégories ASP/DREETS — EXG-06 |
| Reporting ASP / emplois de l'inclusion | ❌ absent | L'ERP n'est pas l'outil officiel : il prépare et contrôle (états, typologies) — EXG-10 |
| PMSMP | ⚠ seulement la colonne « PMSMP » de l'export | Table PMSMP avec bornes réglementaires — EXG-05 |
| Suivi post-sortie 3-6 mois | ❌ absent (mais procédure interne partie 4) | Jalon post-sortie + rappel automatique — EXG-08 |
| Démarche qualité (satisfaction sortie) | ⚠ indirect (persona audit / « démarche qualité ») | Questionnaire de sortie intégré + restitution agrégée — EXG-09 |
| FSE+ | ❌ absent | Conditionnel, à confirmer — EXG-12 |
| Comité de pilotage / bilan annuel | ⚠ indirect (tableau de bord) | Export de synthèse non nominatif — EXG-14 |
| RGPD | ❌ absent du CDC | § 6 entier + EXG-35 à EXG-44 |

### 2.3 Lecture prudente de l'annexe financière ACI076260005A0M0

L'extraction du PDF (formulaire) rend les intitulés illisibles ; seuls les nombres sont fiables. **Rien de ce qui suit ne doit être paramétré en dur sans confirmation de la direction** (les cibles seront saisies en `settings`, EXG-47).

- **Certain (recoupé par l'arithmétique)** : 24,76 ETP × 23 921,00 € = **592 283,96 €** — soit un conventionnement 2026 de **24,76 ETP d'insertion** au **montant socle unitaire de 23 921 €/ETP**, base annuelle **1 820 h** (base horaire ASP d'un ETP). Référente ASP : Aline Roix.
- **Hypothèses plausibles, à confirmer** : p. 1 « 42 / 26,05 / 39 / 26,05 » (postes CDDI conventionnés/réalisés d'un exercice antérieur — le n° 076 010123 renvoie à la convention 2023) ; « 1 / 1,00 » = 1 CDI inclusion (cohérent avec l'art. 4.1) ; p. 2 « 46 / 24,76 ; 3 / 3,00 ; 1 / 0,86 » = **46 salariés en insertion (24,76 ETP), 3 encadrants techniques (3,00 ETP), 1 CIP (0,86 ETP)** — champs exigés par l'art. 8 ; « 583 644 € », « 404 800 € », « 132 240 € » (cofinancement CD76 ?), « 157 160 € REFASHION;ECOMAISON » = autres financements ; à confirmer poste par poste.
- **Objectifs conventionnels p. 3 : « 46 / 82,60 / 54,30 / 17,40 / 10,90 »** — hypothèse de lecture arithmétiquement cohérente : **54,30 + 17,40 + 10,90 = 82,60 exactement**, ce qui correspond au triptyque officiel : taux de **sorties dynamiques 82,60 %** = **emploi durable 54,30 %** + **emploi de transition 17,40 %** + **sorties positives 10,90 %**, « 46 » étant l'effectif (ou le nombre de sorties) de référence. ⚠ Ces valeurs seraient très supérieures aux références nationales (60 %/25 %) : **confirmation impérative par la direction sur le PDF original avant tout affichage d'objectif dans le tableau de bord.** En cas de doute, afficher « objectif non paramétré » (jamais un faux chiffre — principe déjà acté dans l'ERP pour la subvention Refashion).
- **Conséquence de conception** : le ratio d'accompagnement (~46 salariés pour **0,86 ETP de CIP**, si confirmé) est très tendu. Chaque minute de saisie compte : le module doit être conçu pour la **réduction de la charge administrative** (pré-remplissage, reprise du bilan précédent, préparation IA, saisie du journal d'actions < 1 minute) — c'est une exigence de conception à part entière (EXG-18, EXG-23).

---

## 3. Confrontation aux pratiques métier CIP (et aux documents internes, qui font foi)

1. **Le parcours réel est un binôme CIP ↔ encadrant technique (ETI), pas un monologue CIP.** Les classeurs R'PUR le montrent : grilles de compétences métier notées /10 **par l'ETI** avec observations et objectifs, volet « accompagnement social et professionnel » noté par la CIP, **triple signature salarié/ETI/CIP** des évaluations périodiques (1-6, 6-12, 12-18, 18-24 mois), et formulaire de renouvellement **rempli par l'encadrant puis transmis à la CIP** pour la réunion de renouvellement (avis favorable/avec réserves/défavorable, durée 2/4/6 mois, signatures encadrant/CIP/directeur ; le salarié « ne devra pas découvrir la décision au dernier moment »). Le CDC est écrit du seul point de vue CIP : le module doit donner un **espace ETI** (grilles + renouvellement) avec un accès minimisé (pas de détails santé/judiciaire/budget), sans quoi la pratique réelle restera sur Excel.
2. **Le rythme des entretiens est individualisé mais borné.** Doc interne : diagnostic à l'accueil ; bilans à fréquence CIP (formulaire bilan) ; évaluations périodiques par tranche de 6 mois ; renouvellements calés sur les fins de contrat (2/4/6 mois → jusqu'à 6-8 renouvellements sur 24 mois) ; entretien de fin de parcours ; contact post-sortie 3-6 mois. Le moteur actuel (M+1/M+3/M+6/M+10/Sortie, un par type) est **trop rigide** : il faut des jalons obligatoires (diagnostic, renouvellements, sortie) + des bilans intermédiaires **libres et multiples**.
3. **Chaque bilan est une boucle d'évaluation du précédent.** Formulaire interne : situation actuelle (administrative/sociale/professionnelle/nouveaux éléments) → objectifs du jour et du prochain entretien → démarches réalisées/non réalisées **avec raisons** → freins → motivations → **progression et autonomie sur 3 niveaux** → points de vigilance → actions avec échéances → **date du prochain point** → double signature. Le CDC le confirme (« chaque bilan commence par une évaluation du bilan précédent… analyse du plan d'action OK/Non OK, respect des échéances et priorités »). Le formulaire de bilan du module doit donc **pré-charger** le bilan précédent (freins, objectifs, actions) et exiger un statut par action et la planification du suivant.
4. **Le journal d'actions avec partenaires est le cœur de la preuve d'accompagnement.** Structure observée : item / besoin / action réalisée + date / **partenaire mobilisé** (CAF, France Travail, ANTS, SOLIHA, bailleurs sociaux, OPCO, centre des finances, avocat…) / résultat. C'est ce journal qui démontre à la DREETS la « nature, l'objet, la durée des actions » (art. 5). Le `cip_action_plans` actuel (catégorie/priorité/échéance/statut) doit être enrichi (partenaire, résultat, actions hors jalon) + un référentiel de partenaires.
5. **Outils de co-construction** : SWOT à l'entrée, besoins exprimés par le salarié, COA (contrat d'objectifs), plans d'action numérotés, portefeuille de compétences et style d'apprentissage (livret). La rubrique IX de la trame (« attentes, difficultés, objectifs, sujets d'aide ») matérialise l'expression du salarié : elle doit rester en toutes lettres dans le module (pas seulement des scores).
6. **La remise au salarié** : les trames prévoient signature du salarié et l'esprit des procédures est la co-construction ; le module doit produire un **PDF remis/remissible au salarié** (pattern d'export A4 existant) portant les signatures/validations — c'est aussi un vecteur du droit d'accès RGPD.
7. **Préparation d'entretien** : la procédure « suivi du parcours » liste les contrôles à faire (délais, CV/LM, préparation entretiens, formalités administratives) ; l'IA de préparation (CDC) doit produire cette **check-list contextualisée** (actions en retard, échéances proches, freins à réévaluer, questions suggérées) — en assistance, jamais en décision (§ 6.4).

---

## 4. Questionnaire d'accueil — extraction complète et correspondances

### 4.1 Trame « Fiche Diagnostique » — 9 rubriques, champ par champ (source : Diagnostic_SocioProfessionnel, variante ODS identique)

> Chaque rubrique se conclut par un **commentaire libre CIP** (« Commentaire LOGEMENT », « Commentaire SANTÉ », etc.). Une date de passation figure sur chaque page.

**I. Identité**
1. NOM / Prénom
2. Date d'entrée dans l'entreprise
3. Poste(s) occupé(s) — cases « Entretien des locaux / Propreté Urbaine » **(libellés ODS → à remplacer par les postes ST : tri, collecte, boutique, logistique, couture/retouche, etc.)**

**II. Logement**
4. Statut : locataire (bailleur social + lequel / bailleur privé) / propriétaire / hébergé(e) chez… / sans abri
5. Type : appartement / maison ; taille : 1 à 6 pièces
6. Satisfaction O/N ; si non, motifs : taille / coût / insalubre / situation géographique / non adapté santé-handicap / autre
7. Commentaire CIP

**III. Accès aux droits et vie administrative**
8. Date de validité CNI **ou** Titre de Séjour
9. Adresse e-mail O/N + laquelle
10. Allocataire CAF O/N ; ressources perçues : RSA / APL / AF / CF / ASF / AAH
11. Prime d'activité : connue O/N, demandée O/N
12. Comptes administratifs en ligne : Trésor public / Ameli / CAF / Identité Numérique La Poste (FranceConnect+)
13. Commentaire CIP

**IV. Santé**
14. Mutuelle O/N : CSS / mutuelle d'entreprise (laquelle) / mutuelle personnelle (laquelle) + date de validité ; si non : souhait de bénéficier de celle **« d'ODS » (→ mutuelle ST)**
15. RQTH O/N + échéance + indemnisation O/N
16. Contre-indications médicales dans le cadre du travail O/N + lesquelles
17. Difficultés à tenir le poste actuel O/N + lesquelles
18. Suivi de santé particulier O/N
19. Commentaire CIP

**V. Budget**
20. Difficultés financières hors coût de la vie O/N : dette énergie / dette locative / découvert bancaire / dossier de surendettement / autres
21. Crédit(s) en cours O/N + nature
22. Souhait d'épargner O/N ; intérêt pour le **Plan d'Épargne Entreprise « d'ODS » (→ à confirmer : ST propose-t-elle un PEE ?)**
23. Commentaire CIP

**VI. Mobilité**
24. Permis B : oui (solde de points connu O/N + solde) / non (souhait de le passer O/N + pourquoi) / en cours (code en cours / code validé sans conduite / code validé + conduite)
25. Véhicule O/N : personnel / prêt (LOA-LLD) ; assuré O/N ; contrôle technique à jour O/N ; carte grise à jour O/N
26. Moyen de transport actuel : véhicule personnel / covoiturage / transports en commun / à pied / vélo-trottinette / 2 roues motorisé
27. Commentaire CIP

**VII. Situation professionnelle**
28. Autre(s) employeur(s) O/N + heures/semaine totales
29. Souhait d'un complément d'heures **« chez ODS » (→ chez ST)** : nb d'heures souhaitées, période de la journée, zone géographique

**VIII. Projet professionnel**
30. Dernière classe fréquentée
31. Diplôme/qualification O/N + lesquels
32. Métier(s) souhaité(s) issus des expériences (O/N + lesquels + pourquoi)
33. Projet professionnel idéal (texte)
34. Prêt à se (re)former : oui (dans le cadre du poste / centre extérieur ; durée acceptée < 3 mois / 3-6 / 6-12 / > 1 an) / non + pourquoi
35. Accès au compte CPF O/N
36. Commentaire CIP

**IX. Contrat d'insertion et réalisation de soi** (expression libre du salarié — co-construction)
37. Attentes du passage en contrat d'insertion
38. Difficultés rencontrées (personnelles et/ou professionnelles)
39. Objectifs à atteindre
40. Sujets sur lesquels le salarié souhaite l'aide des chargés d'insertion

### 4.2 Apports du « Livret parcours insertion professionnelle » (à fusionner dans le questionnaire d'accueil)

- **État civil** : nom de naissance, date et lieu de naissance, nationalité, adresse, téléphone, e-mail, **NIR ⚠ (à NE PAS stocker — doctrine de minimisation déjà actée dans l'ERP)**, n° identifiant France Travail, n° allocataire CAF (voir § 6.2 pour l'arbitrage).
- **Situation familiale** : marié(e) / célibataire / en couple / divorcé(e) / veuf(ve) ; enfants O/N + nombre + à charge O/N.
- **Freins extra-professionnels** (redondants avec la trame — fusionner) : santé (contre-indications, RQTH), finances (prestations : RSA / AAH / **ARE** / autre + depuis quand), mobilité (permis + type + date d'obtention, moyen de locomotion).
- **Diagnostic de l'expérience professionnelle** : tableau des expériences (poste / entreprise / type de contrat / dates), certifications-diplômes (nom / année / compétences acquises), commentaire.
- **Portefeuille de compétences** : 20 centres d'intérêt à cocher ; savoir-faire et savoir-être libres ; ~47 compétences à cocher en 6 domaines (communication, interpersonnelles, leadership, apprentissage, intrapersonnelles, réflexion).
- **Connaissances linguistiques** : auto-évaluation sur la grille **CECRL** (seule évaluation linguistique du corpus — voir § 4.4).
- **Mode d'apprentissage** : questionnaire 24 items A/B → 4 styles (adaptateur / divergeur / assimilateur / convergeur, modèle Kolb) avec implications pédagogiques (complémentaire du PCM déjà présent — le PCM reste l'outil maître de l'ERP, le style d'apprentissage est un enrichissement).
- **Définition du métier souhaité** : métiers visés, formations pré-requises, compétences pré-requises, points à améliorer, modalités d'inscription connues O/N, offres connues, attente de rémunération, attirances.
- **Suivi des recherches** : check-lists de préparation des RDV CIP, contacts entreprises, dates de RDV (→ alimente le journal d'actions).

### 4.3 Correspondance rubriques ↔ freins du radar

| Rubrique de la trame | Frein CDC (export) | Axe radar ERP existant | Statut |
|---|---|---|---|
| II. Logement | **Frein logement** | ∅ | **Axe à créer** |
| III. Droits & vie administrative | Frein administratif | `frein_administratif` | OK (+ e-mail/comptes en ligne alimentent aussi `frein_numerique`) |
| IV. Santé | Frein santé | `frein_sante` | OK |
| V. Budget | Frein financier | `frein_finances` | OK (libellé à harmoniser) |
| VI. Mobilité | Frein mobilité | `frein_mobilite` | OK |
| — (aucune rubrique) | **Frein linguistique** | `frein_linguistique` | **Rubrique à créer** (s'appuyer sur l'auto-éval CECRL du livret + observation CIP) |
| — (aucune rubrique ; catégorie « Justice » du journal d'actions R'PUR) | **Frein judiciaire** | ∅ | **Axe à créer** — précautions art. 10 RGPD (§ 6.2) |
| Livret : situation familiale | — (colonne « Situation familiale » de l'export, pas un frein CDC) | `frein_famille` | Axe existant **hors liste CDC** — à arbitrer |
| III (e-mail, comptes en ligne) | — | `frein_numerique` | Axe existant **hors liste CDC** — à arbitrer |
| I, VII, VIII, IX | — (données d'identité, d'emploi et de projet) | — | Non-freins |

**Recommandation d'architecture (à arbitrer par la direction, cf. § 8)** : radar cible à **9 axes** = 7 axes existants (leur historique de scores est conservé) + **logement** + **judiciaire** ; l'export CDC restitue les **7 freins demandés** (les axes famille et numérique restent visibles en interne — le frein numérique est un frein majeur reconnu du secteur, le frein famille est déjà évalué). Alternative : basculer strictement sur les 7 freins CDC, au prix d'une perte de granularité et d'une migration de l'historique.

### 4.4 Incohérences et adaptations relevées

1. **Trame d'origine « ODS »** (postes propreté urbaine/entretien des locaux, mutuelle ODS, PEE ODS, complément d'heures ODS) → adapter aux postes et avantages **Solidarité Textiles** ; la liste exacte des avantages ST (mutuelle, PEE ou non, autres) **doit être confirmée par la direction**.
2. **Frein linguistique sans rubrique dédiée** dans la trame : l'export CDC l'exige pourtant → ajouter une rubrique (CECRL simplifié + 3 questions d'observation, le moteur `engine.js` a déjà des questions indirectes et des niveaux 1-5).
3. **Frein judiciaire absent de la trame et du livret** : à créer ex nihilo, en déclaratif et minimisé (§ 6.2).
4. **Écart « 7 freins actuels »** : voir § 4.3 — le CDC croit décrire l'existant mais en diverge (famille/numérique vs logement/judiciaire). C'est LE point de désalignement majeur du CDC avec le code.
5. **Le livret collecte le NIR** (+ ID CAF) : NIR **exclu du stockage** (doctrine ERP actée) ; le formulaire numérique ne doit même pas proposer le champ.
6. **Doublons trame/livret** (santé, mobilité, finances, situation familiale) : le questionnaire numérique unifié doit dédupliquer (une seule saisie alimentant les deux vues).
7. **Schéma actuel incompatible avec le CDC sur 3 points** : `insertion_milestones.milestone_type` est un CHECK fermé à 5 valeurs + `UNIQUE(employee_id, milestone_type)` (impossible d'avoir N bilans intermédiaires) ; `cip_action_plans.milestone_id NOT NULL` (impossible de tracer une action entre deux jalons) ; aucune table d'objectifs structurés (objectif/sous-objectifs/échéance/date butoir).
8. **Comptage du tableau d'export** : le verbatim liste **23 champs** (22 séparateurs « / ») — « NOM Prénom » compté comme un seul champ. À préciser avec le client si « NOM » et « Prénom » font une ou deux colonnes (recommandation : deux colonnes, comme l'export insertion Excel existant).

---

## 5. Tableau d'export des freins (« 22 colonnes » — 23 champs listés) — colonne par colonne

Règle de valorisation proposée pour les freins : **dernier niveau évalué en date** (dernier bilan réalisé, sinon diagnostic d'accueil), jamais le seul diagnostic initial — l'export doit refléter la situation courante. `∅` = donnée absente du schéma actuel (à créer).

| # | Colonne (verbatim CDC) | Source actuelle dans l'ERP | À créer / observations |
|---|---|---|---|
| 1 | NOM Prénom | `employees.last_name`, `employees.first_name` | OK |
| 2 | Nationalité | `employees.nationality` (import Malibou) | OK — qualité de la donnée à vérifier ; recommandation : restituer « Française / UE / hors UE » en transmission externe (minimisation) |
| 3 | Date d'entrée ACI | `employees.contract_start` (1er contrat) / `insertion_start_date` | OK — définir la règle : date du **premier** CDDI (pas du contrat courant) |
| 4 | Fin PASS IAE | ∅ | **Créer** `pass_iae_number` + `pass_iae_start` + `pass_iae_end` (source : emplois de l'inclusion) + alerte échéance |
| 5 | Heures par semaine | `employee_contracts.weekly_hours` (contrat courant) | OK |
| 6 | Genre | `employees.gender` | OK |
| 7 | Date de naissance | `employees.birth_date` | OK — en transmission externe, préférer l'âge ou la tranche (pattern `pii-pseudonymize` existant) |
| 8 | RQTH | `employees.disability_status` (texte) + rubrique IV | **Structurer** : booléen + date d'échéance (le texte libre actuel ne permet pas le comptage typologie publics) |
| 9 | Niveau de formation | `employees.qualification` (texte libre) + rubrique VIII (dernière classe, diplômes) | **Structurer** : nomenclature officielle des niveaux (infra-3, 3 CAP/BEP, 4 Bac, 5 Bac+2, 6+) — exigée pour typologies ASP/FSE+ |
| 10 | Ressources | ∅ (rubrique III/livret : RSA, APL, AF, CF, ASF, AAH, ARE, prime d'activité) | **Créer** champ multi-valué « ressources perçues » (alimente aussi les critères d'éligibilité IAE : bRSA, ASS, AAH…) |
| 11 | Logement | ∅ (rubrique II : statut) | **Créer** statut logement (énuméré : locataire social / locataire privé / propriétaire / hébergé / sans abri) + frein_logement |
| 12 | Commune de résidence | `employees.city` | OK (QPV/ZRR : enrichissement souhaitable pour typologies) |
| 13 | Situation familiale | ∅ (livret) | **Créer** énuméré + enfants à charge O/N/nombre |
| 14 | Frein linguistique | `frein_linguistique` (diagnostic + jalons) | OK — rubrique de saisie à créer (§ 4.4.2) |
| 15 | Frein santé | `frein_sante` | OK |
| 16 | Frein logement | ∅ | **Créer** l'axe (diagnostic + jalons) |
| 17 | Frein administratif | `frein_administratif` | OK |
| 18 | Frein financier | `frein_finances` | OK (renommage d'affichage) |
| 19 | Frein judiciaire | ∅ | **Créer** l'axe — art. 10 RGPD : niveau + impact factuel uniquement, jamais la nature des faits (§ 6.2) ; envisager son exclusion de l'export nominatif courant (variante « avec/sans colonnes sensibles ») |
| 20 | Frein mobilité | `frein_mobilite` | OK |
| 21 | PMSMP | ∅ | **Créer** table PMSMP ; restituer nb réalisées + dates (ou dernière) |
| 22 | Projet de formation | partiel : rubrique VIII (souhait/durée), `cip_action_plans` | **Structurer** champ « projet de formation » (intitulé + statut) |
| 23 | Emploi visé | partiel : `insertion_diagnostics.cip_hypotheses_metiers`, rubrique VIII | **Structurer** champ « emploi visé » (libellé + code ROME souhaitable) |

**Règles d'accès à l'export** (voir § 6) : il combine identité + santé (RQTH) + judiciaire → réservé ADMIN/RH-CIP, chaque génération journalisée dans `rgpd_audit_log`, variante agrégée non nominative pour toute transmission externe (DREETS/CD76 demandent des agrégats, pas du nominatif, hors contrôles sur place).

---

## 6. RGPD

L'ERP dispose déjà des fondations : module RGPD (registre, consentements, audit log), `services/anonymization.js` (unifié employé+candidat, purge planifiée), `utils/pii-pseudonymize.js` (appliqué à `insertion-ai.js` et au chat), rôle DPO, DPO désigné (dpo@solidarite-textiles.fr, cf. règlement intérieur). Les règles ci-dessous s'imposent aux **nouvelles tables** (entretiens, objectifs, actions enrichies, PMSMP, pass IAE, questionnaire d'accueil étendu).

### 6.1 Qualification des données

| Catégorie | Données du module | Régime |
|---|---|---|
| Données « ordinaires » | identité, contrat, logement (statut), ressources (prestations), mobilité, formation, projet, objectifs, actions | RGPD droit commun — minimisation, exactitude |
| **Catégories particulières (art. 9)** | santé : contre-indications, difficultés au poste, suivi particulier, RQTH, mutuelle (révèle indirectement CSS/AAH) ; éventuelles données révélées dans les textes libres (origine, religion…) | Art. 9 §2 b) (obligations en matière de droit du travail et de protection sociale — l'accompagnement IAE est une obligation légale/conventionnelle de l'employeur) ; sécurité renforcée, accès restreint |
| **Infractions/condamnations (art. 10)** | frein judiciaire (aménagement de peine, obligations judiciaires impactant le travail, aide juridictionnelle) | Art. 10 + art. 46 LIL : traitement par l'employeur uniquement dans la stricte mesure nécessaire ; **ne jamais enregistrer la nature des faits ni les condamnations** — uniquement le niveau de frein et l'impact organisationnel factuel déclaré (ex. « contrainte horaire liée à une obligation judiciaire ») |
| Identifiants à risque | NIR, IBAN/BIC (livret/paie) | **Exclus du stockage** (doctrine actée) ; ID CAF : exclu (recommandation) ; ID France Travail : admis si la direction confirme son utilité opérationnelle pour les démarches CIP |

Base juridique d'ensemble : **obligation légale + exécution du contrat de travail** (L.5132-1 s., convention DREETS) pour l'accompagnement ; **obligation légale** pour le reporting ASP/DREETS/FSE+. **Pas de recours au consentement** pour le cœur du traitement (déséquilibre employeur/salarié — le consentement ne serait pas libre) ; le consentement reste réservé aux traitements optionnels (ex. contact post-sortie au-delà du suivi conventionnel, photo).

### 6.2 Règles pour les nouvelles tables (à inscrire au plan de codage)

1. **Registre** : nouvelle entrée `rgpd_registre` « Accompagnement socio-professionnel des salariés en insertion » (finalités : diagnostic, suivi, reporting ; catégories de données dont art. 9/10 ; destinataires : CIP/RH, direction, encadrants (restreint), DREETS/ASP (agrégats), prescripteurs (bilan de prolongation) ; durées § 6.3 ; sous-traitance IA Anthropic déjà inscrite — l'étendre aux nouveaux flux).
2. **Minimisation à la conception** : pas de champ NIR/IBAN/ID CAF dans le schéma ; santé et judiciaire limités à l'impact professionnel ; nationalité restituable en 3 classes vers l'extérieur ; date de naissance → tranche d'âge dans les restitutions (pattern existant).
3. **Accès par rôle (matrice à implémenter et tester)** :
   - ADMIN / RH (CIP) : lecture-écriture complète ;
   - MANAGER (ETI) : ses équipes uniquement — grilles de compétences, formulaire de renouvellement, objectifs professionnels ; **aucun accès** aux détails freins santé/judiciaire/budget ni aux textes du diagnostic social ;
   - DPO : registre, purge, journal — pas de lecture des dossiers en routine ;
   - AUTORITE (auditeur) : agrégats non nominatifs uniquement (pattern KPI Métropole existant) ;
   - COLLABORATEUR : sa propre fiche signée (si la vue salarié est retenue — EXG-31) ;
   - le **frein judiciaire** est masqué à tout rôle autre que ADMIN/RH.
4. **Chiffrement applicatif** des champs texte santé et judiciaire (pattern AES-256 déjà utilisé pour le PCM) — a minima, décision documentée si non retenu.
5. **Traçabilité** : `created_by`/`updated_by` sur toute écriture ; consultation des dossiers sensibles et **chaque export nominatif** journalisés dans `rgpd_audit_log` (qui, quand, périmètre).
6. **Signatures** : la « triple signature » est mise en œuvre a minima par validations horodatées par compte (salarié via remise papier/PDF signé scanné ou case « lu et approuvé » en présence du CIP) ; valeur probante interne, pas de prétention à la signature électronique qualifiée.
7. **Information des personnes** : mention d'information (finalités, destinataires, durées, droits, DPO, existence d'une assistance IA) intégrée au livret d'accueil/parcours **et** imprimée en pied du PDF de diagnostic remis au salarié.
8. **Données R'PUR** : aucun exemple nominatif du corpus dans le code, les seeds ou les jeux de démonstration.

### 6.3 Durées de conservation (à paramétrer dans la purge planifiée existante)

| Donnée | Base active | Archivage intermédiaire | Source |
|---|---|---|---|
| Dossier d'accompagnement (diagnostic, bilans, objectifs, actions, freins) | Durée du parcours + **2 ans après le dernier contact** (le « dernier contact » inclut le suivi post-sortie 3-6 mois) | Si contentieux prud'homal envisageable ou obligation de contrôle : archivage restreint jusqu'à 5 ans après la fin du contrat, accès DPO/direction uniquement | Référentiel CNIL secteur social et médico-social (2023) |
| Pièces justificatives éligibilité (auto-prescription) | Durée exigée pour le contrôle a posteriori (R.5132-1-12 s.) — **conserver de préférence sur la plateforme de l'inclusion**, l'ERP ne stockant que la référence | — | Arrêté 01/09/2021 ; convention art. 3.1 |
| Données de reporting FSE+ (si cofinancement confirmé) | Piste d'audit : **≥ 5 ans à compter du 31/12 de l'année du dernier paiement** (art. 82, règl. UE 2021/1060) — en archivage intermédiaire séparé, PAS en base active | — | Règlement (UE) 2021/1060 |
| Questionnaire satisfaction de sortie | 2 ans nominatif, puis **anonymisation** (conservation illimitée des agrégats qualité) | — | CNIL (droit commun) |
| Après purge | Anonymisation via `services/anonymization.js` **étendu aux nouvelles tables** (les agrégats statistiques — taux de sorties, freins moyens — survivent anonymisés pour les bilans pluriannuels) | | Existant ERP |

### 6.4 IA (préparation d'entretiens, analyses)

- **Pseudonymisation systématique** : tout appel LLM passe par `pii-pseudonymize` (jetons « Salarié A », scrub des textes libres, naissance → tranche d'âge) — déjà en place pour `insertion-ai.js`, à **imposer aux nouvelles routes** (préparation d'entretien, analyse de fiche).
- **Supervision humaine** : l'IA prépare (note éditable), la CIP décide ; aucune décision automatisée produisant des effets juridiques (art. 22 RGPD) — les sorties IA sont clairement étiquetées « proposition ».
- **AI Act (règlement UE 2024/1689)** : les systèmes d'IA utilisés dans le contexte de l'emploi et de la gestion des travailleurs relèvent de l'annexe III (haut risque), avec des obligations de déployeur applicables à partir d'**août 2026** : information des salariés (et représentants du personnel le cas échéant) de l'usage d'une assistance IA, supervision humaine effective, journalisation. La note d'information (§ 6.2.7) et le caractère strictement préparatoire de l'outil couvrent l'essentiel ; à faire vérifier par le DPO.

---

## 7. Matrice d'exigences

Priorités : **O** = obligatoire (réglementaire/conventionnel ou cœur du CDC), **A** = attendu (pratique métier structurante, doc interne faisant foi), **S** = souhaitable. Sources : RÉG (réglementaire), CONV (conventionnel), DOC (document interne), CDC (demande client), MÉT (pratique métier).

### A. Cadre réglementaire et conventionnel

| # | Exigence | Source | Prio | Critère d'acceptation vérifiable |
|---|---|---|---|---|
| EXG-01 | Tout salarié entrant en parcours dispose d'un **diagnostic d'accueil** formalisé, daté, rattaché à son dossier, réalisé dans un délai cible de 30 jours après l'embauche | RÉG (L.5132-1 s., DUI art. 5) + CDC | O | Le tableau de bord liste tout salarié `en_parcours` sans diagnostic réalisé > 30 j après `insertion_start_date` ; 0 salarié en parcours sans jalon Diagnostic |
| EXG-02 | Le **Pass IAE** (numéro, date de début, date de fin) est stocké sur la fiche salarié ; alerte paramétrable avant échéance (défaut 7 mois, fenêtre réglementaire de demande de prolongation) ; la colonne « Fin PASS IAE » de l'export est alimentée | RÉG (emplois de l'inclusion) + CONV (art. 8) + CDC | O | Champs saisissables ; alerte visible dans le bloc alertes ; export colonne 4 non vide pour les salariés ayant un Pass renseigné |
| EXG-03 | La **durée cumulée CDDI** (plafond 24 mois) est suivie (existant) ; tout dépassement exige la saisie d'un **motif de dérogation** parmi : formation en cours, 50 ans et plus, RQTH, CDI inclusion — avec date de décision | RÉG (L.5132-15-1) | O | Impossible d'enregistrer un contrat portant le cumul > 24 mois sans motif ; le motif apparaît sur la fiche et dans l'export d'audit |
| EXG-04 | Le **renouvellement de contrat** est un jalon de parcours : formulaire selon la trame interne (assiduité, motivation, autonomie, participation, projet pro, motifs, avis favorable/avec réserves/défavorable, durée 2/4/6 mois/autre), rempli par l'encadrant, transmis à la CIP, validé par la triple signature encadrant/CIP/directeur | DOC (formulaire renouvellement) + MÉT + RÉG (justification des renouvellements) | O | Un renouvellement de contrat saisi dans l'ERP est lié à un jalon « Renouvellement » complété et validé ; la liste des renouvellements à préparer (contrats finissant < 6 semaines) est affichée |
| EXG-05 | Les **PMSMP** sont enregistrées : dates, entreprise d'accueil, objet (découvrir un métier / confirmer un projet / initier un recrutement), tuteur, bilan ; contrôles : ≤ 1 mois par convention, cumul ≤ 60 j/12 mois, information « saisie dans l'outil officiel (Immersion Facilitée) O/N » ; le CDDI n'est pas suspendu | RÉG (L.5135-1 s.) + CONV (art. 3.3) + CDC (colonne 21) | O | CRUD PMSMP ; violation des bornes → avertissement bloquant ; colonne PMSMP de l'export alimentée |
| EXG-06 | Les **sorties** sont classées selon la nomenclature officielle : emploi durable / emploi de transition / sortie positive / autres sorties (+ destination détaillée : type de contrat, employeur, formation) ; les taux (dynamiques et décomposés) sont calculés par année civile et comparés aux **objectifs conventionnels paramétrés** | RÉG/CONV (dialogue de gestion, annexe objectifs négociés) + CDC (« indicateurs de notre convention ») | O | Chaque `Bilan Sortie` exige la catégorie officielle ; le tableau de bord affiche les 3 taux + total vs cibles `settings` ; migration de l'existant binaire documentée |
| EXG-07 | Le **bilan de sortie** est obligatoire et comprend : synthèse de l'évolution du parcours, évolution des freins (radar superposé), actions restant à réaliser par le salarié, situation à la sortie, et la **check-list des documents remis** (STC, certificat de travail, attestation France Travail) | CDC + DOC (procédure retour à l'emploi) | O | Jalon Sortie non clôturable sans catégorie de sortie ni check-list ; PDF de bilan généré |
| EXG-08 | Un **suivi post-sortie** est déclenché automatiquement : rappel à +3 mois (fenêtre 3-6 mois), écran de saisie de la situation constatée, alimentation du bilan de fin d'année | DOC (procédure retour à l'emploi) | A | Rappel créé à la clôture de la sortie ; situation post-sortie saisissable et reprise dans les stats annuelles |
| EXG-09 | Le **questionnaire de satisfaction de sortie** (trame interne : accueil, accompagnement, compétences, conditions de travail, bilan personnel, situation, satisfaction globale, suggestions) est saisissable et restitué en agrégats anonymisés (démarche qualité / RSEi / Convergence-DDETS) | DOC (formulaire satisfaction) + MÉT | A | Saisie liée au jalon Sortie ; page de restitution annuelle anonymisée |
| EXG-10 | Le tableau de bord expose les **indicateurs du dialogue de gestion** : ETP réalisés vs conventionnés, typologie des publics à l'entrée (bRSA, ASS, AAH, DETLD, 50+, jeunes, RQTH, niveau de formation, QPV…), nb ETI/CIP, formations suivies, PMSMP, sorties (EXG-06), avec export CSV — l'ERP **prépare** le reporting, la saisie officielle restant ASP / emplois de l'inclusion | CONV (art. 5 et 8) + CDC | O | Page tableau de bord avec ces blocs ; contrôle croisé ETP possible ; mention explicite « saisie officielle : ASP/emplois de l'inclusion » |
| EXG-11 | Pour les recrutements en **auto-prescription**, les critères d'éligibilité retenus et la **localisation** des pièces justificatives sont tracés (sans dupliquer les pièces sensibles dans l'ERP) | RÉG (arrêté 01/09/2021, R.5132-1-12 s.) + CONV (art. 3.1) | A | Champ « critères d'éligibilité » + référence pièces sur la fiche ; liste extractible pour un contrôle a posteriori |
| EXG-12 | **Si cofinancement FSE+ confirmé** : recueil des données participant (entrée/sortie) conformes au questionnaire FSE+, export compatible « Ma démarche FSE+ », conservation en piste d'audit séparée | RÉG (règl. UE 2021/1060) | A (conditionnel) | Décision direction documentée ; si oui : questionnaires saisis, export produit, archivage séparé |
| EXG-13 | Un entretien peut être marqué « **vaut entretien professionnel** (L.6315-1) » ; le délai biennal est suivi | RÉG | S | Marqueur sur l'entretien ; alerte à 22 mois sans entretien professionnel |
| EXG-14 | Un **rapport de synthèse non nominatif** (activité d'accompagnement, indicateurs, sorties) est exportable pour les comités de pilotage (2×/an) et le bilan annuel | CONV (art. 3.4 et 5) | S | Export PDF/CSV agrégé en un clic |

### B. Parcours, entretiens et jalons (cœur CDC)

| # | Exigence | Source | Prio | Critère d'acceptation vérifiable |
|---|---|---|---|---|
| EXG-15 | La fiche salarié présente une **frise chronologique** : entretiens (tous types), jalons, objectifs, débuts/fins/renouvellements de contrat, PMSMP, sortie — chaque élément cliquable vers son détail | CDC | O | Frise visible sur la fiche ; tous les types d'événements présents ; navigation vers le bilan/entretien |
| EXG-16 | Les **bilans intermédiaires sont multiples et à fréquence libre** définie par la CIP ; le schéma est étendu (fin du CHECK à 5 types et du UNIQUE par type) ; chaque bilan **pré-charge le bilan précédent** : freins (delta), objectifs, plan d'action avec statut par action (OK/Non OK, respect échéance/priorité), et exige la **planification du prochain entretien** | CDC + DOC (formulaire bilan) + MÉT | O | Création de N bilans pour un salarié ; formulaire pré-rempli ; clôture impossible sans date de prochain point (sauf jalon Sortie) |
| EXG-17 | Les **objectifs sont individualisés et structurés** : objectif → sous-objectifs, échéance, **date butoir**, statut, origine (exprimé par le salarié — rubrique IX — ou proposé par la CIP), rattachés au parcours et repris de bilan en bilan | CDC + DOC (COA) | O | CRUD objectifs/sous-objectifs ; vue « objectifs en retard » ; l'origine salarié/CIP est visible (co-construction) |
| EXG-18 | Les **actions CIP** portent : catégorie, **criticité**, échéance, statut, **partenaire mobilisé**, **résultat**, et peuvent exister **hors jalon** (journal d'actions au fil de l'eau) ; la saisie d'une action prend moins d'une minute (formulaire court, valeurs par défaut) | CDC + DOC/MÉT (journal d'actions R'PUR) | O | `cip_action_plans` étendu (partenaire, résultat, milestone_id nullable) ; tableau de synthèse filtrable (salarié, catégorie, criticité, retard) ; test de saisie rapide |
| EXG-19 | Un **référentiel de partenaires** (CAF, France Travail, CPAM, ANTS, SOLIHA, bailleurs, OPCO, mission locale, CD76, organismes de formation…) est administrable et alimente le journal d'actions ; statistiques d'actions par partenaire | MÉT (journal R'PUR) | A | Liste administrable ; sélection dans l'action ; stat annuelle par partenaire |
| EXG-20 | Le **questionnaire de diagnostic d'accueil** est refondu selon la trame 9 rubriques (§ 4.1, tous les champs) fusionnée avec les apports du livret (§ 4.2), **adapté à Solidarité Textiles** (postes ST, avantages ST confirmés par la direction), avec commentaire CIP par rubrique et valorisation des 9 axes de freins | CDC + DOC (trame + livret) | O | Tous les champs des § 4.1-4.2 saisissables (hors NIR/IBAN/ID CAF) ; aucun libellé « ODS » ; chaque rubrique alimente son frein |
| EXG-21 | Le **radar des freins** cible 9 axes (7 existants + logement + judiciaire — sous réserve d'arbitrage § 8) ; chaque bilan historise les niveaux ; le « **diagramme de valorisation des freins** » superpose au moins deux évaluations (évolution de la toile d'araignée) ; l'export restitue les 7 freins CDC | CDC + code existant | O | Colonnes `frein_logement`/`frein_judiciaire` sur diagnostics ET jalons ; radar superposé sur la fiche et dans les bilans/PDF |
| EXG-22 | Les **jalons s'initialisent automatiquement** au passage candidat→collaborateur (liaison recrutement existante) et à l'entrée en parcours ; ils se **recalculent après chaque bilan et chaque renouvellement** (resync existant à étendre) ; une actualisation manuelle est possible depuis la fiche | CDC + code existant | O | Le lien `link-employee` / l'entrée en parcours crée les jalons ; le renouvellement décale les échéances ; bouton « recalculer les jalons » |
| EXG-23 | Chaque entretien peut être **préparé par l'IA** : note de préparation (synthèse situation, freins et deltas, objectifs en cours, actions en retard, points à aborder, questions suggérées selon le type d'entretien), éditable, pseudonymisée en amont, étiquetée « proposition » | CDC | O | Bouton « Préparer l'entretien » ; sortie éditable ; test : aucun nom/prénom dans la requête LLM |
| EXG-24 | Le **tableau de bord insertion** consolide : indicateurs EXG-06/10, jalons en retard / à venir, files actives par CIP référent, renouvellements et fins de Pass à préparer, délai moyen de réalisation du diagnostic ; les **valeurs cibles sont paramétrées** (settings), jamais codées en dur | CDC + CONV | O | Page unique ; chaque KPI a sa cible paramétrable ou l'état « objectif non paramétré » |
| EXG-25 | Le **tableau d'export des freins** reproduit les colonnes du § 5 dans l'ordre du CDC (arbitrage NOM/Prénom en 1 ou 2 colonnes documenté), export CSV + XLSX ; chaque cellule provient de la source documentée ou reste vide explicite | CDC | O | Export conforme colonne à colonne ; recette sur 3 salariés tests couvrant les cas vide/rempli |
| EXG-26 | Des **grilles de compétences métier par filière ST** (tri, collecte, logistique, boutique) sont administrables : items notés (échelle /10 ou N/E) par l'**ETI**, avec observations et objectifs, en évaluations périodiques datées et signées | DOC/MÉT (classeurs R'PUR, à transposer aux métiers ST) | A | Référentiel de grilles par filière ; évaluation saisie par un compte MANAGER ; reprise dans le bilan et le PDF |
| EXG-27 | Le **volet « accompagnement social et professionnel » noté** (assiduité aux RDV, autonomie démarches, objectifs d'entretien, informatique, intérêt projet pro, CV/LM/TRE, enquêtes métiers, PMSMP) est saisissable avec la valeur **N/E** (non évalué, exclue des moyennes) | DOC/MÉT | A | Items notés ou N/E ; N/E exclu des agrégats (pattern « freins non évalués » déjà acté) |
| EXG-28 | **SWOT à l'entrée**, **besoins exprimés** et **COA** (contrat d'objectifs) sont rattachables au parcours et repris dans les bilans | DOC/MÉT | A | Champs disponibles ; affichés sur la fiche et le PDF |
| EXG-29 | Les bilans et évaluations portent les **validations formelles** : salarié + CIP (bilan), + ETI (évaluation périodique), encadrant + CIP + directeur (renouvellement) — validations horodatées par compte, et **PDF remis au salarié** (pattern export A4 existant) avec mention d'information RGPD | DOC (triple signature) + MÉT + RGPD | O | Un bilan « réalisé » porte ses validations ; bouton « PDF pour le salarié » ; mention RGPD en pied de page |
| EXG-30 | La **continuité recrutement → insertion** est visible : PCM, entretiens d'embauche, tests, entretien de période d'essai et charte d'insertion signée apparaissent en tête de frise (liaison candidat existante) | CDC (« logiciel de recrutement intégré ») + DOC (procédure recrutement) | A | Frise débutant aux événements de recrutement pour les salariés liés |
| EXG-31 | (Option) Une **vue salarié** « Mon parcours » donne accès à ses bilans signés et objectifs (droit d'accès facilité, co-construction) | MÉT + RGPD | S | Compte COLLABORATEUR : lecture seule de sa fiche signée uniquement |
| EXG-32 | Le **portefeuille de compétences** (centres d'intérêt, savoir-faire/savoir-être, compétences par domaines), l'**auto-évaluation linguistique CECRL** et le **style d'apprentissage** (24 items, 4 profils) du livret sont saisissables et éclairent le projet (complément du PCM, qui reste l'outil maître) | DOC (livret parcours) | A | Sections saisissables ; style d'apprentissage restitué avec ses implications pédagogiques |
| EXG-33 | Chaque entretien/action porte son **auteur** ; le filtre « mes salariés » (CIP référent, existant) s'applique à toutes les nouvelles vues | MÉT + code existant | A | `created_by` systématique ; filtre opérationnel sur tableau de bord, actions, entretiens |
| EXG-34 | Le **bloc alertes** consolide : jalon en retard, prochain entretien non planifié, Pass IAE expirant, cumul CDDI approchant 24 mois, renouvellement à préparer, action critique en retard, titre de séjour/visite médicale/RQTH expirant | CDC + CONV + code existant | A | Alertes visibles tableau de bord + fiche ; seuils paramétrables |

### C. RGPD et conformité des données

| # | Exigence | Source | Prio | Critère d'acceptation vérifiable |
|---|---|---|---|---|
| EXG-35 | Une entrée **registre RGPD** couvre le traitement étendu (finalités, catégories art. 9/10, destinataires, durées, sous-traitance IA) avant mise en production | RÉG (RGPD art. 30) | O | Entrée créée dans `rgpd_registre` ; revue DPO tracée |
| EXG-36 | **Minimisation à la conception** : aucun champ NIR, IBAN/BIC, ID CAF ; ID France Travail uniquement si validé par la direction ; santé/judiciaire limités à l'impact professionnel ; restitutions externes en données réduites (tranches d'âge, nationalité en 3 classes) | RÉG (art. 5-1-c) + doctrine ERP | O | Revue du schéma : champs absents ; grep négatif sur `nir`/`social_security` dans les nouvelles tables |
| EXG-37 | Les données **santé** (art. 9) sont limitées au déclaratif à impact professionnel (contre-indications, RQTH + échéance, mutuelle O/N, suivi O/N) ; champs texte chiffrés applicativement (pattern PCM) ou décision contraire documentée | RÉG (art. 9) | O | Champs conformes ; chiffrement vérifié en base ou arbitrage écrit |
| EXG-38 | Le **frein judiciaire** (art. 10) ne stocke que le niveau 1-5 et un impact organisationnel factuel déclaré ; jamais la nature des faits/condamnations ; visible uniquement ADMIN/RH ; exclu par défaut des restitutions, export nominatif en variante « colonnes sensibles » explicitement demandée | RÉG (art. 10, art. 46 LIL) | O | Test d'accès MANAGER/AUTORITE → rien ; export par défaut sans la colonne ; libellé d'aide à la saisie rappelant l'interdit |
| EXG-39 | La **matrice d'habilitations** du § 6.2.3 est implémentée et couverte par des tests automatisés (pattern `backend/tests/contract/`) | RÉG + code existant | O | Tests verts : chaque rôle voit exactement son périmètre |
| EXG-40 | Les **durées de conservation** du § 6.3 sont paramétrées dans la purge planifiée ; `services/anonymization.js` est étendu à toutes les nouvelles tables (entretiens, objectifs, actions, PMSMP, pass IAE, questionnaires) | RÉG (référentiel CNIL 2023) + code existant | O | Purge testée sur un dossier fictif : données nominatives anonymisées à J+2 ans après dernier contact ; agrégats préservés |
| EXG-41 | L'**information des salariés** est effective : note d'information à jour (finalités, droits, DPO, assistance IA), remise tracée, mention sur les PDF | RÉG (art. 13) | O | Note versionnée dans la doc ; mention présente sur les PDF générés |
| EXG-42 | Tout appel **IA** sur des données de parcours passe par `pii-pseudonymize` ; sorties étiquetées « proposition » ; supervision humaine ; conformité déployeur **AI Act** (information des salariés, journalisation) vérifiée par le DPO | RÉG (RGPD art. 22 ; règl. UE 2024/1689) + code existant | O | Revue de code : aucun appel LLM sans pseudonymisation ; journal des générations IA |
| EXG-43 | Les **exports nominatifs** (dont tableau § 5) sont réservés ADMIN/RH, chaque génération journalisée (`rgpd_audit_log`) ; une **variante agrégée non nominative** existe pour toute transmission externe | RÉG + CONV | O | Log présent après export ; variante agrégée téléchargeable |
| EXG-44 | Aucune donnée nominative du corpus (structure sœur) dans le code, les seeds, les tests ou la documentation | RÉG + consigne mission | O | Grep négatif sur les noms du corpus dans le dépôt |

### D. Cohérence et paramétrage

| # | Exigence | Source | Prio | Critère d'acceptation vérifiable |
|---|---|---|---|---|
| EXG-45 | Une **rubrique linguistique** est ajoutée au diagnostic (auto-éval CECRL simplifiée + observations CIP) pour que le frein linguistique exporté repose sur une évaluation réelle | CDC (export) + DOC (livret) | O | Rubrique présente ; frein linguistique calculable depuis la saisie |
| EXG-46 | Tous les libellés hérités d'ODS sont **adaptés à ST** (postes, mutuelle, PEE, complément d'heures) après confirmation par la direction de la liste des avantages ST | DOC + CDC | O | Recette : aucun libellé ODS ; liste des avantages validée par écrit |
| EXG-47 | Les **objectifs conventionnels** (annexe financière : ETP, sorties) sont saisis en `settings` après confirmation par la direction sur le PDF original ; aucun objectif codé en dur ; tant que non confirmés, affichage « objectif non paramétré » | CONV + doctrine ERP (KPI honnêtes) | O | Settings dédiés ; dashboard sans valeur inventée |
| EXG-48 | La **migration de l'existant** est sans perte : diagnostics, jalons M+1/M+3/M+6/M+10/Sortie, actions et scores de freins actuels restent lisibles dans le nouveau modèle (les 5 types historiques deviennent des occurrences du modèle étendu) | code existant | O | Après migration : les parcours existants s'affichent intégralement ; tests de non-régression sur `/insertion/*` verts |

---

## 8. Points à arbitrer par la direction avant le plan de codage

1. **Radar 9 axes vs 7 axes** (§ 4.3) : recommandation 9 axes (conserve famille + numérique, ajoute logement + judiciaire) avec export 7 freins CDC. Si la direction veut strictement 7, décider du sort de l'historique famille/numérique.
2. **Objectifs conventionnels chiffrés** (§ 2.3) : confirmer sur le PDF original la lecture 82,60 % dynamiques = 54,30 durable + 17,40 transition + 10,90 positives (somme exacte), et la base « 46 ». Ne rien paramétrer avant.
3. **FSE+** : la structure émarge-t-elle à un cofinancement FSE+ (direct ou via CD76) ? Conditionne EXG-12 et les durées d'archivage.
4. **« Convergence »** : préciser s'il s'agit du réseau Convergence France (programmes PHC/CVG — reporting spécifique à intégrer) ou d'un autre organisme.
5. **Avantages ST** dans le questionnaire (mutuelle d'entreprise, PEE ou non) — la trame ODS propose PEE et mutuelle ODS.
6. **ID France Travail** : le stocker (utile aux démarches CIP) ou non (minimisation stricte) ; recommandation : oui, ID CAF non, NIR jamais.
7. **Frein judiciaire dans l'export nominatif** : par défaut exclu (variante sensible sur demande) ou inclus — recommandation : exclu par défaut.
8. **NOM/Prénom** : 1 ou 2 colonnes dans l'export (verbatim ambigu : 23 champs listés pour « 22 colonnes » annoncées).
9. **Vue salarié « Mon parcours »** (EXG-31) : activer ou non à ce stade.
10. **Signature** : validation par compte + PDF signé papier (recommandé, simple) vs signature tactile sur écran (plus lourd).

---

## 9. Sources

**Réglementaires et doctrine (consultées le 22/07/2026)**
- Code du travail, art. L.5132-15-1 (CDDI, 24 mois, dérogations, 60 mois ACI) : [Légifrance](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000042674137) ; [code.travail.gouv.fr](https://code.travail.gouv.fr/code-du-travail/l5132-15-1)
- PMSMP, art. L.5135-1 à L.5135-8 : [Légifrance](https://www.legifrance.gouv.fr/codes/id/LEGISCTA000028698637) ; Questions/Réponses DGEFP PMSMP : [DREETS Grand Est](https://grand-est.dreets.gouv.fr/sites/grand-est.dreets.gouv.fr/IMG/pdf/qr4.pmsmp.pdf)
- Pass IAE — fonctionnement et validité 2 ans : [Documentation de l'inclusion](https://documentation.inclusion.beta.gouv.fr/doc/emplois/pass-iae-comment-ca-marche/) ; prolongation (fenêtre 7 mois, bilan à transmettre) : [Aide des emplois de l'inclusion](https://aide.emplois.inclusion.beta.gouv.fr/hc/fr/articles/14738994643217--Prolonger-un-PASS-IAE) ; critères d'éligibilité (niveau 1 / 3× niveau 2) : [Aide des emplois de l'inclusion](https://aide.emplois.inclusion.beta.gouv.fr/hc/fr/articles/14733921254161--Les-crit%C3%A8res-d-%C3%A9ligibilit%C3%A9-IAE) ; diagnostic socio-professionnel de référence : [Aide des emplois de l'inclusion](https://aide.emplois.inclusion.beta.gouv.fr/hc/fr/articles/14733750518161--Diagnostic-socio-professionnel-de-r%C3%A9f%C3%A9rence) ; outil Diagnostic Parcours IAE : [Communauté de l'inclusion](https://communaute.inclusion.beta.gouv.fr/surveys/dsp/create/)
- Questions-réponses réforme du parcours IAE (DGEFP, 22/12/2021) : [DREETS Grand Est](https://grand-est.dreets.gouv.fr/sites/grand-est.dreets.gouv.fr/IMG/pdf/questions-reponses_parcours_iae_et_plateforme_inclusion_vf-2.pdf)
- Indicateurs « emploi » IAE (sorties dynamiques : durable / transition / positive ; références 60 %/25 %) : [Annexe 4, DREETS Bretagne](https://bretagne.dreets.gouv.fr/sites/bretagne.dreets.gouv.fr/IMG/pdf/Annexe_4_indicateurs_emploi.pdf)
- Diagnostic global France Travail (loi plein emploi) : [Le Média Social](https://www.lemediasocial.fr/reforme-france-travail-le-diagnostic-global_O1RQJh)
- CNIL — Référentiel durées de conservation secteur social et médico-social (base active 2 ans après dernier contact) : [PDF CNIL](https://www.cnil.fr/sites/cnil/files/2023-11/referentiel_durees_de_conservation_social_et_medico-social.pdf) ; [page de présentation](https://www.cnil.fr/fr/durees-de-conservation-dans-le-secteur-social-et-medico-social-la-cnil-publie-un-referentiel-et-une)
- FSE+ — questionnaire participant et obligations de recueil : [DREETS Bretagne](https://bretagne.dreets.gouv.fr/Questionnaire-participant) ; Programme national FSE+ Emploi-Inclusion : [fse.gouv.fr](https://fse.gouv.fr/sites/default/files/projects_pdf/20240108_code-1466_global.pdf)
- Convergence France (programmes PHC / CVG en ACI) : [convergence-france.org](https://convergence-france.org/actu/des-nouvelles-de-marseille/)

**Conventionnelles et internes** : convention pluriannuelle ACI 2026-2028 n° C076ACI262800008 (art. 3.1-3.4, 4, 5, 8, 10) ; annexe financière ACI076260005A0M0 (lecture prudente § 2.3) ; trame « Fiche Diagnostique » 9 rubriques ; Livret de parcours ; formulaires bilan / renouvellement / satisfaction ; 4 procédures du processus d'insertion ; règlement intérieur (DPO) ; classeurs R'PUR (structure uniquement).

**Code** : `backend/src/scripts/init-db.js` (tables `insertion_*`, `cip_action_plans`, `employees`) ; `backend/src/routes/insertion/engine.js` (freins, jalons, CDDI) ; CLAUDE.md (historique 2.2.0 → 2.9.0).

---

*Rapport établi par l'agent « garant du cahier des charges ». Prochaine étape prévue par la mission : plan d'action et plan de codage couvrant EXG-01 à EXG-48, puis passes UX/CIP et audit Convergence/DDETS — après validation des arbitrages du § 8 par la direction.*
