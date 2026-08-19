#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# Appairage d'un poste par CODE COURT (ADR-0005, contrat device v1.4).
#
#   sudo bash appairage.sh --code K7M2-9PQX [--url https://solidata.online]
#                          [--target pi5|pi3] [--output /etc/badgeuse/badgeuse.conf]
#
# Échange un code de 8 caractères, affiché par SOLIDATA (Supervision -> fiche du
# poste -> « Code d'appairage »), contre la configuration complète du poste :
# clé du poste NEUVE, clé HMAC du site, code du poste. Écrit le fichier en 0600.
#
# Remplace la saisie manuelle de deux clés de 64 caractères hexadécimaux : la
# frappe passe de 128 caractères à 8, et les clés ne transitent plus par un
# clavier. Le code est à usage unique et expire (défaut 15 min).
# -----------------------------------------------------------------------------
set -euo pipefail

CODE="${BADGEUSE_CODE:-}"
URL="${BADGEUSE_URL:-https://solidata.online}"
TARGET=""
OUT=""
FORCE=0

erreur() { echo "ERREUR : $*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --code) CODE="${2:?}"; shift 2 ;;
    --url) URL="${2:?}"; shift 2 ;;
    --target) TARGET="${2:?}"; shift 2 ;;
    -o|--output) OUT="${2:?}"; shift 2 ;;
    --force) FORCE=1; shift ;;
    -h|--help)
      sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) erreur "option inconnue : $1" ;;
  esac
done

command -v python3 >/dev/null 2>&1 || erreur "python3 est requis."

# Cible : déduite de la machine si elle n'est pas imposée.
if [ -z "$TARGET" ]; then
  MODELE="$(tr -d '\0' < /proc/device-tree/model 2>/dev/null || echo '')"
  case "$MODELE" in
    *"Raspberry Pi 3"*) TARGET="pi3" ;;
    *) TARGET="pi5" ;;
  esac
fi

OUT="${OUT:-/etc/badgeuse/badgeuse.conf}"
if [ -e "$OUT" ] && [ "$FORCE" -ne 1 ]; then
  erreur "$OUT existe déjà. Relancer avec --force pour le remplacer."
fi

# Le code peut être saisi au clavier : c'est court, lisible, sans ambiguïté.
if [ -z "$CODE" ]; then
  if : </dev/tty 2>/dev/null; then
    echo "Code d'appairage affiché par SOLIDATA (Supervision -> « Code d'appairage »)."
    read -r -p "Code (8 caractères, ex. K7M2-9PQX) : " CODE </dev/tty || true
  fi
fi
[ -n "$CODE" ] || erreur "aucun code fourni."

case "$URL" in https://*) ;; *) erreur "l'adresse doit être en HTTPS : '$URL'" ;; esac
URL="${URL%/}"

echo "── Appairage auprès de ${URL}…"

# Échange du code contre la configuration. Python3 est déjà requis par l'agent :
# pas de dépendance supplémentaire (urllib est dans la bibliothèque standard).
REPONSE="$(CODE="$CODE" URL="$URL" python3 - <<'PY'
import json, os, ssl, sys, urllib.request, urllib.error

code = "".join(ch for ch in os.environ["CODE"].upper() if ch.isalnum())
url = os.environ["URL"].rstrip("/") + "/api/badgeuse/device/v1/appairage"
corps = json.dumps({"code": code}).encode()
req = urllib.request.Request(url, data=corps, method="POST",
                             headers={"Content-Type": "application/json"})
try:
    with urllib.request.urlopen(req, timeout=30,
                                context=ssl.create_default_context()) as r:
        d = json.load(r)
except urllib.error.HTTPError as e:
    if e.code == 404:
        sys.exit("code invalide, expire ou deja utilise — en regenerer un dans SOLIDATA")
    if e.code == 429:
        sys.exit("trop de tentatives — patienter une heure avant de reessayer")
    sys.exit(f"le serveur a refuse l'appairage (HTTP {e.code})")
except urllib.error.URLError as e:
    sys.exit(f"serveur injoignable ({e.reason}) — verifier le reseau et l'adresse")

manquants = [c for c in ("device_code", "device_key", "hmac_key") if not d.get(c)]
if manquants:
    sys.exit("reponse incomplete du serveur : " + ", ".join(manquants))

# Les valeurs sortent sur des lignes distinctes, jamais journalisées.
print(d["device_code"]); print(d["device_key"]); print(d["hmac_key"])
print(d.get("server_url") or os.environ["URL"])
print(d.get("cible") or "")
PY
)" || erreur "appairage impossible."

DEVICE_CODE="$(printf '%s\n' "$REPONSE" | sed -n 1p)"
DEVICE_KEY="$(printf '%s\n' "$REPONSE" | sed -n 2p)"
HMAC_KEY="$(printf '%s\n' "$REPONSE" | sed -n 3p)"
SERVER_URL="$(printf '%s\n' "$REPONSE" | sed -n 4p)"
CIBLE_SRV="$(printf '%s\n' "$REPONSE" | sed -n 5p)"

[ "${#HMAC_KEY}" -eq 64 ] || erreur "clé HMAC reçue invalide (${#HMAC_KEY} caractères)."
[ "${#DEVICE_KEY}" -ge 32 ] || erreur "clé de poste reçue invalide."

# Le serveur sait quel modèle il attend : sa valeur prime, et une incohérence
# se signale plutôt que de s'installer en silence.
if [ -n "$CIBLE_SRV" ] && [ "$CIBLE_SRV" != "$TARGET" ]; then
  echo "    /!\\ le serveur déclare ce poste comme « ${CIBLE_SRV} », machine détectée « ${TARGET} »"
  echo "        → la valeur du serveur est retenue."
  TARGET="$CIBLE_SRV"
fi

mkdir -p "$(dirname "$OUT")"
UMASK_PRECEDENT="$(umask)"; umask 077
cat > "$OUT" <<EOF
; Configuration du poste — obtenue par CODE D'APPAIRAGE (ADR-0005).
; Fichier SECRET : 0600, propriétaire badgeuse. Ne jamais versionner.

[server]
url = ${SERVER_URL}
device_code = ${DEVICE_CODE}
device_key = ${DEVICE_KEY}

[site]
hmac_key = ${HMAC_KEY}

[reader]
;vendor_id = 0xffff
;product_id = 0x0035

[system]
data_dir = /var/lib/badgeuse
target = ${TARGET}

[dpms]
allumage = 05:30
extinction = 21:30
EOF
umask "$UMASK_PRECEDENT"
chmod 600 "$OUT"
id -u badgeuse >/dev/null 2>&1 && [ "$(id -u)" -eq 0 ] && chown badgeuse:badgeuse "$OUT" || true

echo "✔ Poste ${DEVICE_CODE} appairé — configuration écrite dans ${OUT} (0600)"
echo "  Le code vient d'être consommé : il ne fonctionnera plus."
