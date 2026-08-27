# Audits — Pointage/Badgeuse, journal d'activité, sauvegardes (lot L8)

**Date** : 26 août 2026 · **Chantier** : évolutions 2026-08-26 (voir `CONTRATS.md` §9) ·
**Nature** : audit factuel — constats sourcés fichier:ligne, preuves, actions faites,
reste à faire. **Aucune modification de comportement backend/API dans ce lot.** La seule
exception autorisée et appliquée est un bandeau non destructif dans `Pointage.jsx` (§1).

---

## 1. Pointage (module 25) vs Temps & Présence / Badgeuse (module 33)

### Constats

- Coexistence **assumée et documentée** par `docs/badgeuse/adr/0003-coexistence-module-pointage-existant.md`
  (ADR-0003, accepté août 2026) : la badgeuse est un module **neuf et distinct** (préfixe
  `badgeuse_`, routes `/api/badgeuse/*`) ; le module 25 « n'est pas modifié » (principe
  non-régression).
- **Qui écrit `work_hours`** : uniquement `backend/src/routes/pointage.js` — upsert après 4
  badgeages complets (`pointage.js:157-159`, `INSERT INTO work_hours ...`), lectures pour les
  résumés jour/mois (`:236`, `:265`). Vérifié : `grep -n "work_hours" backend/src/routes/badgeuse.js`
  → **0 résultat**.
- **`employee_week_hours`** (granularité hebdo ISO de l'import paie Malibou) : même constat,
  0 écriture depuis `badgeuse.js` — ADR-0003 §3 le justifie explicitement (« répartir des
  heures hebdo sur des jours inventerait de la donnée »).
- Les données badgeuse vivent exclusivement dans `badgeuse_pointages`/`badgeuse_feuilles_temps`
  et ressortent par les **exports** paie (`badgeuse.js:1500`, action journalisée
  `BADGEUSE_EXPORT_PAIE`) et IAE (`:1548`, `BADGEUSE_EXPORT_IAE`) — jamais par une écriture
  directe dans les tables RH consommées par les KPI existants (formation, absentéisme…).
- Habilitations **identiques** sur les deux écrans : `frontend/src/App.jsx:203` (`/pointage`) et
  `:284` (`/badgeuse`) sont tous deux `ProtectedRoute roles={['ADMIN','RH','MANAGER']}`.
- Mise en service de la badgeuse **conditionnée**, non encore actée : `docs/badgeuse/JOURNAL.md:36`
  — « le logiciel peut être montré en réunion, mais **aucune mise en service avant le PV** [de
  consultation du CSE] » ; pilote à blanc 4 semaines puis recette matérielle RP-1→RP-6 avant mise
  en service réelle (cf. `RAPPORT_QA.md`, rappelé par CLAUDE.md §12 notes 2.22.0/2.23.0). Rien
  dans le dépôt n'indique que cette consultation a eu lieu à ce jour.
- Écarts fonctionnels réels justifiant la trajectoire, listés par l'ADR-0003 lui-même : le
  module 25 stocke l'UID de badge **en clair**, authentifie les bornes par clé API en clair
  comparée en SQL, n'a ni chaîne d'intégrité, ni corrections additives, ni feuilles de temps, ni
  exports paie/IAE.

### Preuves

- `grep -rn "work_hours\|employee_week_hours" backend/src/routes/badgeuse.js` → 0 résultat.
- `grep -n "work_hours" backend/src/routes/pointage.js` → lignes 111, 157, 159, 236, 265 (seul
  écrivain du module).
- `grep -n "roles=" frontend/src/App.jsx` sur les routes `/pointage` et `/badgeuse` → même
  tableau de rôles.
- `docs/badgeuse/adr/0003-coexistence-module-pointage-existant.md` et `docs/badgeuse/JOURNAL.md`
  lus intégralement pour les citations ci-dessus.

### Actions faites (non destructives)

- Bandeau informatif ajouté en tête de `frontend/src/pages/Pointage.jsx` (juste après le
  `PageHeader`, avant les onglets) : explique que la badgeuse est appelée à remplacer Pointage à
  terme, que sa mise en service reste conditionnée à la consultation préalable du CSE, que
  Pointage reste la **seule** source des heures utilisées par les KPI RH et le planning tant que
  ce n'est pas fait, et pointe vers la route réelle `/badgeuse` (le prompt de lot mentionnait
  `/rh/temps-presence`, qui n'existe pas dans `App.jsx` — vérifié ; la route effective est
  `/badgeuse`, même garde de rôles). **Aucune fonction retirée, aucune route ni comportement
  backend touché.**

