# Qdrant semantic-index cleanup and bucket-ready activation plan

**Status:** Q0 implemented — 2026-08-25; Q1–Q3 remain planned
**Tracks:** `qdrant`, `agent-memory`, `semantic-index`, `rag`, `artifact-retrieval`, `bucket-ready`
**Related:** [agent-control-plane-model-routing-plan.md](./agent-control-plane-model-routing-plan.md) · [agent-harness-capability-ir-foundation.md](./agent-harness-capability-ir-foundation.md) · [scaleway-file-management-ingestion-investigation.md](./scaleway-file-management-ingestion-investigation.md)

---

## 1. Objective

Refactor the existing Qdrant scaffolding into one explicit role: **derived semantic retrieval/indexing for the AI harness**, never canonical ERP or agent memory.

Authoritative memory and artifact state remain in STDB/PG. Qdrant stores rebuildable embeddings/index records that point back to authoritative IDs.

```text
STDB / PG
  AgentSession
  Artifact metadata
  WorkingFacts
  Skills / workflow refs
  File/document metadata
        ↓ asynchronous indexing
      Qdrant
  semantic vectors
  search metadata
  authoritative refs only
        ↓
Agent context compiler
```

Loss of Qdrant may degrade semantic recall/RAG quality but must not prevent ordinary ERP workflows, authorization, artifact access, or audit/recovery.

---

## 2. Existing scaffold to reconcile

The branch already contains Qdrant infrastructure in the AI gateway, including:

- `Dockerfile.qdrant-health`;
- `ai-gateway/src/qdrant_client.rs`;
- embedding provider/routes;
- semantic search/context/RAG routes;
- `qdrant` service + persistent volume in `docker-compose.yml`;
- AI gateway dependency and `QDRANT_URL` wiring.

The cleanup must inventory these paths and classify each as **keep**, **refactor**, or **remove** against the new authority model.

---

## 3. Authority split

### Authoritative

Store in STDB/PG according to the existing application/durable architecture:

- `AgentSession` / task state;
- artifact identity, lifecycle and provenance;
- working facts that must survive/replay deterministically;
- reviewed skill/workflow definitions and references;
- file/document identity and metadata;
- permissions, organization scope and audit context.

### Derived / rebuildable

Qdrant may store:

- artifact-summary embeddings;
- document/extraction chunk embeddings;
- skill-discovery embeddings;
- capability discovery/ranking embeddings when useful;
- semantic tags/features used only for retrieval/ranking;
- references to authoritative IDs and version/fingerprint metadata.

Never treat a vector payload as the canonical copy of an artifact, permission, workflow, file, or business record.

---

## 4. Canonical index reference shape

Prefer a common payload shape such as:

```ts
interface SemanticIndexRecord {
  organizationId: OrganizationId
  resourceKind: SemanticResourceKind
  resourceId: string
  resourceVersion: string
  sourceFingerprint: string
  embeddingModel: string
  indexedAt: string
  tags: readonly string[]
}
```

Qdrant search returns these references. The control plane then fetches the authoritative resource through generated capabilities/trusted services before model context is compiled.

No authorization decision is made from Qdrant payload metadata alone.

---

## 5. Organization isolation and permissions

Every indexed record must carry a trusted organization scope established by the server-side indexing pipeline.

Required behavior:

```text
user objective
   ↓
trusted actor + org resolution
   ↓
semantic query constrained to org / allowed resource classes
   ↓
Qdrant candidate refs
   ↓
normal Casbin/resource authorization
   ↓
authoritative artifact/file fetch
```

Do not rely on hidden/unguessable vector IDs as tenant isolation.

---

## 6. Artifact-first memory integration

Use Qdrant as a semantic accelerator for the Agent Control Plane's artifact-first memory.

Example:

```text
prior AnalysisArtifact
   ↓ compact authoritative summary
embedding job
   ↓
Qdrant

later user request
   ↓
semantic retrieval
   ↓
ArtifactRef candidates
   ↓
fetch authoritative artifacts
   ↓
context compiler selects bounded evidence
```

Do not embed/store entire transcripts by default. Prefer compact artifact summaries, explicit facts, and source references.

---

## 7. Skill and capability discovery

Qdrant can be an optional secondary ranking layer for:

- reviewed `SkillDefinition` discovery;
- capability/tool discovery after deterministic domain/intent narrowing;
- prior artifact lookup.

Deterministic tags/IR metadata remain the first line for capability discovery. Vector similarity should improve ranking, not become the only way the harness finds a tool.

---

## 8. File/document indexing — BUCKET-READY GATE

**Do not implement production file/document vector ingestion until the Scaleway Object Storage bucket and file-management lifecycle are provisioned.**

Until then, the branch may define interfaces/tags and cleanup existing RAG code, but must not require local storage of large PDF/XLSX/document corpora.

