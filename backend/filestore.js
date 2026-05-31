/**
 * filestore.js — file-based JSON persistence fallback.
 *
 * Used when DATABASE_URL is not configured. Stores user records on disk so
 * accounts survive server restarts during local development and single-instance
 * deploys without a PostgreSQL database.
 */

const fs   = require('fs');
const path = require('path');

const DATA_DIR   = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadUsers() {
  ensureDir();
  try {
    const raw = fs.readFileSync(USERS_FILE, 'utf8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

let _saveTimer = null;
let _pendingUsers = null;

function saveUsers(users) {
  _pendingUsers = users;
  if (_saveTimer) return;
  _saveTimer = setTimeout(() => {
    _saveTimer = null;
    if (!_pendingUsers) return;
    const snapshot = _pendingUsers;
    _pendingUsers = null;
    ensureDir();
    try {
      fs.writeFileSync(USERS_FILE, JSON.stringify(snapshot, null, 2), 'utf8');
    } catch (e) {
      console.error('[filestore] Failed to save users:', e.message);
    }
  }, 500);
}

module.exports = { loadUsers, saveUsers };
