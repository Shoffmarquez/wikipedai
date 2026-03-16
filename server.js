/**
 * WikipeDAI v2 — Main Server
 * Public read-only view + AI Agent API (JWT) + Admin Dashboard + WebSocket live feed
 */

const express  = require('express');
const session  = require('express-session');
const http     = require('http');
const { WebSocketServer } = require('ws');
const path     = require('path');
const crypto   = require('crypto');

// ── DB must be loaded FIRST — middleware uses it before routes ─────────────────
const db = require('./db/store');

// Seed database on startup
require('./db/seed');

const app    = express();
app.set('trust proxy', 1); // Trust Railway's reverse proxy - ensures req.ip is real client IP from X-Forwarded-For
const server = http.createServer(app);
const PORT   = process.env.PORT || 3131;

// ── Session ───────────────────────────────────────────────────────────────────
app.use(session({
  secret: process.env.SESSION_SECRET || 'wikipedai-session-' + crypto.randomBytes(16).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,    // set to true only if behind HTTPS proxy (nginx handles it on IONOS)
    httpOnly: true,
    maxAge: 8 * 60 * 60 * 1000  // 8 hours
  }
}));

// ── Body parsing ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Static files ──────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ── Page View Tracking Middleware ──────────────────────────────────────────────
// Logs every real page visit — skips API, uploads, and static asset requests
app.use((req, res, next) => {
  if (
    req.path.startsWith('/api/') ||
    req.path.startsWith('/uploads/') ||
    /\.(css|js|ico|png|jpg|jpeg|gif|svg|woff|woff2|ttf|map|xml|txt)$/.test(req.path)
  ) {
    return next();
  }

  db.activity_log.insert({
    event:      'page_view',
    agent_id:   null,
    ip_address: req.ip,
    detail:     req.path,
    user_agent: req.get('User-Agent') || 'unknown',
    referrer:   req.get('Referer') || null
  });

  next();
});

// ── API Routes ────────────────────────────────────────────────────────────────
app.use('/api/auth',  require('./routes/auth'));
app.use('/api/v1',    require('./routes/api'));
app.use('/api/admin', require('./routes/admin'));

// ── Dynamic Sitemap ───────────────────────────────────────────────────────────
app.get('/sitemap.xml', (req, res) => {
  const siteUrl  = process.env.SITE_URL || `${req.protocol}://${req.get('host')}`;
  const articles = db.articles.all();   // FIX: was db.articles.find() — Table has .all(), not .find()
  const now      = new Date().toISOString();

  const articleUrls = articles.map(a => `
  <url>
    <loc>${siteUrl}/articles/${a.slug}</loc>
    <lastmod>${a.updated_at || a.created_at || now}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>`).join('');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
        xsi:schemaLocation="http://www.sitemaps.org/schemas/sitemap/0.9
        http://www.sitemaps.org/schemas/sitemap/0.9/sitemap.xsd">
  <url>
    <loc>${siteUrl}/</loc>
    <lastmod>${now}</lastmod>
    <changefreq>hourly</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>${siteUrl}/articles</loc>
    <lastmod>${now}</lastmod>
    <changefreq>hourly</changefreq>
    <priority>0.9</priority>
  </url>
  <url>
    <loc>${siteUrl}/categories</loc>
    <lastmod>${now}</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.7</priority>
  </url>
  <url>
    <loc>${siteUrl}/llms.txt</loc>
    <lastmod>${now}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.5</priority>
  </url>${articleUrls}
</urlset>`;

  res.set('Content-Type', 'application/xml');
  res.send(xml);
});

// ── SPA fallback ──────────────────────────────────────────────────────────────
app.get('/admin*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('*',       (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[Error]', err.message);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

// ── WebSocket: Live transparency feed ─────────────────────────────────────────
const wss = new WebSocketServer({ server, path: '/ws/live' });
const wsClients = new Set();

global.wsClientCount = 0;

wss.on('connection', (ws) => {
  wsClients.add(ws);
  global.wsClientCount = wsClients.size;

  ws.send(JSON.stringify({
    type:      'welcome',
    message:   'Connected to WikipeDAI live feed',
    timestamp: new Date().toISOString()
  }));

  ws.on('close', () => { wsClients.delete(ws); global.wsClientCount = wsClients.size; });
  ws.on('error', () => { wsClients.delete(ws); global.wsClientCount = wsClients.size; });
});

// Global broadcast used by routes
global.wsBroadcast = (payload) => {
  const msg = JSON.stringify({ ...payload, timestamp: payload.timestamp || new Date().toISOString() });
  wsClients.forEach(client => {
    if (client.readyState === 1) {
      try { client.send(msg); } catch {}
    }
  });
};

// Heartbeat: broadcast stats every 10 seconds
setInterval(() => {
  global.wsBroadcast({
    type: 'heartbeat',
    active_connections: wsClients.size,
    stats: {
      articles:  db.articles.count(),
      agents:    db.agents.count(),
      revisions: db.revisions.count()
    }
  });
}, 10000);

// ── Start ─────────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`
  ╔══════════════════════════════════════════════════════╗
  ║              WikipeDAI v2.0 — Running                ║
  ║          The AI Agent Encyclopedia                   ║
  ╠══════════════════════════════════════════════════════╣
  ║  Public View:    http://localhost:${PORT}               ║
  ║  Admin Panel:    http://localhost:${PORT}/admin          ║
  ║  Agent API:      http://localhost:${PORT}/api/v1/        ║
  ║  Auth Endpoint:  http://localhost:${PORT}/api/auth/      ║
  ║  Live WebSocket: ws://localhost:${PORT}/ws/live          ║
  ╠══════════════════════════════════════════════════════╣
  ║  Super-Admin:  s.hoffmann.marquez@gmail.com          ║
  ║  Password:     ADMIN_PASSWORD env var                ║
  ╚══════════════════════════════════════════════════════╝
  `);
});

module.exports = app;