### Reste à faire (arbitrage Direction, hors périmètre L8)

- La trajectoire de décommissionnement du module 25 est déjà esquissée par l'ADR-0003
  (§ Conséquences : migration `pointage_events` → `badgeuse_pointages` `source='import'`, « non
  réalisée en V1 ») — à planifier une fois la badgeuse effectivement mise en service (post-CSE,
  post-recette matérielle).
- Tant que la badgeuse n'est pas en service, il n'existe pas de redondance de **données** (deux
  tables disjointes, deux écrans étanches) — seulement une redondance **fonctionnelle** (deux
  façons de suivre la présence). Le risque identifié n'est pas un double-compte silencieux mais
  une confusion d'écran pour l'utilisateur ; le bandeau ajouté adresse ce risque précis.

---

## 2. Journal d'activité — `user_activity_log` vs `rgpd_audit_log`

### Constats

Deux systèmes de journalisation **non reliés** cohabitent :

1. **`user_activity_log`** — alimenté uniquement par `middleware/activity-logger.js`
   (`logActivity`/`autoLogActivity`), lu par `routes/activity-log.js`, traduit à l'écran par
   `frontend/src/pages/ActivityLog.jsx` via deux tables `ENTITY_LABELS`/`ACTION_LABELS` (+
   `ACTION_COLORS`), **gardées** par `backend/tests/unit/activity-log-libelles.test.js`.
2. **`rgpd_audit_log`** — alimenté par 16 fichiers différents (`services/db-backup.js`,
   `services/messagerie.js`, `services/scheduler.js`, `routes/rgpd.js`, `routes/admin-db.js`,
   `routes/exports.js`, `routes/effectifs.js`, `routes/badgeuse.js`, `routes/badgeuse-device.js`,
   4 scripts `scripts/*.js`…), lu par `routes/rgpd.js`, affiché par `frontend/src/pages/RGPD.jsx`
   **sans aucune traduction** — `RGPD.jsx:127` : `render: (a) => <span className="... bg-purple-100
   ...">{a.action}</span>` — le code technique brut s'affiche tel quel à l'écran (ex.
   `DB_BACKUP`, `AUTO_PURGE_MESSAGERIE`, `ASP_LIAISON_SUPPRESSION`, `BADGEUSE_ORPHELIN_RATTACHEMENT`,
   `CAV_REMPLISSAGE_RESET`, `EXPORT_INSERTION_FREINS_SENSIBLE`…) — **≥ 35 codes distincts recensés
   par lecture des 16 fichiers (liste non exhaustive, un balayage automatisé serait nécessaire
   pour la garantir complète)**. Exactement le constat annoncé par `CONTRATS.md` §9.2.

### Preuves — le guard `activity-log-libelles.test.js` (couvre le volet 1 ci-dessus)

**Exécuté avant toute modification de ce lot : VERT** (`Test Suites: 1 passed`, `Tests: 4
passed`). Recensement manuel, avec la **même** méthode que le test (parcours de tout
`backend/src`, regex `autoLogActivity\('...'\)` et `entityType:\s*'...'`), pour vérifier
indépendamment ce résultat :

