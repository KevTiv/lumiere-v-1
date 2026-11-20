# Activate Mistral chat, embeddings and OCR in Alpha

This runbook accompanies the Mistral capability implementation. A merged PR,
provider key, successful health probe or saved upload does not establish tenant
activation. Use the existing Mistral agent and its monetary pool. The agent must
belong to the requested organization and can be shared within that organization
or scoped to the requested company. This procedure does not create credit or
increase the monthly allowance.
Recorded local checks and generated-candidate hashes are in the
[validation report](mistral-alpha-validation.md).
The current tenant repair has a separate
[candidate validation checkpoint](../evidence/alpha-ai-activation-candidate-validation.md);
neither report establishes live activation.

## Release before activation

The original metering release added private `ai_metered_price` and `ai_metered_usage` tables,
their dedicated-reader views and five non-client metering operations. The
canonical contracts were published as immutable release `v0.3.166`. This is
historical, not the current application pin. Migration 36 is registered in
the durable ledger and API catalog with the generated reconstruction output.
Future schema changes must follow the same generation, review, publication and
pin-alignment lane. Do not hand-edit generated contracts or earlier migrations.
Metering requires the matching contracts and module to be deployed before
provider dispatch.

Deploy the module, durable storage migration, API, AI gateway, web and Kong as one
compatible ordered stack release. Retain the previous coherent artifacts and
the expanded private data when rehearsing rollback. Do not roll back to a native
spend implementation that can settle a metered reservation as ordinary tokens.

The current repair adds `set_ai_agent_model` and the no-application-write
`check_ai_agent_activation` probe. Its canonical candidate adds two operations
and no table or durable migration. Publish and pin the matching immutable
contracts before deploying consumers; do not assume the previous `0.3.178` pin
contains these operations.

Embedding execution also needs the exact `ai_spend_writer` service binding for
the `embedding` queue. This does not grant generic queue or business permissions.
Unknown paid results use the private `cancel_ai_embedding_job` operation with
the current worker, lease token and revision. Delivery is cancelled without
settling or releasing its financial hold. Publish the contract containing this
operation before deploying the corresponding worker.

The gateway must read back each claim and verify the persisted live lease
before dispatching work. Reducer success alone is not lease evidence: reclaiming
an expired final attempt can successfully dead-letter the job instead. Missing,
expired or mismatched readback stops processing without another claim or paid
request.

Built-in skills use the execution policies shipped in the gateway. An active
catalog entry and the company’s effective binding control availability. Verify
the enabled surfaces with the deployed gateway and an authorized company session.

## Provider and index configuration

Select these values on the AI gateway for the full capability set:

```dotenv
EMBEDDING_PROVIDER=mistral
VISION_PROVIDER=mistral
MISTRAL_OCR_MODEL=REPLACE_WITH_EXACT_ACCOUNT_VISIBLE_VERSION
MISTRAL_OCR_MAX_PAGES=20
QDRANT_COLLECTION=lumiere_mistral_embed_1024_v1
QDRANT_ACTIVITY_REFS_COLLECTION=lumiere_mistral_activity_refs_actor_v2
```

The OCR model example is intentionally invalid. Supply an exact account-visible
`mistral-ocr-*` version; rolling aliases are rejected. The existing Mistral key
must have access to that model and `mistral-embed`. Verify account access without
generation before a separately approved paid acceptance run. Keep direct
Mistral transport and permit `api.mistral.ai` egress.

Production provider defaults select Mistral. Before deploying, either configure
the exact OCR model and provider credentials or explicitly keep the not-yet-ready
providers `disabled`. Explicit disablement is preserved. A selected Mistral OCR
provider without an exact model fails startup rather than silently choosing one.

Qdrant must support the pinned client's API and both collections' shape. Document
vectors have 1,024 dimensions and cosine distance; activity vectors use their
existing named-vector layout. Existing incompatible dimensions or distances fail
readiness. A change of embedding model requires a separate collection and
source-bound reindex, even if vector dimensions happen to match. Startup never
deletes an old collection. The document worker starts only when its collection
is compatible, and query callers check readiness before paying for embeddings.

