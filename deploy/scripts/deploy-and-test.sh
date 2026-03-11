#!/bin/bash
# ============================================================
# SOLIDATA — Déploiement production + vérifications
# À exécuter SUR LE SERVEUR : cd /opt/solidata.online && bash deploy/scripts/deploy-and-test.sh
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
cd "${APP_DIR}"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'
log()  { echo -e "${GREEN}[SOLIDATA]${NC} $1"; }
warn() { echo -e "${YELLOW}[ATTENTION]${NC} $1"; }
err()  { echo -e "${RED}[ERREUR]${NC} $1"; }

# 1. Déploiement
log "=== Étape 1/3 : Mise à jour (deploy.sh update) ==="
bash deploy/scripts/deploy.sh update

# 2. Health check local (conteneurs + endpoints)
log "=== Étape 2/3 : Vérification santé (health-check.sh) ==="
bash deploy/scripts/health-check.sh

# 3. Test API /api/health (depuis le serveur)
log "=== Étape 3/3 : Test API /api/health ==="
DOMAIN="${SOLIDATA_DOMAIN:-solidata.online}"
HEALTH_URL="https://${DOMAIN}/api/health"
HTTP_CODE=$(curl -s -o /tmp/solidata-health.json -w "%{http_code}" --max-time 15 "${HEALTH_URL}" 2>/dev/null || echo "000")
if [ "${HTTP_CODE}" = "200" ]; then
  if grep -q '"status":"ok"' /tmp/solidata-health.json 2>/dev/null; then
    log "API health OK (HTTP 200, status ok)"
  else
    warn "API a répondu 200 mais body inattendu"
  fi
else
  err "API health a échoué (HTTP ${HTTP_CODE})"
  exit 1
fi

log "=== Déploiement et vérifications terminés ==="
log "Pour les tests complets (smoke API avec login), exécutez depuis votre PC :"
log "  scripts\\run-tests.bat"
log "  ou : set BASE_URL=https://${DOMAIN} && node scripts/tests/api-smoke.js"
