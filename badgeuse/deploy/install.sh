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

# On n'INTERROGE PAS apt sur la disponibilite d'un paquet, on ESSAIE de
# l'installer : apt est la seule autorite, et son verdict tient dans un code de
# retour, pas dans un texte.
#
# L'ancienne sonde lisait `apt-cache policy | grep 'Candidate:'`. Or ce libelle
# est TRADUIT : sur un poste en francais apt ecrit « Candidat : », le motif
# anglais ne matche jamais, et TOUS les paquets sondes sont declares absents —
# silencieusement. C'est ainsi qu'un poste s'est retrouve installe sans
# navigateur NI compositeur (ecran noir), alors que les deux etaient disponibles
# dans l'archive. Aucune analyse de sortie localisee ne subsiste ici.
installer_paquet() {
  DEBIAN_FRONTEND=noninteractive LC_ALL=C \
    apt-get install -y --no-install-recommends "$@" >/dev/null 2>&1
}

if [ "$SANS_APT" -eq 1 ]; then
  info "installation des paquets ignoree (--no-apt)"
else
  export DEBIAN_FRONTEND=noninteractive
  info "mise a jour de l'index des paquets"
  apt-get update -qq

  # Socle indispensable : son echec est un echec d'installation, pas un repli.
  apt-get install -y --no-install-recommends \
    python3-venv python3-pip python3-evdev ca-certificates nftables

  # Navigateur : les distributions ne s'accordent pas sur le nom du paquet
  # (« chromium » sur Debian et Raspberry Pi OS recents, « chromium-browser »
  # sur les plus anciens). On tente dans l'ordre, le premier qui s'installe
  # gagne.
  NAVIGATEUR=""
  for candidat in chromium chromium-browser; do
    if installer_paquet "$candidat"; then NAVIGATEUR="$candidat"; break; fi
  done
  if [ -n "$NAVIGATEUR" ]; then
    info "navigateur installe : ${NAVIGATEUR}"
  else
    avert "AUCUN navigateur installable (ni chromium, ni chromium-browser)"
    avert "  l'ecran restera NOIR tant qu'un navigateur ne sera pas installe"
  fi

  # Compositeur : cage (Wayland) de preference, sinon repli X11.
  if installer_paquet cage; then
    COMPOSITEUR="cage"
    installer_paquet wlr-randr || avert "wlr-randr absent — extinction d'ecran degradee"
    info "compositeur installe : cage (Wayland)"
  else
    avert "paquet 'cage' non installable — repli X11 (openbox)"
    COMPOSITEUR="x11"
    apt-get install -y --no-install-recommends \
      xserver-xorg-core xserver-xorg-video-fbdev xinit openbox x11-xserver-utils
  fi
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

# `evdev` est une extension C : pip la COMPILE (il n'existe pas de roue toute
# faite pour aarch64), ce qui exige les en-tetes Python et un compilateur. Le
# paquet APT `python3-evdev` est deja compile pour la distribution : le venv le
# voit grace a --system-site-packages. On ne demande donc a pip QUE les
# dependances en Python pur, et on ne retombe sur la compilation que si APT n'a
# rien fourni (le pin de version de requirements.txt suffirait sinon a
# declencher une recompilation inutile, et donc un echec sans python3-dev).
DEPS_PURES=(httpx websockets)
if "${RACINE_INSTALL}/venv/bin/python" -c 'import evdev' >/dev/null 2>&1; then
  info "evdev fourni par le paquet systeme (aucune compilation)"
  A_INSTALLER=("${DEPS_PURES[@]}")
else
  avert "python3-evdev absent : compilation necessaire, installation des en-tetes"
  if [ "$SANS_APT" -ne 1 ]; then
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      python3-dev build-essential >/dev/null 2>&1 \
      || avert "en-tetes Python indisponibles — la compilation d'evdev va echouer"
  fi
  A_INSTALLER=(-r "${RACINE_INSTALL}/agent/requirements.txt")
fi

if "${RACINE_INSTALL}/venv/bin/pip" install --quiet "${A_INSTALLER[@]}"; then
  info "dependances installees"
else
  avert "installation des dependances en echec — verifier l'acces reseau puis"
  avert "  relancer : ${RACINE_INSTALL}/venv/bin/pip install ${A_INSTALLER[*]}"
fi

"${RACINE_INSTALL}/venv/bin/python" - <<'PY' || avert "verification des imports en echec"
# `import importlib` seul ne charge PAS le sous-module `util` : depuis
# Python 3.12/3.13 l'acces `importlib.util` leve alors AttributeError.
import importlib.util
import sys
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

# Cache des medias de l'ecran de veille (CDC_AFFICHAGE_V2 §2). L'agent le cree
# aussi au demarrage ; on le pose ici pour qu'il porte les bons droits des la
# premiere installation, y compris quand le rootfs passe en lecture seule.
# Son plafond est pilote par le SERVEUR (onglet Affichage) ; le fichier local
# ne porte qu'un garde-fou facultatif (cf. badgeuse.conf.example).
install -d -m 0750 -o "$UTILISATEUR" -g "$UTILISATEUR" "${REPERTOIRE_DONNEES}/media"
info "cache media : ${REPERTOIRE_DONNEES}/media"

