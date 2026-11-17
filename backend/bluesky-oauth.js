const BLUESKY_BASE_SCOPE = 'atproto transition:generic';
const BLUESKY_OAUTH_SCOPE = `${BLUESKY_BASE_SCOPE} transition:chat.bsky`;

// Authorization servers can retain metadata from before chat was enabled.
// Keep existing client IDs/token grants valid and retry only this precise
// metadata mismatch. Other authorization failures must remain failures.
async function pushBlueskyAuthorization(push) {
  const result = await push(BLUESKY_OAUTH_SCOPE);
  const description = result?.data?.error_description;
  if (result?.status === 400 && result.data?.error === 'invalid_scope'
      && typeof description === 'string'
      && description.includes('transition:chat.bsky')
      && /not declared in (?:the )?client metadata/i.test(description)) {
    return push(BLUESKY_BASE_SCOPE);
  }
  return result;
}

function blueskyAccessTokenFields(response) {
  const ttl = Number(response.expires_in);
  const expiresAt = ttl > 0 ? Date.now() + ttl * 1000 : undefined;
  return { accessToken: response.access_token, expiresAt: Number.isFinite(expiresAt) ? expiresAt : undefined };
}

function blueskyReadError(result) {
  const code = String(result.data?.error || '');
  if (/^(?:expiredtoken|invalid_?token)$/i.test(code)
    || (result.status === 401 && !/dpop/i.test(code))) {
    return Object.assign(new Error('Bluesky access expired or was revoked.'), { status: 401 });
  }
  return new Error('Bluesky content is temporarily unavailable.');
}

module.exports = { BLUESKY_OAUTH_SCOPE, pushBlueskyAuthorization, blueskyAccessTokenFields, blueskyReadError };
