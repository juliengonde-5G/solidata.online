# RAPPORT DE CONFORMITÉ — Module 33 « Temps & Présence » (badgeuse)

**Émetteur :** Agent A5 — Conformité, protection des données dès la conception (seconde barrière bloquante)
**Objet :** Vérification point par point, **dans le code**, du respect de `docs/badgeuse/NOTE_JURIDIQUE_RGPD.md` et de `docs/badgeuse/SPEC_TECHNIQUE.md` §7.3
**Périmètre audité :** commits `b233f6b`, `064e846`, `b726f08` (branche `claude/multi-agents-multi-models-wfgyts`)
**Date :** 15 août 2026

---

## 0. Méthode et valeur de ce rapport

Chaque case de la grille est cochée **uniquement** sur preuve : un chemin de fichier avec numéro de ligne, ou un test automatisé **réellement exécuté** dans le cadre de cet audit. Aucune case n'est cochée sur la foi d'une documentation, d'un commentaire de code ou d'un nom de fichier.

Les commentaires de code affirmant une propriété (« aucun UID en clair », « purge automatisée ») ont été traités comme des **allégations à vérifier**, jamais comme des preuves. Dans chaque cas la vérification a porté sur l'instruction exécutable correspondante.

### 0.1 Tests exécutés pour ce rapport

| Commande | Résultat |
|---|---|
| `npx jest tests/unit/services/badgeuse-scheduler.test.js tests/unit/scripts/badgeuse-schema.test.js` | **60 tests / 2 suites — PASS** |
| `npx jest tests/contract/badgeuse-contract.test.js tests/unit/services/badgeuse-engine.test.js tests/unit/utils/badgeuse-crypto.test.js tests/unit/routes/badgeuse-device.test.js` | **174 tests / 4 suites — PASS** |
| `python3 -m pytest tests/` (depuis `badgeuse/agent/`) | **166 tests — PASS** |
| **Total** | **400 tests exécutés, 400 verts** |

---

## 1. AFFICHAGE — exigences bloquantes de la note §3.5

Rappel du statut donné par la note elle-même : toutes les mesures du tableau §3.5 sont marquées **Obligatoire**, **à une exception près** — l'absence de cumul d'heures est marquée « Fortement recommandé — recommandation : interdire ». Cette nuance est reprise telle quelle ci-dessous ; elle n'est pas une commodité d'audit.

