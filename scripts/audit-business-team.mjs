import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import { startBuiltServer } from '../web/scripts/serve-built.mjs';

const require = createRequire(import.meta.url);
const { createAppHarness, member } = require('../backend/test-support/app-harness');
const app = await createAppHarness();
app.seedUser(member('team-owner', { name: 'Team owner', organization: 'Talent Company', plan: 'business' }));
app.seedUser(member('team-alice', { name: 'Alice', email: 'alice@example.invalid', plan: 'pro' }));
const server = await startBuiltServer({ port: 0 });
const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined });
await fs.mkdir('.cache/audit-ui', { recursive: true });
let checks = 0;
const check = (value, message) => { assert.ok(value, message); checks++; };

try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: 'block' });
    const page = await context.newPage(); page.setDefaultTimeout(12000);
    await page.addInitScript(() => {
      if (location.protocol === 'http:' || location.protocol === 'https:') localStorage.setItem('uficonnect.analytics.consent.v1', 'denied');
    });
    const errors = []; const mutations = [];
    let current = 'team-owner'; let invitation = null; let joined = false; let generation = 0; let rejectInvite = false;
    let authenticated = true; let onboardingComplete = true;
    const owner = { id: 'team-owner', name: 'Team owner', organization: 'Talent Company' };
    const borrowed = () => ({ ownerId: owner.id, ownerName: owner.name, organization: owner.organization, seats: 3, active: joined });
    const profile = () => ({ ...app.fullProfile(app.users.find(user => user.id === current)),
      onboardingComplete: current === 'team-owner' || onboardingComplete,
      plan: current === 'team-owner' || joined ? 'business' : 'pro',
      personalPlan: current === 'team-owner' ? 'business' : 'pro',
      businessTeam: current === 'team-alice' && joined ? borrowed() : null,
      businessSeats: current === 'team-owner' || joined ? 3 : 0 });
    const team = () => current === 'team-owner'
      ? { role: 'owner', active: true, seats: 3, used: joined ? 2 : 1, owner,
        members: joined ? [{ id: 'team-alice', name: 'Alice', email: 'alice@example.invalid', joinedAt: new Date().toISOString(), active: true }] : [],
        invitations: invitation ? [invitation] : [] }
      : joined ? { role: 'member', ...borrowed() } : { role: 'none', active: false, seats: 0 };
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
    await context.route('**/*', async route => {
      const request = route.request(); const url = new URL(request.url());
      const headers = { 'Access-Control-Allow-Origin': server.origin, 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Headers': '*' };
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      if (!['fetch', 'xhr'].includes(request.resourceType())) return url.origin === server.origin ? route.continue() : route.abort();
      const endpoint = url.pathname.replace(/^\/(api|fallback)/, '');
      const fulfill = (json, status = 200) => route.fulfill({ json, status, headers });
      if (endpoint === '/auth/session') return authenticated
        ? fulfill({ token: app.token(current), profile: profile() }) : fulfill({ message: 'Sign in to continue.' }, 401);
      if (endpoint === '/auth/login') { authenticated = true; return fulfill({ token: app.token(current), profile: profile() }); }
      if (endpoint === '/profile/onboarding') {
        mutations.push({ endpoint, body: request.postDataJSON() });
        onboardingComplete = true;
        return fulfill({ profile: profile() });
      }
      if (endpoint === '/profile') return fulfill(profile());
      if (endpoint === '/billing/status') return fulfill({ plan: current === 'team-owner' ? 'business' : 'pro', effectivePlan: profile().plan,
        businessSeats: current === 'team-owner' ? 3 : 0, businessTeam: profile().businessTeam, hasBillingAccount: true, subscriptions: [{ kind: 'plan', status: 'active', tier: current === 'team-owner' ? 'business' : 'pro' }] });
      if (endpoint === '/business/team') return fulfill(team());
      if (endpoint === '/business/team/invitations') {
        mutations.push({ endpoint, body: request.postDataJSON() });
        if (rejectInvite) return fulfill({ message: 'Synthetic team storage unavailable. Try again.' }, 503);
        const token = (generation++ ? 'B' : 'A').repeat(43);
        invitation = { id: 'invitation-1', name: 'Alice', email: request.postDataJSON().email, expiresAt: new Date(Date.now() + 86400000).toISOString(), token };
        return fulfill({ invitation, invitePath: `/recruiting#invite=${token}` });
      }
      if (endpoint === '/business/team/invitation') {
        const valid = current === 'team-alice' && invitation?.token === request.postDataJSON().token;
        return valid ? fulfill({ owner, email: invitation.email, expiresAt: invitation.expiresAt, active: true }) : fulfill({ message: 'This invitation is unavailable for your signed-in account.' }, 404);
      }
      if (endpoint === '/business/team/accept') {
        mutations.push({ endpoint, body: request.postDataJSON() });
        assert.equal(current, 'team-alice'); assert.equal(request.postDataJSON().token, invitation.token);
        joined = true; invitation = null;
        return fulfill({ joined: true, owner });
      }
      if (endpoint === '/business/team/leave') { mutations.push({ endpoint }); joined = false; return fulfill({ left: true }); }
      if (endpoint === '/business/team/invitations/invitation-1') { mutations.push({ endpoint }); invitation = null; return fulfill({ removed: true }); }
      if (endpoint === '/business/team/members/team-alice') { mutations.push({ endpoint }); joined = false; return fulfill({ removed: true }); }
      return fulfill({ sources: [], posts: [], groups: [], connected: {}, members: [], invitations: [], items: [] });
    });

    await page.goto(server.origin + '/recruiting');
    await page.getByRole('heading', { name: 'Talent Company recruiting', exact: true }).waitFor();
    const email = page.getByLabel('Teammate’s registered email', { exact: true });
    await email.fill('alice@example.invalid');
    rejectInvite = true;
    await page.getByRole('button', { name: 'Create invitation link', exact: true }).click();
    await page.getByText('Synthetic team storage unavailable. Try again.', { exact: true }).waitFor();
    check(await page.getByRole('button', { name: 'Create invitation link', exact: true }).isEnabled(), 'Invitation creation recovers after storage failure');
    rejectInvite = false;
    await page.getByRole('button', { name: 'Create invitation link', exact: true }).click();
    const link = page.getByLabel('Invitation link', { exact: true });
    await link.waitFor();
    check((await link.inputValue()) === 'https://uficonnect.org/recruiting#invite=' + 'A'.repeat(43), 'Invitation uses the public HTTPS origin with its account-bound token only in the fragment');
    check(await page.getByRole('button', { name: 'Copy invitation link', exact: true }).isVisible(), 'Owner can copy a link without sending an email');
    await page.getByRole('button', { name: 'Revoke', exact: true }).waitFor();
    check(await page.locator('.business-team-settings li').filter({ hasText: 'alice@example.invalid' }).count() === 1, 'Owner sees the pending intended recipient');
    await page.getByRole('button', { name: 'Revoke', exact: true }).click();
    await page.getByText('Invitation revoked.', { exact: true }).waitFor();
    check(invitation === null, 'Owner can revoke a pending invitation');
    await email.fill('alice@example.invalid');
    await page.getByRole('button', { name: 'Create invitation link', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#business-team-link')?.value.includes('BBBB'));
    const publicInvitation = new URL(await link.inputValue());
    check(publicInvitation.href === 'https://uficonnect.org/recruiting#invite=' + 'B'.repeat(43), 'Replacement invitation has a new fragment token on the public website');
    // Exercise the copied public destination against this isolated local fixture;
    // do not navigate to or mutate the public website during the audit.
    const invitationUrl = new URL(publicInvitation.pathname + publicInvitation.search + publicInvitation.hash, server.origin).href;
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Owner team controls fit ${width}px`);
    await page.screenshot({ path: `.cache/audit-ui/business-team-owner-${width}.png`, fullPage: true });

    current = 'team-alice';
    await page.goto(server.origin + '/settings');
    await page.getByRole('heading', { name: 'Settings', exact: true }).waitFor();
    await page.goto(server.origin + '/recruiting#invite=' + 'X'.repeat(43));
    await page.getByText('This invitation is unavailable for your signed-in account.', { exact: true }).waitFor();
    check(await page.getByRole('button', { name: 'Accept invitation', exact: true }).count() === 0, 'Invalid invitations cannot be accepted');
    const onboardingInvitation = new URL(invitationUrl);
    onboardingInvitation.search = '?source=team-invite';
    for (const session of ['signed-out', 'restored']) {
      authenticated = session === 'restored'; onboardingComplete = false;
      await page.goto('about:blank');
      await page.goto(onboardingInvitation.href);
      if (!authenticated) {
        await page.locator('input[name="email"]').fill('alice@example.invalid');
        await page.locator('input[name="password"]').fill('Synthetic test password only');
        await page.getByRole('button', { name: 'Sign in', exact: true }).click();
      }
      await page.getByRole('heading', { name: 'What best describes you?', exact: true }).waitFor();
      check(new URL(page.url()).pathname === '/onboarding', `${session} invitee completes onboarding before viewing the invitation`);
      await page.reload();
      await page.getByRole('heading', { name: 'What best describes you?', exact: true }).waitFor();
      await page.getByRole('button', { name: /^Software Engineer / }).click();
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await page.getByRole('heading', { name: 'What topics interest you?', exact: true }).waitFor();
      await page.getByRole('region', { name: 'Choose topics', exact: true }).getByRole('button', { name: 'Remove Career Growth', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
      await page.getByRole('button', { name: /^Mid-level / }).click();
      await page.getByRole('button', { name: 'Finish setup', exact: true }).click();
      await page.getByRole('button', { name: 'Accept invitation', exact: true }).waitFor();
      check(page.url() === onboardingInvitation.href, `${session} onboarding preserves the full invitation path, query, and fragment after reload`);
      check(!joined, `${session} onboarding does not accept the invitation automatically`);
      check(await page.locator('.business-team-settings').getByText('alice@example.invalid', { exact: true }).isVisible(), `${session} invitee returns to the correct invitation`);
    }
    await page.goto(invitationUrl);
    await page.getByRole('button', { name: 'Accept invitation', exact: true }).waitFor();
    check(await page.locator('.business-team-settings').getByText('Talent Company', { exact: true }).count() === 1, 'Invitee sees the team before accepting');
    check(await page.locator('.business-team-settings').getByText('alice@example.invalid', { exact: true }).count() === 1, 'Invitee sees the intended account before accepting');
    await page.getByRole('button', { name: 'Accept invitation', exact: true }).click();
    await page.waitForURL(url => url.pathname === '/recruiting' && !url.hash);
    await page.getByRole('button', { name: 'Leave team', exact: true }).waitFor();
    check(joined, 'Accepted invitation activates the member workspace after profile refresh');
    check(await page.getByRole('navigation', { name: 'Recruiting workspace' }).isVisible(), 'Accepted teammate gets the Business navigation');
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Member team controls fit ${width}px`);
    await page.screenshot({ path: `.cache/audit-ui/business-team-member-${width}.png`, fullPage: true });
    await page.goto(server.origin + '/settings');
    await page.getByRole('heading', { name: 'Business team membership', exact: true }).waitFor();
    check(await page.getByText(/Your company manages this Business membership/).isVisible(), 'Borrowed seat is labeled as a company membership without a role field');
    check(await page.getByRole('button', { name: 'Upgrade', exact: true }).count() === 0, 'Active teammate is not prompted to buy another membership');
    await page.goto(server.origin + '/recruiting');
    await page.getByRole('button', { name: 'Leave team', exact: true }).click();
    await page.waitForURL('**/settings');
    check(!joined, 'Member can leave and return to their personal account');

    joined = true; current = 'team-owner';
    await page.goto(server.origin + '/recruiting');
    await page.getByRole('button', { name: 'Remove', exact: true }).click();
    await page.getByText('Team member removed.', { exact: true }).waitFor();
    check(!joined, 'Owner can remove an assigned team member');
    check(mutations.filter(item => item.endpoint === '/business/team/accept').length === 1, 'Acceptance occurs only on the explicit button click');
    check(errors.length === 0, `No team browser errors at ${width}px: ${errors.join('; ')}`);
    await context.close();
  }
  await fs.writeFile('.cache/audit-ui/business-team-results.json', JSON.stringify({ passed: true, checks, widths: [1440, 390], externalActions: 'none; all API requests intercepted' }, null, 2));
  console.log(`PASS: ${checks} Business team browser checks.`);
} catch (error) {
  const page = browser.contexts().at(-1)?.pages().at(-1);
  if (page) { await page.screenshot({ path: '.cache/audit-ui/business-team-failure.png', fullPage: true }); console.error(await page.locator('body').innerText()); }
  throw error;
} finally { await browser.close(); await server.close(); await app.close(); }
