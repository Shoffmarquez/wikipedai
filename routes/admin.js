/**
 * WikipeDAI v2 — Admin Dashboard Routes
 *
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║ ⚠ IMMUTABLE SUPER-ADMIN USERNAME — s.hoffmann.marquez@gmail.com         ║
 * ║   DO NOT CHANGE THIS UNDER ANY CIRCUMSTANCES                            ║
 * ║   This is hardcoded in the source code as required by specification.    ║
 * ║   This account is the sole owner of WikipeDAI.                          ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * Roles:
 *   superadmin — Simon Hoffmann Marquez only. Full access including
 *                managing sub-admins, rollbacks, bans.
 *   admin      — Created by superadmin. Read-only: analytics, traffic,
 *                articles list, agents list, live monitor.
 *
 * Passwords for sub-admins are stored as PBKDF2-SHA512 hashes (Node crypto).
 */

const express = require('express');
const crypto  = require('crypto');
const router  = express.Router();
const db      = require('../db/store');

// ─── Super-Admin Credentials ──────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════════════════
// IMMUTABLE — THIS USERNAME MUST NEVER BE CHANGED
// Owner: Simon Hoffmann Marquez
// ══════════════════════════════════════════════════════════════════════════════
const SUPER_ADMIN_EMAIL    = 's.hoffmann.marquez@gmail.com'; // HARDCODED — NEVER CHANGES
const SUPER_ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'WikiDAI-SHM!2026#x';

// ─── Password Utilities (PBKDF2, no external deps) ───────────────────────────

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  try {
    const [salt, hash] = stored.split(':');
    const verify = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
    // Constant-time compare
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(verify, 'hex'));
  } catch {
    return false;
  }
}

// ─── Middleware ───────────────────────────────────────────────────────────────

// Any authenticated admin (superadmin or admin)
function requireAdmin(req, res, next) {
  if (req.session && req.session.adminAuthenticated) return next();
  res.status(401).json({ error: 'Admin authentication required. POST /api/admin/login' });
}

// Super-admin only (Simon's account)
function requireSuperAdmin(req, res, next) {
  if (req.session && req.session.adminAuthenticated && req.session.adminRole === 'superadmin') {
    return next();
  }
  res.status(403).json({ error: 'Forbidden. This action requires super-admin privileges.' });
}

// ─── Login / Logout ───────────────────────────────────────────────────────────

// POST /api/admin/login
router.post('/login', (req, res) => {
  const { username, password } = req.body;

  // ── 1. Check super-admin (hardcoded) ──
  if (username === SUPER_ADMIN_EMAIL) {
    if (password !== SUPER_ADMIN_PASSWORD) {
      db.activity_log.insert({
        event: 'admin_login_failed', agent_id: null, ip_address: req.ip,
        detail: `Failed super-admin login for ${username}`
      });
      return res.status(401).json({ error: 'Invalid credentials.' });
    }
    req.session.adminAuthenticated = true;
    req.session.adminUser          = SUPER_ADMIN_EMAIL;
    req.session.adminRole          = 'superadmin';
    db.activity_log.insert({
      event: 'admin_login_success', agent_id: null, ip_address: req.ip,
      detail: `Super-admin logged in: ${SUPER_ADMIN_EMAIL}`
    });
    return res.json({ success: true, admin: SUPER_ADMIN_EMAIL, role: 'superadmin' });
  }

  // ── 2. Check sub-admins table ──
  const subAdmin = db.sub_admins.findOne({ email: username, active: true });
  if (!subAdmin) {
    db.activity_log.insert({
      event: 'admin_login_failed', agent_id: null, ip_address: req.ip,
      detail: `Failed admin login — unknown user: ${username}`
    });
    return res.status(401).json({ error: 'Invalid credentials.' });
  }

  if (!verifyPassword(password, subAdmin.password_hash)) {
    db.activity_log.insert({
      event: 'admin_login_failed', agent_id: null, ip_address: req.ip,
      detail: `Failed admin login for sub-admin: ${username}`
    });
    return res.status(401).json({ error: 'Invalid credentials.' });
  }

  req.session.adminAuthenticated = true;
  req.session.adminUser          = subAdmin.email;
  req.session.adminRole          = 'admin';
  req.session.subAdminId         = subAdmin.id;

  db.sub_admins.update({ id: subAdmin.id }, { last_login: new Date().toISOString() });
  db.activity_log.insert({
    event: 'admin_login_success', agent_id: null, ip_address: req.ip,
    detail: `Sub-admin logged in: ${subAdmin.email} (${subAdmin.name})`
  });

  return res.json({ success: true, admin: subAdmin.email, role: 'admin', name: subAdmin.name });
});

