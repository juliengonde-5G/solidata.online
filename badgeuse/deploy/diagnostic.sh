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
  ligne "alimentation" "$ETAT_ALIM"
  [ "$ETAT_ALIM" = "throttled=0x0" ] || retenir \
    "ALIMENTATION : ${ETAT_ALIM} — sous-tension detectee. Le Pi 5 exige un bloc 5 V / 5 A. Remplacer l'alimentation AVANT tout autre diagnostic."
fi

# ── 2. Services ──────────────────────────────────────────────────────────────
titre "2. Services"
for s in badgeuse-agent badgeuse-kiosk; do
  ligne "$s" "$(systemctl is-active "$s" 2>/dev/null || echo inactif)"
done
ligne "getty@tty1 (invite login)" "$(systemctl is-active getty@tty1.service 2>/dev/null || echo inactif)"

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
      [ -x "$mot" ] || retenir "BINAIRE INTROUVABLE : l'unite lance ${mot}, qui n'existe pas (echec 203/EXEC, ecran noir). Corriger : sudo bash /opt/badgeuse/deploy/install.sh" ;;
  esac
done

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

titre "7. Journaux — agent (20 dernieres lignes)"
journalctl -u badgeuse-agent -n 20 --no-pager 2>/dev/null | sed 's/^/    /' \
  || echo "    (journal indisponible)"

# ── 8. Verdict ───────────────────────────────────────────────────────────────
titre "8. Verdict"
if [ "${#CAUSES[@]}" -eq 0 ]; then
  if [ "$KIOSQUE_OK" -eq 1 ] && [ "$AGENT_OK" -eq 1 ]; then
    echo "    Les deux services tournent et l'interface repond."
    echo "    Si l'ecran reste noir, c'est l'ecran ou le cable : verifier la"
    echo "    section 5 ci-dessus (HDMI « connected » ?) et la plage d'allumage."
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
