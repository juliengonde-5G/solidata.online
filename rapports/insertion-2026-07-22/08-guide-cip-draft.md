# Guide CIP — Le module Insertion au quotidien (projet)

> **→ version finalisée : `docs/GUIDE_CIP_INSERTION.md`** (réconciliée avec le réalisé PR 1 + PR 2, le 23/07/2026). Le présent brouillon est conservé pour la traçabilité de la conception.

> **Version projetée — établie sur les plans validés du 22/07/2026, à finaliser après développement.**
> Ce guide décrit le module Insertion tel qu'il fonctionnera après la mise en œuvre des plans validés (rapports 04 et 05, corrigés par les revues UX/CIP et audit — rapports 06 et 07). Les écrans définitifs pourront différer à la marge ; le guide sera relu et mis à jour lors de la recette, avec vous.

- **Public** : conseillère/conseiller en insertion professionnelle (CIP) de Solidarité Textiles ; certains passages concernent les encadrants techniques (ETI) et la direction.
- **Principe du module** : chaque salarié en insertion a un **dossier unique de parcours** — une frise chronologique, des entretiens historisés, des objectifs, un journal d'actions. Tout ce que vous saisissez sert trois fois : votre suivi quotidien, le document remis au salarié, la preuve pour les contrôles (DDETS, CD76). **Vous ne saisissez jamais deux fois la même chose.**
- **Où travailler** : votre page de travail est **« Espace CIP »** (menu Insertion). La page **« Pilotage & indicateurs »** sert à la direction et au dialogue de gestion — vous n'avez pas besoin de l'ouvrir tous les jours.

---

## Sommaire

