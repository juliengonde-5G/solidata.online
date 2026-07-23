# Référentiel d'analyse de la performance de la pratique d'accompagnement

> **Module livré — dernière mise à jour 23/07/2026.**
> Les indicateurs décrits s'appuient sur les écrans et exports du module Insertion effectivement livrés (« Espace CIP », « Pilotage & indicateurs » = `/insertion/audit`, « Actions CIP » = `/insertion/actions`) et sur les endpoints qui les alimentent (audit conventionnel `/insertion/audit` + cibles `/insertion/cibles`, cohorte `/insertion/cohorte/stats`, actions `/insertion/actions-overview`, satisfaction `/insertion/satisfaction-stats`, PMSMP `/insertion/pmsmp`). Depuis la livraison de l'**espace encadrant technique** (lot 8 : grilles de compétences métier, entretien de période d'essai), les **évaluations de compétences** saisies par l'encadrant constituent une **source complémentaire** (progression au poste), mobilisable uniquement en lecture agrégée et anonyme — jamais comme une notation individuelle (voir C6). Les seuils indicatifs restent à confirmer lors de la première revue d'équipe après mise en production.

---

## Préambule — ce que cet outil est, et ce qu'il n'est pas

Ce référentiel est un outil d'**analyse de la pratique d'accompagnement** et d'**aide au pilotage**. Il poursuit trois finalités, et trois seulement :

1. **La qualité de l'accompagnement** : vérifier que chaque salarié en parcours bénéficie de ce que la structure s'est engagée à fournir (diagnostic dans les délais, bilans réguliers, actions suivies, sortie préparée), et repérer collectivement ce qui coince.
2. **Une charge soutenable** : objectiver la charge réelle de la fonction accompagnement — aujourd'hui de l'ordre de **0,86 ETP de CIP pour environ 46 salariés en parcours**, soit un ratio d'environ 53 accompagnements par ETP — pour ajuster l'organisation avant que la qualité ou la personne ne cède.
3. **Le plaidoyer pour les moyens** : donner à la direction des chiffres solides à porter au dialogue de gestion, auprès des financeurs et du conseil d'administration, pour argumenter les moyens de la fonction insertion.

**Ce que cet outil n'est pas — et ne doit jamais devenir :**

- **Pas un outil de surveillance individuelle des CIP.** Aucun indicateur ne sert à évaluer, comparer ou sanctionner une personne. Aucun objectif chiffré individuel n'est fixé sur ces indicateurs, aucun classement n'est établi, et ils n'alimentent ni l'entretien annuel ni aucune décision RH individuelle.
- **Pas une notation des salariés en insertion.** Les freins, objectifs et sorties sont des données d'accompagnement, jamais des « scores de mérite ». Aucune restitution de ce référentiel n'est nominative côté salariés : tout est agrégé.
- **Pas un tableau de rendement.** Un accompagnement d'insertion ne se mesure pas au volume : une action lourde (dossier de surendettement, sortie d'hébergement) vaut des dizaines de micro-actions. Les chiffres ouvrent des questions ; ils ne portent jamais de conclusion à eux seuls.

---

## 1. Principes et garde-fous

