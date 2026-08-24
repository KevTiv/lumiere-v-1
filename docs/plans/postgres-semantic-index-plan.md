# Postgres semantic-index and Qdrant replacement plan

**Status:** Proposed — 2026-08-24
**Tracks:** `postgres`, `pgvector`, `semantic-index`, `agent-memory`, `rag`, `artifact-retrieval`, `qdrant-removal`
**Related:** [agent-control-plane-model-routing-plan.md](./agent-control-plane-model-routing-plan.md) · [agent-harness-capability-ir-foundation.md](./agent-harness-capability-ir-foundation.md) · [scaleway-file-management-ingestion-investigation.md](./scaleway-file-management-ingestion-investigation.md) · [qdrant-semantic-index-cleanup-plan.md](./qdrant-semantic-index-cleanup-plan.md)

---

## 1. Decision

Remove Qdrant from the baseline Lumière production topology and use PostgreSQL as the derived semantic retrieval/indexing store through `pgvector`, PostgreSQL full-text search, normal relational indexes, and optional `pg_trgm` fuzzy matching.

This does **not** change the existing authority boundary:

- SpacetimeDB remains the hot operational/business-logic authority;
- PostgreSQL remains the durable convergence/history/recovery layer and additionally owns rebuildable semantic-index records;
- Object Storage owns large/binary file content;
- semantic vectors are never canonical ERP state, permissions, agent memory, artifacts, or files.

Target topology:

```text
SpacetimeDB
  hot ERP state
  reducers / business logic
  realtime operational state
        |
        v durable projection / references
PostgreSQL
  durable history / audit / recovery
  agent artifacts + working facts
  semantic_index (pgvector)
  FTS / trigram search
  retrieval metadata
        |
        v file refs
Object Storage
  files / large artifacts
```

Qdrant must not be required for the first production SME deployment.

---

## 2. Why simplify

The currently planned Qdrant role is already derived and rebuildable: artifact-summary embeddings, document/extraction chunks, skill discovery, capability ranking, and references to authoritative resources.

Those workloads do not currently justify an additional datastore, deployment unit, network hop, backup policy, health surface, tenant-isolation implementation, or operational failure domain.

PostgreSQL provides enough functionality for the expected initial scale:

- `pgvector` for vector similarity;
- PostgreSQL full-text search for lexical retrieval;
- `pg_trgm` for fuzzy matching when useful;
- optional `unaccent` for accent-insensitive lexical normalization where product requirements justify it;
- relational predicates for organization/resource/version filtering;
- ordinary transactions for index lifecycle bookkeeping;
- one existing durable operational surface rather than a separate vector service.

A specialized vector database may be reconsidered only after measured retrieval scale/latency demonstrates that Postgres is no longer appropriate.

---

## 3. Authority model

### Authoritative in STDB / PostgreSQL

Store authoritative state according to the existing application/durable split:

- `AgentSession` / task lifecycle;
- artifact identity, provenance and versioning;
- reviewed working facts;
- skill/workflow definitions and references;
- file/document identity and metadata;
- permissions, organization scope and audit context;
- durable ERP history and recovery state.

### Derived in PostgreSQL semantic index

The semantic index may contain:

- artifact-summary embeddings;
- document/extraction chunk embeddings;
- skill-discovery embeddings;
- optional capability-ranking embeddings;
- lexical search vectors / normalized searchable text;
- semantic tags/features used for retrieval/ranking;
- authoritative IDs, versions and fingerprints.

Loss or rebuild of semantic-index rows must not prevent ordinary ERP workflows, authorization, artifact access, session continuity, or recovery.

---

## 4. Scaleway managed-Postgres compatibility contract

The production target for this plan is **Scaleway Managed Database for PostgreSQL**, not a generic assumption that every upstream PostgreSQL extension is available.

As of this plan update, the required search features are compatible with Scaleway's managed PostgreSQL offering:

- `pgvector` / extension name `vector` — supported;
- `pg_trgm` — supported;
- `unaccent` — supported when accent-insensitive text normalization is useful;
- PostgreSQL full-text search — built into PostgreSQL and requires no separate extension.

