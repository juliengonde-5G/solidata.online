#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# Génération de la configuration d'un poste de pointage SOLIDATA.
#
#   bash deploy/make-conf.sh                      # dialogue guidé (recommandé)
#   bash deploy/make-conf.sh -o /tmp/badgeuse.conf --target pi3
#   sudo bash deploy/make-conf.sh --install       # écrit /etc/badgeuse/badgeuse.conf
#
# Remplace le « cp badgeuse.conf.example + éditer à la main » : les deux clés
# fournies UNE SEULE FOIS par le back-office (Supervision -> Appairage) sont
# saisies ici, VALIDÉES immédiatement, et le fichier est écrit en 0600.
#
# Pourquoi une saisie interactive et non des options ?
#   Une clé passée en argument est visible de tout le système (`ps aux`) et
#   reste dans l'historique du shell. Les secrets ne se lisent donc qu'au
#   clavier (saisie masquée) ou dans une variable d'environnement pour les
#   déploiements scriptés (BADGEUSE_DEVICE_KEY / BADGEUSE_HMAC_KEY).
#
# Le script applique EXACTEMENT les règles de validation de
# badgeuse_agent/config.py : ce qui passe ici démarre, ce qui échoue ici
# aurait échoué au premier lancement du service.
# -----------------------------------------------------------------------------
set -euo pipefail

OUT=""
INSTALL=0
FORCE=0
TARGET=""
URL=""
DEVICE_CODE=""
DATA_DIR="/var/lib/badgeuse"
DPMS_ALLUMAGE="05:30"
DPMS_EXTINCTION="21:30"
READER_VENDOR=""
READER_PRODUCT=""

INSTALL_PATH="/etc/badgeuse/badgeuse.conf"
DEFAULT_URL="https://solidata.online"

usage() {
  cat <<'USAGE'
Usage : bash deploy/make-conf.sh [options]

  -o, --output FICHIER   Chemin du fichier à écrire (défaut : ./badgeuse.conf)
      --install          Écrit directement /etc/badgeuse/badgeuse.conf (root requis)
      --url URL          Racine HTTPS de SOLIDATA (défaut : https://solidata.online)
      --code CODE        Code du poste, ex. LH-P1 (tel que déclaré au back-office)
      --target pi5|pi3   Cible matérielle (défaut : demandé)
      --data-dir CHEMIN  Répertoire de données (défaut : /var/lib/badgeuse)
      --vendor-id 0xXXXX --product-id 0xXXXX
                         Identifiants USB du lecteur (facultatif : sinon détection auto)
      --allumage HH:MM --extinction HH:MM
                         Plage d'allumage de l'écran (défaut 05:30 / 21:30)
      --force            Écrase un fichier existant
  -h, --help             Cette aide

Les DEUX CLÉS ne se passent jamais en option (elles seraient visibles dans
`ps` et dans l'historique). Elles sont demandées au clavier, en saisie
masquée, ou lues dans les variables d'environnement :

  BADGEUSE_DEVICE_KEY=…  BADGEUSE_HMAC_KEY=…  bash deploy/make-conf.sh --code LH-P1 --target pi5

Où trouver les clés : SOLIDATA -> Temps & Présence -> Supervision ->
« Appairer un poste ». Elles ne sont affichées QU'UNE FOIS. Clé perdue :
bouton « Régénérer la clé » du poste (l'ancienne est révoquée aussitôt).
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    -o|--output) OUT="${2:?}"; shift 2 ;;
    --install) INSTALL=1; shift ;;
    --url) URL="${2:?}"; shift 2 ;;
    --code) DEVICE_CODE="${2:?}"; shift 2 ;;
    --target) TARGET="${2:?}"; shift 2 ;;
    --data-dir) DATA_DIR="${2:?}"; shift 2 ;;
    --vendor-id) READER_VENDOR="${2:?}"; shift 2 ;;
    --product-id) READER_PRODUCT="${2:?}"; shift 2 ;;
    --allumage) DPMS_ALLUMAGE="${2:?}"; shift 2 ;;
    --extinction) DPMS_EXTINCTION="${2:?}"; shift 2 ;;
    --force) FORCE=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Option inconnue : $1" >&2; usage >&2; exit 2 ;;
  esac
