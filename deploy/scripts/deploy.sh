#!/bin/bash
# ============================================================
# SOLIDATA — Script de déploiement
# Usage:
#   bash deploy.sh first   — Premier déploiement (HTTP + certbot)
#   bash deploy.sh update  — Mise à jour standard
#   bash deploy.sh restart — Redémarrage sans rebuild
# ============================================================

set -euo pipefail

# Bash lit un script AU FIL de son exécution, en mémorisant un décalage d'octets.
# Or « update » fait un git pull qui peut réécrire CE fichier : la suite serait
# alors lue au même décalage dans un fichier devenu différent, donc au milieu
# d'une ligne. Le déploiement se poursuivrait en exécutant n'importe quoi.
# On repart donc d'une copie figée, que le pull ne peut plus atteindre.
if [ -z "${SOLIDATA_SELF_COPY:-}" ]; then
    COPIE_SCRIPT="$(mktemp /tmp/solidata-deploy.XXXXXX.sh)"
    cp "$0" "${COPIE_SCRIPT}"
    export SOLIDATA_SELF_COPY=1
    set +e
    bash "${COPIE_SCRIPT}" "$@"
    CODE_SORTIE=$?
    set -e
    rm -f "${COPIE_SCRIPT}"
    exit ${CODE_SORTIE}
fi

APP_DIR="/opt/solidata.online"
DOMAIN="solidata.online"
# IP PUBLIQUE (cible des enregistrements DNS), et NON l'IP d'administration
# SSH (root@51.159.128.110). C'est bien celle-ci qu'il faut ici : la variable
# ne sert qu'à vérifier que le port 80 répond depuis l'extérieur pour le défi
# ACME de Let's Encrypt — y mettre l'IP SSH ferait échouer un contrôle sain.
SERVER_IP="51.159.144.100"
EMAIL="admin@solidata.online"
REPO_URL="https://github.com/juliengonde-5G/solidata.online.git"
COMPOSE_FILE="docker-compose.prod.yml"
BACKUP_DIR="/opt/solidata.online-backups"

cd "${APP_DIR}"

# Couleurs
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[SOLIDATA]${NC} $1"; }
warn() { echo -e "${YELLOW}[ATTENTION]${NC} $1"; }
error() { echo -e "${RED}[ERREUR]${NC} $1"; exit 1; }

# Vérifications
[ -f ".env" ] || error "Fichier .env manquant ! Copiez .env.production et configurez-le."
[ -f "${COMPOSE_FILE}" ] || error "Fichier ${COMPOSE_FILE} introuvable !"

ACTION="${1:-update}"

