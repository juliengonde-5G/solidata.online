# Pièces hors logiciel — ce que SOLIDATA ne produit pas

**Module Insertion — version 2.55.0, 14 septembre 2026.**

> **Pourquoi ce document existe.** L'autorité de tutelle l'a dit sans détour (`06-persona-autorite.md`
> § 7.2, `09-matrice-reporting-autorite.md` § 4.3, condition 5) : « ce sont les seules lignes de ce
> dossier sur lesquelles je n'ai aucune marge d'appréciation, et leur absence me ferait écrire une
> non-conformité quelle que soit la qualité de l'outil ». Ces pièces ne sont **pas des écrans** — aucun
> développement ne peut les produire à la place d'une décision humaine. Ce document liste **qui** les
> écrit, **quand**, propose un **gabarit court** pour chacune, et dit ce que SOLIDATA peut fournir en
> **pièce jointe** pour l'étayer. Aucune de ces six pièces n'est faite au 14 septembre 2026 : c'est
> précisément pour cela qu'elles sont listées ici plutôt que présentées comme réglées.

---

## 1. L'analyse d'impact relative à la protection des données (AIPD)

**Qui** : le délégué à la protection des données (DPO), avec la direction.
**Quand** : avant la mise en production de chaque traitement à risque — **avant**, pas après. Trois
traitements l'exigent et ne sont couverts par **aucune** AIPD validée à ce jour :

1. L'accompagnement socio-professionnel lui-même (données de santé, art. 9 ; données relatives à des
   infractions, art. 10 ; personnes en situation de vulnérabilité).
2. La **note de profil initial** générée par intelligence artificielle à l'arrivée d'un salarié
   (croise CV, entretien de recrutement, mises en situation et profil PCM).
3. La **transmission de la fiche pour le référent unique externe** et les **rappels de rendez-vous**
   par SMS/e-mail (deux traitements ajoutés par les PR B et C, chacun avec sa propre base légale — voir
   § 4).

**Gabarit court** (à adapter, section par traitement) :

```
ANALYSE D'IMPACT RELATIVE À LA PROTECTION DES DONNÉES
Traitement : [nom]
Responsable de traitement : Solidarité Textiles
Finalité : [en une phrase]
Base légale : [mission d'intérêt public / obligation légale / consentement — préciser laquelle et pourquoi]
Catégories de données : [dont art. 9 / art. 10 le cas échéant]
Personnes concernées : [salariés en insertion / bénéficiaires du RSA / candidats]
Nécessité et proportionnalité : [pourquoi ce traitement, pourquoi ces données, pas d'autres]
Risques identifiés pour les personnes : [liste]
Mesures pour réduire ces risques : [chiffrement, masquage par rôle, pseudonymisation avant IA,
  durées de conservation, journalisation — voir § 6 « Preuve à joindre »]
Avis du DPO : [favorable / favorable sous réserve / défavorable, motivé]
Date et signature du DPO :
```

**Preuve à joindre depuis SOLIDATA** : la description technique des mesures de sécurité se lit dans
`GET /rgpd/politique` (module RGPD, onglet « Règles de gestion des données ») — chiffrement, masquage,
durées, valeurs réellement paramétrées, pas une intention écrite à part.

---

## 2. La consultation du comité social et économique (CSE)

**Qui** : la direction, avec le CSE.
**Quand** : avant la mise en service d'un dispositif de contrôle de l'activité des salariés — ce que
SOLIDATA est, pour le volet Insertion comme pour la badgeuse (module 33, déjà consultée séparément).

**Gabarit court** (procès-verbal, extrait) :

```
PROCÈS-VERBAL DE CONSULTATION DU CSE
Séance du [date]
Point à l'ordre du jour : information-consultation sur le module Insertion de l'ERP SOLIDATA
Présentation faite par : [nom, qualité]
Éléments présentés : finalités du traitement, données traitées (dont santé et judiciaire, en
  quels termes exacts), personnes ayant accès, durées de conservation, droits des salariés
Questions et observations des membres : [texte]
Avis du CSE : [favorable / réservé / défavorable] — [nombre de voix]
Date, signature du secrétaire de séance :
```

