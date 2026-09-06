# Mail — démarche d'amélioration continue / certification RSEi
## Évolution SOLIDATA 2.50.0 — Collecte en déchèterie : bordereau Métropole

> **Usage** : ce document est rédigé pour être envoyé tel quel. Il vaut à la fois
> **pièce d'archive** pour la démarche de labellisation RSEi (à verser au registre de
> preuves du module Pilotage RSE) et **note d'information opérationnelle** pour le
> manager de collecte. Les champs entre crochets sont à compléter avant envoi.

---

**Objet :** Amélioration continue — SOLIDATA 2.50.0 : le bordereau de collecte en déchèterie devient un document signé et tracé (information manager de collecte + pièce RSEi)

**De :** [Direction / Référent RSE]
**À :** [Manager de collecte]
**Copie :** [Direction], [Référent RSEi], [DPO], [Responsable QHSE]
**Date :** [JJ/MM/AAAA]
**Classement RSEi :** registre de preuves — critères 1.2, 1.4, 4.3, 5.1, 5.4 (voir § 5)
**Conservation de la pièce :** durée du cycle de labellisation + 1 an

---

Bonjour,

Ce message informe des évolutions apportées à SOLIDATA pour la collecte en déchèterie,
et sert de pièce d'archive pour notre démarche d'amélioration continue dans le cadre de
la labellisation RSEi. Il est structuré pour que chacun y trouve ce qui le concerne :
le **§ 2 et le § 3 sont destinés au manager de collecte et aux équipes**, les **§ 4 à 7
à la démarche de certification**.

---

## 1. Ce qui a déclenché cette évolution

La Métropole Rouen Normandie demande, pour chaque enlèvement réalisé par une structure de
l'ESS sur une zone de réemploi de ses déchèteries, la production d'un **« Bordereau de
collecte des ESS sur les zones de réemploi »** signé par l'agent de la déchèterie et par
le chauffeur de l'ESS.

Jusqu'à présent, ce document était traité **hors du système d'information** : le formulaire
papier circulait, sans lien avec la tournée qui l'avait produit, sans preuve consultable a
posteriori, et sans que SOLIDATA sache même qu'un point de collecte était une déchèterie.
Nous ne pouvions donc ni garantir qu'un bordereau avait bien été établi à chaque passage,
ni le retrouver rapidement en cas de demande de la Métropole.

Il s'agit d'une **exigence documentaire d'une partie prenante institutionnelle majeure**.
La traiter dans l'outil, plutôt qu'à côté, était la seule façon d'en faire une preuve
opposable.

---

## 2. Ce qui change pour les équipes de collecte

### 2.1 Sur le terrain — le chauffeur

Rien ne change tant que le point collecté n'est pas une déchèterie : l'identification du
point et la saisie du remplissage restent **exactement** ce qu'elles étaient.

Sur une déchèterie identifiée comme telle, l'application enchaîne après la collecte sur un
écran dédié en trois temps :

1. **Le poids indicatif en kilos.** Saisie à gros boutons, utilisable avec des gants.
2. **La signature de l'agent de la déchèterie**, tracée au doigt sur l'écran du téléphone.
   Si l'agent n'est pas disponible, le chauffeur appuie sur « L'agent n'est pas disponible » :
   le bordereau portera la mention « Signature de l'agent non recueillie : agent indisponible ».
   **Le chauffeur n'est jamais bloqué devant une déchèterie.**
3. **La signature du chauffeur**, obligatoire.

**Hors réseau, rien n'est perdu** : le bordereau et les deux signatures sont conservés dans
le téléphone et envoyés dès que la connexion revient. C'est une exception assumée à notre
règle habituelle (les photos, elles, ne sont pas mises en file d'attente) : une photo de
borne se reprend au passage suivant, **la signature d'un agent de déchèterie ne se recueille
jamais deux fois**.

### 2.2 Au bureau — le manager de collecte

- **Vous êtes notifié** dès qu'une collecte en déchèterie a lieu (messagerie interne SOLIDATA
  + notification sur téléphone), avec un lien direct vers la tournée concernée.
