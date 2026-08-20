# Pre-bucket lightweight file development mode

**Status:** Temporary development constraint — 2026-08-20
**Related:** [scaleway-file-management-ingestion-investigation.md](./scaleway-file-management-ingestion-investigation.md) · [agent-harness-capability-ir-foundation.md](./agent-harness-capability-ir-foundation.md)

## Objective

Keep file-management development usable before Scaleway Object Storage is provisioned without turning the developer laptop into a long-lived blob store.

The production contracts should still target a provider-neutral `StorageObjectRef`, signed upload/download intents, organization-scoped file metadata, and later Scaleway Object Storage. The temporary local mode exists only to exercise metadata, workflow, parsing, and UI behavior with very small bounded fixtures.

```text
production target
client → signed intent → Scaleway Object Storage → processing

pre-bucket development
client/test fixture → bounded ephemeral storage adapter → processing
```

## Rules

1. Do not build a persistent local S3 replacement as a prerequisite for the file-management work.
2. Do not commit large PDFs, workbooks, OCR outputs, generated exports, or extracted artifacts to the repository.
3. Keep local fixture bytes deliberately tiny and bounded.
4. Prefer temporary directories/files that are removed after the test/process completes.
5. Keep STDB/PG records using the same logical `FileAssetRef`, `FileVersionId`, and `StorageObjectRef` abstractions planned for production.
6. No application/domain code may depend on a local filesystem path being the permanent file identity.
7. Parsing/OCR tests should operate on minimal representative fixtures and mocked/provider-recorded normalized outputs where appropriate.
8. Large-file, multipart, retention, lifecycle, and real signed-URL behavior remain Scaleway-integration proofs and should not be emulated by storing large local corpora.

## Storage adapter boundary

Use one narrow infrastructure abstraction so production storage can replace the temporary implementation without changing application contracts.

```rust
pub trait BlobStore {
    async fn put_ephemeral(&self, input: BlobInput) -> Result<StorageObjectRef>;
    async fn open(&self, object: &StorageObjectRef) -> Result<BlobReader>;
    async fn metadata(&self, object: &StorageObjectRef) -> Result<BlobMetadata>;
    async fn delete(&self, object: &StorageObjectRef) -> Result<()>;
}
```

Production should add signed upload/download intent operations around Scaleway Object Storage rather than exposing this infrastructure interface directly to clients.

Temporary local implementation requirements:

- root under an OS temp/cache directory, never a durable project directory;
- strict total-size and per-file-size caps;
- startup/test cleanup of stale temporary files;
- content hash and media-type metadata still recorded;
- opaque `StorageObjectRef` values rather than leaking absolute paths;
- optional in-memory adapter for very small unit tests.

## Suggested development limits

Keep defaults intentionally small, for example:

```text
unit fixture            <= 1 MB
manual dev upload       <= 10 MB
temporary local budget  <= 100–250 MB
```

Exact values are configuration, not contract semantics. When exceeded, development mode should fail explicitly with guidance to use the provisioned Object Storage environment rather than silently filling disk.

## Spreadsheet/PDF development before bucket provisioning

For Excel/CSV:

- use tiny workbooks covering multiple sheets, dates, currencies, formulas, malformed rows, and mapping edge cases;
- store normalized Dataset outputs in tests rather than large source workbooks;
- prove manual mapping/import proposal workflows independently from storage scale.

For PDF/OCR:

- use a few tiny representative PDFs/images;
- keep provider-neutral `DocumentExtraction` fixtures for most UI/workflow tests;
- call Mistral OCR only in explicit integration tests when credentials/provider access are available;
- discard temporary source and derived bytes after the run unless an explicit debug flag is enabled.

## Frontend behavior

The frontend should not care whether the current storage adapter is local temporary storage or Scaleway Object Storage.

Keep the same conceptual operations:

```text
files.upload.create_intent
files.upload.finalize
files.list
files.download.create_intent
files.process.request
```

In pre-bucket mode the server may implement the upload/download intent with a development-only local endpoint. Do not let feature code switch on filesystem paths or import a local storage implementation directly.

## Transition to Scaleway Object Storage

Once the bucket exists:

1. add the Scaleway/S3 `BlobStore` implementation;
2. switch upload/download intents to short-lived signed URLs;
3. run real object existence/hash/size verification on finalize;
4. run multipart/large-file integration tests remotely;
5. validate lifecycle/versioning/encryption/retention configuration;
6. disable persistent use of the local adapter outside tests/development;
7. keep the local bounded adapter for deterministic unit/integration fixtures only.

There should be no migration requirement for temporary development blobs. They are disposable by design.

## Acceptance criteria

- file metadata/workflow/IR development can proceed before bucket provisioning;
- local file usage is bounded and automatically disposable;
- no production contract depends on local filesystem semantics;
- ordinary manual file-management and import UX can be developed with small fixtures;
- Mistral OCR/file-processing integration can be mocked through normalized provider-neutral artifacts;
- switching to Scaleway Object Storage requires an infrastructure-adapter change and integration tests, not a frontend/domain rewrite.