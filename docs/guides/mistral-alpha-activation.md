# Activate Mistral chat, embeddings and OCR in Alpha

This runbook accompanies the Mistral capability implementation. A merged PR,
provider key, successful health probe or saved upload does not establish tenant
activation. Use one existing shared Mistral agent and its existing monetary pool;
this procedure does not create credit or increase the monthly allowance.

## Release before activation

The native module adds private `ai_metered_price` and `ai_metered_usage` tables,
their dedicated-reader views and five service-only metering operations. Generate
and review the canonical contracts, storage migration and reconstruction output;
publish an immutable release and align all consumer pins through the existing
release lane. Do not hand-edit generated contracts or earlier SQL migrations.
The draft-backend branch deliberately does not publish an immutable contract tag.
Unknown metering operations fail before provider dispatch until the matching
contracts and module are deployed.

Deploy the module, durable storage migration, API, AI gateway, web and Kong as one
compatible ordered stack release. Retain the previous coherent artifacts and
the expanded private data when rehearsing rollback. Do not roll back to a native
spend implementation that can settle a metered reservation as ordinary tokens.

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

Retain separate writer, spend-reader and certification identities. Give the
writer only the exact reviewed native metering, provider-attempt, queue and
evidence permissions for the organization. Queue cancellation is required for
ambiguous paid-job recovery. The spend reader must have its existing active
`ai_spend_reader` organization binding. Price configuration requires an existing active platform superuser and the
`ai_spend/configure_meter` permission. Do not promote an organization owner to
activate this feature; use the existing platform operations identity. Tenant
owner wildcards cannot change the native meter prices, including by direct calls.

Use existing catalog records for the following infrastructure bindings. They
identify bounded native services and do not manufacture executable skill
certificates:

| Company binding | Agent action |
| --- | --- |
| `document_embeddings` | `embedding_index` |
| `activity_indexing` | `embedding_index` |
| `embedding_query` | `embedding_query` |
| `document_ocr` | `ocr` |

The agent's allowed models must include `mistral-embed`, the exact OCR model,
and the reviewed generation/review models. Chat uses its own `rag_generation`
company binding; forms and action drafts use `form_suggestion` and
`action_draft_generation`. Generative bindings require their current matching
source versions, independent certificates, capability grants and model policy.
One skill's activation does not activate another.

Create a private manifest for `scripts/provision-mistral-capabilities.mjs` using
its validated fields: `version: 1`, `organizationId`, `companyId`, `agentId`,
`intelligencePolicyRef`, `currency`, `pricesReviewedAt`, `surfaces` and `meters`.
Each surface contains `skillKey` and `skillId`; generative surfaces also require
their exact `sourceHash`. Each meter contains `model`, `unit` and `unitsPer1k`.
Prices are integer currency microunits per 1,000 tokens or per 1,000 OCR pages.
Obtain current prices; no price or funding amount is inferred from this runbook.

```sh
node scripts/provision-mistral-capabilities.mjs --plan /private/capabilities.json
node scripts/provision-mistral-capabilities.mjs --check /private/capabilities.json
# Apply only the reviewed missing prices and company bindings:
node scripts/provision-mistral-capabilities.mjs --apply /private/capabilities.json
node scripts/provision-mistral-capabilities.mjs --check /private/capabilities.json
```

Plan is offline; check is read-only. Apply never creates an agent, budget,
funding, certificate or organization default. Existing explicit disablement and
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
6. Disabled providers, incompatible collections, missing pricing/certificates and
   unavailable dependencies show a limitation while ordinary ERP remains usable.
7. Chat-to-native-form and saved-guide save/reload/retrieval preserve actor scope,
   dirty work and exact saved identities on the integrated signed-in release.

Local fixtures and mocked providers verify implementation boundaries. They do
not certify account access, reviewed live prices, real provider quality, paid
settlement, deployed migration durability or production user acceptance.