## Identities, prices and company bindings

Retain separate writer and spend-reader identities. Register the
existing writer's verified identity as the exact active `ai_spend_writer`
organization binding through the platform-owned service registration operation.
The registering administrator must be distinct from that writer. Give the
writer only the exact reviewed native metering, provider-attempt, queue and
evidence permissions for the organization. Tenant owner wildcards cannot create
trusted metering rows or settle another writer's paid attempt. Queue cancellation is required for
ambiguous paid-job recovery. The spend reader must have its existing active
`ai_spend_reader` organization binding. Price configuration requires an existing active platform superuser and the
`ai_spend/configure_meter` permission. Do not promote an organization owner to
activate this feature; use the existing platform operations identity. Tenant
owner wildcards cannot change the native meter prices, including by direct calls.
Uncertain-outcome reconciliation likewise requires platform pricing/recovery
authority and its separate permission; a caller-supplied approval label alone
does not grant that authority. A writer rotation retains old holds for approved
reconciliation rather than transferring dispatch ownership silently.

Use existing catalog records for the following infrastructure bindings. They identify bounded native services:

| Company binding | Agent action |
| --- | --- |
| `document_embeddings` | `embedding_index` |
| `activity_indexing` | `embedding_index` |
| `embedding_query` | `embedding_query` |
| `document_ocr` | `ocr` |

The agent's allowed models must include `mistral-embed`, the exact OCR model,
and the reviewed generation/review models. Chat uses its own `rag_generation`
company binding; forms and action drafts use `form_suggestion` and
`action_draft_generation`. Generative bindings require their own capability grants and model policy.

Create a private manifest for `scripts/provision-mistral-capabilities.mjs` using
its validated fields: `version: 1`, `organizationId`, `companyId`, `agentId`,
`intelligencePolicyRef`, `currency`, `pricesReviewedAt`, `surfaces` and `meters`.
Each surface contains `skillKey` and `skillId`. Each meter contains `model`, `unit` and `unitsPer1k`.
Prices are integer currency microunits per 1,000 tokens or per 1,000 OCR pages.
Obtain current prices; no price or funding amount is inferred from this runbook.

This is a **platform operator** workflow, not a tenant onboarding checklist.
The tenant-facing goal is to open chat and use the approved default; future
approved-model selection belongs in chat without exposing infrastructure setup.
The AI Skills binding/catalog repair result is not execution readiness.

For the reviewed non-OCR repair of an existing agent, the manifest may include
this optional fragment:

```json
{
  "agentCapabilities": {
    "addModels": ["mistral-embed"],
    "addActions": ["embedding_query", "embedding_index"]
  }
}
```

Omit additions that are not approved for the selected surfaces. Without this
field, missing allowlist entries continue to block. The tool validates all
structural prerequisites against the explicitly approved prospective allowlists
before any mutation. It then verifies the deployed toggle signatures and calls
the native `check_ai_agent_activation` authorization probe, which changes no
application state. When a price is missing, this probe requires the existing
platform pricing authority as well as agent/skill write authority. No
JavaScript flag or successful SQL read grants these permissions.

Apply adds only missing reviewed model/action entries, verifies that unrelated
agent fields and scope are preserved, then writes missing prices and bindings
and reads back the unchanged allowance. A stale schema, missing writer,
catalog or operator authority blocks activation. The tool does not
create those prerequisites or repair them by granting privileges.

```sh
node scripts/provision-mistral-capabilities.mjs --plan /private/capabilities.json
node scripts/provision-mistral-capabilities.mjs --check /private/capabilities.json
# Apply only the reviewed missing capabilities, prices and company bindings:
node scripts/provision-mistral-capabilities.mjs --apply /private/capabilities.json
node scripts/provision-mistral-capabilities.mjs --check /private/capabilities.json
```

Plan is offline; check is read-only. Apply never creates an agent, budget,
funding or organization default. Existing explicit disablement and
conflicting configuration block writes. Keep credentials in the existing server
environment. An uncertain write stops; inspect exact state before another apply.
Provision the current UTC monthly period without resetting previous use or holds.

### Restore retrieval for an existing chat agent

