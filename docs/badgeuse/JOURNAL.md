# Journal de projet — Badgeuse SOLIDATA (module « Temps & Présence »)

Tenu par l'Agent 0 (chef d'orchestre). Convention : les questions **ouvertes** sont en gras.

## Orchestration réalisée

| Rôle | Réalisation |
|---|---|
| A0 — chef d'orchestre | Session principale (Fable) : cadrage, contrats, ADR, séquencement, réconciliation, ce journal |
| A1 — architecte | Session principale : `MODELE_DONNEES.md`, `CONTRAT_API_DEVICE.md`, `CONTRAT_INTEGRITE.md`, `CONTRAT_HMAC.md` (vecteurs calculés, pas inventés), ADR 0001-0003 |
| A2 — backend SOLIDATA | Agent parallèle (Opus) : init-db, moteur pur, API device, back-office, exports, scheduler, tests Jest |
| A2b — frontend | Agent parallèle (Sonnet) : page Temps & Présence (7 onglets), sidebar, routes |
| A3 — embarqué Raspberry | Agent parallèle (Opus) : `badgeuse/` (agent Python, UI kiosque, scripts d'installation), tests pytest |
| A4 — QA (barrière) | Agent de vérification adversariale après réconciliation |
| A5 — conformité (barrière) | Agent de contrôle RGPD by design, preuves fichier:ligne |
| A6 — déploiement & doc | RUNBOOK, EXPLOITATION, MANUEL_RH après double feu vert |

## Décisions (voir ADR)

- **ADR-0001** : backend implémenté dans la pile réelle de SOLIDATA (Express/pg), pas FastAPI ;
  l'embarqué reste Python. Exigences fonctionnelles inchangées.
- **ADR-0002** : aucune règle de gestion en dur ; défauts seedés = recommandations écrites du RH
  (NOTE_RH §3) ; bandeau « à arbitrer » tant que la Direction n'a pas validé la grille dans l'écran
  Paramètres.
- **ADR-0003** : module neuf `badgeuse_*`, coexistence avec le module « Pointage » legacy (non
  modifié) ; pas d'écriture dans `work_hours` ni `employee_week_hours` en V1 (anti double-compte,
  la paie sort par les exports).

## Questions à la Direction (non bloquantes pour le pilote à blanc, bloquantes pour la production)

1. **Arbitrer la grille des règles de gestion** (écran Temps & Présence → Paramètres) — les 8
   décisions de NOTE_RH §3 sont préremplies aux recommandations RH, à confirmer et « marquer
   comme arbitrées ».
2. **Valider le budget matériel** (525 € TTC recommandé) et commander (BOM SPEC §3).
3. **Lancer la consultation du CSE** (préalable obligatoire — NOTE_JURIDIQUE §2.4) : le logiciel
   peut être montré en réunion, mais **aucune mise en service avant le PV**.
4. **Désigner** le valideur de playlist et le référent d'exploitation (+ suppléant).
5. **Confirmer** l'inscription au registre des traitements (une entrée est seedée dans le module
   RGPD de SOLIDATA — à faire relire par le référent RGPD) et les contrats art. 28.
6. La sonorité/duree overlay et la plage DPMS sont paramétrables — valider en réunion atelier.

## Passe de réconciliation front ↔ back (A0, après livraison des 3 agents parallèles)

Vérification point à point des hypothèses prises par l'agent frontend contre le code backend
réel. Quatre écarts corrigés :

1. **Clé HMAC d'appairage** : `POST /devices` renvoie `hmac_key` ; le front ne testait que
   `hmac_key_site`/`site_hmac_key` → clé jamais affichée à l'appairage. Corrigé
   (SupervisionPostes, chaîne de replis complétée).
2. **Corrections `modification`/`annulation`** : le backend exige `pointage_id` (400 sinon) ;
   la modale n'en portait pas → actions « Corriger »/« Annuler » ajoutées sur chaque ligne du
   journal (modale pré-remplie), champ « N° du pointage d'origine » en repli, l'annulation ne
   demande plus date/heure.
3. **Fuseau des corrections** : le front envoyait une heure murale Paris sans fuseau que
   Postgres aurait interprétée en heure serveur (UTC) → décalage 1-2 h. Le backend interprète
   désormais tout horodatage naïf comme heure murale Paris (`parisDateTimeToUTC`, doctrine
   2.20.0 du dépôt), un horodatage avec fuseau restant pris tel quel.
