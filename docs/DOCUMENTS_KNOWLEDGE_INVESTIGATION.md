# Documents & Knowledge Management Investigation

Current-state assessment of Lumiere documents / knowledge against a NetSuite *quality* bar (integrated ops/finance attachments, multi-entity, drill-down from records, workflow controls, localization, extensibility, lifecycle, integrations) — not a File Cabinet feature-copy checklist.

**Investigation date:** 2026-07-18  
**Method:** Source-traced inventory. “Verified” means present in code. Domain/E2E test names are listed as *existence*; this document does not claim those suites were executed as part of this investigation unless noted under Validation.

**Verdict:** Lumiere has a **metadata-first DMS + wiki spine** — folders, documents with soft-delete and lock, immutable version rows, knowledge categories/articles with publish/member/lock, HTML document/mail templates, AI processing-job and insight tables, Google Drive *connection* config, and search-embedding rows aimed at external vector sync. Against the quality bar it is **unsuitable as an operational document system for pilot**: create paths store empty `url` / zero `file_size` with no object-storage upload, folder ACLs and share links are schema-only, version upload and most knowledge lifecycle ops are backend-ahead-of-UI, retention/legal hold do not apply to documents, full-text/`index_content` is never populated, e-signatures are absent, and generated PDF/XLSX routes are ERP *report* exporters — not File Cabinet storage. Large binaries correctly should **not** live in the SpacetimeDB transaction store; today there is also **no** external blob boundary wired to document versions.

**Quality benchmark (not a spec):** Oracle NetSuite File Cabinet / Document Management patterns emphasize folder hierarchy, record attachments, permissioned access, version history, and integration with transactional records and SuiteApps ([NetSuite File Cabinet](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2858596.html); [Documents and Files](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/chapter_N2857202.html)). Lumiere is judged on whether it can meet that *depth of control, attachability, and evidence integrity* with SpacetimeDB holding metadata/auth/events and object storage holding blobs — not on SuiteApp OCR/signature parity.

**V1 roadmap reconciliation:** `docs/V1_ROADMAP.md` does **not** currently call out a Documents / Knowledge wedge. Treat this investigation as the source of truth until a roadmap claim is added. Tracker: `docs/plans/documents-knowledge-gap-fixes-plan.md` (to be executed after this investigation).

**Compile check:** `cargo check` in `spacetimedb/` — **passed** (2026-07-18; unrelated warnings in subscriptions).

---

## 1. Verified inventory

### 1.1 Tables (`spacetimedb/src/documents` + adjacent)

| Area | Tables (accessor) | File | Notes |
|------|-------------------|------|-------|
| Folders | `doc_folder` (`DocumentFolder`) | `documents/documents.rs` | Hierarchy via `parent_id` / `parent_path`; `storage_id`; ACL vectors; share fields; company optional |
| Documents | `document` (`Document`) | `documents/documents.rs` | Metadata + `url`; `res_model`/`res_id` record link; lock; soft-delete; `index_content` unused; checksum unused |
| Versions | `document_version` | `documents/documents.rs` | Immutable snapshots; `url` per version; `is_current` |
| KB categories | `kb_category` | `documents/knowledge.rs` | Hierarchy; article_count |
| KB articles | `knowledge_article` | `documents/knowledge.rs` | Body in-row; lock/publish/members; permission string fields |
| Doc templates | `document_template` | `documents/templates.rs` | HTML layouts for PDF generation by `model` |
| Mail templates | `mail_template` | `documents/templates.rs` | Email + optional `document_template_id` |
| AI OCR jobs | `ai_document_processing_job` | `ai/intelligence.rs` | Job status machine; extracted JSON; approve flag — **no FK to `document.id`** |
| AI insights | `ai_insight` | `ai/intelligence.rs` | Shared with Settings AI; acknowledge path |
| Search vectors | `search_embedding` | `ai/intelligence.rs` | Text + Qdrant sync fields; content_type can be `document`/`article` |
| Drive config | `google_drive_connection` | `integrations/google_drive.rs` | Credential *references* only; sync metadata; **not wired to upload** |
| Privacy (adjacent) | `data_classification`, rules, `privacy_consent` | `core/privacy.rs` | Retention days + purge — **operational messages only in v1** |
| Numbering (adjacent) | `document_sequence` | `core/reference.rs` | SO/PO/INV counters — **not** DMS file numbering |
| Messaging (adjacent) | `mail_message` | `core/messaging.rs` | Queued from `queue_mail_from_template` |

