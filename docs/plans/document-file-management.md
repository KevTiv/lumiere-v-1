# Shared document viewing, recoverable saving, and folder operations

## Delivery scope

Documents and ERP attachments share the same modal viewer for CSV, PDF, supported images, literal text, and inspected XLSX and DOCX. It uses the existing Documents records and immutable versions. The viewer checks the current organization, company, actor, permissions, exact version, and checksum before delivery. Opening a preview does not discard the Documents browser location. Changing the workspace or losing access clears the preview; an outdated response cannot replace the newly selected version.

CSV previews preserve report-shaped rows, including irregular headers, rather than applying the flat-column import contract. Text is displayed literally, not executed as HTML. Preview reads and displayed rows are bounded. Image/PDF object URLs are revoked on replacement and close. Downloads perform a fresh authorization check and retain the server's inspection policy.

Uploads from Documents, version check-in, ERP attachments, chatter, bill originals, and rendered PDF archives use the shared recoverable receipt flow. A receipt binds the authenticated actor/company, upload intent, immutable object, document, and exact version. Retry resumes that intent. A lost registration response or failed AI indexing does not request another document or version. Saving and indexing have distinct outcomes; unsupported AI input is shown as saved with indexing unavailable. Historical version recovery does not overwrite a newer version or release somebody else's lock.

Folders support create, edit/rename, move, explicit move to root, trash, and restore. Documents support explicit move to root from both the list and detail page. Moves validate current source and destination authority, ancestry, scope, cycles, and access widening. Folder trash records a lifecycle marker on the selected root and retains its descendants and file versions. Descendants become unavailable through ancestor checks. Restoring the root preserves independently trashed children and individually deleted files. Permanent empty-folder deletion remains a separate legacy operation and is not exposed by these controls.

Authorized HTTP projections serve document, folder, and version collections. These resources do not accept an unfiltered SQL subscription snapshot that could reinsert rows hidden by ancestor permissions or trash. Visible workspaces refresh them through HTTP every 15 seconds and immediately on window focus; background polling is disabled. Byte delivery and mutations still check current authority on every request. Folder counts reflect only currently visible files. Generated reducer/operation contracts must be published and pinned through the repository's normal contract workflow before this branch is released.

Office previews use the same checksum-pinned byte delivery path as other managed files. The server checks the selected document and version before and after parsing. The isolated worker returns literal data for up to 24 visible worksheets, with up to 100 rows and 20 columns per worksheet. DOCX previews show body paragraphs and simple tables, up to 200 blocks. The viewer indicates when it clips content. The package limit is 5 MB. Active features, external relationships, hidden sheets and dimensions, and workbook formulas require a supported static copy. Multi-sheet XLSX and DOCX are retained for manual use. The existing values-only single-sheet XLSX import and AI checks still apply.

## Storage migration preparation

`document-blob-migrate` is included in the API runtime image. It can prepare a local inventory, copy immutable objects, verify them, and copy a reviewed S3 manifest back to a recovery directory. It never selects the application's storage backend, rewrites database URLs, removes source files, or changes bucket settings.

The existing [storage configuration and access contract](./document-storage-access.md) still applies. S3 settings use `LUMIERE_DOCUMENT_S3_*`; preparing a migration does not require changing `LUMIERE_DOCUMENT_BLOB_BACKEND` from `local`. Credentials are read from server configuration and are excluded from manifests and verification reports.

### 1. Establish the complete reference inventory

Take consistent, authoritative exports of current documents, **all retained document versions**, saved import admissions/originals, import preparations, and review bindings. Include deleted-but-retained records and every organization/company in the migration. Do not build this inventory from one user's permission-filtered Documents page.

Convert each managed reference into a logical storage key and its independently recorded SHA-256. Document URLs map to `.bin` keys; recovery records may reference `.meta.json` objects. Keep the record ID and reference kind so reviewers can reconcile the counts against the exports:

```json
[
  {
    "kind": "document",
    "recordId": "101",
    "key": "org-7/eu/immutable-object.bin",
    "sha256": "<64 lowercase hexadecimal characters>"
  },
  {
    "kind": "document_version",
    "recordId": "202",
    "key": "org-7/eu/previous-object.bin",
    "sha256": "<independently recorded version checksum>"
  },
  {
    "kind": "import_original",
    "recordId": "<admission identifier>",
    "key": "org-7/import-admissions/<admission identifier>.bin",
    "sha256": "<recorded source checksum>"
  }
]
```

