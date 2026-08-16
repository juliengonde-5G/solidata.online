#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# Poste de pointage SOLIDATA — INSTALLATION EN UNE COMMANDE, carte SD.
#
#   sudo bash /boot/firmware/badgeuse/deploy/sd-init.sh
#
# C'est le SEUL geste à faire sur le Raspberry. Le script :
#   1. reconnaît la machine (Raspberry Pi 5 = poste standard, Pi 3 = secours) ;
#   2. choisit tout seul la configuration correspondante, préparée sur le PC et
#      déposée sur la partition visible de la carte SD ;
#   3. installe le système complet (paquets, service, écran kiosque, pare-feu) ;
#   4. affiche un compte rendu lisible.
#
# Aucune question n'est posée, aucun identifiant n'est demandé : le code et les
# deux configurations voyagent sur la carte SD elle-même. Une SEULE carte peut
# donc servir à préparer les DEUX postes — la machine reconnaît la sienne.
#
# Cible : carte SD uniquement (pas de SSD NVMe, pas de réglage d'EEPROM).
# Idempotent : relançable autant de fois que nécessaire.
# -----------------------------------------------------------------------------
set -euo pipefail

JOURNAL="/var/log/badgeuse-init.log"
RESEAU_ADMIN="${RESEAU_ADMIN:-}"      # ex. RESEAU_ADMIN=192.168.1.0/24 → pare-feu
SANS_PARE_FEU="${SANS_PARE_FEU:-0}"
SOURCE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

titre() { printf '\n\033[1m=== %s\033[0m\n' "$*"; }
info()  { printf '    %s\n' "$*"; }
souci() { printf '    /!\\ %s\n' "$*" >&2; }
mourir() { printf '\n[ERREUR] %s\n\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || mourir "à lancer avec sudo : sudo bash $0"

exec > >(tee -a "$JOURNAL") 2>&1
printf '\n########## %s ##########\n' "$(date '+%Y-%m-%d %H:%M:%S')"

# ── 1. Quelle machine ? ──────────────────────────────────────────────────────
titre "1/5  Reconnaissance de la machine"
MODELE="$(tr -d '\0' < /proc/device-tree/model 2>/dev/null || echo inconnu)"
info "modèle : ${MODELE}"

case "$MODELE" in
  *"Raspberry Pi 5"*) CIBLE="pi5"; ROLE="poste STANDARD" ;;
  *"Raspberry Pi 3"*) CIBLE="pi3"; ROLE="poste de SECOURS" ;;
  *"Raspberry Pi 4"*)
    CIBLE="pi5"; ROLE="poste standard (Pi 4 traité comme un Pi 5)"
    souci "Raspberry Pi 4 : configuration « standard » appliquée." ;;
  *)
    mourir "machine non reconnue (${MODELE}). Ce script attend un Raspberry Pi 5, 4 ou 3." ;;
esac
info "rôle retenu : ${ROLE}  →  configuration « ${CIBLE} »"

# ── 2. Où sont le code et les configurations ? ───────────────────────────────
titre "2/5  Configuration du poste"

# La partition visible depuis Windows/macOS s'appelle /boot/firmware sur les
# versions récentes de Raspberry Pi OS, /boot sur les plus anciennes.
CANDIDATS_BOOT="/boot/firmware /boot"
CONFIG=""
for base in $CANDIDATS_BOOT $SOURCE $SOURCE/deploy; do
  for nom in "badgeuse-${CIBLE}.conf" "badgeuse.conf"; do
    if [ -z "$CONFIG" ] && [ -f "${base}/${nom}" ]; then
      CONFIG="${base}/${nom}"
    fi
  done
done

if [ -z "$CONFIG" ]; then
  mourir "aucune configuration trouvée pour ce poste.
    Attendu, sur la partition visible de la carte SD :
      badgeuse-${CIBLE}.conf
    Préparez-la sur le PC avec :
      bash badgeuse/deploy/make-conf.sh -o badgeuse-${CIBLE}.conf --target ${CIBLE} --code <CODE_DU_POSTE>
    puis copiez-la à la racine de la partition « bootfs » de la carte."
fi
info "configuration retenue : ${CONFIG}"

