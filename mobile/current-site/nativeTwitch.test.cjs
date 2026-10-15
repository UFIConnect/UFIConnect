const { test } = require('node:test');
const assert = require('node:assert/strict');
const { clipRequest, twitchPageUrl, allowTwitchNavigation } = require('./nativeTwitch.cjs');

test('native clip requests expose only the public slug to the hosted player', () => {
  const player = clipRequest({ url: 'https://clips.twitch.tv/ExampleClip-123', title: ' Clip\nname ', creator: ' Streamer ', token: 'private' });
  assert.deepEqual(player, { clip: 'ExampleClip-123', originalUrl: 'https://clips.twitch.tv/ExampleClip-123',
    wrapperUrl: 'https://uficonnect.org/twitch-player.html?clip=ExampleClip-123', title: 'Clip name', creator: 'Streamer' });
  assert.equal(clipRequest({ url: player.originalUrl }).title, 'Twitch clip');
  assert.equal(clipRequest({ url: player.originalUrl, creator: 'x'.repeat(200) }).creator.length, 80);
});

test('native player rejects arbitrary pages, URL credentials, query strings and malformed clip IDs', () => {
  for (const url of ['http://clips.twitch.tv/Example', 'https://clips.twitch.tv/Example?token=private',
    'https://clips.twitch.tv/embed', 'https://clips.twitch.tv/create', 'https://clips.twitch.tv/Example#fragment',
    'https://clips.twitch.tv@evil.example/Example', 'https://clips.twitch.tv.evil.example/Example',
    'https://clips.twitch.tv/%2Fadmin', 'https://clips.twitch.tv/Example/extra', 'javascript:alert(1)', 'file:///secret']) {
    assert.throws(() => clipRequest({ url }), /valid Twitch clip/);
  }
  assert.throws(() => clipRequest({ url: 'https://clips.twitch.tv/Example', title: {} }), /Invalid Twitch/);
});

test('embedded navigation retains the exact first-party parent and official Twitch destinations', () => {
  const player = clipRequest({ url: 'https://clips.twitch.tv/Example' });
  assert.equal(allowTwitchNavigation({ url: player.wrapperUrl, isTopFrame: true }, player), true);
  assert.equal(allowTwitchNavigation({ url: 'https://clips.twitch.tv/embed?clip=Example&parent=uficonnect.org', isTopFrame: false }, player), true);
  assert.equal(allowTwitchNavigation({ url: 'https://www.twitch.tv/creator', isTopFrame: true }, player), true);
  assert.equal(allowTwitchNavigation({ url: 'https://video.ttvnw.net/frame', isTopFrame: false }, player), true);
  assert.equal(allowTwitchNavigation({ url: 'https://video.ttvnw.net/frame', isTopFrame: true }, player), false);
  for (const url of ['https://uficonnect.org/account', player.wrapperUrl + '&token=secret', 'https://evil.example/',
    'https://twitch.tv.evil.example/clip', 'https://evil@twitch.tv/', 'https://twitch.tv:8443/', 'https://twitch.tv\\@evil.example/', 'javascript:alert(1)', 'file:///private']) {
    assert.equal(allowTwitchNavigation({ url, isTopFrame: true }, player), false, url);
    assert.equal(twitchPageUrl(url), null, url);
  }
});

test('official player subframes can load HTTPS ad and consent pages without opening other main-frame destinations', () => {
  const player = clipRequest({ url: 'https://clips.twitch.tv/Example' });
  for (const url of ['https://consent.example.com/frame?provider=twitch', 'https://ads.example.com:443/player', 'https://metrics.example.com/#consent']) {
    assert.equal(allowTwitchNavigation({ url, isTopFrame: false }, player), true, url);
    assert.equal(allowTwitchNavigation({ url, isTopFrame: true }, player), false, url);
    assert.equal(allowTwitchNavigation({ url }, player), false, url);
  }
  assert.equal(allowTwitchNavigation({ url: 'about:blank', isTopFrame: false }, player), true);
  for (const url of ['http://ads.example.com/frame', 'https://user:pass@ads.example.com/frame', 'https://ads.example.com\\@evil.example/',
    'https://ads.example.com/\nframe', 'https://ads.example.com/\u0000frame', 'https://ads.example.com:8443/',
    'https://ads..example.com/frame', 'javascript:alert(1)', 'twitch://open', 'mailto:test@example.com',
    'file:///private', 'data:text/html,hello', 'blob:https://clips.twitch.tv/example']) {
    assert.equal(allowTwitchNavigation({ url, isTopFrame: false }, player), false, url);
    assert.equal(allowTwitchNavigation({ url, isTopFrame: true }, player), false, url);
  }
});