- **Vous validez le bordereau** depuis la fiche de la tournée (rubrique « Bordereaux
  déchèterie ») : vous y consultez le document tel qu'il sera transmis, et un bouton
  « Valider » y ajoute la mention **« Validé par Solidarité textiles sur Solidata le
  JJ/MM/AAAA »** dans le bloc Remarques. Le document est alors régénéré avec cette mention.
- **Après validation, le poids et les signatures ne sont plus modifiables** : c'est une pièce
  signée par un tiers, elle ne se rouvre pas. Une seconde validation est refusée.
- **Vous retrouvez tous les bordereaux d'une déchèterie** depuis sa fiche dans Gestion des
  CAV, et tous ceux d'une journée depuis la fiche de la tournée. Le PDF se télécharge pour
  transmission à la Métropole.

### 2.3 Ce que le document contient — et ce qu'il ne contient pas

Le bordereau reproduit fidèlement le formulaire de la Métropole. SOLIDATA n'en remplit que
ce qui nous concerne :

| Bloc du formulaire | Rempli par SOLIDATA |
|---|---|
| Date de l'enlèvement | Oui, date réelle de la collecte |
| Déchetterie | Case de la commune concernée |
| ESS collectrice | « Solidarité Textile », figée |
| Objets collectés en nombre / en caisses | **Laissés vides** — nous ne collectons que du TLC sur ces zones |
| Objets collectés en kg — TLC | Le poids indicatif déclaré par le chauffeur |
| Signatures agent / chauffeur | Les deux signatures manuscrites recueillies sur le téléphone |
| Remarque(s) | La mention de validation par Solidarité Textiles |

---

## 3. Périmètre : quelles déchèteries sont concernées

La Métropole compte **15 déchèteries** à son réseau. SOLIDATA en connaît désormais **14**
(celles auxquelles correspond un point de collecte dans notre référentiel), marquées
automatiquement lors de la mise à jour, avec un contrôle de cohérence sur la commune : un
identifiant qui ne tombe pas sur la bonne commune n'est jamais marqué au hasard.

- **6 déchèteries** correspondent à une case du formulaire papier (Cléon, Boos,
  Caudebec-lès-Elbeuf, Déville-lès-Rouen, Petit-Quevilly, Le Trait) : la case est cochée
  automatiquement.
- **8 déchèteries** ne figurent pas dans la liste des 7 cases du formulaire (Anneville-Ambourville,
  Bois-Guillaume, Darnétal, Duclair, Grand-Couronne, Rouen, Saint-Jean-du-Cardonnay,
  Saint-Martin-de-Boscherville). Pour celles-ci, **aucune case n'est cochée au hasard** : le
  nom de la déchèterie est écrit en clair dans le bloc Remarques. *Point à instruire avec la
  Métropole : le formulaire fourni ne couvre que 7 communes alors que nous intervenons sur
  davantage de sites.*
- **Saint-Étienne-du-Rouvray** figure au formulaire mais n'a aujourd'hui aucun point de collecte
  dans SOLIDATA. Le jour où une collecte y sera organisée, il faudra cocher « Déchèterie » sur
  sa fiche dans Gestion des CAV.

**Action attendue du manager de collecte** : vérifier cette liste de 14 sites et signaler
toute déchèterie manquante ou marquée à tort. Le marquage se corrige en deux clics dans
Gestion des CAV.

---

## 4. Garanties de traçabilité et de conformité

Ces éléments constituent le cœur de la valeur probante du dispositif.

**Le poids déclaré est indicatif — et il le reste.** Il est présenté comme tel sur le
bordereau (« Poids indicatif déclaré par le chauffeur — ne vaut pas pesée ») et, dans le
système, **il n'alimente aucune pesée, aucun tonnage, aucun stock, aucun reporting Refashion
et aucun apprentissage du moteur prédictif**. Il vit uniquement dans le bordereau. Ce point
est vérifié par test automatisé à chaque évolution du logiciel : il n'y a aucun risque de
double comptage de tonnage entre le bordereau Métropole et nos déclarations d'éco-organisme.

