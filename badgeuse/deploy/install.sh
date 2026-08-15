#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# Installation du poste de pointage SOLIDATA — une seule commande.
#
#   sudo bash deploy/install.sh --target pi5 --config /chemin/badgeuse.conf
#
# Proprietes :
#   - IDEMPOTENT : relancable autant de fois que necessaire (mise a jour du
#     code comprise) sans rien casser ni dupliquer ;
#   - JOURNALISE : tout est trace dans /var/log/badgeuse-install.log ;
#   - LE MEME CODE tourne sur Pi 5 et Pi 3 B+. Seule l'installation diverge
#     (paquets, options Chromium, empreinte memoire) — jamais l'applicatif.
#
# Ce script ne touche ni a l'EEPROM, ni au pare-feu, ni au rootfs en lecture
# seule : ces trois operations sont explicites et separees (voir le resume
# final).
# -----------------------------------------------------------------------------
set -euo pipefail

CIBLE=""
CONFIG_SOURCE=""
SANS_APT=0

RACINE_INSTALL="/opt/badgeuse"
REPERTOIRE_CONFIG="/etc/badgeuse"
REPERTOIRE_DONNEES="/var/lib/badgeuse"
UTILISATEUR="badgeuse"
JOURNAL="/var/log/badgeuse-install.log"

SOURCE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  cat <<'FIN'
Usage : sudo bash deploy/install.sh --target pi5|pi3 --config <fichier.conf>

  --target pi5|pi3   cible materielle (obligatoire)
  --config <chemin>  fichier de configuration a installer en 0600
                     (obligatoire au premier passage ; ensuite facultatif,
                      la configuration deja en place est conservee)
  --no-apt           ne pas installer de paquets (poste deja prepare)
  -h, --help         cette aide
FIN
}

while [ $# -gt 0 ]; do
  case "$1" in
    --target) CIBLE="${2:-}"; shift 2 ;;
    --config) CONFIG_SOURCE="${2:-}"; shift 2 ;;
    --no-apt) SANS_APT=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "option inconnue : $1" >&2; usage; exit 2 ;;
  esac
done

[ "$(id -u)" -eq 0 ] || { echo "A executer en root (sudo)." >&2; exit 1; }

case "$CIBLE" in
  pi5|pi3) ;;
  *) echo "ERREUR : --target pi5 ou --target pi3 est obligatoire." >&2; usage; exit 2 ;;
esac

touch "$JOURNAL"
chmod 0640 "$JOURNAL"
exec > >(tee -a "$JOURNAL") 2>&1

etape() { printf '\n=== %s\n' "$*"; }
info()  { printf '    %s\n' "$*"; }
avert() { printf '  ! %s\n' "$*"; }

printf '\n############################################################\n'
printf '# Installation badgeuse SOLIDATA — %s\n' "$(date '+%Y-%m-%d %H:%M:%S')"
printf '# cible : %s   source : %s\n' "$CIBLE" "$SOURCE"
printf '############################################################\n'

# --------------------------------------------------------------- 1. materiel
etape "1/9 Verification de la machine"
MODELE="$(tr -d '\0' < /proc/device-tree/model 2>/dev/null || echo inconnu)"
info "modele detecte : ${MODELE}"

case "$CIBLE" in
  pi5) printf '%s' "$MODELE" | grep -qi 'Raspberry Pi 5' \
         || avert "cible pi5 demandee mais la machine ne s'annonce pas comme un Pi 5" ;;
  pi3) printf '%s' "$MODELE" | grep -qi 'Raspberry Pi 3' \
         || avert "cible pi3 demandee mais la machine ne s'annonce pas comme un Pi 3" ;;
esac

if ! python3 -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 9) else 1)'; then
  echo "ERREUR : Python 3.9+ requis." >&2
  exit 1
fi
info "python : $(python3 --version)"

# ---------------------------------------------------------------- 2. paquets
etape "2/9 Paquets systeme"

paquet_disponible() { apt-cache policy "$1" 2>/dev/null | grep -q 'Candidate: [^(]'; }

if [ "$SANS_APT" -eq 1 ]; then
  info "installation des paquets ignoree (--no-apt)"
