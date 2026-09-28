// UI audits use the real sign-in form with a synthetic API response. No
// production auth bypass or persisted bearer credential is needed.
const sessions = new WeakMap();

export async function installAuditMember(page, app, userId) {
  // General UI/security audits opt out of optional analytics. Analytics has a
  // separate browser audit that exercises both choices without this fixture.
  await page.addInitScript(() => localStorage.setItem('uficonnect.analytics.consent.v1', 'denied'));
  const existing = sessions.get(page);
  if (existing) {
    existing.userId = userId;
    existing.authenticated = false;
    return;
  }
  const state = { app, userId, authenticated: false };
  sessions.set(page, state);
  await page.route('**/auth/session', async (route) => {
    if (!state.authenticated) return route.fulfill({ status: 401, json: { message: 'No saved audit session.' } });
    const { data: profile, status } = await state.app.request('/profile', { userId: state.userId });
    if (status && status !== 200) throw new Error('Audit member profile unavailable');
    return route.fulfill({ json: { token: state.app.token(state.userId), profile } });
  });
  await page.route('**/auth/login', async (route) => {
    const { data: profile, status } = await state.app.request('/profile', { userId: state.userId });
    if (status && status !== 200) throw new Error('Audit member profile unavailable');
    state.authenticated = true;
    await route.fulfill({ json: { token: state.app.token(state.userId), profile } });
  });
}

async function signIn(page, origin, state) {
  // Starting a fresh sign-in must not restore this fixture's previous session
  // after a password change or logout has returned the browser to /login.
  state.authenticated = false;
  await page.goto(origin + '/login', { waitUntil: 'domcontentloaded' });
  await page.locator('input[name="email"]').fill('ui-audit@example.invalid');
  await page.locator('input[name="password"]').fill('UI audit passphrase only');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForURL((url) => url.pathname !== '/login');
  state.authenticated = true;
}

export async function auditNavigate(page, value, options) {
  const state = sessions.get(page);
  const target = new URL(value);
  const publicPage = target.searchParams.has('audit-public') || /^\/(?:register|login|forgot-password|reset-password)(?:\/|$)/.test(target.pathname);
  if (!state || publicPage) {
    if (state) state.authenticated = false;
    return page.goto(value, { waitUntil: 'domcontentloaded', ...options });
  }
  if (!state.authenticated || !page.url().startsWith(target.origin) || new URL(page.url()).pathname === '/login') {
    await signIn(page, target.origin, state);
  }
  await page.evaluate((url) => new Promise(resolve => {
    history.pushState({}, '', url);
    window.dispatchEvent(new PopStateEvent('popstate'));
    // Let React begin navigation after the history event returns. Two frames
    // do not guarantee a lazy route or transition has committed; callers must
    // wait for destination-specific content before using shared controls.
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }), target.pathname + target.search + target.hash);
  await page.waitForFunction(() => !Array.from(document.querySelectorAll('.splash')).some(element => element.getClientRects().length));
  return null;
}

export async function auditReload(page, options) {
  const target = page.url();
  await page.reload({ waitUntil: 'domcontentloaded', ...options });
  // A saved browser session now restores through the API's HttpOnly cookie.
  return auditNavigate(page, target);
}
