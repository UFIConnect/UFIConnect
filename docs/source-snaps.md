# Source clips in Home and Following

The Snaps row sits above the source selector. Every source with available media
gets its own black box in a horizontal, scrollable row. Home includes external
sources only; UFI Snaps and their Post snap action appear in UFI and Following.
Favorite sources appear first. The row has
no visible title, subtitle, or arrow controls; it supports touch and keyboard
scrolling. Source names and original post links remain visible in the viewer.

Native UFI Snaps keep their existing 24-hour lifetime, member visibility rules,
report suppression, and owner deletion controls.

External previews use already approved source posts from the past seven days.
They qualify when source metadata confirms a video is at most 180 seconds, or
the canonical URL identifies a YouTube Short. An unknown-length ordinary video,
an article thumbnail, or a live stream is not relabeled as a short clip. The
preview window does not delete or expire the original source post.

Home reads the public source pipeline and durable cache. It never requests a
member's connected timeline. Following reads only that member's authorized
Following adapters and never falls back to public discovery or keyword search.
Clip-capable readers currently include YouTube subscriptions, Reddit, Mastodon,
Bluesky, X, and Twitch; a provider appears only when it returns qualifying media. Source
switches, access revocation, content screening, and report removals also apply
to cached previews. Website sign-in alone does not grant source API access.

Following also supports GitHub and GitLab's authorized feeds. X now
uses the OAuth home timeline with read permissions and token renewal. Facebook
keyword matches are excluded from Following. X API access and credits must be
available; failures produce source-specific notices without public fallbacks.

YouTube uses its official player. Mastodon, Bluesky, and Reddit use validated
source embeds where available. Sources without a supported embed retain a
poster and a Watch on source action. Direct playback of external files requires
an explicit trusted playback permission; video files are never downloaded or
rehosted. Closing or changing the viewer unmounts the player. Ending a clip does
not advance to another clip.

The public database read is bounded per source, shared for one minute, and
coalesced across requests. The rail reuses member Following caches without a
forced refresh, so loading it beside the feed does not force an extra paid read.
Each source box has its own refresh action, which requests only that source and
preserves clips and notices from the other sources. Native publication reloads
UFI only. Explicit external refresh bypasses that source's cache.
Provider failures do not remove clips from working sources. Neither surface
consumes the main post feed's seen state.

## Twitch public and followed clips

The public worker requires `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET`. It uses
the server's app token to discover at most six non-mature live broadcasters and
eight recent clips per broadcaster. Discovery is shared for one hour, including
concurrent topic workers. No connected member token or follow graph is used by
this public worker.

Following uses the current member's user token with `user:read:follows`, reads
their followed live streams, and fetches up to eight recent clips from each of
three followed channels. Its five-minute cache is keyed by the full token,
member, client ID, and connection time. Permission failures or revoked tokens
produce a source notice without a public fallback. Original timestamps,
creator attribution, view counts, duration, and canonical clip URLs are kept;
view counts are not displayed as likes.

Twitch clips use the official player with the current hostname as `parent` and
autoplay disabled. Screens too narrow for Twitch's minimum player size use a
thumbnail and Watch on Twitch link. Clip files are not derived or rehosted.

Provider references: [Get Clips](https://dev.twitch.tv/docs/api/reference/#get-clips),
[Get Followed Channels](https://dev.twitch.tv/docs/api/reference/#get-followed-channels),
[Get Followed Streams](https://dev.twitch.tv/docs/api/reference/#get-followed-streams),
[app tokens](https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/#client-credentials-grant-flow),
and [official clip embeds](https://dev.twitch.tv/docs/embed/video-and-clips/).

TikTok's Display API and the installed Dribbble integration read a connected
user's own uploads, so those feeds do not qualify as Following. Discord and
Figma supply account identity rather than post timelines. Installed LinkedIn
and Instagram permissions do not supply a general consumer following timeline.
WordPress Reader has a followed-post API, but UFIConnect's account authorization
for that provider is not configured; it stays locked until setup is complete.
