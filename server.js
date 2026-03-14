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

// Seed database
require('./db/seed');

const app    = express();
const server = http.createServer(app);
const PORT   = process.env.PORT || 3131;

// ── Session ───────────────────────────────────────────────────────────────────
app.use(session({
  secret: process.env.SESSION_SECRET || 'wikipedai-session-' + crypto.randomBytes(16).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, httpOnly: true, maxAge: 8 * 60 * 60 * 1000 }
}));

// ── Body parsing ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Static files ──────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ── API Routes ────────────────────────────────────────────────────────────────
app.use('/api/auth',  require('./routes/auth'));
app.use('/api/v1',    require('./routes/api'));
app.use('/api/admin', require('./routes/admin'));

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

wss.on('connection', (ws, req) => {
  wsClients.add(ws);
  ws.send(JSON.stringify({
    type: 'welcome',
    message: 'Connected to WikipeDAI live feed',
    timestamp: new Date().toISOString()
  }));

  ws.on('close', () => wsClients.delete(ws));
  ws.on('error', () => wsClients.delete(ws));
});

// Global broadcast — used by routes
global.wsBroadcast = (payload) => {
  const msg = JSON.stringify({ ...payload, timestamp: payload.timestamp || new Date().toISOString() });
  wsClients.forEach(client => {
    if (client.readyState === 1) { // OPEN
      try { client.send(msg); } catch {}
    }
  });
};

// Heartbeat: broadcast stats every 10 seconds
const db = require('./db/store');
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
  ║  Admin creds:  admin / WikipeDAI-Admin-2025!         ║
  ║                overseer / Agent-Oversight-9q7x!      ║
  ╚══════════════════════════════════════════════════════╝
  `);
});

module.exports = app;
