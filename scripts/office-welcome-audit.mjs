import assert from 'node:assert/strict';

// Operational audits retain their own service fixtures. These reads let the
// first-login welcome settle without requesting real browser device access.
export async function fulfillOfficeWelcomeRead(route, endpoint, headers = {}) {
  const responses = {
    // The welcome uses its own authenticated summary now. Operational fixtures
    // need not invent analytics or health observations to exercise the call.
    '/office/welcome': { schemaVersion: 1, asOf: new Date(Math.floor(Date.now() / 60000) * 60000).toISOString(),
      timeZone: 'America/Los_Angeles', analytics: { available: false },
      lastActivity: { available: false }, warnings: { available: false } },
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
  const popup = page.locator('.pip-dock-floating .pip-dock-panel');
  await popup.waitFor();
  assert.notEqual(new URL(page.url()).hash, '#office-ai', 'Login keeps the requested Office page while Pip welcomes in the corner');
  assert.equal(await popup.getAttribute('role'), 'region', 'Login opens the call region rather than the chatbot dialog');
  assert.equal(await popup.getAttribute('aria-label'), 'Pip call', 'Login presents the phone call only');
  assert.notEqual(await popup.getAttribute('aria-modal'), 'true', 'The login call leaves the Office page available');
  assert.equal(await page.getByLabel('Message Pip', { exact: true }).isVisible(), false, 'Login keeps the chatbot composer hidden');
  await page.getByRole('button', { name: 'Continue with text', exact: true }).click();
  await page.getByRole('dialog', { name: 'Pip', exact: true }).waitFor();
  // Explicitly enter the workspace so returning below exercises a fresh mount
  // of each operational page, including its existing service-read assertions.
  await page.getByRole('button', { name: 'Open Pip workspace', exact: true }).click();
  await page.locator('.office-ai-header h1').waitFor();
  await page.waitForFunction(() => {
    const refresh = document.querySelector('button[aria-label="Refresh Pip connection"]');
    return refresh && !refresh.disabled;
  });
  await page.waitForLoadState('networkidle');
  beforeReturn();
  const navigation = page.getByRole('navigation', { name: 'Office sections', exact: true });
  const destination = navigation.getByRole('button', { name: navigationLabel, exact: true });
  if (!(await destination.isVisible())) {
    const more = navigation.getByRole('button', { name: 'More tools' });
    if (await more.getAttribute('aria-expanded') === 'false') await more.click();
  }
  await destination.click();
  await page.locator('.pip-dock-floating .pip-dock-panel').getByRole('button', { name: 'Minimize Pip', exact: true }).click();
}

