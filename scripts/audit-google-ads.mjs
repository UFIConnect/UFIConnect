import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

// The standard Google Ads tag ships in the web shell, so every built document
// must carry it exactly once, together with the page-view conversion event.
const ID = 'AW-18490754953';
const CONVERSION = `${ID}/s7sWCK_AsI4dEImPivFE`;
const count = (text, needle) => text.split(needle).length - 1;
for (const file of ['index.html', 'login/index.html', 'vault/index.html', 'app.html']) {
  const html = await fs.readFile(new URL('../web/dist/' + file, import.meta.url), 'utf8');
  assert.equal(count(html, `https://www.googletagmanager.com/gtag/js?id=${ID}`), 1, file + ' loads the Google tag once');
  assert.equal(count(html, `gtag('config', '${ID}')`), 1, file + ' configures the Google tag once');
  assert.equal(count(html, `'send_to': '${CONVERSION}'`), 1, file + ' sends the conversion event once');
  const policy = html.match(/http-equiv="Content-Security-Policy" content="([^"]*)/)[1];
  assert.ok(policy.includes('https://www.googletagmanager.com'), file + ' allows the Google tag script');
  assert.ok(!/unsafe-inline|unsafe-eval/.test(policy.split(';').find(value => value.trim().startsWith('script-src'))), file + ' keeps a strict script policy');
}
console.log('PASS: Google Ads tag and conversion event present in every built document');
