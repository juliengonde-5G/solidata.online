#!/bin/bash
# ============================================================
# SOLIDATA — Rechargement du certificat SSL dans nginx
# À exécuter après un renouvellement certbot (cron ou manuel).
# Re-copie le certificat renouvelé dans le chemin servi par
# nginx puis recharge la config sans coupure.
#
# Usage : bash deploy/scripts/reload-nginx-certs.sh
# ============================================================

COMPOSE_FILE="${COMPOSE_FILE:-/opt/solidata.online/docker-compose.prod.yml}"

# 1. Re-copie du certificat renouvelé dans le chemin servi par nginx + test config.
docker compose -f "$COMPOSE_FILE" exec -T nginx sh -c '
  if [ -f /etc/letsencrypt/live/solidata.online-0001/fullchain.pem ]; then
    cp -fL /etc/letsencrypt/live/solidata.online-0001/fullchain.pem /etc/letsencrypt/live/solidata.online/fullchain.pem
    cp -fL /etc/letsencrypt/live/solidata.online-0001/privkey.pem /etc/letsencrypt/live/solidata.online/privkey.pem
  fi
  nginx -t
'
TEST_RC=$?

# 2. Rechargement gracieux via SIGHUP au process principal du conteneur (PID 1 = maître nginx).
#    Plus robuste que `nginx -s reload`, qui échoue si /var/run/nginx.pid est vide
#    (cas fréquent avec `daemon off;` en conteneur : « invalid PID number »).
if [ "$TEST_RC" -eq 0 ]; then
  docker compose -f "$COMPOSE_FILE" kill -s HUP nginx \
    && echo "[$(date '+%Y-%m-%d %H:%M:%S')] Certificat rechargé dans nginx (SIGHUP)" \
    || echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERREUR envoi SIGHUP à nginx"
else
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERREUR: nginx -t a échoué, rechargement annulé"
fi
