#!/bin/sh
set -e

CERT_DIR="/etc/letsencrypt/live/solidata.online"
CERT_FILE="$CERT_DIR/fullchain.pem"
KEY_FILE="$CERT_DIR/privkey.pem"

# Vérifier si les certificats sont lisibles (pas juste si le dossier existe)
if [ ! -r "$CERT_FILE" ] || [ ! -r "$KEY_FILE" ]; then
  echo "[NGINX-INIT] Certificats absents ou illisibles dans $CERT_DIR"
  echo "[NGINX-INIT] Génération de certificats auto-signés temporaires..."
  mkdir -p "$CERT_DIR"
  apk add --no-cache openssl > /dev/null 2>&1 || true
  openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
    -keyout "$KEY_FILE" \
    -out "$CERT_FILE" \
    -subj "/CN=solidata.online" 2>/dev/null
  echo "[NGINX-INIT] Certificats temporaires créés."
  echo "[NGINX-INIT] Pour obtenir de vrais certificats, lancez :"
  echo "  docker compose exec certbot certbot certonly --webroot -w /var/www/certbot -d solidata.online -d www.solidata.online -d m.solidata.online --email votre@email.com --agree-tos"
  echo "  docker compose exec nginx nginx -s reload"
else
  echo "[NGINX-INIT] Certificats SSL trouvés et lisibles."
fi

# Déléguer au vrai entrypoint nginx
exec /docker-entrypoint.sh nginx -g "daemon off;"
