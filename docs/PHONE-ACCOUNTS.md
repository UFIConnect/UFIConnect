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