Provisioning/migration code may therefore use:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
-- Optional; enable only when product/search requirements need it.
CREATE EXTENSION IF NOT EXISTS unaccent;
```

Do not add a new PostgreSQL extension to the production architecture without first verifying that it is supported by the targeted Scaleway Managed PostgreSQL engine/version.

### Embedding-dimension constraint

Lumière must not blindly adopt an embedding model whose vector size is incompatible with the indexed pgvector strategy available on Scaleway.

For indexed semantic vectors, enforce this architecture-level constraint:

```text
indexed embedding dimension <= 2000
```

Model/provider selection must expose and validate embedding dimensionality before an embedding model can be promoted for production semantic indexing. Prefer deliberate dimensions such as `768`, `1024`, or `1536` when retrieval quality is sufficient.

Required safeguards:

- persist `embedding_model`, provider-neutral model identity/version, and `embedding_dimension` with index metadata;
- reject or explicitly route models above the supported indexed dimension rather than silently creating an unindexable production corpus;
- validate dimension consistency before insert/upsert;
- include dimension compatibility in model certification/promotion tests;
- require an explicit migration/re-embedding plan when changing vector dimensions;
- benchmark retrieval quality/latency before changing the chosen production dimension.

The semantic-index repository must not assume every provider emits the same dimension.

---

## 5. Canonical schema direction

Prefer one shared semantic-reference model rather than separate ad-hoc vector tables per feature.

Illustrative shape:

```sql
CREATE TABLE semantic_index (
  id                  uuid PRIMARY KEY,
  organization_id     uuid NOT NULL,
  resource_kind       text NOT NULL,
  resource_id         text NOT NULL,
  resource_version    text NOT NULL,
  source_fingerprint  text NOT NULL,
  embedding_model     text NOT NULL,
  embedding_dimension integer NOT NULL CHECK (embedding_dimension > 0 AND embedding_dimension <= 2000),
  embedding           vector(/* pinned production dimension */),
  searchable_text     text,
  metadata            jsonb NOT NULL DEFAULT '{}'::jsonb,
  indexed_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, resource_kind, resource_id, resource_version, embedding_model)
);
```

Exact IDs/types must follow generated contract and durable-schema conventions rather than introducing duplicate handwritten domain types.

Because a pgvector column has a concrete dimensionality when dimension-constrained, do not treat arbitrary per-row provider dimensions as interchangeable. A production embedding model/dimension should be pinned per active index generation, or separate versioned index storage should be used during migrations.

Indexes should be selected from measured workload. Do not prematurely lock the design to one ANN index type.

---

## 6. Retrieval contract

Semantic retrieval must return candidate references, never trusted business objects.

```text
user objective
   |
trusted actor + organization resolution
   |
query semantic_index with mandatory org/resource predicates
   |
vector + lexical ranking
   |
AuthoritativeResourceRef candidates
   |
normal authorization
   |
fetch authoritative STDB / PostgreSQL / file resource
   |
context compiler bounds evidence
```

Required properties:

- every query is explicitly organization-scoped;
- resource class restrictions are applied before or during candidate retrieval;
- authorization is re-evaluated against authoritative state;
- semantic-index metadata alone cannot grant access;
- retrieved content remains subject to result-shaping and prompt-injection/untrusted-content controls.

---

## 7. Hybrid search

Prefer hybrid retrieval rather than vector-only search.

Candidate signals may include:

1. deterministic resource/domain filters;
2. exact identifiers/tags;
3. PostgreSQL full-text rank;
4. trigram similarity where appropriate;
5. pgvector similarity;
6. recency/version/fingerprint validity;
7. application-specific ranking after authoritative fetch.

Deterministic IR/tag discovery remains primary for tools/capabilities. Embeddings may improve ranking after intent/domain narrowing but must not become the only discovery mechanism.

---

## 8. Index lifecycle

Indexing is asynchronous, idempotent and rebuildable.

Use authoritative version/fingerprint keys so repeated events do not create duplicate semantic state.

```text
authoritative resource changes
      |
index job / durable work item
      |
embed normalized summary/chunk
      |
validate model + dimension
      |
UPSERT semantic_index
      |
old version retained or retired according to resource lifecycle
```

Requirements:

- bounded worker concurrency;
- retry-safe indexing;
- explicit embedding-model/version/dimension metadata;
- deterministic delete/re-index by resource version;
- health/degraded state surfaced without blocking ERP traffic;
- background indexing shed before interactive ERP work under pressure.

---

## 9. File/document indexing — bucket-ready gate

Production document-vector ingestion remains blocked until Scaleway Object Storage and the file-management lifecycle are ready.

Activation path:

```text
Scaleway bucket ready
   |
FileAsset / FileVersion lifecycle
   |
parser / OCR / spreadsheet extraction
   |
normalized DocumentExtraction / Dataset artifact
   |
chunk/index worker
   |
