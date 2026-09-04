# MANUEL RH — Module « Temps & Présence » (badgeuse)

**À qui s'adresse ce document.** Au service RH et aux encadrants techniques qui utilisent au quotidien l'écran SOLIDATA du pointage par badge. Il n'y a pas de captures d'écran ici : chaque étape décrit le chemin de clic exact, avec les libellés réels des boutons et des menus, tels qu'ils apparaissent à l'écran.

**Où se trouve l'écran.** Menu **Temps & Présence** de SOLIDATA. La page s'ouvre sur des onglets : **Journal**, **Feuilles de temps**, **Anomalies**, **Badges**, **Affichage**, **Supervision**, **Paramètres**.

**Qui a le droit de faire quoi.** Trois niveaux d'accès :

| Rôle | Peut voir | Peut faire |
|---|---|---|
| **Encadrant technique** (MANAGER) | Journal, Feuilles de temps, Anomalies, Badges (lecture), Affichage (lecture), Supervision, Paramètres (lecture) | Corriger un pointage, valider une feuille au niveau encadrant |
| **RH** (et ADMIN) | Tout | En plus de l'encadrant : rattacher un orphelin, attribuer/déclarer perdu/volé/restituer un badge, valider une feuille au niveau RH, produire les exports paie/IAE, publier un contenu sur l'écran, modifier les paramètres |
| **ADMIN** | Tout | En plus du RH : appairer/régénérer un poste, annuler une validation |

