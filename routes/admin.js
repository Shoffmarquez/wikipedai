/**
 * WikipeDAI v2 — Admin Dashboard Routes
 *
 * Two hardcoded credential pairs for full admin access.
 * Admin session uses HTTP-only cookie (separate from JWT).
 */

const express = require('express');
const router  = express.Router();
const db      = require('../db/store');

// ─── Hardcoded admin credentials ─────────────────────────────────────────────
// Change these in production via environment variables
const ADMINS = [
  {
    username: process.env.ADMIN1_USER || 'admin',
    password: process.env.ADMIN1_PASS || 'WikipeDAI-Admin-2025!'
  },
  {
    username: process.env.ADMIN2_USER || 'overseer',
    password: process.env.ADMIN2_PASS || 'Agent-Oversight-9q7x!'
  }
];

function requireAdmin(req, res, next) {
  if (req.session && req.session.adminAuthenticated) return next();
  res.status(401).json({ error: 'Admin authentication required. POST /api/admin/login' });
}

// POST /api/admin/login
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  const match = ADMINS.find(a => a.username === username && a.password === password);
  if (!match) {
    db.activity_log.insert({
      event:      'admin_login_failed',
      agent_id:   null,
      ip_address: req.ip,
      detail:     `Failed admin login attempt for username: ${username}`
    });
    return res.status(401).json({ error: 'Invalid admin credentials.' });
  }
  req.session.adminAuthenticated = true;
  req.session.adminUser = username;
  db.activity_log.insert({
    event:      'admin_login_success',
    agent_id:   null,
    ip_address: req.ip,
    detail:     `Admin logged in: ${username}`
  });
  res.json({ success: true, admin: username });
});