etape "6bis/9 Validation de la configuration"
# PYTHONPATH : le paquet `badgeuse_agent` vit dans agent/, pas dans le venv —
# exactement comme dans l'unite systemd (Environment=PYTHONPATH=...). Sans lui,
# la validation echouait sur « No module named badgeuse_agent » et bloquait une
# installation par ailleurs saine.
if BADGEUSE_CONFIG="$CIBLE_CONFIG" PYTHONPATH="${RACINE_INSTALL}/agent" \
     "${RACINE_INSTALL}/venv/bin/python" \
     -m badgeuse_agent --check --config "$CIBLE_CONFIG"; then
  info "configuration valide"
else
  echo "ERREUR : configuration refusee par l'agent (voir le message ci-dessus)." >&2
  echo "         Les services ne seront pas demarres." >&2
  exit 1
fi

# ------------------------------------------------------------- 7. kiosque
etape "7/9 Options d'affichage (${CIBLE})"

# Politique Chromium GEREE (QA-07) : verrouille les DevTools de facon non
# contournable par un flag de ligne de commande ou un clavier branche sur le
# poste. Les deux chemins possibles selon le paquet installe (chromium vs
# chromium-browser) sont renseignes : celui qui ne correspond pas au
# navigateur present est simplement ignore par Chromium.
for repertoire_politique in /etc/chromium/policies/managed /etc/chromium-browser/policies/managed; do
  install -d -m 0755 "$repertoire_politique"
  install -m 0644 "${SOURCE}/deploy/chromium-policy.json" "${repertoire_politique}/badgeuse.json"
done
info "politique Chromium geree installee (DevTools verrouilles, cf. README §7)"

BASE_FLAGS="--kiosk --noerrdialogs --disable-translate --disable-features=Translate,TranslateUI"
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

# Chien de garde MATERIEL (QA-09). Le WatchdogSec=90 de badgeuse-agent.service
# ne surveille QUE ce service (sd_notify) : un gel du noyau ou de PID1
# lui-meme n'est pas couvert. RuntimeWatchdogSec pilote le chien de garde
# materiel de la puce (bcm2835_wdt) via systemd : si PID1 gele a son tour,
# c'est le materiel qui redemarre le Pi. Idempotent (fichier reecrit a
# l'identique a chaque passage).
install -d -m 0755 /etc/systemd/system.conf.d
cat > /etc/systemd/system.conf.d/badgeuse-watchdog.conf <<'FIN'
# Genere par install.sh — watchdog MATERIEL (bcm2835_wdt). Complementaire
# du WatchdogSec= de badgeuse-agent.service : celui-ci ne surveille que le
# service applicatif, celui-la couvre un gel du systeme tout entier
# (y compris PID1). Voir README.md §7 (PST-09).
[Manager]
RuntimeWatchdogSec=15s
FIN
info "watchdog materiel configure : /etc/systemd/system.conf.d/badgeuse-watchdog.conf"

# Commande de lancement du kiosque. Elle ne peut PAS etre codee en dur dans
# l'unite : le chemin du navigateur varie d'une distribution a l'autre
# (/usr/bin/chromium sur Raspberry Pi OS Bookworm et Trixie,
# /usr/bin/chromium-browser ailleurs) et install.sh sait deja installer l'un ou
# l'autre. Un chemin faux fait echouer l'unite en 203/EXEC : cage demarre, son
# client jamais — l'ecran reste NOIR sans message a l'ecran. On resout donc le
# binaire ici, et on ecrit la commande complete dans un drop-in unique qui
# couvre les deux compositeurs (un seul fichier pose ExecStart, pas deux qui se
# marchent dessus).
install -d -m 0755 /etc/systemd/system/badgeuse-kiosk.service.d
rm -f /etc/systemd/system/badgeuse-kiosk.service.d/x11.conf   # ancien nom

NAVIGATEUR_BIN=""
for candidat in /usr/bin/chromium /usr/bin/chromium-browser; do
  if [ -x "$candidat" ]; then NAVIGATEUR_BIN="$candidat"; break; fi
done
SANS_NAVIGATEUR=0
if [ -z "$NAVIGATEUR_BIN" ]; then
  SANS_NAVIGATEUR=1
  # Aucun navigateur : on l'ecrit quand meme pour que l'unite echoue avec un
  # message explicite plutot que sur un ecran noir muet.
  NAVIGATEUR_BIN="/usr/bin/chromium"
  avert "aucun navigateur trouve (/usr/bin/chromium ni /usr/bin/chromium-browser)"
  avert "  l'ecran restera NOIR — installer : sudo apt-get install -y chromium"
else
  info "navigateur retenu : ${NAVIGATEUR_BIN}"
fi

if [ "$COMPOSITEUR" = "x11" ]; then
  cat > /etc/systemd/system/badgeuse-kiosk.service.d/lancement.conf <<FIN