- **31** appels `autoLogActivity('xxx')` distincts, un par fichier de routes (`achats.js:68`,
  `badgeuse.js:56`, `billing.js:12`, `boutique-commandes.js:15`, `boutique-ventes.js:42`,
  `boutiques.js:14`, `candidates/crud.js:14`, `cav.js:65`, `clients-exutoires.js:10`,
  `commandes-exutoires.js:12`, `effectifs.js:55`, `employees.js:48`, `energie.js:38`,
  `enquetes.js:254`, `expeditions.js:9`, `finance.js:22`, `insertion/routes.js:32`,
  `newsfeed.js:35`, `pennylane.js:317`, `pointage.js:174`, `production.js:11`,
  `referentiels.js:10`, `rse.js:53`, `settings.js:10`, `stock-original.js:198`, `stock.js:10`,
  `teams.js:10`, `tri.js:10`, `users.js:12`, `vak.js:207`, `vehicles.js:158`).
- **5 valeurs distinctes** de `entityType: 'xxx'` littéral (9 occurrences au total) :
  `api_key` (`admin-api-keys.js` ×3), `boutique_commandes` (`boutique-commandes.js:124`),
  `commandes_exutoires` (`commandes-exutoires.js:590`, `services/state-machine.js:10`),
  `custom_role` (`permissions.js` ×2), `role_module_access` (`permissions.js:254`).
- Total : **36 valeurs d'`entity_type` réellement écrites** dans `user_activity_log` — toutes
  déjà présentes dans `ENTITY_LABELS` de `ActivityLog.jsx`, y compris `badgeuse`, `effectifs`,
  `energie`, `enquetes`, `achats`, `rse` explicitement cités comme suspects par la consigne du
  lot. **Aucune entité manquante trouvée.**
- Toutes les actions possibles (`create`/`update`/`delete` dérivées de la méthode HTTP par
  `autoLogActivity`, + `login`/`logout`/`login_failed`/`password_change` de `auth.js`, +
  `role_create`/`role_delete`/`permissions_matrix_update`/`api_key_create`/`api_key_update`/
  `api_key_delete` de `permissions.js`/`admin-api-keys.js`) sont couvertes par `ACTION_LABELS`
  **et** `ACTION_COLORS`.
- Vérification qu'aucun appel `logActivity(` (hors `autoLogActivity`) n'échappe à la détection
  par regex du test via un `entityType` **variable** (qui serait invisible à un simple grep de
  littéraux) : les seuls appels directs sont dans `auth.js` (sans `entityType`) et
  `admin-api-keys.js`/`permissions.js` (déjà comptés, `entityType` littéral).
