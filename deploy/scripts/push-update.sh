#!/bin/bash
# ═══════════════════════════════════════════════════════
# SOLIDATA — Script de mise à jour production
# Usage : bash deploy/scripts/push-update.sh
# Exécuter depuis un poste avec accès SSH au serveur
# ═══════════════════════════════════════════════════════

set -e

SERVER="root@51.159.144.100"
REMOTE_DIR="/opt/solidata.online"
BRANCH="claude/fix-pennylane-add-docs-BWs4Y"

echo "══════════════════════════════════════════"
echo "  SOLIDATA — Déploiement production"
echo "══════════════════════════════════════════"
echo ""

# 1. Vérifier l'accès SSH
echo "▶ Vérification accès SSH..."
if ! ssh -o ConnectTimeout=5 "$SERVER" "echo ok" > /dev/null 2>&1; then
  echo "✗ Impossible de se connecter à $SERVER"
  echo "  Vérifiez votre clé SSH et votre connexion réseau."
  exit 1
fi
echo "✓ Connexion SSH OK"
echo ""

# 2. Ajouter la clé OpenAgenda si absente
echo "▶ Vérification OPENAGENDA_API_KEY..."
ssh "$SERVER" bash -s <<'REMOTE_ENV'
cd /opt/solidata.online
if grep -q "OPENAGENDA_API_KEY" .env 2>/dev/null; then
  echo "✓ OPENAGENDA_API_KEY déjà présente dans .env"
else
  echo 'OPENAGENDA_API_KEY=52061f01b0824e5793431d2bc9c1d8d5' >> .env
  echo "✓ OPENAGENDA_API_KEY ajoutée au .env"
fi
REMOTE_ENV
echo ""

# 3. Merge de la branche dans main puis déploiement
echo "▶ Merge $BRANCH → main et déploiement..."
ssh "$SERVER" bash -s <<REMOTE_DEPLOY
set -e
cd $REMOTE_DIR

echo "  → git fetch..."
git fetch origin

echo "  → Checkout main..."
git checkout main

echo "  → Merge de la branche $BRANCH..."
git merge origin/$BRANCH -m "merge: intégrer $BRANCH (Pennylane, docs véhicules, UX, IA événements multi-sources)"

echo "  → Lancement deploy.sh update..."
bash deploy/scripts/deploy.sh update

echo ""
echo "✓ Déploiement terminé !"
REMOTE_DEPLOY

echo ""
echo "══════════════════════════════════════════"
echo "  ✓ Mise à jour production terminée"
echo "══════════════════════════════════════════"
echo ""
echo "Vérifications :"
echo "  → https://solidata.online"
echo "  → https://solidata.online/api/health"
echo ""
