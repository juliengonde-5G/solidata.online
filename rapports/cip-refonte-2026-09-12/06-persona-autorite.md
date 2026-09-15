# Regard de l'autorité de tutelle sur SOLIDATA — module Insertion

> **Persona** : Fariza D'André, gestionnaire au service Insertion par l'activité économique.
> J'instruis les conventions ACI de Seine-Maritime pour le compte de la DDETS 76 et du Conseil
> départemental (CD76), je conduis le dialogue de gestion annuel, je contrôle les états mensuels
> de présence ASP, j'instruis les dossiers FSE+ sur *Ma Démarche FSE+* (recevabilité, instruction
> technique, contrôle de service fait) et je suis le déploiement de la réforme du RSA issue de la
> loi pour le plein emploi.
>
> **Objet** : avis motivé sur la capacité du système d'information de Solidarité Textiles (module
> Insertion de l'ERP SOLIDATA) à produire les pièces et les indicateurs que je demande.
>
> **Date** : 12 septembre 2026.
> **Conventions concernées** : convention pluriannuelle ACI n° C076ACI262800008 (art. 3, 5, 8, 10, 12),
> annexe financière ACI076260005A0M0, et les dossiers FSE+ 2026-2027 en cours d'instruction.
>
> **Méthode** : j'ai lu la note que la structure destine aux organismes de contrôle
> (`docs/NOTE_CERTIFICATEURS_INSERTION.md`), puis j'ai demandé que l'on me montre **le code qui
> produit réellement les exports** — c'est mon métier de ne pas me satisfaire d'une déclaration
> d'intention. J'ai donc regardé `backend/src/routes/exports.js`,
> `backend/src/utils/insertion-freins-export.js`, `backend/src/routes/effectifs.js`,
> `backend/src/services/asp-parser.js`, les deux notes de reconnaissance internes (`01` et `03`) et
> la revue d'audit de juillet (`rapports/insertion-2026-07-22/07-revue-auditeur.md`).
>
> **Posture** : je ne suis **pas** informaticienne. Quand j'écris « la colonne n'existe pas », je
> restitue ce qu'on m'a montré du dépôt, comme un **fait à faire confirmer par la structure** et non
> comme une expertise technique. Quand je ne sais pas, je l'écris.

---

## 0. Avis d'ensemble, en une page

**Je n'ai jamais vu un ACI de cette taille aussi bien outillé.** La plupart des structures que
j'instruis m'envoient un classeur Excel non horodaté, reconstitué la veille du dialogue de gestion,
dans lequel je ne peux ni dater une saisie, ni savoir qui l'a faite, ni vérifier qu'elle n'a pas été
retouchée après mon appel. Ici, j'ai un entretien **gelé à la clôture** (`locked_at`), un
**historique par instantanés** (`insertion_milestones_history`), un **journal RGPD** des
consultations sensibles, et une doctrine écrite — « l'état ASP fait foi », « objectif non
paramétré » plutôt qu'un chiffre inventé. Sur le plan de la **valeur probante d'un dossier
individuel**, la structure est au-dessus du niveau moyen de mon portefeuille.

**Mais ce n'est pas la même chose que d'être en capacité de me rendre des comptes en 2026-2027.**
Et c'est là que mon avis se sépare en deux.

Les documents que j'ai transmis le 12 septembre décrivent un changement de cadre : la réforme du RSA
et le contrat d'engagement, la logique de performance des conventions ACI 2026-2027 centrées sur la
**levée des freins périphériques chez les BRSA**, et surtout un cofinancement FSE+ dont la piste
d'audit est, elle, **non négociable**. Or, sur ce nouveau cadre, l'outil n'a presque rien :

- il ne sait pas dire **qui est bénéficiaire du RSA** (le mot n'apparaît qu'une fois dans tout le
  logiciel, dans le lecteur d'états ASP, et la valeur lue n'est même pas conservée) ;
- il ne connaît **ni le CER, ni la catégorie France Travail F/G, ni le référent unique**, qui sont
  les trois notions autour desquelles tourne désormais mon suivi départemental ;
- il ne sait pas **coder les critères d'éligibilité IAE** : ils sont dans une zone de texte libre,
  ce qui veut dire qu'aucun comptage n'est possible, donc aucune typologie opposable ;
- et surtout, **le volet FSE+ est en trompe-l'œil** : le questionnaire d'entrée existe avec cinq
  questions, le questionnaire de sortie n'a **aucun écran de saisie**, le suivi de résultat est posé
  à **+3 mois** là où l'indicateur de résultat européen se mesure à **+6 mois**, et l'export
  trimestriel que l'on me destine embarque une requête d'heures qui, telle que je me la suis fait
  lire, porte sur des colonnes inexistantes — avec pour conséquence non pas une colonne à zéro, mais
  **un fichier vide, sans message d'erreur**.

Je résume ma position : **un excellent dossier individuel, un reporting institutionnel encore
inadapté à ce que je demanderai à partir du bilan 2026.** Ce n'est pas sévère : c'est la conséquence
normale d'un outil conçu sur le cadre de 2024. La plupart des manques sont des **champs à ajouter et
des dénominateurs à corriger**, pas une refonte. Je ne conditionne donc pas le renouvellement du
conventionnement à leur correction — mais je conditionne **le paiement du solde FSE+** aux
questionnaires d'entrée et de sortie complets et au suivi à six mois : là, je n'ai aucune marge
d'appréciation.

---

## 1. Ce que j'attends d'une SIAE en 2026-2027 — mes cinq moments de contrôle

Je ne « contrôle » pas en continu. Je contrôle à cinq moments précis, et à chacun j'attends des
pièces différentes, avec des délais différents et des sources qui font foi différentes. Une
structure qui comprend ces cinq moments me facilite considérablement la vie — et se facilite la
sienne.

### 1.1 Le dialogue de gestion annuel (ACI) — février/mars

**Ce que je demande, et le délai.** Le bilan N-1 et les prévisions N, **quinze jours avant la
séance** — pas la veille : il me faut le temps de rapprocher vos chiffres de mes extractions.

| Pièce ou indicateur | Source qui fait foi | Forme attendue |
|---|---|---|
| Effectifs et ETP réalisés vs conventionnés | **ASP** (états mensuels, base 1 820 h) | Tableau mensuel, 12 lignes |
| Liste des salariés en parcours de l'année (entrées, sorties, contrats) | SI de la structure, recalé sur l'ASP | Tableau nominatif, format tableur |
| Typologie des publics à l'entrée par **critère d'éligibilité IAE** | Plateforme des emplois de l'inclusion | Agrégat chiffré, pas de nom |
| Sorties de l'année par catégorie officielle + taux | SI de la structure, **exhaustivité contrôlée sur l'ASP** | Agrégat + méthode de calcul écrite |
| PMSMP : nombre, jours, entreprises, débouchés | *Immersion Facilitée* pour l'existence, SI pour le résultat | Agrégat + liste anonymisée |
| Freins identifiés à l'entrée et **freins levés** | SI de la structure | Agrégat par frein |
| Moyens d'accompagnement : ETP CIP et encadrants, volume d'heures d'accompagnement | Paie + SI | Chiffre unique, argumenté |
| Bilan de la convention (art. 5) et perspectives | Structure | Note écrite signée |

**Ce qui me fait renvoyer un dossier** : un taux de sortie sans dénominateur écrit ; un écart
inexpliqué entre l'effectif annoncé et l'effectif déclaré à l'ASP ; des chiffres qui ne se recoupent
pas d'un tableau à l'autre ; des pourcentages sans effectifs bruts. Je préfère « 7 sorties sur 19,
dont 3 en emploi durable » à « 37 % de sorties dynamiques ».

### 1.2 Les états mensuels de présence ASP — mensuel, avant le 10

**Ce que je demande.** Rien, directement : c'est vous qui saisissez dans l'extranet ASP et c'est
l'ASP qui me restitue. Mon contrôle est un **contrôle de cohérence** : je compare l'état ASP au
registre du personnel et, en cas de contrôle sur place, aux feuilles de présence.

**La source qui fait foi est l'ASP, sans discussion.** Je le dis d'emblée parce que la doctrine
écrite dans `backend/src/routes/effectifs.js` — « quand un état ASP existe pour un mois, LE CHIFFRE
ASP FAIT FOI ; le calcul SOLIDATA reste un CONTRÔLE » — est **exactement la bonne**, et je souhaite
qu'elle ne bouge jamais. C'est même la phrase que je citerai en exemple à d'autres structures.

