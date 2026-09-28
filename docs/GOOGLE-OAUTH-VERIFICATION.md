# UFIConnect Google OAuth verification packet

Prepared September 28, 2026. This packet is not a Google approval or submission receipt.

## Console fields

| Field | Value |
| --- | --- |
| App | UFIConnect (use consistent spelling across consent, homepage, and video) |
| Homepage | https://uficonnect.org/ |
| Privacy policy | https://uficonnect.org/privacy |
| Terms | https://uficonnect.org/terms |
| Authorized domain | uficonnect.org |
| Web OAuth redirect URI | https://api.uficonnect.org/auth/social/youtube/callback |
| Logo | https://uficonnect.org/uficonnect-google-verification-icon.png |
| User-provided demo | https://www.youtube.com/watch?v=8OxRBbY8hcg |
| Support and developer contacts | Select monitored addresses belonging to the project owner; confirm in Console. |

The homepage, policy, terms, logo, and existing Google verification file returned HTTP 200 during the preparation check. The homepage links to both legal pages without JavaScript. The verification file being reachable does not establish that the submitting Google project owner/editor has completed Search Console verification.

## Scope justifications

Declare all scopes that the deployed code actually requests in Google Auth Platform → Data Access. The app uses its own account sign-in; YouTube authorization connects a member's YouTube account.

### https://www.googleapis.com/auth/youtube.readonly

UFIConnect lets a signed-in member connect YouTube and view recent videos from the channels they subscribe to, plus metadata for their own channel uploads. The server reads subscriptions, channel upload playlist identifiers, playlist items, and video metadata such as duration and available engagement counts. These appear in the member's connected feed and own-content views. Public API access alone cannot read the member's account-specific subscriptions or private account metadata. This standard connection requests read-only access and cannot publish ratings or comments.

Evidence: `fetchYouTubeSubscriptionFeed` and `fetchYouTubeOwnUploads` in `backend/index.js`; Connected Accounts; connected feed; own-content views.

### https://www.googleapis.com/auth/youtube.force-ssl

UFIConnect optionally lets a connected member like or remove a rating on a YouTube video and publish a top-level comment from a video card. The member explicitly requests each action using controls labeled with the YouTube destination. The app requests this permission through an interaction upgrade, separately from the standard read-only connection. The YouTube `videos.rate` and `commentThreads.insert` endpoints require write authorization; read-only access cannot perform them. This request is for implemented ratings/comments, not a future video upload feature.

Evidence: `backend/source-interactions.js`, `web/src/components/ConnectedPostActions.jsx`, and `/connected-accounts?interactions=1`.

## Demo evidence

Use a real recording with the browser address bar visible and the UI in English. Do not substitute mocked consent screens or fake successful API responses. Google requests an unlisted YouTube video demonstrating every requested scope.

1. Show the public homepage and privacy link.
2. Sign into UFIConnect, open Connected Accounts, and start the YouTube connection.
3. Show Google's real consent screen, the app identity, requested permissions, and client ID in the browser URL. Keep passwords and client secrets out of the recording.
4. Complete consent and show the connected YouTube account and its actual subscription feed or own-content metadata.
5. For the interaction scope, show the separate permission upgrade, then a rating and comment on a video controlled by the demonstrator. Show the resulting action on YouTube. Only the account owner should perform and authorize these demonstration writes.
6. Show Disconnect and the Google Account connections page where access can be revoked.

The supplied video's visibility and coverage must be confirmed before submission. If it omits a requested scope, replace or extend it; do not describe it as demonstrating functionality it does not show.

## Submission sequence and remaining evidence

1. Deploy the updated policy disclosures and confirm their public URLs.
2. Confirm domain ownership in Search Console using an Owner or Editor of the same Google Cloud project.
3. In Branding, use the public URLs and monitored contact addresses. Resolve any displayed warning, run Verify Branding, and publish the branding after it passes.
4. In Data Access, declare the actual scopes above and supply their justifications. Confirm Console's classifications.
5. In Verification Center, provide the demo link and requested application details, then submit data-access verification. Save the receipt/status. Google makes the approval decision.
6. Monitor the developer/support inbox for follow-up requests.

Open items: exact warning text, verified domain ownership, demo coverage/visibility, authenticated Console submission, and Google's decision. Production connection success is not verification approval. This packet does not certify every operational policy requirement or backup-deletion behavior.

## Official references

- [Google sensitive-scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification)
- [Verification requirements](https://support.google.com/cloud/answer/13464321?hl=en)
- [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy)
- [YouTube developer policies](https://developers.google.com/youtube/terms/developer-policies)
- [Video ratings](https://developers.google.com/youtube/v3/docs/videos/rate)
- [Comment creation](https://developers.google.com/youtube/v3/docs/commentThreads/insert)
