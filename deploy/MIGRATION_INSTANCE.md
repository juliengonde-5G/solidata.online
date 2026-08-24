# SOLIDATA — Migration vers une instance plus grande

> Guide pas-à-pas pour passer la production Scaleway d'une **DEV1-S** (2 vCPU,
> 2 Go, disque local ~17 Go utiles) à une **DEV1-L** (4 vCPU, 8 Go), sans perdre
> de données et avec une coupure de service de l'ordre de **10 minutes**.
>
> Rédigé le 24/08/2026, après une panne causée par un disque à 95 %.

---

## 1. Pourquoi cette méthode

Deux voies existent. **Celle décrite ici consiste à monter une machine neuve à
côté de l'ancienne, puis à basculer l'adresse IP.**

L'outil « Changer de type d'offre » de la console Scaleway refuse de migrer une
instance à stockage **local** vers une autre offre. Il faut d'abord convertir le
volume en **Block Storage**, ce qui impose : instantané → export en QCOW2 vers un
bucket Object Storage → réimport → création du volume. Sur 20 Go, c'est long,
cela demande un bucket, et chaque étape peut échouer **sur la machine qui porte
votre production**.

Monter une instance neuve est plus sûr pour trois raisons :

1. **L'ancienne continue de servir** pendant toute la préparation. La coupure se
   limite à la bascule d'IP.
2. **Le retour arrière est immédiat** : tant que l'ancienne instance existe, il
   suffit de lui rendre l'adresse IP.
3. **Vous repartez sur un disque propre**, au lieu de traîner un disque rempli à
   95 % par des mois d'images Docker.

L'annexe (§9) décrit la migration sur place, si vous préférez cette voie.

---

## 2. Avant de commencer

**Fenêtre** : hors tournée. Après 18 h ou avant 6 h 30. Jamais pendant qu'un
chauffeur est en collecte.

**Durée** : 1 h 30 à 2 h au total, dont ~10 minutes de coupure réelle.

**À avoir sous la main** :