- Fait notable, sans conséquence : `entity_type='tour'` — présent dans `ENTITY_LABELS` (« Tournée »)
  — n'est en réalité **jamais écrit** (`grep -rn "autoLogActivity|entityType" backend/src/routes/tours/
  backend/src/routes/tours.js` → 0 résultat). Étiquette morte et inoffensive : le test ne vérifie
  que « tout code écrit a un libellé », pas l'inverse. Signalé pour mémoire, non corrigé (rien à
  réparer, entrée surnuméraire sans effet).
- **Conclusion** : le volet `user_activity_log`/`ActivityLog.jsx` était **déjà intégralement à
  jour** avant que ce lot ne commence — vraisemblablement suite à une passe antérieure (le
  commentaire du test lui-même relate une correction historique de « 14 entités sur 35 »
  absentes, déjà traitée). **Aucune entité neuve de ce chantier n'écrit dans `user_activity_log`** :
  la messagerie en est explicitement exclue par arbitrage (`CONTRATS.md` §12.6, confirmé en
  code — `backend/src/scripts/init-db.js:8074` : « La messagerie n'est PAS journalisée dans
  user_activity_log (volumétrie + vie privée) ») ; le configurateur de chaîne
  (`chaine-config.js`) et la récurrence de commandes (`commandes-recurrence.js`) n'introduisent
  eux non plus aucun nouvel `entityType`.

### Actions faites

- Guard test exécuté et **vert avant et après** ce lot (`cd backend && npx jest
  tests/unit/activity-log-libelles.test.js` → 4/4 verts) — c'est la preuve demandée par le lot.
  **Aucune édition n'a été nécessaire dans `ActivityLog.jsx`** : rien n'y manquait.

### Reste à faire (documenté, **pas d'extension de la garde dans ce chantier** — `CONTRATS.md` §9.2)

- `rgpd_audit_log` n'a **aucune** traduction française et **aucune** garde anti-dérive.
  Proposition (non implémentée ici) : ajouter une table `ACTION_LABELS_RGPD` dans `RGPD.jsx` sur
  le même modèle que `ActivityLog.jsx`, puis un second test garde
  (`rgpd-audit-log-libelles.test.js`) sur le même principe (parcours du code source, regex sur
  les littéraux `'XXXX'` passés en 2ᵉ position des appels `INSERT INTO rgpd_audit_log`/
  `pool.query(... rgpd_audit_log ...)`). **Risque explicitement identifié si fait dans ce
  chantier** : plusieurs lots en parallèle (L1 a introduit `AUTO_PURGE_MESSAGERIE`, d'autres
  auraient pu faire de même) auraient pu se marcher dessus sans le voir avant intégration — d'où
  le report demandé par `CONTRATS.md`.
- Recommandation annexe, cosmétique : un test miroir sur `ActivityLog.jsx` (chaque libellé
  **déclaré** correspond à un code **réellement** écrit) repérerait les entrées mortes comme
  `tour` — non fait ici, hors périmètre et sans impact utilisateur.

---

## 3. Sauvegardes

### Constats

**Deux chaînes de sauvegarde parallèles, à formats INCOMPATIBLES :**

| | Chaîne applicative | Chaîne serveur |
|---|---|---|
| Fichiers | `backend/src/services/db-backup.js` + `backend/src/routes/admin-db.js` | `deploy/scripts/backup.sh` + `deploy/scripts/backup-s3.sh` |
| Commande | `pg_dump --no-owner --no-acl` **sans** `--format=` → SQL **texte brut** | `pg_dump --format=custom` → archive **binaire** |
| Restauration | `POST /api/admin-db/restore` → `psql -f` (`admin-db.js:116`) | `deploy/scripts/restore.sh:49` → `pg_restore --clean --if-exists` |
| Stockage | Volume Docker nommé `solidata-backups-v2` (`docker-compose.prod.yml:110`, monté `/app/backups`) | `/opt/solidata.online-backups` (hôte, hors du dépôt applicatif) |

Un fichier `.sql` de la chaîne applicative est **inutilisable** par `restore.sh` (qui attend un
`.dump` custom) et réciproquement — confirmé en lisant le code des deux outils de restauration
(aucun test empirique de restauration croisée effectué, le code des deux binaires `psql -f` vs
`pg_restore` suffit à établir l'incompatibilité de format).

- **`pg_dump` sans filtre de table dans les DEUX chaînes** (`db-backup.js:143`,
  `execFileSync('pg_dump', ['--no-owner','--no-acl','-f',filepath], ...)` — aucune option
  `-t`/`--table` ; `backup.sh:25` et `backup-s3.sh:72`, idem avec `--format=custom`) → **toute
  nouvelle table créée par `init-db.js` est automatiquement couverte par les deux mécanismes**,
  y compris les tables neuves de ce chantier (`messagerie_*`, `chaine_layouts`,
  `chaine_layout_postes`, `tour_gps_stops`) — **aucune modification de script requise**.
- `deploy.sh update` appelle **automatiquement** `bash deploy/scripts/backup.sh` (sans argument
  → `TYPE="${1:-manual}"`, conservé 90 j) à l'**étape 1/7**, avant tout `git pull`/rebuild
  (`deploy.sh:330-334`) — un filet de sécurité systématique à chaque déploiement, indépendant du
  cron.
- La sauvegarde **quotidienne** (2h, type `daily`, 30 j de rétention), le health-check 5 min, le
  renouvellement SSL 2×/jour et le nettoyage des logs dépendent **tous** de `crontab
  deploy/crontab.txt` (Étape 5 de `deploy/DEPLOIEMENT.md`) — or `deploy/scripts/init-server.sh:105`
  exécute `crontab -r` (purge **inconditionnelle** du crontab existant) pendant la préparation
  du serveur et **ne le réinstalle pas**. Le cron doit donc être posé à la main après
  `init-server.sh`, sans rappel automatique ni vérification dans `deploy.sh`.
- Un troisième script, `deploy/scripts/backup-s3.sh` (copie **off-site** Scaleway/S3-compatible,
  sommes SHA-256, alerte webhook — introduit en v1.5.0 selon `CLAUDE.md` §12) existe mais
  **n'est référencé nulle part dans `deploy/crontab.txt`** : sans configuration manuelle de
  `/etc/solidata-backup.env` et sans entrées cron dédiées (le script documente lui-même son
  usage cron en en-tête, jamais posé), **aucune copie de sauvegarde ne quitte le serveur** — les
  trois emplacements (`deploy/backups` bind-mount du service `db`, `solidata-backups-v2`,
  `/opt/solidata.online-backups`) vivent sur le même disque Scaleway.
- Les **uploads** (`/app/uploads`, volume `solidata-uploads`) ne sont couverts **que** par la
  chaîne serveur (`backup.sh`/`backup-s3.sh`, `tar czf` du volume) — la chaîne applicative est
  base de données **seule** (`pg_dump`), aucun fichier.
- `RECONSTRUCTION.md` (avant correction de ce lot) listait `backend/src/scripts/migrate-v2.js`
  comme étape de reconstruction (2 occurrences) — ce fichier **n'existe pas** dans le dépôt
  (`ls backend/src/scripts/migrate-v2.js` → absent). `deploy.sh:297` s'en protège déjà (`if [ -f
  "backend/src/scripts/migrate-v2.js" ]`) mais la documentation, elle, le présentait comme une
  commande à lancer directement.
- `migrate-cav-sensors.js` et `migrate-indexes.js` existent mais n'étaient mentionnés nulle part
  dans `RECONSTRUCTION.md`. `migrate-cav-sensors.js` est en réalité **auto-appliqué à chaque
  démarrage du backend** (`backend/src/index.js:562`, fonction `initOnStartup`, **mais
  seulement si le schéma compte déjà ≥ 5 tables** — donc pas au tout premier boot sur base
  vide, où seul `initDatabase()` est déclenché). `migrate-indexes.js` n'est **pas** auto-appliqué
  (script autonome avec son propre `pool.end()`/`process.exit()`) — doit être lancé à la main.

### Preuves

- Lecture complète de `backend/src/services/db-backup.js`, `backend/src/routes/admin-db.js`,
  `deploy/scripts/backup.sh`, `deploy/scripts/backup-s3.sh`, `deploy/scripts/restore.sh`,
  `deploy/crontab.txt`, `deploy/scripts/init-server.sh`, `backend/src/index.js` (bloc
  `initOnStartup`, lignes ~520-620) — extraits cités ci-dessus, fichier:ligne.
- `docker-compose.prod.yml:11-13` (service `db`, bind mount `./deploy/backups:/backups`),
  `:108-111` (service `backend`, volumes `uploads:/app/uploads` + `backups:/app/backups`),
  `:212-220` (déclaration des volumes nommés `solidata-uploads`/`solidata-backups-v2`).
- `ls backend/src/scripts/*.js | grep migrate` → `migrate-cav-sensors.js`,
  `migrate-exutoires.js`, `migrate-finance.js`, `migrate-indexes.js` (pas de `migrate-v2.js`).

### Actions faites (documentation uniquement — aucun fichier `deploy/scripts/` touché)

- **`RECONSTRUCTION.md`** :
  - Bandeau de mise à jour en tête de fichier signalant que le panorama modules/pages (§1-§10)
    est une photo historique v1.0.0 (12 modules) alors que le périmètre réel est de **33
    modules** (renvoi vers `CLAUDE.md` §5-6 comme référence à jour) — corrige le point
    « périmètre 33 modules » du contrat sans dupliquer/faire dériver une seconde liste complète
    des modules dans ce document.
  - §12 (« Procédure de reconstruction ») : retrait des deux appels à `migrate-v2.js` (Étape 5
    et Étape 8), remplacés par une note explicite indiquant que le fichier n'existe pas ; ajout
    d'une note expliquant l'auto-application idempotente de `migrate-exutoires.js`/
    `migrate-finance.js`/`migrate-cav-sensors.js` par `index.js` (condition ≥ 5 tables) et la
    non-automatisation de `migrate-indexes.js` (désormais mentionné comme étape optionnelle).
  - Nouvelle sous-section « Sauvegardes — quoi restaurer avec quoi » : tableau comparatif des
    deux chaînes (déclenchement, format, fichiers, stockage, outil de restauration, couverture
    des uploads), avertissement explicite sur l'incompatibilité des formats, confirmation de la
    couverture automatique des nouvelles tables par `pg_dump`, mention de `backup-s3.sh` et de
    son absence du cron, rappel qu'`init-server.sh` purge le crontab sans le reposer.
- **`deploy/DEPLOIEMENT.md`** : nouvelle section « Vérifier les sauvegardes » (entre
  « Opérations courantes » et « Mode maintenance ») — rappelle les deux chaînes, donne la
  commande de vérification/réinstallation du cron (`crontab -l | grep backup.sh || crontab
  deploy/crontab.txt`) et les commandes de contrôle des fichiers récents dans chaque
  emplacement, signale l'existence de `backup-s3.sh` et sa non-activation par défaut, rappelle
  la garantie de couverture automatique des nouvelles tables par `pg_dump`.

### Reste à faire (constats de CODE, hors périmètre L8 — `deploy/scripts/` interdit à ce lot)

- **Besoin d'intégration** (fichier hors périmètre L8, `deploy/scripts/init-server.sh` n'est
  attribué à aucun lot du chantier courant) : `init-server.sh` pourrait réinstaller `crontab
  deploy/crontab.txt` lui-même en fin de script au lieu de se contenter de le purger
  (`crontab -r` à la ligne 105), pour qu'un serveur fraîchement initialisé ait ses
  sauvegardes/health-check/SSL actifs sans étape manuelle oubliable. Édit prêt à intégrer :
  après la section `# --- Crontab ---` (ligne ~103-106), ajouter
  `crontab "${APP_DIR:-/opt/solidata.online}/deploy/crontab.txt" 2>/dev/null || true` — sous
  réserve que `$APP_DIR` soit déjà résolu à ce point du script (à vérifier par l'agent qui
  touchera ce fichier, non vérifié ici puisque `deploy/scripts/` est interdit à L8).
- `backup-s3.sh` n'est jamais invoqué automatiquement (ni par `deploy.sh`, ni par
  `crontab.txt`) — c'est un choix d'exploitation qui nécessite des credentials S3 externes ; à
  arbitrer par la Direction/Ops si une copie off-site est requise (le dépôt ne peut pas décider
  seul de créer un bucket et des identifiants).
- Aucun mécanisme n'alerte automatiquement si les DEUX chaînes de sauvegarde n'ont pas produit
  de fichier récent (pas de `job_runs`/`JOB_SCHEDULE` pour `backup.sh`/`backup-s3.sh`,
  contrairement à `autoDatabaseBackup` qui, lui, est instrumenté côté applicatif). Piste pour un
  chantier ultérieur.

---

## Récapitulatif — fichiers touchés par ce lot (L8)

- `rapports/evolutions-2026-08-26/AUDITS.md` — neuf, ce document.
- `frontend/src/pages/Pointage.jsx` — bandeau informatif non destructif (import `Link` +
  `Info`, aucune logique existante modifiée).
- `RECONSTRUCTION.md` — bandeau de mise à jour + corrections §12 (retrait `migrate-v2.js`,
  mention `migrate-cav-sensors.js`/`migrate-indexes.js`, nouvelle sous-section doctrine de
  sauvegarde).
- `deploy/DEPLOIEMENT.md` — nouvelle section « Vérifier les sauvegardes ».
- **Non touchés** (vérifié) : `frontend/src/pages/ActivityLog.jsx` (rien n'y manquait — preuve
  au §2), tout fichier `deploy/scripts/`, toute route/service backend, tout schéma de base.
