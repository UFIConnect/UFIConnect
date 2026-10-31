# Temporary dependency security backports

Reviewed 2026-10-03. Review or replace with upstream releases before **2026-11-03**.

Active local backports cover `braces@3.0.3` and `zod@3.25.76`.
Plain `npm audit` continues to report these installed versions.

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