Use the private operator environment when the company already has an enabled
`rag_generation` binding and its agent lacks query embedding admission. Supply
`version: 1`, `organizationId`, `companyId`, `agentId`, `currency`,
`pricesReviewedAt` and `unitsPer1k` in the private JSON manifest. The rate is the
reviewed `mistral-embed` price in currency microunits per 1,000 tokens.

```sh
node scripts/provision-mistral-capabilities.mjs --check --chat-retrieval /private/chat-retrieval.json
node scripts/provision-mistral-capabilities.mjs --apply --chat-retrieval /private/chat-retrieval.json
node scripts/provision-mistral-capabilities.mjs --check --chat-retrieval /private/chat-retrieval.json
```

The first check reports missing entries with exit status 1. Review the result
before applying. This mode resolves the existing company binding and its
policy, preserves that binding, and adds only missing `embedding_query`,
`mistral-embed` and the corresponding token meter. If a meter already exists at
a different price, it stops for review. After readback, use a signed-in company
session to ask about an authorized indexed source and verify the reply and
its citation. On a retrieval failure, filter AI gateway logs for
`Chat query embedding unavailable` and inspect the `stage` field.

For an existing tenant that needs to index documents, include `indexDocuments: true`
in the same manifest. It adds the document indexing binding and action on the
same agent. The publisher installs the infrastructure catalog on upgrade.
Ingest an authorized test document through the Documents ingestion route and
verify completed indexing before sending a question. Check for dead-lettered
jobs if the source was queued before repair.

For fresh managed enrollments, pass a reviewed `embeddingUnitsPer1k` in the
Mistral manifest for `scripts/configure-ai-platform.mjs --activate`. The platform
approval stores the rate for the selected template. Every new enrollment copies
that rate into its own metering snapshot
and enables query and indexing on the managed agent. Use the private operator
path above for existing agents. An embedding request can open an eligible
managed sponsored period at UTC month rollover through normal spend admission.

### Verify a Railway release through authenticated chat

The registry-backed check stores versioned scenario metadata in SpaceTimeDB.
The **Grounded chat acceptance** workflow exchanges GitHub OIDC for short-lived
WorkOS access tokens for dedicated, company-scoped test accounts. It calls the
public chat streaming route and requires indexed evidence and persisted claim
support for the exact document versions.

1. Land and deploy the new native contract, API server, web image, and Kong
   route. Railway deployment completes independently of chat fixture setup.
2. Configure the API server with sealed Railway variables
   `AI_CHAT_ACCEPTANCE_PROOF_PRIVATE_KEY` (an Ed25519 PKCS#8 PEM, stable across
   deployments) and `AI_CHAT_ACCEPTANCE_BROKER_CONFIG`. Set
   `AI_CHAT_ACCEPTANCE_PROOF_PUBLIC_KEY` to the corresponding public PEM in
   both the API service and the operator environment. The web and API services
   use their existing shared
   `LUMIERE_AI_GATEWAY_INTERNAL_SECRET` to authenticate the build stamp.
3. Provision admitted WorkOS test users with read-only roles and a single
   company-bound membership each. The broker uses their normal provider
   sign-in, subject pin, active profile, membership, and role checks. The
   provider must issue access tokens lasting at most 30 minutes and longer
   than 210 seconds for the streaming request. The broker never returns a
   refresh token. If WorkOS requires an interactive challenge, the check
   fails with a sign-in error.

The broker config uses this shape. Set the actual GitHub numeric repository ID
and pinned WorkOS user subjects. Keep the values in the API service's secret
configuration.

```json
{
  "repository": "KevTiv/lumiere-v-1",
  "repositoryId": "123456",
  "environment": "production",
  "organizationId": 4097,
  "actors": [
    {"companyId": 4098, "userId": "user_upgraded_fixture", "password": "PLACEHOLDER"}
  ],
  "freshActor": {"userId": "user_fresh_fixture", "password": "PLACEHOLDER"}
}
```

