#!/usr/bin/env bash
# SOLIDATA — Push local vers origin main
# Usage: bash push.sh [ "Message de commit" ]

set -e
cd "$(dirname "$0")"

# Verifier l'identite Git (sinon le commit echoue)
if [ -z "$(git config user.email)" ] || [ -z "$(git config user.name)" ]; then
  echo "[PUSH] ERREUR : Git ne sait pas qui vous etes. Configurez une fois :"
  echo "  git config --global user.email \"votre@email.com\""
  echo "  git config --global user.name \"Votre Nom\""
  exit 1
fi

# Aller sur main si elle existe, sinon garder la branche actuelle
BRANCH=$(git branch --show-current)
if git rev-parse --verify main >/dev/null 2>&1; then
  git checkout main
  BRANCH=main
else
  [ "$BRANCH" != "main" ] && echo "[PUSH] Pas de branche 'main' locale. Pousse de $BRANCH vers origin main."
fi

MSG="${1:-Mise a jour $(date '+%Y-%m-%d %H:%M')}"

echo "[PUSH] Branche : $(git branch --show-current)"
echo "[PUSH] Statut avant add..."
git status -s

echo "[PUSH] Ajout de tous les fichiers..."
git add -A

echo "[PUSH] Fichiers a committer..."
git status -s

if git diff --cached --quiet; then
  echo "[PUSH] Rien a committer (working tree propre)."
  exit 0
fi

echo "[PUSH] Commit : $MSG"
git commit -m "$MSG"

echo "[PUSH] Envoi vers origin main..."
if [ "$BRANCH" = "main" ]; then
  PUSH_CMD="git push origin main"
else
  PUSH_CMD="git push origin ${BRANCH}:main"
fi
if ! $PUSH_CMD; then
  echo "[PUSH] ERREUR : push a echoue. Verifiez : git remote -v et votre acces (SSH ou token)."
  exit 1
fi

echo "[PUSH] OK."
