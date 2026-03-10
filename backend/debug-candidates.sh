#!/bin/bash
# ══════════════════════════════════════════════════════════════
# Script de diagnostic — Page Candidats
# Usage : bash debug-candidates.sh
# ══════════════════════════════════════════════════════════════

API_URL="${API_URL:-http://localhost:3001/api}"
echo "=== DIAGNOSTIC CANDIDATS ==="
echo "API_URL: $API_URL"
echo ""

# 1. Vérifier que le serveur répond
echo "--- 1. Test connexion serveur ---"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/auth/me" 2>/dev/null)
echo "GET /api/auth/me → HTTP $HTTP_CODE"
if [ "$HTTP_CODE" = "000" ]; then
  echo "❌ Le serveur ne répond pas sur $API_URL"
  echo "   Vérifiez que le backend tourne (pm2 status / docker ps)"
  exit 1
fi
echo ""

# 2. Se connecter (adapter email/password)
echo "--- 2. Authentification ---"
TOKEN=$(curl -s -X POST "$API_URL/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@solidata.fr","password":"admin123"}' | \
  python3 -c "import sys,json; print(json.load(sys.stdin).get('token',''))" 2>/dev/null)

if [ -z "$TOKEN" ]; then
  echo "❌ Échec authentification — adaptez email/password dans ce script"
  echo "   Essayez avec vos identifiants réels"
  exit 1
fi
echo "✅ Token obtenu: ${TOKEN:0:20}..."
echo ""

AUTH="Authorization: Bearer $TOKEN"

# 3. Test GET /candidates
echo "--- 3. GET /candidates ---"
RESP=$(curl -s -w "\nHTTP_CODE:%{http_code}" "$API_URL/candidates" -H "$AUTH")
CODE=$(echo "$RESP" | grep "HTTP_CODE:" | cut -d: -f2)
BODY=$(echo "$RESP" | grep -v "HTTP_CODE:")
echo "HTTP $CODE"
if [ "$CODE" != "200" ]; then
  echo "❌ Erreur: $BODY"
else
  COUNT=$(echo "$BODY" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null)
  echo "✅ $COUNT candidats trouvés"
fi
echo ""

# 4. Test GET /candidates/positions/list
echo "--- 4. GET /candidates/positions/list ---"
RESP=$(curl -s -w "\nHTTP_CODE:%{http_code}" "$API_URL/candidates/positions/list" -H "$AUTH")
CODE=$(echo "$RESP" | grep "HTTP_CODE:" | cut -d: -f2)
BODY=$(echo "$RESP" | grep -v "HTTP_CODE:")
echo "HTTP $CODE"
if [ "$CODE" != "200" ]; then
  echo "❌ Erreur positions: $BODY"
else
  echo "✅ Positions OK"
fi
echo ""

# 5. Test POST /candidates (création)
echo "--- 5. POST /candidates (test création) ---"
RESP=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X POST "$API_URL/candidates" \
  -H "$AUTH" -H "Content-Type: application/json" \
  -d '{"first_name":"Test","last_name":"Debug","email":"test-debug@test.fr","phone":"0600000000","position_id":null}')
CODE=$(echo "$RESP" | grep "HTTP_CODE:" | cut -d: -f2)
BODY=$(echo "$RESP" | grep -v "HTTP_CODE:")
echo "HTTP $CODE"
if [ "$CODE" = "201" ]; then
  CAND_ID=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('id',''))" 2>/dev/null)
  echo "✅ Candidat créé (id=$CAND_ID)"

  # 6. Test PUT /candidates/:id (modification)
  echo ""
  echo "--- 6. PUT /candidates/$CAND_ID (test modification) ---"
  RESP=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X PUT "$API_URL/candidates/$CAND_ID" \
    -H "$AUTH" -H "Content-Type: application/json" \
    -d '{"first_name":"TestModif","comment":"test debug","appointment_date":"","position_id":""}')
  CODE=$(echo "$RESP" | grep "HTTP_CODE:" | cut -d: -f2)
  BODY=$(echo "$RESP" | grep -v "HTTP_CODE:")
  echo "HTTP $CODE"
  if [ "$CODE" = "200" ]; then
    echo "✅ Modification OK"
  else
    echo "❌ Erreur modification: $BODY"
  fi

  # Nettoyage
  echo ""
  echo "--- Nettoyage candidat test ---"
  curl -s -X DELETE "$API_URL/candidates/$CAND_ID" -H "$AUTH" > /dev/null
  echo "✅ Candidat test supprimé"
else
  echo "❌ Erreur création: $BODY"
fi
echo ""

# 7. Vérifier la structure de la table
echo "--- 7. Vérification colonnes table candidates ---"
PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5432}"
PGDATABASE="${PGDATABASE:-solidata}"
PGUSER="${PGUSER:-solidata}"

psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" -c "
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'candidates'
ORDER BY ordinal_position;
" 2>/dev/null

if [ $? -ne 0 ]; then
  echo "⚠️  Impossible de se connecter à PostgreSQL directement."
  echo "   Exportez PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD"
  echo "   ou lancez : psql -d solidata -c \"SELECT column_name, data_type FROM information_schema.columns WHERE table_name='candidates';\""
fi
echo ""

# 8. Vérifier les logs serveur récents
echo "--- 8. Dernières erreurs dans les logs ---"
echo "Cherchez les erreurs avec :"
echo "  pm2 logs --lines 50 | grep -i 'erreur\|error\|CANDIDATES'"
echo "  ou : docker logs <container> --tail 50 2>&1 | grep -i 'error'"
echo ""

echo "=== FIN DIAGNOSTIC ==="
