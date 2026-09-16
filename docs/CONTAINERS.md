# Local container examples

`docker-compose.yml` runs one API worker; `docker-compose.lb.yml` runs two behind an internal nginx balancer. Use either file on its own. Both expose only the web server on `127.0.0.1:80`; the API and PostgreSQL have no published host ports. Open `http://localhost`, with API requests passing through `/api`.

## Required configuration

Supply these through your shell environment or an access-restricted, untracked Compose environment file:

| Variable | Requirement |
| --- | --- |
| `POSTGRES_PASSWORD` | Separate random database password. Use 32 random bytes encoded as hex so it remains safe inside the database URL. |
| `JWT_SECRET` | Separate random secret of at least 32 bytes; for example, 48 random bytes encoded as hex. |
| `OAUTH_TOKEN_ENCRYPTION_KEY` | Separate random 32-byte key encoded as base64. Preserve it securely across restarts; changing it prevents existing provider tokens from being decrypted. |
| `OFFICE_TOKEN` | Optional dedicated random admin secret. Office remains unavailable when this is empty. |

Generate each value independently using a cryptographically secure generator. Do not reuse secrets, commit environment files, pass secrets as Vite build arguments, or paste expanded Compose configuration into logs. PostgreSQL applies its initialization password only when the data volume is first created; changing an environment value does not rotate an existing database password.

After configuring the environment:

```sh
docker compose -f docker-compose.yml config --quiet
docker compose -f docker-compose.yml up --build -d
```

For the two-worker example, replace the filename with `docker-compose.lb.yml`. The web nginx startup template selects `backend:3000` or `api-lb:80` through `API_UPSTREAM`; the browser always uses the same-origin `/api` path. API readiness probes use Node's built-in fetch against `/readyz` and wait for durable authentication storage.

## Network boundary

These are local HTTP examples, not internet-facing deployment configurations. PostgreSQL uses plaintext only on this private local Docker network, explicitly configured with `DATABASE_SSL_MODE=disable` and `DATABASE_ALLOW_PLAINTEXT_INTERNAL=true`. Hosted database connections must use verified TLS.

The only client entry point is the web proxy, which overwrites client-supplied forwarding headers. Backend proxy trust is fixed to one hop in the single-worker example and two in the load-balanced example. Do not publish additional API ports or add another reverse proxy without reviewing that trust boundary. Compose network isolation assumes a trusted Docker host and containers.

Web and API access logs omit query strings and referrers; web responses send no-referrer and nosniff headers. The web build context excludes environment files, signing keys, caches, and dependencies. Node 24 on Debian provides the glibc environment used by the existing canvas build dependency's Linux prebuilds. The [official nginx image](https://hub.docker.com/_/nginx) processes its environment template at startup.

## Validation and release limits

The Compose files were parsed and statically checked for required secrets, local port binding, proxy topology, readiness probes, and database settings. Docker and nginx are unavailable in the current workspace, so no image build, `docker compose config`, nginx syntax check, container startup, cross-worker session test, or image vulnerability scan has been performed here.

Before public hosting, configure HTTPS, verified database TLS, production origins and OAuth callback URLs, shared rate limiting across workers, managed secrets/backups, and the repository security release checklist. Keep test data separate from real sensitive information in these local examples.