Register the `upgraded` baseline before running acceptance. It uses the
existing `companyId`, `documentId`, `sourceVersion`, `question`, and
`expectedAnswerText` fields. An existing dedicated `FARM_ACCEPT_` company
such as 4098 is eligible once its expected document is indexed. Use a native
platform superuser from a private operator environment with `STDB_HOST`,
`STDB_MODULE`, and `AI_CHAT_ACCEPTANCE_OPERATOR_STDB_TOKEN` set.

```sh
node scripts/register-grounded-chat-fixtures.mjs 4097 production baseline /private/upgraded.json
```

Set `AI_CHAT_ACCEPTANCE_URL` in the GitHub production environment to the
verified public HTTPS origin. After Railway serves the new web build, run
**Grounded chat acceptance** from `main` and enter the deployed web commit as
`release_sha`. The job checks the served revision. If the manifest is missing,
it prints the release SHA and a signed cutover receipt, then waits up to 15
minutes for the fresh fixture. After the receipt appears, create a new
`AI_CHAT_ACCEPT_` company in the same tenant, bind the
fresh actor's read-only membership to it, and upload and index a synthetic
known-answer document through the candidate. Register an exact release
manifest with the unchanged `upgraded` fixture, `fresh` with the same five
fields plus `provisionedReleaseSha`, and the top-level `activationProof` from
the job. The operator command verifies the receipt and creation dates before
registering the immutable revision. Each fresh company can prove one release.

```sh
node scripts/register-grounded-chat-fixtures.mjs 4097 production "$RELEASE_SHA" /private/acceptance.json
```

The nightly run at 03:17 UTC verifies the manifest for the currently served web
build. Leave `release_sha` blank to run the same check on demand. A missing
manifest, invalid session, or failed assertion fails the acceptance run and
appears in its summary. GitHub workflows read fixtures only from the registry.
Remove any leftover `AI_CHAT_ACCEPTANCE_JSON` environment secret.

#### Optional acceptance scenarios

Add a `journal` object to the release manifest to verify a posted journal entry
through live Accounting chat. Supply `companyId`, `accountMoveId` as
a decimal string, `question`, `expectedAmountText`, and `expectedDebitText`.
Use a dedicated test company's posted entry with a stable reference and a
known debit account. Match the amount and debit wording to the requested
format in the question, such as `RWF 600` and
`Debit account: Test electricity expense`. The check requires a current
source for that exact entry and verified support for both facts.

The optional `journal.ambiguous` case takes a `question` matching multiple
test entries and `expectedClarificationText`. The optional `journal.foreign`
case takes an inaccessible `accountMoveId`, a `question` about the selected
entry, and a synthetic `forbiddenText` marker from that entry. Both cases use
the journal fixture's signed-in company and check that the assistant
withholds generation and evidence.

Add any of the following optional top-level scenarios to the manifest. Each case
references a test `companyId` and uses the configured read-only actor for that
company.
Cases are strictly validated when present and may set `"expectedGap": true`.
A failing scenario is then reported as
`known-gap` (with its reason under `knownGaps`) without failing the check. A
passing one reports `gap-closed`, which is the cue to remove the flag.

| Key | Extra fields | Checks |
| --- | --- | --- |
| `namedRecord` | `question`, `entityType`, `entityId` (decimal string), `expectedText`, optional `uiContext` | Verified answer citing that live record, with the fact |
| `followUp` | `chatSessionKey` (`[A-Za-z0-9_-]`, up to 100; a per-run suffix is added), `first` (`question`, `entityType`, `entityId`), `question`, optional `expectedText` | Second turn in the same session cites the first turn's record |
| `nonEnglish` | `fr` and/or `rw`, each shaped like `namedRecord` | Same checks for a French or Kinyarwanda question |
| `emptyCompany` | `question`, `expectedText` (the "not indexed yet" wording); a company different from `fresh` and `upgraded` | No generation, no sources, the wording present |
| `summaryHandoff` | `question`, `capabilityKey`, optional `uiContext` | Verified reply offering that handoff in `ui_actions` |
| `revoked` | `question`, `entityType`, `entityId`, `forbiddenText`, `uiContext` (`route`, `module`) | A revoked or foreign record is denied or ungrounded and never leaks `forbiddenText` |
| `importContinuation` | `question`, `importTaskRefs` (1-4 32-hex task ids; the company is added), `expectedRecords` (`entityType`, `entityId`), optional `expectedText` | `import_task_statuses` returned and every expected reviewed record cited |

