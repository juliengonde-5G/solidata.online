#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# Fonctions communes des scripts de deploiement du poste de pointage.
#
# Elles sont ISOLEES ICI pour une seule raison : pouvoir etre TESTEES.
# Les scripts d'installation n'etaient couverts par aucun test, et c'est la
# que se sont loges les defauts qui ont coute une journee de terrain (chemin
# de navigateur code en dur, options Chromium incoherentes avec le
# compositeur, install.sh qui detruisait l'installation quand on le relancait
# depuis /opt).
#
# Aucune de ces fonctions n'ecrit ailleurs que dans les chemins qu'on lui
# passe, aucune n'exige root : voir deploy/tests/test_deploy.sh.
# -----------------------------------------------------------------------------

# Les scripts appelants definissent deja leurs propres traces ; on ne fournit
# des replis que si elles n'existent pas (utilisation directe, tests).
if ! declare -F info >/dev/null 2>&1; then
  info() { printf '    %s\n' "$*"; }
fi
if ! declare -F avert >/dev/null 2>&1; then
  avert() { printf '  ! %s\n' "$*"; }
fi

# Prefixe applique a la recherche des binaires. Vide en exploitation ; les
# tests y placent une arborescence factice, sans root et sans Raspberry.
RACINE_BINAIRES="${RACINE_BINAIRES:-}"

#: Cibles materielles reconnues.
CIBLES_VALIDES="pi5 pi3"

# ------------------------------------------------------------------ INI

lire_cle_ini() {
  # lire_cle_ini <fichier> <section> <cle> : lecture INI minimale, sans
  # dependance. Rend une chaine vide si le fichier, la section ou la cle
  # manquent — l'appelant applique alors SON repli documente, jamais une
  # valeur devinee ici.
  local fichier="$1" section="$2" cle="$3"
  [ -r "$fichier" ] || return 0
  awk -v section="[$section]" -v cle="$cle" '
    /^[[:space:]]*[;#]/ { next }
    /^[[:space:]]*\[/   { dans = ($0 ~ section); next }
    dans && $0 ~ "^[[:space:]]*" cle "[[:space:]]*=" {
      sub(/^[^=]*=[[:space:]]*/, "");
      gsub(/[[:space:]]*$/, "");
      print; exit
    }
  ' "$fichier"
}

port_kiosque() {
  # port_kiosque <fichier de configuration> : port HTTP servi par l'agent.
  # Defaut 8766 (badgeuse_agent/config.py). Une valeur non numerique est
  # ignoree : mieux vaut le defaut connu qu'une URL fantaisiste.
  local valeur
  valeur="$(lire_cle_ini "${1:-}" ui http_port)"
  case "$valeur" in
    ''|*[!0-9]*) printf '8766' ;;
    *) printf '%s' "$valeur" ;;
  esac
}

# --------------------------------------------------------------------- cible

valider_cible() {
  # valider_cible <cible> : 0 si la cible est reconnue, 2 sinon.
  local cible="${1:-}"
  case " $CIBLES_VALIDES " in
    *" $cible "*) return 0 ;;
    *) return 2 ;;
  esac
}

memoire_agent() {
  # memoire_agent <cible> : plafond memoire de l'unite systemd.
  # Pi 3 B+ = 1 Go : la marge est serree, l'agent tourne autour de 40 Mo.
  case "${1:-}" in
    pi3) printf '128M' ;;
    *)   printf '256M' ;;
  esac
}

# ---------------------------------------------------------------- deploiement

deployer() {
  # deployer <origine> <destination> : installe un repertoire, sans jamais
  # laisser le poste sans code.
  #
  # Deux garde-fous, chacun ne pour un incident reel :
  #
  #  1. MEME CHEMIN. Relancer l'installation depuis l'installation elle-meme
  #     (sudo bash /opt/badgeuse/deploy/install.sh — la commande que le
  #     diagnostic recommande) faisait deplacer le repertoire SOURCE vers
  #     .ancien avant de le copier : la copie echouait faute de source, et
  #     /opt/badgeuse/agent disparaissait. Le poste ne redemarrait plus.
  #  2. COPIE D'ABORD, BASCULE ENSUITE. La nouvelle version est copiee a cote
  #     puis basculee : un echec de copie (disque plein, source tronquee) ne
  #     retire jamais la version qui tourne.
  local origine="$1" destination="$2"
  [ -e "$origine" ] || { avert "absent, ignore : ${origine}"; return 0; }

  if [ "$(readlink -f "$origine")" = "$(readlink -f "$destination")" ]; then
    info "deja en place, rien a copier : ${destination}"
    return 0
  fi

  rm -rf "${destination}.nouveau" "${destination}.ancien"
  if ! cp -a "$origine" "${destination}.nouveau"; then
    rm -rf "${destination}.nouveau"
    avert "copie impossible : ${origine} -> ${destination} (version en place conservee)"
    return 1
  fi
  [ -e "$destination" ] && mv "$destination" "${destination}.ancien"
  mv "${destination}.nouveau" "$destination"
  rm -rf "${destination}.ancien"
  info "installe : ${destination}"
}