// POST /api/admin/logout
router.post('/logout', requireAdmin, (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// GET /api/admin/status
router.get('/status', (req, res) => {
  res.json({
    authenticated: !!req.session?.adminAuthenticated,
    admin: req.session?.adminUser || null,
    role:  req.session?.adminRole || null
  });
});

// ─── Sub-Admin Management (superadmin only) ───────────────────────────────────

// GET /api/admin/sub-admins — list all sub-admins
router.get('/sub-admins', requireSuperAdmin, (req, res) => {
  const list = db.sub_admins.all().map(a => ({
    id:         a.id,
    name:       a.name,
    email:      a.email,
    active:     a.active,
    created_at: a.created_at,
    last_login: a.last_login || null
  }));
  res.json({ sub_admins: list, total: list.length });
});

// POST /api/admin/sub-admins — create a new sub-admin
router.post('/sub-admins', requireSuperAdmin, (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'name, email, and password are all required.' });
  }

  // Email must not already be the super-admin
  if (email.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase()) {
    return res.status(400).json({ error: 'That email is reserved for the super-admin.' });
  }

  // Check for duplicates
  const existing = db.sub_admins.findOne({ email: email.toLowerCase() });
  if (existing) {
    return res.status(409).json({ error: 'An admin with that email already exists.' });
  }

  // Password must be at least 10 chars
  if (password.length < 10) {
    return res.status(400).json({ error: 'Password must be at least 10 characters.' });
  }

  const newAdmin = db.sub_admins.insert({
    name:          name.trim(),
    email:         email.toLowerCase().trim(),
    password_hash: hashPassword(password),
    active:        true,
    last_login:    null,
    created_by:    SUPER_ADMIN_EMAIL
  });

  db.activity_log.insert({
    event: 'sub_admin_created', agent_id: null, ip_address: req.ip,
    detail: `Sub-admin created: ${newAdmin.email} (${newAdmin.name}) by ${SUPER_ADMIN_EMAIL}`
  });

  res.status(201).json({
    success: true,
    sub_admin: { id: newAdmin.id, name: newAdmin.name, email: newAdmin.email, active: newAdmin.active }
  });
});

// DELETE /api/admin/sub-admins/:id — remove a sub-admin
router.delete('/sub-admins/:id', requireSuperAdmin, (req, res) => {
  const subAdmin = db.sub_admins.findOne({ id: req.params.id });
  if (!subAdmin) return res.status(404).json({ error: 'Sub-admin not found.' });

  db.sub_admins.update({ id: subAdmin.id }, { active: false });

  db.activity_log.insert({
    event: 'sub_admin_removed', agent_id: null, ip_address: req.ip,
    detail: `Sub-admin deactivated: ${subAdmin.email} (${subAdmin.name}) by ${SUPER_ADMIN_EMAIL}`
  });

  res.json({ success: true });
});

// PATCH /api/admin/sub-admins/:id/reset-password — reset a sub-admin's password
router.patch('/sub-admins/:id/reset-password', requireSuperAdmin, (req, res) => {
  const { new_password } = req.body;
  if (!new_password || new_password.length < 10) {
    return res.status(400).json({ error: 'new_password must be at least 10 characters.' });
  }

  const subAdmin = db.sub_admins.findOne({ id: req.params.id });
  if (!subAdmin) return res.status(404).json({ error: 'Sub-admin not found.' });

  db.sub_admins.update({ id: subAdmin.id }, { password_hash: hashPassword(new_password) });

  db.activity_log.insert({
    event: 'sub_admin_password_reset', agent_id: null, ip_address: req.ip,
    detail: `Password reset for sub-admin: ${subAdmin.email} by ${SUPER_ADMIN_EMAIL}`
  });

  res.json({ success: true });
});

