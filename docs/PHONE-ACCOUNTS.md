# Phone accounts and email settings

Phone sign-up uses a country selector, a phone number, an SMS code, and a name.
It never requires an email address or an email password. If a new member starts
from Login, the approved SMS verification becomes a five-minute, encrypted,
one-use registration proof; completing sign-up does not send another SMS.
Role, topics, and experience follow in onboarding.

Settings → Security supports changing a phone sign-in number after verifying
the new number. The transaction checks the current session, identity snapshot,
and number ownership before replacing the old login mapping. General profile
saves preserve the verified number, including when another worker has a stale
profile. Another account's verified number cannot be taken over.

Completed phone-created accounts without email receive an optional reminder.
They can snooze it for seven days or dismiss it permanently in this browser.
The stored preference is account-specific and contains no email, phone number,
or authentication token. Other sign-up methods do not receive this reminder.

Settings → Account lets a member without email add one using an email code.
Pending addresses do not update the account. Codes expire after ten minutes,
allow five attempts, belong to one authenticated session, and can be used once.
Requests are limited to one per minute and five per hour. Address data is
encrypted in storage. Verification checks account collisions atomically and
keeps the existing phone sign-in method; it does not create an email password.

Email delivery uses the API service's existing SMTP configuration. Configured
fields do not establish that the email provider accepts those credentials.
SMTP authentication and delivery failures leave phone sign-in available and
return a clear retry message. For Gmail SMTP, configure a valid app password
for the sending account; do not use a regular Gmail password.

Google and Apple use their canonical API callbacks and secure binding cookies.
A failed lazy page load after returning to UFIConnect gets one fresh-document
retry within five minutes. A persistent page or render failure shows Reload,
sign-in, and Home recovery links instead of an empty screen. This recovery
does not establish the cause of a particular member's blank page.

## Provider activation and errors

Phone sign-in is enabled when the API has a valid Twilio account, auth token,
Verify service, connected database, and encryption key. An enabled button does
not establish that Twilio permits delivery to every destination. Trial accounts
restrict recipients; unrestricted delivery requires the provider's account
upgrade and compliance requirements. Review the current
[Twilio 21608 requirements](https://www.twilio.com/docs/api/errors/21608).
A rejected SMS does not create an account or a usable verification flow.

Google and Apple buttons on Register create an account after provider
authentication. Login uses the same verified provider identity to sign in.
Google requests only `openid email profile` for authentication, separately from
permissions to read or interact with YouTube. An existing email/password
account must first sign in with its existing method and connect the provider
in Settings → Security; a matching email alone does not link accounts.

The current reused Google client returns to
`https://api.uficonnect.org/auth/social/youtube/callback`. A separately configured
Google sign-in client returns to
`https://api.uficonnect.org/auth/providers/google/callback`. The registered
callback must match the client actually selected by the API. Apple uses
`https://api.uficonnect.org/auth/providers/apple/callback` with `form_post`.

An error on a provider's page must be diagnosed from its exact error code and
details in the provider console. Reaching the account-entry page or receiving
`invalid_grant` for a deliberately invalid code does not establish successful
sign-in, publishing approval, or unrestricted account access.

Failed callbacks returning to UFIConnect emit `[signin] callback failure`
with only the provider, stage, and approved error codes. The record excludes
authorization codes, tokens, cookies, email, and provider messages. It identifies
expired flows, browser binding failures, token exchange, identity verification,
account conflicts, and session failures without revealing account data.