**Not present as tables:** legal hold, retention policy on documents, check-out ticket distinct from lock, collaborative presence/session, signature request/envelope, OCR blob staging, object-storage handle registry, document↔ACL grant table beyond folder vectors.

### 1.2 Backend reducers (callable SpacetimeDB surface)

**Core DMS (`documents/documents.rs`):**  
`create_document_folder`, `create_document`, `add_document_version`, `lock_document`, `unlock_document`, `delete_document` (soft), `update_document`, `record_document_view`

**Knowledge (`documents/knowledge.rs`):**  
`create_knowledge_category`, `update_knowledge_category`, `delete_knowledge_category`, `create_knowledge_article`, `update_knowledge_article`, `delete_knowledge_article`, `lock_knowledge_article`, `unlock_knowledge_article`, `set_article_published`, `add_article_member`, `remove_article_member`

**Templates (`documents/templates.rs`):**  
`create_document_template`, `update_document_template`, `create_mail_template`, `update_mail_template`, `queue_mail_from_template`

**Imports (`data_ops/document_imports.rs`):**  
`import_knowledge_category_csv`, `import_knowledge_article_csv`

**AI (`ai/intelligence.rs` — documents-adjacent):**  
`create_document_processing_job`, `complete_document_processing_job`, `approve_document_processing_job`, `upsert_search_embedding`, embedding sync/delete helpers, insight acknowledge (shared)

**Integrations:**  
`create_google_drive_connection`, `update_google_drive_connection`, `update_google_drive_credentials`, `record_google_drive_sync`, `record_google_drive_sync_error`

| Reducer | Behavior | Gap |
|---------|----------|-----|
| `create_document_folder` | Org guard on parent; owner write ACL = sender; audit | No folder ACL update reducer; share_link never set |
| `create_document` | Folder org guard; creates v1; bumps folder count; `checksum`/`index_content` forced `None` | Accepts any `url` string; no blob verify; no ACL on document itself |
| `add_document_version` | Lock-aware; marks prior not current | Checksum unused; no size/MIME policy |
| `lock` / `unlock` | Exclusive edit lock; admin force-unlock | Not true check-in/out with version on unlock; no timeout |
| `delete_document` | Soft-delete; locked blocked | No restore; no hard purge; blob GC absent |
| `update_document` | Metadata + folder/tags/res_* | Folder move does not adjust folder counts |
| `record_document_view` | last_viewed_* | Does not increment `download_count` despite comment |
| Knowledge CRUD / lock / publish / members | Org guards + audit | Permission strings not enforced as ACL; body stored in STDB (OK for wiki text) |
| Templates CRUD + queue mail | Permission + audit; queues `MailMessage` | Rendering is api-server HTML→PDF path, not STDB |
| KB CSV import | Creates rows | No company scope; can bypass richer create validation |
| AI processing jobs | Status + extract JSON + approve | No link to `document` / version URL; OCR worker external |
| Google Drive | Connection config only | No file sync reducer that creates `Document` rows |
| Search embedding upsert | Pending sync to Qdrant | No reducer fills `document.index_content` |

### 1.3 Frontend contracts (BFF / hooks)

[`DOCUMENTS_BFF_REDUCERS`](../frontend/packages/stdb/src/commands/documents-http.ts): **26** keys (DMS + knowledge + AI jobs/insights). Compile contract enumerates them. **0 phantoms** vs generated reducers for those keys.

[`TEMPLATES_BFF_REDUCERS`](../frontend/packages/stdb/src/commands/templates-http.ts): document/mail template create/update + `queue_mail_from_template` — **separate** from documents BFF.

