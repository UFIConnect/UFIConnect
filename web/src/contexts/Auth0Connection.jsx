import { memo, useLayoutEffect } from 'react';
import { Auth0Provider, useAuth0 } from '@auth0/auth0-react';
import { auth0AuthorizationParams, auth0Config } from '../auth/auth0Config';

function ReportAuth0State({ onChange }) {
  const auth0 = useAuth0();
  useLayoutEffect(() => { onChange(auth0); }, [auth0, onChange]);
  return null;
}

export default memo(function Auth0Connection({ onChange }) {
  return (
    <Auth0Provider
      domain={auth0Config.domain}
      clientId={auth0Config.clientId}
      authorizationParams={auth0AuthorizationParams()}
      cacheLocation="memory"
      useRefreshTokens
    >
      <ReportAuth0State onChange={onChange} />
    </Auth0Provider>
  );
});
