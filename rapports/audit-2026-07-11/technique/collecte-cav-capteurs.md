# Audit technique — Parc CAV, capteurs IoT & prédiction de remplissage

**Date** : 11 juillet 2026
**Périmètre code** : `backend/src/routes/{cav.js, association-points.js, alert-thresholds.js, ml.js}`, `backend/src/services/{liveobjects-api.js, liveobjects-mqtt.js, liveobjects-processor.js, predictive-ai.js, ml-model.js, event-discovery.js}`, `backend/src/utils/{milesight-em400mud.js, weather.js, lora-crypto.js}`, `backend/src/routes/webhooks.js`, `backend/src/scripts/{init-db.js, migrate-cav-sensors.js}`, pages `AdminCAV/FillRateMap/AdminSensors/AdminPredictive/CollectionProposals/DashboardCollecte`.
**Note globale** : **6.5 / 10** — ingénierie soignée par endroits (transactions, SQL paramétré, décodeur testé, sécurité webhook, diagnostic 4 couches), mais dette réelle : modèle IA déprécié, heuristiques dupliquées et divergentes, boucle d'apprentissage largement inerte, incohérences sémantiques ML, requêtes lourdes non cachées et couverture de tests fine sur le chemin critique.

---

## 1. Points forts

- **Décodeur Milesight isolé et testé** (`utils/milesight-em400mud.js`) : réécrit sans dépendance, TLV canal par canal, modèle de calibration **deux points** (`computeFillPercent`) rétro-compatible mono-point. Couvert par `tests/unit/utils/milesight-em400mud.test.js`. Bon exemple de code métier extractible et vérifiable.
- **Sécurité du webhook entrant** (`routes/webhooks.js`) : secret partagé comparé en temps constant (`crypto.timingSafeEqual` + contrôle de longueur), **fail-closed** si `LIVEOBJECTS_WEBHOOK_SECRET` absent (503), log d'IP sur échec. Le webhook est bien monté **hors** de `authenticate`.
- **Écritures multi-tables transactionnelles** : `processUplink` (`services/liveobjects-processor.js`) et la réaffectation de capteur (`cav.js` `POST /sensors/reassign`) utilisent `BEGIN/COMMIT/ROLLBACK` avec `pool.connect()`/`release()` corrects.
- **Idempotence de l'ingestion** : déduplication `(cav_id, fcnt)` via index unique partiel (`uq_sensor_readings_cav_fcnt`) **et** contrôle applicatif dans la transaction — protège du doublon webhook + MQTT simultanés.
- **Chiffrement des AppKey LoRaWAN** (`utils/lora-crypto.js`, AES-256-CBC, IV aléatoire) ; l'AppKey n'est jamais renvoyée (les `RETURNING` de provisioning listent des colonnes explicites, pas `*`).
- **Diagnostic capteur 4 couches** (`cav.js` `GET /:id/sensor-diagnostic`) : outil d'exploitation réellement utile (sonde / Live Objects / réception / BDD), avec détecteur de « lecture figée » et recommandations ciblées.
- **SQL entièrement paramétré** ($1/$2) sur tout le périmètre — aucune injection SQL détectée.
- **Frontend cohérent** : pages en `React.lazy` + `ProtectedRoute roles`, service `api` centralisé, temps réel Socket.IO avec repli polling (`FillRateMap` 60 s, `DashboardCollecte` 30 s), dégradation gracieuse (`.catch(() => …)`) sur les appels optionnels (`AdminPredictive`, `AdminSensors`).

---

## 2. Constats par axe

### 2.1 Qualité & cohérence

- **P1 — Modèle Claude déprécié par défaut** (`services/predictive-ai.js:19`) : `CLAUDE_MODEL || 'claude-sonnet-4-20250514'`. Le CLAUDE.md documente à plusieurs reprises que ce modèle déprécié cause des 404 et que les autres services IA ont migré vers `claude-sonnet-5`. Les 3 fonctions (`analyseHebdomadaire`, `recommanderAjustements`, `predictionEnrichie`) échouent donc silencieusement tant que `CLAUDE_MODEL` n'est pas surchargé côté serveur.
- **P1 — Heuristiques saisonnières dupliquées et divergentes** : `cav.js` contient **trois** jeux de facteurs codés en dur qui ne concordent pas — `/map:78` et `/fill-rate:141` partagent un tableau, mais `/:id/activity:531` en utilise un **autre** (`SEASONAL`) plus un tableau `DOW:532`. Pire, la **formule** de remplissage diffère entre `/map` (`rawFill = jours·accumulation/nb_containers·100`, ligne 87) et `/fill-rate` (`accumulatedKg/capacityKg·100`, capacité `nb·150`, lignes 158-164) : deux endpoints renvoient des taux « estimés » différents pour le même CAV. À cela s'ajoutent `predictive-ai.recalcSeasonalFactors` (table `predictive_seasonal_factors`) et `tours/predictions.getSeasonalFactors` : au moins 3-4 sources de facteurs non coordonnées, sans référentiel unique. Valeurs magiques (150 kg/conteneur, seuils 40/80 %) éparpillées.
- **P2 — `cav.js` fichier fourre-tout de 1534 lignes / 69 Ko** : un seul routeur mêle CRUD, QR codes, photos, flotte capteurs, provisioning, calibration, diagnostic et prévision. À découper (`cav/crud`, `cav/sensors`, `cav/diagnostic`) pour la maintenabilité.