case "${ACTION}" in

  # ===============================
  # PREMIER DEPLOIEMENT
  # ===============================
  first)
    log "=== PREMIER DÉPLOIEMENT SOLIDATA ==="

    CONF_DIR="deploy/nginx/conf.d"

    # ── Étape 0: Purge Docker ──
    log "Étape 0/7 — Purge Docker complète..."
    docker compose -f ${COMPOSE_FILE} down --remove-orphans 2>/dev/null || true
    docker stop $(docker ps -aq) 2>/dev/null || true
    docker rm -f $(docker ps -aq) 2>/dev/null || true
    docker rmi -f $(docker images -aq) 2>/dev/null || true
    for vol in $(docker volume ls -q 2>/dev/null); do
        if [ "$vol" != "solidata-pgdata" ]; then
            docker volume rm -f "$vol" 2>/dev/null || true
        fi
    done
    docker builder prune -af 2>/dev/null || true
    docker network prune -f 2>/dev/null || true
    truncate -s 0 /var/lib/docker/containers/*/*-json.log 2>/dev/null || true
    apt-get clean 2>/dev/null || true
    rm -rf /tmp/* /var/tmp/* 2>/dev/null || true
    journalctl --vacuum-size=50M 2>/dev/null || true
    log "Espace disque après purge :"
    df -h /

    # Vérifier qu'il reste assez d'espace
    AVAIL_KB=$(df / | tail -1 | awk '{print $4}')
    if [ "$AVAIL_KB" -lt 1500000 ]; then
        warn "Seulement $(( AVAIL_KB / 1024 )) Mo disponibles. Le build risque d'échouer."
        warn "Lancez d'abord : sudo bash deploy/scripts/init-server.sh"
    fi

    # ── Étape 1: Vérifications pré-déploiement ──
    log "Étape 1/7 — Vérifications pré-déploiement..."

    # Vérifier qu'aucun nginx host ne tourne (conflit de port)
    if systemctl is-active nginx &>/dev/null; then
        warn "Un Nginx HOST est actif ! Il bloque le port 80. Arrêt..."
        systemctl stop nginx
        systemctl disable nginx
    fi
    # Vérifier qu'aucun processus ne bloque le port 80
    if ss -tlnp | grep -q ':80 '; then
        warn "Port 80 déjà utilisé par :"
        ss -tlnp | grep ':80 '
        warn "Tentative de libération..."
        fuser -k 80/tcp 2>/dev/null || true
        sleep 2
    fi
    # Vérifier qu'aucun processus ne bloque le port 443
    if ss -tlnp | grep -q ':443 '; then
        warn "Port 443 déjà utilisé, libération..."
        fuser -k 443/tcp 2>/dev/null || true
        sleep 2
    fi
    # Vérifier UFW
    if command -v ufw &>/dev/null; then
        if ufw status | grep -q "Status: active"; then
            if ! ufw status | grep -q "80/tcp.*ALLOW"; then
                warn "UFW actif mais port 80 non autorisé ! Ajout..."
                ufw allow 80/tcp
                ufw allow 443/tcp
            fi
            log "UFW: port 80 et 443 ouverts"
        fi
    fi

    # ── Config HTTP-only pour certbot ──
    # Sauvegarder la config SSL UNIQUEMENT si ce n'est pas déjà une sauvegarde HTTP
    # (évite d'écraser le backup SSL en cas de re-run)
    if [ ! -f "${CONF_DIR}/solidata.conf.ssl-backup" ]; then
        cp "${CONF_DIR}/solidata.conf" "${CONF_DIR}/solidata.conf.ssl-backup"
    fi
    cp "${CONF_DIR}/solidata-initial.conf.disabled" "${CONF_DIR}/solidata.conf"

    # ── Étape 2: Pull images + Build (SANS certbot) ──
    log "Étape 2/7 — Pull images, build et démarrage en HTTP..."

    # Pré-tirer les images légères AVANT de builder (évite de manquer d'espace)
    log "  Pull des images de base..."
    docker pull nginx:alpine
    docker pull postgis/postgis:15-3.4
    log "  Espace après pull des images de base :"
    df -h /

    # Build séquentiel pour économiser le disque
    # Nettoyer les couches intermédiaires entre chaque build
    log "  Build du backend..."
    docker compose -f ${COMPOSE_FILE} build backend
    docker image prune -f 2>/dev/null || true
    log "  Build du frontend..."
    docker compose -f ${COMPOSE_FILE} build frontend
    docker image prune -f 2>/dev/null || true
    log "  Build du mobile..."
    docker compose -f ${COMPOSE_FILE} build mobile
    docker image prune -f 2>/dev/null || true

    log "  Espace après build :"
    df -h /
    AVAIL_KB=$(df / | tail -1 | awk '{print $4}')
    if [ "$AVAIL_KB" -lt 200000 ]; then
        error "Plus que $(( AVAIL_KB / 1024 )) Mo libre ! Disque trop petit pour continuer. Utilisez un serveur avec plus de stockage."
    fi

    # Démarrer SANS le service certbot (évite le conflit avec certbot certonly)
    log "  Démarrage des services (sans certbot)..."
    docker compose -f ${COMPOSE_FILE} up -d db backend frontend mobile nginx

    # Vérifier immédiatement que le conteneur nginx est créé et tourne
    sleep 5
    NGINX_STATUS=$(docker inspect -f '{{.State.Status}}' solidata-proxy 2>/dev/null || echo "not_found")
    if [ "$NGINX_STATUS" = "not_found" ]; then
        error "Le conteneur solidata-proxy n'a pas été créé ! Vérifiez 'docker compose -f ${COMPOSE_FILE} ps -a' et le disque : df -h /"
    elif [ "$NGINX_STATUS" != "running" ]; then
        warn "Conteneur nginx en état : ${NGINX_STATUS}"
        warn "Logs du conteneur nginx :"
        docker logs solidata-proxy --tail=30 2>&1 || true
        warn "Vérification du disque :"
        df -h /
        if [ "$NGINX_STATUS" = "exited" ] || [ "$NGINX_STATUS" = "dead" ]; then
            warn "Nginx a crashé. Tentative de redémarrage..."
            docker start solidata-proxy 2>/dev/null || true
            sleep 5
        fi
    else
        log "Conteneur nginx est running."
    fi

    # Attendre que nginx réponde sur le port 80
    log "Attente que nginx soit prêt sur le port 80..."
    RETRIES=0
    MAX_RETRIES=60
    while [ $RETRIES -lt $MAX_RETRIES ]; do
        HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost 2>/dev/null || echo "000")
        if echo "$HTTP_CODE" | grep -qE "^(200|301|302|404|502)$"; then
            log "Nginx répond sur le port 80 (HTTP $HTTP_CODE) !"
            break
        fi
        if [ $(( RETRIES % 10 )) -eq 0 ] && [ $RETRIES -gt 0 ]; then
            warn "Nginx ne répond pas (HTTP $HTTP_CODE), diagnostic..."
            docker compose -f ${COMPOSE_FILE} ps
            docker compose -f ${COMPOSE_FILE} logs --tail=10 nginx 2>/dev/null || true
        fi
        RETRIES=$((RETRIES + 1))
        echo "  Tentative ${RETRIES}/${MAX_RETRIES} (HTTP ${HTTP_CODE})..."
        sleep 5
    done

    if [ $RETRIES -eq $MAX_RETRIES ]; then
        warn "Nginx ne répond pas. Logs de tous les services :"
        docker compose -f ${COMPOSE_FILE} ps
        docker compose -f ${COMPOSE_FILE} logs --tail=50 nginx
        docker compose -f ${COMPOSE_FILE} logs --tail=20 backend
        docker compose -f ${COMPOSE_FILE} logs --tail=20 frontend
        docker compose -f ${COMPOSE_FILE} logs --tail=20 mobile
        # Vérifier si le port est bien ouvert
        warn "État des ports :"
        ss -tlnp | grep -E ':80|:443' || echo "  Aucun service sur 80/443 !"
        error "Nginx ne répond pas après ${MAX_RETRIES} tentatives."
    fi

    # ── Vérifier le challenge ACME ──
    log "Vérification accès ACME challenge..."
    docker compose -f ${COMPOSE_FILE} exec -T nginx sh -c \
        'mkdir -p /var/www/certbot/.well-known/acme-challenge && echo "acme-test-ok" > /var/www/certbot/.well-known/acme-challenge/test-solidata'
    ACME_TEST=$(curl -s http://localhost/.well-known/acme-challenge/test-solidata 2>/dev/null || echo "FAIL")
    if echo "$ACME_TEST" | grep -q "acme-test-ok"; then
        log "ACME challenge accessible en local !"
    else
        warn "ACME challenge NON accessible en local. Réponse: ${ACME_TEST}"
        warn "Logs nginx :"
        docker compose -f ${COMPOSE_FILE} logs --tail=20 nginx
    fi

    # Vérifier l'accès externe (depuis l'IP publique)
    log "Vérification accès externe sur ${SERVER_IP}:80..."
    EXT_CODE=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 "http://${SERVER_IP}/.well-known/acme-challenge/test-solidata" 2>/dev/null || echo "000")
    if [ "$EXT_CODE" = "000" ]; then
        warn "⚠️  Port 80 NON ACCESSIBLE depuis l'IP publique ${SERVER_IP} !"
        warn "Vérifiez le Security Group Scaleway : port 80 TCP doit être ouvert en INBOUND."
        warn "Console Scaleway > Instances > Security Groups > Ajouter règle : TCP 80 ACCEPT"
    else
        log "Port 80 accessible depuis l'IP publique (HTTP $EXT_CODE)"
    fi

    # ── Étape 3: Obtenir certificat SSL ──
    log "Étape 3/7 — Obtention certificat Let's Encrypt..."
    docker compose -f ${COMPOSE_FILE} run --rm --entrypoint "" certbot \
        certbot certonly \
        --webroot \
        --webroot-path=/var/www/certbot \
        --email ${EMAIL} \
        --agree-tos \
        --no-eff-email \
        --force-renewal \
        -d ${DOMAIN} \
        -d www.${DOMAIN} \
        -d m.${DOMAIN}

    # ── Étape 4: Restaurer config SSL + redémarrer nginx ──
    log "Étape 4/7 — Activation SSL..."
    if [ -f "${CONF_DIR}/solidata.conf.ssl-backup" ]; then
        cp "${CONF_DIR}/solidata.conf.ssl-backup" "${CONF_DIR}/solidata.conf"
        rm -f "${CONF_DIR}/solidata.conf.ssl-backup"
    else
        warn "Backup SSL introuvable, la config actuelle est conservée."
    fi

    # Certbot peut créer le certificat dans solidata.online-0001 au lieu de solidata.online
    # (si le dossier solidata.online existait déjà avec l'auto-signé)
    # On copie les vrais certs au bon endroit pour que Nginx les trouve
    log "Vérification emplacement certificat Let's Encrypt..."
    docker compose -f ${COMPOSE_FILE} exec -T nginx sh -c '
        if [ -d /etc/letsencrypt/live/solidata.online-0001 ] && [ -f /etc/letsencrypt/live/solidata.online-0001/fullchain.pem ]; then
            echo "Certificat trouvé dans solidata.online-0001, copie vers solidata.online..."
            cp -fL /etc/letsencrypt/live/solidata.online-0001/fullchain.pem /etc/letsencrypt/live/solidata.online/fullchain.pem
            cp -fL /etc/letsencrypt/live/solidata.online-0001/privkey.pem /etc/letsencrypt/live/solidata.online/privkey.pem
        fi
    '

    log "Redémarrage nginx avec SSL..."
    docker compose -f ${COMPOSE_FILE} restart nginx
    sleep 10

    # Maintenant démarrer aussi le service certbot (renouvellement automatique)
    log "Démarrage du service certbot (renouvellement auto)..."
    docker compose -f ${COMPOSE_FILE} up -d certbot

    # ── Étape 5: Initialisation base de données ──
    log "Étape 5/7 — Initialisation base de données..."
    sleep 5
    if docker compose -f ${COMPOSE_FILE} exec -T backend node src/scripts/init-db.js; then
        log "Base de données initialisée (tables + seeds)."
    else
        log "FATAL : init-db.js a échoué. Déploiement annulé."
        log "Diagnostic : docker compose -f ${COMPOSE_FILE} logs backend"
        exit 1
    fi
    if [ -f "backend/src/scripts/migrate-v2.js" ]; then
        if docker compose -f ${COMPOSE_FILE} exec -T backend node src/scripts/migrate-v2.js 2>/dev/null; then
            log "Migration v2 appliquée."
        fi
    fi

    # ── Étape 6: Nettoyage ──
    log "Étape 6/7 — Nettoyage images intermédiaires..."
    docker image prune -f

    # ── Étape 7: Statut final ──
    log "Étape 7/7 — Vérification..."
    docker compose -f ${COMPOSE_FILE} ps
    log "Espace disque final :"
    df -h /

    log "=== DÉPLOIEMENT INITIAL TERMINÉ ==="
    log "Application disponible sur :"
    log "  Web     : https://${DOMAIN}"
    log "  Mobile  : https://m.${DOMAIN}"
    log "  API     : https://${DOMAIN}/api"
    log ""
    log "Compte admin par défaut :"
    log "  Identifiant : admin"
    log "  Mot de passe : généré aléatoirement, affiché UNE FOIS dans les logs de démarrage :"
    log "    docker compose -f ${COMPOSE_FILE} logs backend | grep -A6 'MOT DE PASSE ADMIN INITIAL'"
    warn "Notez-le maintenant — changement obligatoire à la première connexion (≥ 10 caractères)."
    ;;

  # ===============================
  # MISE À JOUR
  # ===============================
  update)
    log "=== MISE À JOUR SOLIDATA ==="

    # Backup avant update
    log "Étape 1/7 — Sauvegarde base de données..."
    bash deploy/scripts/backup.sh

    # Pull dernières modifications.
    # GIT_TERMINAL_PROMPT=0 : sans lui, un identifiant manquant fait ATTENDRE git
    # sur une invite « Username for … ». Un déploiement lancé sans terminal
    # (cron, session détachée) resterait suspendu là indéfiniment — sauvegarde
    # faite, rien de déployé, et personne pour s'en apercevoir. Mieux vaut
    # échouer tout de suite, en disant pourquoi.
    log "Étape 2/7 — Récupération du code..."
    if ! GIT_TERMINAL_PROMPT=0 git pull origin main; then
        warn ""
        warn "RIEN N'A ÉTÉ DÉPLOYÉ : l'application tourne toujours dans sa version"
        warn "précédente, aucune image n'a été reconstruite, le site n'a pas été"
        warn "fermé et la sauvegarde de l'étape 1 est conservée."
        warn ""
        warn "Les deux causes habituelles :"
        warn "  1. IDENTIFIANTS — l'URL du dépôt porte un nom d'utilisateur"
        warn "     (https://<nom>@github.com/…) ou un jeton périmé, ce qui force une"
        warn "     récupération authentifiée. Le dépôt étant PUBLIC, une URL sans"
        warn "     identifiant se récupère sans rien saisir :"
        warn "       git remote set-url origin ${REPO_URL}"
        warn "       GIT_TERMINAL_PROMPT=0 git ls-remote origin main   # doit afficher un SHA"
        warn "  2. MODIFICATIONS LOCALES — un fichier suivi a été édité sur le serveur"
        warn "     et le pull refuse de l'écraser :"
        warn "       git status --short     # voir lesquels"
        warn "       git stash              # les mettre de côté"
        warn ""
        warn "Puis relancer : bash deploy/scripts/deploy.sh update"
        error "Récupération du code impossible depuis GitHub."
    fi

    # Rebuild séquentiel sans cache (économise le disque sur DEV1-S)
    log "Étape 3/7 — Reconstruction des images (sans cache)..."
    log "  Build backend..."
    docker compose -f ${COMPOSE_FILE} build --no-cache backend
    docker image prune -f 2>/dev/null || true
    log "  Build frontend..."
    docker compose -f ${COMPOSE_FILE} build --no-cache frontend
    docker image prune -f 2>/dev/null || true
    log "  Build mobile..."
    docker compose -f ${COMPOSE_FILE} build --no-cache mobile
    docker image prune -f 2>/dev/null || true

    # ── Mode maintenance ────────────────────────────────────────────────
    # Posé ICI et pas au début : pendant les reconstructions d'images
    # (plusieurs minutes), l'ancienne version tourne toujours et sert
    # parfaitement les utilisateurs. Fermer le site pendant ce temps-là serait
    # une coupure gratuite. La vraie indisponibilité commence maintenant.
    #
    # nginx ne redémarre pas ici (son image n'est jamais reconstruite) : c'est
    # donc lui qui sert la page, en 503, pendant que tout le reste redémarre.
    MAINTENANCE_ACTIVE=0
    signaler_maintenance_restee() {
        [ "${MAINTENANCE_ACTIVE}" = "1" ] || return 0
        echo ""
        warn "Le mode maintenance est TOUJOURS ACTIF : le déploiement ne s'est pas terminé normalement."
        warn "C'est volontaire — mieux vaut une page honnête qu'une application à moitié déployée."
        warn "Une fois le problème réglé, levez-le :  bash deploy/scripts/maintenance.sh off"
    }
    trap signaler_maintenance_restee EXIT

    if bash deploy/scripts/maintenance.sh on "Mise à jour de SOLIDATA en cours"; then
        MAINTENANCE_ACTIVE=1
    else
        warn "Le mode maintenance n'a pas pu être posé — le déploiement continue."
        warn "Les utilisateurs verront les erreurs de passerelle habituelles pendant la coupure."
    fi

    log "Étape 4/7 — Redémarrage des services..."
    docker compose -f ${COMPOSE_FILE} up -d

    # La configuration nginx est MONTÉE depuis le dépôt, pas construite dans une
    # image. « up -d » ne recrée donc pas le conteneur quand seul le contenu du
    # fichier a changé : il reste « Running », avec l'ancienne configuration
    # chargée en mémoire. Toute évolution de deploy/nginx/conf.d/ était ainsi
    # récupérée par git pull puis ignorée, sans le moindre signal.
    # Le conteneur peut venir d'être RECRÉÉ (changement de volume ou de
    # définition dans le compose). Il démarre alors avec la configuration à
    # jour, mais son fichier PID n'est pas encore écrit : un « -s reload »
    # immédiat échoue sur « invalid PID number ». On laisse donc nginx finir de
    # se lever avant de lui parler.
    for _ in 1 2 3 4 5 6 7 8 9 10; do
        if docker compose -f ${COMPOSE_FILE} exec -T nginx sh -c '[ -s /var/run/nginx.pid ]' >/dev/null 2>&1; then
            break
        fi
        sleep 1
    done

    if docker compose -f ${COMPOSE_FILE} exec -T nginx nginx -t >/dev/null 2>&1; then
        # Le rechargement ne doit JAMAIS interrompre le déploiement. Constat du
        # 26/08/2026 : un « -s reload » lancé sur un conteneur fraîchement
        # recréé a échoué, et `set -e` a avorté la mise à jour AVANT les
        # migrations — laissant le site fermé sur une version à moitié
        # déployée. Or dans ce cas précis il n'y avait rien à recharger : la
        # configuration du dépôt était déjà celle que nginx venait de lire.
        if docker compose -f ${COMPOSE_FILE} exec -T nginx nginx -s reload >/dev/null 2>&1; then
            log "  Configuration nginx rechargée."
        else
            warn "  Rechargement nginx impossible — conteneur vraisemblablement recréé à l'instant."
            warn "  Sans conséquence dans ce cas : il a démarré avec la configuration à jour."
            warn "  Vérification : docker compose -f ${COMPOSE_FILE} exec nginx nginx -T | head -20"
        fi
    else
        warn "  Configuration nginx INVALIDE — rechargement refusé, l'ancienne reste active."
        warn "  Diagnostic : docker compose -f ${COMPOSE_FILE} exec nginx nginx -t"
    fi

    # Migrations base de données
    log "Étape 5/7 — Migrations base de données..."
    sleep 5
    if docker compose -f ${COMPOSE_FILE} exec -T backend node src/scripts/init-db.js; then
        log "init-db.js exécuté (tables + migrations)."
    else
        log "FATAL : init-db.js a échoué. Mise à jour annulée."
        log "Diagnostic : docker compose -f ${COMPOSE_FILE} logs backend"
        exit 1
    fi

    # Health check (basique)
    log "Étape 6/7 — Health check basique..."
    sleep 3
    # Nginx redirige tout HTTP→HTTPS (301). On tape directement HTTPS avec -k
    # (cert localhost ≠ cert solidata.online → -k requis en interne).
    # Le Host header force le bon vhost : sans ça nginx tombe sur le default_server
    # qui peut être un autre projet (ex: solireport) → 502.
    HTTP_CODE=$(curl -sk -H "Host: solidata.online" -H "X-Solidata-Bypass-Maintenance: 1" -o /dev/null -w "%{http_code}" --connect-timeout 5 https://localhost/api/health 2>/dev/null || echo "000")
    if [ "$HTTP_CODE" = "200" ]; then
        log "Health check API : OK (HTTP 200)"
    else
        error "Health check API : HTTP ${HTTP_CODE} — déploiement interrompu. Vérifiez : docker compose -f ${COMPOSE_FILE} logs backend --tail 50"
    fi

    # Smoke test endpoints critiques (couvre les bugs SQL post-déploiement)
    #
    # Le smoke a besoin de SMOKE_API_KEY — une clé d'API de SERVICE, en lecture
    # seule (2.45.0). Elle remplace le compte ADMIN de service dont le mot de
    # passe ET le secret TOTP vivaient côte à côte dans ce même .env : ranger
    # les deux facteurs au même endroit annulait la double authentification.
    # Sans clé, le smoke ne couvre que les endpoints publics — il le DIT et le
    # déploiement continue : une couverture réduite n'est pas une régression.
    # Création : docker compose exec backend node src/scripts/creer-cle-api.js --apply
    #
    # ATTENTION — on ne fait PAS `source .env`.
    # `source` EXÉCUTE le fichier : toute ligne qui n'est pas une affectation
    # valide (valeur repliée sur la ligne suivante, espaces autour du `=`,
    # caractère spécial non échappé) est lancée comme une commande, et le shell
    # l'affiche alors en clair dans les logs de déploiement — y compris s'il
    # s'agit d'une clé d'API. Constat en production le 24/08/2026 : une clé
    # Anthropic imprimée dans la sortie de déploiement.
    # On extrait donc UNIQUEMENT les deux variables nécessaires, sans jamais
    # interpréter le reste du fichier ni afficher la moindre valeur.
    log "Étape 7/7 — Smoke test endpoints critiques..."
    lire_env() {
        # $1 = nom de la variable. Dernière occurrence gagnante, guillemets
        # optionnels retirés, commentaires et lignes vides ignorés.
        sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*//p" .env \
            | tail -n 1 \
            | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'\$/\1/"
    }
    SMOKE_API_KEY="$(lire_env SMOKE_API_KEY)"
    if [ -z "${SMOKE_API_KEY:-}" ]; then
        warn "SMOKE_API_KEY absente du .env — smoke test exécuté en mode dégradé (endpoints publics seulement)."
        warn "Pour couvrir les endpoints protégés, créer la clé de service (lecture seule) :"
        warn "  docker compose -f ${COMPOSE_FILE} exec backend node src/scripts/creer-cle-api.js --apply"
        warn "  puis reporter SMOKE_API_KEY=<clé affichée> dans .env"
    fi
    # Les anciennes variables ne sont PLUS lues. Le dire, plutôt que de laisser
    # croire à une couverture qui n'existe plus.
    if [ -n "$(lire_env API_PASSWORD)" ] || [ -n "$(lire_env API_TOTP_SECRET)" ]; then
        warn "API_PASSWORD / API_TOTP_SECRET encore présents dans .env : ils ne sont plus utilisés par le smoke test."
        warn "  Retirez-les (et désactivez le compte ADMIN de service) — un secret inutile reste un secret exposé."
    fi
    # On tape solidata.online (et pas localhost) pour matcher le bon vhost nginx :
    # https://localhost atterrit sur le default_server (potentiellement un autre projet) → 502.
    # Le cert est valide pour solidata.online, donc pas besoin de TLS-insecure.
    #
    # Le test ne dépend d'aucun paquet npm (que des primitives Node). Il tourne
    # donc soit avec le Node de la machine, soit — quand il n'y en a pas, ce qui
    # est le cas d'un serveur installé par init-server.sh, qui ne pose que
    # Docker — dans un conteneur jetable partageant le réseau de l'hôte.
    #
    # La clé est exportée puis passée par « -e NOM » sans valeur : Docker la lit
    # dans son environnement, elle n'apparaît jamais dans la ligne de commande,
    # donc jamais dans « ps ».
    export BASE_URL="https://solidata.online"
    export SMOKE_API_KEY

    run_smoke_test() {
        if command -v node >/dev/null 2>&1; then
            node scripts/tests/api-smoke.js
        elif command -v docker >/dev/null 2>&1; then
            docker run --rm --network host \
                -e BASE_URL -e SMOKE_API_KEY \
                -v "${APP_DIR}:/work" -w /work \
                node:20-alpine node scripts/tests/api-smoke.js
        else
            return 2
        fi
    }

    smoke_status=0
    run_smoke_test || smoke_status=$?

    if [ "${smoke_status}" -eq 0 ]; then
        log "Smoke test : tous les endpoints critiques répondent ✓"
    elif [ "${smoke_status}" -eq 2 ]; then
        # Distinction essentielle : un test qu'on n'a PAS PU exécuter n'est pas
        # un test qui échoue. Confondre les deux ferait annuler par un rollback
        # un déploiement parfaitement sain.
        warn "Smoke test NON EXÉCUTÉ : ni Node sur la machine, ni Docker pour le lancer."
        warn "Le déploiement est allé à son terme — il n'a simplement pas été vérifié."
    else
        error "Smoke test ÉCHOUÉ — un ou plusieurs endpoints critiques n'ont pas répondu correctement. Inspecter la sortie ci-dessus + les journaux du backend. Rollback à envisager : git reset --hard HEAD~1 && bash deploy/scripts/deploy.sh update"
    fi

    # Le site rouvre SEULEMENT ici : après les migrations, le health check et
    # le smoke test. Tout échec précédent a interrompu le script, laissant la
    # page de maintenance en place — c'est ce qu'on veut.
    if bash deploy/scripts/maintenance.sh off; then
        MAINTENANCE_ACTIVE=0
        trap - EXIT
    else
        error "Le mode maintenance n'a PAS pu être levé : le site reste FERMÉ alors que le déploiement est sain. Levez-le à la main : bash deploy/scripts/maintenance.sh off"
    fi

    # Cleanup
    docker image prune -f

    log "=== MISE À JOUR TERMINÉE ==="
    docker compose -f ${COMPOSE_FILE} ps
    log "Version déployée : $(git log -1 --format='%h %s' 2>/dev/null || echo 'inconnue')"
    log "Espace disque :"
    df -h /
    ;;

  # ===============================
  # REDEMARRAGE
  # ===============================
  restart)
    log "Redémarrage des services..."
    # Un redémarrage coupe le service au même titre qu'une mise à jour : les
    # utilisateurs méritent la même page plutôt qu'un 502 nu.
    bash deploy/scripts/maintenance.sh on "Redémarrage des services"
    docker compose -f ${COMPOSE_FILE} restart
    sleep 5
    bash deploy/scripts/maintenance.sh off
    docker compose -f ${COMPOSE_FILE} ps
    ;;

  # ===============================
  # STOP
  # ===============================
  stop)
    warn "Arrêt de tous les services..."
    docker compose -f ${COMPOSE_FILE} down
    log "Services arrêtés."
    ;;

  # ===============================
  # LOGS
  # ===============================
  logs)
    SERVICE="${2:-}"
    if [ -n "${SERVICE}" ]; then
        docker compose -f ${COMPOSE_FILE} logs -f --tail=100 "${SERVICE}"
    else
        docker compose -f ${COMPOSE_FILE} logs -f --tail=100
    fi
    ;;

  # ===============================
  # STATUS
  # ===============================
  status)
    log "=== STATUT SOLIDATA ==="
    docker compose -f ${COMPOSE_FILE} ps
    echo ""
    log "Utilisation disque :"
    docker system df
    echo ""
    log "Volumes :"
    docker volume ls | grep solidata
    ;;

  *)
    echo "Usage: $0 {first|update|restart|stop|logs|status}"
    echo ""
    echo "  first   — Premier déploiement (HTTP → SSL)"
    echo "  update  — Mise à jour (backup + rebuild)"
    echo "  restart — Redémarrage sans rebuild"
    echo "  stop    — Arrêt complet"
    echo "  logs    — Afficher les logs (optionnel: logs backend)"
    echo "  status  — Statut des services"
    exit 1
    ;;
esac
