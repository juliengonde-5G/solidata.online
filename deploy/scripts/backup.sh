#!/bin/bash
# ============================================================
# SOLIDATA — Sauvegarde base de données + uploads
# Usage: bash backup.sh [daily|manual]
# Cron recommandé : 0 2 * * * /opt/solidata.online/deploy/scripts/backup.sh daily
# ============================================================

set -euo pipefail

APP_DIR="/opt/solidata.online"
BACKUP_DIR="/opt/solidata.online-backups"
DATE=$(date +%Y%m%d_%H%M%S)
TYPE="${1:-manual}"
RETENTION_DAYS=30

mkdir -p "${BACKUP_DIR}"

echo "[BACKUP] Sauvegarde ${TYPE} — ${DATE}"

# --- 1. Dump PostgreSQL ---
echo "[BACKUP] Export base de données..."
docker exec solidata-db pg_dump -U solidata_user -d solidata --format=custom \
    -f /backups/solidata_${DATE}.dump 2>/dev/null

# Copier hors du conteneur
cp "${APP_DIR}/deploy/backups/solidata_${DATE}.dump" "${BACKUP_DIR}/db_${TYPE}_${DATE}.dump" 2>/dev/null || \
    docker cp solidata-db:/backups/solidata_${DATE}.dump "${BACKUP_DIR}/db_${TYPE}_${DATE}.dump"

echo "[BACKUP] Base de données : db_${TYPE}_${DATE}.dump"

# --- 2. Backup uploads ---
echo "[BACKUP] Sauvegarde uploads..."
if docker volume inspect solidata-uploads &>/dev/null; then
    docker run --rm \
        -v solidata-uploads:/data \
        -v "${BACKUP_DIR}:/backup" \
        alpine tar czf "/backup/uploads_${TYPE}_${DATE}.tar.gz" -C /data .
    echo "[BACKUP] Uploads : uploads_${TYPE}_${DATE}.tar.gz"
fi

# --- 3. Compression dump ---
echo "[BACKUP] Compression..."
gzip -f "${BACKUP_DIR}/db_${TYPE}_${DATE}.dump"
echo "[BACKUP] Fichier compressé : db_${TYPE}_${DATE}.dump.gz"

# --- 4. Nettoyage anciennes sauvegardes ---
echo "[BACKUP] Nettoyage des sauvegardes > ${RETENTION_DAYS} jours..."
find "${BACKUP_DIR}" -name "db_daily_*.dump.gz" -mtime +${RETENTION_DAYS} -delete 2>/dev/null
find "${BACKUP_DIR}" -name "uploads_daily_*.tar.gz" -mtime +${RETENTION_DAYS} -delete 2>/dev/null
# Garder les manuelles plus longtemps (90 jours)
find "${BACKUP_DIR}" -name "db_manual_*.dump.gz" -mtime +90 -delete 2>/dev/null
find "${BACKUP_DIR}" -name "uploads_manual_*.tar.gz" -mtime +90 -delete 2>/dev/null

# --- 5. Résumé ---
TOTAL_SIZE=$(du -sh "${BACKUP_DIR}" | cut -f1)
NB_FILES=$(ls -1 "${BACKUP_DIR}" | wc -l)
echo ""
echo "[BACKUP] ✅ Sauvegarde terminée"
echo "[BACKUP] Répertoire : ${BACKUP_DIR}"
echo "[BACKUP] Total : ${NB_FILES} fichiers, ${TOTAL_SIZE}"
