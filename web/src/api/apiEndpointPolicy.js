function isLoopback(hostname) {
  return hostname === 'localhost' || hostname === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(hostname);
}

export function validateApiBaseUrl(value, { production = false, pageOrigin = 'http://localhost' } = {}) {
  const input = String(value || '').trim();
  if (!input) return '';
  if (/\\|[\u0000-\u001f\u007f]/.test(input) || input.startsWith('//')) throw new Error('Invalid API endpoint configuration.');
  const relative = input.startsWith('/');
  if (!relative && !/^https?:\/\//i.test(input)) throw new Error('API endpoints must use HTTPS or a relative path.');
  const url = new URL(input, pageOrigin);
  if (url.username || url.password || url.search || url.hash) throw new Error('API endpoints cannot contain credentials, queries, or fragments.');
  const localDevelopment = isLoopback(url.hostname) && isLoopback(new URL(pageOrigin).hostname);
  if (url.protocol !== 'https:' && (url.protocol !== 'http:' || (production && !localDevelopment))) {
    throw new Error('Production API endpoints must use HTTPS.');
  }
  return input === '/' ? '/' : input.replace(/\/+$/, '');
}

export function isRelativeApiRequest(value) {
  const url = String(value || '');
  return Boolean(url) && url === url.trim() && !/[\\\u0000-\u001f\u007f]/.test(url)
    && !/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(url);
}
