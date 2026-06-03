export const auth0Config = {
  domain: (import.meta.env.VITE_AUTH0_DOMAIN || '').replace(/^https?:\/\//, '').replace(/\/+$/, ''),
  clientId: import.meta.env.VITE_AUTH0_CLIENT_ID || '',
  audience: import.meta.env.VITE_AUTH0_AUDIENCE || '',
};

export const isAuth0Configured = Boolean(auth0Config.domain && auth0Config.clientId);

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
