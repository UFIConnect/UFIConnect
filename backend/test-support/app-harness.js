const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');
const { createRequire } = require('node:module');
const express = require('express');
const jwt = require('jsonwebtoken');

// Run the real routes without loading deployment secrets, starting workers,
// writing local account data, or connecting to production services.
async function createAppHarness({ env = {}, connected = false, query, modules = {} } = {}) {
  const entry = path.resolve(__dirname, '../index.js');
  const localRequire = createRequire(entry);
  const queries = [];
  const errors = [];
  const db = {
    isConnected: () => connected,
    isBackupConnected: () => false,
    isReadFailoverActive: () => false,
    getBackupStatus: () => ({}),
    initDB: () => new Promise(() => {}),
    query: async (sql, params = []) => {
      queries.push({ sql, params });
      if (query) return query(sql, params);
      return { rows: [], rowCount: 0 };
    },
  };
  db.withClient = async fn => fn({ query: db.query });
  db.readQuery = db.query;
  const expressFactory = Object.assign(() => {
    const app = express();
    app.listen = () => null;
    return app;
  }, express);
  const timer = () => ({ unref() {}, ref() {} });
  const blockedRequest = () => { throw new Error('External network disabled in route tests'); };
  const context = vm.createContext({
    require(name) {
      if (Object.prototype.hasOwnProperty.call(modules, name)) return modules[name];
      if (name === 'express') return expressFactory;
      if (name === 'dotenv') return { config() {} };
      if (name === './db') return db;
      if (name === './filestore') return { loadUsers: () => [], saveUsers() {} };
      if (name === 'http' || name === 'https') return {
        ...localRequire(name), get: blockedRequest, request: blockedRequest,
      };
      if (name === 'fs') return {
        ...fs, mkdirSync() {}, writeFileSync() {}, appendFileSync() {}, unlinkSync() {},
      };
      return localRequire(name);
    },
    process: Object.assign(Object.create(process), {
      env: { NODE_ENV: 'test', JWT_SECRET: 'route-test-only', PORT: '0', AUTOFIX_SMOKE_TEST: '1', ...env },
      on() {},
    }),
    console: { log() {}, warn() {}, error: (...args) => errors.push(args.map(String).join(' ')) },
    Buffer, URL, URLSearchParams, AbortController, AbortSignal, TextEncoder, TextDecoder,
    structuredClone, setTimeout: timer, clearTimeout() {}, setInterval: timer, clearInterval() {},
    setImmediate, clearImmediate, fetch: blockedRequest,
    __dirname: path.dirname(entry), __filename: entry, module: { exports: {} }, exports: {},
  });
  vm.runInContext(fs.readFileSync(entry, 'utf8') + `
    globalThis.audit = {
      app, users, groups, posts, connections, blocks, follows,
      pickOnboardingGroups, fullProfile, provisionAuth0User,
      normalizeFeedPost, dbRowToFeedPost, mapSharedJobPost,
      seedUser(user) { users.push(user); },
    };
  `, context, { filename: entry, timeout: 10000, importModuleDynamically: vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER });
  const { audit } = context;
  const server = http.createServer(audit.app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    ...audit, base, errors, queries, db,
    token(id) { return jwt.sign({ id }, 'route-test-only', { expiresIn: '1h' }); },
    async request(url, { userId, body, headers = {}, method = 'GET' } = {}) {
      const res = await fetch(base + url, {
        method, headers: { ...(userId ? { authorization: `Bearer ${this.token(userId)}` } : {}),
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(5000),
      });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch { data = text; }
      return { status: res.status, data, headers: res.headers };
    },
    async close() {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    },
  };
}

function member(id, overrides = {}) {
  return {
    id, name: `Test ${id}`, email: `${id}@example.invalid`, phone: '+15555550100',
    title: '', bio: '', organization: '', skills: [], joinedGroups: [],
    onboardingComplete: true, preferences: { role: '', goals: [], interests: [], experience: '' },
    roleSettings: {}, socialAccounts: {}, socialTokens: {}, socialRefreshTokens: {},
    socialConnectedAt: {}, links: {}, plan: 'free', ...overrides,
  };
}

module.exports = { createAppHarness, member };
