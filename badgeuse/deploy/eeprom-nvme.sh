#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# Raspberry Pi 5 UNIQUEMENT — ordre de demarrage NVMe prioritaire.
#
# Supprime le mode de panne « carte microSD » (SPEC §6) : le poste demarre sur
# le SSD NVMe du HAT M.2, avec repli sur microSD puis USB.
#
#   BOOT_ORDER=0xf416  -> lu de droite a gauche : 6 = NVMe, 1 = microSD,
#                         4 = USB-MSD, f = recommencer indefiniment.
#   PCIE_PROBE=1       -> sonde le port PCIe pour les cartes non « HAT+ ».
#
# La generation PCIe est laissee en AUTO : forcer la gen 3 est hors
# specification officielle et cause des SSD injoignables a froid. Ne la forcer
# qu'apres un test de charge sur le modele de SSD retenu.
#
# Idempotent : relancable sans effet si l'ordre est deja correct.
# -----------------------------------------------------------------------------
set -euo pipefail

BOOT_ORDER_CIBLE="${BOOT_ORDER_CIBLE:-0xf416}"

log() { printf '[eeprom] %s\n' "$*"; }

[ "$(id -u)" -eq 0 ] || { echo "A executer en root." >&2; exit 1; }

# --- Garde-fou : la cible doit etre un Pi 5 ----------------------------------
MODELE="$(tr -d '\0' < /proc/device-tree/model 2>/dev/null || echo inconnu)"
if ! printf '%s' "$MODELE" | grep -qi 'Raspberry Pi 5'; then
  log "machine detectee : ${MODELE}"
  log "REFUS : ce script ne s'applique qu'au Raspberry Pi 5."
  log "        Sur Pi 3 B+, le demarrage reste sur microSD (aucun PCIe)."
  exit 1
fi

command -v rpi-eeprom-config >/dev/null 2>&1 || {
  log "rpi-eeprom-config absent — apt-get install -y rpi-eeprom"
  exit 1
}

# --- Etat avant --------------------------------------------------------------
AVANT="$(rpi-eeprom-config)"
log "configuration AVANT :"
printf '%s\n' "$AVANT" | sed 's/^/    /'

ORDRE_ACTUEL="$(printf '%s\n' "$AVANT" | sed -n 's/^BOOT_ORDER=//p' | tail -n1)"
SONDE_ACTUELLE="$(printf '%s\n' "$AVANT" | sed -n 's/^PCIE_PROBE=//p' | tail -n1)"

if [ "${ORDRE_ACTUEL:-}" = "$BOOT_ORDER_CIBLE" ] && [ "${SONDE_ACTUELLE:-}" = "1" ]; then
  log "deja conforme (BOOT_ORDER=${BOOT_ORDER_CIBLE}, PCIE_PROBE=1) — rien a faire"
  exit 0
fi

# --- Application -------------------------------------------------------------
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

printf '%s\n' "$AVANT" \
  | grep -v '^BOOT_ORDER=' \
  | grep -v '^PCIE_PROBE=' > "$TMP"
{
  echo "BOOT_ORDER=${BOOT_ORDER_CIBLE}"
  echo "PCIE_PROBE=1"
} >> "$TMP"

log "application du nouvel ordre de demarrage"
rpi-eeprom-config --apply "$TMP"

log "configuration APRES :"
rpi-eeprom-config | sed 's/^/    /'

log "termine. La nouvelle EEPROM est ecrite AU PROCHAIN REDEMARRAGE."
log "Verifier ensuite : lsblk (le rootfs doit etre sur /dev/nvme0n1)."
