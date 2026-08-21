#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# Tests des scripts de deploiement du poste de pointage.
#
#   bash badgeuse/deploy/tests/test_deploy.sh
#
# S'executent SANS root, SANS Raspberry, SANS reseau : tout se passe dans un
# repertoire temporaire. Aucune dependance (ni bats, ni shellcheck) — bash et
# les outils de base suffisent, comme le reste du poste.
#
# Pourquoi ces tests existent : les scripts d'installation n'etaient couverts
# par rien, et c'est la que se sont loges les defauts qui ont immobilise un
# poste (navigateur code en dur, options Chromium incoherentes avec le
# compositeur, installation detruite en relancant install.sh depuis /opt).
# -----------------------------------------------------------------------------
set -uo pipefail

RACINE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TRAVAIL="$(mktemp -d)"
trap 'rm -rf "$TRAVAIL"' EXIT

OK=0
KO=0

verifier() {
  # verifier <intitule> <attendu> <obtenu>
  if [ "$2" = "$3" ]; then
    OK=$((OK + 1))
    printf '  ok   %s\n' "$1"
  else
    KO=$((KO + 1))
    printf '  KO   %s\n       attendu : %s\n       obtenu  : %s\n' "$1" "$2" "$3"
  fi
}

verifier_contient() {
  # verifier_contient <intitule> <motif> <texte>
  if printf '%s' "$3" | grep -qF -- "$2"; then
    OK=$((OK + 1))
    printf '  ok   %s\n' "$1"
  else
    KO=$((KO + 1))
    printf '  KO   %s\n       motif absent : %s\n' "$1" "$2"
  fi
}

verifier_absent() {
  # verifier_absent <intitule> <motif> <texte>
  if printf '%s' "$3" | grep -qF -- "$2"; then
    KO=$((KO + 1))
    printf '  KO   %s\n       motif present alors qu%s : %s\n' "$1" "'il ne devrait pas" "$2"
  else
    OK=$((OK + 1))
    printf '  ok   %s\n' "$1"
  fi
}

titre() { printf '\n== %s\n' "$*"; }

# --------------------------------------------------------------- 1. syntaxe

