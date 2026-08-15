# Rapport QA — Module « Temps & Présence » (badgeuse)

**Agent A4 (QA/Debug) — barrière bloquante avant mise en production**
**Itération 3 — re-vérification FINALE après boucle de correction n°2 (3/3)**
**Date :** 15 août 2026 · **Périmètre re-vérifié :** HEAD `87331c8` (QA-13 serveur) et `135404c`
(QA-13 poste), sur amendement `CONTRAT_API_DEVICE.md v1.2` (statut `retry` non terminal).
Historique : itération 2 sur `89f6310`/`1b45d03` (contrat v1.1 + addendum `adr/0002`).
**Posture :** adversariale et inchangée. Aucun statut « corrigé » n'a été accordé sur la foi d'un
rapport de correction : chaque défaut a été re-vérifié dans le code (fichier:ligne) et, quand la
règle est numérique, re-prouvé par exécution. Aucun correctif n'a été appliqué par le présent
agent : ce document constate.

---

## 1. Résultats des trois suites — ré-exécutées réellement (itération 3)

| Suite | Commande | Résultat | Sortie |
|---|---|---|---|
| Backend Jest | `cd backend && npx jest --forceExit` | **93 suites, 1605 tests : 1601 passés, 4 ignorés, 0 échec** — 5,5 s | 0 |
| Frontend build | `cd frontend && npx vite build` | **Succès, 10,24 s** | 0 |
| Agent Python | `python3 -m pytest badgeuse/agent/tests/ -q` | **190 tests passés** — 0,65 s | 0 |

**Trajectoire sur les 3 itérations** — Jest : 1498 → 1579 → **1601** passés (**+103**, suites
toujours 93/93, **0 régression à chaque boucle**) · Python : 166 → 179 → **190** (**+24**) ·
build vert aux 3 itérations.

> Réserve maintenue : Jest signale toujours `A worker process has failed to exit gracefully` ;
> le `--forceExit` masque une fuite de handle. Sans incidence sur les verdicts, à traiter en
> hygiène de test.

<details>
<summary>Chiffres de l'itération 1 (avant correction), pour mémoire</summary>

Jest 93 suites / 1502 tests (1498 passés, 4 ignorés) · vite build OK 10,07 s · pytest 166 passés.
Dont badgeuse : 334 tests (contract 125, device 59, engine 46, scheduler 39, schema 34, crypto 31).
</details>

---

## 2. Matrice de traçabilité

Légende : **OK** = implémenté ET testé · **PARTIEL** = implémenté incomplètement, ou implémenté
sans test, ou exigence à moitié couverte · **ABSENT** = non trouvé dans le code.

### 2.1 Poste de pointage (PST-01 → PST-10)

| Exig. | Implémenté (fichier:ligne) | Testé | Verdict |
|---|---|---|---|
| PST-01 — capture `evdev` exclusive `EVIOCGRAB` | `badgeuse/agent/badgeuse_agent/reader.py:107` (`device.grab()`), libération `:250` ; droits `deploy/systemd/badgeuse-agent.service:14` | `tests/test_pipeline.py` (lecteur simulé) | **OK** |
| PST-02 — anti-rebond 8 s, message « déjà enregistré » | `debounce.py` (module dédié) ; seuil serveur `badgeuse-settings.js:40` (`anti_rebond_sec: 8`) ; message `ui/app.js` | `tests/test_debounce.py` | **OK** |
| PST-03 — sens par alternance depuis le dernier pointage du jour | `sens.py` (`determine_sens`, `ENTREE`/`INCONNU`) ; appel `app.py:159` | `tests/test_sens.py` | **OK** |
| PST-04 — badge inconnu → écran d'erreur + pointage orphelin, jamais de rejet silencieux | `badgeuse-device.js:188-196` (`badge_inconnu`, `badge_inactif`), `:201-204` (`hors_plage`) — stocké en `statut='orphelin'`, jamais rejeté | `badgeuse-device.test.js`, `badgeuse-contract.test.js` | **OK** |
| PST-05 — file SQLite persistante, purge sur accusé serveur uniquement | `ACK_STATUSES` `store.py:60` = `{ok, duplicate, orphan, invalid}` — **`retry` délibérément exclu** (`store.py:54`) ; classification serveur `badgeuse-device.js:152-157` ; arrêt de lot `:392-396` | `tests/test_store.py`, `badgeuse-device.test.js` | **OK** (QA-01 + QA-13 corrigés) |
| PST-06 — cache badges 5 min / playlist 15 min, ETag | `sync.py:191/207/219` ; ETag serveur `badgeuse-device.js:92-103` ; cadences `badgeuse-settings.js:44-45` (300 s / 900 s) | `badgeuse-device.test.js` (304), `tests/test_store.py` | **OK** |
| PST-07 — heartbeat 60 s (version, dérive, file, température, disque) | `sync.py:235-258` ; réception `badgeuse-device.js:434-452` (dont `alerte`) ; télémétrie `sync.py:322-364` | `badgeuse-device.test.js` | **OK** (QA-02 corrigé) |
| PST-08 — bandeau discret « hors ligne » | `ui/app.js:46` (`hors_ligne`), élément `#bandeau-hors-ligne` `:65` | non testé (UI kiosque) | **PARTIEL** (implémenté, non couvert par un test automatisé) |
| PST-09 — watchdog matériel + redémarrage systemd + arrêt propre bouton | `badgeuse-agent.service:29` `WatchdogSec=90` (+ `sd_notify`), `Restart=always` ; **watchdog matériel** `install.sh:322` `RuntimeWatchdogSec=15s` | `badgeuse-schema.test.js` (unités) | **OK** (QA-09 corrigé) — arrêt propre par bouton à confirmer en recette (RP-1) |
| PST-10 — aucune saisie clavier, pas de bureau, sans barre d'outils, curseur masqué | `cage` `badgeuse-kiosk.service:35` ; flags `install.sh:249-251` ; **politique gérée** `deploy/chromium-policy.json` (`DeveloperToolsAvailability:2`) déployée sur les 2 arborescences `install.sh:254-256` ; curseur `ui/style.css:36` ; lecteur grabbé `reader.py:107` | — | **OK** (QA-07 corrigé) |

### 2.2 Affichage (AFF-01 → AFF-08)

| Exig. | Implémenté (fichier:ligne) | Testé | Verdict |
|---|---|---|---|
| AFF-01 — overlay prénom + initiale, sens, heure, picto, durée 3–8 s (défaut 5) | `ui/app.js:56-61` (picto/identité/message/heure) ; défaut `badgeuse-settings.js:39` ; **bornage 3–8 s serveur** `badgeuse-settings.js:115` + re-plafond poste `ui/app.js:9` ; minimisation source `badgeuse-device.js:299-304` (prénom + initiale seuls) | `badgeuse-contract.test.js` (bornes overlay) | **OK** |
| AFF-02 — cumul hebdo affiché seulement si activé (désactivé par défaut) | `badgeuse-settings.js:38` (`affichage_cumul_hebdo: false`) ; transmis `badgeuse-device.js:323` ; élément `ui/app.js:61` | `badgeuse-contract.test.js` | **OK** |
| AFF-03 — contraste ≥ 7:1, police ≥ 48 px, lisible à 3 m | `ui/style.css:93` `clamp(38px,5vw,84px)`, `:152` `clamp(64px,12vw,220px)`, `:233` `clamp(110px,18vh,260px)` | — | **PARTIEL** — tailles conformes en 16:9 usuel, mais **borne basse 38 px < 48 px** ; contraste non mesuré (à valider en recette matériel, cf. §6) |
| AFF-04 — retour sonore succès / erreur | `ui/app.js:101-127` (`AudioContext`, `note()`, rampe de gain) ; autoplay débloqué `install.sh` (`--autoplay-policy=no-user-gesture-required`) | — | **PARTIEL** (implémenté, non testé) |
| AFF-05 — playlist typée, ordre, durée, fenêtre, ciblage site, activation | table `badgeuse_contenus` `init-db.js:6839` ; service `badgeuse-device.js:341-367` (filtre `actif`, fenêtre `visible_du/au`, `site_id`) | `badgeuse-schema.test.js`, `badgeuse-device.test.js` | **OK** |
| AFF-06 — transition douce, aucun clignotement | `ui/style.css:126, 195, 210` (`transition: opacity … ease-in-out`) | — | **PARTIEL** (implémenté, non testé) |
| AFF-07 — playlist conservée et rejouée hors ligne | `sync.py:219-231` (cache `CACHE_KEY_PLAYLIST`), rejeu `ui/app.js:15` | `tests/test_store.py` (cache) | **OK** |
| AFF-08 — mise en veille DPMS hors plage | `deploy/dpms.sh` + `badgeuse-dpms.timer` (toutes les 5 min, idempotent) ; paramètres `badgeuse-settings.js:46-47` (21:30 / 05:30) | `badgeuse-contract.test.js` (paramètres) | **OK** |