4. **Liste des sites** : le backend expose `GET /badgeuse/sites` (non prévu au contrat initial) ;
   la modale d'appairage le consomme désormais au lieu de déduire les sites des postes existants.

Divers : `PUT /parametres` marque l'arbitrage à tout enregistrement réussi (le drapeau
`marquer_arbitrees` envoyé par le front est ignoré sans effet — comportement voulu ADR-0002 §3).

## Barrières A4/A5 et boucle de correction n°1

- **A5 Conformité : CONFORME SOUS RÉSERVE** (`RAPPORT_CONFORMITE.md`) — tous les points
  « Obligatoires » de la note juridique prouvés dans le code. 1 écart majeur (E1 : lecture
  MANAGER non cloisonnée par équipe — précédent v2.12.0 du dépôt, **à arbitrer par la
  Direction/référent RGPD avant mise en service**) + 6 réserves (R1-R6) documentées.
- **A4 QA : NO-GO** (`RAPPORT_QA.md`) — 1 bloquant (QA-01), 6 majeurs, 5 mineurs ;
  cohérence crypto inter-piles PROUVÉE par exécution croisée ; 3 suites exécutées vertes.
- **Boucle de correction n°1 (en application de la règle « max 3 itérations »)** :
  - Amendements de spécification actés par A0 : contrat device v1.1 (statut `invalid`
    terminal, `uid_hmac:'-'` valide, heartbeat `alerte`) + ADR-0002 addendum
    (pause monotone, sortie au réel, heures théoriques contractuelles, consommation
    de `pointages_par_jour`/`regularisation_delai_jours`, seuil de silence paramétré).
  - Agent de correction serveur+front : QA-01/02/03/04/05/06/08/10/11.
  - Agent de correction poste : QA-01 (purge `invalid` + compteur + alerte), QA-07
    (politique Chromium DevTools), QA-09 (watchdog matériel RuntimeWatchdogSec),
    QA-12 (casse hmac), + réserve R3 d'A5 (verrouillage `verify_tls`).
  - QA-06 et QA-10 sont des corrections de RÈGLE : consignées dans l'ADR-0002 addendum,
    **à confirmer par la Direction avec le reste de la grille** (écran Paramètres).

## Boucle de correction n°2 et verdict final des barrières

- **Itération 2 (A4)** : les 12 défauts de la boucle 1 prouvés corrigés, mais détection de
  **QA-13 (bloquant)** — le correctif QA-01 accusait `invalid` (terminal, purgé par le poste)
  toute erreur SQL y compris transitoire : un incident d'infrastructure aurait détruit une
  heure. Contrat amendé **v1.2** : statut par élément `retry` NON terminal ; `invalid`
  restreint aux SQLSTATE de données (classes 22/23 hors 23505).
- **Correctifs boucle 2** : serveur — classification par SQLSTATE + **arrêt du lot au premier
  incident transitoire** (préserve la chaîne d'intégrité au rejeu, prouvé par contre-épreuve
  A4 : sans arrêt de lot, le rejeu produit une rupture permanente) + ROLLBACK TO SAVEPOINT
  protégé ; poste — `retry` jamais purgé ni compté, alerte seulement si la file stagne > 1 h.
- **Itération 3 (A4) : ✅ GO SOUS RÉSERVE — barrière logicielle levée.** 13/13 défauts
  corrigés et prouvés, traçabilité 23 OK / 6 PARTIEL / 0 ABSENT, vecteurs de chaîne
  identiques au bit près entre Node et Python sur les 3 itérations. Résidu mineur QA-14
  (alerte générique levée à tort sur un lot entièrement différé) **soldé par l'orchestrateur**
  (fonction pure `lot_entierement_differe`, test dédié — pytest 191/191).
