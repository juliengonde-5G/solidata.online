# FORMATION — MODE DÉMO CHAUFFEUR

## Guide du formateur — Application SOLIDATA Mobile

**Solidarité Textiles — Août 2026**

---

```
+--------------------------------------------------+
|                                                    |
|   CE GUIDE EST POUR VOUS, LE FORMATEUR            |
|                                                    |
|   Il explique comment récupérer le lien de la     |
|   démo, le poser sur le téléphone d'un stagiaire  |
|   et faire pratiquer les 6 gestes essentiels du   |
|   métier de chauffeur-collecteur — sans jamais    |
|   toucher aux données réelles de l'entreprise.    |
|                                                    |
+--------------------------------------------------+
```

Le support destiné au stagiaire lui-même reste `docs/FORMATION_CHAUFFEURS.md` (langage simplifié, à lui remettre ou à garder dans le camion). Ce document-ci vous est adressé, à vous qui animez la session.

---
---

# 1. À QUOI SERT LE MODE DÉMO

## Le principe

Un véhicule est réservé exclusivement à la formation : **« DÉMO FORMATION »**. Il possède, comme tous les véhicules de la flotte, son propre lien d'accès mobile (`https://m.solidata.online/v/...`), mais avec une différence essentielle :

```
+--------------------------------------------------+
|                                                    |
|   TOUT CE QUI EST FAIT DEPUIS CE LIEN N'A         |
|   AUCUN EFFET SUR LES DONNÉES RÉELLES DE          |
|   L'ENTREPRISE.                                   |
|                                                    |
+--------------------------------------------------+
```

Concrètement, un stagiaire peut se tromper, recommencer, tout casser sans risque :

- Le tonnage « collecté » pendant la démo n'est **jamais** compté dans les statistiques de collecte, la facturation, le CO2 évité ou le suivi Refashion.
- Les incidents et anomalies déclarés pendant la démo ne remontent **pas** dans le registre réel d'incidents consulté par les managers.
- Le véhicule « DÉMO FORMATION » n'est pas un vrai camion de la tournée du jour — il n'entre dans aucun planning réel.

**La formation se fait en salle, pas devant les conteneurs.** Sur une vraie tournée, l'application refuse de valider un point si le téléphone n'est pas à moins de 50 mètres du conteneur — c'est une sécurité contre les validations à distance. En mode démo, ce contrôle est **levé** : le stagiaire peut identifier et « collecter » n'importe quel point du scénario depuis la salle de formation. La règle reste entière sur les vraies tournées.

C'est le serveur qui garantit cette neutralisation : vous n'avez rien à vérifier ni à « annuler » après coup. Une fois la session terminée, il suffit de réinitialiser la démo (§4) pour que le stagiaire suivant reparte d'un état propre.

## Ce que la démo permet de pratiquer

L'application mobile chauffeur est un parcours linéaire : véhicule → checklist → carte → collecte de chaque point → retour au centre → pesée → clôture. La démo suit exactement ce même parcours, avec les mêmes écrans que sur le terrain — c'est bien l'application réelle qui s'ouvre, seulement raccordée à un véhicule et une tournée de démonstration.

---
---

# 2. RÉCUPÉRER LE LIEN ET LE PRÉPARER SUR LE TÉLÉPHONE

## Étape 1 — Se connecter sur l'ordinateur

Sur `solidata.online`, connectez-vous avec un compte **Administrateur** ou **Manager**.

## Étape 2 — Ouvrir le panneau « Démo formation »

```
Menu de gauche → Véhicules
                    │
                    ▼
     Onglet  "Démo formation"
```

Vous y trouvez :

- le **lien à copier** (bouton « Copier » à côté du lien) ;
- le véhicule de démo concerné ;
- l'**état de la tournée de démo** : date, statut, nombre de points, nombre déjà collectés ;
- la date de la **dernière réinitialisation** ;
- le bouton **« Réinitialiser la démo »**.

Si le panneau affiche « Démo formation non installée », la démo n'a pas encore été mise en place sur ce serveur : il faut qu'un administrateur lance d'abord le script d'installation côté serveur (véhicule et tournée dédiés). Cela ne se fait qu'une seule fois — pas avant chaque session.

