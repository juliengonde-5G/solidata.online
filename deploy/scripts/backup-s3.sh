#!/bin/bash
# ============================================================
# SOLIDATA — Sauvegarde DB + uploads avec upload off-site (S3-compatible)
# Usage : bash backup-s3.sh [daily|manual|weekly|monthly]
# Cron : 0 2 * * * /opt/solidata.online/deploy/scripts/backup-s3.sh daily
#         0 3 * * 0 /opt/solidata.online/deploy/scripts/backup-s3.sh weekly
#         0 4 1 * * /opt/solidata.online/deploy/scripts/backup-s3.sh monthly
#
# Variables d'environnement requises (à mettre dans /etc/solidata-backup.env) :
#   S3_ENDPOINT       — ex : https://s3.fr-par.scw.cloud
#   S3_BUCKET         — ex : solidata-backups
#   AWS_ACCESS_KEY_ID
#   AWS_SECRET_ACCESS_KEY
#   AWS_REGION        — ex : fr-par
#   ALERT_WEBHOOK     — (optionnel) URL de webhook pour notifier en cas d'erreur
# ============================================================

set -euo pipefail

APP_DIR="/opt/solidata.online"
BACKUP_DIR="/opt/solidata.online-backups"
DATE=$(date +%Y%m%d_%H%M%S)
TYPE="${1:-manual}"

# Rétentions par type (jours)
declare -A RETENTION=( [daily]=30 [weekly]=84 [monthly]=365 [manual]=90 )
DAYS=${RETENTION[$TYPE]:-30}

# Charger les credentials S3 (jamais en argv)
if [ -f /etc/solidata-backup.env ]; then
  set -a; . /etc/solidata-backup.env; set +a
fi

mkdir -p "${BACKUP_DIR}"
LOG=/var/log/solidata-backup.log
exec > >(tee -a "$LOG") 2>&1

echo "─────────────────────────────────────────────"
echo "[BACKUP-S3] Démarrage type=${TYPE} date=${DATE}"

notify_failure() {
  local msg="$1"
  echo "[BACKUP-S3] ECHEC : $msg"
  if [ -n "${ALERT_WEBHOOK:-}" ]; then
    curl -sS -X POST -H "Content-Type: application/json" \
      --data "{\"type\":\"backup_failure\",\"backup_type\":\"${TYPE}\",\"message\":\"${msg}\"}" \
      "$ALERT_WEBHOOK" >/dev/null || true
  fi
  exit 1
}
trap 'notify_failure "Erreur ligne $LINENO (code $?)"' ERR

# --- 1. Dump PostgreSQL en custom format (compressé natif) ---
DB_FILE="db_${TYPE}_${DATE}.dump"
echo "[BACKUP-S3] pg_dump -> ${DB_FILE}"
docker exec solidata-db pg_dump -U solidata_user -d solidata --format=custom \
    -f "/backups/${DB_FILE}"
docker cp "solidata-db:/backups/${DB_FILE}" "${BACKUP_DIR}/${DB_FILE}"
docker exec solidata-db rm -f "/backups/${DB_FILE}"

# --- 2. Tar uploads ---
UPLOAD_FILE="uploads_${TYPE}_${DATE}.tar.gz"
if docker volume inspect solidata-uploads &>/dev/null; then
  echo "[BACKUP-S3] tar uploads -> ${UPLOAD_FILE}"
  docker run --rm \
      -v solidata-uploads:/data:ro \
      -v "${BACKUP_DIR}:/backup" \
      alpine tar czf "/backup/${UPLOAD_FILE}" -C /data .
fi

# --- 3. Checksums SHA-256 (intégrité) ---
echo "[BACKUP-S3] Calcul checksums"
cd "${BACKUP_DIR}"
sha256sum "${DB_FILE}" "${UPLOAD_FILE}" 2>/dev/null > "checksums_${TYPE}_${DATE}.sha256" || true

# --- 4. Upload S3 (si configuré) ---
if [ -n "${S3_BUCKET:-}" ] && command -v aws >/dev/null 2>&1; then
  ENDPOINT_ARG=""
  [ -n "${S3_ENDPOINT:-}" ] && ENDPOINT_ARG="--endpoint-url=${S3_ENDPOINT}"
  REMOTE_PATH="s3://${S3_BUCKET}/${TYPE}/${DATE}"
  echo "[BACKUP-S3] Upload vers ${REMOTE_PATH}"
  aws ${ENDPOINT_ARG} s3 cp "${DB_FILE}"                  "${REMOTE_PATH}/${DB_FILE}"                  --storage-class STANDARD_IA --no-progress
  [ -f "${UPLOAD_FILE}" ] && aws ${ENDPOINT_ARG} s3 cp "${UPLOAD_FILE}"          "${REMOTE_PATH}/${UPLOAD_FILE}"          --storage-class STANDARD_IA --no-progress
  aws ${ENDPOINT_ARG} s3 cp "checksums_${TYPE}_${DATE}.sha256" "${REMOTE_PATH}/checksums_${TYPE}_${DATE}.sha256" --no-progress
  echo "[BACKUP-S3] Upload OK"
else
  echo "[BACKUP-S3] AVERTISSEMENT : S3_BUCKET non configuré ou aws-cli absent — backup local uniquement"
fi

# --- 5. Rétention locale ---
echo "[BACKUP-S3] Nettoyage local > ${DAYS} jours (type=${TYPE})"
find "${BACKUP_DIR}" -name "db_${TYPE}_*.dump"      -mtime +${DAYS} -delete 2>/dev/null || true
find "${BACKUP_DIR}" -name "uploads_${TYPE}_*.tar.gz" -mtime +${DAYS} -delete 2>/dev/null || true
find "${BACKUP_DIR}" -name "checksums_${TYPE}_*.sha256" -mtime +${DAYS} -delete 2>/dev/null || true

# --- 6. Résumé ---
TOTAL=$(du -sh "${BACKUP_DIR}" | cut -f1)
NB=$(ls -1 "${BACKUP_DIR}" | wc -l)
echo "[BACKUP-S3] OK type=${TYPE} fichiers=${NB} taille=${TOTAL}"