| Surface | Status |
|---------|--------|
| Query hooks | Documents, folders, articles, categories, AI jobs, insights |
| Hooks without UI | `add_document_version`; knowledge update/delete/lock/unlock/publish/members; category update/delete |
| Create params | `toCreateDocumentParams` hardcodes `fileSize: 0n`, `url: ""` |
| Templates | `useDocumentTemplates` unused; mail template queue used from Accounting; create/update template hooks **missing** |
| Contract test | `documents.contract.ts` — compile-only BFF enumeration |

### 1.4 Subscriptions & queries

`DOCUMENTS_WORKSPACE_RESOURCE_KEYS` ([`documents-workspace.ts`](../frontend/packages/stdb/src/subscriptions/documents-workspace.ts)): six keys.

| Key | In `ERP_ORG_SQL` | In `erp-subscriptions.ts` SQL builder | Notes |
|-----|------------------|----------------------------------------|-------|
| `documents` | Yes | Yes | Org-scoped; **no** `is_deleted = false` filter |
| `document-folders` | Yes | Yes | Org-scoped |
| `knowledge-articles` | Yes | Yes | Org-scoped |
| `knowledge-categories` | Yes | Yes | Org-scoped |
| `ai-document-processing-jobs` | **No** | **No** | In resource registry + HTTP query; **not** org-SQL / WS mirror |
| `ai-insights` | **No** | **No** | Same |

**Absent subscription resources:** `document-versions`, `document_template`, `mail_template`, `search_embedding`, `google_drive_connection`.

SSR prefetch (`documents/page.tsx`) uses the same six keys via `serverFetchQueryListsAllowEmpty`.

### 1.5 UI operations (`/documents`)

Tabs from module config + [`documents-client.tsx`](../frontend/web/app/(modules)/documents/documents-client.tsx):

| Tab / surface | End-to-end operations | Gaps |
|---------------|----------------------|------|
| Dashboard | Live KPIs; Upload Document / New Article quick actions | “Upload” = metadata create |
| Documents | Create / edit / lock / unlock / record view / delete | Empty URL/size; no file picker; no version UI; no record-link picker |
| Knowledge base | Create article; CSV import | No edit/delete/lock/publish/members UI; `isPublished` form field ignored |
| Knowledge categories | Create; CSV | No update/delete UI |
| Document folders | Create folder | No move/rename/ACL/share; `storageId` not collected |
| Document processing | Create / complete / approve jobs | Manual/ops-style; no blob/OCR pipeline |
| Document insights | Acknowledge; generate via AI skill | Not document-body search |
| Templates | — | **No tab**; Accounting queues mail templates; Sales/Reports use PDF export helpers |
| api-server `/v1/documents/*` | PDF/CSV/XLSX for sale-order, account-move, financial-report, pivot | **Report generation**, not DMS blob storage |

### 1.6 Tests (existence only)

| Layer | What exists | Not covered |
|-------|-------------|-------------|
| Domain | `run_documents_folder_test` → folder create smoke (`platform_smoke.rs`) | Document create/version/lock; knowledge; ACL; soft-delete restore; isolation |
| Contract | `documents.contract.ts` BFF keys | Runtime reducer presence; templates BFF |
| Playwright | `phase-6-platform-smoke.spec.ts` — tab sweep / button visibility | Mutations; upload; version; publish |
| Misnamed | `parity-phase3-approvals-documents-mutations.spec.ts` | **PO approval only** — no documents mutations |
| Smoke | `phase-10-overview-smoke.spec.ts` — categories CSV modal open/cancel | Import success |

### 1.7 Seed

`seed.rs` seeds sample documents with `index_content: None`, AI document processing job rows, and Google Drive-related fixtures where present. `document_sequence` seeds transactional number series (SO/PO/…), not DMS.

---

## 2. Gap matrix (quality bar vs inventory)

Definitions:

- **Present** — usable end to end with operational consequences.
- **Partial** — implemented at limited depth, or missing an essential UI, policy, storage, or integration layer.
- **Absent** — no meaningful implementation.
- **Unsuitable** — surface exists but cannot safely meet the workflow / evidence requirement.

