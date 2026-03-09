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

    # Étape 0: Purge complète Docker pour libérer l'espace disque
    log "Étape 0/7 — Purge Docker complète..."
    docker compose -f ${COMPOSE_FILE} down 2>/dev/null || true
    docker stop $(docker ps -aq) 2>/dev/null || true
    docker rm -f $(docker ps -aq) 2>/dev/null || true
    docker rmi -f $(docker images -aq) 2>/dev/null || true
    docker volume rm -f $(docker volume ls -q | grep -v solidata-pgdata) 2>/dev/null || true
    docker system prune -af --volumes 2>/dev/null || true
    # Nettoyage supplémentaire : logs Docker, cache apt, tmp
    truncate -s 0 /var/lib/docker/containers/*/*-json.log 2>/dev/null || true
    apt-get clean 2>/dev/null || true
    rm -rf /tmp/* /var/tmp/* 2>/dev/null || true
    log "Espace disque après purge :"
    df -h /

    # Étape 1: Démarrer avec config HTTP uniquement (pour certbot)
    log "Étape 1/7 — Démarrage en HTTP (sans SSL)..."

    # Temporairement remplacer la config SSL par la config HTTP-only
    cp "${CONF_DIR}/solidata.conf" "${CONF_DIR}/solidata.conf.ssl-backup"
    cp "${CONF_DIR}/solidata-initial.conf.disabled" "${CONF_DIR}/solidata.conf"

    docker compose -f ${COMPOSE_FILE} build --no-cache
    docker compose -f ${COMPOSE_FILE} up -d

    # Attendre que nginx réponde vraiment sur le port 80
    log "Attente que nginx soit prêt sur le port 80..."
    RETRIES=0
    MAX_RETRIES=60
    while [ $RETRIES -lt $MAX_RETRIES ]; do
        if curl -s -o /dev/null -w "%{http_code}" http://localhost 2>/dev/null | grep -qE "200|301|302|404"; then
            log "Nginx répond sur le port 80 !"
            break
        fi
        RETRIES=$((RETRIES + 1))
        echo "  Tentative ${RETRIES}/${MAX_RETRIES}..."
        sleep 5
    done

    if [ $RETRIES -eq $MAX_RETRIES ]; then
        error "Nginx ne répond pas après ${MAX_RETRIES} tentatives. Vérifiez les logs : docker compose -f ${COMPOSE_FILE} logs nginx"
    fi

    # Vérifier que le challenge path est accessible
    log "Vérification accès ACME challenge..."
    docker compose -f ${COMPOSE_FILE} exec -T nginx sh -c 'mkdir -p /var/www/certbot/.well-known/acme-challenge && echo "test" > /var/www/certbot/.well-known/acme-challenge/test'
    if curl -s http://localhost/.well-known/acme-challenge/test | grep -q "test"; then
        log "ACME challenge accessible !"
    else
        warn "ACME challenge non accessible, vérification des logs nginx..."
        docker compose -f ${COMPOSE_FILE} logs --tail=20 nginx
    fi

    # Étape 2: Obtenir certificat SSL
    log "Étape 2/7 — Obtention certificat Let's Encrypt..."
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
    log "Étape 3/7 — Activation SSL..."
    cp "${CONF_DIR}/solidata.conf.ssl-backup" "${CONF_DIR}/solidata.conf"
    rm -f "${CONF_DIR}/solidata.conf.ssl-backup"

    # Étape 4: Redémarrer nginx avec SSL
    log "Étape 4/7 — Redémarrage avec SSL..."
    docker compose -f ${COMPOSE_FILE} restart nginx

    # Attendre que nginx redémarre avec SSL
    sleep 10

    # Étape 5: Initialisation base de données
    log "Étape 5/7 — Initialisation base de données..."
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

    # Étape 6: Nettoyage post-déploiement
    log "Étape 6/7 — Nettoyage images intermédiaires..."
    docker image prune -f

    # Étape 7: Statut final
    log "Étape 7/7 — Vérification..."
    docker compose -f ${COMPOSE_FILE} ps
    log "Espace disque final :"
    df -h /

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
