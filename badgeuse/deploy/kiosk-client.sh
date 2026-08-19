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

dire "demarrage : ${NAV} (options : ${CHROMIUM_FLAGS:-aucune}) -> ${URL}"

# shellcheck disable=SC2086 — CHROMIUM_FLAGS est une liste d'options, le
# decoupage sur les espaces est voulu (aucune option ne contient d'espace).
"$NAV" ${CHROMIUM_FLAGS:-} "$URL"
CODE=$?

dire "chromium termine (code ${CODE})"
exit "$CODE"
