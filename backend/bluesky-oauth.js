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

module.exports = { BLUESKY_OAUTH_SCOPE, pushBlueskyAuthorization };