## Étape 3 — Poser le lien sur le téléphone du stagiaire

1. Copiez le lien (bouton « Copier »).
2. Ouvrez le navigateur du téléphone du stagiaire et collez le lien dans la barre d'adresse.
3. Si vous comptez refaire plusieurs sessions sur le même téléphone, ajoutez un raccourci à l'écran d'accueil :
   - **Android (Chrome)** : menu ⋮ → *Ajouter à l'écran d'accueil*.
   - **iPhone (Safari)** : bouton Partager → *Sur l'écran d'accueil*.
4. Le lien ouvre directement l'application chauffeur, sans nom d'utilisateur ni mot de passe à saisir — exactement comme sur un vrai véhicule.

```
+--------------------------------------------------+
|  IMPORTANT                                        |
|                                                    |
|  Un seul stagiaire à la fois sur le lien.         |
|                                                    |
|  Le lien identifie UN véhicule, donc UNE          |
|  session partagée. Si deux téléphones ouvrent     |
|  le même lien en même temps, ils se marchent      |
|  dessus (même tournée, mêmes points).             |
|                                                    |
|  → Faites pratiquer les stagiaires les uns        |
|    après les autres, et réinitialisez entre       |
|    chaque passage (§4).                           |
+--------------------------------------------------+
```

---
---

# 3. LES 6 CAS PRATIQUES À FAIRE DÉROULER

Idée générale de l'exercice : vous jouez le rôle du « responsable qui briefe », le stagiaire tient le téléphone et suit les écrans comme s'il partait vraiment en tournée. Laissez-le lire et toucher lui-même — l'application est conçue pour être comprise sans notice (gros boutons, texte court, vibrations de confirmation).

## (a) Départ avec la checklist du camion

**Vous annoncez :**
« Avant de partir, tu dois toujours vérifier ton camion. On va faire ça ensemble sur l'écran. »

**Le stagiaire fait :**
1. Il ouvre le lien (ou reprend le raccourci déjà posé).
2. Il retrouve l'écran de départ, avec le véhicule « DÉMO FORMATION » déjà présélectionné, et confirme le départ.
3. La checklist de contrôle s'affiche (une dizaine de points : papiers du véhicule, permis, équipements de sécurité, feux, pneus, niveaux, propreté du véhicule...). Il coche chaque ligne une par une.
4. Il renseigne le kilométrage de départ (un nombre au choix, ex. 45000 — c'est un véhicule fictif, aucune vraie valeur n'est requise).
5. Il valide pour démarrer la tournée.

**Ce qu'il doit observer à l'écran :**
- Le bouton de démarrage reste grisé/désactivé tant que toutes les cases ne sont pas cochées — c'est volontaire, montrez-le en laissant sciemment une case non cochée.
- Une fois la checklist validée, l'écran bascule automatiquement sur la carte de la tournée.

**Point pédagogique à souligner :** si un point de la checklist n'est pas bon dans la vraie vie (ex. un pneu abîmé), on ne coche PAS la case — on prévient le responsable et on attend les instructions avant de partir. La démo ne simule pas ce cas particulier, mais c'est le bon moment pour le rappeler oralement.

---

## (b) Collecte normale d'un point (remplissage + photo)

**Vous annoncez :**
« Tu arrives devant un conteneur. Voici comment le déclarer collecté. »

**Le stagiaire fait :**
1. Sur la carte, il repère le prochain point à collecter (marqueur mis en avant) et touche « Scanner ».
2. Le scanner de QR code s'ouvre (caméra). Comme il n'y a pas de vrai QR code de démo à disposition, utilisez le bouton de repli (« QR indisponible » / sélection manuelle du point dans la liste) pour continuer — c'est aussi l'occasion de montrer ce chemin de secours, utile le jour où un vrai QR code est abîmé ou sale sur le terrain.
3. L'écran de remplissage s'affiche : 5 niveaux à choisir (Vide / 1⁄4 / 1⁄2 / 3⁄4 / Plein).
4. Une **photo du conteneur** est demandée. C'est une fonctionnalité récente : à chaque passage, l'application vérifie si une photo récente existe déjà pour ce point.
   - Si la photo manque ou date de plus de quelques mois, le message affiché à l'écran le dit clairement (« pas de photo » / « photo trop ancienne ») et **il faut en reprendre une** avant de pouvoir valider — mais seulement quand le téléphone est connecté à internet.
   - Hors connexion, l'application ne bloque jamais : elle redemandera la photo au prochain passage.
