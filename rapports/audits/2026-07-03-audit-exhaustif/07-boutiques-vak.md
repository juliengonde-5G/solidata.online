# Audit exhaustif SOLIDATA — Rapport 07 : Boutiques (retail 2nde main) & Vente au Kilo (VAK / SumUp)

> Date : 3-4 juillet 2026 · Périmètre : modules 26 (Boutiques) et 27 (Vente au Kilo).
> Méthode : lecture intégrale de `backend/src/routes/{boutiques,boutique-ventes,boutique-commandes,boutique-objectifs,boutique-meteo,vak}.js`, `backend/src/services/{sumup,scheduler}.js`, `backend/src/utils/weather.js`, `backend/src/scripts/init-db.js` (tables 3431-3829), `backend/src/middleware/auth.js`, `backend/src/index.js` (montage), et des pages frontend `Boutiques{Dashboard,Ventes,Commandes,Planning,Objectifs,Import}` + `Vak{Performance,Annuel,Sessions,Live,Journee,SumupConfig}`.
> Toute affirmation est référencée `fichier:ligne`. Aucun fichier de code n'a été modifié.
>
> Renvois : le rapport 01 (sécurité transverse) couvre le montage des webhooks et le fallback `JWT_SECRET`. Le rapport 08 (UX) note déjà que le Dashboard d'accueil ignore `RESP_BTQ` (MODULE_CARDS sans modules 26/27) et que `/admin/pennylane-config` est orpheline — cités ici sans re-développement.
> Acquis corrigés **pendant l'audit** (ne pas recompter) : le rôle `RESP_BTQ` refusé par `POST /api/users` + absent de `Users.jsx`/`StatusBadge` a été corrigé.

---

## 0. SYNTHÈSE

Deux modules de maturité inégale. **Boutiques** : chaîne d'ingestion CSV LogicS solide sur le papier (double garde-fou SHA-256 + chevauchement de dates, reconstruction ticket, 8 KPI retail) mais **le canal d'import temps réel documenté (webhook e-mail Power Automate) est mort** (piégé derrière `authenticate`), et **aucun cloisonnement par boutique** n'existe (fuite horizontale inter-boutiques). **VAK/SumUp** : intégration OAuth 2.0 + webhook HMAC + Socket.IO live nettement plus soignée (webhook correctement monté avant `authenticate`, chiffrement AES-256-GCM, idempotence par `xmax`), mais souffre de **présomptions de calcul** (TVA 20 % en dur, classification CB/espèces par `ILIKE` sur des libellés SumUp non vérifiés) et d'un **axe horaire en UTC** qui décale toute l'analyse d'affluence.

| Sévérité | Nombre | Numéros |
|----------|--------|---------|
| CRITIQUE | 0 | — |
| HIGH | 3 | A1, A2, A3 |
| MEDIUM | 9 | A4–A11, A19 |
| LOW | 6 | A12–A17 (+ A18 note doc) |

---

## 1. PROMESSE vs RÉALITÉ

