# Monthly generation allowances

Each signed-in member has separate calendar-month allowances:

| Generation | Allowance | Counted unit |
| --- | ---: | --- |
| Video | 20 | One new video generation request, regardless of length |
| Image | 50 | One new image generation request |
| Resume Builder | 30 | One successful AI assistance or application draft request, shared by summary, experience bullets, cover letters and outreach |

Months start and reset at 00:00 UTC on the first day. `GET /generation/usage`
returns the authenticated member's counts and reset time with `private, no-store`.
Media Studio and Resume Builder show the remaining allowance. A monthly limit
returns HTTP 429 with `MONTHLY_GENERATION_LIMIT`, the current usage and reset time.
Database failures return HTTP 503 with `GENERATION_USAGE_UNAVAILABLE`.

`backend/generation-usage.js` reserves each slot atomically in PostgreSQL before
generation. Pending jobs count toward the allowance across API workers and
restarts. Confirmed failed jobs release a pending slot once. Confirmed provider
success remains counted even when saving the media subsequently fails. An
ambiguous timeout after submission retains its slot because the provider may
have accepted the job. Generation is never automatically submitted again.

Saved video status checks, saved media, manual resume editing and exports do not
reserve slots. An application draft returned by the template fallback counts as
one successful drafting request. Subscription and short-term rate limits also
apply. Usage records appear in account data exports and cascade on account
deletion.

## Provider auto-reload

The approved billing settings are **$50 per refill and a $100 monthly automatic
refill cap for each provider**. These are provider-wide credit purchases, separate
from member generation allowances and existing subscription charges. No billing
settings or paid generations are changed by this release.

- OpenAI: open the correct organization's [Billing overview](https://platform.openai.com/account/billing)
  and configure automatic recharge. The dashboard asks for a balance threshold,
  recharge target and monthly limit. Check how the displayed target maps to a
  $50 refill before saving; do not substitute a $50 target balance silently.
  The $100 recharge limit excludes manual purchases and does not cap usage of
  existing credits. See [OpenAI's prepaid billing guide](https://help.openai.com/en/articles/8264644-setting-up-and-managing-prepaid-api-billing).
- Shotstack: open the [dashboard](https://app.shotstack.io/)
  under Settings > Credits or Plans & Billing > Credits & Plans. Confirm the
  account offers auto-recharge, a $50 refill and a $100 monthly cap before
  enabling it. Public documentation does not establish that every account offers
  these controls. See [billing help](https://help.shotstack.io/en/articles/16843603-billing-faqs)
  and [terms, section 3.2](https://shotstack.io/terms/).

The workspace has generation API keys and deployment access, but no authenticated
provider billing dashboard. Auto-reload remains pending dashboard configuration.
Do not use generation keys or invented environment flags as billing controls.

## Verification

PostgreSQL tests cover concurrent admission, month rollover, persistent counts,
exactly-once release, outages and account deletion. Route tests exercise the
generation gates and async video recovery with synthetic provider responses.
`scripts/audit-generation-usage.mjs` checks member quota controls on desktop and
mobile. These checks generate no billable content.