**Un bordereau par passage.** Un même passage sur une même déchèterie ne peut pas produire
deux documents signés, y compris si le chauffeur recharge son écran ou si le téléphone
renvoie l'information après une coupure réseau.

**Chaîne complète et horodatée** : le bordereau porte un numéro unique (BD-AAAA-NNNN), la
tournée, le véhicule, le point de collecte et l'heure de génération. Chaque consultation du
document est journalisée, chaque validation également.

**Protection des signatures manuscrites.** Les signatures et le PDF sont conservés dans la
base de données, **jamais dans un dossier de fichiers accessible par simple adresse web**.
Le document ne s'ouvre qu'à travers l'application, par un utilisateur habilité (Administrateur
ou Manager), et cette ouverture laisse une trace.

**Information de la personne qui signe.** L'agent de déchèterie est un tiers : nous recueillons
sa signature manuscrite. L'écran du chauffeur affiche désormais, **avant la signature**, un
encadré à lui montrer, en langage simple : à quoi sert sa signature, combien de temps nous la
conservons, et comment demander à la consulter ou à la faire retirer. Cette information
préalable répond aux articles 12 à 14 du RGPD.

**Durée de conservation : 3 ans**, appliquée automatiquement (suppression du bordereau et des
signatures au terme). Cette règle est affichée dans l'écran RGPD de l'application, parmi les
neuf purges automatiques. Par ailleurs, si un salarié demande l'effacement de ses données, sa
signature est retirée du bordereau et le document régénéré ; la signature de l'agent de la
déchèterie, qui appartient à un tiers, est conservée avec la pièce.

---

## 5. Rattachement au référentiel RSEi

Cette évolution alimente les critères suivants. Les niveaux indiqués sont ceux auxquels
l'évolution **contribue** ; elle ne suffit pas à elle seule à les atteindre.

| Critère | Ce que l'évolution apporte |
|---|---|
| **1.2** Identification et dialogue avec les parties prenantes | Réponse formalisée, outillée et tracée à une **exigence documentaire écrite de la Métropole Rouen Normandie**. Chaque bordereau validé est une trace datée d'un échange avec cette partie prenante — à verser au journal des interactions PP du module Pilotage RSE. |
| **1.4** Ancrage territorial | Service rendu et documenté sur **14 déchèteries du réseau métropolitain**, au-delà de notre parc de bornes. |
| **1.3** Gouvernance et loyauté des pratiques | Validation managériale explicite, journalisation des consultations et des validations, impossibilité de modifier une pièce signée par un tiers. |
| **1.6** Veille technologique — « changement d'outil » | Le référentiel valorise explicitement le changement d'outil au niveau 3 : passage d'un formulaire papier non tracé à un document produit, signé, validé et archivé dans le SI. |
| **4.3** Économie circulaire | Traçabilité du TLC capté sur les **zones de réemploi** des déchèteries, jusqu'ici hors de toute traçabilité formelle. |
| **5.1** Évaluations internes | La conduite du changement elle-même (voir § 6) — cahier des charges, arbitrages tracés, **revue de sécurité indépendante**, preuves reproductibles — constitue une évaluation interne documentée, méthode transposable aux autres domaines. |
| **5.4** Bilan et pilotage du plan d'action RSE | Pièce à verser au registre de preuves et au bilan annuel : exemple concret de boucle « exigence d'une partie prenante → analyse → décision → réalisation → vérification → mise en service ». |

**Classement recommandé** : verser ce mail au **registre de preuves** du module Pilotage RSE
(SOLIDATA → Pilotage RSE → Registre de preuves), avec une échéance de fraîcheur au
[JJ/MM/AAAA + 12 mois], en le rattachant aux critères 1.2 et 4.3.

---

## 6. Méthode de conduite du changement (élément de preuve du critère 5.1)

L'évolution a suivi une méthode formalisée, dont chaque étape a laissé une trace écrite
conservée avec le code :

1. **Cahier des charges fonctionnel** rédigé à partir de la demande et du formulaire réel de
   la Métropole, incluant un état des lieux honnête de ce qui n'existait pas.
