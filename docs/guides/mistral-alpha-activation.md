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
