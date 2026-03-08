# SOLIDATA — Guide de Déploiement Production

## Prérequis

- Serveur Scaleway **DEV1-S** minimum (2 vCPU, 2 Go RAM, 20 Go SSD)
- Ubuntu 22.04 LTS
- Domaine `solidata.online` avec DNS configuré

## Configuration DNS (Scaleway)

Créer 3 enregistrements DNS A pointant vers l'IP du serveur :

```
A    solidata.online      → 51.159.144.100
A    www.solidata.online   → 51.159.144.100
A    m.solidata.online     → 51.159.144.100
```

## Étape 1 — Initialisation serveur

```bash
# Se connecter en SSH
ssh root@51.159.144.100

# Télécharger le script d'init (une seule commande)
curl -sL https://raw.githubusercontent.com/juliengonde-5G/solidata.online/main/deploy/scripts/init-server.sh | sudo bash

# OU manuellement :
git clone https://github.com/juliengonde-5G/solidata.online.git /tmp/solidata-init
sudo bash /tmp/solidata-init/deploy/scripts/init-server.sh
```

Ce script effectue automatiquement :
1. **Purge complète** : arrêt/suppression de tous les conteneurs Docker, images, volumes, réseaux, anciennes installations (Nginx, PostgreSQL, Node.js standalone), certificats SSL, crontabs
2. **Installation propre** : Docker, UFW (pare-feu), Fail2ban, Swap
3. **Clone du dépôt** dans `/opt/solidata.online` (branche `main`)

## Étape 2 — Configuration

```bash
cd /opt/solidata.online

# Copier et éditer les variables d'environnement
cp .env.production .env
nano .env
```

Modifier :
- `DB_PASSWORD` : mot de passe fort (ex: `openssl rand -base64 32`)
- `JWT_SECRET` : secret JWT (ex: `openssl rand -hex 64`)
- `BREVO_API_KEY` : clé API Brevo si notifications SMS/email

## Étape 3 — Premier déploiement

```bash
bash deploy/scripts/deploy.sh first
```

Ce script :
1. Build les 6 conteneurs Docker (db, backend, frontend, mobile, nginx, certbot)
2. Démarre en HTTP temporairement
3. Obtient le certificat SSL Let's Encrypt
4. Bascule vers HTTPS
5. Initialise la base de données (tables + seeds) et applique les migrations si présentes
6. Affiche le statut des services

Si l’init BDD n’a pas été faite automatiquement, exécuter manuellement :
`docker compose -f docker-compose.prod.yml exec backend node src/scripts/init-db.js`

## Étape 4 — Vérification

```bash
# Vérifier les services
bash deploy/scripts/deploy.sh status

# Vérifier la santé
bash deploy/scripts/health-check.sh

# Voir les logs
bash deploy/scripts/deploy.sh logs
bash deploy/scripts/deploy.sh logs backend
```

## Étape 5 — Service systemd + Cron

```bash
# Démarrage automatique au boot
sudo cp deploy/solidata.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable solidata

# Tâches planifiées (backup, health-check, SSL)
crontab deploy/crontab.txt
```

## Accès

| Service | URL |
|---------|-----|
| Application web | https://solidata.online |
| Mobile PWA | https://m.solidata.online |
| API | https://solidata.online/api |

**Compte admin par défaut :**
- Identifiant : `admin`
- Mot de passe : `admin123`
- **CHANGER IMMÉDIATEMENT après connexion**

## Opérations courantes

```bash
# Depuis votre PC : pousser le code vers le repo (avant de mettre à jour le serveur)
bash push.sh "Description des changements"
# ou sous Windows : push.bat "Description des changements"

# Sur le serveur : mise à jour
bash deploy/scripts/deploy.sh update

# Redémarrage
bash deploy/scripts/deploy.sh restart

# Arrêt
bash deploy/scripts/deploy.sh stop

# Sauvegarde manuelle
bash deploy/scripts/backup.sh manual

# Restauration
bash deploy/scripts/restore.sh /opt/solidata.online-backups/db_manual_20260307.dump.gz

# Logs en temps réel
bash deploy/scripts/deploy.sh logs backend
```

## Dépannage — 502 Bad Gateway

Un 502 signifie que Nginx ne peut pas joindre le frontend ou le backend. Sur le serveur :

```bash
cd /opt/solidata.online

# Vérifier que tous les conteneurs sont Up
docker compose -f docker-compose.prod.yml ps

# Si un conteneur est "Restarting" ou absent : voir les logs
docker compose -f docker-compose.prod.yml logs --tail=80 frontend
docker compose -f docker-compose.prod.yml logs --tail=80 backend

# Redémarrer tout proprement
bash deploy/scripts/deploy.sh restart
# ou rebuild si besoin
bash deploy/scripts/deploy.sh update
```

Causes fréquentes : conteneur frontend/backend en crash (erreur au build, fichier manquant), base de données non prête, ou mémoire insuffisante (OOM).

## Architecture production

```
Internet
   │
   ├── :80  → Nginx (redirect HTTPS)
   └── :443 → Nginx SSL (Let's Encrypt)
                ├── solidata.online     → Frontend React (Nginx)
                ├── m.solidata.online   → Mobile PWA (Nginx)
                ├── /api/*              → Backend Node.js :3001
                ├── /socket.io/*        → Backend WebSocket
                └── /uploads/*          → Backend fichiers
                                            │
                                            └── PostgreSQL + PostGIS
```

## Sécurité

- UFW : ports 22, 80, 443 uniquement
- Fail2ban : protection brute-force SSH
- HTTPS obligatoire (HSTS)
- Rate limiting : 30 req/s API, 5 req/min login
- JWT tokens avec refresh
- Données PCM chiffrées AES-256
- Headers sécurité (X-Frame, X-Content-Type, XSS-Protection)