**Ce qui me fait ouvrir un contrôle** : des heures déclarées variant de plus de 15 % d'un mois sur
l'autre sans explication ; des salariés déclarés à l'ASP absents du registre du personnel ; un taux
de réalisation ETP durablement inférieur à 85 % sans demande d'avenant. Sur ce dernier point, que la
direction m'entende bien : **sous-réaliser sans le signaler est plus pénalisant que sous-réaliser en
le signalant** — dans le premier cas je découvre l'écart au bilan, trop tard pour redéployer.

### 1.3 L'instruction FSE+ et le contrôle de service fait — en continu, puis à 6 mois

C'est là que je suis le plus rigide : je ne décide pas seule — la Commission contrôle mes contrôles,
et une dépense jugée inéligible remonte jusqu'à moi.

| Étape | Délai | Pièces |
|---|---|---|
| Recevabilité | au dépôt | Dossier, plan de financement, périmètre des participants |
| Éligibilité du participant | **à l'entrée, jamais après** | Justificatif du statut (notification RSA, attestation FT), **questionnaire d'entrée complet** |
| Suivi | continu | Feuilles de temps des personnels affectés, signées ; cohérence avec les congés |
| Sortie du participant | **dans le mois suivant le départ** | Statut de sortie saisi sur MDFSE+ |
| Résultat | **à +6 mois** | Situation constatée (emploi, formation, inactivité) |
| Bilan d'exécution | ≤ 6 mois après la fin de période | Bilan + indicateurs + pièces de dépense |
| Contrôle de service fait | 6 à 12 mois après | Vérification exhaustive ou par échantillon |

