# Cahier des charges — Extension du module Insertion (historique des entretiens) & Label RSEi

- **Date** : 22 juillet 2026
- **Émetteur** : Julien Gondé (direction)
- **Branche de travail** : `claude/insertion-module-entretiens-ehli4m`
- **Statut** : cadrage — livrables d'étude à valider AVANT toute implémentation (pas de PR sans validation)

Ce document fige la demande initiale **verbatim** (section A), le manifeste du corpus documentaire fourni (section B) et les premières notes de lecture de l'orchestrateur (section C). Il sert de référence unique à tous les agents de la mission.

---

## A. Demande initiale (verbatim)

> **Extension du module Insertion avec historique des entretiens :**
> Dans le cadre de notre activité d'accompagnement des publics en insertion, les CIP réalisent régulièrement des échanges avec les collaborateurs.
> Nous devons renforcer la partie insertion de nos parcours.
>
> ### 1. Renforcement du suivi du parcours
>
> Le module de suivi des parcours d'insertion n'est pas assez visuel. Je te propose de le revoir.
> Un parcours d'insertion c'est quoi ?
>
> **• Une embauche** (test technique, test de personnalité, entretien d'embauche)
>
> Cette partie est plutôt bien documentée dans l'application.
> Tu vas embaucher un agent pour étudier les évolutions possibles pour répondre à la promesse d'un logiciel de recrutement intégré dans une optique de suivi du parcours d'insertion des collaborateurs recrutés.
> Une fois embauché, le candidat devient un collaborateur accompagné. Nous avons déjà traité le passage technique du statut de candidat à collaborateur.
>
> **• Un diagnostic d'accueil**
>
> Ce diag est un point clé du parcours.
> D'abord il répond à une obligation réglementaire, ensuite parce qu'il va conditionner les actions, le calendrier, les jalons et étapes du parcours d'insertion.
> Je te joins dans ce message et dans le suivant un ensemble de documents et d'informations qui cadrent la conduite des parcours d'insertion.
> Le logiciel doit permettre de couvrir ce champ fonctionnel et de soutenir la CIP dans son travail de détection et d'approche du collaborateur.
> Pour cela, tu vas revoir le questionnaire de suivi de l'entretien d'accueil. Il doit reprendre les éléments proposés dans ma documentation, les 7 freins actuels, le diagramme de valorisation des freins.
> Aussi cet entretien permet de définir des objectifs. Chaque objectif peut avoir des sous-objectifs, des échéances et des dates butoirs. Les objectifs sont individualisés.
> À la sortie de l'entretien, la CIP doit établir son plan d'action. Chaque action de la CIP a une catégorie, une criticité et une échéance.
>
> **• Des diagnostics intermédiaires**
>
> Les bilans intermédiaires sont d'une fréquence à définir par la CIP en fonction du parcours individualisé. Chaque bilan commence par une évaluation du bilan précédent dont l'évolution de la situation des freins (évolution de la toile d'araignée).
> Une analyse du plan d'action (OK/Non OK, respect des échéances et des priorités…).
> Planification du prochain entretien.
>
> **• Audit et bilan de sortie**
>
> C'est un entretien obligatoire. Il doit reprendre la synthèse de l'évolution du parcours d'insertion dans la structure, de l'évolution des freins et des actions restant à réaliser par le collaborateur.
>
> D'une manière générale, dans le processus fonctionnel de l'application, la partie insertion doit être revue comme suit :
>
> - **Tableau de bord** (avec notamment les indicateurs de qualité légaux et de notre convention)
> - **Tableau de synthèse des actions CIP + tableau d'export des freins** avec :
>   NOM Prénom / Nationalité / Date d'entrée ACI / Fin PASS IAE / Heures par semaine / Genre / Date de naissance / RQTH / Niveau de formation / Ressources / Logement / Commune de résidence / Situation familiale / Frein linguistique / Frein santé / Frein logement / Frein administratif / Frein financier / Frein judiciaire / Frein mobilité / PMSMP / Projet de formation / Emploi visé
> - **Accès à la fiche individualisée de chaque salarié** :
>   - Dans chaque fiche salarié : une frise chronologique des entretiens, jalons, objectifs, début et fin de contrat
>   - L'accès aux bilans et entretiens
>   - Commentaires et actions de la CIP
>   - Analyse IA
>
> L'initialisation des jalons se fait automatiquement au moment du passage de candidat à collaborateur et s'actualise après chaque bilan. L'actualisation peut se faire manuellement depuis la fiche individuelle.
> Chaque entretien est préparé par l'IA pour simplifier le travail préparatoire de la CIP.
>
> D'abord tu vas embaucher un agent qui s'assure du respect du cahier des charges ci-dessus, du respect réglementaire, de la preuve de la promesse du logiciel, des pratiques et usages du métier de CIP dans les ACI.
> Ensuite tu vas proposer le plan d'action et le plan de codage des nouvelles fonctionnalités et évolutions.
> Ensuite tu vas prendre un persona chargé de projet UX et fonctionnalité logiciel avec un persona CIP. Tu t'assures de l'adaptation des fonctionnalités et visuels du logiciel pour répondre aux besoins de l'utilisateur final.
> Enfin tu prends le persona d'un chargé de mission Audit chez Convergence ou à la DDETS pour t'assurer du respect réglementaire de nos pratiques, du respect de nos obligations envers les bénéficiaires, de notre reporting et notre démarche qualité.
>
> ### 2. Label RSEi
>
> Notre structure s'engage pour obtenir le label RSEi. Je te joins la documentation support de ce label.
> - Tu embauches un agent en charge de la rédaction méthodologique de l'agent de supervision et d'audit de la RSE dans notre structure et de son application dans Solidata.
> - Tu embauches un agent en charge de l'analyse et de l'étude de la certification de Solidata au label RSEi.
> - Tu embauches un agent en charge de l'évaluation et de l'édition d'un plan d'action pour faire évoluer la qualité de notre certification par les usages couverts dans Solidata. Tu peux être large dans ton approche fonctionnelle du logiciel.
>
> ### 3. Documentation
>
> Tu établis une documentation pour les CIP pour l'utilisation du logiciel, une note pour nos organes de certification (Convergence, DDETS notamment) et un outil d'analyse de la performance de la pratique des CIP.
>
> Tu es un chef d'orchestre et tu organises le travail des différents agents. Tu peux utiliser les modèles, compétences nécessaires. Tu m'interroges si nécessaire. **Nous validons avant écriture d'un PR.**

---

## B. Corpus documentaire fourni (20 documents uniques)

Textes extraits automatiquement pour l'analyse (les originaux restent hors dépôt).

| # | Document | Type | Rôle dans la mission |
|---|----------|------|----------------------|
| 1 | Label RSEi — Dispositif de labellisation v3 | | Processus de labellisation RSEi |
| 2 | Référentiel RSEi 2026 | | Référentiel d'exigences du label |
| 3 | Livret parcours insertion professionnelle | DOCX | Livret bénéficiaire : identité, freins, portefeuille de compétences, style d'apprentissage, projet métier |
| 4 | Diagnostic Socio-Professionnel (+ variante ODS) | | Trame officielle du diagnostic d'accueil (9 rubriques) |
| 5 | Procédure accompagnement socioprofessionnel | | Processus d'insertion partie 2 |
| 6 | Procédure suivi du parcours | | Processus d'insertion partie 3 |
| 7 | Procédure retour à l'emploi | | Processus d'insertion partie 4 (incl. suivi post-sortie 3-6 mois) |
| 8 | Procédure recrutement | | Processus d'insertion partie 1 (rôles Encadrant/Directeur/CIP/Assistante) |
| 9 | Formulaire bilan d'entretien | DOCX | Trame actuelle du bilan de suivi (situation, objectifs, freins, progression, actions) |
| 10 | Formulaire renouvellement de contrat | DOCX | Évaluation encadrant → réunion de renouvellement (avis, durée, triple signature) |
| 11 | Formulaire satisfaction sortie de contrat | DOCX | Questionnaire qualité de sortie (smileys + situation à la sortie) |
| 12 | Suivi de parcours (exemple réel, structure sœur R'PUR) | XLSX | Grilles compétences /10 par filière, volet accompagnement, SWOT, plans d'action, journal d'actions avec partenaires |
| 13 | Bilan de parcours (exemple réel, structure sœur R'PUR) | XLSX | Évaluations périodiques 1-6 / 6-12 / 12-18 / 18-24 mois, observations encadrant + objectifs, COA, triple signature |
| 14 | Convention ACI C076ACI262800008 | | Convention DREETS de la structure |
| 15 | Annexe financière ACI076260005A0M0 | | Postes conventionnés, ETP, aides, **objectifs conventionnels** 2026-2028 |
| 16 | Livret d'accueil collaborateur | | Accueil / intégration |
| 17 | Règlement intérieur | | Cadre disciplinaire et de vie |
| 18 | Sécurité et santé au travail | | Volet QHSE |
| 19 | Présentation Solidarité Textiles | | Présentation générale de la structure |
| 20 | Procédure « PESTEL » (référencée dans le suivi du parcours) | — | Non fournie (référence dans le doc 6) |

**⚠ RGPD** : les documents 12 et 13 contiennent des données personnelles réelles de salariés d'une structure sœur. Ils sont exploités uniquement pour leur **structure** (rubriques, grilles, workflow). Aucune donnée nominative ne doit apparaître dans les livrables.

---

## C. Notes de lecture structurantes (orchestrateur)

1. **La trame « Fiche Diagnostique » comporte 9 rubriques** : I. Identité — II. Logement — III. Accès aux droits et vie administrative — IV. Santé — V. Budget — VI. Mobilité — VII. Situation professionnelle — VIII. Projet professionnel — IX. Contrat d'insertion et réalisation de soi (attentes/difficultés/objectifs exprimés par le salarié). Chaque rubrique se termine par un commentaire libre CIP. La trame provient d'une structure sœur (« ODS », postes propreté urbaine) : elle devra être **adaptée aux postes et avantages de Solidarité Textiles** (tri, collecte, boutique ; mutuelle/PEE propres à ST).
2. **Le processus d'insertion est formalisé en 4 procédures** : Recrutement → Accompagnement socio-professionnel (création du dossier + livret, analyse des freins, projet professionnel, calendrier de RDV) → Suivi du parcours (contrôle délais/objectifs, CV/LM, préparation entretiens) → Retour à l'emploi (simulation d'entretien, entretien de fin de parcours, transmission documents STC/certificat/attestation France Travail, **prise de contact 3 à 6 mois post-départ**, bilan de fin d'année).
3. **Le bilan d'entretien actuel** (formulaire Word) structure : situation actuelle (administrative/sociale/professionnelle/nouveaux éléments) → objectifs (du jour, du prochain entretien) → démarches réalisées/non réalisées avec raisons → freins (sociaux/professionnels/personnels) → motivations → **évaluation de progression et d'autonomie (3 niveaux)** → points de vigilance → actions à mener avec échéances → date du prochain point → double signature (salarié + CIP).
4. **Le suivi Excel actuel** (à remplacer) ajoute : grilles de compétences métier notées /10 par filière **avec observations et objectifs de l'encadrant technique (ETI)**, volet « accompagnement social et professionnel » noté (assiduité RDV, autonomie démarches, objectifs d'entretiens, informatique, projet pro, CV/LM/TRE, enquêtes métiers, PMSMP — valeur N/E possible), SWOT à l'entrée, besoins exprimés, plans d'action numérotés, COA (contrat d'objectifs), bilan de parcours rédigé, **journal d'actions : item / besoin / action réalisée + date / partenaire mobilisé (CAF, France Travail, ANTS, SOLIHA, bailleurs, OPCO…) / résultat**, évaluations périodiques par tranche de 6 mois, triple signature (salarié/ETI/CIP).
5. **Renouvellement de contrat** : formulaire rempli par l'encadrant, transmis à la CIP pour la réunion de renouvellement (assiduité, motivation, autonomie, participation aux actions, projet pro, motifs, avis favorable/réservé/défavorable, durée 2/4/6 mois, signatures encadrant/CIP/directeur). C'est un **jalon de parcours à part entière**.
6. **Satisfaction de sortie** : questionnaire bénéficiaire (accueil, accompagnement, compétences, conditions de travail, bilan personnel, situation à la sortie, satisfaction globale, suggestions) — boucle **démarche qualité** exploitable pour Convergence/DDETS et le label RSEi.
7. **Annexe financière 2026-2028** : référente ASP Aline Roix ; ~42-46 postes / ~24,8-26 ETP conventionnés ; l'extraction brute (PDF formulaire) rend les intitulés illisibles — les **objectifs conventionnels chiffrés (p. 3 : 46 / 82,60 / 54,30 / 17,40 / 10,90) devront être confirmés avec la direction** avant paramétrage du tableau de bord.
8. **Livret parcours** : collecte le NIR — conformément à la doctrine de minimisation déjà actée dans SOLIDATA (import paie), le **NIR ne sera pas stocké** dans le module.
9. Les 7 freins cités par le CDC (linguistique, santé, logement, administratif, financier, judiciaire, mobilité) correspondent au radar déjà présent dans le module ; la trame diagnostic couvre en outre droits/administratif, budget, projet professionnel — la correspondance rubriques ↔ freins est un point de conception clé.
