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

docker compose -f "$COMPOSE_FILE" exec -T nginx sh -c '
  if [ -f /etc/letsencrypt/live/solidata.online-0001/fullchain.pem ]; then
    cp -fL /etc/letsencrypt/live/solidata.online-0001/fullchain.pem /etc/letsencrypt/live/solidata.online/fullchain.pem
    cp -fL /etc/letsencrypt/live/solidata.online-0001/privkey.pem /etc/letsencrypt/live/solidata.online/privkey.pem
  fi
  nginx -t && nginx -s reload
' && echo "[$(date '+%Y-%m-%d %H:%M:%S')] Certificat rechargé dans nginx" \
  || echo "[$(date '+%Y-%m-%d %H:%M:%S')] ERREUR rechargement certificat nginx"
