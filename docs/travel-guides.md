# Live Travel and city guides

Live Travel uses the complete 91-city catalog for its city rail and Previous/Next controls, including the expanded viewer. City search filters by city or country without changing the saved feed location. A matching verified camera plays when available. Otherwise another verified stream plays with its actual city and country clearly labeled. Failed and ended streams advance to the next verified camera; exhausting the list shows a retry control. YouTube availability and playback restrictions still apply. Watch live opens UFIConnect's own viewer. City guide buttons in the rail and feed open a UFIConnect dialog, with Back to Travel and Escape support.

`GET /travel/guides/:id` serves public text excerpts for an exact catalog ID. The server chooses the Wikivoyage slug from the catalog; callers cannot supply a URL. Successful results are cached for six hours, concurrent requests for a city share work, and at most four provider requests run together. Requests have a seven-second deadline and a 2 MiB response limit. Provider failures return an existing saved guide or a brief catalog overview with a retry state. This route does not read or change member location or account data.

The reader displays one topic at a time, with topic tabs in a single horizontally scrollable row. The tabs support arrow keys, Home and End. It displays plain text and does not embed provider HTML, scripts, images, or an external website. Long sections are shortened. Attribution identifies Wikivoyage contributors, links the original article and its history, and links CC BY-SA 4.0. These adapted text excerpts remain under that license.

`backend/travel-camera-streams.json` records operator-published YouTube candidates, their exact catalog city, attribution and operator links. These were located through operator pages and supported channel/upload-playlist API reads, without additional `search.list` requests. The backend batches them with existing cameras for fresh `videos.list` verification; stored verification dates are provenance, not permission to label an ended stream live. An exhausted search quota does not prevent these checks. Videos with explicit commercial-use or embedding restrictions are excluded. Playback uses YouTube's official iframe player, with operator attribution; footage is not downloaded or rehosted.

References:

- [Wikivoyage guide reuse](https://en.wikivoyage.org/wiki/Wikivoyage:How_to_re-use_Wikivoyage_guides)
- [MediaWiki text extraction API](https://www.mediawiki.org/wiki/Extension:TextExtracts/en)

Validation: `node --test backend/travel-guides.test.js backend/travel.test.js` and `node scripts/audit-travel.mjs`. The browser fixture exercises all 91 city transitions, the expanded viewer, nested city guides, keyboard close, outages, unsafe provider text, and mobile layout. It uses simulated camera playback; real stream availability remains controlled by YouTube verification.
