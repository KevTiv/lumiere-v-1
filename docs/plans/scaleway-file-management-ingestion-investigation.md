# Scaleway file management, ingestion, and document-processing investigation

**Status:** Investigation — 2026-08-20
**Tracks:** `file-management`, `object-storage`, `dataset-import`, `document-processing`, `mistral-ocr`, `agent-capabilities`, `manual-fallback`
**Related:** [sliding-window-cold-tier.md](./sliding-window-cold-tier.md) · [agent-harness-capability-ir-foundation.md](./agent-harness-capability-ir-foundation.md) · [regional-stdb-scaleway-durable-foundation.md](./regional-stdb-scaleway-durable-foundation.md)

---

## 1. Objective

Investigate and define the production architecture for first-class organization files on Scaleway while preserving the current STDB authority model.

The target is to support user-managed Excel/CSV/PDF/document workflows, OCR/extraction, AI-assisted inspection, import proposals, generated reports/content, and durable archival without allowing Object Storage, OCR workers, or AI models to become business-authority surfaces.

A core requirement is graceful manual fallback: file management and import/review workflows must remain fully usable when OCR, AI, parser inference, or enrichment services are unavailable, disabled, or uncertain.

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
manual review/correction always available
   ↓
STDB reducer approval/apply
```

---

## 2. Core design rules

1. **Object Storage stores bytes; STDB/PG store authoritative metadata and lifecycle.** Bucket keys are never application identities.
2. **Files are organization-scoped resources.** All file operations resolve organization and permissions server-side.
3. **AI/OCR output is untrusted derived content.** It may propose structure/content but cannot directly mutate ERP records.
4. **Imports use proposal/review/apply semantics.** Excel/CSV/document extraction never bypasses reducers.
5. **Manual operation is first-class.** Users can manage files, correct metadata, map columns/fields, classify documents, and complete review/apply flows without AI/OCR availability.
6. **All processing is idempotent and content-addressed where practical.** Re-upload/retry must not create duplicate business effects.
7. **Large file bytes never flow through STDB tables.** STDB stores refs, hashes, metadata, state, and workflow records.
8. **PG durable projection stores long-lived file metadata/history, not duplicate blobs unless explicitly needed for recovery manifests.**
9. **Object access is mediated.** Frontend/agent receives short-lived upload/download capability, never raw permanent bucket credentials.
10. **Generated application IR may expose file/content operations structurally, but Casbin remains the authorization source.**
11. **Processing failures are isolated from ordinary ERP traffic via bounded queues/concurrency and traffic classes.**
12. **Automation failure never blocks ordinary file CRUD/navigation.** Move/rename/version/download/attach/manual import mapping remain independent from enrichment workers.

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
optional processing request(s)
      ↓
normalized derived artifacts / NeedsReview
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

`Available` must be a usable state on its own. Processing enriches the file but is not required to list, organize, download, version, attach, or manually review it.

Finalization must not trust caller-supplied size/hash/object location without server verification.

---

## 6. Manual/user-driven fallback requirements

The frontend must expose file-management workflows that remain useful without automation.

At minimum investigate first-class UX for:

- create folder/logical collection;
- upload, download, rename, move, copy, archive, restore, delete where policy permits;
- create/inspect file versions and version history;
- attach/detach files to ERP entities;
- manually set classification/document type/tags/description;
- manually select spreadsheet sheet/header row/data range;
- manually map spreadsheet columns to import fields;
- manually correct inferred types, currencies, dates, identifiers, and validation errors;
- manually enter/correct extracted PDF fields alongside the source-page preview;
- manually mark OCR regions/fields as accepted/rejected/unknown;
- manually create an import proposal even when AI inference is unavailable;
- retry, skip, replace, or cancel failed processing jobs without losing the original file;
- inspect source provenance for any generated/extracted value.

Design principle:

```text
base file workflow
  works without AI/OCR
       ↓
automation adds suggestions
       ↓
user can accept/edit/reject
```

Avoid designing screens where `Processing` is a blocking modal state that prevents ordinary file interaction.

### Manual fallback states

Investigate explicit UX states such as:

```text
Automation unavailable
Automation pending
Automation failed
Automation low-confidence
Manual review requested
Manual-only mode
```

These are workflow states, not permission bypasses. All user actions still pass through generated capabilities, Casbin, and STDB validation.

### User-maintained import templates

For recurring spreadsheets maintained by customers/accountants, investigate organization-owned mapping templates:

```rust
pub struct ImportMappingTemplate {
    pub organization_id: OrganizationId,
    pub resource: ResourceKey,
    pub name: String,
    pub source_shape_fingerprint: Option<ContentHash>,
    pub mappings: Vec<FieldMapping>,
    pub created_by: UserId,
    pub version: u64,
}
```

This provides a non-AI path where a user maps a workbook once and safely reuses that mapping for later uploads.

---

## 7. Spreadsheet / tabular ingestion

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
optional schema inference / mapping proposal
  ↓
manual mapping/correction always available
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
- reusable mapping templates per organization/accountant;
- manual mapping UX that does not depend on an AI-produced first guess.

No spreadsheet row becomes ERP state without STDB-owned validation/business reducers.

---

## 8. PDF/document ingestion and Mistral OCR

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
manual correction/review
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
- ability to continue with manual extraction/correction when OCR is unavailable;
- prompt-injection/untrusted-document handling before extracted text reaches agents;
- retention policy for raw OCR responses vs normalized extraction;
- regional latency and processing concurrency limits.

OCR output must be treated as untrusted extracted content and cannot authorize or execute ERP mutations.

---

## 9. Derived artifacts and datasets

Avoid stuffing large extraction payloads into STDB active tables.

Investigate a split such as:

```text
STDB
  FileAsset / FileVersion metadata
  processing state
  Dataset metadata
  ImportProposal workflow
  manual-review state
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

