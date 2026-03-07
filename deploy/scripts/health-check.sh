#!/bin/bash
# ============================================================
# SOLIDATA — Vérification santé des services
# Usage: bash health-check.sh
# Cron : */5 * * * * /opt/solidata/deploy/scripts/health-check.sh
# ============================================================

DOMAIN="solidata.online"
LOG_FILE="/opt/solidata/logs/health-check.log"
COMPOSE_FILE="/opt/solidata/docker-compose.prod.yml"

mkdir -p /opt/solidata/logs

check_service() {
    local name=$1
    local url=$2
    local expected=$3

    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "${url}" 2>/dev/null || echo "000")

    if [ "${HTTP_CODE}" = "${expected}" ]; then
        echo "[OK] ${name} (HTTP ${HTTP_CODE})"
        return 0
    else
        echo "[KO] ${name} — HTTP ${HTTP_CODE} (attendu ${expected})"
        return 1
    fi
}

TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
ERRORS=0

echo "=== Health Check — ${TIMESTAMP} ===" | tee -a "${LOG_FILE}"

# Vérifier les conteneurs Docker
for CONTAINER in solidata-db solidata-api solidata-web solidata-mobile solidata-proxy; do
    STATUS=$(docker inspect -f '{{.State.Status}}' "${CONTAINER}" 2>/dev/null || echo "not_found")
    if [ "${STATUS}" = "running" ]; then
        echo "[OK] Container ${CONTAINER}" | tee -a "${LOG_FILE}"
    else
        echo "[KO] Container ${CONTAINER} — ${STATUS}" | tee -a "${LOG_FILE}"
        ERRORS=$((ERRORS + 1))

        # Auto-restart si le conteneur est arrêté
        if [ "${STATUS}" = "exited" ]; then
            echo "[FIX] Redémarrage ${CONTAINER}..." | tee -a "${LOG_FILE}"
            docker start "${CONTAINER}" 2>/dev/null
        fi
    fi
done

# Vérifier les endpoints HTTP
check_service "Frontend" "https://${DOMAIN}" "200" || ERRORS=$((ERRORS + 1))
check_service "API" "https://${DOMAIN}/api/auth/me" "401" || ERRORS=$((ERRORS + 1))
check_service "Mobile" "https://m.${DOMAIN}" "200" || ERRORS=$((ERRORS + 1))

# Vérifier l'espace disque
DISK_USAGE=$(df / | tail -1 | awk '{print $5}' | tr -d '%')
if [ "${DISK_USAGE}" -gt 90 ]; then
    echo "[KO] Disque à ${DISK_USAGE}% — CRITIQUE" | tee -a "${LOG_FILE}"
    ERRORS=$((ERRORS + 1))
elif [ "${DISK_USAGE}" -gt 80 ]; then
    echo "[WARN] Disque à ${DISK_USAGE}%" | tee -a "${LOG_FILE}"
else
    echo "[OK] Disque à ${DISK_USAGE}%" | tee -a "${LOG_FILE}"
fi

# Vérifier la mémoire
MEM_USAGE=$(free | awk '/Mem:/{printf "%.0f", $3/$2 * 100}')
echo "[INFO] Mémoire à ${MEM_USAGE}%" | tee -a "${LOG_FILE}"

# Résumé
echo "" | tee -a "${LOG_FILE}"
if [ ${ERRORS} -eq 0 ]; then
    echo "[✅] Tous les services sont opérationnels" | tee -a "${LOG_FILE}"
else
    echo "[❌] ${ERRORS} erreur(s) détectée(s)" | tee -a "${LOG_FILE}"
fi
echo "---" >> "${LOG_FILE}"