### 2.3 Back-office (BO-01 → BO-11)

| Exig. | Implémenté (fichier:ligne) | Testé | Verdict |
|---|---|---|---|
| BO-01 — badges : attribution, restitution, perte/vol, historique | `routes/badgeuse.js:191` (liste), `:230` (POST), `:271` (PATCH statut), `:317` (historique) ; tables `init-db.js:6707` + `:6731` ; UI `GestionBadges.jsx` | `badgeuse-contract.test.js`, `badgeuse-schema.test.js` | **OK** |
| BO-02 — journal des pointages, filtres salarié/date/site/statut + indicateur d'anomalie | `routes/badgeuse.js:340-359` (filtres `employee_id`, `statut`, `du`, `au`, tous paramétrés `$n`) ; UI `JournalPointages.jsx` | `badgeuse-contract.test.js` | **OK** |
| BO-03 — corrections additives, motif obligatoire, auteur tracé, brut conservé | `routes/badgeuse.js:546` (POST) ; moteur `badgeuse-engine.js:142-202` (`buildEffectiveEvents` — le brut n'est jamais modifié) ; table `init-db.js:6790` (motif liste fermée, `auteur_id` `ON DELETE RESTRICT`) | `badgeuse-engine.test.js`, `badgeuse-contract.test.js` | **OK** |
| BO-04 — feuille mensuelle **théorique / pointé / écart** + circuit encadrant → RH | `routes/badgeuse.js:729-757` (théorique contractuel figé à la validation), `:121` (écart), circuit `:787` ; table `init-db.js:6812` | `badgeuse-contract.test.js` | **OK** (QA-03 corrigé) — `source_theorique` exposé, `null` honnête si aucun contrat |
| BO-05 — anomalies : oubli sortie, journée > 10 h, hors plage, orphelin, absence | `badgeuse-engine.js:214-256` (`oubli_sortie`, `sequence_impaire`, `sortie_sans_entree`, `double_pointage`), `:365` (`journee_longue`), `:473` (`detectAnomalies`) ; route `:884` ; ingestion `badgeuse-device.js:201` | `badgeuse-engine.test.js` (46 tests) | **PARTIEL** — « absence non justifiée » non implémentée (aucun croisement planning/`employee_leaves`) |
| BO-06 — export paie CSV paramétrable (colonnes, décimal/sexagésimal) | `routes/badgeuse.js:950` ; helpers `badgeuse-engine.js:121` (`minutesToHms`) / `:127` (`minutesToDecimal`) ; UI `FeuillesTemps.jsx:164` (`&heures=`) | `badgeuse-contract.test.js` | **OK** |
| BO-07 — export heures IAE (ASP / extranet) | `routes/badgeuse.js:1011` ; UI `FeuillesTemps.jsx:165` | `badgeuse-contract.test.js` | **OK** |
| BO-08 — playlist : éditeur, prévisualisation 16:9, publication immédiate/programmée | `routes/badgeuse.js:1067-1148` (CRUD) ; UI `PlaylistAffichage.jsx:102-112` (`aspect-video`), `:226` | `badgeuse-contract.test.js` | **OK** |
| BO-09 — supervision : en ligne/hors ligne, dernière remontée, version, **alerte e-mail si silence > seuil** | `scheduler.js:817` (seuil paramétré), `:870` (e-mail via `sendNotification`), `:907` (compteurs) ; `/devices` → `{silence_minutes, devices}` ; UI `SupervisionPostes.jsx:236-242, 318-319` | `badgeuse-scheduler.test.js` | **OK** (QA-04 corrigé) |
| BO-10 — purge automatique mensuelle, journalisée | `scheduler.js` `badgeusePurgeRetention` (6 tables + journal), mode `dryRun`, trace `AUTO_PURGE_BADGEUSE` ; durées `badgeuse-settings.js:49-53` | `badgeuse-scheduler.test.js` (39 tests) | **OK** |
| BO-11 — rôles salarié / encadrant / RH / admin + journalisation des consultations RH | `routes/badgeuse.js:49-52` (`READ`/`WRITE`/`CORRECTION`/`ADMIN_ONLY`) ; salarié `:1352` (`/mes-pointages`, borné par `user_id`) ; journal `:86` (`logConsultation` → `rgpd_audit_log`), purgé `scheduler.js` | `badgeuse-contract.test.js` (matrice de rôles) | **PARTIEL** — l'encadrant (MANAGER) **n'est pas restreint à son équipe** (écart assumé et documenté `routes/badgeuse.js:12-13`, précédent v2.12.0) |

**Synthèse itération 1 :** 29 exigences — 17 OK, 12 PARTIEL, 0 ABSENT.
**Synthèse itération 2 (après boucle 1) :** 29 exigences — 22 OK, 7 PARTIEL, 0 ABSENT.
**Synthèse itération 3 (après boucle 2) :** 29 exigences — **23 OK**, **6 PARTIEL**, **0 ABSENT**.
Restent PARTIEL, tous **non bloquants** : PST-08 / AFF-04 / AFF-06 (implémentés, non couverts par
un test automatisé), AFF-03 (borne basse 38 px < 48 px — sans effet sur un écran kiosque 16:9
usuel où le rendu est plafonné à 84 px ; contraste à mesurer en recette), BO-05 (« absence non
justifiée » non implémentée), BO-11 (MANAGER non restreint à son équipe — écart assumé et
documenté).

---

## 3. Cohérence inter-piles (crypto) — vérifiée par exécution, pas par lecture

Les deux implémentations ont été **exécutées sur les mêmes vecteurs** et comparées caractère par
caractère (Node 22 vs CPython 3.11).

| Vecteur | `canonical` | `chain_hash` | Identique ? |
|---|---|---|---|
| Badge, séq. 42, sens `entree`, source `badge` | `0193…0a11\|LH-P1\|42\|e75ed0b4…3120\|2026-08-17T06:58:12.031Z\|entree\|badge` | `57e62b8f…17bd` | **✅** |
| **Manuel** (`uid_hmac` = `-`), séq. 1, sens `inconnu` | `0193…0a12\|LH-P1\|1\|-\|2026-08-17T06:58:12.000Z\|inconnu\|manuel` | `e02d1475…46f4` | **✅** |
| Import, séq. 7, sens `sortie`, UID 7 octets | `0193…0a13\|LH-P1\|7\|0f2275d9…0ee3\|2026-08-17T23:59:59.999Z\|sortie\|import` | `ba48fc9e…1546` | **✅** |

Points de contrat vérifiés identiques : **format d'horodatage** `YYYY-MM-DDTHH:MM:SS.mmmZ` ·
**séparateur** `|` · **ordre des 7 champs** · **casse hex minuscule** du condensat ·
**`-` littéral** pour le pointage manuel · **`sens='inconnu'`** accepté des deux côtés ·
**genèse** `SHA256("genesis:"+device_code)` = `07b7f5a0…b1ab` des deux côtés ·
**concaténation de CHAÎNES** (et non d'octets décodés).

`hmac_uid` : clé décodée hex→octets, message = chaîne ASCII de l'UID normalisé →
`e75ed0b48b1ed96285c935b683869bfa58f801956072d035c5131df4818f3120` **des deux côtés**.

Normalisation d'UID identique : `04:a2:b3:c4` → `04A2B3C4` · décimal `0067305985` → `04030201`
(mode `decimal` signalé) · `12345` → rejet.

**Amorçage de chaîne cohérent** : le poste initialise `chain_state.last_hash` à
`genesis_hash(device_code)` (`store.py:123`) et le serveur retombe sur `genesisHash(req.device.code)`
en l'absence de pointage (`badgeuse-device.js:142`). Le premier pointage d'un poste neuf est donc
valide — **à condition que le `device_code` configuré soit identique au caractère près** (aucune
normalisation de casse ni d'espaces de part et d'autre : à contrôler à l'appairage).

> **Conclusion : aucune divergence cryptographique bloquante.** Le risque « pointage rejeté en
> production pour rupture de chaîne » est écarté sur le chemin nominal. Deux écarts de robustesse
> subsistent (QA-08, QA-12), sans effet sur le chemin nominal.

---

## 4. Preuves numériques du moteur RH

Exécutées sur `services/badgeuse-engine.js` avec la grille par défaut (NOTE_RH §3).

### 4.1 Arrondi « à l'avantage du salarié » — **confirmé à l'avantage**

Pas 5 min, `arrondi_sens='avantage_salarie'` — entrée 08:07, sortie 16:52 :

| | Réel | Compté |
|---|---|---|
| Entrée | 08:07 | **08:05** (plancher, −2 min) |
| Sortie | 16:52 | **16:55** (plafond, +3 min) |
| Durée | 8 h 45 (525 min) | **8 h 50 (530 min)** |

**+5 minutes en faveur du salarié.** La règle est bien à son avantage : l'entrée est toujours
reculée, la sortie toujours avancée, quel que soit le pas. ✅

### 4.2 Journée à cheval sur minuit — **correct**

Poste 22:00 → 06:00 (heure murale Paris) : la paire est rattachée **au jour civil de l'entrée**,
en une seule journée. `2026-08-17 : 7,25 h` (8 h moins la pause de 45 min). ✅

### 4.3 Bascules DST — **exactes** (calcul sur les instants)

| Nuit | Horloge murale | Durée réelle | Calculé |
|---|---|---|---|
| 24→25/10/2026 (recul) | 22:00 → 06:00 | **9 h** | 8,25 h + 45 min pause = **9 h** ✅ |
| 28→29/03/2026 (avance) | 22:00 → 06:00 | **7 h** | 6,25 h + 45 min pause = **7 h** ✅ |

### 4.4 Déduction de pause — conforme à la lettre de NOTE_RH §3, mais **non monotone**

Règle appliquée : 45 min déduites si **une seule paire** et journée **> 6 h** (`badgeuse-engine.js:355`).
Conforme au texte RH. Mais la fonction de paie est **discontinue** :

| Travail réel | Payé | Observation |
|---|---|---|
| 360 min (6 h 00) | **360 min** | pas de déduction |
| **361 min (6 h 01)** | **316 min (5,27 h)** | ⚠️ **1 minute de plus ⇒ 44 minutes de moins** |
| 405 min (6 h 45) | 360 min | retour au niveau de 6 h 00 |
| 406 min | 361 min | sortie de la zone morte |

Il existe une **zone morte de 45 minutes** (]6 h 00 ; 6 h 45]) où travailler davantage rapporte
autant ou moins. Avec pause badgée (2 paires), 361 min sont payées 361 min — la déduction ne
s'applique pas, ce qui est conforme. Voir **QA-06**.

### 4.4bis — Re-preuves après correction (itération 2)

**QA-06 — monotonie rétablie.** Même protocole, 10 points de mesure, seuil 6 h / pause 45 min :

| Travail réel | Payé (avant) | Payé (**après**) |
|---|---|---|
| 359 min | 359 | **359** |
| 360 min | 360 | **360** |
| **361 min** | **316** ⚠️ | **360** ✅ |
| 370 min | 325 | **360** |
| 405 min | 360 | **360** |
| 406 min | 361 | **361** |
| 480 min | 435 | **435** |

La fonction de paie est désormais **non décroissante sur toute la plage mesurée** (contrôle
programmatique : `MONOTONE : OUI`). La déduction est plafonnée à l'excédent au-dessus du seuil,
si bien qu'un salarié ne peut plus être payé moins en travaillant plus. Le comportement au-delà de
6 h 45 est inchangé (déduction pleine de 45 min), conforme à NOTE_RH §3.

**QA-10 — sortie comptée au réel.** Entrée 08:07 / sortie 16:52, pas 5 min, `avantage_salarie` :

| | Réel | Compté (avant) | Compté (**après**) |
|---|---|---|---|
| Entrée | 08:07 | 08:05 | **08:05** (recul au pas — toujours en faveur) |
| Sortie | 16:52 | 16:55 (plafond) | **16:52** (au réel) ✅ |
| Durée | 8 h 45 | 8 h 50 | **8 h 47 (527 min)** |

L'arrondi ne peut plus **retirer** de temps au salarié (l'entrée recule toujours) ni lui en
**ajouter** en fin de journée : la sortie comptée est la sortie badgée, exactement ce qu'écrit
NOTE_RH §3 (« sortie arrondie au réel »).