5. Il valide. Un petit vibreur confirme l'enregistrement, et l'écran revient sur la carte : le point apparaît maintenant marqué comme collecté.

**Ce qu'il doit observer à l'écran :**
- Le marqueur du point change de couleur une fois collecté.
- Le total « points collectés » de la tournée progresse (visible aussi depuis votre panneau « Démo formation » côté ordinateur, pratique pour montrer le lien entre le geste terrain et le suivi manager).

---

## (c) Point impossible à collecter

**Vous annoncez :**
« Parfois, tu arrives devant un conteneur, mais tu ne peux pas le vider. Voici comment le signaler sans bloquer ta tournée. »

**Le stagiaire fait :**
1. Sur le point concerné, il cherche le bouton **« Impossible de collecter »** (à côté ou à la place du bouton de collecte normale).
2. Il choisit un motif parmi ceux proposés à l'écran — la liste est courte et volontairement simple à lire (« facile à lire et à comprendre »). On y retrouve typiquement des cas comme :
   - un véhicule garé devant / accès bloqué ;
   - le conteneur est absent ou a disparu ;
   - le conteneur est endommagé ou impossible à ouvrir ;
   - une zone en travaux ;
   - un autre motif, à préciser en texte libre.
   (Les intitulés exacts affichés à l'écran font foi — faites lire les 5 propositions au stagiaire plutôt que de les lui réciter par cœur.)
3. Il valide. La tournée passe directement au point suivant.

**Ce qu'il doit observer à l'écran :**
- Le point est marqué différemment d'un point « collecté » (il n'est pas compté dans le poids collecté, mais il n'empêche pas la suite de la tournée).
- Cette action fonctionne **même sans réseau** — profitez-en pour couper le Wi-Fi/les données du téléphone un instant et montrer que ça continue de marcher (un bon moment pour rassurer les stagiaires qui travaillent souvent en zone de faible couverture).

**Point pédagogique à souligner :** ce bouton n'est pas fait pour éviter un conteneur « juste vide » (ça, c'est le niveau « Vide » du cas (b)) — il sert quand la collecte est réellement impossible à faire.

---

## (d) Déclaration d'un incident (avec photo)

**Vous annoncez :**
« Maintenant, imagine un problème plus sérieux — panne, accident, souci de sécurité. Voici comment le signaler. »

**Le stagiaire fait :**
1. Depuis la carte, il touche le bouton **« Incident »**.
2. Il choisit un type parmi les 5 proposés : Panne véhicule, Accident, Problème CAV, Environnement, Autre.
3. Il écrit une courte description (obligatoire).
4. Il ajoute une photo — c'est ici la différence avec le motif du cas (c) : la photo d'incident s'envoie **en ligne** (il faut que le téléphone soit connecté au moment de l'envoi ; contrairement à la collecte, ce n'est pas mis en attente pour un envoi différé hors connexion).
5. Il valide « Signaler l'incident ».

**Ce qu'il doit observer à l'écran :**
- Une confirmation visuelle et une vibration de succès.
- Retour automatique à la carte, tournée non interrompue.

**Point pédagogique à souligner :** rappelez la règle réelle du métier — un incident grave (accident, blessure) se signale d'abord **en vrai** au responsable par téléphone, l'application vient ensuite pour la traçabilité. La démo n'appelle personne, bien sûr : profitez-en pour rappeler oralement les numéros d'urgence (15 SAMU / 18 Pompiers) comme le fait `FORMATION_CHAUFFEURS.md`.

---

## (e) Retour au centre et pesée