| Promesse (CLAUDE.md mod. 26/27 + historique 1.4.0→2.1.0) | Réalité code | Statut |
|---|---|---|
| Import CSV LogicS **formats 10 et 11 colonnes** auto-détectés | `boutique-ventes.js:146-156` détecte `Num_Ticket` dans l'en-tête, sinon compte les colonnes | ✅ conforme |
| **Num_Ticket** réel privilégié, sinon **minute-key** de reconstruction | `boutique-ventes.js:201` `mk = numTicket ? T<num> : minuteKey()` | ⚠️ conforme mais clé sans date → **A3** |
| **SHA-256 anti-doublon** | `boutique-ventes.js:83-96` + garde chevauchement de dates 102-131 | ✅ robuste (double garde) |
| Import **auto par e-mail** (Power Automate → webhook temps réel) | `boutique-ventes.js:823` **derrière** `router.use(authenticate)` (l.26) → 401 sans JWT | ❌ **A1 — canal mort** |
| Import auto **par scan de dossier** | `scheduler.js:679 scanBoutiqueCSVFolders` (runAllJobs 7/12/18h) | ✅ c'est le **vrai** canal auto qui marche |
| **Dashboard 3 niveaux** jour/mois/année | endpoints `/analytics/{daily,monthly}`, `/kpis`, `/hourly`, `/evolution` + budget | ✅ (voir §4 pour l'usage) |
| **8 KPI retail** (panier moyen, IPT, part promo CA/volume, taux attache sac, TVA, prix moyen article, durée ticket) | `boutique-ventes.js:575-658` | ⚠️ présents mais **panier moyen incohérent** (A5) et objectif HT vs réalisé TTC (A4) |
| **Heatmap** fréquentation jour×heure | `boutique-ventes.js:682-694`, `vak.js:315-322` | ⚠️ axe horaire **UTC** (A6) |
| **Comparaison N-1** | Boutiques `/evolution` = **période adjacente précédente** (pas N-1) ; VAK `/comparison` = même mois an-1 (correct) | ⚠️ libellé « N-1 » trompeur côté boutiques (A18) |
| **Commandes par lot/poids**, state machine 5-6 statuts, rôle RESP_BTQ | `boutique-commandes.js` moteur `state-machine`, verrou `FOR UPDATE` (l.48) | ✅ solide |
| **Objectifs mensuels % atteinte** | `boutique-objectifs.js` + `boutiques.js:151` budget | ⚠️ HT vs TTC (A4) |
| **Corrélation météo/CA** | `boutique-meteo.js:28`, `utils/weather.js` (Open-Meteo Europe/Paris) | ✅ (météo Paris, mais ventes UTC → axes désalignés, A6) |
| VAK : **OAuth SumUp** authorize→token→**refresh auto** | `sumup.js:116-212`, refresh à T-60s (l.205) | ⚠️ pas de verrou → race (A9) |
| VAK : **sync incrémentale** transactions history | `sumup.js:568-648` cursor = dernier `newest_time` | ✅ (garde-fou 50 pages) |
| VAK : **webhook HMAC signé** + Socket.IO live salle `vak:live:<id>` | `vak.js:74` (public, avant auth), HMAC `sumup.js:256-266`, emit `sumup.js:796-802` | ✅ bien fait |
| VAK : **chiffrement AES-256-GCM** des tokens | `sumup.js:45-65` (`v1:iv:tag:enc`) | ✅ |
| VAK : **parser CSV 17 colonnes** date FR « 15 mai 2026 10:15 » | `sumup.js:303-317, 344-527` | ✅ (mais re-import duplique les lignes, A7) |
| VAK : **KPI poids kg / €-par-kg / mix paiement** | `vak.js:243-301` | ⚠️ €/kg OK ; mix CB/espèces fragile (A10) |
| VAK : **écran TV kiosk** `/vak/live` | `vak.js:629 /live/current` + `VakLive.jsx` | ⚠️ auth ADMIN/MANAGER sur un mur (§4, robustesse) |
| VAK : **comparaisons N-1 / YTD** | `vak.js:368-447` | ✅ conforme |

---

## 2. ANOMALIES (sévérité · fichier:ligne · preuve · impact · correctif)

### A1 — HIGH — Le webhook d'import e-mail des boutiques est inatteignable (401)
- **Preuve** : `boutique-ventes.js:26` `router.use(authenticate)` s'applique à **toutes** les routes suivantes, dont `POST /webhook-email` (l.823) qui prétend pourtant « Authentifié par clé secrète (header X-Webhook-Secret), **sans JWT** » (l.807). `middleware/auth.js:14-31` exige un `Bearer` **sans aucune exception de chemin**. Le webhook n'est monté nulle part avant `authenticate` (index.js:249 monte le routeur entier ; `routes/webhooks.js` ne contient aucun handler boutique — vérifié). Contraste probant : le webhook VAK est, lui, monté **avant** `router.use(authenticate)` (`vak.js:74` vs `153`).
- **Impact** : Power Automate (qui n'a pas de JWT) reçoit **401 avant même** la vérification `X-Webhook-Secret`. Le canal d'import « temps réel » documenté ne fonctionne pas. Aggravant : le commentaire scheduler (`scheduler.js:617`) pointe Power Automate vers `POST /api/boutique-ventes/webhook` — **chemin qui n'existe pas** (le vrai est `/webhook-email`). Seul le scan de dossier (`scanBoutiqueCSVFolders`) importe réellement, et uniquement si les fichiers atterrissent sur le **système de fichiers serveur** (`csv_folder_path`), pas par e-mail.
- **Correctif** : monter `POST /webhook-email` **avant** `router.use(authenticate)` (comme VAK), ou l'extraire dans `routes/webhooks.js`. Corriger le chemin/commentaire scheduler.

### A2 — HIGH — Aucun cloisonnement par boutique (fuite horizontale inter-boutiques)
- **Preuve** : tous les routeurs boutique n'ont que `router.use(authenticate)` sans filtrage par propriétaire. `boutiques.js:13` (GET liste toutes) et `:38` (GET n'importe laquelle) ; `boutique-ventes.js:389,411,466,492,575,663,706,777` (analytics de **n'importe quel** `boutique_id` en query) ; `boutique-commandes.js:139` (liste), `:228` (POST crée pour n'importe quel `boutique_id` en body), `:378` (annuler) autorisent `RESP_BTQ` ; `boutique-objectifs.js:11,29`. La colonne `boutiques.responsable_id` (`init-db.js:3441`) existe mais **n'est jamais utilisée** pour restreindre les requêtes à `req.user`.
- **Impact** : un `RESP_BTQ` de St-Sever peut lire tout le CA/tickets/objectifs de L'Hôpital via `?boutique_id=<autre>`, et **créer/annuler des commandes** sur une autre boutique. Confidentialité + intégrité opérationnelle. Pour un ERP multi-boutiques destiné à s'étendre, c'est une absence de cloisonnement locataire.
- **Correctif** : middleware qui, si `req.user.role === 'RESP_BTQ'`, force `boutique_id ∈ {boutiques WHERE responsable_id = req.user.id}` (ou claim `boutique_id` sur le JWT) ; rejeter 403 sinon.

### A3 — HIGH (conditionnel) — Fusion de tickets inter-jours au format 11 colonnes
- **Preuve** : au format neuf, la clé de regroupement est `mk = T<num_ticket>` (`boutique-ventes.js:201`) **sans composante de date**, stockée dans la colonne `minute_key` (l.237). La table impose `UNIQUE(boutique_id, minute_key)` (`init-db.js:3496`) et l'UPSERT est **additif** (`ON CONFLICT ... nb_articles = ... + EXCLUDED.nb_articles`, l.239-243). Un fichier par boutique **par jour** est importé quotidiennement (batch distinct).
- **Impact** : si les numéros de ticket LogicS **se réinitialisent** (comportement courant des caisses : ticket #1, #2… par jour), le ticket « 45 » du jour 2 **fusionne** dans le ticket « 45 » du jour 1 : `nb_articles`/`total` additionnés, `date_ticket` figée au jour 1. Conséquences : `nb_tickets` sous-compté, panier moyen gonflé, analyses par date de ticket faussées. La correction se réclame de la promesse V1.4.1 (« distinguer les tickets chevauchant la même minute ») mais l'échange minute→num_ticket a introduit une collision inter-jours.
- **Correctif** : intégrer la date dans la clé (`T<YYYY-MM-DD>-<num>`) ou cibler `ON CONFLICT (boutique_id, num_ticket, DATE(date_ticket))`. À défaut de connaître le schéma de numérotation LogicS, c'est une hypothèse d'unicité globale non défensive.

### A4 — MEDIUM — Objectif/budget HT comparé au réalisé TTC
- **Preuve** : objectifs stockés en **HT** (`ca_objectif_ht`, renommé depuis `ca_objectif_ttc` par migration `init-db.js:3676-3689`). Mais `boutiques.js:182-183` : `ca_total_realise = Σ ca_ttc` vs `ca_total_objectif = Σ ca_objectif_ht`. `boutique-objectifs.js:36` (objectif HT) comparé l.46 à `SUM(total_ttc)` (réalisé TTC). Idem `panier_moyen_objectif` vs panier TTC (l.49).
- **Impact** : le « % d'atteinte » mélange HT et TTC → biais systématique de l'ordre du taux de TVA. Un responsable croit atteindre l'objectif alors qu'il manque la marge de TVA (ou l'inverse selon la saisie).
- **Correctif** : comparer à grandeurs homogènes (HT vs HT ou TTC vs TTC) ; expliciter l'unité dans l'UI.

### A5 — MEDIUM — « Panier moyen » calculé de trois façons différentes
- **Preuve** : `boutique-ventes.js:554` `/analytics/panier-moyen` = `AVG(total_ttc)` (TTC) ; `:623` `/analytics/kpis` = `AVG(total_ht)` (HT) ; `:451` `/analytics/monthly` = `SUM(total_ht)/COUNT(tickets)` (HT). Le glossaire CLAUDE.md définit panier moyen = **CA TTC / tickets**.
- **Impact** : selon la carte/vue, le panier moyen affiché diffère (écart = taux de TVA) → incohérence visible pour l'utilisateur.
- **Correctif** : une seule définition (TTC conforme au glossaire), factorisée.

### A6 — MEDIUM — Analyse horaire/heatmap en UTC, désalignée de la météo (Europe/Paris)
- **Preuve** : toutes les colonnes temporelles sont `TIMESTAMP` **sans fuseau** (`init-db.js:3489,3509,3750,3773`). Les ventes VAK API sont des instants UTC (`new Date(tx.timestamp)`, `sumup.js:653`) ; `EXTRACT(HOUR FROM date_ticket)` (`boutique-ventes.js:669`, `vak.js:307,573`) renvoie donc l'heure **UTC**. La météo, elle, est demandée en `timezone=Europe/Paris` (`weather.js:52,89`) et l'heure est extraite du libellé local (`weather.js:102`).
- **Impact** : la heatmap d'affluence est décalée de 1-2 h (une boutique ouverte 10-18 h Paris apparaît active 8-16 h), et l'axe horaire ventes ≠ axe horaire météo → la « corrélation » horaire compare des heures différentes.
- **Correctif** : `EXTRACT(HOUR FROM date_ticket AT TIME ZONE 'Europe/Paris')`, et normaliser l'ingestion (ou passer en `timestamptz`).

### A7 — MEDIUM — Ré-import CSV VAK duplique les lignes `vak_ventes`
- **Preuve** : dans le chemin CSV (`sumup.js:476-514`), le ticket est UPSERT (remplace l'en-tête) mais les lignes sont **ré-insérées sans suppression préalable** (l.503-513) ; le commentaire l.502 mise sur le CASCADE au niveau **batch**, pas ticket. Le chemin API, lui, fait `DELETE FROM vak_ventes WHERE ticket_id = $1` avant ré-insertion (`sumup.js:745`). `vak_ventes` n'a **aucune** contrainte d'unicité (`init-db.js:3768-3789`).
- **Impact** : deux fichiers qui se recouvrent (ré-export correctif) ou CSV+API sur la même transaction → **lignes dupliquées**. Les analytics lisant `vak_ventes` (`vak.js:330 segments`, `:587 segments-trend`) double-comptent, alors que les KPI au niveau ticket restent justes → incohérence CA segments vs CA total.
- **Correctif** : `DELETE FROM vak_ventes WHERE ticket_id = $1` avant ré-insertion dans le chemin CSV aussi (une ligne).

### A8 — MEDIUM — TVA 20 % **en dur** dans l'ingestion API SumUp
- **Preuve** : `sumup.js:691-692` (fallback sans line_items) `total_ht = totalTTC/1.2`, `total_tva = totalTTC - totalTTC/1.2` ; `:704-706` (par ligne) `tva = it.vat_amount || lineTTC - lineTTC/1.2`, `taux = it.vat_rate || 20`.
- **Impact** : une SIAE textile / vente au kilo relève probablement d'un taux réduit ou d'une exonération ; imposer 20 % fausse `ca_ht` et `tva_collectee` (KPI affichés). Le chemin CSV utilise les vraies colonnes TVA (mieux).
- **Correctif** : n'utiliser que la TVA renvoyée par SumUp ; si absente, taux configurable (setting) plutôt que 20 % implicite.

### A9 — MEDIUM — Race condition sur le refresh du token SumUp
- **Preuve** : `sumup.js:203-212 getValidAccessToken` teste l'expiration et appelle `refreshAccessToken` **sans verrou**. Deux appelants concurrents (webhook temps réel + `syncVakSumUp` scheduler, `scheduler.js:633`) peuvent tous deux voir le token expiré et POST `/token` avec le **même** refresh_token. SumUp effectue une rotation du refresh_token → le second appel présente un refresh_token déjà consommé (400) et peut écraser un token valide (`persistTokens`, l.168-175).
- **Impact** : un cycle de sync échoue ; au pire, désynchronisation des tokens imposant une re-autorisation OAuth manuelle (ADMIN).
- **Correctif** : single-flight (mutex mémoire) ou `pg_advisory_lock` autour de `refreshAccessToken`.

### A10 — MEDIUM — Classification paiement CB/espèces fragile
- **Preuve** : `vak.js:265-268, 463-466, 611-612` classent via `moyen_paiement ILIKE '%visa%' OR '%mastercard%' OR '%carte%'` (CB) et `'%espèce%' OR '%cash%'` (espèces). Or `moyen_paiement` provient de `detail.payment_type || detail.card?.type || detail.payment_method` (`sumup.js:672`), valeurs SumUp typiques `CARD`/`POS`/`ECOM`/`CASH`.
- **Impact** : si SumUp renvoie `payment_type='CARD'` (et non `visa/mastercard/carte`), le paiement tombe en **`autre`** → `taux_cb` potentiellement toujours 0. Le « mix paiement CB/espèces », KPI phare VAK, peut être systématiquement faux.
- **Correctif** : mapper l'énum SumUp réel (`CARD`→cb, `CASH`→espèces) et normaliser à l'ingestion plutôt qu'au `SELECT`.

### A11 — MEDIUM — Imports CSV non atomiques → batch bloquant
- **Preuve** : `boutique-ventes.js:133-285` et `sumup.js:348-527` enchaînent INSERT batch + UPSERT tickets + INSERT ventes **sans transaction**. Un crash à mi-course laisse des données partielles et le batch en `statut='en_cours'`. La garde anti-doublon boutique traite `en_cours` comme **bloquant** (`boutique-ventes.js:109` `statut IN ('termine','en_cours')`).
- **Impact** : un import partiel **empêche** tout ré-import de la même plage de dates jusqu'à suppression manuelle du batch (admin). Pour un responsable peu à l'aise, blocage opaque.
- **Correctif** : envelopper l'import dans une transaction (`BEGIN/COMMIT`), et/ou exclure de la garde les `en_cours` de plus de N minutes.

### A12 — LOW — Double contrainte d'unicité sur `vak_tickets` vs un seul `ON CONFLICT`
- **Preuve** : `vak_tickets` a `sumup_transaction_id VARCHAR(64) UNIQUE` **seul** (`init-db.js:3748`) **et** `UNIQUE(vak_id, ref_transaction)` (l.3761). L'UPSERT ne cible que `(vak_id, ref_transaction)` (`sumup.js:728`). Or `refTx` dérive de `transaction_code || transaction_id || id` (l.671), potentiellement différent entre le résumé (history) et le détail (`/transactions/{id}`).
- **Impact** : si le même `sumup_transaction_id` réapparaît avec un `ref_transaction` différent, l'INSERT viole la contrainte non ciblée → exception non gérée → `ingestSumUpTransaction` renvoie `false` (transaction silencieusement ignorée). Faible probabilité, mais latent.
- **Correctif** : dériver `refTx` de façon déterministe (privilégier `id`) ; ou UPSERT sur `sumup_transaction_id`.

### A13 — LOW — Webhook boutique : pas d'isolation d'erreur par pièce jointe
- **Preuve** : `boutique-ventes.js:884-905` boucle sur les pièces jointes ; une exception `importCSVContent` remonte et renvoie **500** pour tout le lot. (Impact atténué : A1 rend le webhook inatteignable de toute façon.)
- **Correctif** : try/catch par pièce jointe, agréger les résultats.

### A14 — LOW — Jobs scheduler dépendants de la minute de démarrage
- **Preuve** : `scheduler.js` est un `setInterval(…, 1h)` (l.673). Les jobs gardés par `now.getMinutes() < 30` (l.608,620,634,644,664) ne se déclenchent que si le tick horaire tombe avant :30. Un démarrage à HH:45 → ces gardes ne passent **jamais**. Le scan CSV 20 h (l.620) est sauvé car `runAllJobs` (7/12/18 h) l'appelle aussi (l.812), mais le scan dédié 20 h peut être mort.
- **Correctif** : remplacer par un vrai cron (node-cron), déjà suggéré ailleurs.

### A15 — LOW — Références de secours défaisant l'idempotence
- **Preuve** : `sumup.js:430` `unknown-${i}` (CSV, index de ligne) et `:671` `sumup-${Date.now()}` (API) pour les tickets sans réf. → clés instables entre ré-imports → tickets dupliqués pour les lignes sans référence.
- **Correctif** : dériver une clé stable (hash date+montant+description) ou rejeter la ligne.

### A16 — LOW — Coordonnées Rouen par défaut incohérentes
- **Preuve** : défaut `49.4431/1.0993` (`boutique-meteo.js:107`, `scheduler.js:740`) vs `49.4231/1.0993` pour VAK (`sumup.js:548`, `init-db.js:3707`). Cosmétique (météo à ~2 km près).

### A17 — LOW — `ajuster` non atomique (poids commit, transition séparée)
- **Preuve** : `boutique-commandes.js:335-353` committe les poids ajustés dans une transaction, **puis** `checkAndTransition` (l.354) ouvre une **autre** connexion/transaction. Si la transition échoue (état invalide), les poids sont déjà persistés mais le statut reste.
- **Correctif** : réaliser l'ajustement et la transition dans la même transaction.

### A18 — LOW — « Évolution N-1 » boutiques = période adjacente, pas année précédente
- **Preuve** : `boutique-ventes.js:713-723` calcule la période précédente **immédiatement adjacente** de même durée (`prevTo = date_from - 1j`). CLAUDE.md 1.4.1 parle de « période équivalente N-1 ». VAK, lui, fait bien même-mois-an-1 (`vak.js:383-397`).
- **Impact** : si l'UI intitule ce delta « vs N-1 (année précédente) », il est faux (c'est « vs période précédente »). À vérifier côté front (§4).
- **Correctif** : aligner le libellé UI sur la sémantique réelle, ou implémenter le vrai N-1.

---

## 3. LOGIQUE DES ROUTEURS (auth, cloisonnement, exposition)

- **Webhooks** : VAK `POST /sumup/webhook` **public + HMAC** monté avant `authenticate` (`vak.js:74`), rawBody capturé globalement (`index.js:72-74`) — **correct**. Callback OAuth public avec state CSRF en mémoire TTL 10 min (`vak.js:52-68,129-148`) — correct (fragile si redémarrage backend pendant le flux, A-mineur). À l'inverse, le webhook boutique est **derrière** `authenticate` → **A1**.
- **Cloisonnement RESP_BTQ** : **absent** côté boutiques → **A2**. Côté VAK, toutes les routes sont `authorize('ADMIN','MANAGER')` (voire `ADMIN` pour SumUp) — `RESP_BTQ` n'a **aucun** accès VAK, ce qui est cohérent (la VAK est au siège, pas en boutique).
- **Analytics** : toutes authentifiées mais non cloisonnées (boutiques) ; l'exposition d'un `boutique_id` arbitraire suffit à tout lire.
- **Écriture sensible** : création/màj boutique = ADMIN/MANAGER (`boutiques.js:57,100`), objectifs = ADMIN/MANAGER (bien : le responsable ne fixe pas ses objectifs), commandes = ADMIN/MANAGER/RESP_BTQ (bien), SumUp credentials/sync/disconnect = ADMIN (`vak.js:751-827`) — cohérent.
- **Injection SQL** : requêtes paramétrées partout ; les `ILIKE '%…%'` sont des littéraux, pas d'entrée utilisateur. RAS.

---

## 4. SIMPLICITÉ D'USAGE (responsable boutique peu à l'aise) — [à enrichir après lecture frontend]

- **Importer le CSV du jour** : le webhook e-mail « zéro clic » promis est mort (A1) ; reste soit le scan de dossier serveur (invisible pour le responsable), soit l'upload manuel (`BoutiquesImport.jsx`). Les messages d'erreur d'import (doublon date/hash) sont renvoyés en clair mais leur lisibilité UI reste à vérifier. Un batch coincé en `en_cours` (A11) bloque silencieusement les ré-imports.
- **Lire le dashboard** : 8 KPI, mais panier moyen incohérent (A5) et % objectif biaisé (A4) → risque de perte de confiance. Heatmap décalée (A6).
- **Passer une commande** : state machine claire (brouillon→envoyée→ajustée→préparation→expédiée), rôles corrects — a priori le point le plus abouti côté responsable.
- **Suivre l'objectif** : dépend de A4.
- **Écran TV VakLive** : `/live/current` exige un JWT ADMIN/MANAGER (`vak.js:629`) → sur un mur, l'expiration du token (8 h) fige l'écran ; robustesse Socket.IO (reconnexion, veille) à vérifier dans `VakLive.jsx`.

*(Frictions UI détaillées + vérification libellés/erreurs : section complétée après lecture des pages.)*

---

## 5. OPTIMISATIONS

- **O1 — N+1 à l'import** : UPSERT ticket **une requête par ticket** (`boutique-ventes.js:235-247`) et INSERT vente **une requête par ligne** dans le chemin CSV VAK (`sumup.js:503-513, 746-756`). Les ventes boutiques sont, elles, déjà bulk (l.251-271). → batcher tickets et lignes VAK en multi-VALUES.
- **O2 — Index composites manquants** : seuls des index mono-colonne existent (`init-db.js:3524-3525` `date_vente`, `boutique_id` séparés). Les analytics filtrent systématiquement `boutique_id + DATE(date_vente)` → un index `(boutique_id, date_vente)` et `(boutique_id, date_ticket)` réduirait les scans. `evolution` fait 4 requêtes séquentielles (`boutique-ventes.js:725-753`) → paralléliser/CTE.
- **O3 — Compteurs live recalculés à chaque transaction** : `emitLiveUpdate` (`sumup.js:782-791`) et `/live/current` (`vak.js:645`) refont un `SUM/COUNT` complet sur `vak_tickets` par vente. Volume VAK modeste, mais des compteurs incrémentaux (Redis) élimineraient l'agrégat par événement en rafale.
- **O4 — Payloads analytics** : `/tickets` (`boutique-ventes.js:777`) agrège les lignes en JSON pour 500 tickets ; `/annual/*` VAK scannent toutes les VAK de l'année. Pagination/limites déjà présentes ailleurs, à généraliser.

---

## 6. ÉVOLUTIONS

- **E1 — Prévision CA météo** : la corrélation existe déjà (données `*_meteo_quotidien` collectées) ; passer à un modèle prédictif (le socle IA prédictive collecte est réutilisable).
- **E2 — Planning vendeuses basé affluence** : une fois l'axe horaire corrigé (A6), dimensionner le staffing sur la heatmap.
- **E3 — Fidélité / taux de conversion** : compteur visiteurs (déjà « roadmap » VAK) pour un vrai taux de transformation.
- **E4 — Caisse connectée boutiques** : répliquer le modèle SumUp (API temps réel) pour supprimer l'import CSV LogicS, fragile par nature (encodage, séparateur, format 10/11 col, e-mail).
- **E5 — E-commerce / marketplace inter-SIAE** : déjà dans la vision CLAUDE.md ; le catalogue produits et le stock conditionné existent.

---

## 7. QUICK WINS SÛRS

1. **A7** : ajouter `DELETE FROM vak_ventes WHERE ticket_id = $1` avant la ré-insertion CSV (`sumup.js:~503`) — une ligne, supprime les doublons de lignes.
2. **A5** : unifier la définition du panier moyen (TTC) sur les 3 endpoints.
3. **O2** : créer `idx (boutique_id, date_vente)` et `(boutique_id, date_ticket)` (idempotent dans init-db).
4. **A1** : corriger le commentaire/chemin scheduler et remonter le webhook boutique avant `authenticate` (ou documenter que seul le scan dossier fonctionne).
5. **A3** : préfixer la clé ticket par la date au format 11 colonnes.
6. **A16** : harmoniser les coordonnées Rouen par défaut.

---

*Rapport 07 — première version (backend complet). Enrichissement frontend en cours.*
