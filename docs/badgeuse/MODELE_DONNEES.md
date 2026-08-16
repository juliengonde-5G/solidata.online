# Modèle de données & API back-office — Module « Temps & Présence » (badgeuse)

**Livrable A1.** Référence : `SPEC_TECHNIQUE.md` §5, `CONTRAT_API_DEVICE.md`,
`CONTRAT_INTEGRITE.md`, `CONTRAT_HMAC.md`, ADR-0001/0002/0003.
Toutes les tables sont créées de façon **idempotente** dans `backend/src/scripts/init-db.js`
(section « Module 33 — Temps & Présence (badgeuse) »), préfixe `badgeuse_`.

## 1. Tables

### `badgeuse_sites`
| Colonne | Type | Notes |
|---|---|---|
| id | SERIAL PK | |
| code | VARCHAR(20) UNIQUE NOT NULL | ex. `LH` |
| libelle | VARCHAR(120) | |
| actif | BOOLEAN DEFAULT true | |
| created_at | TIMESTAMPTZ DEFAULT NOW() | |

Seed idempotent : `('LH', 'Le Houlme — atelier')`. Multi-site dès la V1 (risque « extension
Vernon », SPEC §9). La clé HMAC du site vit dans `settings` (`badgeuse.hmac_key_site_<id>`),
**chiffrée AES-256-GCM** (helper du module, même format que sumup.js).

### `badgeuse_devices`
| Colonne | Type | Notes |
|---|---|---|
| id | SERIAL PK | |
| code | VARCHAR(30) UNIQUE NOT NULL | ex. `LH-P1` |
| libelle | VARCHAR(120) | |
| site_id | INTEGER REFERENCES badgeuse_sites(id) | |
| api_key_hash | VARCHAR(64) | SHA-256 hex de la clé device — la clé n'est montrée qu'une fois |
| actif | BOOLEAN DEFAULT true | |
| version_logicielle | VARCHAR(30) | heartbeat |
| cible | VARCHAR(10) | `pi5` / `pi3` |
| dernier_heartbeat | TIMESTAMPTZ | |
| heartbeat_info | JSONB | dernier heartbeat brut, **liste blanche** : `version`, `horloge_utc`, `derive_estimee_sec`, `taille_file`, `temperature_cpu`, `disque_libre_mo`, `cible`, `reader_mode`, `throttled`, **`alerte`** (≤ 300 car. ou `null` — CONTRAT_API_DEVICE §2.5 v1.1, QA-02) |
| cree_le | TIMESTAMPTZ DEFAULT NOW() | |

### `badgeuse_badges`
| Colonne | Type | Notes |
|---|---|---|
| id | SERIAL PK | |
| employee_id | INTEGER NOT NULL REFERENCES employees(id) | |
| uid_hmac | VARCHAR(64) UNIQUE NOT NULL | jamais d'UID en clair (CONTRAT_HMAC) |
| statut | VARCHAR(15) CHECK IN ('actif','perdu','vole','restitue','desactive') DEFAULT 'actif' | |
| attribue_le | TIMESTAMPTZ DEFAULT NOW() | |
| restitue_le | TIMESTAMPTZ | |
| commentaire | VARCHAR(300) | |
| cree_par | INTEGER REFERENCES users(id) | |
| created_at | TIMESTAMPTZ DEFAULT NOW() | |

Index partiel unique : un seul badge `actif` par salarié
(`CREATE UNIQUE INDEX ... ON badgeuse_badges(employee_id) WHERE statut='actif'`).

### `badgeuse_badge_historique` (BO-01 : historique complet)
`id SERIAL, badge_id INTEGER REFERENCES badgeuse_badges(id) ON DELETE CASCADE, evenement
VARCHAR(30) (attribution|perte|vol|restitution|desactivation|reactivation), details JSONB,
auteur_id INTEGER REFERENCES users(id), created_at TIMESTAMPTZ DEFAULT NOW()`.