**Vous annoncez :**
« Ta tournée est terminée, tu reviens au centre de tri. Voici comment déclarer ton retour et peser ta collecte. »

**Le stagiaire fait :**
1. Il touche « Retour centre » sur la carte.
2. Il renseigne le kilométrage d'arrivée (un nombre fictif, ex. 45080) et d'éventuelles remarques.
3. Il passe à l'écran de pesée : il saisit un **poids brut** (camion chargé, ex. 5200) et une **tare** (camion vide, ex. 3500).
4. Le **poids net** se calcule automatiquement et s'affiche en direct (poids brut − tare).
5. Il valide la pesée.

**Ce qu'il doit observer à l'écran :**
- Le calcul du poids net se met à jour au fur et à mesure qu'il tape les chiffres — un bon moyen de vérifier qu'il a compris la logique brut − tare = net.

**Point pédagogique à souligner :** rappelez que la tare est propre à chaque véhicule et qu'en situation réelle, elle est déjà connue (affichée sur le véhicule ou demandée au responsable) — pendant la démo, n'importe quelle valeur cohérente convient.

---

## (f) Clôture de la journée

**Vous annoncez :**
« Dernière étape : on regarde le résumé de la tournée et on clôture la journée. »

**Le stagiaire fait :**
1. Après la pesée, l'écran de résumé (bilan) s'affiche automatiquement.
2. Il observe les chiffres récapitulatifs : nombre de conteneurs collectés, poids total, distance parcourue, durée de la tournée, CO2 évité.
3. Il touche « Terminer la journée ».

**Ce qu'il doit observer à l'écran :**
- Le retour à l'écran de départ, prêt pour une nouvelle tournée.

**Point pédagogique à souligner :** insistez sur le fait que ce bilan est ce que voit aussi le manager pour de vraies tournées (les chiffres du panneau « Démo formation » que vous avez sous les yeux sur l'ordinateur en sont le miroir, mais restent hors statistiques réelles).

---
---

# 4. RÉINITIALISER ENTRE DEUX STAGIAIRES

Une fois qu'un stagiaire a terminé son passage (ou si vous voulez repartir d'un état propre à tout moment), remettez la démo à zéro **avant** de faire passer le suivant.

### Marche à suivre

1. Sur l'ordinateur, retournez dans **Véhicules → onglet « Démo formation »**.
2. Cliquez sur **« Réinitialiser la démo »**.
3. Une fenêtre de confirmation s'affiche, rappelant que cette action remet tous les points à collecter et reste sans effet sur les données réelles. Confirmez.
4. Un message de résultat s'affiche (succès avec le nombre de points remis à collecter, ou message d'erreur explicite si quelque chose s'est mal passé — dans ce dernier cas, réessayez, et si ça persiste contactez le support technique).
5. Le prochain stagiaire peut reprendre le lien depuis le début (écran de départ, checklist vierge, tous les points à collecter).

```
+--------------------------------------------------+
|                                                    |
|   NE RÉINITIALISE JAMAIS PENDANT QU'UN            |
|   STAGIAIRE EST EN PLEIN MILIEU D'UN EXERCICE.    |
|                                                    |
|   Ça lui ferait perdre sa progression en cours.   |
|   Attends la fin de son passage (ou la pause      |
|   entre deux stagiaires).                         |
|                                                    |
+--------------------------------------------------+
```

---
---

# 5. QUESTIONS FRÉQUENTES

**Que se passe-t-il si le téléphone du stagiaire est hors connexion pendant l'exercice ?**
C'est prévu et sans danger — l'application mobile est conçue pour fonctionner hors ligne sur le terrain. La collecte d'un point, la pesée et le signalement « Impossible de collecter » restent utilisables sans réseau et s'envoient dès que la connexion revient. Seuls la première ouverture du lien et l'envoi d'une photo (au point de collecte ou à l'incident) demandent une connexion active au moment de l'action.

**Est-ce que les actions faites pendant la démo comptent dans les statistiques de l'entreprise ?**
Non, jamais. Ni dans le tonnage collecté, ni dans la facturation, ni dans le CO2 évité, ni dans le suivi Refashion, ni dans aucun tableau de bord réel. C'est garanti côté serveur, vous n'avez rien à vérifier après coup.

**Peut-on faire pratiquer plusieurs stagiaires en même temps, chacun sur son téléphone ?**
Non, pas en même temps sur le même lien : le lien identifie un seul véhicule et donc une seule tournée partagée. Faites-les passer l'un après l'autre et réinitialisez entre deux (§4). Rien n'empêche en revanche que plusieurs stagiaires suivent l'exercice groupés autour d'un même téléphone (ou d'un écran projeté) pendant qu'un seul manipule.

