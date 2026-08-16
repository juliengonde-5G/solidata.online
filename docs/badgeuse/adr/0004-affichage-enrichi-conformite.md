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
