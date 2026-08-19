# Rapport consolidé — Mise en service du poste de secours et débogage multi-agents

**Module 33 « Temps & Présence » (badgeuse) — SOLIDATA**
**Date : 19 août 2026**
**Destinataires : Direction de Solidarité Textiles, référent d'exploitation badgeuse**

---

## 1. Contexte et méthode

### 1.1 Contexte

Le 19 août 2026, le poste de secours (Raspberry Pi 3, hostname `ST-BadgeuseSecours`)
a été mis en service pour la première fois sur un matériel réel, hors environnement
de développement. Cette mise en service a fait apparaître, en quelques heures et en
production, une cascade de pannes qui n'étaient jamais survenues en développement :
écran noir, poste apparemment redémarrant en boucle, lecteur de badge « connecté »
mais muet. Ces pannes ont été corrigées au fil de l'eau par l'orchestrateur du projet
au fur et à mesure qu'elles se présentaient sur le poste (PR #105 à #115, toutes
fusionnées sur `main`).

Une fois le poste stabilisé, un débogage systématique — et non plus seulement
réactif — a été engagé sur l'ensemble du module (partie serveur SOLIDATA **et**
partie poste embarqué), pour rechercher les défauts qui n'avaient pas encore trouvé
l'occasion de se manifester.

### 1.2 Méthode

Le débogage a été mené en orchestration multi-agents / multi-modèles :

| Rôle | Modèle | Périmètre |
|---|---|---|
| A0 — orchestrateur | Opus | Cadrage, réconciliation des correctifs, arbitrages, mise en service terrain |
| A2 — débogage applicatif | Opus | Backend + frontend SOLIDATA (module `badgeuse_*`) |
| A3 — débogage poste | Opus | Agent embarqué Python, UI kiosque, scripts d'installation Raspberry |
| Reporting | Sonnet | Consolidation et rédaction du présent rapport |

**Règle de méthode appliquée aux deux vagues de débogage** : *aucun bug n'est
affirmé sans reproduction, aucun correctif n'est considéré acquis sans preuve
d'exécution.* Concrètement, chaque défaut retenu dans ce rapport a été rejoué
« avant correctif » (échec constaté) puis « après correctif » (succès constaté),
sur du code réel — base PostgreSQL 16.13 réelle pour la partie serveur, agent
Python réel face à un faux serveur conforme au contrat pour la partie poste,
rendu Chromium réel pour les captures d'écran.

---

## 2. Les 11 correctifs « terrain » (PR #105 à #115)

Ces onze correctifs ont été appliqués un par un, dans l'ordre où les pannes se
sont présentées sur le poste de secours réel, avant que le débogage systématique
ne soit engagé.