Every scenario checks `retrieval_degraded`, the run status (`run_id`,
`provider`, `model`), the verification outcome and the sources, never only the
reply text. The gateway's chat response carries no settled-spend field today,
so none is asserted.

An optional top-level `maxWithholdRate` (0 to 1) lets a withheld verification
outcome (`requires_review` or `blocked`) pass a scenario; the run fails when
the share of withheld scenarios (non-gap record, follow-up, language, handoff
and import scenarios) exceeds it. Without it, any withheld answer fails.

Before the live questions, the command probes each distinct cookie with an empty
query, which the web route rejects after authentication and before any model
call. An expired cookie fails with a message naming the fixture to re-sign. There
is no non-interactive production sign-in in the repository (the e2e helpers sign
in a seeded local user), so cookies must still be rotated by hand; automating
that sign-in for a dedicated acceptance user is a follow-up.

## Document and activity flows

Document ingestion resolves the current DMS document, version and stored blob,
checks its checksum, and first uses local text/PDF extraction. Scans and images
use the internal authenticated `/v1/documents/ocr` route. The API forwards current
actor/company authority; browser-supplied replacement document text is not an
ingestion source. The old external `LUMIERE_EVIDENCE_OCR_URL` is not a production
escape hatch. Actor access and the current source version are checked again
after extraction. OCR text, page boundaries and provider usage are retained;
there is no invented confidence score or automatic invoice posting.

The actor needs `ai.document.ocr` with explicit byte/page bounds for OCR,
`ai.evidence.retrieve` for retrieval, and `ai.context.index` for explicit activity
indexing. Review grants against the actual source and purpose, not a wildcard.
Activity indexing accepts at most eight canonical resource references and
64 KiB of authorized projected content. It is actor-bound indexing of selected
records, not a whole-organization activity backfill or background table scan.
Fresh authorized reads invalidate changed, revoked and unavailable activity hits.

The evidence extractor emits bounded UTF-8 passages for the embedding adapter.
Legacy oversized immutable passages cannot be rewritten in place: create a new
DMS source version and reingest through the normal owner. A status check never
triggers paid extraction or reingestion. A failed/cancelled queue job needs the
canonical retry/recovery owner, not a new upload or an invented success receipt.

## Spend, recovery and acceptance

Every paid token/page call reserves money in the same monthly/prepaid pool as
chat, durably accepts the attempt and wins a native per-invocation dispatch claim
before network I/O. Successful outputs and actual unit usage are privately
persisted for exact recovery. OCR pages are not recorded as tokens. Unknown
outcomes retain their holds and stop automatic paid retries; explicit approved
reconciliation owns any later settlement. A pre-dispatch setup failure makes no
provider call. The unit-aware usage summary excludes document contents and
private cached outputs.

Record the exact release pins, actor/company, source checksum/version, models,
request/run/reservation IDs and private receipts while proving:

1. Stored text/PDF upload → completed indexing → cited chat answer.
2. Scanned PDF and image → real OCR pages → completed indexing → cited answer.
3. Selected ERP record → authorized activity index → current-source retrieval;
   changed fields, deletion, company switch and permission revocation withhold it.
4. Same-request replay and lost responses recover the same paid result; concurrent
   callers dispatch once. Unknown outcomes retain spend and require recovery.
5. Embedding, OCR and chat share the same cap and prepaid balance; exhausted
   allowance blocks before provider I/O, including indexing queries and retries.
6. Disabled providers, incompatible collections, missing pricing and
   unavailable dependencies show a limitation while ordinary ERP remains usable.
7. Chat-to-native-form and saved-guide save/reload/retrieval preserve actor scope,
   dirty work and exact saved identities on the integrated signed-in release.

Local fixtures and mocked providers verify implementation boundaries. They do
not certify account access, reviewed live prices, real provider quality, paid
settlement, deployed migration durability or production user acceptance.
