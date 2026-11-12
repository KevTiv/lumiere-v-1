# Persistent platform operator for alpha activation

Status: locally validated and independently reviewed release candidate;
**no production enrollment applied**.

## Explicit authority decision

KevTiv requested both retained tenant AI setup access and permanent
platform-superuser authority for the existing non-human server operator. This
supersedes the time limit and automatic revocation in the
[historical temporary bootstrap](../../infra/railway/pilots/alpha-org-admin-bootstrap.md).
It does not authorize changing human accounts, making the AI spend writer a
superuser, increasing the existing USD 5 allowance, or manufacturing AI
certification evidence.

Platform-superuser authority is broad application administration. The AI
allowance limits paid AI admission; it does **not** constrain that authority.
The operator remains privileged until an explicitly approved revocation. Chat
and tenant setup controls do not acquire a one-hour lifetime.

## Verified starting state

Private Railway readback after the successful deployment of merged #406 found:

- Existing `STDB_SERVER_TOKEN` principal:
  `c2006e9ff9e43cebc0436160b5a1b3a21dea399853183df8b215e5b986ca545c`.
- Its existing native profile and membership are both row **4098**, organization
  **1**, company **1**, with the same expired reserved bootstrap lease. Both
  physical active flags are false; the profile superuser flag is false.
- Canonical profile:
  `p_e13d3a2735c0740b9dba9b83e82685eae711a7a1d4b9951d`, bound to that exact
  identity, inactive/non-superuser, with **zero credential rows**.
- Its active, empty, non-inherited role has six other **inactive historical**
  memberships and no role/user permission conflicts or active supplemental
  assignments. Preserve that history; reject other current active members
  rather than deleting history or creating/rebinding a role.
- No active native platform superuser exists. The no-application-write
  `check_ai_agent_activation` call rejected the current operator.
- Target AI organization/company **4097**, agent **2**, policy
  `mistral-mugisha-usd5@1` and the November USD **5,000,000-microunit** pool remain
  unchanged: **9,060 settled, zero held**.

These are operator selectors, not constants to embed in enrollment logic.
Resolve and verify them again immediately before writes. Credentials remain in
Railway runtime environment variables and never enter command arguments,
reports, manifests or source.

## Chosen path

There is no existing production reducer that safely enrolls a persistent
operator when all prior platform authority is inactive. Dev-only promotion,
renewing an expired lease, or changing lease validation is not a valid path.
SpacetimeDB 2.8.2 SQL supports scalar DML but cannot construct the Option/sum
value needed to change native profile metadata.

Add one **private, default-deny native enrollment command**, backed by exact
deployment policy. Keep existing profiles as authority records rather than
introducing another grant table or a second authority flag.

### Deployment-owned policy

`LUMIERE_PERSISTENT_PLATFORM_OPERATOR` is a public, non-secret deployment
configuration with exactly four fields:

```text
<64-hex-identity>:<organization-id>:<company-id>:<approval-reference>
```

The production publisher compiles this policy into the native artifact. It is
part of the artifact cache fingerprint; changing a Railway runtime variable
cannot change an already-built module's authority. Empty/invalid policy denies
enrollment. CI/schema extraction defaults to no enrollment authority.

The final publisher image is also checked against the downloaded WASM digest,
its OCI module label and the contained module bytes. A source-SHA image with
different compiled policy must fail closed, not be reused or retagged. Changing
an already-published revision's build policy requires a new tested source
revision and coherent release.

The native command takes only an `apply` boolean. Caller identity, organization,
company and approval reference come from authenticated sender plus compiled
policy—not caller-supplied targets, roles or privilege flags.

### Private operator workflow

The private Rust `api-server platform-operator` command uses the existing
runtime `STDB_SERVER_TOKEN` and `PG_*` environment. It adds no HTTP route,
credential, password or WorkOS login.

This remains a **non-interactive operator**. Both native-backed API session
resolution and canonical PG interactive-auth checks reject its reserved
persistent marker, including malformed or unknown versions. The operator's
permanent authority is enforced by native reducers; projected PG flags are not
a second browser/session grant. Human tenant setup access is separate and
unchanged. The CLI accepts only private/loopback SpacetimeDB origins and never
follows authenticated redirects.

1. `--plan` / `--check` inspect the exact existing native/canonical binding,
   default membership/company, original bootstrap metadata and dedicated empty
   role with no other active member (inactive history is preserved). Reject
   duplicate bindings, ordinary profiles, credentialed identities,
   foreign scope or conflicting enrollment. Invoke the native `apply=false`
   probe before any write; an environment value alone grants nothing.
   Existing authentication callbacks may advance only `last_login` and
   `updated_at`; those server-owned bookkeeping fields are not enrollment
   effects. Privilege flags, identity, metadata, membership, settings, role and
   enrollment audits remain exact.
2. The native `apply=true` command accepts only the reviewed recovery origin:
   the exact existing profile is physically inactive and not a superuser, the
   membership is inactive, and both still have the same valid bootstrap-origin
   lease. Mixed or active bootstrap states reject instead of being normalized.
   It transactionally activates both rows, converts their metadata to matching
   persistent enrollment state, grants the profile's permanent superuser flag,
   preserves unrelated values and appends authenticated native audit evidence.
   No scalar SQL reactivation or metadata patch is used.
