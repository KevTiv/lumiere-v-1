# Harness key readiness — 2026-10-24

This status supersedes the September execution board for the bounded Mistral
pilot. It distinguishes code integration, disposable acceptance, deployment
provisioning, and real-provider admission.

## Local convergence on 2026-10-24

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
  privately, verifies exact tenant/company/payload matches, then retires the
  duplicate columns. Existing index rows remain unverified until canonical
  reconciliation; the archive cannot supply retrieval evidence.
- The existing Railway preflight now requires one AI replica, distinct service
  credentials, no owner token on the gateway, and direct Mistral transport.
- `provision-ai-harness.mjs` accepts `--env` with `AI_HARNESS_MANIFEST_JSON`.
  Placeholders and rolling model aliases are rejected. Credentials remain in
  environment variables. The provisioning job needs the owner token; the
  gateway must not receive it.

The embedding request contract changes. The published immutable release is
v0.3.141 at `fcfe7dff63a6f42b54e4dac2bf306f16e07eed9a`, generated from
application source `6d6e8eeb75b5cd2e5daa10c241c181accfa3b3bb`. It preserves the
published v0.3.140 baseline. The consumer pin, Rust archive, frontend package,
lockfiles and release assertions agree. Live local generation passes the full
contracts drift comparison and release-manifest verification. Contracts `main`
and annotated tag `v0.3.141` both resolve to the verified release commit.
[Hosted Contracts CI](https://github.com/KevTiv/lumiere-contracts/actions/runs/40093161295)
passed for that exact commit, including offline generation, emitter tests,
Rust v2 contracts, TypeScript type-check/build and package validation. This
publishes contract artifacts; it does not deploy the application.

## Executed local acceptance after convergence

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
