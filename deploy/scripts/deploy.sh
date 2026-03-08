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

    CONF_DIR="deploy/nginx/conf.d"

    # Étape 1: Démarrer avec config HTTP uniquement (pour certbot)
    log "Étape 1/6 — Démarrage en HTTP (sans SSL)..."

    # Temporairement remplacer la config SSL par la config HTTP-only
    cp "${CONF_DIR}/solidata.conf" "${CONF_DIR}/solidata.conf.ssl-backup"
    cp "${CONF_DIR}/solidata-initial.conf.disabled" "${CONF_DIR}/solidata.conf"

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
    log "Étape 2/6 — Obtention certificat Let's Encrypt..."
    docker compose -f ${COMPOSE_FILE} run --rm --entrypoint certbot certbot certonly \
        --webroot \
        --webroot-path=/var/www/certbot \
        --email ${EMAIL} \
        --agree-tos \
        --no-eff-email \
        -d ${DOMAIN} \
        -d www.${DOMAIN} \
        -d m.${DOMAIN}

    # Étape 3: Restaurer la config SSL
    log "Étape 3/6 — Activation SSL..."
    cp "${CONF_DIR}/solidata.conf.ssl-backup" "${CONF_DIR}/solidata.conf"
    rm -f "${CONF_DIR}/solidata.conf.ssl-backup"

    # Étape 4: Redémarrer nginx avec SSL
    log "Étape 4/6 — Redémarrage avec SSL..."
    docker compose -f ${COMPOSE_FILE} restart nginx

    # Étape 5: Initialisation base de données
    log "Étape 5/6 — Initialisation base de données..."
    sleep 5
    if docker compose -f ${COMPOSE_FILE} exec -T backend node src/scripts/init-db.js 2>/dev/null; then
        log "Base de données initialisée (tables + seeds)."
    else
        warn "init-db.js a échoué ou n'existe pas. Exécutez manuellement : docker compose -f ${COMPOSE_FILE} exec backend node src/scripts/init-db.js"
    fi
    if [ -f "backend/src/scripts/migrate-v2.js" ]; then
        if docker compose -f ${COMPOSE_FILE} exec -T backend node src/scripts/migrate-v2.js 2>/dev/null; then
            log "Migration v2 appliquée."
        fi
    fi

    # Étape 6: Statut final
    log "Étape 6/6 — Vérification..."
    docker compose -f ${COMPOSE_FILE} ps

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

    # Rebuild sans cache pour prendre en compte le nouveau code (évite que le frontend reste en cache)
    log "Reconstruction des images (sans cache)..."
    docker compose -f ${COMPOSE_FILE} build --no-cache

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