**Non-régression du moteur.** Minuit et les deux bascules DST ont été re-vérifiés implicitement par
la suite `badgeuse-engine.test.js` (46 → tests étendus, 0 échec) ; les résultats §4.2 et §4.3
restent valides, le calcul portant toujours sur les instants.

---

## 5. Statut des défauts après les boucles de correction n°1 et n°2

**Verdict de re-vérification finale : 13 / 13 défauts corrigés et prouvés.** La boucle 1 a corrigé
QA-01 → QA-12 (en introduisant QA-13) ; la boucle 2 a corrigé QA-13 sans régression. Un unique
résidu **mineur** est apparu (QA-14, bruit d'alerte — non bloquant).

| Id | Sévérité initiale | Statut | Preuve de la correction (re-vérifiée dans le code) |
|---|---|---|---|
| QA-01 | BLOQUANT | ✅ **CORRIGÉ** | Symétrie rétablie **dans les deux sens** : serveur `badgeuse-device.js:124` (`isSansBadge` : `null`/`''`/`-` valides) + `:193` (stocké `NULL`, `-` en forme canonique) ; poste `store.py:53` (`ACK_STATUSES` inclut `invalid`), purge + compteur persistant `store.py:283-309`, alerte `store.py:113-121`. Contrat aligné `CONTRAT_API_DEVICE.md:59-67`. |
| QA-02 | majeur | ✅ **CORRIGÉ** | `alerte` entre dans la liste blanche `badgeuse-device.js:439-452` (borné 300 car.), et ressort par poste dans `/devices` (`badgeuse.js`, `alerte: heartbeat_info.alerte`). Contrat `:143-148`. |
| QA-03 | majeur | ✅ **CORRIGÉ** | `heuresHebdoContractuelles()` + `engine.heuresTheoriquesMois()` alimentent la feuille (`badgeuse.js:729-757`), figées à la validation. Doctrine préservée : `source_theorique` exposé (`:803`, `:846`) et `ecart_heures` reste `null` si le théorique est nul (`:121`). |
| QA-04 | majeur | ✅ **CORRIGÉ** | E-mail réellement envoyé via `sendNotification` (`scheduler.js:870`), compteurs `emails`/`email_statut` retournés (`:907`) ; seuil lu en base (`:817`). `/devices` renvoie `{ silence_minutes, devices }` et le front consomme la nouvelle forme (`SupervisionPostes.jsx:318-319`), l'alerte (`:242,257`) et la vraie télémétrie (`:236-237`). |
| QA-05 | majeur | ✅ **CORRIGÉ** | Les deux paramètres produisent désormais un effet : `pointages_par_jour` alimente une détection d'anomalie (`badgeuse-engine.js:584-624`), `regularisation_delai_jours` un signalement de délai (`badgeuse.js:641-666`). |
| QA-06 | majeur | ✅ **CORRIGÉ** | Déduction plafonnée `badgeuse-engine.js:456` : `min(pause, max(0, brut − seuil))`. **Monotonie re-prouvée par exécution** (§4.4bis) : plus aucune régression sur 10 points de mesure. |
| QA-07 | majeur | ✅ **CORRIGÉ** | `deploy/chromium-policy.json` (`DeveloperToolsAvailability: 2`) installé dans **les deux arborescences de paquet** `/etc/chromium/policies/managed` et `/etc/chromium-browser/policies/managed` (`install.sh:254-256`) — couvre le chemin `cage` comme le repli X11. |
| QA-08 | mineur | ✅ **CORRIGÉ** | `canonicalPointage` lève sur champ vide ou séparateur (`badgeuse-crypto.js:143-146`), alignant le JS sur le Python. La levée est **captée par élément** (`badgeuse-device.js:213-216`) → accusé `invalid`, jamais un 503 de lot. |
| QA-09 | mineur | ✅ **CORRIGÉ** | `RuntimeWatchdogSec=15s` posé par `install.sh:322` (watchdog matériel), en complément du `WatchdogSec=90` applicatif. `README.md` corrigé. |
| QA-10 | mineur | ✅ **CORRIGÉ** | `arrondirInstant` (`badgeuse-engine.js:362`) : en `avantage_salarie`, l'entrée recule au pas, **la sortie est intouchée**. Re-prouvé (§4.4bis) : sortie 16:52 → comptée 16:52. Conforme à NOTE_RH §3. |
| QA-11 | mineur | ✅ **CORRIGÉ** | Seuil lu dans `badgeuse.supervision_silence_minutes` (`scheduler.js:817`, `badgeuse.js` `/devices`), défaut 15 min. |
| QA-12 | mineur | ✅ **CORRIGÉ** | Normalisation explicite en minuscules avant chaînage côté poste (`store.py:204` : `(uid_hmac or NO_BADGE).lower()`, `-` inchangé), + `:358`, `:385`. |
| QA-13 | BLOQUANT | ✅ **CORRIGÉ** (boucle 2) | Classification par SQLSTATE `badgeuse-device.js:152-157` (classes 22/23 hors 23505 → `invalid` ; **tout le reste, code absent compris → `retry`**) ; `retry` non inséré et **non accusé** ; arrêt du lot au premier incident transitoire `:392-396` ; `ROLLBACK TO SAVEPOINT` protégé (`savepointOk` faux → `retry` même sur 22/23, `:369`). Poste : `retry` exclu d'`ACK_STATUSES` (`store.py:54,60`), log INFO dédié (`sync.py:205-212`), alerte seulement si la file stagne > 1 h (`file_ancienne`, `sync.py:305`). **Cohérence du rejeu re-prouvée par exécution** (§5ter). |
| **QA-14** | **mineur** | 🟡 **NOUVEAU** | Un lot **entièrement** différé lève l'alerte générique « sans accusé exploitable » au lieu du chemin `retry` silencieux — voir §5ter. |

### Symétrie du contrat amendé — re-vérifiée par exécution

Les vecteurs croisés Node ↔ Python ont été **ré-exécutés** après modification de
`badgeuse-crypto.js` (ajout des levées QA-08) et de `store.py` (normalisation QA-12) :

| Vecteur | `chain_hash` Node | `chain_hash` Python | Identique ? |
|---|---|---|---|
| Badge, séq. 42 | `57e62b8f…17bd` | `57e62b8f…17bd` | **✅** |
| **Sans badge** (`-`), séq. 1, `manuel` | `e02d1475…46f4` | `e02d1475…46f4` | **✅** |
| Import, séq. 7 | `ba48fc9e…1546` | `ba48fc9e…1546` | **✅** |

Les trois condensats sont **inchangés** par rapport à l'itération 1 : les correctifs n'ont introduit
**aucune régression cryptographique**. La symétrie du cas amendé est vérifiée dans les deux sens :
le poste émet `uid_hmac: "-"` (`store.py:204`), le serveur l'accepte (`isSansBadge`), le stocke
`NULL` et **le recanonise en `-`** — donc `chainHash` serveur = `chain_hash` poste sur le pointage
sans badge, qui était le cas cassé de l'itération 1.

### 5ter. QA-13 — re-vérification finale (boucle 2) : **corrigé et prouvé**

**Classification serveur** (`badgeuse-device.js:152-157`) — doctrine « le doute profite à la
preuve » : un code SQLSTATE non conforme (absent, non-SQL, longueur ≠ 5) retombe sur `retry` ;
seules les classes **22** (données erronées) et **23** (violation de contrainte, hors `23505`
déjà traité en `duplicate`) sont jugées **permanentes** et accusées `invalid`. Les classes
transitoires qui causaient la perte (`57014` timeout, `53100` disque plein, `40*`, `08*`)
produisent désormais `retry`, **sans insertion et sans accusé**. Garde supplémentaire : si le
`ROLLBACK TO SAVEPOINT` lui-même échoue, l'état transactionnel est perdu et l'élément est différé
**même sur une classe 22/23** (`:369`).

**Traitement poste** — `retry` est **délibérément exclu** d'`ACK_STATUSES` (`store.py:54`, `:60`) :
jamais purgé, jamais compté comme invalide, log INFO dédié (`sync.py:205-212`). Une file qui ne
s'écoule réellement plus est détectée par **ancienneté** (fonction pure `file_ancienne`, seuil 1 h,
`sync.py:305`) et non par un retry isolé.

