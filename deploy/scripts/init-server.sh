#!/bin/bash
# ============================================================
# SOLIDATA — Initialisation serveur Scaleway
# Purge complète + installation propre
# Serveur : 51.159.144.100
# Usage: sudo bash init-server.sh
# ============================================================

set -euo pipefail

DOMAIN="solidata.online"
SERVER_IP="51.159.144.100"
EMAIL="admin@solidata.online"
APP_DIR="/opt/solidata.online"
DEPLOY_USER="solidata"
REPO_URL="https://github.com/juliengonde-5G/solidata.online.git"
BRANCH="main"

echo "============================================"
echo "  SOLIDATA — Initialisation serveur"
echo "  IP: ${SERVER_IP}"
echo "  Domaine: ${DOMAIN}"
echo "============================================"
echo ""

# ===========================================================
# ÉTAPE 0 — PURGE COMPLÈTE DE L'INSTANCE
# ===========================================================
echo "[0/9] *** PURGE COMPLÈTE DE L'INSTANCE ***"

# --- Arrêt et suppression de tous les conteneurs Docker ---
if command -v docker &> /dev/null; then
    echo "  Arrêt de tous les conteneurs Docker..."
    docker stop $(docker ps -aq) 2>/dev/null || true
    echo "  Suppression de tous les conteneurs..."
    docker rm -f $(docker ps -aq) 2>/dev/null || true
    echo "  Suppression de toutes les images Docker..."
    docker rmi -f $(docker images -aq) 2>/dev/null || true
    echo "  Suppression de tous les volumes Docker..."
    docker volume rm -f $(docker volume ls -q) 2>/dev/null || true
    echo "  Suppression de tous les réseaux Docker..."
    docker network rm $(docker network ls -q --filter type=custom) 2>/dev/null || true
    echo "  Purge complète Docker (builder cache, etc.)..."
    docker system prune -af --volumes 2>/dev/null || true
    echo "  Docker purgé."
fi

