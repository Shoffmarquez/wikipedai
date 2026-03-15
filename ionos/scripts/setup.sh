#!/usr/bin/env bash
# ══════════════════════════════════════════════════════════════════════════════
#  WikipeDAI — IONOS VPS Full Setup Script
#  Domain:  wikipedai.wiki
#  Owner:   Simon Hoffmann <s.hoffmann.marquez@gmail.com>
#
#  Run once on a fresh IONOS VPS (Ubuntu 22.04):
#    curl -fsSL https://raw.githubusercontent.com/Shoffmarquez/wikipedai/master/ionos/scripts/setup.sh | bash
#  OR:
#    bash /var/wikipedai.wiki/app/ionos/scripts/setup.sh
# ══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

# ── Colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

log()  { echo -e "${CYAN}[setup]${NC} $*"; }
ok()   { echo -e "${GREEN}[✓]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
err()  { echo -e "${RED}[✗]${NC} $*"; exit 1; }

# ── Configuration ─────────────────────────────────────────────────────────────
DOMAIN="wikipedai.wiki"
BASE="/var/${DOMAIN}"
APP_DIR="${BASE}/app"
DATA_DIR="${BASE}/data"
LOGS_DIR="${BASE}/logs"
BACKUP_DIR="${BASE}/backups"
NGINX_DIR="${BASE}/nginx"
GITHUB_REPO="https://github.com/Shoffmarquez/wikipedai.git"
NODE_PORT=3131

echo -e "\n${BOLD}══════════════════════════════════════════════════${NC}"
echo -e "${BOLD}   WikipeDAI IONOS Setup — ${DOMAIN}${NC}"
echo -e "${BOLD}══════════════════════════════════════════════════${NC}\n"

# ── Must run as root ──────────────────────────────────────────────────────────
[[ $EUID -ne 0 ]] && err "Please run as root: sudo bash setup.sh"

# ── 1. System packages ────────────────────────────────────────────────────────
log "Updating system packages..."
apt-get update -qq && apt-get upgrade -y -qq
apt-get install -y -qq git curl nginx certbot python3-certbot-nginx ufw fail2ban
ok "System packages ready"

# ── 2. Node.js 20 LTS ─────────────────────────────────────────────────────────
if ! command -v node &>/dev/null || [[ $(node -v | cut -d. -f1 | tr -d 'v') -lt 20 ]]; then
    log "Installing Node.js 20 LTS..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - -qq
    apt-get install -y -qq nodejs
fi
ok "Node.js $(node -v) ready"

# ── 3. PM2 ────────────────────────────────────────────────────────────────────
if ! command -v pm2 &>/dev/null; then
    log "Installing PM2..."
    npm install -g pm2 --quiet
fi
ok "PM2 $(pm2 -v) ready"

# ── 4. Create folder structure ────────────────────────────────────────────────
log "Creating /var/${DOMAIN}/ folder structure..."
mkdir -p "${APP_DIR}"
mkdir -p "${DATA_DIR}/uploads"
mkdir -p "${LOGS_DIR}"
mkdir -p "${BACKUP_DIR}"
mkdir -p "${NGINX_DIR}"
chmod -R 755 "${BASE}"
ok "Folder structure created:"
echo "    ${BASE}/"
echo "    ├── app/       ← application code"
echo "    ├── data/      ← database + uploads (persistent)"
echo "    │   └── uploads/"
echo "    ├── logs/      ← PM2 + nginx logs"
echo "    ├── backups/   ← daily database backups"
echo "    └── nginx/     ← nginx config copy"

# ── 5. Clone / update application code ───────────────────────────────────────
log "Cloning WikipeDAI from GitHub..."
if [[ -d "${APP_DIR}/.git" ]]; then
    warn "App directory already has a git repo — pulling latest..."
    git -C "${APP_DIR}" pull origin master
else
    git clone "${GITHUB_REPO}" "${APP_DIR}"
fi
ok "Code ready at ${APP_DIR}"

# ── 6. Install Node.js dependencies ──────────────────────────────────────────
log "Installing npm dependencies..."
cd "${APP_DIR}"
npm install --omit=dev --silent
ok "npm dependencies installed"

# ── 7. Environment variables ──────────────────────────────────────────────────
if [[ ! -f "${APP_DIR}/.env" ]]; then
    log "Creating .env from template..."
    cp "${APP_DIR}/.env.example" "${APP_DIR}/.env"

    # Generate secrets automatically
    SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(64).toString('hex'))")
    JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(64).toString('hex'))")

    sed -i "s|SESSION_SECRET=replace-with-a-long-random-string|SESSION_SECRET=${SESSION_SECRET}|" "${APP_DIR}/.env"
    sed -i "s|JWT_SECRET=replace-with-another-long-random-string|JWT_SECRET=${JWT_SECRET}|" "${APP_DIR}/.env"
    sed -i "s|DATA_DIR=.*|DATA_DIR=${DATA_DIR}|" "${APP_DIR}/.env"
    sed -i "s|SITE_URL=.*|SITE_URL=https://${DOMAIN}|" "${APP_DIR}/.env"

    warn "⚠  .env created with auto-generated secrets."
    warn "   Change ADMIN_PASSWORD and OVERSEER_PASSWORD before going live:"
    warn "   nano ${APP_DIR}/.env"
