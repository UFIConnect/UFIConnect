# UFIConnect web protection — October 8, 2026

## Browser behavior

The default website connection panel uses automatic web protection. It verifies
the current authenticated session and Express's trusted HTTPS transport state;
it does not provision a VPN device, download a profile, install an app, change the
visitor's IP, or claim a device tunnel. Account Security settings show the same
status. Errors, offline state, logout and account switches clear a previous
protected status. Device VPN clients retain their explicit native entrypoint.

These controls apply throughout the website and do not require a paid Vault
membership. Baseline protection cannot be disabled with a browser toggle.

## Security changes

- Production session cookies use the `__Host-` prefix with Secure, HttpOnly,
  SameSite=Lax and Path=/, without a Domain attribute. Duplicate cookies cannot
  select an account. Existing production browser cookies require sign-in once
  after this change; sessions already loaded in memory continue normally.
- Cookie-authenticated requests, messages, connected inboxes, imports and account
  endpoints use uncached responses. Cookie mutations on optional authentication
  routes enforce the same origin checks as required authentication routes.
- Invalid or oversized JSON receives a fixed error without submitted text.
- Native message reads, read marks and attachments bind both participants.
  Blocks, accepted connections, follow relationships and existing conversations
  are read from persistent records for database accounts. Permission storage
  failure stops access instead of using an old worker's cached permissions.
- Blocks and relationship removal commit in one transaction before updating
  worker memory. Unblocking also waits for a durable write. Blocking shares
  account locks with message commits, and message permission is checked again
  after media verification and screening finish.
- New message media uses owner-bound, signed authenticated uploads. Provider
  metadata establishes format and size. Conversation responses omit the asset
  URL and upload proof. A participant-authorized API route streams bounded bytes
  with private responses, validated MIME types and no arbitrary redirects.
- Message files load only when requested. Object URLs and requests are cleared
  on navigation, account changes and unmount. Late reads, uploads and sends cannot
  insert another conversation's data or overwrite a new account's drafts.
- Account deletion queues owned message media in the same transaction. A durable
  upload inventory covers abandoned uploads. Cleanup retries and retains pending
  deletion until previous signed upload requests expire.
- Resume imports verify PDF, DOCX and TXT signatures and canonical MIME types.
  DOCX has 512-entry, 4 MB per-entry and 32 MB expanded-total limits; actual
  inflation and CRCs are checked, including forged directory sizes. PDFs are
  limited to 50 pages and extracted text to 200,000 characters. Parser resources
  are released. Uploads are bounded per member and downloaded as inert files.
- Vault credential imports reject malformed CSV, duplicate columns, shifted
  records and invalid or excessive JSON entries. File bytes are bounded before
  reading and parsing. Stale imports cannot overwrite later edits or a new Vault
  selection.
- Source image downloads retain the fixed CDN allowlist, reject redirects and
  non-image content, validate MIME against file signatures, cap actual bytes at
  10 MB, and stop after 10 seconds or client cancellation.

## Limits

The Vault's connection-monitoring switch starts or pauses its authenticated
status checks. Pausing aborts pending checks and clears their displayed status.
The preference is saved per account in this browser; Settings keeps checking
independently. The switch does not disable HTTPS, Vault encryption, account
permissions or message/import safeguards, and does not control a VPN tunnel.

This is application security over HTTPS. Native messages are not end-to-end
encrypted. Historical attachments can still use their earlier public delivery
URLs; this release does not claim to retroactively privatize those files. Third
party sites, embeds, network providers and other apps retain their own security
and connection policies. The status report is a current request check, not a
security certification or a claim that all vulnerabilities have been eliminated.

## Verification

Targeted tests cover ownership, participant access, cross-worker policy changes,
private responses, parser bombs, malformed imports and bounded downloads.
Desktop and phone browser audits cover the actual default Vault and Settings
pages plus messaging with account and recipient changes. A real 67-byte image
was uploaded to authenticated storage, its unsigned URL was denied, and the API
proxy returned the expected private bytes. The test asset was deleted; no
production account or message was created.