| PR | Symptôme vécu | Cause racine | Correctif |
|---|---|---|---|
| **#105** | L'installation échoue sur le Raspberry Pi 3 neuf (Raspberry Pi OS « Trixie », Python 3.13). | Trois incompatibilités avec Python 3.13 : le paquet du lecteur de badge (`evdev`) tentait une recompilation inutile et impossible (aucun compilateur présent) ; une fonction Python standard (`importlib.util`) n'est plus chargée automatiquement depuis Python 3.12 ; le mode de vérification de la configuration ne trouvait pas le logiciel de l'agent faute de chemin d'accès correctement transmis. | Réutilisation du paquet système déjà compilé, correction de l'import, alignement du chemin d'accès sur celui utilisé par le service réel. (Ajout au passage d'une procédure d'accès SSH au poste, jusque-là non documentée.) |
| **#106** | Après une installation qui se termine « sans erreur », l'écran reste bloqué sur un écran de connexion texte ; vu de la salle, cela ressemble à un redémarrage en boucle. | Le service d'affichage du kiosque et l'écran de connexion standard du Raspberry se disputaient le même écran physique ; le kiosque échouait à chaque tentative, l'écran de connexion reprenait aussitôt la main, ce qui donnait l'illusion d'un redémarrage permanent alors que la machine ne redémarrait pas. | L'écran de connexion standard est désactivé sur l'écran réservé au kiosque, dès l'installation. |
| **#107** | Écran noir au démarrage, sans aucun message d'erreur exploitable. | Le chemin du navigateur (Chromium) était écrit en dur dans le service système, alors que son nom exact varie selon la distribution installée. | Le chemin du navigateur est détecté à l'installation et transmis correctement au service. Création d'un outil de diagnostic en une seule commande (`diagnostic.sh`), qui deviendra le point d'entrée de tous les diagnostics suivants. |
| **#108** | Un poste s'installe « avec succès » d'après le résumé final, mais l'écran reste noir : ni le navigateur, ni le logiciel d'affichage ne sont, en réalité, installés. | Le script de vérification cherchait le mot anglais « Candidate: » dans la réponse du gestionnaire de paquets Linux (apt). Sur un système en français, apt répond « Candidat : » — la vérification ne trouvait donc **jamais aucun paquet installé**, y compris les plus essentiels, et l'installation se poursuivait en silence sans navigateur ni afficheur. | La vérification n'interroge plus un texte qui change selon la langue : elle tente l'installation et lit le résultat technique de la commande (indépendant de la langue). Un poste sans navigateur affiche désormais un message d'échec explicite au lieu de se déclarer réussi. |
| **#109** | Le mode d'affichage de secours (X11) refuse de démarrer, sans aucune trace exploitable dans les journaux. | Le composant système qui autorise un utilisateur non-administrateur à démarrer l'affichage graphique manquait de la liste des paquets installés en secours. | Ajout du paquet manquant à l'installation. |
| **#110** | Le service d'affichage est déclaré « actif » par le système d'exploitation, mais l'écran reste noir : le logiciel de fond tourne sans que le navigateur ne s'affiche par-dessus. | Le contrôle de bon fonctionnement se contentait de vérifier que le service tournait, sans vérifier qu'un navigateur y était réellement présent et actif. | Le diagnostic vérifie désormais les processus réellement présents à l'intérieur du service, pas seulement son statut déclaré par le système. |
| **#111** | Deux défauts révélés par l'usage réel du diagnostic : un faux verdict « aucun navigateur actif » alors qu'il l'était bien ; un redémarrage du kiosque qui laisse l'écran éteint 90 secondes. | L'emplacement système que le diagnostic lisait n'est pas toujours celui réellement utilisé (faux négatif) ; aucune limite de temps n'était fixée à l'arrêt du kiosque, qui appliquait donc le délai maximal par défaut du système (90 s). | Le diagnostic lit l'emplacement réel au lieu de le deviner ; le délai d'arrêt du kiosque est borné à 10 secondes. |
| **#112** | Le diagnostic contrôlait l'affichage, mais ne disait jamais si le lecteur de badge fonctionnait, ni si les pointages partaient réellement vers SOLIDATA. | Absence de tout contrôle sur la chaîne « badge lu → mis en file d'attente locale → envoyé au serveur ». | Deux nouvelles sections de diagnostic : état du lecteur de badge (nombre de périphériques détectés, dernier événement) et état de la file d'attente locale des pointages. |
| **#113** | Écran encore noir malgré les correctifs précédents : le logiciel de fond du kiosque tourne depuis longtemps, mais aucun navigateur ne figure dans la liste des processus actifs. | Les options de lancement du navigateur et le mode d'affichage réellement utilisé (modifié manuellement sur le terrain après coup) n'étaient plus cohérents entre eux : le navigateur tentait de démarrer dans le mauvais mode et quittait aussitôt, sans laisser aucune trace. | Contrôle de cohérence ajouté au diagnostic (mode d'affichage retenu vs options réellement transmises). Ajout de l'outil `sqlite3`, manquant, pour pouvoir inspecter la file de pointages en attente sur le poste. |
| **#114** | Une faute de frappe sur le paramètre indiquant le modèle de matériel (`--targert` au lieu de `--target`) bloquait une réinstallation, alors que le poste sait déjà, seul, de quel modèle il s'agit. | Ce paramètre était obligatoire sans nécessité réelle. | Le modèle de matériel (Pi 3 / Pi 4 / Pi 5) est désormais reconnu automatiquement ; le paramètre reste disponible pour forcer un modèle en banc de test. |
| **#115** | Relancer le script d'installation depuis le poste déjà installé — un geste que la documentation elle-même recommandait pour redérouler la configuration — **a effacé les dossiers du logiciel embarqué**. | Le script déplaçait d'abord l'ancienne version avant de copier la nouvelle. Lorsqu'il est relancé depuis le dossier déjà installé, origine et destination sont **le même dossier** : le déplacement fait disparaître le contenu avant que la copie ne puisse le remplacer. | Garde d'identité (origine = destination → aucune action) ; bascule uniquement après une copie réussie de la nouvelle version ; restauration automatique de l'ancienne version en cas d'échec de copie. |

Ces onze correctifs ont permis au poste de secours d'atteindre un état affichable
et stable. Ils n'ont en revanche pas, à eux seuls, réglé la panne la plus gênante
en exploitation — le lecteur de badge « connecté » mais silencieux — qui a exigé
le débogage systématique décrit ci-dessous (§4).

---