| # | Exigence | Statut | Preuve |
|---|---|---|---|
| AFF-1 | **Aucun champ photo** dans le modèle, l'API, le cache poste, l'UI | ✅ | Recherche exhaustive `photo` (insensible à la casse) sur `backend/src/routes/badgeuse*.js`, `services/badgeuse-engine.js`, `utils/badgeuse-*.js`, `frontend/src/components/badgeuse/`, `badgeuse/` : **2 occurrences, toutes deux des interdictions** — `frontend/src/components/badgeuse/PlaylistAffichage.jsx:166` (avertissement à l'éditeur) et `badgeuse/ui/app.js:17` (commentaire). Le schéma des 8 tables (`init-db.js:6669-6856`) ne comporte aucune colonne photo ; le cache poste non plus (`store.py:63-68`) |
| AFF-2 | Écran limité au **prénom + initiale**, jamais le nom complet | ✅ | Serveur : `badgeuse-device.js:299-304` — la projection construit `initiale_nom: String(row.last_name).trim().charAt(0).toUpperCase()`, le nom complet ne quitte jamais le serveur. Poste : `store.py:63-68` (colonnes `prenom`, `initiale`). Canal UI : `ws_server.py:160-185` (`badge_ok` n'émet que `prenom`, `initiale`, `sens`, `heure_locale`, `cumul_hebdo`, `overlay_duree_sec`). UI : `app.js:192-196` — `identite()` rend `« Prénom I. »` |
| AFF-3 | Durée d'affichage **plafonnée à 8 s** | ✅ | **Quadruple plafond.** Serveur : `utils/badgeuse-settings.js:57-58` (`OVERLAY_MAX_SEC = 8`) appliqué en sortie de `readBadgeuseParams()` ligne 115 — une valeur hors bornes en base est ramenée dans les bornes. Poste : `ws_server.py:32-33` + `clamp_overlay()` 49-59, appliqué à **chaque** message (183, 193, 205). UI : `app.js:27` (`OVERLAY_MAX_MS = 8000`) + `dureeOverlay()` 185-190. Saisie : `ParametresBadgeuse.jsx:178` (`min={3} max={8}` + clamp JS) |
| AFF-4 | **Aucun cumul d'heures/solde/retard** affichable par défaut | ✅ (défaut) — **voir réserve R1** | Chaîne complète vérifiée de bout en bout : défaut serveur `badgeuse-settings.js:38` (`'badgeuse.affichage_cumul_hebdo': false`) → transmis au poste `badgeuse-device.js:323` → porte agent `app.py:94-96` (`_cumul_active`, `.get(..., False)`) → `app.py:192-193` (`if not self._cumul_active: return None`) → `ws_server.py:168-173` (`cumul_hebdo` reste `None`) → UI `app.js:160-162` (`if (options.cumul)` — rien ne s'affiche sans valeur). **Aucun solde ni retard n'existe dans le canal d'affichage** : `badge_ok` n'a pas de champ pour cela |
| AFF-5 | **Aucune mention de statut** (CDDI, parcours, encadrant) vers le poste | ✅ | `GET /v1/devices/:code/badges` renvoie **exactement 4 champs** : `uid_hmac`, `salarie_id`, `prenom`, `initiale_nom` (`badgeuse-device.js:299-304`). `GET /config` ne renvoie que des paramètres d'affichage et de capture (`badgeuse-device.js:320-329`). Défense en profondeur côté poste : `store.py:271-289` — `replace_badges()` **ignore par construction tout champ supplémentaire** envoyé par le serveur |
| AFF-6 | **Aucun historique consultable** depuis l'écran | ✅ | Le canal WS est **unidirectionnel par construction** : `ws_server.py:128-130` — `async for _ in websocket: pass` (l'interface n'émet rien, aucune requête n'est traitée). Le serveur HTTP local ne sert **que des fichiers statiques** (`SimpleHTTPRequestHandler` avec `directory=ui_dir`, `ws_server.py:106-107`), listage de répertoire refusé (`list_directory` → 404, lignes 234-236). Aucune route d'API n'existe sur le poste |
| AFF-7 | **Aucun message individuel** diffusable en veille | ✅ (structurel) — **voir réserve R5** | `badgeuse_contenus` (`init-db.js:6839-6855`) ne porte **aucune FK vers `employees`** : la seule FK vers `users` est `cree_par` (l'auteur du contenu, non une cible). Il est structurellement impossible d'adresser un contenu à un salarié. L'éditeur affiche l'interdiction (`PlaylistAffichage.jsx:166`) |

---

## 2. DONNÉES — minimisation (note §3.4)

| # | Exigence | Statut | Preuve |
|---|---|---|---|
| DON-1 | `uid_hmac` partout, **UID en clair nulle part** | ✅ | **Schéma** : seules colonnes `uid_hmac VARCHAR(64)` (`init-db.js:6710` et `6756`) — aucune colonne d'UID. **Agent** : `app.py:122-123` calcule le condensat puis `del normalise` (« l'UID brut ne survit pas au calcul ») ; l'UID brut n'est jamais passé à un logger (`app.py:101`). **Journaux agent** : `hmac_uid.py:65-72` — `short()` tronque à **12 caractères du condensat** (jamais l'UID, jamais le condensat entier) ; utilisé lignes 127, 148, 171 d'`app.py`. **Journaux sync** : `sync.py:118-302` — uniquement des compteurs et des messages, aucun identifiant. **Journaux serveur** : `badgeuse-device.js:269-273` — code du poste et compteurs seulement. **Base locale** : `store.py:63-68`. **Réponses d'API et messages d'erreur** : 401 générique sans détail (`badgeuse-device.js:66`), aucune route ne renvoie d'UID |
| DON-2 | Cache local poste = `uid_hmac` + `salarie_id` + prénom + initiale, **rien d'autre** | ✅ | `store.py:63-68` (schéma SQLite : 4 colonnes exactement) et `store.py:271-289` (écriture : les champs hors contrat sont ignorés silencieusement, par construction) |
| DON-3 | Aucune donnée de **santé / absence motivée / parcours** ne transite par le poste | ✅ | La base locale ne comporte que 5 tables (`store.py:48-84`) : `chain_state`, `queue`, `badges`, `pointages_locaux` (uuid, salarie_id, horodatage, sens), `cache`. Aucun champ de santé, d'absence ou de parcours. Aucun endpoint device n'expose de telles données (§AFF-5) |
| DON-4 | Motifs en **liste fermée**, champ libre limité au seul motif « autre » | ✅ — **voir réserve R2** | **Triple verrou.** SQL : `CHECK (motif_code IN (...))` 6 valeurs (`init-db.js:6797-6798`). Route : `body('motif_code').isIn(MOTIFS)` (`badgeuse.js:549`) **et validation bidirectionnelle** lignes 582-587 — `autre` sans précision → 400 ; **précision sur un motif codé → 400** (le champ libre ne peut pas être détourné sur un motif de la liste). UI : `JournalPointages.jsx:182-189` (select fermé, champ de précision rendu **uniquement** si `autre`, `maxLength={200}`) + `:96` (envoi `null` sinon). Tests exécutés : `badgeuse-contract.test.js:292-324` (4 cas) |

---

## 3. CONSERVATION — durées et purge (note §3.7)

| # | Exigence | Statut | Preuve |
|---|---|---|---|
| CON-1 | La purge **existe** | ✅ | `services/scheduler.js:686-765` — `badgeusePurgeRetention()`. C'est le **seul** point du code qui supprime physiquement un pointage (cf. TRA-1) |
| CON-2 | Elle est **planifiée** | ✅ | Inscrite dans `runAllJobs` : `scheduler.js:1711` (`await runInstrumented('badgeusePurgeRetention', badgeusePurgeRetention)`) |
| CON-3 | Elle est **journalisée** | ✅ | Double trace : `job_runs` via `runInstrumented` (scheduler.js:1711) **et** `rgpd_audit_log` action `AUTO_PURGE_BADGEUSE` avec le bilan détaillé et les durées appliquées (`scheduler.js:746-757`). Supervision : `routes/monitoring.js:109` (`JOB_SCHEDULE`). Finesse vérifiée : l'entrée de purge n'est **pas** une action `BADGEUSE_%`, elle ne s'auto-purgerait donc pas (test exécuté, `badgeuse-scheduler.test.js:201-207`) |

### 3.1 Comparaison clé par clé aux valeurs de la note §3.7

| Donnée (note §3.7) | Valeur exigée | Défaut codé | Fichier:ligne | Verdict |
|---|---|---|---|---|
| Pointages bruts et corrections | jusqu'à **5 ans** | `retention_pointages_mois: 60` (= 5 ans) | `badgeuse-settings.js:49` | ✅ |
| Feuilles de temps validées | **5 ans** | `retention_feuilles_mois: 60` | `badgeuse-settings.js:50` | ✅ |
| Association badge ↔ salarié | **3 mois** après la sortie | `retention_badges_apres_restitution_jours: 90` | `badgeuse-settings.js:51` | ✅ |
| Journaux d'accès des utilisateurs RH | **6 mois à 1 an** | `retention_journal_acces_mois: 12` | `badgeuse-settings.js:53` | ✅ (borne haute de la fourchette) |
| Contenus d'affichage | publication **+ 1 an** | `retention_contenus_apres_expiration_jours: 365` | `badgeuse-settings.js:52` | ✅ |
| Journaux techniques du poste | **6 mois maximum** | *Aucune table d'historique* : `heartbeat_info` est une colonne JSONB **écrasée** à chaque battement (`init-db.js:6697`, `badgeuse-device.js:394-407`) ; côté poste, les événements locaux sont purgés à **30 jours** (`store.py:43`, `380-401`, boucle active `app.py:318-326, 375`) | ✅ conforme par conception (rien ne s'accumule) |

