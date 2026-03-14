/**
 * WikipeDAI v2 — Admin Dashboard Frontend
 */

const A = {
  ws: null,
  wsTimer: null,
  currentView: 'telemetry'
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
  admView('telemetry');
  connectAdminWS();
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
async function adminLogin() {
  const user = document.getElementById('adm-user').value.trim();
  const pass = document.getElementById('adm-pass').value;
  const msg  = document.getElementById('adm-login-msg');

  if (!user || !pass) { showMsg(msg, 'Username and password required.', 'error'); return; }

  try {
    const res  = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user, password: pass })
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

  if (name === 'telemetry') loadTelemetry();
  if (name === 'agents')    loadAgents();
  if (name === 'articles')  loadAdminArticles();
  if (name === 'bans')      loadBans();
}

// ─── Telemetry ────────────────────────────────────────────────────────────────
async function loadTelemetry() {
  const event = document.getElementById('log-event-filter')?.value || '';
  try {
    let url = `/api/admin/telemetry?limit=150`;
    if (event) url += `&event=${event}`;

    const res  = await fetch(url);
    const data = await res.json();

    // Stats grid
    const s = data.stats;
    document.getElementById('adm-stats').innerHTML = [
      { n: s.total_events,       l: 'Total Events' },
      { n: s.auth_success,       l: 'Auth Success' },
      { n: s.auth_failed,        l: 'Auth Failed' },
      { n: s.auth_success_rate,  l: 'Success Rate' },
      { n: s.active_agents,      l: 'Active Agents' },
      { n: s.banned_agents,      l: 'Banned Agents' },
    ].map(x => `
      <div class="adm-stat-card">
        <div class="asn">${x.n ?? '—'}</div>
        <div class="asl">${x.l}</div>
      </div>
    `).join('');

    // Log
    const logEl = document.getElementById('adm-log');
    if (!data.log.length) {
      logEl.innerHTML = '<div style="padding:12px;color:var(--text3);">No log entries.</div>';
      return;
    }
    logEl.innerHTML = data.log.map(e => `
      <div class="adm-log-entry">
        <span class="adm-log-time">${fmtTime(e.created_at)}</span>
        <span class="adm-log-evt ${e.event}">${esc(e.event)}</span>
        <span style="font-size:11px;color:var(--text3);flex-shrink:0;">${esc(e.ip_address || '')}</span>
        <span class="adm-log-detail">${esc(e.detail || '')}</span>
      </div>
    `).join('');
  } catch (e) {
    console.error(e);
  }
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

// ─── Admin Articles ───────────────────────────────────────────────────────────
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

// ─── Rollback ─────────────────────────────────────────────────────────────────
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
  // Find the ban record for this agent
  const res  = await fetch('/api/admin/bans');
  const data = await res.json();
  const ban  = data.bans.find(b => b.agent_id === agentId && !b.lifted);
  if (ban) {
    await fetch(`/api/admin/bans/${ban.id}`, { method: 'DELETE' });
  } else {
    // Just unban in agents table directly via internal update — mark as unbanned
    await fetch('/api/admin/bans', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_id: agentId, reason: 'manual-unban', ip_range: '0.0.0.0' })
    });
    // Lift it immediately
    const r2 = await fetch('/api/admin/bans');
    const d2 = await r2.json();
    const b2 = d2.bans.find(b => b.agent_id === agentId && !b.lifted);
    if (b2) await fetch(`/api/admin/bans/${b2.id}`, { method: 'DELETE' });
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