titre "Syntaxe de tous les scripts (bash -n)"
for script in "$RACINE"/*.sh "$RACINE"/tests/*.sh; do
  if bash -n "$script" 2>/dev/null; then
    verifier "syntaxe $(basename "$script")" "ok" "ok"
  else
    verifier "syntaxe $(basename "$script")" "ok" "erreur de syntaxe"
  fi
done

# ------------------------------------------------------------ 2. lib.sh pur

# shellcheck source=../lib.sh
. "$RACINE/lib.sh"

titre "Cibles materielles"
valider_cible pi5 && verifier "pi5 acceptee" "0" "0" || verifier "pi5 acceptee" "0" "1"
valider_cible pi3 && verifier "pi3 acceptee" "0" "0" || verifier "pi3 acceptee" "0" "1"
valider_cible pi4 && verifier "pi4 refusee" "2" "0" || verifier "pi4 refusee" "2" "2"
verifier "memoire pi3" "128M" "$(memoire_agent pi3)"
verifier "memoire pi5" "256M" "$(memoire_agent pi5)"

# ---------------------------------------------------- 3. deployer (bloquant)

titre "deployer : relance depuis l'installation elle-meme"
# Reproduction du defaut : « sudo bash /opt/badgeuse/deploy/install.sh »
# faisait disparaitre /opt/badgeuse/agent, et le poste ne redemarrait plus.
OPT="$TRAVAIL/opt/badgeuse"
mkdir -p "$OPT/agent" "$OPT/ui" "$OPT/deploy"
echo "code agent" > "$OPT/agent/app.py"
echo "interface"  > "$OPT/ui/index.html"
echo "installeur" > "$OPT/deploy/install.sh"

SORTIE="$(deployer "$OPT/agent" "$OPT/agent" 2>&1)"
verifier "agent toujours present" "code agent" "$(cat "$OPT/agent/app.py" 2>/dev/null)"
verifier "aucun repertoire .ancien" "" "$(ls -d "$OPT"/*.ancien 2>/dev/null)"
verifier_contient "message explicite" "deja en place" "$SORTIE"

SORTIE="$(deployer "$OPT/deploy" "$OPT/deploy" 2>&1)"
verifier "install.sh survit" "installeur" "$(cat "$OPT/deploy/install.sh" 2>/dev/null)"

titre "deployer : mise a jour normale"
NEUF="$TRAVAIL/source/agent"
mkdir -p "$NEUF"
echo "code agent v2" > "$NEUF/app.py"
deployer "$NEUF" "$OPT/agent" >/dev/null 2>&1
verifier "code mis a jour" "code agent v2" "$(cat "$OPT/agent/app.py")"
verifier "aucun residu .nouveau" "" "$(ls -d "$OPT"/*.nouveau 2>/dev/null)"
verifier "aucun residu .ancien" "" "$(ls -d "$OPT"/*.ancien 2>/dev/null)"

titre "deployer : la copie echoue, la version en place reste"
CODE=0
deployer "$TRAVAIL/source/inexistant" "$OPT/agent" >/dev/null 2>&1 || CODE=$?
verifier "source absente : rend 0 (ignore)" "0" "$CODE"
verifier "code toujours en place" "code agent v2" "$(cat "$OPT/agent/app.py")"

# Copie impossible : destination non inscriptible.
ILLISIBLE="$TRAVAIL/source/illisible"
mkdir -p "$ILLISIBLE"
echo x > "$ILLISIBLE/fichier"
BLOQUE="$TRAVAIL/bloque"
mkdir -p "$BLOQUE/cible"
echo "version en service" > "$BLOQUE/cible/marqueur"
chmod 500 "$BLOQUE"
CODE=0
deployer "$ILLISIBLE" "$BLOQUE/cible" >/dev/null 2>&1 || CODE=$?
chmod 700 "$BLOQUE"
if [ "$(id -u)" -eq 0 ]; then
  printf '  (ignore : lance en root, les droits ne bloquent rien)\n'
else
  verifier "echec de copie signale" "1" "$CODE"
  verifier "version en service conservee" "version en service" \
    "$(cat "$BLOQUE/cible/marqueur" 2>/dev/null)"
fi

# --------------------------------------------------- 4. navigateur / kiosque

titre "Resolution du navigateur (le chemin varie selon la distribution)"
FAUX="$TRAVAIL/racine"
mkdir -p "$FAUX/usr/bin"
RACINE_BINAIRES="$FAUX"
CODE=0
resoudre_navigateur >/dev/null 2>&1 || CODE=$?
verifier "aucun navigateur : echec signale" "1" "$CODE"

: > "$FAUX/usr/bin/chromium-browser"; chmod +x "$FAUX/usr/bin/chromium-browser"
verifier "chromium-browser retenu" "/usr/bin/chromium-browser" "$(resoudre_navigateur)"
: > "$FAUX/usr/bin/chromium"; chmod +x "$FAUX/usr/bin/chromium"
verifier "chromium prioritaire" "/usr/bin/chromium" "$(resoudre_navigateur)"
RACINE_BINAIRES=""

titre "Coherence compositeur <-> options Chromium"
# Defaut de terrain : cage lance sans --ozone-platform=wayland, ou X11 lance
# avec. Dans les deux cas Chromium sort aussitot et l'ecran reste noir.
FLAGS_CAGE="$(flags_chromium cage pi5)"
FLAGS_X11="$(flags_chromium x11 pi5)"
verifier_contient "cage : ozone wayland pose" "--ozone-platform=wayland" "$FLAGS_CAGE"
verifier_absent   "x11 : ozone wayland absent" "--ozone-platform=wayland" "$FLAGS_X11"
verifier_contient "audio autorise (AFF-04)" "--autoplay-policy=no-user-gesture-required" "$FLAGS_CAGE"
verifier_contient "mode kiosque" "--kiosk" "$FLAGS_CAGE"

FLAGS_PI3="$(flags_chromium cage pi3)"
verifier_contient "pi3 : rendu bride" "--renderer-process-limit=1" "$FLAGS_PI3"
verifier_absent   "pi3 : pas de rasterisation GPU" "--enable-gpu-rasterization" "$FLAGS_PI3"
verifier_contient "pi5 : rasterisation GPU" "--enable-gpu-rasterization" "$FLAGS_CAGE"

titre "Drop-in de lancement du kiosque"
LANCEMENT_CAGE="$(ligne_lancement cage /usr/bin/chromium http://127.0.0.1:8766)"
LANCEMENT_X11="$(ligne_lancement x11 /usr/bin/chromium-browser http://127.0.0.1:8766)"
verifier_contient "cage : ExecStart vide d'abord" "ExecStart=" "$LANCEMENT_CAGE"
# Le compositeur lance le LANCEUR, plus jamais chromium directement : c'est le
# lanceur qui journalise la sortie et le code de fin du navigateur (un chromium
# qui meurt sous cage ne laissait AUCUNE trace). Le navigateur resolu passe par
# l'environnement du service.
verifier_contient "cage : lance le lanceur via cage" "/usr/bin/cage -- /opt/badgeuse/deploy/kiosk-client.sh" "$LANCEMENT_CAGE"
verifier_contient "cage : navigateur resolu transmis en environnement" "NAVIGATEUR_BIN=/usr/bin/chromium" "$LANCEMENT_CAGE"
verifier_contient "cage : session wayland" "XDG_SESSION_TYPE=wayland" "$LANCEMENT_CAGE"
verifier_contient "x11 : lance le lanceur via xinit" "/usr/bin/xinit /opt/badgeuse/deploy/kiosk-client.sh" "$LANCEMENT_X11"
verifier_contient "x11 : navigateur resolu transmis en environnement" "NAVIGATEUR_BIN=/usr/bin/chromium-browser" "$LANCEMENT_X11"
verifier_contient "x11 : session x11" "XDG_SESSION_TYPE=x11" "$LANCEMENT_X11"
verifier_contient "x11 : vt1 sans ecoute TCP" "-- :0 vt1 -nolisten tcp" "$LANCEMENT_X11"
# Un kiosque ne recoit JAMAIS de frappe : sans ces deux options, l'economiseur
# du serveur X noircit l'ecran au bout de 10 min et le DPMS met le moniteur en
# veille — en pleine journee, indiscernable d'une panne pour l'atelier.
verifier_contient "x11 : economiseur X desactive" "-s off" "$LANCEMENT_X11"
verifier_contient "x11 : mise en veille DPMS desactivee" "-dpms" "$LANCEMENT_X11"
verifier_absent  "cage : aucune option X (Wayland n'a pas d'economiseur)" "-dpms" "$LANCEMENT_CAGE"
# X11 ne peut PAS demarrer sous les durcissements de l'unite de base :
# NoNewPrivileges neutralise le setuid d'Xorg.wrap, ProtectHome empeche xinit
# d'ecrire .Xauthority. Ces levees sont donc load-bearing — et strictement
# reservees a X11 : la voie Wayland doit rester entierement durcie.
verifier_contient "x11 : setuid Xorg.wrap autorise" "NoNewPrivileges=no" "$LANCEMENT_X11"
verifier_contient "x11 : acces au home pour .Xauthority" "ProtectHome=no" "$LANCEMENT_X11"
verifier_absent  "cage : durcissement conserve (NoNewPrivileges)" "NoNewPrivileges=no" "$LANCEMENT_CAGE"
verifier_absent  "cage : durcissement conserve (ProtectHome)" "ProtectHome=no" "$LANCEMENT_CAGE"
# Le navigateur ne doit JAMAIS etre code en dur dans le drop-in : c'est celui
# resolu a l'installation qui doit s'y trouver.
verifier_absent "x11 : pas de chromium code en dur" "/usr/bin/chromium " "$LANCEMENT_X11"

titre "Coherence croisee flags <-> drop-in (le defaut du terrain)"
for compositeur in cage x11; do
  FLAGS="$(flags_chromium "$compositeur" pi5)"
  LANCEMENT="$(ligne_lancement "$compositeur" /usr/bin/chromium)"
  case "$compositeur" in
    cage)
      if printf '%s' "$LANCEMENT" | grep -q '/usr/bin/cage' \
         && printf '%s' "$FLAGS" | grep -q -- '--ozone-platform=wayland'; then
        verifier "cage : options et lancement d'accord" "ok" "ok"
      else
        verifier "cage : options et lancement d'accord" "ok" "incoherent"
      fi ;;
    x11)
      if printf '%s' "$LANCEMENT" | grep -q '/usr/bin/xinit' \
         && ! printf '%s' "$FLAGS" | grep -q -- '--ozone-platform=wayland'; then
        verifier "x11 : options et lancement d'accord" "ok" "ok"
      else
        verifier "x11 : options et lancement d'accord" "ok" "incoherent"
      fi ;;
  esac
done

# --------------------------------------------------------- 5. lecture de conf

titre "Lecture de la configuration du poste (INI)"
CONF="$TRAVAIL/badgeuse.conf"
cat > "$CONF" <<'FIN'
; commentaire
[server]
url = https://solidata.online
device_code = LH-P1

[ui]
;http_port = 9999
http_port = 8123

[dpms]
allumage = 05:30
extinction = 21:30
FIN
verifier "cle lue dans la bonne section" "LH-P1" "$(lire_cle_ini "$CONF" server device_code)"
verifier "commentaire ignore" "8123" "$(lire_cle_ini "$CONF" ui http_port)"
verifier "cle absente : vide" "" "$(lire_cle_ini "$CONF" ui ws_port)"
verifier "fichier absent : vide" "" "$(lire_cle_ini "$TRAVAIL/nexiste.pas" ui http_port)"
verifier "port du kiosque" "8123" "$(port_kiosque "$CONF")"
verifier "port par defaut si absent" "8766" "$(port_kiosque "$TRAVAIL/nexiste.pas")"

cat > "$TRAVAIL/mauvais.conf" <<'FIN'
[ui]
http_port = huit-mille
FIN
verifier "port illisible : defaut connu" "8766" "$(port_kiosque "$TRAVAIL/mauvais.conf")"

# ------------------------------------------- 5 bis. make-conf.sh de bout en bout

titre "make-conf.sh : ecriture reelle d'une configuration"
# Les deux cles passent par l'environnement (jamais par la ligne de commande :
# elles seraient visibles dans `ps`). Aucune saisie clavier n'est requise.
CONF_GEN="$TRAVAIL/genere/badgeuse.conf"
SORTIE_CONF="$(
  BADGEUSE_DEVICE_KEY="$(printf 'a%.0s' $(seq 1 64))" \
  BADGEUSE_HMAC_KEY="$(printf '0123456789abcdef%.0s' $(seq 1 4))" \
  bash "$RACINE/make-conf.sh" --output "$CONF_GEN" --code LH-TEST --target pi3 \
       --url https://solidata.online --force </dev/null 2>&1
)"
CODE_CONF=$?
verifier "make-conf rend 0" "0" "$CODE_CONF"
verifier "fichier ecrit" "oui" "$([ -f "$CONF_GEN" ] && echo oui || echo non)"
verifier "permissions 0600" "600" "$(stat -c '%a' "$CONF_GEN" 2>/dev/null)"
verifier "cible reportee" "pi3" "$(lire_cle_ini "$CONF_GEN" system target)"
verifier "code du poste reporte" "LH-TEST" "$(lire_cle_ini "$CONF_GEN" server device_code)"
verifier_contient "validee par l'agent lui-meme" "contrôle de validité : OK" "$SORTIE_CONF"
verifier_absent "aucun bruit /dev/tty" "/dev/tty: No such device" "$SORTIE_CONF"
verifier_absent "la cle du poste n'est pas reaffichee" \
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" "$SORTIE_CONF"

# Une cle HMAC de mauvaise longueur doit etre refusee AVANT d'ecrire quoi que
# ce soit : le poste ne demarrerait pas, autant le dire tout de suite.
CODE_CONF=0
BADGEUSE_DEVICE_KEY="$(printf 'a%.0s' $(seq 1 64))" \
BADGEUSE_HMAC_KEY="trop-courte" \
bash "$RACINE/make-conf.sh" --output "$TRAVAIL/genere/refuse.conf" --code LH-TEST \
     --target pi5 --url https://solidata.online --force </dev/null >/dev/null 2>&1 || CODE_CONF=$?
verifier "cle HMAC invalide refusee" "1" "$CODE_CONF"
verifier "aucun fichier ecrit" "non" \
  "$([ -f "$TRAVAIL/genere/refuse.conf" ] && echo oui || echo non)"

# ------------------------------------------------- 6. coherence des scripts

titre "Coherence des scripts entre eux"
# La commande recommandee par le diagnostic doit exister.
verifier_contient "diagnostic renvoie vers install.sh" \
  "/opt/badgeuse/deploy/install.sh" "$(cat "$RACINE/diagnostic.sh")"
# install.sh doit passer par la bibliotheque testee, pas par des copies.
verifier_contient "install.sh source lib.sh" "lib.sh" "$(cat "$RACINE/install.sh")"
verifier_absent "install.sh ne redefinit pas deployer()" \
  "deployer() {" "$(cat "$RACINE/install.sh")"
# Le kiosque ne doit pas etre lance avec un chemin de navigateur en dur.
verifier_absent "aucun ExecStart chromium en dur dans l'unite" \
  "ExecStart=/usr/bin/cage -- /usr/bin/chromium" \
  "$(cat "$RACINE/systemd/badgeuse-kiosk.service" | grep -v '^#')"
# La plage d'allumage suit l'heure de REFERENCE du poste (Europe/Paris) et non
# le fuseau systeme : sur une image restee en UTC, l'ecran s'eteignait deux
# heures trop tot.
verifier_contient "dpms lit l'heure en Europe/Paris" \
  "TZ=Europe/Paris date" "$(cat "$RACINE/dpms.sh")"
verifier_contient "install.sh aligne le fuseau du systeme" \
  "set-timezone Europe/Paris" "$(cat "$RACINE/install.sh")"

# ------------------------------------------------------------------ bilan

printf '\n----------------------------------------\n'
printf 'Tests de deploiement : %d ok, %d KO\n' "$OK" "$KO"
[ "$KO" -eq 0 ] || exit 1
exit 0