**Preuve à joindre depuis SOLIDATA** : aucune — c'est un acte social, pas une donnée du système. Le PV
lui-même, une fois signé, peut être déposé comme pièce du dossier de conformité (§ 6.1 de
`rapports/decheterie-2026-09-06/` documente un dépôt de pièce analogue pour un autre module ; pour
l'Insertion, aucun mécanisme de dépôt de PV n'existe — c'est un classeur, pas un écran).

---

## 3. La note d'information remise aux salariés, avec sa trace de remise

**Qui** : la direction ou la CIP, à chaque salarié entrant en parcours d'insertion — et, en version
mise à jour, à chaque salarié déjà en parcours au moment où un nouveau traitement entre en service
(rappels de rendez-vous, transmission au référent).
**Quand** : à l'entrée dans le dispositif, et à chaque évolution substantielle des finalités ou des
destinataires.

**Gabarit court** (en français simple, à distribuer et à faire signer) :

```
CE QUE SOLIDARITÉ TEXTILES FAIT DE VOS INFORMATIONS

Pendant votre parcours, nous notons ce qui vous concerne pour vous accompagner : votre situation,
vos entretiens, les actions que nous menons ensemble. Certaines informations sont sensibles (santé,
suivi judiciaire) : nous n'écrivons que ce qui est utile à votre accompagnement, jamais le détail.

Qui voit votre dossier : votre conseillère en insertion, la direction. Votre encadrant technique ne
voit ni votre santé, ni un éventuel suivi judiciaire, ni votre budget.

Si vous êtes bénéficiaire du RSA : nous transmettons certaines informations à votre référent
(le centre médico-social ou France Travail) pour qu'il assure le suivi de votre contrat
d'engagements. Nous vous en remettons toujours un exemplaire.

Combien de temps nous gardons vos informations : deux ans après la fin de nos échanges, puis elles
sont effacées (sauf ce qui concerne un financement européen, gardé plus longtemps pour la preuve).

Vos droits : accès à votre dossier, correction d'une erreur, opposition à être recontacté après
votre sortie. Contact : dpo@solidarite-textiles.fr

Si vous consentez à recevoir un rappel de rendez-vous par SMS ou e-mail, nous vous le demandons
séparément — ce n'est jamais automatique.

Date : ____________  Signature (reçu et compris) : ____________
```

**Preuve à joindre depuis SOLIDATA** : rien pour la version papier elle-même — mais chaque PDF produit
par le module (fiche de parcours, diagnostic, bilan) porte déjà en pied de page la **mention
d'information RGPD** datée, ce qui prouve que la version diffusée à un instant donné est bien celle qui
a circulé.

---

## 4. La base légale de la transmission au référent externe

**Qui** : le délégué à la protection des données, saisi par la direction.
**Quand** : avant que le traitement « fiche pour le référent » entre définitivement au registre — il
y figure aujourd'hui avec la mention explicite « mission d'intérêt public — **à confirmer par le
DPO** » (voir `GET /rgpd/registre`), et la structure continue de produire la fiche dans l'intervalle
parce que le référent en a l'usage, pas parce que le point est réglé.

**Ce qu'il faut trancher** : la transmission d'informations nominatives à un professionnel extérieur
(CMS ou France Travail) repose-t-elle sur la **mission d'intérêt public** du dispositif d'insertion
(art. 6-1-e RGPD, pas de consentement à recueillir, mais un droit d'opposition à motif légitime), ou
sur l'**accord de la personne** (art. 6-1-a, alors révocable à tout moment, avec la question de ce qui
se passe si elle refuse) ? Le choix change la conduite à tenir en cas de refus.

**Gabarit court** (fiche de décision DPO) :

```
DÉCISION DU DÉLÉGUÉ À LA PROTECTION DES DONNÉES
Traitement : Transmission d'informations au référent unique externe (fiche pour le référent)
Base légale retenue : [mission d'intérêt public / consentement — motiver]
Conséquence si la personne s'y oppose : [conduite à tenir]
Mention à ajouter à la note d'information des salariés : [oui/non, laquelle]
Entrée au registre mise à jour le : ____________
```

**Preuve à joindre depuis SOLIDATA** : la fiche pour le référent porte déjà, en pied de page, la
mention des droits de la personne (§ 5.6 du `09-matrice-reporting-autorite.md` le demande) ; la trace
de chaque génération et de chaque remise est journalisée (`INSERTION_FICHE_REFERENT_GENERATION`,
`_REMISE`, consultables dans le journal d'audit RGPD — module RGPD, onglet « Journal d'audit »).

---

## 5. La convention et l'annexe financière (cibles chiffrées)

**Qui** : l'autorité de tutelle (DDETS/CD76) transmet, la direction saisit.
**Quand** : au renouvellement annuel de la convention.

**Ce qui manque** : les **cibles conventionnelles** (ETP conventionnés, taux de sorties attendus par
catégorie, heures annuelles par ETP) ne sont **saisies nulle part par défaut** — l'outil affiche
« objectif non paramétré » plutôt qu'un chiffre inventé (doctrine du projet). Tant que l'annexe
financière n'est pas transmise puis saisie, les taux de la synthèse de dialogue de gestion s'affichent
sans comparaison à une cible.

**Où les saisir une fois reçues** : `Réglages insertion` (`/admin/insertion`, ADMIN) pour les cibles de
sorties ; `settings` clé `effectifs.convention_<année>` (module Effectifs ETP, `/rh/effectifs` onglet
Paramètres) pour l'ETP conventionné et les heures annuelles par ETP.

**Preuve à joindre depuis SOLIDATA** : aucune tant que la valeur n'est pas connue — c'est le point.
Une fois saisie, l'écran « Pilotage & indicateurs » (`/insertion/audit`) l'affiche en clair, avec
l'écart au réel.

---

## 6. La maquette du questionnaire participant *Ma Démarche FSE+*

**Qui** : l'autorité de gestion du FSE+ transmet, la CIP vérifie la correspondance.
**Quand** : dès réception — le retard ne bloque rien aujourd'hui (le questionnaire d'entrée de
SOLIDATA est construit de façon à accueillir la liste officielle sans reprise technique), mais chaque
mois sans elle est un mois où l'on ne peut pas garantir que les libellés utilisés dans l'outil
correspondent mot pour mot à ceux de la plateforme.