else
  # L'index doit etre a jour AVANT toute interrogation de disponibilite,
  # sinon apt-cache repond « aucun candidat » sur une machine fraiche.
  export DEBIAN_FRONTEND=noninteractive
  info "mise a jour de l'index des paquets"
  apt-get update -qq

  PAQUETS=(python3-venv python3-pip python3-evdev ca-certificates nftables)

  NAVIGATEUR=""
  for candidat in chromium chromium-browser; do
    if paquet_disponible "$candidat"; then NAVIGATEUR="$candidat"; break; fi
  done
  [ -n "$NAVIGATEUR" ] && PAQUETS+=("$NAVIGATEUR") \
    || avert "aucun paquet chromium trouve — l'affichage devra etre installe a la main"

  COMPOSITEUR=""
  if paquet_disponible cage; then
    COMPOSITEUR="cage"
    PAQUETS+=(cage wlr-randr)
  else
    avert "paquet 'cage' indisponible — repli X11 (openbox)"
    COMPOSITEUR="x11"
    PAQUETS+=(xserver-xorg-core xserver-xorg-video-fbdev xinit openbox x11-xserver-utils)
  fi

  info "installation : ${PAQUETS[*]}"
  apt-get install -y --no-install-recommends "${PAQUETS[@]}"
fi

command -v cage >/dev/null 2>&1 && COMPOSITEUR="cage" || COMPOSITEUR="${COMPOSITEUR:-x11}"
info "compositeur retenu : ${COMPOSITEUR}"

# ------------------------------------------------------------ 3. utilisateur
etape "3/9 Utilisateur systeme non privilegie"
if id -u "$UTILISATEUR" >/dev/null 2>&1; then
  info "utilisateur ${UTILISATEUR} deja present"
else
  useradd --system --create-home --home-dir "/home/${UTILISATEUR}" \
          --shell /usr/sbin/nologin "$UTILISATEUR"
  info "utilisateur ${UTILISATEUR} cree (sans shell de connexion)"
fi

for groupe in input video render tty; do
  if getent group "$groupe" >/dev/null 2>&1; then
    usermod -aG "$groupe" "$UTILISATEUR"
  fi
done
info "groupes : $(id -nG "$UTILISATEUR")"

# ------------------------------------------------------------------ 4. code
etape "4/9 Deploiement du code"
install -d -m 0755 "$RACINE_INSTALL"

deployer() {
  local origine="$1" destination="$2"
  [ -e "$origine" ] || { avert "absent, ignore : ${origine}"; return 0; }
  rm -rf "${destination}.ancien"
  [ -e "$destination" ] && mv "$destination" "${destination}.ancien"
  cp -a "$origine" "$destination"
  rm -rf "${destination}.ancien"
  info "installe : ${destination}"
}

deployer "${SOURCE}/agent"  "${RACINE_INSTALL}/agent"
deployer "${SOURCE}/ui"     "${RACINE_INSTALL}/ui"
deployer "${SOURCE}/deploy" "${RACINE_INSTALL}/deploy"
[ -f "${SOURCE}/README.md" ] && cp -a "${SOURCE}/README.md" "${RACINE_INSTALL}/README.md"

