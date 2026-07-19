# Documents & Knowledge Gap Fixes — Tracker

Executable tracker for the backlog (Pilot → Competitive → Differentiating). Source investigation: [../DOCUMENTS_KNOWLEDGE_INVESTIGATION.md](../DOCUMENTS_KNOWLEDGE_INVESTIGATION.md).

**Product boundary:** SpacetimeDB owns document/folder/version **metadata**, ACL, locks/presence, version events, knowledge text, templates, AI job status, and embedding sync pointers. **Large binaries live in external object storage** (presign via api-server). PDF/XLSX routes in `api-server/src/routes/documents.rs` are report renderers — archive outputs into DMS versions when needed; do not treat them as the blob store.

## Wave A — Pilot integrity (storage + ACL + attach)

- [x] api-server presign upload + verify (size/MIME/checksum) for org/company/residency
- [x] Reject empty `url` / zero `file_size` in `create_document` / `add_document_version` (production policy)
- [x] Fix UI: file picker → upload → `toCreateDocumentParams` with real url/size/checksum (kill `url: ""`, `fileSize: 0n`)
- [x] Enforce folder ACL (`read_access_ids` / `write_access_ids` / `is_access_restricted`) on create/read paths — or remove unused fields
- [x] Record attach panel: set `res_model`/`res_id` from SO/PO/Bill/Expense (and list attachments by res_*)
- [x] Org SQL + subscriptions: `ai-document-processing-jobs`, `ai-insights`; default `documents` filter `is_deleted = false`
- [x] Subscribe or query `document-versions` for detail views
- [x] Company isolation domain tests for folder/document mutate
- [x] Domain suite beyond folder smoke + Playwright upload→lock→attach

## Wave B — Lifecycle productization

- [x] Version upload UI + check-in creates version; lock lease TTL optional
- [x] Soft-delete restore reducer + recycle-bin query
- [x] Knowledge UI: update/delete/lock/unlock/publish/members (hooks already exist)
- [x] Honor `isPublished` on create/update mappers
- [x] Folder rename/move/delete; fix folder `document_count` on move
- [x] Document/mail template admin UI (templates BFF already exists)
- [x] Archive rendered sale-order / account-move PDFs as `document_version` linked to record
- [x] Align `DOCUMENTS_UI_REDUCERS` with actually wired UI ops

## Wave C — Search, retention, regional

- [x] Worker populates `index_content` and/or external FTS; basic search UI
- [x] Language/analyzer settings keyed by country pack (pt-BR, es, ms, id, th, …)
- [x] Document retention classification + purge worker (extend privacy patterns; not messaging-only)
- [x] Residency-tagged `storage_id` / region on folder or org pack
- [x] Pack-aware archive expectations for fiscal PDFs/XML (NF-e, MyInvois, e-Faktur) as linked versions

## Wave D — Differentiating integrations

- [x] Legal hold table + block delete/purge
- [x] OCR worker: job ↔ `document_id`/version URL → approved extraction for expenses/AP
- [x] Google Drive sync worker → Document rows (credentials remain external)
- [x] E-sign provider integration (external TSP) → completed PDF version
- [x] Collaborative presence table/reducers for docs/articles
- [x] Bidirectional Drive/SharePoint conflict policy

## Out of scope (do not invent here)

- Storing file bytes inside SpacetimeDB tables
- Replacing accounting PDF renderers with a new report engine in Wave A
- Full enterprise ECM (SharePoint parity) before storage + ACL + attach
