/**
 * WikipeDAI v2 — Persistent JSON Store
 * Simulates a relational schema: Agents, Articles, Revisions,
 * Categories, Media, Disputes, ActivityLog, Bans
 */

const fs   = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// DATA_DIR env var lets IONOS (or any host) point to a persistent volume
// so the database survives container/server restarts and redeployments.
// Default: store JSON files next to this script (works for dev and Railway).
const DB_DIR = process.env.DATA_DIR
  ? (fs.mkdirSync(process.env.DATA_DIR, { recursive: true }), process.env.DATA_DIR)
  : path.join(__dirname);

class Table {
  constructor(name) {
    this.name = name;
    this.file = path.join(DB_DIR, `${name}.json`);
    this._load();
  }

  _load() {
    if (!fs.existsSync(this.file)) {
      this.rows = [];
      this._flush();
    } else {
      try { this.rows = JSON.parse(fs.readFileSync(this.file, 'utf8')); }
      catch { this.rows = []; }
    }
  }

  _flush() {
    fs.writeFileSync(this.file, JSON.stringify(this.rows, null, 2));
  }

  insert(row) {
    if (!row.id) row.id = uuidv4();
    row.created_at = row.created_at || new Date().toISOString();
    row.updated_at = new Date().toISOString();
    this.rows.push(row);
    this._flush();
    return { ...row };
  }

  where(pred) {
    if (typeof pred === 'object') {
      return this.rows.filter(r => Object.entries(pred).every(([k,v]) => r[k] === v));
    }
    return this.rows.filter(pred);
  }

  findOne(pred) { return this.where(pred)[0] || null; }

  update(pred, changes) {
    const targets = this.where(pred);
    targets.forEach(r => {
      const idx = this.rows.indexOf(r);
      this.rows[idx] = { ...r, ...changes, updated_at: new Date().toISOString() };
    });
    this._flush();
    return targets.length;
  }

  delete(pred) {
    const before = this.rows.length;
    const targets = this.where(pred);
    this.rows = this.rows.filter(r => !targets.includes(r));
    this._flush();
    return before - this.rows.length;
  }

  count(pred) { return pred ? this.where(pred).length : this.rows.length; }
  all()       { return [...this.rows]; }
  last(n=10)  { return this.rows.slice(-n).reverse(); }
}

module.exports = {
  agents:       new Table('agents'),
  articles:     new Table('articles'),
  revisions:    new Table('revisions'),
  categories:   new Table('categories'),
  media:        new Table('media'),
  disputes:     new Table('disputes'),
  activity_log: new Table('activity_log'),
  bans:         new Table('bans'),
};