**Important : un encadrant ne corrige jamais ses propres pointages.** Le système le refuse automatiquement (message : « Vous ne pouvez pas corriger vos propres pointages — la correction relève d'un tiers »). La correction des pointages de la Direction relève d'un tiers désigné.

---

## 1. Le badge d'un salarié

### 1.1 Attribuer un badge

**Chemin :** Temps & Présence → onglet **Badges** → bouton **« Attribuer un badge »**.

La fenêtre « Attribuer un badge » demande :
- **Salarié** (liste déroulante) ;
- **Empreinte du badge (uid_hmac)** — un code de 64 caractères hexadécimaux, jamais l'identifiant du badge en clair ;
- **Commentaire** (facultatif).

**Point de vigilance — où trouver l'empreinte.** Le texte d'aide affiché sous ce champ indique : *« Présentez le badge sur un poste appairé et collez l'empreinte affichée dans l'onglet Supervision (mode enrôlement), ou saisissez l'empreinte fournie. »* **Ce mode d'affichage n'existe pas encore dans l'onglet Supervision au moment de la rédaction de ce manuel.** L'empreinte d'un badge neuf, jamais présenté sur un poste, n'est donc **pas récupérable directement depuis cet écran**. En pratique aujourd'hui :

1. Faites présenter le badge par le salarié sur un poste déjà appairé et en service (démonstration pratique du premier jour, cf. NOTE_RH §4.1 — c'est même le geste recommandé pour désamorcer les inquiétudes).
2. Le badge, non reconnu, part en pointage « orphelin » dans SOLIDATA (visible dans Journal → « Pointages orphelins »).
3. **Demandez au référent technique** de vous communiquer l'empreinte exacte de ce pointage (elle n'est pas encore affichée dans le tableau des orphelins visible à l'écran, mais elle existe dans les données) — collez-la dans le champ « Empreinte du badge » du formulaire d'attribution.
4. Une fois le badge attribué, ce même geste (présenter le badge) fonctionnera immédiatement sur tous les postes du site.

Signalez ce manque au référent technique : il devrait, à terme, être comblé par une évolution de l'écran Supervision plutôt que de rester une manipulation à deux mains (RH + technique) à chaque nouveau badge.

Cliquez sur **« Attribuer »** pour valider.

### 1.2 Déclarer un badge perdu ou volé (invalidation immédiate)

**Chemin :** Temps & Présence → **Badges**. Sur la ligne du salarié concerné (badge au statut « Actif »), les icônes d'action apparaissent à droite :

- **« Déclarer perdu »** (icône triangle d'alerte) ;
- **« Déclarer volé »** (icône interdiction) ;
- **« Restituer »** (icône flèche retour) ;
- **« Désactiver »** (icône interdiction).

Cliquez sur l'action voulue. Une boîte de confirmation **« Confirmer l'action »** s'affiche, avec le rappel : *« Il sera invalidé immédiatement. »* Confirmez.

**L'invalidation est immédiate et sans délai de grâce.** Dès la synchronisation suivante du poste (au maximum 5 minutes), le badge disparaît du cache actif de tous les postes du site : toute présentation ultérieure produit un pointage orphelin (traitement RH, §2.4), pas un pointage valide. Le badge n'a pas besoin d'être physiquement récupéré pour être neutralisé.

Une fois déclaré perdu ou volé, attribuez un nouveau badge au salarié en suivant §1.1 — un salarié ne reste jamais sans moyen de badger à cause d'un incident matériel qui n'est pas de son fait (NOTE_RH §4.2 : le remplacement est gratuit, sans limite).

### 1.3 Restituer un badge à la sortie

**Chemin :** Temps & Présence → **Badges** → sur la ligne du salarié, cliquer sur **« Restituer »** → confirmer dans la boîte **« Confirmer l'action »** (message : *« Enregistrer la restitution du badge de [nom] ? »*).

Le badge passe au statut **« Restitué »** et est retiré du cache des postes à la synchronisation suivante.

### 1.4 Remettre un relevé d'heures au salarié à la sortie

**Chemin recommandé aujourd'hui :** Temps & Présence → **Feuilles de temps** → sélectionner la période (ou les périodes) concernée(s) → cliquer sur le **nom du salarié** dans le tableau pour déplier le détail journalier (flèche à gauche du nom) → utiliser la fonction d'impression du navigateur (Ctrl+P) pour en remettre une copie papier.

**Point de vigilance.** SOLIDATA prépare, côté serveur, un « relevé individuel » spécifiquement conçu pour cette remise (il est d'ailleurs journalisé comme une consultation individuelle, au même titre que les autres accès RH). **Aucun bouton de cet écran ne le déclenche encore** au moment de la rédaction de ce manuel — l'usage réel passe donc par le détail des feuilles de temps décrit ci-dessus. Si cette remise devient fréquente, signalez au référent technique qu'un bouton dédié serait utile.

---

## 2. Corriger un pointage

### 2.1 Les trois types de correction

| Type | Quand l'utiliser |
|---|---|
| **Ajout d'un pointage manquant** | Un badgeage n'a pas eu lieu (badge oublié, mission extérieure...) et doit être créé |
| **Modification d'un pointage existant** | Un pointage existe mais son heure ou son sens est faux |
| **Annulation d'un pointage erroné** | Un pointage existe et ne doit pas être compté (ex. double badgeage accidentel non filtré) |

**Principe intangible : l'enregistrement brut n'est jamais modifié.** Une correction s'ajoute toujours à côté du pointage d'origine, jamais à sa place — c'est ce qui rend le dispositif opposable en cas de contestation. Le texte affiché dans la fenêtre de correction le rappelle : *« L'enregistrement brut n'est jamais modifié : la correction s'ajoute, avec motif obligatoire et auteur tracé. »*

### 2.2 Corriger depuis une ligne du journal (méthode recommandée)

**Chemin :** Temps & Présence → **Journal**. Sur chaque ligne d'un pointage rattaché à un salarié (colonne « Correction », à droite), deux liens :

- **« Corriger »** — ouvre la fenêtre « Nouvelle correction de pointage » pré-remplie en type « Modification d'un pointage existant », avec le salarié, le pointage d'origine, sa date et son heure déjà renseignés.
- **« Annuler »** — même fenêtre, pré-remplie en type « Annulation d'un pointage erroné ».

C'est la méthode à privilégier : elle renseigne automatiquement le numéro du pointage d'origine, obligatoire pour ces deux types et sinon fastidieux à retrouver.

### 2.3 Créer une correction depuis zéro (ajout d'un pointage manquant)

**Chemin :** Temps & Présence → **Journal** → bouton **« + Correction »** en haut à droite des filtres.

Dans la fenêtre **« Nouvelle correction de pointage »**, renseigner :
1. **Salarié** ;
2. **Type de correction** : choisir « Ajout d'un pointage manquant » ;
3. **Sens** : Entrée ou Sortie ;
4. **Date** et **Heure** (heure de Paris, celle affichée à l'écran) ;
5. **Motif** (liste fermée, voir §2.4) ;
6. Cliquer sur **« Enregistrer la correction »**.

### 2.4 Les motifs — liste fermée

Le champ « Motif » n'accepte que ces six valeurs :

| Motif affiché | Quand l'utiliser |
|---|---|
| Badge oublié | Le salarié n'avait pas son badge |
| Badge défaillant | Le badge ou le lecteur n'a pas fonctionné (y compris procédure papier de repli, `RUNBOOK.md` §6) |
| Mission extérieure | Le salarié était en collecte, livraison ou chantier hors site |
| Rendez-vous accompagnement | Absence pour un rendez-vous avec l'accompagnatrice socio-professionnelle |
| Formation | Absence pour une action de formation |
| Autre (à préciser) | Tout autre cas — **un champ de précision devient alors obligatoire** (200 caractères maximum) |

**Le champ de précision n'existe que pour le motif « Autre ».** Sur les cinq autres motifs, aucun texte libre n'est possible — c'est volontaire : le motif codé suffit, et un champ libre ouvert sur toute correction serait une porte vers une donnée sensible (santé, situation personnelle) qui n'a rien à faire dans un outil de décompte du temps.

### 2.5 Qui a le droit de corriger

Les corrections sont ouvertes aux **encadrants techniques, au RH et à l'ADMIN**. Deux verrous s'appliquent systématiquement, refusés par le système lui-même (pas une simple règle de bonne conduite) :

1. **Aucun encadrant ne corrige ses propres pointages.** Tentative refusée avec le message : *« Vous ne pouvez pas corriger vos propres pointages — la correction relève d'un tiers. »* Les corrections sur les pointages de l'encadrant relèvent du RH ; celles sur la Direction relèvent d'un tiers désigné.
2. **Aucune correction sur une période déjà validée par le RH.** Tentative refusée avec le message : *« La feuille de temps [période] est validée par le RH — aucune correction rétroactive (une contestation postérieure suit la procédure de réclamation). »* Une fois la feuille validée en fin de mois (§3.2), le chiffre fait foi ; toute contestation ultérieure suit une procédure distincte, hors de cet écran.

### 2.6 Délai de signalement — 5 jours ouvrés, avertissement non bloquant

La recommandation RH est de signaler une anomalie **dans les 5 jours ouvrés** suivant le fait. Ce délai est paramétré (« Délai de signalement d'une régularisation », onglet Paramètres, §5) et **ne bloque jamais l'enregistrement d'une correction** : au-delà du délai, la correction est tout de même enregistrée, mais un message d'avertissement apparaît à celui qui la saisit :

> *« Régularisation tardive : [N] jours ouvrés se sont écoulés depuis la date corrigée, au-delà du délai de signalement de [X] jours ouvrés. La correction est bien enregistrée. »*

C'est un signal de vigilance, pas un refus : aucune heure de travail n'est jamais perdue pour cause de délai dépassé.

### 2.7 Rattacher un pointage orphelin

Un badge non reconnu par un poste (badge jamais attribué, ou badge devenu inactif) produit un **pointage orphelin** : rien n'est rejeté en silence, il est conservé en attente de rattachement.

**Chemin :** Temps & Présence → **Journal** → encart **« Pointages orphelins »** en haut de l'écran (visible seulement s'il en existe). Sur la ligne concernée, cliquer sur **« Rattacher »**.

Dans la fenêtre **« Rattacher le pointage orphelin »** : choisir le **salarié** dans la liste, cliquer sur **« Rattacher »**.

**Réservé au RH et à l'ADMIN** — un encadrant technique voit l'encart mais n'a pas le bouton « Rattacher » (seuls RH/ADMIN décident du rattachement).

**Ce que le rattachement fait, et ne fait pas.** Il associe **ce pointage précis** au salarié choisi — le pointage change de statut et devient « Traité ». Il **ne crée pas** de badge : si le même badge physique est présenté à nouveau, il redeviendra orphelin tant qu'un badge (avec son empreinte) n'a pas été créé pour ce salarié via **« Attribuer un badge »** (§1.1). Pour un badge neuf, faites les deux : rattachez le premier pointage orphelin **et** attribuez le badge.

---

## 3. Feuilles de temps mensuelles

### 3.1 Circuit de validation

**Chemin :** Temps & Présence → **Feuilles de temps**. Sélectionner la période (sélecteur « Période », format mois/année) en haut de l'écran. Le tableau liste chaque salarié ayant des pointages sur la période, avec les colonnes **Théoriques**, **Pointées**, **Écart**, **Validées**, **Statut**, **Circuit de validation**.

**Deux étapes obligatoires, dans l'ordre :**

1. **Validation encadrant.** Tant que la feuille est au statut « Brouillon », le bouton **« Valider (encadrant) »** apparaît dans la colonne « Circuit de validation ». Un encadrant technique, le RH ou l'ADMIN peut cliquer dessus.
2. **Validation RH.** Une fois la feuille au statut « Validée (encadrant) », le bouton **« Valider (RH) »** apparaît — réservé au **RH et à l'ADMIN**.

### 3.2 Ce que la validation RH fige

**La validation RH est un point de non-retour pour la correction.** Une fois une feuille au statut **« Validée (RH) »** :
- le nombre d'heures affiché dans la colonne « Validées » **fait foi** — c'est celui-ci, et non un éventuel recalcul, qui part en export paie et en export IAE ;
- **aucune correction rétroactive** n'est plus possible sur cette période pour ce salarié (§2.5, verrou 2) ;
- seul un **ADMIN** peut annuler cette validation (« dévalidation »), en cas d'erreur avérée — **cette action n'a pas de bouton dans cet écran aujourd'hui** ; elle passe par une intervention du référent technique. Une dévalidation est systématiquement journalisée.

**« — » plutôt qu'un chiffre à zéro.** Quand la colonne « Théoriques » ou « Écart » affiche un tiret, ce n'est pas un oubli : cela signifie qu'aucune heure hebdomadaire contractuelle n'est connue pour ce salarié sur la période (contrat non renseigné ou absent des périodes couvertes). Ce n'est jamais remplacé par un zéro, qui laisserait croire à un écart réel.

### 3.3 Produire l'export paie

**Chemin :** Temps & Présence → **Feuilles de temps** → sélectionner la période → menu **« Format des heures (export paie) »** (Décimal, ex. 7,70, ou Heures:minutes, ex. 07:42) → bouton **« Export paie (CSV) »**.

**L'export ne sort que les feuilles validées par le RH.** S'il reste des feuilles non validées sur la période, l'export est **refusé** et un bandeau ambre apparaît avec la liste des salariés concernés, accompagné du bouton **« Exporter quand même les feuilles validées »** : cliquer dessus produit l'export en ne gardant que les feuilles déjà validées, en le disant explicitement dans le fichier téléchargé (suffixe « _partiel »).

### 3.4 Produire l'export heures IAE

**Chemin :** même écran, bouton **« Export heures IAE (CSV) »**, à côté du précédent. Même comportement en cas de feuilles non validées (bandeau + bouton « Exporter quand même... »). Cet export **ne retient que les salariés en parcours d'insertion** (statut « en parcours ») dont la feuille est validée par le RH — c'est le fichier destiné à la saisie ASP / extranet IAE.

---

## 4. Publier un contenu sur l'écran de veille

**Chemin :** Temps & Présence → onglet **Affichage**.

### 4.1 Règle absolue — à ne jamais enfreindre

Un bandeau d'avertissement est affiché en permanence sur cet écran : *« Aucune donnée personnelle dans ces contenus — l'écran de veille est une finalité de communication interne dissociée du pointage (photo, nom complet, statut de contrat ou de parcours interdits). »*

**Concrètement : jamais de message qui vise un salarié en particulier**, ni par son nom, ni par une allusion reconnaissable (« Bon rétablissement à... », « Bravo à... pour ses 6 mois... »). L'écran d'affichage sert la communication interne collective (consignes, planning, météo, événements) — jamais un message individuel. C'est aussi une garantie structurelle du système : un contenu de la playlist ne peut techniquement être adressé à personne.

### 4.2 Créer un contenu

Bouton **« Nouveau contenu »**. La fenêtre demande :

- **Type** : Message, Image, Planning, Compte à rebours, ou Météo ;
- **Ordre d'affichage** (un nombre — détermine la position dans la playlist) ;
- **Titre** (obligatoire) ;
- **Corps du message** (texte libre, zone à trois lignes) ;
- **Durée (s)** : entre 5 et 60 secondes d'affichage ;
- **Visible du** / **Visible au** : fenêtre de dates de diffusion (laisser vide pour un contenu permanent) ;
- **Contenu actif** (case à cocher) : décoche = le contenu reste enregistré mais ne diffuse pas.

- **Afficher uniquement les jours de Vente au Kilo** (case à cocher) : voir 4.3 ci-dessous.

**Point de vigilance — le type « Image ».** Ce type historique attend le nom d'un fichier **déjà déployé sur le poste** : il ne sert plus à grand-chose. Pour diffuser un visuel, utilisez les deux boutons dédiés, à côté de « Nouveau contenu » :

- **« Téléverser un média »** : une image ou une vidéo prise sur votre ordinateur. Elle est stockée dans SOLIDATA et recopiée sur le poste, qui la diffuse même sans réseau.
- **« Partager un lien »** : vous collez une adresse `https://…`, c'est le **serveur** qui télécharge le visuel (le poste, lui, ne va jamais sur Internet).

### 4.3 Un contenu réservé aux jours de Vente au Kilo

La fenêtre de création (et celle des deux boutons ci-dessus) propose la case **« Afficher uniquement les jours de Vente au Kilo »**. Cochée, l'affiche ne passe à l'écran que les jours où une vente est effectivement en cours.

**Vous n'avez aucune date à saisir, ni à tenir à jour :** les dates sont celles du module Vente au Kilo. Sous la case, l'écran vous dit ce qu'il en est aujourd'hui — « une vente est en cours », ou « prochaine : VAK octobre, du 9 au 10 octobre ». C'est ce qui vous permet de vérifier que votre affiche passera bien, sans attendre le jour J pour le découvrir.

Dans la liste des contenus, la colonne « Fenêtre » affiche alors le repère orange **« Jours de VAK »** au lieu d'une plage de dates.

Cliquer sur **« Enregistrer »**.

### 4.4 Prévisualiser

Le panneau de droite, **« Aperçu écran (16:9) »**, affiche le contenu sélectionné dans la liste (clic sur une ligne, ou icône œil **« Prévisualiser »**). Les images et les vidéos y apparaissent **telles qu'elles seront diffusées** : c'est le vrai fichier qui est affiché, pas une vignette symbolique. Pour les écrans calculés par le serveur (anniversaires, actualités, tournées, Vente au Kilo), l'aperçu montre un **exemple**, signalé comme tel — la vraie donnée du jour se voit dans l'onglet « Écran en direct ».

### 4.5 Modifier ou supprimer

Sur chaque ligne du tableau : icône crayon **« Modifier »** (ouvre la même fenêtre pré-remplie), icône corbeille **« Supprimer »** (demande confirmation dans la boîte **« Supprimer le contenu »** — action définitive).

Pour une image ou une vidéo, **le titre, la durée, l'ordre, la fenêtre de validité et la case « jours de VAK » se modifient** ; seul le fichier lui-même ne se remplace pas (téléversez alors un nouveau média). Le titre est celui qui s'affiche sous le visuel sur le poste : il vaut la peine d'être relu, il reprend par défaut le nom du fichier.

### 4.6 Voir ce que le poste affiche en ce moment — onglet « Écran en direct »

**Chemin :** Temps & Présence → onglet **Écran en direct**.

Cet onglet rejoue **la playlist réellement servie au poste** : les mêmes écrans, dans le même ordre, avec les mêmes durées, et avec les **vraies données du jour** (les anniversaires réellement annoncés, les tournées en cours, le poids vendu de la VAK…). C'est le moyen de vérifier depuis un bureau ce que voit l'atelier, sans se déplacer devant l'écran.

À côté du visuel, la **séquence diffusée** liste tous les écrans : cliquer sur l'un d'eux l'affiche et met la rotation en pause (boutons ‹ ⏸ › sous l'aperçu). L'en-tête indique le poste concerné, s'il donne signe de vie, et si une Vente au Kilo est en cours.

**Deux limites, dites franchement :**

- ce n'est **pas une caméra** braquée sur l'écran du poste. Après chaque badgeage, le poste affiche pendant quelques secondes le prénom et l'initiale d'un salarié : retransmettre cette image reviendrait à créer un second fichier de données personnelles. Ce message-là n'apparaît donc jamais ici ;
- la rotation affichée est celle de **votre navigateur**. Le poste ne dit pas à quelle seconde il en est : vous voyez les mêmes écrans, pas forcément au même instant.

Si le poste est resté muet plus longtemps que le seuil de supervision, un avertissement le signale : la playlist affichée est bien celle qui lui est destinée, mais rien ne garantit qu'il l'affiche (poste éteint, réseau coupé).

---

## 5. Paramètres — la grille de règles de gestion

**Chemin :** Temps & Présence → onglet **Paramètres**.

### 5.1 Le bandeau d'arbitrage

En haut de l'écran, un bandeau indique l'état de la grille :

- **Ambre, non arbitrée** (tant que personne n'a validé) : *« Règles par défaut (recommandations RH) — à faire arbitrer par la Direction avant la mise en production. Le pilote peut démarrer sur ces valeurs, mais l'état « non arbitré » reste visible tant que personne ne les a validées. »*
- **Vert, arbitrée** (après enregistrement) : *« Règles arbitrées par la Direction le [date] (utilisateur n°[X]). »*

**Ce bandeau ne bloque rien** : le pointage fonctionne dès l'installation, avec les valeurs par défaut. C'est un indicateur de traçabilité, pas un verrou technique — mais **c'est une décision de Direction qui reste due** (NOTE_RH §11, point 1 : « huit décisions à prendre »).

### 5.2 La grille (réservée ADMIN/RH pour l'écriture)

| Champ à l'écran | Valeur par défaut | Recommandation RH d'origine |
|---|---|---|
| Pointages par jour | 4 (avec pause méridienne) | Permet de justifier la pause, évite la déduction forfaitaire contestable |
| Arrondi des pointages — pas | 5 min | — |
| Arrondi des pointages — sens | À l'avantage du salarié | Entrée reculée au pas si arrivée en avance ; sortie comptée au réel |
| Tolérance de retard sans effet paie (min) | 5 | Sans effet paie, au-delà décompte réel |
| Badgeage avant l'heure planifiée | Non compté (recommandation) | Le temps d'attente avant la prise de poste n'est pas du travail effectif |
| Pause déduite automatiquement (min) | 45 | Si aucun pointage intermédiaire sur une journée dépassant le seuil |
| Seuil journée pour déduction de pause (h) | 6 | — |
| Durée maximale d'une journée avant alerte (h) | 10 | Déclenche une alerte automatique |
| Plage horaire d'acceptation des pointages | 05:00 – 21:00 | — |
| Durée de l'overlay de confirmation (s) | 5 (réglable de 3 à 8) | **Plafonné à 8 s côté serveur, non modifiable** — exigence juridique, pas un choix RH |
| Anti-rebond (s) | 8 | Un badge présenté deux fois en moins de 8 s ne compte qu'une fois |
| Délai de signalement d'une régularisation (jours ouvrés) | 5 | Au-delà, avertissement non bloquant (§2.6) |

Un second bloc, **« Postes et écran d'information (exploitation) »**, contient des réglages qui ne sont **pas** des règles RH à arbitrer (ce sont des réglages techniques) : le seuil de silence avant qu'un poste soit déclaré « hors ligne » (15 min par défaut), les destinataires de l'alerte e-mail correspondante, la taille maximale d'un média, et les **horaires d'activation de l'écran**.

**Horaires d'activation de l'écran.** Deux heures, en heure de Paris : l'écran s'allume à la première, s'éteint à la seconde. **Pendant cette plage, l'écran ne s'endort jamais tout seul** — l'économiseur et la mise en veille sont désactivés sur le poste, car un écran noir en pleine journée est indiscernable d'une panne pour l'atelier. Une plage à cheval sur minuit (équipes de nuit : 21:00 → 06:00) est acceptée. Le poste applique le changement à sa prochaine synchronisation puis à son passage de contrôle suivant : comptez une dizaine de minutes, jamais un redémarrage. Ces horaires ne comptent pas comme une règle de gestion RH : les modifier ne fait pas disparaître le bandeau « règles par défaut ».

Un dernier bloc, en case à cocher, contrôle l'**affichage du cumul hebdomadaire sur l'écran du poste**. La recommandation RH, rappelée juridiquement à l'écran, est de le laisser **désactivé** : *« Confidentialité au point de passage — la consultation du cumul se fait dans l'espace personnel SOLIDATA, pas sur un écran partagé. »*

### 5.3 Enregistrer

Bouton **« Enregistrer et marquer comme arbitrées »**, en bas de l'écran. **Réservé au RH et à l'ADMIN.** Chaque enregistrement, quel que soit le nombre de champs modifiés, marque **toute la grille** comme arbitrée à la date du jour — c'est un acte global, pas un arbitrage champ par champ.

### 5.4 Durées de conservation — affichées, non modifiables ici

Un dernier bloc, **« Durées de conservation »**, montre les délais de purge automatique (pointages, feuilles, badges après restitution, contenus expirés, journal d'accès). Ces valeurs sont des exigences de conformité RGPD, pas des règles de gestion : elles ne se modifient pas depuis cet écran. Le détail complet est dans `EXPLOITATION.md` §7.

---

## 6. Rappels de conformité — à garder en tête dans chaque procédure

Ces principes ne sont pas des options : ils sont soit imposés par le code (le système refuse ce qu'ils interdisent), soit des engagements pris par écrit dans la note juridique et la note RH.

- **Aucune sanction automatique.** Le pointage mesure une présence, jamais un rendement. Aucune mesure disciplinaire ne peut découler mécaniquement d'un retard ou d'une anomalie détectée : toute sanction suppose un entretien contradictoire et une appréciation individuelle, hors de cet outil.
- **Toute consultation individuelle est journalisée.** Ouvrir le journal filtré sur un salarié, la feuille de temps d'un salarié, ou produire un export, laisse une trace datée et nominative dans le registre RGPD de SOLIDATA — y compris pour un usage parfaitement légitime. Ce n'est pas une contrainte à contourner, c'est la garantie qui permet de répondre à un salarié qui demande « qui a regardé mes heures ? » (droit rappelé au §10 de la note d'information aux salariés).
- **Pas de temps réel « par curiosité ».** Le dispositif ne doit jamais servir à savoir qui est présent en atelier à un instant donné, en dehors du besoin de sécurité incendie.
- **Réponses aux questions des salariés.** Toute question d'un salarié sur le dispositif (pourquoi, comment, quels droits) trouve sa réponse dans `NOTE_INFORMATION_SALARIES.md`, écrite pour être lue directement par les personnes concernées. En cas de doute sur une réponse à donner, s'appuyer sur ce document plutôt que d'improviser — il a été rédigé et validé pour ce public.
- **La consultation du CSE est un préalable obligatoire, non négociable.** Aucune mise en service réelle (au-delà d'une démonstration ou d'un pilote sans effet sur la paie) ne doit intervenir avant le procès-verbal de consultation du CSE (NOTE_RH §8, note juridique §2.4). Vérifier ce point avant toute bascule en production.
- **Le pilote à blanc protège les salariés, pas seulement le projet.** Pendant les huit premières semaines annoncées (quatre de pilote + quatre de production accompagnée, NOTE_RH §11 point 2), aucune sanction ne doit découler d'un oubli ou d'une erreur de pointage. C'est un engagement écrit, à tenir dans les faits.

---

## 7. Annexe — fiche mémo à afficher près du poste

Une fiche mémo en pictogrammes, sans texte long, est prévue en annexe de `NOTE_INFORMATION_SALARIES.md` (section « ANNEXE — Fiche mémo à afficher près du poste »). Elle couvre en cinq blocs : « J'arrive », « Je pars », « Ça ne marche pas ? », « J'ai oublié mon badge », « Interdit » (un badge = une personne), et un bloc de contact à compléter.

**À faire avant la mise en service :**
1. Ouvrir `docs/badgeuse/NOTE_INFORMATION_SALARIES.md`, aller à l'annexe finale.
2. Compléter les champs de contact laissés en blanc (« Mon encadrant : ______ », « Le bureau : ______ »).
3. Faire réaliser la mise en page par un graphiste selon les indications de la note (police sans empattement, corps minimum 24 pt pour le texte courant et 48 pt pour les titres, un seul message par bloc, fond blanc, pictogrammes de grande taille) — **format A3, à imprimer en couleurs et plastifier**.
4. L'afficher directement à côté du poste de pointage, à hauteur de lecture.

Cette fiche doit rester compréhensible **sans lire un seul mot** — c'est une exigence du document source, pas une option de mise en page.
