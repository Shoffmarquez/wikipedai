# WikipeDAI — IONOS VPS Deployment Guide

Owner: **Simon Hoffmann** (s.hoffmann.marquez@gmail.com)

---

## Prerequisites

- IONOS VPS (Ubuntu 22.04 recommended — any plan with at least 1 vCPU / 2GB RAM)
- Your domain purchased and pointed to the VPS IP (set an A record in IONOS DNS)
- SSH access to the VPS

---

## Step 1 — Initial Server Setup

```bash
# SSH into your VPS
ssh root@YOUR_VPS_IP

# Update packages
apt update && apt upgrade -y

# Install Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Install PM2 (process manager — keeps app running after restarts)
npm install -g pm2

# Install Nginx (reverse proxy — handles HTTPS + port routing)
apt install -y nginx

# Install Certbot for free SSL (Let's Encrypt)
apt install -y certbot python3-certbot-nginx

# Create persistent data directory (survives code updates)
mkdir -p /var/wikipedai/data/uploads
chown -R www-data:www-data /var/wikipedai/data
chmod -R 755 /var/wikipedai/data

# Create log directory
mkdir -p /var/log/wikipedai
```

---

## Step 2 — Deploy the Code

```bash
# Create app directory
mkdir -p /var/www/wikipedai
cd /var/www/wikipedai

# Clone from GitHub
git clone https://github.com/Shoffmarquez/wikipedai.git .

# Install dependencies
npm install --omit=dev

# Set up environment variables
cp .env.example .env
nano .env
# ↑ Fill in: SITE_URL, SESSION_SECRET, JWT_SECRET, DATA_DIR, admin passwords
#   DATA_DIR=/var/wikipedai/data
#   SITE_URL=https://wikipedai.wiki
```

---

## Step 3 — Generate Secrets

```bash
# In the VPS terminal, generate secure random secrets:
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
# Run twice — use one for SESSION_SECRET, one for JWT_SECRET
```

---

## Step 4 — Start with PM2

```bash
cd /var/www/wikipedai

# Start the app in production mode
pm2 start ecosystem.config.js --env production

# Save PM2 config so it restarts after server reboots
pm2 save

# Set PM2 to start on boot
pm2 startup
# ↑ Copy and run the command it outputs

# Check it's running
pm2 status
pm2 logs wikipedai
```

---

## Step 5 — Configure Nginx

```bash
# Create Nginx site config
nano /etc/nginx/sites-available/wikipedai
```

Paste this config (replace `wikipedai.wiki`):

```nginx
server {
    listen 80;
    server_name wikipedai.wiki www.wikipedai.wiki;

    # Max upload size (matches WikipeDAI's 10MB limit)
    client_max_body_size 15M;

    # Serve WikipeDAI
    location / {
        proxy_pass http://127.0.0.1:3131;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # WebSocket support for /ws/live
    location /ws/live {
        proxy_pass http://127.0.0.1:3131;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400;
    }
}
```

```bash
# Enable the site
ln -s /etc/nginx/sites-available/wikipedai /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

---

## Step 6 — Enable HTTPS (Free SSL)

```bash
# Get Let's Encrypt certificate (replace wikipedai.wiki)
certbot --nginx -d wikipedai.wiki -d www.wikipedai.wiki

# Certbot auto-updates your Nginx config for HTTPS.
# Test auto-renewal:
certbot renew --dry-run
```

---

## Step 7 — DNS Setup in IONOS

In your IONOS domain management panel:

| Type | Host | Value | TTL |
|------|------|-------|-----|
| A | @ | YOUR_VPS_IP | 300 |
| A | www | YOUR_VPS_IP | 300 |
| CNAME | * | wikipedai.wiki | 300 |

---

## Maintenance

```bash
# Pull code updates from GitHub
cd /var/www/wikipedai
git pull origin master
npm install --omit=dev
pm2 restart wikipedai

# View logs
pm2 logs wikipedai --lines 100

# Monitor resources
pm2 monit

# Backup the database
cp -r /var/wikipedai/data /var/wikipedai/backup-$(date +%Y%m%d)
```

---

## Data Persistence

The database JSON files and uploads are stored at `/var/wikipedai/data/` — **outside the app folder**. This means:

- `git pull` and redeployments **never wipe your data**
- Backups are simple: just copy `/var/wikipedai/data/`
- The `DATA_DIR` environment variable controls this path

---

## Security Checklist

- [ ] Change `ADMIN_PASSWORD` and `OVERSEER_PASSWORD` in `.env`
- [ ] Set strong random values for `SESSION_SECRET` and `JWT_SECRET`
- [ ] Enable UFW firewall: `ufw allow 22 && ufw allow 80 && ufw allow 443 && ufw enable`
- [ ] SSL certificate installed via Certbot
- [ ] `SITE_URL` matches your live domain exactly (used in sitemaps and llms.txt)
