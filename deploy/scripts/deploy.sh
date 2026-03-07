#!/bin/bash
# ============================================================
# SOLIDATA — Script de déploiement
# Usage:
#   bash deploy.sh first   — Premier déploiement (HTTP + certbot)
#   bash deploy.sh update  — Mise à jour standard
#   bash deploy.sh restart — Redémarrage sans rebuild
# ============================================================

set -euo pipefail

APP_DIR="/opt/solidata.online"
DOMAIN="solidata.online"
SERVER_IP="51.159.144.100"
EMAIL="admin@solidata.online"
COMPOSE_FILE="docker-compose.prod.yml"
BACKUP_DIR="/opt/solidata.online-backups"

cd "${APP_DIR}"

# Couleurs
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[SOLIDATA]${NC} $1"; }
warn() { echo -e "${YELLOW}[ATTENTION]${NC} $1"; }
error() { echo -e "${RED}[ERREUR]${NC} $1"; exit 1; }

# Vérifications
[ -f ".env" ] || error "Fichier .env manquant ! Copiez .env.production et configurez-le."
[ -f "${COMPOSE_FILE}" ] || error "Fichier ${COMPOSE_FILE} introuvable !"

ACTION="${1:-update}"

case "${ACTION}" in

  # ===============================
  # PREMIER DEPLOIEMENT
  # ===============================
  first)
    log "=== PREMIER DÉPLOIEMENT SOLIDATA ==="

    # Étape 1: Démarrer avec config HTTP uniquement (pour certbot)
    log "Étape 1/4 — Démarrage en HTTP (sans SSL)..."

    CONF_DIR="deploy/nginx/conf.d"

    # Restaurer les fichiers .disabled si relance après échec
    [ -f "${CONF_DIR}/solidata-initial.conf.disabled" ] && mv "${CONF_DIR}/solidata-initial.conf.disabled" "${CONF_DIR}/solidata-initial.conf"
    [ -f "${CONF_DIR}/solidata-ssl.conf.disabled" ] && mv "${CONF_DIR}/solidata-ssl.conf.disabled" "${CONF_DIR}/solidata.conf"

    # Sauvegarder la config SSL, mettre la config HTTP-only en place
    cp "${CONF_DIR}/solidata.conf" "${CONF_DIR}/solidata-ssl.conf.disabled"
    cp "${CONF_DIR}/solidata-initial.conf" "${CONF_DIR}/solidata.conf"
    mv "${CONF_DIR}/solidata-initial.conf" "${CONF_DIR}/solidata-initial.conf.disabled"

    docker compose -f ${COMPOSE_FILE} build --no-cache
    docker compose -f ${COMPOSE_FILE} up -d

    log "Attente démarrage services (30s)..."
    sleep 30

    # Vérifier que le serveur répond
    if curl -s -o /dev/null -w "%{http_code}" http://localhost | grep -q "200\|301\|302"; then
        log "Services démarrés !"
    else
        warn "Le serveur ne répond pas encore, vérifiez les logs : docker compose -f ${COMPOSE_FILE} logs"
    fi

    # Étape 2: Obtenir certificat SSL
    log "Étape 2/4 — Obtention certificat Let's Encrypt..."
    docker compose -f ${COMPOSE_FILE} run --rm --entrypoint certbot certbot certonly \
        --webroot \
        --webroot-path=/var/www/certbot \
        --email ${EMAIL} \
        --agree-tos \
        --no-eff-email \
        -d ${DOMAIN} \
        -d www.${DOMAIN} \
        -d m.${DOMAIN}

    # Étape 3: Basculer vers config SSL
    log "Étape 3/4 — Activation SSL..."
    mv deploy/nginx/conf.d/solidata-ssl.conf.disabled deploy/nginx/conf.d/solidata.conf

    # Étape 4: Redémarrer nginx avec SSL
    log "Étape 4/4 — Redémarrage avec SSL..."
    docker compose -f ${COMPOSE_FILE} restart nginx

    log "=== DÉPLOIEMENT INITIAL TERMINÉ ==="
    log "Application disponible sur :"
    log "  Web     : https://${DOMAIN}"
    log "  Mobile  : https://m.${DOMAIN}"
    log "  API     : https://${DOMAIN}/api"
    log ""
    log "Compte admin par défaut :"
    log "  Identifiant : admin"
    log "  Mot de passe : admin123"
    warn "CHANGEZ CE MOT DE PASSE IMMÉDIATEMENT !"
    ;;

  # ===============================
  # MISE À JOUR
  # ===============================
  update)
    log "=== MISE À JOUR SOLIDATA ==="

    # Backup avant update
    log "Sauvegarde base de données..."
    bash deploy/scripts/backup.sh

    # Pull dernières modifications
    log "Récupération du code..."
    git pull origin main

    # Rebuild et redémarrage
    log "Reconstruction des images..."
    docker compose -f ${COMPOSE_FILE} build

    log "Redémarrage des services..."
    docker compose -f ${COMPOSE_FILE} up -d

    # Cleanup
    log "Nettoyage images obsolètes..."
    docker image prune -f

    log "=== MISE À JOUR TERMINÉE ==="
    docker compose -f ${COMPOSE_FILE} ps
    ;;

  # ===============================
  # REDEMARRAGE
  # ===============================
  restart)
    log "Redémarrage des services..."
    docker compose -f ${COMPOSE_FILE} restart
    docker compose -f ${COMPOSE_FILE} ps
    ;;

  # ===============================
  # STOP
  # ===============================
  stop)
    warn "Arrêt de tous les services..."
    docker compose -f ${COMPOSE_FILE} down
    log "Services arrêtés."
    ;;

  # ===============================
  # LOGS
  # ===============================
  logs)
    SERVICE="${2:-}"
    if [ -n "${SERVICE}" ]; then
        docker compose -f ${COMPOSE_FILE} logs -f --tail=100 "${SERVICE}"
    else
        docker compose -f ${COMPOSE_FILE} logs -f --tail=100
    fi
    ;;

  # ===============================
  # STATUS
  # ===============================
  status)
    log "=== STATUT SOLIDATA ==="
    docker compose -f ${COMPOSE_FILE} ps
    echo ""
    log "Utilisation disque :"
    docker system df
    echo ""
    log "Volumes :"
    docker volume ls | grep solidata
    ;;

  *)
    echo "Usage: $0 {first|update|restart|stop|logs|status}"
    echo ""
    echo "  first   — Premier déploiement (HTTP → SSL)"
    echo "  update  — Mise à jour (backup + rebuild)"
    echo "  restart — Redémarrage sans rebuild"
    echo "  stop    — Arrêt complet"
    echo "  logs    — Afficher les logs (optionnel: logs backend)"
    echo "  status  — Statut des services"
    exit 1
    ;;
esac