**Cohérence du rejeu — prouvée par exécution.** Scénario : lot de 5 pointages chaînés, incident
transitoire sur la séquence 3.

| Étape | Résultat mesuré |
|---|---|
| Lot 1 | séq. 1-2 insérées et **committées** ; séq. 3 `retry` (`erreur_transitoire`) ; séq. 4-5 `retry` (`lot_interrompu`) ; `break` puis `COMMIT` |
| File du poste | séq. 3-4-5 conservées ; `pending_batch` les rend **dans l'ordre croissant** de séquence (`store.py`, `ORDER BY sequence_device ASC`) |
| Lot 2 (rejeu) | séq. 3 → `chaine_valide = true` · séq. 4 → `true` · séq. 5 → `true` |
| Verdict | **CHAÎNE INTACTE APRÈS REJEU : OUI** — et statut `ok` (l'élément n'ayant jamais été inséré, il n'y a ni conflit d'`uuid` ni de séquence) |

**Contre-épreuve — l'arrêt du lot est load-bearing, pas une simple précaution.** En simulant le
comportement sans arrêt de lot (séquence 4 insérée alors que 3 est différée), le rejeu de la
séquence 3 donne **`chaine_valide = false`** : son `hash_precedent` ne correspond plus au dernier
hash stocké. L'arrêt du lot est donc ce qui **empêche un incident d'infrastructure de se
transformer en rupture de preuve permanente**. La justification portée en commentaire du code
(`:380-391`) est exacte et vérifiée.

### QA-14 — mineur — Un lot entièrement différé lève une alerte générique

**Constat.** Si l'incident transitoire frappe le **premier** élément d'un lot, tous les éléments
sont différés, donc `ack()` ne purge rien et `push_queue` entre dans la branche `purges == 0`
(`sync.py:172-177`), qui lève `« reponse serveur sans accuse exploitable — file conservee »`.
Cette branche ne distingue pas « le serveur n'a rien renvoyé d'exploitable » de « le serveur a
explicitement répondu `retry` », alors que `_log_resultats` documente précisément l'intention
inverse : « pas d'alerte heartbeat pour un retry isolé ».

**Conséquence.** Bruit d'exploitation : un simple à-coup de base de données sur le premier élément
d'un lot remonte une alerte au back-office, au lieu d'être absorbé silencieusement et laissé à la
détection par ancienneté (`file_ancienne`, > 1 h).

**Ce que ce n'est pas.** Aucune perte, aucun blocage, aucune boucle : la file est correctement
conservée, le `break` est justifié (inutile de réessayer le même lot immédiatement) et l'alerte
s'efface d'elle-même au premier lot suivant qui acquitte quelque chose. **Non bloquant.**

