# Test persona — Chauffeur-collecteur

**Audit SOLIDATA — 11 juillet 2026**
**Persona** : chauffeur-collecteur en parcours d'insertion, peu à l'aise avec le numérique, smartphone dans le camion, souvent avec des gants, parfois en zone blanche.
**Périmètre inspecté** : `mobile/src/` en entier, `backend/src/routes/auth.js` (driver-start), `backend/src/routes/tours/*`, `backend/src/routes/vehicles.js`, `backend/src/middleware/auth.js`.

## 1. Ma promesse

Ce que j'attends de l'application : qu'elle me dise, sans que j'aie rien à taper, quel véhicule est le mien et quelle est ma tournée du jour ; qu'elle me guide CAV par CAV sans me faire chercher dans des menus ; et qu'elle n'oublie **jamais** ce que je saisis sur le terrain — même sans réseau, même avec des gants, même en plein soleil — parce que chaque pesée et chaque incident compte pour la structure et pour Refashion.

## 2. Mon parcours, testé dans le code

**Prise de poste.** J'ouvre le raccourci `/v/<token>` sur l'écran d'accueil (`mobile/src/pages/VehicleLogin.jsx`), configuré une fois par mon manager. Aucun mot de passe : `POST /api/auth/driver-start` (`backend/src/routes/auth.js`) authentifie directement mon véhicule. C'est réellement le point fort du dispositif : zéro saisie pour démarrer.

**Checklist véhicule.** `mobile/src/pages/Checklist.jsx` liste 11 points (papiers, gilet, pneus, benne propre...) avec cases à cocher larges ; le bouton de démarrage reste grisé tant que tout n'est pas coché. Cohérent avec une vraie ronde de sécurité.

**Découverte de la tournée.** Si un manager a planifié ma tournée sur mon véhicule aujourd'hui, `GET /api/tours/vehicle/:id/today` me l'apporte automatiquement. Sinon, je passe par `VehicleSelect.jsx` (`GET /tours/my`, `PUT /tours/:id/claim` ou `POST /tours/claim-vehicle`). **Ici j'ai trouvé une vraie fragilité** (détaillée en 3).

**Navigation vers le CAV.** `TourMap.jsx` affiche la carte Leaflet, ma position, le prochain point. Le comportement change selon que je roule ou que je suis arrêté (`contexts/UsageModeContext.jsx`) : en conduite, un seul bouton "Naviguer" ; à l'arrêt, "Identifier le CAV" + "Incident". Bonne idée : je n'ai pas à chercher le bon bouton parmi dix.

**Identification/scan.** `IdentifyCav.jsx` ouvre la caméra (html5-qrcode) et bascule automatiquement sur une liste/saisie manuelle si la caméra échoue. Rassurant. **Mais** le code décodé n'est jamais comparé au CAV attendu ni transmis au serveur (voir 3).

**Saisie du niveau / collecte.** `FillLevel.jsx` propose 6 niveaux illustrés (icônes de conteneur) + anomalies pré-cochées ("Débordement", "Accès bloqué"...). Écriture d'abord en local (IndexedDB), tentative d'envoi immédiat, sinon file d'attente — c'est du offline-first sérieusement fait.

**CAV inaccessible ou vide.** Il n'existe pas de bouton "sauter ce point" distinct : je dois choisir un niveau (y compris "vide" à 0%) et cocher éventuellement "Accès bloqué". La colonne `tour_cav.skip_reason` existe pourtant en base et sert déjà côté manager — elle n'est simplement pas câblée sur mon écran.

**Incident.** `Incident.jsx` : un tap sur le type suffit (enregistrement local + envoi immédiat), le détail est optionnel et vient après. Très bien pensé pour "un seul geste".

**Pesée au retour.** `ReturnCentre.jsx` puis `WeighIn.jsx` : je saisis kilométrage, puis poids brut et tare. Le pavé affiche "🔗 Bascule connectée · auto-lecture" — **mais aucune intégration bascule n'existe dans le code** : deux champs numériques à taper à la main, sans même pré-remplissage depuis `vehicles.tare_weight_kg` (existant côté admin, jamais lu par le mobile).

**Fin de tournée / récap.** `TourSummary.jsx` calcule le CO2 évité, affiche les écarts prévu/réalisé — un vrai plus motivant pour une mission ESS.

**Zone blanche, gants, plein soleil.** Boutons de 60px, vibrations de confirmation (`services/haptic.js`), contrastes marqués : bien calibré pour des gants et l'extérieur. En offline réel en revanche, **la lecture des données (ma tournée, mes CAV) n'est pas protégée** alors que l'écriture (collectes/pesées/incidents/GPS) l'est très bien (voir 3).