### 2.2 Dette technique

- **P1 — Boucle d'apprentissage « vérité terrain » largement inerte** : `processUplink` n'écrit un feedback que `if (previousFill != null)`, où `previousFill = cav.estimated_fill_rate` (`liveobjects-processor.js:175`). Or **aucun code n'écrit jamais `estimated_fill_rate`** (recherche exhaustive : 0 affectation runtime) → la colonne reste nulle → les lignes de feedback capteur ne sont quasi jamais créées. De plus, les requêtes d'exactitude de `predictive-ai.getHistoricalData` filtrent `observed_fill_level IS NOT NULL` (échelle 0-5, écrite par `tours/execution.js`), ce qui **exclut** les lignes capteur (qui remplissent `observed_fill_rate`, laissant `observed_fill_level` nul). La donnée capteur, présentée comme la plus fiable, est donc écartée des métriques principales, et son insertion échoue en silence si les colonnes manquent (`processor:238`, `catch` muet).
- **P2 — Divergence schéma ↔ code (source de vérité)** : `init-db.js:1158` définit `collection_learning_feedback` **sans** `observed_fill_rate` ni `source` ; ces colonnes ne sont ajoutées que par `migrate-cav-sensors.js:87-95`, et une **troisième** définition inline existe dans `index.js:528`. Le défaut d'intervalle de reporting diverge aussi (init-db 180 vs migrate `DEFAULT 360`). Un lecteur d'`init-db.js` voit un schéma incomplet/faux.
- **P2 — Cache modèle ML non invalidé** (`routes/ml.js:8`, `cachedModel`) : rechargé seulement à l'entraînement dans le même process, sans TTL → stale en multi-conteneurs.

### 2.3 Sécurité

