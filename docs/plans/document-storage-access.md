# Managed document storage, access and folder navigation

## Scope and deployment status

This slice adds a selectable local/S3 backend for managed document files, strengthens the authenticated blob boundary, and makes the existing file browser navigate visible folder ancestry. SpacetimeDB remains authoritative for document, version, folder and template records. The bucket stores bytes and their server-maintained metadata; it is not the user-facing folder tree or an RBAC authority.

**No live Railway cutover is included.** The connected Railway account required reauthentication during inspection, so the deployed bucket, credentials, volume and application configuration were not verified. The [production manifest](../../infra/railway/production-eu-services.json) still describes the local `/data/document-blobs` volume. Enabling S3 and migrating existing objects are separate operator work after the checks below.

This document supplements the [template designer contract](./document-template-designer.md). The older [Documents investigation](../DOCUMENTS_KNOWLEDGE_INVESTIGATION.md) is historical; checked items in the [DMS tracker](./documents-knowledge-gap-fixes-plan.md) are not deployment evidence.

## Storage configuration

Configuration is read by [the API configuration parser](../../api-server/src/config.rs). Document storage is separate from owner-report storage: `LUMIERE_REPORT_ARTIFACT_BACKEND` and `LUMIERE_REPORT_S3_*` do not select the document backend.

| Variable | Meaning / default |
| --- | --- |
| `LUMIERE_DOCUMENT_BLOB_BACKEND` | `local` or `s3`; omitted/empty selects `local`, including in production, to avoid an implicit cutover. |
| `LUMIERE_DOCUMENT_BLOB_DIR` | Local root. Defaults to the OS temporary directory plus `lumiere-document-blobs`; production local storage must point at the intended persistent volume. The current manifest uses `/data/document-blobs`. |
| `LUMIERE_DOCUMENT_S3_ENDPOINT` | Required for S3. HTTPS origin with no embedded credentials, path, query or fragment. Use the endpoint supplied by the configured provider. |
| `LUMIERE_DOCUMENT_S3_BUCKET` | Required S3 bucket name. |
| `LUMIERE_DOCUMENT_S3_REGION` | Required provider region/signing region. |
| `LUMIERE_DOCUMENT_S3_ACCESS_KEY_ID` | Required server-side credential. |
| `LUMIERE_DOCUMENT_S3_SECRET_ACCESS_KEY` | Required server-side credential. |
| `LUMIERE_DOCUMENT_S3_PREFIX` | Optional namespace, default `document-blobs`. Safe path segments only; traversal and empty segments are rejected. |
| `LUMIERE_DOCUMENT_S3_PATH_STYLE` | Optional addressing mode, default `false`. Accepts `true`/`1` or `false`/`0`; choose the mode required by the actual endpoint. |

Selecting `s3` with incomplete or invalid settings fails configuration; storage errors do not fall back to local files. Keep credentials on the server. The UI receives neither bucket credentials nor direct bucket download links.

The [storage adapter](../../api-server/src/document_blob_store.rs) preserves this logical key pair:

```text
org-<organization_id>/<residency>/<object_id>.bin
org-<organization_id>/<residency>/<object_id>.meta.json
```

Local paths prepend `LUMIERE_DOCUMENT_BLOB_DIR`; S3 keys prepend `LUMIERE_DOCUMENT_S3_PREFIX`. Company, creator, purpose, MIME type, completion and checksums belong in trusted metadata and authorized ERP records. A key prefix or residency label alone does not authorize access or prove physical data residency. Folder names and folder moves do not rename stored objects.

## Upload, immutable bytes and authenticated reads

The existing client sequence remains reservation (`presign`) → managed PUT → completion/verification → ERP registration. Despite the historical `presign` and `publicUrl` names, these are application routes. This slice does not issue external S3 presigned URLs or make the bucket public.

Saved references keep the managed route shape:

```text
/api/documents/blobs/object/<organization_id>/<residency>/<object_id>
```

Checksum-pinned consumers additionally use `?sha256=<digest>`. The [blob router](../../api-server/src/document_blobs.rs) resolves the current authenticated session, company membership and purpose-specific access before returning bytes. A backend move therefore does not require replacing document/version URLs.

Binary writes are create-only. Local storage publishes synced files without replacing an existing key. S3 writes send `If-None-Match: *`; an existing object is accepted as an idempotent retry only when its bytes match. Upload completion may update the `.meta.json` sidecar; it cannot rewrite `.bin` content through the metadata operation.

**The actual S3 endpoint must honor conditional creation before it is used for these files.** An S3-compatible API label is insufficient evidence. Verify on an isolated test key that a second PUT with different bytes cannot replace the first object, that the endpoint returns its conditional conflict response, and that a subsequent read retains the original bytes. Local/mock tests verify adapter behavior, not Railway's live response. This mechanism is application immutability; it is not a claim that bucket Object Lock or a retention policy has been enabled.

## Actor and purpose policy

[Upload policy](../../api-server/src/document_blob_policy.rs) separates `document`, `branding` and `expense_receipt` purposes. The reservation fixes `purpose` in server metadata and records `createdBy` from the authenticated session. Later upload, completion and download requests cannot supply a different owner or promote an ordinary document into a branding-preview exception.