**Ce qui bloque un paiement, concrètement** (et je l'ai vu plusieurs fois cette année) : un
questionnaire d'entrée manquant pour un seul participant — le participant est retiré de l'assiette ;
une feuille de temps non signée ou incohérente avec les congés — la dépense de personnel est
écartée ; un statut de sortie non saisi dans le mois — la plateforme **bloque le dépôt du bilan
financier** pour tout le projet, pas seulement pour la personne concernée.

Un point que les structures sous-estiment : **le questionnaire d'entrée n'est pas rattrapable**. Si
la personne est partie, on ne peut plus le recueillir, et une reconstitution a posteriori est une
irrégularité — c'est pourquoi un système qui laisse sortir un participant sans questionnaire de
sortie est un **risque financier direct**.

*À confirmer sur la plateforme* : la liste exacte des items du questionnaire participant MDFSE+
2021-2027 n'est pas dans les documents que j'ai transmis — je m'engage à fournir la maquette en
vigueur. Je sais en revanche que les indicateurs communs portent sur le statut sur le marché du
travail, le niveau d'instruction, la situation du ménage, l'âge, le sexe, puis la situation à la
sortie et à six mois.

### 1.4 Le suivi de la réforme du RSA — trimestriel, en comité départemental

C'est le plus récent, et c'est celui qui va me faire poser à la structure des questions qu'elle n'a
jamais entendues. Depuis l'inscription automatique des bénéficiaires du RSA à France Travail, le
Département a besoin de savoir, **personne par personne** : qui est son référent unique, si elle a
un contrat d'engagement signé, quel volume d'activité hebdomadaire elle réalise, si elle honore ses
rendez-vous, et si un manquement doit passer par une **conciliation** avant toute décision
défavorable.

| Ce que je demande | Fréquence | Forme |
|---|---|---|
| Nombre de salariés BRSA et part dans l'effectif | Trimestriel | Agrégat |
| Dont : référent unique = la structure / = CMS / = France Travail | Trimestriel | Agrégat |
| Taux de contrats d'engagement signés parmi les BRSA dont vous êtes référent | Trimestriel | Agrégat + liste nominative si contrôle |
| Volume hebdomadaire d'activité d'insertion constaté | Trimestriel | Moyenne + distribution |
| Points d'étape réalisés / dus | Trimestriel | Agrégat |
| **Motifs légitimes d'absence documentés** | À la demande | Pièce individuelle |

**Ce dernier point n'est pas un contrôle contre vous : c'est une protection du salarié.** Quand un
manquement est signalé, la seule chose qui empêche une suspension est une pièce datée montrant un
motif légitime (santé, garde d'enfant, transport, convocation). Qui documente protège ; qui ne
documente pas expose.

### 1.5 Le contrôle sur place (art. 10 de la convention) — préavis court

Je viens avec une liste. Je tire au sort **trois à cinq dossiers** et je demande à voir, sur pièces :
le justificatif d'éligibilité et le Pass IAE ; le contrat et ses avenants ; le diagnostic daté et son
délai par rapport à l'embauche ; tous les entretiens, datés et signés ; le journal des actions avec
leur nature, leur objet, leur **durée** et le partenaire mobilisé ; les conventions de PMSMP ; le
bilan de sortie et les documents remis ; la preuve du suivi post-sortie. Je demande aussi,
systématiquement : registre des traitements, analyse d'impact, note d'information remise aux
salariés, trace de la consultation des représentants du personnel. **Sur ce dernier bloc, la note de
la structure indique elle-même que la mise en production y est conditionnée : je considère que ce
n'est pas fait, et je le reposerai.**

**Ce qui me fait rédiger une réserve au procès-verbal** : un dossier où le diagnostic date de plus
de trois mois après l'embauche sans explication ; des entretiens dont je ne peux pas dater le
contenu ; une action d'accompagnement sans partenaire ni résultat ; un bilan de sortie sans
catégorie. **Ce qui me fait écrire une non-conformité** : une donnée relevant de l'article 10 du
RGPD (infractions, condamnations) trouvée dans un champ libre ; un export nominatif transmis par
messagerie non sécurisée ; l'absence de base légale documentée pour le contact post-sortie.

---

## 2. Matrice de couverture de mes exigences

Lecture des verdicts : **Couvert** = je peux m'en servir tel quel en contrôle ; **Partiel** = la
brique existe mais elle n'est pas opposable en l'état (donnée non structurée, périmètre incomplet,
chiffre non vérifiable) ; **Absent** = rien dans l'outil.

### 2.1 Réforme du RSA et contrat d'engagement (A1-A6, C1-C7)

| Réf. | Mon exigence | Ce que SOLIDATA produit aujourd'hui | Verdict | Ce qu'il faut pour que ce soit opposable |
|---|---|---|---|---|
| **A1** | Savoir qui est BRSA et porter son identifiant France Travail | `employees.france_travail_id` existe. Le statut BRSA n'existe **pas** comme attribut : il n'est déductible que du tableau déclaratif `insertion_diagnostics.ressources` (valeur `RSA` parmi 9). Le seul chiffre fiable, « Dont BRSA », est lu par `asp-parser.js:144` — et **il n'est pas conservé** : aucune colonne `nb_brsa` dans `etp_asp_mensuel`, il n'apparaît qu'à l'écran d'aperçu d'import. | **Absent** | Une colonne `brsa` (booléen + date de constatation + source : notification CAF / état ASP / déclaration) sur la personne. Et persister `nb_brsa` à l'import ASP : c'est la seule valeur **certifiée** de tout le système. |
| **A2** | Savoir qui a orienté et qui est **référent unique** | `prescripteur_orgas` (8 types, dont FT, ML, CD, CCAS, Cap emploi) + `date_prescription` : très bien fait. Mais le prescripteur n'est **pas** le référent unique, et `cip_referent_user_id` désigne la conseillère **interne**, pas le référent au sens de la réforme. | **Partiel** | Trois notions distinctes à séparer : **orienteur** (qui a décidé du parcours), **prescripteur** (qui a prescrit l'IAE), **référent unique** (qui tient le contrat d'engagement) — ce dernier avec une valeur « la structure elle-même ». |
| **A3** | Tracer l'actualisation mensuelle quand le référent est France Travail | Rien. | **Absent** | Un rappel mensuel et une case « actualisation faite / non faite / sans objet ». Faible coût, effet direct : cela évite une rupture de droits. |
| **A4** | Volume d'activité hebdomadaire 15-20 h, comptabilisable | La quotité **contractuelle** existe (`employee_contracts.weekly_hours`). Les heures **réellement constatées** existent aussi, dans `employee_week_hours` (`hours_worked`, `hours_expected`, `hours_absence`, par semaine ISO) — alimentée par l'import de paie et, d'après la note interne `03`, **lue par rien du tout**. Aucun seuil, aucun croisement avec le statut BRSA. | **Partiel** | La donnée est là, c'est le plus important. Il manque : un indicateur hebdomadaire par personne (heures travaillées + heures d'accompagnement + ateliers + PMSMP), un seuil paramétrable, une alerte sous le seuil. |
| **A5** | Rattacher les actions aux partenaires locaux (CMS, forums, job datings) | `insertion_partenaires` (16 partenaires seedés) + `cip_action_plans.partenaire_id` + catégorie + résultat. C'est bien construit. | **Couvert** | Ajouter les CMS au référentiel et une catégorie d'action « job dating / relation entreprise ». Rien de structurel. |
| **A6** | Documenter l'assiduité et les **motifs légitimes** d'absence | Les absences existent en paie (`employee_leaves`, catégorisées) et alimentent le calcul d'ETP réalisé. Mais il n'y a **aucun objet « motif légitime »** opposable, ni pièce rattachée. | **Partiel** | Un journal d'assiduité avec, pour chaque absence signalée : motif, pièce justificative référencée, date de la CIP qui l'a constaté. C'est la pièce qui protège le salarié en conciliation. |
| **C1** | Un type d'entretien « contrat d'engagement / point d'étape » | Six types d'entretiens existent (`engine.js:14`) — aucun n'est le contrat d'engagement. | **Absent** | Deux types : `contrat_engagement` et `point_etape_ce`. La mécanique d'entretien existe déjà, c'est une extension de liste. |
| **C2** | Diagnostic partagé exportable au format du contrat | Le diagnostic 12 rubriques + 9 freins est de **très bonne facture** — la meilleure trame que j'aie vue, honnêtement, avec sa valeur « non évalué » explicite. Mais il n'existe aucune édition au format attendu. | **Partiel** | Un modèle d'impression reprenant les rubriques du contrat d'engagement. |
| **C3** | Co-construction : démarches réalistes, portées par la personne | `insertion_objectifs.origine` = `salarie` / `cip`. **C'est exactement la preuve que je cherche** et je n'ai jamais vu un outil la porter nativement. | **Couvert** | Rien. À mettre en avant en contrôle. |
| **C4** | Engagements du bénéficiaire, volume, présence aux RDV, changements de situation | Objectifs et actions : oui. Volume : voir A4. Présence aux rendez-vous : **rien** — les entretiens n'ont ni statut de présence ni motif d'absence. Journal des changements de situation : `insertion_notes_suivi` (chiffré, daté à la date de l'**événement**) s'en approche beaucoup. | **Partiel** | Sur l'entretien : `presence` (présent / absent excusé / absent non excusé) + motif. C'est trois champs et cela change tout pour le suivi RSA. |
| **C5** | Engagements de l'institution : **aides mobilisées** (mobilité, garde, transport) | Les actions portent un partenaire et un résultat, jamais une aide chiffrée. | **Partiel** | Sur l'action : nature de l'aide, organisme, montant si connu, date d'obtention. Le Département veut savoir ce que ses aides produisent. |
| **C6** | Durée 6-12 mois, renouvellement après bilan, exemplaire remis, **avenants** | Le mécanisme générique est là : entretien daté, gelé à la clôture, historique par instantanés, `remise_salarie`. | **Partiel** | Ce mécanisme appliqué à l'objet « contrat d'engagement », avec une notion d'avenant numéroté. |
| **C7** | Entretien de **conciliation** et motifs légitimes | Rien. | **Absent** | Un type d'entretien `conciliation`. Peu de travail, et c'est une pièce que je réclamerai le jour où un dossier partira en suspension. |

### 2.2 Plateforme de l'inclusion (P1-P5)

| Réf. | Mon exigence | Ce que SOLIDATA produit | Verdict | Ce qu'il faut |
|---|---|---|---|---|
| **P1a** | **Critères d'éligibilité IAE cochés** | `employees.eligibilite_criteres` est une **zone de texte libre** (`init-db.js:4082`), recopiée du candidat à l'embauche. Aucune occurrence de DELD, QPV, ZRR, ASS, senior, sortant de détention, primo-arrivant dans tout le logiciel. | **Absent** | Une liste **cochable** alignée sur les critères administratifs en vigueur — bénéficiaire du RSA, ASS, AAH, demandeur d'emploi de longue durée, niveau de formation, senior, travailleur handicapé, résident QPV ou ZRR, personne placée sous main de justice, personne sans hébergement, bénéficiaire de la protection internationale, jeune de moins de 26 ans. **Une zone de texte ne se compte pas** : c'est la raison pour laquelle je ne peux pas aujourd'hui vous demander votre typologie d'entrée. *Liste à recaler sur l'arrêté en vigueur — je fournirai la version applicable.* |
| **P1b** | **Pass IAE** : numéro, dates, **suspension**, prolongation | Numéro et dates : oui (`pass_iae_number/start/end`) avec alertes à 7 mois et 2 mois, ce qui est très bien vu. Suspension : **rien**. | **Partiel** | Un statut de Pass (actif / suspendu / prolongé) avec dates et motif. La suspension existe dans la vraie vie (arrêt de parcours, reprise) et vous n'en avez pas trace. |
| **P1c** | Localisation des justificatifs d'éligibilité | `eligibilite_justificatifs_ref` : une référence textuelle, les pièces restant sur la plateforme. | **Couvert** | **Ce choix est le bon**, je le valide explicitement (voir §6). |
| **P1d** | État de la candidature (reçue / retenue / refusée) | Le module recrutement a son propre suivi, sans lien avec les états de la plateforme. | **Partiel** | Sans objet pour moi tant que la plateforme reste la référence. Faible priorité. |
| **P2** | Orientation **DORA** rattachée à un frein | Zéro occurrence de DORA. Les partenaires sont un référentiel interne. | **Absent** | Sur l'action de levée de frein : lien vers la fiche du service, date d'orientation, résultat. C'est ce qui transforme « frein identifié » en « frein traité », et c'est exactement ce que finance la convention 2026-2027. |
| **P3** | Convocation, rappel, **présent/absent/motif** | Les rappels existent (le module d'envoi est en place). La présence, non. | **Partiel** | Voir C4. Même champ, double usage. |
| **P4** | Récapitulatif de parcours partageable entre professionnels | Le PDF de parcours existe. | **Couvert** | Veiller à ce que la version partagée soit **expurgée** des articles 9 et 10 — la note affirme que c'est le cas pour le bilan de Pass IAE ; à vérifier pour les autres éditions. |
| **P5** | Marché de l'inclusion | Hors de mon champ ici. | — | — |

### 2.3 Contexte départemental et logique de performance (S1-S7)

| Réf. | Mon exigence | Ce que SOLIDATA produit | Verdict | Ce qu'il faut |
|---|---|---|---|---|
| **S1** | **PMSMP comme indicateur de performance** (nombre, durée, débouchés) | Le module PMSMP est **excellent** : objets légaux, bornes contrôlées (un mois par convention, 60 jours sur 12 mois glissants appréciés par organisme d'accueil, deux conventions au plus), forçage tracé, et la mention de la saisie dans l'outil officiel. La synthèse compte les conventions, les jours et les salariés concernés. | **Partiel** | Il manque le **débouché** : la PMSMP a-t-elle donné lieu à une embauche, une formation, rien ? Sans cela je mesure une activité, pas un résultat — or c'est un résultat que je finance. |
| **S2** | Freins identifiés **et levés**, actions par frein, effectif BRSA | Les neuf freins sont notés de 1 à 5 à chaque entretien, l'historique permet de voir l'évolution, et les actions portent un `frein_type`. La matière est là. Mais il n'existe **aucun indicateur « frein levé »** et, faute de statut BRSA, aucun croisement possible. | **Partiel** | Un indicateur par frein : nombre de personnes concernées à l'entrée, nombre dont le niveau a baissé d'au moins deux points, nombre d'actions engagées, partenaire le plus mobilisé. **C'est l'indicateur central de la convention 2026-2027** et c'est celui que je n'ai pas. |
| **S3** | Un projet FSE+ = une **cohorte identifiée** | Rien : aucune notion de projet ni de rattachement. `fse_entree` est posé sur tout diagnostic, indistinctement. | **Absent** | Un objet « projet cofinancé » (intitulé, période, financeur) et un rattachement daté des participants. **Sans lui, aucun bilan d'exécution n'est composable**, et le CSF portera sur un périmètre que vous ne saurez pas justifier. |
| **S4** | **Catégorie France Travail F/G** et alerte sur les dossiers en attente | Zéro occurrence. | **Absent** | Un champ catégorie avec sa date de constatation. La catégorie G (attente d'orientation) est précisément le signal d'un dossier qui dort. |
| **S5** | Frein linguistique et actions FLE | `cecrl_niveau` au diagnostic et frein linguistique : **bien fait**, et rare. | **Couvert** | Une catégorie d'action « formation FLE » pour le comptage. |
| **S6** | Actions job dating / relation entreprise | Catégories d'action génériques. | **Partiel** | Deux valeurs de liste à ajouter. |
| **S7** | Trajectoire : PMSMP → emploi, immersions | Les deux objets existent mais ne se parlent pas. | **Absent** | Le lien PMSMP → sortie. C'est ce qui permet de dire « 11 immersions, 4 embauches chez l'accueillant » — la phrase qui justifie un financement. |

### 2.4 FSE+ (F1-F8) — la partie qui m'inquiète

| Réf. | Mon exigence | Ce que SOLIDATA produit | Verdict | Ce qu'il faut |
|---|---|---|---|---|
| **F1** | Rattachement des salariés au projet, base du plan de financement | Voir S3 : rien. | **Absent** | Objet projet + cohorte datée. |
| **F2** | Savoir quels **postes** sont affectés au projet | Rien dans le module. | **Absent** | Affectation des postes CIP/encadrants au projet, avec le taux forfaitaire retenu. |
| **F3** | **Feuilles de temps** des CIP par projet, cohérentes avec les congés, signables | Rien. Le module de temps et présence produit des exports de paie, sans notion de projet. | **Absent** | Une feuille de temps mensuelle par personne et par projet, avec une ligne par jour, cohérente avec `employee_leaves`, signée par l'intéressé et le responsable. **Je le répète parce que c'est le premier motif de rejet que j'applique** : une signature manquante, et la dépense de personnel est écartée. |
| **F4** | Bilan d'exécution composable depuis l'outil | Rien d'identifiable comme tel. | **Absent** | Un état « bilan d'exécution » : participants du projet, indicateurs d'entrée, de sortie, de résultat à six mois, taux de complétude. |
| **F5** | Dossier individuel : éligibilité prouvée à l'entrée, **suivi à la sortie ET à +6 mois** | Éligibilité : référence textuelle seulement. Sortie : voir F7. **Résultat à six mois : le suivi post-sortie est créé automatiquement à +3 mois** (`scheduler.js:512`, `due.setMonth(due.getMonth() + 3)`), avec six situations possibles. | **Partiel, et non conforme en l'état** | Le suivi à +3 mois est une **excellente pratique d'accompagnement** — je ne demande pas de la supprimer. Mais l'indicateur de résultat européen se mesure à **six mois**, et un relevé à trois mois ne le remplace pas. Il faut **les deux** : +3 mois pour vous, +6 mois pour moi. |
| **F6** | Questionnaire d'entrée dès l'arrivée | Il existe : cinq items (situation avant l'entrée, durée sans emploi, foyer monoparental, sans domicile stable, commentaire), dans une étape dédiée du diagnostic, avec le rappel des sanctions en cas de fausse déclaration. L'intention est bonne. Mais il est stocké en **JSON libre** (`fse_entree JSONB`), sans schéma, sans contrôle de complétude, et **il n'est pas obligatoire**. | **Partiel** | Des champs typés, un contrôle de complétude à l'entrée, et un blocage du parcours FSE+ tant qu'il manque. Et surtout : **la liste des items doit être celle de la plateforme**, pas une liste maison. *Je fournirai la maquette.* |
| **F7** | Statut de sortie saisi **dans le mois** | `fse_sortie` existe comme colonne et est acceptée par l'interface de programmation… mais **je n'ai trouvé aucun écran de saisie** : le terme n'apparaît nulle part dans l'interface. Concrètement, personne ne peut le remplir. Et aucune alerte ne surveille le délai d'un mois. | **Absent** | Un formulaire de sortie FSE+ dans le bilan de sortie, et une alerte à J+15 puis J+25. **Tant que ce point n'est pas réglé, je considère que le risque de blocage de vos bilans financiers est élevé.** |
| **F8** | Export bilan d'exécution avec taux de complétude | L'export FSE+ trimestriel existe (24 colonnes) — voir mon jugement détaillé au §3.1, qui n'est pas favorable. | **Partiel** | Voir §3.1. |

---

## 3. Mon jugement sur le reporting existant

### 3.1 L'export FSE+ trimestriel (24 colonnes) — **je ne peux pas m'en servir**

Je serai directe, parce que c'est le point le plus sérieux de cette note.

**Premièrement, il ne correspond pas à ce que demande la plateforme.** MDFSE+ ne se nourrit pas d'un
fichier de vingt-quatre colonnes composé par la structure : les participants et leurs indicateurs se
saisissent sur la plateforme, et ce qui m'est utile à côté est un **état de rapprochement** entre
elle et votre SI. L'export actuel n'est ni l'un ni l'autre : c'est une extraction généraliste, utile
en interne, mais qu'il ne faut pas appeler « export FSE+ » — le nom laisse croire à une conformité
qui n'est pas là.

**Deuxièmement, la colonne « Heures travaillées (trimestre) » est cassée, et son échec est
silencieux.** On m'a montré la requête (`exports.js:373-380`) : elle calcule la différence entre une
heure de fin et une heure de début sur la table des heures de travail. Or cette table, telle qu'elle
est créée (`init-db.js:451-462`), ne porte **ni heure de début ni heure de fin** : elle porte un
nombre d'heures (`hours_worked`) et un type. La requête ne peut donc pas aboutir. Et comme elle est
enveloppée dans un filet qui, en cas d'échec, renvoie une liste vide, **le résultat n'est pas une
colonne à zéro : c'est un fichier entièrement vide, sans le moindre message**. Une structure qui
transmet ce fichier de bonne foi transmet un document qui dit « zéro bénéficiaire ». Je considère
cela comme le **défaut le plus grave** que j'aie relevé, parce qu'il est invisible.

**Troisièmement, les deux colonnes qui portent la substance FSE+ sont du JSON brut.** Si vous
m'envoyez une cellule contenant
`{"statut_avant_entree":"demandeur_emploi","duree_sans_emploi":"12_24_mois",...}`, je ne peux
**rien** en faire : ni trier, ni compter, ni contrôler la complétude, ni la rapprocher de la
plateforme. Un auditeur de la Commission ne le fera pas davantage. **Une donnée de piste d'audit
doit être une colonne, avec un intitulé lisible en français** : cinq items d'entrée, cinq colonnes.
Ce n'est pas une préférence esthétique, c'est ce qui rend la pièce exploitable.

**Quatrièmement, cet export n'est pas journalisé.** La note aux certificateurs affirme (§ 3) que
« chaque export nominatif » l'est. C'est vrai pour le tableau des freins — où un échec d'écriture du
journal fait échouer l'export, ce qui est la bonne conception. Mais l'export FSE+ (nom, prénom,
civilité, genre, dates) et l'extraction complète en tableur (nominative, avec les freins, donc avec
de la santé) ne le sont pas. **Une affirmation générale démentie par deux exceptions me fait perdre
confiance dans le reste du document** — je préfère de loin « deux exports sur quatre sont
journalisés, les deux autres le seront au prochain lot ».

**Gravité que j'y attache** : moyenne sur le plan du risque réel (ces exports sont réservés à deux
rôles et restent internes), **élevée sur le plan de la crédibilité documentaire**. En contrôle, une
promesse écrite non tenue m'amène à vérifier les autres.

### 3.2 Le tableau des freins (23 colonnes) — **c'est le bon document**

Celui-là, je le garde. Il est bien conçu, et sur plusieurs points il est meilleur que ce que je
reçois d'habitude :

- **la règle de valorisation est écrite et défendable** : dernière évaluation en date, c'est-à-dire
  le dernier entretien réalisé portant au moins un frein, avec repli axe par axe sur le diagnostic —
  et cette règle est **imprimée dans le fichier lui-même**, feuille « Informations ». Un contrôleur
  qui ouvre le fichier sait comment les chiffres ont été faits. C'est rare, et c'est exactement ce
  qu'il faut ;
- **la cellule vide signifie « non évalué »** et non « pas de difficulté ». La distinction est
  capitale et la plupart des outils la ratent ;
- **le frein judiciaire est exclu par défaut**, et son inclusion passe par un paramètre explicite,
  journalisé sous une action distincte, la colonne n'étant même pas lue dans le cas général. C'est
  du bon travail de minimisation ;
- **la complétude par colonne est calculable avant génération**. C'est une idée que je vais citer
  ailleurs : elle évite de m'envoyer un tableau à moitié vide.

**Ce qui lui manque**, de mon point de vue :

1. **Le statut BRSA, la catégorie France Travail et les critères d'éligibilité IAE** : sans eux, ce
   tableau ne peut pas servir au suivi de la réforme, qui est le sujet de 2026-2027.
2. **Une colonne « frein levé »**, ou à défaut la valeur d'entrée à côté de la valeur courante : le
   tableau me donne une photographie, la convention me demande une **trajectoire**.
3. **Le référent unique et le prescripteur**, qui existent en base et n'y figurent pas.
4. Une précision de forme : « Heures par semaine » restitue la **quotité contractuelle**, pas les
   heures constatées — pour le suivi des 15-20 h ce n'est pas la même chose, et l'intitulé devrait
   le dire.

### 3.3 La synthèse pour comité de pilotage — bonne, et honnête

Document agrégé, strictement non nominatif, portant sa mention de périmètre, produit à partir des
**mêmes calculs** que l'écran de pilotage — donc pas de double vérité. Il contient l'essentiel :
effectifs, ETP de contrôle, typologies, entretiens réalisés sur échus, moyennes de freins, sorties
par catégorie avec les cibles, PMSMP, satisfaction, actions.

Deux remarques :

- **« objectif non paramétré » est la bonne réponse** quand la cible n'est pas connue. Je le dis
  parce que la tentation inverse est universelle : mettre un chiffre rond pour ne pas laisser une
  case vide. Ici on s'en abstient, et c'est un signe de sérieux. Je fournirai les cibles de
  l'annexe financière pour qu'elles soient renseignées avant le bilan.
- La synthèse ne reprend **pas** les chiffres ASP validés, alors que le module d'effectifs les
  détient. Résultat : au comité de pilotage, on discute d'un « ETP de contrôle » approché pendant
  que le chiffre qui fait foi est dans un autre écran. **C'est le chiffre ASP qui doit figurer en
  premier**, et l'approximation ERP à côté, en petit, comme contrôle de cohérence.

### 3.4 Les indicateurs conventionnels — **le dénominateur est le point à corriger**

Les catégories sont **conformes à la nomenclature officielle** : emploi durable, emploi de
transition, sortie positive, autres sorties. C'est vérifié dans le code
(`DYNAMIC_SORTIE_CLASSES`), et les définitions retenues (contrat à durée indéterminée, contrat d'au
moins six mois ou création d'activité en emploi durable ; contrat court ou aidé en transition ;
formation qualifiante ou autre structure d'insertion en sortie positive) correspondent à ce que
j'applique. Le taux de sorties dynamiques est la somme des trois premières catégories : c'est juste.

**En revanche, le dénominateur n'est pas conforme à ma méthode.** Le calcul retient comme sorties de
l'année les **bilans de sortie réalisés portant une classification**, dont la date de clôture tombe
dans l'année civile. Autrement dit : une personne qui quitte la structure sans que le bilan de
sortie ait été fait — abandon, rupture, non-retour, personne injoignable — **n'entre pas au
dénominateur**. Or c'est très exactement la population dont les sorties sont les moins favorables.

Le taux ainsi calculé est donc **structurellement supérieur** à celui que je calcule sur l'ensemble
des sorties constatées — couramment de cinq à dix points sur des structures de votre taille. Et il
vous pénalise : au dialogue de gestion, un taux dont la méthode ne tient pas est un taux que
j'écarte, et l'on revient à mes chiffres.

**Ce que je demande** : le dénominateur doit être **toutes les sorties de la période** — toute
personne dont le contrat s'est achevé et qui n'a pas été renouvelée. Les personnes sorties sans
bilan sont classées en « autres sorties » ou, mieux, dans une ligne « sortie non documentée », qui
est elle-même un indicateur de qualité du suivi. Et la façon de le vérifier est à portée de main :
**l'état ASP porte, pour chaque salarié, la date de sortie définitive et le code motif de sortie**
(le lecteur les extrait déjà). Rapprocher vos bilans de sortie de la liste ASP des sorties du mois
vous donne l'exhaustivité gratuitement.

La note méthodologique de bascule annoncée pour le premier bilan produit avec le nouvel outil est,
elle, une **bonne pratique** : une rupture de série annoncée ne se discute pas, une rupture de série
découverte se discute longuement.

### 3.5 Les ETP et les trois bases — **il faut en choisir une par usage, et le dire**

Le système fait coexister trois bases :

| Base | Où | À quoi elle sert | Mon avis |
|---|---|---|---|
| **1 820 h/an** | `asp-parser.js:49` | ETP conventionné ACI, aide au poste | **C'est la mienne.** C'est celle de vos états ASP, c'est celle de votre annexe financière, c'est celle sur laquelle je calcule votre taux de réalisation et donc votre financement. |
| **1 607 h/an** | KPI ressources humaines et métropolitains | Statistique d'emploi générale | Légitime dans son contexte. **N'a rien à faire dans un document de conventionnement.** |
| **35 h/semaine** | « ETP de contrôle » du pilotage insertion | Approximation instantanée | Utile en interne. Ce n'est pas un ETP : c'est un effectif pondéré à l'instant T. |

**Pourquoi j'en fais un problème** : trois chiffres circulent sous le même mot. Si le bilan annonce
« 24,8 ETP » sans préciser la base, je ne sais pas si l'on me parle du chiffre ASP (qui fait foi),
d'un calcul en 1 607 h (mécaniquement supérieur d'environ 13 %) ou d'un effectif instantané — et le
rapprochement avec l'annexe financière déclenchera une question que personne n'aura anticipée.

**Ce que je demande** : que tout document sortant porte la base employée, et que **seule la base
1 820 h** apparaisse dans les documents de conventionnement. Que l'approximation en 35 h porte un
autre nom que « ETP » — « effectif pondéré », par exemple. C'est une correction de vocabulaire, elle
ne coûte rien, et elle évitera une heure de malentendu par dialogue de gestion.

### 3.6 La doctrine « l'ASP fait foi » — **à conserver telle quelle**

La phrase écrite dans le module d'effectifs — le chiffre ASP prime, le calcul interne est un
contrôle, **aucune fiche salarié n'est créée depuis un état ASP** (on explique l'écart, on ne le
comble pas) — est une doctrine de gestionnaire, pas de développeur. Et le contrôle qui **refuse
l'import** lorsque la somme des heures ne correspond pas au total déclaré garantit que le
rapprochement porte sur l'état réel et non sur une lecture partielle.

Deux prolongements utiles :

1. **Conserver « Dont BRSA »**. La valeur est lue à l'import puis perdue. C'est, aujourd'hui, la
   seule donnée BRSA **certifiée** de tout le système, et elle ne survit pas à la fenêtre d'aperçu.
   Une colonne suffit.
2. **Exploiter les motifs de sortie ASP**. Le code à deux chiffres est extrait mais jamais traduit.
   La table de correspondance figure dans l'état lui-même ; la reprendre donnerait, sans aucune
   saisie supplémentaire, une liste exhaustive des sorties de l'année et de leur motif officiel —
   exactement ce qui manque au §3.4.

### 3.7 Ce que la note aux certificateurs affirme et que je n'ai pas retrouvé

Je consacre un paragraphe à cet exercice parce que, en contrôle, c'est ce que je fais : je prends
les affirmations et je les vérifie une par une.

| Affirmation de la note | Ce que j'ai constaté |
|---|---|
| « chaque export nominatif est journalisé » (§3) | Vrai pour le tableau des freins. **Faux** pour l'export FSE+ et l'extraction complète en tableur, tous deux nominatifs. |
| « Les entretiens portent également leur durée » (§2) | Je n'ai trouvé **aucune colonne de durée** sur les entretiens. La durée existe sur les **actions** (`duree_minutes`). |
| « Le module agrège un volume d'heures d'accompagnement par salarié et global » (§2) | Je n'ai trouvé **aucun calcul de somme** de ces durées, nulle part. L'indicateur annoncé n'existe pas. C'était déjà la réserve n° 4 de votre auditeur de juillet : elle n'est levée qu'à moitié — le champ existe, l'indicateur non. |
| « la possibilité de rattacher à l'entretien le scan de l'exemplaire signé » (§3) | Je n'ai trouvé **aucun mécanisme de dépôt de fichier** dans le module Insertion. Le « faisceau de preuve » de la co-construction repose donc sur deux jambes (validation par compte, trace de remise) et non trois. |
| « trace de la remise du document » | Ce qui est enregistré est l'instant où le document a été **produit**, et par qui. Ce n'est pas tout à fait la remise à la personne. Nuance mineure, mais à ne pas écrire autrement qu'elle n'est. |
| « analyse d'impact validée avant la mise en production », « consultation du CSE » | Présentées comme des conditions à venir. J'en prends acte et je les reposerai : ce sont les deux seules lignes de ce dossier qui, si elles manquaient au jour du contrôle, me feraient écrire une non-conformité. |
| « volet RSEi : mission séparée » (§7) | La note interne indique que ce module est livré depuis juillet. Détail, mais il date le document. |

**Comment je lis tout cela** : ce ne sont pas des mensonges, ce sont des **promesses écrites au
futur et lues au présent**. Le remède est simple et je le recommande vivement : **dater chaque
affirmation** (« livré le … » / « prévu pour … »). Une note qui distingue les deux est plus
crédible qu'une note qui affirme tout.

### 3.8 Les réserves de votre auditeur de juillet — où en sommes-nous

Je les ai reprises une à une, parce qu'une réserve d'audit non levée est une réserve qui revient.

| Réserve | Objet | État au 12/09/2026 |
|---|---|---|
| RES-01 | Analyse d'impact obligatoire | **Non levée** — annoncée, non produite. |
| RES-02 | Intégrité des entretiens clôturés | **Levée** — verrou + historique par instantanés. Bon travail. |
| RES-03 | Preuve de co-construction, signature, remise | **Partiellement levée** — validations et trace de remise oui ; **dépôt du scan signé absent**. |
| RES-04 | Durée des actions (art. 5 de la convention) | **Partiellement levée** — champ créé, **aucun agrégat**, rien sur les entretiens. |
| RES-05 | Second parcours (réembauche) | **Levée** — numéro de parcours et unicité par parcours. |
| RES-06 | Arbitrages bloquants et FSE+ non reportable | **Partiellement levée** — entrée oui, **sortie inutilisable**, six mois absents. |
| RES-07 | Assiette du plafond PMSMP de 60 jours | **Levée** — appréciée par organisme d'accueil, avec la règle des deux conventions. |
| RES-08 | Dérogation au-delà de 24 mois par la voie de l'import de paie | **Levée sur le principe** (alerte critique par dossier) ; je n'ai pas trouvé de **file consolidée** des dossiers à régulariser. |
| RES-09 | Dénominateur des taux et rupture de série | **Levée sur la forme** (méthode écrite), **non levée sur le fond** (voir §3.4). |
| RES-10 | Circuit du renouvellement et habilitations | **Levée** — écran dédié pour l'encadrant, triple validation. |
| RES-11 | Entretien professionnel (L.6315-1) | **Non levée** — aucune trace dans le logiciel. Ce n'est pas un sujet IAE mais un sujet d'employeur, et il peut m'être opposé. |
| RES-12 | Information et consultation du CSE | **Non levée**. |
| RES-13 | Contact post-sortie : base légale et information | **Partiellement levée** — l'information au bilan de sortie est prévue ; le recueil de l'opposition existe ; la base légale reste à écrire. |

---

## 4. Ce que je veux voir en plus — indicateurs, forme, fréquence

Je liste ci-dessous ce que je demanderai. La colonne « forme » est importante : je ne veux **pas**
de données nominatives quand un agrégat suffit, et je ne veux **pas** d'un agrégat quand il me faut
une pièce individuelle.

| # | Indicateur ou état | Forme attendue | Fréquence | Pourquoi |
|---|---|---|---|---|
| 1 | **Typologie d'entrée par critère d'éligibilité IAE** (BRSA, demandeur d'emploi de longue durée, moins de 26 ans, 50 ans et plus, travailleur handicapé, QPV, ZRR, ASS, AAH, protection internationale, sortant de détention, sans hébergement) | Agrégat non nominatif, effectifs bruts + part | Annuel, et à l'appui de toute demande d'avenant | C'est la base de la conformité au conventionnement et de l'aide au poste |
| 2 | **Effectif BRSA** et part dans l'effectif conventionné | Agrégat ; le chiffre ASP « Dont BRSA » en référence | Mensuel (repris de l'ASP), consolidé au trimestre | Pilotage départemental |
| 3 | **Catégorie France Travail** (dont F et G) | Agrégat + liste nominative sur demande en contrôle | Trimestriel | Détecter les dossiers en attente d'orientation |
| 4 | **Référent unique** : structure / CMS / France Travail / non déterminé | Agrégat | Trimestriel | Savoir qui tient le contrat d'engagement |
| 5 | **Contrat d'engagement** : signés / dus, respect du volume 15-20 h, points d'étape réalisés / dus, avenants | Agrégat ; le contrat signé en pièce individuelle sur demande | Trimestriel | Cœur de la réforme |
| 6 | **Volume hebdomadaire d'activité d'insertion** par personne (travail + accompagnement + ateliers + immersions) | Distribution agrégée (moyenne, part sous 15 h, part au-delà de 20 h) | Trimestriel | Le seul moyen de documenter le respect de l'engagement |
| 7 | **PMSMP** : nombre, jours, entreprises d'accueil, **débouché** (embauche / formation / aucun) | Agrégat + liste anonymisée des entreprises | Semestriel | Consigne de renforcement des immersions |
| 8 | **Freins : identifiés → levés**, par frein, avec l'action et le partenaire mobilisé | Agrégat par frein | Semestriel, et au bilan | **Indicateur central de la convention 2026-2027** |
| 9 | **Sorties à +6 mois** (emploi, formation, inactivité, injoignable) | Agrégat, et fichier importable pour le FSE+ | Semestriel | Indicateur de résultat européen |
| 10 | **Complétude des questionnaires MDFSE+** entrée et sortie | Taux + liste des dossiers incomplets, nominative (usage interne et contrôle) | **Mensuel** | Prévention du blocage du bilan financier |
| 11 | **Feuilles de temps** des CIP et encadrants par projet cofinancé | Pièce individuelle signée, mensuelle | Mensuel, transmise au bilan | Sans elle, la dépense de personnel est écartée |
| 12 | **Ruptures de droits évitées** : actualisations rappelées, motifs légitimes documentés, conciliations | Agrégat | Trimestriel | Protection des personnes, et indicateur de qualité |
| 13 | **Cohorte du projet d'accompagnement social intensif** : entrées, sorties, indicateurs propres | Tableau nominatif réservé au contrôle, agrégat pour le reste | Semestriel | Périmètre du cofinancement |
| 14 | **Volume d'heures d'accompagnement** (entretiens + actions), par personne et global | Agrégat + moyenne par personne | Annuel | Article 5 de la convention — et c'est vous qui l'avez promis |
| 15 | **Sorties non documentées** (départ sans bilan de sortie) | Agrégat, en valeur absolue | Annuel | Indicateur de qualité du suivi, et correctif du dénominateur |

**Sur la forme des transmissions** : un fichier tableur par état, une ligne d'en-tête, un intitulé en
français par colonne, aucun contenu technique dans les cellules, pas de fusion, pas de couleur
porteuse de sens ; un document unique signé de la direction pour le bilan annuel ; et les fichiers
nominatifs par le canal sécurisé habituel, jamais en pièce jointe de messagerie ordinaire.

---

## 5. Mes lignes rouges et mes points de confiance

### 5.1 Ce qui me rassure

1. **Le verrouillage à la clôture et l'historique par instantanés.** C'est la réponse à la question
   que je pose toujours et à laquelle personne ne répond : « comment savez-vous que ce compte rendu
   n'a pas été réécrit après mon appel ? » Ici, une correction passe par une réouverture motivée et
   journalisée, qui annule les validations. C'est une conception de qualité probante, pas une
   conception d'usage.
2. **L'auteur et l'horodatage systématiques**, et **la journalisation des consultations
   sensibles** — avec le choix, que je souligne, de faire **échouer l'export si le journal ne
   s'écrit pas**. Refuser un export plutôt que d'en produire un non tracé est une décision que je
   n'avais encore jamais vue dans ce secteur.
4. **« L'ASP fait foi »** et le refus de créer une fiche salarié depuis un état ASP.
5. **« Objectif non paramétré »** plutôt qu'un chiffre inventé.
6. **La minimisation** : ni numéro de sécurité sociale, ni coordonnées bancaires, ni numéro
   d'allocataire dans le modèle de données — non pas masqués : **absents**. Le volet judiciaire
   limité au niveau de difficulté et à l'impact d'organisation, **jamais la nature des faits**, avec
   un rappel affiché à la saisie. Le chiffrement des textes libres de santé et de justice. Et
   l'exclusion par défaut du frein judiciaire des exports.
7. **La valeur « non évalué »**, distincte de « pas de difficulté », et son exclusion des moyennes.
   C'est de la probité statistique.
8. **L'origine « salarié » des objectifs** : la meilleure preuve de co-construction que j'aie vue
   dans un système d'information.

### 5.2 Ce qui m'inquiète

1. **Le FSE+ en JSON libre.** Une donnée soumise à une piste d'audit d'au moins cinq ans ne peut pas
   vivre dans un champ sans structure ni contrôle. Dans cinq ans, au contrôle de service fait,
   personne ne saura dire quelles questions étaient posées en 2026 ni si elles étaient toutes
   remplies. **C'est mon premier sujet d'inquiétude.**
2. **Le questionnaire de sortie sans écran de saisie**, et le suivi à trois mois là où il en faut
   six. Risque financier direct.
3. **L'export qui peut sortir vide sans le dire.** Un outil de contrôle qui échoue en silence est
   pire qu'un outil absent : il donne une fausse assurance. Je demande que **tout export qui ne
   ramène aucune ligne le dise explicitement** dans le fichier lui-même.
4. **Les promesses de la note non tenues dans le code** (§3.7), en particulier la journalisation
   « de chaque export » et l'agrégat d'heures d'accompagnement.
5. **L'échelle des freins inversée dans vos propres documents.** Deux documents diffusés — le guide
   de la conseillère et le guide utilisateur — décrivent l'échelle à l'envers du logiciel (dans le
   logiciel 5 est bloquant ; les documents disent 1). **Si l'un me parvient et que je lis un tableau
   de freins à côté, je conclurai que vos publics vont bien alors qu'ils vont mal, ou l'inverse.**
   C'est la correction la moins coûteuse et la plus urgente de toute cette note.
6. **L'assistance par intelligence artificielle.** Je n'y suis hostile ni par principe ni par
   ignorance, et les garanties annoncées sont les bonnes. Mais je poserai trois questions au
   contrôle : **quel prestataire, où sont hébergées les données, qu'a-t-on dit aux salariés ?** Et
   une observation de fond : le niveau d'un frein ne doit **jamais** être écrit par la machine — sur
   ce point la conception (proposer sans enregistrer, la conseillère tranche) est correcte ; qu'elle
   le reste.
7. **Le rapprochement automatique par homonymie** entre l'état ASP et les fiches du personnel : le
   principe est bon (les noms d'usage diffèrent), mais un rapprochement faux attribue à une personne
   les heures d'une autre. La liaison manuelle est le bon garde-fou ; qu'elle reste obligatoire en
   cas de doute.
8. **L'analyse d'impact et la consultation des représentants du personnel**, toujours au futur.

---

## 6. Ce que je ne veux **pas** que la structure fasse

Je tiens à ce paragraphe autant qu'aux autres, parce que la sur-adaptation d'une structure à son
financeur produit autant de dégâts que la sous-adaptation.

1. **Ne redoublez pas les plateformes de l'État.** Les pièces d'éligibilité restent sur la
   plateforme des emplois de l'inclusion, les conventions d'immersion sur *Immersion Facilitée*, les
   états de présence sur l'extranet de l'ASP, les participants sur *Ma Démarche FSE+*. Le choix fait
   ici — **référencer** les justificatifs sans les recopier — est le bon, et je le valide
   explicitement. Une deuxième copie d'un document officiel, c'est une deuxième version qui peut
   diverger, et c'est une surface de risque supplémentaire au titre de la protection des données.
   La mention « document de travail, les saisies officielles font foi » imprimée sur les exports est
   la bonne pratique : conservez-la.
2. **Ne m'envoyez jamais de données de santé ni de justice.** Ni le frein de santé détaillé, ni le
   frein judiciaire, ni les commentaires de santé, ni un document de reconnaissance de travailleur
   handicapé. Pour mes besoins, le fait qu'une personne relève d'une reconnaissance de travailleur
   handicapé est un **critère d'éligibilité**, donc un comptage — pas un dossier médical. Si j'ai
   besoin d'une pièce individuelle, je la consulte **sur place**, je ne la reçois pas. Et je préfère
   recevoir un tableau amputé d'une colonne qu'un tableau que je devrai détruire.
3. **N'inventez pas de chiffres.** « Objectif non paramétré » est une bonne réponse.
   « Non évalué » est une bonne réponse. « Nous ne savons pas encore » est une bonne réponse. Un
   zéro qui remplace une donnée manquante est une **fausse déclaration**, même de bonne foi — et
   c'est ce qui m'oblige à écarter des dépenses.
4. **Ne fabriquez pas d'indicateur qui flatte.** Un taux de sortie calculé sur les seules personnes
   qui ont eu un bilan est un indicateur qui flatte (§3.4). Je le verrai, et il coûtera plus cher en
   crédibilité qu'il ne rapporte en pourcentage.
5. **Ne demandez pas à la conseillère de ressaisir.** Si un chiffre existe dans la paie ou dans
   l'état ASP, il doit venir de là. Chaque ressaisie est une divergence programmée — et, en pratique,
   une ressaisie de plus, c'est un entretien de moins.
6. **Ne transformez pas cet outil en outil de contrôle des personnes.** Le suivi de l'assiduité
   existe pour **documenter les motifs légitimes** et protéger le salarié en conciliation, pas pour
   alimenter une procédure. La note interne sur l'analyse de la pratique d'accompagnement retient
   des garde-fous explicites — agrégats, co-analyse, aucune notation individuelle : c'est la bonne
   ligne, tenez-la.

---

## 7. Mes questions

### 7.1 À la direction de Solidarité Textiles

1. **Êtes-vous, oui ou non, référent unique de vos salariés bénéficiaires du RSA ?** De la réponse
   dépend tout le reste : si oui, vous rédigez le contrat d'engagement, vous tenez les points
   d'étape et vous êtes en première ligne en cas de conciliation ; si non, vous alimentez le
   référent et il vous faut au minimum savoir qui il est pour chacun. **Aujourd'hui votre système ne
   sait répondre ni dans un cas ni dans l'autre.**
2. **Quels projets cofinancés portez-vous en 2026-2027, et quels salariés y sont rattachés ?**
   J'ai besoin d'une liste et de dates d'entrée dans le projet, pas d'une intention. Sans cohorte
   identifiée, le contrôle de service fait n'a pas d'assiette.
3. **Qui remplit aujourd'hui le questionnaire de sortie du FSE+, et où ?** Je n'ai pas trouvé
   d'écran. Si la réponse est « directement sur la plateforme », dites-le — c'est acceptable, mais
   il faut alors retirer la colonne correspondante de l'export, qui laisse croire à une double
   source.
4. **Combien de sorties de l'exercice 2026 n'ont pas donné lieu à un bilan de sortie ?** C'est le
   chiffre qui manque à votre dénominateur, et je le rapprocherai des sorties déclarées à l'ASP.
5. **Les cibles conventionnelles de votre annexe financière sont-elles paramétrées dans l'outil ?**
   Si non, faisons-le ensemble avant le bilan : je fournis les valeurs, elles sont à l'annexe.
6. **Où en sont l'analyse d'impact et la consultation des représentants du personnel ?** Ce sont les
   deux seuls points de ce dossier sur lesquels je n'ai aucune marge d'appréciation.
7. **Qui sait produire ces exports en l'absence de la conseillère ?** L'outil réserve, à juste titre,
   les données sensibles à deux profils ; je veux savoir combien de personnes physiques sont
   derrière. Un dispositif dont une seule personne détient la clé est fragile — pour vous comme pour
   moi.
8. **Comment vos salariés ont-ils été informés** de l'existence de ce dossier informatisé, de
   l'assistance par intelligence artificielle, de leurs droits ? La note mentionne un document
   d'information : je demanderai à le voir, dans sa version remise, avec la trace de remise.

### 7.2 Ce que je me pose sur SOLIDATA, en néophyte — et qu'il faudra m'expliquer

Je ne connais pas cet outil ; il n'est pas dans la liste de ceux que je croise habituellement. Voici
ce que j'attends d'une présentation d'une heure — et je préfère des réponses simples à une
démonstration.

1. **Qu'est-ce que c'est, exactement ?** Un logiciel du commerce ? Un développement sur mesure ? Qui
   en est propriétaire ? La réponse m'importe pour une raison très concrète : **que devient votre
   dossier d'accompagnement si l'auteur du logiciel n'est plus là ?** J'ai vu des structures perdre
   dix ans d'historique de cette façon. Existe-t-il une sauvegarde exploitable **sans** le logiciel
   — un export tableur complet, par exemple ?
2. **Qui y a accès, et qui voit quoi ?** Je veux une page, pas une base de données : les profils,
   et pour chacun ce qu'il voit et ce qu'il ne voit pas. J'ai retenu que l'encadrant technique ne
   voit ni la santé, ni la justice, ni le budget, et qu'un profil d'auditeur externe n'accède qu'à
   des agrégats : c'est exactement ce qu'il faut, **montrez-le-moi sous cette forme**.
3. **Où sont les données, et qui peut y accéder techniquement ?** Hébergeur, pays, sauvegardes, et
   qui détient les accès d'administration.
4. **Comment puis-je vérifier qu'un document que vous m'envoyez est bien sorti de l'outil et n'a pas
   été retouché ?** Aujourd'hui, rien ne me le garantit : je reçois un tableur, je peux le modifier
   moi-même. Une **date et une heure de génération, le nom du générateur, le périmètre et le nombre
   de lignes, imprimés dans le fichier** me suffiraient. Votre export de freins le fait déjà dans sa
   feuille « Informations » : **faites-le partout**.
5. **Comment tirer au sort un dossier devant moi, et l'imprimer en entier ?** C'est le geste que je
   ferai en contrôle sur place. Je veux vérifier qu'il prend moins de cinq minutes.
6. **Que se passe-t-il si une donnée est fausse ?** Je veux voir, en vrai, la correction d'un
   entretien déjà clôturé : la réouverture, le motif, la trace, et ce que devient la version
   antérieure. Si cette démonstration se passe bien, elle vaudra tout le reste de la présentation.
7. **Quelles données de vos salariés partent vers un prestataire extérieur**, pour l'assistance par
   intelligence artificielle ? La réponse annoncée est « aucune identité ». Je veux voir la
   vérification.
8. **Combien de temps gardez-vous quoi ?** J'ai retenu : deux ans après le dernier contact puis
   anonymisation, les données du cofinancement européen étant conservées séparément au-delà de cinq
   ans. C'est cohérent avec ce que j'attends. Je veux voir la purge fonctionner, ou au minimum sa
   trace d'exécution.
9. **Que se passe-t-il le jour où une personne demande l'accès à son dossier ?** Qui le produit, en
   combien de temps, sous quelle forme, et qu'est-ce qui en est retiré ?

---

## 8. Tableau récapitulatif — exigence, verdict, action attendue, priorité

**Priorités** : **P1** = à traiter avant le bilan 2026 ou avant le prochain appel de fonds
européen ; **P2** = avant le dialogue de gestion de février 2027 ; **P3** = souhaitable, sans délai
imposé.

| Réf. | Exigence | Verdict | Action attendue | Prio. |
|---|---|---|---|---|
| **F7** | Statut de sortie FSE+ saisi dans le mois | **Absent** | Créer l'écran de saisie du questionnaire de sortie et l'alerte à J+15 / J+25 | **P1** |
| **F5** | Résultat à **+6 mois** | Partiel (+3 mois) | Ajouter le relevé à 6 mois **en plus** de celui à 3 mois | **P1** |
| **F6** | Questionnaire d'entrée conforme et complet | Partiel (JSON libre, 5 items maison) | Champs typés, items de la plateforme, contrôle de complétude bloquant | **P1** |
| **§3.1** | Export FSE+ : colonne d'heures cassée, fichier vide silencieux | **Défaillant** | Réparer la requête ; **faire échouer bruyamment** un export à zéro ligne | **P1** |
| **§3.1** | Données FSE+ en JSON dans l'export | **Inexploitable** | Une colonne par item, intitulé en français | **P1** |
| **S3 / F1** | Cohorte du projet cofinancé | **Absent** | Objet « projet » + rattachement daté des participants | **P1** |
| **F3** | Feuilles de temps des CIP par projet, signées | **Absent** | Feuille mensuelle par personne et par projet, cohérente avec les congés | **P1** |
| **§5.2** | Échelle des freins inversée dans deux documents diffusés | **Erreur documentaire** | Corriger les deux guides | **P1** |
| **§3.4** | Dénominateur des taux de sortie | **Non conforme** | Dénominateur = **toutes** les sorties de la période ; ligne « sortie non documentée » ; rapprochement avec les sorties ASP | **P1** |
| **RES-01 / RES-12** | Analyse d'impact et consultation du CSE | **Non levées** | Produire les deux pièces | **P1** |
| **P1a** | Critères d'éligibilité IAE cochables | **Absent** | Liste fermée alignée sur l'arrêté en vigueur | **P2** |
| **A1** | Statut BRSA comme attribut de la personne | **Absent** | Champ dédié + conserver « Dont BRSA » à l'import ASP | **P2** |
| **S4** | Catégorie France Travail (F/G) | **Absent** | Champ + date de constatation | **P2** |
| **A2** | Référent unique distinct du prescripteur | Partiel | Séparer orienteur / prescripteur / référent unique | **P2** |
| **C1 / C6 / C7** | Contrat d'engagement, points d'étape, avenants, conciliation | **Absent** | Trois types d'entretien s'appuyant sur la mécanique existante | **P2** |
| **A4** | Volume hebdomadaire 15-20 h | Partiel | Exploiter les heures hebdomadaires déjà importées ; seuil et alerte | **P2** |
| **S2** | Freins **levés** par frein | Partiel | Indicateur d'évolution entrée → dernière évaluation, par frein | **P2** |
| **§3.1** | Journalisation de **tous** les exports nominatifs | Partiel | Étendre à l'export FSE+ et à l'extraction complète | **P2** |
| **§3.7** | Durée des entretiens et agrégat d'heures d'accompagnement | **Promis, absent** | Champ de durée sur l'entretien + somme par personne et globale | **P2** |
| **§3.5** | Trois bases d'ETP | **Ambigu** | Base 1 820 h seule dans les documents de conventionnement ; renommer l'approximation | **P2** |
| **C4 / P3** | Présence aux rendez-vous et motif d'absence | **Absent** | Trois champs sur l'entretien | **P2** |
| **A6** | Motifs légitimes d'absence documentés | Partiel | Journal d'assiduité avec pièce référencée | **P2** |
| **P1b** | Suspension du Pass IAE | Partiel | Statut du Pass + dates + motif | **P2** |
| **§3.6** | Motifs de sortie ASP traduits | Non exploité | Reprendre la table de correspondance de l'état | **P2** |
| **§3.3** | Chiffre ASP absent de la synthèse COPIL | Incohérent | Afficher l'ASP en premier, l'approximation ERP en contrôle | **P2** |
| **P2** | Orientation DORA rattachée au frein | **Absent** | Lien vers la fiche du service, date, résultat | **P3** |
| **S1 / S7** | Débouché des immersions et lien immersion → sortie | **Absent** | Champ de débouché + rattachement | **P3** |
| **C5** | Aides mobilisées (mobilité, garde, transport) | Partiel | Nature, organisme, montant, date sur l'action | **P3** |
| **RES-03** | Dépôt du scan de l'exemplaire signé | **Absent** | Pièce jointe sur l'entretien | **P3** |
| **A3** | Actualisation mensuelle France Travail | **Absent** | Rappel + case de suivi | **P3** |
| **RES-11** | Entretien professionnel (L.6315-1) | **Non levée** | Type d'entretien dédié | **P3** |
| **§3.2** | Tableau des freins : BRSA, catégorie FT, éligibilité, frein levé, référent | Partiel | Cinq colonnes à ajouter | **P3** |
| **§7.2** | En-tête de traçabilité sur **tous** les exports | Partiel | Généraliser la feuille « Informations » du tableau des freins | **P3** |

---

### Mot de la fin

Je termine par où j'ai commencé, pour qu'une liste de trente-trois lignes ne donne pas le sentiment
d'un dossier en difficulté : **ce n'est pas le cas**. Les fondations — dossier individuel daté, gelé,
historisé, journalisé, minimisé — sont posées et elles sont bonnes. Ce qui manque relève de **champs
à ajouter, de dénominateurs à corriger et d'écrans qui n'ont pas été faits**, non d'une conception à
reprendre. Le seul point appelant une réaction rapide est le volet européen, parce que c'est le seul
où le temps joue contre vous : un questionnaire d'entrée non recueilli ne se rattrape pas, et un
statut de sortie saisi hors délai bloque le dépôt des bilans de tout un projet.

Je reste disponible pour fournir la maquette du questionnaire participant, les cibles de l'annexe
financière et la liste des critères d'éligibilité en vigueur, et pour recevoir la présentation de
l'outil — que j'accepte volontiers, à condition qu'elle contienne la démonstration du point 6 du
§7.2.

*Fariza D'André — 12 septembre 2026.*
*Document de travail interne au chantier `cip-refonte-2026-09-12`, rédigé en posture d'autorité de
tutelle. Aucune donnée nominative n'y figure. Les constats techniques sont issus d'une lecture du
dépôt au 12/09/2026 et sont à faire confirmer par la structure.*
