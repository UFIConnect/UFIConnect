# Google, Apple and phone account sign-in

Google and Apple buttons support account login and signup. Provider identities are checked using signed ID tokens, the expected issuer and client ID, token expiry, and a nonce. Existing accounts are matched only by the provider's verified subject. A matching email address does not automatically link a password account.

Members can add a login method from Security settings while signed in. `/auth/providers/:provider/link` starts Google or Apple linking; `/auth/phone/link` starts a phone code. Linking checks the initiating persisted session and account security version again at completion. A revoked session, an identity attached to another account, or a second identity from the same provider is rejected. Existing passwords remain available. `/auth/providers/linked` lists connected login methods without exposing provider subjects or phone numbers.

## Google

The API can reuse `YOUTUBE_CLIENT_ID` and `YOUTUBE_CLIENT_SECRET`. Register the existing public API `/auth/social/youtube/callback` URL on that OAuth web client. Source connection states and account login states remain separate. Login requests `openid email profile`, without YouTube access.

Alternatively configure `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, and register `/auth/providers/google/callback`. Google authorization uses a server-held PKCE verifier, state and nonce.

## Apple

An Apple Developer account must be configured first. Create a Services ID associated with your Sign in with Apple app and register the public website domain and HTTPS API return URL `/auth/providers/apple/callback`.

Add `APPLE_CLIENT_ID` (Services ID), `APPLE_TEAM_ID`, `APPLE_KEY_ID`, and `APPLE_PRIVATE_KEY` (PEM .p8 private key) to the API Render service. Preserve newlines, or use literal `\n` escapes. The API signs a short-lived ES256 client secret and verifies Apple's RS256 identity token. Apple uses `form_post`; its browser flow cookie requires HTTPS and SameSite=None. The name is supplied by Apple only on the initial authorization.

## Phone

Create a Twilio account and an SMS-enabled Verify service. Set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_VERIFY_SERVICE_SID` on the API service. Review destination-country permissions, fraud controls, sender regulations and SMS billing in Twilio before enabling this method.

Phone signup requires a name and an international phone number, with an optional job title. It does not require an email or password. A code sent through Verify must be approved by Twilio before an account or session is issued. A phone number previously saved in a member's profile is not a verified login identity and is never used to link accounts.

Requests are limited to one per minute, five per UTC hour and twenty per UTC day per number, with an additional IP limit. Codes expire after ten minutes and permit at most five verification attempts. Provider errors do not expose a phone number or code. Phone-only records use a random internal email alias marked as a placeholder; it is hidden in profiles and excluded from Office email and Stripe customer email.

## Sessions and mobile handoff

Browser sign-in sets the existing HttpOnly revocable session cookie. The frontend restores the token and profile using `/auth/session`. OAuth flow secrets are encrypted in the primary database; successful callbacks consume the state exactly once. Expired flow secrets are deleted every ten minutes and before new flows. Phone throttling records are deleted after two inactive days.

Native apps start the same provider authorization through `/auth/providers/:provider/start` with `client: native`. The API returns a high-entropy verifier over TLS. The app retains that verifier and receives only a two-minute, one-use code at `uficonnect://auth/callback#code=...`. `/auth/providers/finish` requires both the code and verifier. An intercepted callback code by itself cannot issue a session. The native scheme and callback hostname must be registered in the app build; browser previews use the standard web flow.

Apple and phone buttons remain unavailable until their required provider settings are configured. `/auth/providers` reports readiness without exposing credentials. Office Setup shows exact setting names and callback instructions. No setup inventory request sends SMS or signs in to a provider.

Sources: [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect), [Apple environment setup](https://developer.apple.com/documentation/signinwithapple/configuring-your-environment-for-sign-in-with-apple), [Apple token endpoint](https://developer.apple.com/documentation/signinwithapplerestapi/generate-and-validate-tokens), [Twilio Verify requests](https://www.twilio.com/docs/verify/api/verification), [Twilio verification checks](https://www.twilio.com/docs/verify/api/verification-check).
