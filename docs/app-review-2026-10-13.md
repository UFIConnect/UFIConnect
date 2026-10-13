# App review update — 13 October 2026

The current review work includes these requested changes:

- Compact app welcome with sign-in, account creation and policy links, plus a bold animated blue background that respects reduced-motion preferences. The public-feed shortcut has been removed.
- App top and bottom navigation anchored to the viewport, with usable scrolling and native safe areas applied once.
- Original-source buttons that open correctly in the iPhone app.
- Shared video resolution for Mastodon API attachments, Bluesky API playlists and official YouTube/Vimeo embeds, including Music and Snaps.
- Muted autoplay for the active visible playable item, including desktop feeds without a hover; UFI controls and attribution outside the picture. Required source player elements and advertising remain intact.
- Full provider-supplied post writing remains available through Read more inside UFI; the import pipeline no longer treats a short card preview as the stored body. Sources that supply only an excerpt still retain their original-source link.
- Job summaries describe the role using the source's overview, with responsibilities shown separately and the supplied listing available in full.
- Player command improvements for scrubbing, keyboard access and active-player ownership, with source-specific capabilities.
- Twitch clip checks: official controls remain available where the embed fits and has a valid web hostname; unsupported app/phone embeds receive an explicit original-source action.
- The concurrent website update restoring endless feeds and changing navigation buttons. Search remains paginated.
- Earnings report generation from authorized provider estimates and explicitly unverified manual statements. Each amount retains its source, creator account, dates, currency and provenance. Exports never create a payable balance.

Provider earnings, measured playback time and payments from UFI are separate concepts. Only the YouTube creator-revenue adapter currently supplies provider estimates. A missing provider report is unavailable, not zero. Provider revenue shares and payout balances are not supplied by the current adapters.

There is no active UFI payout program. Platform terms and UFI's existing terms do not specify a funded UFI rate, recipient agreement or payment mechanism. This update therefore generates reports; it does not invent earnings, transfer money, or claim to register provider views. Entries typed into the report generator last for that view and can be exported as JSON or CSV.

YouTube's monetary Analytics API is a read-only reporting connection. UFI cannot send its own earnings or watch records back to YouTube to trigger payments or make activity appear to originate on youtube.com. Official embedded playback lets YouTube measure the real activity under its own rules.

Official provider UI may remain visible where source requirements demand it. YouTube's [embedded advertising guidance](https://support.google.com/youtube/answer/132596) distinguishes embedded-player ad eligibility from scripted playback. [YouTube player requirements](https://developers.google.com/youtube/terms/required-minimum-functionality), [X display requirements](https://docs.x.com/developer-terms/display-requirements), and [Reddit embed terms](https://redditinc.com/policies/embeds-terms) prevent using CSS masks or custom bookkeeping to replace required provider behavior.

Release evidence and remaining deployment requirements will be recorded with the new frozen app bundle. The October 11 build 9 bundle remains a separate, unchanged artifact and does not contain this update.