1. [Mon espace du lundi matin](#1-mon-espace-du-lundi-matin)
2. [Un nouveau salarié arrive](#2-un-nouveau-salarié-arrive)
3. [Je conduis le diagnostic d'accueil](#3-je-conduis-le-diagnostic-daccueil)
4. [Je prépare un entretien en 10 minutes](#4-je-prépare-un-entretien-en-10-minutes)
5. [Je mène et je clôture un bilan](#5-je-mène-et-je-clôture-un-bilan)
6. [Je saisis une action au vol](#6-je-saisis-une-action-au-vol)
7. [Le renouvellement de contrat](#7-le-renouvellement-de-contrat)
8. [La PMSMP (immersion en entreprise)](#8-la-pmsmp-immersion-en-entreprise)
9. [La sortie](#9-la-sortie)
10. [Pass IAE et prolongation](#10-pass-iae-et-prolongation)
11. [Mes tableaux](#11-mes-tableaux)
12. [Ce que je remets au salarié](#12-ce-que-je-remets-au-salarié)
13. [FAQ — 10 questions fréquentes](#13-faq--10-questions-fréquentes)
14. [Lexique](#14-lexique)

---

## 1. Mon espace du lundi matin

**Objectif** : savoir en moins de deux minutes ce qui vous attend cette semaine, sans rien chercher.

**Pas à pas**

1. Ouvrez **Espace CIP**. En tête de page, le bloc **« Aujourd'hui / Cette semaine »** liste vos entretiens planifiés, avec l'heure et un badge **« préparation prête »** quand la note de préparation a déjà été générée (voir cas 4). Un clic ouvre directement la fiche du salarié sur le bon entretien.
2. En dessous, le bloc **Alertes** regroupe ce qui demande une action, **une ligne par salarié** (les badges se cumulent sur la ligne). Trois couleurs seulement :
   - **rouge** = réglementaire ou contractuel (Pass IAE arrivant à échéance, cumul CDDI ≥ 22 mois, diagnostic non réalisé à 30 jours) ;
   - **ambre** = organisation du suivi (bilan en retard, prochain rendez-vous non planifié, action critique en retard, renouvellement à préparer) ;
   - **gris** = à venir (pour anticiper, rien d'urgent).
3. Sur chaque alerte : **« Vu — me le rappeler dans 7 jours »** pour la mettre de côté sans la perdre (le report est enregistré).
4. Votre **file active** (« Mes salariés ») liste les salariés dont vous êtes référente ; les filtres (en parcours, fin de contrat proche, sans prochain RDV) servent à organiser la semaine.

**Ce qui est automatique** : les alertes se calculent seules à partir des dates déjà saisies (contrats, Pass, entretiens planifiés, échéances d'actions). Les rappels J-14 / J-7 / J-1 sur les entretiens planifiés aussi. Vous n'avez rien à programmer.

> **Points de vigilance**
> - Le rouge signifie « agir cette semaine ». Si vous voyez du rouge partout, dites-le : les seuils sont réglables par l'administrateur (écran Réglages insertion), ils doivent rester crédibles.
> - « Me le rappeler dans 7 jours » reporte l'affichage, pas l'échéance réelle : un Pass expire à sa date, quoi qu'il arrive.

---

## 2. Un nouveau salarié arrive

**Objectif** : ouvrir le dossier de parcours sans ressaisir ce que le recrutement sait déjà.

**Pas à pas**

1. La fiche collaborateur est créée par **l'import de paie** (c'est la règle dans SOLIDATA : seule la paie crée un collaborateur). Si le poste est un CDDI, le salarié passe automatiquement « en parcours ».
2. Si la personne est passée par le module Recrutement : depuis sa fiche candidat, utilisez **« Lier à un collaborateur »** (ou depuis la fiche salarié, « Lier une fiche de recrutement »). La liaison rapatrie dans le dossier de parcours : le **prescripteur**, le **Pass IAE** (numéro et dates), les **critères d'éligibilité** retenus, le **profil PCM**, le projet exprimé et les difficultés signalées à l'embauche.
3. Ouvrez la fiche : les **échéances du parcours** (diagnostic d'accueil, renouvellements liés aux fins de contrat, bilan de sortie) sont déjà posées. En tête de fiche, la **frise du parcours** se lit en **couloirs superposés** — Contrats (bandeaux), Entretiens (points : plein = réalisé, creux = planifié), Objectifs, PMSMP — chaque couloir pouvant être masqué d'une case à cocher, les événements trop proches étant regroupés (pastille « ×3 » dépliable) ; pour un salarié lié au recrutement, la frise commence aux événements d'embauche (entretien, PCM). En dessous, la **liste chronologique** classique reste la vue de référence, ligne par ligne. Pour un nouvel entrant, la frise n'affiche que le contrat et les échéances futures « en fantôme », et une carte unique remplace l'historique : **« Commencer le diagnostic d'accueil — à réaliser avant le [date d'entrée + 30 jours] »**.
4. Vérifiez l'en-tête de fiche : Pass IAE, prescripteur, durée cumulée CDDI. Complétez ce qui manque (par exemple le rythme de suivi souhaité : mensuel, bimestriel, trimestriel — il servira à proposer les dates de vos prochains bilans).

**Ce qui est automatique** : la création des échéances du parcours (à la liaison recrutement et à l'entrée en parcours par la paie), le pré-remplissage du dossier depuis le recrutement, le décompte du délai réglementaire de 30 jours pour le diagnostic. Les échéances se recalent seules après chaque bilan réalisé et chaque renouvellement ; un bouton **« Mettre à jour les échéances »** existe sur la fiche si besoin.

> **Points de vigilance**
> - Les éléments repris du recrutement (difficultés signalées, projet) arrivent **en texte, à titre d'information** : aucun niveau de frein n'est pré-coché. C'est vous qui évaluez, au diagnostic.
> - Si la carte « Commencer le diagnostic » reste affichée à l'approche des 30 jours, l'alerte passe au rouge : planifiez la ou les séances sans attendre (le diagnostic peut se faire en deux fois, voir cas 3).

---

## 3. Je conduis le diagnostic d'accueil

**Objectif** : dérouler la trame d'accueil en face à face, sans que l'écran fasse écran, et sans jamais perdre une saisie.

**Pas à pas**

1. Depuis la fiche : **« Commencer le diagnostic d'accueil »**. Le questionnaire suit la trame que vous connaissez, **une rubrique à la fois** (repère « Rubrique 3/9 » et sommaire cliquable sur le côté) : I. Identité — II. Logement — III. Accès aux droits — IV. Santé — V. Budget — VI. Mobilité — VII. Situation professionnelle — VIII. Projet professionnel — IX. Contrat d'insertion et réalisation de soi. Deux volets complètent la trame : **linguistique** (auto-évaluation simplifiée + votre observation) et **situation judiciaire** (réduite au niveau de frein et à l'impact sur l'organisation du travail — voir vigilance).
2. Chaque rubrique se conclut par votre **commentaire CIP** et, quand la rubrique nourrit un frein, par la **valorisation du frein** : une rangée de six boutons **[Non évalué | 1 | 2 | 3 | 4 | 5]**. Le bouton suggéré par les réponses est mis en évidence — **vous confirmez ou corrigez d'un clic, c'est toujours vous qui décidez**.
3. La **rubrique IX** (attentes, difficultés, objectifs, aide souhaitée — les mots du salarié) alimente directement les **objectifs du parcours**, marqués « origine : salarié ». C'est la trace de la co-construction.
4. Vous pouvez **vous arrêter à tout moment** : le diagnostic reste « en cours » et, à la réouverture, reprend là où vous étiez. Faire le diagnostic en **deux séances** (par exemple garder Santé et Budget pour un second rendez-vous, quand la confiance est là) est prévu — l'essentiel est de terminer dans la fenêtre des 30 jours.
5. À la fin : le radar des freins (la **toile d'araignée**, 9 axes) s'affiche, avec les « non évalué » réellement absents du tracé. Clôturez, puis générez le **PDF** (exemplaire salarié / exemplaire dossier — voir cas 12).

**Ce qui est automatique** : la **sauvegarde continue** (bandeau « Brouillon enregistré à HH:MM » — une coupure de courant ou un onglet fermé ne fait rien perdre), la suggestion des niveaux de freins depuis les réponses, la création des objectifs « origine salarié » depuis la rubrique IX, le report du statut « diagnostic en cours » dans vos alertes.

> **Points de vigilance**
> - **Santé** : notez uniquement ce qui a un impact sur le travail (contre-indications, RQTH et son échéance, suivi en cours oui/non). Pas de diagnostic médical, pas de pathologie détaillée. Le champ est chiffré en base, mais **la meilleure protection reste de ne pas écrire ce qui n'est pas nécessaire**.
> - **Judiciaire** : n'écrivez **jamais la nature des faits ni les condamnations**. Uniquement le niveau de frein et l'impact concret (« contrainte horaire liée à une obligation judiciaire »). Un rappel s'affiche à la saisie ; ce volet n'est visible que de vous, de la RH et de l'administrateur.
> - « Non évalué » est une réponse honnête et normale. Ne mettez jamais 1 « pour remplir » : cela fausserait la toile d'araignée et les moyennes.

---

## 4. Je prépare un entretien en 10 minutes

**Objectif** : arriver au rendez-vous de 14 h en sachant ce qui s'est dit, ce qui était prévu, ce qui est en retard — même si l'IA est indisponible.

**Pas à pas**

1. Depuis le bloc « Aujourd'hui » ou la fiche, ouvrez l'entretien planifié. La **synthèse factuelle** s'affiche instantanément, sans IA : dernier avis, objectifs en cours, actions en retard, delta des freins depuis le dernier bilan.
2. Si le badge **« préparation prête »** est présent, la note de préparation IA a été générée automatiquement 7 jours avant le rendez-vous. Ouvrez-la : synthèse de situation, points à aborder selon le type d'entretien, questions suggérées.
3. Sinon, cliquez **« Préparer cet entretien »** : la génération prend jusqu'à deux minutes — anticipez, ne la lancez pas à 13 h 58.
4. La note est **une proposition** : modifiez-la, supprimez ce qui ne va pas, ajoutez vos points. Votre version est conservée avec l'entretien.

**Ce qui est automatique** : la génération à J-7 pour les entretiens planifiés (activée par défaut, désactivable dans les réglages), la synthèse factuelle sans IA, la **pseudonymisation** — l'IA ne reçoit **jamais** le nom du salarié ni ses données d'identification, seulement un dossier anonymisé (« Salarié A »).

> **Points de vigilance**
> - L'IA **propose, vous décidez**. Rien de ce qu'elle écrit n'engage le parcours tant que vous ne l'avez pas repris à votre compte. Les notes sont étiquetées « Proposition IA » et l'historique garde vos modifications : c'est aussi ce qui prouve, en contrôle, que l'humain a gardé la main.
> - La préparation IA ne remplace pas la synthèse factuelle : vérifiez toujours les dates et les chiffres à l'écran.

---

## 5. Je mène et je clôture un bilan

**Objectif** : faire un bilan de suivi plus vite que sur le formulaire Word actuel, et ne jamais laisser un bilan « ni fait ni planifié ».

**Pas à pas**

1. Depuis la fiche : **« Nouveau bilan »** (ou ouvrez le bilan planifié). Le formulaire suit **l'ordre de la trame papier**, en cinq étapes affichées sur un rail latéral :
   1. **Situation du jour** — quatre zones : administrative, sociale, professionnelle, nouveaux éléments.
   2. **Depuis le dernier bilan** — les objectifs et les actions du bilan précédent sont **repris automatiquement**. Pour chaque ligne, **un seul geste** : [Atteint] [En partie] [Non fait] pour un objectif, [Faite] [Non faite] pour une action (+ résultat). Le respect des échéances est **calculé par le système** — on ne vous le demande pas. Un commentaire est possible, jamais obligatoire.
   3. **Freins** — les neuf axes en boutons [Non évalué | 1–5], pré-remplis avec la dernière évaluation ; la toile d'araignée se superpose en direct (série précédente en pointillé, tendances ↗ ↘ =).
   4. **Objectifs et actions** — les objectifs non atteints sont reportés d'office ; ajoutez les nouveaux (origine salarié ou CIP, échéance, date butoir), et les actions à mener (ajout rapide en deux champs).
   5. **Clôture** — progression et autonomie (trois niveaux, comme sur la trame), points de vigilance (champ interne, jamais sur l'exemplaire salarié), avis global.
2. À tout moment, **« Enregistrer le brouillon »** : un bilan peut rester incomplet et être repris plus tard. La sauvegarde automatique tourne de toute façon en continu.
3. Le rail latéral affiche en permanence **« Prêt à clôturer : 3/4 »** avec le détail de ce qui manque.
4. **« Clôturer le bilan… »** ouvre la fenêtre de clôture : récapitulatif des contrôles, **date du prochain entretien proposée d'office** selon le rythme de suivi du salarié (modifiable), durée de l'entretien (valeur proposée, ajustable), case **« Relu avec le salarié (validation en présence) »**. Validez : le bilan est clos, le prochain rendez-vous est créé et apparaît dans votre agenda.
5. Générez le **PDF** et faites signer l'exemplaire papier (voir cas 12).

**Ce qui est automatique** : la reprise du bilan précédent (objectifs, actions, freins), le calcul du respect des échéances, le report des objectifs non atteints, la proposition de date du prochain rendez-vous, le recalage des échéances du parcours après clôture, la sauvegarde continue.

> **Points de vigilance**
> - **Enregistrer n'est pas clôturer.** Un brouillon ne déclenche ni contrôle ni rendez-vous suivant. Ne laissez pas des bilans en brouillon durablement : ils apparaissent en ambre dans vos alertes.
> - **La clôture sans prochain rendez-vous est impossible** (sauf bilan de sortie). C'est voulu : c'est la « date du prochain point » de votre trame papier, et c'est elle qui alimente tous les rappels.
> - **Un bilan clôturé est verrouillé.** Pour corriger une erreur : « Rouvrir », avec un **motif obligatoire** — la réouverture est journalisée et les validations sont à refaire. C'est ce qui donne sa valeur de preuve au dossier en cas de contrôle.
> - Si la clôture est refusée, le message vous dit **champ par champ** ce qui manque — pas de message générique.

---

## 6. Je saisis une action au vol

**Objectif** : noter « il a eu la CAF » ou « prendre RDV CPAM » en moins de 30 secondes, où que vous soyez dans le module.

**Pas à pas**

1. Cliquez le bouton **« + Action »**, toujours visible dans l'en-tête du module Insertion, quelle que soit la page ouverte.
2. Deux champs obligatoires : le **salarié** (autocomplétion, vos derniers dossiers consultés en premier) et le **libellé** (« Relancer dossier APL »).
3. Tout le reste est pré-rempli : catégorie, criticité moyenne, échéance à +14 jours (réglable dans les paramètres). Ajustez seulement si nécessaire — la **criticité haute** est là pour ce qui ne peut pas attendre.
4. Touche **Entrée** : c'est enregistré. Un message discret confirme (« Action ajoutée pour X ») et vous restez sur votre page.
5. Plus tard, au calme, complétez depuis le tableau **Actions CIP** : **partenaire mobilisé** (CAF, France Travail, CPAM, ANTS, SOLIHA, bailleur, OPCO, mission locale… — liste administrable), **résultat**, rattachement à un objectif ou à un bilan si utile.

**Ce qui est automatique** : les valeurs par défaut, le rattachement facultatif (une action peut vivre « au fil de l'eau », sans bilan), l'apparition de l'action dans le prochain bilan du salarié (étape « Depuis le dernier bilan ») et dans le tableau transversal.

> **Points de vigilance**
> - Ce journal d'actions est **votre preuve d'accompagnement** au sens de la convention (« nature, objet, durée » des actions — article 5). Notez l'action **le jour où elle a lieu**, même en deux mots : c'est la date qui compte, vous enrichirez après.
> - Renseignez le **partenaire** dès que vous le connaissez : c'est ce qui permet, en fin d'année, de montrer le réseau mobilisé (et d'objectiver les partenaires qui ne répondent pas).
> - Le **résultat** clôt l'action. Une action sans résultat reste « en cours » et pèse dans vos listes : soldez au fil de l'eau.

---

## 7. Le renouvellement de contrat

**Objectif** : instruire environ deux renouvellements par semaine sans double saisie, dans le circuit réel : encadrant → CIP → directeur.

**Pas à pas**

1. La liste **« Renouvellements à préparer »** (Espace CIP) affiche les contrats finissant dans moins de six semaines. L'encadrant technique concerné est prévenu de son côté.
2. **L'encadrant remplit son volet** sur un écran dédié, accessible par lien direct (« 2 renouvellements à remplir ») : un salarié, une page, les rubriques de la trame papier (assiduité, motivation, autonomie, participation, projet professionnel, motifs) en boutons et cases larges, l'**avis** (favorable / avec réserves / défavorable), la **durée proposée** (2 / 4 / 6 mois), puis **« Transmettre à la CIP »**. Il n'a pas à naviguer dans le module.
3. Vous recevez le formulaire **pré-rempli** dans votre liste : complétez votre volet (éléments du parcours, votre avis), préparez la réunion de renouvellement.
4. **Triple validation** : encadrant, CIP, directeur — chacun valide avec son compte, horodaté. Le PDF de renouvellement est généré pour le dossier.
5. Le renouvellement recale automatiquement les échéances du parcours.

**Ce qui est automatique** : la détection des fins de contrat à moins de six semaines, la transmission encadrant → CIP, le lien avec le contrat de renouvellement, le recalage des échéances, l'alerte sur le **cumul CDDI** (badge « 22/24 mois »).

> **Points de vigilance**
> - Le salarié **ne doit pas découvrir la décision au dernier moment** (procédure interne) : le module trace l'instruction, mais l'annonce reste un entretien humain, à vous de le planifier.
> - **Au-delà de 24 mois de CDDI cumulés**, le module exige un **motif de dérogation** (formation en cours, 50 ans et plus, RQTH, CDI inclusion) et la date de décision. Pour un contrat arrivé par l'import de paie, le module ne bloque pas la paie : il ouvre une alerte **« dérogation à régulariser »** qui reste visible tant que le motif n'est pas saisi.
> - Si l'encadrant a rempli un formulaire papier (situation transitoire), c'est vous qui le retranscrivez : indiquez alors l'origine « saisi par la CIP d'après le formulaire papier de l'encadrant ».

---

## 8. La PMSMP (immersion en entreprise)

**Objectif** : enregistrer une période d'immersion, avec les règles légales vérifiées automatiquement, sans oublier l'outil officiel.

**Pas à pas**

1. Fiche salarié → onglet Parcours → **« + PMSMP »**.
2. Saisissez : dates, **organisme d'accueil** (avec son SIRET), **objet légal** (découvrir un métier / confirmer un projet professionnel / initier un recrutement), tuteur, et plus tard le bilan de l'immersion.
3. Cochez **« Convention saisie dans l'outil officiel (Immersion Facilitée) »** une fois la saisie faite sur la plateforme — c'est elle qui fait foi, la convention Cerfa signée reste au dossier.
4. La PMSMP apparaît sur la frise du parcours (segment dédié) et dans la colonne PMSMP des exports.

**Ce qui est automatique** : le contrôle des **bornes légales** — au plus 1 mois par convention, cumul limité à **60 jours sur 12 mois glissants chez un même organisme d'accueil**, au plus 2 conventions avec le même organisme (et pour des objets différents). En cas de dépassement, le module vous avertit en citant la règle. Le contrat CDDI **n'est pas suspendu** pendant l'immersion — rien à faire côté paie.

> **Points de vigilance**
> - Le plafond de 60 jours s'apprécie **par organisme d'accueil**, pas toutes immersions confondues : le module fait le bon calcul, mais vérifiez que le SIRET saisi est le bon (deux établissements d'une même enseigne sont deux organismes).
> - La saisie dans **Immersion Facilitée** est une obligation de la convention (article 3.3) : la case n'est pas décorative, elle sera regardée en contrôle.

---

## 9. La sortie

**Objectif** : clore le parcours proprement — bilan, classement officiel de la sortie, documents remis, satisfaction — et préparer le suivi à 3 mois.

**Pas à pas**

1. Ouvrez le **Bilan de sortie** (proposé automatiquement à l'approche de la fin de contrat sans renouvellement). Le formulaire reprend : synthèse de l'évolution du parcours, **évolution des freins** (toile d'araignée superposée entrée/sortie, tendances), actions restant à réaliser par le salarié.
2. Renseignez la **catégorie officielle de sortie** — obligatoire pour clôturer :
   - **Emploi durable** (CDI, CDD ou intérim de 6 mois et plus, création d'entreprise…) ;
   - **Emploi de transition** (CDD ou intérim de moins de 6 mois, contrat aidé) ;
   - **Sortie positive** (formation qualifiante, entrée dans une autre SIAE…) ;
   - **Autre sortie** (avec le sous-motif : chômage, inactivité, rupture…).
   Ajoutez la destination détaillée (type de contrat, employeur ou formation).
3. Cochez la **liste des documents remis** : solde de tout compte, certificat de travail, attestation France Travail. La clôture est impossible sans.
4. Proposez le **questionnaire de satisfaction** (trame interne : accueil, accompagnement, compétences, conditions de travail, bilan personnel, situation à la sortie, satisfaction globale, suggestions). La saisie est assistée ; les réponses ne sont restituées qu'en **agrégats anonymes**.
5. **Informez le salarié du contact post-sortie** : il sera recontacté dans 3 à 6 mois pour connaître sa situation ; il peut s'y opposer, et l'opposition est consignée (l'entretien passera alors en « non réalisable — opposition »). Cette information figure aussi sur le PDF du bilan de sortie.
6. Clôturez : le parcours passe en « terminé », et l'entretien **« Suivi post-sortie »** est planifié automatiquement à +3 mois. Le moment venu, vous y saisirez la **situation constatée** (en emploi, en formation, autre, injoignable) — deux minutes, souvent au téléphone.

**Ce qui est automatique** : la proposition du bilan de sortie, la planification du suivi post-sortie (fenêtre 3–6 mois, avec rappel), la reprise des sorties dans les statistiques annuelles (taux de sorties dynamiques), la clôture du parcours.

> **Points de vigilance**
> - La **catégorie de sortie** alimente directement les taux présentés à la DDETS : en cas de doute entre deux catégories, tranchez avec les définitions affichées à l'écran (et notez l'élément déterminant en commentaire).
> - Un salarié parti brutalement (abandon, licenciement) a droit au même soin de classement : « autre sortie » + sous-motif. Ne laissez pas de sortie sans catégorie.
> - En cas de **réembauche** plus tard, un **nouveau parcours** s'ouvre avec son propre diagnostic et son propre bilan de sortie (voir FAQ n° 6).

---

## 10. Pass IAE et prolongation

**Objectif** : ne jamais découvrir trop tard qu'un Pass expire, et produire le bilan de prolongation sans le rédiger from scratch.

**Pas à pas**

1. Le **Pass IAE** (numéro, début, fin) figure en tête de la fiche salarié — repris du recrutement si la liaison a été faite, sinon saisi par vous (source : plateforme des emplois de l'inclusion).
2. **7 mois avant l'échéance** (c'est l'ouverture de la fenêtre réglementaire de demande de prolongation), une alerte rouge apparaît, et le salarié entre dans la liste **« Pass à préparer »** du tableau de bord. Un second rappel intervient à 2 mois.
3. Depuis la fiche (badge Pass) **ou** depuis la liste « Pass à préparer » : **« Bilan de prolongation »**. Le module assemble un PDF à partir des bilans déjà saisis : synthèse du parcours, évolution des freins, actions menées et envisagées — le support attendu par le prescripteur habilité.
4. Relisez, ajustez, puis transmettez au prescripteur. **La demande de prolongation elle-même se fait sur la plateforme des emplois de l'inclusion** — l'ERP prépare la pièce, il ne remplace pas la démarche.
5. À l'accord, mettez à jour les dates du Pass sur la fiche.

**Ce qui est automatique** : les alertes à J-7 mois et J-2 mois (seuils réglables), la constitution du bilan de prolongation depuis vos bilans existants, la colonne « Fin PASS IAE » des exports.

> **Points de vigilance**
> - **Le bilan de prolongation n'est bon que si vos bilans le sont** : un parcours sans bilan récent produit un document creux. C'est une raison de plus de tenir le rythme de suivi.
> - La demande peut se faire au plus tôt 7 mois avant l'échéance et **au plus tard le dernier jour de validité** : passé ce délai, plus de prolongation possible. Ne « reportez » pas cette alerte-là à la légère.

---

## 11. Mes tableaux

**Objectif** : retrouver les vues transversales — pour vous, pour la direction, pour les partenaires.

**Pas à pas**

1. **Espace CIP** (quotidien) : bloc « Aujourd'hui / Cette semaine », alertes, file active « Mes salariés ». C'est votre page.
2. **Actions CIP** (`Insertion → Actions CIP`) : le tableau transversal de toutes les actions, tous salariés — filtres par salarié, catégorie, criticité, partenaire, retard ; tri par échéance ; ajout rapide ; export CSV. C'est votre « qu'est-ce que je dois faire cette semaine ».
3. **Pilotage & indicateurs** (direction, dialogue de gestion) : taux de sorties par catégorie comparés aux objectifs conventionnels (affichés « objectif non paramétré » tant que la direction n'a pas confirmé les valeurs — c'est normal), ETP réalisés (étiquetés « contrôle — la saisie officielle reste l'ASP »), typologie des publics, délai moyen des diagnostics, files actives, renouvellements et Pass à préparer.
4. **Export « Tableau des freins » (23 colonnes)** : le tableau demandé par le cahier des charges (identité, dates ACI et Pass, RQTH, niveau de formation, ressources, logement, situation familiale, les 7 freins, PMSMP, projet de formation, emploi visé), en XLSX ou CSV. Avant de générer, le module affiche la **complétude** (« 39/46 fiches complètes — voir les 7 incomplètes », avec le lien vers chaque fiche et la rubrique manquante) et des **filtres** (année, présents/sortis, par CIP référente).
5. **Exports pour l'extérieur** : la **variante agrégée non nominative** (comités de pilotage, DDETS, CD76) et la **synthèse comité de pilotage** (PDF/CSV, deux fois par an). Si un cofinancement FSE+ est confirmé, l'export FSE+ dédié s'ajoute (questionnaires d'entrée/sortie des participants).

**Ce qui est automatique** : le calcul de tous les indicateurs à partir de vos saisies courantes (aucune saisie « pour les statistiques »), la valorisation des freins de l'export à la **dernière évaluation en date**, la **journalisation** de chaque export nominatif (qui, quand, quel périmètre — exigence RGPD).

> **Points de vigilance**
> - Par défaut, l'export 23 colonnes **exclut le frein judiciaire** ; la variante « colonnes sensibles » n'existe que sur demande explicite et reste réservée ADMIN/RH. Pour toute transmission externe, utilisez la variante **agrégée**.
> - Vérifiez la complétude **avant** le rendez-vous, pas devant l'interlocuteur : les fiches incomplètes se corrigent en quelques minutes si l'on s'y prend la veille.
> - Chaque export/PDF porte la mention « Document de travail ERP — les saisies officielles (ASP / emplois de l'inclusion / Immersion Facilitée) font foi » : c'est voulu, ne la retirez pas.

---

## 12. Ce que je remets au salarié

**Objectif** : remettre un document que le salarié peut lire et comprendre, sans exposer vos notes internes, et en respectant ses droits.

**Pas à pas**

1. Sur chaque diagnostic et chaque bilan clôturé, le bouton **PDF** propose deux versions :
   - **Exemplaire salarié** : ouvre sur « **Ce que nous avons décidé** » en trois phrases courtes, l'évolution des freins en pictogrammes (↗ s'améliore, ↘ se dégrade, = stable), la toile d'araignée, un gros corps de texte. **Sans** les points de vigilance internes ni les détails santé/judiciaire.
   - **Exemplaire dossier** : complet, pour le classeur et les contrôles (accès selon habilitation).
2. Pour la relecture commune en fin d'entretien, activez le **mode relecture** : l'écran passe en grande typographie et masque les champs internes — vous relisez ensemble avant de valider.
3. Faites signer l'exemplaire salarié papier (double signature bilan ; triple signature renouvellement). Enregistrez la **remise** (date + mode : en main propre / envoyé) et, si possible, joignez le **scan de l'exemplaire signé** à l'entretien.
4. En pied de page de chaque PDF figure la **mention d'information RGPD** (version datée) : finalités, destinataires, durées, droits, existence de l'assistance IA.

**Les droits du salarié — à savoir expliquer simplement**

- **Accès** : il peut demander tout ce qui le concerne ; le PDF « exemplaire dossier » remis via la RH en est le vecteur naturel.
- **Rectification** : une erreur factuelle se corrige (sur un bilan clôturé, par la procédure de réouverture motivée).
- **Effacement / durées** : le dossier est conservé pendant le parcours puis 2 ans après le dernier contact, ensuite anonymisé automatiquement.
- **Opposition** : notamment au contact post-sortie (voir cas 9).
- **IA** : il est informé qu'une assistance IA prépare les entretiens, qu'elle ne reçoit pas son identité et qu'elle ne décide de rien.
- **Contact** : le délégué à la protection des données (dpo@solidarite-textiles.fr).

> **Points de vigilance**
> - **Ne remettez jamais l'exemplaire dossier au salarié par erreur** — le bouton distingue clairement les deux, vérifiez le titre du PDF avant impression.
> - La trace de remise et le scan signé sont ce qu'un contrôleur demandera pour prouver la co-construction : prenez le réflexe systématiquement, pas seulement « quand il y a le temps ».

---

## 13. FAQ — 10 questions fréquentes

**1. L'ordinateur s'éteint (ou je ferme l'onglet) en plein diagnostic : ai-je tout perdu ?**
Non. La sauvegarde est continue (bandeau « Brouillon enregistré à HH:MM »). À la réouverture, le diagnostic « en cours » reprend là où vous étiez, rubrique comprise.

**2. Puis-je modifier un bilan déjà clôturé ?**
Pas directement : un bilan clôturé est verrouillé (c'est sa valeur de preuve). Utilisez « Rouvrir » avec un motif — la réouverture est journalisée, les validations existantes tombent et sont à refaire après correction.

**3. Le salarié n'a pas de compte : comment « signe-t-il » ?**
Trois éléments se cumulent : la case « validé en présence du salarié » cochée par vous (horodatée), la signature papier sur l'exemplaire remis, et le scan de cet exemplaire signé joint à l'entretien. La remise elle-même est tracée (date + mode).

**4. Que voit exactement l'IA ? Peut-elle décider quelque chose ?**
Elle reçoit un dossier pseudonymisé (jamais le nom, jamais les identifiants), produit une note étiquetée « Proposition IA », que vous éditez librement. Elle ne fixe aucun niveau de frein, ne classe aucune sortie, ne prend aucune décision. Tout reste à votre main.

**5. Je ne peux pas évaluer un frein (sujet pas encore abordé) : je mets 1 ?**
Non, jamais. Choisissez « Non évalué » : l'axe n'est pas tracé sur la toile d'araignée et n'entre pas dans les moyennes. Un 1 « par défaut » fausse tout.

**6. Un ancien salarié est réembauché : comment faire ?**
Sa réentrée en parcours ouvre un **nouveau parcours** sur le même dossier : nouveau diagnostic d'accueil (dans les 30 jours), nouveaux bilans, nouveau bilan de sortie et nouvelle enquête de satisfaction le moment venu. L'historique du premier parcours reste lisible sur la frise.

**7. Dois-je encore saisir sur les emplois de l'inclusion, l'extranet ASP, Immersion Facilitée ?**
Oui. SOLIDATA **prépare et contrôle** (il produit les pièces, vérifie les délais et les cohérences) mais **ne remplace aucune saisie officielle**. Les plateformes de l'État font foi ; l'écran et les exports le rappellent.

**8. Qu'ai-je le droit d'écrire dans les champs santé et judiciaire ?**
Santé : uniquement l'impact professionnel (contre-indications, RQTH + échéance, suivi oui/non). Judiciaire : uniquement le niveau de frein et l'impact organisationnel — **jamais la nature des faits**. Règle simple : n'écrivez que ce dont vous avez besoin pour accompagner ; le chiffrement protège la donnée, pas la collecte excessive.

**9. Qui voit quoi dans le dossier ?**
Vous (CIP/RH) et l'administrateur : tout. L'encadrant technique : ses équipes seulement — grilles, renouvellement, objectifs professionnels ; **jamais** les détails santé, judiciaire ou budget, ni les textes du diagnostic social. La direction : la fiche en lecture. L'auditeur externe (rôle dédié) : uniquement des agrégats non nominatifs. Ces règles sont testées automatiquement à chaque livraison.

**10. Les alertes s'accumulent et je ne m'y retrouve plus : que faire ?**
D'abord traiter le rouge (réglementaire), puis utiliser « Vu — me le rappeler dans 7 jours » sur ce qui peut attendre (le report est tracé). Si le volume reste ingérable, demandez l'ajustement des seuils dans les réglages : des alertes que plus personne ne lit ne protègent personne.

---

## 14. Lexique

| Terme | Définition |
|---|---|
| **ACI** | Atelier et Chantier d'Insertion — le cadre conventionnel de Solidarité Textiles. |
| **ASP** | Agence de Services et de Paiement — verse l'aide au poste sur la base des états mensuels de présence (saisie officielle, hors ERP). |
| **Bilan de suivi** | Entretien intermédiaire à fréquence libre (souvent bimestrielle), numéroté (« Bilan de suivi n° 3 »), qui commence toujours par l'évaluation du précédent. |
| **CDDI** | Contrat à Durée Déterminée d'Insertion — 4 mois minimum, renouvelable dans la limite de 24 mois (dérogations possibles : formation en cours, 50 ans et plus, RQTH, CDI inclusion). |
| **CIP** | Conseiller·ère en Insertion Professionnelle — vous. |
| **COA** | Contrat d'Objectifs d'Accompagnement — engagement réciproque salarié/CIP sur des objectifs, repris de bilan en bilan. |
| **Criticité** | Niveau d'urgence d'une action CIP (haute / moyenne / basse) ; une action critique en retard déclenche une alerte. |
| **Diagnostic d'accueil** | Premier entretien approfondi du parcours (trame 9 rubriques), à réaliser dans les 30 jours suivant l'entrée. |
| **Échéances du parcours** | Les rendez-vous obligatoires posés automatiquement (diagnostic, renouvellements, bilan de sortie) — appelés « jalons » dans les documents techniques. |
| **ETI** | Encadrant·e Technique d'Insertion — remplit le volet renouvellement et, en phase 2, les grilles de compétences métier. |
| **File active** | L'ensemble des salariés en parcours dont vous êtes référente. |
| **Frein** | Difficulté périphérique à l'emploi, évaluée de 1 (très bloquant) à 5 (résolu) ou « non évalué ». Neuf axes : mobilité, santé, finances, famille, linguistique, administratif, numérique, logement, judiciaire. |
| **Jalon** | Terme technique pour une échéance du parcours (voir ci-dessus). |
| **Pass IAE** | Agrément individuel délivré via la plateforme des emplois de l'inclusion, valable 24 mois, prolongeable par un prescripteur habilité sur présentation d'un bilan du parcours. |
| **PMSMP** | Période de Mise en Situation en Milieu Professionnel — immersion en entreprise (1 mois max par convention, 60 jours max sur 12 mois chez un même organisme d'accueil). |
| **Prescripteur** | Organisme qui a orienté le salarié vers l'ACI (France Travail, mission locale, CD76…) ; en auto-prescription, c'est la structure elle-même qui a validé l'éligibilité. |
| **RQTH** | Reconnaissance de la Qualité de Travailleur Handicapé (avec date d'échéance). |
| **Sortie dynamique** | Somme des trois catégories officielles de sorties : emploi durable + emploi de transition + sortie positive. C'est le taux phare du dialogue de gestion. |
| **STC** | Solde de tout compte — l'un des trois documents obligatoires remis à la sortie (avec le certificat de travail et l'attestation France Travail). |
| **Toile d'araignée** | Le radar des freins : une forme par évaluation ; leur superposition montre l'évolution du parcours d'un coup d'œil. |

---

*Guide établi le 22/07/2026 sur les plans validés (rapports 04/05/06/07). À relire en recette avec la CIP, puis à finaliser après développement. Les copies d'écran seront ajoutées à la version définitive.*
