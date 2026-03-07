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

# Télécharger et exécuter le script d'init
git clone https://github.com/juliengonde-5G/solidata.online.git /opt/solidata
cd /opt/solidata
sudo bash deploy/scripts/init-server.sh
```

Ce script effectue :
1. **Purge complète** : arrêt/suppression de tous les conteneurs Docker, images, volumes, réseaux, anciennes installations (Nginx, PostgreSQL, Node.js standalone), certificats SSL, crontabs
2. **Installation propre** : Docker, UFW (pare-feu), Fail2ban, Swap si nécessaire

## Étape 2 — Configuration

```bash
cd /opt/solidata

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
1. Build les 5 conteneurs Docker
2. Démarre en HTTP temporairement
3. Obtient le certificat SSL Let's Encrypt
4. Bascule vers HTTPS

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
# Mise à jour
bash deploy/scripts/deploy.sh update

# Redémarrage
bash deploy/scripts/deploy.sh restart

# Arrêt
bash deploy/scripts/deploy.sh stop

# Sauvegarde manuelle
bash deploy/scripts/backup.sh manual

# Restauration
bash deploy/scripts/restore.sh /opt/solidata-backups/db_manual_20260307.dump.gz

# Logs en temps réel
bash deploy/scripts/deploy.sh logs backend
```

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
