#!/bin/bash
# ============================================================
# SOLIDATA — Restauration base de données
# Usage: bash restore.sh /chemin/vers/db_backup.dump.gz
# ============================================================

set -euo pipefail

DUMP_FILE="${1:-}"

if [ -z "${DUMP_FILE}" ]; then
    echo "Usage: $0 <fichier_dump.dump.gz>"
    echo ""
    echo "Sauvegardes disponibles :"
    ls -lh /opt/solidata-backups/db_*.dump.gz 2>/dev/null || echo "  Aucune sauvegarde trouvée"
    exit 1
fi

if [ ! -f "${DUMP_FILE}" ]; then
    echo "Erreur: Fichier ${DUMP_FILE} introuvable"
    exit 1
fi

echo "============================================"
echo "  SOLIDATA — Restauration base de données"
echo "  Fichier : ${DUMP_FILE}"
echo "============================================"
echo ""
read -p "ATTENTION : Ceci va ÉCRASER la base actuelle. Continuer ? (oui/non) " CONFIRM
if [ "${CONFIRM}" != "oui" ]; then
    echo "Restauration annulée."
    exit 0
fi

# Décompresser si nécessaire
TEMP_DUMP="${DUMP_FILE}"
if [[ "${DUMP_FILE}" == *.gz ]]; then
    echo "[RESTORE] Décompression..."
    TEMP_DUMP="/tmp/solidata_restore.dump"
    gunzip -c "${DUMP_FILE}" > "${TEMP_DUMP}"
fi

# Copier dans le conteneur
echo "[RESTORE] Copie vers le conteneur..."
docker cp "${TEMP_DUMP}" solidata-db:/tmp/restore.dump

# Restaurer
echo "[RESTORE] Restauration en cours..."
docker exec solidata-db pg_restore -U solidata_user -d solidata \
    --clean --if-exists --no-owner \
    /tmp/restore.dump

# Nettoyage
docker exec solidata-db rm -f /tmp/restore.dump
[ "${TEMP_DUMP}" = "/tmp/solidata_restore.dump" ] && rm -f "${TEMP_DUMP}"

echo ""
echo "[RESTORE] ✅ Base de données restaurée avec succès"
echo "[RESTORE] Redémarrez le backend : docker restart solidata-api"
