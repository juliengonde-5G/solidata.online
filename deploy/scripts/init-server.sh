#!/bin/bash
# ============================================================
# SOLIDATA — Initialisation serveur Scaleway
# PURGE TOTALE du disque + réinstallation propre
# Serveur : 51.159.144.100
# Usage: sudo bash init-server.sh
#
# ⚠️  CE SCRIPT SUPPRIME TOUT : Docker, données, base,
#     certificats, logs, cache. Le serveur repart à zéro.
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
echo "  SOLIDATA — PURGE TOTALE + REINSTALLATION"
echo "  IP: ${SERVER_IP}"
echo "============================================"
echo ""
echo "  Espace disque AVANT purge :"
df -h /
echo ""

# ===========================================================
# ÉTAPE 0 — PURGE TOTALE DU DISQUE
# ===========================================================
echo "[0/9] *** PURGE TOTALE DU DISQUE ***"

# --- Docker : tout supprimer ---
if command -v docker &> /dev/null; then
    echo "  [Docker] Arrêt de tous les conteneurs..."
    docker stop $(docker ps -aq) 2>/dev/null || true
    echo "  [Docker] Suppression conteneurs..."
    docker rm -f $(docker ps -aq) 2>/dev/null || true
    echo "  [Docker] Suppression images..."
    docker rmi -f $(docker images -aq) 2>/dev/null || true
    echo "  [Docker] Suppression volumes (TOUS, y compris pgdata)..."
    docker volume rm -f $(docker volume ls -q) 2>/dev/null || true
    echo "  [Docker] Suppression réseaux..."
    docker network rm $(docker network ls -q --filter type=custom) 2>/dev/null || true
    echo "  [Docker] Purge system + builder cache..."
    docker system prune -af --volumes 2>/dev/null || true
    docker builder prune -af 2>/dev/null || true
    echo "  [Docker] Suppression overlay2 / couches intermédiaires..."
    systemctl stop docker 2>/dev/null || true
    rm -rf /var/lib/docker/overlay2/* 2>/dev/null || true
    rm -rf /var/lib/docker/tmp/* 2>/dev/null || true
    rm -rf /var/lib/docker/buildkit/* 2>/dev/null || true
    # Tronquer les logs des containers (peut rester après rm)
    find /var/lib/docker/containers/ -name '*-json.log' -exec truncate -s 0 {} \; 2>/dev/null || true
    systemctl start docker 2>/dev/null || true
    echo "  [Docker] Purgé."
fi

# --- Répertoires applicatifs ---
echo "  [App] Suppression répertoires applicatifs..."
rm -rf /opt/solidata.online 2>/dev/null || true
rm -rf /opt/solidata.online-backups 2>/dev/null || true
rm -rf /var/www/* 2>/dev/null || true
rm -rf /tmp/solidata* 2>/dev/null || true

# --- Services systemd ---
echo "  [Services] Arrêt et suppression..."
systemctl stop solidata 2>/dev/null || true
systemctl disable solidata 2>/dev/null || true
rm -f /etc/systemd/system/solidata.service 2>/dev/null || true
systemctl daemon-reload 2>/dev/null || true

# --- Nginx standalone ---
echo "  [Nginx] Suppression Nginx standalone..."
systemctl stop nginx 2>/dev/null || true
apt-get remove -y nginx nginx-common nginx-full 2>/dev/null || true
rm -rf /etc/nginx 2>/dev/null || true

# --- PostgreSQL standalone ---
echo "  [PostgreSQL] Suppression PostgreSQL standalone..."
systemctl stop postgresql 2>/dev/null || true
apt-get remove -y postgresql* 2>/dev/null || true
rm -rf /var/lib/postgresql 2>/dev/null || true
rm -rf /etc/postgresql 2>/dev/null || true

# --- Node.js standalone ---
echo "  [Node] Suppression Node.js standalone..."
apt-get remove -y nodejs npm 2>/dev/null || true
rm -rf /usr/local/lib/node_modules 2>/dev/null || true
rm -rf ~/.npm ~/.nvm 2>/dev/null || true

# --- Certificats SSL ---
echo "  [SSL] Suppression certificats..."
rm -rf /etc/letsencrypt 2>/dev/null || true

# --- Crontab ---
echo "  [Cron] Nettoyage..."
crontab -r 2>/dev/null || true
rm -f /etc/logrotate.d/solidata 2>/dev/null || true

# --- Journaux système (gros consommateur sur petit disque) ---
echo "  [Logs] Purge journaux système..."
journalctl --vacuum-size=10M 2>/dev/null || true
find /var/log -name '*.gz' -delete 2>/dev/null || true
find /var/log -name '*.old' -delete 2>/dev/null || true
find /var/log -name '*.1' -delete 2>/dev/null || true
truncate -s 0 /var/log/syslog 2>/dev/null || true
truncate -s 0 /var/log/kern.log 2>/dev/null || true
truncate -s 0 /var/log/auth.log 2>/dev/null || true
truncate -s 0 /var/log/daemon.log 2>/dev/null || true
truncate -s 0 /var/log/dpkg.log 2>/dev/null || true
truncate -s 0 /var/log/alternatives.log 2>/dev/null || true
rm -rf /var/log/journal/* 2>/dev/null || true

# --- Cache APT + paquets orphelins ---
echo "  [APT] Nettoyage paquets et cache..."
apt-get autoremove -y --purge 2>/dev/null || true
apt-get autoclean -y 2>/dev/null || true
apt-get clean 2>/dev/null || true
rm -rf /var/cache/apt/archives/*.deb 2>/dev/null || true

# --- Tmp ---
echo "  [Tmp] Nettoyage fichiers temporaires..."
rm -rf /tmp/* /var/tmp/* 2>/dev/null || true

# --- Snap (si installé, gros consommateur) ---
if command -v snap &> /dev/null; then
    echo "  [Snap] Suppression cache snap..."
    snap list 2>/dev/null | awk 'NR>1{print $1}' | while read pkg; do
        snap remove "$pkg" 2>/dev/null || true
    done
    rm -rf /var/lib/snapd/cache/* 2>/dev/null || true
fi

echo ""
echo "  ✅ PURGE TOTALE TERMINÉE"
echo "  Espace disque APRÈS purge :"
df -h /
echo ""

# ===========================================================
# ÉTAPE 1 — INSTALLATION PROPRE
# ===========================================================

# --- 1. Mise à jour système ---
echo "[1/9] Mise à jour système..."
apt-get update && apt-get upgrade -y
apt-get install -y curl git ufw fail2ban htop unzip
# Nettoyer le cache APT juste après l'install
apt-get clean

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
    # Nettoyer le script d'install
    apt-get clean
fi

if ! docker compose version &> /dev/null; then
    apt-get install -y docker-compose-plugin
    apt-get clean
fi

# Configurer Docker pour limiter les logs (évite que le disque se remplisse)
mkdir -p /etc/docker
cat > /etc/docker/daemon.json <<'DOCKERCONF'
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "5m",
    "max-file": "2"
  },
  "storage-driver": "overlay2"
}
DOCKERCONF
systemctl restart docker

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

# Toujours repartir d'un clone frais après purge totale
rm -rf ${APP_DIR}
git clone ${REPO_URL} ${APP_DIR}
cd ${APP_DIR}
git checkout ${BRANCH}

echo "  Branche active : $(git branch --show-current)"
mkdir -p ${APP_DIR}/logs

chown -R ${DEPLOY_USER}:${DEPLOY_USER} ${APP_DIR}
chown -R ${DEPLOY_USER}:${DEPLOY_USER} /opt/solidata.online-backups

# --- 7. Swap (si < 2Go RAM) ---
echo "[7/9] Vérification swap..."
TOTAL_RAM=$(free -m | awk '/^Mem:/{print $2}')
if [ "$TOTAL_RAM" -lt 2048 ]; then
    # Supprimer ancien swap si existant
    swapoff /swapfile 2>/dev/null || true
    rm -f /swapfile 2>/dev/null || true
    sed -i '/swapfile/d' /etc/fstab 2>/dev/null || true
    echo "RAM < 2Go (${TOTAL_RAM}Mo), création swap 2Go..."
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
    rotate 7
    compress
    delaycompress
    notifempty
    copytruncate
    maxsize 10M
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
echo "  SERVEUR PURGÉ ET RÉINSTALLÉ !"
echo "  IP: ${SERVER_IP}"
echo "  Disque libre : $(df -h / | tail -1 | awk '{print $4}')"
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
