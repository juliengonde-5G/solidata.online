#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# Plage d'activation de l'ecran (AFF-08) : allume dedans, eteint dehors.
#
# SOURCE DES HEURES, dans cet ordre :
#   1. <data_dir>/dpms.conf, ecrit par l'agent avec ce que SOLIDATA decide
#      (Temps & Presence -> Parametres). C'est la voie NOMINALE : la doctrine
#      du module veut qu'aucune regle d'affichage ne se decide sur le poste
#      (ADR-0002), et jusqu'ici les horaires regles dans le back-office
#      n'atteignaient tout simplement pas ce minuteur ;
#   2. a defaut, /etc/badgeuse/badgeuse.conf, section [dpms] — la plage posee
#      a l'installation, qui reste valable tant qu'aucun serveur n'a parle.
# Les heures sont interpretees en EUROPE/PARIS, comme tout le reste du poste,
# et non dans le fuseau systeme de la machine.
# Plage absente ou incomplete => l'ecran reste allume (aucune extinction
# decidee par defaut : on ne coupe pas un afficheur sur une supposition).
#
# PENDANT LA PLAGE, L'ECRAN NE DOIT PAS S'ENDORMIR TOUT SEUL. Un kiosque ne
# recoit jamais de frappe : l'economiseur et la mise en veille du serveur
# graphique se declenchent donc en pleine journee, et un ecran noir est
# indiscernable d'une panne pour l'atelier. kiosk-client.sh les neutralise
# DEJA au demarrage du navigateur, mais une seule fois : une configuration
# Xorg, une reprise de session ou un redemarrage du serveur X les remet en
# place sans que rien ne le signale. On les neutralise donc a CHAQUE passage,
# toutes les 5 minutes, tant qu'on est dans la plage.
#
# Trois voies d'extinction, dans cet ordre :
#   1. wlr-randr, dans la session cage du kiosque (Wayland) ;
#   2. xset DPMS, dans la session X11 du kiosque ;
#   3. vcgencmd display_power, en repli (fonctionne hors session).
#
# Appele toutes les 5 minutes par badgeuse-dpms.timer, et idempotent :
# rallumer un ecran allume ne fait rien.
# -----------------------------------------------------------------------------
set -euo pipefail

CONF="${BADGEUSE_CONFIG:-/etc/badgeuse/badgeuse.conf}"
KIOSK_USER="${KIOSK_USER:-badgeuse}"

log() { printf '[dpms] %s\n' "$*"; }

# Lecteur INI commun (deploy/lib.sh) : une seule implementation, testee.
# shellcheck source=lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

lire_cle() {
  # lire_cle <section> <cle> : dans la configuration du poste.
  lire_cle_ini "$CONF" "$1" "$2"
}

data_dir() {
  # Repertoire de donnees de l'agent ([system] data_dir), defaut documente
  # dans badgeuse.conf.example et config.py.
  local valeur
  valeur="$(lire_cle system data_dir || true)"
  printf '%s' "${valeur:-/var/lib/badgeuse}"
}

lire_plage() {
  # lire_plage <cle> : l'heure decidee par le SERVEUR si l'agent en a depose
  # une, sinon celle de la configuration d'installation. Jamais de valeur
  # inventee : une source muette laisse la suivante repondre.
  local cle="$1" valeur fichier
  fichier="$(data_dir)/dpms.conf"
  valeur="$(lire_cle_ini "$fichier" dpms "$cle" || true)"
  if [ -n "$valeur" ]; then
    printf '%s' "$valeur"
    return 0
  fi
  lire_cle dpms "$cle"
}

