# Harness key readiness — 2026-10-23

This status supersedes the September execution board for the bounded Mistral
pilot. It distinguishes code integration, disposable acceptance, deployment
provisioning, and real-provider admission.

## Integrated implementation

The `codex/harness-key-readiness` branch combines current main (`c4c83289`),
Phase 4 draft/protocol/recovery PR #135, reconstruction PR #136, and run-history
PR #193. Their original branches remain intact. Main already includes spend
recovery #190, trusted envelopes #191, legacy retirement #192, revocation #133,
and spend safety #134.

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

## Acceptance evidence

- The integrated gateway suite passes **713 tests**, with eight existing ignored
  tests. Profile queue/deadline/isolation regression tests are included.
- Provisioning has eight deterministic tests for idempotence, scope/conflict
  rejection before writes, ambiguous-response handling, dedicated spend reads,
  catalog validation, and durable smoke settlement. CI runs these tests.
- The reconstruction verifier's ten tests pass.
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
```

`--check` is read-only and exits nonzero when setup is missing. `--apply` reads
back all provisioned state; an uncertain mutation stops instead of retrying.
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

Use the returned `agentId` explicitly for the pilot. The smoke requires a fully
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