Accepted reference kinds are `document`, `document_version`, `import_original`, `import_preparation`, and `import_review_binding`. Distinct records may legitimately refer to the same immutable object. Preserve export evidence outside the blob directory.

The tool verifies supplied reference bindings against object checksums, but **cannot prove that an external database export was complete**. A zero/subset reference list is not migration acceptance. Reconcile counts and missing references explicitly. Legacy metadata repair needs independently reviewed provenance; this tool does not infer an uploader from a copied URL or silently backfill ownership.

### 2. Plan and resolve exceptions

```sh
document-blob-migrate plan /data/document-blobs /migration/references.json /migration/manifest.json
```

The manifest must be a new file outside the source root. Planning enumerates all managed local objects, including upload receipts and import preparation/review sidecars. It validates completed binary/metadata pairs, trusted creator/import provenance, organization/key binding, lengths, and SHA-256. Symlinks, unsupported files, missing references, corrupt pairs, and incomplete uploads fail the plan. Resolve these exceptions explicitly; do not silently omit them to make the copy succeed.

Metadata-only recovery records are preserved byte-for-byte. Their presence and checksum are preservation evidence, **not proof that application recovery succeeds**. Rehearse the recovery flows in step 4.

### 3. Fence writers and copy

Before the final plan and copy, fence every service that can upload, complete, generate, register, index, or update recovery/import records. Capture a consistent database/source snapshot and a fresh manifest while the fence is held. The flag below records the operator's assertion; it does not establish the fence itself.

```sh
document-blob-migrate copy /data/document-blobs /migration/manifest.json --writers-fenced
document-blob-migrate verify /data/document-blobs /migration/manifest.json
```

Copy verifies the complete local inventory before writing, creates binary objects before metadata, and uses immutable create-only writes for both. An interrupted copy can be resumed. Existing identical objects are accepted; conflicting destination bytes are never replaced. Every target object is read back and checked, and the source is checked again to detect intervening changes. Preserve the JSON verification reports, manifest hash, counts, byte totals, reference totals, and non-secret target descriptor.

For a local rehearsal, pass `--local-target /rehearsal/document-blobs` to both commands. Source and target directories must not overlap. The same library path has regression coverage for interrupted copies, conflicting targets, historical versions, import originals, sidecar preservation, source changes, and recovery into a separate directory.

Local verification compares the complete local inventory. **S3 verification covers only manifest keys**, not the entire bucket. `completeLocalInventory: false` in an S3 report is intentional. Establish destination-prefix ownership and investigate unexpected target keys separately. Verify the actual provider's conditional-write behavior; the mock S3 test is not provider certification.

### 4. Rehearse application access and recovery

On an isolated deployment using the verified destination and a consistent database snapshot:

- Preview/download current files and historical versions from Documents and ERP attachments. Include an imported original and a retained/deleted record restored through normal application controls.
- Verify allowed/denied access, revoked membership, cross-company requests, and folders with restricted or trashed ancestors.
- Resume a saved upload receipt after an uncertain registration response. Confirm its document and version IDs do not change and no extra rows are created.
- Retry failed AI indexing independently. Confirm disallowed input remains saved without inappropriate indexing retries, and recovery of a historical version cannot index a newer file as if it were the original request.
- Resume a saved import preparation/review and verify the exact original bytes/checksum and provenance still resolve.
- Recover the reviewed manifest to a separate local directory and repeat representative file/receipt/import checks against it.

```sh
document-blob-migrate recover /recovery/document-blobs /migration/manifest.json --writers-fenced
```

Do not use successful byte-copy tests as a substitute for this application rehearsal.

### 5. Enable only after acceptance

Accept the migration only when the authoritative reference inventory reconciles, every object passes checksum readback, conditional creation works at the actual endpoint, and the access/recovery rehearsals pass. Record the accepted manifest hash and evidence with the normal release review. Then select the same backend/bucket/prefix for every reader and writer, deploy, verify old/current/new downloads, and release the fence.

Retain the original source and database snapshot through acceptance. If S3 receives new writes after cutover, the old manifest and local directory are no longer a complete rollback. Fence again, inventory and verify those additional objects and references, and reconcile them before switching back. The recovery command copies only the reviewed manifest; it does not discover post-cutover data automatically. No source cleanup, live migration, or backend activation is part of this PR.
