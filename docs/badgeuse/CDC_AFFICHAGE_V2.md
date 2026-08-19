# CDC — Écran d'information v2 (badgeuse Solidarité Textiles)

**Demandeur :** Direction (août 2026). **Périmètre : Solidarité Textiles uniquement**
(site badgeuse `LH` — les boutiques Frip & Co sont hors dispositif, NOTE_RH §2).
**Arbitrages de conformité : ADR-0004** (lu conjointement — les écarts à la demande
initiale y sont motivés point par point).

## 1. Au badgeage — overlay personnalisé (≤ 8 s, plafond juridique inchangé)

| Moment (déterminé par le poste : sens + heure murale Paris, plages paramétrables) | Message par défaut (gabarits paramétrables, variable `{prenom}`) |
|---|---|
| `matin` — entrée avant `badgeuse.moment_matin_fin` (11:30) | « Bonjour, {prenom} ! » |
| `pause` — sortie entre 11:00 et 14:00 | « Bon appétit, {prenom} ! » |
| `retour` — entrée entre 11:30 et 15:00 | « Bon après-midi, {prenom} ! » |
| `soir` — sortie après 14:00 | « Bonne fin de journée, {prenom} ! » |

- **Identité affichée : prénom + initiale** (inchangé — ADR-0004 §1).
- **Phrase de motivation** : tirée d'un **vivier générique paramétrable**
  (`badgeuse.phrases_motivation`, rotation quotidienne déterministe jour-de-l'année %
  taille) — **jamais liée au profil PCM** (ADR-0004 §2). Activable/désactivable.
- **Écran festif** (variante d'overlay, même plafond 8 s, animation douce sans
  clignotement AFF-06) : anniversaire de naissance et/ou anniversaire d'entrée dans la
  structure (« 2 ans avec nous ! ») — **uniquement pour les salariés ayant donné leur
  accord** (opt-in individuel tracé, ADR-0004 §4).
- **Premier jour** : « Bienvenue chez Solidarité Textiles, {prenom} ! » au premier
  badgeage (drapeau serveur `premier_jour`, calculé sur le début de contrat).
- **Rappel de rendez-vous (CIP / visite médicale) : PAS à l'écran** (ADR-0004 §3) —
  alternative livrée en piste : rappel SMS personnel Brevo (module Notifications).

Le cache badges (API device) est enrichi de **drapeaux booléens uniquement** :
`premier_jour`, `anniversaire`, `anniversaire_entreprise_annees` (entier ou null).
Aucune date de naissance, aucun statut, aucune donnée de parcours ne transite.

## 2. Écran de veille — playlist enrichie

Types de contenus existants conservés (`message`, `image`, `planning`,
`compte_a_rebours`) + nouveaux types. **`meteo` a changé de nature** (août 2026,
ADR-0006) : c'était un texte libre qui n'affichait rien, c'est désormais un
générateur servi par le serveur — voir la ligne correspondante.

| Type | Contenu (généré CÔTÉ SERVEUR à la construction de la playlist) | Règles |
|---|---|---|
| `annonces` | Événements du jour : anniversaires (naissance + entreprise) — **prénom + initiale**, opt-in uniquement | Affiché seulement s'il y a ≥ 1 annonce |
| `actus` | Dernières brèves du fil d'actualités SOLIDATA (`news_articles` : titre + résumé + source) | N paramétrable (défaut 3), aucun contenu externe fetché par le poste |
| `tournees` | Tournées en cours (`/tours/active-summary`) : libellé, code véhicule, progression X/Y CAV, statut | **SANS nom de chauffeur** (ADR-0004 §5) ; liste + barres de progression, pas de carte (frugalité kiosque) |
| `social` | Derniers posts Instagram/Facebook des comptes de la structure : visuel + légende + réseau | Via API Meta Graph si jeton configuré (job `syncBadgeuseSocial`), images téléchargées côté serveur ; **stories vidéo = V2** (ADR-0004 §6) |
| `media` | Image ou vidéo **téléversée** dans SOLIDATA (multer, pattern Refashion) | Le poste télécharge et sert en local (CSP `'self'` intacte, hors-ligne préservé) |
| `lien` | Lien partagé par un utilisateur : le SERVEUR télécharge le contenu (image/vidéo, https, liste blanche de types, taille max, garde anti-SSRF) et le transforme en média | Le poste ne fetch JAMAIS un domaine externe |
| `vak_live` | Écran promotionnel VAK (voir §3) | Injecté automatiquement les jours de VAK |
| `meteo` | Météo du **lieu du poste** : jour courant (température, libellé WMO, min, pluie, vent) + prévision courte. Source Open-Meteo via `utils/weather.js`, **rapatriée par le serveur** (job `syncBadgeuseMeteo`, cache `badgeuse_meteo`) | Lieu en cascade : coordonnées du **site** → réglages `badgeuse.meteo_*` → rien. Sans relevé du jour, l'écran est **omis** ; un texte saisi à la main reste affiché (ADR-0006 §5) |
| `presse` | Actualité **nationale** par flux RSS paramétrables (`badgeuse.presse_flux`, défaut franceinfo « à la une ») : **un écran PAR article** — titre, chapô, source, date, vignette | Flux lus par le SERVEUR (gardes anti-SSRF), vignettes téléchargées puis servies par l'API device. **Vidéo de presse NON rediffusée par défaut** — question de droits posée à la Direction (ADR-0006 §4) |