3. After native success and readback, update only the matching existing
   canonical PG profile in a transaction. Revalidate its opaque binding and
   absence of credentials; preserve unrelated fields. Use the native persistent
   state as projection data, not an invented receipt or generic upsert.
4. Require fresh both-store readback before reporting completion. A failed PG
   projection is incomplete and resumable; a native write with uncertain
   outcome stops for inspection, never a blind retry.

Native and PG writes are not a distributed transaction. If successful fresh
native reads confirm revocation after projection, repair only this enrollment's
matching PG flags downward under a row lock. Preserve metadata/unrelated
fields, and never overwrite a concurrently replaced projection. A native
transport failure is not revocation evidence and must report incomplete
verification. Interactive marker denial—not a timing-sensitive final read—is
the boundary that prevents stale PG flags from restoring operator authority.

Native SQL cannot guard an update with equality on Option metadata either.
Keeping recovery in one typed reducer avoids a race where an unguarded scalar
membership update could otherwise reactivate a concurrently revoked persistent
operator. The compiled enrollment policy is the explicit new authority for this
one-time recovery; the old lease itself grants no new authority.

An exact already-enrolled active/superuser replay is a no-op. Revoked,
non-superuser or inactive **persistent** records must reject: this enrollment
command cannot silently regrant authority after revocation. The original
bootstrap lease checks and nonrenewal rules remain unchanged for everyone else.

## Required validation and release

- Shared parser: strict identity/scope/approval, default-deny, malformed and zero
  values rejected.
- Persisted native: no-write probe; exact inactive-bootstrap recovery; mixed or
  active bootstrap apply rejected; enrollment preserving profile/membership/role;
  audit count and retry; unauthorized,
  duplicate, foreign, ordinary/credentialed and revoked cases rejected.
- Private CLI: no writes before native policy probe; no native SQL writes;
  uncertain-outcome stop; native-before-PG ordering; no upsert; repeatable PG
  projection; both-store verification; confirmed-revocation compensation;
  non-interactive stale projections; no secrets or authenticated redirects.
- Isolated PostgreSQL and local SpacetimeDB tests, canonical generation,
  internal/denied exposure, operation-history revision, deployment policy
  fingerprint and independent security review.
- New immutable contracts publication and coherent reviewed backend/module
  deployment before the private enrollment command is used.

Shared authentication source changes also require fresh immutable source
versions: chat/forms/action drafts now default to `1.0.1`, Finance reviews to
`1.0.5`. Discover hashes from the served build and re-certify; no previous
certificate is rewritten or treated as live-provider acceptance.

Neither a successful build nor this document establishes production operator
authority. Do not use a development seed or manually mint an active profile to
close the gate.

### Executed local evidence

All runtime evidence below uses isolated loopback services and synthetic
principals, not production credentials or provider calls.

| Check | Result |
| --- | --- |
| API library suite, locked/offline | 1,023 passed; 5 prerequisite-dependent tests ignored |
| Gateway binary suite, locked/offline | 1,013 passed; 9 prerequisite-dependent tests ignored |
| Shared policy / authentication / client suites | 15 / 94 / 18 passed |
| Code generation, including normally ignored parity tests | 148 passed |
| Build fingerprint, deployment policy and publisher payload tests | 27 passed |
| Isolated PostgreSQL projection regression, explicitly run with `--ignored` | Passed: projection, preservation, bounded lock waits, replay, confirmed-revocation compensation, unavailable-native behavior and changed-metadata protection |
| Persisted native suites | Core permissions, AI owner configuration and AI spend recovery passed |
| Production-compiled native + PostgreSQL + actual private CLI proof | Passed: default-deny/wrong-principal rejection, plan/check/apply/check/replay, two exact audits, administrative authority and revoked-state rejection |
| Independent final security/source review | No remaining concrete blocking findings |

The full proof is repeatable with
`scripts/test-persistent-platform-operator.py --development-wasm <local-development-wasm> --api-binary <local-api-server>`.
It creates isolated fixtures, upgrades them to the production-configured
module, invokes the real CLI, and checks preserved budgets, history, roles,
credentials and business fields. It restores the prior local module artifact
and stops its temporary services. Synthetic policy never becomes production
deployment configuration.

The candidate has 1,531 canonical operations; the new enrollment operation has
only a boolean parameter and denied generic exposure. No table or durable DDL
change is introduced. Ignored tests are not acceptance evidence; the new
PostgreSQL regression was executed separately as recorded above.

Remaining gates are the immutable contracts release, clean-head CI, reviewed
backend/module deployment with the approved production policy, and fresh
private enrollment/readback. None of this local evidence establishes live
Mistral provider access, successful indexing, a cited chat answer, settled
production spend or full alpha acceptance.

## Provisioning after enrollment

Retained tenant AI setup controls require no promotion of the human tenant
owner. Once operator enrollment is verified, finish the existing
[Mistral activation workflow](../guides/mistral-alpha-activation.md): exact writer
registration, reviewed embedding rate, bounded infrastructure catalog,
independent current-source releases/certificates/grants, capability/binding
reconciliation, authorized indexing and signed-in cited-chat/spend acceptance.
Keep agent 2 and its existing pool/history; omit OCR.

Permanent administrator access is not an AI execution certificate. Current
production source admission, empty indexes and missing metering/service
prerequisites remain blockers until their own readbacks pass.

Partially relational
