#!/bin/bash
# ============================================================
# SOLIDATA — Configuration des clés VAPID (Web Push, Niveau 2.2)
# ------------------------------------------------------------
# Usage :
#   bash deploy/scripts/configure-vapid.sh
# Comportement :
#   - Si VAPID_PUBLIC_KEY est déjà non vide dans .env → no-op
#   - Sinon : génère une paire VAPID, backup .env, ajoute les
#     3 variables (PUBLIC, PRIVATE, SUBJECT).
#   - Tente `npx web-push generate-vapid-keys` directement ;
#     fallback sur le conteneur solidata-api (si déjà déployé).
# ============================================================

set -euo pipefail

APP_DIR="${APP_DIR:-/opt/solidata.online}"
ENV_FILE="${APP_DIR}/.env"
COMPOSE_FILE="${APP_DIR}/docker-compose.prod.yml"
SUBJECT_DEFAULT="mailto:admin@solidata.online"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
log()  { echo -e "${GREEN}[VAPID]${NC} $1"; }
warn() { echo -e "${YELLOW}[VAPID]${NC} $1"; }
err()  { echo -e "${RED}[VAPID]${NC} $1" >&2; exit 1; }

cd "$APP_DIR" || err "Répertoire introuvable : $APP_DIR"
[ -f "$ENV_FILE" ] || err "Fichier .env introuvable : $ENV_FILE"

# ── 1. Si la clé publique est déjà renseignée, on n'écrase pas ──
EXISTING=$(grep -E '^VAPID_PUBLIC_KEY=.+$' "$ENV_FILE" | head -n1 || true)
if [ -n "$EXISTING" ] && [ "$EXISTING" != "VAPID_PUBLIC_KEY=" ]; then
  log "Clés VAPID déjà présentes dans $ENV_FILE — aucune action."
  log "Pour les régénérer : retirer VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY puis relancer."
  exit 0
fi

# ── 2. Génération des clés ──────────────────────────────────────
OUT=""

# Tentative 1 : npx direct (sans dépendre du conteneur)
if command -v npx >/dev/null 2>&1; then
  log "Génération via 'npx web-push generate-vapid-keys'..."
  OUT=$(npx --yes web-push generate-vapid-keys --json 2>/dev/null || true)
fi

# Tentative 2 : conteneur backend (si npx local indisponible ou a échoué)
# Nom du service dans docker-compose.prod.yml : "backend" (container: solidata-api)
if [ -z "$OUT" ] && command -v docker >/dev/null 2>&1 && [ -f "$COMPOSE_FILE" ]; then
  log "Fallback : génération via le conteneur backend..."
  OUT=$(docker compose -f "$COMPOSE_FILE" exec -T backend npx web-push generate-vapid-keys --json 2>/dev/null || true)
  # Fallback ultime : exec direct sur le container par son nom
  if [ -z "$OUT" ]; then
    OUT=$(docker exec -i solidata-api npx web-push generate-vapid-keys --json 2>/dev/null || true)
  fi
fi

[ -n "$OUT" ] || err "Génération impossible. Déployer d'abord (bash deploy/scripts/deploy.sh update) puis relancer ce script."

# ── 3. Parsing JSON (portable, sans jq) ─────────────────────────
PUB=$(printf '%s' "$OUT"  | sed -n 's/.*"publicKey":"\([^"]*\)".*/\1/p' | head -n1)
PRIV=$(printf '%s' "$OUT" | sed -n 's/.*"privateKey":"\([^"]*\)".*/\1/p' | head -n1)

[ -n "$PUB" ]  || err "Parsing publicKey échoué — sortie : $OUT"
[ -n "$PRIV" ] || err "Parsing privateKey échoué"

# ── 4. Backup et nettoyage d'anciennes lignes vides ─────────────
BACKUP="${ENV_FILE}.bak.$(date +%Y%m%d_%H%M%S)"
cp "$ENV_FILE" "$BACKUP"
log "Backup : $BACKUP"

# Supprime les lignes vides VAPID existantes (ex: VAPID_PUBLIC_KEY=)
sed -i.tmp \
  -e '/^VAPID_PUBLIC_KEY=$/d' \
  -e '/^VAPID_PRIVATE_KEY=$/d' \
  -e '/^VAPID_SUBJECT=$/d' \
  "$ENV_FILE"
rm -f "${ENV_FILE}.tmp"

# Conserve VAPID_SUBJECT existant s'il est non vide, sinon défaut
SUBJECT=$(grep -E '^VAPID_SUBJECT=.+$' "$ENV_FILE" | head -n1 | cut -d'=' -f2- || true)
[ -z "$SUBJECT" ] && SUBJECT="$SUBJECT_DEFAULT"

# Si une ligne SUBJECT non vide existe déjà, ne pas la redupliquer
if grep -qE '^VAPID_SUBJECT=.+$' "$ENV_FILE"; then
  SUBJECT_LINE=""
else
  SUBJECT_LINE="VAPID_SUBJECT=${SUBJECT}"
fi

# ── 5. Ajout des clés ──────────────────────────────────────────
{
  echo ""
  echo "# Web Push VAPID (Niveau 2.2) — généré le $(date '+%Y-%m-%d %H:%M:%S')"
  echo "VAPID_PUBLIC_KEY=${PUB}"
  echo "VAPID_PRIVATE_KEY=${PRIV}"
  [ -n "$SUBJECT_LINE" ] && echo "$SUBJECT_LINE"
} >> "$ENV_FILE"

log "✓ Clés VAPID ajoutées à $ENV_FILE"
log "  Public prefix : ${PUB:0:20}…"
log "  Subject       : ${SUBJECT}"
echo ""
warn "Redémarrer le backend pour prendre en compte les nouvelles variables :"
echo "    docker compose -f docker-compose.prod.yml restart backend"
