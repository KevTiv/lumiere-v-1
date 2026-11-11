# Consolidated alpha AI activation candidate

Status: **locally validated source candidate; production activation blocked**.
Base: `e2b8e56c2`, after merged activation plan #404 and company-scope fix #405.
This record does not certify a production provider call, settled production
spend, or a signed-in end-to-end tenant workflow.

## Scope and tenant experience

Target selectors are organization **4097**, company **4097**, existing agent
**2** (`mistral-mugisha-usd5`) and policy **`mistral-mugisha-usd5@1`**. Resolve
them against live data before a write; they are not application defaults.

The tenant-facing goal is to open chat and use an approved default. Provider
credentials, model profiles, query/index embeddings, metering, service
identities and source certificates are platform duties, not tenant setup tasks.
The new allowlist operation is an operator repair primitive, **not** a completed
per-turn model picker. A future picker must select an approved company/policy
profile without rewriting another conversation's agent or creating another pool.

Included source repairs:

- Intent-shaped, audited, idempotent model and embedding-action toggles on the
  existing agent, including delegated company scope and legacy-entry removal.
- Native no-application-write activation authority probe, deployed signature
  verification, explicit reviewed capability additions, prospective inspection
  before mutation, preservation readback and stop-on-uncertain-outcome behavior.
- Binding setup distinguished from execution readiness, with consistent
  company-setup permissions at BFF, gateway and reducer boundaries.
- Typed sanitized retrieval/source-unavailable responses through JSON/SSE
  HTTP failures and the client; no healthy-empty answer for failed retrieval.
- Source-bound certification adapters for chat, form suggestions and action
  drafts using their shared production executor/parsers/admission. RAG uses
  exact immutable grant/passage transcripts and both actual release rechecks.
- One fail-closed tenant-first catalog resolver, including disabled local
  shadows and ambiguous company configurations. Current-source checks before
  new generation runs and each paid generation/query-embedding/review attempt.
- Invalid generated action batches fail before draft persistence; paid model
  output is never replaced with an arbitrary first-catalog heuristic proposal.

OCR/vision, external research, unbounded backfill, automatic business effects,
new credit, a second pool, payment cutover and future model selection are not
added. Other declared non-OCR cohorts keep their independent release and live
acceptance gates; route admission or a catalog entry alone never proves them.

## Relationship and mutation preservation

| Relationship/input | Authority and semantics | Evidence boundary |
| --- | --- | --- |
| Agent → organization/company | Load the existing row; organization equality and delegated company checks; shared or exact-company agent accepted by provisioning | Native persisted positive/negative scenarios plus operator tests; production row not changed |
| Model/action membership | Exact operator intent; validate additions; remove only the exact non-selected entry; absent removal/addition is idempotent | Audits only on actual changes; entire agent configuration compared |
| Company binding → agent/policy/skill | Existing scoped rows and exact immutable policy/source; disabled/custom conflicts block | Operator structural inspection and readback tests; no invented catalog/certificate IDs |
| Catalog → active version/source | Local row shadows global even when disabled; exact version/skill/org identity and compiled source | Actual local SQL mock-server resolver tests; missing, stale, ambiguous, foreign and revoked cases reject |
| Reservation/attempt/usage → agent/pool/run | Preserve existing stored values; no budget/funding inputs in capability operations | Full BSATN before/after snapshots of seven persisted rows: budget, generation price, meter price, reservation, accepted provider attempt, usage and run |
| Passage → current version/source/grant | Exact actor/company scope; initial and both release-time reads consumed in order | Real admission code with immutable synthetic transcripts; production provenance explicitly not claimed |

The native preservation scenario seeds real admission rows but makes no provider
call. It proves outstanding admission/history preservation, not settlement of
a real provider output. Synthetic source certification reports zero billable
calls and explicitly disclaims provider qualification and durable production
provenance.

## Executed checks

