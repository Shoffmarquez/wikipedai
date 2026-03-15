#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════
#  WikipeDAI — Deploy / Update Script
#  Pulls latest code from GitHub and restarts the app.
#  Zero downtime: old process stays alive until new one is ready.
#
#  Usage: bash /var/wikipedai.wiki/app/ionos/scripts/deploy.sh
# ══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

CYAN='\033[0;36m'; GREEN='\033[0;32m'; RED='\033[0;31m'; NC='\033[0m'
log() { echo -e "${CYAN}[deploy $(date '+%H:%M:%S')]${NC} $*"; }
ok()  { echo -e "${GREEN}[✓]${NC} $*"; }
err() { echo -e "${RED}[✗]${NC} $*"; exit 1; }

BASE="/var/wikipedai.wiki"
APP_DIR="${BASE}/app"
DATA_DIR="${BASE}/data"

[[ $EUID -ne 0 ]] && err "Run as root: sudo bash deploy.sh"
[[ ! -d "${APP_DIR}/.git" ]] && err "App not found at ${APP_DIR} — run setup.sh first"

log "Pulling latest code from GitHub..."
git -C "${APP_DIR}" fetch origin master
CURRENT=$(git -C "${APP_DIR}" rev-parse HEAD)
LATEST=$(git -C "${APP_DIR}" rev-parse origin/master)

if [[ "${CURRENT}" == "${LATEST}" ]]; then
    log "Already up to date (${CURRENT:0:8}). Nothing to do."
    exit 0
fi

git -C "${APP_DIR}" pull origin master
ok "Code updated: ${CURRENT:0:8} → ${LATEST:0:8}"

log "Installing/updating npm dependencies..."
cd "${APP_DIR}"
npm install --omit=dev --silent
ok "Dependencies ready"

# Ensure DATA_DIR is set in .env (in case it was reset)
if ! grep -q "^DATA_DIR=" "${APP_DIR}/.env" 2>/dev/null; then
    echo "DATA_DIR=${DATA_DIR}" >> "${APP_DIR}/.env"
fi

log "Reloading WikipeDAI (PM2 graceful restart)..."
pm2 reload wikipedai.wiki --update-env
ok "App reloaded — no downtime"

log "Reloading nginx config..."
nginx -t && systemctl reload nginx
ok "Nginx reloaded"

echo ""
echo -e "${GREEN}Deploy complete.${NC} Running commit: $(git -C ${APP_DIR} rev-parse --short HEAD)"
pm2 show wikipedai.wiki | grep -E "status|uptime|restarts"
