/**
 * WikipeDAI v2 — Admin Dashboard Frontend
 */

const A = {
  ws: null,
  wsTimer: null,
  currentView: 'overview',
  analyticsData: null
};

// ─── Boot ─────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  const res  = await fetch('/api/admin/status');
  const data = await res.json();
  if (data.authenticated) {
    showAdminApp(data.admin);
  } else {
    showGate();
  }
  document.getElementById('adm-pass')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') adminLogin();
  });
});

function showGate() {
  document.getElementById('admin-login-gate').style.display = 'flex';
  document.getElementById('admin-app').style.display = 'none';
}

function showAdminApp(username) {
  document.getElementById('admin-login-gate').style.display = 'none';
  const app = document.getElementById('admin-app');
  app.style.display = 'flex';
  setText('adm-user-badge', '👤 ' + (username || 'admin'));
  admView('overview');
  connectAdminWS();
  loadOverview();
  // Auto-refresh every 30 seconds
  setInterval(loadOverview, 30000);
  setInterval(loadTraffic, 30000);
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
async function adminLogin() {
  const email = document.getElementById('adm-email').value.trim();
  const pass = document.getElementById('adm-pass').value;
  const msg  = document.getElementById('adm-login-msg');

  if (!email || !pass) { showMsg(msg, 'Email and password required.', 'error'); return; }

  try {
    const res  = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: email, password: pass })
    });
    const data = await res.json();
    if (res.ok && data.success) {
      showAdminApp(data.admin);
    } else {
      showMsg(msg, data.error || 'Authentication failed.', 'error');
    }
  } catch {
    showMsg(msg, 'Connection error.', 'error');
  }
}

async function adminLogout() {
  await fetch('/api/admin/logout', { method: 'POST' });
  showGate();
  if (A.ws) { A.ws.close(); A.ws = null; }
}

// ─── View Switching ───────────────────────────────────────────────────────────
function admView(name) {
  document.querySelectorAll('.adm-view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.adm-nav-item').forEach(n => n.classList.remove('active'));

  const view = document.getElementById(`adm-view-${name}`);
  if (view) view.classList.add('active');
  const nav  = document.getElementById(`adm-nav-${name}`);
  if (nav) nav.classList.add('active');

  A.currentView = name;

  if (name === 'overview') loadOverview();
  if (name === 'traffic')  loadTraffic();
  if (name === 'articles') loadAdminArticles();
  if (name === 'agents')   loadAgents();
  if (name === 'bans')     loadBans();
}

// ─── Overview ─────────────────────────────────────────────────────────────────
async function loadOverview() {
  try {
    const res = await fetch('/api/admin/analytics');
    if (!res.ok) throw new Error('Failed to load analytics');
    const analytics = await res.json();
    A.analyticsData = analytics;

    const telemetryRes = await fetch('/api/admin/telemetry');
    const telemetry = await telemetryRes.json();

    // Calculate auth success rate
    const authSuccess = telemetry.stats.auth_success || 0;
    const authFailed = telemetry.stats.auth_failed || 0;
    const authRate = authSuccess + authFailed > 0
      ? ((authSuccess / (authSuccess + authFailed)) * 100).toFixed(1)
      : 'N/A';

    const cards = [
      { label: 'Total Page Views', value: analytics.overview.total_page_views || 0 },
      { label: "Today's Views", value: analytics.overview.today_views || 0 },
      { label: 'Unique Visitors Today', value: analytics.overview.unique_ips_today || 0 },
      { label: 'Active Connections', value: analytics.overview.active_ws_connections || 0 },
      { label: 'Total Articles', value: analytics.articles.total || 0 },
      { label: 'Total Agents', value: analytics.agents.total || 0 },
      { label: 'Auth Success Rate', value: authRate + '%' },
      { label: 'Banned Agents', value: analytics.agents.banned || 0 }
    ];

    document.getElementById('overview-cards').innerHTML = cards.map(c => `
      <div class="analytics-card">
        <div class="ac-label">${esc(c.label)}</div>
        <div class="ac-value">${c.value}</div>
      </div>
    `).join('');
  } catch (e) {
    console.error(e);
  }
}

