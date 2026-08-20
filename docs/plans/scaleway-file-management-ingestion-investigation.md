# Scaleway file management, ingestion, and document-processing investigation

**Status:** Investigation — 2026-08-20
**Tracks:** `file-management`, `object-storage`, `dataset-import`, `document-processing`, `mistral-ocr`, `agent-capabilities`
**Related:** [sliding-window-cold-tier.md](./sliding-window-cold-tier.md) · [agent-harness-capability-ir-foundation.md](./agent-harness-capability-ir-foundation.md) · [regional-stdb-scaleway-durable-foundation.md](./regional-stdb-scaleway-durable-foundation.md)

---

## 1. Objective

Investigate and define the production architecture for first-class organization files on Scaleway while preserving the current STDB authority model.

The target is to support user-managed Excel/CSV/PDF/document workflows, OCR/extraction, AI-assisted inspection, import proposals, generated reports/content, and durable archival without allowing Object Storage, OCR workers, or AI models to become business-authority surfaces.

```text
user / agent
   ↓
generated file/content capability
   ↓
server auth + Casbin
   ↓
STDB file metadata / workflow state
   ↓
Scaleway Object Storage
   ↓
processing pipeline
   ├── spreadsheet parser
   ├── PDF/document parser
   ├── Mistral OCR
   └── optional enrichment/classification
   ↓
normalized artifact / Dataset / ImportProposal
   ↓
STDB reducer approval/apply
```

---

## 2. Core design rules

1. **Object Storage stores bytes; STDB/PG store authoritative metadata and lifecycle.** Bucket keys are never application identities.
2. **Files are organization-scoped resources.** All file operations resolve organization and permissions server-side.
3. **AI/OCR output is untrusted derived content.** It may propose structure/content but cannot directly mutate ERP records.
4. **Imports use proposal/review/apply semantics.** Excel/CSV/document extraction never bypasses reducers.
5. **All processing is idempotent and content-addressed where practical.** Re-upload/retry must not create duplicate business effects.
6. **Large file bytes never flow through STDB tables.** STDB stores refs, hashes, metadata, state, and workflow records.
7. **PG durable projection stores long-lived file metadata/history, not duplicate blobs unless explicitly needed for recovery manifests.**
8. **Object access is mediated.** Frontend/agent receives short-lived upload/download capability, never raw permanent bucket credentials.
9. **Generated application IR may expose file/content operations structurally, but Casbin remains the authorization source.**
10. **Processing failures are isolated from ordinary ERP traffic via bounded queues/concurrency and traffic classes.**

---

## 3. File resource model to investigate

Evaluate a canonical model along these lines:

```rust
pub struct FileAssetRef(pub Uuid);
pub struct FileVersionId(pub Uuid);
pub struct DatasetRef(pub Uuid);
pub struct ImportProposalRef(pub Uuid);

pub struct FileAsset {
    pub id: FileAssetRef,
    pub organization_id: OrganizationId,
    pub logical_path: String,
    pub current_version: FileVersionId,
    pub classification: FileClassification,
    pub lifecycle: FileLifecycle,
}

pub struct FileVersion {
    pub id: FileVersionId,
    pub file_id: FileAssetRef,
    pub content_hash: ContentHash,
    pub media_type: String,
    pub size_bytes: u64,
    pub storage_object_ref: StorageObjectRef,
    pub created_by: UserId,
    pub created_at: Timestamp,
}
```

Investigate whether folder/file navigation should be modeled as logical metadata (`parent_id`, `name`) rather than encoded into S3 keys.

Target user-facing logical namespaces may include:

```text
Organization Files/
  Imports/
  Reports/
  Attachments/
  Exports/
  Generated/
  Contracts/
```

Object keys remain opaque implementation details.

---

## 4. Scaleway Object Storage investigation

Validate:

- bucket strategy: shared bucket with organization prefixes vs dedicated bucket per environment/org class;
- bucket/versioning policy;
- lifecycle/storage-class policy for active vs archived documents;
- encryption-at-rest options and key-management implications;
- signed upload/download URL flow;
- multipart uploads and large-file limits;
- object-lock/version-retention needs for audit/compliance-sensitive documents;
- cross-region bucket availability and future organization migration implications;
- backup/export strategy independent of the live bucket;
- event notification options for triggering processing;
- cost/latency implications from African STDB cells to Scaleway Object Storage.

The investigation should prefer a logical `StorageObjectRef` abstraction so physical bucket/region changes do not leak into file contracts.

---

## 5. Upload and processing lifecycle

Target lifecycle:

