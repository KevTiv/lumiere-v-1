# Mistral alpha setup on Railway

For the current idempotent provisioning command and Railway environment
manifest, use [Harness key readiness](../plan/harness-key-readiness-status.md).
The older release/identity manifest below remains an optional read-only audit;
it is a different format from the provisioning manifest.

This procedure prepares one organization for the governed `report_analysis`
pilot. It does not grant alpha admission or deploy a release. Use one gateway
replica: the profile concurrency limit is process-local, not a distributed
Railway quota. Keep retries,
fallbacks and shadows disabled. Keep all profiles on Mistral. The current spend
reducers reject a different provider from the agent's provider.

## Prepare a reviewed manifest

Copy `infra/railway/mistral-alpha-manifest.example.json` to a private working
file. Replace every placeholder. The example deliberately fails validation.
Record the exact application commit, pinned contract version, registered
certification runtime digest, Railway project/environment/region/module,
organization, company, agent, skill release and three verified service
identities. The tool records release provenance; it does not compare it with
the live deployment.

Use exact account-visible model IDs. Rolling `-latest` aliases are excluded
from this bounded pilot. Declare decision, reasoning, generation and review
profile refs. Use a different model for review. A stricter admitted policy that
requires a different review **provider** cannot use this same-provider pilot;
do not weaken that policy to enable it.

Review every price. Rates are integer millionths of the selected currency
**per 1,000 tokens**. For example, a published rate of EUR 2 per million tokens
maps to 2,000 microunits per 1,000 tokens. This is a unit example, not a provider
price. `limitMicrounits` is the monthly budget in the same currency units.
Use the current UTC billing period for checks.

```sh
node scripts/mistral-alpha-preflight.mjs plan /private/path/pilot.json
```

`plan` has no network access and does not read credentials. It emits the
reviewed profile, policy, budget and bootstrap inputs. The output uses Rust
source parameter names. It is **not** an HTTP/SATS payload: serialize parameters
through the matching released contracts before any operator applies them.
Unknown manifest fields are rejected to keep credentials out of saved plans.

There is no automatic apply mode. `configure_ai_spend` appends an immutable
price snapshot each time it runs. First read the current budget and model price
snapshots with the dedicated spend reader. If the configuration already matches,
retain the verified snapshot IDs. Apply only reviewed missing or changed
configuration, then read back its exact IDs and values. Do not identify snapshots
by date, arbitrary row order or an assumed newest row. Changed profile/policy
content requires a new immutable version; never rewrite an existing version.

## Provision service identities and scope

Use existing identity owners. `scripts/lib/production-identity-bootstrap.mjs`
already defines separate AI writer, `ai_spend_reader` and certification executor
identities for the Doppler production path. That path mints and stores secrets
when explicitly applied; do not run it merely to inspect setup. The Railway
private-network `railway-bootstrap-service-identities.mjs` does not currently
register AI identities. Its success marker does not establish AI readiness.

Before applying the reviewed plan, an authorized operator must:

1. Confirm three distinct non-owner identities. Register the spend reader's
   `ai_spend_reader` binding for the exact organization with the existing
   `register_cold_tier_service_identity` owner.
2. Grant the writer the reviewed organization-scoped `ai_spend/reserve` and
   `ai_spend/settle` permissions plus the existing admitted runtime permissions.
   Preserve domain authorization and actor-bound execution. Do not grant owner
   or superuser access as a setup shortcut. Recovery/reconciliation permissions
   remain separately governed.
3. Register the certification executor's exact identity and runtime digest with
   `register_ai_skill_certification_runtime_profile`. Verify it is the active
   organization profile.
4. Confirm company ownership/membership, active Mistral agent, all selected models
   in its allowlist, and compatible agent/profile context and output limits.
5. Register reviewed immutable profiles, then policy, then any missing/changed
   budget and price configuration through their existing reducer owners.
6. Confirm `report_analysis` has the intended active certified release and
   reviewed capability grants. Call the internal governed bootstrap with the
   emitted `orgId` and `intelligencePolicyRef` only after the policy exists.

The preflight does not grant permissions, register identities, create an agent,
certify a skill or perform these writes.

## Check server configuration and optional metadata

Run in the AI gateway's server environment, with credentials supplied by the
existing secret manager. Do not pass credentials as command arguments or write
them in the manifest. Required names are `MISTRAL_API_KEY`, `STDB_TOKEN`,
`AI_SPEND_READ_STDB_TOKEN`, `AI_CERTIFICATION_STDB_TOKEN`,
`AI_EXECUTION_ENVELOPE_KEY`, `LUMIERE_AI_GATEWAY_INTERNAL_SECRET`,
`AI_CERTIFICATION_RUNTIME_HASH`, `STDB_HOST`, `STDB_MODULE`,
`LUMIERE_ENV=production` and `LUMIERE_BIN=gateway`.

```sh
node scripts/mistral-alpha-preflight.mjs check /private/path/pilot.json
node scripts/mistral-alpha-preflight.mjs check /private/path/pilot.json --catalog --identities
```

The default `check` is offline. `--catalog` sends one authenticated GET to the
fixed `https://api.mistral.ai/v1/models` origin. It checks declared model IDs,
chat/tool capabilities and context limits. `--identities` sends only SQL SELECT
requests to the configured STDB origin. It compares server-verified identities
with the manifest and reads the declared budget through `ai_spend_budget_read`
with the dedicated reader. An empty scoped result fails. Neither option calls
a reducer or a generation endpoint. Redirects are rejected, requests have a
10-second deadline, and response bodies/transport details are suppressed on
errors. Output never includes credential values.

Writer reserve/settle grants, certification registration, agent/policy/skill
bindings, region/image/schema alignment and real completion remain explicit
operator checks. A passing preflight always reports `deploymentAcceptance=false`.
It does not establish token least privilege from successful authentication.

Keep `KONG_LLM_URL` unset for direct Mistral. `EMBEDDING_PROVIDER` selects indexing,
not chat. For the approved chat-only pilot, set `EMBEDDING_PROVIDER=disabled` and
`VISION_PROVIDER=disabled`. These selections reject embedding/OCR requests,
skip collection initialization and leave queued embedding work unclaimed. Their
unused providers and vector collections are not readiness requirements. Existing
provider selections still require their dependencies. Changing embedding space
requires its own collection migration and reindex proof.

## Deploy and prove the pilot

Restore Railway authentication before taking a live inventory. Use the existing
production preflight and ordered stack release with explicit AI enablement.
Verify schema publication, PostgreSQL migration completion, matching immutable
artifacts, private services, Qdrant and configured readiness probes. See
`docs/PRODUCTION_DEPLOY.md` and `.github/workflows/release-railway-stack.yml`.

After the release is approved and deployed, run the authenticated dedicated
`/api/ai/skills/report-analysis` BFF with synthetic ERP data. Record the exact
actor/company, skill release, provider/model, durable run/steps, provider attempt,
evidence and settled spend. Prove denied access, revoked scope, exhausted budget,
cancellation, reconnect and ambiguous-outcome recovery without duplicate
dispatch. `/health/ready`, catalog metadata, deterministic `low_stock`, and a
passing offline preflight do not establish this acceptance.

Validation for this tooling is `node --test scripts/tests/test_mistral_alpha_preflight.mjs`.
Live Railway/Mistral checks have not run in this task. Railway requires
reauthentication; credentials and a controlled target are not provisioned here.
