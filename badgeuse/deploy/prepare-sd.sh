#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# Préparation de la carte SD — À LANCER SUR LE PC, pas sur le Raspberry.
#
#   bash badgeuse/deploy/prepare-sd.sh /media/moi/bootfs
#   bash badgeuse/deploy/prepare-sd.sh /Volumes/bootfs        (macOS)
#
# Dépose sur la partition visible de la carte SD (celle que Windows et macOS
# montent après un flash par Raspberry Pi Imager) :
#   - le dossier « badgeuse » (code du poste, ~1 Mo) ;
#   - les DEUX configurations : badgeuse-pi5.conf et badgeuse-pi3.conf.
#
# La même carte sert donc pour les DEUX postes : chaque machine reconnaît la
# sienne au démarrage. Sur le Raspberry, il ne reste qu'une commande.
# -----------------------------------------------------------------------------
set -euo pipefail

SOURCE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="${1:-}"

info() { printf '    %s\n' "$*"; }
mourir() { printf '\n[ERREUR] %s\n\n' "$*" >&2; exit 1; }

# Lecture d'une réponse : au clavier réel si un terminal existe, sinon sur
# l'entrée standard (le script reste utilisable dans un tube ou un banc de test
# plutôt que d'échouer sur un « /dev/tty: No such device »).
if : 2>/dev/null </dev/tty; then TTY=/dev/tty; else TTY=/dev/stdin; fi
demander() {
  local invite="$1" defaut="${2:-}" reponse=""
  read -r -p "$invite" reponse <"$TTY" || true
  echo "${reponse:-$defaut}"
}

if [ -z "$DEST" ] || [ "$DEST" = "-h" ] || [ "$DEST" = "--help" ]; then
  cat <<'FIN'
Usage : bash badgeuse/deploy/prepare-sd.sh <partition bootfs de la carte SD>

  Linux  : /media/<vous>/bootfs      (voir : lsblk)
  macOS  : /Volumes/bootfs
  Windows: utiliser l'explorateur (voir docs/badgeuse/RUNBOOK.md)

Le script demande, pour chaque poste, les clés fournies par SOLIDATA
(Temps & Présence -> Supervision -> « Appairer un poste »). Un poste déjà
configuré peut être passé : sa configuration existante est conservée.
FIN
  exit 0
fi

[ -d "$DEST" ] || mourir "introuvable : ${DEST}
    Insérez la carte SD flashée, puis indiquez le chemin de la partition « bootfs »."
[ -w "$DEST" ] || mourir "écriture impossible sur ${DEST} (droits insuffisants ?)"

# Contrôle : est-ce bien une partition de démarrage Raspberry ?
if [ ! -e "${DEST}/config.txt" ] && [ ! -e "${DEST}/cmdline.txt" ]; then
  mourir "${DEST} ne ressemble pas à la partition de démarrage d'un Raspberry Pi
    (ni config.txt ni cmdline.txt). Vérifiez le chemin — écrire au mauvais
    endroit ne servirait à rien."
fi

echo "── Préparation de la carte SD : ${DEST}"

# ── 1. Le code du poste ──────────────────────────────────────────────────────
echo
echo "1/2  Copie du code du poste"
rm -rf "${DEST}/badgeuse"
mkdir -p "${DEST}/badgeuse"
for element in agent ui deploy README.md; do
  [ -e "${SOURCE}/${element}" ] && cp -r "${SOURCE}/${element}" "${DEST}/badgeuse/"
done
# Les caches Python n'ont rien à faire sur une carte de déploiement.
find "${DEST}/badgeuse" -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
info "code copié ($(du -sh "${DEST}/badgeuse" 2>/dev/null | cut -f1))"

# ── 2. Les deux configurations ───────────────────────────────────────────────
echo
echo "2/2  Configurations des deux postes"
info "Les clés sont dans SOLIDATA -> Temps & Présence -> Supervision -> « Appairer un poste »."
info "Elles ne sont affichées QU'UNE FOIS. Clé perdue : bouton « Régénérer la clé »."

for cible in pi5 pi3; do
  case "$cible" in
    pi5) role="poste STANDARD (Raspberry Pi 5)"; code_defaut="LH-P1" ;;
    pi3) role="poste de SECOURS (Raspberry Pi 3)"; code_defaut="LH-P2" ;;
  esac

  fichier="${DEST}/badgeuse-${cible}.conf"
  echo
  echo "  ── ${role} ──"

  if [ -f "$fichier" ]; then
    reponse="$(demander "    Une configuration existe déjà. La remplacer ? [o/N] " n)"
    case "$reponse" in
      [oO]*) ;;
      *) info "conservée."; continue ;;
    esac
  else
    reponse="$(demander "    Configurer ce poste maintenant ? [O/n] " o)"
    case "$reponse" in
      [nN]*) info "ignoré — à faire avant de démarrer ce poste."; continue ;;
    esac
  fi

  code="$(demander "    Code du poste [${code_defaut}] : " "$code_defaut")"

  # make-conf.sh ne demandera plus que les deux clés (saisie masquée).
  bash "${SOURCE}/deploy/make-conf.sh" \
    --output "$fichier" --target "$cible" --code "$code" --force \
    <"$TTY" || mourir "configuration du poste ${cible} abandonnée."
done

# Sur une partition FAT, les permissions n'existent pas : le fichier sera
# reposé en 0600 par sd-init.sh au moment de l'installation sur le poste.
echo
echo "############################################################"
echo "#  Carte SD prête"
echo "############################################################"
echo
info "Contenu déposé :"
ls -1 "${DEST}" | grep -E '^badgeuse' | sed 's/^/      /'
echo
info "Sur CHAQUE Raspberry, après démarrage, une seule commande :"
echo
echo "      sudo bash /boot/firmware/badgeuse/deploy/sd-init.sh"
echo
info "La machine reconnaît son modèle et prend la configuration qui lui"
info "correspond. La même carte sert donc pour les deux postes."
echo
