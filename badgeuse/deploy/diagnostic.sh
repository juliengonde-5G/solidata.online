#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# Poste de pointage SOLIDATA — DIAGNOSTIC EN UNE COMMANDE
#
#   sudo bash /opt/badgeuse/deploy/diagnostic.sh
#
# Ne modifie RIEN. Rassemble en une passe tout ce qu'il faut pour comprendre
# pourquoi l'ecran n'affiche pas l'interface de pointage, et affiche un verdict
# en clair suivi de la commande de correction.
#
# A copier-coller integralement quand on demande de l'aide.
# -----------------------------------------------------------------------------
set -uo pipefail   # pas de -e : un diagnostic ne doit JAMAIS s'arreter en route

titre() { printf '\n\033[1m=== %s\033[0m\n' "$*"; }
ligne() { printf '    %-34s %s\n' "$1" "$2"; }

CAUSES=()
retenir() { CAUSES+=("$1"); }

printf '\n########## DIAGNOSTIC BADGEUSE — %s ##########\n' "$(date '+%Y-%m-%d %H:%M:%S %Z')"

# ── 1. La machine redemarre-t-elle vraiment ? ────────────────────────────────
titre "1. Machine"
MODELE=inconnu
[ -r /proc/device-tree/model ] && MODELE="$(tr -d '\0' < /proc/device-tree/model)"
ligne "modele" "$MODELE"
ligne "allume depuis" "$(uptime -p 2>/dev/null || uptime)"
ligne "demarrages enregistres" "$(journalctl --list-boots --no-pager 2>/dev/null | wc -l)"
if command -v vcgencmd >/dev/null 2>&1; then
  ETAT_ALIM="$(vcgencmd get_throttled 2>/dev/null)"
  # get_throttled est un champ de bits, PAS un booleen — l'annoncer en bloc
  # comme une sous-tension etait FAUX (constate : 0x80000 = limite thermique
  # PASSEE, presentee comme un defaut d'alimentation). Bits utiles :
  #   0 sous-tension EN COURS   / 16 survenue depuis le demarrage
  #   3 limite thermique EN COURS / 19 survenue depuis le demarrage
  VAL=$(( $(printf '%d' "0x${ETAT_ALIM#throttled=0x}" 2>/dev/null || echo 0) ))
  DETAIL=""
  [ $((VAL & 1)) -ne 0 ]        && DETAIL="${DETAIL}sous-tension EN COURS ; "
  [ $((VAL & 65536)) -ne 0 ]    && DETAIL="${DETAIL}sous-tension survenue depuis le demarrage ; "
  [ $((VAL & 8)) -ne 0 ]        && DETAIL="${DETAIL}limite thermique EN COURS ; "
  [ $((VAL & 524288)) -ne 0 ]   && DETAIL="${DETAIL}limite thermique atteinte par le passe ; "
  ligne "alimentation/thermique" "${ETAT_ALIM}${DETAIL:+ — ${DETAIL%% ; }}"
  if [ $((VAL & 65537)) -ne 0 ]; then
    retenir "ALIMENTATION : ${ETAT_ALIM} — sous-tension ($( [ $((VAL & 1)) -ne 0 ] && echo EN COURS || echo survenue depuis le demarrage)). Le Pi 5 exige un bloc 5 V / 5 A. Remplacer l'alimentation AVANT tout autre diagnostic."
  fi
  if [ $((VAL & 8)) -ne 0 ]; then
    retenir "TEMPERATURE : limite thermique EN COURS — le processeur est bride. Verifier ventilation/dissipateur."
  fi
fi

# ── 2. Services ──────────────────────────────────────────────────────────────
titre "2. Services"
# systemctl is-active ECRIT l'etat sur stdout ET rend un code non nul des que
# l'etat n'est pas « active » (« activating », « failed »...). Un `|| echo` ici
# affichait donc DEUX lignes : l'etat reel, puis « inactif ». On lit la sortie,
# on ignore le code.
etat_service() {
  local e; e="$(systemctl is-active "$1" 2>/dev/null)"
  printf '%s' "${e:-inconnu}"
}
for s in badgeuse-agent badgeuse-kiosk; do
  ligne "$s" "$(etat_service "$s")"
