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

    # ── Étape 0: Purge Docker ──
    log "Étape 0/7 — Purge Docker complète..."
    docker compose -f ${COMPOSE_FILE} down --remove-orphans 2>/dev/null || true
    docker stop $(docker ps -aq) 2>/dev/null || true
    docker rm -f $(docker ps -aq) 2>/dev/null || true
    docker rmi -f $(docker images -aq) 2>/dev/null || true
    for vol in $(docker volume ls -q 2>/dev/null); do
        if [ "$vol" != "solidata-pgdata" ]; then
            docker volume rm -f "$vol" 2>/dev/null || true
        fi
    done
    docker builder prune -af 2>/dev/null || true
    docker network prune -f 2>/dev/null || true
    truncate -s 0 /var/lib/docker/containers/*/*-json.log 2>/dev/null || true
    apt-get clean 2>/dev/null || true
    rm -rf /tmp/* /var/tmp/* 2>/dev/null || true
    journalctl --vacuum-size=50M 2>/dev/null || true
    log "Espace disque après purge :"
    df -h /

    # Vérifier qu'il reste assez d'espace
    AVAIL_KB=$(df / | tail -1 | awk '{print $4}')
    if [ "$AVAIL_KB" -lt 1500000 ]; then
        warn "Seulement $(( AVAIL_KB / 1024 )) Mo disponibles. Le build risque d'échouer."
        warn "Lancez d'abord : sudo bash deploy/scripts/init-server.sh"
    fi

    # ── Étape 1: Vérifications pré-déploiement ──
    log "Étape 1/7 — Vérifications pré-déploiement..."

    # Vérifier qu'aucun nginx host ne tourne (conflit de port)
    if systemctl is-active nginx &>/dev/null; then
        warn "Un Nginx HOST est actif ! Il bloque le port 80. Arrêt..."
        systemctl stop nginx
        systemctl disable nginx
    fi
    # Vérifier qu'aucun processus ne bloque le port 80
    if ss -tlnp | grep -q ':80 '; then
        warn "Port 80 déjà utilisé par :"
        ss -tlnp | grep ':80 '
        warn "Tentative de libération..."
        fuser -k 80/tcp 2>/dev/null || true
        sleep 2
    fi
    # Vérifier qu'aucun processus ne bloque le port 443
    if ss -tlnp | grep -q ':443 '; then
        warn "Port 443 déjà utilisé, libération..."
        fuser -k 443/tcp 2>/dev/null || true
        sleep 2
    fi
    # Vérifier UFW
    if command -v ufw &>/dev/null; then
        if ufw status | grep -q "Status: active"; then
            if ! ufw status | grep -q "80/tcp.*ALLOW"; then
                warn "UFW actif mais port 80 non autorisé ! Ajout..."
                ufw allow 80/tcp
                ufw allow 443/tcp
            fi
            log "UFW: port 80 et 443 ouverts"
        fi
    fi

    # ── Config HTTP-only pour certbot ──
    # Sauvegarder la config SSL UNIQUEMENT si ce n'est pas déjà une sauvegarde HTTP
    # (évite d'écraser le backup SSL en cas de re-run)
    if [ ! -f "${CONF_DIR}/solidata.conf.ssl-backup" ]; then
        cp "${CONF_DIR}/solidata.conf" "${CONF_DIR}/solidata.conf.ssl-backup"
    fi
    cp "${CONF_DIR}/solidata-initial.conf.disabled" "${CONF_DIR}/solidata.conf"

    # ── Étape 2: Pull images + Build (SANS certbot) ──
    log "Étape 2/7 — Pull images, build et démarrage en HTTP..."

    # Pré-tirer les images légères AVANT de builder (évite de manquer d'espace)
    log "  Pull des images de base..."
    docker pull nginx:alpine
    docker pull postgis/postgis:15-3.4
    log "  Espace après pull des images de base :"
    df -h /

    # Build séquentiel pour économiser le disque
    # Nettoyer les couches intermédiaires entre chaque build
    log "  Build du backend..."
    docker compose -f ${COMPOSE_FILE} build backend
    docker image prune -f 2>/dev/null || true
    log "  Build du frontend..."
    docker compose -f ${COMPOSE_FILE} build frontend
    docker image prune -f 2>/dev/null || true
    log "  Build du mobile..."
    docker compose -f ${COMPOSE_FILE} build mobile
    docker image prune -f 2>/dev/null || true

    log "  Espace après build :"
    df -h /
    AVAIL_KB=$(df / | tail -1 | awk '{print $4}')
    if [ "$AVAIL_KB" -lt 200000 ]; then
        error "Plus que $(( AVAIL_KB / 1024 )) Mo libre ! Disque trop petit pour continuer. Utilisez un serveur avec plus de stockage."
    fi

    # Démarrer SANS le service certbot (évite le conflit avec certbot certonly)
    log "  Démarrage des services (sans certbot)..."
    docker compose -f ${COMPOSE_FILE} up -d db backend frontend mobile nginx

    # Vérifier immédiatement que le conteneur nginx est créé et tourne
    sleep 5
    NGINX_STATUS=$(docker inspect -f '{{.State.Status}}' solidata-proxy 2>/dev/null || echo "not_found")
    if [ "$NGINX_STATUS" = "not_found" ]; then
        error "Le conteneur solidata-proxy n'a pas été créé ! Vérifiez 'docker compose -f ${COMPOSE_FILE} ps -a' et le disque : df -h /"
    elif [ "$NGINX_STATUS" != "running" ]; then
        warn "Conteneur nginx en état : ${NGINX_STATUS}"
        warn "Logs du conteneur nginx :"
        docker logs solidata-proxy --tail=30 2>&1 || true
        warn "Vérification du disque :"
        df -h /
        if [ "$NGINX_STATUS" = "exited" ] || [ "$NGINX_STATUS" = "dead" ]; then
            warn "Nginx a crashé. Tentative de redémarrage..."
            docker start solidata-proxy 2>/dev/null || true
            sleep 5
        fi
    else
        log "Conteneur nginx est running."
    fi

    # Attendre que nginx réponde sur le port 80
    log "Attente que nginx soit prêt sur le port 80..."
    RETRIES=0
    MAX_RETRIES=60
    while [ $RETRIES -lt $MAX_RETRIES ]; do
        HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost 2>/dev/null || echo "000")
        if echo "$HTTP_CODE" | grep -qE "^(200|301|302|404|502)$"; then
            log "Nginx répond sur le port 80 (HTTP $HTTP_CODE) !"
            break
        fi
        if [ $(( RETRIES % 10 )) -eq 0 ] && [ $RETRIES -gt 0 ]; then
            warn "Nginx ne répond pas (HTTP $HTTP_CODE), diagnostic..."
            docker compose -f ${COMPOSE_FILE} ps
            docker compose -f ${COMPOSE_FILE} logs --tail=10 nginx 2>/dev/null || true
        fi
        RETRIES=$((RETRIES + 1))
        echo "  Tentative ${RETRIES}/${MAX_RETRIES} (HTTP ${HTTP_CODE})..."
        sleep 5
    done

    if [ $RETRIES -eq $MAX_RETRIES ]; then
        warn "Nginx ne répond pas. Logs de tous les services :"
        docker compose -f ${COMPOSE_FILE} ps
        docker compose -f ${COMPOSE_FILE} logs --tail=50 nginx
        docker compose -f ${COMPOSE_FILE} logs --tail=20 backend
        docker compose -f ${COMPOSE_FILE} logs --tail=20 frontend
        docker compose -f ${COMPOSE_FILE} logs --tail=20 mobile
        # Vérifier si le port est bien ouvert
        warn "État des ports :"
        ss -tlnp | grep -E ':80|:443' || echo "  Aucun service sur 80/443 !"
        error "Nginx ne répond pas après ${MAX_RETRIES} tentatives."
    fi

    # ── Vérifier le challenge ACME ──
    log "Vérification accès ACME challenge..."
    docker compose -f ${COMPOSE_FILE} exec -T nginx sh -c \
        'mkdir -p /var/www/certbot/.well-known/acme-challenge && echo "acme-test-ok" > /var/www/certbot/.well-known/acme-challenge/test-solidata'
    ACME_TEST=$(curl -s http://localhost/.well-known/acme-challenge/test-solidata 2>/dev/null || echo "FAIL")
    if echo "$ACME_TEST" | grep -q "acme-test-ok"; then
        log "ACME challenge accessible en local !"
    else
        warn "ACME challenge NON accessible en local. Réponse: ${ACME_TEST}"
        warn "Logs nginx :"
        docker compose -f ${COMPOSE_FILE} logs --tail=20 nginx
    fi

    # Vérifier l'accès externe (depuis l'IP publique)
    log "Vérification accès externe sur ${SERVER_IP}:80..."
    EXT_CODE=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 "http://${SERVER_IP}/.well-known/acme-challenge/test-solidata" 2>/dev/null || echo "000")
    if [ "$EXT_CODE" = "000" ]; then
        warn "⚠️  Port 80 NON ACCESSIBLE depuis l'IP publique ${SERVER_IP} !"
        warn "Vérifiez le Security Group Scaleway : port 80 TCP doit être ouvert en INBOUND."
        warn "Console Scaleway > Instances > Security Groups > Ajouter règle : TCP 80 ACCEPT"
    else
        log "Port 80 accessible depuis l'IP publique (HTTP $EXT_CODE)"
    fi

    # ── Étape 3: Obtenir certificat SSL ──
    log "Étape 3/7 — Obtention certificat Let's Encrypt..."
    docker compose -f ${COMPOSE_FILE} run --rm --entrypoint "" certbot \
        certbot certonly \
        --webroot \
        --webroot-path=/var/www/certbot \
        --email ${EMAIL} \
        --agree-tos \
        --no-eff-email \
        --force-renewal \
        -d ${DOMAIN} \
        -d www.${DOMAIN} \
        -d m.${DOMAIN}

    # ── Étape 4: Restaurer config SSL + redémarrer nginx ──
    log "Étape 4/7 — Activation SSL..."
    if [ -f "${CONF_DIR}/solidata.conf.ssl-backup" ]; then
        cp "${CONF_DIR}/solidata.conf.ssl-backup" "${CONF_DIR}/solidata.conf"
        rm -f "${CONF_DIR}/solidata.conf.ssl-backup"
    else
        warn "Backup SSL introuvable, la config actuelle est conservée."
    fi

    # Certbot peut créer le certificat dans solidata.online-0001 au lieu de solidata.online
    # (si le dossier solidata.online existait déjà avec l'auto-signé)
    # On copie les vrais certs au bon endroit pour que Nginx les trouve
    log "Vérification emplacement certificat Let's Encrypt..."
    docker compose -f ${COMPOSE_FILE} exec -T nginx sh -c '
        if [ -d /etc/letsencrypt/live/solidata.online-0001 ] && [ -f /etc/letsencrypt/live/solidata.online-0001/fullchain.pem ]; then
            echo "Certificat trouvé dans solidata.online-0001, copie vers solidata.online..."
            cp -fL /etc/letsencrypt/live/solidata.online-0001/fullchain.pem /etc/letsencrypt/live/solidata.online/fullchain.pem
            cp -fL /etc/letsencrypt/live/solidata.online-0001/privkey.pem /etc/letsencrypt/live/solidata.online/privkey.pem
        fi
    '

    log "Redémarrage nginx avec SSL..."
    docker compose -f ${COMPOSE_FILE} restart nginx
    sleep 10

    # Maintenant démarrer aussi le service certbot (renouvellement automatique)
    log "Démarrage du service certbot (renouvellement auto)..."
    docker compose -f ${COMPOSE_FILE} up -d certbot

    # ── Étape 5: Initialisation base de données ──
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

    # ── Étape 6: Nettoyage ──
    log "Étape 6/7 — Nettoyage images intermédiaires..."
    docker image prune -f

    # ── Étape 7: Statut final ──
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
    log "Étape 1/6 — Sauvegarde base de données..."
    bash deploy/scripts/backup.sh

    # Pull dernières modifications
    log "Étape 2/6 — Récupération du code..."
    git pull origin main

    # Rebuild séquentiel sans cache (économise le disque sur DEV1-S)
    log "Étape 3/6 — Reconstruction des images (sans cache)..."
    log "  Build backend..."
    docker compose -f ${COMPOSE_FILE} build --no-cache backend
    docker image prune -f 2>/dev/null || true
    log "  Build frontend..."
    docker compose -f ${COMPOSE_FILE} build --no-cache frontend
    docker image prune -f 2>/dev/null || true
    log "  Build mobile..."
    docker compose -f ${COMPOSE_FILE} build --no-cache mobile
    docker image prune -f 2>/dev/null || true

    log "Étape 4/6 — Redémarrage des services..."
    docker compose -f ${COMPOSE_FILE} up -d

    # Migrations base de données
    log "Étape 5/6 — Migrations base de données..."
    sleep 5
    if docker compose -f ${COMPOSE_FILE} exec -T backend node src/scripts/init-db.js 2>/dev/null; then
        log "init-db.js exécuté (tables + migrations)."
    else
        warn "init-db.js a échoué. Vérifiez les logs : docker compose -f ${COMPOSE_FILE} logs backend"
    fi

    # Cleanup + Health check
    log "Étape 6/6 — Nettoyage et vérification..."
    docker image prune -f

    # Health check
    sleep 3
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 http://localhost/api/health 2>/dev/null || echo "000")
    if [ "$HTTP_CODE" = "200" ]; then
        log "Health check API : OK (HTTP 200)"
    else
        warn "Health check API : HTTP ${HTTP_CODE} — vérifiez les logs backend"
    fi

    log "=== MISE À JOUR TERMINÉE ==="
    docker compose -f ${COMPOSE_FILE} ps
    log "Espace disque :"
    df -h /
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
