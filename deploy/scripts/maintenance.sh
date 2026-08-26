#!/bin/bash
# ============================================================
# SOLIDATA — Mode maintenance
#
# Pendant un déploiement, les conteneurs applicatifs redémarrent : sans ce
# mode, les utilisateurs reçoivent un « 502 Bad Gateway » nu, qui ne dit ni ce
# qui se passe, ni quoi faire, ni combien de temps ça dure.
#
# nginx, lui, ne redémarre PAS pendant une mise à jour (sa configuration est
# montée depuis le dépôt, son image n'est jamais reconstruite). C'est donc lui
# qui sert la page de maintenance, en 503, tant que le fichier témoin existe.
#
# Usage :
#   bash deploy/scripts/maintenance.sh on [raison]
#   bash deploy/scripts/maintenance.sh off
#   bash deploy/scripts/maintenance.sh status
# ============================================================

set -euo pipefail

RACINE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TEMOIN="${RACINE}/deploy/nginx/maintenance/ACTIF"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"

VERT='\033[0;32m'; JAUNE='\033[1;33m'; ROUGE='\033[0;31m'; NC='\033[0m'
log()  { echo -e "${VERT}[MAINTENANCE]${NC} $1"; }
warn() { echo -e "${JAUNE}[ATTENTION]${NC} $1"; }
err()  { echo -e "${ROUGE}[ERREUR]${NC} $1"; }

# Interroge le site À TRAVERS nginx. Un mode maintenance qu'on CROIT actif sans
# qu'il le soit serait pire que pas de mode du tout : on vérifie, on ne suppose
# pas. Renvoie le code HTTP, ou 000 si rien ne répond.
code_http() {
    curl -sk -o /dev/null -w "%{http_code}" --connect-timeout 3 --max-time 8 \
        -H "Host: solidata.online" "https://localhost/api/health" 2>/dev/null || echo "000"
}

case "${1:-status}" in
  on)
    # Pas d'apostrophe dans la valeur par défaut : à l'intérieur de
    # "${2:-…}", bash traite l'apostrophe comme une ouverture de chaîne.
    RAISON="${2:-Mise à jour de SOLIDATA}"
    mkdir -p "$(dirname "${TEMOIN}")"
    # Le contenu n'est lu par personne (nginx ne teste que l'existence) : il
    # sert à l'humain qui se demandera plus tard pourquoi le site est fermé.
    {
        echo "actif_depuis=$(date -Iseconds)"
        echo "raison=${RAISON}"
        echo "pose_par=$(whoami)@$(hostname)"
    } > "${TEMOIN}"
    log "Mode maintenance ACTIVÉ — ${RAISON}"

    CODE="$(code_http)"
    case "${CODE}" in
      503) log "Vérifié : le site répond 503 avec la page de maintenance." ;;
      000) warn "nginx ne répond pas : la page de maintenance n'est servie par personne." ;;
      *)   warn "Le site répond encore ${CODE} au lieu de 503 : la page n'est PAS servie."
           warn "Cas attendu UNE SEULE FOIS, au tout premier déploiement de cette fonctionnalité :"
           warn "nginx tourne encore sans le volume /etc/nginx/maintenance, qui n'existait pas avant."
           warn "Il sera monté au redémarrage qui suit, et les déploiements suivants afficheront la page."
           warn "Sinon : docker compose -f ${COMPOSE_FILE} exec nginx ls /etc/nginx/maintenance/" ;;
    esac
    ;;

  off)
    if [ ! -f "${TEMOIN}" ]; then
        log "Mode maintenance déjà inactif."
    else
        rm -f "${TEMOIN}"
        log "Mode maintenance LEVÉ."
    fi
    CODE="$(code_http)"
    if [ "${CODE}" = "200" ]; then
        log "Vérifié : l'application répond de nouveau (HTTP 200)."
    else
        warn "L'application répond ${CODE} — le mode est levé, mais le service n'est pas sain pour autant."
    fi
    ;;

  status)
    if [ -f "${TEMOIN}" ]; then
        log "Mode maintenance ACTIF."
        sed 's/^/  /' "${TEMOIN}"
        echo "  code HTTP observé : $(code_http)"
        echo "  pour lever : bash deploy/scripts/maintenance.sh off"
    else
        log "Mode maintenance inactif (code HTTP observé : $(code_http))."
    fi
    ;;

  *)
    err "Usage : $0 on [raison] | off | status"
    exit 1
    ;;
esac