// ─── Analytics ────────────────────────────────────────────────────────────────

// GET /api/admin/analytics
router.get('/analytics', requireAdmin, (req, res) => {
  try {
    const allLogs = db.activity_log.all();
    const pageViewLogs = allLogs.filter(l => l.event === 'page_view');

    const now          = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfWeek  = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const today_views  = pageViewLogs.filter(l => new Date(l.created_at) >= startOfToday).length;
    const week_views   = pageViewLogs.filter(l => new Date(l.created_at) >= startOfWeek).length;
    const total_page_views = pageViewLogs.length;

    const unique_ips_today = new Set(
      pageViewLogs
        .filter(l => new Date(l.created_at) >= startOfToday)
        .map(l => l.ip_address)
    ).size;

    const hourly_today = {};
    for (let h = 0; h < 24; h++) hourly_today[`${h}:00`] = 0;
    pageViewLogs
      .filter(l => new Date(l.created_at) >= startOfToday)
      .forEach(l => { const hour = new Date(l.created_at).getHours(); hourly_today[`${hour}:00`]++; });

    const pageStats = {};
    pageViewLogs.forEach(l => {
      if (l.detail) pageStats[l.detail] = (pageStats[l.detail] || 0) + 1;
    });
    const top_pages = Object.entries(pageStats)
      .map(([page, count]) => ({ page, count }))
      .sort((a, b) => b.count - a.count).slice(0, 10);

    const referrerStats = {};
    pageViewLogs.forEach(l => {
      const ref = l.referrer || 'direct';
      referrerStats[ref] = (referrerStats[ref] || 0) + 1;
    });
    const top_referrers = Object.entries(referrerStats)
      .map(([ref, count]) => ({ ref, count }))
      .sort((a, b) => b.count - a.count).slice(0, 10);

    const ua_breakdown = { Chrome: 0, Firefox: 0, Safari: 0, Bot: 0, Other: 0 };
    pageViewLogs.forEach(l => {
      const ua = l.user_agent || '';
      if (ua.includes('Chrome'))                                       ua_breakdown.Chrome++;
      else if (ua.includes('Firefox'))                                 ua_breakdown.Firefox++;
      else if (ua.includes('Safari'))                                  ua_breakdown.Safari++;
      else if (ua.toLowerCase().includes('bot') || ua.toLowerCase().includes('spider')) ua_breakdown.Bot++;
      else                                                             ua_breakdown.Other++;
    });

    const articles = db.articles.all();
    const most_viewed_articles = articles
      .filter(a => a.views > 0)
      .sort((a, b) => (b.views || 0) - (a.views || 0))
      .slice(0, 10)
      .map(a => ({ title: a.title, slug: a.slug, views: a.views || 0 }));

    const agents = db.agents.all();

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
      articles: { total: articles.length, most_viewed: most_viewed_articles },
      agents:   { total: agents.length, active: agents.filter(a => !a.banned).length, banned: agents.filter(a => a.banned).length }
    });
  } catch (err) {
    console.error('[Analytics Error]', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Telemetry ────────────────────────────────────────────────────────────────

router.get('/telemetry', requireAdmin, (req, res) => {
  const limit = Number(req.query.limit) || 100;
  const event = req.query.event || null;

  let log = db.activity_log.all();
  if (event) log = log.filter(e => e.event === event);
  log.sort((a,b) => new Date(b.created_at)-new Date(a.created_at));
  log = log.slice(0, limit);

  const eventCounts = {};
  db.activity_log.all().forEach(e => { eventCounts[e.event] = (eventCounts[e.event] || 0) + 1; });

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

// ─── Rollback (superadmin only) ───────────────────────────────────────────────

router.post('/rollback/article/:articleId', requireSuperAdmin, (req, res) => {
  const { revision_id } = req.body;
  if (!revision_id) return res.status(400).json({ error: 'revision_id is required.' });

  const article = db.articles.findOne({ id: req.params.articleId });
  if (!article) return res.status(404).json({ error: 'Article not found.' });

  const rev = db.revisions.findOne({ id: revision_id, article_id: article.id });
  if (!rev) return res.status(404).json({ error: 'Revision not found for this article.' });

  const rollbackRev = db.revisions.insert({
    article_id: article.id,
    agent_id: 'admin-rollback',
    content_payload: rev.content_payload,
    parent_revision_id: article.current_revision_id,
    edit_note: `Admin rollback to revision ${revision_id} by ${req.session.adminUser}`
  });

  db.articles.update({ id: article.id }, { current_revision_id: rollbackRev.id });
  db.activity_log.insert({
    event: 'admin_rollback', agent_id: null, ip_address: req.ip,
    detail: `Admin rolled back "${article.title}" to revision ${revision_id}`, article_id: article.id
  });

  if (global.wsBroadcast) {
    global.wsBroadcast({ type: 'admin_action', action: 'rollback', article: article.title, timestamp: new Date().toISOString() });
  }

  res.json({ success: true, new_revision: rollbackRev });
});

router.post('/rollback/database', requireSuperAdmin, (req, res) => {
  const { timestamp } = req.body;
  if (!timestamp) return res.status(400).json({ error: 'timestamp (ISO 8601) is required.' });

  const target = new Date(timestamp);
  if (isNaN(target)) return res.status(400).json({ error: 'Invalid timestamp format.' });

  const articles = db.articles.all();
  let rolledBack = 0;

  articles.forEach(article => {
    const revs = db.revisions.where({ article_id: article.id })
      .filter(r => new Date(r.created_at) <= target)
      .sort((a,b) => new Date(b.created_at)-new Date(a.created_at));

    if (revs.length > 0 && revs[0].id !== article.current_revision_id) {
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
    event: 'admin_db_rollback', agent_id: null, ip_address: req.ip,
    detail: `Global DB rollback to ${timestamp}. ${rolledBack} articles affected.`
  });

  res.json({ success: true, articles_affected: rolledBack, rolled_back_to: timestamp });
});

// ─── Ban Controls (superadmin only) ──────────────────────────────────────────

router.post('/bans', requireSuperAdmin, (req, res) => {
  const { ip_range, agent_id, reason } = req.body;
  if (!ip_range && !agent_id) return res.status(400).json({ error: 'ip_range or agent_id required.' });

  const ban = db.bans.insert({ ip_range, agent_id, reason: reason || 'Banned by admin', lifted: false });
  if (agent_id) db.agents.update({ id: agent_id }, { banned: true });

  db.activity_log.insert({
    event: 'admin_ban', agent_id: agent_id || null, ip_address: req.ip,
    detail: `Ban applied. IP range: ${ip_range || 'N/A'}, Agent: ${agent_id || 'N/A'}. Reason: ${reason}`
  });

  if (global.wsBroadcast) {
    global.wsBroadcast({ type: 'admin_action', action: 'ban', ip_range, agent_id, timestamp: new Date().toISOString() });
  }

  res.status(201).json({ ban });
});

router.get('/bans', requireAdmin, (req, res) => {
  const bans = db.bans.all();
  res.json({ bans, total: bans.length });
});

router.delete('/bans/:id', requireSuperAdmin, (req, res) => {
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

// ─── Article lock/unlock (superadmin only) ────────────────────────────────────

router.post('/articles/:id/lock', requireSuperAdmin, (req, res) => {
  const article = db.articles.findOne({ id: req.params.id });
  if (!article) return res.status(404).json({ error: 'Article not found.' });
  db.articles.update({ id: article.id }, { locked: true });
  db.activity_log.insert({ event: 'admin_article_locked', agent_id: null, ip_address: req.ip, detail: `Locked: "${article.title}"` });
  res.json({ success: true });
});

router.post('/articles/:id/unlock', requireSuperAdmin, (req, res) => {
  const article = db.articles.findOne({ id: req.params.id });
  if (!article) return res.status(404).json({ error: 'Article not found.' });
  db.articles.update({ id: article.id }, { locked: false });
  res.json({ success: true });
});

module.exports = router;
