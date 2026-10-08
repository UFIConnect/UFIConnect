# Source clips in Home and Following

The Snaps row sits above the source selector. Every source with available media
gets its own black box in a horizontal, scrollable row. UFI stays first, including
when empty, with its Post snap action. Favorite sources follow it. The row has
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
Bluesky, and X; a provider appears only when it returns qualifying media. Source
switches, access revocation, content screening, and report removals also apply
to cached previews. Website sign-in alone does not grant source API access.

Following also supports GitHub, GitLab, and Twitch's authorized feeds. X now
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