# Genere par install.sh — repli X11 (paquet cage indisponible).
[Service]
Environment=XDG_SESSION_TYPE=x11
ExecStart=
ExecStart=/usr/bin/xinit ${NAVIGATEUR_BIN} \$CHROMIUM_FLAGS http://127.0.0.1:8766 -- :0 vt1 -nolisten tcp
FIN
  info "repli X11 configure"
else
  cat > /etc/systemd/system/badgeuse-kiosk.service.d/lancement.conf <<FIN
# Genere par install.sh — compositeur cage (Wayland), navigateur resolu a
# l'installation.
[Service]
ExecStart=
ExecStart=/usr/bin/cage -- ${NAVIGATEUR_BIN} \$CHROMIUM_FLAGS http://127.0.0.1:8766
FIN
fi

# La console tty1 doit revenir au KIOSQUE. badgeuse-kiosk.service reclame
# /dev/tty1 avec StandardInput=tty-fail : systemd REFUSE de demarrer le service
# si la console est deja prise. Or Raspberry Pi OS y lance getty@tty1, qui
# affiche l'invite de connexion. Sans cette liberation, le kiosque echouait a
# chaque tentative et le poste restait indefiniment sur l'ecran de login
# (avec Restart=always, une boucle de redemarrage toutes les 5 s).
# On desactive getty@tty1 plutot que de le forcer : le conflit doit disparaitre,
# pas etre arbitre a chaque demarrage. Reversible : systemctl enable --now
# getty@tty1.service redonne la console locale (voir RUNBOOK, depannage).
if systemctl cat getty@tty1.service >/dev/null 2>&1; then
  if systemctl disable --now getty@tty1.service >/dev/null 2>&1; then
    info "console tty1 liberee pour le kiosque (getty@tty1 desactive)"
  else
    avert "getty@tty1 non desactive — le kiosque restera sur l'invite de connexion"
  fi
fi

systemctl daemon-reload
# daemon-reload ne relit que les unites : le watchdog materiel (RuntimeWatchdogSec,
# option [Manager] de system.conf.d) exige que PID1 se re-execute pour en tenir
# compte immediatement. Best-effort : sans cela, actif au prochain redemarrage.
systemctl daemon-reexec 2>/dev/null \
  || avert "daemon-reexec impossible — watchdog materiel actif au prochain redemarrage"
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

# Panne la plus courante du kiosque : la console tty1 lui est refusee. Le
# symptome vu par l'exploitant est un ecran bloque sur l'invite de connexion,
# sans rapport apparent avec le kiosque — on nomme donc la cause explicitement.
if ! systemctl is-active --quiet badgeuse-kiosk; then
  avert "le kiosque ne tourne pas — l'ecran restera sur l'invite de connexion"
  if systemctl is-active --quiet getty@tty1.service; then
    avert "  cause probable : getty@tty1 occupe la console"
    avert "  correction    : sudo systemctl disable --now getty@tty1.service"
    avert "                  sudo systemctl restart badgeuse-kiosk"
  else
    avert "  diagnostic : journalctl -u badgeuse-kiosk -n 50"
  fi
fi

ETAPE_NVME=""
if [ "$CIBLE" = "pi5" ]; then
  ETAPE_NVME="   2. Demarrage NVMe    sudo bash ${RACINE_INSTALL}/deploy/eeprom-nvme.sh   (puis redemarrer)"
fi

# Un poste sans navigateur ne peut RIEN afficher. L'installation se termine
# quand meme (l'agent, lui, enregistre deja les badgeages), mais le defaut est
# annonce en tete du resume, pas noye dans les avertissements : c'est
# exactement ce qui a produit un ecran noir sans explication.
if [ "$SANS_NAVIGATEUR" -eq 1 ]; then
  cat <<'FINAV'

  ####################################################################
  #  INSTALLATION INCOMPLETE — AUCUN NAVIGATEUR SUR CE POSTE         #
  #                                                                  #
  #  L'agent fonctionne et enregistre les badgeages, mais L'ECRAN    #
  #  RESTERA NOIR : il n'y a rien pour afficher l'interface.         #
  #                                                                  #
  #  Corriger, puis relancer cette installation :                    #
  #    sudo apt-get update                                           #
  #    sudo apt-get install -y chromium || \                         #
  #      sudo apt-get install -y chromium-browser                    #
  ####################################################################

FINAV
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

  Si l'ecran n'affiche pas l'interface (noir, ou invite de connexion) :
    sudo bash ${RACINE_INSTALL}/deploy/diagnostic.sh
  Ce diagnostic ne modifie rien : il nomme la cause et donne la correction.

  Verifications utiles :
    systemctl status badgeuse-agent
    journalctl -u badgeuse-agent -f
    sudo -u ${UTILISATEUR} ${RACINE_INSTALL}/venv/bin/python -m badgeuse_agent --check

  Rappel : l'agent fonctionne SANS reseau et SANS serveur. Une file qui
  grossit hors ligne est un fonctionnement normal, pas une panne.

FIN
