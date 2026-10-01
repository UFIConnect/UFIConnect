# Maps, Office, and local review

Website **Maps** is `web/src/pages/Maps.jsx`. Its category neighborhoods and sources
are defined in `web/src/data/mapTowns.js` and `mapDistricts.js`. Maps is currently
available in development previews only. Counts come from the feed; animated traffic
is illustrative, never a report of posts being processed. A failed request keeps
the last real counts and displays a stale/unavailable state.

Office **Live City** remains the operations dashboard. Its agents, operational
districts, and health data belong to `office/src/city-model.mjs`. Neither website
Maps nor its labels should import that operational model.

Both features use the renderer and geometry in `shared/city`. The small Office
re-export modules preserve existing imports. React and Three resolve from each
application's dependencies. Render builds both static sites from the repository
root so these shared files are available.

## Local web

Run `npm run office:release-local`, then open `http://127.0.0.1:4174/#local-web`.
This is a tab inside your local Office, not a separate hosted workspace page.

- **Your files** previews this checkout on port 4173.
- **GitHub → Get latest from GitHub** fetches the selected branch into an isolated
  `.cache/github-review` worktree on port 4175. The branch and commit are displayed.
  Fetching never merges into or overwrites your working files. Edits in the snapshot
  must be saved before it can update. The editor continues editing your local files.
- The GitHub snapshot runs the repository's dev configuration and uses the live
  API. Use trusted branches from this repository. Package lifecycle scripts are
  disabled during its dependency installation.
- The optional local sample/Vault launcher can provide port 4188 with
  `reviewOnly: true`. Its extra tabs and sample-account data stay separate from
  the GitHub snapshot. The Vault browser origin is preserved so encrypted browser
  storage stays accessible. Publishing and phone sharing are hidden in this mode.

The GitHub preview is an explicit refresh, not automatic publication or a claim
that Render has deployed that commit. Local-only feature overlays must be
reconciled separately; never replace them by resetting a working checkout.
