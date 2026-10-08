# Home and Following source choices

`shared/feed-source-catalog.json` defines the selectable feeds: 39 public Home
sources, and UFIConnect plus eight connected Following sources (YouTube, GitHub,
GitLab, Reddit, Twitch, Bluesky, Mastodon, and X). Feed filters, source favorites,
desktop tools, and the mobile web menu use those same lists.

Account and website sources without an installed reader remain visible as
disabled choices labeled **Public feed unavailable** or **Following unavailable**.
Their website links still work. Disabled choices cannot become filters or saved
feed favorites. Connecting an account never substitutes its owner's uploads or
a public keyword search for the member's actual Following timeline.

Public Twitch collection retains stream cards for Home and short clips for
Videos/Snaps from the same bounded, cached official discovery response. It uses
the app's credentials; Following uses the current member's authorized token.
No extra provider reads were added for stream cards. Stream metadata is a source
preview and does not assert that a previously collected stream is still live.

Publisher accounts in the website directory do not imply distribution rights
or a public collector. New feed readers require the appropriate provider access
before being added to the shared selectable-feed catalog.
