export function hostedBillingUrl(value, kind = 'checkout') {
  const url = new URL(value);
  const expected = kind === 'portal' ? 'billing.stripe.com' : 'checkout.stripe.com';
  if (url.protocol !== 'https:' || url.hostname !== expected || url.port || url.username || url.password) {
    throw new Error('The secure billing link was not valid. Please try again.');
  }
  return url.href;
}
