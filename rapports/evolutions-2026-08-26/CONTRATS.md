# Contrats techniques — chantier évolutions du 26 août 2026 (8 lots)

**Date** : 26 août 2026 · **Statut** : FIGÉ — référence commune des agents d'implémentation.
Toute divergence par rapport à ce document est un défaut, pas une variante. En cas d'ambiguïté :
ne pas improviser, implémenter au plus proche de la lettre et le signaler dans le rapport final
(section « divergences »), comme l'errata du chantier tournées associations.

Périmètre client : **(1)** messagerie interne type Slack (bot, @privé, chauffeurs en conduite,
notifications applicatives) · **(2)** configurateur 2D chaîne de tri (plan V7, 15 personnes) ·
**(3)** planning hebdo (retrait boutiques, collecte remontée des tournées, véhicules, permanents) ·
**(4)** redondance Pointage/Badgeuse · **(5)** audit journal d'activité + sauvegardes · **(6)**
arrêts GPS > 5 min + temps de vidage CAV + checklists au rapport · **(7)** commandes exutoires
récurrentes + clients/factures Pennylane.

Base PostgreSQL 16 de preuve : `DB_HOST=127.0.0.1 DB_PORT=5432 DB_NAME=solidata
DB_USER=solidata_user DB_PASSWORD=changeme` — PostGIS **indisponible** ici : jouer sa DDL sur
tables parentes minimales, jamais `init-db.js` complet (séquence complète rejouée par
l'orchestrateur). La DDL du §1 a été **prouvée sur cette base** : 2 passes idempotentes + gardes
d'unicité vérifiées (cle_unique, participants, layout actif unique, fille unique par date).

---

## 0. Règles générales (tous lots)

1. **Interdits absolus** : `git commit`/`git push` · dépendance npm nouvelle · modification de
   `CLAUDE.md` · fichier hors périmètre (§10) · SQL non paramétré · route sensible sans
   `authenticate` + `authorize` · libellé UI en anglais.
2. **Fichiers partagés** (`backend/src/index.js` sauf L1, `init-db.js`, `scheduler.js`,
   `monitoring.js`, `tours/live-edit.js`, `App.jsx`, `Layout.jsx`, `services/api.js`) : AUCUN lot
   ne les édite. Tout besoin se déclare en `besoins_integration` : fichier, emplacement, code
   exact prêt à coller. La DDL du §1 est intégrée dans `init-db.js` par l'intégration, ordre du §1.
3. **Jamais de valeur inventée** : information absente = `null` + motif exposé, jamais un zéro.
4. **Erreurs UI en bandeau** (jamais de `catch` muet, jamais d'`alert()` natif).
5. **Tests** : modules purs sans base ; routes en contrat (`jest.mock('../../src/config/database')`,
   `mockQuery` routé par regex SQL, JWT réel, supertest) ; `node --check` sur chaque .js backend
   modifié ; Vitest pour mobile. Les tests existants passent SANS modification.
6. **Aucune nouvelle entité `user_activity_log` dans ce chantier** (§12.6) : pas
   d'`autoLogActivity(...)` ni `entityType:` nouveaux — la garde anti-dérive
   `activity-log-libelles.test.js` resterait rouge entre lots.
7. Réponse d'erreur backend : `res.status(code).json({ error: 'message', code: 'CODE_STABLE' })`.
8. Tokens : web = `localStorage.accessToken`, mobile = `localStorage.mobile_token` — ne jamais les
   confondre (un socket sans token ne s'ouvre pas, sans erreur visible).

---

## 1. Schéma — DDL COMPLÈTE (appliquée par l'INTÉGRATION dans `init-db.js`, ordre imposé)

Chaque lot peut jouer « sa » section sur la base de preuve, mais ne touche pas `init-db.js`.
Tables parentes référencées (toutes existantes, vérifié) : `users`, `vehicles`, `tours`, `cav`,
`association_points`, `postes_operation`, `commandes_exutoires`, `clients_exutoires`,
`pennylane_config`, `settings`.

### 1.1 Messagerie interne (lot L1)

```sql
CREATE TABLE IF NOT EXISTS messagerie_conversations (
  id SERIAL PRIMARY KEY,
  type VARCHAR(20) NOT NULL DEFAULT 'directe' CHECK (type IN ('directe', 'bot', 'systeme')),
  titre VARCHAR(200),
  cle_unique VARCHAR(120) UNIQUE,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  dernier_message_at TIMESTAMP
);

CREATE TABLE IF NOT EXISTS messagerie_participants (
  id SERIAL PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES messagerie_conversations(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  vehicle_id INTEGER REFERENCES vehicles(id) ON DELETE CASCADE,
  dernier_lu_message_id INTEGER,
  created_at TIMESTAMP DEFAULT NOW(),
  CHECK (user_id IS NOT NULL OR vehicle_id IS NOT NULL)
);
-- UNIQUE composite avec NULL ne déduplique pas en PostgreSQL : index partiels obligatoires.
CREATE UNIQUE INDEX IF NOT EXISTS idx_msgp_conv_user
  ON messagerie_participants(conversation_id, user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_msgp_conv_vehicule
  ON messagerie_participants(conversation_id, vehicle_id) WHERE vehicle_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_msgp_user ON messagerie_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_msgp_vehicule ON messagerie_participants(vehicle_id);

CREATE TABLE IF NOT EXISTS messagerie_messages (
  id SERIAL PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES messagerie_conversations(id) ON DELETE CASCADE,
  auteur_type VARCHAR(20) NOT NULL DEFAULT 'utilisateur'
    CHECK (auteur_type IN ('utilisateur', 'chauffeur', 'bot', 'systeme')),
  auteur_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  auteur_vehicle_id INTEGER REFERENCES vehicles(id) ON DELETE SET NULL,
  texte TEXT NOT NULL,
  type VARCHAR(20) NOT NULL DEFAULT 'texte' CHECK (type IN ('texte', 'notification')),
  source VARCHAR(50),
  lien VARCHAR(300),
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_msgm_conv ON messagerie_messages(conversation_id, id);
CREATE INDEX IF NOT EXISTS idx_msgm_created ON messagerie_messages(created_at);

CREATE TABLE IF NOT EXISTS messagerie_mentions (
  id SERIAL PRIMARY KEY,
  message_id INTEGER NOT NULL REFERENCES messagerie_messages(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  vehicle_id INTEGER REFERENCES vehicles(id) ON DELETE CASCADE,
  CHECK (user_id IS NOT NULL OR vehicle_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_msgmention_msg ON messagerie_mentions(message_id);
```

Pas de pièce jointe en v1 (texte seul). `cle_unique` (déduplication, calculée serveur) : segments
`u<user_id>`/`v<vehicle_id>` des participants triés lexicographiquement, préfixés du type — ex.
`directe:u3:u7`, `directe:u3:v1`, `bot:u3`, `systeme:u3`, `systeme:v1`.

### 1.2 Configurateur 2D chaîne de tri (lot L4)

```sql
CREATE TABLE IF NOT EXISTS chaine_layouts (
  id SERIAL PRIMARY KEY,
  nom VARCHAR(120) NOT NULL,
  description TEXT,
  effectif_max INTEGER,
  source VARCHAR(20) NOT NULL DEFAULT 'manuel' CHECK (source IN ('seed_v7', 'manuel', 'duplication')),
  is_actif BOOLEAN NOT NULL DEFAULT false,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
-- Un seul layout actif à la fois (activation transactionnelle : UPDATE tous à false puis un à true)
CREATE UNIQUE INDEX IF NOT EXISTS idx_chaine_layouts_actif ON chaine_layouts(is_actif) WHERE is_actif = true;

CREATE TABLE IF NOT EXISTS chaine_layout_postes (
  id SERIAL PRIMARY KEY,
  layout_id INTEGER NOT NULL REFERENCES chaine_layouts(id) ON DELETE CASCADE,
  code VARCHAR(40) NOT NULL,
  libelle VARCHAR(120) NOT NULL,
  categorie VARCHAR(20) NOT NULL DEFAULT 'poste'
    CHECK (categorie IN ('poste', 'zone_depose', 'entree')),
  x NUMERIC(6,2) NOT NULL DEFAULT 0,
  y NUMERIC(6,2) NOT NULL DEFAULT 0,
  largeur NUMERIC(6,2),
  hauteur NUMERIC(6,2),
  obligatoire BOOLEAN NOT NULL DEFAULT false,
  actif BOOLEAN NOT NULL DEFAULT true,
  effectif_min INTEGER NOT NULL DEFAULT 0,
  effectif_max INTEGER NOT NULL DEFAULT 1,
  poste_operation_id INTEGER REFERENCES postes_operation(id) ON DELETE SET NULL,
  proprietes JSONB,
  UNIQUE (layout_id, code)
);
CREATE INDEX IF NOT EXISTS idx_chaine_layout_postes_layout ON chaine_layout_postes(layout_id);
```

`x`/`y`/`largeur`/`hauteur` en **pourcentage 0–100 du canevas**, origine haut-gauche. `categorie` :
`poste` = poste de travail avec opérateurs (sélectionnable, obligatoire/facultatif) ; `zone_depose`
= contenant/sortie (effectifs 0) ; `entree` = « Original entrant pour tri ». `proprietes` JSONB
libre (couleur, notes, flux) — jamais requis.

### 1.3 Arrêts GPS (lot L6)

```sql
CREATE TABLE IF NOT EXISTS tour_gps_stops (
  id SERIAL PRIMARY KEY,
  tour_id INTEGER NOT NULL REFERENCES tours(id) ON DELETE CASCADE,
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id),
  debut TIMESTAMP NOT NULL,
  fin TIMESTAMP,
  duree_min NUMERIC(6,1),
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  type VARCHAR(20) NOT NULL DEFAULT 'inconnu'
    CHECK (type IN ('cav', 'centre', 'association', 'inconnu')),
  cav_id INTEGER REFERENCES cav(id) ON DELETE SET NULL,
  association_point_id INTEGER REFERENCES association_points(id) ON DELETE SET NULL,
  source VARCHAR(20) NOT NULL DEFAULT 'cloture' CHECK (source IN ('cloture', 'recalcul')),
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (tour_id, debut)
);
CREATE INDEX IF NOT EXISTS idx_tour_gps_stops_tour ON tour_gps_stops(tour_id);
CREATE INDEX IF NOT EXISTS idx_tour_gps_stops_cav ON tour_gps_stops(cav_id) WHERE cav_id IS NOT NULL;
```

### 1.4 Récurrence commandes + Pennylane (lot L7) — colonnes additives

`commandes_exutoires` est créée par `migrate-exutoires.js` ; les ajouts vivent dans `init-db.js`
(pattern existant des colonnes Pennylane de `factures_exutoires`).

```sql
ALTER TABLE commandes_exutoires
  ADD COLUMN IF NOT EXISTS prochaine_echeance DATE,
  ADD COLUMN IF NOT EXISTS recurrence_suspendue BOOLEAN NOT NULL DEFAULT false;
-- Anti-doublon de génération : une seule fille par modèle et par date d'échéance
CREATE UNIQUE INDEX IF NOT EXISTS idx_cmd_exu_fille_unique
  ON commandes_exutoires(commande_parent_id, date_commande) WHERE commande_parent_id IS NOT NULL;

ALTER TABLE pennylane_config
  ADD COLUMN IF NOT EXISTS last_invoice_sync_at TIMESTAMP;

ALTER TABLE clients_exutoires
  ADD COLUMN IF NOT EXISTS pennylane_customer_id VARCHAR(60),
  ADD COLUMN IF NOT EXISTS pennylane_customer_name VARCHAR(255);
CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_exu_pennylane
  ON clients_exutoires(pennylane_customer_id) WHERE pennylane_customer_id IS NOT NULL;
```

Le modèle récurrent EST la commande d'origine : `frequence <> 'unique' AND commande_parent_id IS
NULL` (définition dérivée, aucune colonne « est_modele »). CHECK `frequence` existant INCHANGÉ.

### 1.5 Settings à seeder (INSERT ... WHERE NOT EXISTS, catégorie entre parenthèses)

| Clé | Défaut | Usage |
|---|---|---|
| `messagerie.retention_jours` (messagerie) | `365` | purge planifiée des messages |
| `collecte.arret_seuil_min` (collecte) | `5` | durée minimale d'un arrêt GPS retenu |
| `collecte.arret_rayon_m` (collecte) | `40` | rayon de stationnarité du cluster GPS |
| `collecte.arret_rattachement_m` (collecte) | `80` | rayon de rattachement CAV/association |
| `exutoires.recurrence_horizon_jours` (exutoires) | `30` | horizon de génération des occurrences |
| `tri.chaine_layout_v7_seed` (tri) | *posé par le seed* | verrou anti-réapparition (pattern 2.26.4) |

### 1.6 Registre RGPD à seeder (pattern `INSERT INTO rgpd_registre ... WHERE NOT EXISTS`)

Entrée `'Messagerie interne (conversations, mentions et notifications)'` : finalité communication
opérationnelle interne (dont consignes équipages) + notifications applicatives ; base légale
intérêt légitime ; personnes = utilisateurs et chauffeurs (identité portée par le véhicule) ;
données = auteur, contenu, horodatages, accusés de lecture ; destinataires = participants
uniquement ; conservation = `messagerie.retention_jours` (365 j), purge planifiée journalisée
`rgpd_audit_log` ; sécurité = accès borné aux participants, périmètre véhicule chauffeurs.
Code exact fourni par L1 en `besoins_integration`.

---

## 2. Lot L1 — Messagerie backend

### 2.1 `backend/src/services/messagerie.js` (neuf) — signatures FIGÉES, consommées par d'autres lots

```js
// Aucune de ces fonctions ne throw : toute erreur résout en { ok: false, motif }.
// Émission temps réel via global.__io (déjà exposé par index.js) ; absent → dégrade sans erreur.

async envoyerMessageSysteme({ destinataire_user_id = null, destinataire_employee_id = null,
                              destinataire_vehicle_id = null, texte, source = 'systeme',
                              lien = null })
// → { ok: true, conversation_id, message_id } | { ok: false, motif }
// - exactement UN destinataire ; destinataire_employee_id résolu via employees.user_id
//   (null → { ok:false, motif:'employé sans compte utilisateur' } — jamais de repli inventé)
// - crée/retrouve la conversation 'systeme' (cle_unique 'systeme:u<id>'/'systeme:v<id>', titre
//   'SOLIDATA', participant unique = destinataire) ; message auteur_type 'systeme',
//   type 'notification' ; met à jour dernier_message_at ; émet 'messagerie:nouveau' (§2.4)

async envoyerMessageSystemeRoles(roles, { texte, source = 'systeme', lien = null })
// → { ok: true, envoyes: n, echecs: [] } — users actifs dont resolveBaseRole(role) ∈ roles
// (resolveBaseRole de middleware/auth : couvre les rôles personnalisés, contrairement à
//  sendPushToRoles qui filtre le rôle brut — écart documenté, non corrigé ici)

async purgeMessagerieRetention()
// → { ok, messages_supprimes, conversations_supprimees, retention_jours }
// - rétention lue dans settings 'messagerie.retention_jours' (défaut 365, jamais en dur)
// - DELETE messages plus vieux ; conversations sans message ni activité depuis la rétention ;
//   recale les dernier_lu_message_id orphelins ; journalise rgpd_audit_log
//   ('AUTO_PURGE_MESSAGERIE') UNIQUEMENT si total > 0 (pattern badgeusePurgeRetention)
```

### 2.2 Identité et périmètre

- **Utilisateur web** : identité = `users.id` (JWT claim `id`).
- **Chauffeur** (« 1 URL = 1 véhicule ») : identité messagerie = le **VÉHICULE**, jamais
  `req.user.id` (compte générique `chauffeur` PARTAGÉ entre camions) ; détection
  `isDriverSession` / `driverVehicleIdFromToken` de `routes/tours/driver-session.js`. Il ne voit
  QUE les conversations où `participants.vehicle_id = son véhicule` (403 sinon) ; contacts =
  ADMIN/MANAGER actifs (base role) ; pas de bot.
- **Coexistence `driver_messages`** (§12.3) : table et écran mobile intacts ;
  `notifierChauffeur()` de `live-edit.js` DOUBLE son écriture d'un `envoyerMessageSysteme({
  destinataire_vehicle_id, source:'programme' })` — édit d'INTÉGRATION, code fourni par L1 (L1 ne
  touche pas `live-edit.js`).

### 2.3 REST `/api/messages` (`backend/src/routes/messages.js`, neuf, monté par L1 dans `index.js`)

`router.use(authenticate)` global ; pas d'`authorize` par rôle (tous rôles messagent) ; le
périmètre par participant vaut autorisation. Texte : trim, non vide, ≤ 4000 caractères (400).

```
GET  /api/messages/conversations
  → { conversations: [{ id, type, titre_affiche, participants: [{ type:'utilisateur'|'vehicule',
      user_id?, vehicle_id?, nom }], dernier_message: { id, texte, auteur_type, created_at } | null,
      non_lus }] }   // triées dernier_message_at DESC NULLS LAST
POST /api/messages/conversations
  { destinataire: { type:'utilisateur', user_id } | { type:'vehicule', vehicle_id } | { type:'bot' } }
  → 200 { conversation }   // créée ou retrouvée par cle_unique ; 404 destinataire inconnu/inactif
GET  /api/messages/conversations/:id/messages?avant_id=&limit=
  → { messages: [du plus ancien au plus récent], a_plus: bool }
  // limit défaut 50 max 200 ; avant_id = pagination descendante ; 403 non-participant
POST /api/messages/conversations/:id/messages   { texte }
  → 201 { message } | 201 { message, reponse_bot }   // reponse_bot sur conversation bot (§2.5)
POST /api/messages/conversations/:id/lu   { dernier_lu_message_id }
  → { ok: true }   // borné au max(id) réel de la conversation ; jamais en arrière
GET  /api/messages/contacts?q=
  → { contacts: [{ type:'utilisateur', user_id, nom, role }, { type:'vehicule', vehicle_id, nom }] }
  // users is_active=true (nom "Prénom NOM", repli username) ; véhicules hors démo ET
  // status <> 'out_of_service' (nom = registration + nom) ; q insensible casse/accents ; max 20
GET  /api/messages/non-lus
  → { total, par_conversation: { "<id>": n } }   // pastille du dock et du mobile
```

Mentions : le serveur parse les `@username` du texte (match exact `users.username`, insensible à
la casse), insère `messagerie_mentions`, et pour tout mentionné NON participant de la conversation
appelle `envoyerMessageSysteme` vers lui (texte « <Auteur> vous a mentionné », lien
`/messagerie?conversation=<id>`). Le ciblage « @utilisateur = message privé » est porté par l'UI
(le composer global ouvre la conversation directe, §3).

### 2.4 Socket.IO — salles et événements FIGÉS (partagés L1/L2/L3)

- **Join côté SERVEUR uniquement**, dans `io.on('connection')` d'`index.js` (L1) : résoudre le
  véhicule par `driverVehicleIdFromToken(socket.user)` (couvre les jetons hérités
  `username='driver_<id>'` SANS claim `vehicle_id`, valides jusqu'à 8 h) — véhicule trouvé →
  `socket.join('vehicule:' + id)` **et rien d'autre** (le compte générique partagé ne doit
  jamais joindre `user:<id>`) ; sinon `socket.join('user:' + socket.user.id)`. Aucun join client.
- Événements serveur → client (émis par `messagerie.js`/`messages.js` via `global.__io`) :

```js
io.to(salle).emit('messagerie:nouveau', { conversation_id,
  message: { id, conversation_id, auteur_type, auteur_user_id, auteur_vehicle_id, auteur_nom,
             texte, type, source, lien, created_at }, non_lus_conversation })
io.to(salle).emit('messagerie:lu', { conversation_id, dernier_lu_message_id })
```

- L'ENVOI passe toujours par REST (source de vérité en base, rejouable hors ligne) ; le socket
  ne sert qu'à la poussée ; le front dédoublonne par `message.id`.

### 2.5 Bot (SolidataBot dans la messagerie)

`chat.js` passe au périmètre L1 pour UNE extraction mécanique : la logique du `POST /` (rate
limit, session, tools, pseudonymisation, `chatbot_history`) est extraite en
`async traiterMessageBot({ userId, role, message, sessionId }) → { reply, response_time_ms }`
exportée ; l'endpoint HTTP existant l'appelle (zéro changement de comportement, tests verts).
Sur une conversation `bot`, `POST .../messages` : insère le message utilisateur, appelle
`traiterMessageBot` (sessionId `msg-<conversation_id>`), insère la réponse (`auteur_type:'bot'`),
renvoie les deux, émet le socket. Échec bot → 201 avec `reponse_bot: null` + `bot_erreur` (le
message utilisateur n'est jamais perdu).

### 2.6 `backend/src/index.js` (L1 SEUL) — deux éditions : le montage
`app.use('/api/messages', require('./routes/messages'));` et le join des salles §2.4 dans
`io.on('connection')`. RIEN d'autre (aucun handler d'événement entrant messagerie).
Tests L1 : `backend/tests/unit/messagerie.test.js` (cle_unique, purge, périmètre) +
`backend/tests/contract/messages-contract.test.js` (endpoints, 403 périmètre, session chauffeur).

---

## 3. Lot L2 — Messagerie web

Fichiers neufs uniquement : `frontend/src/pages/Messagerie.jsx` +
`frontend/src/components/messagerie/` (`MessagerieDock.jsx`, `FilConversation.jsx`,
`ComposerMessage.jsx`, `useMessagerieSocket.js`, autres au besoin).

- **Dock global** `MessagerieDock` : pastille flottante (total non lus via `GET /non-lus`, mise à
  jour sur `messagerie:nouveau`), panneau latéral liste + fil + composer. Monté dans `Layout.jsx`
  PAR L'INTÉGRATION (code fourni en `besoins_integration`) ; position distincte du widget
  SolidataBot existant.
- **Page `/messagerie`** : volets conversations / fil / composer ; autocomplete `@` branchée sur
  `GET /contacts?q=` — sélectionner un contact ouvre/crée la conversation directe
  (`POST /conversations`) : c'est LA sémantique « @utilisateur = message privé ». Conversation
  « SolidataBot » via `{destinataire:{type:'bot'}}`.
- Socket : `io(window.location.origin, { auth: { token: localStorage.getItem('accessToken') } })`
  (pattern `useCavSensorSocket`), écoute `messagerie:nouveau` / `messagerie:lu`, AUCUN emit ;
  déduplication par `message.id` ; marquage lu (`POST /lu`) à l'affichage du fil.
- Messages type `notification` : rendu distinct (bandeau, `lien` cliquable). Erreurs en bandeau,
  UI française, Tailwind + variables CSS existantes.

---

## 4. Lot L3 — Messagerie mobile (mode conduite)

`mobile/**` uniquement. Mêmes endpoints REST et mêmes événements socket que le web (§2.3–2.4),
token `localStorage.mobile_token` ; le serveur borne déjà le périmètre véhicule.

- Accès : bouton flottant « Messages » avec pastille non lus sur les écrans de tournée (TourMap
  au minimum) + page mobile dédiée (ex. `/messages`) ; connexion socket propre ou réutilisation
  de celle de TourMap (choix L3, sans duplication).
- **Mode conduite (FALC)** : cibles ≥ 48 px, texte court, contraste élevé ; trois réponses
  rapides figées — « J'ai compris », « J'arrive », « Je suis bloqué, rappelez-moi » — envoyées
  par le même `POST .../messages` ; saisie libre disponible, jamais requise.
- **Hors ligne** : envoi échoué conservé et rejoué (file locale, pattern `-public` : purge sur
  2xx/4xx, conservation sur 5xx/réseau) ; liste = dernier état chargé + mention « hors ligne » ;
  JAMAIS de message perdu en silence.
- `DriverMessageBanner` (consignes `driver_messages`) reste INCHANGÉ (§12.3). Tests Vitest sur la
  file d'envoi et le rendu des réponses rapides.

---

## 5. Lot L4 — Configurateur 2D chaîne de tri

### 5.1 Seed du plan V7 (source : PDF client, 15 personnes max)

`backend/src/data/chaine-tri-v7.json` (versionné) + `backend/src/scripts/seed-chaine-v7.js`
exportant `async seedChaineV7(client)` (idempotent, verrou settings `tri.chaine_layout_v7_seed`
posé APRÈS création réussie — un layout supprimé volontairement ne réapparaît jamais, pattern
2.26.4) + CLI `[--apply]` dry-run par défaut. Appel au boot câblé dans `init-db.js` par
l'intégration. Layout seedé : « Plan V7 — 15 personnes », `source:'seed_v7'`, `effectif_max:15`,
`is_actif:true` si aucun layout actif.

**Postes de travail FIGÉS** (somme des max = 15 ; « oblig. » = défaut de seed, modifiable) :

| code | libelle | oblig. | min–max | x,y (indicatif %) |
|---|---|---|---|---|
| `CRAQ_1` | Crackage ligne 1 | oui | 1–1 | 24,25 |
| `CRAQ_2` | Crackage ligne 2 | oui | 1–1 | 24,62 |
| `CHAUSS_NON_TLC` | Chaussures et non TLC | oui | 1–1 | 17,45 |
| `RECYCL_REEMPLOI_1` | Recyclage VS réemploi ligne 1 | oui | 1–2 | 34,27 |
| `RECYCL_REEMPLOI_2` | Recyclage VS réemploi ligne 2 | non | 0–2 | 34,64 |
| `QUALITES_HOMME` | Qualités Homme | oui | 1–1 | 52,42 |
| `QUALITES_FEMME` | Qualités Femme | oui | 1–1 | 68,42 |
| `STOCK_VAK_BTQ` | Mise en stock VAK/BTQ Homme & Femme | oui | 1–2 | 60,8 |
| `QUALITE_ENFANT` | Qualité Enfant + mise en stock | non | 0–1 | 88,75 |
| `AFFINAGE_RECYCLAGE` | Affinage recyclage (CSR / effilochage) | non | 0–2 | 88,30 |
| `PREPA_CHIF` | Prépa CHIF | non | 0–1 | 55,82 |

**Zones** (`categorie:'zone_depose'`, effectifs 0, positions relatives du PDF, libellés EXACTS du
plan) : Déchets non TLC ×2, Poubelle jaune ×2, Couettes oreiller, Peluches & Jouets (non DEEE),
DEEE, Recyclage Chauss., CSR Maroq., Linge de maison VAK/BTQ, Effilo Mérinos, Textiles mouillés,
Pré-classé Chauss. Pairées, Déco Textiles, Chaussures et Maroquinerie (accessoires) BTQ&VAK,
Recyclage (pré-tri) et Homme/Femme/Enfant VAK/BTQ (pré-tri) aux abords des lignes, Homme et Femme
VAK/STD/EXTRA, CSR Textile ×2, Effilo coton ×2, Effilo Jean, Effilo Tricot ×2 ;
`categorie:'entree'` : Original entrant pour tri ×2. Codes stables `Z_` + slug (+ suffixe si
doublon). Page 1 du PDF = disposition de référence ; page 2 = variante non seedée.

### 5.2 API `backend/src/routes/chaine-config.js` (neuf ; montage `/api/chaine-config` : INTÉGRATION)

Lecture/écriture ADMIN/MANAGER ; suppression ADMIN.

```
GET    /layouts             → { layouts: [{ ...layout, nb_postes, effectif_total }] }
POST   /layouts             { nom, description?, depuis_layout_id? } → 201
                            // depuis_layout_id : duplication postes comprise (source:'duplication')
GET    /layouts/:id         → { layout, postes: [...] }
PUT    /layouts/:id         { nom?, description?, effectif_max? }
PUT    /layouts/:id/postes  { postes: [{ code, libelle, categorie, x, y, largeur?, hauteur?,
       obligatoire, actif, effectif_min, effectif_max, poste_operation_id?, proprietes? }] }
       → remplacement COMPLET transactionnel (pattern PUT /route-templates) ;
       400 si code dupliqué ou effectif_min > effectif_max
POST   /layouts/:id/activer → transactionnel (tous false puis un true)
DELETE /layouts/:id         → 409 { code:'LAYOUT_ACTIF' } si actif
GET    /layout-actif        → { layout, postes } | { layout: null }   // tout rôle authentifié
```

Réponse layout : `effectif_total` = somme `effectif_max` des postes `actif=true,
categorie='poste'` + `alerte_effectif: bool` si > `layout.effectif_max` (alerte, jamais bloquant).

### 5.3 UI `frontend/src/pages/ChaineConfigurateur.jsx` + `frontend/src/components/chaine/**` (neufs)

Canevas 2D HTML/CSS positionné en % (AUCUNE librairie : drag natif pointerdown/move/up, pattern
dégâts checklist mobile) ; bloc sélectionné → panneau latéral (libellé, obligatoire/facultatif,
actif, effectifs, catégorie, couleur via proprietes) ; compteur « effectif total X / 15 » avec
alerte ; gestion des layouts (liste, dupliquer, activer, supprimer) ; enregistrement explicite
via `PUT /postes` ; erreurs en bandeau. Route `/tri/configurateur` + menu : INTÉGRATION.

---

## 6. Lot L5 — Planning hebdomadaire

Fichiers : `backend/src/routes/planning-hebdo.js` · `frontend/src/pages/PlanningHebdo.jsx` ·
`frontend/src/pages/BoutiquesPlanning.jsx` (bandeau seulement) · tests contract.

1. **Retrait boutiques** : filière `btq` retirée de `FILIERES` et des postes générés.
   `GET /postes` pour RESP_BTQ → 200 `{ filieres: [], postes: [], message: 'Le planning des
   boutiques est géré hors logiciel.' }` (jamais 500) ; même logique sur `GET /`.
   `BoutiquesPlanning.jsx` : bandeau informatif, page conservée. Les affectations `schedule`
   historiques `BTQ_*` ne sont NI supprimées NI renvoyées.
2. **Postes collecte par véhicule (évolutif)** : la génération en dur `COLL_CHAUFF`/`COLL_RIPEUR`
   est remplacée par un poste par véhicule réel — `SELECT id, registration, nom, status FROM
   vehicles WHERE COALESCE(is_demo,false)=false AND status <> 'out_of_service' ORDER BY
   registration` → `{ id:'collecte_vehicule_<vid>', code:'COLL_VEH_<vid>', filiere:'collecte',
   nom:'<registration>', vehicle_id, obligatoire:false, permet_doublure:true,
   require_permis_b:false }`. Les affectations historiques `COLL_*` restent lisibles : tout
   `poste_code` inconnu du référentiel s'affiche sous « Anciens postes » — rien de masqué.
3. **La collecte remonte de la gestion de la collecte** : `GET /?week_start=` renvoie en plus
   `collecte_tournees: [{ date, tour_id, vehicle_id, registration, statut, chauffeur:
   { employee_id, nom } | null, suiveurs: [{ employee_id, nom }] }]` — `tours` (hors is_demo) ×
   `vehicles` × `employees` (chauffeur + `suiveur1_employee_id`/`suiveur2_employee_id`), `date
   BETWEEN` la semaine, noms « NOM Prénom ». LECTURE SEULE : badges non déplaçables sur la ligne
   du véhicule (l'équipage s'affecte au Planning tournées) ; les cellules `schedule`
   (`COLL_VEH_*`) complètent.
4. **Permanents dans le tableau** : le roster expose en plus `insertion_status` et
   `est_permanent = (insertion_status IS DISTINCT FROM 'en_parcours')` ; le front groupe le
   vivier « Salariés permanents » / « Salariés en parcours » (ils étaient déjà dans la requête —
   l'affichage les rend visibles et affectables).
5. Aucun changement de schéma ; CHECK `schedule.status` inchangé ; écritures ADMIN/MANAGER.

---

## 7. Lot L6 — Arrêts GPS, temps de vidage, checklists dans le suivi

### 7.1 Module `backend/src/routes/tours/analyse-gps.js` (neuf) — détection FIGÉE

Fonction PURE `detecterArrets(positions, { seuilMin, rayonM })` (positions triées `recorded_at`
ASC, aucune E/S) : cluster ouvert au premier point ; un point y reste si sa distance haversine au
PREMIER point du cluster ≤ `rayonM` (déterministe, pas de centroïde glissant) ; sinon fermeture
au dernier point inclus, nouveau cluster. Durée = `recorded_at` dernier − premier (timestamps
réels ; les trous d'émission comptent tels quels — jamais de temps inventé) ; retenu si ≥
`seuilMin` minutes. Sortie `[{ debut, fin, duree_min, latitude, longitude }]` (lat/lng = premier
point ; `duree_min` arrondie à 0,1).

`classerArret(arret, contexte)` : `type='cav'` si un CAV du programme (`tour_cav JOIN cav`) est à
≤ `arret_rattachement_m` (le plus proche gagne, `cav_id` posé) ; sinon `association` (même rayon,
`association_point_id`) ; sinon `centre` si ≤ 200 m du centre de tri (`lieux_techniques`
catégorie `centre_tri`, repli `CENTRE_TRI_LAT/LNG`) ; sinon `inconnu`. Réglages lus dans
`settings` (§1.5), jamais en dur ; réutiliser `haversineDistance` de `services/TourService.js`.

`async analyserArretsGps(tourId, { persist })` : charge `gps_positions` (plafond 20 000, pattern
rapport.js), détecte, classe ; `persist` → transaction DELETE `tour_gps_stops WHERE tour_id` +
INSERT (`source:'cloture'`/`'recalcul'`) — recalcul idempotent.

### 7.2 Branchements

- **Clôture** : `completion-effects.js` appelle `analyserArretsGps(tourId, {persist:true})` en
  best-effort journalisé (un échec n'empêche JAMAIS la clôture).
- **Endpoints** (montés par L6 dans `routes/tours/index.js`, ADMIN/MANAGER) :

```
GET /api/tours/:id/arrets-gps
  → { arrets: [{ debut, fin, duree_min, latitude, longitude, type, cav_id, cav_nom,
       association_point_id, association_nom, duree_prevue_min|null }], source: 'table'|'live',
       seuil_min, rayon_m }
  // close → lecture table ; en cours → calcul à la volée SANS écriture (source:'live')
POST /api/tours/:id/arrets-gps/recalcul   → recalcule et persiste (tournée close, 409 sinon)
GET /api/tours/analyse-gps/cav-durees?mois=&cav_id=
  → { lignes: [{ cav_id, cav_nom, fill_level, nb_passages, duree_moyenne_min,
       duree_mediane_min }], periode }
  // JOIN tour_gps_stops (type 'cav') × tour_cav (même tour_id + cav_id) : temps RÉEL par CAV
  // croisé au remplissage constaté = « temps de vidage selon le taux de remplissage ».
  // Cellule sans donnée → absente, jamais 0. mois défaut 6, borné 1–24.
```

- **Tableau de suivi** : `LiveVehicles.jsx` — panneau/badge « Arrêts > seuil » par tournée (GET
  ci-dessus, rafraîchi avec le poll 30 s existant), arrêts `inconnu` mis en évidence ;
  `Tours.jsx` (fiche) — section « Arrêts GPS détectés » + tableau temps de vidage.
- **Rapport de tournée** : `rapport.js` ajoute le bloc `arrets_gps` (même forme que l'endpoint,
  dégradation `soft` + motif) et enrichit `checklist` : heure de fin, `points_non_valides`
  détaillés, `degats`, `end_of_day` ; `pdf-tournee.js` rend « Checklist du matin terminée à
  HH:MM », liste des anomalies, silhouette SVG des dégâts (x/y 0–1 par vue), déclaration de fin
  de journée, section arrêts GPS. Blocs absents nommés, pattern 2.39.0.
- **Anomalies transmises au gestionnaire** (même canal que les incidents) : dans
  `checklist-public` (`routes/tours/index.js`, périmètre L6), si un `reponses[].ok !== true` OU
  `degats` non vide → `sendPushToRoles(['ADMIN','MANAGER'], …)` (pattern incident-public) ET
  `envoyerMessageSystemeRoles(['ADMIN','MANAGER'], { texte, source:'checklist',
  lien:'/vehicles' })` via **require paresseux** de `services/messagerie` sous try/catch (module
  livré par L1 en parallèle : absent → dégradation journalisée, la checklist n'échoue jamais pour
  ça). Idem `incident-public` : même appel messagerie en plus du push existant.
- **Fiche véhicule** : `GET /vehicles/:id/etat-declare` renvoie en plus `degats: [...]` et
  `reponses: [...]` complets ; `Vehicles.jsx` affiche la « carte d'état » (silhouette + points de
  dégâts positionnés) dans le panneau existant — la dernière carte reste consultable jusqu'à la
  checklist suivante (comportement actuel conservé).

Tests : unit `analyse-gps` (clusters, trous, classement — sans base) + contract endpoints.

---

## 8. Lot L7 — Commandes exutoires récurrentes + Pennylane

### 8.1 `backend/src/services/commandes-recurrence.js` (neuf)

```js
async genererCommandesRecurrentes({ horizonJours = null, simulation = false } = {})
// → { ok: true, generees: [{ commande_id, parent_id, date_commande, reference }],
//     preparations: [{ preparation_id, commande_id }],
//     ignorees: [{ parent_id, date, motif }], horizon_jours }
```

Règles FIGÉES :
- Modèles = `frequence <> 'unique' AND commande_parent_id IS NULL AND statut <> 'annulee'
  AND recurrence_suspendue = false` (+ `date_fin_recurrence` non dépassée).
- Pas : `hebdomadaire` +7 j · `bi_mensuel` +14 j · `mensuel` +1 mois calendaire ;
  `prochaine_echeance` NULL → initialisée `date_commande + pas` au premier passage.
- Boucle tant que `prochaine_echeance ≤ aujourd'hui + horizon` (settings
  `exutoires.recurrence_horizon_jours`, défaut 30) et ≤ `date_fin_recurrence` si posée : créer la
  fille (`commande_parent_id`, `date_commande = échéance`, référence `CMD-AAAA-NNNN` par le
  générateur EXISTANT de `commandes-exutoires.js` — réutilisé, pas recopié —, statut
  `en_attente`, client/type_produit/tonnage_prevu/prix_tonne copiés) ; l'index §1.4 rend le
  re-run sans double ; avancer l'échéance. Transaction PAR modèle (un échec n'empêche pas les
  autres).
- **Préparation positionnée automatiquement** : gabarit = dernière `preparations_expedition` du
  modèle ou d'une fille (ORDER BY created_at DESC LIMIT 1) → `transporteur`/`lieu_chargement`
  copiés, `date_expedition = échéance 12:00`, `date_livraison_remorque = échéance − 1 j 12:00`,
  statut `planifiee` ; MÊME contrôle de chevauchement que `POST /preparations` — conflit OU aucun
  gabarit → PAS de préparation, motif dans `ignorees` (« aucun gabarit de préparation » /
  « créneau occupé »), commande laissée `en_attente`. Préparation créée → fille basculée
  `en_preparation` (même effet que la route).
- `simulation:true` → aucun INSERT/UPDATE, mêmes listes en réponse.

### 8.2 Routes et UI récurrence

- `commandes-exutoires.js` : `POST /recurrence/generer?simulation=1` (ADMIN/MANAGER) ;
  `PATCH /:id/recurrence` `{ recurrence_suspendue }` (modèles seuls, 409 sinon) ;
  `GET /:id/occurrences` (filles + prochaine échéance). Job auto : §11.
- **Bug calendrier corrigé** : `calendrier-logistique.js` teste les valeurs RÉELLES
  `'hebdomadaire' | 'bi_mensuel' | 'mensuel'` (fin des fantômes `bimensuelle/mensuelle/
  trimestrielle`) ; la projection SAUTE toute date où une fille matérialisée existe (anti double
  compte).
- `ExutoiresCommandes.jsx` : badge « Modèle récurrent », prochaine échéance, suspendre/reprendre,
  occurrences ; `ExutoiresCalendrier.jsx` : distinction occurrence matérialisée / projetée.

### 8.3 Pennylane — sync factures réparée + clients

- **Cause racine** (vérifiée code) : `last_sync_at` PARTAGÉ entre test connexion / GL /
  transactions / factures — le job GL quotidien l'avance, le bouton manuel « factures » ne
  cherche plus que depuis hier. Correctif : `syncCustomerInvoicesAuto` lit/écrit la colonne
  DÉDIÉE `last_invoice_sync_at` (§1.4 ; repli 90 j si NULL) et NE TOUCHE PLUS `last_sync_at` ;
  `since` explicite prioritaire ; le job `syncPennylaneInvoicesDaily` garde sa fenêtre 35 j.
- **UI honnête** : `Pennylane.jsx` et `ExutoiresControleFacturation.jsx` — champ optionnel
  « Depuis le (date) » transmis en `since` ; réponse enrichie `{ periode: { du, au }, recuperees,
  importees, deja_presentes, rapprochees, erreurs }` ; `recuperees === 0` → bandeau « Aucune
  facture renvoyée par Pennylane sur la période — vérifiez la période et que les factures sont
  finalisées (non brouillon) », jamais un « 0 importée(s) » nu.
- **Diagnostic** : `GET /api/pennylane/sync/diagnostic-invoices` (ADMIN) — appel direct
  `customer_invoices` SANS filtre de date, `limit` faible → `{ total_estime, exemples: [3 max,
  liste blanche: id, invoice_number, date, status/draft, amount, customer] }` (pattern
  « Diagnostic transaction » VAK) pour trancher EN PROD la piste « brouillons non renvoyés par
  défaut » (non confirmable hors ligne). Bouton sur `PennylaneConfig.jsx`.
- **Clients depuis Pennylane** : `GET /api/pennylane/customers?limit=` (ADMIN/MANAGER — pull v2
  `GET /api/external/v2/customers`, conventions `pennylaneRequest`/cursor, lecture seule) ;
  `POST /api/pennylane/customers/import` (ADMIN/MANAGER) — upsert `clients_exutoires` : match
  `pennylane_customer_id` puis nom normalisé ; absent → création `actif=true` ; JAMAIS de
  suppression ni d'écrasement d'un champ saisi (COALESCE, pattern import Malibou) ; réponse
  `{ crees, relies, inchanges, ambigus: [...] }` — un nom rapproché de PLUSIEURS clients =
  ambigu, non tranché. `ExutoiresClients.jsx` : « Importer depuis Pennylane » (prévisualisation
  GET puis POST) ; badge « lié Pennylane ». Si `/customers` v2 diffère à l'essai réel :
  documenter la forme constatée en divergence, ne rien inventer.

Tests : unit recurrence (pas de double, bornes, gabarit absent) + contract (customers, since).

---

## 9. Lot L8 — Audits (Pointage/Badgeuse, journal d'activité, sauvegardes)

Livrable principal : `rapports/evolutions-2026-08-26/AUDITS.md` (nouveau) — 3 volets factuels
(constats sourcés fichier:ligne, risques, recommandations arbitrables ; AUCUNE modification de
comportement) :
1. **Pointage (25) vs Badgeuse (33)** : coexistence ADR-0003 assumée ; seul le legacy écrit
   `work_hours` (KPI RH, absences du planning) ; badgeuse non en service (CSE préalable) ;
   trajectoire de décommissionnement recommandée SANS l'exécuter.
2. **Journal d'activité** : `user_activity_log` vs `rgpd_audit_log` (2 systèmes non reliés ; la
   garde `activity-log-libelles.test.js` ne couvre pas le second — actions `DB_BACKUP`,
   `AUTO_PURGE_*`, `ASP_*`, `BADGEUSE_*`… sans libellés) ; PAS d'extension de la garde dans ce
   chantier (risque de rouge inter-lots), proposition documentée seulement.
3. **Sauvegardes** : deux mécanismes hétérogènes à formats INCOMPATIBLES (applicatif
   `db-backup.js` plain SQL, base seule, garanti actif ; `deploy/scripts/backup.sh` format
   custom + uploads + vérif `pg_restore --list`, cron MANUEL non posé par deploy.sh) ; uploads
   sans sauvegarde garantie si le cron n'est pas installé ; check-list de vérification prod.

Code/docs autorisés : `Pointage.jsx` — bandeau informatif NON destructif en tête (« Module
historique : la badgeuse Temps & Présence (module 33) est déployée en parallèle — mise en service
conditionnée à la consultation du CSE ; ce module reste la source des heures `work_hours`. ») ;
`ActivityLog.jsx` — libellés manquants CONSTATÉS d'entités déjà journalisées (aucune entité
nouvelle du chantier, §0.6) ; `RECONSTRUCTION.md` — retrait de `migrate-v2.js` (inexistant),
séquence prouvée `init-db → migrate-exutoires → migrate-finance → init-db`, mention
`migrate-cav-sensors.js`/`migrate-indexes.js`, périmètre 33 modules, doctrine sauvegardes (quoi
restaurer avec quoi) ; `deploy/DEPLOIEMENT.md` — section « Vérifier les sauvegardes » (cron
`crontab deploy/crontab.txt`, contrôle des deux chaînes). AUCUN fichier `deploy/scripts/` modifié.

---

## 10. Table de propriété fichier → lot (ZÉRO chevauchement)

| Lot | Fichiers (— = neuf) |
|---|---|
| **L1** | — `backend/src/services/messagerie.js` · — `backend/src/routes/messages.js` · `backend/src/routes/chat.js` (extraction `traiterMessageBot` UNIQUEMENT) · `backend/src/index.js` (§2.6 : montage + join salles, RIEN d'autre) · — tests `backend/tests/unit/messagerie.test.js`, `backend/tests/contract/messages-contract.test.js` |
| **L2** | — `frontend/src/pages/Messagerie.jsx` · — `frontend/src/components/messagerie/**` |
| **L3** | `mobile/**` (pages, composants, services, routeur, tests Vitest) — EXCLUSIF |
| **L4** | — `backend/src/routes/chaine-config.js` · — `backend/src/data/chaine-tri-v7.json` · — `backend/src/scripts/seed-chaine-v7.js` · — `frontend/src/pages/ChaineConfigurateur.jsx` · — `frontend/src/components/chaine/**` · — tests unit/contract chaine-config |
| **L5** | `backend/src/routes/planning-hebdo.js` · `frontend/src/pages/PlanningHebdo.jsx` · `frontend/src/pages/BoutiquesPlanning.jsx` (bandeau) · — test `backend/tests/contract/planning-hebdo-contract.test.js` |
| **L6** | — `backend/src/routes/tours/analyse-gps.js` · `backend/src/routes/tours/rapport.js` · `backend/src/routes/tours/completion-effects.js` · `backend/src/routes/tours/index.js` (checklist/incident-public + montage analyse-gps) · `backend/src/routes/vehicles.js` (etat-declare) · `frontend/src/components/tours/pdf-tournee.js` · `frontend/src/pages/Tours.jsx` · `frontend/src/pages/Vehicles.jsx` · `frontend/src/pages/LiveVehicles.jsx` · — tests analyse-gps |
| **L7** | — `backend/src/services/commandes-recurrence.js` · `backend/src/routes/commandes-exutoires.js` · `backend/src/routes/calendrier-logistique.js` · `backend/src/routes/pennylane.js` · `frontend/src/pages/ExutoiresCommandes.jsx` · `frontend/src/pages/ExutoiresCalendrier.jsx` · `frontend/src/pages/ExutoiresClients.jsx` · `frontend/src/pages/ExutoiresControleFacturation.jsx` · `frontend/src/pages/Pennylane.jsx` · `frontend/src/pages/PennylaneConfig.jsx` · — tests recurrence/pennylane |
| **L8** | — `rapports/evolutions-2026-08-26/AUDITS.md` · `frontend/src/pages/Pointage.jsx` (bandeau) · `frontend/src/pages/ActivityLog.jsx` (libellés) · `RECONSTRUCTION.md` · `deploy/DEPLOIEMENT.md` |
| **Intégration** (après lots) | `backend/src/scripts/init-db.js` (DDL §1 + seeds + appel seedChaineV7) · `backend/src/services/scheduler.js` · `backend/src/routes/monitoring.js` (JOB_SCHEDULE) · `backend/src/routes/tours/live-edit.js` (double envoi messagerie) · `frontend/src/App.jsx` · `frontend/src/components/Layout.jsx` · `frontend/src/services/api.js` (aucun besoin identifié) |

`CLAUDE.md`, `docs/`, `rapports/` (hors AUDITS.md de L8) : réservés à l'orchestrateur.
`backend/src/scripts/migrate-exutoires.js` : INTOUCHÉ (ALTER additifs en init-db, §1.4).

---

## 11. Points d'intégration attendus (appliqués par l'agent d'intégration)

1. **`init-db.js`** : DDL §1.1→1.4 (ordre du contrat, après les tables parentes), seeds settings
   §1.5, registre RGPD §1.6 (code fourni par L1), appel `seedChaineV7(client)` (code par L4).
2. **`App.jsx`** : `/messagerie` → `Messagerie` (ProtectedRoute sans restriction de rôle) ;
   `/tri/configurateur` → `ChaineConfigurateur` (`['ADMIN','MANAGER']`) — lazy import.
3. **`Layout.jsx`** : `<MessagerieDock />` global (code L2) ; entrée 1er niveau « Messagerie »
   (icône MessageCircle, tous rôles) ; « Configurateur de chaîne » sous Opérations → Tri
   (ADMIN/MANAGER).
4. **`scheduler.js`** : dans `runAllJobs` (3×/jour) — `runInstrumented('purgeMessagerieRetention',
   purgeMessagerieRetention)` et `runInstrumented('genererCommandesRecurrentes', () =>
   genererCommandesRecurrentes())` ; dans les jobs `notification_triggers`, doubler l'envoi Brevo
   d'un `envoyerMessageSysteme` vers les utilisateurs concernés (code L1, best-effort).
5. **`monitoring.js`** : 2 entrées `JOB_SCHEDULE` — `purgeMessagerieRetention` (« Purge RGPD
   messagerie », 3×/jour, DAILY) et `genererCommandesRecurrentes` (« Génération commandes
   exutoires récurrentes », 3×/jour, DAILY).
6. **`live-edit.js`** (`notifierChauffeur`) : en plus de l'existant, `envoyerMessageSysteme({
   destinataire_vehicle_id, texte, source:'programme' })` best-effort (code L1).
7. Chaque lot liste ses `besoins_integration` sous la forme : fichier → emplacement (ancre de
   code existante) → bloc exact à coller.

---

## 12. Arbitrages motivés (≤ 5 lignes chacun)

1. **Seed plan V7 en fichier data + verrou settings** (pattern 2.26.4) : le layout est une donnée
   d'exploitation modifiable à l'écran ; le seed ne rejoue jamais par-dessus une suppression
   volontaire (`tri.chaine_layout_v7_seed`) et une base neuve l'obtient d'office.
2. **Positions en % du canevas, drag natif sans librairie** : projet léger par design (règle 5
   CLAUDE.md) ; le plan V7 est un schéma logique, pas une carte à l'échelle — le % survit à toute
   taille d'écran et s'imprime tel quel.
3. **Messagerie = canal QUI S'AJOUTE, `driver_messages` conservé** : l'écran mobile déployé
   (polling 15 s) continue de servir les consignes ; les nouvelles partent EN DOUBLE
   (driver_messages + messagerie) le temps de la transition ; aucun canal existant (Brevo, push
   VAPID) n'est retiré — la messagerie double, ne remplace pas.
4. **Identité chauffeur = véhicule** : le compte `chauffeur` est générique et PARTAGÉ ; router
   par `users.id` enverrait les consignes de tous les camions à tous les téléphones. Le
   participant `vehicle_id` s'aligne sur « 1 URL = 1 véhicule » et `driver_messages`.
5. **Pointage vs Badgeuse : audit NON destructif** : badgeuse pas en service (CSE préalable,
   ADR-0003), seul le legacy alimente `work_hours` (KPI RH, absences planning) — toucher au
   branchement casserait la paie ; L8 documente la trajectoire, la direction arbitre.
6. **Aucune nouvelle entité `user_activity_log`** : la garde anti-dérive compare le backend aux
   libellés d'`ActivityLog.jsx` (L8) ; une entité ajoutée par L1/L4 rendrait la suite rouge dans
   tout lot isolé. La messagerie n'y est pas journalisée (volumétrie + vie privée) ; sa purge
   l'est côté `rgpd_audit_log`.
7. **Récurrence : occurrences MATÉRIALISÉES, statut de modèle DÉRIVÉ** : `commande_parent_id`
   existait sans usage ; matérialiser rend les occurrences visibles (kanban/calendrier) et
   traçables. Pas de colonne « est_modèle » (dérivé = ne peut pas mentir) ; préparation posée
   SEULEMENT si gabarit réel + créneau libre — jamais de date inventée.
8. **Pennylane : curseur dédié `last_invoice_sync_at`** plutôt que réformer le `last_sync_at`
   partagé (GL/transactions/test) : correctif minimal, zéro régression GL ; la piste
   « brouillons » reste une hypothèse → diagnostic en prod plutôt qu'un correctif à l'aveugle.
9. **Détection d'arrêts en POST-TRAITEMENT de `gps_positions`** (clôture + à la volée), pas dans
   le handler Socket.IO `gps-update` : données déjà en base, chemin chaud partagé (`index.js`
   réservé L1), recalcul idempotent PROUVABLE — un détecteur temps réel ne le serait pas hors
   production.

---

## 13. Rapport final attendu de chaque lot

Fait, fichier par fichier ; prouvé et comment (tests, base réelle, `node --check`, builds) ;
`besoins_integration` (§11.7) ; laissé de côté et pourquoi ; toute divergence au présent contrat.