| Check | Result |
| --- | --- |
| `CARGO_BUILD_JOBS=1 cargo test --locked -p ai-gateway --bin gateway --offline` | **1,013 passed, 9 ignored, 0 failed** |
| `CARGO_BUILD_JOBS=1 LUMIERE_ENABLE_DEV_REDUCERS=1 make contracts-module-ci` | Passed; raw module published only to a disposable in-memory local SpacetimeDB 2.8.2 |
| `spacetime call lumiere-alpha-ai-activation run_ai_owner_configuration_tests --server <disposable-local> --anonymous --no-config --yes` | Passed against the final native bodies and refreshed development seeds |
| Same local call for `run_ai_spend_recovery_tests` | Passed |
| `CARGO_BUILD_JOBS=1 CONTRACTS_STAGING_DIR="$PWD/.contracts-staging" cargo test --locked -p lumiere-codegen --offline -- --include-ignored` | **148 passed**, including canonical/durable migration parity |
| `node --test scripts/tests/test-provision-mistral-capabilities.mjs scripts/tests/test-provision-ai-harness.mjs scripts/tests/configure-ai-platform.test.mjs scripts/tests/test_mistral_alpha_preflight.mjs` | **54 passed**, no skips |
| Node 26.5.0: `pnpm --dir frontend/web test:unit` | **1,182 passed**, no skips |
| Node 26.5.0: focused assistant-turn/BFF tests and query-hooks provisioning tests | **31 passed**, no skips |
| Node 26.5.0: `NODE_OPTIONS=--max-old-space-size=8192 pnpm --dir frontend/web typecheck` | Passed in the isolated clean-PR scope; see caveat below |
| `python3 -B scripts/finance-skill-manifests.py --check` and `gateway certification-bundles` | Proposed report/Finance manifests and development source bindings match the compiled candidate |

The nine ignored gateway tests require real provider, Qdrant or guide
prerequisites; they are not live acceptance passes. The canonical frontend
typecheck in the parent's mixed working tree remains blocked by an unrelated,
pre-existing untracked `frontend/web/lib/ai-chat-attachments.ts` import.
In an isolated clone, only that file was temporarily path-stashed; the exact
canonical command passed and the file was restored byte-for-byte. No user
attachment work was altered or included in this candidate.

The native WASM check initially exceeded a 200-second tool limit; a subsequent
bounded run completed and both persisted suites passed. The disposable server
was stopped. No production identity or credential was used for those tests.
No browser suite, paid Mistral acceptance, hosted CI or production activation
was executed for this candidate.

## Contracts and source rollout

Canonical generation used the actual disposable-module schema and the official
SpacetimeDB generator, not hand-edited bindings. The candidate contains **1,530
operations, 539 tables** and the two new operations
`set_ai_agent_model` / `check_ai_agent_activation`. All 19 previously released
durable SQL migration files remain byte-identical; no table or durable migration
is added. The checked-in generated reducer descriptor and operation history
follow the same candidate.

The immutable contracts release must be published and all consumer pins
aligned through the existing release workflow before deployment. A local
candidate is not a new released pin.

Affected source revisions are chat/forms/action drafts `1.0.0`, report analysis
`1.0.10`, low-stock/report composer `1.0.1`, and the five Finance reviews `1.0.4`.
Discover the exact hashes from the served candidate build, independently
certify/promote each enabled surface, and coordinate the gateway rollout.
Old source certificates will fail closed; copying a certificate or suppressing
the current-source gate is not a rollout strategy.

## Private production readback and outstanding acceptance

Last no-cost readback in this thread confirmed the exact tenant, agent and
policy; company bindings for report/chat/forms/actions; the existing USD
5,000,000-microunit November budget with 9,060 settled and zero held; a correctly
registered dedicated reader; and account-visible approved Mistral models.
Neither collection contained points despite compatible green 1,024-dimension
document/activity stores. Readback is a snapshot, not permission to reuse stale
IDs or counters during apply.

Production remains blocked on:

1. A legitimate active platform authority for registration/pricing. Native
   superuser readback returned no rows; the SQL operator profile was inactive
   and not a superuser. SQL access and tenant owner permissions are not substitutes.
2. Registering the already verified gateway writer, reviewed embedding meter
   pricing and missing bounded infrastructure catalog entries through their
   canonical owners. Preserve the distinct reader/certification identities.
3. Publishing/deploying coherent contracts/module/API/gateway/web/edge artifacts
   and independently activating current source versions/certificates/grants.
   Production had report releases only, not chat/form/action releases.
4. Private operator `--plan`, `--check`, reviewed `--apply`, then `--check` using
   live IDs and reviewed prices. Preserve agent 2, company scope, policy, pool,
   allowance and historical rows. Stop rather than retry an uncertain write.
5. Authorized source/version-bound text indexing and a normal signed-in
   company-4097 cited answer whose citation opens, with exact durable
   run/attempt/reservation/provenance and settled shared economics.
6. Independent enabled-surface, native approval/saved-effect, recovery,
   revocation, budget and company-isolation acceptance from the
   [plan](../plans/alpha-ai-acceptance-and-prepaid-usage-plan.md).

The missing approved authority is not repaired by promoting the tenant owner,
reusing the spend writer as administrator, minting a certificate or granting
credit. The complete operational gate remains blocked until the platform owner
supplies that legitimate path and the private live matrix passes.

Partially relational
