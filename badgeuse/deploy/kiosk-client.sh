#!/bin/bash
# -----------------------------------------------------------------------------
# Client du kiosque — lance par le COMPOSITEUR (cage ou xinit), jamais a la main.
#
# Rend l'echec du navigateur BRUYANT : constate en exploitation, chromium
# mourait sous cage sans laisser une seule ligne, cage restant seul devant un
# ecran vide.
#
# JOURNALISATION PAR HERITAGE, deliberement : ce processus est l'enfant de
# cage, lui-meme lance par systemd avec StandardOutput/StandardError=journal —
# tout ce qui s'ecrit ici et tout ce que chromium ecrira arrive DONC au journal
# du service (journalctl -u badgeuse-kiosk), sans aucun intermediaire. La
# premiere version passait par systemd-cat : constate sur le poste, il peut
# BLOQUER dans ce contexte de session (cage fige en do_wait sur un lanceur
# suspendu avant sa premiere ligne — aucun log, aucun chromium, ecran vide).
# Plus aucun processus intermediaire ici : un printf ne bloque pas.
# -----------------------------------------------------------------------------
set -u

URL="${KIOSK_URL:-http://127.0.0.1:8766}"
NAV="${NAVIGATEUR_BIN:-/usr/bin/chromium}"

dire() { printf 'kiosk-client: %s\n' "$*" >&2; }

if [ ! -x "$NAV" ]; then
  dire "ERREUR : navigateur introuvable (${NAV}) — relancer install.sh"
  exit 127
fi
[ -e /dev/dri/card0 ] || [ -e /dev/dri/card1 ] \
  || dire "avertissement : aucun peripherique /dev/dri — rendu GPU indisponible"

# X11 : sans gestionnaire de fenetres, PERSONNE n'honore --kiosk — Chromium
# ouvre une fenetre de taille par defaut au milieu de l'ecran (constate en
# exploitation : interface confinee a la moitie gauche d'un ecran 16:9).
# openbox, deja installe par la voie X11, applique le plein ecran demande.
# Sous Wayland, cage EST le gestionnaire : rien a lancer.
if [ "${XDG_SESSION_TYPE:-}" = "x11" ]; then
  if command -v openbox >/dev/null 2>&1; then
    openbox &
    GESTIONNAIRE=$!
    sleep 1
    dire "gestionnaire de fenetres openbox demarre (plein ecran honore)"
  fi
  # CEINTURE. « -s off -dpms » est deja passe au serveur X ; on le redit ici
  # parce qu'une configuration Xorg du systeme peut reactiver l'economiseur
  # apres coup, et parce qu'un ecran de pointage qui noircit en pleine journee
  # est indiscernable d'une panne pour l'atelier. xset fait partie de
  # x11-xserver-utils, installe par la voie X11.
  if command -v xset >/dev/null 2>&1; then
    xset s off -dpms s noblank 2>/dev/null \
      && dire "economiseur et mise en veille X desactives (ecran toujours allume)" \
      || dire "avertissement : xset n'a pas pu desactiver l'economiseur"
  else
    dire "avertissement : openbox absent — la fenetre risque de ne pas occuper tout l'ecran"
  fi
  # Repli de ceinture : on force la geometrie a la taille reelle de l'ecran,
  # utile si le gestionnaire tarde ou manque. xdpyinfo fait partie de
  # x11-xserver-utils, installe par la voie X11.
  if command -v xdpyinfo >/dev/null 2>&1; then
    TAILLE="$(xdpyinfo 2>/dev/null | awk '/dimensions:/ { print $2; exit }')"
    case "$TAILLE" in
      [0-9]*x[0-9]*)
        CHROMIUM_FLAGS="${CHROMIUM_FLAGS:-} --window-position=0,0 --window-size=${TAILLE%x*},${TAILLE#*x}"
        dire "geometrie forcee a la taille de l'ecran : ${TAILLE}" ;;
    esac
  fi
fi

dire "demarrage : ${NAV} (options : ${CHROMIUM_FLAGS:-aucune}) -> ${URL}"

# shellcheck disable=SC2086 — CHROMIUM_FLAGS est une liste d'options, le
# decoupage sur les espaces est voulu (aucune option ne contient d'espace).
"$NAV" ${CHROMIUM_FLAGS:-} "$URL"
CODE=$?

# Le gestionnaire de fenetres ne survit pas au navigateur : sans cela, un
# openbox orphelin resterait a chaque redemarrage du kiosque.
[ -n "${GESTIONNAIRE:-}" ] && kill "$GESTIONNAIRE" 2>/dev/null

dire "chromium termine (code ${CODE})"
exit "$CODE"