done
ligne "getty@tty1 (invite login)" "$(etat_service getty@tty1.service)"

KIOSQUE_OK=0; systemctl is-active --quiet badgeuse-kiosk 2>/dev/null && KIOSQUE_OK=1
AGENT_OK=0;   systemctl is-active --quiet badgeuse-agent 2>/dev/null && AGENT_OK=1

if [ "$KIOSQUE_OK" -eq 0 ] && systemctl is-active --quiet getty@tty1.service 2>/dev/null; then
  retenir "CONSOLE OCCUPEE : getty@tty1 tient /dev/tty1, que le kiosque reclame en tty-fail. Corriger :
      sudo systemctl disable --now getty@tty1.service && sudo systemctl restart badgeuse-kiosk"
fi

# ── 3. De quoi afficher ? ────────────────────────────────────────────────────
titre "3. Briques d'affichage"
NAV=""
for c in /usr/bin/chromium /usr/bin/chromium-browser; do
  [ -x "$c" ] && { NAV="$c"; break; }
done
ligne "navigateur" "${NAV:-ABSENT}"
ligne "cage (Wayland)" "$(command -v cage 2>/dev/null || echo absent)"
ligne "xinit (repli X11)" "$(command -v xinit 2>/dev/null || echo absent)"
[ -n "$NAV" ] || retenir \
  "NAVIGATEUR ABSENT : ni /usr/bin/chromium ni /usr/bin/chromium-browser. cage demarre sans client, l'ecran reste NOIR. Corriger :
      sudo apt-get install -y chromium && sudo bash /opt/badgeuse/deploy/install.sh"

# Chemin reellement lance par systemd, et son existence : un ExecStart pointant
# sur un binaire absent echoue en 203/EXEC, symptome = ecran noir muet.
CMD="$(systemctl show badgeuse-kiosk -p ExecStart --value 2>/dev/null | head -c 400)"
[ -n "$CMD" ] && printf '    commande lancee :\n      %s\n' "$CMD"
for mot in $CMD; do
  case "$mot" in
    /usr/bin/chromium*|/usr/bin/cage|/usr/bin/xinit)
      [ -x "$mot" ] || retenir "BINAIRE INTROUVABLE : la commande du kiosque reference ${mot}, qui n'existe pas — le service echoue a chaque essai et l'ecran reste NOIR. Corriger :
      sudo bash /opt/badgeuse/deploy/install.sh" ;;
  esac
done

# L'unite livree ne DEVINE pas la commande de lancement : elle refuse de
# demarrer tant que install.sh n'a pas pose le drop-in correspondant au
# compositeur et au navigateur reellement installes.
case "$CMD" in
  *"kiosque non configure"*)
    retenir "KIOSQUE NON CONFIGURE : le drop-in lancement.conf n'a pas ete pose (installation interrompue ?). Le service refuse de demarrer plutot que de lancer une commande devinee. Corriger :
      sudo bash /opt/badgeuse/deploy/install.sh --target pi5" ;;
esac

# Repli X11 : le kiosque tourne en utilisateur non privilegie. Seul le wrapper
# setuid /usr/lib/xorg/Xorg.wrap (paquet xserver-xorg-legacy) autorise un
# non-root a demarrer le serveur X. Absent, xinit rend 1 SANS AUCUN MESSAGE.
case "$CMD" in
  *xinit*)
    ligne "mode" "repli X11 (xinit)"
    if [ -u /usr/lib/xorg/Xorg.wrap ]; then
      ligne "Xorg.wrap (setuid)" "present"
    else
      ligne "Xorg.wrap (setuid)" "ABSENT"
      retenir "SERVEUR X NON DEMARRABLE : le kiosque tourne sous l'utilisateur « badgeuse » (non root) et /usr/lib/xorg/Xorg.wrap est absent ou non setuid. xinit echoue immediatement, sans message. Corriger, de preference en passant a Wayland :
      sudo apt-get install -y cage wlr-randr && sudo bash /opt/badgeuse/deploy/install.sh
   ou, si cage n'est pas installable, en completant le repli X11 :
      sudo apt-get install -y xserver-xorg-legacy && sudo bash /opt/badgeuse/deploy/install.sh"
    fi
    ligne "allowed_users" "$(grep -h '^allowed_users' /etc/X11/Xorg.wrap.config 2>/dev/null || echo 'non defini (defaut: console)')"
    ;;