| Capability | State | Evidence | Priority |
|------------|-------|----------|----------|
| Folder hierarchy | **Partial** | Create + parent_path; no rename/move/delete/ACL UI | Pilot-critical |
| Document metadata register | **Partial** | Create/update/list; empty url/size from UI | Pilot-critical |
| Binary object storage | **Absent** (product) | No presign/PUT/GC; api-server routes are renders | Pilot-critical |
| Versioning | **Partial** (API) / **Absent** (UI) | `add_document_version`; UI unused; checksum unused | Pilot-critical |
| Check-in / check-out | **Partial** | Lock/unlock only; no version-on-check-in; no lease TTL | Competitive |
| Folder / document permissions | **Unsuitable** | ACL vectors stored; never consulted on read/write; share_link unset | Pilot-critical |
| Record linking (`res_model`/`res_id`) | **Partial** | Columns + update params; no attach UX from SO/PO/expense/invoice | Pilot-critical |
| Soft-delete / recycle | **Partial** | Soft-delete; no restore; deleted still in org SQL | Competitive |
| Knowledge base wiki | **Partial** | Create + CSV; body in STDB; lifecycle UI thin | Competitive |
| Templates (generated docs) | **Partial** | HTML templates + report PDF routes; no DMS template admin UI | Competitive |
| OCR / extraction | **Partial** | Job table + complete/approve; no document FK; no worker blob | Differentiating |
| E-signatures | **Absent** | No envelope/signer tables (sale_order `signature` field is POS/sales, not DMS) | Differentiating |
| Retention policies | **Absent** (docs) | Privacy classifications exist; purge is messaging-only | Pilot-critical (regulated) |
| Legal holds | **Absent** | — | Differentiating |
| Full-text search | **Unsuitable** | `index_content` always None; embeddings external/Qdrant unfinished for docs UI | Competitive |
| Language-aware search | **Absent** | Embeddings have no locale; UI English-only | Competitive |
| Collaborative presence | **Absent** | No presence table/reducer | Differentiating |
| Google Drive / external DMS | **Partial** | Connection config; no sync→Document | Differentiating |
| Multi-entity isolation | **Partial** | Org guards; company optional; weak company tests | Pilot-critical |
| Audit coverage | **Present** (MVP) | `write_audit_log_v2` on mutators | — |
| Drill-down record → attachment | **Absent** (UX) | Schema only | Pilot-critical |
| International document formats | **Partial** | PDF/XLSX exporters for ERP docs; no local e-invoice PDF archive in DMS | Competitive |
| Extensibility | **Partial** | AI jobs + Drive config + embeddings pattern | Competitive |
| Phantom UI contracts | **Present** (BFF ok) / **Partial** (UI overclaim) | `DOCUMENTS_UI_REDUCERS` lists unwired ops | Competitive |

---

## 3. Required invariants

### Accounting / evidence (document adjacency)

Documents are not a GL module, but they underwrite evidence for expenses, AP, AR, contracts, and close packs.

| Invariant | Currently enforced | Evidence | Remaining requirement |
|-----------|-------------------|----------|------------------------|
| Attachment IDs on financial records resolve to real blobs | **No** | Expense stubs `[1n]`; document create allows empty URL | Object storage + version URL required before financial attach |
| Generated statutory PDFs archived as versions | **No** | api-server renders on demand | Persist render → object store → `document_version` linked to `res_*` |
| Soft-deleted evidence still held under retention/legal hold | **No** | Soft-delete without hold/retention | Retention class + hold blocks purge |
| Checksum integrity of archived files | **No** | Field always None | Hash on upload; verify on download |

### Authorization

| Invariant | Currently enforced | Evidence | Remaining requirement |
|-----------|-------------------|----------|------------------------|
| Reducer permissions | Yes | `check_permission` on document/folder/knowledge/template | Keep deny-by-default |
| Tenant isolation | Yes (org) | Org mismatch errors | Company-scoped folders/docs when company set |
| Folder/document ACL | **No** | Vectors unused | Enforce read/write ACL (or Casbin resource) before mutate/read |
| Share links | **No** | Fields never set | Tokenized share with expiry + audit, or remove fields |
| Knowledge `internal_permission` | **No** | Stored string | Enforce or drop |