1. **Agrégats uniquement.** Toute restitution porte sur des ensembles (la cohorte, l'année, le trimestre), jamais sur un salarié nommé. Les indicateurs se calculent depuis les données déjà saisies au fil de l'accompagnement : **aucune saisie supplémentaire n'est demandée « pour le contrôle »**.
2. **Périodes d'au moins un trimestre.** En dessous, les effectifs sont trop faibles pour signifier quoi que ce soit (une seule sortie déplace un taux de 2 à 3 points). Les lectures hebdomadaires ou mensuelles ne servent qu'à l'organisation opérationnelle, jamais à l'analyse de la pratique.
3. **Jamais de classement individuel.** Le cas de Solidarité Textiles impose une vigilance particulière : **avec une CIP unique, tout indicateur « par CIP » est de fait individuel.** La règle est donc explicite : ces chiffres se lisent comme des **indicateurs de charge et de fonctionnement du système** (ratio d'accompagnement, organisation, partenaires, moyens), jamais comme une évaluation de la personne. Ils sont systématiquement partagés avec la CIP **avant** toute diffusion, commentés par elle, et présentés avec son commentaire.
4. **Co-analyse en réunion d'équipe.** Un indicateur ne se lit jamais seul ni en tête-à-tête hiérarchique improvisé : il se discute dans les rituels prévus au § 3, la CIP parlant en premier. L'interprétation qualitative prime ; le chiffre sert de point de départ à la question « qu'est-ce qui l'explique ? », pas de réponse.
5. **Chaque indicateur porte ses limites.** Les fiches du § 2 énoncent explicitement ce que l'indicateur **ne dit pas**. Une restitution qui omet les limites d'interprétation n'est pas conforme au présent référentiel.
6. **Transparence institutionnelle.** Le référentiel est présenté au CSE (comme le module lui-même), révisé une fois par an en réunion d'équipe, et toute évolution d'usage (nouvel indicateur, nouveau destinataire) repasse par cette validation. En cas de doute sur un usage, la question à se poser est : « cet usage sert-il la qualité de l'accompagnement, la soutenabilité de la charge ou le plaidoyer pour les moyens ? » — si la réponse est non, l'usage est hors référentiel.

---

## 2. Référentiel d'indicateurs

Quatre familles. Pour chaque indicateur : définition, formule, source dans le module, fréquence de lecture, seuil indicatif et **limites d'interprétation**.

> Convention de lecture des seuils : « cible » = niveau visé ; « vigilance » = niveau qui déclenche une discussion en revue (jamais une conclusion). Les seuils marqués « à confirmer en équipe » seront arrêtés lors de la première revue après mise en production.
>
> Tous les indicateurs sont calculés à partir des données déjà saisies et servis par les endpoints du module : `/insertion/audit` (indicateurs conventionnels et de pilotage) + `/insertion/cibles` (cibles paramétrées), `/insertion/cohorte/stats` (files actives, freins moyens, sorties), `/insertion/actions-overview` (journal d'actions filtrable), `/insertion/satisfaction-stats` (satisfaction agrégée), `/insertion/pmsmp`.

### Famille A — Couverture réglementaire

*Question : faisons-nous ce que la loi et la convention nous demandent, dans les délais ?*

**A1. Diagnostics d'accueil dans les 30 jours**
- **Définition** : part des salariés entrés en parcours sur la période dont le diagnostic d'accueil a été réalisé dans les 30 jours suivant l'entrée.
- **Formule** : diagnostics réalisés ≤ 30 j après la date d'entrée ÷ nombre d'entrées en parcours de la période. En complément : délai moyen de réalisation (jours).
- **Source** : écran « Pilotage & indicateurs » (`/insertion/audit`, délai diagnostic vs cible) ; liste des diagnostics en attente dans le bloc alertes de l'Espace CIP.
- **Fréquence** : trimestrielle.
- **Seuil indicatif** : cible 100 % ; vigilance < 90 %.
- **Limites** : une entrée groupée (cohorte de recrutement) ou l'absence du salarié (arrêt, imprévu) allonge mécaniquement le délai sans traduire une défaillance : lire avec les motifs. Le diagnostic en deux séances est conforme dès lors que la clôture tient dans la fenêtre.

**A2. Entretiens planifiés honorés**
- **Définition** : part des entretiens planifiés arrivés à échéance sur la période qui ont été réalisés (ou explicitement replanifiés).
- **Formule** : entretiens réalisés ÷ entretiens planifiés échus de la période. Le dénominateur est fiable par construction : la clôture d'un bilan exige la planification du suivant.
- **Source** : « Pilotage & indicateurs » (taux d'entretiens dans les délais) ; bloc « Aujourd'hui / Cette semaine » pour le suivi courant.
- **Fréquence** : trimestrielle.
- **Seuil indicatif** : cible ≥ 90 % ; vigilance < 75 %.
- **Limites** : les reports du fait du salarié (maladie, absence) comptent dans les non-honorés au premier calcul — distinguer en revue « non tenu » et « reporté avec motif ». Un taux très élevé avec des rythmes de suivi très espacés peut masquer un suivi distendu : croiser avec A3/B2.

**A3. Renouvellements documentés**
- **Définition** : part des renouvellements de CDDI intervenus qui portent un formulaire complet (volet encadrant + volet CIP) et la triple validation encadrant/CIP/directeur.
- **Formule** : renouvellements avec formulaire complet et validé ÷ renouvellements de contrat de la période. En complément : part des dérogations > 24 mois avec motif et date de décision saisis (cible 100 %).
- **Source** : liste « Renouvellements à préparer » (`/insertion/renouvellements`) + fiches ; file « dérogations à régulariser ».
- **Fréquence** : trimestrielle.
- **Seuil indicatif** : cible 100 % ; vigilance < 95 %.
- **Limites** : un retard de validation du directeur ou de saisie de l'encadrant n'est pas un défaut d'accompagnement de la CIP — l'indicateur mesure le **circuit à trois**, et c'est souvent le circuit qu'il faut régler.

**A4. Pass IAE à jour et prolongations anticipées**
- **Définition** : part des salariés en parcours dont le Pass IAE est renseigné et en cours de validité ; part des prolongations engagées dans la fenêtre réglementaire (à partir de 7 mois avant l'échéance).
- **Formule** : (a) salariés avec Pass renseigné non expiré ÷ salariés en parcours ; (b) bilans de prolongation générés avant J-2 mois ÷ Pass arrivant à échéance dans la période.
- **Source** : liste « Pass à préparer » du tableau de bord ; en-têtes de fiches.
- **Fréquence** : trimestrielle.
- **Seuil indicatif** : cible 100 % renseignés ; vigilance dès 1 Pass expiré sans prolongation engagée.
- **Limites** : la donnée de référence vit sur la plateforme des emplois de l'inclusion ; l'ERP reflète la saisie. Un « trou » peut être un simple défaut de report — vérifier la plateforme avant de conclure.

### Famille B — Intensité et réactivité

*Question : le suivi est-il régulier et réactif, au rythme prévu pour chacun ?*

**B1. Entretiens par salarié et par trimestre**
- **Définition** : nombre moyen d'entretiens réalisés (tous types) par salarié en parcours sur le trimestre.
- **Formule** : entretiens réalisés du trimestre ÷ file active moyenne du trimestre.
- **Source** : « Pilotage & indicateurs » ; détail par type dans l'export de synthèse.
- **Fréquence** : trimestrielle.
- **Seuil indicatif** : repère ≥ 1 par trimestre pour tous ; ~1,5 pour un rythme bimestriel majoritaire. À confirmer en équipe.
- **Limites** : l'intensité utile dépend du parcours : une file active en phase stable appelle moins d'entretiens qu'une cohorte de nouveaux entrants. Ne jamais transformer ce repère en quota — c'est la **distribution** (y a-t-il des salariés sans aucun entretien depuis longtemps ?) qui compte, pas la moyenne.

**B2. Délai entre deux bilans, comparé au rythme choisi**
- **Définition** : écart moyen entre bilans réalisés consécutifs d'un même salarié, rapporté au rythme de suivi retenu (à défaut de rythme par salarié — livré en phase ultérieure —, le rythme des bilans paramétré, défaut 2 mois).
- **Formule** : moyenne des (délai constaté − rythme prévu), et part des salariés « dans leur rythme » (délai ≤ rythme prévu + 2 semaines).
- **Source** : « Pilotage & indicateurs » ; alertes ambre « bilan en retard ».
- **Fréquence** : trimestrielle.
- **Seuil indicatif** : cible ≥ 80 % des salariés « dans leur rythme » ; vigilance < 60 %.
- **Limites** : le point de comparaison est le rythme retenu, pas une norme unique. Une dérive générale signale plutôt une surcharge (voir famille D) qu'un défaut de pratique : c'est typiquement un indicateur de plaidoyer.

**B3. Actions d'accompagnement par salarié**
- **Définition** : nombre d'actions du journal (créées ou soldées) par salarié en parcours sur la période ; répartition par catégorie et par partenaire.
- **Formule** : actions de la période ÷ file active moyenne ; ventilations par catégorie/partenaire.
- **Source** : page « Actions CIP » (`/insertion/actions-overview`, filtres + export CSV) ; statistique annuelle par partenaire.
- **Fréquence** : trimestrielle ; ventilation par partenaire en lecture annuelle.
- **Seuil indicatif** : pas de seuil — indicateur de **description**, pas de performance. À lire en tendance.
- **Limites** : compter n'est pas peser : une action « dossier de surendettement » représente des heures, une action « relance téléphonique » quelques minutes — le volume d'heures (B5) est plus honnête. Un chiffre bas peut aussi signifier une saisie différée : vérifier l'hygiène de saisie avant toute autre lecture. **Ne jamais fixer d'objectif de volume d'actions** : cela produirait de la saisie, pas de l'accompagnement.

**B4. Délai de traitement des actions critiques**
- **Définition** : réactivité sur les actions de criticité haute — délai médian entre création et résultat, et part en retard sur leur échéance.
- **Formule** : médiane (date de résultat − date de création) des actions critiques soldées ; actions critiques en retard ÷ actions critiques en cours.
- **Source** : « Actions CIP » (filtre criticité haute + retard) ; alerte « action critique en retard ».
- **Fréquence** : mensuelle (opérationnel) ; trimestrielle (analyse).
- **Seuil indicatif** : vigilance si > 20 % des actions critiques en retard. À confirmer en équipe.
- **Limites** : le délai dépend largement des **partenaires externes** (CAF, préfecture, bailleurs…) : lire systématiquement avec la colonne partenaire. Cet indicateur mesure souvent le système partenarial du territoire, pas la CIP — c'est précisément ce qui le rend utile en dialogue de gestion.

**B5. Volume d'accompagnement (heures)**
- **Définition** : heures d'accompagnement constatées (durées des entretiens réalisés + durées saisies sur les actions), par salarié et globales — la matière de l'article 5 de la convention (« nature, objet, durée »).
- **Formule** : somme des durées de la période ; moyenne par salarié en parcours.
- **Source** : synthèse annuelle et export comité de pilotage ; « Pilotage & indicateurs ».
- **Fréquence** : trimestrielle et annuelle (bilan conventionnel).
- **Seuil indicatif** : pas de seuil la première année — l'année 1 établit la référence.
- **Limites** : les durées sont déclaratives et arrondies (valeurs par défaut par type d'entretien) : l'ordre de grandeur est fiable, pas la minute. Ne pas comparer à d'autres structures sans harmoniser les conventions de saisie.

### Famille C — Qualité des parcours

*Question : les parcours produisent-ils des effets, et que nous disent les personnes ?*

**C1. Évolution des freins**
- **Définition** : progression moyenne des neuf axes de freins entre la première et la dernière évaluation, pour les salariés présents depuis au moins 6 mois ; part des salariés avec au moins un frein en amélioration.
- **Formule** : moyenne des deltas par axe (dernière évaluation − première), axes « non évalué » exclus ; % de salariés avec ≥ 1 axe en amélioration.
- **Source** : « Pilotage & indicateurs » (freins moyens de cohorte, `/insertion/cohorte/stats`) ; toiles d'araignée superposées sur les fiches (usage individuel d'accompagnement uniquement).
- **Fréquence** : semestrielle et annuelle.
- **Seuil indicatif** : pas de seuil — lecture en tendance pluriannuelle.
- **Limites** : l'échelle 1-5 est un jugement professionnel, pas une mesure ; une réévaluation honnête peut « dégrader » un score parce que la confiance a permis de voir un problème jusque-là caché — **une baisse peut être une bonne nouvelle clinique**. Ne jamais agréger en « note moyenne du salarié », ne jamais lire cet indicateur individuellement en instance, et ne jamais en faire un objectif chiffré : on obtiendrait des évaluations complaisantes. L'axe judiciaire, sensible, ne doit pas être restitué hors ADMIN/RH ni sur de très petits effectifs.

**C2. Objectifs atteints, en cours, abandonnés**
- **Définition** : devenir des objectifs individualisés du parcours (co-construits, origine salarié ou CIP).
- **Formule** : objectifs clos atteints ÷ objectifs clos de la période ; part des abandons avec motif renseigné ; répartition par origine (salarié / CIP).
- **Source** : onglet Objectifs & actions (agrégé dans « Pilotage & indicateurs »).
- **Fréquence** : semestrielle.
- **Seuil indicatif** : pas de cible de taux d'atteinte ; cible 100 % des abandons motivés.
- **Limites** : des objectifs ambitieux font mécaniquement baisser le taux d'atteinte — un taux très élevé peut signaler des objectifs trop prudents, pas une meilleure pratique. L'abandon motivé est une donnée saine (réorientation), pas un échec. Croiser avec l'origine : un déficit durable d'objectifs « origine salarié » interroge la co-construction.

**C3. Sorties par catégorie, comparées à l'objectif conventionnel**
- **Définition** : répartition des sorties constatées de l'année selon la nomenclature officielle (emploi durable / emploi de transition / sortie positive / autres avec sous-motifs) ; taux de sorties dynamiques.
- **Formule** : sorties de la catégorie ÷ sorties constatées de l'année (règle de calcul documentée à l'écran), comparé aux cibles conventionnelles paramétrées (`/insertion/cibles`).
- **Source** : « Pilotage & indicateurs » (bloc indicateurs conventionnels) ; export de synthèse.
- **Fréquence** : annuelle (suivi trimestriel indicatif en cours d'année).
- **Seuil indicatif** : l'objectif conventionnel paramétré — affiché « objectif non paramétré » tant que la direction n'a pas confirmé les valeurs sur les documents contractuels.
- **Limites** : sur ~20-30 sorties par an, **une seule sortie déplace le taux de 3 à 5 points** : les écarts d'une année ne signifient rien isolément. Le taux dépend du marché de l'emploi local, du profil des publics accueillis et de la conjoncture — jamais de la seule pratique d'accompagnement. La première année suivant la bascule de nomenclature (2026) n'est pas comparable aux séries antérieures (note méthodologique jointe au bilan annuel).

**C4. Satisfaction de sortie**
- **Définition** : ce que disent les personnes à la sortie (questionnaire interne : accueil, accompagnement, compétences, conditions de travail, bilan personnel, satisfaction globale) ; taux de réponse.
- **Formule** : moyennes par thème sur les questionnaires de l'année ; répondants ÷ sortants.
- **Source** : restitution annuelle anonymisée (`/insertion/satisfaction-stats`).
- **Fréquence** : annuelle.
- **Seuil indicatif** : taux de réponse cible ≥ 70 % ; vigilance sur tout thème durablement en retrait des autres.
- **Limites** : biais de désirabilité (le questionnaire est proposé par la structure au moment du départ) et petits effectifs : lire en tendance pluriannuelle et par thème, jamais en valeur absolue. Les verbatims libres (suggestions) valent souvent plus que les moyennes.

**C5. Situation post-sortie (3-6 mois)**
- **Définition** : part des sortants dont la situation à 3-6 mois est connue, et répartition de ces situations (en emploi, en formation, autre, sans nouvelle).
- **Formule** : situations constatées ÷ sortants contactables (les oppositions consignées sont exclues du dénominateur) ; ventilation des situations.
- **Source** : entretiens « Suivi post-sortie » agrégés (« Pilotage & indicateurs », bilan annuel).
- **Fréquence** : annuelle.
- **Seuil indicatif** : cible ≥ 60 % de situations connues. À confirmer en équipe.
- **Limites** : « injoignable » n'est pas un échec d'accompagnement (changement de numéro, mobilité) et l'opposition est un droit : l'indicateur mesure d'abord la **capacité de la structure à garder le lien**, et la durabilité des sorties ensuite. Interpréter la répartition avec prudence sur de petits effectifs.

**C6. Progression des compétences au poste (source complémentaire — encadrant technique)**
- **Définition** : évolution, en agrégat de cohorte, des notes de compétences métier saisies par l'encadrant technique entre la première et la dernière évaluation validée, pour les salariés présents depuis au moins 6 mois. Complète C1 (freins) et C3 (sorties) par un signal « montée en compétences au poste ».
- **Formule** : moyenne des deltas de note (dernière évaluation validée − première), items « non évalué » exclus ; part des salariés avec au moins une compétence en progression. **Jamais** restituée par salarié nommé.
- **Source** : onglet Compétences des fiches (`/insertion/competences/:employeeId`) ; à ce jour, **pas d'écran de pilotage agrégé dédié** — la lecture de cohorte se fait manuellement en revue à partir des évaluations validées (un tableau de bord consolidé pourra être ajouté ultérieurement).
- **Fréquence** : semestrielle et annuelle.
- **Seuil indicatif** : aucun — indicateur de **description**, pas de performance.
- **Limites** : la note /10 est un **jugement professionnel de l'encadrant**, pas une mesure, et elle porte sur la progression **au poste** — elle ne mesure pas la pratique de la CIP (c'est l'ETI qui évalue) et n'entre dans aucun classement. À ne **jamais** transformer en objectif chiffré ni en notation individuelle de salarié ; à lire en tendance de cohorte. Sa valeur tient au **binôme CIP-encadrant** : un écart entre progression des compétences et évolution des freins est un point de discussion en revue, jamais un verdict. La triple validation (salarié/encadrant/CIP) fiabilise la donnée mais ne la rend pas comparable d'un encadrant à l'autre sans harmoniser les usages de cotation.

### Famille D — Charge et soutenabilité

*Question : la charge de la fonction accompagnement est-elle tenable — et sinon, comment le démontrer ?*

**D1. File active par ETP de CIP**
- **Définition** : nombre de salariés en parcours rapporté aux ETP de CIP.
- **Formule** : file active moyenne de la période ÷ ETP CIP. Situation de référence : ~46 ÷ 0,86 ≈ **53 accompagnements par ETP**.
- **Source** : « Pilotage & indicateurs » (files actives).
- **Fréquence** : trimestrielle ; systématique au dialogue de gestion.
- **Seuil indicatif** : il n'existe **pas de norme réglementaire opposable** ; la structure se donne un repère interne, arrêté en équipe et revu annuellement, en deçà duquel les exigences des familles A et B sont réputées tenables. Tout dépassement durable de ce repère est porté au dialogue de gestion.
- **Limites** : le ratio brut ignore la lourdeur des situations (niveaux de freins, phases d'entrée/sortie plus consommatrices) : accompagner 40 personnes très éloignées de l'emploi peut peser plus que 55 parcours stabilisés. C'est l'indicateur central du **plaidoyer pour les moyens** — jamais un indicateur de productivité.

**D2. Stock d'actions en cours**
- **Définition** : nombre d'actions ouvertes à date, dont critiques, et ancienneté moyenne du stock.
- **Formule** : comptage à date (photo trimestrielle) ; part des critiques ; ancienneté moyenne des actions ouvertes.
- **Source** : « Actions CIP » (filtres statut/criticité).
- **Fréquence** : trimestrielle.
- **Seuil indicatif** : lecture en tendance ; vigilance si le stock croît trois trimestres de suite.
- **Limites** : un stock élevé peut signifier une charge réelle **ou** un retard de mise à jour des résultats : vérifier d'abord l'hygiène de saisie (actions terminées non soldées). Un stock bas juste après une purge de saisie ne dit rien de la charge.

**D3. Saturation de l'agenda d'accompagnement**
- **Définition** : occupation prévisionnelle des créneaux d'entretien de la CIP sur les 4 semaines à venir, rapportée à sa capacité théorique (temps de présence dédié aux entretiens).
- **Formule** : entretiens planifiés à 4 semaines ÷ capacité d'entretiens de la période (nombre de créneaux tenables par semaine × semaines, convention fixée en équipe).
- **Source** : bloc « Aujourd'hui / Cette semaine » et entretiens planifiés (« Pilotage & indicateurs »).
- **Fréquence** : mensuelle.
- **Seuil indicatif** : vigilance au-delà de ~80 % de saturation durable (plus aucune marge pour les urgences et imprévus).
- **Limites** : l'agenda du module ne capte pas tout le travail réel (réunions, ateliers collectifs, urgences de couloir, coordination partenaires) : la saturation réelle est **toujours supérieure** au chiffre. À 0,86 ETP, un taux élevé constant est un signal de moyens, pas d'organisation.

**D4. Pics d'échéances à venir**
- **Définition** : anticipation de charge — nombre de renouvellements, prolongations de Pass et bilans arrivant à échéance dans les 3 prochains mois, par mois.
- **Formule** : comptage prospectif par mois (renouvellements < 6 semaines, Pass < 7 mois, entretiens planifiés).
- **Source** : listes « Renouvellements à préparer » et « Pass à préparer » ; alertes grises « à venir ».
- **Fréquence** : mensuelle.
- **Seuil indicatif** : pas de seuil — outil de planification (lisser ce qui peut l'être, anticiper les absences).
- **Limites** : purement prévisionnel ; ne mesure rien de la pratique.

---

## 3. Rituels d'usage

Les indicateurs ne vivent que dans des rendez-vous réguliers, où la parole précède les chiffres.

**3.1 Revue mensuelle de pratique (CIP + responsable, 30-45 min)**
Objet opérationnel : les familles B (réactivité) et D (charge) en lecture courte, plus les alertes rouges en cours. La CIP ouvre la séance par son propre état des lieux qualitatif (grille du § 4.2) ; les chiffres viennent ensuite, comme contrepoint. Sortie attendue : 2-3 décisions concrètes (replanifications, arbitrages de priorité, relances partenaires, demandes d'appui), notées et revues le mois suivant.

**3.2 Revue trimestrielle direction (direction + CIP + représentant des ETI, 1 h)**
Objet : familles A (couverture) et D (soutenabilité) en série trimestrielle, famille B en tendance. C'est l'instance qui statue sur les seuils « à confirmer en équipe », qui décide des ajustements d'organisation, et qui consigne ce qui relève des moyens (à porter au § 3.3). Les constats sont archivés avec leur date : c'est la matière première du plaidoyer.

**3.3 Préparation du dialogue de gestion (annuelle, avant l'échéance DDETS)**
Objet : consolider l'année — famille C complète (sorties vs objectifs conventionnels, satisfaction, post-sortie), volume d'accompagnement (B5, au titre de l'article 5), ratio de charge (D1) et son historique. Supports : export de synthèse du module + note méthodologique (bascule de nomenclature 2026 la première année). La partie « charge » du dossier est relue par la CIP avant transmission.

**3.4 Rapport annuel et label RSEi**
Les agrégats des familles C et D alimentent le rapport annuel d'activité, la revue qualité annuelle (satisfaction + post-sortie + indicateurs → plan d'amélioration daté) et le dossier de labellisation RSEi (preuves du volet social : traçabilité de l'accompagnement, écoute des bénéficiaires, effets des parcours), ce dernier relevant d'une mission dédiée distincte. Un même chiffre ne se recalcule jamais deux fois : tout part des mêmes exports datés.

---

## 4. Trames

### 4.1 Ordre du jour type — revue mensuelle de pratique

1. **Tour qualitatif de la CIP** (10 min) — sans chiffres : situations marquantes du mois, ce qui a bien fonctionné, ce qui a coincé, état de charge ressenti (grille 4.2 en support).
2. **Retour sur les décisions du mois précédent** (5 min) — faites / en cours / abandonnées (et pourquoi).
3. **Lecture partagée des indicateurs du mois** (10 min) — B2 (rythmes de suivi), B4 (actions critiques), D3 (saturation à 4 semaines), alertes rouges en cours. Pour chaque écart : « qu'est-ce qui l'explique ? » avant « que fait-on ? ».
4. **Partenaires** (5 min) — blocages externes récurrents (depuis B4), relances à porter au niveau direction.
5. **Anticipation** (5 min) — pics d'échéances à 3 mois (D4), absences prévues, arbitrages de planification.
6. **Décisions** (5 min) — 2-3 actions datées, avec porteur ; besoins d'appui ou de moyens à faire remonter.

*Règles de séance : les chiffres arrivent après la parole ; aucune donnée nominative salarié dans le compte rendu ; le compte rendu est co-relu par la CIP.*

### 4.2 Grille d'auto-évaluation qualitative de la CIP

Support personnel de préparation des revues — remplie par la CIP pour elle-même, partagée si et dans la mesure où elle le souhaite, **jamais collectée, jamais archivée par la direction, jamais croisée mécaniquement avec les indicateurs**. Son rôle est d'apporter le regard qualitatif qui manque aux chiffres.

Pour chaque item, trois réponses possibles — « ça va » / « sous tension » / « ça déborde » — et une ligne libre « ce qui l'explique » :

| # | Item | Éclaire (famille) |
|---|---|---|
| 1 | J'arrive à préparer mes entretiens dans de bonnes conditions | B |
| 2 | Les rythmes de suivi que j'ai fixés sont tenus, ou révisés en conscience | B2 |
| 3 | Les délais réglementaires (diagnostics 30 j, renouvellements, Pass) sont tenables sans sacrifier le reste | A |
| 4 | La co-construction est réelle : les salariés portent des objectifs qui viennent d'eux | C2 |
| 5 | Je parviens à solder mes actions (résultats saisis) au fil de l'eau | B3/D2 |
| 6 | Les partenaires répondent dans des délais compatibles avec les situations | B4 |
| 7 | Le binôme avec les encadrants techniques fonctionne (renouvellements, évaluations de compétences, signaux terrain) | A3 |
| 8 | J'ai encore de la marge pour les urgences et les imprévus | D3 |
| 9 | La saisie dans le module reste une aide, pas une charge | transversal |
| 10 | Situations qui me préoccupent particulièrement ce mois-ci (sans détail nominatif écrit) | qualitatif |
| 11 | Ce dont j'aurais besoin (temps, appui, formation, arbitrage, outil) | plaidoyer |

**Usage croisé chiffres × grille** : en revue, chaque écart chiffré est confronté à la grille (« l'indicateur B2 se dégrade — la grille dit "ça déborde" sur l'item 8 : c'est un problème de charge, pas de pratique »). Quand les chiffres et le ressenti divergent, c'est le point le plus intéressant de la revue : il signale soit un problème de saisie, soit un angle mort — dans les deux cas, une discussion, jamais une mise en cause.

---

*Référentiel établi le 22/07/2026 dans le cadre de la mission Insertion, finalisé le 23/07/2026 après livraison du module (lots 1-8, espace encadrant technique compris). À présenter au CSE avec le module, à confirmer en première revue d'équipe après mise en production, puis à réviser annuellement.*
