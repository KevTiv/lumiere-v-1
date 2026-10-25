# Harness key readiness — 2026-10-25

This status supersedes the September execution board for the bounded Mistral
pilot. It distinguishes code integration, disposable acceptance, deployment
provisioning, and real-provider admission.

## Combined Alpha release candidate

PR #266 combines merged #265 with #264's authorized display projections, table
mappings and seed evidence, and the server-issued setup lease workflow. The
immutable contracts pin is `v0.3.148` at
`5159f2191f19c594e6f7e7816bb7d331cce2266c`.

The chat-only pilot can explicitly disable embeddings and OCR. Disabled
adapters reject requests before provider I/O; startup does not initialize vector
collections or claim embedding jobs. Selected providers retain their readiness
checks. The full gateway suite passed 743 tests (eight existing ignored tests),
policy/auth suites passed 7 and 84 tests, five member mutation tests passed, and
the combined API compile check passed. Final-head hosted checks remain required.

Production role 4098, `Alpha AI setup (no permissions)`, was created through the
normal authenticated role form and read back with an empty permission list.
It is unassigned. No setup lease, superuser grant, AI service binding,
certification, model provisioning or paid provider call has started.

## Main integration on 2026-10-25

The branch now retains merged main through `712cd2c6`, including #249's current
Work-board, delegation and recovery fixes, #258's production layout repairs,
#260's currency and record labels, and #262's expense-authoring test correction.
The combined immutable contracts release is `v0.3.145` at
`b8ea146ebcbc75b9d45acf3f9f9fa682b8e351f6`, generated from application source
`cb72e325ab04b40a08dddfc34cb06e9d618c7f9c`. Its history continues v0.3.144,
adds embedding-job finalization and records the changed embedding request shape.
The consumer catalog includes AI migration phases 23–26; released migration 22
remains byte-identical.