esac

# COHERENCE compositeur <-> options du navigateur. install.sh ecrit kiosk.env ET
# la commande de lancement dans la MEME passe, a partir de la meme decision.
# Mais si cage est installe A LA MAIN apres coup, la commande passe a Wayland
# tandis que kiosk.env garde les options X11 : Chromium tente alors X11 sous un
# compositeur Wayland, ne trouve pas de DISPLAY et sort aussitot — cage reste
# seul a l'ecran, qui demeure noir. Panne silencieuse, d'ou ce controle.
ENV_KIOSK=/etc/badgeuse/kiosk.env
if [ -r "$ENV_KIOSK" ]; then
  FLAGS="$(grep -h '^CHROMIUM_FLAGS=' "$ENV_KIOSK" 2>/dev/null | head -1)"
  case "$FLAGS" in
    *ozone-platform=wayland*) ligne "options navigateur" "Wayland" ;;
    *)                        ligne "options navigateur" "X11 (pas d'option Wayland)" ;;
  esac
  case "$CMD:$FLAGS" in
    *cage*:*ozone-platform=wayland*) : ;;
    *cage*:*)
      retenir "OPTIONS INCOHERENTES : le kiosque demarre sous cage (Wayland) mais ${ENV_KIOSK} ne contient pas --ozone-platform=wayland. Chromium tente X11, ne trouve pas d'affichage et sort immediatement : cage reste seul, l'ecran est noir. Corriger en regenerant la configuration :
      sudo bash /opt/badgeuse/deploy/install.sh" ;;
  esac
else
  ligne "options navigateur" "ABSENT (${ENV_KIOSK})"
fi

# Le compositeur vivant ne prouve PAS que le navigateur affiche : cage peut
# tenir l'ecran alors que son client est mort ou n'a jamais peint. On liste donc
# les processus REELLEMENT dans le cgroup du service, et depuis combien de temps.
titre "3 bis. Processus du kiosque"
DEPUIS="$(systemctl show badgeuse-kiosk -p ActiveEnterTimestamp --value 2>/dev/null)"
ligne "actif depuis" "${DEPUIS:-inconnu}"
ligne "redemarrages" "$(systemctl show badgeuse-kiosk -p NRestarts --value 2>/dev/null || echo '?')"

# NE PAS deviner le chemin du cgroup. PAMName=login fait enregistrer une session
# aupres de logind, qui peut deplacer les processus hors de
# system.slice/<unite>/ : le cgroup.procs de l'unite est alors VIDE et une
# lecture naive conclut a tort « aucun navigateur » (faux positif constate).
# On part du MainPID reel, on lit SON cgroup, et on enumere les processus de
# l'utilisateur du kiosque — independant de l'endroit ou logind les a places.
MAINPID="$(systemctl show badgeuse-kiosk -p MainPID --value 2>/dev/null)"
ligne "MainPID" "${MAINPID:-0}"
if [ -n "${MAINPID:-}" ] && [ "${MAINPID:-0}" != "0" ] && [ -r "/proc/${MAINPID}/cgroup" ]; then
  ligne "cgroup du MainPID" "$(sed -n 's/^0:://p' "/proc/${MAINPID}/cgroup" 2>/dev/null | head -1)"
fi

NAV_VU=0
PROCS_VUS=0
while read -r pid nom tps; do
  [ -n "$pid" ] || continue
  PROCS_VUS=1
  ligne "  pid ${pid}" "${nom} (${tps} s)"
  case "$nom" in chromium*|chrome*) NAV_VU=1 ;; esac