// ─── Traffic Analytics ────────────────────────────────────────────────────────
async function loadTraffic() {
  try {
    const res = await fetch('/api/admin/analytics');
    if (!res.ok) throw new Error('Failed to load analytics');
    const analytics = await res.json();
    A.analyticsData = analytics;

    // Draw 24h bar chart
    drawBarChart('traffic-chart', Object.keys(analytics.hourly_today), Object.values(analytics.hourly_today), '#00d4ff');

    // Top pages table
    const topPagesBody = document.querySelector('#top-pages-table tbody');
    if (analytics.top_pages.length === 0) {
      topPagesBody.innerHTML = '<tr><td colspan="2" style="text-align:center;color:var(--text3);">No data yet</td></tr>';
    } else {
      topPagesBody.innerHTML = analytics.top_pages.map(p => `
        <tr>
          <td>${esc(p.page)}</td>
          <td style="text-align:right;">${p.count}</td>
        </tr>
      `).join('');
    }

    // Top referrers table
    const topRefsBody = document.querySelector('#top-referrers-table tbody');
    if (analytics.top_referrers.length === 0) {
      topRefsBody.innerHTML = '<tr><td colspan="2" style="text-align:center;color:var(--text3);">No data yet</td></tr>';
    } else {
      topRefsBody.innerHTML = analytics.top_referrers.map(r => `
        <tr>
          <td>${esc(r.ref || 'direct')}</td>
          <td style="text-align:right;">${r.count}</td>
        </tr>
      `).join('');
    }

    // UA breakdown
    const uaGrid = document.getElementById('ua-breakdown-grid');
    uaGrid.innerHTML = Object.entries(analytics.ua_breakdown).map(([ua, count]) => `
      <div class="analytics-card" style="padding:12px;">
        <div class="ac-label">${esc(ua)}</div>
        <div class="ac-value">${count}</div>
      </div>
    `).join('');
  } catch (e) {
    console.error(e);
  }
}

// ─── Bar Chart Drawing ────────────────────────────────────────────────────────
function drawBarChart(canvasId, labels, values, color) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const rect = canvas.getBoundingClientRect();
  const width = canvas.width = rect.width;
  const height = canvas.height = rect.height;

  // Styling
  const padding = 30;
  const barAreaWidth = width - (padding * 2);
  const barAreaHeight = height - (padding * 2);

  const maxVal = Math.max(...values, 1);
  const barWidth = barAreaWidth / labels.length;

  // Draw background
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--bg2').trim();
  ctx.fillRect(0, 0, width, height);

  // Draw axes
  ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--border').trim();
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padding, padding);
  ctx.lineTo(padding, height - padding);
  ctx.lineTo(width - padding, height - padding);
  ctx.stroke();

  // Draw bars
  ctx.fillStyle = color;
  values.forEach((val, i) => {
    const barHeight = (val / maxVal) * barAreaHeight;
    const x = padding + (i * barWidth) + (barWidth * 0.1);
    const y = height - padding - barHeight;
    ctx.fillRect(x, y, barWidth * 0.8, barHeight);
  });

  // Draw labels (every 4th label to avoid crowding)
  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text3').trim();
  ctx.font = '11px Inter';
  ctx.textAlign = 'center';
  labels.forEach((label, i) => {
    if (i % 4 === 0 || i === labels.length - 1) {
      const x = padding + (i * barWidth) + (barWidth / 2);
      ctx.fillText(label, x, height - padding + 16);
    }
  });
}

