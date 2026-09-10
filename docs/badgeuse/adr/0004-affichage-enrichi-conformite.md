# ADR 0004 — Écran d'information v2 : arbitrages de conformité

**Statut :** Accepté — Août 2026. **Contexte :** demande Direction (CDC_AFFICHAGE_V2.md)
d'enrichir l'écran de la badgeuse. Trois éléments demandés contredisent frontalement des
exigences marquées **Obligatoires** de la NOTE_JURIDIQUE (§3.4/§3.5), contrôlées par la
barrière A5 et inscrites dans la note d'information remise aux salariés. Ils sont livrés
en **variante conforme** ; la voie pour revenir à la demande initiale est décrite — elle
passe par un arbitrage écrit, pas par le code.

## 1. « Nom - Prénom » à l'écran → **prénom + initiale, inchangé**

NOTE_JURIDIQUE §3.5 : « Affichage limité au prénom + initiale du nom — **Obligatoire** »
(l'écran est en zone de passage accessible à des tiers ; chaque affichage est une
divulgation). La note d'information salariés (§5) le promet noir sur blanc. Les messages
personnalisés (« Bonjour, {prenom} ! ») portent l'intention chaleureuse sans l'écart.
**Pour changer** : avis écrit DPO/avocat + mise à jour de la note d'information remise
contre émargement + information CSE. Aucune option de code n'est livrée en attendant.

## 2. Phrase liée au profil PCM → **vivier générique paramétrable**

Le PCM est un profil psychologique (chiffré AES-256 dans l'ERP, finalités
recrutement/accompagnement). Afficher publiquement une phrase dérivée du profil :
(a) **détournement de finalité** (NOTE_JURIDIQUE §3.2 — sanctionnable, prive les données
de valeur probatoire), (b) divulgation d'une inférence psychologique à des tiers,
(c) transit de données de profil vers le poste, interdit par conception. Livré :
vivier de phrases génériques, éditable, rotation quotidienne — aucun lien individuel.
**Pour changer** : ce serait une AIPD complète + base légale propre ; déconseillé.

## 3. RDV CIP / visite médicale à l'écran → **refusé, alternative SMS**

Un rappel « RDV CIP » identifie publiquement un salarié en parcours d'insertion
(NOTE_JURIDIQUE §3.5 « aucune mention du statut — Obligatoire » ; §7 « l'écran ne doit
jamais permettre de distinguer un salarié en parcours d'un permanent »). Une visite
médicale est une donnée de santé par implication (§3.4 : « ne doit pas transiter par le
poste »). Même réduit à un booléen neutre, le flux prend sa source dans les modules
CIP/médical. Alternative en piste (non livrée dans ce lot) : **rappel SMS personnel**
via Brevo (module Notifications existant) — canal individuel, pas d'écran collectif.

## 4. Anniversaires (naissance + entreprise) → **opt-in individuel tracé**

Ni photo, ni nom complet, ni statut : l'affichage festif (« prénom + initiale ») ne
figure pas dans les interdits de la note, mais c'est une divulgation non nécessaire au
traitement → **consentement libre** requis (refuser n'a aucune conséquence : le
consentement est ici valable malgré la subordination). Implémentation :
`employees.badgeuse_optin_festif` (défaut **false**), recueil tracé (`rgpd_audit_log`,
date + auteur), révocable en un clic, case gérée dans l'onglet Badges. Seuls des
**booléens** transitent vers le poste (jamais la date de naissance).

## 5. Tournées sur l'écran de veille → **sans nom de chauffeur**

La position temps réel des véhicules est visible des MANAGER dans l'ERP ; l'écran
d'atelier est une audience nouvelle. Affiché : libellé de tournée, code véhicule,
progression CAV — **jamais le nom du chauffeur** (géolocalisation indirecte d'une
personne sinon). Pas de carte sur le kiosque (frugalité + pas de tuiles externes).

## 6. Réseaux sociaux → **API officielle ou saisie manuelle, jamais de scraping**

Contenus récupérés CÔTÉ SERVEUR via l'API Meta Graph (jeton configuré, chiffré) pour
les comptes DE la structure ; images téléchargées puis servies au poste par l'API
device (la CSP du kiosque reste `'self'`, le poste ne contacte jamais un domaine
externe). Sans jeton : partage manuel (type `lien`/`media`). **Stories vidéo : V2**
(exigences API Meta spécifiques + volumétrie vidéo sur le poste) — dit honnêtement
plutôt que promis.

## Conséquences

- Le contrat d'API device passe en **v1.3** (drapeaux festifs booléens dans le cache
  badges, gabarits/plages dans la config, types de playlist enrichis, endpoint média).
- La barrière A5 (conformité) est **re-passée en delta** sur les nouveaux flux avant
  fusion — c'est la contrepartie de l'extension d'une surface déjà validée.

---

## Addendum du 19/08/2026 — carte des tournées : la position revient, **approchée**

Le §5 ci-dessus écartait toute carte sur le kiosque. La Direction demande désormais
un écran « position de la tournée » montrant les véhicules sur une carte. Cet
addendum **révise** le §5 — il ne l'annule pas : les deux motifs d'origine tiennent
toujours, et ce sont eux qui dictent la forme retenue.

**Ce qui est décidé** : position **approchée** — le véhicule apparaît sur la
**commune ou le secteur en cours**, jamais au point GPS exact. La tournée se voit
progresser sur le territoire ; les déplacements d'un salarié ne sont pas restituables
mètre par mètre devant l'atelier et ses visiteurs.

