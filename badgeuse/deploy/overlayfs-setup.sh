#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# Rootfs en lecture seule + donnees sur partition dediee inscriptible.
#
# But (SPEC §7.1) : une coupure de courant ne doit jamais corrompre le systeme,
# et un poste doit se remettre en service en cinq minutes.
#
# GARDE-FOU CENTRAL : le script REFUSE d'activer l'overlay tant que
# /var/lib/badgeuse n'est pas monte sur une partition dediee. Sous overlay, un
# repertoire du rootfs vit en RAM : les pointages non encore transmis
# dispararaitraient au redemarrage. Des heures de travail qui font foi ne se
# stockent pas dans un systeme de fichiers volatil.
#
# Preparer la partition de donnees AVANT d'activer l'overlay :
#     sudo mkfs.ext4 -L BADGEUSE_DATA /dev/<partition>
#     sudo bash overlayfs-setup.sh --data-only     # montage + fstab
#     sudo bash overlayfs-setup.sh                 # puis l'overlay
#
# Usage :
#   overlayfs-setup.sh [--data-only] [--disable] [--force]
# -----------------------------------------------------------------------------
set -euo pipefail

ETIQUETTE_DATA="${ETIQUETTE_DATA:-BADGEUSE_DATA}"
POINT_MONTAGE="/var/lib/badgeuse"

DATA_ONLY=0
DESACTIVER=0
FORCER=0

for arg in "$@"; do
  case "$arg" in
    --data-only) DATA_ONLY=1 ;;
    --disable)   DESACTIVER=1 ;;
    --force)     FORCER=1 ;;
    -h|--help)   sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "option inconnue : $arg" >&2; exit 2 ;;
  esac
done

log() { printf '[overlay] %s\n' "$*"; }

[ "$(id -u)" -eq 0 ] || { echo "A executer en root." >&2; exit 1; }

MODELE="$(tr -d '\0' < /proc/device-tree/model 2>/dev/null || echo inconnu)"
EST_PI5=0
printf '%s' "$MODELE" | grep -qi 'Raspberry Pi 5' && EST_PI5=1
log "machine : ${MODELE}"

# ---------------------------------------------------------------- horloge ----
configurer_horloge() {
  if [ "$EST_PI5" -eq 1 ]; then
    # Le Pi 5 a une RTC materielle (avec sa pile) : fake-hwclock, qui se
    # contente de rejouer la derniere date connue, fausserait l'horodatage.
    if systemctl list-unit-files | grep -q '^fake-hwclock'; then
      log "desactivation de fake-hwclock (RTC materielle du Pi 5)"
      systemctl disable --now fake-hwclock >/dev/null 2>&1 || true
    fi
    if [ -e /dev/rtc0 ]; then
      log "RTC detectee : $(hwclock -r 2>/dev/null || echo 'lecture impossible')"
    else
      log "ATTENTION : aucune RTC visible (/dev/rtc0) — verifier la pile"
    fi
  else
    # Pi 3 B+ : aucune RTC. Un module DS3231 sur le bus I2C est vivement
    # recommande, sinon l'heure derive a chaque coupure jusqu'a la synchro NTP.
    if [ -e /dev/i2c-1 ] && command -v i2cdetect >/dev/null 2>&1 \
       && i2cdetect -y 1 2>/dev/null | grep -qi ' 68'; then
      if ! grep -q '^dtoverlay=i2c-rtc,ds3231' /boot/firmware/config.txt 2>/dev/null; then
        log "module DS3231 detecte (0x68) — activation de l'overlay i2c-rtc"
        echo 'dtoverlay=i2c-rtc,ds3231' >> /boot/firmware/config.txt
        log "prise en compte au prochain redemarrage"
      else
        log "overlay DS3231 deja configure"
      fi
    else
      log "aucun DS3231 detecte : le Pi 3 depend entierement de NTP au demarrage"
      log "  (l'agent signale toute derive > 2 s dans son heartbeat)"
    fi
  fi
}

