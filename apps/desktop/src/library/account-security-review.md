# Account security review — 2026-09-18

Scope: the Battle.net account importer committed in `79faf94`, its native webview
and desktop data flow, the existing Xbox browser/API flow in the backend sibling,
and the installed JavaScript/Rust dependency graphs. This is a code review and
targeted regression validation, not a penetration-test certification.

## Findings addressed

| Area                          | Finding                                                                                                       | Change                                                                                                                                                              |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Battle.net private mode       | Wry can silently fall back to a persistent controller on older WebView2 runtimes.                             | Open a hidden blank page first, verify the native private profile, then navigate.                                                                                   |
| Battle.net session cleanup    | Cancellation released the active slot before destruction; cleanup relied only on closing a window.            | Await native cookie/browsing-data clearing; block overlapping attempts and retries after cleanup failure.                                                           |
| Battle.net browser privileges | Whole provider domains were accepted and native browser defaults were broader than needed.                    | Exact login hosts, visible host in the native title, disabled native messaging/host objects/password saving/autofill/devtools, denied permissions/popups/downloads. |
| Battle.net metadata reader    | Fetch followed redirects implicitly.                                                                          | Reject redirects and unexpected response endpoints; retain strict metadata-only projection and native validation.                                                   |
| Xbox result confidentiality   | Browser-visible OAuth state was also the secret used to retrieve/cancel an import.                            | Independent random values, one-use state, S256 PKCE binding.                                                                                                        |
| Xbox diagnostics              | Raw provider error bodies and malformed JSON/network errors could enter server logs.                          | Fixed operation/status errors only; no raw provider error details.                                                                                                  |
| Xbox transport                | Desktop accepted an arbitrary returned login URL and configurable unencrypted remote API endpoints.           | Validate the Microsoft authorization origin/path before displaying/opening it; require HTTPS except loopback development; reject redirects on account requests.     |
| Xbox browser response         | Account responses lacked explicit cache/referrer/frame restrictions.                                          | No-store, no-referrer, restrictive CSP, no unused refresh-token scope.                                                                                              |
| Dependencies                  | Published advisories affected Rust TLS/XML/pointer dependencies, backend HTTP packages and development tools. | Targeted compatible updates; patched Fastify requires address-based proxy trust, now restricted to the immediate private/loopback Azure peer.                       |

## Verified boundaries

Battle.net credentials, cookies, account IDs, subscription details and CD keys
are not in the native result contract, library persistence or backup contract.
Only game title IDs, localized game names and franchise identifiers leave the
account webview. Normal matching sends provider/game identifiers to the API.
Steam/local scans do not initiate account sign-in. Xbox tokens stay on the
backend; its desktop result contains game data and optional failure account labels.

The Windows native test uses synthetic cookies in isolated storage and verifies
private-mode rejection for a persistent profile, disabled messaging/host objects/
devtools/password saving/autofill, functioning script-result callbacks, cookie
clearing and preservation of the main profile. Unit tests exercise hostile URLs,
metadata projection, cancellation, PKCE, state/result separation and error
redaction. Neither credentials nor real cookie values were inspected for this review.

Validation completed:

- Desktop: 1,120 tests passed across 87 files; typecheck and production frontend build passed.
- Rust: 62 unit tests passed. The isolated native security test also passed when explicitly run; the local installation diagnostic remains excluded from the default suite.
- Backend: 118 tests passed; 39 PostgreSQL tests skipped because `PGTEST_URL` is not configured. Typecheck and build passed.
- Both repositories passed `git diff --check`.

After dependency updates, both workspace JavaScript audits report no advisories.
`cargo audit` reports zero vulnerability entries, with remaining informational
warnings for unmaintained upstream crates and Linux-only `glib` VariantStrIter
unsoundness (`RUSTSEC-2024-0429`); these are not silently ignored or represented
as a completely clean cross-platform audit.

## Limits and release follow-up

The pre-hardening Battle.net flow was exercised with a real login. The stricter
flow's session controls were exercised with the native synthetic test. Live MFA
and every federated provider have not all been retested; an unlisted login host
is intentionally blocked. A current Evergreen WebView2 runtime remains required.

Cloud proxy/access-log settings were not inspected or changed. Confirm OAuth
codes/state and result query strings are not retained there before deploying.
Backend fixes need their own deployment. No release, push or deployment is
implied by this local review. The main desktop CSP remains a broader hardening
opportunity; no production `dangerouslySetInnerHTML`/dynamic code execution sink
for account metadata was found. OS compromise, compromised identity providers,
browser zero-days and malicious replacement application builds are outside the
guarantees of these tests.

Reference guidance:
[Microsoft WebView2 security](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/security),
[Microsoft authorization code flow and PKCE](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow),
[Tauri capabilities](https://v2.tauri.app/security/capabilities/),
[Tauri origin-confusion advisory, already patched by the installed 2.11.2](https://github.com/tauri-apps/tauri/security/advisories/GHSA-7gmj-67g7-phm9),
[Fastify proxy-trust advisory](https://github.com/fastify/fastify/security/advisories/GHSA-3m5p-2c4r-xxw2).