## 3. Ma remontée

### Points forts
- Authentification "1 URL = 1 véhicule" sans aucune saisie, avec ré-authentification transparente en cas d'expiration (`services/driverAuth.js`, `authedFetch.js`).
- File d'attente offline robuste et bien pensée : `clientId` d'idempotence, purge différenciée 4xx/5xx/401, backoff progressif (`services/db.js`, `services/sync.js`).
- Ergonomie terrain réelle : gros boutons, vibrations, mode conduite/arrêt adaptatif (`index.css`, `UsageModeContext.jsx`).
- Écrans de confirmation avec compte à rebours et "Corriger" — rassure sans bloquer (`StepConfirmScreen.jsx`).
- SolidataBot avec dictée vocale et lecture à voix haute en français, accessible à mon rôle (`SolidataBot.jsx`, `chat.js`).
- Parcours strictement linéaire, sans menu ni sidebar à apprendre (`mobile/src/App.jsx`).

### Points faibles
- Le libellé "bascule connectée" de `WeighIn.jsx` est trompeur : aucune lecture automatique, tout est manuel, y compris une tare qui existe déjà en base véhicule.
- Le scan QR ne vérifie jamais l'identité du CAV scanné (voir défaillance ci-dessous).
- Pas de bouton "sauter ce point" explicite malgré un champ dédié en base.
- Refus ou coupure GPS/caméra silencieux, sans message clair (`TourMap.jsx › startGPS`).
- Une fois synchronisé, un incident ou une pesée disparaît de mon historique local sans repli serveur (`TourHistory.jsx`, limite assumée dans le code lui-même).
- Pas de fond de carte ni de guidage embarqué hors-ligne ; "Naviguer" sort vers Google Maps.

### Défaillances vérifiées dans le code
1. **Scan QR non vérifié** — `IdentifyCav.jsx › handleScanSuccess` stocke le texte décodé sans jamais le comparer au CAV attendu, et `sync.js › sendCollect` ne transmet même pas ce texte au serveur (seul un booléen `qr_scanned` part). Scanner le mauvais conteneur (plusieurs CAV proches) passe inaperçu.
2. **Pas de repli offline en lecture** — `services/db.js` déclare un store `tours` jamais alimenté ; `Checklist.jsx`, `TourMap.jsx`, `IdentifyCav.jsx` avalent l'erreur réseau (`catch (e) {}` ou `console.error`) sans repli local. Si l'appli redémarre à froid en zone blanche, je n'ai plus ma tournée ni mes CAV.
3. **Chaîne d'identité fragile hors tournée pré-planifiée** — `driver-start` (`routes/auth.js`) retombe sur un compte `users.username='chauffeur'` que je ne trouve nulle part semé dans `scripts/init-db.js` (seul `admin` l'est) ; si ce compte manque et qu'aucun chauffeur n'est assigné, `driver-start` renvoie 400, que `VehicleLogin.jsx` affiche comme un problème réseau avec un "Réessayer" voué à échouer identiquement. Même assigné, si mon employé n'a pas de compte utilisateur lié, `/tours/my`, `/claim-vehicle`, `/:id/claim` (`routes/tours/execution.js`) exigent `employees.user_id = req.user.id` — une correspondance non garantie — et je reçois "Aucune fiche employé liée à votre compte", un message pensé pour un contexte web, pas pour moi.

### Insuffisances fonctionnelles
- Pas de photo depuis mon écran incident alors que le backend sait déjà le faire (`routes/tours/execution.js › POST /:id/incidents`, `upload.single('photo')`) : mon `Incident.jsx` n'envoie que du JSON vers `/incident-public`, sans champ photo. Pour un dépôt sauvage ou un conteneur vandalisé, la preuve visuelle manque.
- Aucune replanification manuelle de mon côté : je peux seulement accepter/refuser les propositions de ré-optimisation du serveur.
- Aucune vérification serveur que la tournée manipulée correspond à mon véhicule (aucun `req.user` exploité dans `routes/tours/index.js`) — pas un blocage quotidien, mais une garde-fou manquante.

## 4. Verdict

La promesse est **partiellement tenue**. Le cœur du métier quotidien — véhicule assigné, tournée planifiée, collecte, incident, pesée, retour — fonctionne réellement et avec un vrai soin ergonomique pour mon profil. Mais des angles morts concrets et vérifiés dans le code (scan non vérifié, absence de repli hors-ligne en lecture, chaîne d'identité fragile dès que je sors du cas nominal, pas de photo d'incident) touchent exactement les situations où j'ai le plus besoin de fiabilité : signal faible, imprévu, véhicule de remplacement.

**Note : 6,5/10**
