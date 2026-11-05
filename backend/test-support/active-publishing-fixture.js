'use strict';

// Real application routes and publishing adapters. Only provider transport,
// member data and durable history are synthetic; external network is disabled.
const assert = require('node:assert/strict');
const { createAppHarness, member } = require('./app-harness');
const { YOUTUBE_SCOPES } = require('../youtube-permissions');

async function createActivePublishingFixture() {
  const calls = [], writes = [], history = [];
  const state = { youtubeDenied: true, youtubeUploadDenied: false, githubReceipt: true, failHistory: false, holdWrite: null };
  const releases = new Map();
  const repository = { id: 3, full_name: 'member/project', private: false, permissions: { push: true } };
  const project = { id: 12, path_with_namespace: 'member/project', name: 'Project', archived: false };
  const tags = ['v1.0', 'v2.0', 'v3.0', 'v4.0'];
  const reply = (data, status = 200, headers = {}) => ({ status, data, headers });
  async function request(value, options = {}) {
    const url = new URL(value), method = options.method || 'GET';
    calls.push({ url: value, method, ...options });
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      writes.push({ url: value, method, ...options });
      if (state.holdWrite) await state.holdWrite;
    }
    if (url.hostname === 'api.github.com') {
      if (url.pathname === '/user') return reply({ id: 7, login: 'member', name: 'Fixture GitHub member' });
      if (url.pathname === '/user/repos') return reply([repository]);
      if (url.pathname === '/repos/member/project') return reply(repository);
      if (url.pathname === '/repos/member/project/tags') return reply(tags.map(name => ({ name })));
      const tag = decodeURIComponent(url.pathname.split('/').at(-1));
      if (url.pathname.startsWith('/repos/member/project/git/ref/tags/')) return reply({ ref: 'refs/tags/' + tag, object: { sha: 'abc123' } });
      if (url.pathname.startsWith('/repos/member/project/releases/tags/')) return releases.has('github:' + tag) ? reply({ id: 99 }) : reply({}, 404);
      if (url.pathname === '/repos/member/project/releases' && method === 'POST') {
        assert.equal(options.headers.Authorization, 'Bearer github-owner-token');
        assert.ok(tags.includes(options.json.tag_name));
        releases.set('github:' + options.json.tag_name, true);
        return reply(state.githubReceipt ? { id: 99, tag_name: options.json.tag_name, draft: false, author: { id: 7 }, html_url: 'https://github.com/member/project/releases/tag/' + options.json.tag_name } : {}, 201);
      }
    }
    if (url.hostname === 'gitlab.com') {
      if (url.pathname === '/api/v4/user') return reply({ id: 8, username: 'member', name: 'Fixture GitLab member' });
      if (url.pathname === '/api/v4/projects') return reply([project]);
      if (url.pathname === '/api/v4/projects/12') return reply(project);
      if (url.pathname === '/api/v4/projects/12/members/all/8') return reply({ id: 8, access_level: 30 });
      if (url.pathname === '/api/v4/projects/12/repository/tags') return reply(tags.map(name => ({ name })));
      const tag = decodeURIComponent(url.pathname.split('/').at(-1));
      if (url.pathname.startsWith('/api/v4/projects/12/repository/tags/')) return reply({ name: tag, commit: { id: 'def456' } });
      if (url.pathname.startsWith('/api/v4/projects/12/releases/')) return releases.has('gitlab:' + tag) ? reply({ name: tag }) : reply({}, 404);
      if (url.pathname === '/api/v4/projects/12/releases' && method === 'POST') {
        assert.equal(options.headers.Authorization, 'Bearer gitlab-owner-token');
        releases.set('gitlab:' + options.json.tag_name, true);
        return reply({ tag_name: options.json.tag_name, author: { id: 8 }, _links: { self: 'https://gitlab.com/member/project/-/releases/' + options.json.tag_name } }, 201);
      }
    }
    if (url.hostname === 'www.googleapis.com') {
      if (url.pathname === '/youtube/v3/channels') {
        if (state.youtubeDenied) return reply({ error: { message: 'The connection grants read-only access.' } }, 403);
        return reply({ items: [{ id: 'UCfixturechannel', snippet: { title: 'Fixture YouTube channel' } }] });
      }
      if (url.pathname === '/upload/youtube/v3/videos' && method === 'POST') return state.youtubeUploadDenied
        ? reply({ error: { code: 403, errors: [{ reason: 'insufficientPermissions' }], message: 'Insufficient Permission' } }, 403)
        : reply({}, 200, { location: 'https://www.googleapis.com/upload/youtube/v3/videos?upload_id=fixture-upload' });
      if (url.pathname === '/upload/youtube/v3/videos' && method === 'PUT') return reply({ id: 'fixturevideo1', snippet: { channelId: 'UCfixturechannel' } });
      if (url.pathname === '/youtube/v3/videos') return reply({ items: [] });
    }
    throw new Error('Unexpected synthetic provider request: ' + method + ' ' + value);
  }
  const app = await createAppHarness({ connected: true,
    env: { GITHUB_CLIENT_ID: 'fixture-github', GITHUB_CLIENT_SECRET: 'fixture-secret', GITLAB_CLIENT_ID: 'fixture-gitlab', GITLAB_CLIENT_SECRET: 'fixture-secret', YOUTUBE_CLIENT_ID: 'fixture-youtube', YOUTUBE_CLIENT_SECRET: 'fixture-secret', TIKTOK_CLIENT_KEY: 'fixture-tiktok', TIKTOK_CLIENT_SECRET: 'fixture-secret', CLOUDINARY_CLOUD_NAME: 'fixture' },
    query: async (sql, params = []) => {
      if (sql.includes('INSERT INTO cross_posts')) {
        if (state.failHistory) throw new Error('Synthetic durable history unavailable');
        history.unshift({ id: params[0], user_id: params[1], content: params[2], media_url: params[3], targets: JSON.parse(params[4]), created_at: new Date().toISOString() });
      }
      if (sql.includes('UPDATE cross_posts SET targets')) {
        const row = history.find(item => item.id === params[1] && item.user_id === params[2]);
        if (row) row.targets = JSON.parse(params[0]);
      }
      if (sql.includes('FROM cross_posts')) return { rows: history.filter(row => !params[0] || row.user_id === params[0]), rowCount: history.length };
      return { rows: [], rowCount: 1 };
    },
    modules: { './publishing-http': { createPublishingHttp: () => ({ request, downloadMedia: async (url, options) => {
      assert.equal(url, 'https://res.cloudinary.com/fixture/video/upload/video.mp4');
      assert.equal(options.kind, 'video');
      return { body: Buffer.from('synthetic video only'), contentType: 'video/mp4' };
    } }) } },
  });
  const owner = member('active-publisher', { plan: 'pro', joinedGroups: ['fixture-group'], socialTokens: { github: 'github-owner-token', gitlab: 'gitlab-owner-token', youtube: 'youtube-owner-token', tiktok: 'tiktok-owner-token' }, socialRefreshTokens: { youtube: 'youtube-owner-refresh' }, socialGrantedScopes: { youtube: [...YOUTUBE_SCOPES] } });
  app.seedUser(owner);
  app.seedUser(member('other-publisher', { plan: 'pro' }));
  app.setContentScreening(async ({ content }) => ({ allowed: true, content }));
  return { app, owner, state, calls, writes, history };
}

module.exports = { createActivePublishingFixture };