- **P2 — Exposition de données sensibles par `SELECT *`** : `GET /api/cav` (`cav.js:42`) et `GET /:id` (`:839`) renvoient toutes les colonnes, dont `lora_appkey_encrypted`, `lora_appeui` et `qr_code_data`, à **tout utilisateur authentifié** (le routeur n'a que `authenticate`, aucun `authorize` sur ces GET — donc les 6 rôles, y compris AUTORITE/RESP_BTQ). Le module véhicules strippe pourtant `qr_token` des GET par défense en profondeur (cf. CLAUDE.md) ; le même durcissement manque ici pour le blob AppKey et le secret QR.
- **P2 — GET à effet de bord côté ML** : `GET /api/ml/predict/:cavId` et `GET /api/ml/predict-batch` (`ml.js:285,354`) exécutent des `INSERT/UPSERT`. `predict-batch` n'exige que `authenticate` (aucun `authorize`) : n'importe quel rôle peut déclencher une prédiction sur **tous** les CAV, non throttlée. Combiné au N+1 (ci-dessous), c'est une surface de charge involontaire et une entorse REST.
- **P2 — Validation d'entrée faible sur routes héritées** : `POST /scan-qr` et `POST /sensor-reading` (`cav.js:275,1000`) sont authentifiés mais sans rôle ; `latitude`/`longitude` ne sont pas typés/validés. Risque faible (chemin legacy, le vrai flux passe par le webhook signé).

### 2.4 Robustesse

- **P1 — Requêtes lourdes non cachées et pollées** : `GET /cav/fill-rate` calcule, **par CAV actif**, 4 sous-requêtes corrélées **plus** une auto-jointure à double `ROW_NUMBER()` pour `avg_days_between` (`cav.js:124-133`). Sur ~209 CAV c'est coûteux, et `FillRateMap` l'appelle toutes les 60 s ; `/cav/map` est du même acabit (2 sous-requêtes/ligne). Aucun cache, recalcul intégral à chaque appel.
- **P1 — N+1 sur `ml/predict-batch`** (`ml.js:371`) : boucle sur tous les CAV, chaque `buildFeatures` émet 4 requêtes séquentielles + 1 upsert → ~5N requêtes série pour un seul appel.
- **P2 — Scraping HTML fragile** (`event-discovery.js`) : `parseVideGreniersHTML`/`parseBrocabracHTML` reposent sur des regex sur du HTML tiers (vide-greniers.org, brocabrac.fr) — cassera en silence au moindre changement de balisage (`.catch(() => [])` par source). `discoverNearAllCAVs` traite les ~209 CAV **en série** avec `setTimeout(500 ms)` × 3 sources → cron très long, non parallélisé.
- **P2 — `geocodeAddress` sans timeout** (`association-points.js:16`) : `https.get` sans `timeout` ni suivi de redirection, **attendu** dans `POST`/`PUT` → un géocodeur lent bloque la création/modification du point.
- **P2 — Décodeur : cas limites** (`milesight-em400mud.js`) : le repli « canal inconnu » avance d'1 octet (`:109`, risque de désynchronisation) ; `readInt16LE/readUInt16LE` ne bornent pas l'offset (payload tronqué → `NaN`). Chemin nominal testé, cas dégradés non couverts.
- **P2 — Course concurrente sur ingestion** : sous webhook + MQTT simultanés, deux uplinks de même `fcnt` peuvent tous deux passer le `SELECT` de dédup puis entrer en collision sur l'index unique → l'une des requêtes renvoie **500** au lieu d'un `deduplicated` propre.

### 2.5 Testabilité

- **P1 — Chemin critique non testé** : seuls les utilitaires purs sont couverts (`milesight-em400mud.test.js`, `base24.test.js`). **Aucun test** pour `processUplink` (ingestion + dédup + calcul fill + alertes + Socket.IO), la garde de secret du webhook, `predictive-ai`, `ml.js`, ni `event-discovery`. Ce sont pourtant les zones à plus forte valeur/risque. Le décodeur est le seul maillon vérifié de bout en bout.

---

## 3. Recommandations priorisées

| # | Priorité | Effort | Action |
|---|----------|--------|--------|
| 1 | **P1** | **S** | Aligner le défaut de `predictive-ai.js:19` sur `claude-sonnet-5` (comme les autres services IA) ; sinon documenter `CLAUDE_MODEL` obligatoire. |
| 2 | **P1** | **M** | Réparer/clarifier la boucle d'apprentissage capteur : abandonner la dépendance à `estimated_fill_rate` (jamais écrite) comme déclencheur, et faire remonter `observed_fill_rate` (source `sensor`) dans les métriques d'exactitude — ou documenter explicitement que la vérité terrain n'alimente pas encore la calibration. Supprimer les `catch` muets qui masquent l'échec d'insertion. |
| 3 | **P1** | **M** | Centraliser les facteurs saisonniers/jour et la capacité (150 kg) dans **un seul** module partagé ; faire converger `/cav/map` et `/cav/fill-rate` sur la même formule ; brancher `predictive_seasonal_factors` réellement calculé au lieu des tableaux codés en dur. |
| 4 | **P1** | **M** | Réécrire `/cav/fill-rate` et `/cav/map` en jointures ensemblistes (agrégats groupés) au lieu de sous-requêtes corrélées par ligne, et ajouter un cache court (déjà disponible : `cacheMiddleware`, TTL ~60 s) pour les endpoints pollés. |
| 5 | **P1** | **S** | `ml/predict-batch` : restreindre à `authorize('ADMIN','MANAGER')`, précharger les CAV en 1 requête (supprimer le N+1) et n'écrire les prédictions que sur un POST explicite (séparer lecture/écriture). |
| 6 | **P1** | **M** | Tests d'intégration prioritaires : `processUplink` (formats aplati + LoRa, dédup `fcnt`, calcul fill deux points, alertes seuils) et la garde de secret du webhook. |
| 7 | **P2** | **S** | Stripper `lora_appkey_encrypted`/`lora_appeui`/`qr_code_data` des `GET /cav` et `GET /cav/:id` (whitelist de colonnes), à l'image du traitement `qr_token` des véhicules. |
| 8 | **P2** | **S** | Réconcilier le schéma `collection_learning_feedback` : intégrer `observed_fill_rate`/`source` dans la définition canonique `init-db.js` et supprimer la définition inline dupliquée d'`index.js`. |
| 9 | **P2** | **S** | `geocodeAddress` : ajouter un `timeout` (et suivi de redirection) ; envisager un géocodage asynchrone pour ne pas bloquer la création de point. |
| 10 | **P2** | **L** | Découper `cav.js` (1534 lignes) en sous-routeurs `cav/crud`, `cav/sensors`, `cav/diagnostic` ; extraire les helpers de prévision. |

---

## 4. Conclusion

Le module combine des fondations solides — décodeur capteur testé, webhook sécurisé, ingestion transactionnelle et idempotente, diagnostic d'exploitation soigné — avec une couche prédictive qui accumule de la dette : un modèle IA déprécié par défaut, des heuristiques saisonnières éclatées et contradictoires, une boucle d'apprentissage « vérité terrain » qui ne se referme quasiment jamais, et un modèle ML dont la cible (kg/conteneur) est présentée comme un taux de remplissage borné 0-100. S'y ajoutent des requêtes lourdes non cachées pollées toutes les minutes, un N+1 sur les prédictions batch et une couverture de tests concentrée sur le seul décodeur. Aucune vulnérabilité critique (SQL paramétré, secrets chiffrés, webhook robuste), mais des durcissements de défense en profondeur (SELECT *, GET à effet de bord) et surtout un effort de **convergence des heuristiques** et de **fiabilisation de la boucle capteur → apprentissage** restent à mener pour que la promesse « prédiction de remplissage » soit réellement tenue.