## 3. Synthèse de la vague A2 — partie applicative SOLIDATA (PR #116)

Audit mené sur PostgreSQL 16.13 réel, avec les véritables gestionnaires de
requêtes Express (pas de simulation de base de données) : 216 assertions de
bancs d'essai, 33 tests de contrat nouveaux — dont la particularité d'être des
**contre-épreuves** (le correctif retiré fait retomber le test en échec, preuve
que le test contrôle bien le bon comportement et non un artefact).

### 3.1 Les 7 bugs (tous prouvés par exécution)

| # | Sévérité | Défaut | Conséquence côté exploitation |
|---|---|---|---|
| **B1** | **P0 — sécurité/RH** | `PATCH /badgeuse/badges/:id` échouait (erreur serveur) sur les 5 statuts possibles, à cause d'un paramètre technique typé différemment à deux endroits du code. | **Un badge perdu ou volé ne pouvait pas être désactivé** : il continuait d'ouvrir des pointages. Aucun badge de remplacement ne pouvait être délivré. La purge RGPD des badges restitués n'était jamais amorcée. |
| **B7** | **P0 — transverse** | La reconstruction d'une base de données neuve (scénario disaster-recovery) échouait à zéro table créée, à cause d'un ordre d'exécution incorrect dans le script d'initialisation. | **La reconstruction complète du système après un incident majeur était impossible.** Régression d'un correctif antérieur (v2.7.0). |
| B2 | Majeur | Un pointage « orphelin » provenant d'un badge **connu** mais hors de sa plage horaire habituelle était invisible à la fois de l'encart des orphelins et du décompte des anomalies, tout en restant impossible à rattacher — et pourtant compté dans les heures. | Un pointage anormal restait « à traiter » indéfiniment, sans jamais apparaître à l'écran prévu pour cela. |
| B3 | Majeur | Les écrans affichaient « Salarié #7 » au lieu de « DURAND Amel » sur 5 onglets, l'écran cherchant un champ que l'API ne renvoie pas sous ce nom. | Identification des salariés illisible pour l'utilisateur RH/encadrant. |
| B4 | Majeur | L'encart « Pointages orphelins » avalait ses erreurs et affichait « Aucun pointage orphelin en attente » même quand l'appel au serveur avait échoué. | Un problème technique se traduisait par un faux message rassurant, potentiellement trompeur pour l'exploitation. |
| B5 | Moyen | Deux compteurs d'anomalies restaient structurellement à zéro (jamais produits par le moteur de calcul), et 4 types d'anomalies sur 8 n'avaient pas de libellé français. | Tableau d'anomalies partiellement muet et partiellement en anglais technique. |
| B6 | Mineur | Le tri des feuilles de temps par nom ne fonctionnait pas (le code de tri lisait un champ absent de la donnée réellement transmise). | Confort d'utilisation dégradé, aucun impact sur les données. |

### 3.2 Verdict sur la promesse « orphelins »

La promesse fonctionnelle *« un pointage orphelin envoyé par le poste apparaît
dans l'encart Pointages orphelins »* est **tenue après correctifs**, pour un
badge inconnu **et** pour un badge hors plage horaire. Elle a été vérifiée de
bout en bout : envoi réel au point d'entrée du poste → statut « orphelin » posé
en base → lecture par l'écran (forme exacte attendue par le composant réel) →
rendu vérifié sur un rendu Chromium du build réel → rattachement RH accepté et
journalisé → tentative de rejeu refusée (404) → tentative par un compte MANAGER
refusée (403).

### 3.3 Verdict de conformité

