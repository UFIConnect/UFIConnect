// All accounts, API responses and downloads below are synthetic. Never contacts
// production, launches WireGuard, or writes a real customer's private profile.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPrivateKey, createPublicKey } from 'node:crypto';
import { chromium } from 'playwright';
import { createServer } from '../web/node_modules/vite/dist/node/index.js';
import { wireguardIdentity, forgetIdentity, profileText, validateProfile, publicKeyValid } from '../web/src/lib/wireguardProfile.js';
import { paidVpnAccess } from '../web/src/lib/vpnAccess.js';
import { isPrivateTelemetryPath } from '../web/src/analytics/telemetryPrivacy.mjs';

let checks = 0;
const check = (value, message) => { assert.ok(value, message); checks++; };
const config = { available: true, profileImportAvailable: true, protocol: 'wireguard', gateways: [{ id: 'germany-1', country: 'DE', label: 'Germany' }] };
const seed = Buffer.from('77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a', 'hex');
const known = wireguardIdentity(seed);
check(Buffer.from(known.publicKey, 'base64').toString('hex') === '8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a', 'RFC7748 public-key known answer');
check(!(known.privateKey[0] & 7) && !(known.privateKey[31] & 128) && (known.privateKey[31] & 64), 'Exported private key has WireGuard clamp bits');
for (let i = 0; i < 3; i++) {
  const pair = wireguardIdentity();
  const native = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b656e04220420', 'hex'), pair.privateKey]), format: 'der', type: 'pkcs8' });
  const publicBytes = createPublicKey(native).export({ format: 'der', type: 'spki' }).subarray(-32);
  check(publicBytes.toString('base64') === pair.publicKey, 'Generated public key matches independent Node/OpenSSL X25519');
  forgetIdentity(pair); check(pair.privateKey.every(value => value === 0), 'Private byte buffer zeroed after use');
}
const serverKey = Buffer.alloc(32, 19).toString('base64');
const response = publicKey => ({ state: 'registered', profile: {
  id: '11111111-1111-4111-8111-111111111111', gatewayId: 'germany-1', label: 'UFIConnect iOS', publicKey,
  addresses: ['10.80.0.2/32', 'fd80:80::2/128'], endpoint: 'vpn.example.com:51820', serverPublicKey: serverKey,
  dns: ['10.80.0.1'], allowedIPs: ['0.0.0.0/0', '::/0'], persistentKeepalive: 25, ipv6Egress: 'blocked',
  createdAt: new Date().toISOString(), enrollmentMode: 'profile',
} });
const formatted = profileText(known, response(known.publicKey), config);
check(formatted.includes('AllowedIPs = 0.0.0.0/0, ::/0') && !formatted.includes('UFIConnect iOS'), 'Fixed full-tunnel configuration omits API labels');
check(formatted.split('\n').filter(line => line.includes(' = ')).map(line => line.split(' = ')[0]).join(',') === 'PrivateKey,Address,DNS,MTU,PublicKey,Endpoint,AllowedIPs,PersistentKeepalive', 'Only supported fixed directives enter profile');
for (const patch of [
  { endpoint: 'vpn.example.com:51820\nPostUp = unsafe' }, { addresses: ['10.80.0.999/32', 'fd80:80::2/128'] },
  { dns: ['8.8.8.8'] }, { allowedIPs: ['0.0.0.0/0'] }, { publicKey: serverKey }, { gatewayId: 'unconfigured' },
  { privateKey: 'server-supplied-secret' }, { serverPublicKey: 'A'.repeat(43) + '=' },
]) {
  assert.throws(() => validateProfile({ ...response(known.publicKey), profile: { ...response(known.publicKey).profile, ...patch } }, known.publicKey, config)); checks++;
}
forgetIdentity(known);
check(!paidVpnAccess({ status: { vpnConnectorAddon: true, subscriptions: [{ kind: 'vpn_connector', status: 'trialing', currentPeriodEnd: Date.now() / 1000 + 3600 }] } }), 'Trials do not enable paid VPN');
check(!paidVpnAccess({ status: { vpnConnectorAddon: true, subscriptions: [null] } }), 'Malformed billing data cannot enable paid VPN');
check(isPrivateTelemetryPath('/vault'), 'Vault profile page is excluded from analytics');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, '.cache/audit-vpn-profiles');
const fixture = `import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {BrowserRouter} from 'react-router-dom';
import {ManagedVpnPanel} from '/src/components/VaultVpnPanel.jsx';
import {setAccessToken,clearSession} from '/src/auth/session.js';
import client from '/src/api/client.js';
import '/src/index.css';
import '/src/pages/Vault.css';
setAccessToken('synthetic-account-a');
window.__profileAudit={downloads:[],clearSession,dispatches:[],dispatchWaiting:false};
let dispatchHold=null,releaseDispatch=null;
window.__profileAudit.holdDispatch=()=>{window.__profileAudit.dispatchWaiting=false;dispatchHold=new Promise(resolve=>{releaseDispatch=resolve;});};
window.__profileAudit.releaseDispatch=()=>{releaseDispatch();dispatchHold=null;};
client.interceptors.request.use(async config=>{
 if(config.method==='post'&&config.url==='/vpn/profiles'){
  if(dispatchHold){window.__profileAudit.dispatchWaiting=true;await dispatchHold;}
  window.__profileAudit.dispatches.push({authorization:config.headers.Authorization,aborted:Boolean(config.signal?.aborted)});
 }
 return config;
});
function Fixture(){
 const [state,setState]=useState({accountId:'account-a',paid:false,trial:false});
 window.__profileAudit.update=patch=>{if(patch.accountId)setAccessToken('synthetic-'+patch.accountId);flushSync(()=>setState(old=>({...old,...patch})));};
 const active=state.paid||state.trial;
 const billing={active,checking:false,status:{vpnConnectorAddon:active,subscriptions:active?[{kind:'vpn_connector',status:state.trial?'trialing':'active',currentPeriodEnd:Math.floor(Date.now()/1000)+3600}]:[]}};
 return React.createElement(BrowserRouter,null,React.createElement('main',{className:'vault-page',style:{maxWidth:480,padding:16,margin:'auto'}},React.createElement(ManagedVpnPanel,{
 accountId:state.accountId,billing,openApp:()=>{throw Error('iOS must not open native handler');},
 downloadProfile:async url=>{const text=await(await fetch(url)).text();window.__profileAudit.downloads.push({url,text});}})));
}
createRoot(document.getElementById('root')).render(React.createElement(Fixture));`;
const server = await createServer({ root: path.join(root, 'web'), configFile: path.join(root, 'web/vite.config.js'), envFile: false,
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api'), 'import.meta.env.VITE_API_FALLBACK_URL': JSON.stringify('/api') },
  plugins: [{ name: 'profile-fixture', resolveId(id) { if (id === 'virtual:profile-audit.jsx') return '\0virtual:profile-audit.jsx'; },
    load(id) { if (id === '\0virtual:profile-audit.jsx') return fixture; },
    configureServer(vite) { vite.middlewares.use(async (req, res, next) => { if (req.url !== '/__profile-audit') return next();
      res.setHeader('Content-Type', 'text/html'); res.end(await vite.transformIndexHtml(req.url, '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Profile audit</title></head><body><div id="root"></div><script type="module" src="/@id/virtual:profile-audit.jsx"></script></body></html>')); }); },
  }], server: { host: '127.0.0.1', port: 5261, strictPort: false } });
