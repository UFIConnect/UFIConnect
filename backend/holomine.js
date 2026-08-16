const http = require('http');
const https = require('https');

function postJson(url, payload, timeout = 8000) {
  return new Promise((resolve, reject) => {
    try {
      const u = new URL(url);
      const body = JSON.stringify(payload || {});
      const opts = {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'User-Agent': 'uficonnect-holomine/1.0',
        },
        timeout,
      };
      const lib = u.protocol === 'https:' ? https : http;
      const req = lib.request(u, opts, (res) => {
        let data = '';
        res.on('data', (c) => data += c);
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch (e) { resolve({ statusCode: res.statusCode, body: data }); }
        });
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    } catch (err) { reject(err); }
  });
}

function registerHolomine(app, opts = {}) {
  const externalUrl = opts.externalUrl || process.env.HOLOMINE_URL || null;
  let simulatedState = { active: false, mode: 'simulated' };

  // Activate endpoint: will call external service if HOLOMINE_URL provided, otherwise simulate
  app.post('/holomine/activate', async (req, res) => {
    const payload = req.body || {};
    if (externalUrl) {
      try {
        const result = await postJson(externalUrl, payload);
        return res.json({ mode: 'external', url: externalUrl, result });
      } catch (err) {
        return res.status(502).json({ error: 'external_request_failed', message: err.message });
      }
    }
    // Simulate activation and keep minimal state
    simulatedState = { active: true, mode: 'simulated', activatedAt: new Date().toISOString(), payload };
    return res.json({ mode: 'simulated', state: simulatedState, message: 'Holomine brain simulated and activated' });
  });

  // Deactivate
  app.post('/holomine/deactivate', (_req, res) => {
    simulatedState = { active: false, mode: externalUrl ? 'external' : 'simulated', deactivatedAt: new Date().toISOString() };
    return res.json({ mode: simulatedState.mode, state: simulatedState, message: 'Holomine brain deactivated' });
  });

  // Status
  app.get('/holomine/status', (_req, res) => {
    const status = externalUrl ? { mode: 'external', url: externalUrl } : simulatedState;
    return res.json({ ok: true, status });
  });

  // A small helper route that demonstrates persona responses when simulated
  app.post('/holomine/respond', (req, res) => {
    const { prompt } = req.body || {};
    if (externalUrl) return res.status(400).json({ error: 'use_external', message: 'Respond is only available in simulated mode when no HOLOMINE_URL is set' });
    const reply = `Holomine persona active${simulatedState.active ? '' : ' (inactive)'} — received: ${prompt || '<empty prompt>'}`;
    return res.json({ mode: 'simulated', reply, timestamp: new Date().toISOString() });
  });
}

module.exports = { register: registerHolomine };