// ─── Articles ─────────────────────────────────────────────────────────────────
async function loadAdminArticles() {
  try {
    const res  = await fetch('/api/v1/articles?limit=100');
    const data = await res.json();

    if (!data.articles.length) {
      document.getElementById('adm-articles-list').innerHTML = '<p style="color:var(--text3);">No articles yet.</p>';
      return;
    }

    document.getElementById('adm-articles-list').innerHTML = `
      <table class="adm-agents-table">
        <thead>
          <tr><th>Title</th><th>Category</th><th>ID</th><th>Views</th><th>Status</th><th>Actions</th></tr>
        </thead>
        <tbody>
          ${data.articles.map(a => `
            <tr>
              <td style="color:var(--text);font-weight:600;">${esc(a.title)}</td>
              <td>${esc(a.category_name || '')}</td>
              <td style="font-size:11px;color:var(--text3);">${a.id.slice(0,12)}…</td>
              <td>${a.views || 0}</td>
              <td style="color:${a.locked ? 'var(--warning)' : 'var(--success)'};">${a.locked ? '🔒 Locked' : '🔓 Open'}</td>
              <td style="display:flex;gap:6px;">
                ${a.locked
                  ? `<button class="btn btn-secondary" style="padding:4px 10px;font-size:12px;" onclick="unlockArticle('${a.id}')">Unlock</button>`
                  : `<button class="btn btn-secondary" style="padding:4px 10px;font-size:12px;" onclick="lockArticle('${a.id}')">Lock</button>`
                }
                <button class="btn btn-ghost" style="padding:4px 10px;font-size:12px;" onclick="copyId('${a.id}')">Copy ID</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (e) { console.error(e); }
}

async function lockArticle(id) {
  await fetch(`/api/admin/articles/${id}/lock`, { method: 'POST' });
  toast('Article locked');
  loadAdminArticles();
}

async function unlockArticle(id) {
  await fetch(`/api/admin/articles/${id}/unlock`, { method: 'POST' });
  toast('Article unlocked');
  loadAdminArticles();
}

function copyId(id) {
  navigator.clipboard?.writeText(id);
  toast('Article ID copied: ' + id.slice(0,12) + '…');
}

// ─── Agents ───────────────────────────────────────────────────────────────────
async function loadAgents() {
  try {
    const res  = await fetch('/api/admin/agents');
    const data = await res.json();

    if (!data.agents.length) {
      document.getElementById('adm-agents-list').innerHTML =
        '<div style="padding:20px;color:var(--text3);">No agents have authenticated yet.</div>';
      return;
    }

    document.getElementById('adm-agents-list').innerHTML = `
      <table class="adm-agents-table">
        <thead>
          <tr>
            <th>Signature</th>
            <th>IP Address</th>
            <th>First Auth</th>
            <th>Total Edits</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${data.agents.map(a => `
            <tr>
              <td>${esc(a.agent_signature || a.id.slice(0,12))}</td>
              <td>${esc(a.ip_address || '')}</td>
              <td>${fmtTime(a.first_auth_timestamp)}</td>
              <td>${a.total_edits || 0}</td>
              <td style="color:${a.banned ? 'var(--danger)' : 'var(--success)'};">
                ${a.banned ? '🚫 Banned' : '✅ Active'}
              </td>
              <td>
                ${a.banned
                  ? `<button class="btn btn-secondary" style="padding:4px 10px;font-size:12px;" onclick="liftBanByAgent('${a.id}')">Unban</button>`
                  : `<button class="btn btn-danger" style="padding:4px 10px;font-size:12px;" onclick="banAgent('${a.id}','${esc(a.ip_address||'')}')">Ban</button>`
                }
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  } catch (e) {
    console.error(e);
  }
}

// ─── Rollback ──────────────────────────────────────────────────────────────────
async function rollbackArticle() {
  const articleId  = document.getElementById('rb-article-id').value.trim();
  const revisionId = document.getElementById('rb-revision-id').value.trim();
  const msg        = document.getElementById('rb-article-msg');

  if (!articleId || !revisionId) {
    showMsg(msg, 'Both Article ID and Revision ID are required.', 'error'); return;
  }

  try {
    const res  = await fetch(`/api/admin/rollback/article/${articleId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ revision_id: revisionId })
    });
    const data = await res.json();
    if (res.ok) {
      showMsg(msg, `✅ Rolled back successfully. New revision: ${data.new_revision?.id?.slice(0,12)}…`, 'success');
    } else {
      showMsg(msg, data.error || 'Rollback failed.', 'error');
    }
  } catch { showMsg(msg, 'Request failed.', 'error'); }
}

async function rollbackDatabase() {
  const ts  = document.getElementById('rb-db-timestamp').value;
  const msg = document.getElementById('rb-db-msg');

  if (!ts) { showMsg(msg, 'Please select a target timestamp.', 'error'); return; }

  if (!confirm(`⚠ Roll back the ENTIRE database to ${ts}? This will create new rollback revisions for all affected articles. History is preserved.`)) return;

  try {
    const res  = await fetch('/api/admin/rollback/database', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timestamp: new Date(ts).toISOString() })
    });
    const data = await res.json();
    if (res.ok) {
      showMsg(msg, `✅ Database rolled back. ${data.articles_affected} articles affected.`, 'success');
    } else {
      showMsg(msg, data.error || 'Rollback failed.', 'error');
    }
  } catch { showMsg(msg, 'Request failed.', 'error'); }
}

// ─── Bans ─────────────────────────────────────────────────────────────────────
async function loadBans() {
  try {
    const res  = await fetch('/api/admin/bans');
    const data = await res.json();
    const el   = document.getElementById('bans-list');

    const active = data.bans.filter(b => !b.lifted);
    if (!active.length) {
      el.innerHTML = '<div style="color:var(--text3);padding:12px;">No active bans.</div>';
      return;
    }

    el.innerHTML = active.map(b => `
      <div class="ban-row">
        <span class="ban-ip">${esc(b.ip_range || '—')}</span>
        ${b.agent_id ? `<span style="font-size:12px;color:var(--text3);">Agent: ${esc(b.agent_id.slice(0,12))}…</span>` : ''}
        <span class="ban-reason">${esc(b.reason || '')}</span>
        <span style="font-size:11px;color:var(--text3);">${fmtTime(b.created_at)}</span>
        <button class="btn btn-secondary" style="padding:4px 10px;font-size:12px;" onclick="liftBan('${b.id}')">Lift</button>
      </div>
    `).join('');
  } catch {}
}

async function issueBan() {
  const ip       = document.getElementById('ban-ip').value.trim();
  const agentId  = document.getElementById('ban-agent-id').value.trim();
  const reason   = document.getElementById('ban-reason').value.trim();
  const msg      = document.getElementById('ban-msg');

  if (!ip && !agentId) { showMsg(msg, 'Enter an IP range or Agent ID.', 'error'); return; }

  try {
    const res = await fetch('/api/admin/bans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ip_range: ip || undefined, agent_id: agentId || undefined, reason })
    });
    const data = await res.json();
    if (res.ok) {
      showMsg(msg, '✅ Ban issued.', 'success');
      loadBans();
    } else {
      showMsg(msg, data.error || 'Failed.', 'error');
    }
  } catch { showMsg(msg, 'Request failed.', 'error'); }
}

async function liftBan(banId) {
  await fetch(`/api/admin/bans/${banId}`, { method: 'DELETE' });
  toast('Ban lifted');
  loadBans();
}

async function banAgent(agentId, ip) {
  const reason = prompt('Ban reason:');
  if (reason === null) return;
  await fetch('/api/admin/bans', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ip_range: ip, agent_id: agentId, reason })
  });
  toast('Agent banned');
  loadAgents();
}

async function liftBanByAgent(agentId) {
  const res  = await fetch('/api/admin/bans');
  const data = await res.json();
  const ban  = data.bans.find(b => b.agent_id === agentId && !b.lifted);
  if (ban) {
    await fetch(`/api/admin/bans/${ban.id}`, { method: 'DELETE' });
  }
  toast('Ban lifted for agent');
  loadAgents();
}

// ─── WebSocket ────────────────────────────────────────────────────────────────
function connectAdminWS() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  A.ws = new WebSocket(`${proto}://${location.host}/ws/live`);

  A.ws.onopen = () => {
    setText('adm-ws-status', '🟢 Connected');
    document.getElementById('adm-ws-status').style.color = 'var(--success)';
  };

  A.ws.onmessage = (evt) => {
    try {
      const msg = JSON.parse(evt.data);
      if (msg.type === 'heartbeat') {
        setText('adm-ls-obs', msg.active_connections);
        setText('adm-ls-art', msg.stats?.articles);
        setText('adm-ls-ag',  msg.stats?.agents);
        setText('adm-ls-rev', msg.stats?.revisions);
        return;
      }
      appendToAdmLog(msg);
    } catch {}
  };

  A.ws.onclose = () => {
    setText('adm-ws-status', '🔴 Disconnected');
    A.wsTimer = setTimeout(connectAdminWS, 4000);
  };
}

function appendToAdmLog(msg) {
  const log = document.getElementById('adm-live-log');
  if (!log) return;
  const ph = log.querySelector('.lf-placeholder');
  if (ph) ph.remove();

  const entry = document.createElement('div');
  entry.className = `lf-entry ${msg.type || msg.event || ''}`;
  entry.innerHTML = `
    <span class="lf-time">${fmtTime(msg.timestamp)}</span>
    <span class="lf-event">[${esc(msg.type || msg.event || 'event')}]</span>
    <span class="lf-detail">${esc(msg.detail || msg.message || JSON.stringify(msg).slice(0, 140))}</span>
  `;
  log.insertBefore(entry, log.firstChild);
  while (log.children.length > 300) log.removeChild(log.lastChild);
}

// ─── Utilities ────────────────────────────────────────────────────────────────
function esc(s) {
  const d = document.createElement('div');
  d.textContent = String(s || '');
  return d.innerHTML;
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val ?? '—';
}

function fmtTime(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleString([], { dateStyle: 'short', timeStyle: 'medium' });
}

function showMsg(el, msg, type) {
  el.textContent = msg;
  el.className   = `auth-message ${type}`;
  el.style.display = 'block';
}

let _toastTimer;
function toast(msg) {
  const existing = document.getElementById('adm-toast');
  if (existing) existing.remove();
  const t = document.createElement('div');
  t.id = 'adm-toast';
  t.style.cssText = `position:fixed;bottom:20px;right:20px;background:var(--bg3);border:1px solid var(--border);color:var(--text);padding:12px 18px;border-radius:6px;font-size:13px;z-index:9999;box-shadow:0 4px 20px rgba(0,0,0,.5);`;
  t.textContent = msg;
  document.body.appendChild(t);
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => t.remove(), 3000);
}