else
    ok ".env already exists — skipping"
fi

# ── 8. Copy nginx config ──────────────────────────────────────────────────────
log "Installing Nginx configuration..."
cp "${APP_DIR}/ionos/nginx/${DOMAIN}.conf" "${NGINX_DIR}/${DOMAIN}.conf"
cp "${APP_DIR}/ionos/nginx/${DOMAIN}.conf" "/etc/nginx/sites-available/${DOMAIN}"

# Enable site
if [[ ! -L "/etc/nginx/sites-enabled/${DOMAIN}" ]]; then
    ln -s "/etc/nginx/sites-available/${DOMAIN}" "/etc/nginx/sites-enabled/${DOMAIN}"
fi

# Remove default nginx site if present
rm -f /etc/nginx/sites-enabled/default

nginx -t && systemctl reload nginx
ok "Nginx configured for ${DOMAIN}"

# ── 9. Install backup cron ────────────────────────────────────────────────────
log "Installing daily backup cron..."
BACKUP_SCRIPT="${APP_DIR}/ionos/scripts/backup.sh"
chmod +x "${BACKUP_SCRIPT}"

CRON_LINE="0 3 * * * bash ${BACKUP_SCRIPT} >> ${LOGS_DIR}/backup.log 2>&1"
(crontab -l 2>/dev/null | grep -v "wikipedai"; echo "${CRON_LINE}") | crontab -
ok "Daily backup scheduled at 03:00"

# ── 10. Copy deploy script ────────────────────────────────────────────────────
chmod +x "${APP_DIR}/ionos/scripts/deploy.sh"
ok "Deploy script ready: bash ${APP_DIR}/ionos/scripts/deploy.sh"

# ── 11. Start app with PM2 ────────────────────────────────────────────────────
log "Starting WikipeDAI with PM2..."
cd "${APP_DIR}"
pm2 delete wikipedai.wiki 2>/dev/null || true
pm2 start ecosystem.config.js --env production
pm2 save

# Set PM2 to start on boot
env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u root --hp /root | tail -1 | bash || true
ok "WikipeDAI running at http://127.0.0.1:${NODE_PORT}"

# ── 12. Firewall ─────────────────────────────────────────────────────────────
log "Configuring UFW firewall..."
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment "SSH"
ufw allow 80/tcp comment "HTTP"
ufw allow 443/tcp comment "HTTPS"
ufw --force enable
ok "Firewall active: SSH, HTTP, HTTPS only"

# ── 13. Fail2ban ──────────────────────────────────────────────────────────────
systemctl enable fail2ban --quiet
systemctl start fail2ban
ok "fail2ban active (brute force protection)"

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}══════════════════════════════════════════════════${NC}"
echo -e "${BOLD}${GREEN}   Setup complete! Next steps:${NC}"
echo -e "${BOLD}${GREEN}══════════════════════════════════════════════════${NC}"
echo ""
echo -e "  ${YELLOW}1. Change admin passwords:${NC}"
echo -e "     nano ${APP_DIR}/.env"
echo ""
echo -e "  ${YELLOW}2. Point your IONOS DNS to this server:${NC}"
echo -e "     A record:  ${DOMAIN}     → $(curl -s ifconfig.me)"
echo -e "     A record:  www.${DOMAIN} → $(curl -s ifconfig.me)"
echo ""
echo -e "  ${YELLOW}3. Once DNS propagates, enable HTTPS:${NC}"
echo -e "     certbot --nginx -d ${DOMAIN} -d www.${DOMAIN}"
echo ""
echo -e "  ${YELLOW}4. Monitor the app:${NC}"
echo -e "     pm2 logs wikipedai.wiki"
echo -e "     pm2 monit"
echo ""
echo -e "  ${YELLOW}5. Folder summary:${NC}"
echo -e "     App:     ${APP_DIR}"
echo -e "     Data:    ${DATA_DIR}"
echo -e "     Logs:    ${LOGS_DIR}"
echo -e "     Backups: ${BACKUP_DIR}"
echo ""
