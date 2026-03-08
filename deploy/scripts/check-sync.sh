#!/bin/bash
# Diagnostic branche / sync — à lancer SUR LE SERVEUR (SSH)
# bash deploy/scripts/check-sync.sh

set -euo pipefail
cd /opt/solidata.online

echo "=== Diagnostic sync SOLIDATA ==="
echo ""
echo "1. Branche actuelle :"
git branch -v
echo ""
echo "2. Dernier commit local :"
git log -1 --oneline
echo ""
echo "3. Dernier commit sur origin/main (sans fetch) :"
git log -1 origin/main --oneline 2>/dev/null || echo "(fetch nécessaire)"
echo ""
echo "4. Fetch puis dernier commit origin/main :"
git fetch origin
git log -1 origin/main --oneline
echo ""
echo "5. Êtes-vous à jour avec origin/main ?"
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)
if [ "$LOCAL" = "$REMOTE" ]; then
  echo "   Oui : même commit que origin/main."
else
  echo "   Non : le serveur n'a pas le dernier code."
  echo "   Local  : $LOCAL"
  echo "   Remote : $REMOTE"
  echo "   → Faire : git pull origin main"
  echo "   Puis   : bash deploy/scripts/deploy.sh update"
fi
echo ""
echo "6. Le fichier Employees.jsx contient-il les modifs (bouton Enregistrer) ?"
if grep -q "firstInputRef" frontend/src/pages/Employees.jsx 2>/dev/null; then
  echo "   Oui : firstInputRef présent."
else
  echo "   Non : fichier ancien. Faire git pull origin main."
fi
echo ""
echo "=== Fin diagnostic ==="