```text
create upload intent
      ↓
server derives org + policy
      ↓
short-lived upload URL
      ↓
client uploads bytes directly to Object Storage
      ↓
finalize upload operation
      ↓
verify object exists / hash / size / media type
      ↓
FileVersion becomes Available
      ↓
processing request(s)
      ↓
normalized derived artifacts
```

Investigate lifecycle states such as:

```rust
pub enum FileProcessingState {
    PendingUpload,
    Available,
    Processing,
    Ready,
    NeedsReview,
    Failed,
    Quarantined,
    Archived,
}
```

Finalization must not trust caller-supplied size/hash/object location without server verification.

---

## 6. Spreadsheet / tabular ingestion

Use Excel/CSV onboarding as the first end-to-end proof.

Pipeline:

```text
xlsx/csv
  ↓
parser
  ↓
workbook/sheet metadata
  ↓
normalized Dataset
  ↓
schema inference / mapping proposal
  ↓
field-level validation
  ↓
ImportProposal
  ↓
preview: valid / invalid / warnings
  ↓
user or authorized agent approval
  ↓
STDB reducers apply bounded batches
```

Investigate:

- Rust/JS spreadsheet parsing libraries and where processing should run;
- preservation of workbook sheets/cell references/source row numbers;
- formula handling: evaluated value vs formula text;
- dates/currency/locale normalization;
- large workbook streaming/batching;
- import mapping persistence for repeat uploads maintained by the same organization;
- deterministic import fingerprinting/idempotency;
- reconciliation semantics when an uploaded sheet represents updates rather than creates;
- reusable mapping templates per organization/accountant.

No spreadsheet row becomes ERP state without STDB-owned validation/business reducers.

---

## 7. PDF/document ingestion and Mistral OCR

Investigate Mistral OCR as one document processor, not the canonical document model.

Pipeline:

```text
PDF/image/document
   ↓
content-type validation + malware/safety scan
   ↓
parser decision
   ├── text-native parser
   └── OCR pipeline
          ↓
      Mistral OCR
   ↓
DocumentExtraction
   ├── page text
   ├── page/region provenance
   ├── tables
   ├── images/refs
   └── confidence/processor metadata
   ↓
optional structured extraction agent
   ↓
proposal / content workspace / dataset
```

Define a provider-neutral result shape so another OCR engine can replace/augment Mistral later:

```rust
pub struct DocumentExtraction {
    pub source_file: FileVersionId,
    pub processor: ProcessorDescriptor,
    pub pages: Vec<ExtractedPage>,
    pub content_hash: ContentHash,
    pub extracted_at: Timestamp,
}
```

Investigation questions:

- Mistral OCR supported formats/limits/pricing/latency in the planned Scaleway-hosted harness environment;
- direct file submission vs pre-signed object fetch pattern;
- avoiding permanent external URLs;
- page-level/table provenance necessary for citations back into original documents;
- OCR retries and idempotency;
- confidence thresholds and human-review UX;
- prompt-injection/untrusted-document handling before extracted text reaches agents;
- retention policy for raw OCR responses vs normalized extraction;
- regional latency and processing concurrency limits.

OCR output must be treated as untrusted extracted content and cannot authorize or execute ERP mutations.

---

## 8. Derived artifacts and datasets

Avoid stuffing large extraction payloads into STDB active tables.

Investigate a split such as:

```text
STDB
  FileAsset / FileVersion metadata
  processing state
  Dataset metadata
  ImportProposal workflow
  authorization/business state

PG durable
  durable metadata/history
  import/extraction manifests
  structured rows needed for historical replay/search

Object Storage
  original bytes
  rendered previews
  large normalized extraction artifacts
  generated exports
```

Define stable references between these layers and content hashes so artifacts can be verified after movement/backfill/reactivation.

---

## 9. File manipulation / generated content

Investigate first-class operations for:

- create/copy/move/rename logical file;
- create new file version;
- convert/export dataset to CSV/XLSX;
- generate PDF/document from content workspace;
- annotate/extract selected pages;
- combine/split PDFs where product-useful;
- attach files to ERP entities;
- create report/export snapshots;
- retain provenance from generated output to source datasets/files/operations.

Keep manipulation operations capability-based and organization-scoped. Generated tools should accept `FileAssetRef`/`DatasetRef`, never arbitrary filesystem paths.

---

## 10. IR / generated capability integration

Extend the investigation around application-contract IR with file/content operation kinds.

Example structural metadata:

```rust
pub enum CapabilityResourceKind {
    ErpOperation,
    File,
    Dataset,
    ContentWorkspace,
    Presentation,
}

pub struct GeneratedFileCapability {
    pub capability: CapabilityKey,
    pub operation: OperationName,
    pub input: GeneratedTypeRef,
    pub output: GeneratedTypeRef,
    pub risk: OperationRisk,
    pub traffic: GeneratedOperationTrafficPolicy,
}
```

