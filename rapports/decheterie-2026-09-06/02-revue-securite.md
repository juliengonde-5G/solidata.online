# Revue de sécurité et de conformité RGPD — chantier « bordereau déchèterie » (2.50.0)

**Agent de sécurité — revue EN LECTURE SEULE, 6 septembre 2026.**
Périmètre : `git diff ce4070f..HEAD` (6 commits, 41 fichiers, +5 681 lignes) — lots backend,
mobile et web, plus la documentation de coordination.
Références : `CLAUDE.md` (§5 modules 6 et 14, §7, §8), `00-cahier-des-charges.md`,
`01-contrats-techniques.md`.

Aucun fichier du dépôt n'a été modifié. Les preuves d'exécution ont été produites dans un
répertoire temporaire hors dépôt.

---

## 1. Synthèse

**Verdict : CONFORME SOUS RÉSERVE — deux correctifs BLOQUANTS avant déploiement.**

L'architecture du chantier est saine et, sur la plupart des points instruits, meilleure que ce
que le contrat exigeait :

- le périmètre chauffeur est **réellement** appliqué (prouvé par exécution, §3.1) ;
- **aucune requête SQL du chantier n'est interpolée avec une entrée utilisateur** ;
- les signatures ne quittent jamais une route authentifiée et ne touchent jamais `/uploads` ;
- registre art. 30, journalisation de consultation et de validation, purge de rétention
  (job + bouton manuel) et retrait de la signature à l'anonymisation sont tous branchés ;
- les deux gardes anti-dérive du dépôt sont vertes et couvrent bien les nouveaux codes.

Deux défauts, en revanche, sont **bloquants**, et ils portent tous deux sur le même point
d'entrée : le décodage des signatures PNG déposées par le mobile. Un chauffeur authentifié — ou
quiconque met la main sur le lien « 1 URL = 1 véhicule » posé sur un téléphone — peut, avec une
requête de **77 octets**, **tuer le processus backend** (§C-01, reproduit), ou, avec **74 octets**,
faire consommer **1,6 Go de mémoire et 9,7 s de CPU bloquant** au serveur (§C-02, mesuré).
Ni l'un ni l'autre n'est un cas tordu de laboratoire : ce sont des octets que la borne actuelle
laisse passer parce qu'elle ne contrôle que les **quatre premiers**.

S'y ajoutent deux constats majeurs de nature différente : **aucune information n'est donnée à
l'agent de déchèterie** avant qu'on lui fasse apposer sa signature manuscrite (art. 12-14 RGPD,
§C-03), et **l'aperçu PDF sera muet en production** parce que la CSP de nginx ne couvre pas le
schéma `blob:` pour les cadres (§C-04) — un défaut qu'il faut corriger avec la bonne directive,
pas en élargissant `default-src`.

Aucun de ces quatre points ne remet en cause la conception du chantier ; tous se corrigent sans
changer le contrat.

---

## 2. Tableau des constats

Gravité : **MAJEUR** = à corriger avant déploiement · **mineur** = à corriger dans le lot ·
*note* = observation, pas d'action exigée.