# Contrôle de cohérence : la configuration doit viser CETTE machine.
CIBLE_FICHIER="$(sed -n 's/^[[:space:]]*target[[:space:]]*=[[:space:]]*//p' "$CONFIG" | tail -n1 | tr -d '[:space:]')"
if [ -n "$CIBLE_FICHIER" ] && [ "$CIBLE_FICHIER" != "$CIBLE" ]; then
  mourir "cette machine est un ${CIBLE}, mais ${CONFIG} annonce target = ${CIBLE_FICHIER}.
    Vérifiez que vous n'avez pas interverti les deux fichiers de configuration."
fi
CODE_POSTE="$(sed -n 's/^[[:space:]]*device_code[[:space:]]*=[[:space:]]*//p' "$CONFIG" | tail -n1 | tr -d '[:space:]')"
info "poste déclaré : ${CODE_POSTE:-<non lu>}"

# ── 3. Installation ──────────────────────────────────────────────────────────
titre "3/5  Installation (quelques minutes, ne rien débrancher)"
[ -f "${SOURCE}/deploy/install.sh" ] \
  || mourir "code du poste introuvable : ${SOURCE}/deploy/install.sh manquant.
    Copiez le dossier « badgeuse » entier sur la partition visible de la carte SD."

bash "${SOURCE}/deploy/install.sh" --target "$CIBLE" --config "$CONFIG"

# ── 4. Pare-feu ──────────────────────────────────────────────────────────────
titre "4/5  Pare-feu"
if [ "$SANS_PARE_FEU" = "1" ]; then
  info "ignoré (SANS_PARE_FEU=1)"
elif [ -z "$RESEAU_ADMIN" ]; then
  souci "non appliqué : le réseau d'administration n'est pas connu."
  info "Le poste fonctionne, mais SSH reste ouvert à tout le réseau local."
  info "Pour le fermer plus tard :"
  info "  sudo RESEAU_ADMIN=192.168.1.0/24 bash /opt/badgeuse/deploy/firewall.sh"
else
  RESEAU_ADMIN="$RESEAU_ADMIN" bash "${SOURCE}/deploy/firewall.sh" \
    || souci "le pare-feu n'a pas pu être appliqué — le poste fonctionne quand même."
fi

# ── 5. Contrôle final ────────────────────────────────────────────────────────
titre "5/5  Contrôle"
ETAT_AGENT="$(systemctl is-active badgeuse-agent 2>/dev/null || echo inactif)"
ETAT_KIOSQUE="$(systemctl is-active badgeuse-kiosk 2>/dev/null || echo inactif)"
info "service badgeuse-agent  : ${ETAT_AGENT}"
info "service badgeuse-kiosk  : ${ETAT_KIOSQUE}"

IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
ALIM="$(vcgencmd get_throttled 2>/dev/null | sed 's/throttled=//' || echo '?')"
[ "$ALIM" = "0x0" ] || [ "$ALIM" = "?" ] \
  || souci "alimentation ou température : vcgencmd get_throttled = ${ALIM} (bloc 5 V/5 A officiel requis sur Pi 5)"

cat <<FIN

############################################################
#  Poste ${CODE_POSTE:-?} — ${ROLE}
############################################################

  Machine        ${MODELE}
  Configuration  /etc/badgeuse/badgeuse.conf  (0600)
  Adresse IP     ${IP:-<réseau non détecté>}
  Journal        ${JOURNAL}

  Agent : ${ETAT_AGENT}      Écran : ${ETAT_KIOSQUE}

  À FAIRE MAINTENANT, dans SOLIDATA :

   1. Temps & Présence -> Supervision : le poste ${CODE_POSTE:-?} doit
      apparaître EN LIGNE dans la minute qui vient.
   2. Présentez un badge : l'écran affiche un refus (normal, aucun badge
      n'est encore enrôlé) et le badge apparaît dans
      Journal -> Pointages orphelins, avec son empreinte à copier.
   3. Badges -> « + Attribuer un badge » : collez l'empreinte, choisissez
      le salarié. Re-badgez : le message d'accueil s'affiche.

  Si l'agent n'est pas « active » :   journalctl -u badgeuse-agent -n 40

FIN
