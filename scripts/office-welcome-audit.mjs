import assert from 'node:assert/strict';

// Operational audits retain their own service fixtures. These reads let the
// first-login welcome settle without requesting real browser device access.
export async function fulfillOfficeWelcomeRead(route, endpoint, headers = {}) {
  const responses = {
    '/office/ai': { configured: false, provider: 'Cloudflare', missing: [] },
    '/office/ai/tasks': { tasks: [], capabilities: {} },
    '/office/ai/tools': { tools: [] },
    '/office/connections': { connections: [] },
    '/office/ai/conversations': { conversations: [], storage: 'encrypted-database' },
  };
  if (!Object.hasOwn(responses, endpoint)) return false;
  await route.fulfill({ headers, json: responses[endpoint] });
  return true;
}

export async function returnFromOfficeWelcome(page, navigationLabel, beforeReturn = () => {}) {
  await page.locator('.office-ai-header h1').waitFor();
  assert.equal(new URL(page.url()).hash, '#office-ai', 'Successful login opens the Office welcome before operational inspection');
  const call = page.locator('.office-ai-call[role="dialog"]');
  if (await call.isVisible()) await call.getByRole('button', { name: 'Continue with text', exact: true }).click();
  beforeReturn();
  const navigation = page.getByRole('navigation', { name: 'Office sections', exact: true });
  const destination = navigation.getByRole('button', { name: navigationLabel, exact: true });
  if (!(await destination.isVisible())) {
    const more = navigation.getByRole('button', { name: 'More tools' });
    if (await more.getAttribute('aria-expanded') === 'false') await more.click();
  }
  await destination.click();
}