Les clauses SQL de suppression appliquent bien ces clés : `scheduler.js:719-737` (7 blocs : corrections, pointages, feuilles, historique de badges, badges, contenus, journal d'accès ciblé `action LIKE 'BADGEUSE_%'`).

| # | Exigence | Statut | Preuve |
|---|---|---|---|
| CON-4 | **Testable à blanc** (dry-run) | ✅ | `scheduler.js:686-687` (`options.dryRun`) et `706-708` (en dry-run : `SELECT COUNT(*)` au lieu du `DELETE` — **rien n'est supprimé**). Exporté pour exploitation : `scheduler.js:1762` |
| CON-5 | Un **test automatisé prouve les clauses de suppression** | ✅ | `tests/unit/services/badgeuse-scheduler.test.js` — **exécuté pour ce rapport : 26/26 PASS**. Couvre notamment : les seuils paramétrés remplacent les défauts (`:159-177`), un seuil illisible retombe sur le défaut documenté **et jamais sur 0** (`:179-184`), la purge réelle supprime et se journalise avec son bilan (`:186-202`), le journal d'accès purgé est **ciblé** sur les actions du module (`:150-156`), une purge sans effet ne journalise rien (`:210-215`) |

---

## 4. TRAÇABILITÉ ET DROITS (note §3.9, §5)

| # | Exigence | Statut | Preuve |
|---|---|---|---|
| TRA-1 | **Aucune suppression physique** de pointage hors purge légale | ✅ | Recherche `DELETE FROM badgeuse_` sur l'ensemble du dépôt : **une seule occurrence en code applicatif**, `badgeuse.js:1137`, et elle porte sur `badgeuse_contenus` (contenus d'affichage, sans donnée personnelle). **Zéro DELETE** sur `badgeuse_pointages` ou `badgeuse_corrections` dans les routes. La purge construit son ordre par gabarit (`DELETE FROM ${table}`, `scheduler.js:710`, noms de tables constants — d'où l'absence de correspondance littérale). Verrouillé par deux tests exécutés : `badgeuse-contract.test.js:340` et `badgeuse-schema.test.js:301-302` |
| TRA-2 | Toute correction crée un **enregistrement lié**, l'original **intact** | ✅ | La correction est un **INSERT pur** dans `badgeuse_corrections` (`badgeuse.js:622-627`) portant `auteur_id`, `created_at`, `motif_code`, `motif_detail` — aucun UPDATE du pointage d'origine. **Unique UPDATE sur `badgeuse_pointages` de tout le code applicatif** : `badgeuse.js:461-465`, rattachement d'orphelin, `SET employee_id = $2, statut = 'traite'` avec garde `WHERE employee_id IS NULL AND statut = 'orphelin'` — **aucun champ couvert par la chaîne d'intégrité n'est touché**, et l'acte est journalisé **dans la transaction** (`:472-473`). Tests exécutés : `badgeuse-contract.test.js:332-341` (additivité), `:470-480` (aucun champ protégé modifié : `uuid`, `horodatage_utc`, `sens`, `source`, `uid_hmac`, `sequence_device`, `hash_courant`), `:451-468` (journalisation avant COMMIT), `badgeuse-schema.test.js:314-317` (un seul UPDATE dans tout le fichier) |
| TRA-3 | Le salarié accède à **ses propres** données | ✅ | `GET /mes-pointages` (`badgeuse.js:1352-1394`) : la fiche est résolue par `SELECT id ... FROM employees WHERE user_id = $1` avec `req.user.id` (`:1356`). Le **seul** paramètre accepté est `periode` (`:1353`) — aucun `employee_id`, aucun moyen syntaxique de lire autrui. Route volontairement **hors `READ`** (accessible à tout rôle authentifié) : c'est le droit d'accès art. 15. Transparence bidirectionnelle : les corrections et leurs motifs sont rendus au salarié (`:1381-1384`). Test exécuté : `badgeuse-contract.test.js:185-193` |
| TRA-4 | Toute **consultation RH individuelle est journalisée** | ✅ | Les quatre surfaces individuelles sont couvertes : `GET /pointages?employee_id` → `badgeuse.js:384` (journalisation **conditionnée** à la présence du filtre individuel, `:383`) ; `GET /corrections?employee_id` → `:523` ; `GET /feuilles-temps/:employeeId` → `:743` ; `GET /salaries/:employeeId/releve` → `:1421`. Exports également tracés : `:997` (paie), `:1036` (IAE). Actes faisant foi journalisés **dans** la transaction : rattachement d'orphelin `:472`, validation `:825`, dévalidation `:865`. Tests exécutés : `badgeuse-contract.test.js:425-449` — dont le cas négatif « une consultation **non** individuelle (liste globale) n'est pas journalisée » (`:436`), qui prouve que la journalisation cible bien l'accès à une personne |
| TRA-5 | **Aucune décision automatisée à effet** | ✅ | Les anomalies sont des **signalements factuels typés**, sans note ni classement : `sens_indetermine`, `double_pointage`, `sequence_impaire`, `sortie_sans_entree`, `oubli_sortie` (`badgeuse-engine.js:225-253`), avec une `severite` `info`/`alerte` purement descriptive. Aucune notion de sanction, de score ou de classement dans le code (recherche `sanction|scoring|classement|score` sur `badgeuse-engine.js` et `badgeuse.js` : **aucune occurrence**). Le seul paramètre nommé « retard » (`tolerance_retard_minutes`) ne sert qu'à **ne pas** pénaliser (`badgeuse-engine.js:280-281` : dans la tolérance, l'heure planifiée est retenue) — il joue toujours à l'avantage du salarié et ne produit **aucune** anomalie de retard |
| TRA-6 | **Aucun recueil de consentement** (base légale écartée par §3.3) | ✅ | Recherche `consentement|consent` sur `backend/src/routes/badgeuse*.js`, `frontend/src/components/badgeuse/`, `badgeuse/ui/`, `badgeuse/agent/` : **aucune occurrence**. Aucune case à cocher, aucun écran d'acceptation |