done <<EOF
$(ps -u badgeuse -o pid=,comm=,etimes= --no-headers 2>/dev/null \
    | awk '$2 != "python" && $2 != "python3" { print $1, $2, $3 }')
EOF
[ "$PROCS_VUS" -eq 1 ] || ligne "processus" "aucun (hors agent)"

if [ "$KIOSQUE_OK" -eq 1 ] && [ "$NAV_VU" -eq 0 ]; then
  retenir "COMPOSITEUR SEUL : le service est actif, mais aucun processus chromium ne tourne sous l'utilisateur du kiosque — l'ecran affiche un fond vide. La cause exacte est dans la section 6 bis (lanceur + sortie de chromium et code de fin). Si elle est vide, l'installation est anterieure, ou le client n'a jamais ete lance :
      sudo bash /opt/badgeuse/deploy/install.sh && sudo systemctl restart badgeuse-kiosk"
fi

# La session graphique : cage ne peut prendre l'ecran que si logind lui accorde
# le CONTROLE DU SEAT — ce qui suppose une session rattachee a seat0 et ACTIVE
# (le VT au premier plan). Sinon, cage attend en silence : vivant, sans client,
# sans une ligne de journal, sourd a SIGTERM. C'est indiscernable d'un ecran
# casse sans cette section.
titre "3 ter. Session graphique du kiosque (seat/logind)"
SESSION_ID=""
if [ -n "${MAINPID:-}" ] && [ "${MAINPID:-0}" != "0" ] && [ -r "/proc/${MAINPID}/cgroup" ]; then
  SESSION_ID="$(sed -n 's/.*session-\([0-9a-zA-Z]*\)\.scope.*/\1/p' "/proc/${MAINPID}/cgroup" | head -1)"
fi
if [ -n "$SESSION_ID" ] && command -v loginctl >/dev/null 2>&1; then
  ligne "session logind" "$SESSION_ID"
  ETAT_SESSION="$(loginctl show-session "$SESSION_ID" -p State --value 2>/dev/null)"
  SEAT_SESSION="$(loginctl show-session "$SESSION_ID" -p Seat --value 2>/dev/null)"
  ACTIVE_SESSION="$(loginctl show-session "$SESSION_ID" -p Active --value 2>/dev/null)"
  ligne "  etat" "${ETAT_SESSION:-inconnu}"
  ligne "  seat" "${SEAT_SESSION:-AUCUN}"
  ligne "  active (VT au premier plan)" "${ACTIVE_SESSION:-inconnu}"
  if [ "$KIOSQUE_OK" -eq 1 ] && { [ -z "$SEAT_SESSION" ] || [ "$ACTIVE_SESSION" = "no" ]; }; then
    retenir "SEAT NON ACCORDE : la session du kiosque n'est pas rattachee a un seat actif (seat='${SEAT_SESSION:-aucun}', active='${ACTIVE_SESSION:-?}'). cage attend la prise de controle et ne lancera JAMAIS son client — ecran vide, aucune erreur. Essayer d'abord de remettre le VT1 au premier plan :
      sudo chvt 1 && sleep 3 && sudo systemctl restart badgeuse-kiosk
   puis relancer ce diagnostic. Si active reste 'no', transmettre cette section au support."
  fi
else
  ligne "session logind" "indeterminee"
