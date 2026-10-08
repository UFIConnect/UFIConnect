import test from 'node:test';
import assert from 'node:assert/strict';
import { messageFileError, messageAttachmentPath, legacyMessageUrl, messageBlobError, createMessageRequestScope } from './messageSecurity.mjs';

test('message files and delivered blobs permit only bounded raster photos and supported videos', () => {
  assert.equal(messageFileError({ type: 'image/jpeg', size: 10 * 1024 * 1024 }), '');
  assert.equal(messageFileError({ type: 'video/mp4', size: 100 * 1024 * 1024 }), '');
  for (const type of ['image/svg+xml', 'text/html', 'application/pdf', 'video/unknown']) assert.ok(messageFileError({ type, size: 1 }));
  assert.ok(messageFileError({ type: 'image/jpeg', size: 10 * 1024 * 1024 + 1 }));
  assert.ok(messageFileError({ type: 'video/mp4', size: 100 * 1024 * 1024 + 1 }));
  assert.ok(messageFileError({ type: 'image/jpeg', size: 0 }));
  assert.equal(messageBlobError(new Blob(['data'], { type: 'image/jpeg' }), 'image'), '');
  assert.ok(messageBlobError(new Blob(['html'], { type: 'text/html' }), 'image'));
  assert.ok(messageBlobError(new Blob(['svg'], { type: 'image/svg+xml' }), 'image'));
});

test('attachment requests are pinned to the displayed member and message path', () => {
  const expected = '/messages/member%2Fa/attachments/msg%3Fid';
  assert.equal(messageAttachmentPath({ type: 'image', accessPath: expected }, 'member/a', 'msg?id'), expected);
  for (const accessPath of ['https://attacker.invalid/file', '//attacker.invalid/file', '/messages/other/attachments/msg%3Fid', '/messages/member%2Fa/attachments/another']) {
    assert.equal(messageAttachmentPath({ type: 'image', accessPath }, 'member/a', 'msg?id'), null);
  }
});

test('historical messages cannot auto-load arbitrary schemes, third-party tracking or active files', () => {
  const url = 'https://res.cloudinary.com/fixture/image/upload/v1/uficonnect-messages/file.jpg';
  assert.equal(legacyMessageUrl({ type: 'image', url, legacy: true }), url);
  assert.equal(legacyMessageUrl({ type: 'image', url }), null);
  for (const href of ['javascript:alert(1)', 'data:image/svg+xml,hi', 'https://attacker.invalid/file.jpg',
    'https://res.cloudinary.com/fixture/image/upload/v1/uficonnect-messages/file.svg',
    'https://user:password@res.cloudinary.com/fixture/image/upload/v1/uficonnect-messages/file.jpg',
    'https://res.cloudinary.com/fixture/image/upload/v1/other/file.jpg']) {
    assert.equal(legacyMessageUrl({ type: 'image', url: href, legacy: true }), null);
  }
});

test('recipient navigation and account changes cancel old message requests and discard late private responses', async () => {
  const scope = createMessageRequestScope();
  let finish;
  const response = new Promise(resolve => { finish = resolve; });
  const displayed = [];
  const pending = response.then(value => { if (scope.isCurrent()) displayed.push(value); });
  let aborted = false; scope.signal.addEventListener('abort', () => { aborted = true; });
  scope.close(); finish('previous member private conversation'); await pending;
  assert.equal(aborted, true); assert.deepEqual(displayed, []);
  assert.equal(createMessageRequestScope().isCurrent(), true);
});