Diffusion des médias : nouvel endpoint device `GET /devices/:code/media/:id`
(clé device), cache local de l'agent dans `/var/lib/badgeuse/media/` (plafond
paramétrable, purge des fichiers non référencés) — l'affichage reste fonctionnel
hors ligne (AFF-07) et la CSP du kiosque reste `img-src 'self'`/`media-src 'self'`.

Comptes sociaux de référence (paramétrage, structure Solidarité Textiles) :
Instagram fripandcorouen, vintiz.fr, fripandcostreet, fripandcofamily ;
Facebook fripandcorouen, SolidariteTextiles, vintiz.fr.

## 3. Jours de VAK — écran promotionnel automatique

Quand une VAK est active (jour civil Paris dans ses bornes — même source que
`/vak/live/current`, périmètre caisse respecté) : un élément `vak_live` est injecté
dans la playlist avec **poids cumulé vendu (kg)** depuis l'ouverture, jauge d'objectif
et libellé de l'événement — aucune donnée personnelle, vocation visiteurs.
`sync_playlist_interval_sec` est abaissé à 300 s par le serveur les jours de VAK
(le champ existe déjà dans la config device).

## 4. Paramétrage SOLIDATA (Temps & Présence)

- **Onglet Affichage refondu** : playlist (types nouveaux + téléversement + lien
  partagé + générateurs activables avec durée/ordre), prévisualisation 16:9 par type.
- **Sous-écran « Messages de badgeage »** : gabarits des 4 moments + festifs +
  premier jour, plages horaires des moments, vivier de phrases, interrupteurs
  (motivation, festif, premier jour) — ADMIN/RH.
- **Sous-écran « Réseaux sociaux »** : comptes suivis, jeton Meta (chiffré AES-256-GCM,
  pattern SumUp), état de la dernière synchro, activation par compte — ADMIN.
- **Opt-in festif** : dans l'onglet Badges, par salarié — case « Affichage
  anniversaires accepté » + date de recueil tracée (`rgpd_audit_log`).

## 4bis. Identité de l'association sur tous les écrans (août 2026)

**Demande.** « Rajoute le logo de l'association sur tous les écrans. »

**Réalisation.** Le logo de Solidarité Textiles figure sur **l'écran de veille**
(bandeau haut, à gauche du libellé « Pointage » — présent quelle que soit la
catégorie diffusée : message, annonces, actus, tournées, compte à rebours,
météo, social, média, lien, VAK) **et sur l'écran de badgeage** (overlay :
succès, festif, badge non reconnu, anti-rebond), en signature discrète dans le
coin bas-gauche.

**Contraintes respectées.**

- **Aucun domaine externe.** Le fichier est servi par l'agent depuis
  `badgeuse/ui/assets/logo-solidarite-textiles.png` : la CSP du kiosque reste
  `default-src 'none'` avec `img-src 'self'`. Charger le logo depuis
  `solidata.online` aurait été une ressource distante, donc bloquée — et une
  dépendance réseau sur un écran qui doit fonctionner hors ligne.
- **Jamais devant l'information.** Sur l'overlay, le logo est en `z-index`
  inférieur à la carte : si un message long fait grandir celle-ci, le logo
  passe **derrière**. Le prénom et le message principal ne peuvent pas être
  masqués (AFF-03). Deux tests verrouillent ce point (présence sur les deux
  écrans, et ordre d'empilement).
- **Lisible sur fond sombre.** L'exemplaire du kiosque est recadré sur le bloc
  de marque : la baseline « Association d'insertion par la valorisation… » est
  imprimée en gris foncé, illisible sur le fond `#0f172a` et de toute façon
  indéchiffrable à la taille d'affichage. Fichier réduit à 256 px de large
  (21,6 Ko contre 301 Ko pour l'original) — un poste embarqué n'a pas à décoder
  une image de 2 290 px pour l'afficher en 60.
- **Aucune donnée personnelle** n'est ajoutée à l'écran par ce changement.

## 5. Hors périmètre V1 (documenté, pas silencieux)

Stories vidéo Instagram (API Meta contraignante, V2) ; **rediffusion des vidéos de
presse** (droits d'auteur : le mécanisme est livré mais désactivé, ADR-0006 §4) ; carte temps réel des véhicules
sur le kiosque (liste de progression en V1) ; nom complet, phrase PCM, rappels de
RDV à l'écran (ADR-0004 — voie d'arbitrage décrite) ; tout contenu nécessitant un
fetch externe par le poste (interdit par conception).