fi
# Sessions residuelles : une session badgeuse morte qui detient encore
# seat0/tty1 prive TOUTES les suivantes du seat — c'est exactement la panne
# constatee (session du premier demarrage jamais cloturee apres un SIGKILL).
if command -v loginctl >/dev/null 2>&1; then
  SESSIONS_BADGEUSE="$(loginctl list-sessions --no-pager 2>/dev/null | awk '$3 == "badgeuse" && $6 !~ /manager/ { print $1, $4, $7 }')"
  if [ -n "$SESSIONS_BADGEUSE" ]; then
    NB_SESS="$(printf '%s\n' "$SESSIONS_BADGEUSE" | wc -l)"
    ligne "sessions badgeuse (id seat tty)" "${NB_SESS}"
    printf '%s\n' "$SESSIONS_BADGEUSE" | sed 's/^/      /'
    if [ "$NB_SESS" -gt 1 ] || { [ -n "$SESSION_ID" ] && ! printf '%s\n' "$SESSIONS_BADGEUSE" | awk -v s="$SESSION_ID" '$1 == s && $2 == "seat0" { trouve = 1 } END { exit trouve ? 0 : 1 }'; }; then
      retenir "SESSION RESIDUELLE : une ancienne session badgeuse detient seat0/tty1 pendant que la session COURANTE du kiosque n'a pas de seat — cage attend un controle que logind ne peut plus accorder. Purger puis relancer :
      sudo loginctl terminate-user badgeuse && sleep 2 && sudo systemctl restart badgeuse-kiosk
   (les versions d'install.sh posterieures au 19/08 apres-midi font cette purge a chaque demarrage du kiosque)"
    fi
  fi
fi

# Ce que cage et libseat ont dit, eux : rien = blocage avant toute sortie.
SORTIE_CAGE="$(journalctl -u badgeuse-kiosk --no-pager 2>/dev/null | grep -Ei 'cage|wlr|libseat|seat' | grep -v 'pam_unix\|systemd\[1\]' | tail -8)"
if [ -n "$SORTIE_CAGE" ]; then
  echo "    sortie compositeur/libseat (8 dernieres) :"
  printf '%s\n' "$SORTIE_CAGE" | sed 's/^/      /'
else
  ligne "sortie compositeur" "AUCUNE — blocage avant toute initialisation"
fi

# ── 4. L'interface est-elle servie ? ─────────────────────────────────────────
titre "4. Interface locale (servie par l'agent)"
if command -v curl >/dev/null 2>&1; then
  CODE="$(curl -s -o /dev/null -m 5 -w '%{http_code}' http://127.0.0.1:8766 2>/dev/null)"
  ligne "http://127.0.0.1:8766" "${CODE:-injoignable}"
  [ "$CODE" = "200" ] || retenir \
    "INTERFACE INJOIGNABLE (reponse « ${CODE:-aucune} ») : le kiosque n'a rien a afficher. Voir les journaux de l'agent ci-dessous."
else
  ligne "http://127.0.0.1:8766" "curl absent — non teste"
fi

# ── 4 bis. Lecteur de badge ──────────────────────────────────────────────────
# Symptome vecu sur le terrain : le journal annonce « lecteur connecte » et
# AUCUN badge n'arrive. Un lecteur RFID HID expose souvent deux interfaces
# /dev/input/eventN indiscernables, dont une seule emet les frappes : le poste
# les ecoute donc TOUTES. Cette section montre ce qu'il voit et ce qu'il saisit.
# Aucune frappe n'est lue ici : le diagnostic ne peut pas divulguer un UID.
titre "4 bis. Lecteur de badge"
AGENT_PY=/opt/badgeuse/venv/bin/python
if [ -x "$AGENT_PY" ] && [ -d /opt/badgeuse/agent ]; then
  SORTIE_LECTEURS="$(BADGEUSE_CONFIG=/etc/badgeuse/badgeuse.conf \
      PYTHONPATH=/opt/badgeuse/agent "$AGENT_PY" -m badgeuse_agent --lecteurs 2>&1)"
  CODE_LECTEURS=$?
  printf '%s\n' "$SORTIE_LECTEURS" | sed 's/^/    /'
  if [ "$CODE_LECTEURS" -ne 0 ]; then
    retenir "LECTEUR NON SAISI : aucune interface d'entree ne peut composer un badge (detail ci-dessus). Verifier le branchement USB, puis :
      lsusb && sudo systemctl restart badgeuse-agent"
  fi
else
  ligne "agent installe" "non (/opt/badgeuse absent)"
fi

# Preuve du flux REEL : la trace est posee a la premiere frappe de chaque
# interface. Presente = le lecteur parle ; absente = il ne parle pas, ou pas a
# nous (interface non saisie, cable, alimentation).
NB_FRAPPES="$(journalctl -u badgeuse-agent --no-pager 2>/dev/null | grep -c 'premiere frappe recue')"
if [ "${NB_FRAPPES:-0}" -gt 0 ]; then
  ligne "frappes recues (journal)" "${NB_FRAPPES}"
  printf '    derniere :\n      %s\n' "$(journalctl -u badgeuse-agent --no-pager 2>/dev/null | grep 'premiere frappe recue' | tail -1)"
else
  ligne "frappes recues (journal)" "AUCUNE"
  if [ "$AGENT_OK" -eq 1 ]; then
    retenir "AUCUNE FRAPPE RECUE : l'agent tourne et a saisi une ou plusieurs interfaces, mais rien n'en sort. Passer un badge et surveiller :
      journalctl -u badgeuse-agent -f
   Si la ligne « premiere frappe recue » n'apparait pas, le lecteur n'emet rien vers le poste (cable, alimentation, mode du lecteur — il doit etre en emulation clavier)."
  fi
fi

# Lectures emises mais REFUSEES par la normalisation : le compteur et la
# derniere ligne (metadonnees sans contenu) disent comment regler le lecteur.
NB_NONCONF="$(journalctl -u badgeuse-agent --no-pager 2>/dev/null | grep -c 'lecture de badge non conforme')"
if [ "${NB_NONCONF:-0}" -gt 0 ]; then
  ligne "lectures refusees (non conformes)" "${NB_NONCONF}"
  printf '    derniere :\n      %s\n' "$(journalctl -u badgeuse-agent --no-pager 2>/dev/null | grep 'lecture de badge non conforme' | tail -1)"
  retenir "LECTURES REFUSEES : le lecteur emet, mais dans un format hors contrat (8/14/20 hexadecimaux, ou 10 chiffres). La derniere ligne ci-dessus donne longueur et composition SANS le contenu — regler le mode d'emission du lecteur (hexadecimal, sans prefixe/suffixe), ou transmettre cette ligne au support."
fi

titre "4 ter. File de pointages"
DB=/var/lib/badgeuse/badgeuse.db
if [ -r "$DB" ] && command -v sqlite3 >/dev/null 2>&1; then
  ligne "en attente d'envoi" "$(sqlite3 "$DB" 'SELECT COUNT(*) FROM queue;' 2>/dev/null || echo '?')"
  ligne "pointages locaux" "$(sqlite3 "$DB" 'SELECT COUNT(*) FROM pointages_locaux;' 2>/dev/null || echo '?')"
  ligne "badges connus (cache)" "$(sqlite3 "$DB" 'SELECT COUNT(*) FROM badges;' 2>/dev/null || echo '?')"
elif [ -r "$DB" ]; then
  ligne "base locale" "presente (installer sqlite3 pour le detail)"
else
  ligne "base locale" "ABSENTE (${DB})"
fi
DERNIER_ENVOI="$(journalctl -u badgeuse-agent --no-pager 2>/dev/null \
  | grep -E 'POST .*/pointages' | tail -1)"
if [ -n "$DERNIER_ENVOI" ]; then
  printf '    dernier envoi de pointages :\n      %s\n' "$DERNIER_ENVOI"
else
  ligne "envoi de pointages" "AUCUN depuis le demarrage"else
  ligne "envoi de pointages" "AUCUN depuis le demarrage"
fi

# ── 5. Ecran physique ────────────────────────────────────────────────────────
titre "5. Ecran"
if [ -d /sys/class/drm ]; then
  for e in /sys/class/drm/card*-HDMI*; do
    [ -e "$e/status" ] || continue
    ligne "$(basename "$e")" "$(cat "$e/status" 2>/dev/null)"
  done
fi
CONF=/etc/badgeuse/badgeuse.conf
if [ -r "$CONF" ]; then
  DEB="$(grep -E '^\s*(screen_on|allumage)' "$CONF" 2>/dev/null | head -1)"
  FIN="$(grep -E '^\s*(screen_off|extinction)' "$CONF" 2>/dev/null | head -1)"
  ligne "plage d'allumage" "${DEB:-non defini} / ${FIN:-non defini}"
  ligne "heure locale du poste" "$(date '+%H:%M')"
fi

# ── 6. Journaux ──────────────────────────────────────────────────────────────
titre "6. Journaux — kiosque (20 dernieres lignes)"
journalctl -u badgeuse-kiosk -n 20 --no-pager 2>/dev/null | sed 's/^/    /' \
  || echo "    (journal indisponible)"

titre "6 bis. Sortie du lanceur et de chromium (journal de l'unite)"
# Le lanceur ecrit sur son stderr HERITE (prefixe « kiosk-client: »), chromium
# aussi : tout est dans le journal de l'unite — aucun intermediaire qui puisse
# bloquer ou se perdre.
SORTIE_CLIENT="$(journalctl -u badgeuse-kiosk --no-pager 2>/dev/null | grep -E 'kiosk-client:|chromium' | tail -12)"
if [ -n "$SORTIE_CLIENT" ]; then
  printf '%s\n' "$SORTIE_CLIENT" | sed 's/^/    /'
else
  echo "    (aucune ligne du lanceur — installation anterieure, ou client jamais lance : relancer install.sh)"
fi

titre "7. Journaux — agent (20 dernieres lignes)"
journalctl -u badgeuse-agent -n 20 --no-pager 2>/dev/null | sed 's/^/    /' \
  || echo "    (journal indisponible)"

# Le serveur X n'ecrit pas dans journald mais dans son propre fichier : sans
# cette section, la cause reelle d'un echec X11 reste invisible.
case "$CMD" in
  *xinit*)
    titre "7 bis. Journal du serveur X"
    TROUVE=0
    for j in /home/badgeuse/.local/share/xorg/Xorg.0.log /var/log/Xorg.0.log; do
      if [ -r "$j" ]; then
        TROUVE=1
        printf '    %s (10 dernieres lignes) :\n' "$j"
        tail -n 10 "$j" | sed 's/^/      /'
      fi
    done
    [ "$TROUVE" -eq 1 ] || echo "    aucun journal Xorg — le serveur n'a jamais demarre"
    ;;
