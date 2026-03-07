#!/bin/bash
# ============================================================
# SOLIDATA — Initialisation serveur Scaleway
# Exécuter UNE SEULE FOIS sur un serveur Ubuntu 22.04+ frais
# Usage: sudo bash init-server.sh
# ============================================================

set -euo pipefail

DOMAIN="solidata.online"
EMAIL="admin@solidata.online"
APP_DIR="/opt/solidata"
DEPLOY_USER="solidata"

echo "============================================"
echo "  SOLIDATA — Initialisation serveur"
echo "  Domaine: ${DOMAIN}"
echo "============================================"

# --- 1. Mise à jour système ---
echo "[1/8] Mise à jour système..."
apt-get update && apt-get upgrade -y
apt-get install -y curl git ufw fail2ban htop unzip

# --- 2. Pare-feu UFW ---
echo "[2/8] Configuration pare-feu..."
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
echo "Pare-feu activé (SSH, HTTP, HTTPS)"

# --- 3. Fail2ban ---
echo "[3/8] Configuration Fail2ban..."
systemctl enable fail2ban
systemctl start fail2ban

# --- 4. Docker ---
echo "[4/8] Installation Docker..."
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
echo "[5/8] Création utilisateur ${DEPLOY_USER}..."
if ! id "${DEPLOY_USER}" &>/dev/null; then
    useradd -m -s /bin/bash -G docker "${DEPLOY_USER}"
    echo "Utilisateur ${DEPLOY_USER} créé et ajouté au groupe docker"
fi

# --- 6. Structure répertoires ---
echo "[6/8] Création structure..."
mkdir -p ${APP_DIR}
mkdir -p /opt/solidata-backups
chown -R ${DEPLOY_USER}:${DEPLOY_USER} ${APP_DIR}
chown -R ${DEPLOY_USER}:${DEPLOY_USER} /opt/solidata-backups

# --- 7. Swap (si < 2Go RAM) ---
echo "[7/8] Vérification swap..."
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
echo "[8/8] Configuration logrotate..."
cat > /etc/logrotate.d/solidata <<'LOGROTATE'
/opt/solidata/logs/*.log {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    copytruncate
}
LOGROTATE

echo ""
echo "============================================"
echo "  Serveur initialisé avec succès !"
echo "============================================"
echo ""
echo "Prochaines étapes :"
echo "  1. Cloner le dépôt dans ${APP_DIR}"
echo "  2. Copier .env.production et configurer les secrets"
echo "  3. Exécuter: bash deploy/scripts/deploy.sh first"
echo ""
echo "DNS requis (Scaleway) :"
echo "  A    solidata.online     → IP_SERVEUR"
echo "  A    www.solidata.online → IP_SERVEUR"
echo "  A    m.solidata.online   → IP_SERVEUR"
echo ""
