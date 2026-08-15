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
| heartbeat_info | JSONB | dernier heartbeat brut (dérive, temp, file, disque…) |
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

### `badgeuse_feuilles_temps` (BO-04)
`id SERIAL, employee_id INTEGER NOT NULL REFERENCES employees(id), periode VARCHAR(7) NOT
NULL ('YYYY-MM'), heures_theoriques NUMERIC(6,2), heures_pointees NUMERIC(6,2),
heures_validees NUMERIC(6,2), detail JSONB (par jour : événements effectifs, heures, anomalies,
règles appliquées), statut VARCHAR(20) CHECK IN ('brouillon','validee_encadrant','validee_rh')
DEFAULT 'brouillon', valide_encadrant_par/le, valide_rh_par/le, updated_at,
UNIQUE(employee_id, periode)`.
Validation RH : transaction + `rgpd_audit_log` (`BADGEUSE_FEUILLE_VALIDATION`), pattern
`effectifs.js` ETP_ASP. Dévalidation : ADMIN uniquement, journalisée.

### `badgeuse_contenus` (playlist, BO-08)
`id SERIAL, site_id INTEGER REFERENCES badgeuse_sites(id), type VARCHAR(20) CHECK IN
('message','image','planning','compte_a_rebours','meteo'), titre VARCHAR(200), corps TEXT,
media_url VARCHAR(300), ordre INTEGER DEFAULT 0, duree_sec INTEGER DEFAULT 10 (5–60),
visible_du DATE, visible_au DATE, actif BOOLEAN DEFAULT true, cree_par INTEGER REFERENCES
users(id), created_at, updated_at`. Aucune donnée personnelle dans ces contenus (finalité
communication interne dissociée — NOTE_JURIDIQUE §3.2) : pas de FK employé, et le back-office
l'affiche en avertissement.

## 2. Paramètres (`settings`, catégorie `badgeuse`)

Voir ADR-0002 (règles de gestion, défauts = recommandations RH) + conservation :
`badgeuse.retention_pointages_mois` (60), `badgeuse.retention_feuilles_mois` (60),
`badgeuse.retention_badges_apres_restitution_jours` (90),
`badgeuse.retention_contenus_apres_expiration_jours` (365),
`badgeuse.retention_journal_acces_mois` (12) — valeurs NOTE_JURIDIQUE §3.7.
Marqueur d'arbitrage : `badgeuse.regles_validees_le` (+ `badgeuse.regles_validees_par`).
Secrets chiffrés : `badgeuse.hmac_key_site_<id>`.

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
| GET/POST/PUT/DELETE `/contenus` | READ / WRITE_RH | BO-08 (prévisualisation côté front) |
| GET `/devices`, POST `/devices`, PATCH `/devices/:id`, POST `/devices/:id/regenerate-key`, GET `/devices/:id/verify-chain` | READ (liste) / ADMIN_ONLY (écritures) | BO-09 + CONTRAT_INTEGRITE §4 |
| GET `/mes-pointages` | tout rôle authentifié | droit d'accès art. 15 (lien `employees.user_id`) |
| GET `/salaries/:employeeId/releve?periode=` | READ (journalisé) | récapitulatif remis au salarié (sortie, contestation) |

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
