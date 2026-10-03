# Temporary dependency security backports

Reviewed 2026-10-03. Review or replace with upstream releases before **2026-11-03**.

Installed versions remain `braces@3.0.3` and `node-forge@1.4.0`. Neither advisory
currently has a published fixed version. These are local backports, not upstream
releases; plain `npm audit` continues to report their versions.

## Provenance

- [braces PR 72](https://github.com/micromatch/braces/pull/72), addressing
  [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm):
  cap brace/parenthesis nesting and AST traversal at 100, honor stricter limits,
  and reject cyclic parent chains. Only five `lib/` files were backported to
  the npm release; existing code outside the hunks is preserved. MIT license.
- [node-forge PR 1152](https://github.com/digitalbazaar/forge/pull/1152), addressing
  [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv):
  check nested DigestAlgorithm element count as well as outer DigestInfo count.
  Only `lib/rsa.js` changes. Used under node-forge's BSD-3-Clause license option.

`manifest.json` preserves reviewed hunks, upstream diff SHA-256, package versions
and before/after SHA-256 for every changed file. Tarball integrity remains pinned
in the lockfile. Installation never fetches mutable PR content.

## Installation and release gate

`npm ci --prefix mobile` applies patches through `postinstall`. Unknown versions
or unexpected contents fail installation. Application is idempotent and covers
every copy in the lockfile. An `--ignore-scripts` installation fails verification
until `npm run postinstall --prefix mobile` is explicitly run.

`npm run audit:security --prefix mobile` runs attack regressions and the ordinary
npm JSON audit. The raw report is saved to `mobile/.cache/dependency-audit.json`
and uploaded by CI. Only the two exact advisory URLs above are recognized after
installed versions, locations, file hashes and regression tests pass. Transitive
reports are covered only when every underlying advisory is covered. New high or
critical advisories, unpatched copies, unavailable audit data and expired review
dates fail the gate. Other package audit commands remain unchanged.

Both vulnerability regressions failed against pristine npm packages, as expected.
Patched packages pass all six regression/policy tests and all 40 mobile security
and compatibility tests. Coverage includes malformed RSA DigestInfo with public
exponents 3 and 65537, valid signatures with optional NULL, ordinary globs/ranges,
excessive input/AST depth, parent cycles, patch integrity and audit policy.

## Retirement

When fixed upstream versions exist, update the lockfile, remove their manifest
entries and retain behavioral regressions. Retire custom audit handling after
both backports are replaced. Do not extend the review date or add exceptions
without reviewing current upstream state and mitigation.
