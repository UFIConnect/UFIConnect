/**
 * filestore.js — file-based JSON persistence fallback.
 *
 * Used when DATABASE_URL is not configured. Stores user records on disk so
 * accounts survive server restarts during local development and single-instance
 * deploys without a PostgreSQL database.
 */

const fs   = require('fs');
const path = require('path');
const { createTokenVault } = require('./token-vault');

const DATA_DIR   = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  }
}

function loadUsers() {
  ensureDir();
  try {
    const raw = fs.readFileSync(USERS_FILE, 'utf8');
    const data = JSON.parse(raw);
    if (!Array.isArray(data)) throw new Error('Invalid local account store.');
    const vault = createTokenVault();
    const migrated = data.map(user => ({
      ...user,
      socialTokens: vault.migrateMap(user.socialTokens, user.id, 'access'),
      socialRefreshTokens: vault.migrateMap(user.socialRefreshTokens, user.id, 'refresh'),
    }));
    if (JSON.stringify(data) !== JSON.stringify(migrated)) writeSnapshot(migrated);
    return migrated.map(user => ({
      ...user,
      socialTokens: vault.decryptMap(user.socialTokens, user.id, 'access'),
      socialRefreshTokens: vault.decryptMap(user.socialRefreshTokens, user.id, 'refresh'),
    }));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw new Error('Could not securely load local accounts. Check the account store and encryption key.');
  }
}

let _saveTimer = null;
let _pendingUsers = null;

function saveUsers(users) {
  _pendingUsers = serializeUsers(users);
  if (_saveTimer) return;
  _saveTimer = setTimeout(() => {
    _saveTimer = null;
    if (!_pendingUsers) return;
    const snapshot = _pendingUsers;
    _pendingUsers = null;
    ensureDir();
    try {
      writeSnapshot(snapshot);
    } catch (e) {
      console.error('[filestore] Failed to save users:', e.message);
    }
  }, 500);
}

function serializeUsers(users) {
  const vault = createTokenVault();
  return users.map(user => ({
    ...user,
    socialTokens: vault.encryptMap(user.socialTokens, user.id, 'access'),
    socialRefreshTokens: vault.encryptMap(user.socialRefreshTokens, user.id, 'refresh'),
  }));
}

function writeSnapshot(snapshot) {
  ensureDir();
  const temporary = `${USERS_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(snapshot, null, 2), { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, USERS_FILE);
}

function saveUsersNow(users) {
  const snapshot = serializeUsers(users);
  writeSnapshot(snapshot);
  if (_saveTimer) clearTimeout(_saveTimer);
  _saveTimer = null;
  _pendingUsers = null;
}

module.exports = { loadUsers, saveUsers, saveUsersNow };