**Ce que la structure fera à réception** : faire correspondre chaque item du questionnaire d'entrée
saisi dans le diagnostic (`insertion.diagnostic-socle-champs.json`) aux items officiels, un par un, et
signaler tout écart au lieu de le corriger en silence.

**Preuve à joindre depuis SOLIDATA** : le contenu exact des questionnaires actuellement saisis reste
consultable dans l'export FSE+ participants (a) et dans le dossier de conformité par participant
(`/insertion/conformite`) — utile pour vérifier une fois la maquette reçue.

---

## Ce que SOLIDATA fournit pour étayer les six pièces ci-dessus

Aucune des six ne se produit depuis un écran. Ce que le logiciel apporte, c'est la **preuve que le
dispositif technique correspond à ce que ces pièces annoncent** :

| Ce qui est écrit | Où le vérifier dans SOLIDATA |
|---|---|
| Le registre des traitements (art. 30), avec la base légale de chacun | `GET /rgpd/registre` — module RGPD, onglet correspondant, ADMIN/DPO |
| Les règles de gestion réellement codées (chiffrement, masquage, durées) | `GET /rgpd/politique` — module RGPD, onglet « Règles de gestion des données » |
| L'état et l'historique des purges de rétention | `GET /rgpd/purges` — module RGPD, onglet « Automatisations & purges » |
| Qui a consulté ou généré quoi, et quand — jamais le contenu | Module RGPD, onglet « Journal d'audit » |

Ces quatre écrans sont ce que la structure montrera en séance à l'appui des six pièces listées
ci-dessus, une fois qu'elles existeront. Ils ne les remplacent pas.

---

*Document établi le 14 septembre 2026, lot 8 de la PR D « Reporting autorité et présentation »
(`rapports/cip-refonte-2026-09-12/25-contrats-techniques-PR-D.md`), à partir des exigences du § 4.3 de
`09-matrice-reporting-autorite.md` et des points laissés ouverts au § 12 de
`PRESENTATION_AUTORITE_INSERTION.md`. Aucune des six pièces n'est produite à cette date : c'est l'objet
même de ce document que de le dire.*