- **Réserves finales A4 (non bloquantes)** : BO-05 « absence non justifiée » en V1.1, AFF-03
  contraste à mesurer en recette, PST-08/AFF-04/AFF-06 sans test automatisé (UI kiosque),
  BO-11 MANAGER non cloisonné par équipe (= E1 d'A5, décision RH/DPO), fuite de handle Jest
  pré-existante masquée par --forceExit.
- **La recette matérielle RP-1→RP-6 (RAPPORT_QA.md) reste le préalable obligatoire à la mise
  en service sur site** — RP-5 (30 badges/60 s, comptage contradictoire papier) est le test le
  plus discriminant car il exerce le chemin `retry`.
- **Chiffres finaux** : Jest 93 suites / 1605 tests (1601 ✓, 4 skipped pré-existants),
  build Vite OK, pytest 191/191.

## Passe de complétion UI (après A6)

En documentant le système réel, A6 a détecté 5 écarts UI. Traitement :

1. **Enrôlement d'un badge** (bloquant opérationnel — l'empreinte n'était visible nulle part) :
   **corrigé** — l'encart « Pointages orphelins » du Journal affiche l'empreinte avec bouton
   copier ; l'aide de « + Attribuer un badge » décrit le flux réel.
2. **Rotation de la clé HMAC de site absente** : **backlog V1.1** (rotation annuelle §7.1 —
   procédure documentée comme manquante dans EXPLOITATION.md, pas de procédure inventée).
3. **Relevé individuel sans bouton** : **corrigé** — bouton « Relevé » sur chaque ligne des
   feuilles de temps (impression A4 charte SOLIDATA, consultation journalisée côté serveur).
4. **Dévalidation de feuille sans bouton** : **corrigé** — bouton « Dévalider » (ADMIN,
   ConfirmDialog, journalisé).
5. **Playlist type « image » sans champ** : **corrigé honnêtement** — champ media_url ajouté
   (form + prévisualisation), avec la limite RÉELLE documentée dans l'aide : la CSP du kiosque
   (validée par les barrières) n'affiche que des images hébergées sur le poste
   (`img-src 'self'`) ; l'ouverture à `https://solidata.online` est une évolution V1.1 à
   arbitrer (elle toucherait la CSP du poste, donc re-passage barrière).

## Passe « poste » après la première mise en service réelle (A3-DEBUG)

Le poste de secours (Pi 3) a été installé sur site alors que pytest était vert à
400/400. Six défauts sont apparus le même jour, dont un lecteur saisi mais muet.
La cause profonde n'est pas dans les six correctifs : **la suite ne testait que des
pièces, jamais la promesse** (« le poste badge et affiche »), et les scripts
d'installation n'étaient testés par rien. Cette passe corrige cela.

**Défaut principal — le lecteur « connecté » et muet.** Un lecteur RFID HID expose
souvent deux `/dev/input/eventN` sous le même nom et les mêmes identifiants USB ;
une seule émet les frappes. `reader.py` n'en retenait qu'une, la première du
répertoire : le badgeage se jouait à pile ou face au branchement. Toutes les
interfaces qualifiées sont désormais saisies et lues simultanément, chacune avec
son tampon. Reproduit avant correctif (UID reçus = `[]`), vert après.

**Trois autres chemins silencieux fermés** : la queue d'un flot anormal repartait
comme un badge ; une interface refusant de s'ouvrir disparaissait sans trace ; un
écran figé bloquait le verrou de badgeage, donc tous les pointages suivants
(prouvé : ancien code bloqué à 3 s, nouveau rendu en 0,5 s).

**install.sh détruisait le poste** quand on le relançait depuis `/opt/badgeuse` —
la commande que le diagnostic recommande. `deployer()` déplaçait la destination
avant de copier la source : même chemin, source perdue, `/opt/badgeuse/agent`
renommé `.ancien`, installation interrompue. Corrigé (garde de même chemin +
copie avant bascule) et testé.

**Deux heures sur le même écran** : la veille affichait l'heure du navigateur
(fuseau système, UTC sur une image neuve) pendant que l'overlay affichait Paris.
L'agent envoie désormais son heure de référence ; `dpms.sh` lit l'heure en
Europe/Paris ; `install.sh` aligne le fuseau du système.

**Niveaux de test ajoutés** (pytest 400 → 454, plus 68 vérifications shell) :
- `test_promesse_poste.py` + `faux_serveur.py` — l'agent RÉEL face à une API device
  conforme au contrat (retry, invalid, 500, 503, ETag, média) ;
- `test_reader.py` + `faux_evdev.py` — la capture réelle face à un lecteur à deux
  interfaces (le module n'avait aucun test) ;
- `test_conformite_poste.py` — CSP, absence de ressource externe, absence de secret,
  aucune trace d'UID : les promesses de confidentialité deviennent des tests ;
- `deploy/tests/test_deploy.sh` (branché sur pytest) — relance depuis `/opt`,
  résolution du navigateur, cohérence compositeur ↔ options Chromium, écriture
  réelle d'une configuration en 0600.

**Instrumentation de terrain** : `python -m badgeuse_agent --lecteurs` (inventaire des
interfaces, aucune frappe lue), trace « premiere frappe recue » par interface, et
section « 4 bis. Lecteur de badge » du diagnostic. C'est ce qui manquait pour
distinguer « le lecteur ne parle pas » de « le poste n'écoute pas la bonne
interface ».

## Écarts assumés à la lettre du dossier de prompts

- OpenAPI YAML remplacé par un contrat Markdown (ADR-0001) — même fonction, pile différente.
- Le rôle « salarié consulte ses propres données » est servi par (a) `GET /api/badgeuse/mes-pointages`
  pour les salariés disposant d'un compte (lien `employees.user_id`), (b) le relevé individuel
  imprimable remis par l'encadrant/RH (journalisé) — conforme à la note d'information salariés
  (« Demandez à votre encadrant, il vous montre »).
- Anomalie « absence non justifiée » (BO-05) : nécessite le planning théorique fiable ; V1 couvre
  oubli de sortie, journée > seuil, hors plage, orphelins. À raccorder au planning hebdo
  (`weekly_schedule`) en V1.1.
- MANAGER (encadrant) non restreint à son équipe en lecture : précédent documenté du dépôt
  (v2.12.0) ; l'anti-autocorrection (NOTE_RH §5.2) est, elle, appliquée strictement.
- Les tests « robustesse physique » d'A4 (20 coupures secteur, ventilateur entravé, 24 h hors
  ligne réelles) ne sont **pas exécutables en environnement de développement** : ils sont
  transcrits en tests logiciels équivalents (crash SQLite simulé, file hors ligne, plafonds) et
  consignés dans le RUNBOOK comme protocole de recette **sur matériel réel** avant mise en service.

## 19 août 2026 — Mise en service du poste de secours et débogage multi-agents (bilan)

La mise en service du poste de secours (Pi 3, `ST-BadgeuseSecours`) a fait apparaître en
production, le jour même, une cascade de **11 correctifs terrain** (PR #105-#115 : trois
incompatibilités Python 3.13/Trixie, conflit tty1 donnant une fausse impression de
redémarrage en boucle, chemin du navigateur codé en dur, sonde apt insensible à la langue
anglaise (« Candidat : » vs « Candidate: ») laissant le poste sans aucun navigateur installé,
wrapper X11 setuid manquant, incohérence compositeur/options Chromium, `install.sh`
s'auto-détruisant quand relancé depuis sa propre installation, création de `diagnostic.sh`),
corrigés au fil de l'eau par l'orchestrateur. Une fois le poste stabilisé, un débogage
systématique en deux vagues (A2 applicatif SOLIDATA PR #116, A3 poste embarqué PR #117) a
corrigé **21 défauts supplémentaires** (4 bloquants/P0, 11 majeurs, 1 moyen, 5 mineurs), avec
pour pièce maîtresse l'**élucidation du lecteur muet** : un lecteur RFID HID expose souvent
deux interfaces `/dev/input/eventN` sous le même nom, une seule transmettant réellement les
badges — le poste n'en écoutait qu'une, tirée au sort à chaque branchement ; toutes les
interfaces qualifiées sont désormais lues simultanément. Côté SOLIDATA, 2 défauts P0 ont été
trouvés en base PostgreSQL réelle (badge perdu impossible à désactiver, reconstruction d'une
base neuve échouant à 0 table). **Tests** : pytest 400→454, jest badgeuse 549→569 (dont une
suite d'exécution réelle sur PostgreSQL, opt-in), harnais de test des scripts shell 0→68,
20 captures d'écran produites par les agents réels (0 avant ce jour). **Rapport complet** :
`rapports/badgeuse-debug-2026-08-19/01-rapport-consolide.md`. **Décisions restant à arbitrer** :
traitement des heures d'un orphelin « hors plage » avant validation RH, capture systématique
de tous les claviers HID branchés au poste (dont un clavier d'administration local), lecture
MANAGER non cloisonnée par équipe (réserve E1 déjà documentée), pastille d'état décorative,
suite PostgreSQL réelle à accrocher à `deploy.sh`/CI, recette matérielle RP-1→RP-6 toujours
obligatoire avant toute mise en service réelle — les préalables CSE / note d'information
salariés / arbitrage de la grille de règles restent, eux, inchangés.

## 19 août 2026 — Écran de veille : la météo affiche enfin, l'actualité devient nationale

Deux demandes de l'exploitant après quelques jours d'usage réel, traitées ensemble parce
qu'elles touchent la même chaîne (générateur serveur → contrat device → moteur de rendu du
poste).

**« L'écran de la météo n'affiche rien ».** Ce n'était ni un problème de réseau ni un
paramétrage manquant : le type `meteo` **n'a jamais eu de générateur**. Il figurait dans la
liste des types depuis la V1, mais comme un simple **texte libre** — le serveur envoyait
`{id, type:'meteo', titre, corps}` et l'interface du poste avait `meteo: null` dans sa table
de moteurs de rendu. Un écran créé sans corps affichait donc son titre, et rien d'autre :
c'est exactement la capture d'écran obtenue en reproduction. `meteo` devient un vrai
générateur (Open-Meteo via `utils/weather.js`, déjà partagé avec Boutiques et VAK), avec un
cache serveur (`badgeuse_meteo`) pour que l'écran tienne hors ligne, et une cascade de lieu
site → réglage → rien. Sans relevé pour le jour courant, l'écran est **omis** — jamais la
météo d'un autre jour. Un écran météo saisi à la main continue de fonctionner.

**« L'actualité doit être nationale, un écran par article ».** Le type `actus` (fil interne
SOLIDATA) est **conservé tel quel** ; un type `presse` est ajouté à côté, alimenté par des
flux RSS **paramétrables** (défaut : franceinfo « à la une »), lus par le SERVEUR sous les
mêmes gardes anti-SSRF que les visuels sociaux, vignettes téléchargées puis servies par
l'API device. Le poste ne joint aucun site de presse.

**Ce qui n'a pas été livré, et pourquoi : le « flux vidéo ».** Rediffuser une vidéo de
presse sur un écran d'entreprise est une représentation qui suppose une licence ; un flux
RSS n'en accorde pas. Le mécanisme est écrit et testé, mais **désactivé par défaut**
(`badgeuse.presse_video_autorisee = false`) : un article dont le seul média est une vidéo
s'affiche quand même, sans la vidéo. **ADR-0006** pose la question à la Direction (licence
d'affichage en entreprise auprès de l'éditeur retenu ; sort des vignettes ; absence de lien
de retour compensée par l'affichage systématique de la source).

**Point de conformité tranché en passant** : le test de minimisation du schéma interdisait
le mot « latitude » dans tout le module. L'interdit réel (NOTE_JURIDIQUE §3.4) est la
géolocalisation **d'un salarié**. L'assertion a été **resserrée table par table** — aucune
coordonnée sur les pointages, badges, postes, corrections, feuilles de temps — plutôt que
contournée ; les coordonnées d'un site (adresse d'établissement) et du cache météo ne
désignent personne. Contre-épreuve exécutée : ajouter une latitude sur `badgeuse_badges`
fait tomber le test.

**Tests** : jest badgeuse 569 → 612 (+43 : lecture de flux RSS et gardes, cascade du lieu,
contrat de playlist, diffusion de la vignette, chaîne complète sur PostgreSQL réel),
pytest poste 454 → 459 (forme de l'écran presse dans le cache média du poste), suite
backend complète 1941 verts. Captures de recette produites depuis l'interface réelle du
poste (avant/après météo, article de presse avec et sans vignette).

**Reste à faire, hors périmètre de ce lot** : le sélecteur de type de l'écran de
paramétrage (`frontend/src/components/badgeuse/badgeuseShared.jsx`) ne propose pas encore
`presse` — les deux nouveaux jobs ne figurent pas non plus au registre de cadence
`JOB_SCHEDULE` (`routes/monitoring.js`). Voir le rapport de lot.

---

## Lot « carte des tournées » — écran de veille `tournees_carte` (21/08/2026)

**Demande** : « écran position de la tournée → une carte avec la position des véhicules ».
Le §5 de l'**ADR-0004** avait écarté toute carte sur le kiosque ; son **addendum du
19/08/2026** révise cette position sans lever les deux motifs d'origine, qui dictent la
forme livrée : position **approchée** (commune, jamais le point GPS) et fond **dessiné
localement** (aucune tuile, la CSP du poste reste `'self'`).

**Position affichée : la commune du DERNIER POINT DE COLLECTE relevé.** C'est le choix
de conception central, et il n'est pas un détail d'implémentation. La piste évidente —
prendre la dernière position GPS du véhicule et la rattacher à une commune — a été
**écartée** : elle aurait fait transiter une position fine de salarié dans le code de
l'écran, où une inattention future aurait suffi à la laisser descendre vers le poste. Le
dernier point collecté est un **événement de travail** (un conteneur vidé), déjà exposé
par l'écran `tournees` sous forme de progression. `gps_positions` n'est donc **pas lue du
tout**, et un test le verrouille : ce qui n'est pas lu ne peut pas fuir.

Conséquence assumée et dite à l'écran : on montre **où la tournée a collecté en dernier**,
pas où le camion roule à la seconde. Une position qui retarde et qui l'annonce vaut mieux
qu'une position exacte qu'on n'a pas le droit d'afficher.

**Écran AJOUTÉ, pas remplacé.** `tournees_carte` vient **à côté** de `tournees` (la liste
des progressions), comme `presse` était venu à côté d'`actus` : ce sont deux écrans, et un
exploitant qui a configuré la liste ne doit pas la voir se transformer en carte. La liste
reste utile là où la carte est impossible — une base sans point de collecte géolocalisé.

**Fond de carte** : communes placées au **barycentre de leurs points de collecte** (CAV et
points d'association), contour = **enveloppe convexe** de ces communes, soit l'emprise
réelle du réseau de collecte — pas une frontière administrative, que nous n'avons pas en
base et que nous n'irons pas chercher chez un tiers. La projection est faite **côté
serveur** (`utils/badgeuse-carte.js`, module PUR) et **détruit la coordonnée** : le poste
reçoit des points déjà exprimés dans un repère abstrait, et un véhicule ne porte qu'une
**référence de secteur**. Contrat d'API device en **v1.6** (§3quinquies).

**Deux défauts trouvés par les tests, pas par la relecture** : une coordonnée `NULL`
devenait l'équateur (`Number(null) === 0`, donc le garde-fou « (0,0) » ne la voyait pas) ;
et l'enveloppe convexe de points alignés renvoyait un polygone d'aire nulle au lieu d'un
segment. Deux défauts trouvés par **PostgreSQL réel**, pas par le mock : la jointure par
nom de commune dupliquait un CAV dès que le référentiel contenait un **homonyme** dans un
autre EPCI (le référentiel couvre plusieurs EPCI depuis 2.20.0) — d'où une sous-requête
scalaire ; et `tours.collection_type` vaut `'pav'`, pas `'cav'`.

**Deux défauts trouvés par le RENDU, pas par les tests** : le cadre `overflow: hidden`
rognait le titre **et la mention « position inconnue »** — l'aveu d'ignorance disparaissait
de l'écran, exactement ce qu'on ne veut pas ; et sur un territoire compact comme
l'agglomération, les étiquettes de deux tournées voisines se chevauchaient, illisibles.
D'où l'espacement vertical global des étiquettes avec amorce vers leur marqueur, et le
dessin en deux passes (marqueurs puis textes).

**Point de conformité tranché en passant** : la garde « aucune ressource externe » du poste
(`test_interface_sans_ressource_externe`) refusait la chaîne `http://www.w3.org/2000/svg`,
que `createElementNS` **exige** pour produire un élément SVG. Un espace de noms XML est un
**identifiant**, jamais une requête sortante. La garde a été **amendée nominativement**
(deux espaces de noms W3C, liste close) plutôt que contournée, et **doublée d'une
contre-épreuve** : une adresse de tuiles OpenStreetMap glissée dans l'interface fait
toujours tomber le test.

**Tests** : jest badgeuse 625 → 659 (+34 : géométrie pure, contrat du générateur, chaîne
complète sur PostgreSQL réel), suite backend complète 2254 → 2290 verte, pytest poste
469 → 470. Migration de la CHECK `badgeuse_contenus.type` **rejouée deux fois** sur une
base réellement déployée : refus reproduit avant, acceptation après, une seule contrainte
au terme des deux passes. Captures de recette produites depuis l'interface réelle du poste
(nominal et deux tournées dans la même commune), typographie mesurée dans le navigateur :
immatriculation 54 px, au-delà du plancher de 48 px du CDC.

**Reste à la charge de la Direction avant mise en service** (ADR-0004, addendum) :
**information du CSE** — un écran d'atelier qui montre l'avancement des tournées reste une
information sur l'activité de salariés identifiables par leur véhicule, même sans position
fine. À joindre au dossier de consultation déjà prévu (NOTE_JURIDIQUE §9).

**Reste à faire, hors périmètre de ce lot** : `presse` ne figure toujours pas au sélecteur
de type de l'écran de paramétrage (dette déjà consignée au lot précédent) ; la recette
matérielle sur le poste réel (lisibilité à 3 m sur le téléviseur, rendu SVG sur Pi 3)
n'a pas pu être exécutée ici.