xset_kiosque() {
  # xset_kiosque <arguments xset> : parle au serveur X du kiosque, s'il y en a
  # un. Ce script tourne en root (minuteur systemd) alors que X appartient a
  # l'utilisateur du kiosque : sans son fichier d'autorisation, xset se voit
  # refuser l'acces a l'affichage. Rend 1 sans bruit quand il n'y a pas de X
  # (voie Wayland/cage : il n'y a alors pas d'economiseur a neutraliser).
  command -v xset >/dev/null 2>&1 || return 1
  local maison xauth
  maison="$(getent passwd "$KIOSK_USER" 2>/dev/null | cut -d: -f6)"
  xauth="${maison:-/home/$KIOSK_USER}/.Xauthority"
  [ -r "$xauth" ] || return 1
  DISPLAY="${DISPLAY_KIOSQUE:-:0}" XAUTHORITY="$xauth" xset "$@" >/dev/null 2>&1
}

desactiver_veille() {
  # Pendant la plage d'activation : plus d'economiseur, plus de mise en veille.
  # « s off » coupe l'economiseur, « -dpms » desactive la mise en veille du
  # moniteur, « s noblank » interdit le noircissement de la console.
  if xset_kiosque s off -dpms s noblank; then
    log "veille et economiseur desactives (plage d'activation)"
  fi
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

  # Voie X11. L'ORDRE DES DEUX COMMANDES N'EST PAS COSMETIQUE : « xset -dpms »
  # desactive l'extension DPMS, et « dpms force off » ne fait alors plus rien.
  # Pour eteindre, il faut donc la RALLUMER d'abord ; pour reveiller, forcer
  # l'allumage avant de la desactiver a nouveau (desactivation posee ensuite
  # par desactiver_veille, pendant toute la plage).
  if [ "$etat" = on ]; then
    if xset_kiosque dpms force on; then
      log "ecran on (xset)"
      return 0
    fi
  else
    if xset_kiosque +dpms && xset_kiosque dpms force off; then
      log "ecran off (xset)"
      return 0
    fi
  fi

  if command -v vcgencmd >/dev/null 2>&1; then
    vcgencmd display_power "$([ "$etat" = on ] && echo 1 || echo 0)" >/dev/null
    log "ecran $etat (vcgencmd)"
    return 0
  fi

  log "aucune methode d'extinction disponible (ni wlr-randr, ni xset, ni vcgencmd)"
  return 1
}

main() {
  local allumage extinction debut fin maintenant
  allumage="$(lire_plage allumage || true)"
  extinction="$(lire_plage extinction || true)"

  if [ -z "${allumage:-}" ] || [ -z "${extinction:-}" ]; then
    # Aucune plage : l'ecran reste allume, ET on l'empeche de s'endormir —
    # « pas de plage » veut dire « allume en permanence », pas « livre a
    # l'economiseur du serveur graphique ».
    log "plage non configuree — ecran laisse allume en permanence"
    desactiver_veille
    exit 0
  fi

  debut="$(minutes_depuis_minuit "$allumage")" || {
    log "heure d'allumage illisible ('$allumage') — ecran laisse allume"; exit 0; }
  fin="$(minutes_depuis_minuit "$extinction")" || {
    log "heure d'extinction illisible ('$extinction') — ecran laisse allume"; exit 0; }

  # Heure de REFERENCE du poste : Europe/Paris, comme partout ailleurs dans
  # l'agent (sens.py, moments.py, horodatage local des pointages). Sans ce
  # TZ explicite, la plage suivrait le fuseau SYSTEME : sur une image
  # Raspberry Pi OS restee en UTC, l'ecran s'eteignait deux heures trop tot.
  maintenant=$(( 10#$(TZ=Europe/Paris date +%H) * 60 + 10#$(TZ=Europe/Paris date +%M) ))

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

  if [ "$ouvert" -eq 1 ]; then
    ecran on
    desactiver_veille
  else
    ecran off
  fi
}

# Le harnais de tests source ce script pour exercer ses fonctions REELLES
# (priorite serveur/local de la plage) plutot qu'une copie qui divergerait.
# En exploitation la variable n'est jamais posee : le script s'execute.
if [ "${BADGEUSE_DPMS_SOURCE_SEULEMENT:-}" != "1" ]; then
  main "$@"
fi