**Pourquoi pas le point exact** : un véhicule = un chauffeur à un instant donné. Le
point GPS temps réel sur un écran commun expose les déplacements d'une personne
identifiable à une audience nouvelle — c'est le motif qui avait fait refuser le nom
du chauffeur au §5, et il s'applique identiquement à la position fine. Le point exact
reste disponible aux MANAGER dans l'ERP, dont c'est la finalité déclarée.

**Pourquoi pas de tuiles externes** : la CSP du kiosque reste `'self'`. Le fond de
carte est **dessiné localement** à partir du référentiel des communes déjà en base —
aucun appel réseau au moment de l'affichage, y compris hors ligne. La frugalité
invoquée au §5 est donc préservée : pas de téléchargement de tuiles, pas de
dépendance à un fournisseur cartographique.

**Ce qui est affiché** : contour du territoire de collecte, véhicules par **code**
(jamais un nom), commune ou secteur en cours, progression CAV. Inchangé du §5 :
**jamais le nom du chauffeur**.

**Reste à la charge de la Direction, avant mise en service de cet écran** :
information du CSE — un écran d'atelier qui montre l'avancement des tournées est une
information sur l'activité de salariés identifiables par leur véhicule, même sans
position fine. À joindre au dossier de consultation déjà prévu (NOTE_JURIDIQUE §9).

**Réalisation (21/08/2026)** : type de playlist `tournees_carte`, livré **à côté** de
`tournees` (la liste des progressions reste). Position = commune du **dernier point de
collecte relevé** — `gps_positions` n'est pas lue, aucune coordonnée ne descend vers le
poste, un véhicule ne porte qu'une **référence de secteur**. Fond dessiné à partir des
barycentres de nos propres points de collecte. Contrat d'API device **v1.6**
(§3quinquies) ; détail et preuves d'exécution au JOURNAL.

---

## Addendum du 10/09/2026 — anniversaires : l'affichage devient le défaut, l'**opposition** la barrière

**Demande de la Direction** : « par défaut afficher tous les anniversaires à l'écran, mais
[pas] ceux sans badge affecté ».

### Ce que cela change au §4

Le §4 fondait l'affichage festif sur un **consentement préalable** : rien ne s'affichait
sans un accord recueilli, salarié par salarié. En pratique, la case n'a presque jamais été
cochée — non par refus, mais parce que personne n'a été interrogé —, si bien que l'écran
festif ne fêtait personne. La Direction tranche pour l'inverse : **tout le monde est
affiché, sauf opposition.**

La base légale bascule alors du consentement (art. 6-1-a) vers l'**intérêt légitime**
(art. 6-1-f) : une convivialité d'atelier, avec une donnée déjà minimale (prénom +
initiale, jamais la date de naissance, jamais l'âge). Ce n'est pas une décision technique
et elle n'est **pas gratuite** : elle déplace la garantie du consentement vers le **droit
d'opposition** (art. 21), qui doit alors être réel.

### Les trois contreparties, tenues dans le code

1. **Une opposition explicite, distincte de l'absence de réponse.**
   Nouvelles colonnes `employees.badgeuse_refus_festif` (+ `_le`, `_par`), à côté de
   `badgeuse_optin_festif` qui est conservée. Relire l'ancienne colonne « à l'envers »
   aurait été un contresens : un `false` existant veut dire « personne n'a posé la
   question », jamais « cette personne a refusé ». **L'opposition l'emporte toujours**, y
   compris sur un accord recueilli plus tôt.
2. **Le badge actif est une condition d'affichage.**
   L'écran est celui de l'atelier. Le fichier du personnel contient des personnes qui n'y
   viennent jamais — autres sites, permanents du siège, fiches conservées après un départ.
   L'absence de badge est le seul signe fiable, et déjà tenu à jour, qu'une personne badge
   ici. C'est la partie « mais ceux sans badge » de la demande.
3. **La décision reste reprenable, et se voit.**
   Réglage `badgeuse.festif_accord_prealable` (défaut `false`). À `true`, on revient
   exactement à la règle du §4. Il est exposé dans l'écran « Messages de badgeage » avec
   sa contrepartie écrite noir sur blanc, plutôt qu'enfoui dans une condition SQL.

**Une seule règle en code** (`badgeuse-device.festifAutorise`), appelée par le cache des
badges **et** par l'écran « annonces » de la playlist, et réutilisée par le back-office
pour annoncer l'état effectif. Deux conditions recopiées finiraient par diverger : le jour
où elles divergeraient, une personne verrait son anniversaire sur un écran et pas sur
l'autre — c'est-à-dire la promesse qu'on lui a faite qui serait rompue.

### Reste à la charge de la Direction, avant la mise en service

- **Informer les salariés** (art. 12-14) que les anniversaires sont affichés par défaut,
  et **comment s'y opposer**. Sans cette information, l'intérêt légitime ne tient pas.
  À joindre à la note d'information déjà prévue (NOTE_JURIDIQUE §9).
- **Recueillir une opposition sans discussion** quand elle est exprimée : c'est la
  contrepartie qui rend le choix du défaut acceptable.

Les trois gestes (accord, opposition, retour à « sans réponse ») sont journalisés au
registre RGPD, datés et attribués — une opposition qui ne se prouve pas ne vaut rien.