done

erreur() { echo "ERREUR : $*" >&2; exit 1; }

# Clavier réel si un terminal de contrôle est ouvrable, sinon entrée standard
# (le script reste utilisable depuis prepare-sd.sh ou un banc de test, au lieu
# d'échouer sur un « /dev/tty: No such device »).
if : 2>/dev/null </dev/tty; then TTY=/dev/tty; else TTY=/dev/stdin; fi

# Une valeur demandée au clavier si elle n'a pas été fournie en option.
demander() {
  local invite="$1" defaut="${2:-}" reponse=""
  if [ -n "$defaut" ]; then
    read -r -p "$invite [$defaut] : " reponse <"$TTY" || true
    echo "${reponse:-$defaut}"
  else
    read -r -p "$invite : " reponse <"$TTY" || true
    echo "$reponse"
  fi
}

# Un SECRET : saisie masquée, jamais réaffiché, jamais dans l'historique.
demander_secret() {
  local invite="$1" reponse=""
  read -r -s -p "$invite : " reponse <"$TTY" || true
  [ "$TTY" = "/dev/tty" ] && echo >/dev/tty || echo >&2
  echo "$reponse"
}

# ── Destination ──────────────────────────────────────────────────────────────
if [ "$INSTALL" -eq 1 ]; then
  [ "$(id -u)" -eq 0 ] || erreur "--install exige les droits root (sudo)."
  OUT="$INSTALL_PATH"
fi
OUT="${OUT:-badgeuse.conf}"
if [ -e "$OUT" ] && [ "$FORCE" -ne 1 ]; then
  erreur "$OUT existe déjà. Relancer avec --force pour l'écraser (l'ancienne configuration sera perdue)."
fi

echo "── Configuration d'un poste de pointage SOLIDATA ──"
echo "Les clés sont fournies par : Temps & Présence -> Supervision -> « Appairer un poste »."
echo

# ── Valeurs non secrètes ─────────────────────────────────────────────────────
[ -n "$URL" ] || URL="$(demander 'Adresse de SOLIDATA' "$DEFAULT_URL")"
case "$URL" in
  https://*) ;;
  *) erreur "l'adresse doit être en HTTPS (le poste refuse le HTTP en clair) : '$URL'" ;;
esac
URL="${URL%/}"

[ -n "$DEVICE_CODE" ] || DEVICE_CODE="$(demander 'Code du poste (ex. LH-P1)')"
[ -n "$DEVICE_CODE" ] || erreur "le code du poste est obligatoire."
case "$DEVICE_CODE" in
  *"|"*) erreur "le code du poste ne peut pas contenir le caractère '|' (séparateur de la chaîne d'intégrité)." ;;
esac

[ -n "$TARGET" ] || TARGET="$(demander 'Cible matérielle (pi5 = principal, pi3 = secours)' 'pi5')"
TARGET="$(printf '%s' "$TARGET" | tr '[:upper:]' '[:lower:]')"
[ "$TARGET" = "pi5" ] || [ "$TARGET" = "pi3" ] || erreur "cible inconnue : '$TARGET' (attendu : pi5 ou pi3)."

# ── Les deux secrets ─────────────────────────────────────────────────────────
DEVICE_KEY="${BADGEUSE_DEVICE_KEY:-}"
[ -n "$DEVICE_KEY" ] || DEVICE_KEY="$(demander_secret 'Clé du poste (X-Device-Key, saisie masquée)')"
case "$DEVICE_KEY" in
  CHANGE_ME*|A_REMPLACER*) erreur "clé du poste restée sur la valeur d'exemple." ;;
esac
[ "${#DEVICE_KEY}" -ge 32 ] || erreur "clé du poste trop courte (${#DEVICE_KEY} caractères, 32 minimum) — vérifiez le copier-coller."