Postgres semantic_index
```

Each indexed chunk must retain provenance such as:

- `FileAssetRef` / `FileVersionId`;
- organization ID;
- content/source fingerprint;
- page/sheet/row/chunk provenance;
- extraction/parser/OCR version;
- embedding model/version/dimension;
- authoritative resource version.

Do not store raw arbitrary file paths or canonical file contents in `semantic_index`.

---

## 10. Qdrant migration/removal tasks

### P0 — define Postgres semantic-index foundation

- [ ] pin the production target to Scaleway Managed PostgreSQL and record the supported engine/version;
- [ ] enable `pgvector` in development and planned Scaleway Postgres deployment;
- [ ] evaluate whether `pg_trgm` and `unaccent` are needed and enable only when useful;
- [ ] enforce `indexed embedding dimension <= 2000` in model certification/configuration;
- [ ] select and pin the initial production embedding model + dimension from measured retrieval quality;
- [ ] define generated/typed `SemanticIndexRecord` / `AuthoritativeResourceRef` contracts including model/version/dimension;
- [ ] implement organization-scoped semantic repository abstraction;
- [ ] add vector + lexical retrieval contract;
- [ ] define index-job lifecycle and idempotency keys;
- [ ] ensure semantic-index loss is rebuildable from authoritative resources.

### P1 — migrate AI gateway retrieval paths

- [ ] inventory `ai-gateway/src/qdrant_client.rs` and all embed/search/context/RAG callers;
- [ ] replace Qdrant client dependency with Postgres semantic repository;
- [ ] migrate artifact-summary retrieval;
- [ ] migrate skill-discovery retrieval where embeddings remain useful;
- [ ] migrate context/RAG routes to return authoritative refs and re-authorize fetched resources;
- [ ] preserve provider-neutral embedding generation while validating provider/model dimensionality;
- [ ] add deterministic non-semantic fallback.

### P2 — remove Qdrant infrastructure

- [ ] remove `Dockerfile.qdrant-health`;
- [ ] remove Qdrant service/volume from compose files;
- [ ] remove `QDRANT_URL` and Qdrant-specific configuration/secrets;
- [ ] remove Qdrant health checks and deployment documentation;
- [ ] remove unused Qdrant client crate/dependencies;
- [ ] update production/development runbooks and environment templates;
- [ ] prove clean bootstrap without any Qdrant container/service.

### P3 — bucket-ready document retrieval

- [ ] consume normalized extraction artifacts rather than raw paths;
- [ ] chunk with precise provenance;
- [ ] index using bounded workers;
- [ ] support re-index/delete by authoritative file version;
- [ ] validate untrusted-content handling before model context inclusion;
- [ ] benchmark hybrid retrieval quality and latency against pilot corpus.

---

## 11. Scaleway deployment direction

Baseline production dependencies should become:

```text
SpacetimeDB
Scaleway Managed PostgreSQL + pgvector
Object Storage
application/API services
agent sandbox compute when enabled
```

Do not provision Qdrant for the initial production topology.

Postgres semantic-index traffic is a derived workload. Protect the durable/ERP path by:

- connection-pool separation where useful;
- bounded embedding/index worker concurrency;
- statement/query timeouts;
- measured ANN indexes;
- pausing background indexing under database pressure;
- maintaining deterministic retrieval fallback.

Deployment validation must include a migration/bootstrap test against the actual targeted Scaleway PostgreSQL version proving that all required extensions can be enabled before release.

If semantic retrieval eventually dominates Postgres resource usage, first evaluate a dedicated read/search Postgres topology before introducing another database product.

---

## 12. Criteria for reconsidering a dedicated vector database

Do not reintroduce Qdrant or another vector service based on anticipated scale alone.

Require measured evidence such as:

- vector corpus/tenant scale materially exceeding comfortable Postgres operation;
- unacceptable p95/p99 retrieval latency after appropriate pgvector indexing/tuning;
- semantic workload materially interfering with durable ERP workloads despite isolation controls;
- operational features required by the product that Postgres cannot reasonably provide;
- demonstrated lower total operational complexity/cost with a specialized service.

Any future vector datastore remains derived and rebuildable; it must not change the STDB/Postgres authority model.

---

## 13. Acceptance criteria

- Qdrant is absent from the baseline deployment topology;
- Scaleway Managed PostgreSQL is the explicitly validated production target;
- `vector`/pgvector and any enabled optional extensions are proven available on the targeted Scaleway engine version during deployment validation;
- indexed production embeddings are constrained to `<= 2000` dimensions;
- embedding model/version/dimension are explicit metadata and validated before indexing;
- changing embedding dimension requires an intentional versioned migration/re-embedding path;
- Postgres owns the rebuildable semantic index through `pgvector`;
- vector/lexical retrieval is organization-scoped and returns authoritative refs;
- authorization occurs against authoritative resources, not index payloads;
- semantic-index outage/rebuild does not break ordinary ERP or agent-session continuity;
- existing Qdrant AI-gateway paths are migrated or removed;
- document indexing remains bucket-ready gated;
- Docker/deployment/env documentation boots without Qdrant;
- adding a specialized vector database later requires measured evidence rather than architectural assumption.