### `badgeuse_pointages` — enregistrement brut, **jamais modifié, jamais supprimé**
| Colonne | Type | Notes |
|---|---|---|
| id | BIGSERIAL PK | |
| uuid | UUID UNIQUE NOT NULL | idempotence (généré par le poste) |
| employee_id | INTEGER REFERENCES employees(id) | NULL = orphelin non rattaché |
| device_id | INTEGER REFERENCES badgeuse_devices(id) | NULL = saisie manuelle serveur |
| uid_hmac | VARCHAR(64) | NULL pour une correction-ajout sans badge |
| horodatage_utc | TIMESTAMPTZ NOT NULL | cœur du traitement |
| horodatage_local | VARCHAR(30) | tel que vu par le poste (débogage fuseau) |
| fuseau | VARCHAR(40) DEFAULT 'Europe/Paris' | |
| sens | VARCHAR(10) CHECK IN ('entree','sortie','inconnu') | `inconnu` = orphelin |
| source | VARCHAR(10) CHECK IN ('badge','manuel','import') DEFAULT 'badge' | |
| statut | VARCHAR(10) CHECK IN ('brut','traite','orphelin') DEFAULT 'brut' | |
| orphelin_raison | VARCHAR(30) | `badge_inconnu` / `hors_plage` / `badge_inactif` |
| sequence_device | BIGINT | monotone par device |
| hash_precedent / hash_courant | VARCHAR(64) | CONTRAT_INTEGRITE |
| chaine_valide | BOOLEAN DEFAULT true | false si rupture détectée à la réception |
| recu_le | TIMESTAMPTZ DEFAULT NOW() | |
| cree_par | INTEGER REFERENCES users(id) | saisies manuelles |

Index : `(employee_id, horodatage_utc)` ; unique partiel `(device_id, sequence_device) WHERE
device_id IS NOT NULL`. **Seules** mutations autorisées (traitement, pas capture) :
rattachement d'un orphelin (`employee_id`, `statut` → `traite`) — journalisé
`rgpd_audit_log`. Les champs couverts par la chaîne (uuid, device, séquence, uid_hmac,
horodatage, sens, source) ne sont **jamais** mis à jour ; aucun `DELETE` dans le code
(seule la purge RGPD planifiée supprime au-delà de la durée légale).

### `badgeuse_corrections` — additives, l'enregistrement brut est intouché (BO-03)
| Colonne | Type | Notes |
|---|---|---|
| id | SERIAL PK | |
| pointage_id | BIGINT REFERENCES badgeuse_pointages(id) | NULL pour un `ajout` |
| employee_id | INTEGER NOT NULL REFERENCES employees(id) | |
| type | VARCHAR(15) CHECK IN ('ajout','modification','annulation') | |
| horodatage_corrige | TIMESTAMPTZ | requis pour ajout/modification |
| sens_corrige | VARCHAR(10) CHECK IN ('entree','sortie') | requis pour ajout |
| motif_code | VARCHAR(30) NOT NULL CHECK IN ('oubli_badge','badge_defaillant','mission_exterieure','rdv_accompagnement','formation','autre') | liste fermée (NOTE_RH §5.1) |
| motif_detail | VARCHAR(200) | exigé si et seulement si `motif_code='autre'` |
| auteur_id | INTEGER NOT NULL REFERENCES users(id) | |
| created_at | TIMESTAMPTZ DEFAULT NOW() | |

Règles applicatives : un encadrant ne corrige jamais **ses propres** pointages (403 si le
salarié cible est lié à `req.user` via `employees.user_id`) ; aucune correction sur une
période dont la feuille de temps est `validee_rh` (409, NOTE_RH §5.2).

