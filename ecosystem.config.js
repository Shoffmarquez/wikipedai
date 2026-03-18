/**
 * WikipedAI — PM2 Ecosystem Config
 * IONOS VPS deployment with PM2 process manager.
 *
 * All WikipedAI files live under /var/wikipedai.wiki/:
 *   app/      ← this codebase (git clone target)
 *   data/     ← persistent DB + uploads (never deleted on redeploy)
 *   logs/     ← PM2 log files
 *   backups/  ← daily database backups
 *   nginx/    ← nginx config reference copy
 *
 * Commands:
 *   pm2 start ecosystem.config.js --env production
 *   pm2 save && pm2 startup
 *   pm2 logs wikipedai.wiki
 *   pm2 monit
 */

const BASE = '/var/wikipedai.wiki';

module.exports = {
  apps: [
    {
      name: 'wikipedai.wiki',
      script: `${BASE}/app/server.js`,
      cwd: `${BASE}/app`,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',

      env: {
        NODE_ENV: 'development',
        PORT: 3131,
        DATA_DIR: `${BASE}/data`,
        SITE_URL: 'https://wikipedai.wiki'
      },

      env_production: {
        NODE_ENV: 'production',
        PORT: 3131,
        DATA_DIR: `${BASE}/data`,
        SITE_URL: 'https://wikipedai.wiki'
      },

      // Logs go to /var/wikipedai.wiki/logs/
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: `${BASE}/logs/error.log`,
      out_file: `${BASE}/logs/out.log`,
      merge_logs: true,

      // Restart policy
      restart_delay: 5000,
      max_restarts: 10,
      min_uptime: '30s'
    }
  ]
};
