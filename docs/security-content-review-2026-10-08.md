# Frontend and backend content review — October 8, 2026

## Result

No phishing files, embedded mining code, injected executable scripts, exposed
literal credentials, or unexpected source symlinks were identified in the
reviewed frontend, backend and Office source. Microsoft Defender scanned a
snapshot of 520 tracked files (private environment files and installed dependency
folders excluded) and reported no threats. This includes the public Windows VPN
ZIP, whose SHA-256 matches its published download manifest.

Removed `backend/holomine.js` and its route registration. This unused prototype
had unauthenticated activation, deactivation, status and response endpoints. It
could forward an entire request body to `HOLOMINE_URL`, expose that configured URL,
and share submitted state between callers. No frontend or Office feature uses it.
Its provenance is an earlier repository commit; the review did not establish that
it was malware. Removing it closes an unnecessary public forwarding surface.

## Scope and evidence

- Inventoried backend, web and Office source, public assets, HTML, SVG, scripts,
  executable archives, dependency manifests and lockfiles.
- Checked dynamic execution, encoded programs, external script injection,
  credential literals, credential-collection destinations, OAuth destinations,
  navigation URLs, upload destinations and service-worker behavior.
- No untracked source files or unexpected symlinks were found in these folders.
- All 398 resolved lockfile packages use `registry.npmjs.org` and have integrity
  metadata. Reviewed external integrations include social providers, career
  sources, live-camera embeds, signed Cloudinary uploads, and the isolated Google
  analytics bridge. Office's constrained Cloudflare tunnel supports local previews.
- The VPN ZIP contains the two expected UFIConnect executables and a README. It
  was inspected and scanned without running those executables.

This review covers the checked-out source and distributed assets. It is not a
complete review of production database rows, account-specific feed imports, cloud
storage objects or third-party provider contents. No production content was
deleted based solely on its being external.

## Dependency advisory

The frontend and Office dependency scans reported zero advisories. The backend
scan reported three moderate entries for the same transitive chain:
`mammoth → argparse → sprintf-js`. There were no high or critical entries.

[GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c)
affects formatting precision when an attacker controls a format string. No patched
`sprintf-js` release is available. Mammoth 1.13.0 is current; its command-line
entry loads argparse. UFIConnect uses `mammoth.extractRawText()` for DOCX imports
and does not run its command-line entry or accept formatting strings. The
advisory remains recorded; dependencies were not downgraded or replaced with an
incompatible command-line parser to suppress the warning.

## Mandatory automatic location

Authenticated Home, Following, source-filtered, video, music and map feed reads
require fresh device coordinates or trusted Cloudflare IP-location information.
Saved travel destinations, profile text, legacy disabled-location preferences,
unverified location headers and expired device coordinates do not bypass this
requirement. Device location is preferred; network location satisfies the
requirement when device permission is declined. IP location is approximate and
can fall back to country when a city is unavailable.

If neither source resolves, the API returns `428 feed_location_required` with
private, uncached responses. The browser pauses the feed and offers Enable
location and Retry automatic location. Profile, settings, privacy and the public
guest feed remain accessible. Coordinates are not saved to public profiles or
returned in feed metadata.

## Validation

Focused backend checks cover every guarded route, device and trusted IP success,
missing/forged/expired location, travel and source-filter bypass attempts, private
responses, profile access and removal of the prototype endpoints. Existing
device-session and location-personalization checks passed. The frontend production
build passed. Browser checks cover the required-location screen and recovery
through IP fallback with device permission denied at desktop and phone widths.
Broad local test suites were skipped as requested; normal required repository
checks still apply to publication.
