import test from 'node:test';
import assert from 'node:assert/strict';
import { isBusinessAccount, membershipTiersForAccount } from './businessAccount.mjs';

test('personal accounts never receive an in-app Business purchase option', () => {
  for (const profile of [null, {}, { accountType: 'personal', plan: 'free' }, { accountType: 'personal', plan: 'pro' }, { accountType: 'personal', plan: 'business' }]) {
    assert.equal(isBusinessAccount(profile), false);
    assert.deepEqual(membershipTiersForAccount(profile), ['pro']);
  }
});

test('Business enrollment remains available after cancellation without offering a personal upgrade', () => {
  for (const plan of ['free', 'business']) {
    const profile = { accountType: 'business', plan };
    assert.equal(isBusinessAccount(profile), true);
    assert.deepEqual(membershipTiersForAccount(profile), ['business']);
  }
});

test('existing paid and accepted-team profiles survive a staged server rollout', () => {
  for (const profile of [{ plan: 'business' }, { personalPlan: 'business' }, { plan: 'free', businessTeam: { active: true } }]) {
    assert.equal(isBusinessAccount(profile), true);
    assert.deepEqual(membershipTiersForAccount(profile), ['business']);
  }
  assert.equal(isBusinessAccount({ plan: 'free', businessTeam: { active: false } }), false);
  assert.equal(isBusinessAccount({ accountType: 'unknown', plan: 'business' }), false);
});
