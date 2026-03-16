#!/bin/sh
# Si les certificats n'existent pas encore, créer des auto-signés temporaires
# pour que nginx puisse démarrer (certbot les remplacera ensuite)
CERT_DIR="/etc/letsencrypt/live/solidata.online"
if [ ! -f "$CERT_DIR/fullchain.pem" ]; then
  echo "[NGINX] Certificats absents — création de certificats auto-signés temporaires..."
  mkdir -p "$CERT_DIR"
  openssl req -x509 -nodes -days 1 -newkey rsa:2048 \
    -keyout "$CERT_DIR/privkey.pem" \
    -out "$CERT_DIR/fullchain.pem" \
    -subj "/CN=solidata.online" 2>/dev/null
  echo "[NGINX] Certificats temporaires créés. Lancez certbot pour les vrais certificats."
fi

# Lancer nginx
exec nginx -g "daemon off;"
