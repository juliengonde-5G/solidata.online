# ADR 0006 — Presse nationale sur l'écran de veille : ce qui est diffusé, et ce qui ne l'est pas

**Statut :** Accepté — 19 août 2026.
**Contexte :** l'exploitant, après quelques jours d'usage réel du poste, demande deux
choses : que l'écran météo affiche enfin quelque chose, et que « l'écran d'actualité
reprenne de l'actualité **nationale**, avec un **flux vidéo**, un écran par article de
presse ». Les deux premiers points sont livrés. Le troisième — la vidéo — ne l'est pas
tel quel, et cet ADR dit pourquoi plutôt que de le passer sous silence.

## 1. Un type de contenu DISTINCT : `presse`, à côté d'`actus`

Le CDC v2 définit `actus` comme « les dernières brèves du fil d'actualités SOLIDATA »
(table `news_articles`, module 20). Cette source reste **inchangée** : c'est le canal par
lequel la structure parle d'elle-même, et le remplacer par des dépêches nationales aurait
supprimé une fonction pour en ajouter une autre. La presse nationale est donc un
**second type**, `presse`, que l'exploitant ajoute (ou non) à sa playlist.

**Un écran par article**, conformément à la demande : le serveur n'envoie pas une liste à
faire défiler dans un seul écran, il émet **un élément de playlist par article**. La
rotation reste celle de la playlist (`duree_sec` de l'écran), donc le rythme est réglable
sans toucher au code.

## 2. Les sources sont PARAMÉTRABLES, jamais codées en dur

`badgeuse.presse_flux` porte la liste des flux (libellé, source affichée, URL, actif).
Défaut livré : **franceinfo — à la une** (`https://www.francetvinfo.fr/titres.rss`, actif)
et **Le Monde — à la une** (inactif). Motifs du choix : service public d'information
nationale, flux RSS public, stable et documenté, sans clé d'accès ni compte.
Une source de presse change d'adresse de flux, ferme, ou change ses conditions : ce
paramétrage doit rester entre les mains de l'exploitant.

## 3. Le poste ne contacte AUCUN site de presse

Invariant repris de l'ADR-0004 §6, sans exception : le **serveur** lit le flux (gardes
anti-SSRF : `https` seul, IP internes refusées, redirections revalidées, type de contenu
en liste blanche, taille et délai bornés), range les articles en base, **télécharge la
vignette** et la sert au poste par l'API device (`GET /devices/:code/media/p<id>`). La CSP
du kiosque reste `'self'` ; l'écran continue de tourner hors ligne sur le dernier état
connu. Aucune adresse de site de presse ne descend jusqu'au poste — c'est vérifié par test.

## 4. La VIDÉO de presse n'est pas rediffusée — question posée à la Direction

**Ce qui a été demandé** : un « flux vidéo » d'actualité nationale sur l'écran.

**Ce qui a été livré** : le mécanisme complet (une `enclosure` vidéo d'un flux est
reconnue, téléchargeable côté serveur, diffusable par l'API device, et l'interface du
poste sait lire une vidéo), **désactivé par défaut** — `badgeuse.presse_video_autorisee`
vaut `false`. Un article dont le seul média est une vidéo est **quand même affiché**
(titre, chapô, source) ; c'est la vidéo qui est écartée, pas l'information. Le compteur
`videos_ignorees` du journal de synchronisation dit combien.

**Pourquoi ce n'est pas un détail technique.** Diffuser une vidéo de presse sur un écran
installé dans les locaux d'une entreprise est une **représentation** au sens du droit
d'auteur : ce n'est ni une consultation privée, ni le cercle de famille. Un flux RSS
autorise en pratique la reprise du titre, d'un chapô et d'une vignette **avec attribution
de la source et lien vers l'article** — c'est sa raison d'être. Il n'emporte aucune
licence de rediffusion du contenu vidéo, et les conditions d'utilisation des grands
éditeurs français l'excluent en général explicitement pour un usage collectif ou
commercial. Rediffuser sans licence expose la structure ; l'activer d'un clic sans que
personne n'ait tranché aurait été le contraire d'un service rendu.

**Ce que la Direction doit arbitrer** (rien de tout cela ne se règle dans le code) :

1. **La vidéo** — vérifier auprès de l'éditeur retenu si une diffusion sur écran interne
   est couverte, ou souscrire l'offre adaptée (les éditeurs publics et les agences ont des
   licences « affichage en entreprise »). Le jour où c'est écrit, il suffit de passer
   `badgeuse.presse_video_autorisee` à `true`.
2. **Les vignettes** — la photographie d'illustration est elle aussi une œuvre protégée.
   Elle est diffusée **par défaut**, avec la source affichée à l'écran, au titre de l'usage
   ordinaire d'un flux RSS ; c'est un choix défendable, pas une certitude juridique.
   `badgeuse.presse_vignettes` permet de les couper d'un réglage si la Direction préfère
   s'en tenir au texte.
3. **Le lien de retour** — un agrégateur RSS renvoie normalement vers l'article. Un écran
   d'atelier ne le peut pas. À défaut, l'écran affiche **systématiquement la source** :
   c'est l'attribution minimale, et elle n'est pas optionnelle dans le rendu.

**Alternative livrée en attendant** : l'écran plein cadre **vignette + titre en très
grand + chapô + source**, un article par écran, avec la même rotation douce que le reste
de la playlist. C'est ce que voit l'atelier aujourd'hui.

## 5. Météo : le lieu vient du site, jamais d'une ville devinée

Le type `meteo` existait depuis la V1 mais n'était qu'un **texte libre** : le serveur
n'envoyait aucune donnée, l'écran restait vide (c'est le défaut signalé). Il devient un
générateur servi par Open-Meteo, via l'utilitaire déjà partagé avec les modules Boutiques
et VAK. Le lieu suit une **cascade explicite** : coordonnées du **site du poste**
(`badgeuse_sites.latitude/longitude`) → réglages `badgeuse.meteo_*` (préremplis avec les
coordonnées du centre de tri du Houlme, seul site équipé) → **rien**. La source retenue
(`site` ou `parametre`) accompagne la prévision jusqu'à l'écran.

Sans relevé pour **aujourd'hui**, l'écran météo est **omis** : jamais la température d'un
autre jour présentée comme celle du jour. Un écran météo saisi à la main (texte) continue
de s'afficher tel quel, y compris quand la prévision manque.

**Note de conformité** : ces coordonnées sont celles d'un **établissement** (adresse
publique de la structure) et d'un cache de prévisions. Elles ne désignent personne, et
aucune table nominative du module (pointages, badges, postes, corrections, feuilles de
temps) n'en porte — c'est désormais vérifié table par table par le test de minimisation
du schéma, en remplacement de l'interdiction globale du mot « latitude ». L'interdit de
la NOTE_JURIDIQUE §3.4 (géolocalisation **d'un salarié**) est intégralement tenu.

## Conséquences

- Le contrat d'API device passe en **v1.5** : type `meteo` enrichi d'un bloc de données,
  type `presse` (un élément par article), préfixe média `p<id>`.
- Deux nouvelles tables sans donnée personnelle : `badgeuse_meteo` (cache de prévisions),
  `badgeuse_presse_articles` (articles importés). Leur conservation est appliquée par la
  purge planifiée déjà en place (`badgeuse.retention_presse_jours`, défaut 15 jours) —
  hygiène de disque, pas durée RGPD.
- Deux jobs au scheduler : `syncBadgeusePresse` (horaire) et `syncBadgeuseMeteo`
  (aux passages de `runAllJobs`, plus un rafraîchissement de dernier recours à la
  construction de la playlist).
