# Local new-password screening

`common-passwords.json` contains 1,197 SHA-256 fingerprints derived from the public NCSC common-password list in SecLists. The pinned source contains 99,839 entries. Entries outside the application's 12-character / 72-UTF-8-byte policy are excluded because the length check already rejects them. Source URL, commit and download checksum are recorded in the JSON. SecLists' MIT notice is preserved in `LICENSE-SecLists.txt`.

The server compares the whole proposed password, using NFKC normalization and lowercase for blocklist matching only. It also rejects whole-value repeated strings, well-known sequences and simple service-name guesses. It does not reject a passphrase merely because it contains a dictionary word or the service name. The exact entered credential, including case and spaces, still goes to bcrypt; login behavior is unchanged.

This check runs locally during registration, password changes and password resets. User passwords and their fingerprints are not sent to an external screening service. The list is a bounded common-password defense, not a complete or live database of breached credentials.

## Maintenance

Review upstream changes periodically and when credible password-guessing incidents occur. Download the intended pinned `Passwords/Common-Credentials/100k-most-used-passwords-NCSC.txt` and its `LICENSE` from the official SecLists repository into `.cache/common-passwords-source.txt` and `.cache/common-passwords-LICENSE.txt`; record the 40-character source commit in `.cache/common-passwords-source-sha.txt`. Inspect the source and license before updating.

Run `node scripts/build-password-blocklist.cjs`, inspect the generated metadata and data diff, and run `npm test --prefix backend`. Commit the generated JSON and license with the change. The offline generator takes no user-password input and does not run during application startup. If the password length policy changes, regenerate the eligible entries and review the supplementary guesses.

References: [pinned source](https://github.com/danielmiessler/SecLists/blob/1a7bb9127eca9e6ff2fc0301c597fe6e16a0cb56/Passwords/Common-Credentials/100k-most-used-passwords-NCSC.txt), [NIST password guidance](https://pages.nist.gov/800-63-4/sp800-63b.html#passwordver).
