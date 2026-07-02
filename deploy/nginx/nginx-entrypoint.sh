#!/bin/sh
# ============================================================
# SOLIDATA — Entrypoint nginx
# 1. Copie le certificat Let's Encrypt (lineage solidata.online-0001)
#    vers le chemin servi par nginx (live/solidata.online)
# 2. Génère un certificat auto-signé au premier déploiement
# 3. Boucle de fond : re-copie le certificat renouvelé par certbot
#    et recharge nginx toutes les 6 heures (sans coupure)
#
# Sans cette boucle, nginx sert la copie faite au démarrage du
# conteneur jusqu'à son expiration (~90 jours) même si certbot
# renouvelle correctement sur le disque → NET::ERR_CERT_DATE_INVALID
# ============================================================

CERT_DIR=/etc/letsencrypt/live/solidata.online
LINEAGE_DIR=/etc/letsencrypt/live/solidata.online-0001

apk add --no-cache openssl >/dev/null 2>&1 || true
mkdir -p "$CERT_DIR"

refresh_certs() {
  if [ -f "$LINEAGE_DIR/fullchain.pem" ]; then
    cp -fL "$LINEAGE_DIR/fullchain.pem" "$CERT_DIR/fullchain.pem"
    cp -fL "$LINEAGE_DIR/privkey.pem" "$CERT_DIR/privkey.pem"
    return 0
  fi
  return 1
}

if refresh_certs; then
  echo "Certificat Let's Encrypt copié depuis solidata.online-0001"
elif [ ! -f "$CERT_DIR/fullchain.pem" ]; then
  openssl req -x509 -nodes -days 1 -newkey rsa:2048 \
    -keyout "$CERT_DIR/privkey.pem" -out "$CERT_DIR/fullchain.pem" \
    -subj /CN=solidata.online
  echo "Certificat auto-signé généré (premier déploiement)"
else
  echo "Certificat existant conservé"
fi

# Boucle de rafraîchissement (toutes les 6 h = 21600 s)
(
  while :; do
    sleep 21600
    refresh_certs
    nginx -s reload 2>/dev/null || true
    echo "nginx rechargé (rafraîchissement certificat SSL)"
  done
) &

exec nginx -g "daemon off;"
