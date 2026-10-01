# GitHub updates, reviewed inside Office

`review/local-web` is the default branch for local website updates. Push completed
review changes to that branch. Keep public deployment on `main` separate until the
owner asks to publish. Do not merge this review branch just to refresh the preview.

Open Office at http://127.0.0.1:4174/#local-web. GitHub is selected automatically.
Opening Local web or clicking **Refresh from GitHub** fetches the latest branch
commit into an isolated checkout, installs changed dependencies, and restarts the
embedded website. The status displays the branch and commit actually loaded.
The branch field can temporarily preview another branch; reopening defaults to
`review/local-web`. **Your files / Local review** remains available for local edits.

For a fresh checkout, switch to `review/local-web`, install dependencies with
`npm ci --prefix web`, `npm ci --prefix office`, and `npm ci --prefix backend`,
then run `npm run office:review`. Node 24 and authenticated Git access to this
repository are required. Servers listen only on this computer.

The review launcher supplies a synthetic account and sample posts. GitHub supplies
the website source; the local launcher supplies the sample API and optional
Windows VPN adapter. Nothing is sent to production by this sample launcher.
Updating the launcher itself requires pulling this branch and restarting it.

Maps opens with an animated overview of all 16 nature cities around UFI downtown.
Downtown buildings explain feeds, sources, topics, collections, groups, people,
Command Center, and Vault. Open a city to reach its source houses and topic targets.
Use **Back to all cities** in the map controls to return to the complete overview.
The desktop map has Customize your app, Sources, and Community collection on its
right. City Topics and How your app works follow Community collection in that same
rail, including when viewing one city. These controls stack below the map on mobile.
Maps is at the bottom of the app sidebar; Analytics lives in Profile → More.

Selecting a house or downtown building reveals and focuses the corresponding
right-hand heading. Selecting the same house again also reveals its topics.
Feed results and pagination are scoped to the current city, sources, topics, and
search: changing those inputs immediately hides previous results during loading,
so saving a page cannot accidentally use the preceding selection.

Cars, walkers, cyclists, trams, delivery shuttles, birds, clouds, fountains, water,
and trees animate in the scene. Homes and downtown include windows, rooftops,
landscaping, and street furniture. Full motion is the default, with Calm and Pause
controls. Reduced-motion preferences pause it initially; offscreen and hidden
views suspend rendering. Traffic is illustrative, not a live count of members.
Geometry and palette colors are instanced across cities. The renderer begins with
physical lighting and cached shadows, then adjusts resolution, surface shading,
and subpixel geometry when measured frame time is too high. Every city, source,
and animation remains available at each quality level. Picking accepts deliberate
primary-pointer clicks and cancels on drag, multi-touch, and pointer cancellation.

Maps also preserves topic selections, loaded/saved counts, and per-topic post targets.
Vault is below Music. Profile's More area includes the
writing, research, cooking, sports, developer, monetization, analytics, and learning
workspaces. Learning tools prepare experiments and datasets; no model is trained.

The GitHub website uses http://127.0.0.1:4175. Existing Vault data stays at the
original http://localhost:4188 origin, accessible with **Local review**. Encrypted
Vault data and browser workspaces are never uploaded to GitHub or transferred
between origins. Open the website in its own tab for device-unlock prompts if the
browser restricts them inside Office.