**Correctif proposé (non appliqué).** Dans la branche `purges == 0`, ne lever l'alerte que si le
lot ne contient **pas** que des `retry` :
```python
if purges == 0:
    if not resultats or any(r.get("status") != "retry" for r in resultats):
        self._raise_alert("reponse serveur sans accuse exploitable — file conservee")
    break
```

---

### QA-13 — fiche d'origine (itération 2) — ⚠️ CORRIGÉ depuis, voir §5ter

> **État actuel : CORRIGÉ** (boucle 2, HEAD `87331c8`). La fiche ci-dessous décrit le défaut **tel
> qu'il se présentait à l'itération 2** et est conservée pour la traçabilité de l'audit ; le code
> décrit n'existe plus. Ne pas la lire comme un constat courant.

**Titre d'origine : une erreur SQL transitoire détruit le pointage**

**Reproduction minimale.** Provoquer une erreur SQL non-`23505` **transitoire** sur l'`INSERT` d'un
élément de lot — le cas le plus réaliste étant un `57014 query_canceled` (dépassement de
`statement_timeout` sous contention, typiquement lors d'une salve type RP-5) ou un `53100 disk_full`.

`badgeuse-device.js:299-313` :
```js
} catch (e) {
  await client.query('ROLLBACK TO SAVEPOINT badgeuse_item');
  await client.query('RELEASE SAVEPOINT badgeuse_item');
  if (e.code === '23505') { … status: 'duplicate' … }
  else {
    console.error(…);
    rejeter(resultats, p.uuid, 'erreur_stockage');   // → status: 'invalid'
  }
}
```
`rejeter` (`:157-161`) émet `status: 'invalid'`. Or, depuis l'amendement v1.1, `invalid` est un
**accusé TERMINAL que le poste purge** (`store.py:53`, `:292`). Le pointage est donc **supprimé de
la file et jamais retransmis** : **l'heure est perdue définitivement et silencieusement.**

**Cause racine.** Le correctif de QA-01 a changé la sémantique de `invalid` (de « bloqué en file »
à « détruit »), mais la branche `erreur_stockage` a été conservée telle quelle. Le commentaire du
code (`:308-310`) ne raisonne que sur des causes **permanentes** (« FK d'un salarié supprimé,
dépassement de BIGINT ») ; le `else` capte en réalité **toutes** les autres classes de SQLSTATE,
y compris les transitoires `08*` (connexion), `40*` (deadlock/sérialisation), `53*` (ressources),
`57*` (annulation/timeout). Le raisonnement n'a pas couvert la classe d'erreurs où le rejeu
**réussirait**.

**Pourquoi c'est plus grave que QA-01.** QA-01 provoquait un encombrement de file **sans perte**
(l'heure restait sur le poste). QA-13 provoque une **perte sèche et silencieuse**, sur un
dispositif dont toute la doctrine affichée est « aucune heure ne se perd » et dont la finalité est
probatoire. La probabilité est faible mais la conséquence est irréversible et non détectable
a posteriori (le pointage n'existe plus nulle part).

**Correctif proposé (non appliqué).** N'accuser réception que des erreurs **déterministes** :
```js
const PERMANENTES = new Set(['22P02','22003','22007','22008','23502','23503','23514','23505']);
…
} else if (PERMANENTES.has(e.code)) {
  rejeter(resultats, p.uuid, 'erreur_stockage');      // terminal assumé
} else {
  // Transitoire : NE PAS accuser réception. L'élément est simplement omis de
  // `resultats` → le poste le conserve et le rejouera (PST-05).
  transitoires += 1;
}
```
L'omission de `resultats` est déjà correctement gérée par le poste : `ack` ne purge que les `uuid`
présents avec un statut d'accusé (`store.py:289`), et si aucun élément n'est acquitté,
`sync.py:167-172` lève l'alerte et cesse de boucler. Ajouter le compteur `transitoires` au log de
fin de lot et au heartbeat.

---

## 5bis. Tableau des défauts (itération 1 — historique)

> Les fiches détaillées ci-dessous sont celles de l'itération 1, conservées pour la traçabilité de
> l'audit. Leur statut après correction est donné au §5.

| Id | Sévérité | Titre |
|---|---|---|
| QA-01 | **BLOQUANT** | Statut `invalid` hors contrat : le poste ne le purge jamais et n'a aucune voie de sortie |
| QA-02 | majeur | Le champ `alerte` du heartbeat est silencieusement écarté par la liste blanche serveur |
| QA-03 | majeur | BO-04 : `heures_theoriques` n'est jamais calculé — « théorique » et « écart » vides à vie |
| QA-04 | majeur | BO-09 : aucune alerte e-mail, salle Socket.IO sans abonné, page sans rafraîchissement |
| QA-05 | majeur | Paramètres RH fantômes : `pointages_par_jour` et `regularisation_delai_jours` jamais consommés |
| QA-06 | majeur | Déduction de pause non monotone : 6 h 01 payées moins que 6 h 00 |
| QA-07 | majeur | PST-10 : DevTools Chromium non verrouillés (ni flag, ni politique gérée) |
| QA-08 | mineur | `canonicalPointage` serveur n'interdit ni champ vide ni séparateur `\|` (Python les rejette) |
| QA-09 | mineur | PST-09 : watchdog matériel absent (systemd seulement) |
| QA-10 | mineur | Arrondi de sortie au plafond alors que NOTE_RH écrit « sortie arrondie au réel » |
| QA-11 | mineur | Seuil de silence BO-09 codé en dur (15 min) |
| QA-12 | mineur | `uid_hmac` mis en minuscules côté serveur, pas côté Python (divergence latente) |

---

### QA-01 — BLOQUANT — Statut `invalid` hors contrat, jamais purgé

**Reproduction minimale.** Faire déposer par le poste un pointage **manuel** (sans badge), tel que
le prévoit `CONTRAT_INTEGRITE.md §2` et tel que `store.enqueue_pointage` le produit par défaut
(`store.py:147` : `uid_hmac: str = NO_BADGE` = `"-"`; sérialisé `store.py:179`) :

```json
{ "uuid": "…", "sequence_device": 12, "uid_hmac": "-", "sens": "entree", "source": "manuel", … }
```

Côté serveur (`badgeuse-device.js:154`) :
```js
if (!horodatage || !sens || (p.uid_hmac != null && p.uid_hmac !== '' && !isHex64(p.uid_hmac))) {
  resultats.push({ uuid: p.uuid, status: 'invalid', raison: 'champs_invalides' });
```
`"-"` n'est ni `null`, ni `""`, ni 64 hex → **`status: 'invalid'`**. Vérifié par exécution :
`"-"` ⇒ invalid · `""` ⇒ accepté · `null` ⇒ accepté.

Côté poste (`store.py:229-242`), `ACK_STATUSES = {ok, duplicate, orphan}` (`store.py:37`) :
`invalid` n'est pas un accusé → l'élément **n'est jamais supprimé de la file**.

**Cause racine.** Le contrat `CONTRAT_API_DEVICE.md §2.1` ne définit que trois statuts. Le serveur
en émet un **quatrième**, non spécifié, qui est **terminal côté serveur** (l'élément ne sera jamais
accepté, quel que soit le nombre de retransmissions) mais **non purgeable côté poste**. C'est
exactement la classe d'échec que l'en-tête du fichier prétend avoir éliminée
(`badgeuse-device.js:16` : « JAMAIS D'ÉCHEC SILENCIEUX »). Second chemin d'accès, indépendant du
pointage manuel : la branche `erreur_stockage` (`badgeuse-device.js:262`) transforme **toute**
erreur SQL non-`23505` en `invalid` (dépassement `BIGINT` sur `sequence_device`, violation de FK
sur un salarié supprimé entre la lecture du cache et l'insertion…).

**Conséquences.** L'élément est retransmis à chaque cycle indéfiniment ; `taille_file` ne revient
jamais à 0, ce qui **neutralise l'indicateur de file du heartbeat** (PST-07) et donc la capacité à
détecter une vraie accumulation ; l'alerte « réponse serveur sans accusé exploitable »
(`sync.py:169`) est levée localement mais **n'atteint jamais le serveur** (QA-02) — la panne est
invisible depuis le back-office.

**Correctif proposé (non appliqué).** Au choix, dans cet ordre de préférence :
1. **Ne jamais émettre `invalid` pour un élément que le poste ne pourra pas corriger** : stocker
   l'élément en `statut='orphelin'` avec `orphelin_raison='payload_invalide'` et répondre `orphan`
   — cohérent avec la doctrine « aucune heure ne se perd, on n'efface jamais une preuve ».
2. Accepter `"-"` comme synonyme d'absence de badge dans la validation (`badgeuse-device.js:154`),
   alignant le serveur sur `CONTRAT_INTEGRITE.md §2`.
3. À défaut, documenter `invalid` dans `CONTRAT_API_DEVICE.md §2.1` **comme accusé terminal** et
   l'ajouter à `ACK_STATUSES`, avec quarantaine locale (table `rejets`) pour conserver la preuve.

---

### QA-02 — majeur — L'alerte du poste est écartée en silence

`sync.py:253-256` ajoute `payload["alerte"] = self._last_alert` au heartbeat (« Extension au
contrat : l'anomalie remonte avec l'état du poste, jamais en silence »). Le serveur
(`badgeuse-device.js:382-392`) construit `info` par **liste blanche stricte** de 9 champs :
`alerte` n'y figure pas → la valeur est **jetée** avant l'`UPDATE`.

**Cause racine.** Extension unilatérale du contrat côté poste, non répercutée côté serveur ni dans
`CONTRAT_API_DEVICE.md §2.5`. La liste blanche est une bonne pratique (elle empêche l'arrivée de
données personnelles) — c'est son **désalignement** avec l'émetteur qui est le défaut.

**Correctif.** Ajouter `alerte` (chaîne bornée, ex. 200 car.) à la liste blanche et au contrat, la
journaliser (`console.warn`) et la remonter dans la supervision BO-09.

---

### QA-03 — majeur — BO-04 : « théorique » et « écart » ne sont jamais calculés

`heures_theoriques` n'apparaît qu'en **lecture** (`routes/badgeuse.js:715`, `:753`) et dans le
schéma (`init-db.js:6812`). **Aucun `INSERT`/`UPDATE` ne l'alimente**, et rien ne le dérive des
contrats. Le moteur est correct (`badgeuse-engine.js:445` : `ecart_heures = null` si le théorique
est nul — doctrine « jamais de valeur inventée » respectée), et l'UI affiche `—`
(`FeuillesTemps.jsx:90`). Résultat : la colonne « écart », qui est la **raison d'être** d'une
feuille de temps de validation, est vide en permanence.

**Cause racine.** Aucun raccordement à la source disponible : `employee_contracts.weekly_hours`,
déjà exploitée par `services/effectifs-engine.js` (quotité = heures hebdo / 35).

**Correctif.** Calculer le théorique mensuel depuis les périodes de contrat effectives (mêmes
règles que le moteur ETP), le stocker à l'`upsertFeuille`, et laisser `null` si aucun contrat ne
couvre la période (jamais de valeur inventée).

---

### QA-04 — majeur — BO-09 : supervision sans alerte ni temps réel

Trois constats cumulés :
1. **Aucune alerte e-mail.** `checkBadgeuseDevices` produit un `console.warn` et un `emit`
   Socket.IO. L'exigence BO-09 écrit « alerte e-mail si silence > 15 min ». Le projet dispose de
   Brevo (`services/notifications`), non utilisé ici.
2. **Salle Socket.IO morte.** Le serveur émet vers `badgeuse:supervision`
   (`badgeuse-device.js:245`, `scheduler.js` `device-offline`), mais **aucun handler de `join`
   n'existe** dans `index.js` et **aucun composant frontend n'ouvre de socket** (`grep socket`
   sur `components/badgeuse/` : aucun résultat). Les deux `emit` partent dans le vide.
3. **Page sans rafraîchissement.** `SupervisionPostes.jsx:292` charge une fois au montage ; ni
   `setInterval`, ni socket. L'état affiché est un instantané figé.

**Cause racine.** Canal temps réel conçu côté serveur, jamais raccordé côté client ; exigence
d'alerte poussée (e-mail) non implémentée.

**Correctif.** Envoyer l'e-mail via le service de notification existant (destinataires
paramétrables) ; puis, au choix, brancher la salle Socket.IO (handler `join` + abonnement client)
ou assumer un `setInterval` de 60 s et retirer les `emit` morts.

---

### QA-05 — majeur — Deux règles RH arbitrées mais sans effet

`badgeuse.pointages_par_jour` (défaut 4) et `badgeuse.regularisation_delai_jours` (défaut 5) sont
déclarés dans `BADGEUSE_SETTING_DEFAULTS` (`badgeuse-settings.js:28`, `:41`), donc exposés à
l'arbitrage RH dans `ParametresBadgeuse.jsx` — mais **consommés zéro fois** dans tout le backend
(vérifié par recherche sur `routes/`, `services/`, `utils/`, `scripts/`).

**Cause racine.** Paramètres repris de NOTE_RH §3 sans implémentation de la règle correspondante.
`pointages_par_jour` devrait piloter la détection d'anomalie « nombre de pointages inattendu » ;
`regularisation_delai_jours` devrait borner le délai de correction après la période.

**Conséquence.** La Direction arbitre et signe une règle qui ne produit aucun effet — exactement
le contraire de la promesse ADR-0002. Aggravé par le fait que l'écran d'arbitrage donne l'illusion
inverse.

**Correctif.** Soit implémenter les deux règles, soit les retirer de la grille et de l'écran
d'arbitrage jusqu'à implémentation.

---

### QA-06 — majeur — Déduction de pause non monotone

Voir la démonstration chiffrée §4.4 : **361 minutes travaillées sont payées 316 minutes**, contre
360 payées 360. Zone morte de 45 minutes.

**Cause racine.** Déduction **forfaitaire à seuil** (`badgeuse-engine.js:355-357`) sans garde de
monotonicité. L'implémentation est **fidèle à la lettre** de NOTE_RH §3 — le défaut est dans la
règle, pas dans le code. Il est néanmoins inacceptable en paie : deux salariés séparés d'une minute
de travail sont payés à 44 minutes d'écart, dans le sens défavorable au plus assidu, sur un
dispositif présenté comme probatoire.

**Correctif.** Plafonner la déduction pour préserver la monotonicité :
`minutes = max(seuil, brut − pause)` — au-delà du seuil, le compté ne peut jamais redescendre sous
le seuil. Décision à faire arbitrer et écrire par la Direction/RH **avant** la première paie, et à
répercuter dans la note d'information aux salariés.

---

### QA-07 — majeur — PST-10 : DevTools accessibles

Flags appliqués (`install.sh:249-255`) : `--kiosk --noerrdialogs --disable-translate
--disable-features=Translate --disable-session-crashed-bubble --disable-infobars --no-first-run
--disable-pinch --overscroll-history-navigation=0 --check-for-update-interval=…
--autoplay-policy=…`.

**Absents** : aucun verrouillage des outils de développement, et **aucune politique gérée**
(`/etc/chromium/policies/managed/*.json`). Un clavier USB branché sur le poste ouvre DevTools
(F12 / Ctrl+Maj+I), donnant accès à la page kiosque **et** au serveur local de l'agent
(`127.0.0.1:8766` HTTP, `127.0.0.1:8765` WebSocket — `ws_server.py:29`, correctement bornés à la
boucle locale, mais atteignables depuis la page).

**Atténuations réelles :** le **lecteur de badge est grabbé** (`EVIOCGRAB`, `reader.py:107`), ses
frappes n'atteignent donc pas Chromium ; `cage` n'expose aucun bureau ; l'attaque exige un accès
physique et un clavier.

**Cause racine.** Durcissement par flags de ligne de commande seulement, sans politique
d'entreprise — les flags ne couvrent pas DevTools.

**Correctif.** Déposer `/etc/chromium/policies/managed/badgeuse.json` avec
`{"DeveloperToolsAvailability": 2, "IncognitoModeAvailability": 1, "URLBlocklist": ["*"],
"URLAllowlist": ["http://127.0.0.1:8766/*"], "PrintingEnabled": false}` — verrouillage non
contournable par ligne de commande. Optionnellement, désactiver les périphériques HID non
appairés via une règle udev.

---

### QA-08 — mineur — Charge canonique serveur trop permissive

`chain.canonical` (Python, `chain.py:70-73`) **refuse** un champ vide et **refuse** un champ
contenant le séparateur `|`. `canonicalPointage` (JS, `badgeuse-crypto.js:107-119`) accepte les
deux : `String(o.uuid || '')` produit une chaîne vide sans erreur, et aucun contrôle du séparateur
n'est fait.

**Conséquence.** Ambiguïté canonique théorique : un poste malveillant pourrait construire deux
pointages distincts de charge canonique identique (`uuid="a|b", device_code="c"` vs
`uuid="a", device_code="b|c"`), affaiblissant la valeur probante de la chaîne. Non exploitable par
le poste légitime (le `device_code` est imposé par le serveur, `badgeuse-device.js:166`, et
`uuid`/`sens`/`source` sont validés en amont).

**Correctif.** Aligner le JS sur le Python : rejeter champ vide et séparateur dans
`canonicalPointage`, en faire un test de contrat partagé.

---

### QA-09 — mineur — PST-09 : watchdog matériel absent

`WatchdogSec=90` + `sd_notify` (`badgeuse-agent.service:29`) et `Restart=always` couvrent la
**défaillance applicative**. Aucun `RuntimeWatchdogSec` dans `/etc/systemd/system.conf`, aucun
`dtparam=watchdog=on` : un **gel du noyau** n'est pas récupéré. L'exigence dit « watchdog
matériel ». `README.md:222` déclare l'exigence couverte — déclaration non conforme au code.
**Correctif :** activer le watchdog matériel BCM (`dtparam=watchdog=on` + `RuntimeWatchdogSec=30`).

### QA-10 — mineur — Arrondi de sortie divergent de la note RH

NOTE_RH §3 écrit : « 5 min à l'avantage du salarié (entrée arrondie à l'heure de début planifiée si
arrivée en avance, **sortie arrondie au réel**) ». Le moteur arrondit la sortie **au plafond**
(`badgeuse-engine.js:271`). L'écart est **favorable au salarié** (jusqu'à +5 min/jour, ≈ +20 h/an)
mais diverge de la règle écrite et signée. **Correctif :** faire trancher (le paramètre
`arrondi_sens='reel'` existe déjà) et aligner la note.

### QA-11 — mineur — Seuil BO-09 codé en dur

`const SILENCE_MINUTES = 15;` dans `checkBadgeuseDevices`. Seuil d'exploitation, non règle RH — la
lettre d'ADR-0002 n'est pas violée, mais toute la grille badgeuse est paramétrée : l'exception
détonne. **Correctif :** `badgeuse.supervision_silence_minutes`.

### QA-12 — mineur — Casse de `uid_hmac` traitée différemment

Le serveur force `toLowerCase()` (`badgeuse-crypto.js:114`), le Python conserve la casse reçue
(`chain.py:68`). Sans effet aujourd'hui (`hexdigest()` produit toujours des minuscules), mais toute
source alimentant le poste en majuscules produirait deux condensats différents pour un même
pointage. **Correctif :** normaliser explicitement en minuscules dans `chain.canonical`, ou valider
via `is_valid_uid_hmac` (déjà écrit, `hmac_uid.py:58`, non appelé sur ce chemin).

---

## 6. Tests de robustesse **physique** — recette matériel obligatoire

Ces vérifications **ne peuvent pas** être faites en logiciel : elles engagent l'alimentation, la
thermique, l'horloge matérielle et le comportement réel de la carte. Elles conditionnent le GO.

### RP-1 — Coupures secteur × 20 (intégrité de la file et de la chaîne)

**Protocole.** Poste en service nominal, 5 pointages badgés déposés puis **coupure brutale de
l'alimentation** (retrait secteur, jamais `shutdown`), 30 s hors tension, remise sous tension,
attente du retour de l'écran de veille. Répéter **20 fois**. À chaque cycle, badger **pendant**
l'écriture (dans les 2 s suivant un bip) sur au moins 5 des 20 cycles.
**Instrumentation.** Avant/après : `sqlite3 /var/lib/badgeuse/badgeuse.db "SELECT COUNT(*) FROM queue"`,
`"SELECT sequence, last_hash FROM chain_state"`, et côté serveur
`GET /api/badgeuse/devices/:id/verify-chain`.
**Critères de succès (chiffrés).**
- **0** base SQLite corrompue (`PRAGMA integrity_check` = `ok` sur 20/20).
- **0** trou et **0** doublon dans `sequence_device` (suite strictement +1).
- `verify-chain` : **0** maillon rompu (`chaine_valide = false` sur 0 pointage).
- Nombre de pointages en base serveur = nombre de badges présentés (**perte = 0**).
- Retour à l'écran opérationnel en **≤ 90 s** sur 20/20.

### RP-2 — 24 heures hors ligne réelles (PST-05 / PST-08 / AFF-07)

**Protocole.** Débrancher le réseau (câble ou Wi-Fi désactivé côté point d'accès — **pas** une
règle de pare-feu locale, qui ne reproduit pas les délais TCP). Maintenir **24 h**. Faire badger
**≥ 40 pointages** répartis sur la période (dont 4 après 20 h d'isolement). Rebrancher, puis
observer 30 min.
**Critères.**
- Bandeau « hors ligne » affiché en **≤ 120 s** après la coupure, et masqué en **≤ 120 s** après
  rétablissement.
- Playlist de veille rejouée **sans interruption** pendant les 24 h (AFF-07).
- Backoff plafonné : intervalle entre deux tentatives **≤ 300 s** en régime établi (`journalctl -u
  badgeuse-agent`), **aucune** tentative en rafale.
- Après reconnexion : **100 %** des pointages remontés en **≤ 10 min**, `taille_file` **= 0**,
  **0** doublon côté serveur (contrôle par `uuid`), **0** rupture de chaîne.
- Espace disque consommé par la file **< 5 Mo** pour 40 pointages.

### RP-3 — Ventilateur entravé (thermique)

**Protocole.** Obstruer physiquement le ventilateur/ailettes (adhésif sur la grille, poste en
boîtier fermé, ambiante ≥ 25 °C). Charge : cycle de veille normal + 1 badge/minute pendant **2 h**.
Relever `temperature_cpu` et `throttled` du heartbeat toutes les minutes.
**Critères.**
- Le heartbeat **remonte effectivement** la montée en température (série non constante).
- `throttled = true` **est transmis** dès que `vcgencmd get_throttled` est non nul, et
  **journalisé** côté serveur (`badgeuse-device.js:413`).
- **Aucun redémarrage** du service ni du poste sur les 2 h.
- **0** pointage perdu ; latence bip ≤ 1 s même à `temperature_cpu` ≥ 80 °C.
- Retour sous 70 °C en ≤ 10 min après désobstruction.
> Test de supervision autant que de matériel : un throttling invisible est le mode de panne n°1.

### RP-4 — Bascule sur Raspberry Pi 3 (cible dégradée)

**Protocole.** Installer via `install.sh` avec `CIBLE=pi3` (1 Go de RAM, flags
`--renderer-process-limit=1 --js-flags=--max-old-space-size=96`, `MEMOIRE_AGENT=128M`). Repli X11
(`openbox`) si `cage` indisponible. Exercice de 4 h : 200 pointages + playlist de 10 éléments dont
2 images.
**Critères.**
- Démarrage complet (secteur → écran de veille) **≤ 180 s**.
- Empreinte mémoire agent **≤ 128 Mo** (`systemctl show -p MemoryCurrent`), **0** OOM-kill
  (`dmesg | grep -i oom` vide).
- Latence badge → overlay **≤ 1,5 s** au 95ᵉ centile (chronométrage vidéo, 30 mesures).
- **0** redémarrage de `badgeuse-kiosk` sur 4 h.
- Curseur masqué et **aucun accès au bureau** confirmés sous X11 (le repli openbox doit être
  vérifié séparément de `cage` — c'est un chemin de code distinct).

### RP-5 — Charge 30 badges / 60 s (file d'attente réelle)

**Protocole.** 30 personnes (ou 30 présentations successives de badges **distincts**) en 60 s,
cadence ~1 badge / 2 s, à l'embauche. Répéter 3 fois (matin, après pause, fin de poste). Inclure
**2 présentations doubles volontaires** (< 8 s) pour éprouver l'anti-rebond PST-02.
**Critères.**
- **30 pointages distincts** enregistrés par salve (les doubles < 8 s comptent pour 1 et affichent
  « déjà enregistré »).
- Latence badge → overlay **≤ 1 s** au 95ᵉ centile ; **aucun** overlay sauté.
- Sens (entrée/sortie) correct sur **30/30** (contrôle contre une feuille de présence papier).
- **0** collision de `sequence_device`, **0** rupture de chaîne.
- Retour sonore audible à 3 m sur 30/30 (AFF-04) ; lisibilité de l'overlay à 3 m validée par
  3 observateurs (AFF-03), **y compris par une personne portant une correction visuelle**.

### RP-6 — RTC pile vide (dérive d'horloge et valeur probante)

**Protocole.** Retirer la pile CR2032 du module DS3231 (`overlayfs-setup.sh:69` :
`dtoverlay=i2c-rtc,ds3231`). Couper le poste **12 h**. Redémarrer **sans réseau** (donc sans NTP).
Badger 3 pointages. Rétablir le réseau après 15 min. Répéter avec pile neuve pour comparaison.
**Critères.**
- Au démarrage sans RTC valide ni NTP, le poste **ne doit pas horodater silencieusement** avec une
  date fausse : `derive_estimee_sec` doit être remontée et l'anomalie visible.
- Après retour du réseau, la dérive est corrigée et **journalisée** côté serveur
  (`badgeuse-device.js:412`, seuil > 2 s).
- Les 3 pointages horodatés hors NTP sont **identifiables** (dérive connue) et rattrapables par
  correction BO-03 — **aucun n'est perdu**.
- Avec pile neuve : dérive **≤ 2 s** après 12 h hors tension.
> ⚠️ Ce test est le plus important pour la **force probante** : un horodatage faux et non signalé
> ruine la valeur du dispositif. Voir aussi QA-02 — vérifier que l'alerte remonte réellement.

**Matériel requis :** 2 postes (Pi 5 et Pi 3), 30 badges distincts, wattmètre/interrupteur secteur,
thermomètre d'ambiance, chronomètre vidéo, accès `journalctl` et `sqlite3` sur les postes.

---
## 7. Avis final — itération 3 (barrière logicielle)

# ✅ GO SOUS RÉSERVE — barrière logicielle levée

**Aucun défaut bloquant ni majeur ne subsiste.** Les **13 défauts** ouverts au cours de l'audit sont
**corrigés et prouvés dans le code** (§5) : QA-01 → QA-12 par la boucle 1, QA-13 par la boucle 2,
cette dernière **sans introduire de régression** (3 suites vertes, +22 tests backend, +11 tests
poste, 93/93 suites à chaque itération).

Le point qui a coûté deux boucles — la sémantique de l'accusé de réception — est désormais **sain
et démontré** :

- un pointage **sans badge** est accepté (`-` ⇄ `NULL`), et les condensats de chaîne restent
  **identiques au bit près** entre Node et Python sur les trois vecteurs, **inchangés depuis
  l'itération 1** malgré les modifications des deux piles ;
- une donnée **définitivement** non stockable est accusée `invalid`, purgée, **comptée et
  signalée** — jamais en silence ;
- un incident **transitoire** est différé (`retry`), **jamais accusé, jamais purgé** : le poste
  conserve l'heure et la représente ;
- le **rejeu après interruption préserve la chaîne d'intégrité**, ce qui a été prouvé par exécution
  **et par contre-épreuve** : sans l'arrêt de lot, le pointage différé serait rejoué avec une
  chaîne définitivement rompue (§5ter).

Autrement dit, les trois issues possibles d'un pointage — stocké, rejeté définitivement, différé —
sont désormais **explicites, symétriques entre les deux piles, et sans perte**. C'est l'invariant
central du module (« aucune heure ne se perd, aucune preuve n'est effacée ») ; il est tenu.

### Réserves (aucune n'est bloquante)

| # | Réserve | Nature |
|---|---|---|
| R1 | **QA-14** — un lot entièrement différé lève l'alerte générique « sans accusé exploitable » au lieu du chemin `retry` silencieux (§5ter). Correctif de 3 lignes proposé. | Bruit d'exploitation, auto-résorbé |
| R2 | **BO-05** — « absence non justifiée » non implémentée (les 4 autres types d'anomalie fonctionnent). | Exigence partielle |
| R3 | **AFF-03** — borne basse de police 38 px < 48 px exigés. Sans effet sur un écran kiosque 16:9 usuel (rendu plafonné à 84 px) ; **contraste ≥ 7:1 et lisibilité à 3 m à mesurer en recette** (RP-5). | À mesurer sur site |
| R4 | **PST-08 / AFF-04 / AFF-06** — bandeau hors ligne, retours sonores, transitions : implémentés, **non couverts par un test automatisé**. | Couverture de test |
| R5 | **BO-11** — le MANAGER (encadrant technique) n'est **pas restreint à son équipe**. Écart **assumé et documenté** (`routes/badgeuse.js:12-13`, précédent v2.12.0). | Décision à confirmer par le RH/DPO |
| R6 | Fuite de handle Jest masquée par `--forceExit` (`A worker process has failed to exit gracefully`). | Hygiène de test |

Aucune de ces réserves ne met en cause l'intégrité des données, la paie, la sécurité ni la
conformité. R1 et R6 relèvent du traitement courant ; R2 et R4 sont des compléments planifiables ;
R3 se vérifie en recette ; R5 est une décision d'organisation, pas un défaut technique.

### Portée de cet avis — et ce qui reste avant la mise en service

**Cet avis porte sur le logiciel seul.** Il ne vaut pas autorisation de mise en service.

La **recette matérielle RP-1 → RP-6 (§6) reste le préalable obligatoire au GO de mise en service
sur site**, et aucun de ces six tests n'est substituable par du logiciel :

- **RP-1 (coupures secteur ×20)** et **RP-6 (RTC pile vide)** conditionnent la **valeur probante**
  du dispositif : une base corrompue ou un horodatage faux non signalé ruinerait la preuve, quelle
  que soit la qualité du code.
- **RP-5 (charge 30 badges / 60 s)** garde une importance particulière : c'est le scénario qui met
  la base sous contention et donc **celui qui exerce réellement le chemin `retry` corrigé en boucle
  2**. Il doit être joué en vérifiant par **comptage contradictoire** (contre une feuille de
  présence papier) qu'aucun pointage n'a disparu, et en confirmant que la file revient à 0.
- **RP-2, RP-3, RP-4** valident respectivement le mode hors ligne 24 h, le comportement thermique
  et la cible dégradée Pi 3.

**Recommandation de séquencement :** livrer le correctif R1 (3 lignes) avec la campagne de recette,
puis exécuter RP-1 → RP-6 et tracer leurs résultats chiffrés en annexe du présent rapport avant la
décision de mise en service.

---

*Rapport établi par l'Agent A4 (QA/Debug). Itération 3 (finale) : les trois suites ont été
ré-exécutées, la classification SQLSTATE, la symétrie du contrat v1.2 et la cohérence du rejeu
(avec contre-épreuve) ont été prouvées par exécution réelle du code du dépôt à HEAD `87331c8`.
Aucun fichier de code n'a été modifié, aucun commit n'a été créé.*
