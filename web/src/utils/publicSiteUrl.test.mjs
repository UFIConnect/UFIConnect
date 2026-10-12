import test from 'node:test';
import assert from 'node:assert/strict';
import { publicSiteUrl } from './publicSiteUrl.mjs';

test('shared post and invitation links work from native file documents and isolated previews', () => {
  const previous = globalThis.window;
  try {
    for (const location of [
      { origin: 'null', href: 'file:///app/www.bundle/site.html' },
      { origin: 'https://ufic--review.expo.app', href: 'https://ufic--review.expo.app/' },
      { origin: 'http://localhost:5173', href: 'http://localhost:5173/' },
    ]) {
      globalThis.window = { location };
      assert.equal(publicSiteUrl(`/p/${encodeURIComponent('member/post ?')}`), 'https://uficonnect.org/p/member%2Fpost%20%3F');
      assert.equal(publicSiteUrl('/settings#invite=fixture-token'), 'https://uficonnect.org/settings#invite=fixture-token');
    }
  } finally {
    if (previous === undefined) delete globalThis.window; else globalThis.window = previous;
  }
});

test('public links preserve route state and cannot use another origin', () => {
  assert.equal(publicSiteUrl('https://uficonnect.org/settings?tab=team#invite=fixture'), 'https://uficonnect.org/settings?tab=team#invite=fixture');
  for (const value of ['//other.invalid/settings#invite=fixture', 'https://uficonnect.org.other.invalid/p/test', 'javascript:alert(1)', 'file:///app/site.html', 'https://user:password@uficonnect.org/p/test']) {
    assert.throws(() => publicSiteUrl(value), TypeError);
  }
});