| N° | Gravité | Fichier:ligne | Constat | Correctif |
|---|---|---|---|---|
| C-01 | **MAJEUR (bloquant)** | `backend/src/services/bordereau-decheterie.js:117-136` (`decoderSignature`) ; `backend/src/utils/bordereau-decheterie-pdf.js:123-126` (`estPngValide`), `:362-371` (`placerSignature`) ; `node_modules/png-js/png-node.js:182-186` | **Arrêt du processus backend par PNG malformé.** `decoderSignature` n'inspecte que les 4 octets de signature PNG. pdfkit délègue à png-js, dont `decodePixels` fait `zlib.inflate(data, (err, …) => { if (err) throw err; })` : l'exception est levée **dans un callback zlib**, donc hors du `try/catch` de `placerSignature` **et** hors de la promesse de `genererBordereauPdf`. Le dépôt n'installe aucun `process.on('uncaughtException')` → le processus meurt. **REPRODUIT** : 77 octets (signature + IHDR type 6 + IDAT non-zlib) → `Error: incorrect header check` → `EXIT=1`. Aggravants : (a) la file mobile ne purge que sur 4xx — une connexion coupée est conservée et **rejouée toutes les 5 min** (backoff plafonné, `mobile/src/services/sync.js:54`), donc un téléphone met le backend en boucle de redémarrage ; (b) le **même chemin** est emprunté par `POST /bordereaux/:bid/valider` et par `retirerSignatureChauffeur` — un PNG corrompu accepté une fois rend l'anonymisation RGPD du salarié **impossible**. | Valider la structure du PNG **avant** de le stocker : IHDR présent, dimensions bornées, flux IDAT réellement décompressible (`zlib.inflateSync` sous `try/catch`, avec `maxOutputLength`). Code proposé au §4.1. Refus en `400 SIGNATURE_INVALIDE` (4xx ⇒ la file purge, doctrine du lot). Ajouter un test de contrat avec un PNG corrompu — il n'en existe aucun aujourd'hui. En ceinture : `process.on('uncaughtException')` dans `backend/src/index.js`, qui journalise avant de sortir. |
| C-02 | **MAJEUR (bloquant)** | même point d'entrée ; `backend/src/utils/bordereau-decheterie-pdf.js:365` (`doc.image`) | **Bombe d'allocation par dimensions IHDR forgées.** La largeur et la hauteur sont lues dans le PNG et servent à allouer `width × height × 4` octets dans le callback zlib. **MESURÉ** : entrée de **74 octets**, IHDR 20 000 × 20 000 RGBA, IDAT zlib parfaitement valide → **1 615 Mo de RSS, 9 687 ms de CPU bloquant (Node est mono-thread : toute l'API est figée), PDF de 1 559 369 octets** écrit en BYTEA. À 60 000 × 60 000 : **> 100 s** (arrêt sur délai). Amplification ≈ 21 000× en stockage, non bornée en CPU. Le débit global (1 000 req/15 min/IP, `backend/src/index.js:83`) ne protège de rien : une poignée de requêtes suffit. | Borner `largeur`/`hauteur` lues dans l'IHDR avant tout appel à `doc.image` — le pad rend 600 × 220 (`mobile/src/components/SignaturePad.jsx:37-38`), une borne à 1200 × 600 est déjà large. Inclus dans le code du §4.1. |
| C-03 | **MAJEUR** | `mobile/src/pages/DecheterieBordereau.jsx:344-383` ; `docs/FORMATION_CHAUFFEURS.md` (§ ajouté par `1aacaae`) | **Aucune information préalable à la personne dont on recueille la signature.** L'agent de déchèterie est un **tiers** (salarié de la Métropole, pas de la structure) : on lui fait apposer une signature manuscrite, conservée **3 ans**, versée à un document remis à son propre employeur. L'écran ne dit ni qui traite, ni pourquoi, ni combien de temps, ni quels droits — et le guide de formation chauffeurs non plus (vérifié : aucune occurrence de « RGPD », « conservation » ou « données » dans le passage ajouté). Le registre art. 30 est bien seedé (`init-db.js:8280+`), mais l'art. 30 est une obligation de **documentation** : il ne vaut pas information des personnes au sens des art. 12 à 14. C'est le seul écran du parcours chauffeur qui collecte la donnée personnelle d'un tiers, et c'est le seul qui n'annonce rien. | Encart FALC permanent au-dessus du cadre « 2. Signature de l'agent » (texte proposé au §4.2) ; reprise du même texte dans `docs/FORMATION_CHAUFFEURS.md` pour que le chauffeur sache le dire à l'oral ; faire viser le texte par le DPO. Vérifier aussi que la convention Métropole prévoit ce recueil. |
| C-04 | **MAJEUR** | `deploy/nginx/conf.d/solidata.conf:34` et `:154` ; `frontend/src/components/tours/BordereauxDecheterie.jsx:271-276` | **L'aperçu PDF sera un cadre vide en production.** La CSP servie aux deux vhosts est `default-src 'self'; … ` **sans** directive `frame-src` ni `child-src`, et sans le schéma `blob:`. `frame-src` retombe donc sur `default-src 'self'`, qui ne couvre pas `blob:` : `<iframe src="blob:…">` est bloqué par le navigateur. Le composant invoque comme précédents `PrevisualisationContenu.jsx` (badgeuse) et `RegistrePreuves.jsx` (RSE) — mais ceux-là sont des `<img>`, couverts par `img-src 'self' data: blob:`. **C'est le seul `<iframe>` de tout le frontend** (vérifié par recherche exhaustive) : le précédent invoqué ne couvre pas ce cas. Le bouton « Télécharger », lui, fonctionnera (un `<a download>` n'est pas soumis à la CSP), ce qui rendra le défaut d'autant plus déroutant. | Ajouter aux **deux** blocs serveur, dans la même directive : `frame-src 'self' blob:; object-src 'none';`. Ciblé, ne touche ni `default-src` ni `script-src`. **Ne pas** « réparer » en ajoutant `blob:` à `default-src` : cela l'ouvrirait aussi à `script-src` par héritage. Vérifier ensuite dans un navigateur réel — la console CSP est le seul juge. |
| C-05 | mineur | `backend/src/scripts/init-db.js:8236-8274` ; `backend/src/routes/tours/bordereaux.js:133-147` | **Rien n'impose « un bordereau par passage ».** Le contrat §0 dit « un par passage (tournée × point) », mais l'idempotence repose **uniquement** sur `client_id`. Un chauffeur qui recharge l'écran obtient un nouvel identifiant (`newClientId()`), et le serveur crée un **second document officiel** — autre numéro, autre poids, autres signatures — sur le même passage. Le drapeau `bordereau_deja_depose` n'empêche que le mobile de reproposer l'écran ; il n'est jamais vérifié côté serveur. Deux bordereaux contradictoires peuvent partir à la Métropole. | Index UNIQUE partiel `CREATE UNIQUE INDEX IF NOT EXISTS uq_tdb_passage ON tour_decheterie_bordereaux(tour_id, cav_id) WHERE cav_id IS NOT NULL;` **ou** contrôle explicite renvoyant `409 BORDEREAU_DEJA_DEPOSE` avec le numéro existant. La seconde option est préférable : elle donne au chauffeur un message qu'il comprend. |
| C-06 | mineur | `backend/src/routes/tours/bordereaux.js:133-139` | **Le contrôle d'idempotence n'est pas borné à la tournée** (`WHERE client_id = $1` seul). Conséquences : (a) fuite théorique — un chauffeur qui devinerait un `client_id` obtiendrait `id`, `numero` et `statut` d'un bordereau d'un **autre véhicule**, la garde de périmètre ayant déjà été franchie sur *sa* tournée ; (b) plus gênant, une collision rendrait « déjà enregistré » un dépôt qui n'a rien écrit **pour cette tournée-là**, et la file mobile purgerait un bordereau perdu. Les `client_id` sont des UUID v4 : l'exploitation est hors de portée en pratique, mais le contrôle est **plus large que son objet**. | `WHERE client_id = $1 AND tour_id = $2`. Coût nul, et la réponse « déjà enregistré » redevient exactement ce qu'elle prétend être. |
| C-07 | mineur | `backend/src/services/anonymization.js:418-428` | **La résilience annoncée n'existe pas.** Le commentaire promet « on ne fait pas échouer toute l'anonymisation ». Or `retirerSignatureChauffeur` s'exécute **dans la transaction ouverte** par `routes/rgpd.js` : toute erreur SQL y avorte la transaction entière (`25P02`), et le `catch` qui l'avale ne fait que **déplacer** l'échec sur l'INSERT d'audit qui suit (`rgpd.js:145`), lequel ressort en `500 Erreur serveur` opaque. Le seul cas réellement survivable est l'absence du module ou de la table — déjà traité en amont par le contrôle `information_schema` (`bordereau-decheterie.js:330-336`). Le filet n'attrape donc rien de ce qu'il annonce, et brouille la cause réelle. | Soit retirer le `try/catch` et laisser l'erreur remonter avec son message (l'anonymisation échoue franchement, ce qui est le bon comportement) ; soit encadrer l'appel d'un `SAVEPOINT`/`ROLLBACK TO SAVEPOINT` pour que la promesse du commentaire devienne vraie. Dans les deux cas, corriger le commentaire. |
| C-08 | mineur | `backend/src/routes/rgpd.js:253-500` (`GET /politique`) | **La nouvelle rétention n'apparaît pas dans « Règles de gestion des données ».** L'écran énumère les durées réellement appliquées — candidatures, PCM, réponses PCM, dossiers d'insertion, FSE+, positions GPS — mais pas les bordereaux, **alors que c'est le seul traitement du dépôt portant des signatures manuscrites, dont celle d'un tiers**. L'onglet « Automatisations & purges » la montre (il dérive de `PURGES_RGPD`), donc l'information existe ; mais l'écran dont la raison d'être est de prouver la conformité est incomplet exactement là où l'enjeu est le plus haut. | Ajouter une règle dans la catégorie `conservation`, valeur lue par `readSetting('rgpd.bordereaux_decheterie_retention_jours', BORDEREAUX_DECHETERIE_RETENTION_DEFAUT_JOURS)` avec `source` calculée comme les voisines — jamais une valeur figée. |
| C-09 | mineur | `mobile/src/services/sync.js:687-717` ; `mobile/src/services/db.js:425-452` | **Signatures conservées sans plafond sur le téléphone.** Sur 5xx ou coupure réseau durable, l'élément reste dans `pendingBordereaux` **indéfiniment** : le backoff (max 300 s) espace les tentatives, il n'y a ni TTL ni nombre maximal d'essais. Deux signatures manuscrites peuvent donc dormir des mois dans l'IndexedDB d'un téléphone de chantier. La purge après succès (2xx) et après refus (4xx) est en revanche bien effective (`deleteItem` dans les deux branches) — c'est le seul cas d'échec durable qui n'a pas de sortie. | Purge locale des éléments de plus de N jours (paramètre en code, 7 j semble raisonnable) avec une trace visible dans le bandeau de synchronisation — un bordereau abandonné doit être **dit**, pas effacé en silence. Le compteur de non-envoyés existe déjà (`getPendingCount`), il suffit de l'exploiter. |
| C-10 | mineur | `frontend/src/components/tours/BordereauxDecheterie.jsx:114-121` | `URL.revokeObjectURL(url)` est appelé **immédiatement** après `a.click()`, dans le même tour de boucle. Course connue : certains navigateurs n'ont pas encore commencé le téléchargement quand l'URL est révoquée, et le fichier arrive vide ou pas du tout. L'aperçu, lui, révoque correctement (nettoyage d'effet, `:104-107`). | Révoquer dans un `setTimeout(..., 1000)`, comme le font les autres exports du dépôt qui n'ont pas ce défaut. |
| C-11 | mineur | `backend/src/scripts/init-db.js:8268-8274` | Trois index posés (`tour_id`, `cav_id`, partiel `a_valider`), **aucun sur `driver_employee_id`** — pourtant seule colonne de filtre de `retirerSignatureChauffeur` (`WHERE b.driver_employee_id = $1`), c'est-à-dire du chemin d'anonymisation, qui s'exécute dans une transaction. Volumétrie faible (quelques milliers de lignes à 3 ans), donc sans conséquence aujourd'hui. | `CREATE INDEX IF NOT EXISTS idx_tdb_driver ON tour_decheterie_bordereaux(driver_employee_id) WHERE driver_employee_id IS NOT NULL;` |
| C-12 | *note* | `backend/src/routes/tours/bordereaux.js:74-80, 367` | La journalisation de consultation est **best effort** (`pool.query(...).catch(console.error)`, non attendue) : un PDF peut être servi sans laisser de trace si l'INSERT échoue. C'est le choix de doctrine du dépôt (« un journal indisponible n'empêche pas la lecture d'une pièce qu'on a le droit de lire »), assumé et commenté. À conserver, mais à savoir : la promesse « chaque consultation est journalisée » du cahier des charges §3.6 est vraie **sauf panne du journal**. |
| C-13 | *note* | `backend/src/routes/tours/bordereaux.js:335`, `frontend/src/App.jsx:214, 313` | **MANAGER n'est pas cloisonné par équipe** : tout MANAGER lit les bordereaux et les PDF de toutes les tournées. C'est **conforme au reste du module 6** (`/tours` et `/admin-cav` sont déjà ADMIN/MANAGER, comme le rapport de tournée), et le registre art. 30 le déclare honnêtement (« Direction et responsables d'exploitation (ADMIN/MANAGER) »). Un point à savoir tout de même : masquer un module dans `/admin/permissions` **ne ferme pas l'API** — les routes vivent sous `/api/tours` et `/api/cav`. Aucune action demandée ; à arbitrer avec le client si la signature manuscrite justifie un traitement plus strict que le reste de la collecte. |
| C-14 | *note* | `backend/src/routes/tours/bordereaux.js:217, 226` | `corps.slice(corps.indexOf('bordereau'))` reconstruit le texte de messagerie par recherche d'un mot dans une chaîne qu'on vient de composer. Cela fonctionne, mais un libellé de déchèterie contenant « bordereau » couperait au mauvais endroit. Composer les deux textes séparément coûterait une ligne. Aucune donnée personnelle dans la notification (numéro, tournée, libellé du point, poids — jamais le nom du chauffeur), et le `lien` est bien un chemin interne `/tours?tour=<id>`. |
| C-15 | *note* | `backend/src/services/bordereau-decheterie.js:119` ; `backend/src/index.js:73-76` | La regex de `decoderSignature` s'applique à la chaîne **entière** avant tout contrôle de longueur, et `express.json` accepte 10 Mo. La regex est linéaire (une seule classe de caractères, pas de quantificateur imbriqué) : **pas de ReDoS**. Reste deux copies de chaîne inutiles (`trim`, `replace`) sur une charge potentiellement volumineuse. Un `if (dataUrl.length > BORNE) return { ok:false, motif:'taille' }` en tête réglerait la question pour rien. |
| C-16 | *note* | `backend/src/routes/tours/bordereaux.js:405-441` | Le PDF est régénéré **à l'intérieur** de la transaction de validation : verrou `FOR UPDATE` et connexion du pool tenus pendant le rendu. Sans conséquence sur un document normal (quelques dizaines de ms) ; devient un problème seulement si C-02 n'est pas corrigé (verrou de ligne tenu 100 s). Mentionné pour mémoire, aucune action une fois C-02 traité. |
| C-17 | *note* | `backend/src/routes/tours/bordereaux.js:354-388, 401-457` | `42P01` (base non migrée) est rattrapé là où le contrat le promet — `GET /:id/bordereaux` (`:479`), `GET /cav/:id/bordereaux` (`cav.js`), `GET /cav/:id/historique` (rattrapage **individuel** dans le `Promise.all`, bien vu), `decorerDecheterie` (`tours/index.js:286`), la purge et l'anonymisation. Il ne l'est pas sur `/bordereaux/:bid/pdf` ni sur `/valider` : sur une base non migrée ces routes rendent 500. Sans conséquence pratique (il n'y a alors aucun bordereau à afficher), et le contrat ne l'exigeait pas. |
| C-18 | *note* | `backend/src/routes/tours/bordereaux.js:142` | **Observation de revue.** Pendant la revue, la garde du point (`row.tour_cav_id == null \|\| row.is_decheterie !== true`) est apparue momentanément mutée en `\|\| false` dans l'arbre de travail — c'est-à-dire avec la garde « le point doit être marqué déchèterie » neutralisée. Elle a été restaurée depuis, et l'état commité (`HEAD` = `1aacaae`) est correct, arbre de travail propre. Il s'agit selon toute vraisemblance de la contre-épreuve par mutation de l'agent de debug travaillant en parallèle. Signalé pour qu'il ne subsiste aucun doute au moment de figer le lot : **vérifier cette ligne une dernière fois avant le déploiement**. |

---

## 3. Instruction détaillée des points demandés

### 3.1 Périmètre chauffeur — **conforme, prouvé par exécution**

Le chemin `POST /api/tours/:id/cav/:cavId/bordereau-decheterie-public` est bien couvert :

- **`MOBILE_DRIVER_PATH`** (`routes/tours/index.js:120`) vaut
  `/(-public(\/|$))|(^\/[^/]+\/public$)|(^\/vehicle\/[^/]+\/today$)/`. Le chemin se termine par
  `-public`, la première alternative (`-public$`) le capture. Le middleware qui l'applique
  (`:204-210`) est enregistré **avant** le montage de `routerChauffeur` (`:1894-1895`), donc il
  s'exécute d'abord, sous-routeurs compris.
- **`enforceDriverVehicleScope`** (`:154-203`) tombe sur la dernière branche
  (`/^\/(\d+)(\/|$)/`), lit `tours.vehicle_id` et refuse en 403 si la tournée n'est pas celle du
  jeton. La garde n'est **pas recopiée** dans `bordereaux.js` — bon choix : deux définitions du
  périmètre finissent toujours par diverger.

**Vérifié par exécution** (sonde jouée hors dépôt, vrais routeurs Express, jetons JWT réels) :

| Requête, avec un jeton chauffeur `driver_5` (`vehicle_id: 5`) | Réponse |
|---|---|
| `POST /api/tours/90/cav/7/bordereau-decheterie-public`, tournée 90 du véhicule **9** | **403** |
| `GET /api/tours/bordereaux/12/pdf` | **403** |
| `POST /api/tours/bordereaux/12/valider` | **403** |
| `GET /api/tours/90/bordereaux` | **403** |
| `GET /api/tours/bordereaux/referentiel-decheteries` | **403** |

**Un chauffeur du véhicule A ne peut pas déposer sur une tournée du véhicule B**, et **aucune
route back-office n'est atteignable avec un jeton chauffeur.**

`authorize` (`middleware/auth.js:227-238`) compare `req.user.role` **et** `resolveBaseRole(role)`
à la liste. Le jeton chauffeur porte `role: 'COLLABORATEUR'` **en dur** (`routes/auth.js:358`) —
y compris quand le véhicule est affecté à un salarié dont le compte serait ADMIN : la
substitution est faite à l'émission, pas héritée. Les rôles personnalisés se résolvent vers leur
rôle de base, donc un rôle dupliqué de MANAGER accède aux bordereaux (comportement voulu et
identique au reste du module) et un rôle dupliqué de COLLABORATEUR est refusé.

Le placement de `authorize` **route par route** plutôt qu'en `routerBackOffice.use()` est
correct et le commentaire (`bordereaux.js:325-334`) en donne la vraie raison : un middleware de
routeur monté en `router.use('/', …)` se serait exécuté pour **toutes** les requêtes traversant
le routeur des tournées, y compris celles destinées aux routeurs montés après — un QHSE lisant
une tournée aurait pris un 403. Le piège aurait été silencieux.

### 3.2 Entrées non fiables — **deux défauts bloquants, le reste conforme**

| Entrée | État |
|---|---|
| `client_id` | Chaîne non vide ≤ 64 caractères (`validerClientId`), aligné sur `VARCHAR(64)`, paramétré. Jamais réémis vers le client. **Conforme** (voir C-06 sur la portée du contrôle). |
| `poids_indicatif_kg` | `Number.isFinite`, `0 ≤ n ≤ 60 000`, arrondi à la décimale de `NUMERIC(8,1)` ; zéro reste une valeur, jamais une absence. Doublé par le `CHECK` de la colonne. **Conforme.** |
| `agent_absent_motif` | Liste **fermée** `['agent_indisponible']` gelée par `Object.freeze`. `anonymisation` en est volontairement exclu (c'est un motif posé par le serveur sur l'autre signature). **Conforme.** |
| Identifiants `:id` / `:cavId` | `parseInt` + `Number.isInteger`, refus 400 avant toute requête. **Conforme.** |
| Taille du corps JSON | `express.json({ limit: '10mb' })` (`index.js:74`). Deux signatures de 200 Ko décodés ≈ 534 Ko de base64 : **la limite est largement suffisante**, aucun ajustement nécessaire. |
| Signatures PNG — **borne de taille** | La borne est bien posée **avant** le décodage base64 (`bordereau-decheterie.js:124`), puis re-contrôlée exactement après (`:133`). Calcul juste : 204 800 octets ⇒ 273 068 caractères, seuil à 273 076. **Conforme, et bien fait.** |
| Signatures PNG — **contenu** | **NON CONFORME** — voir C-01 et C-02. Le seul contrôle est `estPngValide` : `length > 8` et les 4 octets `\x89PNG`. Ni les dimensions, ni la décompressibilité du flux ne sont vérifiées. |

**pdfkit ne « lève » pas proprement.** C'est le point qu'il faut avoir en tête : le `try/catch`
de `placerSignature` (`bordereau-decheterie-pdf.js:364-367`) et le `catch` de
`genererBordereauPdf` (`:200-202`) **ne peuvent pas** attraper l'erreur, parce qu'elle est levée
dans un callback `zlib.inflate` asynchrone. La protection ne peut donc venir que d'une
validation **en amont**.

Preuves d'exécution (Node 22.22.2, pdfkit 0.15.2, png-js du dépôt) :

```
# C-01 — PNG de 77 octets, IHDR type couleur 6, IDAT = « CE N EST PAS DU ZLIB »
decoderSignature -> {"ok":true}                 ← accepté par la borne actuelle
/home/user/solidata.online/backend/node_modules/png-js/png-node.js:185
        throw err;
Error: incorrect header check   errno: -3   code: 'Z_DATA_ERROR'
EXIT=1                                          ← le processus est mort

# C-02 — PNG de 74 octets, IDAT zlib VALIDE, IHDR forgé
entrée 74 o | 2000x2000   | PDF     19 787 o |    175 ms | RSS   99 Mo
entrée 74 o | 20000x20000 | PDF  1 559 369 o |  9 687 ms | RSS 1 615 Mo
entrée 74 o | 60000x60000 | (arrêté sur délai à 100 s)
```

### 3.3 Injection SQL — **conforme, aucun défaut**

Toutes les requêtes du chantier sont paramétrées. Les seuls fragments interpolés sont des
**constantes de module**, jamais des entrées :

- `COLONNES_RESUME`, `COLONNES_RESUME_NUES`, `COLONNES_COMPLETES` — listes de colonnes figées
  (`bordereau-decheterie.js:241-272`). Le choix de maintenir deux formes (préfixée `b.` et nue)
  plutôt qu'une substitution textuelle est le bon, et la raison donnée en commentaire est juste.
- `SQL_TODAY_PARIS` = `"(CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Paris')::date"`
  (`driver-session.js:96`) — littéral SQL sans variable.
- `make_interval(months => $2)` (`cav.js`, historique) — paramétré.
- Rétention de la purge : `"… NOW() - ($1 || ' days')::interval"` avec `String(retentionJours)`,
  la valeur venant de `readSetting` qui **ne rend qu'un entier > 0 ou le défaut du code**
  (`rgpd-purges.js:79-88`). Paramétré **et** typé.
- **Seed** (`init-db.js:8638-8724`) : le référentiel JSON est lu, puis chaque valeur passe en
  `$1/$2/$3`. Contrôlé : 15 entrées, `pavid` ≤ 8 caractères (colonne 20), `code_bordereau` ≤ 24
  (colonne 40), **aucun code hors des 7 cases**, aucun `id_solidata` en double, aucune donnée
  personnelle dans le fichier. La garde par commune normalisée avant marquage par identifiant est
  une bonne précaution : un identifiant de production ne désigne pas le même point sur une autre
  base, et marquer un conteneur de rue comme déchèterie ferait réclamer au chauffeur deux
  signatures impossibles à obtenir.

Recherche systématique des interpolations `${…}` dans du SQL ajouté par le chantier : **aucune
occurrence portant une entrée utilisateur**.

### 3.4 Données personnelles

**Ce qui est conforme :**

- **Stockage.** Signatures et PDF en `BYTEA`, jamais sous `/uploads` — le dossier est servi
  statiquement (`index.js:99+`), une signature y serait accessible par URL. La doctrine est
  écrite à trois endroits du chantier et effectivement respectée : aucun `multer`, aucun
  `fs.write` dans les fichiers du lot.
- **Exposition.** Aucun BYTEA dans les listes : `COLONNES_RESUME` ne rend que des booléens
  `signature_*_presente`. Vérifié sur les trois surfaces (`/tours/:id/bordereaux`,
  `/cav/:id/bordereaux`, `/cav/:id/historique`). Le PDF n'est servi que par sa route dédiée,
  ADMIN/MANAGER, jamais en accès anonyme.
- **En-têtes du PDF** : `application/pdf`, `Content-Disposition: inline` avec un nom de fichier
  **construit à partir du numéro serveur** (`BD-AAAA-NNNN`, jamais une entrée utilisateur — pas
  d'injection d'en-tête possible), `X-Content-Type-Options: nosniff`, `Cache-Control: no-store`.
  **Conforme au contrat.**
- **Journalisation.** `BORDEREAU_DECHETERIE_CONSULTE` à chaque ouverture du PDF et
  `BORDEREAU_DECHETERIE_VALIDE` à la validation, dans `rgpd_audit_log`, doublés du journal
  d'activité (`view` / `create`). Réserve C-12 sur le caractère best effort.
- **Registre art. 30** seedé de façon idempotente (`WHERE NOT EXISTS`), avec une rédaction
  honnête : la qualité de **tiers** de l'agent y est nommée, la base légale (art. 6-1-b,
  convention Métropole) est cohérente, les destinataires et les mesures de sécurité correspondent
  à ce que le code fait réellement.
- **Purge** `purgeBordereauxDecheterie` intégrée au registre `PURGES_RGPD` — donc **une seule
  implémentation** pour le job planifié et le bouton manuel —, branchée au scheduler
  (`scheduler.js:2049`) et déclarée dans `JOB_SCHEDULE` (`monitoring.js:147`), donc un arrêt du
  job se verra. Délai compté depuis `created_at` (le passage du camion) et non depuis la
  validation : le raisonnement donné en commentaire est juste — une formalité interne ne prolonge
  pas la durée de vie de la signature d'un tiers. Journalisation **même à zéro ligne supprimée**
  pour le déclenchement manuel, conforme à la doctrine 2.44.0.
- **Anonymisation** : `signature_chauffeur = NULL`, motif `anonymisation`,
  `driver_employee_id = NULL`, **PDF régénéré** — et si la régénération échoue, l'effacement est
  quand même appliqué (`bordereau-decheterie.js:357-382`). L'ordre de priorité est le bon.
  La signature de l'**agent** est conservée : arbitrage explicite et défendable (le droit à
  l'effacement du salarié ne s'exerce pas sur la donnée d'un tiers dans une pièce contractuelle).
- **Libellés français** des 4 nouveaux codes RGPD et de l'entité `bordereau_decheterie` du
  journal d'activité : présents, et les deux gardes anti-dérive sont **vertes**
  (`npx jest tests/unit/rgpd-audit-libelles.test.js tests/unit/activity-log-libelles.test.js`
  → **2 suites, 6 tests, 0 échec**).
- **Journaux applicatifs** : aucun `console.*` du chantier n'écrit le contenu d'une signature —
  vérifié sur les trois fichiers backend et sur le mobile (`sync.js` ne loge que le statut HTTP
  et le code d'erreur ; `DecheterieBordereau.jsx` ne loge qu'un message d'exception).
- **IndexedDB** : purge effective après envoi (`deleteItem` après `sendBordereau`, dans l'écran
  **et** dans `syncPendingBordereaux`) et après refus 4xx. `localStorage` ne reçoit que
  `selected_cav_id` / `selected_cav_name` — jamais une signature. **Réserve C-09** sur l'échec
  durable.
- **Pad de signature** : résolution interne figée à 600 × 220 avec `devicePixelRatio`
  **volontairement ignoré** — décision juste, et bien expliquée : suivre la densité d'écran
  quadruplerait le poids du PNG et le ferait buter sur la borne serveur au pire moment, quand
  l'agent est déjà reparti.

**Ce qui ne l'est pas :** l'**information préalable** (C-03) et, indirectement, la présence du
traitement dans l'écran « Règles de gestion des données » (C-08).

### 3.5 Notifications — **conforme**

Texte poussé : `« Tournée #<id> — <libellé de la déchèterie> : bordereau BD-AAAA-NNNN à valider
(<poids> kg indicatifs) »`. Aucune donnée personnelle : ni nom de chauffeur, ni nom d'agent, ni
signature. Destinataires `['ADMIN','MANAGER']` sur les deux canaux (push et messagerie système),
identiques aux droits de la route de consultation — le bot de notification ne donne pas plus que
l'écran. Le `lien` est bien un chemin **interne** `/tours?tour=<id>`, lu côté web par
`useSearchParams` pour ouvrir la fiche. Les trois écritures (push, messagerie, journal
d'activité) sont posées **après** `res.status(201).json(...)` et aucune n'est attendue : le
chauffeur n'attend jamais un canal de notification. Réserve cosmétique C-14.

### 3.6 Mode démo — **conforme**

`isDemoTour(row)` (`services/demo-mode.js:41-45`) lit **`row.is_demo`**, et le `SELECT` de
contexte sélectionne bien `t.is_demo` (`bordereaux.js:106`). Le contrôle est placé en **premier**,
avant la validation du `client_id`, avant toute écriture et avant toute notification
(`:121-123`) : sur une tournée de démonstration, la réponse est `200 { demo: true }`, rien n'est
inséré, personne n'est réveillé. Le mobile purge sa file sur ce 2xx. Le stagiaire va au bout de
son parcours et voit sa confirmation. **Conforme au contrat §2.1 point 1 et à la doctrine 2.27.0.**

### 3.7 Autorisation de validation — voir C-13

ADMIN/MANAGER conformément à l'arbitrage Q4. Le MANAGER accède de fait aux PDF de **toutes** les
tournées, hors de son équipe. **Ce n'est pas une régression** : `/tours` et `/admin-cav` sont déjà
ADMIN/MANAGER (`App.jsx:214, 313`), et l'API des rapports de tournée l'est également — le module
Collecte n'a jamais été cloisonné par équipe. Le registre art. 30 le déclare. Différence à
signaler tout de même au client : la pièce en cause porte deux signatures manuscrites, ce qui est
plus sensible qu'un compte rendu de tournée. Décision à lui, pas au code.

### 3.8 Robustesse

- **Régénération du PDF à la validation** : `BEGIN` → `SELECT … FOR UPDATE OF b` → génération →
  `UPDATE` → `COMMIT`. Un échec de génération déclenche `ROLLBACK` puis 500 ; le statut reste
  `a_valider` et le PDF précédent est intact — **état cohérent**. La double validation est bien
  refusée en 409 sous verrou de ligne (pas de course possible entre deux gestionnaires).
  Réserve C-16 (durée de tenue du verrou) et rappel : si le PNG stocké est corrompu, C-01
  s'applique ici aussi et le processus meurt au lieu de rendre 500.
- **Taille du BYTEA `pdf`** : ~15-20 Ko en usage normal, non borné en base. Voir C-02 pour le cas
  forgé (1,5 Mo mesuré pour 74 octets d'entrée).
- **Index** : trois présents, un manquant (C-11). `numero UNIQUE` sert bien le
  `WHERE numero LIKE 'BD-2026-%' ORDER BY numero DESC LIMIT 1` de la numérotation, et le
  zéro-padding à 4 chiffres est ce qui rend l'ordre lexicographique équivalent à l'ordre
  numérique — ce n'est pas cosmétique, et c'est testé.
- **Numérotation concurrente** : le numéro est calculé dans la transaction, la contrainte
  d'unicité arbitre, une seule reprise puis l'erreur remonte. Un `23505` portant sur `client_id`
  est correctement distingué d'une course de numérotation et rend le bordereau existant.
  **Bien conçu.**
- **Base non migrée** : `42P01` rattrapé partout où le contrat le promet ; voir C-17 pour les
  deux routes non couvertes, sans conséquence.

### 3.9 Gardes anti-dérive du dépôt — **vertes**

```
npx jest tests/unit/rgpd-audit-libelles.test.js tests/unit/activity-log-libelles.test.js
→ Test Suites: 2 passed, 2 total | Tests: 6 passed, 6 total
```

Les quatre codes RGPD (`BORDEREAU_DECHETERIE_CONSULTE`, `BORDEREAU_DECHETERIE_VALIDE`,
`AUTO_PURGE_BORDEREAUX_DECHETERIE`, `PURGE_BORDEREAUX_DECHETERIE`), l'entité
`tour_decheterie_bordereaux` (journal RGPD), l'entité `bordereau_decheterie` et l'action `view`
(journal d'activité) sont tous présents dans leurs dictionnaires.

Les suites du chantier passent également : `bordereau-decheterie-contract`,
`bordereau-decheterie-service`, `bordereau-decheterie-pdf` → **3 suites, 79 tests, 0 échec**.
**Trou de couverture identifié** : aucun test n'exerce un PNG **structurellement invalide** (bons
octets magiques, contenu corrompu) — c'est exactement l'angle mort de C-01/C-02.

---

## 4. Correctifs proposés, en détail

### 4.1 C-01 et C-02 — validation réelle du PNG (`services/bordereau-decheterie.js`)

À insérer avant `decoderSignature`, et à appeler à la place de `estPngValide` à la ligne 134 :

```js
const zlib = require('zlib');

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// Le pad rend 600 × 220 (mobile/src/components/SignaturePad.jsx). La borne est
// large à dessein : elle n'existe pas pour discipliner le mobile, mais pour que
// des dimensions FORGÉES ne fassent pas allouer width × height × 4 octets.
const SIGNATURE_MAX_LARGEUR = 1200;
const SIGNATURE_MAX_HAUTEUR = 600;
const PIXELS_MAX_DECOMPRESSES = 8 * 1024 * 1024;

/**
 * Le PNG est-il RÉELLEMENT exploitable par pdfkit ?
 *
 * `estPngValide` ne regarde que les 4 premiers octets. Ça ne suffit pas : pdfkit
 * délègue à png-js, dont `decodePixels` fait `zlib.inflate(data, (err) => { if
 * (err) throw err; })`. Cette exception est levée DANS un callback zlib — hors de
 * toute promesse et de tout try/catch — et il n'existe aucun gestionnaire
 * `uncaughtException` : le processus MEURT. 77 octets suffisent (revue de
 * sécurité 06/09/2026, C-01). Les dimensions, elles, pilotent une allocation :
 * 74 octets annonçant 20000 × 20000 ont fait monter le serveur à 1,6 Go de RSS
 * et bloquer 9,7 s de CPU (C-02).
 *
 * On refuse donc AVANT de stocker, jamais après : le document sera régénéré à la
 * validation et à l'anonymisation, sur les octets qu'on aura acceptés ici.
 */
function pngExploitable(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 33) return false;
  if (!buf.subarray(0, 8).equals(PNG_SIGNATURE)) return false;
  // IHDR est obligatoirement le premier chunk (spec PNG §11.2.2).
  if (buf.readUInt32BE(8) !== 13 || buf.toString('ascii', 12, 16) !== 'IHDR') return false;

  const largeur = buf.readUInt32BE(16);
  const hauteur = buf.readUInt32BE(20);
  if (largeur < 1 || hauteur < 1) return false;
  if (largeur > SIGNATURE_MAX_LARGEUR || hauteur > SIGNATURE_MAX_HAUTEUR) return false;

  // Les IDAT doivent former un flux zlib réellement décompressible.
  const morceaux = [];
  let p = 8;
  while (p + 12 <= buf.length) {
    const taille = buf.readUInt32BE(p);
    if (taille > buf.length) return false;
    const type = buf.toString('ascii', p + 4, p + 8);
    if (type === 'IDAT') morceaux.push(buf.subarray(p + 8, p + 8 + taille));
    if (type === 'IEND') break;
    p += 12 + taille;
  }
  if (morceaux.length === 0) return false;
  try {
    zlib.inflateSync(Buffer.concat(morceaux), { maxOutputLength: PIXELS_MAX_DECOMPRESSES });
  } catch (_) {
    return false;                       // flux illisible OU bombe de décompression
  }
  return true;
}
```

Puis, dans `decoderSignature`, remplacer `if (!estPngValide(buf))` par
`if (!pngExploitable(buf))`.

**Tests à ajouter** (unitaires sur le service, et un cas de contrat sur la route) :
1. PNG aux bons octets magiques mais IDAT non-zlib → `400 SIGNATURE_INVALIDE` **et le processus
   survit** ;
2. PNG à IHDR 20 000 × 20 000 → `400 SIGNATURE_INVALIDE` ;
3. contre-épreuve : retirer `pngExploitable` fait tomber les deux.

**Ceinture, en complément et non en remplacement** — dans `backend/src/index.js` :

```js
process.on('uncaughtException', (err) => {
  logger.error('Exception non rattrapée — arrêt', { message: err.message, stack: err.stack });
  process.exit(1);   // on sort volontairement : l'état du processus n'est plus sûr
});
```

Cela ne répare rien (le processus meurt toujours), mais **la cause apparaîtra dans les journaux**
au lieu d'un redémarrage muet du conteneur. À décider avec l'équipe : c'est un changement
transverse au dépôt, hors périmètre de ce chantier.

### 4.2 C-03 — mention d'information (texte proposé, FALC)

À placer dans `mobile/src/pages/DecheterieBordereau.jsx`, **avant** le pad de l'agent
(§ « 2. Signature de l'agent »), dans un encart permanent — pas une info-bulle, pas un lien :

> **Avant de faire signer**
> Dites-le à l'agent : sa signature est enregistrée par Solidarité Textiles pour établir le
> bordereau demandé par la Métropole Rouen Normandie. Elle ne sert à rien d'autre. Elle est
> conservée **3 ans**, puis effacée automatiquement. L'agent peut demander à la voir ou à la
> faire effacer en écrivant à `<adresse de contact du DPO>`.
> S'il refuse, appuyez sur « L'agent n'est pas disponible » : le bordereau reste valable.

Trois raisons de ne pas se contenter d'un lien : l'écran est utilisé sous la pluie sur un quai,
l'agent ne tient pas le téléphone, et le refus doit rester une option visible au même endroit —
il l'est déjà (`agent_indisponible`), il suffit de le rattacher explicitement à l'information.

Le même paragraphe est à reprendre dans `docs/FORMATION_CHAUFFEURS.md` : c'est le chauffeur qui
porte l'information à l'oral, il faut qu'il ait la phrase. Faire viser le texte par le DPO et
vérifier que la convention avec la Métropole couvre ce recueil.

### 4.3 C-04 — CSP (`deploy/nginx/conf.d/solidata.conf`, lignes 34 et 154)

Ajouter, dans la même directive, sur **les deux** blocs serveur :

```
frame-src 'self' blob:; object-src 'none';
```

`object-src 'none'` est ajouté en même temps parce qu'il n'est **pas** couvert par
`default-src` de façon utile ici et qu'il ferme `<object>`/`<embed>` — c'est un durcissement
gratuit pendant qu'on touche la ligne. Vérifier après déploiement, dans un navigateur, que la
console ne rapporte plus de violation et que le bouton « Voir » affiche le document.

---

## 5. Points positifs vérifiés

Ils sont nombreux et méritent d'être écrits, parce qu'ils réduisent la surface de ce chantier
plutôt qu'ils ne l'augmentent :

1. **Le périmètre chauffeur n'est pas recopié.** Le routeur chauffeur hérite de la garde
   existante au lieu d'en réécrire une. C'est la bonne décision, et elle est prouvée par
   exécution (§3.1).
2. **`authorize` posé route par route** et non par `routerBackOffice.use()` : évite un 403
   silencieux sur tout le module Collecte pour les rôles montés après. Le piège est identifié et
   commenté dans le code.
3. **Aucune interpolation SQL avec une entrée utilisateur** dans les 5 681 lignes du chantier.
4. **Doctrine de stockage tenue** : rien sous `/uploads`, tout en BYTEA, aucun blob dans une
   liste — et deux jeux de colonnes maintenus explicitement plutôt qu'une substitution textuelle
   fragile.
5. **Snapshots** (`decheterie_code`, `decheterie_libelle`, `cav_nom`) doublant des FK en
   `ON DELETE SET NULL` : le document reste lisible quand le point disparaît du référentiel.
   C'est ce qu'exige une pièce remise à un tiers.
6. **Une seule fonction régénère le PDF** (`genererPdfDepuisLigne`), partagée par la création, la
   validation et l'anonymisation. Trois copies auraient produit trois documents divergents.
7. **Mode démo contrôlé en premier**, avant toute écriture et toute notification.
8. **Idempotence conçue, pas espérée** : `client_id` unique, `23505` sur `client_id` distingué
   d'une course de numérotation, reprise unique puis échec franc.
9. **Purge dans le registre partagé `PURGES_RGPD`** : une seule implémentation pour le job et
   pour le bouton manuel, déclarée dans `JOB_SCHEDULE`, tracée même à zéro ligne supprimée.
10. **Anonymisation qui fait passer l'effacement avant le document** : si le PDF ne se régénère
    pas, la signature est retirée quand même.
11. **Seed à verrou avec garde par commune** : un identifiant de production ne marque un CAV que
    si sa commune correspond ; en cas d'ambiguïté, **rien n'est marqué et c'est dit au journal**.
    Le verrou n'est posé que si au moins un point a été marqué.
12. **Le poids indicatif ne rejoint aucun chiffre** — vérifié dans le code et verrouillé par un
    test qui porte sur les requêtes réellement émises, pas sur une intention.
13. **`devicePixelRatio` ignoré** dans le pad : le PNG reste sous la borne serveur, donc la
    signature arrive au lieu d'être refusée quand l'agent est déjà reparti.
14. **Les deux gardes anti-dérive du dépôt sont vertes** et couvrent les nouveaux codes ; les
    trois suites du chantier passent (79 tests).
15. **Aucun `console.*` n'écrit le contenu d'une signature**, ni côté serveur ni côté mobile.
16. **Le registre art. 30 nomme la qualité de tiers de l'agent** — c'est précisément ce qui rend
    le manquement C-03 visible plutôt que caché.

---

## 6. Ce qu'il faut faire avant de déployer

| Ordre | Action | Constat |
|---|---|---|
| 1 | Valider réellement les PNG de signature (dimensions + flux IDAT décompressible) + tests + contre-épreuve | C-01, C-02 |
| 2 | Ajouter `frame-src 'self' blob:` aux deux blocs nginx et vérifier l'aperçu dans un navigateur | C-04 |
| 3 | Écrire la mention d'information sur l'écran mobile et dans le guide chauffeurs ; faire viser par le DPO | C-03 |
| 4 | Borner le bordereau à un par passage (index unique ou 409) et borner l'idempotence à la tournée | C-05, C-06 |
| 5 | Corriger le filet d'anonymisation (SAVEPOINT ou remontée franche) et son commentaire | C-07 |
| 6 | Déclarer la rétention dans `GET /rgpd/politique` | C-08 |
| 7 | TTL local des bordereaux non envoyés ; révocation différée de l'objectURL ; index `driver_employee_id` | C-09, C-10, C-11 |
| 8 | **Relire une dernière fois `bordereaux.js:142`** avant de figer le lot | C-18 |

---

## Suite donnée par le coordinateur (06/09/2026, après la revue)

| N° | Décision | Correctif appliqué |
|---|---|---|
| C-01, C-02 | **Corrigés** | Nouveau module PUR `backend/src/utils/png-signature.js` (`analyserPng`) : signature, IHDR en premier chunk, dimensions bornées (≤ 2000 par côté, ≤ 720 000 pixels), profondeur/type de couleur/méthodes connus, non entrelacé, CRC32 de chaque chunk (implémenté ici — `zlib.crc32` n'existe qu'en Node ≥ 22.2, l'image de production est en Node 20), IEND terminal, IDAT décompressé sous `maxOutputLength` à la taille EXACTE attendue. Appelé par `decoderSignature` (refus 400 `SIGNATURE_INVALIDE`, motif `dimensions` / `idat` / `crc` / `format`) ET par `placerSignature` du générateur PDF (double garde : un PNG stocké douteux ne touche jamais pdfkit). 14 tests unitaires avec PNG forgés (IHDR 20 000 × 20 000 → refusé en < 1 s, IDAT corrompu → le processus survit). |
| C-03 | **Corrigé** | Encart FALC « À montrer à l'agent avant qu'il signe » sur l'écran mobile (finalité, durée 3 ans, effacement, contact). |
| C-04 | **Corrigé** | `frame-src 'self' blob:; object-src 'none';` ajoutés aux deux CSP de `deploy/nginx/conf.d/solidata.conf` (jamais `blob:` dans `default-src`). |
| C-05 | **Corrigé** | Un bordereau par passage : un second dépôt sur la même tournée × point rend l'existant (`deja_enregistre`), jamais un second document signé. |
| C-06 | **Corrigé** | Contrôle d'idempotence borné à la tournée (`client_id AND tour_id`). |
| C-07 | **Corrigé** | `SAVEPOINT` autour du retrait de signature dans `anonymizeEmployee` : un échec ne peut plus avorter la transaction d'anonymisation. |
| C-08 | **Corrigé** | Règle « Bordereaux de collecte en déchèterie » ajoutée à `GET /rgpd/politique` (valeur lue en direct) ; compteur « 9 purges ». |
| C-09 | **Assumé** | Pas de TTL sur `pendingBordereaux` : une signature d'agent n'est pas re-recueillable, la perdre serait irréparable ; l'élément est supprimé au premier 2xx/4xx. Documenté dans le code mobile. |
| C-10 | **Corrigé** | `revokeObjectURL` différé de 10 s après le clic de téléchargement. |
| C-11 | **Corrigé** | Index `idx_tdb_driver` sur `driver_employee_id`. |
| C-12, C-13, C-15 à C-18 | **Notes** | Conformes à la doctrine du dépôt ; C-14 corrigé au passage (textes de notification composés séparément). |