# --- Suppression des anciennes installations applicatives ---
echo "  Nettoyage des répertoires applicatifs..."
rm -rf /opt/solidata.online 2>/dev/null || true
rm -rf /opt/solidata.online-backups 2>/dev/null || true
rm -rf /var/www/* 2>/dev/null || true
rm -rf /tmp/solidata* 2>/dev/null || true

# --- Arrêt et suppression des services existants ---
echo "  Arrêt des services existants..."
systemctl stop solidata 2>/dev/null || true
systemctl disable solidata 2>/dev/null || true
rm -f /etc/systemd/system/solidata.service 2>/dev/null || true
systemctl daemon-reload 2>/dev/null || true

# --- Suppression des anciennes configs Nginx standalone ---
echo "  Nettoyage Nginx standalone (si installé hors Docker)..."
systemctl stop nginx 2>/dev/null || true
apt-get remove -y nginx nginx-common nginx-full 2>/dev/null || true
rm -rf /etc/nginx 2>/dev/null || true

# --- Suppression d'anciennes bases PostgreSQL standalone ---
echo "  Nettoyage PostgreSQL standalone (si installé hors Docker)..."
systemctl stop postgresql 2>/dev/null || true
apt-get remove -y postgresql* 2>/dev/null || true
rm -rf /var/lib/postgresql 2>/dev/null || true
rm -rf /etc/postgresql 2>/dev/null || true

# --- Suppression de Node.js standalone (si installé) ---
echo "  Nettoyage Node.js standalone..."
apt-get remove -y nodejs npm 2>/dev/null || true
rm -rf /usr/local/lib/node_modules 2>/dev/null || true
rm -rf ~/.npm ~/.nvm 2>/dev/null || true

# --- Nettoyage des anciens certificats SSL ---
echo "  Nettoyage certificats SSL existants..."
rm -rf /etc/letsencrypt 2>/dev/null || true

# --- Suppression des crontabs applicatifs ---
echo "  Nettoyage crontab..."
crontab -r 2>/dev/null || true

# --- Nettoyage logrotate solidata ---
rm -f /etc/logrotate.d/solidata 2>/dev/null || true

# --- Nettoyage paquets résiduels ---
echo "  Nettoyage paquets orphelins..."
apt-get autoremove -y 2>/dev/null || true
apt-get autoclean -y 2>/dev/null || true

echo "  ✅ Purge complète terminée."
echo ""

# ===========================================================
# ÉTAPE 1 — INSTALLATION PROPRE
# ===========================================================

# --- 1. Mise à jour système ---
echo "[1/9] Mise à jour système..."
apt-get update && apt-get upgrade -y
apt-get install -y curl git ufw fail2ban htop unzip

# --- 2. Pare-feu UFW ---
echo "[2/9] Configuration pare-feu..."
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
echo "Pare-feu activé (SSH, HTTP, HTTPS)"

# --- 3. Fail2ban ---
echo "[3/9] Configuration Fail2ban..."
systemctl enable fail2ban
systemctl start fail2ban

# --- 4. Docker ---
echo "[4/9] Installation Docker..."
if ! command -v docker &> /dev/null; then
    curl -fsSL https://get.docker.com | sh
    systemctl enable docker
    systemctl start docker
fi

if ! command -v docker compose &> /dev/null && ! docker compose version &> /dev/null; then
    apt-get install -y docker-compose-plugin
fi

echo "Docker version: $(docker --version)"
echo "Docker Compose version: $(docker compose version)"

# --- 5. Utilisateur déploiement ---
echo "[5/9] Création utilisateur ${DEPLOY_USER}..."
if ! id "${DEPLOY_USER}" &>/dev/null; then
    useradd -m -s /bin/bash -G docker "${DEPLOY_USER}"
    echo "Utilisateur ${DEPLOY_USER} créé et ajouté au groupe docker"
fi

# --- 6. Clone du dépôt + structure ---
echo "[6/9] Clone du dépôt et création structure..."
cd /
mkdir -p /opt/solidata.online-backups

if [ -d "${APP_DIR}/.git" ]; then
    echo "  Dépôt déjà présent, mise à jour..."
    cd ${APP_DIR}
    git fetch origin
    git checkout ${BRANCH}
    git pull origin ${BRANCH}
elif [ -d "${APP_DIR}" ]; then
    echo "  Répertoire existant mais pas un dépôt Git, nettoyage..."
    rm -rf ${APP_DIR}
    git clone ${REPO_URL} ${APP_DIR}
    cd ${APP_DIR}
    git checkout ${BRANCH}
else
    git clone ${REPO_URL} ${APP_DIR}
    cd ${APP_DIR}
    git checkout ${BRANCH}
fi

echo "  Branche active : $(git branch --show-current)"
mkdir -p ${APP_DIR}/logs

chown -R ${DEPLOY_USER}:${DEPLOY_USER} ${APP_DIR}
chown -R ${DEPLOY_USER}:${DEPLOY_USER} /opt/solidata.online-backups

# --- 7. Swap (si < 2Go RAM) ---
echo "[7/9] Vérification swap..."
TOTAL_RAM=$(free -m | awk '/^Mem:/{print $2}')
if [ "$TOTAL_RAM" -lt 2048 ] && [ ! -f /swapfile ]; then
    echo "RAM < 2Go, création swap 2Go..."
    fallocate -l 2G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
    echo "Swap 2Go activé"
fi

# --- 8. Logrotate ---
echo "[8/9] Configuration logrotate..."
cat > /etc/logrotate.d/solidata <<'LOGROTATE'
/opt/solidata.online/logs/*.log {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    copytruncate
}
LOGROTATE

# --- 9. Vérification post-installation ---
echo "[9/9] Vérification finale..."
echo "  Docker       : $(docker --version 2>/dev/null || echo 'NON INSTALLÉ')"
echo "  Compose      : $(docker compose version 2>/dev/null || echo 'NON INSTALLÉ')"
echo "  UFW          : $(ufw status | head -1)"
echo "  Fail2ban     : $(systemctl is-active fail2ban)"
echo "  Swap         : $(swapon --show --noheadings | awk '{print $3}' || echo 'aucun')"
echo "  Disque libre : $(df -h / | tail -1 | awk '{print $4}')"
echo "  RAM          : $(free -h | awk '/Mem:/{print $2}')"

echo ""
echo "============================================"
echo "  Serveur purgé et initialisé avec succès !"
echo "  IP: ${SERVER_IP}"
echo "============================================"
echo ""
echo "Dépôt cloné dans : ${APP_DIR}"
echo "Branche : ${BRANCH}"
echo ""
echo "Prochaines étapes :"
echo "  1. Configurer les secrets :"
echo "     cd ${APP_DIR}"
echo "     cp .env.production .env"
echo "     nano .env"
echo "  2. Lancer le premier déploiement :"
echo "     bash deploy/scripts/deploy.sh first"
echo ""
echo "DNS requis (Scaleway console) :"
echo "  A    solidata.online     → ${SERVER_IP}"
echo "  A    www.solidata.online → ${SERVER_IP}"
echo "  A    m.solidata.online   → ${SERVER_IP}"
echo ""
