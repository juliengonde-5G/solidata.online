#!/bin/bash
# ============================================================
# Déploiement : Affectation chauffeur par véhicule + Fix Pennylane
# Date : 28 mars 2026
# Branche : claude/vehicle-link-assignment-w6YHZ
# ============================================================

set -euo pipefail

SERVER="root@51.159.144.100"
BRANCH="claude/vehicle-link-assignment-w6YHZ"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[DEPLOY]${NC} $1"; }
warn() { echo -e "${YELLOW}[ATTENTION]${NC} $1"; }
error() { echo -e "${RED}[ERREUR]${NC} $1"; exit 1; }

# ── Étape 1 : Merge sur main ──
log "Étape 1/4 — Merge de ${BRANCH} sur main..."
git checkout main
git pull origin main
git merge ${BRANCH} --no-edit
log "Merge OK ✓"

# ── Étape 2 : Push main ──
log "Étape 2/4 — Push sur origin/main..."
git push origin main
log "Push OK ✓"

# ── Étape 3 : Déploiement serveur ──
log "Étape 3/4 — Déploiement sur le serveur de production..."
ssh ${SERVER} "cd /opt/solidata.online && bash deploy/scripts/deploy.sh update"
log "Déploiement serveur OK ✓"

# ── Étape 4 : Vérification santé ──
log "Étape 4/4 — Vérification santé API..."
sleep 10
HEALTH=$(curl -s -o /dev/null -w "%{http_code}" https://solidata.online/api/health || echo "000")
if [ "$HEALTH" = "200" ]; then
  log "API santé OK (HTTP 200) ✓"
else
  warn "API retourne HTTP ${HEALTH} — vérifier les logs : ssh ${SERVER} 'cd /opt/solidata.online && docker compose -f docker-compose.prod.yml logs --tail=50 solidata-api'"
fi

echo ""
log "══════════════════════════════════════════════════"
log "  DÉPLOIEMENT TERMINÉ"
log "  - Affectation chauffeur attitré par véhicule"
log "  - Fix table financial_exercises (Pennylane)"
log "══════════════════════════════════════════════════"
