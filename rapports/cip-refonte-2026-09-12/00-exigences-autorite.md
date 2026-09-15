# Refonte du module CIP — Synthèse des exigences de l'autorité de tutelle

> Chantier `cip-refonte-2026-09-12`. Source : trois documents transmis par la structure le 12/09/2026,
> rédigés par Fariza D'André (référente institutionnelle) — mises à jour juin/juillet/septembre 2026.
> Ce fichier est la lecture STRUCTURÉE de ces documents (le PDF est un scan OCRisé : les chiffres ont été
> relus à l'image). Il sert de référence unique aux personas, au plan d'action et à la matrice de reporting.

## Document 1 — « Les évolutions pour les BRSA en Seine-Maritime » + « Le CER » (sept. 2026)

### Cadre : loi Plein Emploi, expérimentation départementale Seine-Maritime
| Réf. | Exigence / fait institutionnel | Conséquence pour une SIAE (ACI) |
|------|-------------------------------|---------------------------------|
| A1 | **Inscription automatique à France Travail** de tous les bénéficiaires du RSA depuis le 01/01/2025 | Tout salarié BRSA est un demandeur d'emploi inscrit ; son identifiant FT et sa catégorie statistique existent |
| A2 | Un **orienteur unique** désigne le parcours : recherche d'emploi (conseiller FT) OU accompagnement social / socioprofessionnel (Département ou **structure partenaire**) | La SIAE peut être **référent unique** d'un BRSA ; il faut savoir, pour chaque salarié, QUI est son référent unique et QUI l'a orienté |
| A3 | Si le référent est FT : **actualisation mensuelle** de la situation | Rappel mensuel à tracer pour les salariés dont le référent est FT (rupture de droits sinon) |
| A4 | **CER ou PPAE obligatoire**, objectif moyen **15 à 20 h/semaine** d'activités d'insertion (formations, ateliers CV, PMSMP, job datings…), étapes sur mesure selon contraintes (garde d'enfants, santé, transports) | Le volume d'activité hebdomadaire doit être **comptabilisable et justifiable** (heures de travail CDDI + heures d'accompagnement + ateliers + PMSMP) |
| A5 | Accompagnement local : conseillers dédiés en **CMS** (logement, santé, mobilité), forums, coaching, **job datings** secteurs en tension | Les partenaires CMS et les événements Job 76 sont des **actions CIP** à rattacher aux parcours |
| A6 | **DTR trimestrielle** CAF/MSA obligatoire ; non-respect des engagements → **conciliation** puis **suspension-remobilisation** | La SIAE doit pouvoir **documenter l'assiduité et les motifs légitimes** d'absence (protéger le salarié d'une sanction) |

### Le Contrat d'Engagements Réciproques (CER)
| Réf. | Contenu du CER | Ce que SOLIDATA doit savoir produire |
|------|----------------|--------------------------------------|
| C1 | Rédigé en **entretien individuel** avec le référent unique | Un type d'entretien « CER / point d'étape CER » |
| C2 | **Diagnostic partagé** : compétences, expériences, difficultés matérielles/personnelles (logement, santé, garde d'enfants, mobilité) | Le diagnostic d'accueil 12 rubriques + 9 freins existe : il doit être **exportable au format CER** |
| C3 | **Co-construction** : démarches réalistes et réalisables | Objectifs individualisés à origine « salarié » (existe) |
| C4 | Engagements du bénéficiaire : actions d'insertion, volume 15-20 h, présence aux RDV, informer de tout changement | Objectifs + actions + assiduité + **journal des changements de situation** |
| C5 | Engagements Département/FT : accompagnement sur mesure, **aides financières/matérielles** (mobilité, transport, garde), orientations partenaires (santé, logement, PME), **points d'étape réguliers** | Actions CIP typées « aide mobilisée » avec montant/nature ; partenaires ; entretiens |
| C6 | Durée **6 à 12 mois**, renouvelable après **bilan** ; signé par les deux parties ; **exemplaire remis** ; **avenant** à tout moment | Document CER daté, versionné (avenants), trace de remise (existe pour le diagnostic : `remise_salarie`) |
| C7 | Non-respect → **entretien de conciliation** → suspension-remobilisation | Un type d'entretien « conciliation » + trace des motifs légitimes |

## Document 2 — « La Plateforme de l'inclusion, focus sur ses outils » (sept. 2026)

| Réf. | Outil | Fonction | Ce que SOLIDATA doit savoir faire (sans doublonner l'outil d'État) |
|------|-------|----------|--------------------------------------------------------------------|
| P1 | **Les Emplois de l'inclusion** | Guichet unique candidatures IAE ; **PASS IAE 24 mois** ; pour la SIAE : publication d'offres, **auto-prescription & éligibilité** (critères IAE : BRSA, DELD, jeunes…), **gestion PASS IAE** (édition, suspension, prolongation auprès de la DDETS), **pilotage** (échéances PASS + fins de contrat → anticiper sorties dynamiques) ; prescripteurs habilités (FT, CMS, Mission Locale, Cap Emploi) orientent et suivent l'état (reçue / retenue / refusée) | Stocker pour chaque personne : **critères d'éligibilité IAE cochés**, **n° PASS IAE + dates + statut (actif / suspendu / prolongé)**, **prescripteur habilité ou auto-prescription**, **état de la candidature** ; alerter sur les échéances (existe partiellement) ; **suspension** du PASS (nouveau) |
| P2 | **DORA** | Annuaire national des services d'insertion ; recherche par territoire (garde d'enfants horaires décalés, mobilité inclusive, bilan de santé, ateliers budget, FLE) ; **orientation directe** avec transmission sécurisée ; disponibilité temps réel | Chaque **frein** doit pouvoir être relié à une **orientation DORA** (lien vers la fiche service + date + résultat) — partenaires « services DORA » |
| P3 | **RDV-Insertion** | Prise de RDV d'orientation BRSA, invitations SMS/mail, lutte contre l'absentéisme aux entretiens | Convocations aux entretiens avec **rappel SMS/mail** (Brevo existe) + trace **présent / absent / motif** |
| P4 | **Mon Récap** | Partage des **bilans de parcours** et **traçabilité des étapes** entre professionnels | Export d'un **récapitulatif de parcours** partageable (étapes datées, sans données art. 9/10) |
| P5 | **Marché de l'inclusion** | Achats inclusifs (acheteurs ↔ SIAE) | Hors module CIP (module Achats responsables / commercial) |

## Document 3 — « Du nouveau pour les SIAE en 2026 » + « MDFSE = Ma Démarche FSE+ » (juin/juillet 2026)

### Contexte départemental et logique de financement
| Réf. | Fait | Conséquence |
|------|------|-------------|
| S1 | **Circulaire FIE** : souplesse de la DDETS 76 pour répartir les crédits IAE / EA / contrats aidés ; consigne de **renforcer massivement les PMSMP** | Les PMSMP deviennent un **indicateur de performance** attendu (nombre, durée, débouchés) |
| S2 | **Renouvellement des conventions ACI 2026-2027** (AAP du Département) : financements ciblés sur le **renforcement des postes CIP et encadrants** pour la **levée des freins périphériques chez les BRSA** | L'autorité voudra voir : effectif BRSA, freins identifiés, freins levés, actions par frein |
| S3 | **Accompagnement Social Intensif (ASI)** cofinancé FSE+ 2026-2027 pour les publics les plus vulnérables | Un **projet FSE+ = une cohorte de participants** identifiée dans l'outil |
| S4 | Catégories statistiques FT **F (sociale, freins majeurs)** et **G (attente d'orientation)** ; « les SIAE adaptent leurs outils de diagnostic » ; pression sur le suivi des parcours pour **éviter les ruptures de droits** | Enregistrer la **catégorie FT** de chaque salarié à l'entrée ; alerter sur les dossiers « en attente » |
| S5 | Primo-arrivants (AAP DREETS) : **FLE à visée professionnelle**, formations courtes, freins périphériques, volont'R | Frein linguistique (CECRL existe) + actions formation FLE |
| S6 | Job 76 « Démarquez-vous », SEVE Emploi 2027 (parcours vers l'emploi durable avec employeurs privés) | Actions CIP « job dating », « relation entreprise » |
| S7 | Logique **« performance »** : l'État finance une **trajectoire de sortie** ; financements conditionnés à l'efficacité du retour à l'**emploi durable** ; immersions en entreprise | Indicateurs de sorties dynamiques **et** de trajectoire (PMSMP → emploi) |

### FSE+ : mécanique et obligations de traçabilité
| Réf. | Règle FSE+ (Ma Démarche FSE+) | Ce que SOLIDATA doit produire |
|------|-------------------------------|-------------------------------|
| F1 | Cofinancement ~**60 % UE / 40 %** Département (ASI BRSA) — si le Département baisse d'1 €, l'UE baisse au prorata | Hors module CIP (Finance) — mais le **rattachement des salariés au projet FSE+** est la base du calcul |
| F2 | **OCS** : forfait (ex. 40 % sur les coûts salariaux des CIP) OU coût réel | Savoir quels **postes** (CIP, encadrants) sont affectés au projet |
| F3 | **Contrôle du temps passé** : **feuilles de temps ultra-précises** des CIP/encadrants **au prorata du temps réellement dédié au projet** ; une signature manquante ou une incohérence avec les congés **bloque le paiement** | **Nouveau besoin** : feuille de temps CIP par projet cofinancé (temps d'accompagnement par salarié / par activité), cohérente avec les congés (`employee_leaves`) et signable |
| F4 | Remboursement sur factures acquittées : **avance 30 %**, acomptes sur **bilan intermédiaire** (jusqu'à 70-80 %), **solde après Contrôle de Service Fait** (6-12 mois) ; délai global **18-24 mois** | Hors module CIP (trésorerie) — mais le **bilan d'exécution** doit pouvoir être **composé depuis l'outil** |
| F5 | **Dossier individuel strict par participant** : prouver l'**éligibilité à l'entrée** (statut RSA, demandeur d'emploi), **suivi à la sortie ET à +6 mois** (emploi durable / formation / inactivité) — ce sont les indicateurs de résultat qui **valident la subvention** | Pièces justificatives d'éligibilité rattachées au dossier ; **questionnaire de sortie** ; **suivi post-sortie à 6 mois** systématique et **saisi** |
| F6 | **Questionnaire d'entrée** sur la situation socio-professionnelle **dès l'arrivée** | Le bloc `fse_entree` existe : à compléter et à rendre **obligatoire à l'embauche** pour les participants FSE+ |
| F7 | **Statut de sortie saisi dans le mois suivant le départ**, sinon la plateforme **bloque le dépôt des bilans financiers** | Alerte « sortie non renseignée » J+15 / J+25 après fin de contrat |
| F8 | Bilan d'exécution ≤ **6 mois** après la fin de période ; CSF vérifie fiches de paie, feuilles de temps, cofinancements, **questionnaires entrée/sortie complets** | Export « bilan d'exécution FSE+ » : participants, indicateurs entrée/sortie, taux de complétude |

## Ce que l'autorité attend en REPORTING (lecture consolidée)
1. **Qui accompagnons-nous ?** Critères d'éligibilité IAE, statut BRSA, catégorie FT (F/G), prescripteur/orienteur, référent unique, PASS IAE (n°, dates, suspensions, prolongations).
2. **Que faisons-nous avec eux ?** Diagnostic partagé, freins identifiés et **levés**, CER/PPAE (engagements, 15-20 h, points d'étape, avenants), actions (formations, ateliers, PMSMP, job datings, orientations DORA/CMS, aides mobilisées), assiduité et motifs légitimes.
3. **Avec quel résultat ?** Sorties par catégorie (emploi durable / transition / positive / autre), **trajectoire** (PMSMP → emploi), suivi **à +6 mois**, satisfaction.
4. **Avec quels moyens ?** ETP conventionnés (ASP), temps CIP/encadrants **par projet FSE+**, cohérence avec la paie et les congés.
5. **Quand ?** Questionnaire d'entrée dès l'arrivée, sortie dans le mois, bilan d'exécution à 6 mois, bilans CER à 6-12 mois, actualisation mensuelle FT.

## Ce que ces documents NE disent PAS (à arbitrer avec le client)
- La structure est-elle **référent unique** de ses salariés BRSA (donc rédige-t-elle le CER) ou seulement **structure d'accueil** (le CER est tenu par le CMS/FT et la SIAE alimente le référent) ?
- Quel(s) **projet(s) FSE+** la structure porte-t-elle en 2026-2027 (ASI ? postes CIP en OCS ?) et quels salariés y sont rattachés ?
- Le **format exact** du questionnaire MDFSE+ entrée/sortie (liste des questions) n'est pas dans les documents — il faudra le récupérer sur la plateforme ou auprès de la gestionnaire.
- Les **15-20 h** : le temps de travail CDDI compte-t-il dans le volume d'activité ? (Un CDDI à 26 h le dépasse ; c'est alors le **hors-temps-de-travail** qui doit être documenté.)