- Document bytes require the current permitted document/version projection, matching organization/company, exact managed reference and checksum, and trusted creator provenance. Copying another object's URL into a row is not ownership evidence.
- Expense receipts require the receipt purpose, current receipt-read authority, the recorded uploader, and an authorized receipt with the exact storage key and content hash. Reviewer sharing is not inferred from organization membership. Branding uses its bounded image policy and explicit checksum-pinned template/profile references; these purpose-specific paths are not general document-read grants.
- Unpublished branding previews remain limited to their trusted creator and applicable current permissions. Generated quotation PDFs retain their server-recorded creator and immutable version provenance.
- Missing or invalid trusted creator provenance fails closed. For already archived PDFs marked `generatedPdf`, the existing server-written `generatedBy` is accepted when `createdBy` is absent. This compatibility path does not apply to ordinary legacy uploads.
- An omitted `purpose` defaults to `document`; it never confers branding or receipt access. A legacy object with trusted creator proof may therefore remain a document. Legacy logos need reviewed `createdBy` and `purpose: "branding"` backfill before using the branding path. Existing files acquire no organization-wide fallback simply because they predate this metadata.

The implemented rules are in [document blob access](../../api-server/src/document_blob_access.rs). Server authorization remains authoritative even when a UI control is hidden. [Evidence ingestion](../../api-server/src/evidence_ingestion.rs) also calls `read_authorized_document_blob` before bytes reach extraction or OCR, applying the same current document policy as authenticated GET and rejecting copied-URL access at that entry point.

## Visible folder projection

The [browser projection](../../frontend/web/app/(modules)/documents/file-browser-rows.ts) and [file browser](../../frontend/packages/ui/src/documents/file-browser.tsx) use the actor's supplied document/folder collections. They now support child-folder navigation and breadcrumbs through visible ancestors. Missing or hidden ancestors start a new visible root without exposing ancestor names or IDs. Cycles terminate safely; a disappearing selection returns to current visible files.

The root keeps the existing **All files** view. Folder counts and sizes use the visible files supplied to the browser, not unrestricted database totals. New-folder creation and uploads use the selected folder. The [Documents client](../../frontend/web/app/(modules)/documents/documents-client.tsx) requires current identity/company readiness and create permissions for these controls; scope changes close stale creation forms and stop continued upload work.

This is navigation over the existing authorized projection. It does not introduce team grants, inherited folder ACLs, or a filesystem mount.

## Migration prerequisites and operator sequence

**This slice contains no document-blob migration CLI or automatic legacy backfill.** The existing `storage-migrate` database command is not a file-copy tool. Treat the following as a reviewed migration procedure to implement and execute separately:

1. Inventory the source document/version references and local object pairs. Snapshot the metadata and bytes, and fence all relevant upload, completion, generated-document and ingestion writers before the final copy. Preserve a rollback manifest.
2. Validate each completed `.bin`/`.meta.json` pair: logical key, organization/company, MIME type, completion state, byte length and SHA-256 must agree with its trusted records. Missing or incomplete pairs are exceptions to resolve, not files to silently declare migrated.
3. Review legacy creator/purpose evidence before enabling the stricter access rules for old objects. Use authoritative creation/audit/workflow evidence; a filename, path, caller-supplied URL or current document row alone is insufficient. Keep unverifiable objects unavailable pending reviewed repair or authorized re-upload.
4. Copy both members of every accepted pair under the configured S3 prefix, preserving object IDs and references. Any reviewed metadata backfill must be explicit in the migration manifest. Do not overwrite a conflicting target object.
5. Read back from the destination and verify counts, lengths, metadata and every accepted binary checksum against the manifest. Test the endpoint's conditional-write prerequisite and authenticated allowed/denied reads for each supported purpose, including cross-company, revoked and unproven legacy cases.
6. Select the same backend/bucket/prefix configuration on every service that reads or writes these objects, then deploy through the normal release process. Recheck old and newly created document/version downloads before releasing the writer fence. Record the live configuration and test evidence.

Retain the source copy until migration acceptance. If writes occur after S3 cutover, switching the environment variable back to local is not a complete rollback: reconcile those new pairs with verified copies first. Do not remove the old volume or source files as part of this implementation slice.

## Remaining work / limits

| Area | Status after this slice |
| --- | --- |
| Private S3 document adapter and stable URLs | Implemented in code; live Railway connection, credentials, bucket behavior and cutover remain unverified. |
| Existing object migration | Procedure above only; no production inventory, verified copy or legacy creator/purpose backfill has run. |
| Folder/team access | Existing scoped projection retained. Full read/write member management, team grants, inherited ACLs and complete folder move semantics remain separate work. |
| File redaction | Access may deny delivery. Field masking and template sanitization do not redact sensitive bytes inside an already-saved PDF, image or office file. Policy-specific derivative generation remains unimplemented here. |
| AI/OCR/search | The ingestion entry now authorizes source bytes through the current document policy before extraction/OCR. Permission and revocation propagation across extracted text, embeddings, search, passage retrieval and caches, plus redaction and lifecycle handling, still require implementation review and end-to-end evidence; this slice does not certify those downstream paths. |
| Storage lifecycle | Bucket retention, deletion/garbage collection, backups, residency guarantees and operational recovery require explicit provider configuration and validation. |
| Acceptance | Focused code/UI tests are available. A successful live provider test and real ERP acceptance against the selected backend are required before declaring deployed document storage complete. |