### Audit

| Invariant | Currently enforced | Evidence | Remaining requirement |
|-----------|-------------------|----------|------------------------|
| Append-only mutation log | Yes | `write_audit_log_v2` | Include storage object key + checksum in new_values |
| Version events immutable | Partial | Version rows not updated except `is_current` | Never rewrite URL/bytes; add event stream for presence optional |
| Processing job approve trail | Partial | reviewed_by/at + audit | Link job → document_version |

### Concurrency / integrity

| Invariant | Currently enforced | Evidence | Remaining requirement |
|-----------|-------------------|----------|------------------------|
| Lock blocks version/update by others | Yes | `add_document_version` / `update_document` | Lease TTL + admin unlock audit already partial |
| Atomic metadata + version pointer | Yes (txn) | create + first version in one reducer | Keep; upload completes *before* reducer with verified object key |
| No binary bytes in reducer args | **De facto** | URL string only | Formalize: reducers accept storage handle + checksum only |
| Idempotent upload registration | **No** | — | client_request_id / content hash unique per org |
| Subscription consistency | Partial | Core four keys org-SQL; AI keys missing org-SQL | Add bounded SQL for jobs; filter deleted docs |

SpacetimeDB atomicity model: each reducer runs in one transaction that commits or rolls back as a unit ([Transactions and Atomicity](https://spacetimedb.com/docs/2.0.0-rc1/databases/transactions-atomicity); [Functions](https://spacetimedb.com/docs/functions/)). Blob upload, OCR, Drive OAuth, Qdrant upsert, and PDF render belong in **api-server / procedures / workers**, not reducers.

---

## 4. Reference workflows

1. **Create folder hierarchy** — Partial (create only).
2. **Upload file → object store → register Document + Version** — Unsuitable (metadata-only create).
3. **Add new version / check-out → edit → check-in** — Partial lock API; no blob/version UI.
4. **Attach document to ERP record (SO/PO/Bill/Expense)** — Schema Partial; product Absent.
5. **Permissioned share / folder ACL** — Unsuitable (unenforced).
6. **Soft-delete → restore → retention purge** — Partial delete only.
7. **Generate invoice/PO PDF from template → archive** — Partial generate; archive Absent.
8. **Knowledge article publish lifecycle** — Partial API; UI create-only.
9. **OCR job on receipt/invoice → extract → approve → link** — Partial job shell.
10. **Full-text / semantic search across docs + articles** — Unsuitable / Partial embeddings.
11. **Google Drive sync bidirectional** — Partial connection config.
12. **E-sign contract → completed PDF version** — Absent.
13. **Legal hold blocks delete/purge** — Absent.
14. **Regional retention / residency-tagged storage** — Absent for docs.
15. **Collaborative presence on article/doc** — Absent.
16. **CSV bootstrap knowledge** — Present (API + UI import).
17. **Cross-company isolation** — Partial (org only tested lightly).
18. **Mail template queue with PDF attach** — Partial (Accounting queue; attach path thin).

### Acceptance scenarios (≥10)

1. User uploads a PDF via UI: client obtains presigned PUT to regional object store, computes checksum, then `create_document` registers metadata with non-empty `url`, `file_size`, `checksum`, and version 1 pointing at the same object key; empty URL rejected in production policy mode.
2. `add_document_version` only succeeds when caller holds lock (or document unlocked); prior version remains immutable with `is_current=false`; checksum stored.
3. Folder with `is_access_restricted` and non-empty ACL: non-listed identity cannot `create_document` into folder or read via query/subscription projection.
4. Document linked with `res_model=account.move` / `res_id=N` appears on that invoice’s attachment panel; soft-delete hides from default lists but remains resolvable under audit/retention.
5. Soft-deleted document can be restored by authorized role before retention purge; legal hold (when implemented) blocks delete and purge.
6. Knowledge article: create → update body → lock → publish → members can view; unpublished not visible to non-members (enforced server-side).
7. Document template for `sale.order` renders PDF via api-server; rendered bytes stored as a new `document_version` attached to the order (`res_*`).
8. AI processing job references `document_id` + version URL; worker writes `extracted_data`; approve audits reviewer; expense/AP can consume approved extraction without stub attachment IDs.
9. Full-text: uploading a text/PDF populates `index_content` (or external search index) via worker; search returns doc by phrase; locale/analyzer selectable by country pack.
10. Company B cannot open/update/delete company A’s company-scoped document or folder (domain + e2e).
11. Retention classification on document class: after `retention_days`, purge soft-deleted blobs + metadata unless legal hold; purge writes audit.
12. Google Drive sync (download direction) creates Document rows with external IDs in metadata and object copies or deep links per policy — credentials never stored in STDB.
13. Concurrent editors: second user sees lock presence (or presence channel); cannot overwrite; admin force-unlock audited.
14. Multicountry: AU/NZ/ZA/SG org stores objects in residency-compatible bucket; BR NF-e XML/PDF archived as versions linked to vendor bill; MY/ID e-invoice PDFs similarly archivable.
15. CSV knowledge import creates Draft/unpublished articles only by default; publish remains explicit reducer.

---

## 5. Localization matrix (documents / retention / formats / search)

Country packs today are **tax-seed + company metadata** (`spacetimedb/src/core/country_pack.rs`). There are **no** document-residency, retention, or language-analyzer pack fields for DMS.

**i18n:** UI ships **English only** (`SupportedLanguage = "en"`). Knowledge/article strings are not localized packs.

Requirements below are **dated research notes as of 2026-07-18**, cited from official sources where linked — **not legal advice**; verify before go-live.

| Concern | Oceania (AU / NZ) | Southern Africa (ZA) | Brazil / Southern Cone (BR / AR / CL) | Maritime SEA (SG / MY / ID / PH / TH) |
|---------|-------------------|----------------------|----------------------------------------|----------------------------------------|
| Pack keys | `au`, `nz` | `za` | `br`, `ar`, `cl` | `sg`, `my`, `id`, `th`, `ph` |
| Data residency expectation | Prefer AU/NZ or agreed region storage; APP/NZ Privacy | POPIA — justifiable cross-border + safeguards | LGPD (BR); local privacy (AR/CL) — residency options matter | PDPA/PDP/etc.; SG often regional hub |
| Retention config | Tax/record retention schedules (e.g. ATO record keeping ~5 years typical business records — confirm per record class) | SARS record retention | NF-e / books retention (multi-year) | IRAS / LHDN / DJP / BIR / RD — multi-year e-invoice archives |
| In-tree DMS retention | **Absent** | **Absent** | **Absent** | **Absent** |
| Language-aware search | en (+ occasional iwi/te reo content) — English analyzers default | en/af/zu… — need analyzer config | pt-BR / es — analyzers + OCR language packs | en + ms/id/th/fil — OCR + analyzer packs |
| Local document formats | PDF tax invoices; AU eInvoicing Peppol direction | PDF tax invoices | NF-e XML + DANFE PDF; fiscal XML must be archivable | IRAS/Peppol; MY MyInvois XML; ID e-Faktur; PH/TH e-invoice PDF/XML |
| Generated docs today | Generic PDF/XLSX exporters | Same | Same — **no** NF-e archive pipeline | Same — **no** MyInvois/e-Faktur archive pipeline |
| Signature culture | Common e-sign for contracts (external) | Same | ICP-Brasil often required for qualified signatures — **external TSP** | Regional e-sign providers — **external** |
| Object-storage design | Region-tagged bucket per pack/org | Same | Prefer BR region for LGPD-sensitive docs | SG or local regions per customer contract |

### Official sources (dated; verify)

| Region | Authority / reference |
|--------|----------------------|
| Australia Privacy / records | [OAIC](https://www.oaic.gov.au); [ATO record keeping](https://www.ato.gov.au) |
| New Zealand Privacy | [Privacy Commissioner](https://www.privacy.org.nz); [IRD](https://www.ird.govt.nz) |
| South Africa POPIA / records | [Information Regulator](https://inforegulator.org.za); [SARS](https://www.sars.gov.za) |
| Brazil LGPD / NF-e | [ANPD](https://www.gov.br/anpd); [Receita Federal NF-e](https://www.gov.br/receitafederal) |
| Singapore PDPA / GST invoices | [PDPC](https://www.pdpc.gov.sg); [IRAS](https://www.iras.gov.sg) |
| Malaysia PDPA / e-Invoice | [JPDP](https://www.pdp.gov.my); [LHDN MyInvois](https://www.hasil.gov.my) |
| Indonesia PDP / e-Faktur | [DJP](https://www.pajak.go.id) |
| Chile / Argentina privacy & e-docs | [SII](https://www.sii.cl); [AFIP/ARCA](https://www.afip.gob.ar) |

Neighboring Southern African markets have **no** in-tree packs.

---

## 6. SpacetimeDB architecture decision (Documents & Knowledge)

Quality benchmark: NetSuite File Cabinet depth of control with modern blob separation ([File Cabinet](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/section_N2858596.html)). Architecture constraints from SpacetimeDB: reducers are transactional and deterministic; procedures/workers are the HTTP and large-I/O boundary ([SpacetimeDB Functions](https://spacetimedb.com/docs/functions/); [Transactions and Atomicity](https://spacetimedb.com/docs/2.0.0-rc1/databases/transactions-atomicity); [Subscription semantics](https://spacetimedb.com/docs/subscriptions/semantics)).

| Topic | Decision |
|-------|----------|
| **What lives in SpacetimeDB** | Document/folder/version **metadata**, ACL grants, lock/presence, version **events**, knowledge article text (bounded), templates HTML, AI job status, embedding *sync pointers*, Drive *connection config* (credential references only), audit. |
| **What must not live in SpacetimeDB** | Raw file bytes, multipart uploads, OCR model weights, OAuth tokens, Qdrant vectors as sole store (optional small embedding backup already exists — do not grow unbounded). |
| **Upload transaction** | (1) api-server issues presigned PUT scoped to org/company/residency; (2) client uploads bytes; (3) api-server verifies size/MIME/checksum; (4) single reducer `create_document` / `add_document_version` commits metadata + version pointer. Never reverse the order in production policy mode. |
| **Atomic metadata** | Keep create+v1 and version bump+`is_current` flip inside one reducer txn. Folder count updates should be corrected on move/delete (fix move count drift). |
| **Subscriptions** | Org-scoped documents/folders/articles/categories; add `document-versions` by document or recent; add AI jobs org/company SQL; default filter `is_deleted = false`; presence as ephemeral table or short-TTL rows. Avoid full-table scans for search — query external index. |
| **Isolation / scale** | Index org, company, folder, res_model+res_id, is_deleted, locked_by. Enforce company when set. Cap `index_content` size; push heavy search to OpenSearch/Qdrant/Meilisearch via workers. |
| **External I/O** | Object storage, OCR, e-sign TSP, Drive/Graph sync, PDF render, virus scan → **api-server / workers / procedures**. Reducers only record outcomes + IDs. |
| **Knowledge body** | Keep wiki HTML/Markdown in STDB while size-bounded; large attachments on articles use same object-storage path as DMS. |
| **Templates vs File Cabinet** | `document_template` remains layout definitions; rendered outputs become `Document`/`DocumentVersion` linked to records. |
| **Retention / legal hold** | New document classification + hold tables in STDB; blob GC worker respects hold; reuse privacy classification patterns but **do not** overload messaging-only purge. |
| **Residency** | `storage_region` / `storage_id` on folder or org pack settings selects bucket; reducers store opaque handle, never relocate bytes. |
| **UI contract repair** | Kill empty URL creates; wire version UI; enforce ACL; attach panels on financial modules; productize knowledge lifecycle; archive generated PDFs. |

---

## 7. Priority classification

### Pilot-critical

| Gap | Why |
|-----|-----|
| Object storage + presign upload + reject empty URL/size | Without blobs, DMS and financial evidence are theater |
| Checksum + MIME/size policy on register/version | Integrity |
| Enforce folder ACL (or remove fields) | Permission model is currently unsafe |
| Record attach UX (`res_model`/`res_id`) from SO/PO/Bill/Expense | NetSuite-class operational attachment |
| Org SQL for AI jobs + filter deleted docs; subscribe versions | Live consistency |
| Company isolation tests for docs/folders | Multi-entity pilot |
| Retention hooks for archived fiscal PDFs (pack-aware schedule) | Close/evidence |
| Domain + Playwright: upload→version→lock→attach | Prove spine |

### Competitive

| Gap | Why |
|-----|-----|
| Version UI + check-in creates version | Lifecycle |
| Soft-delete restore + recycle bin query | Ops |
| Knowledge edit/delete/lock/publish/members UI | Wiki usability |
| Document/mail template admin in product | Generated docs |
| Populate `index_content` or external FTS + basic search UI | Findability |
| Language/analyzer pack settings (pt-BR, es, ms, id, th) | Regional search |
| Folder move count integrity + rename/delete | Hierarchy ops |
| Archive api-server PDF renders as versions | Auditability of issued docs |
| Drive sync worker → Document rows | Integration |

### Differentiating

| Gap | Why |
|-----|-----|
| Legal hold | Regulated industries |
| E-sign provider integration (external TSP) | Contracts |
| Real OCR worker linking jobs → versions → expenses/AP | Automation |
| Collaborative presence on docs/articles | PSA/wiki concurrency UX |
| Bidirectional Drive/SharePoint with conflict policy | Enterprise content |
| Qualified signature / ICP-Brasil / regional e-sign profiles | BR/SEA edge |
| Cross-border residency policies per folder | Global multi-entity |

**Recommended next wave:** storage boundary + non-empty register + ACL enforce + record attach → version/check-in UI + knowledge lifecycle UI → retention/FTS/template archive → OCR/Drive/e-sign/presence.

---

## Validation

| Check | Result |
|-------|--------|
| Tables/reducers vs `spacetimedb/src/documents/*` | Verified 2026-07-18 |
| AI jobs / embeddings vs `ai/intelligence.rs` | Verified |
| Drive vs `integrations/google_drive.rs` | Verified (config only) |
| Privacy purge scope vs `core/privacy.rs` | Messaging-only verified |
| BFF keys vs reducers | Documents 26 keys enumerated; templates separate |
| Workspace keys vs `ERP_ORG_SQL` | 4/6 wired; AI jobs/insights **missing** org-SQL |
| UI stub upload (`url: ""`, `fileSize: 0n`) | Verified in `documents-create-params.ts` |
| `cargo check` (`spacetimedb/`) | **Passed** 2026-07-18 |
| Domain/E2E suites executed in this investigation | **No** — existence only |
| Acceptance scenarios | 15 listed (≥10 required) |
| Every gap has state + priority | Yes (§2 / §7) |

---

## Bottom line

Lumiere documents are a **credible metadata and knowledge schema** with locks, versions, templates, and AI job shells — but **not** a File Cabinet. The highest-severity gaps against the quality bar are **(1)** no object-storage upload boundary (empty URLs from UI), **(2)** unenforced ACLs/share fields, and **(3)** missing record-attachment and retention paths that finance and regional compliance require. Keep binaries out of SpacetimeDB; make STDB authoritative for metadata, auth, version events, and presence — and wire the external store before calling the module pilot-ready.

### Related docs

- [Expenses investigation](./EXPENSES_INVESTIGATION.md) — receipt evidence / stub attachment adjacency
- [Projects & PSA investigation](./PROJECTS_PSA_INVESTIGATION.md) — PSA document adjacency
- [Multi-entity platform inventory](./MULTI_ENTITY_PLATFORM_INVENTORY.md) — tenant, packs, residency
- [V1 roadmap](./V1_ROADMAP.md) — no Documents wedge claim at investigation time
- Wave tracker: [documents-knowledge-gap-fixes-plan.md](./plans/documents-knowledge-gap-fixes-plan.md)
- Documents module: `spacetimedb/src/documents/`
- Documents workspace: `frontend/packages/stdb/src/subscriptions/documents-workspace.ts`
- UI: `frontend/web/app/(modules)/documents/documents-client.tsx`
- Export routes: `api-server/src/routes/documents.rs`
