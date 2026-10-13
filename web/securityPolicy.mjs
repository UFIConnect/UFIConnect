import crypto from 'node:crypto';

function inlineScriptHashes(html) {
  const normalized = html.replace(/\r\n/g, '\n');
  return [...normalized.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter(match => !/\bsrc\s*=/i.test(match[1]) && match[2].trim())
    .map(match => `'sha256-${crypto.createHash('sha256').update(match[2]).digest('base64')}'`);
}

export function analyticsBridgeSecurityPolicy(html) {
  return ["default-src 'none'", `script-src ${inlineScriptHashes(html).join(' ')} https://www.googletagmanager.com`,
    'connect-src https://*.google-analytics.com https://*.analytics.google.com https://www.googletagmanager.com',
    'img-src https://*.google-analytics.com https://www.googletagmanager.com',
    "base-uri 'none'", "form-action 'none'", "object-src 'none'"].join('; ');
}

export function browserSecurityPolicy(html, { meta = false, advertising = false, video = false } = {}) {
  const hashes = inlineScriptHashes(html);
  const scripts = [...hashes, ...(video ? ['https://www.youtube.com', 'https://s.ytimg.com'] : []),
    ...(advertising ? ['https://www.googletagmanager.com', 'https://tagmanager.google.com', 'https://www.googleadservices.com', 'https://www.google.com', 'https://googleads.g.doubleclick.net'] : [])];
  const styles = ['https://fonts.googleapis.com',
    ...(advertising ? ['https://www.googletagmanager.com', 'https://tagmanager.google.com'] : [])];
  return ["default-src 'self'", `script-src 'self' ${scripts.join(' ')}`.trim(),
    "script-src-attr 'none'",
    `style-src 'self' 'unsafe-inline' ${styles.join(' ')}`, "img-src 'self' https: data: blob:",
    "font-src 'self' https://fonts.gstatic.com data:", "connect-src 'self' https:",
    "media-src 'self' https: blob:", "frame-src 'self' https:", "worker-src 'self' blob:",
    "object-src 'none'", "base-uri 'self'", "form-action 'self' https://*.auth0.com https://checkout.stripe.com",
    ...(!meta ? ["frame-ancestors 'self'"] : []), 'upgrade-insecure-requests'].join('; ');
}