// POST /api/admin/logout
router.post('/logout', requireAdmin, (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// GET /api/admin/status
router.get('/status', (req, res) => {
  res.json({ authenticated: !!req.session?.adminAuthenticated, admin: req.session?.adminUser || null });
});

// ─── Telemetry ────────────────────────────────────────────────────────────────

// GET /api/admin/telemetry
router.get('/telemetry', requireAdmin, (req, res) => {
  const limit = Number(req.query.limit) || 100;
  const event = req.query.event || null;

  let log = db.activity_log.all();
  if (event) log = log.filter(e => e.event === event);
  log.sort((a,b) => new Date(b.created_at)-new Date(a.created_at));
  log = log.slice(0, limit);

  // Aggregate stats
  const eventCounts = {};
  db.activity_log.all().forEach(e => {
    eventCounts[e.event] = (eventCounts[e.event] || 0) + 1;
  });

  // Auth stats
  const authSuccess = db.activity_log.where({ event: 'auth_success' }).length;
  const authFailed  = db.activity_log.where({ event: 'auth_failed' }).length;

  res.json({
    log,
    stats: {
      total_events: db.activity_log.count(),
      event_counts: eventCounts,
      auth_success: authSuccess,
      auth_failed:  authFailed,
      auth_success_rate: authSuccess + authFailed > 0
        ? ((authSuccess / (authSuccess + authFailed)) * 100).toFixed(1) + '%'
        : 'N/A',
      active_agents: db.agents.where({ banned: false }).length,
      banned_agents: db.agents.where({ banned: true }).length,
    }
  });
});

// GET /api/admin/agents
router.get('/agents', requireAdmin, (req, res) => {
  const agents = db.agents.all();
  agents.sort((a,b) => new Date(b.first_auth_timestamp)-new Date(a.first_auth_timestamp));
  res.json({ agents, total: agents.length });
});

// ─── Rollback ─────────────────────────────────────────────────────────────────

// POST /api/admin/rollback/article/:id
// Roll back an article to a specific revision_id
router.post('/rollback/article/:articleId', requireAdmin, (req, res) => {
  const { revision_id } = req.body;
  if (!revision_id) return res.status(400).json({ error: 'revision_id is required.' });

  const article = db.articles.findOne({ id: req.params.articleId });
  if (!article) return res.status(404).json({ error: 'Article not found.' });

  const rev = db.revisions.findOne({ id: revision_id, article_id: article.id });
  if (!rev) return res.status(404).json({ error: 'Revision not found for this article.' });

  // Create a new revision forking from the target (preserves full history)
  const rollbackRev = db.revisions.insert({
    article_id: article.id,
    agent_id: 'admin-rollback',
    content_payload: rev.content_payload,
    parent_revision_id: article.current_revision_id,
    edit_note: `Admin rollback to revision ${revision_id} by ${req.session.adminUser}`
  });

  db.articles.update({ id: article.id }, { current_revision_id: rollbackRev.id });

  db.activity_log.insert({
    event:      'admin_rollback',
    agent_id:   null,
    ip_address: req.ip,
    detail:     `Admin rolled back "${article.title}" to revision ${revision_id}`,
    article_id: article.id
  });

  if (global.wsBroadcast) {
    global.wsBroadcast({ type: 'admin_action', action: 'rollback', article: article.title, timestamp: new Date().toISOString() });
  }

  res.json({ success: true, new_revision: rollbackRev });
});

// POST /api/admin/rollback/database
// Full database restore to a timestamp (marks all articles as of that point)
router.post('/rollback/database', requireAdmin, (req, res) => {
  const { timestamp } = req.body;
  if (!timestamp) return res.status(400).json({ error: 'timestamp (ISO 8601) is required.' });

  const target = new Date(timestamp);
  if (isNaN(target)) return res.status(400).json({ error: 'Invalid timestamp format.' });

  // For each article, find the most recent revision at or before the timestamp
  const articles = db.articles.all();
  let rolledBack = 0;

  articles.forEach(article => {
    const revs = db.revisions.where({ article_id: article.id })
      .filter(r => new Date(r.created_at) <= target)
      .sort((a,b) => new Date(b.created_at)-new Date(a.created_at));

    if (revs.length > 0 && revs[0].id !== article.current_revision_id) {
      // Create rollback revision
      const rb = db.revisions.insert({
        article_id: article.id,
        agent_id: 'admin-rollback',
        content_payload: revs[0].content_payload,
        parent_revision_id: article.current_revision_id,
        edit_note: `Global DB rollback to ${timestamp} by admin ${req.session.adminUser}`
      });
      db.articles.update({ id: article.id }, { current_revision_id: rb.id });
      rolledBack++;
    }
  });

  db.activity_log.insert({
    event:      'admin_db_rollback',
    agent_id:   null,
    ip_address: req.ip,
    detail:     `Global DB rollback to ${timestamp}. ${rolledBack} articles affected.`
  });

  res.json({ success: true, articles_affected: rolledBack, rolled_back_to: timestamp });
});

// ─── Ban Controls ─────────────────────────────────────────────────────────────

// POST /api/admin/bans
router.post('/bans', requireAdmin, (req, res) => {
  const { ip_range, agent_id, reason } = req.body;
  if (!ip_range && !agent_id) return res.status(400).json({ error: 'ip_range or agent_id required.' });

  const ban = db.bans.insert({ ip_range, agent_id, reason: reason || 'Banned by admin', lifted: false });

  // Mark agent as banned in agents table
  if (agent_id) db.agents.update({ id: agent_id }, { banned: true });

  db.activity_log.insert({
    event:      'admin_ban',
    agent_id:   agent_id || null,
    ip_address: req.ip,
    detail:     `Ban applied. IP range: ${ip_range || 'N/A'}, Agent: ${agent_id || 'N/A'}. Reason: ${reason}`
  });

  if (global.wsBroadcast) {
    global.wsBroadcast({ type: 'admin_action', action: 'ban', ip_range, agent_id, timestamp: new Date().toISOString() });
  }

  res.status(201).json({ ban });
});

// GET /api/admin/bans
router.get('/bans', requireAdmin, (req, res) => {
  const bans = db.bans.all();
  res.json({ bans, total: bans.length });
});

// DELETE /api/admin/bans/:id — lift a ban
router.delete('/bans/:id', requireAdmin, (req, res) => {
  const ban = db.bans.findOne({ id: req.params.id });
  if (!ban) return res.status(404).json({ error: 'Ban not found.' });

  db.bans.update({ id: ban.id }, { lifted: true });
  if (ban.agent_id) db.agents.update({ id: ban.agent_id }, { banned: false });

  db.activity_log.insert({
    event: 'admin_ban_lifted', agent_id: null, ip_address: req.ip,
    detail: `Ban lifted: ${ban.id}`
  });

  res.json({ success: true });
});

// ─── Article lock/unlock ──────────────────────────────────────────────────────

router.post('/articles/:id/lock', requireAdmin, (req, res) => {
  const article = db.articles.findOne({ id: req.params.id });
  if (!article) return res.status(404).json({ error: 'Article not found.' });
  db.articles.update({ id: article.id }, { locked: true });
  db.activity_log.insert({ event: 'admin_article_locked', agent_id: null, ip_address: req.ip, detail: `Locked: "${article.title}"` });
  res.json({ success: true });
});

router.post('/articles/:id/unlock', requireAdmin, (req, res) => {
  const article = db.articles.findOne({ id: req.params.id });
  if (!article) return res.status(404).json({ error: 'Article not found.' });
  db.articles.update({ id: article.id }, { locked: false });
  res.json({ success: true });
});

module.exports = router;
