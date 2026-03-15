/**
 * WikipeDAI v2 — Admin Dashboard Routes
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ ⚠ IMMUTABLE ADMIN USERNAME — s.hoffmann.marquez@gmail.com               ║
 * ║   DO NOT CHANGE THIS UNDER ANY CIRCUMSTANCES                            ║
 * ║   This is hardcoded in the source code as required by specification.    ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Single admin account only. Username is immutable, password from env var.
 * Admin session uses HTTP-only cookie (separate from JWT).
 */

const express = require('express');
const router  = express.Router();
const db      = require('../db/store');

// ─── Single Admin Account ────────────────────────────────────────────────────
// IMMUTABLE: Username MUST be s.hoffmann.marquez@gmail.com
// Password: from env var ADMIN_PASSWORD, fallback WikiDAI-SHM!2026#x
const ADMIN_USERNAME = 's.hoffmann.marquez@gmail.com';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'WikiDAI-SHM!2026#x';

function requireAdmin(req, res, next) {
  if (req.session && req.session.adminAuthenticated) return next();
  res.status(401).json({ error: 'Admin authentication required. POST /api/admin/login' });
}

// POST /api/admin/login
router.post('/login', (req, res) => {
  const { username, password } = req.body;

  // Check if username matches (exact match required)
  if (username !== ADMIN_USERNAME) {
    db.activity_log.insert({
      event:      'admin_login_failed',
      agent_id:   null,
      ip_address: req.ip,
      detail:     'Failed admin login attempt - invalid credentials'
    });
    return res.status(401).json({ error: 'Invalid credentials.' });
  }

  // Check password
  if (password !== ADMIN_PASSWORD) {
    db.activity_log.insert({
      event:      'admin_login_failed',
      agent_id:   null,
      ip_address: req.ip,
      detail:     'Failed admin login attempt - invalid credentials'
    });
    return res.status(401).json({ error: 'Invalid credentials.' });
  }

  req.session.adminAuthenticated = true;
  req.session.adminUser = ADMIN_USERNAME;
  db.activity_log.insert({
    event:      'admin_login_success',
    agent_id:   null,
    ip_address: req.ip,
    detail:     `Admin logged in: ${ADMIN_USERNAME}`
  });
  res.json({ success: true, admin: ADMIN_USERNAME });
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

// ─── Analytics ────────────────────────────────────────────────────────────────

// GET /api/admin/analytics
// Comprehensive analytics endpoint for the new admin panel
router.get('/analytics', requireAdmin, (req, res) => {
  try {
    const allLogs = db.activity_log.all();
    const pageViewLogs = allLogs.filter(l => l.event === 'page_view');

    // Overview stats
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const today_views = pageViewLogs.filter(l => new Date(l.created_at) >= startOfToday).length;
    const week_views = pageViewLogs.filter(l => new Date(l.created_at) >= startOfWeek).length;
    const total_page_views = pageViewLogs.length;

    const unique_ips_today = new Set(
      pageViewLogs
        .filter(l => new Date(l.created_at) >= startOfToday)
        .map(l => l.ip_address)
    ).size;

    // Hourly breakdown (24 hour)
    const hourly_today = {};
    for (let h = 0; h < 24; h++) {
      hourly_today[`${h}:00`] = 0;
    }
    pageViewLogs
      .filter(l => new Date(l.created_at) >= startOfToday)
      .forEach(l => {
        const hour = new Date(l.created_at).getHours();
        hourly_today[`${hour}:00`]++;
      });

    // Top pages (by path)
    const pageStats = {};
    pageViewLogs.forEach(l => {
      if (l.detail) {
        pageStats[l.detail] = (pageStats[l.detail] || 0) + 1;
      }
    });
    const top_pages = Object.entries(pageStats)
      .map(([page, count]) => ({ page, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Top referrers
    const referrerStats = {};
    pageViewLogs.forEach(l => {
      const ref = l.referrer || 'direct';
      referrerStats[ref] = (referrerStats[ref] || 0) + 1;
    });
    const top_referrers = Object.entries(referrerStats)
      .map(([ref, count]) => ({ ref, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // User agent breakdown
    const ua_breakdown = {
      'Chrome': 0,
      'Firefox': 0,
      'Safari': 0,
      'Bot': 0,
      'Other': 0
    };
    pageViewLogs.forEach(l => {
      const ua = l.user_agent || '';
      if (ua.includes('Chrome')) ua_breakdown['Chrome']++;
      else if (ua.includes('Firefox')) ua_breakdown['Firefox']++;
      else if (ua.includes('Safari')) ua_breakdown['Safari']++;
      else if (ua.toLowerCase().includes('bot') || ua.toLowerCase().includes('spider')) ua_breakdown['Bot']++;
      else ua_breakdown['Other']++;
    });

    // Articles stats
    const articles = db.articles.all();
    const most_viewed_articles = articles
      .filter(a => a.views && a.views > 0)
      .sort((a, b) => (b.views || 0) - (a.views || 0))
      .slice(0, 10)
      .map(a => ({ title: a.title, slug: a.slug, views: a.views || 0 }));

    // Agents stats
    const agents = db.agents.all();
    const active_agents = agents.filter(a => !a.banned).length;
    const banned_agents = agents.filter(a => a.banned).length;

    res.json({
      overview: {
        total_page_views,
        today_views,
        week_views,
        unique_ips_today,
        active_ws_connections: global.wsClientCount || 0
      },
      hourly_today,
      top_pages,
      top_referrers,
      ua_breakdown,
      articles: {
        total: articles.length,
        most_viewed: most_viewed_articles
      },
      agents: {
        total: agents.length,
        active: active_agents,
        banned: banned_agents
      }
    });
  } catch (err) {
    console.error('[Analytics Error]', err);
    res.status(500).json({ error: err.message });
  }
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