Candidate generated operations:

```text
files.upload.create_intent
files.upload.finalize
files.list
files.download.create_intent
files.process.request
files.extract.get
datasets.inspect
datasets.map.create
imports.proposal.create
imports.proposal.validate
imports.proposal.apply
content.document.generate
```

Tool discovery may expose these to the AI harness, but every invocation passes through server auth + Casbin and then STDB-owned business/workflow validation.

---

## 11. Agent and AI-panel integration

The AI panel should consume file capabilities through the same generated registry used by UI clients.

Example user request:

```text
"Look at our receivables workbook and show me how overdue balances changed over the last six months."
```

Potential flow:

```text
files/dataset capability
      ↓
inspect normalized dataset
      ↓
ERP/accounting query capabilities
      ↓
presentation capability
      ↓
renderer-neutral table/chart
```

For contract/legal/content workflows:

```text
source files
  ↓
OCR/extraction
  ↓
research/content workspace
  ↓
content proposal with source provenance
  ↓
user review/finalize/export
```

Models may research, summarize, transform, and propose; they do not bypass capability authorization or reducer/business workflows.

---

## 12. Security and resilience investigation

Required topics:

- content-type allowlists and magic-byte verification;
- antivirus/malware scanning options;
- archive/decompression bomb limits;
- PDF parser/OCR sandboxing;
- spreadsheet formula/macro handling;
- prompt injection in uploaded documents;
- signed URL TTL and least privilege;
- object key traversal/path confusion prevention;
- per-org file-size/storage/processing quotas;
- processing traffic classes and bounded concurrency;
- provider timeouts/circuit breaking;
- OCR/parser poison-job handling;
- PII/logging/redaction policy;
- audit records for upload/download/import/finalize/delete actions;
- retention/legal-hold implications.

File processing must not share unbounded worker capacity with interactive ERP requests.

---

## 13. Offline / regional-cell implications

Investigate how file metadata behaves with future regional STDB cells:

- organization file metadata follows canonical OrganizationPlacement;
- Object Storage may remain centralized initially;
- uploads/downloads should continue through signed URLs rather than proxying bytes through a distant STDB cell;
- offline Expo stores metadata, thumbnails, selected files, and queued intents locally as appropriate;
- offline-generated imports remain proposals until reconnected and authorized;
- future disconnected/self-hosted cells may require a local blob store plus later object replication, but this is out of scope for the current implementation.

The file model must not assume the execution cell and physical object-storage region are identical.

---

## 14. Investigation proof cases

### Proof A — Excel onboarding

- upload `.xlsx` through signed intent;
- parse sheets into Dataset;
- infer/map customer/vendor/accounting fields;
- show validation preview;
- create ImportProposal;
- apply through STDB reducers;
- preserve source-file + row provenance.

### Proof B — PDF invoice/document OCR

- upload PDF;
- run parser/OCR;
- produce provider-neutral DocumentExtraction;
- display original page alongside extracted fields/text;
- allow user correction;
- create a draft/proposal only;
- prove no OCR result can directly mutate accounting state.

### Proof C — AI dataset visualization

- authorized agent discovers dataset/file capabilities from generated registry;
- reads allowed Dataset metadata/rows;
- combines with approved ERP queries;
- emits renderer-neutral chart/table presentation;
- audit/telemetry retain correlation IDs.

---

## 15. Deliverables from investigation

- [ ] recommended STDB/PG/Object Storage ownership split;
- [ ] canonical FileAsset/FileVersion/Dataset/ImportProposal schemas;
- [ ] Scaleway Object Storage topology recommendation;
- [ ] upload/download signed-intent design;
- [ ] spreadsheet parser/runtime recommendation;
- [ ] provider-neutral document extraction schema;
- [ ] Mistral OCR integration recommendation and constraints;
- [ ] file-processing worker/queue topology;
- [ ] security/threat-model findings;
- [ ] IR capability additions required;
- [ ] migration/backfill implications for existing attachments/reports;
- [ ] proof implementation plan for Excel + PDF OCR.

---

## 16. Explicitly out of scope for this investigation

- building a full Google Drive/SharePoint replacement;
- collaborative document editing engine;
- arbitrary agent filesystem access;
- direct model bucket credentials;
- OCR output directly mutating ERP state;
- active-active object-store replication across African cells;
- implementing disconnected-cell blob replication;
- legal-document correctness guarantees from OCR/LLM output.
