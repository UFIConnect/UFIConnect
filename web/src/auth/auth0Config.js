export const auth0Config = {
  domain: (import.meta.env.VITE_AUTH0_DOMAIN || '').trim().replace(/^https?:\/\//, '').replace(/\/+$/, '').toLowerCase(),
  clientId: (import.meta.env.VITE_AUTH0_CLIENT_ID || '').trim(),
  audience: (import.meta.env.VITE_AUTH0_AUDIENCE || '').trim(),
};

export const isAuth0Configured = Boolean(auth0Config.domain && auth0Config.clientId);

export function auth0BackendAvailable(value) {
  return isAuth0Configured && value?.enabled === true && typeof value.domain === 'string'
    && value.domain.trim().toLowerCase() === auth0Config.domain && Boolean(auth0Config.audience)
    && value.audience === auth0Config.audience && value.issuer === `https://${auth0Config.domain}/`;
}

export function auth0AuthorizationParams(screenHint = null) {
  const basePath = import.meta.env.BASE_URL && import.meta.env.BASE_URL !== '/'
    ? import.meta.env.BASE_URL.replace(/\/$/, '')
    : '';
  const params = {
    redirect_uri: `${window.location.origin}${basePath}`,
    scope: 'openid profile email',
  };
  if (auth0Config.audience) params.audience = auth0Config.audience;
  if (screenHint) params.screen_hint = screenHint;
  return params;
}