esac

# ── 8. Verdict ───────────────────────────────────────────────────────────────
titre "8. Verdict"
if [ "${#CAUSES[@]}" -eq 0 ]; then
  if [ "$KIOSQUE_OK" -eq 1 ] && [ "$AGENT_OK" -eq 1 ]; then
    echo "    Les deux services tournent, le navigateur est vivant dans le"
    echo "    kiosque, et l'interface repond en 200."
    echo
    echo "    Si l'ecran reste noir malgre cela, la piste n'est plus logicielle :"
    echo "    verifier la section 5 (HDMI « connected »), la plage d'allumage,"
    echo "    l'entree selectionnee sur l'ecran, et le cable micro-HDMI (sur"
    echo "    Raspberry Pi 5, la prise la PLUS PROCHE de l'alimentation)."
  elif [ "$KIOSQUE_OK" -eq 0 ]; then
    echo "    Le kiosque echoue alors que toutes les briques semblent presentes."
    echo "    Les journaux des sections 6 et 7 bis portent la cause exacte."
    echo
    echo "    Piste la plus frequente — repasser a Wayland, qui n'exige aucun"
    echo "    privilege particulier la ou X en demande :"
    echo "      sudo apt-get install -y cage wlr-randr"
    echo "      sudo bash /opt/badgeuse/deploy/install.sh"
  else
    echo "    Aucune cause connue reconnue automatiquement."
    echo "    Transmettre l'integralite de cette sortie au referent."
  fi
else
  printf '    %d cause(s) probable(s), par ordre de traitement :\n\n' "${#CAUSES[@]}"
  n=0
  for c in "${CAUSES[@]}"; do
    n=$((n + 1))
    printf '    %d. %s\n\n' "$n" "$c"
  done
fi
printf '########## FIN DU DIAGNOSTIC ##########\n\n'
