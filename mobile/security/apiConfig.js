const DEFAULT_API_URL = 'https://api.uficonnect.org';

function resolveApiBase(value = DEFAULT_API_URL, development = false) {
  // Keep this compatible with Hermes without depending on its partial URL API.
  const match = typeof value === 'string' && value.match(/^(https?):\/\/([a-z\d.-]+|\[[a-f\d:]+\])(?::(\d{1,5}))?(\/[a-z\d/_-]*)?$/i);
  if (!match || (match[3] && (Number(match[3]) < 1 || Number(match[3]) > 65535))) {
    throw new Error('API_URL must be an HTTP(S) address without credentials, query parameters, or fragments.');
  }
  if (match[1].toLowerCase() !== 'https' && !development) {
    throw new Error('Release builds require an HTTPS API_URL.');
  }
  return value.replace(/\/+$/, '');
}

module.exports = { resolveApiBase };
