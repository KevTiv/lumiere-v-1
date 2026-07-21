# Proposals & Tenders — Investigation

Current-state assessment of Lumiere proposals / tenders against a NetSuite *quality* bar (integrated ops/finance, multi-entity, drill-down, workflow controls, localization, extensibility, lifecycle, integrations) — not a feature-copy checklist.

**Investigation date:** 2026-07-21  
**Method:** Source-traced inventory. “Verified” means present in code. Domain/E2E test names are listed as *existence*; this document does not claim those suites were executed as part of this investigation unless noted under Validation.

**Verdict:** Lumiere has a **collaborative proposal drafting workspace** (sections, presence, comments, client-supplied version blobs, product line items, source-doc ingest, AI analyze HTTP) with a thin list UI and status string transitions. Against the quality bar it is **partial** on collaborative editing and version *storage*, and **absent / unsuitable** for real tender lifecycle: no company/currency integrity, no bid/no-bid or scoring persistence, no clause library or compliance matrix as data, no tender portal, no e-sign-on-proposal, no convert→order/project, no server-side conflict resolution, and templates/"import RFP" are UI phantoms. Purchasing `purchase_rfq` is a **separate inbound sourcing** spine — not wired to sales proposals.

**Quality benchmark (not a spec):** Oracle NetSuite’s commercial depth for quotes/proposals emphasizes **transaction-accurate pricing**, **template-driven documents**, and **CRM/ERP conversion** (e.g. NetSuite CPQ Proposal Generator / document templates from configured items and transactions) ([CPQ Proposal Generator](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/article_5132447427.html); [Creating Document Templates](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/article_1134727908.html)). Inbound multi-vendor RFQ/portal depth lives under NetSuite Sourcing ([Sourcing Management](https://www.netsuite.com/portal/products/erp/procurement/source.shtml)). Lumiere is judged on whether proposals can meet that *depth of commercial control + financial drill-down + safe collaboration* — including government/procurement formats and multilingual/currency packs for Oceania / Southern Africa / Brazil–Southern Cone / Maritime SEA — not on SuiteApp feature parity.

**V1 roadmap reconciliation:** `docs/V1_ROADMAP.md` does **not** currently call out a Proposals & Tenders wedge. Treat this investigation as the source of truth for proposal/tender depth until a roadmap claim is added.

**Compile check:** `cargo check` in `spacetimedb/` — **passed** (2026-07-21; unrelated warnings in workflow packs).

**Trackers:** [Gap-fixes plan](./plans/proposals-tenders-gap-fixes-plan.md) (scaffold)

---

## 1. Verified inventory

### 1.1 Tables (`spacetimedb/src/proposals`)

| Area | Tables (accessor) | File | Notes |
|------|-------------------|------|-------|
| Proposal header | `proposal` | `proposals/proposals.rs` | Org-scoped; title, free-text `client_name`, `ProposalStatus`, bare `value: f64`, deadline, owner, `version_count`, optional `template_id` / `partner_id` / `document_folder_id`, metadata |
| Draft sections | `proposal_section` | same | Title/content/`SectionStatus`/sequence/word_count/`ai_suggestion` |
| Version snapshots | `proposal_version` | same | `version_number`, commit `message`, **`sections_json` (opaque string)** |
| Source docs (AI input) | `proposal_source_doc` | same | Pasted/uploaded text blob + word_count |
| Pricing lines | `proposal_line_item` | same | Product snapshot name, qty, `price_unit`, discount %, computed subtotal; optional `section_id` |
| Collaborative presence | `proposal_presence` | same | User + optional section + `last_seen`; `cursor_position` unused on insert |
| Section comments | `proposal_comment` | same | Thread via `parent_id`; resolve flag |
| Clause library | — | — | **Absent** |
| Compliance matrix / requirements | — | — | **Absent** as tables (UI template copy mentions “compliance matrix”) |
| Bid / no-bid / scoring | — | — | **Absent** |
| Tender portal / submissions | — | — | **Absent** |
| Approvals (proposal-specific) | — | — | **Absent** (generic workflow packs unrelated) |
| Multilingual template store | — | — | **Absent** (3 hard-coded client templates) |
| Company / currency | — | — | **No `company_id`**; **no currency** on header or lines |
| Convert target links | — | — | **No** `sale_order_id` / `project_id` / opportunity FK |

**Enums (`proposals.rs`):**

| Concept | Values | Notes |
|---------|--------|-------|
| `ProposalStatus` | Draft, Review, Submitted, Awarded, Rejected, Archived | String parse; **no transition machine** in reducer |
| `SectionStatus` | Empty, Draft, Complete, Reviewed | |

**Adjacent (not proposals-owned):**

| Area | Evidence | Link to `proposal`? |
|------|----------|---------------------|
| Purchasing RFQ / vendor bids | `purchase_rfq`, `purchase_rfq_line`, `purchase_rfq_bid` in `purchasing/sourcing.rs` | **No** — inbound procure tenders |
| Opportunity → SO | `convert_opportunity_to_sale_order` | **No** `proposal_id` |
| Sale orders / projects | sales / projects modules | **No** proposal FK |
| Document e-sign | `DocumentSignatureRequest` in `documents/esign.rs` | Document-scoped only; optional `document_folder_id` on proposal unused by create UI |
| CRM partner | `partner_id` column | Create hardcodes `None`; seed sets contact |

### 1.2 Backend reducers (callable SpacetimeDB surface)

**18 reducers** in `proposals/proposals.rs`:

| Group | Reducers |
|-------|----------|
| Header | `create_proposal`, `update_proposal`, `update_proposal_status` |
| Sections | `upsert_proposal_section`, `delete_proposal_section` |
| Versions | `save_proposal_version` |
| Source docs | `add_proposal_source_doc`, `update_proposal_source_doc`, `delete_proposal_source_doc` |
| Line items | `add_proposal_line_item`, `update_proposal_line_item`, `delete_proposal_line_item`, `reorder_proposal_line_items` |
| Presence | `update_proposal_presence`, `clear_proposal_presence` |
| Comments | `add_proposal_comment`, `resolve_proposal_comment` |

| Reducer | Behavior | Gap |
|---------|----------|-----|
| `create_proposal` | Org permission; inserts Draft; hardcodes `partner_id`/`template_id`/`metadata` None, `version_count: 0`; flat args | No `*Params`; no `company_id`; no currency; audit only CREATE here (partial) |
| `update_proposal_status` | Any valid status string | **No** transition guards; **no** audit; UI soft-gates only |
| `update_proposal` | Overwrites core fields | No audit; flat required fields (not Option params) |
| `upsert_proposal_section` | Create if `section_id == 0` else full overwrite | **Last-write-wins**; no expected `write_date` / version token |
| `save_proposal_version` | Inserts client `sections_json`; bumps `version_count` | **Does not snapshot server sections**; trusts client blob; no line-item/pricing snapshot |
| `update_proposal_presence` / `clear_*` | Upsert/delete by sender | **No** `check_permission` |
| Line item CRUD | Subtotal = qty × price × (1 − discount/100) | No currency; does not recompute header `value`; product_id not validated against catalog org |
| `update_proposal_source_doc` | Partial via `UpdateProposalSourceDocParams` | **Only** Params-shaped reducer + consistent audit |

**Absent (no reducers/tables):** `delete_proposal`, bid/no-bid, score/evaluate, clause CRUD, compliance row CRUD, tender portal submit, approval gate, multilingual template CRUD, convert→SO/project, restore-version-from-snapshot (server), conflict resolve, link partner/folder/template, e-sign request for proposal PDF.

**Aspirational phantoms** (in `frontend/web/scripts/track-reducer-coverage.ts`, **not** implemented): `delete_proposal`, `submit_proposal`, `approve_proposal`, `reject_proposal` (as dedicated reducers), `convert_proposal_to_sale_order`, `send_proposal`, `preview_proposal`, `delete_proposal_comment`, `update_proposal_comment`. Status changes today use `update_proposal_status`.

### 1.3 Frontend contracts (BFF / hooks)

[`PROPOSALS_BFF_REDUCERS`](../frontend/packages/stdb/src/commands/proposals-http.ts): **17** keys matching implemented mutators (all except none missing vs STDB — **0 phantoms in BFF list**). Coverage script still lists phantoms separately.

| Surface | Status |
|---------|--------|
| Query hooks | `useProposals`, sections, line-items, versions, source-docs, presence, comments |
| Mutations | Full BFF set wired in `query-hooks/hooks/proposals.ts` |
| Workspace keys | `PROPOSALS_WORKSPACE_RESOURCE_KEYS` — all seven proposal resources |
| Contract test | `proposals.contract.ts` — compile-only BFF enumeration |
| Analyze API | `POST /v1/proposals/analyze` — RAG or **deterministic mock**; result is **client state only** (not persisted) |
| Dedicated `/proposals` + `/proposals/[id]` | Present |

### 1.4 Subscriptions & queries

| Key | In `ERP_ORG_SQL` | Filter / notes |
|-----|------------------|----------------|
| `proposals` | Yes | Org-scoped `proposal` |
| `proposal-sections` | Yes | Org + `ORDER BY sequence` |
| `proposal-line-items` | Yes | Org |
| `proposal-versions` | Yes | Org + version_number DESC |
| `proposal-source-docs` | Yes | Org |
| `proposal-presence` | Yes | Org — high-churn if heartbeats frequent |
| `proposal-comments` | Yes | Org |
| Company-scoped proposal queues | **No** | No company column |
| “Due this week” / “awaiting bid decision” | **No** | Client filter only |

### 1.5 UI operations (`/proposals` + workspace)

| Tab / surface | End-to-end operations | Gaps |
|---------------|----------------------|------|
| Dashboard | Active/submitted/awarded counts; pipeline `$` sum (bare value, `$` label) | No FX; no company filter; cosmetic `$…k` |
| Proposals list | Create/edit header; status actions Draft→Review→Submitted→Awarded; Reject; Archive (from Awarded/Rejected) | Soft UI gates only; reducer accepts any status; create form `type` **discarded** |
| Templates | Three **in-memory** `BUILTIN_PROPOSAL_TEMPLATES` (Commercial / Tender / Grant) | Not STDB; “Use template” only switches tab; tender copy mentions compliance matrix — **no data model** |
| Quick action “Import RFP” | Opens same create form | **Not** RFP import |
| Workspace sections | Debounced upsert; sidebar; product `@` mentions; line items; comments | No optimistic concurrency |
| Presence bar | Live avatars from `proposal_presence` | Advisory only |
| Version bar | Save version from **client-loaded** sections JSON; LCS diff UI | **`onRestoreVersion` not wired** — restore does not rewrite server sections |
| Source docs + AI panel | Paste/upload; analyze HTTP; apply suggested sections via upsert | Analysis criteria not persisted; mock fallback |
| Export | Markdown / plaintext / print CSS | Not branded PDF/DOCX portal package |
| Orphan components | `tender-editor-panel.tsx`, `ai-analysis-panel.tsx` | Exported; **not** mounted by `ProposalWorkspace` |
| Registry form statuses | `proposals.config.ts` uses `sent`/`viewed`/`negotiating`/… | **Misaligned** with `ProposalStatus` (live forms use `proposals-form-configs.ts`) |
| Convert → SO / project | **Absent** | — |
| Bid/no-bid / scoring UI | **Absent** | — |
| Tender portal / compliance matrix | **Absent** | — |
| E-sign from proposal | **Absent** | Documents esign separate |

### 1.6 Tests (existence only)

| Layer | What exists | Not covered |
|-------|-------------|-------------|
| Domain (Rust) | **None** under `spacetimedb/tests` for proposals | Company isolation, status machine, version snapshot integrity, convert |
| Contract | `proposals.contract.ts` | Runtime reducer presence |
| Playwright | `module-smoke` — create + open workspace; `phase-9-edge-smoke` — row action visibility; `auth-shell` — `/proposals` | Status transitions, concurrent edit, restore, convert, tender compliance |
| Analyze API | No e2e found for mock/RAG contract | Persistence of scores |

### 1.7 Seed

`seed.rs`: one coverage proposal linked to Acme contact + contracts folder; section, version, source doc, line item, presence, comment; `audit_rule` for `"proposal"`; AI insight `related_model: "proposal"`.

---

## 2. Gap matrix (quality bar vs inventory)

Definitions:

- **Present** — usable end to end with operational and/or financial consequences.
- **Partial** — implemented at limited depth, or missing an essential UI, policy, reporting, or integration layer.
- **Absent** — no meaningful implementation.
- **Unsuitable** — surface exists but cannot safely meet the workflow / accounting / scale / concurrency requirement.

| Capability | State | Evidence | Priority |
|------------|-------|----------|----------|
| Proposal / tender header CRUD | **Partial** | Create/update/list; no delete; weak partner/template wiring | Pilot-critical |
| Multi-entity `company_id` | **Absent** / **Unsuitable** for multi-entity | No column; audit `company_id: None` | Pilot-critical |
| Multi-currency pricing | **Absent** / **Unsuitable** | Bare `f64` value + line prices; dashboard assumes `$` | Pilot-critical |
| Collaborative editing (presence) | **Partial** | Presence table + bar; no locks/OT | Competitive |
| Explicit version snapshots | **Partial** / **Unsuitable** for audit-grade | Client-supplied `sections_json`; no server snapshot of lines/pricing; restore unwired | Pilot-critical |
| Conflict resolution | **Absent** / **Unsuitable** | Last-write-wins upsert; presence advisory | Pilot-critical |
| Sections + comments | **Present** (MVP) | Upsert/delete; threaded comments + resolve | — |
| Product line items | **Partial** | CRUD + reorder; no header rollup; no tax/FX; product org not enforced | Pilot-critical |
| Status / lifecycle | **Partial** | Enum + UI soft path; reducer unrestricted | Pilot-critical |
| Bid / no-bid decision | **Absent** | — | Pilot-critical (tender) |
| Scoring / evaluation criteria | **Absent** (persist) | Analyze API returns criteria in JSON only | Competitive |
| Approvals / SoD | **Absent** | No workflow gate on submit/award | Pilot-critical |
| Clause libraries | **Absent** | — | Competitive |
| Compliance matrices / doc requirements | **Absent** | Template marketing copy only | Competitive |
| Tender portals (gov / buyer) | **Absent** | — | Differentiating |
| Multilingual templates | **Absent** | 3 EN client stubs; `SupportedLanguage = "en"` | Competitive |
| Government / procurement formats | **Absent** | No pack overlays | Competitive |
| Local commercial terms | **Absent** | No Incoterms/payment/terms blocks as data | Competitive |
| Signatures | **Partial** adjacent | Document esign; not proposal-bound | Competitive |
| Convert → sale order | **Absent** | Phantom in coverage script | Pilot-critical |
| Convert → project | **Absent** | — | Competitive |
| Post-award traceability | **Absent** | Awarded status only; no SO/project/contract link | Pilot-critical |
| CRM opportunity linkage | **Partial** field | `partner_id` unused on create | Competitive |
| Documents folder linkage | **Partial** field | Optional folder id; not create UI | Competitive |
| AI-assisted drafting | **Partial** | Analyze HTTP + apply sections; mock fallback; not durable scores | Differentiating |
| Drill-down reporting (pipeline → lines → SO → GL) | **Absent** | Dashboard sums bare value | Pilot-critical |
| Purchasing RFQ adjacency | **Present** elsewhere | Separate inbound RFQ — must not be confused with sales tenders | — |
| Extensibility / CSV / import RFP | **Unsuitable** (label) | “Import RFP” = create form | Competitive |
| Phantom coverage names | **Unsuitable** (docs/scripts) | Invented submit/approve/convert reducers | Competitive |
| Audit completeness | **Partial** | Only create + update source doc consistently audited | Pilot-critical |
| Internationalization | **Partial** | `en` keys only | Competitive |

---

## 3. Required invariants

### Accounting / commercial

| Invariant | Currently enforced | Evidence | Remaining requirement |
|-----------|-------------------|----------|------------------------|
| Money has currency + company books | **No** | Bare `f64` | `company_id` + `currency_id` (or code) on header/lines; FX snapshot on submit/award |
| Line totals reconcile to header commercial value | **No** | Header `value` independent of lines | Server recompute or explicit “commercial total” with audit on submit |
| Awarded proposal → order/project inherits partner, lines, tax policy | **No** | No convert | Atomic convert reducer(s); preserve proposal_id on SO/project |
| Period / credit controls on convert post | **N/A** (no convert) | — | Reuse sales confirm / credit helpers — do not invent AR in proposals |
| Version used for customer-facing submit is immutable + server-authored | **No** | Client JSON blob | Snapshot server sections + lines (+ currency) in reducer; reject client-authored content as sole truth |
| Tax / withholding on tender pricing | **No** | — | Country-pack commercial tax metadata at quote time (display + convert) |

### Authorization

| Invariant | Currently enforced | Evidence | Remaining requirement |
|-----------|-------------------|----------|------------------------|
| Org permission on writes | **Mostly** | `check_permission(..., "proposal", …)` | Presence must require read/write; deny-by-default |
| Company ownership | **No** | No company | Require `company_id`; guard all mutators; isolation tests |
| SoD on award / convert / high-value submit | **No** | UI-only status | Workflow approval gate or dedicated approve role before Awarded/convert |
| Field policy on commercial fields | **No** | — | Casbin field writability on value/discount |
| External portal identity ≠ internal editor | **N/A** | No portal | Separate principal + permission for portal submits |

### Audit

| Invariant | Currently enforced | Evidence | Remaining requirement |
|-----------|-------------------|----------|------------------------|
| Mutation audit | **Partial** | create + source doc update | Audit status, section, version, line, comment, convert |
| Bid/no-bid / score decisions append-only | **No** | — | Decision event table with actor + rationale |
| Post-award trail proposal → SO/project → invoice | **No** | — | Stable FKs + audit metadata |
| Do not audit presence heartbeats | **Yes** (by omission) | No presence audit | Keep — avoid subscription+audit storm |

### Concurrency / integrity / scale

| Invariant | Currently enforced | Evidence | Remaining requirement |
|-----------|-------------------|----------|------------------------|
| Section edit atomic per reducer | **Yes** | Single txn upsert | Keep |
| Concurrent editors cannot silently clobber | **No** | LWW | Require `expected_write_date` or section revision; on conflict return error + optional merge intent |
| Version restore is transactional | **No** | Restore UI unwired | Restore reducer applies snapshot to sections (+ optional lines) in one txn |
| Presence ephemeral / bounded | **Partial** | Org-wide presence query | TTL cleanup on disconnect; optional proposal-scoped subscription |
| Large RFP source blobs | **At risk** | Full text in STDB rows | Cap size; store large binaries in document store; keep extract/summary in STDB |
| AI analyze non-blocking | **Yes** (HTTP outside reducer) | `/proposals/analyze` | Persist results via reducer after worker returns — never HTTP inside reducer |

SpacetimeDB atomicity model: each reducer runs in one transaction that commits or rolls back as a unit ([Transactions and Atomicity](https://spacetimedb.com/docs/2.0.0-rc1/databases/transactions-atomicity); [Functions](https://spacetimedb.com/docs/functions/)). Subscriptions push row changes ([Subscription semantics](https://spacetimedb.com/docs/subscriptions/semantics)). External HTTP (AI gateway, e-sign providers, gov portals, PDF render) belongs in procedures/workers, not reducers.

---

## 4. Reference workflows

1. **Qualify opportunity** → create proposal (company, partner, currency) — Partial header; company/currency Absent.
2. **Bid / no-bid** with rationale + approver — Absent.
3. **Apply multilingual / market template** (sections + clause packs) — Absent (client stubs).
4. **Ingest RFP / tender pack** (docs → requirements → compliance matrix) — Unsuitable (“import” = create form); analyze Partial.
5. **Collaborative draft** (sections + presence + comments) — Partial; conflict Absent.
6. **Price with product lines** (pricelist, tax, FX) — Partial lines; FX/tax Absent.
7. **Save immutable version** (server snapshot) → internal review approval — Version Partial/Unsuitable; approval Absent.
8. **Submit to customer / portal** (package + deadline) — Status string only; portal Absent.
9. **Negotiate** (new version; redlines; clause swaps) — Comments Partial; clause library Absent.
10. **Customer / gov e-sign** — Adjacent documents only.
11. **Award / reject** with scorecard — Status Partial; scoring Absent.
12. **Convert → sale order and/or project** with post-award traceability — Absent.
13. **Post-award compliance / delivery trace** — Absent.
14. **Inbound vendor RFQ** (purchasing) — Present elsewhere; keep domain boundary clear.

### Acceptance scenarios (≥10)

1. Create proposal with required `company_id`, `currency_id`, partner (or validated client), deadline; audit CREATE; second org cannot see it.
2. Bid/no-bid decision recorded with rationale; no-bid blocks submit; audit append-only.
3. Apply locale template (e.g. AU tender / BR proposta / SG gov format) materializes sections + default commercial terms from pack — not hard-coded EN-only stubs.
4. Two editors open same section with presence visible; second save with stale `expected_write_date` fails closed; winner’s content remains; loser can merge via explicit resolve.
5. Save version snapshots **server** sections + line items + currency totals; client cannot inject arbitrary JSON as sole snapshot body.
6. Restore version N rewrites live sections (and optional lines) in one transaction; audit RESTORE; UI restore wired.
7. Line items roll into commercial total; discount field policy enforced; multicurrency display uses company currency (AUD/ZAR/BRL/SGD…).
8. Submit for review requires all mandatory compliance rows Complete (when matrix present) or explicit waiver; reducer rejects invalid status jumps (e.g. Draft→Awarded).
9. Approval gate (workflow or SoD role) required before Submitted→Awarded for value above threshold.
10. Awarded proposal converts to sale order inheriting partner, lines, UTM/campaign if mapped; `proposal_id` on SO; second convert blocked.
11. Optional convert to project with WBS stub from sections; post-award list drills proposal → SO/project.
12. E-sign package generated from submitted version (worker); completion recorded against proposal version id.
13. Analyze RFP returns requirements; persisting compliance rows is a reducer (not client-only JSON); mock path clearly labeled non-production.
14. Portal principal can upload clarification only for Submitted proposals of invited tenders — cannot mutate internal draft sections.
15. Multi-entity: company B cannot edit company A proposal sections/lines (domain + e2e).
16. Large source PDF stored via documents module; proposal holds reference + extracted text cap — reducer rejects oversized inline content.
17. Purchasing `purchase_rfq` award path remains independent; no accidental FK mash with sales proposal Awarded.

---

## 5. Localization matrix (commercial / tender / language / currency)

Country packs today are **tax-seed + company-ID metadata + expense/document flags** (`spacetimedb/src/core/country_pack.rs`). Proposals need **currency defaults, commercial-terms blocks, gov procurement format packs, and multilingual template locales** — not only sale-tax seeds. Pack metadata must not be mistaken for live statutory adapters or portal connectors.

**i18n:** UI ships **English only** (`SupportedLanguage = "en"`). Keys under `proposals.*` / `proposalWorkspace.*`. Country packs are not language packs.

Rates and rules below are **dated requirements as of 2026-07-21**, cited from official sources where linked — **not legal advice**; verify before go-live.

| Concern | Oceania (AU / NZ) | Southern Africa (ZA only in-tree) | Brazil / Southern Cone (BR / AR / CL) | Maritime SEA (SG / MY / ID / PH / TH) |
|---------|-------------------|-----------------------------------|----------------------------------------|----------------------------------------|
| Pack keys | `au`, `nz` | `za` only | `br`, `ar`, `cl` | `sg`, `my`, `id`, `th`, `ph` |
| Currency | AUD / NZD | ZAR | BRL / ARS / CLP (inflation modes in pack meta) | SGD / MYR / IDR / PHP / THB |
| Languages (templates) | EN (+ te reo NZ adjacency) | EN / Afrikaans / local B2G | PT-BR; ES-AR/CL | EN + BM/ID/TH/Filipino adjacency |
| Company ID on bidder / client | ABN/ACN; NZBN | CIPC / VAT | CNPJ/CPF; CUIT; RUT | UEN; SSM; NPWP; TIN |
| Gov / public procurement norms | Commonwealth / state tender portals — **worker** | Preferential procurement / B-BBEE adjacency — **pack metadata + worker** | Licitações / portal de compras — **worker** | GeBIZ (SG) and local e-procurement — **worker** |
| Commercial terms | Australian Consumer Law / NZCC adjacency in terms clauses | CPA adjacency | CDC / local consumer + FX clauses (AR) | PDPA + local consumer; Islamic finance terms optional |
| Tax on quotes | GST | VAT | ICMS/ISS complexity — often **procedure** | GST/SST/VAT variants |
| Signature / formalities | Wet + e-sign accepted widely | E-sign + advanced signatures | ICP-Brasil adjacency for some B2G | Region-specific e-sign trust lists |
| Proposal pack gap | AUD defaults; ABN on cover; Commonwealth response schedules as templates | ZAR + B-BBEE score fields as **optional matrix columns** | PT-BR templates; CNPJ validation; currency + indexation notes | Multi-language templates; UEN; GeBIZ export as **worker** |

### Official sources (dated; verify)

| Region | Authority / reference |
|--------|----------------------|
| Australia | [AusTender](https://www.tenders.gov.au); [ATO](https://www.ato.gov.au) GST |
| New Zealand | [GETS](https://www.gets.govt.nz); [IRD](https://www.ird.govt.nz) |
| South Africa | [National Treasury eTender](https://www.etenders.gov.za); [SARS](https://www.sars.gov.za) |
| Brazil | [Portal de Compras](https://www.gov.br/compras); [Receita Federal](https://www.gov.br/receitafederal) |
| Chile / Argentina | [Mercado Público](https://www.mercadopublico.cl); [Compr.ar](https://comprar.gob.ar) |
| Singapore | [GeBIZ](https://www.gebiz.gov.sg); [IRAS](https://www.iras.gov.sg) |
| Malaysia / Indonesia / Thailand / Philippines | [MyProcurement](https://myprocurement.treasury.gov.my); LKPP/INAPROC; [e-GP](https://www.gprocurement.go.th); PhilGEPS |

Neighboring Southern African markets (e.g. Botswana, Namibia, Mozambique) have **no** in-tree packs — relevant for cross-border bid teams based in ZA.

---

## 6. SpacetimeDB architecture decision (Proposals & Tenders)

Quality benchmark: NetSuite-class **quote/proposal accuracy and conversion** plus ecosystem **tender/RFP response** depth (compliance, portals, multilingual packages) without copying SuiteApp feature lists ([CPQ Proposal Generator](https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/article_5132447427.html); [Sourcing Management](https://www.netsuite.com/portal/products/erp/procurement/source.shtml) for *inbound* RFQ contrast). Architecture constraints: reducers transactional/deterministic; subscriptions push row changes; procedures/workers are the HTTP boundary.

| Topic | Decision |
|-------|----------|
| **System of record in SpacetimeDB** | Proposal header, sections, line items, comments, bid decisions, compliance rows, clause *references*, version **metadata**, presence, and convert FKs live in SpacetimeDB. |
| **Version snapshots** | `save_proposal_version` must **read server rows** and serialize sections (+ line items + commercial totals + currency) inside the reducer. Client may supply commit `message` only. Optional: store large snapshot blobs in documents module with hash on `proposal_version`. |
| **Conflict resolution** | Keep presence for UX. Require optimistic concurrency on section upsert (`expected_write_date` or `revision`). On conflict, fail closed; provide `resolve_proposal_section_conflict` that applies chosen side or merged content in one txn. Do **not** invent OT/CRDT inside WASM unless a proven library fits the sandbox — explicit snapshots + LWW-with-guard is the pilot bar. |
| **Collaborative subscriptions** | Subscribe proposal-scoped resources for workspace; keep org list for pipeline. Presence: heartbeat with TTL; clear on disconnect lifecycle if available; do not audit heartbeats. |
| **Approvals** | Prefer reusable workflow approval gate subject = proposal (pattern from workflow module) over one-off status strings for submit/award. |
| **Convert boundary** | `convert_proposal_to_sale_order` / `…_to_project` as single reducers creating targets + writing FKs + audit. Pricing must pass through existing sales validation (warehouse/pricelist/tax) — proposals do not post GL. |
| **AI / analyze** | Worker/procedure calls model; reducer `apply_proposal_analysis` persists requirements/scores. Mock analyze allowed only behind non-prod flag. |
| **Portals & e-sign & PDF** | External. Intent rows (`proposal_integration_intent`) + workers for GeBIZ/AusTender/etc., PDF/DOCX render, DocuSign-class providers. Reducers record status transitions from worker callbacks. |
| **Documents** | Large RFP PDFs and signed packages in documents module; proposal holds ids + extracts. Reuse esign against generated document linked to `proposal_version_id`. |
| **Inbound RFQ isolation** | Keep `purchase_rfq*` in purchasing. Shared UX patterns OK; **no** shared table. Naming in UI must say “Vendor RFQ” vs “Sales proposal / tender response”. |
| **Scale** | Cap inline source_doc content; index org+company+status+deadline; avoid org-wide presence churn — filter by `proposal_id` in workspace queries where possible. |
| **Reducer conventions** | Migrate to `CreateProposalParams` / `UpdateProposalParams`; flat `organization_id`, `company_id`, `proposal_id`; audit all commercial mutations; no hardcoded partner/template nulls without params. |
| **Isolation** | Mandatory company scope + domain tests A↛B. |

---

## 7. Priority classification

### Pilot-critical

| Gap | Why |
|-----|-----|
| `company_id` + ownership guards + isolation tests | Multi-entity safety |
| Currency on header/lines + honest money UI (no forced `$`) | Southern Hemisphere commercial ops |
| Server-authored version snapshots + wired restore | Audit-grade lifecycle |
| Section optimistic concurrency / explicit conflict resolve | Collaborative editing without silent data loss |
| Status transition machine + audit on status | Reliable workflow controls |
| Bid/no-bid decision record | Tender go/no-go |
| Approval/SoD before award (workflow gate OK) | Control |
| Convert → sale order with `proposal_id` traceability | Ops/finance quality bar |
| Line rollup / commercial total integrity | Accurate quotes |
| Audit sweep on mutators | Governance |
| Remove or quarantine phantom reducer names | Hygiene / honest coverage |

### Competitive

| Gap | Why |
|-----|-----|
| Compliance matrix + document requirements | Gov/enterprise tenders |
| Clause library + pack commercial terms | Consistency / speed |
| Multilingual templates (STDB) + locale packs | Regional bids |
| Scoring / evaluation persistence | Award justification |
| Partner/opportunity/folder wiring in create UI | CRM/doc cohesion |
| E-sign link from submitted version | Closing |
| Convert → project | Services / PSA |
| Real RFP ingest (docs → requirements) | Tender response speed |
| Delete proposal / archive policy | Lifecycle hygiene |
| Mount or delete orphan tender/AI panels | UX honesty |
| Align registry form statuses with backend enum | Prevent dual vocabularies |

### Differentiating

| Gap | Why |
|-----|-----|
| Government portal connectors (GeBIZ, AusTender, eTender, …) via workers | Regional win rate |
| Branded PDF/DOCX proposal generator from templates + CPQ options | NetSuite-class output |
| AI analyze → durable compliance/score with explainability | Response acceleration |
| Customer/bidder portal for clarifications & submissions | Two-sided tendering |
| Preferential procurement / B-BBEE / local-content score columns | ZA/SEA public sector fit |
| Cross-proposal clause analytics / reuse intelligence | Knowledge leverage |

**Recommended first wave (pilot):** company + currency + Params/audit cleanup → server version snapshot + restore → section concurrency token → status machine + bid/no-bid → thin approval gate → convert→SO → isolation/e2e. Then compliance matrix/clauses/templates; then portals/PDF/e-sign/AI persistence.

---

## Validation

| Check | Result |
|-------|--------|
| Tables/reducers vs `spacetimedb/src/proposals/proposals.rs` | Verified 2026-07-21 |
| BFF keys vs reducers | 17 BFF keys; phantoms only in coverage script |
| Workspace / SQL | Seven proposal resources org-scoped |
| Convert / project / SO FK | **None** verified |
| Purchasing RFQ adjacency | Present; **no** proposal FK |
| E-sign adjacency | Document-scoped; no proposal version FK |
| Version save trusts client JSON | Verified |
| Restore unwired (`onRestoreVersion` absent on workspace) | Verified |
| Templates in-memory only | Verified `BUILTIN_PROPOSAL_TEMPLATES` |
| `cargo check` (`spacetimedb/`) | **Passed** 2026-07-21 |
| Domain/E2E suites executed in this investigation | **No** — existence only |
| Acceptance scenarios | 17 listed (≥10 required) |
| Every gap has state + priority | Yes (§2 / §7) |

---

## Bottom line

Lumiere Proposals today is a **real-time drafting surface with advisory presence and client-trusted version blobs**, not a **NetSuite-quality commercial/tender control plane**. The highest-severity gaps against the quality bar are **(1)** missing company/currency and convert→order traceability, **(2)** versioning/concurrency that cannot guarantee conflict-safe collaborative truth, and **(3)** absence of bid decisions, approvals, compliance/clause data, and portal/e-sign boundaries needed for multilingual, multi-currency government and enterprise tenders across Oceania, Southern Africa, Brazil/Southern Cone, and Maritime Southeast Asia.

### Related docs

- [Gap-fixes tracker](./plans/proposals-tenders-gap-fixes-plan.md) — checkbox backlog scaffold
- [CRM lifecycle investigation](./CRM_LIFECYCLE_INVESTIGATION.md) — opportunity / presence patterns
- [Sales order management investigation](./SALES_ORDER_MANAGEMENT_INVESTIGATION.md) — convert / CPQ adjacency
- [Purchasing / procurement investigation](./PURCHASING_PROCUREMENT_INVESTIGATION.md) — inbound RFQ boundary
- [Documents / knowledge investigation](./DOCUMENTS_KNOWLEDGE_INVESTIGATION.md) — esign / folder adjacency
- [Projects / PSA investigation](./PROJECTS_PSA_INVESTIGATION.md) — convert-to-project adjacency
- [Workflow / approvals investigation](./WORKFLOW_APPROVALS_INVESTIGATION.md) — gate pattern reuse
- [Multi-entity platform inventory](./MULTI_ENTITY_PLATFORM_INVENTORY.md) — tenant, FX, country packs
- [V1 roadmap](./V1_ROADMAP.md) — no Proposals wedge claim at investigation time
- Proposals module: `spacetimedb/src/proposals/`
- Workspace UI: `frontend/packages/ui/src/proposal-workspace/`
- Proposals workspace keys: `frontend/packages/stdb/src/subscriptions/proposals-workspace.ts`
- E2E smoke: `frontend/web/tests/e2e/module-smoke.spec.ts`, `phase-9-edge-smoke.spec.ts`
