#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# Extinction de l'ecran hors plage d'ouverture (AFF-08).
#
# La plage est lue dans /etc/badgeuse/badgeuse.conf, section [dpms] :
#     allumage   = 05:30
#     extinction = 21:30
# Plage absente ou incomplete => l'ecran reste allume (aucune extinction
# decidee par defaut : on ne coupe pas un afficheur sur une supposition).
#
# Deux voies, dans cet ordre :
#   1. wlr-randr, dans la session cage du kiosque (Wayland) ;
#   2. vcgencmd display_power, en repli (fonctionne hors session).
#
# Appele toutes les 5 minutes par badgeuse-dpms.timer, et idempotent :
# rallumer un ecran allume ne fait rien.
# -----------------------------------------------------------------------------
set -euo pipefail

CONF="${BADGEUSE_CONFIG:-/etc/badgeuse/badgeuse.conf}"
KIOSK_USER="${KIOSK_USER:-badgeuse}"

log() { printf '[dpms] %s\n' "$*"; }

lire_cle() {
  # lire_cle <section> <cle> : lecture INI minimale, sans dependance.
  local section="$1" cle="$2"
  [ -r "$CONF" ] || return 0
  awk -v section="[$section]" -v cle="$cle" '
    /^[[:space:]]*[;#]/ { next }
    /^[[:space:]]*\[/   { dans = ($0 ~ section); next }
    dans && $0 ~ "^[[:space:]]*" cle "[[:space:]]*=" {
      sub(/^[^=]*=[[:space:]]*/, "");
      gsub(/[[:space:]]*$/, "");
      print; exit
    }
  ' "$CONF"
}

minutes_depuis_minuit() {
  local hhmm="$1"
  [[ "$hhmm" =~ ^([0-9]{1,2}):([0-9]{2})$ ]] || return 1
  echo $(( 10#${BASH_REMATCH[1]} * 60 + 10#${BASH_REMATCH[2]} ))
}

ecran() {
  # ecran <on|off>
  local etat="$1" uid runtime
  uid="$(id -u "$KIOSK_USER" 2>/dev/null || echo '')"

  if command -v wlr-randr >/dev/null 2>&1 && [ -n "$uid" ]; then
    runtime="/run/badgeuse"
    [ -d "$runtime" ] || runtime="/run/user/$uid"
    for socket in "$runtime"/wayland-*; do
      [ -S "$socket" ] || continue
      if XDG_RUNTIME_DIR="$runtime" WAYLAND_DISPLAY="$(basename "$socket")" \
         wlr-randr --output '*' --"$etat" >/dev/null 2>&1; then
        log "ecran $etat (wlr-randr)"
        return 0
      fi
    done
  fi

  if command -v vcgencmd >/dev/null 2>&1; then
    vcgencmd display_power "$([ "$etat" = on ] && echo 1 || echo 0)" >/dev/null
    log "ecran $etat (vcgencmd)"
    return 0
  fi

  log "aucune methode d'extinction disponible (ni wlr-randr, ni vcgencmd)"
  return 1
}

main() {
  local allumage extinction debut fin maintenant
  allumage="$(lire_cle dpms allumage || true)"
  extinction="$(lire_cle dpms extinction || true)"

  if [ -z "${allumage:-}" ] || [ -z "${extinction:-}" ]; then
    log "plage non configuree — ecran laisse allume"
    exit 0
  fi

  debut="$(minutes_depuis_minuit "$allumage")" || {
    log "heure d'allumage illisible ('$allumage') — ecran laisse allume"; exit 0; }
  fin="$(minutes_depuis_minuit "$extinction")" || {
    log "heure d'extinction illisible ('$extinction') — ecran laisse allume"; exit 0; }

  maintenant=$(( 10#$(date +%H) * 60 + 10#$(date +%M) ))

  local ouvert=0
  if [ "$debut" -le "$fin" ]; then
    # Plage dans la journee (cas courant : 05:30 -> 21:30).
    if [ "$maintenant" -ge "$debut" ] && [ "$maintenant" -lt "$fin" ]; then
      ouvert=1
    fi
  else
    # Plage a cheval sur minuit (equipes de nuit : 21:00 -> 06:00).
    if [ "$maintenant" -ge "$debut" ] || [ "$maintenant" -lt "$fin" ]; then
      ouvert=1
    fi
  fi

  if [ "$ouvert" -eq 1 ]; then ecran on; else ecran off; fi
}

main "$@"
