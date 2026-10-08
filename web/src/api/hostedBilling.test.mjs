import assert from 'node:assert/strict';
import { test } from 'node:test';
import { billingReturnPath, billingReturnState, hostedBillingUrl } from './hostedBilling.mjs';

test('billing captures the current page, selected tab and anchor for checkout or portal', () => {
  const current = { pathname: '/command-center', search: '?tab=media&draft=abc%2F123', hash: '#preview' };
  assert.equal(billingReturnPath(current), '/command-center?tab=media&draft=abc%2F123#preview');
  current.search = '?tab=accounts';
  assert.equal(billingReturnPath(current), '/command-center?tab=accounts#preview', 'Each launch captures the current route instead of an earlier tab');
  assert.equal(billingReturnPath({ pathname: '/', search: '?feed=following', hash: '' }), '/?feed=following');
  assert.equal(billingReturnPath({ pathname: '/vault' }), '/vault');
});

test('unsafe and unavailable return locations leave the API fallback in control', () => {
  for (const location of [undefined, null, {}, { pathname: 'https://outside.invalid/settings' },
    { pathname: '//outside.invalid/settings' }, { pathname: '/\\outside.invalid' },
    { pathname: '/settings\n' }, { pathname: '/settings', search: '?x=1\r\nLocation:x' },
    { pathname: '/%2Foutside.invalid' }, { pathname: '/%255Coutside.invalid' },
    { pathname: '/settings', search: '?x=%250A' }, { pathname: '/settings', hash: '#%7f' },
    { pathname: '/settings', search: 'tab=billing' }, { pathname: '/settings', hash: 'billing' },
    { pathname: '/settings', search: 12 }, { pathname: '/settings', hash: {} },
    { pathname: '/' + 'a'.repeat(2048) }, { pathname: '/' + 'é'.repeat(500) }]) {
    assert.equal(billingReturnPath(location), undefined);
    assert.equal(JSON.stringify({ tier: 'pro', returnPath: billingReturnPath(location) }), '{"tier":"pro"}');
  }
  assert.equal(billingReturnPath({ pathname: '/' + 'a'.repeat(2047) }).length, 2048);
});

test('checkout cleanup preserves page, tab, other parameters and hash for all outcomes', () => {
  for (const result of ['success', 'cancelled']) {
    assert.deepEqual(billingReturnState({ pathname: '/resume-builder', search: `?tab=cover-letter&upgrade=${result}&draft=123`, hash: '#writing' }), {
      result, hasMarker: true, returnPath: '/resume-builder?tab=cover-letter&draft=123#writing',
    });
  }
  assert.deepEqual(billingReturnState({ pathname: '/command-center', search: '?tab=crosspost&upgrade=bogus', hash: '#photo' }), {
    result: null, hasMarker: true, returnPath: '/command-center?tab=crosspost#photo',
  });
  assert.deepEqual(billingReturnState({ pathname: '/settings', search: '?tab=billing', hash: '#membership' }), {
    result: null, hasMarker: false, returnPath: '/settings?tab=billing#membership',
  }, 'Portal returns retain their route without manufacturing a payment success');
  assert.deepEqual(billingReturnState(null), { result: null, hasMarker: false, returnPath: undefined });
});

test('hosted Stripe destination validation remains strict and separate from return routes', () => {
  assert.equal(hostedBillingUrl('https://checkout.stripe.com/c/pay/a#b'), 'https://checkout.stripe.com/c/pay/a#b');
  assert.equal(hostedBillingUrl('https://billing.stripe.com/p/session/a', 'portal'), 'https://billing.stripe.com/p/session/a');
  for (const url of ['http://checkout.stripe.com/c/pay/a', 'https://checkout.stripe.com.evil.invalid/a',
    'https://person:password@checkout.stripe.com/a', 'https://checkout.stripe.com:8443/a',
    'https://billing.stripe.com/a', '/command-center?tab=media']) assert.throws(() => hostedBillingUrl(url));
  assert.throws(() => hostedBillingUrl('https://checkout.stripe.com/a', 'portal'));
});