let browser, page;
try {
  await fs.mkdir(output, { recursive: true }); await server.listen();
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined, headless: true });
  for (const width of [390, 1024]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1', serviceWorkers: 'block' });
    page = await context.newPage(); page.setDefaultTimeout(10000); await page.clock.install();
    const requests = [], errors = [], posted = [], profiles = new Map();
    let registrations = 0, removals = 0, failure = false, poison = false, unavailable = false, held = null, configReads = 0;
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => requests.push({ url: request.url(), body: request.postData() || '' }));
    await context.route('**/api/**', async route => {
      const request = route.request(), url = new URL(request.url());
      if (!url.pathname.startsWith('/api/')) return route.continue();
      const owner = request.headers().authorization;
      if (url.pathname === '/api/vpn/config') { configReads++; return route.fulfill({ json: { ...config, available: !unavailable } }); }
      if (url.pathname === '/api/vpn/profiles' && request.method() === 'GET') return route.fulfill({ json: { profiles: [...profiles.values()].filter(value => value.owner === owner).map(value => value.data.profile) } });
      if (url.pathname === '/api/vpn/profiles' && request.method() === 'POST') {
        registrations++; const body = request.postDataJSON(); posted.push(body);
        if (held) await held;
        if (failure) return route.fulfill({ status: 503, json: { message: 'Unavailable' } });
        const key = owner + ':' + body.publicKey;
        if (!profiles.has(key)) { const data = response(body.publicKey); data.profile.id = '11111111-1111-4111-8111-' + String(profiles.size + 1).padStart(12, '0'); profiles.set(key, { owner, data }); }
        const data = structuredClone(profiles.get(key).data);
        if (poison) data.profile.endpoint += '\nPostUp = unsafe';
        return route.fulfill({ json: data });
      }
      if (url.pathname.startsWith('/api/vpn/profiles/') && request.method() === 'DELETE') {
        removals++; const id = url.pathname.split('/').at(-1);
        for (const [key, value] of profiles) if (value.owner === owner && value.data.profile.id === id) profiles.delete(key);
        return route.fulfill({ json: { removed: true } });
      }
      return route.fulfill({ status: 404, json: { message: 'Unexpected request' } });
    });
    await page.goto(server.resolvedUrls.local[0] + '__profile-audit#vpn');
    const button = page.getByRole('button', { name: 'Get VPN profile', exact: true });
    const consent = page.getByRole('checkbox');
    await page.locator('.vault-status').filter({ hasText: 'Subscription required' }).waitFor();
    check(registrations === 0 && await button.isDisabled(), 'Opening #vpn does not create a profile');
    check(configReads === 0, 'Unpaid iPhone user never fetches member VPN configuration');
    await page.evaluate(() => window.__profileAudit.update({ trial: true }));
    check(await button.isDisabled(), 'Vault trial cannot create paid VPN profile');
    check(configReads === 0, 'Vault trial never fetches paid VPN configuration');
    await page.evaluate(() => window.__profileAudit.update({ trial: false, paid: true }));
    await page.locator('.vault-status').filter({ hasText: 'Ready for WireGuard' }).waitFor();
    check(await button.isDisabled(), 'First use requires disclosure consent');
    await consent.check(); check(await button.isEnabled(), 'Paid member can explicitly get a profile after consent');
    unavailable = true; await page.getByLabel('Check VPN availability').click();
    await page.locator('.vault-status').filter({ hasText: 'Unavailable' }).waitFor(); check(await button.isDisabled(), 'Unavailable gateway cannot enroll');
    unavailable = false; await page.getByLabel('Check VPN availability').click();
    await page.locator('.vault-status').filter({ hasText: 'Ready for WireGuard' }).waitFor();
    failure = true; await button.click(); await page.getByRole('alert').filter({ hasText: 'temporarily unavailable' }).waitFor();
    check(await page.evaluate(() => window.__profileAudit.downloads.length) === 0, 'Failed enrollment never downloads a private profile');
    failure = false; poison = true; await button.click(); await page.getByRole('alert').filter({ hasText: 'could not be prepared' }).waitFor();
    check(await page.evaluate(() => window.__profileAudit.downloads.length) === 0, 'Injected configuration never downloads');
    check(posted[0].publicKey === posted[1].publicKey, 'Explicit retry reuses pending public key');
    poison = false; let release; held = new Promise(resolve => { release = resolve; });
    const before = registrations; await button.evaluate(element => { element.click(); element.click(); });
    await page.waitForFunction(() => document.querySelector('.vault-vpn-quick-action button').disabled);
    await new Promise(resolve => setTimeout(resolve, 50)); check(registrations === before + 1, 'Double click enrolls only once');
    release(); held = null;
    await page.waitForFunction(() => window.__profileAudit.downloads.length === 1);
    check(posted[0].publicKey === posted.at(-1).publicKey && profiles.size === 1, 'Ambiguous response retry retains one registration');
    const download = await page.evaluate(() => window.__profileAudit.downloads[0]);
    const privateKey = download.text.match(/^PrivateKey = (.+)$/m)?.[1];
    check(publicKeyValid(privateKey) && download.url.startsWith('blob:'), 'Private profile downloads from local Blob only');
    const imported = createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b656e04220420', 'hex'), Buffer.from(privateKey, 'base64')]), format: 'der', type: 'pkcs8' });
    check(createPublicKey(imported).export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64') === posted.at(-1).publicKey, 'Downloaded private key matches the enrolled public key');
    check(!requests.some(value => value.url.includes(privateKey) || value.body.includes(privateKey) || value.body.includes('PrivateKey')), 'Private key never enters HTTP or telemetry requests');
    check(posted.every(value => Object.keys(value).sort().join(',') === 'label,publicKey' && value.label === 'UFIConnect iOS'), 'Only public key and automatic device label enter API');
    check(await page.evaluate(value => !JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage }, cookie: document.cookie }).includes(value), privateKey), 'Private key never enters browser storage');
    check(!await page.locator('body').innerText().then(text => text.includes(privateKey)), 'Private key is never displayed as page text');
    check((await page.locator('.vault-status').innerText()) === 'Profile ready', 'Downloaded profile is not presented as connected');
    check(await page.getByRole('link', { name: /Get official WireGuard/ }).getAttribute('href') === 'https://apps.apple.com/app/wireguard/id1441195209', 'Official iOS app link only');
    await page.evaluate(() => window.__profileAudit.update({ paid: false }));
    await page.locator('.vault-status').filter({ hasText: 'Subscription required' }).waitFor();
    check(await page.getByRole('link', { name: 'Download VPN profile', exact: true }).count() === 0, 'Membership loss immediately hides the private download');
    check(await page.evaluate(async url => { try { await fetch(url); return false; } catch { return true; } }, download.url), 'Membership loss revokes the prepared private Blob');
    await page.evaluate(() => window.__profileAudit.update({ accountId: 'account-b', paid: true }));
    check(await page.getByRole('link', { name: 'Download VPN profile', exact: true }).count() === 0, 'Account switch immediately removes old private download');
    check(await page.evaluate(async url => { try { await fetch(url); return false; } catch { return true; } }, download.url), 'Old account Blob URL is revoked');
    await consent.check(); let releaseOld; held = new Promise(resolve => { releaseOld = resolve; });
    await button.click(); await page.waitForFunction(() => document.querySelector('.vault-vpn-quick-action button').disabled);
    await page.evaluate(() => window.__profileAudit.update({ accountId: 'account-c', paid: true }));
    releaseOld(); held = null; await new Promise(resolve => setTimeout(resolve, 80));
    check(await page.evaluate(() => window.__profileAudit.downloads.length) === 1, 'Late old-account enrollment cannot download into new account');
    await consent.check();
    await page.evaluate(() => window.__profileAudit.holdDispatch());
    const previousRequests = registrations;
    await button.click(); await page.waitForFunction(() => window.__profileAudit.dispatchWaiting);
    await page.evaluate(() => window.__profileAudit.update({ accountId: 'account-d', paid: true }));
    await page.evaluate(() => window.__profileAudit.releaseDispatch());
    await page.waitForFunction(() => window.__profileAudit.dispatches.at(-1)?.aborted);
    check(registrations === previousRequests, 'Account switch aborts enrollment before delayed network dispatch');
    check(await page.evaluate(() => window.__profileAudit.dispatches.at(-1).authorization === 'Bearer synthetic-account-c'), 'Delayed mutation keeps initiating account Authorization');
    await page.evaluate(() => window.__profileAudit.update({ accountId: 'account-a', paid: false }));
    await page.getByText('Manage saved profiles', { exact: true }).click();
    check(await page.getByRole('button', { name: 'Remove profile 1', exact: true }).isEnabled(), 'Profile revocation remains available without paid access');
    await page.getByRole('button', { name: 'Remove profile 1', exact: true }).click(); check(removals === 0, 'Removal requires explicit confirmation');
    await page.getByRole('button', { name: 'Confirm removal', exact: true }).click();
    await page.getByText('Manage saved profiles', { exact: true }).waitFor({ state: 'detached' }); check(removals === 1, 'Confirmed removal revokes only selected profile');
    await page.evaluate(() => window.__profileAudit.update({ paid: true }));
    await consent.check(); await button.click();
    await page.waitForFunction(() => window.__profileAudit.downloads.length === 2);
    const expiringUrl = await page.getByRole('link', { name: 'Download VPN profile', exact: true }).getAttribute('href');
    await page.clock.fastForward(600001);
    check(await page.getByRole('link', { name: 'Download VPN profile', exact: true }).count() === 0, 'Private download link has a ten-minute maximum lifetime');
    check(await page.evaluate(async url => { try { await fetch(url); return false; } catch { return true; } }, expiringUrl), 'Expired private Blob is revoked');
    failure = true; await button.click(); await page.getByRole('alert').filter({ hasText: 'temporarily unavailable' }).waitFor();
    const pendingKey = posted.at(-1).publicKey;
    await page.clock.fastForward(180001);
    await button.click(); await page.getByRole('alert').filter({ hasText: 'temporarily unavailable' }).waitFor();
    check(posted.at(-1).publicKey !== pendingKey, 'Uncertain registration retry key is discarded after three minutes');
    failure = false;
    await page.evaluate(() => window.__profileAudit.holdDispatch());
    const beforeCancellation = registrations;
    await button.click(); await page.waitForFunction(() => window.__profileAudit.dispatchWaiting);
    await page.evaluate(() => window.__profileAudit.update({ paid: false }));
    await page.evaluate(() => window.__profileAudit.releaseDispatch());
    await page.waitForFunction(() => window.__profileAudit.dispatches.at(-1)?.aborted);
    check(registrations === beforeCancellation, 'Membership loss aborts profile generation before delayed dispatch');
    check(await page.evaluate(() => window.__profileAudit.downloads.length) === 2, 'Canceled profile preparation cannot produce a private download');
    const text = await page.locator('body').innerText();
    check(!/terminal|powershell|configured countries|Device, locations and setup|Add configured location/i.test(text) && await page.locator('select,input:not([type=checkbox])').count() === 0, 'No manual commands or device/location forms');
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2), 'Profile flow fits viewport');
    check(errors.length === 0, 'No browser runtime errors');
    await page.screenshot({ path: path.join(output, 'profiles-' + width + '.png'), fullPage: true });
    await context.close();
  }
  console.log(`PASS: ${checks} WireGuard profile policy and browser checks; no production enrollment or native handler launched.`);
} catch (error) { await page?.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {}); throw error; }
finally { await browser?.close(); await server.close(); }
