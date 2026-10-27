import test from 'node:test';
import assert from 'node:assert/strict';
import { EMAIL_TEMPLATES, emailDraftError, excludedRecipientCount, pendingRecipientIds, templatePlaceholders } from './office-email-templates.mjs';

test('security notices require verified facts and cannot pass validation with placeholders', () => {
  const notices = EMAIL_TEMPLATES.filter(template => template.requiresVerifiedFacts);
  assert.equal(notices.length, 3);
  for (const template of notices) {
    assert.ok(templatePlaceholders(template.subject, template.message).length > 0);
    assert.match(emailDraftError(template.subject, template.message), /bracketed/);
    assert.equal(emailDraftError(template.subject.replace(/\[[A-Z][A-Z0-9_]{1,80}\]/g, 'Confirmed fact'), template.message.replace(/\[[A-Z][A-Z0-9_]{1,80}\]/g, 'Confirmed fact')), '');
  }
  assert.match(EMAIL_TEMPLATES.find(template => template.id === 'password').message, /https:\/\/uficonnect\.org\/forgot-password/);
});

test('draft validation handles empty, oversized and header-injection content', () => {
  assert.ok(emailDraftError(' ', 'hello'));
  assert.ok(emailDraftError('Hello\nBcc: elsewhere', 'hello'));
  assert.ok(emailDraftError('x'.repeat(161), 'hello'));
  assert.ok(emailDraftError('Hello', 'x'.repeat(10001)));
  assert.deepEqual(templatePlaceholders('[DATE] [DATE]', '[USER_ACTION]'), ['[DATE]', '[USER_ACTION]']);
  assert.equal(emailDraftError('Welcome', 'Hello, welcome.'), '');
});

test('resume excludes accepted, failed, uncertain, sending and skipped recipients', () => {
  const statuses = [null, 'accepted', 'failed', 'uncertain', 'sending', 'skipped', 'limited', 'interrupted'];
  const campaign = { recipients: statuses.map((_, id) => ({ id: String(id) })), results: Object.fromEntries(statuses.flatMap((status, id) => status ? [[String(id), { status }]] : [])) };
  assert.deepEqual(pendingRecipientIds(campaign), ['0', '6', '7']);
  assert.equal(excludedRecipientCount({ missingEmail: 1, reservedAddress: 14, invalidAddress: 0 }), 15);
});