---

## 5. SÉCURITÉ (note §4)

| # | Exigence | Statut | Preuve |
|---|---|---|---|
| SEC-1 | **TLS obligatoire** côté poste ; `config.py` refuse une URL http | ✅ — **voir réserve R3** | `config.py:116-119` : toute URL ne commençant pas par `https://` lève `ConfigError` — **l'agent refuse de démarrer**, il n'y a pas de repli en clair. `sync.py:75-78` passe `verify` à chaque requête. `verify_tls` vaut `True` par défaut (`config.py:55` et `:152`) |
| SEC-2 | **Clé device hors dépôt**, posée en 0600, **stockée hachée**, jamais renvoyée après création, **révocable** | ✅ | Hors dépôt : `badgeuse/deploy/badgeuse.conf.example` ne contient que des marqueurs `CHANGE_ME_...` (aucun secret réel). Permissions : `install.sh:214` (`install -m 0600 -o badgeuse -g badgeuse`) et `:218` (`chmod 0600`), avec avertissement si le fichier est lisible par tous (`config.py:113`). Stockage haché : colonne `api_key_hash` (`init-db.js:6692`), alimentée par `hashDeviceKey()` SHA-256 (`badgeuse.js:1196`, `badgeuse-crypto.js:147-149`) — **la clé elle-même n'est jamais stockée**. Jamais renvoyée : `GET /devices` n'expose qu'un booléen `(api_key_hash IS NOT NULL) AS appaire` (`badgeuse.js:1155`, commentaire `:1161`) ; la clé n'est rendue qu'**une fois** à l'appairage (`:1212-1215`). Révocable : `POST /devices/:id/regenerate-key` ADMIN (`badgeuse.js:1225-1242`) |
| SEC-3 | **Clé HMAC site chiffrée AES-256-GCM**, jamais loguée, jamais renvoyée hors appairage | ✅ — **voir réserve R4** | Chiffrement à l'écriture : `badgeuse.js:1203` (`writeSetting(hmacKeySettingKey(siteId), encryptSecret(hmacKey), client)`) ; `encryptSecret` = AES-256-GCM avec IV aléatoire et tag d'authentification (`badgeuse-crypto.js:177-185`). **`decryptSecret` n'est jamais appelé dans `badgeuse.js`** (recherche effectuée : aucune occurrence) — la clé de site est en écriture seule côté serveur après sa création. Jamais loguée : l'échec de déchiffrement renvoie `null` sans tracer le secret ni la charge (`badgeuse-crypto.js:197-200`). Renvoyée une seule fois, à l'appairage (`badgeuse.js:1212-1215`), et **uniquement si le site n'en possédait pas déjà une** (`:1200-1204`) |
| SEC-4 | Comparaison de clé à **temps constant** | ✅ | `badgeuse-crypto.js:155-160` — `timingSafeEqualHex()` avec garde de longueur préalable (une différence de longueur renvoie `false` sans appeler `timingSafeEqual`, qui lèverait). Employée à l'authentification du poste : `badgeuse-device.js:81`. Réponse 401 **générique** dans tous les cas (clé absente, poste inconnu, poste inactif, clé fausse) — aucune énumération possible (`badgeuse-device.js:66`, `:80-81`) |
| SEC-5 | **Cloisonnement par rôle effectivement testé** | ✅ (mécanisme) — **voir écart E1 sur le périmètre** | `tests/contract/badgeuse-contract.test.js:123-199` — **exécuté pour ce rapport (suite verte)**. Cas couverts : lecture ouverte à ADMIN/RH/MANAGER (`:124`) ; **COLLABORATEUR → 403** sur `/pointages` et les autres lectures RH (`:134`) ; **QHSE (rôle hors périmètre) → 403** (`:142`) ; écritures réservées à ADMIN/RH, MANAGER et COLLABORATEUR refusés (`:146`) ; administration des postes réservée à ADMIN (`:156`) ; dévalidation d'une feuille ADMIN seul (`:164`) ; exports ADMIN/RH (`:169`) ; corrections ouvertes au MANAGER (`:176`) ; `/mes-pointages` accessible à tout rôle authentifié (`:185`) ; **sans jeton → 401 partout** (`:194`). Verrous métier également testés : un encadrant ne corrige pas ses propres pointages (`:260`), aucune correction sur période validée RH (`:271`) |
| SEC-6 | **Aucune écoute réseau non-localhost** sur le poste | ✅ | Double barrière. Liaisons : `ws_server.py:29` (`LOOPBACK = "127.0.0.1"`), appliqué au WebSocket `:86` et au serveur statique `:107`. Pare-feu : `deploy/firewall.sh` — chaîne d'entrée `policy drop` avec pour seules acceptations `iif lo`, les connexions établies, et SSH restreint à un réseau d'administration paramétrable ; sortie limitée à 443/123/53(+DHCP). Les ports 8765/8766 sont donc inatteignables depuis le réseau, y compris si une liaison était modifiée |
| SEC-7 | **Chaînage d'intégrité** : un test prouve qu'une falsification en base est détectée | ✅ | `tests/contract/badgeuse-contract.test.js:738-766` — **exécuté, vert**. Le test simule exactement le scénario redouté : un **horodatage modifié directement en base** (heure d'arrivée avancée d'une heure) alors que le `hash_courant` enregistré reste celui de la capture d'origine. `GET /devices/:id/verify-chain` renvoie `ok: false` avec la rupture localisée (`sequence: 1`, `trouve` ≠ `attendu`). Complété par `badgeuse-crypto.test.js:163-165` (une falsification d'**une seule milliseconde** change le condensat) et `badgeuse-device.test.js:215-221` (un hash falsifié en transit est stocké avec `chaine_valide = false` — la preuve imparfaite n'est jamais effacée) |

---

## 6. Écarts constatés

| Réf | Écart | Sévérité | Analyse |
|---|---|---|---|
| **E1** | **Le MANAGER (encadrant technique) accède aux données individuelles de _tous_ les salariés, sans restriction d'équipe**, alors que la note §3.6 « Destinataires » lui assigne « **les salariés de son équipe uniquement** » (contrôle : « cloisonnement par rôle »). | **MAJEURE** | `READ = authorize('ADMIN','RH','MANAGER')` (`badgeuse.js:49`) et `CORRECTION` idem (`:51`) ne portent **aucun filtre d'équipe** : aucune clause `team_id`/`manager_id` ne restreint `GET /pointages`, `/feuilles-temps/:employeeId`, `/salaries/:employeeId/releve` (vérifié : la seule occurrence de `team_id` est une **colonne de sortie**, `badgeuse.js:690` et `:709`). L'écart est **assumé et documenté en tête de fichier** (`badgeuse.js:12-14` : « accès non restreint par équipe, précédent documenté v2.12.0 »), et il est cohérent avec un précédent du dépôt. Il n'en reste pas moins une divergence avec la note, sur des données individuelles d'un public vulnérable, et il est **atténué** par la journalisation systématique de toute consultation individuelle (TRA-4). **Ce point n'est pas listé parmi les mesures marquées « Obligatoire » de la note (§3.5) ni parmi les contrôles de recette du §9-10** : il ne déclenche donc pas la non-conformité automatique, mais il appelle un arbitrage explicite de la Direction et du référent RGPD **avant mise en service**. |

**Aucun écart n'a été relevé sur les points marqués « Obligatoire » par la note juridique** (§3.5 affichage : photo, prénom + initiale, 8 secondes, statut, historique, message individuel ; §3.8 inscription au registre ; §4 mesures de sécurité ; §3.9 droits).

---

## 7. Réserves documentées

| Réf | Réserve | Sévérité | Analyse |
|---|---|---|---|
| **R1** | **Le cumul hebdomadaire est activable** par un ADMIN/RH, alors que la note recommande de l'**interdire**. | Moyenne | La note §3.5 classe cette mesure « **Fortement recommandé — recommandation : interdire** », et non « Obligatoire » — seule ligne du tableau dans ce cas. Le code retient l'option la plus faible mais **conforme à la lettre** : défaut `false` (`badgeuse-settings.js:38`), chaîne complète neutre jusqu'à l'UI (cf. AFF-4), et l'écran de réglage affiche l'avertissement juridique et la recommandation « désactivé » (`ParametresBadgeuse.jsx:193-201`). **Décision attendue :** soit la Direction assume l'option activable (traçable en settings), soit le paramètre est retiré du code pour tenir la recommandation. |
| **R2** | **Champ libre `motif_detail` pour le seul motif « autre »** — tension entre deux documents de référence. | Faible | La note juridique §3.4 écrit « **champ libre à proscrire** » ; la note RH prévoit à l'inverse « rendez-vous accompagnement / formation / **autre à préciser** » (`NOTE_RH.md:112`). Le code tranche par le **confinement strict** : le détail est refusé (400) sur tout motif codé et exigé sur `autre` seulement (`badgeuse.js:582-587`), borné à 200 caractères (`init-db.js:6799`, `JournalPointages.jsx:189`). La surface de texte libre est donc minimale et exceptionnelle, mais **elle n'est pas nulle** : la tension entre les deux notes doit être tranchée par écrit par le référent RGPD (recommandation : conserver le confinement actuel, et rappeler par consigne que ce champ ne doit contenir aucune donnée de santé ni motif d'absence). |
| **R3** | **La vérification du certificat TLS est désactivable** par configuration du poste. | Faible | `config.py:152-156` : `verify_tls` vaut `True` par défaut et sa désactivation produit un avertissement explicite (« réservée à un banc de test, jamais en exploitation »), mais elle reste techniquement possible. L'exigence §4 (« chiffrement des flux, TLS 1.2 minimum ») est tenue sur le fond — le HTTPS, lui, est **imposé** sans repli (SEC-1). Risque résiduel opérationnel : un poste mal configuré resterait chiffré mais exposé à un intermédiaire actif. **Recommandation :** contrôler `verify_tls` à la recette de chaque poste. |
| **R4** | **La clé HMAC de site (chiffrée) est visible en tant que ligne de `settings`** via l'endpoint générique `GET /api/settings`. | Faible | `routes/settings.js:15` exécute `SELECT * FROM settings`, ce qui inclut `badgeuse.hmac_key_site_<id>`. La valeur exposée est le **chiffré AES-256-GCM** (`v1:iv:tag:enc`), jamais la clé : le déchiffrement dépend d'un secret d'environnement (`BADGEUSE_ENCRYPTION_KEY` / `PCM_ENCRYPTION_KEY` / `JWT_SECRET`) absent de la base. L'endpoint est **réservé à ADMIN** (`settings.js:9`). Il s'agit d'un **motif pré-existant du dépôt** (mêmes modalités que les jetons SumUp), non d'une régression du module. **Recommandation :** exclure les clés `*hmac_key*` et assimilées de la projection de `GET /api/settings` (correctif transverse, hors périmètre de ce module). |
| **R5** | **Le corps des contenus de veille est du texte libre** : rien n'empêche techniquement un rédacteur d'y saisir un message nominatif. | Faible | L'interdiction du §3.5 (« aucun message individuel diffusé en veille ») est garantie **structurellement** — `badgeuse_contenus` n'a aucune FK vers `employees` (`init-db.js:6839-6855`), aucun contenu ne peut être *adressé* à un salarié — et l'éditeur affiche l'interdiction (`PlaylistAffichage.jsx:166`). Le risque résiduel est **éditorial, non technique**, et relève du circuit de validation de la playlist déjà prévu (un valideur unique désigné, SPEC §9). |
| **R6** | **Le poste conserve 30 jours d'événements locaux minimaux.** | Pour information | `store.py:43` (`LOCAL_EVENTS_RETENTION_DAYS = 30`), purge active (`store.py:380-401`, boucle `app.py:318-326` lancée en tâche `:375`). Ces données (`uuid`, `salarie_id`, horodatage, sens) sont nécessaires à la détermination hors ligne du sens entrée/sortie. La durée est très inférieure aux plafonds du §3.7 et le vol du matériel ne livrerait ni fichier du personnel ni moyen de cloner un badge (aucun UID, aucun nom de famille). **Aucune action requise** — mentionné pour la complétude du registre. |

---

## 8. Points de conformité remarquables

Trois choix de conception dépassent l'exigence et méritent d'être signalés au référent RGPD comme éléments de défense en cas de contrôle :

1. **Le plafond d'affichage de 8 secondes est appliqué quatre fois indépendamment** (serveur, poste, interface, saisie). Une régression sur un seul étage ne suffit pas à produire un affichage non conforme.
2. **Le poste ignore par construction tout champ non prévu au contrat** (`store.py:274-289`) : même une modification serveur ajoutant le nom de famille ou le statut de contrat ne le ferait pas descendre dans le cache du poste ni à l'écran.
3. **La preuve imparfaite n'est jamais effacée** : une rupture de chaîne ou un badge inconnu produit un enregistrement conservé (`chaine_valide = false`, statut `orphelin`) plutôt qu'un rejet — ce qui sert simultanément l'obligation de décompte (L.3171-2) et la détectabilité exigée au §4.

---

## 9. AVIS FINAL

> ## CONFORME SOUS RÉSERVE

Le module 33 « Temps & Présence » **satisfait l'intégralité des exigences marquées « Obligatoire »** par la note juridique : aucune photographie nulle part dans la chaîne, affichage limité au prénom et à l'initiale, durée d'overlay plafonnée à 8 secondes par quatre mécanismes indépendants, aucun statut de contrat ou de parcours transmis au poste, aucun historique interrogeable depuis l'écran, aucun message individuel structurellement diffusable, UID de badge jamais présent en clair (base, journaux, API, poste), purge automatisée planifiée et journalisée appliquant **exactement** les durées du §3.7, inaltérabilité des pointages avec corrections additives, droit d'accès du salarié satisfait par construction, journalisation de toute consultation individuelle, et chaîne cryptographique dont la capacité de détection d'une falsification en base est **prouvée par un test exécuté**.

La mise en service est subordonnée au traitement des points suivants :

1. **Arbitrage de l'écart E1** (accès MANAGER non cloisonné par équipe) par la Direction et le référent RGPD : soit restriction technique par équipe, soit acceptation écrite et motivée au dossier de conformité, en s'appuyant sur la journalisation des consultations.
2. **Décision sur la réserve R1** (cumul hebdomadaire activable) : maintien de l'option ou retrait du paramètre.
3. **Formalisation écrite de la réserve R2** (champ libre confiné au motif « autre ») par le référent RGPD, pour trancher la tension entre la note juridique et la note RH.
4. **Prise en compte des réserves R3 et R4** au plan de recette (contrôle de `verify_tls` par poste) et au backlog transverse (projection de `GET /api/settings`).

Ce rapport ne couvre que la **conformité technique du code livré**. Il ne préjuge en rien de l'accomplissement des formalités du §9 de la note juridique — consultation préalable du CSE, information individuelle des salariés contre émargement, fiche au registre des traitements, contrats de sous-traitance — qui demeurent **bloquantes et hors du périmètre logiciel**. La fiche de registre est bien créée par le code (`init-db.js:6861-6876`), mais sa **validation par le référent RGPD** reste un acte humain requis.

---

*Rapport établi sur lecture du code source et exécution effective de 400 tests automatisés. Aucune modification n'a été apportée au code dans le cadre de cet audit.*