Tous les points de contrôle de conformité testés sont **conformes** : clé du
poste hachée (jamais en clair), révocation immédiate à la régénération, clés de
site chiffrées sans rotation silencieuse, aucun identifiant de badge en clair
nulle part (base, journaux, API), l'authentification web ne peut pas se
substituer à la clé du poste, appairage à usage unique et à durée limitée,
matrice des rôles exacte, le cache du poste ne dépasse jamais prénom + initiale,
la date de naissance ne quitte jamais le serveur, purge RGPD à 7 périmètres
vérifiée sur des données antidatées, toutes les requêtes SQL sont paramétrées
(5 tentatives d'injection testées, toutes refusées), et une altération directe
en base de la chaîne d'intégrité est détectée.

### 3.4 Tests

Suite `jest` badgeuse : 12 suites, 569 tests verts (dont une nouvelle suite
d'exécution sur base PostgreSQL réelle, activable par variable d'environnement,
et une nouvelle suite verrouillant la forme exacte lue par les écrans réels).
Suite `jest` complète du projet : 105 suites, 1 895 tests verts. Build Vite OK.
La section « badgeuse » du script d'initialisation de base a été rejouée trois
fois de façon idempotente. 8 captures d'écran Chromium des onglets de l'écran
Temps & Présence, produites sur un build réel.

---

## 4. Synthèse de la vague A3 — partie poste embarqué (PR #117)

### 4.1 Le mystère du lecteur muet, élucidé

C'est la réponse à la question posée sur le terrain : *« le badge est passé,
mais je ne le vois jamais remonter dans les pointages orphelins »*.

**Ce qui a été constaté** : le lecteur de badge du poste de secours
(marque Hengchangtong, modèle HCT) se laisse détecter et « ouvrir » par le
logiciel sans aucune erreur — le journal indique sincèrement « lecteur
connecté » — puis ne transmet plus jamais rien. Silence total, sans message
d'erreur.

**Explication en une phrase** : un lecteur de badge de ce type se présente
souvent au système d'exploitation comme **deux périphériques distincts** (deux
entrées `/dev/input/eventN`), portant le même nom et les mêmes identifiants —
mais **un seul des deux transmet réellement les badges lus**, l'autre restant
muet en permanence.

Le logiciel du poste ne retenait que **le premier périphérique trouvé**, dans un
ordre que le système ne garantit pas — c'est-à-dire, en pratique, **un tirage au
sort à chaque branchement**. Une fois sur deux (au hasard), le poste écoutait la
mauvaise moitié du lecteur : elle se laisse ouvrir sans protester, mais ne parle
jamais. D'où le symptôme exact observé sur le terrain : lecteur reconnu,
silence éternel ensuite.

**Preuve par reproduction** : rejoué en laboratoire avec un faux lecteur à deux
interfaces, la version avant correctif ne recevait aucun badge (liste vide) là
où un vrai badge avait pourtant été présenté ; la version après correctif le
recevait correctement.

**Correctif** : le logiciel du poste écoute désormais **simultanément toutes**
les interfaces qualifiées du lecteur, chacune avec sa propre mémoire tampon
(sans mélange entre elles, vérifié par test) — la bonne moitié parle, l'autre
reste silencieuse sans que cela n'ait plus d'importance.