- [ ] Accès à la console Scaleway
- [ ] Votre clé SSH
- [ ] Le contenu du fichier `.env` du serveur actuel (**il n'est pas dans Git**)
- [ ] Un terminal sur votre Mac, pour rapatrier les sauvegardes

**Vérification préalable — aucune tournée en cours, aucune action en attente :**

```bash
# Sur le serveur actuel
docker compose -f docker-compose.prod.yml exec -T db psql -U solidata_user -d solidata -c \
  "SELECT id, date, status FROM tours WHERE status IN ('in_progress','paused','returning');"
```

Si des lignes sortent, un chauffeur est en tournée : **reportez**. Et si un
téléphone affiche encore « N actions en attente d'envoi », faites-les remonter
avant de couper quoi que ce soit — elles n'existent que dans ce navigateur.

---

## 3. Phase 0 — Sauvegarder (30 min, sans coupure)

### 3.1 Sauvegarde complète

```bash
cd /opt/solidata.online
bash deploy/scripts/backup.sh manual
ls -lh /opt/solidata.online-backups/ | tail -5
```

Vous obtenez deux fichiers : `db_manual_<date>.dump.gz` et
`uploads_manual_<date>.tar.gz`.

### 3.2 Les rapatrier — étape non négociable

Une sauvegarde qui reste sur la machine qu'on migre ne sauve rien.

```bash
# Depuis votre Mac
mkdir -p ~/solidata-migration && cd ~/solidata-migration
scp root@51.159.144.100:/opt/solidata.online-backups/db_manual_*.dump.gz .
scp root@51.159.144.100:/opt/solidata.online-backups/uploads_manual_*.tar.gz .
scp root@51.159.144.100:/opt/solidata.online/.env .env.production
ls -lh
```

Le `.env` contient vos mots de passe, la clé JWT, les jetons Pennylane, SumUp,
Brevo, Anthropic et TomTom. **Il n'est pas dans Git** : sans lui, la nouvelle
machine ne démarre pas. Conservez-le hors du dépôt et ne le committez jamais.

### 3.3 Noter l'état de référence

Vous en aurez besoin pour prouver que rien n'a été perdu.

```bash
docker compose -f docker-compose.prod.yml exec -T db psql -U solidata_user -d solidata -At -F'|' -c "
SELECT 'employees', COUNT(*)::text FROM employees
UNION ALL SELECT 'cav', COUNT(*)::text FROM cav
UNION ALL SELECT 'tours', COUNT(*)::text FROM tours
UNION ALL SELECT 'tonnage_history', COUNT(*)::text FROM tonnage_history
UNION ALL SELECT 'production_daily', COUNT(*)::text FROM production_daily
UNION ALL SELECT 'stock_movements', COUNT(*)::text FROM stock_movements
UNION ALL SELECT 'badgeuse_pointages', COUNT(*)::text FROM badgeuse_pointages
UNION ALL SELECT 'insertion_milestones', COUNT(*)::text FROM insertion_milestones;"
```

**Copiez cette sortie dans un fichier texte.** C'est votre référence.

---

## 4. Phase 1 — Créer la nouvelle instance (20 min, sans coupure)

Dans la console Scaleway :

1. **Instances → Créer une instance**
2. Même **zone de disponibilité** que l'actuelle (indispensable pour transférer
   l'adresse IP)
3. Offre **DEV1-L** — 4 vCPU, 8 Go
4. Image **Ubuntu 22.04 LTS** (identique à l'existant)
5. Stockage : **Block Storage**, **au moins 80 Go**
6. Votre clé SSH
7. **Ne demandez pas d'IP flexible** : vous allez transférer celle de l'ancienne
8. Nom suggéré : `solidata-erp-v2`

Notez l'adresse IP temporaire attribuée à la création.

---

## 5. Phase 2 — Installer et restaurer (40 min, toujours sans coupure)

L'ancienne machine sert toujours vos utilisateurs pendant toute cette phase.

### 5.1 Socle système

```bash
ssh root@<IP_TEMPORAIRE>
curl -fsSL https://raw.githubusercontent.com/juliengonde-5G/solidata.online/main/deploy/scripts/init-server.sh -o init-server.sh
bash init-server.sh
```

Le script installe Docker, le pare-feu, Fail2ban, le swap, logrotate, et clone
le dépôt dans `/opt/solidata.online`.

### 5.2 Remettre le `.env`

```bash
# Depuis votre Mac
scp ~/solidata-migration/.env.production root@<IP_TEMPORAIRE>:/opt/solidata.online/.env
```

### 5.3 Les fichiers absents du dépôt

`docker-compose.prod.yml` monte des fichiers en lecture seule. **S'ils n'existent
pas, Docker crée un dossier vide à leur place** et le conteneur démarre avec un
montage inutilisable. Deux entrées ne sont pas dans Git :

```bash
ssh root@<IP_TEMPORAIRE>
cd /opt/solidata.online
mkdir -p boutiques-csv
touch "Carte des PAV au 28-02-2026.kml"   # ou copiez le vrai fichier depuis l'ancien serveur
ls -la *.xlsx *.xlsm *.kml boutiques-csv
```

Pour récupérer le vrai KML depuis l'ancienne machine :

```bash
# Depuis votre Mac
scp root@51.159.144.100:"/opt/solidata.online/Carte des PAV au 28-02-2026.kml" .
scp "Carte des PAV au 28-02-2026.kml" root@<IP_TEMPORAIRE>:/opt/solidata.online/
```

### 5.4 Démarrer la pile

```bash
cd /opt/solidata.online
docker compose -f docker-compose.prod.yml up -d db redis
sleep 20
docker compose -f docker-compose.prod.yml ps
```

Attendez que `solidata-db` soit `healthy`.

### 5.5 Restaurer la base

```bash
# Depuis votre Mac
scp ~/solidata-migration/db_manual_*.dump.gz root@<IP_TEMPORAIRE>:/tmp/
scp ~/solidata-migration/uploads_manual_*.tar.gz root@<IP_TEMPORAIRE>:/tmp/
```

```bash
# Sur la nouvelle machine
cd /opt/solidata.online
gunzip -c /tmp/db_manual_*.dump.gz > /tmp/solidata.dump
docker cp /tmp/solidata.dump solidata-db:/tmp/solidata.dump
docker compose -f docker-compose.prod.yml exec -T db \
  pg_restore -U solidata_user -d solidata --clean --if-exists --no-owner /tmp/solidata.dump
```

`pg_restore` affiche des avertissements sur des objets absents : c'est normal
avec `--clean` sur une base neuve. Ce qui compte, c'est l'absence d'erreur
fatale.

### 5.6 Restaurer les uploads

```bash
docker run --rm -v solidata-uploads:/data -v /tmp:/backup alpine \
  tar xzf /backup/uploads_manual_*.tar.gz -C /data
docker run --rm -v solidata-uploads:/data alpine sh -c 'ls /data | wc -l'
```

### 5.7 Vérifier les compteurs

```bash
docker compose -f docker-compose.prod.yml exec -T db psql -U solidata_user -d solidata -At -F'|' -c "
SELECT 'employees', COUNT(*)::text FROM employees
UNION ALL SELECT 'cav', COUNT(*)::text FROM cav
UNION ALL SELECT 'tours', COUNT(*)::text FROM tours
UNION ALL SELECT 'tonnage_history', COUNT(*)::text FROM tonnage_history
UNION ALL SELECT 'production_daily', COUNT(*)::text FROM production_daily
UNION ALL SELECT 'stock_movements', COUNT(*)::text FROM stock_movements
UNION ALL SELECT 'badgeuse_pointages', COUNT(*)::text FROM badgeuse_pointages
UNION ALL SELECT 'insertion_milestones', COUNT(*)::text FROM insertion_milestones;"
```

**Comparez ligne à ligne avec la référence de §3.3.** Un écart, même d'une
seule ligne, doit être compris **avant** d'aller plus loin. Ne basculez pas
sur un doute.

### 5.8 Démarrer le reste

```bash
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml ps
curl -sS -o /dev/null -w "backend=%{http_code}\n" http://localhost/api/health
```

Nginx va se plaindre des certificats, absents à ce stade. C'est attendu : ils
arriveront avec l'adresse IP, en §6.


### 5.9 Récupérer les certificats SSL

**À faire maintenant, pendant que l'ancienne machine tourne encore.** Après
extinction, ils ne seront plus accessibles.

```bash
# Depuis votre Mac
ssh root@51.159.144.100 "docker run --rm -v solidata-certbot-etc:/d alpine tar czf - -C /d ." > ~/solidata-migration/certs.tar.gz
scp ~/solidata-migration/certs.tar.gz root@<IP_TEMPORAIRE>:/tmp/
```

```bash
# Sur la nouvelle machine
docker run --rm -v solidata-certbot-etc:/d -v /tmp:/b alpine tar xzf /b/certs.tar.gz -C /d
docker run --rm -v solidata-certbot-etc:/d alpine ls /d/live/
```

Recopier les certificats évite de solliciter Let's Encrypt, qui plafonne le
nombre d'émissions par semaine et par domaine.

---

## 6. Phase 3 — La bascule (10 minutes de coupure)

### 6.1 Arrêter proprement l'ancienne machine

```bash
ssh root@51.159.144.100
cd /opt/solidata.online
docker compose -f docker-compose.prod.yml stop
```

À partir d'ici, le service est coupé. **Le chronomètre tourne.**

### 6.2 Une dernière sauvegarde différentielle

Entre la sauvegarde de §3 et maintenant, des données ont pu être saisies.

```bash
docker compose -f docker-compose.prod.yml start db
sleep 15
docker compose -f docker-compose.prod.yml exec -T db \
  pg_dump -U solidata_user -d solidata --format=custom -f /tmp/final.dump
docker cp solidata-db:/tmp/final.dump /tmp/final.dump
docker compose -f docker-compose.prod.yml stop
```

```bash
# Depuis votre Mac
scp root@51.159.144.100:/tmp/final.dump ~/solidata-migration/
scp ~/solidata-migration/final.dump root@<IP_TEMPORAIRE>:/tmp/
```

```bash
# Sur la nouvelle machine
docker cp /tmp/final.dump solidata-db:/tmp/final.dump
docker compose -f docker-compose.prod.yml exec -T db \
  pg_restore -U solidata_user -d solidata --clean --if-exists --no-owner /tmp/final.dump
```

### 6.3 Transférer l'adresse IP

Dans la console Scaleway, **Réseau → IP flexibles** :

1. Repérez `51.159.144.100`
2. **Détacher** de `solidata-erp`
3. **Attacher** à `solidata-erp-v2`

Aucun changement DNS n'est nécessaire : l'adresse suit. Vos certificats,
le lien `/v/<token>` posé sur le téléphone des chauffeurs et la badgeuse
continuent de fonctionner.

> Si l'adresse n'est pas détachable (IP routée non flexible), attachez une IP
> flexible à la nouvelle instance et mettez à jour l'enregistrement DNS `A`
> de `solidata.online`, `www` et `m`. Comptez alors jusqu'à une heure de
> propagation, et prévenez vos utilisateurs.

### 6.4 Certificats SSL

Ils ont été recopiés en §5.9. Vérifiez simplement qu'ils sont en place :

```bash
docker run --rm -v solidata-certbot-etc:/d alpine ls /d/live/
bash deploy/scripts/reload-nginx-certs.sh
```

Si l'étape §5.9 a été manquée et que l'ancienne machine est déjà éteinte,
régénérez — l'adresse IP pointe désormais sur la nouvelle machine, la
validation aboutira :

```bash
docker compose -f docker-compose.prod.yml run --rm --entrypoint certbot certbot \
  certonly --webroot -w /var/www/certbot \
  -d solidata.online -d www.solidata.online -d m.solidata.online \
  --agree-tos --no-eff-email
bash deploy/scripts/reload-nginx-certs.sh
```

### 6.5 Relancer

```bash
cd /opt/solidata.online
docker compose -f docker-compose.prod.yml up -d --force-recreate nginx
docker compose -f docker-compose.prod.yml ps
```

---

## 7. Phase 4 — Vérifier

```bash
# Ressources
df -h / && free -h

# Conteneurs : les 7 doivent être Up
docker compose -f docker-compose.prod.yml ps

# Les deux sites, par leurs vrais noms
curl -sS -o /dev/null -m 10 -w "web=%{http_code}\n" --resolve solidata.online:443:127.0.0.1 https://solidata.online/
curl -sS -o /dev/null -m 10 -w "mob=%{http_code}\n" --resolve m.solidata.online:443:127.0.0.1 https://m.solidata.online/

# Santé applicative
bash deploy/scripts/health-check.sh

# Endpoints critiques (nécessite API_USER / API_PASSWORD dans .env)
node scripts/tests/api-smoke.js
```

**Attendu** : `web=200`, `mob=200`, sept conteneurs `Up`, smoke test sans 5xx.

Puis, depuis un navigateur — les vérifications qu'aucune commande ne remplace :

- [ ] Connexion sur `https://solidata.online`
- [ ] Une fiche salarié s'ouvre, avec ses données
- [ ] La carte des CAV s'affiche avec les bornes
- [ ] Une photo de CAV se charge (contrôle du volume uploads)
- [ ] `https://m.solidata.online/v/<token>` sur un téléphone
- [ ] La badgeuse reprend ses battements (Temps & Présence → Supervision)

---

## 8. Phase 5 — Tirer parti des 8 Go

Sans cette étape, vous payez de la mémoire que vos conteneurs n'utiliseront pas.
Les limites actuelles totalisent 1,88 Go — dimensionnées pour la DEV1-S.

Dans `docker-compose.prod.yml`, section `deploy.resources.limits` de chaque
service :

| Service | Actuel | Proposé |
|---|---|---|
| `db` | 512M | **2G** |
| `redis` | 320M | **512M** |
| `backend` | 768M | **2G** |
| `frontend` | 128M | **192M** |
| `mobile` | 128M | **192M** |
| `nginx` | 64M | **128M** |
| **Total** | 1,88 Go | **5,0 Go** |

Il reste ainsi 3 Go pour le système, Docker et les reconstructions d'images.

```bash
docker compose -f docker-compose.prod.yml up -d
docker stats --no-stream
```

**Faites-le un autre jour**, une fois la migration validée. Ne cumulez pas deux
changements dans la même fenêtre.

---

## 9. Retour arrière

Tant que l'ancienne instance existe, le retour est immédiat :

1. Console Scaleway → détacher l'IP de `solidata-erp-v2`, la rattacher à `solidata-erp`
2. `ssh root@51.159.144.100` puis `docker compose -f docker-compose.prod.yml up -d`

Le service revient tel qu'il était. Les données saisies sur la nouvelle machine
entre-temps seraient perdues — d'où l'intérêt de vérifier avant d'ouvrir aux
utilisateurs.

**Ne supprimez l'ancienne instance qu'après 7 jours de fonctionnement normal.**
Elle coûte 6,56 € par mois : c'est une assurance bon marché.

---

## 10. Annexe — Migration sur place

Si vous préférez conserver la machine actuelle, la conversion du stockage local
en Block Storage passe par :

1. Instantané du volume local (onglet **Stockage** de l'instance)
2. **Copier vers un bucket** — export QCOW2 vers un bucket Object Storage de la
   même région (à créer si vous n'en avez pas)
3. **Importer comme instantané** dans la zone de destination, type *Block Storage*
4. **Créer un volume depuis l'instantané**
5. Puis seulement, « Changer de type d'offre » vers DEV1-L

Documentation : [Migrate Local Storage to Block Storage](https://www.scaleway.com/en/docs/instances/how-to/migrate-local-storage-to-sbs/)

**Coupure attendue** : l'export et le réimport d'une image de 20 Go se comptent
en dizaines de minutes, machine éteinte. Et en cas d'échec en cours de route,
vous n'avez plus de production debout — d'où la recommandation du §1.

---

## 11. Après la migration

- [ ] Réinstaller les tâches planifiées : `crontab deploy/crontab.txt`
- [ ] Vérifier le service systemd de démarrage automatique
- [ ] Relancer une sauvegarde de contrôle : `bash deploy/scripts/backup.sh manual`
- [ ] Mettre à jour l'IP dans vos notes internes si elle a changé
- [ ] Programmer un `docker system prune -af` après chaque déploiement

