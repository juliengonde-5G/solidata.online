#!/bin/bash
# Script d'initialisation SSL pour solidata.online
# À exécuter UNE SEULE FOIS sur le serveur avant le premier docker compose up
set -e

DOMAINS="solidata.online www.solidata.online m.solidata.online"
EMAIL="${1:?Usage: ./init-ssl.sh votre-email@example.com}"
COMPOSE_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== Initialisation SSL pour solidata.online ==="

# 1. Créer les volumes et répertoires
echo "[1/5] Création des répertoires..."
docker compose -f "$COMPOSE_DIR/docker-compose.yml" up -d --no-deps nginx
sleep 2

# 2. Arrêter nginx pour libérer le port 80
echo "[2/5] Arrêt de nginx..."
docker compose -f "$COMPOSE_DIR/docker-compose.yml" stop nginx

# 3. Obtenir les certificats en mode standalone (pas besoin de webroot)
echo "[3/5] Obtention des certificats Let's Encrypt (mode standalone)..."
docker run --rm \
  -p 80:80 \
  -v "$(docker volume inspect solidataonline_letsencrypt --format '{{.Mountpoint}}')":/etc/letsencrypt \
  certbot/certbot certonly \
    --standalone \
    --preferred-challenges http \
    -d solidata.online \
    -d www.solidata.online \
    -d m.solidata.online \
    --email "$EMAIL" \
    --agree-tos \
    --no-eff-email

# 4. Démarrer tout
echo "[4/5] Démarrage de la stack complète..."
docker compose -f "$COMPOSE_DIR/docker-compose.yml" up -d

# 5. Vérification
echo "[5/5] Vérification..."
sleep 3
if curl -sk https://solidata.online/ -o /dev/null -w "%{http_code}" | grep -q "200\|301\|302"; then
  echo "✓ HTTPS fonctionne !"
else
  echo "⚠ Vérifiez la config — tentez : docker compose logs nginx"
fi

echo ""
echo "=== Terminé ! ==="
echo "Le renouvellement automatique est géré par le conteneur certbot."
