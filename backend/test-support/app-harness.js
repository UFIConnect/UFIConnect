const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const http = require('node:http');
const { createRequire } = require('node:module');
const express = require('express');
const jwt = require('jsonwebtoken');

// Run the real routes without loading deployment secrets, starting workers,
// writing local account data, or connecting to production services.
async function createAppHarness({ env = {}, connected = false, query, withClient, generationUsage, modules = {} } = {}) {
  const entry = path.resolve(__dirname, '../index.js');
  const localRequire = createRequire(entry);
  // Cold SDK loading can exceed the route VM's execution limit on Windows.
  // Load the storage module before entering the timed application context.
  localRequire('./generated-media');
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
  db.withClient = withClient ? fn => withClient(fn, db.query) : async fn => fn({ query: db.query });
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
      if (name === './generation-usage' && generationUsage) return {
        ...localRequire(name), createGenerationUsage: () => generationUsage,
      };
      if (name === './filestore') return { loadUsers: () => [], saveUsers() {}, saveUsersNow() {} };
      if (name === './travel-providers') return {
        ...localRequire(name), fetchTravelResource: async () => { throw new Error('Travel provider unavailable in route tests'); },
      };
      if (name === 'http' || name === 'https') return {
        ...localRequire(name), get: blockedRequest, request: blockedRequest,
      };
      if (name === 'fs') return {
        ...fs, mkdirSync() {}, writeFileSync() {}, appendFileSync() {}, unlinkSync() {},
      };
      return localRequire(name);
    },
    process: Object.assign(Object.create(process), {
      env: { NODE_ENV: 'test', JWT_SECRET: 'route-test-only', OAUTH_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'), PORT: '0', AUTOFIX_SMOKE_TEST: '1', ...env },
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
      app, users, groups, posts, connections, blocks, follows, conversations,
      pickOnboardingGroups, fullProfile, provisionAuth0User, issueSession, createPasswordResetToken, localSessions,
      createOAuthState, verifyOAuthState, dbRowToMemUser, saveSocialToken,
      normalizeFeedPost, dbRowToFeedPost, mapSharedJobPost, parseRSSItems, trimPostContent, savePostsToDBFast,
      savePostsToDB, savePostsToDBFast, parseYouTubeChannelRSS, buildSavedPostSnapshot, ARCHIVE_COLUMNS,
      getFeedLocationContext, feedPostLocationMatch, rankFeedPostsForLocation, jobMatchesUserLocation, mainFeedSnapshotKey, mainFeedSnapshots,
      getFollowingFeedPosts, getCommunityPosts, followingSourceCache,
      sseClients, broadcastSSE, flushSSEBatch,
      refreshConnectedAccessToken,
      createDPoPProof,
      setFollowingFetcher(source, handler) { FOLLOWING_SOURCE_FETCHERS[source] = handler; },
      setTokenExchange(handler) { postForm = handler; },
      setPostJSONWithMeta(handler) { postJSONWithMeta = handler; },
      setAIText(handler) { callOpenAIText = handler; },
      setAIImage(handler) { callOpenAIImage = handler; },
      setConfiguredVideoGenerator(handler) { callConfiguredVideoGenerator = handler; },
      setAIVideoCreate(handler) { createOpenAIVideoJob = handler; },
      setAIVideoStatus(handler) { getOpenAIVideoJob = handler; },
      publishCrossPostTarget,
      setAtprotoTokenExchange(handler) { atprotoPost = handler; },
      getVideoCapableSources, videoReadAdmission,
      sourceRefreshQueue, refreshControl, SOURCE_FETCHERS, enqueueSourceRefresh, drainSourceRefreshQueue,
      makeTopicCycler, FEED_TOPICS, setSourceRefreshWait(handler) { waitMs = handler; },
      addAndBroadcast, flushFeedPersistenceQueue, ingestPersistenceQueues, transferStagedPosts,
      COUNTRIES_DESTINATION_GUIDES, LIVE_CAMERA_CATALOG, liveCameraDiscoveryCache,
      fetchYouTubeLiveStates, fetchTravelGuidePosts, fetchSelectedTravelNewsPosts, fetchSelectedTravelEventPosts,
      travelCityMatches, travelCountryMatches, selectedTravelGuideDestinations, selectedTravelNewsEdition,
      getCountriesCameraFeed, discoverLiveCameraReplacement, resolveLiveCameraDiscoveries, currentLiveCameraPosts,
      liveCameraVerificationState, liveCameraLocationRefreshes, locationLiveFeedCache,
      setYouTubeCallReady() { youtubeApiLastCallAt = 0; },
      setContentScreening(handler) { screenMemberContent = handler; },
      setResumeExtraction(handler) { extractResumeText = handler; },
      exhaustCameraDiscoveryBudget() { liveCameraDiscoveryWindowStartedAt = Date.now(); liveCameraDiscoveryCount = LIVE_CAMERA_MAX_DISCOVERIES_PER_WINDOW; },
      seedUser(user) { users.push(user); },
    };
  `, context, { filename: entry, timeout: 10000, importModuleDynamically: vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER });
  const { audit } = context;
  const server = http.createServer(audit.app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    ...audit, base, errors, queries, db,
    token(id) {
      const user = audit.users.find(user => user.id === id);
      const sid = require('node:crypto').randomUUID();
      audit.localSessions.set(sid, { userId: id, expiresAt: Date.now() + 3600000 });
      return jwt.sign({ id, sid, purpose: 'session', ver: user?.authVersion || 0 }, env.JWT_SECRET || 'route-test-only', {
        expiresIn: '1h', algorithm: 'HS256', issuer: 'uficonnect', audience: 'uficonnect-api',
      });
    },
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

// Explicit fixture for tests focused on media history or duration. Quota route
// tests use the real PostgreSQL store and its UUID account foreign keys.
function generationUsageStub() {
  const { GENERATION_LIMITS } = require('../generation-usage');
  const startsAt = new Date(); startsAt.setUTCDate(1); startsAt.setUTCHours(0, 0, 0, 0);
  const resetsAt = new Date(startsAt); resetsAt.setUTCMonth(resetsAt.getUTCMonth() + 1);
  const usage = { period: { startsAt: startsAt.toISOString(), resetsAt: resetsAt.toISOString() },
    limits: Object.fromEntries(Object.entries(GENERATION_LIMITS).map(([kind, limit]) => [kind, { limit, used: 0, remaining: limit }])) };
  return {
    async usage() { return usage; },
    async reserve(userId, kind) { return { id: require('node:crypto').randomUUID(), userId, kind, periodStart: usage.period.startsAt, usage }; },
    async complete() { return true; }, async release() { return true; },
  };
}

module.exports = { createAppHarness, member, generationUsageStub };
