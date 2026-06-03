# UFIConnect Deployment

Render is no longer the active deployment target for this repo.

## Hosting

- Identity: Auth0
- API: Railway
- Web: GitHub Pages
- Office: GitHub Pages at `/office/`

## GitHub Actions

Set these repository secrets/variables:

- Secret `RAILWAY_TOKEN`: Railway project token for API deploys.
- Variable `RAILWAY_SERVICE`: Railway service name, usually `api`.
- Variable `RAILWAY_ENVIRONMENT`: Railway environment name, usually `production`.
- Variable `VITE_API_URL`: public API URL, usually `https://api.uficonnect.org`.
- Variables `VITE_AUTH0_DOMAIN`, `VITE_AUTH0_CLIENT_ID`, `VITE_AUTH0_AUDIENCE`: public Auth0 SPA values.

## Railway API Variables

Set these on the Railway API service:

- `NODE_ENV=production`
- `JWT_SECRET`
- `DATABASE_URL`
- `ALLOWED_ORIGINS`
- `API_BASE_URL=https://api.uficonnect.org`
- `FRONTEND_URL=https://uficonnect.org`
- `AUTH0_DOMAIN`
- `AUTH0_AUDIENCE`
- `AUTH0_ISSUER`
- `NODE_HEAP_MB=1024`

Optional Office deploy button support:

- `GITHUB_DEPLOY_TOKEN`
- `GITHUB_DEPLOY_REPO=yosufkaka99-alt/proconnect`
- `GITHUB_DEPLOY_REF=main`

## Auth0 URLs

Add these in the Auth0 SPA application settings:

- Allowed Callback URLs: `https://uficonnect.org`, `https://yosufkaka99-alt.github.io/proconnect/`, local dev URL.
- Allowed Logout URLs: same as callbacks.
- Allowed Web Origins: same origins without paths where appropriate.

The Auth0 API Identifier must exactly match `AUTH0_AUDIENCE` and `VITE_AUTH0_AUDIENCE`.