**Outillage ajouté pour le diagnostic sur le terrain** : une trace explicite
« première frappe reçue » par interface dans le journal du poste ; une commande
`python -m badgeuse_agent --lecteurs` qui liste les interfaces sans divulguer
aucun badge lu ; une nouvelle section « 4 bis. Lecteur de badge » dans l'outil
de diagnostic avec un verdict explicite sur les frappes reçues dans les
dernières 24 heures. Cet outillage permet désormais de distinguer, sans
ambiguïté, « le lecteur n'écoute pas la bonne interface » (le défaut ici
corrigé) de « le lecteur ne transmet réellement rien » (câble, alimentation, ou
lecteur configuré en mode clavier plutôt qu'en mode badge).

### 4.2 Bloquants et défauts majeurs corrigés

| Type | Défaut | Effet | Correctif |
|---|---|---|---|
| Bloquant | Le script d'installation s'auto-détruisait quand il était relancé depuis le poste déjà installé (mécanisme partagé avec le correctif terrain #115). | Perte du logiciel embarqué sur un geste par ailleurs recommandé. | Convergé avec le correctif de l'orchestrateur : une seule fonction de déploiement, mécanique « copie d'abord, bascule ensuite » (un échec de copie ne touche jamais la version qui tourne). |
| Bloquant | Le point de démarrage du kiosque contenait des chemins de fichiers devinés en dur. | Écran noir muet, aucune piste dans le journal (échec « 203/EXEC »). | Refus explicite avec message de correction au journal et dans le diagnostic, au lieu d'un échec silencieux. |
| Majeur | Un écran figé gelait **tous** les badgeages suivants (le programme restait bloqué 3,0 secondes sur l'affichage d'un badgeage avant de pouvoir en traiter un autre). | Un incident d'affichage isolé bloquait tout le poste pour tous les salariés suivants. | Le délai de blocage est ramené à 0,5 seconde. |
| Majeur | Deux heures différentes affichées sur le même écran (l'écran de veille au fuseau du navigateur — UTC sur une image neuve — pendant que le badgeage affichait l'heure de Paris). | Confusion sur l'heure réelle affichée aux salariés. | L'agent transmet désormais sa propre heure de référence Paris à tout l'écran. |
| Majeur | L'extinction programmée de l'écran (économie d'énergie) raisonnait en heure système (UTC) plutôt qu'en heure de Paris. | L'écran s'éteignait deux heures trop tôt sur un poste en UTC — l'équivalent de deux heures de service perdu chaque matin. | Le script d'extinction lit désormais l'heure en fuseau Europe/Paris. |
| Majeur | Le fuseau horaire du système n'était pas fixé à l'installation. | Journaux et horodatages décalés de deux heures, gênant tout dépannage à distance. | Le fuseau est désormais fixé par le script d'installation. |
| Majeur | Une anomalie dans le flux du lecteur pouvait repartir comme si elle était un vrai badge (« 11111 »). | Risque de pointage fantôme. | Cette anomalie est désormais écartée avant transmission. |
| Majeur | Une interface de lecteur illisible (droits d'accès insuffisants) était ignorée en silence. | Panne muette, invisible sans inspection manuelle. | L'échec d'ouverture est désormais journalisé au lieu d'être avalé. |
| Majeur | Les modules cœur du poste (lecture du badge, synchronisation, serveur web local, application) n'avaient **aucun test réel** — seul un assemblage manuel des morceaux était testé. | Une régression sur l'un de ces modules pouvait passer inaperçue jusqu'au terrain. | Nouvelle suite de tests qui fait tourner l'**agent réel** face à un faux serveur conforme au contrat (27 tests de « promesse »), plus 17 tests dédiés au lecteur et 7 tests de conformité (confidentialité, absence de secret exposé). |
| Mineur (5) | Ordre des redirections `/dev/tty` dans 4 scripts ; port de l'interface locale figé ; message « badgez » affiché même sans lecteur détecté ; colonnes de la commande `--lecteurs` ; une case du document QA se déclarait testée à tort. | Confort de diagnostic, cohérence documentaire. | Corrigés et vérifiés. |

### 4.3 Les 12 captures kiosque

12 images 1920×1080 ont été produites par **l'agent réel**, via un navigateur
Chromium piloté automatiquement sur l'interface locale du poste, en connexion
WebSocket réelle (aucune simulation de rendu) : les 5 écrans de veille
(message, annonces, actualités, tournées, VAK), les 5 états de badgeage (badge
valide, badge festif, badge inconnu, badge illisible, badge déjà passé), l'état
« poste hors ligne » et l'état « lecteur absent ». Aucune erreur JavaScript
constatée, message principal toujours lisible à distance (taille ≥ 48 px),
contrastes conformes, et affichage strictement limité à « prénom + initiale »
(exemple constaté : « Karim B. »). **Deux défauts ont été trouvés par la
capture elle-même** (le décalage d'heure §4.2, et un défaut mineur de rendu) —
la preuve visuelle a donc, une fois de plus, servi de détecteur de bug à part
entière et pas seulement de justificatif après coup.

*Note d'exploitation : ces 12 captures, comme les 8 de la vague A2, ont été
produites dans l'environnement d'exécution des agents et ne sont pas, à ce
jour, versionnées dans le dépôt — elles ne sont donc pas rejouables
automatiquement à chaque nouvelle version (cf. §7, point 3).*

### 4.4 Tests

`pytest` : 400 → 454 tests verts, aucun test ignoré. Nouveau harnais de test des
**scripts shell** (jusque-là non testés par quoi que ce soit) : 68 vérifications,
toutes vertes, exécutables sans droits root, sans matériel Raspberry et sans
réseau. Vérification de syntaxe des 12 scripts shell du poste : conforme.

---

## 5. Bilan chiffré

### 5.1 Défauts corrigés, par origine et sévérité

| Origine | Bloquant / P0 | Majeur | Moyen | Mineur | Total |
|---|---|---|---|---|---|
| Correctifs terrain (mise en service, PR #105-#115) | — | — | — | — | **11** |
| Vague A2 — applicatif SOLIDATA (PR #116) | 2 | 3 | 1 | 1 | **7** |
| Vague A3 — poste embarqué (PR #117) | 2 | 8 | — | 4 | **14** |
| **Total débogage systématique (A2 + A3)** | **4** | **11** | **1** | **5** | **21** |
| **Total général (terrain + débogage)** | | | | | **32** |

### 5.2 Tests, avant / après la journée du 19 août 2026

| Suite de tests | Avant | Après |
|---|---|---|
| `pytest` (poste embarqué) | 400 | **454** |
| `jest` badgeuse (dont une suite d'exécution réelle sur PostgreSQL) | 549 | **569** |
| Harnais de test des scripts shell (poste) | 0 | **68** |
| Captures d'écran réelles (Chromium, rendu réel) | 0 | **20** (8 côté SOLIDATA + 12 côté poste) |

`jest` sur l'ensemble du projet : 105 suites, 1 895 tests verts. Build Vite OK.
`bash -n` (vérification de syntaxe) sur les 12 scripts du poste : 12/12 OK.

### 5.3 PR fusionnées

**#105 à #117**, en deux temps : correctifs terrain #105-#115 (fusionnés au fil
de l'eau le jour même), puis débogage systématique #116 (vague A2, applicatif
SOLIDATA) et #117 (vague A3, poste embarqué), fusionnés après réconciliation par
l'orchestrateur.

---

## 6. Leçons systémiques

**Le constat qui doit être pris au sérieux** : au matin du 19 août, la suite de
tests automatisés du poste était **verte à 400/400**. Elle n'a empêché **aucun**
des six défauts découverts en production ce même jour. Il ne s'agit pas d'un
hasard malheureux mais d'un **angle mort structurel**, désormais identifié et en
grande partie corrigé :

1. **Les tests testaient les pièces, jamais la promesse.** Le pipeline complet
   du poste — « un badge est lu → mis en file → envoyé au serveur → le salarié
   voit un retour à l'écran » — n'était vérifié par **aucun test automatisé**
   avant ce jour : seul un assemblage manuel des morceaux, recomposé à la main
   dans un test, faisait office de garantie. Le module de lecture du lecteur de
   badge en particulier n'avait jamais été testé en tant que tel.

2. **Les scripts d'installation et de diagnostic (shell) n'étaient testés par
   rien.** `install.sh`, `diagnostic.sh`, `dpms.sh` — c'est-à-dire exactement
   les scripts qui s'exécutent au moment le plus critique, sur le vrai matériel,
   sans filet — ne disposaient d'aucun harnais de test avant la journée du 19
   août. C'est dans ces scripts qu'ont été trouvés la moitié des correctifs
   terrain (langue d'apt, chemin du navigateur, auto-destruction à
   l'installation).

3. **Aucun test ne tournait sur une base de données réellement vide, ni sur un
   Raspberry Pi OS réellement à jour (Trixie / Python 3.13).** Le scénario de
   reconstruction complète (disaster-recovery) — la situation la plus grave que
   le système puisse rencontrer — n'avait jamais été rejoué en pratique avant
   que la vague A2 ne le teste explicitly : il échouait à zéro table créée. De
   même, les incompatibilités Python 3.13 n'ont pu être vues qu'au contact d'un
   Raspberry réellement neuf.

4. **La langue du système n'avait jamais été considérée comme une variable à
   tester.** La sonde de vérification des paquets installés cherchait un texte
   anglais (« Candidate: ») que le gestionnaire de paquets Linux traduit en
   français (« Candidat : ») sur un poste francophone. Un test qui aurait
   tourné dans un environnement anglophone (le cas le plus fréquent en
   développement et en intégration continue) ne pouvait, par construction,
   jamais détecter ce défaut.

5. **L'auto-référence n'avait jamais été envisagée.** Relancer un script
   d'installation depuis le dossier où il est déjà installé — un geste que la
   documentation recommandait elle-même pour redérouler une configuration — est
   un scénario qu'aucun test ne rejoue naturellement : un test lance toujours le
   script *depuis* une source distincte *vers* une destination différente. Sur
   le terrain, ce cas s'est produit et a effacé le poste.

6. **Un mécanisme aléatoire (« au tirage au sort ») ne se révèle pas à un test
   déterministe.** Le choix de la mauvaise interface du lecteur de badge dépend
   de l'ordre — non garanti par le système d'exploitation — dans lequel les
   périphériques apparaissent. Un test classique, exécuté toujours dans le même
   environnement contrôlé, ne tombe quasiment jamais sur le mauvais tirage ; le
   terrain, lui, y est exposé à chaque redémarrage.

**Ce qui a changé structurellement, en réponse à ces six constats** :

- Un nouveau niveau de test **« promesse »** fait désormais tourner l'agent réel
  du poste face à un faux serveur conforme au contrat d'échange (27 tests), et
  une suite équivalente côté SOLIDATA fait tourner les vrais gestionnaires de
  requêtes contre une vraie base PostgreSQL réelle (opt-in, 13 tests).
- Les scripts shell disposent désormais d'un harnais dédié (68 vérifications),
  branché sur `pytest` — ils ne sont plus « hors radar ».
- La forme exacte des données lues par les écrans réels est désormais
  verrouillée par des tests extraits du code front réel (20 tests), plutôt que
  supposée.
- Les captures d'écran sont désormais produites par l'agent réel sur un rendu
  Chromium réel, et ont elles-mêmes servi à détecter deux défauts
  supplémentaires — la preuve visuelle est un outil de détection, pas seulement
  un justificatif.
- Le diagnostic terrain (`diagnostic.sh`) a été enrichi à chaque panne réelle
  rencontrée (état des services, occupation de l'écran, présence du navigateur,
  état du lecteur de badge, état de la file de pointages) : il condense
  aujourd'hui en une seule commande ce qui exigeait auparavant une inspection
  manuelle par SSH.

**Ce qui reste un point de vigilance** (voir aussi §7) : la suite d'exécution
réelle sur PostgreSQL reste **optionnelle** (non branchée à `deploy.sh` ni à
l'intégration continue), et les 11 suites `jest` historiques du module
continuent de s'exécuter sur une base simulée plutôt que réelle — c'est
précisément sur une base réelle que les deux P0 de la vague A2 (badge
indésactivable, reconstruction à zéro table) ont été trouvés.

---

## 7. Décisions à arbitrer (Direction / RH)

1. **Pointage orphelin « hors plage » compté dans les heures avant arbitrage.**
   Un badge connu, pointé hors de sa plage horaire habituelle, est désormais
   visible et rattachable — mais il reste compté dans le temps de travail tant
   qu'aucune règle n'a tranché. Le bouton « Confirmer » de l'écran ne fait
   aujourd'hui qu'accuser réception de l'anomalie : il ne modifie aucun chiffre
   de paie. **À trancher avec la RH** : faut-il neutraliser ces heures par
   défaut jusqu'à validation RH, ou les compter comme aujourd'hui ?

2. **Capture de tous les claviers HID branchés au poste.** Le correctif du
   lecteur muet (§4.1) fait désormais écouter **toutes** les interfaces
   qualifiées comme « clavier » — ce qui inclut un clavier d'administration
   local qui serait branché au poste pour du dépannage : il sera capté en
   exclusivité par l'agent de badgeage, et donc rendu inutilisable pendant ce
   temps. Avant le correctif, ce risque existait déjà mais « au tirage au
   sort » ; il est désormais systématique. Des filtres de reconnaissance du
   lecteur et une commande de contrôle (`--lecteurs`) atténuent le risque.
   **À arbitrer** : le périmètre de capture est-il acceptable tel quel, ou
   faut-il exclure explicitement les claviers d'administration connus ?

3. **Cloisonnement de la lecture MANAGER par équipe.** Un encadrant (rôle
   MANAGER) peut aujourd'hui consulter les pointages de **tout** salarié, pas
   seulement ceux de son équipe. Ce point est un écart déjà documenté depuis la
   mise en service initiale du module (réserve E1, précédent déjà connu dans le
   dépôt depuis la v2.12.0) — il n'a pas été traité par cette journée de
   débogage et reste **à arbitrer par la Direction et le référent RGPD**.

4. **Pastille d'état d'en-tête décorative.** La pastille verte d'état affichée
   en en-tête de la supervision reste verte même lorsque le poste est hors
   ligne ou sans lecteur fonctionnel — elle ne reflète pas encore ces deux
   états. **À arbitrer** : faut-il la relier aux nouveaux signaux disponibles
   (dernière frappe reçue, dernier heartbeat) ?

5. **Suite de test PostgreSQL réelle non accrochée au déploiement.** La suite
   qui exécute les vrais gestionnaires de requêtes contre une vraie base
   PostgreSQL (celle qui a détecté les deux P0 de la vague A2) est aujourd'hui
   **optionnelle**, activée seulement par une variable d'environnement dédiée.
   **Recommandation** : l'accrocher à `deploy.sh` et/ou à l'intégration
   continue, pour qu'elle s'exécute systématiquement et non plus seulement à
   la demande d'un agent de débogage.

6. **Recette matérielle RP-1 → RP-6 toujours obligatoire.** Aucun des
   correctifs de cette journée ne remplace la recette matérielle décrite dans
   `RAPPORT_QA.md` (mise en charge réelle, coupures, badges en rafale). Elle
   reste **le préalable obligatoire** à toute mise en service réelle d'un poste,
   secours compris.

7. **Préalables inchangés.** La consultation du CSE, la note d'information aux
   salariés et l'arbitrage formel de la grille de règles de gestion par la
   Direction (écran Paramètres) restent des préalables **non levés** par cette
   journée de débogage technique — ils demeurent posés dans le journal du
   projet depuis la mise en service initiale du module.

---

## 8. Prochaines étapes — geste opérateur sur le poste de secours

Le référent d'exploitation peut, sans compétence de développement, remettre le
poste de secours à niveau avec les correctifs des deux vagues :

1. **Re-synchroniser le dossier `badgeuse` depuis le Mac** vers le poste
   (`git pull` sur le Mac, puis `scp` du dossier mis à jour vers le
   Raspberry).
2. **Vérifier `agent/` et `ui/`** : si le poste a été touché par la panne
   d'auto-destruction (§2, PR #115) et n'a pas encore été restauré, les
   anciens dossiers survivent sous les noms `agent.ancien` et `ui.ancien` dans
   `/opt/badgeuse` — les remettre en place, ou repartir d'une copie fraîche
   depuis le Mac (ne **pas** redémarrer `badgeuse-agent` avant d'avoir
   restauré).
3. **Relancer l'installation** : `sudo bash ~/badgeuse/deploy/install.sh`,
   **sans** l'option `--target` (le modèle de matériel est désormais reconnu
   automatiquement).
4. **Passer un badge devant le lecteur en surveillant le journal en direct** :
   `journalctl -u badgeuse-agent -f`. La trace **« première frappe reçue de
   eventN »** est désormais le signal qui tranche sans ambiguïté entre « le
   lecteur fonctionne » et « le lecteur ne transmet rien » (câble, alimentation,
   ou mode clavier mal configuré).
5. **Vérifier côté SOLIDATA** que le badgeage remonte bien : écran
   **Temps & Présence → Journal**, encart « Pointages orphelins » (pour un badge
   pas encore attribué) ou ligne du journal du jour (pour un badge déjà connu).

En cas de blocage à l'une de ces étapes, `deploy/diagnostic.sh` (lancé sur le
poste) donne désormais un verdict consolidé — affichage, lecteur de badge et
file de pointages — en une seule commande, sans inspection manuelle.

---

## 9. Table des références

| PR | Titre | Contenu |
|---|---|---|
| #105 | install.sh : 3 correctifs Raspberry Pi OS Trixie (Python 3.13) + accès SSH au poste | Correctif terrain |
| #106 | Le kiosque ne pouvait jamais prendre l'écran (conflit sur tty1) | Correctif terrain |
| #107 | Écran noir : chemin du navigateur codé en dur + diagnostic en une commande | Correctif terrain — création de `diagnostic.sh` |
| #108 | Un poste s'installait sans navigateur : la sonde apt était sensible à la langue | Correctif terrain |
| #109 | Le repli X11 ne pouvait pas démarrer : wrapper setuid absent | Correctif terrain |
| #110 | Diagnostic : « compositeur vivant » ne prouve pas que l'écran affiche | Correctif terrain |
| #111 | Diagnostic : détection des processus par MainPID, et arrêt du kiosque borné à 10 s | Correctif terrain |
| #112 | Diagnostic : le lecteur de badge et la file de pointages n'étaient pas vérifiés | Correctif terrain |
| #113 | Écran noir résiduel : options Chromium incohérentes avec le compositeur | Correctif terrain |
| #114 | install.sh reconnaît la cible matérielle tout seul | Correctif terrain |
| #115 | install.sh s'auto-détruisait quand il était lancé depuis /opt/badgeuse | Correctif terrain |
| #116 | Vague A2-DEBUG : 6 bugs prouvés côté SOLIDATA + reconstruction base neuve réparée (le 7e défaut, P0, a été corrigé par l'orchestrateur à la réconciliation — voir §3) | Débogage systématique — applicatif |
| #117 | Vague A3-DEBUG de l'audit multi-agents : lecteur muet élucidé + 14 défauts du poste corrigés | Débogage systématique — poste embarqué |

**Rapports détaillés des agents** (référence complète des preuves d'exécution,
non versionnés dans le dépôt) :
- Agent A2 (applicatif SOLIDATA) : `rapport-A2-solidata.md`
- Agent A3 (poste embarqué) : `rapport-A3-poste.md`

**Captures d'écran réelles** (produites par les agents lors de l'exécution,
non versionnées dans le dépôt à ce jour — cf. §7 point 5 et §4.3) :
- Côté SOLIDATA (8) : les onglets Journal, Journal — encart Pointages
  orphelins, Anomalies, Feuilles de temps, Badges, Affichage, Supervision et
  Paramètres de l'écran Temps & Présence.
- Côté poste (12) : les 5 écrans de veille (message, annonces, actualités,
  tournées, VAK), les 5 états de badgeage (valide, festif, inconnu,
  illisible, déjà passé), l'état hors ligne et l'état lecteur absent.

**Documentation mise à jour dans le cadre de cette journée** : `RUNBOOK.md`
(sections d'arbre de décision pour les pannes tty1, écran noir, connexion SSH),
`RAPPORT_QA.md` (correction d'une case déclarée testée à tort), `JOURNAL.md`
(entrée du 19 août 2026, voir `docs/badgeuse/JOURNAL.md`).
