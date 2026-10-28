# Business team membership

Business accounts are created from the public `/business/register` page before signing in. Registration collects the organization and primary industry, creates a free Business account, and goes directly to membership setup at `/business/enrollment`. Payment is a separate explicit action using current Stripe pricing. Personal accounts cannot convert to Business through Settings, profile updates, checkout, the billing portal, or invitations. Existing Business members and previously accepted teammates retain their account track, including after cancellation. A separate Business account requires a different email from an existing personal account.

Business owners choose the total number of people, including themselves. The owner occupies one seat. An active membership for two or more people allows the owner to create an invitation link for an existing Business account from the recruiting workspace or Settings. New teammates register publicly first; they do not need to purchase their own membership. Links expire after seven days, reserve one available seat, and require the intended account to sign in and accept. The app does not send invitation emails.

Only invitation hashes are stored. The link token stays in the URL fragment until the user accepts; it is sent in an authenticated request body for inspection or acceptance. Reissuing an invitation replaces its token. Acceptance consumes the invitation and checks paid capacity under database locks, so concurrent requests cannot allocate more seats than purchased. Each account can belong to one team.

The stored personal plan stays independent. Accepted seats derive Business access from the owner's current plan and paid seat count on each profile and career-access check. Reducing the count keeps the earliest joined members within the available capacity active; excess members remain listed without team access. Cancellation disables every borrowed seat. Storage failures deny derived access. Owners may remove members and revoke invitations; members may leave in Settings. Starting a separate Business checkout requires leaving an existing team first.

Account export includes owned and assigned seats and invitation metadata, without token hashes. Deleting an owner or member removes related team records through foreign keys.

Run `node --test backend/business-teams.test.js backend/billing.test.js backend/privacy-data.test.js` for PostgreSQL-backed capacity, billing, ownership, cancellation and export/deletion checks. Browser checks in `scripts/audit-business.mjs` use synthetic users and intercepted billing.

## Industry workspaces and publishing

Paid Business members use `/business/industries` for industry spaces and `/business/cross-post` for publishing. The registration industry is the initial space choice. Each industry offers relevant source sites; resource links do not imply an enabled publishing integration. Owners manage and archive/restore spaces. Archived spaces keep their history and block new draft changes and publication until restored.

Authors can save, edit, delete, and publish their own drafts. Publishing uses the same draft record with version checks and a durable request identity, preventing concurrent clicks or a lost response from sending the same publication twice. Public UFI and connected LinkedIn destinations require explicit selection. History shows authors, destination results, filters, pagination, and refresh. An uncertain delivery outcome is retained for review rather than automatically retried.

The recruiting dashboard links job posting, candidates, messages, team settings, industry spaces, and cross-posting. Job applications and candidate conversations continue to use the existing recruiting flows. The database remains on Render; these spaces do not provision additional hosted servers.

Enrollment and lifecycle coverage also lives in `backend/business-enrollment.test.js`, `backend/business-industries.test.js`, `scripts/audit-business-signup.mjs`, and `scripts/audit-business-industries.mjs`.