2. **Quatre arbitrages soumis à la direction** et tranchés avant tout développement : périmètre
   des déchèteries, conduite à tenir si l'agent est absent, durée de conservation, habilitations
   de validation. Les décisions sont consignées.
3. **Contrats techniques figés** avant écriture du code, pour que les trois volets (application
   chauffeur, serveur, back-office) soient développés en parallèle sans divergence.
4. **Revue de sécurité indépendante**, conduite par un intervenant distinct de ceux qui ont
   écrit le code. Elle a identifié **deux défauts critiques** dans le traitement des images de
   signature, qui ont été **reproduits puis corrigés avant toute mise en service**. Le fait que
   cette revue ait trouvé des défauts réels est, en soi, la preuve qu'elle n'était pas formelle.
5. **Vérification sur environnement réel** : 68 contrôles exécutés sur une base de données de
   production simulée, en jouant le parcours complet (dépôt du bordereau, tentative depuis un
   autre véhicule, refus des saisies invalides, validation, seconde validation, effacement RGPD,
   purge à échéance). S'y ajoutent plus de 4 000 tests automatisés sur l'ensemble de
   l'application, exécutés sans erreur.
6. **Validation visuelle du document** par la direction **avant** mise en service.

**Constat versé à l'amélioration continue** : la revue de sécurité a mis en évidence qu'un
point d'entrée alimenté depuis le terrain (ici, une image transmise par un téléphone) mérite
un contrôle plus strict que ce que la pratique habituelle prévoyait. Ce constat est étendu aux
prochains développements du même type.

---

## 7. Limites assumées et points ouverts

Par honnêteté vis-à-vis de l'évaluation, ces points sont énoncés explicitement :

1. **Le poids TLC est une estimation du chauffeur**, non une pesée. Il ne peut pas servir de
   base à une déclaration de tonnage. C'est écrit sur le document lui-même.
2. **Le logo officiel de la Métropole** n'est pas encore intégré (le scan fourni est
   inexploitable en impression) : le bordereau affiche pour l'instant la mention textuelle
   « MÉTROPOLE ROUEN NORMANDIE ». *À demander à la Métropole — fichier image de son logo.*
3. **Huit déchèteries sur lesquelles nous intervenons ne figurent pas dans les cases du
   formulaire** (voir § 3). *À instruire avec la Métropole : faire évoluer le formulaire, ou
   confirmer que la mention en clair dans les Remarques lui convient.*
4. **La transmission à la Métropole reste manuelle** : le PDF validé se télécharge et s'envoie
   par le canal habituel. Aucun envoi automatique n'est prévu à ce stade.
5. **Une passation accompagnée reste possible** : rien n'empêche techniquement le chauffeur de
   signer à la place de l'agent. C'est une règle de conduite, pas une barrière technique — à
   rappeler en briefing.

---

## 8. Ce qui est attendu, et de qui

| Qui | Quoi | Quand |
|---|---|---|
| Manager de collecte | Vérifier la liste des 14 déchèteries marquées, signaler les manques | À la mise en service |
| Manager de collecte | Informer les chauffeurs du nouvel écran et de l'encadré à montrer à l'agent | Avant la première collecte concernée |
| Manager de collecte | Valider les bordereaux au fil de l'eau depuis la fiche de tournée | En continu |
| Direction / Référent RSE | Verser ce mail au registre de preuves RSEi (critères 1.2, 4.3) | À réception |
| Direction | Demander à la Métropole son logo et instruire le point des 8 déchèteries hors formulaire | [échéance] |
| DPO | Prendre connaissance de l'inscription au registre des traitements (durée 3 ans, signature d'un tiers) | À réception |

---

**Documents de référence conservés avec le code** (accessibles sur demande) :
cahier des charges fonctionnel, contrats techniques, rapport de revue de sécurité,
rapport de vérification, cartographie des exigences. Dossier : `rapports/decheterie-2026-09-06/`.

**Version du logiciel** : SOLIDATA 2.50.0 — **statut** : [développement achevé et vérifié /
mis en service le JJ/MM/AAAA].

Je reste disponible pour toute précision.

[Signature]

