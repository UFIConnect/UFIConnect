# Temporary dependency security backports

Re-reviewed 2026-11-03 (America/Los_Angeles). Review or replace with upstream
releases before **2026-11-17 at 00:00 UTC**, when the release gate expires again.

Active local backports cover `braces@3.0.3` and `zod@3.25.76`.
Plain `npm audit` continues to report the installed Zod version. The braces
advisory has been withdrawn; its existing bounded-depth hardening remains.

## 2026-11-03 upstream and mitigation review

The previous review deadline expired independently of the Office AI changes.
This renewal keeps the pinned dependencies, patch hunks, before/after hashes,
exact advisory matching, installed-copy checks, regression tests, and expiry
enforcement unchanged. No new advisory exception is added.

- [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)
  remains high severity and identifies Zod 4.6.6 as fixed. The current
  [Zod registry metadata](https://registry.npmjs.org/zod) still lists 3.25.76
  as the latest stable v3 release. The current SDK57
  [Expo CLI 57.0.32 metadata](https://registry.npmjs.org/@expo/cli/57.0.32)
  requires `zod: ^3.25.76`; forcing Zod4 would cross its supported major range.
  The existing backport follows upstream commit
  [a0ebf970](https://github.com/colinhacks/zod/commit/a0ebf970f2d752e5f58527cd2942ff48be4f46bd):
  leading collection size bounds reject oversized input before child parsing.
  Unbounded schemas remain outside this mitigation, matching that upstream fix.
- [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)
  was withdrawn on 2026-10-23 because it was not considered practically
  exploitable. The current [braces registry metadata](https://registry.npmjs.org/braces)
  still lists 3.0.3 as latest. Retaining the already-tested depth checks avoids
  changing glob behavior during this narrow review renewal; this is hardening,
  not a claim that an active braces advisory remains unresolved.
- The [CI native job](https://github.com/UFIConnect/UFIConnect/actions/runs/41795066544/job/126457109094)
  passed all 24 backport regression and integrity tests before failing solely
  on the old review date. Its
  [raw npm audit artifact](https://github.com/UFIConnect/UFIConnect/actions/runs/41795066544/artifacts/13305051655)
  contains two high findings (Zod and the dependent Expo CLI), eleven moderate,
  two low, and no critical findings. The unchanged exact-advisory assessment
  covers the Zod high cause and finds no unmitigated high/critical causes.
  Lower-severity findings remain visible and are not marked patched.

Local validation on 2026-11-04 repeated all 24 backport tests after a fresh
installation of the unchanged lockfile and explicit application of the pinned
patches. `processPatches()` verified every installed file hash and package copy;
`assessAudit()` accepted the CI report at the current date and still rejected
that same report at the new expiry. The reviewed raw report's SHA-256 is
`82aad6eef2845ebad1ebb43857f828b8a32e26f05d89019a29f3e4b5f60f4c1b`.

The next review is limited to 14 days. Replace the backport when a compatible
upstream release is available, or plan and validate the Expo major migration
separately. A future expiry, unknown high/critical advisory, changed package,
missing patch, or unavailable audit report still blocks release.

On 2026-10-31, the lockfile moved to upstream `node-forge@1.4.2` and
`follow-redirects@1.16.2` to resolve the newly reported high-severity advisories.
The Forge backport was removed from the manifest; its RSA behavioral regressions
remain. Forge 1.4.2 includes the security fixes in 1.4.1 and restores Buffer PEM
input compatibility. See the [Forge changelog](https://github.com/digitalbazaar/forge/blob/v1.4.2/CHANGELOG.md)
and [redirect advisory](https://github.com/advisories/GHSA-mrwp-f3q8-3g9p).

## Provenance

- [braces PR 72](https://github.com/micromatch/braces/pull/72), addressing
  [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm):
  cap brace/parenthesis nesting and AST traversal at 100, honor stricter limits,
  and reject cyclic parent chains. Only five `lib/` files were backported to
  the npm release; existing code outside the hunks is preserved. MIT license.
- Retired: [node-forge PR 1152](https://github.com/digitalbazaar/forge/pull/1152), addressing
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
and uploaded by CI. Only exact advisory URLs in the active manifest are recognized after
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
all backports are replaced. Do not extend the review date or add exceptions
without reviewing current upstream state and mitigation.


## Zod 3.25.76 bounded collection backport

GHSA-mrhx-c7xc-m3w5 was updated on October 23, 2026. Expo SDK57 CLI still requires Zod3; upgrading Expo within SDK57 does not remove the affected dependency. The pinned adaptation follows upstream commit [a0ebf970](https://github.com/colinhacks/zod/commit/a0ebf970f2d752e5f58527cd2942ff48be4f46bd). It returns a size error before walking children when a leading upper size bound is exceeded. It covers v3 arrays and sets, and bundled v4 arrays, sets and maps, through CommonJS, ES modules and TypeScript source exports.

The older v4 executor runs checks after parsing even for aborting size errors. The backport wraps its run function to prevent duplicate size issues and later checks from reading unparsed input. Non-size checks before a bound retain their order, including overwrite operations and conditional checks. V3 maps have no size-bound API. Unbounded collections remain unchanged, matching the scope of the upstream fix. No global input limit or new Zod major version is introduced.

Regression tests exercise all public module entry variants, oversized sync/async input, zero child/later refinement calls, single error reporting, nested paths, valid values, below-bound errors, overwrite order, and audit rejection of unknown or unpatched copies. The existing review deadline remains unchanged.