Local integration checks passed 149 Python script tests, 24 provisioning/preflight
tests, 537 web unit tests, 24 focused chat/Kanban/currency tests, and the runtime
image and publisher orchestration checks. The existing production-publisher
workflow now validates PR heads without publishing registry images. Its
[populated upgrade run](https://github.com/KevTiv/lumiere-v-1/actions/runs/40193064361)
preserved every existing column in all seven tables through the actual publisher,
with data deletion disabled, and passed production provisioning checks.

Merge requires fresh hosted CI, P0 and production-upgrade validation for the final
pin; the PR records those results. Service configuration, worker certification
and promotion, real-provider settled-spend acceptance and deployed-alpha
acceptance remain release gates.

## Alpha report and operator lease closure on 2026-10-25

The alpha follow-up records each report analytics operation as an immutable,
run-scoped `analytics_snapshot` passage with the exact bounded result, including
empty results. Evidence metadata stays inside the existing privacy-filtered
artifact envelope. Both generated and reasoned answers must cover their complete
content with claims that select only their own run's observations. The existing
catalog, arithmetic, figure and independent semantic review checks still decide
admission; plain prose remains held for review. Report routing calibrates the
estimated attention probability separately from the confidence used by decision
admission.

The approved temporary operator lease is enforced in shared policy, native
profile resolution, API field access, admin checks, WorkOS session binding and
workflow realtime scope checks. Expired authority is rejected even if cleanup
has not run. These changes do not grant production access. The approved bootstrap
window has not started.

Local validation: the complete gateway suite passed 742 tests (eight existing
ignored tests); shared policy/auth suites passed 7 and 83 tests. API and module/tests compile checks and all 24 provisioning/preflight Node tests passed. The expired-operator reducer regression is included in disposable E2E setup. Hosted final-head
CI, deployed worker certification, independent skill promotion, provisioning and
live Mistral/GOV00 acceptance remain separate gates. Railway inspection in Dia
still found no source attached to the offline AI gateway; its Mistral key and
pilot manifest variable names are present. No live provider request was made.

## Setup membership follow-up

The existing advanced member form now has explicit company scope and a one-hour
setup option. The native member reducer chooses the issue/expiry timestamps and
copies only the reserved lease into a new profile. Replays preserve the original
expiry; existing profiles and expired leases cannot be silently replaced. This
creates a membership with the selected role, not a superuser or a login credential.
The approved operator uses a dedicated role with no permissions before the
separate, verified temporary administrator grant. The contract shape is unchanged.

Local checks passed the five member mutation tests, query-hooks/UI type checks,
and module/tests compilation. The same existing permissions reducer exercises
lease issuance, malformed/future/overlong rejection, replay and expiry behavior in
disposable E2E setup. Hosted acceptance and production execution remain pending.

## Historical local convergence on 2026-10-24

The isolated `codex/harness-gap-closure` branch combines #135, #136, #193,
#252–#254, #226 and #232. The published v0.3.140 source from #249 is a
contracts dependency: migration 22 stays byte-identical, and the AI index
upgrade uses phases 23–26. This local integration does not merge those PRs.

- Routed limits have one owner, inside durable spend admission. Only an
  explicitly rejected and zero-settled rate limit can permit bounded retry.
  Ambiguous dispatch, result recording or settlement still blocks all routes.
- Required GOV00 cannot skip missing or invalid agent provisioning. Successful
  acceptance now requires `completed`, an ordered durable trace and authorized
  Mistral economics with settled reservations. Reload reads the original run.
- Chat workspace and scope-isolation changes are integrated. The authenticated
  layout/keyboard suite covers 320/390/768/1440 pixels without provider calls.
  Its browser execution is a separate check from component tests and discovery.
- The embedding worker finalizes only its claimed job after confirmed vector
  persistence. The upgrade archives legacy document text and vector payloads
  privately and verifies exact tenant/company/payload matches. Compatibility
  columns remain until an audited retirement. Existing index rows remain unverified until canonical
  reconciliation; the archive cannot supply retrieval evidence.
- The existing Railway preflight now requires one AI replica, distinct service
  credentials, no owner token on the gateway, and direct Mistral transport.
- `provision-ai-harness.mjs` accepts `--env` with `AI_HARNESS_MANIFEST_JSON`.
  Placeholders and rolling model aliases are rejected. Credentials remain in
  environment variables. The provisioning job needs the owner token; the
  gateway must not receive it.

That initial embedding-request convergence published the immutable release
v0.3.141 at `fcfe7dff63a6f42b54e4dac2bf306f16e07eed9a`, generated from
application source `6d6e8eeb75b5cd2e5daa10c241c181accfa3b3bb`. It preserves the
published v0.3.140 baseline. The consumer pin, Rust archive, frontend package,
lockfiles and release assertions agreed. Live local generation passed the full
contracts drift comparison and release-manifest verification. At that point,
contracts `main` and annotated tag `v0.3.141` resolved to the verified release commit.
[Hosted Contracts CI](https://github.com/KevTiv/lumiere-contracts/actions/runs/40093161295)
passed for that exact commit, including offline generation, emitter tests,
Rust v2 contracts, TypeScript type-check/build and package validation. This
publishes contract artifacts; it does not deploy the application.

## Historical local acceptance after that convergence

- Gateway: **729 passed**, eight existing ignored tests. API and gateway binaries
  build against the v0.3.141 candidate. Codegen: **136 passed**, one existing
  ignored test.
- PostgreSQL migration suite: **30 passed**, with `C4_TEST_PG=1` and disposable
  local databases. The authored AI upgrade also passes exact archive/scope,
  quarantine, forced-mismatch rollback, current-projector adoption and partial
  legacy-shape rejection checks. Released migration 22 remains unchanged.
- Native module: embedding organization isolation, evidence provenance and
  document Wave D/OCR suites passed against the combined source.
- Frontend: **523 unit tests passed** and full TypeScript validation passed.
  Authenticated Chromium chat tests passed at 320/390/768/1440 pixels, plus
  authentication setup (**5 passed**), using a real local API, PostgreSQL and
  seeded SpacetimeDB module. This was a development server and made no provider
  requests. The shared helper now opens mobile navigation before the assistant.
- Provisioning: the exact script applied twice against the real disposable
  module and gateway, then read back `readyForKey: true`, with **zero billable
  calls**. This exposed and fixed the live SQL one-field Identity tuple encoding.
  Synthetic model IDs/prices and local credentials prove request/read-back
  compatibility only; they do not establish account access or reviewed prices.
- Operational Node CI suite: **40 passed**, including twelve provisioning tests.
  Reconstruction verifier: **10 passed**. Railway preflight shell suite passed.
- The full Python script suite was attempted on macOS. Its native-Linux ELF
  cache cases fail on this host, and the Kong YAML test cannot import PyYAML.
  This is not recorded as a passing full script suite.

The combined head still needs its own hosted CI/full P0 lane. GOV00 and the
billable smoke must run after real deployment configuration and tenant
provisioning. No completed local check replaces those gates.

## Integrated implementation

The earlier `codex/harness-key-readiness` branch combines main (`c4c83289`),
Phase 4 draft/protocol/recovery PR #135, reconstruction PR #136, and run-history
PR #193. Their original branches remain intact. Main already includes spend
recovery #190, trusted envelopes #191, legacy retirement #192, revocation #133,
and spend safety #134.

Review: [integration PR #255](https://github.com/KevTiv/lumiere-v-1/pull/255).

Additional corrections in this branch:

- Immutable profile deadlines apply to provider I/O inside the durable spend
  boundary. A timeout records `outcome_unknown` and retains reserved spend.
- Profile concurrency is shared across runs in one gateway process, scoped by
  organization and immutable profile version. Queue deadlines occur before
  spend admission. These permits are per replica; the database still owns the
  shared monetary ceiling.
- Unknown dispatch, failed result recording/settlement, and existing durable
  attempts cannot trigger router retry/fallback under a different request key.
- Explicit, repeatable provisioning creates a separate non-default Mistral
  agent, primary/review profiles, policy, current-period budget/price snapshots,
  built-in calibration, and company-specific report-analysis policy binding.
  It preserves existing settings, counters, and reviewed overrides. No API key
  is needed for these operations, and no provider call is made.
- The company skill also binds its default agent. Ordinary report-analysis
  requests use that agent without replacing the organization's default or
  overriding an explicit agent/persona selection.

## Earlier acceptance evidence (before local convergence)

- The integrated gateway suite passes **716 tests**, with eight existing ignored
  tests. Profile queue/deadline/isolation regression tests are included.
- Provisioning has nine deterministic tests for idempotence, scope/conflict
  rejection before writes, ambiguous-response handling, dedicated spend reads,
  catalog validation, durable smoke settlement, and payload compatibility with
  the immutable generated contracts. CI runs these tests.
- Read-only runtime readiness uses the canonical release, skill, model-policy,
  calibration and spend readers. HTTP fixtures exercise the actual resolvers
  for a configured pilot and eight configuration/authorization failure cases.
- The router regression covers decision, review, reasoning and generation with
  retries and a fallback configured: an ambiguous dispatch makes exactly one
  provider attempt/reservation and stops.
- The reconstruction verifier's ten tests pass.
- Full web TypeScript, focused harness UI tests, all 140 script tests, changed
  Rust formatting, and trusted-route boundary lint pass locally.
- The pre-existing disposable Phase 4 evidence is in
  `docs/evidence/aih-phase4-disposable-2026-10-23.json`: two-client budget/claim
  races, ambiguous-timeout restart, and reconstruction without redispatch.
  Those instrumented-provider results are not real Mistral admission.
- Original PR #135 CI and E2E are green. #136's failing P0 shard is the bank
  fixture selecting a supplier instead of a customer; #193 includes the fixture
  correction, and its current CI/E2E are green. The combined head must still
  pass its own hosted gates.

## Operator setup

Use `node scripts/provision-ai-harness.mjs --plan manifest.json` to review the
exact immutable profiles/policy without network access. The manifest format is:

```json
{
  "version": 1,
  "organizationId": 1,
  "companyId": 1,
  "agentName": "mistral-pilot",
  "policyKey": "mistral-pilot",
  "policyVersion": 1,
  "currency": "USD",
  "monthlyLimitUnits": 1000000,
  "priceReviewedAt": "2026-10-23",
  "primary": {
    "model": "ACCOUNT_VISIBLE_PRIMARY_MODEL",
    "maxTokens": 2048,
    "contextWindow": 32000,
    "timeoutMs": 60000,
    "maxConcurrency": 1,
    "inputUnitsPer1k": 1,
    "outputUnitsPer1k": 1
  },
  "review": {
    "model": "ACCOUNT_VISIBLE_DISTINCT_REVIEW_MODEL",
    "maxTokens": 2048,
    "contextWindow": 32000,
    "timeoutMs": 60000,
    "maxConcurrency": 1,
    "inputUnitsPer1k": 1,
    "outputUnitsPer1k": 1
  }
}
```

**The IDs, models, and prices above are placeholders, not a deployable pricing
configuration.** Replace IDs with the selected tenant/company, choose exact
account-visible models, and review their current rates. Amounts are millionths
of the currency; prices are per **1,000** tokens. Budget 1,000,000 is one unit
of currency. Do not use synthetic prices to claim monetary admission.

For `--check` and `--apply`, supply the existing server environment:
`STDB_HOST`, `STDB_MODULE`, `STDB_SERVER_TOKEN`, a distinct registered
`AI_SPEND_READ_STDB_TOKEN`, `AI_GATEWAY_URL`, and
`LUMIERE_AI_GATEWAY_INTERNAL_SECRET`. Keep secrets out of the manifest and
command arguments. Origins must use HTTPS, Railway private HTTP, or loopback.
The target must already have a reviewed active report-analysis skill release
and the canonical gateway/service grants. This tool never manufactures a
certificate, overrides explicit disablement, or switches the default agent.

```sh
node scripts/provision-ai-harness.mjs --check manifest.json
node scripts/provision-ai-harness.mjs --apply manifest.json
node scripts/provision-ai-harness.mjs --check manifest.json

# In an approved private setup job, supply the reviewed JSON as one variable:
node scripts/provision-ai-harness.mjs --plan --env
node scripts/provision-ai-harness.mjs --apply --env
node scripts/provision-ai-harness.mjs --check --env
```

`--check` is read-only and exits nonzero when setup is missing. Once the stored
configuration matches, it also calls the internal-secret-protected
`/v1/harness/governed/readiness` endpoint to verify the deployed gateway's own
release/policy/profile/bootstrap/spend resolution and selected database.
`--apply` reads back all provisioned state; an uncertain mutation stops instead
of retrying.
It does not reset spend or replace an existing incompatible policy. Re-run for
each billing period to provision that month's budget without resetting history.

After setting `MISTRAL_API_KEY` on the gateway, leaving direct transport enabled
(`KONG_LLM_URL` unset), and permitting `api.mistral.ai` egress:

```sh
# Non-billable account/model/tool/context validation; key is read from environment.
node scripts/provision-ai-harness.mjs --verify-key manifest.json

# Explicit billable acceptance through the ordinary authenticated BFF.
# AI_HARNESS_WEB_URL and an authorized AI_HARNESS_SESSION_COOKIE are required.
node scripts/provision-ai-harness.mjs --smoke manifest.json
```

Ordinary report-analysis requests use the company-bound agent when no explicit
agent/persona is selected. The smoke pins the returned `agentId` explicitly and requires a fully
settled run, at least two durable trace steps, and matching provider-attempt and
reservation usage. It prints IDs/counts only. Neither catalog access nor a green
health endpoint establishes this acceptance. An uncertain request requires run
inspection/reconciliation before another smoke.

## Remaining external gates

Deployment configuration has not been provisioned from this environment. The
Railway connector repeatedly returned an authentication retry response, and
this environment has no deployment/service credential bindings. Consequently
tenant IDs, reviewed model pricing, service grants, active release, and runtime
deployment still require verified access before claiming the key is the sole
remaining operator task.

No real Mistral key/call, production rollout, or existing deployed PostgreSQL
migration is certified here. Cross-provider funding, multi-account/region
provider instances, new skill expansion, and WorkPrograms are separate
admission scopes; the initial pilot deliberately uses one Mistral account with
no automatic retries, fallbacks, shadows, or consequential operations.