Activation milestone:

```text
Scaleway bucket ready
   ↓
FileAsset/FileVersion lifecycle available
   ↓
parser/OCR extraction available
   ↓
normalized DocumentExtraction / Dataset artifacts
   ↓
chunk/index worker
   ↓
Qdrant references authoritative file/version/chunk provenance
```

Required source metadata once activated:

- `FileAssetRef` / `FileVersionId`;
- organization ID;
- content/source fingerprint;
- page/sheet/row/chunk provenance;
- extraction/parser/OCR version;
- embedding model/version;
- authoritative resource version.

Re-upload/version change must enqueue bounded re-indexing rather than mutating canonical file history inside Qdrant.

---

## 9. Cleanup tasks

### Q0 — inventory and authority cleanup

- [x] inventory current `qdrant_client`, embed/search/context/RAG routes and config;
- [x] classify each path as keep/refactor/remove;
- [x] prohibit vector records as canonical session/artifact memory;
- [x] define `SemanticIndexRecord` / authoritative-reference payload;
- [x] ensure every search is organization-scoped;
- [x] require post-search authorization before authoritative fetch;
- [x] preserve provider-neutral embedding abstraction where useful;
- [x] remove any raw ERP payload embedding path that bypasses generated capabilities/result policies.

Q0 verification is owned by `.github/workflows/semantic-index-q0.yml`. It runs
reference-only and fail-closed unit tests plus a live Qdrant 2×2 organization /
company isolation matrix. Semantic retrieval failures are reported as degraded
and never fall back to vector payload content. Activity and document writers
remain gated until their authoritative projection and bucket lifecycles exist.

### Q0 collection rollout

- use `lumiere_embeddings_org_v3` and `lumiere_erp_activity_refs_v1`; never
  repoint the new readers at a legacy collection containing text payloads;
- configure Rust clients against Qdrant gRPC port `6334`; reserve REST port
  `6333` for health checks and administration;
- create the collection and mandatory organization/company payload indexes
  before backfill or read cutover;
- backfill only from authoritative, policy-filtered projections carrying stable
  versions and fingerprints;
- cut readers over only after reference-only, authorization, and 2×2 tenant
  isolation verification passes;
- roll back by restoring the previous reader configuration, never by copying
  legacy payloads into the new collection;
- delete legacy collections only after the cutover observation window and an
  explicit rollback decision.

### Q1 — artifact retrieval

- [ ] index compact summaries of approved artifact types;
- [ ] add async/idempotent indexing jobs keyed by authoritative version/fingerprint;
- [ ] return only authoritative refs + relevance metadata from semantic search;
- [ ] context compiler fetches and bounds authoritative artifact contents;
- [ ] prove Qdrant outage falls back to non-semantic discovery without breaking agent sessions.

### Q2 — skill/capability ranking

- [ ] evaluate embeddings as a secondary ranker for skill discovery;
- [ ] evaluate capability search embeddings only after domain/intent filtering;
- [ ] measure retrieval precision and prompt-token reduction;
- [ ] keep deterministic fallback path.

### Q3 — bucket-ready document indexing (DEFERRED)

**Blocked until Scaleway Object Storage/file lifecycle is ready.**

- [ ] consume normalized extraction/dataset artifacts rather than raw arbitrary paths;
- [ ] chunk with page/sheet/row provenance;
- [ ] index using bounded worker concurrency;
- [ ] support re-index/delete by authoritative file version;
- [ ] validate prompt-injection/untrusted-content handling before retrieved chunks reach a model;
- [ ] prove manual file workflows still work with Qdrant/OCR disabled.

---

## 10. Deployment/resource isolation

Qdrant is derived infrastructure and must never pressure the authoritative STDB execution path enough to degrade ERP usage.

Early development may co-host Qdrant with other services, but production planning should prefer Qdrant/index workers in the AI/derived-workload failure domain rather than the STDB failure domain.

If temporarily co-hosted:

- bound Qdrant memory/CPU;
- bound embedding/index worker concurrency;
- prioritize interactive ERP/STDB traffic;
- shed/pause background indexing first under pressure;
- expose health/degraded state so semantic retrieval can fall back cleanly.

---

## 11. Acceptance criteria

- Qdrant has one documented role: derived semantic retrieval/indexing;
- authoritative memory/artifacts/files/permissions live outside Qdrant;
- semantic results always resolve to authoritative refs and are re-authorized;
- organization isolation is explicit in indexing and search;
- Qdrant outage does not break ordinary ERP or canonical agent-session continuity;
- old RAG/context paths are reconciled against generated capabilities and artifact-first memory;
- file/document indexing is explicitly tagged **bucket-ready deferred** and does not require local large-corpus storage;
- future bucket/OCR work can activate document indexing without redesigning the memory authority boundary.
