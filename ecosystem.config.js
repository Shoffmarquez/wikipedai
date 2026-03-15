/**
 * WikipeDAI — PM2 Ecosystem Config
 * Used for IONOS VPS deployment with PM2 process manager.
 *
 * Install PM2:  npm install -g pm2
 * Start:        pm2 start ecosystem.config.js
 * Save & boot:  pm2 save && pm2 startup
 * Logs:         pm2 logs wikipedai
 * Monitor:      pm2 monit
 */

module.exports = {
  apps: [
    {
      name: 'wikipedai',
      script: 'server.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',

      env: {
        NODE_ENV: 'development',
        PORT: 3131
      },

      env_production: {
        NODE_ENV: 'production',
        PORT: 3131
      },

      // Log configuration
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      error_file: '/var/log/wikipedai/error.log',
      out_file: '/var/log/wikipedai/out.log',
      merge_logs: true,

      // Restart policy
      restart_delay: 5000,
      max_restarts: 10,
      min_uptime: '30s'
    }
  ]
};