# ------------------------------------------------------- partition de donnees -
monter_donnees() {
  if findmnt -n "$POINT_MONTAGE" >/dev/null 2>&1; then
    log "$POINT_MONTAGE est deja un point de montage :"
    findmnt -n "$POINT_MONTAGE" | sed 's/^/    /'
    return 0
  fi

  if ! blkid -L "$ETIQUETTE_DATA" >/dev/null 2>&1; then
    log "aucune partition portant l'etiquette ${ETIQUETTE_DATA}"
    return 1
  fi

  local peripherique
  peripherique="$(blkid -L "$ETIQUETTE_DATA")"
  log "partition de donnees trouvee : ${peripherique}"

  mkdir -p "$POINT_MONTAGE"

  if ! grep -q "LABEL=${ETIQUETTE_DATA}" /etc/fstab; then
    log "ajout de l'entree fstab"
    printf 'LABEL=%s  %s  ext4  defaults,noatime,nodev,nosuid,noexec  0  2\n' \
      "$ETIQUETTE_DATA" "$POINT_MONTAGE" >> /etc/fstab
  fi

  mount "$POINT_MONTAGE"
  chown badgeuse:badgeuse "$POINT_MONTAGE" 2>/dev/null || true
  chmod 0750 "$POINT_MONTAGE"
  log "donnees montees sur ${POINT_MONTAGE}"
  return 0
}

# ------------------------------------------------------------------ overlay --
etat_overlay() {
  if command -v raspi-config >/dev/null 2>&1; then
    raspi-config nonint get_overlay_now 2>/dev/null || echo "?"
  else
    echo "?"
  fi
}

activer_overlay() {
  command -v raspi-config >/dev/null 2>&1 || {
    log "raspi-config absent : installer 'overlayroot' et configurer"
    log "  /etc/overlayroot.conf (overlayroot=tmpfs) a la main"
    exit 1
  }

  # Convention raspi-config nonint : 0 = activer, 1 = desactiver.
  log "activation de l'overlay du systeme de fichiers racine"
  raspi-config nonint do_overlayfs 0
  log "passage de la partition de demarrage en lecture seule"
  raspi-config nonint do_bootro 0 || log "  (do_bootro indisponible sur cette version)"
}

desactiver_overlay() {
  command -v raspi-config >/dev/null 2>&1 || { log "raspi-config absent"; exit 1; }
  log "desactivation de l'overlay (retour en ecriture pour maintenance)"
  raspi-config nonint do_bootro 1 || true
  raspi-config nonint do_overlayfs 1
  log "redemarrer, appliquer les mises a jour, puis reactiver l'overlay"
}

# --------------------------------------------------------------------- main --
log "etat overlay actuel : $(etat_overlay)  (0 = actif, 1 = inactif)"

if [ "$DESACTIVER" -eq 1 ]; then
  desactiver_overlay
  log "termine — REDEMARRAGE necessaire"
  exit 0
fi

configurer_horloge

if monter_donnees; then
  DONNEES_OK=1
else
  DONNEES_OK=0
fi

if [ "$DATA_ONLY" -eq 1 ]; then
  [ "$DONNEES_OK" -eq 1 ] && log "partition de donnees prete" \
    || log "partition de donnees ABSENTE — creer : mkfs.ext4 -L ${ETIQUETTE_DATA} /dev/<partition>"
  exit 0
fi

if [ "$DONNEES_OK" -eq 0 ]; then
  log ""
  log "REFUS D'ACTIVER L'OVERLAY."
  log "  ${POINT_MONTAGE} n'est pas sur une partition dediee : sous overlay, la"
  log "  file d'attente des pointages vivrait en RAM et serait PERDUE a chaque"
  log "  redemarrage. Aucune heure de travail ne doit dependre de cela."
  log ""
  log "  Marche a suivre :"
  log "    1. creer la partition :  mkfs.ext4 -L ${ETIQUETTE_DATA} /dev/<partition>"
  log "    2. la monter          :  bash $0 --data-only"
  log "    3. relancer           :  bash $0"
  log ""
  log "  Passer outre en connaissance de cause : bash $0 --force"
  [ "$FORCER" -eq 1 ] || exit 1
  log "  --force : activation demandee malgre des donnees VOLATILES."
fi

activer_overlay

log ""
log "termine — REDEMARRAGE necessaire pour appliquer l'overlay."
log "Apres redemarrage, verifier :"
log "  findmnt /            -> doit indiquer overlay"
log "  findmnt ${POINT_MONTAGE}  -> doit indiquer la partition ${ETIQUETTE_DATA}"
log "  systemctl is-active badgeuse-agent"
log ""
log "Maintenance ulterieure (mise a jour, changement de config) :"
log "  bash $0 --disable && reboot   puis   bash $0 && reboot"
