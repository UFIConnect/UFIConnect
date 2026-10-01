# Local review updates

Open Office at http://127.0.0.1:4174/#local-web and select **Local review**.
The website is http://localhost:4188. The separate GitHub snapshot intentionally
does not contain these local-only changes.

- Maps sits below Analytics in desktop and mobile navigation. Your Vault follows
  Music in the feed rail and mobile feed menu.
- Maps now uses its own compact renderer (`MapCityScene.jsx`) with sixteen nature
  themes. This local website change does not alter Office Live City.
- City and platform houses retain source choices, selected topics, and post
  targets. More topics are available across categories. Topic counts distinguish
  loaded posts from saved posts; they are not global source totals.
- Targets apply to manual and bulk saving. City targets go up to 500, within the
  overall 500-post collection cap. Posts matching multiple selected topics count
  toward each applicable topic target. Existing selections are preserved.
- Vault entries can store a website and an official app launch link. Launches
  use the browser/device, do not embed third-party login pages, and never append
  passwords. Supported links are HTTP(S) websites, HTTPS app links, Spotify
  content URIs, and official Teams app/entity links. Device support determines
  which installed app handles a link.
- App favorites, launch counts, and favorite/frequent commands are encrypted in
  the existing account-scoped Vault record. No Vault usage enters analytics.
  Existing records without preferences remain readable. Hardware setup remains
  pending; browser auto-lock and account isolation remain enabled.
- Profile → More includes Monetization, Deep learning, Analytics, Article writing,
  Research center, Cooking center, Sports center, Developer, Developer analytics,
  and Backend developer, plus the existing account/settings tools. Analytics
  retains the existing connected-source reporting page. The new workspaces link
  to those reports and support aggregate imports, planning, and exports. They do
  not start paid services or run model training; an actual training runtime is
  still required for training experiments.

Checks: six focused encryption/account/link/topic-limit tests passed. Local
browser checks covered city and topic targets, persistence, source houses, More
routes, Vault favorites and locking, and mobile overflow without runtime errors.

App link references:
- https://developer.spotify.com/documentation/ios/tutorials/content-linking
- https://learn.microsoft.com/en-us/microsoftteams/platform/concepts/build-and-test/deep-links
