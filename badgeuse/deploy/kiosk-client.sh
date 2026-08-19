#!/bin/bash
# -----------------------------------------------------------------------------
# Client du kiosque — lance par le COMPOSITEUR (cage ou xinit), jamais a la main.
#
# Raison d'etre : constate en exploitation, chromium mourait sous cage SANS
# LAISSER UNE SEULE LIGNE — cage restait seul a tenir un ecran vide et rien,
# ni dans le journal du service ni ailleurs, ne disait pourquoi. Ce lanceur
# rend l'echec bruyant :
#   - controles prealables nommes (navigateur present, rendu GPU accessible) ;
#   - sortie de chromium (stdout+stderr) versee au journal systemd sous
#     l'etiquette « badgeuse-kiosk-client » ;
#   - code de fin journalise, PUIS propage : le compositeur tombe avec son
#     client et systemd (Restart=always) relance l'ensemble — plus jamais un
#     compositeur vivant devant un ecran mort.
#
# Le navigateur et ses options viennent de /etc/badgeuse/kiosk.env, charge par
# l'unite systemd (EnvironmentFile) et herite par ce processus.
# -----------------------------------------------------------------------------
set -u

TAG=badgeuse-kiosk-client
URL="${KIOSK_URL:-http://127.0.0.1:8766}"
NAV="${NAVIGATEUR_BIN:-/usr/bin/chromium}"

dire() { printf '%s\n' "$*" | systemd-cat -t "$TAG" 2>/dev/null || printf '%s\n' "$*" >&2; }

if [ ! -x "$NAV" ]; then
  dire "ERREUR : navigateur introuvable (${NAV}) — relancer install.sh"
  exit 127
fi
[ -e /dev/dri/card0 ] || [ -e /dev/dri/card1 ] \
  || dire "avertissement : aucun peripherique /dev/dri — rendu GPU indisponible"

dire "demarrage : ${NAV} (options : ${CHROMIUM_FLAGS:-aucune}) -> ${URL}"

# shellcheck disable=SC2086 — CHROMIUM_FLAGS est une liste d'options, le
# decoupage sur les espaces est voulu (aucune option ne contient d'espace).
"$NAV" ${CHROMIUM_FLAGS:-} "$URL" > >(systemd-cat -t "$TAG") 2>&1
CODE=$?

dire "chromium termine (code ${CODE})"
exit "$CODE"