# ------------------------------------------------------------------- kiosque

resoudre_navigateur() {
  # resoudre_navigateur : chemin du navigateur installe, ou rien.
  # Le nom du paquet varie selon la distribution : un chemin code en dur
  # produit un ExecStart en 203/EXEC, donc un ecran NOIR sans message.
  local candidat
  for candidat in /usr/bin/chromium /usr/bin/chromium-browser; do
    if [ -x "${RACINE_BINAIRES}${candidat}" ]; then
      printf '%s' "$candidat"
      return 0
    fi
  done
  return 1
}

flags_chromium() {
  # flags_chromium <compositeur> <cible> : options de la ligne de commande.
  #
  # Regle non negociable : --ozone-platform=wayland n'est POSE QUE si le
  # compositeur est cage. Pose sous X11, Chromium ne trouve aucun compositeur
  # Wayland et sort aussitot ; absent sous cage, il tente X11 et sort aussi.
  # Les deux cas donnent un ecran noir muet : la coherence des deux valeurs
  # est testee (deploy/tests/test_deploy.sh).
  local compositeur="${1:-cage}" cible="${2:-pi5}" flags

  flags="--kiosk --noerrdialogs --disable-translate"
  flags="${flags} --disable-features=Translate,TranslateUI"
  flags="${flags} --disable-session-crashed-bubble --disable-infobars"
  flags="${flags} --no-first-run --disable-pinch --overscroll-history-navigation=0"
  flags="${flags} --check-for-update-interval=31536000"
  # Les retours sonores (AFF-04) sont synthetises par la page : sans cette
  # option, Chromium bloque l'audio faute de geste utilisateur — or il n'y a,
  # par conception, aucune interaction possible sur ce poste.
  flags="${flags} --autoplay-policy=no-user-gesture-required"

  if [ "$compositeur" = "cage" ]; then
    flags="${flags} --ozone-platform=wayland --enable-features=UseOzonePlatform"
  fi

  if [ "$cible" = "pi3" ]; then
    # 1 Go de RAM : on bride le rendu, on garde un seul processus de rendu.
    flags="${flags} --disable-gpu-compositing --disable-dev-shm-usage"
    flags="${flags} --process-per-site --renderer-process-limit=1"
    flags="${flags} --js-flags=--max-old-space-size=96"
  else
    flags="${flags} --enable-gpu-rasterization"
  fi

  printf '%s' "$flags"
}

ligne_lancement() {
  # ligne_lancement <compositeur> <navigateur> <url> : contenu du drop-in
  # systemd qui pose ExecStart. UN SEUL fichier pose ExecStart, jamais deux
  # qui se marchent dessus.
  #
  # Le compositeur ne lance plus chromium DIRECTEMENT mais via
  # kiosk-client.sh : constate en exploitation, chromium pouvait mourir sous
  # cage sans laisser une seule ligne — cage restait seul devant un ecran
  # vide. Le lanceur journalise la sortie et le code de fin de chromium
  # (etiquette badgeuse-kiosk-client) puis PROPAGE ce code : le compositeur
  # tombe avec son client et systemd relance l'ensemble. Le navigateur et
  # l'URL passent par l'environnement (kiosk.env), pas par la ligne.
  local compositeur="${1:-cage}" navigateur="${2:-/usr/bin/chromium}"
  local url="${3:-http://127.0.0.1:8766}"
  local client="/opt/badgeuse/deploy/kiosk-client.sh"

  if [ "$compositeur" = "x11" ]; then
    cat <<FIN
# Genere par install.sh — repli X11 (paquet cage indisponible).
[Service]
Environment=XDG_SESSION_TYPE=x11
Environment=NAVIGATEUR_BIN=${navigateur}
Environment=KIOSK_URL=${url}
ExecStart=
ExecStart=/usr/bin/xinit ${client} -- :0 vt1 -nolisten tcp
FIN
  else
    cat <<FIN
# Genere par install.sh — compositeur cage (Wayland), navigateur resolu a
# l'installation.
[Service]
Environment=XDG_SESSION_TYPE=wayland
Environment=NAVIGATEUR_BIN=${navigateur}
Environment=KIOSK_URL=${url}
ExecStart=
ExecStart=/usr/bin/cage -- ${client}
FIN
  fi
}