**Verrou de période — DOUBLE (revue Codex C2).** Une `modification` qui déplace un pointage
à travers une frontière de mois touche **deux** périodes : celle qu'elle vide (période du
pointage d'origine) et celle qu'elle remplit (période de `horodatage_corrige`). Le refus
409 tombe dès que **l'une** des deux est `validee_rh` — sans quoi un mois clos serait
modifié « par l'autre bout ». Les deux périodes sont lues en une requête paramétrée
(`periode = ANY($2)`) ; seules les périodes **connues** sont vérifiées (un pointage
d'origine introuvable ne fait pas inventer de période — la clé étrangère tranche à
l'insertion). La réponse 409 porte `periodes_concernees`.

**Appartenance à une période — c'est la JOURNÉE qui appartient, pas l'événement.** Le moteur
rattache une paire entrée→sortie au **jour civil Paris de son ENTRÉE** (`computeDays`) : une
nuit du 31/08 23:50 au 01/09 00:10 est une journée du 31/08, elle appartient donc **entière**
à août, sortie comprise. Le calcul procède en trois temps :

1. **chargement élargi de 24 h** de part et d'autre de la période — une journée peut enjamber
   la frontière ; 24 h suffisent, la journée étant bornée par les règles (au-delà de
   `badgeuse.journee_max_heures`, défaut 10 h, l'anomalie « journée longue » part). S'y
   ajoutent, hors marge, les pointages qu'une correction **déplace** dans la fenêtre
   (`EXISTS`, pour les recalages de plus de 24 h) et les corrections portant sur les
   pointages chargés (`pointage_id = ANY(...)`, pour celles qui en **sortent** un) ;
2. **appariement sans filtre préalable** (`buildEffectiveEvents` + `computeDays`) : filtrer
   les événements avant l'appariement coupait la paire nocturne en deux et perdait ses
   minutes des **deux** côtés (entrée orpheline d'un côté, « sortie sans entrée » fantôme de
   l'autre) ;
3. **filtrage des journées** sur les bornes civiles `[premier jour ; premier jour du mois
   suivant[` (`badgeuse-engine.filterDaysToPeriod`). Une heure est ainsi comptée **une** fois,
   du bon côté de la frontière, et `GET /anomalies` ne remonte aucune anomalie d'une journée
   hors fenêtre.

Corollaire : la frontière de mois se comporte comme n'importe quelle frontière de jour — une
sortie badgée le 1ᵉʳ après un oubli le 31 est appariée et **datée du 31** (avec ses anomalies
de séquence), au lieu d'être remise à zéro par le changement de mois.

Les tableaux `pointages` / `corrections` rendus par `/mes-pointages` et le relevé individuel
restent bornés à la fenêtre **stricte** (origine dans la période, ou correction l'y amenant) :
les lignes de la marge servent au calcul, pas à l'affichage.

### `badgeuse_feuilles_temps` (BO-04)
`id SERIAL, employee_id INTEGER NOT NULL REFERENCES employees(id), periode VARCHAR(7) NOT
NULL ('YYYY-MM'), heures_theoriques NUMERIC(6,2), heures_pointees NUMERIC(6,2),
heures_validees NUMERIC(6,2), detail JSONB (par jour : événements effectifs, heures, anomalies,
règles appliquées), statut VARCHAR(20) CHECK IN ('brouillon','validee_encadrant','validee_rh')
DEFAULT 'brouillon', valide_encadrant_par/le, valide_rh_par/le, updated_at,
UNIQUE(employee_id, periode)`.
Validation RH : transaction + `rgpd_audit_log` (`BADGEUSE_FEUILLE_VALIDATION`), pattern
`effectifs.js` ETP_ASP. Dévalidation : ADMIN uniquement, journalisée.

**`heures_theoriques` — alimentation (ADR-0002 addendum §3, QA-03).** La colonne est écrite
à chaque recalcul de feuille en **brouillon** (`upsertFeuille`) :
`heures hebdomadaires contractuelles au 1ᵉʳ du mois × jours ouvrés du mois ÷ 5`, arrondi
2 décimales. Les heures hebdo viennent d'`employee_contracts` (contrat dont la période
effective couvre le 1ᵉʳ du mois — même lecture que le moteur ETP), **repli** documenté sur
`employees.weekly_hours`. Aucune heure connue → `heures_theoriques = NULL` et
`ecart_heures = NULL` : l'écran affiche « — », **jamais 0** (« jamais de valeur inventée »).
« Jour ouvré » = lundi→vendredi, définition identique à `services/effectifs-engine.js` ; les
jours fériés ne sont pas retranchés (l'addendum ne le prévoit pas). Une feuille **déjà
validée** n'est jamais réécrite : son théorique reste figé à la validation, et son écart est
calculé sur les chiffres qui font foi. Une feuille validée AVANT la livraison de QA-03 garde
donc un théorique nul — état honnête, pas un défaut.

### `badgeuse_contenus` (playlist, BO-08)
`id SERIAL, site_id INTEGER REFERENCES badgeuse_sites(id), type VARCHAR(20) CHECK IN
('message','image','planning','compte_a_rebours','meteo'), titre VARCHAR(200), corps TEXT,
media_url VARCHAR(300), ordre INTEGER DEFAULT 0, duree_sec INTEGER DEFAULT 10 (5–60),
visible_du DATE, visible_au DATE, actif BOOLEAN DEFAULT true, cree_par INTEGER REFERENCES
users(id), created_at, updated_at`. Aucune donnée personnelle dans ces contenus (finalité
communication interne dissociée — NOTE_JURIDIQUE §3.2) : pas de FK employé, et le back-office
l'affiche en avertissement.

**Écran d'information v2** (CDC_AFFICHAGE_V2, ADR-0004) — colonnes ajoutées (idempotentes) :
`fichier VARCHAR(300)` (chemin **relatif** à `uploads/badgeuse`, jamais une URL externe),
`media_type VARCHAR(10)` (`image`|`video`), `media_sha256 VARCHAR(64)` (vérification du cache
du poste), `source_url VARCHAR(500)` (provenance d'un lien rapatrié), `config JSONB`
(paramètres du générateur, ex. `{"nb_actus":3}`). La CHECK `type` est **élargie à 12 valeurs**
(+ `annonces`, `actus`, `tournees`, `social`, `media`, `lien`, `vak_live`) par **DO-scan de
`pg_constraint`** : `CREATE TABLE IF NOT EXISTS` ne re-contraint jamais une table existante,
sans ce scan une base déjà déployée refuserait tout contenu v2 (prouvé sur PostgreSQL 16.13 :
`vak_live` rejeté en 23514 avant migration, accepté après, type inconnu toujours rejeté).

### `badgeuse_social_posts` (écran v2 — ADR-0004 §6)
`id SERIAL, reseau VARCHAR(20) CHECK IN ('instagram','facebook'), compte VARCHAR(100),
post_id VARCHAR(100), permalink VARCHAR(500), legende TEXT, media_fichier VARCHAR(300),
media_sha256 VARCHAR(64), publie_le TIMESTAMPTZ, sync_le TIMESTAMPTZ, UNIQUE(reseau, post_id)`.
Publications **publiques des comptes DE la structure**, rapatriées côté serveur par l'API Meta
Graph (jamais de scraping) : aucune FK vers `employees`/`users`, aucune donnée de salarié.
L'`UNIQUE(reseau, post_id)` rend la synchronisation idempotente ; le visuel est **téléchargé
puis servi par l'API device**, si bien que le kiosque ne contacte aucun domaine externe.

### Consentement à l'affichage festif (`employees`, ADR-0004 §4)
`badgeuse_optin_festif BOOLEAN NOT NULL DEFAULT false`, `badgeuse_optin_festif_le TIMESTAMPTZ`,
`badgeuse_optin_festif_par INTEGER REFERENCES users(id)`. Afficher un anniversaire n'est **pas
nécessaire** au décompte du temps : c'est une divulgation supplémentaire, donc un consentement
libre, révocable, **daté et imputé** (recueil comme retrait journalisés `BADGEUSE_OPTIN_FESTIF`
dans `rgpd_audit_log`, DANS la transaction). Défaut `false` : l'absence de choix n'est jamais
un accord. Seuls des **booléens** partent ensuite vers le poste — la date de naissance ne quitte
jamais le serveur.

## 2. Paramètres (`settings`, catégorie `badgeuse`)

Voir ADR-0002 (règles de gestion, défauts = recommandations RH) + conservation :
`badgeuse.retention_pointages_mois` (60), `badgeuse.retention_feuilles_mois` (60),
`badgeuse.retention_badges_apres_restitution_jours` (90),
`badgeuse.retention_contenus_apres_expiration_jours` (365),
`badgeuse.retention_journal_acces_mois` (12) — valeurs NOTE_JURIDIQUE §3.7.
Marqueur d'arbitrage : `badgeuse.regles_validees_le` (+ `badgeuse.regles_validees_par`).
Secrets chiffrés : `badgeuse.hmac_key_site_<id>`.

**Exploitation (BO-09 — ne sont PAS des règles de gestion RH, donc hors arbitrage, mais
paramétrées pour qu'aucun seuil ne reste en dur, QA-11) :**
`badgeuse.supervision_silence_minutes` (15) — au-delà, un poste est affiché « hors ligne »
par `GET /devices` **et** l'alerte du job `checkBadgeuseDevices` part ; les deux consomment
désormais la même valeur.
`badgeuse.supervision_alerte_emails` (`''`) — destinataires de l'alerte, séparés par des
virgules ; vide = repli sur les ADMIN actifs, pour que l'exigence « alerte e-mail » ne reste
pas lettre morte faute de paramétrage.
État interne (non arbitrable, non exposé par `PUT /parametres`) :
`badgeuse.supervision_derniere_alerte` — JSON `{ code_poste: horodatage ISO }`, anti-spam
d'un e-mail par poste toutes les 6 h.

**Écran d'information v2** (CDC_AFFICHAGE_V2 §1/§4 — **aucune règle d'affichage n'est codée
dans le poste**, tout descend par `GET /config`) :

| Clé | Défaut | Rôle |
|---|---|---|
| `badgeuse.msg_matin` / `msg_pause` / `msg_retour` / `msg_soir` | « Bonjour, {prenom} ! », « Bon appétit… », « Bon après-midi… », « Bonne fin de journée… » | gabarits par moment ; **`{prenom}` obligatoire**, ≤ 120 car. |
| `badgeuse.msg_premier_jour` | « Bienvenue chez Solidarité Textiles, {prenom} ! » | premier badgeage |
| `badgeuse.msg_anniversaire` / `msg_anniversaire_entreprise` | « Joyeux anniversaire… » / « {annees} an(s) avec nous… » | écran festif (opt-in requis) |
| `badgeuse.moment_matin_fin` (11:30), `moment_pause_debut` (11:00), `moment_pause_fin` (14:00), `moment_retour_fin` (15:00), `moment_soir_debut` (14:00) | — | bornes HH:MM des moments (heure murale Paris) |
| `badgeuse.phrases_motivation` | 10 phrases génériques (JSON) | vivier **collectif** — jamais lié à un profil PCM (ADR-0004 §2) ; ≤ 30 phrases, ≤ 200 car. |
| `badgeuse.motivation_active` / `festif_actif` | true / true | interrupteurs ; `festif_actif` ne **remplace pas** l'opt-in individuel, il s'y ajoute |
| `badgeuse.media_cache_max_mo` | 500 | plafond du cache média local du poste |
| `badgeuse.lien_taille_max_mo` | 50 | plafond de téléchargement d'un lien partagé |
| `badgeuse.social_sync_actif` | false | active le job `syncBadgeuseSocial` |
| `badgeuse.social_comptes` | 7 comptes de la structure, **inactifs, `graph_id: null`** | l'identifiant Graph est un paramétrage, jamais une inférence depuis le pseudo |
| `badgeuse.social_posts_par_compte` | 5 | nombre de posts récupérés par compte |
| `badgeuse.retention_social_jours` | 30 | conservation des posts sociaux — appliquée par `badgeusePurgeRetention` **et par lui seul** |

Secret chiffré AES-256-GCM, **hors `BADGEUSE_SETTING_DEFAULTS`** (donc inaccessible en
lecture comme en écriture par `PUT /parametres`) : `badgeuse.meta_token` — jeton Meta Graph,
jamais renvoyé par l'API, même tronqué ; seule sa date de configuration l'est
(`badgeuse.meta_token_configure_le`). État d'exploitation : `badgeuse.social_dernier_sync`.

## 3. API back-office `/api/badgeuse` (authentifiée)

Rôles : `READ = ADMIN/RH/MANAGER` (MANAGER = encadrant technique ; accès non restreint par
équipe, précédent documenté v2.12.0), `WRITE_RH = ADMIN/RH`, `ADMIN_ONLY = ADMIN`.
Toute consultation de données **individuelles** (filtre `employee_id`, relevé, feuille
individuelle) est journalisée dans `rgpd_audit_log` (`BADGEUSE_CONSULTATION`) — BO-11.

| Endpoint | Rôles | Objet |
|---|---|---|
| GET/PUT `/parametres` | READ / WRITE_RH | grille §5.4 + marqueur d'arbitrage (ADR-0002) |
| GET `/badges`, POST `/badges`, PATCH `/badges/:id`, GET `/badges/:id/historique` | READ / WRITE_RH | BO-01 (invalidation immédiate perte/vol) |
| GET `/pointages` (filtres salarié/date/device/statut, pagination) | READ | BO-02 (+ indicateurs d'anomalie) |
| GET `/orphelins`, POST `/orphelins/:id/rattacher` | READ / WRITE_RH | PST-04/BO-05 |
| GET `/corrections`, POST `/corrections` | READ / ADMIN+RH+MANAGER | BO-03, motif fermé, anti-autocorrection |
| GET `/feuilles-temps?periode=`, GET `/feuilles-temps/:employeeId?periode=`, POST `/feuilles-temps/:employeeId/valider` | READ / MANAGER (encadrant) puis WRITE_RH | BO-04, circuit encadrant → RH |
| GET `/anomalies?du=&au=` | READ | BO-05 (oubli sortie, journée > seuil, hors plage, orphelins) |
| GET `/exports/paie?periode=&heures=decimal|hms` | WRITE_RH | BO-06 — CSV `;` BOM, journalisé |
| GET `/exports/iae?periode=` | WRITE_RH | BO-07 — salariés `insertion_status='en_parcours'`, journalisé |
| GET/POST/PUT/DELETE `/contenus` | READ / WRITE_RH | BO-08 (prévisualisation côté front) ; DELETE supprime AUSSI le fichier média |
| POST `/contenus/upload` (multipart `fichier`) | WRITE_RH | écran v2 — téléversement image/vidéo (≤ 100 Mo, liste blanche ext+MIME, sha256 en flux) ; 415 type refusé, 413 trop gros |
| POST `/contenus/lien` | WRITE_RH | écran v2 — le **serveur** télécharge le contenu d'un lien partagé (gardes anti-SSRF, cf. §3.1) ; 422 + `code` si refusé |
| POST `/salaries/:employeeId/optin-festif` | WRITE_RH | consentement affichage festif — journalisé `BADGEUSE_OPTIN_FESTIF` en transaction |
| GET `/social/status` | READ | comptes suivis, dernier sync, nb posts — **jamais le jeton** |
| PUT `/social/config`, POST `/social/sync` | ADMIN_ONLY | jeton Meta chiffré (jamais relu), comptes, déclenchement à la demande |
| GET `/devices`, POST `/devices`, PATCH `/devices/:id`, POST `/devices/:id/regenerate-key`, GET `/devices/:id/verify-chain` | READ (liste) / ADMIN_ONLY (écritures) | BO-09 + CONTRAT_INTEGRITE §4 |
| GET `/mes-pointages` | tout rôle authentifié | droit d'accès art. 15 (lien `employees.user_id`) |
| GET `/salaries/:employeeId/releve?periode=` | READ (journalisé) | récapitulatif remis au salarié (sortie, contestation) |

### 3.1 Formes de réponse amendées (boucle QA n°1)

**`GET /feuilles-temps?periode=` et `GET /feuilles-temps/:employeeId?periode=`** portent
désormais le trio complet de BO-04 et l'indicateur NOTE_RH §9 :

| Champ | Type | Sens |
|---|---|---|
| `heures_theoriques` | number \| **null** | cf. §1 `badgeuse_feuilles_temps` — `null` si aucune heure contractuelle connue |
| `heures_pointees` | number | chiffre validé s'il existe, recalcul sinon |
| `ecart_heures` | number \| **null** | `pointées − théoriques`, **`null`** dès que le théorique l'est (jamais 0) |
| `source_theorique` | `'contrat'` \| `'fiche'` \| **null** | provenance de l'heure hebdo retenue |
| `taux_pointages_complets_pct` | number \| **null** | % de journées **soumises** à l'attendu de pointages qui l'atteignent ; `null` si aucune journée n'est soumise |
| `jours_pointage_attendu` / `jours_pointage_complet` | number | dénominateur / numérateur du taux ci-dessus |

**`GET /anomalies?du=&au=`** : ajoute `taux_pointages_complets_pct`, `jours_pointage_attendu`
et `jours_pointage_complet` (même définition, agrégés sur la fenêtre) ; le type d'anomalie
**`pointages_incomplets`** (sévérité `info`) apparaît pour toute journée dépassant le seuil de
pause avec moins de `badgeuse.pointages_par_jour` événements (ADR-0002 addendum §4, QA-05).

**Population d'une période (revue Codex C1).** `GET /feuilles-temps?periode=` liste les
salariés ayant, sur le mois, **un pointage brut OU une feuille déjà ouverte OU une
correction** (troisième membre ajouté : un salarié en mission extérieure n'a que des
corrections `ajout` — il était absent de la liste, donc ni validable ni exportable). La
même population sert à `GET /anomalies` (fenêtre libre, donc sans le membre « feuille ») et
aux **exports paie/IAE**, qui matérialisent en brouillon la feuille manquante d'un salarié
de la population : l'export ne dépend plus d'un passage préalable par l'écran mensuel. La
matérialisation est idempotente et ne réécrit **jamais** une feuille déjà validée ; le
journal de l'export paie porte `feuilles_creees`.

**`POST /corrections`** (409) : ajoute `periodes_concernees` (les périodes touchées — une
seule pour un `ajout`, deux pour une `modification` qui franchit une frontière de mois).

**`POST /corrections`** (201) : ajoute `avertissement` (`'hors_delai_signalement'` \| `null`),
`jours_ouvres_ecoules` et `regularisation_delai_jours`. L'avertissement est **informatif et
non bloquant** — la correction est enregistrée dans tous les cas (NOTE_RH §5.1, QA-05).

**`GET /devices`** : la réponse n'est plus un tableau nu mais l'enveloppe
`{ silence_minutes, devices: [...] }` (QA-11). Chaque poste porte `online` (calculé sur
`silence_minutes`, plus sur 5 min en dur) et `alerte` (remontée à plat depuis
`heartbeat_info.alerte`, QA-02). `api_key_hash` n'est toujours **jamais** exposé.

**`GET /devices/:id/verify-chain`** : une charge canonique impossible à reconstituer (champ
vide ou contenant `|` en base — cf. QA-08) est rendue comme une **rupture**
(`raison: 'canonique_impossible'`), jamais comme une erreur 500.

**`GET /badges` (back-office)** : ajoute `badgeuse_optin_festif` (bool) et
`badgeuse_optin_festif_le` — la case se gère dans l'onglet Badges, avec sa date de recueil
(un consentement sans date ne prouve rien).

**`POST /contenus/lien` — gardes anti-SSRF (écran v2).** Le serveur devient client HTTP pour
que le poste n'ait jamais à l'être : cette route est donc la surface la plus sensible du lot.
Refus en **422** avec un `code` stable et un message lisible :

| `code` | Cas |
|---|---|
| `protocole` | autre chose que `https:` (jamais `http`, `file`, `data`…) |
| `ip_privee` | l'hôte **résout** vers une adresse privée / loopback / lien-local (169.254.169.254 des métadonnées cloud) / CGNAT / multicast — **une seule** adresse interne parmi plusieurs suffit à refuser |
| `dns` | nom non résolu, ou résolution vide |
| `redirections` | plus de 3 sauts (chaque saut est **revalidé** : un 302 vers une IP interne est refusé) |
| `http` | le tiers ne répond pas 2xx |
| `type` | Content-Type hors liste blanche image/vidéo (jpg, png, webp, gif, mp4, webm — **ni SVG ni HTML** : exécutables côté navigateur) |
| `trop_gros` | dépasse `badgeuse.lien_taille_max_mo`, en annoncé **comme en flux** (un serveur menteur sur `content-length` est coupé net) |

**Limite connue, documentée plutôt que tue** : entre la résolution DNS et la connexion, un
attaquant maîtrisant sa zone peut faire varier la réponse (*DNS rebinding*). S'en prémunir
imposerait de se connecter à l'IP validée avec l'en-tête `Host` d'origine, ce qui casse la
validation TLS. Risque résiduel accepté : l'écriture est réservée à ADMIN/RH (surface interne)
et le contenu rapatrié n'est jamais interprété (fichier statique servi tel quel).

**Diffusion des médias au poste — convention `media_id`.** La playlist device référence un
binaire par un identifiant **préfixé de son origine** : `c<id>` pour un contenu de playlist
(téléversé ou rapatrié d'un lien), `s<id>` pour le visuel d'un post social. Un seul point
d'entrée `GET /devices/:code/media/:id` plutôt que deux routes jumelles : le poste rejoue
l'identifiant **tel quel**, sans avoir à connaître la table d'origine. Le chemin de fichier
serveur ne part jamais vers le poste ; il est résolu strictement sous `uploads/badgeuse`
(aucun `..`, aucun chemin absolu) et le `Content-Type` est déduit d'une **liste blanche
d'extensions** — jamais du contenu, jamais d'un en-tête stocké — avec `nosniff`.

**Purge (BO-10) — deux périmètres ajoutés** au bilan de `badgeusePurgeRetention` :
`social_posts` (au-delà de `badgeuse.retention_social_jours`, fichiers supprimés **avant** les
lignes) et `medias_orphelins` (fichiers d'`uploads/badgeuse` qu'aucune ligne ne référence,
avec un **délai de grâce de 24 h** — sans lui, un téléversement en cours pourrait être effacé
entre l'écriture du fichier et l'INSERT qui le référence). Le job `syncBadgeuseSocial` ne
purge **délibérément rien** : deux purges concurrentes, ce sont deux règles qui divergent le
jour où l'une change.

## 4. Matrice de couverture exigences → implémentation

| Réf | Élément |
|---|---|
| PST-01..03, PST-05..10 | poste (`badgeuse/agent`, cf. CONTRAT_API_DEVICE) |
| PST-04 | `badgeuse_pointages.statut='orphelin'` + `/orphelins` |
| AFF-01..08 | `badgeuse/ui` + `/devices/:code/config` + `badgeuse_contenus` |
| BO-01 | `badgeuse_badges` + `badgeuse_badge_historique` |
| BO-02 | GET `/pointages` |
| BO-03 | `badgeuse_corrections` (additives) |
| BO-04 | `badgeuse_feuilles_temps` + moteur `badgeuse-engine` |
| BO-05 | GET `/anomalies` + statut orphelin |
| BO-06 | GET `/exports/paie` |
| BO-07 | GET `/exports/iae` |
| BO-08 | `badgeuse_contenus` + CRUD |
| BO-09 | heartbeat + `/devices` + job `checkBadgeuseDevices` |
| BO-10 | job `badgeusePurgeRetention` (dry-run possible, journalisé) |
| BO-11 | rôles + journalisation `rgpd_audit_log` |
| §4.1 minimisation / inaltérabilité / idempotence | CONTRAT_HMAC / CONTRAT_INTEGRITE / uuid UNIQUE |
| CDC v2 §1 (overlay personnalisé) | `GET /config` bloc `affichage` + drapeaux du cache badges |
| CDC v2 §2 (playlist enrichie) | générateurs serveur `annonces`/`actus`/`tournees`/`social`/`vak_live` + `GET /devices/:code/media/:id` |
| CDC v2 §3 (jours de VAK) | élément `vak_live` (périmètre caisse partagé `sqlPerimetreCaisse`) + `sync_playlist_interval_sec` abaissé à 300 s |
| CDC v2 §4 (paramétrage) | settings `badgeuse.msg_*`/`moment_*`/`phrases_motivation` + `POST /salaries/:id/optin-festif` + `PUT /social/config` |
| ADR-0004 §1/§4/§5 (interdits) | prénom + initiale partout, opt-in obligatoire, tournées sans chauffeur — verrouillés par `badgeuse-affichage-device.test.js` |
| ADR-0004 §6 (réseaux sociaux) | `badgeuse_social_posts` + job `syncBadgeuseSocial` (API officielle, jeton chiffré, vidéos = V2) |