find "${RACINE_INSTALL}" -name '__pycache__' -type d -prune -exec rm -rf {} + 2>/dev/null || true
chmod +x "${RACINE_INSTALL}"/deploy/*.sh 2>/dev/null || true
chown -R root:root "$RACINE_INSTALL"
chmod -R go-w "$RACINE_INSTALL"

# ------------------------------------------------------- 5. environnement py
etape "5/9 Environnement Python"
if [ ! -x "${RACINE_INSTALL}/venv/bin/python" ]; then
  # --system-site-packages : python3-evdev vient d'APT (pas de compilation).
  python3 -m venv --system-site-packages "${RACINE_INSTALL}/venv"
  info "environnement virtuel cree"
else
  info "environnement virtuel deja present"
fi

"${RACINE_INSTALL}/venv/bin/pip" install --quiet --upgrade pip >/dev/null 2>&1 || \
  avert "mise a jour de pip impossible (poste hors ligne ?) — sans gravite"

if "${RACINE_INSTALL}/venv/bin/pip" install --quiet \
     -r "${RACINE_INSTALL}/agent/requirements.txt"; then
  info "dependances installees"
else
  avert "installation des dependances en echec — verifier l'acces reseau puis"
  avert "  relancer : ${RACINE_INSTALL}/venv/bin/pip install -r ${RACINE_INSTALL}/agent/requirements.txt"
fi

"${RACINE_INSTALL}/venv/bin/python" - <<'PY' || avert "verification des imports en echec"
import importlib, sys
manquants = [m for m in ("evdev", "httpx", "websockets")
             if importlib.util.find_spec(m) is None]
print("    modules manquants :", ", ".join(manquants) if manquants else "aucun")
sys.exit(1 if manquants else 0)
PY

# ------------------------------------------------------------ 6. config/data
etape "6/9 Configuration et donnees"
install -d -m 0750 -o root -g "$UTILISATEUR" "$REPERTOIRE_CONFIG"

CIBLE_CONFIG="${REPERTOIRE_CONFIG}/badgeuse.conf"
if [ -n "$CONFIG_SOURCE" ]; then
  [ -f "$CONFIG_SOURCE" ] || { echo "ERREUR : ${CONFIG_SOURCE} introuvable." >&2; exit 1; }
  if [ -f "$CIBLE_CONFIG" ] && ! cmp -s "$CONFIG_SOURCE" "$CIBLE_CONFIG"; then
    cp -a "$CIBLE_CONFIG" "${CIBLE_CONFIG}.$(date +%Y%m%d%H%M%S).bak"
    info "configuration precedente sauvegardee"
  fi
  install -m 0600 -o "$UTILISATEUR" -g "$UTILISATEUR" "$CONFIG_SOURCE" "$CIBLE_CONFIG"
  info "configuration installee : ${CIBLE_CONFIG} (0600)"
elif [ -f "$CIBLE_CONFIG" ]; then
  chown "$UTILISATEUR":"$UTILISATEUR" "$CIBLE_CONFIG"
  chmod 0600 "$CIBLE_CONFIG"
  info "configuration existante conservee"
else
  echo "ERREUR : aucune configuration. Fournir --config <fichier>." >&2
  echo "         Modele : ${SOURCE}/deploy/badgeuse.conf.example" >&2
  exit 1
fi

# Le repertoire de donnees n'est cree que s'il n'est pas deja un point de
# montage (partition dediee, cf. overlayfs-setup.sh).
if ! findmnt -n "$REPERTOIRE_DONNEES" >/dev/null 2>&1; then
  install -d -m 0750 -o "$UTILISATEUR" -g "$UTILISATEUR" "$REPERTOIRE_DONNEES"
else
  chown "$UTILISATEUR":"$UTILISATEUR" "$REPERTOIRE_DONNEES"
  info "donnees sur partition dediee : $(findmnt -n -o SOURCE "$REPERTOIRE_DONNEES")"
fi
info "donnees : ${REPERTOIRE_DONNEES}"

etape "6bis/9 Validation de la configuration"
if BADGEUSE_CONFIG="$CIBLE_CONFIG" "${RACINE_INSTALL}/venv/bin/python" \
     -m badgeuse_agent --check --config "$CIBLE_CONFIG"; then
  info "configuration valide"
else
  echo "ERREUR : configuration refusee par l'agent (voir le message ci-dessus)." >&2
  echo "         Les services ne seront pas demarres." >&2
  exit 1
fi

# ------------------------------------------------------------- 7. kiosque
etape "7/9 Options d'affichage (${CIBLE})"

BASE_FLAGS="--kiosk --noerrdialogs --disable-translate --disable-features=Translate"
BASE_FLAGS="${BASE_FLAGS} --disable-session-crashed-bubble --disable-infobars"
BASE_FLAGS="${BASE_FLAGS} --no-first-run --disable-pinch --overscroll-history-navigation=0"
BASE_FLAGS="${BASE_FLAGS} --check-for-update-interval=31536000"
# Les retours sonores (AFF-04) sont synthetises par la page : sans cette
# option, Chromium bloque l'audio faute de geste utilisateur — or il n'y a,
# par conception, aucune interaction possible sur ce poste.
BASE_FLAGS="${BASE_FLAGS} --autoplay-policy=no-user-gesture-required"

if [ "$COMPOSITEUR" = "cage" ]; then
  BASE_FLAGS="${BASE_FLAGS} --ozone-platform=wayland --enable-features=UseOzonePlatform"
fi

if [ "$CIBLE" = "pi3" ]; then
  # 1 Go de RAM : on bride le rendu, on garde un seul processus de rendu.
  CIBLE_FLAGS="--disable-gpu-compositing --disable-dev-shm-usage --process-per-site"
  CIBLE_FLAGS="${CIBLE_FLAGS} --renderer-process-limit=1 --js-flags=--max-old-space-size=96"
  MEMOIRE_AGENT="128M"
else
  CIBLE_FLAGS="--enable-gpu-rasterization"
  MEMOIRE_AGENT="256M"
fi

cat > "${REPERTOIRE_CONFIG}/kiosk.env" <<FIN
# Genere par install.sh — cible ${CIBLE}. Ne pas editer a la main.
CHROMIUM_FLAGS=${BASE_FLAGS} ${CIBLE_FLAGS}
FIN
chmod 0644 "${REPERTOIRE_CONFIG}/kiosk.env"
info "options Chromium ecrites dans ${REPERTOIRE_CONFIG}/kiosk.env"

# ------------------------------------------------------------- 8. services
etape "8/9 Services systemd"
for unite in badgeuse-agent.service badgeuse-kiosk.service \
             badgeuse-dpms.service badgeuse-dpms.timer; do
  if [ -f "${SOURCE}/deploy/systemd/${unite}" ]; then
    install -m 0644 "${SOURCE}/deploy/systemd/${unite}" "/etc/systemd/system/${unite}"
    info "unite installee : ${unite}"
  fi
done

# Empreinte memoire propre a la cible : hors du fichier d'unite, qui reste
# identique sur les deux machines.
install -d -m 0755 /etc/systemd/system/badgeuse-agent.service.d
cat > /etc/systemd/system/badgeuse-agent.service.d/cible.conf <<FIN
# Genere par install.sh — cible ${CIBLE}.
[Service]
MemoryMax=${MEMOIRE_AGENT}
FIN

# Repli X11 : cage indisponible, on remplace la commande de lancement.
install -d -m 0755 /etc/systemd/system/badgeuse-kiosk.service.d
if [ "$COMPOSITEUR" = "x11" ]; then
  cat > /etc/systemd/system/badgeuse-kiosk.service.d/x11.conf <<'FIN'
# Genere par install.sh — repli X11 (paquet cage indisponible).
[Service]
Environment=XDG_SESSION_TYPE=x11
ExecStart=
ExecStart=/usr/bin/xinit /usr/bin/chromium $CHROMIUM_FLAGS http://127.0.0.1:8766 -- :0 vt1 -nolisten tcp
FIN
  info "repli X11 configure"
else
  rm -f /etc/systemd/system/badgeuse-kiosk.service.d/x11.conf
fi

systemctl daemon-reload
systemctl enable badgeuse-agent.service >/dev/null
systemctl enable badgeuse-kiosk.service >/dev/null
systemctl enable badgeuse-dpms.timer >/dev/null 2>&1 || true

systemctl restart badgeuse-agent.service
sleep 3
systemctl restart badgeuse-kiosk.service || avert "le kiosque n'a pas demarre — voir : journalctl -u badgeuse-kiosk"
systemctl start badgeuse-dpms.timer >/dev/null 2>&1 || true

# --------------------------------------------------------------- 9. controle
etape "9/9 Controle"
for service in badgeuse-agent badgeuse-kiosk; do
  printf '    %-18s %s\n' "$service" "$(systemctl is-active "$service" 2>/dev/null || echo inactif)"
done

if systemctl is-active --quiet badgeuse-agent; then
  info "derniers journaux de l'agent :"
  journalctl -u badgeuse-agent -n 8 --no-pager | sed 's/^/      /'
else
  avert "l'agent ne tourne pas — diagnostic : journalctl -u badgeuse-agent -n 50"
fi

ETAPE_NVME=""
if [ "$CIBLE" = "pi5" ]; then
  ETAPE_NVME="   2. Demarrage NVMe    sudo bash ${RACINE_INSTALL}/deploy/eeprom-nvme.sh   (puis redemarrer)"
fi

cat <<FIN

############################################################
# Installation terminee — cible ${CIBLE}
############################################################

  Code         ${RACINE_INSTALL}
  Configuration ${CIBLE_CONFIG}  (0600 ${UTILISATEUR}:${UTILISATEUR})
  Donnees      ${REPERTOIRE_DONNEES}
  Interface    http://127.0.0.1:8766   (locale uniquement)
  Journal      ${JOURNAL}

  Services : badgeuse-agent, badgeuse-kiosk, badgeuse-dpms.timer

  RESTE A FAIRE, explicitement, dans cet ordre :

   1. Pare-feu          sudo RESEAU_ADMIN=192.168.x.0/24 bash ${RACINE_INSTALL}/deploy/firewall.sh
${ETAPE_NVME}
   3. Partition donnees sudo bash ${RACINE_INSTALL}/deploy/overlayfs-setup.sh --data-only
   4. Rootfs en lecture seule
                        sudo bash ${RACINE_INSTALL}/deploy/overlayfs-setup.sh   (puis redemarrer)

  Verifications utiles :
    systemctl status badgeuse-agent
    journalctl -u badgeuse-agent -f
    sudo -u ${UTILISATEUR} ${RACINE_INSTALL}/venv/bin/python -m badgeuse_agent --check

  Rappel : l'agent fonctionne SANS reseau et SANS serveur. Une file qui
  grossit hors ligne est un fonctionnement normal, pas une panne.

FIN