## 10. File manipulation / generated content

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

Every automation-backed manipulation should have a user-driven equivalent or a clear manual fallback where practical.

---

## 11. IR / generated capability integration

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
files.rename
files.move
files.version.list
files.metadata.update
files.download.create_intent
files.process.request
files.process.cancel
files.extract.get
datasets.inspect
datasets.map.create
datasets.map.update
imports.proposal.create
imports.proposal.validate
imports.proposal.apply
content.document.generate
```

Tool discovery may expose these to the AI harness, but every invocation passes through server auth + Casbin and then STDB-owned business/workflow validation.

The same generated operations should back ordinary manual frontend interactions; do not create an AI-only file API.

---

## 12. Agent and AI-panel integration

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
OCR/extraction (optional accelerator)
  ↓
research/content workspace
  ↓
content proposal with source provenance
  ↓
user review/edit/finalize/export
```

Models may research, summarize, transform, and propose; they do not bypass capability authorization or reducer/business workflows. If agent/OCR services are disabled, users must still be able to open files, edit metadata, perform manual mappings/review, and continue supported workflows.

---

## 13. Security and resilience investigation

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
- retention/legal-hold implications;
- degradation behavior proving provider outages do not block base file CRUD or manual review.

File processing must not share unbounded worker capacity with interactive ERP requests.

---

## 14. Offline / regional-cell implications

Investigate how file metadata behaves with future regional STDB cells:

- organization file metadata follows canonical OrganizationPlacement;
- Object Storage may remain centralized initially;
- uploads/downloads should continue through signed URLs rather than proxying bytes through a distant STDB cell;
- offline Expo stores metadata, thumbnails, selected files, and queued intents locally as appropriate;
- offline-generated imports remain proposals until reconnected and authorized;
- manual file navigation/metadata editing should degrade predictably when the bytes are not locally cached;
- future disconnected/self-hosted cells may require a local blob store plus later object replication, but this is out of scope for the current implementation.

The file model must not assume the execution cell and physical object-storage region are identical.

---

## 15. Investigation proof cases

### Proof A — Excel onboarding

- upload `.xlsx` through signed intent;
- parse sheets into Dataset;
- infer/map customer/vendor/accounting fields when automation is available;
- prove the same mapping can be completed manually from scratch;
- show validation preview;
- create ImportProposal;
- apply through STDB reducers;
- preserve source-file + row provenance;
- save/reuse an organization-owned mapping template.

### Proof B — PDF invoice/document OCR

- upload PDF;
- run parser/OCR;
- produce provider-neutral DocumentExtraction;
- display original page alongside extracted fields/text;
- allow user correction;
- disable/fail OCR and prove the user can manually enter/correct the draft fields;
- create a draft/proposal only;
- prove no OCR result can directly mutate accounting state.

### Proof C — AI dataset visualization

- authorized agent discovers dataset/file capabilities from generated registry;
- reads allowed Dataset metadata/rows;
- combines with approved ERP queries;
- emits renderer-neutral chart/table presentation;
- audit/telemetry retain correlation IDs;
- remove AI availability and prove the Dataset remains inspectable/exportable through normal UI.

### Proof D — provider outage/manual continuity

- simulate Mistral OCR/enrichment outage;
- upload/list/move/rename/download/version files successfully;
- create manual spreadsheet mapping/import proposal;
- manually classify/correct a document;
- queue optional enrichment for later retry;
- prove no user data or review state is lost.

---

## 16. Deliverables from investigation

- [ ] recommended STDB/PG/Object Storage ownership split;
- [ ] canonical FileAsset/FileVersion/Dataset/ImportProposal schemas;
- [ ] Scaleway Object Storage topology recommendation;
- [ ] upload/download signed-intent design;
- [ ] baseline manual file-management UX/capability set;
- [ ] spreadsheet parser/runtime recommendation;
- [ ] manual mapping + reusable organization template design;
- [ ] provider-neutral document extraction schema;
- [ ] Mistral OCR integration recommendation and constraints;
- [ ] manual OCR/document review fallback design;
- [ ] file-processing worker/queue topology;
- [ ] security/threat-model findings;
- [ ] IR capability additions required;
- [ ] migration/backfill implications for existing attachments/reports;
- [ ] proof implementation plan for Excel + PDF OCR + provider-outage continuity.

---

## 17. Explicitly out of scope for this investigation

- building a full Google Drive/SharePoint replacement;
- collaborative document editing engine;
- arbitrary agent filesystem access;
- direct model bucket credentials;
- OCR output directly mutating ERP state;
- making AI/OCR mandatory for ordinary file management;
- active-active object-store replication across African cells;
- implementing disconnected-cell blob replication;
- legal-document correctness guarantees from OCR/LLM output.