HMAC_KEY="${BADGEUSE_HMAC_KEY:-}"
[ -n "$HMAC_KEY" ] || HMAC_KEY="$(demander_secret 'Clé HMAC du site (64 caractères hex, saisie masquée)')"
HMAC_KEY="$(printf '%s' "$HMAC_KEY" | tr '[:upper:]' '[:lower:]')"
case "$HMAC_KEY" in
  change_me*|a_remplacer*) erreur "clé HMAC restée sur la valeur d'exemple." ;;
esac
[ "${#HMAC_KEY}" -eq 64 ] || erreur "clé HMAC : 64 caractères attendus, ${#HMAC_KEY} reçu(s) — c'est la clé du SITE, pas celle du poste."
printf '%s' "$HMAC_KEY" | grep -qE '^[0-9a-f]{64}$' \
  || erreur "clé HMAC : caractères hexadécimaux uniquement (0-9, a-f)."

# ── Écriture, jamais lisible par autrui même une fraction de seconde ─────────
mkdir -p "$(dirname "$OUT")"
UMASK_PRECEDENT="$(umask)"
umask 077
cat > "$OUT" <<EOF
; Configuration du poste de pointage SOLIDATA — générée par make-conf.sh
; Fichier SECRET : permissions 0600, propriétaire badgeuse. Ne jamais versionner.
; Clés d'origine : Temps & Présence -> Supervision -> « Appairer un poste ».

[server]
url = $URL
device_code = $DEVICE_CODE
device_key = $DEVICE_KEY
;api_path = /api/badgeuse/device/v1
;verify_tls = true

[site]
hmac_key = $HMAC_KEY

[reader]
$([ -n "$READER_VENDOR" ] && echo "vendor_id = $READER_VENDOR" || echo ";vendor_id = 0xffff")
$([ -n "$READER_PRODUCT" ] && echo "product_id = $READER_PRODUCT" || echo ";product_id = 0x0035")
;name = rfid

[system]
data_dir = $DATA_DIR
target = $TARGET
;media_cache_max_mo = 500

[ui]
;ws_port = 8765
;http_port = 8766

[dpms]
allumage = $DPMS_ALLUMAGE
extinction = $DPMS_EXTINCTION
EOF
umask "$UMASK_PRECEDENT"

chmod 600 "$OUT"
if id -u badgeuse >/dev/null 2>&1 && [ "$(id -u)" -eq 0 ]; then
  chown badgeuse:badgeuse "$OUT"
  PROPRIETAIRE="badgeuse:badgeuse"
else
  PROPRIETAIRE="$(id -un):$(id -gn)"
fi

# ── Contrôle final : la configuration est-elle acceptée par l'agent ? ────────
VERIF="(non exécutée — python3 absent)"
if command -v python3 >/dev/null 2>&1; then
  RACINE_AGENT="$(cd "$(dirname "$0")/../agent" 2>/dev/null && pwd || true)"
  if [ -n "$RACINE_AGENT" ] && [ -d "$RACINE_AGENT/badgeuse_agent" ]; then
    if PYTHONPATH="$RACINE_AGENT" python3 -c "
import sys
from badgeuse_agent import config
try:
    c = config.load('$OUT')
except config.ConfigError as exc:
    print(f'REFUSEE : {exc}'); sys.exit(1)
print('acceptee par l agent (poste ' + c.device_code + ', cible ' + c.target + ')')
" 2>/dev/null; then
      VERIF="OK"
    else
      erreur "le fichier écrit est refusé par l'agent — corrigez les valeurs et relancez avec --force."
    fi
  fi
fi

echo
echo "✔ Configuration écrite : $OUT"
echo "  permissions 0600, propriétaire $PROPRIETAIRE"
echo "  poste $DEVICE_CODE, cible $TARGET, serveur $URL"
[ "$VERIF" = "OK" ] && echo "  contrôle de validité : OK"
echo
if [ "$INSTALL" -eq 1 ]; then
  echo "Étape suivante : sudo bash deploy/install.sh --target $TARGET --config $OUT"
else
  echo "Étape suivante : sudo bash deploy/install.sh --target $TARGET --config $(cd "$(dirname "$OUT")" && pwd)/$(basename "$OUT")"
fi
echo "Les clés ne sont plus affichées nulle part : ce fichier est désormais la seule copie sur le poste."
