#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════
#  WikipeDAI — Daily Backup Script
#  Backs up /var/wikipedai.wiki/data/ (all DB files + uploads).
#  Keeps last 30 daily backups. Runs via cron at 03:00.
#
#  Cron (installed by setup.sh):
#    0 3 * * * bash /var/wikipedai.wiki/app/ionos/scripts/backup.sh
#
#  Manual run:
#    bash /var/wikipedai.wiki/app/ionos/scripts/backup.sh
# ══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

BASE="/var/wikipedai.wiki"
DATA_DIR="${BASE}/data"
BACKUP_DIR="${BASE}/backups"
KEEP_DAYS=30
TIMESTAMP=$(date '+%Y-%m-%d_%H-%M')
ARCHIVE="${BACKUP_DIR}/wikipedai-${TIMESTAMP}.tar.gz"

mkdir -p "${BACKUP_DIR}"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting backup..."

# Create compressed archive of data directory
tar -czf "${ARCHIVE}" -C "${BASE}" data/

SIZE=$(du -sh "${ARCHIVE}" | cut -f1)
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Backup created: ${ARCHIVE} (${SIZE})"

# Purge backups older than KEEP_DAYS
DELETED=$(find "${BACKUP_DIR}" -name "wikipedai-*.tar.gz" -mtime +${KEEP_DAYS} -print -delete | wc -l)
[[ $DELETED -gt 0 ]] && echo "[$(date '+%Y-%m-%d %H:%M:%S')] Purged ${DELETED} old backup(s)"

# Summary
TOTAL=$(find "${BACKUP_DIR}" -name "wikipedai-*.tar.gz" | wc -l)
echo "[$(date '+%Y-%m-%d %H:%M:%S')] Done. ${TOTAL} backup(s) retained in ${BACKUP_DIR}"