**Le lien de démo expire-t-il ?**
Le lien reste valable tant qu'il n'est pas régénéré côté administration. Vous pouvez donc le garder en favori ou en raccourci d'écran d'accueil d'une session de formation à l'autre — il suffit de réinitialiser la tournée avant chaque nouveau passage.

**Faut-il créer un compte utilisateur pour chaque stagiaire ?**
Non. C'est justement l'intérêt du lien véhicule : aucun identifiant ni mot de passe à saisir, comme sur un vrai camion. Le stagiaire ouvre le lien et démarre directement.

**Le véhicule « DÉMO FORMATION » apparaît-il dans le suivi en temps réel des vrais véhicules (carte live, planning) ?**
Non — c'est un véhicule dédié à la formation, distinct de la flotte opérationnelle réelle ; il n'entre dans aucun planning de tournée réel.

**Que faire si le bouton « Réinitialiser la démo » affiche une erreur ?**
Le message d'erreur s'affiche à l'écran (jamais d'échec silencieux) : lisez-le, réessayez une fois. Si l'erreur persiste, contactez le support technique en indiquant le message affiché.

**Que faire si le panneau affiche « Démo formation non installée » ?**
La démo n'a pas encore été mise en place sur ce serveur. Un administrateur doit lancer, une seule fois, le script d'installation côté serveur (il crée le véhicule et la tournée dédiés). Contactez le support technique.

**Combien de temps dure une session de formation type ?**
Comptez environ 20 à 30 minutes pour dérouler les 6 cas pratiques à un rythme confortable, en laissant le stagiaire manipuler lui-même chaque écran.

---
---

# AIDE-MÉMOIRE RAPIDE DU FORMATEUR

```
+====================================================+
|                                                    |
|        SOLIDATA — DÉMO FORMATION CHAUFFEUR        |
|              AIDE-MÉMOIRE FORMATEUR                |
|                                                    |
+====================================================+
|                                                    |
|  AVANT LA SESSION                                  |
|  ─────────────────                                 |
|  1. solidata.online → Véhicules → Démo formation  |
|  2. Copier le lien                                 |
|  3. Le coller dans le navigateur du téléphone      |
|  4. (Optionnel) Ajouter à l'écran d'accueil        |
|                                                    |
+----------------------------------------------------+
|                                                    |
|  LES 6 CAS À FAIRE PRATIQUER                       |
|  ─────────────────────────────                     |
|  (a) Checklist de départ du camion                 |
|  (b) Collecte normale (niveau + photo)             |
|  (c) Point impossible à collecter (5 motifs)       |
|  (d) Déclarer un incident (avec photo)             |
|  (e) Retour au centre + pesée                      |
|  (f) Résumé + clôture de la journée                |
|                                                    |
+----------------------------------------------------+
|                                                    |
|  ENTRE DEUX STAGIAIRES                             |
|  ──────────────────────                            |
|  Véhicules → Démo formation → Réinitialiser la     |
|  démo → Confirmer                                  |
|                                                    |
+----------------------------------------------------+
|                                                    |
|  À RETENIR                                         |
|  ──────────                                        |
|  • Aucune donnée réelle n'est jamais modifiée      |
|  • Un seul stagiaire à la fois sur le lien         |
|  • Ne pas réinitialiser en plein exercice          |
|  • Toute erreur s'affiche à l'écran, en clair      |
|                                                    |
+====================================================+
```

---

**Bonne formation !**

**Solidarité Textiles — Août 2026**
