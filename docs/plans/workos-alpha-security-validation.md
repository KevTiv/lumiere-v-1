# WorkOS alpha security implementation and validation

This local patch introduces hosted WorkOS authentication while keeping database
credentials inside the Rust API. It adds explicit alpha identity approval, guards
tenant creation in SpacetimeDB, repairs native invitation acceptance, and closes
public native signup and recovery during alpha. No deployment, provider settings,
PR comments, or account migration were performed.

## Security boundaries

- WorkOS access JWTs must pass trusted per-client signature, issuer, lifetime,
  canonical verified email, immutable subject, explicit admission and live
  provider-session checks. Existing email accounts are never linked implicitly.
- Browser requests use AuthKit refresh through Next.js and the private Rust API.
  The provider bridge returns identity metadata, never the database token.
- Both tenant-creation reducers share a default-closed founder guard. Prior
  membership, including inactive membership, prevents another founder bootstrap.
- Invitation creation validates the inviter and target role in the organization,
  enforces bounded expiry and quotas, and uses a narrowly permitted server path.
  Existing native accounts must prove their password before credential release.
- Invitation claims precede membership grants. Claim reuse is rejected. The
  active-member cap is checked atomically at membership insertion/reactivation.
- Hosted realtime retains direct Rust WebSocket upgrades. A same-origin endpoint
  creates a narrow HTTP-only provider-token cookie; Rust requires the exact
  browser Origin. Sockets end within 60 seconds or JWT expiry and revalidate on
  reconnect. Closing a socket also disconnects its SDK subscription.

## Validation completed

- Production module `cargo check --manifest-path spacetimedb/Cargo.toml
  --no-default-features --offline`: passed, with existing unrelated warnings.
- API `cargo check -p api-server --offline --locked` and the corresponding
  `--tests` check: passed using one build job, no incremental compilation and
  `CARGO_PROFILE_DEV_DEBUG=0`.
- Five founder-policy tests and compiled production/development policy probes:
  passed. Two membership-cap boundary tests: passed.
- Six tests extracted from the current WorkOS helpers into an isolated Rust
  harness: passed. They execute real RSA verification and adversarial claims,
  admission matching, founder scope, Origin and socket lifetime checks.
- Three current-source native authentication tests in an isolated Rust harness:
  passed, including real bcrypt verification, rejection of wrong passwords and
  SSO-only credentials, and bounded email/password input.
- Three focused recovery/input checks: passed. Native recovery remains disabled
  because these checks do not establish database-token revocation.
- Frontend `node --import tsx --test next-config.test.ts
  lib/api-server-forward.test.ts lib/api-session.test.ts
  lib/workos-security.test.ts lib/server-query.test.ts`: passed. This covers
  refreshed credential forwarding, explicit credential precedence, CSRF denial,
  callback cleanup, return URLs, realtime handoff and runtime callback settings.
- Kong render test, three private-release policy tests, YAML parsing, shell
  syntax and `git diff --check`: passed.
- Fresh read-only backend and frontend reviewers identified a membership-cap
  race, rewrite bypass of the browser handoff and incompatible WebSocket
  forwarding. Their followup reviews confirmed the fixes and reported no further
  concrete bypass in the reviewed paths.

Full frontend type checking reports 81 diagnostics in accounting/manufacturing
contract consumers and missing Geist font declarations. The starting revision
was checked separately with the same installed dependencies: its diagnostics
match the final patch after normalizing checkout paths, output order and shifted
layout import line numbers. This patch does not clear that existing release gate.

The initial default-debug API check/test attempts were killed while compiling the
large generated contracts crate. The lower-memory API and test-target checks
subsequently passed; a full API test executable was not run. The isolated Rust
harnesses execute actual source helpers but do not exercise the complete HTTP,
PostgreSQL or provider flow.

## Remaining release work

Follow [WorkOS alpha admission](../PRODUCTION_DEPLOY.md#workos-alpha-admission)
for provider settings, exact identity mappings, founder-policy builds and private
network requirements. Existing native database tokens are not revoked merely by
switching the application to WorkOS. Native recovery stays disabled. Hosted
invitation creation and identity-bound acceptance are implemented for identities
already explicitly approved for the local and provider organizations. The invite
handoff is HTTP-only and token-free through WorkOS redirects. Automatic approval,
legacy-account linking and atomic cross-reducer invitation acceptance are not
implemented; a failed mid-flight invitation must be inspected and reissued by an
operator.

An isolated stack must still exercise real hosted sign-in, approved founder
bootstrap, membership removal, cross-tenant denial, refresh, logout, provider
outage and WebSocket reconnection. No live WorkOS or full-stack acceptance result
is claimed. JWKS rotation can temporarily deny a valid new signing key until the
five-minute cache expires; open sockets recheck revocation within 60 seconds.

## Follow-up WorkOS invitation slice (unverified live)

- Added hosted-only UI and server-side invite handoff; bearer invitation tokens
  are not serialized into WorkOS state, rendered pages or browser storage APIs.
- Provider-verified accepted identity must match the invite email and the
  admission-scoped local organization. Session bridge never exposes STDB tokens.
- Existing administrator-issued invite reducer and role/member-cap validations
  remain authoritative. Replay is denied by the invite claim reducer.
- **Not an atomic multi-reducer transaction:** failed grant/bind after claim
  requires inspection and reissue. A contract-bearing atomic command is future
  code work and requires a pinned contracts release.
- Tests cover token sealing/tampering/expiry, frontend routing and hosted
  organization matching. Live provider/browser acceptance is still required.


## Hosted lifecycle completion

The ordered invitation handoff described above is superseded by the atomic
`accept_user_invite` operation and trusted retry receipts. Effective primary and
additional roles, profile editing, explicit account linking, role retirement and
validation requirements are documented in [the lifecycle report](workos-lifecycle-completion.md).
Live provider acceptance remains a separate release requirement.
