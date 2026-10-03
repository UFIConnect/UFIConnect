# Business team membership

Business owners choose the total number of people, including themselves. The owner occupies one seat. An active membership for two or more people allows the owner to create an invitation link for an existing registered account from the recruiting workspace or Settings. Links expire after seven days, reserve one available seat, and require the intended account to sign in and accept. The app does not send invitation emails.

Only invitation hashes are stored. The link token stays in the URL fragment until the user accepts; it is sent in an authenticated request body for inspection or acceptance. Reissuing an invitation replaces its token. Acceptance consumes the invitation and checks paid capacity under database locks, so concurrent requests cannot allocate more seats than purchased. Each account can belong to one team.

The stored personal plan stays independent. Accepted seats derive Business access from the owner's current plan and paid seat count on each profile and career-access check. Reducing the count keeps the earliest joined members within the available capacity active; excess members remain listed without team access. Cancellation disables every borrowed seat. Storage failures deny derived access. Owners may remove members and revoke invitations; members may leave in Settings. Starting a separate Business checkout requires leaving an existing team first.

Account export includes owned and assigned seats and invitation metadata, without token hashes. Deleting an owner or member removes related team records through foreign keys.

Run `node --test backend/business-teams.test.js backend/billing.test.js backend/privacy-data.test.js` for PostgreSQL-backed capacity, billing, ownership, cancellation and export/deletion checks. Browser checks in `scripts/audit-business.mjs` use synthetic users and intercepted billing.
