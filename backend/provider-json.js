'use strict';

function createProviderJsonClient(https) {
  function request(url, extraHeaders = {}, redirects = 0) {
    return new Promise((resolve, reject) => {
      let target;
      try {
        target = new URL(url);
        if (target.protocol !== 'https:' || target.username || target.password) throw new Error('Unsafe provider URL.');
      } catch { reject(new Error('Unsafe provider URL.')); return; }
      const outgoing = https.get(target, { headers: {
        'User-Agent': 'UFIconnect/1.0 (https://uficonnect.org)', Accept: 'application/json',
        'Accept-Language': 'en-US,en;q=0.9', 'Cache-Control': 'no-cache', ...extraHeaders,
      } }, response => {
        if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
          response.resume();
          if (redirects >= 5) return reject(new Error('Provider redirect limit exceeded.'));
          let destination;
          try { destination = new URL(response.headers.location, target); }
          catch { return reject(new Error('Invalid provider redirect.')); }
          // Provider credentials must never follow a redirect to another host.
          const headers = destination.origin === target.origin ? extraHeaders : {};
          return request(destination.toString(), headers, redirects + 1).then(resolve, reject);
        }
        if (response.statusCode < 200 || response.statusCode >= 300) {
          response.resume();
          // URLs and error bodies can contain access tokens, app keys or PII.
          const error = new Error(`HTTP ${response.statusCode} for ${target.origin}`);
          error.status = response.statusCode;
          error.headers = response.headers;
          return reject(error);
        }
        let data = '';
        response.on('data', chunk => {
          data += chunk;
          if (data.length > 10 * 1024 * 1024) {
            response.destroy();
            reject(new Error('Provider response too large.'));
          }
        });
        response.on('error', () => reject(new Error(`Provider connection failed for ${target.origin}`)));
        response.on('end', () => {
          try { resolve({ data: JSON.parse(data), headers: response.headers }); }
          catch { reject(new Error(`JSON parse failed for ${target.origin}`)); }
        });
      });
      outgoing.on('error', () => reject(new Error(`Provider connection failed for ${target.origin}`)));
      outgoing.setTimeout(15000, function () { this.destroy(new Error('Provider request timed out.')); });
    });
  }
  return {
    fetchJSON: (url, headers) => request(url, headers).then(result => result.data),
    fetchJSONWithHeaders: request,
  };
}

module.exports = { createProviderJsonClient };
