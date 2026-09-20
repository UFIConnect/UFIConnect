# Render runtime and sync

UFIconnect is a Node.js and React application. There is no Python service,
`requirements.txt`, or Python start command. A Python file-discovery error means
the selected service runtime does not match this repository.

Connect the repository **UFIConnect/UFIConnect**, branch **main**. Use the root
`render.yaml` when creating or syncing the Blueprint. Its four application
services have these settings:

| Service | Type/runtime | Root directory | Build | Start / output |
| --- | --- | --- | --- | --- |
| API | Web service / Node 24 | `backend` | `npm ci --omit=dev` | `node --max-old-space-size=320 index.js` |
| Pipeline | Web service / Node 24 | `backend` | `npm ci --omit=dev` | Same command; `SERVICE_ROLE=pipeline` |
| Website | Static site | `web` | `npm ci && npm run build` | `dist` |
| Office | Static site | `office` | `npm ci && npm run build` | `dist` |

Keep the existing environment variables, database connections, service names,
and domains. The API uses `SERVICE_ROLE=api`; both backend services check
`/readyz`. The Node services do not require Docker or Python files to sync.
If an existing service was created with Python, inspect its runtime settings
before changing its build command: adding a Python file will not run this app.

For an intentionally Docker-based backend, the repository now includes the
default root `Dockerfile`; use repository-root build context. The older
`Dockerfile.backend` also needs repository-root context. The website's
`web/Dockerfile` uses `web` as context and is the local Compose alternative to
the deployed static site. Do not select `web/Dockerfile` for the API or pipeline.

Blueprint synchronization updates service configuration. Publishing code is
separate: the GitHub `Verify UFIconnect` workflow must pass on the latest main
commit, then `Deploy Render Services` sends that exact commit to all four hooks.
Keep all four `RENDER_HOOK_*` secrets in the existing deployment environment.
A successful hook request starts a deploy; check readiness and live assets
after its build finishes.

References: [Blueprint specification](https://render.com/docs/blueprint-spec),
[Node version](https://render.com/docs/node-version),
[Docker deploys](https://render.com/docs/docker),
[Deploy hooks](https://render.com/docs/deploy-hooks).
