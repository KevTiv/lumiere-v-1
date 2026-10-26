# Finance alpha change history and review

**Status:** Proposed implementation plan; no feature implementation or release admission implied.
**Date:** 2026-10-26
**Baseline:** application `1d92894eec252f2169591966344dda6d64bab33d`, contracts `0.3.148`.
**Scope authority:** [Finance alpha navigation](../plan/finance-alpha-navigation-status.md), confirmed by `PRODUCT_SURFACES` in `frontend/packages/ui/src/lib/product-surface-catalog.ts`.
**Related:** [ChangeSet architecture](offline-changeset-sync.md), [Finance work boards](../plan/module-work-boards-alpha.md), [Accounting alpha contracts](../ACCOUNTING_ALPHA_GAPS.md), [trusted operation context](audit-auth-operation-context-plan.md).

## Product outcome

Finance alpha users can inspect who changed a record, compare before and after values, propose an update, review its consequences, and follow its approval and actual result. The seven included modules are **Accounting, Sales, CRM, Purchasing, Reports, Subscriptions and Expenses**. Documents, Approvals, Tasks and the existing Finance workspace provide supporting entry points.

Deliver this online first. The broader offline plan supplies the ChangeSet semantics, but SQLite, OPFS, offline leases and the open offline PR stack are not prerequisites. Later offline clients submit the same typed proposals and use the same review/apply boundary.

**Confirmed product behavior (2026-10-26):** ordinary permitted edits save immediately and acquire history. Selected financial actions require review under the existing approval rules. Users can explicitly choose **Propose change**; submitted proposals also require review. The operation matrix must identify which actions apply immediately and which enter approval, with enforcement in the canonical server owner.

## Alpha scope

There are two complementary experiences:

1. **Changes:** immutable history of actual committed work, grouped by business operation, with actor, time, reason when supplied, affected records, before/after values and result links.
2. **Review changes:** a submitted, immutable proposal version with base/current/proposed comparison, current eligibility, decisions and exact application evidence.

The first proposal boundary is **one existing business aggregate**, including its owned lines. Creation is captured in history, but arbitrary bundles of new records and cross-module multi-action proposals are later work. An approved owner operation may still have its normal downstream effects, such as an invoice or picking; these must be linked exactly.

| Module | Required alpha history coverage | First proposed update | Existing consequential action and review relationship |
| --- | --- | --- | --- |
| Accounting | Invoice/bill and journal header/line changes, posting/correction, payment transactions and allocations, bank settlement/reversal, imports, period close and asset/depreciation operations exposed by alpha | Existing draft invoice/bill or journal entry, including owned lines; use server-confirmed amounts | Reuse `PostAccountMove`, `PostPayment`, `PostPaymentTransaction`, `ReversePaymentTransaction` and `ReverseBankStatementSettlement` where their existing paths apply. Bank ownership, close, allocation and import rules stay with their owners. |
| Sales | Customer quotation/order headers and lines, confirmation/cancellation and exact fulfillment/invoice handoffs | Draft quotation/order commercial edits | Reuse `ConfirmSalesOrder`; changes that invalidate an existing approval require fresh review. |
| CRM | Shared customer/vendor contacts, leads/opportunities, stages, conversion and Sales handoff | Selected contact or lead/opportunity fields supported by current update contracts | CRM edits have no general Finance work-board approval adapter today. Add the typed proposal adapter and review projection; do not pretend existing board support covers CRM. |
| Purchasing | Supplier/requisition/RFQ/PO changes, approvals, receipt/bill links and correction/recovery paths visible in alpha | Draft RFQ/PO headers and owned lines | Reuse `SendPurchaseOrder` and `ConfirmPurchaseOrder`; bill, receipt and recovery effects remain canonical Purchasing/Accounting operations. |
| Reports | Saved report definitions, templates, schedules, dashboards/widgets and generation/export records exposed by alpha | Existing report template or schedule definition | Add a typed definition-update proposal adapter. Definition changes and generated financial results are distinct events; a new template does not rewrite an existing report. |
| Subscriptions | Plan/subscription/line changes, activation, amendment, renewal/cancellation, billing runs and resulting invoices | An existing subscription amendment using the native amendment contract and its before/after ledger | Add a typed proposal/review adapter. Revalidate effective date, proration, already-billed periods and invoice links; frozen commercial approval is separate from posting approval. |
| Expenses | Expense/receipt relationships, report submission, approval/rejection and posting/reimbursement | An editable expense or unsubmitted expense report using supported fields only | Reuse `ApproveExpenseSheet`; preserve employee access, separation of duties and Accounting effects. |

This table defines minimum families, not a claim that every current operation has complete evidence. `FCR-00` enumerates every enabled alpha mutation, including secondary tabs, bulk actions, imports, jobs and direct BFF/native paths. Every row needs an owner, history policy, proposal eligibility and proof. Unsupported proposed fields are explicitly disabled; they are never silently dropped. Remaining alpha families stay on the matrix until implemented or explicitly excluded from this feature's scope by a product decision.

Supporting Documents attach exact authorized versions; Tasks and Approvals expose eligible review assignments; the Finance feed includes only authorized alpha records. Settings access changes, full document version control, generic Calendar/Messages editing, and hidden operational/workforce modules are not new proposal targets in this release. Existing financial email sends and linked receipt/stock effects still appear as outcomes of their alpha source workflow.

## Current foundations and gaps

| Existing owner | Reuse | Required work |
| --- | --- | --- |
| `spacetimedb/src/core/audit.rs`, `spacetimedb/src/helpers.rs` | Append-only audit identity and reducer-local capture | Audit payloads vary in completeness. `log_audit_event` accepts member-supplied values, and `audit_log` is public. Such entries cannot establish authoritative business diffs. Add trusted provenance and private material evidence before collecting more sensitive values. |
| `frontend/packages/ui/src/entity-views/record-audit-tab.tsx` | Record-level placement and actor labels | It currently filters the organization audit query in the client. Replace this path with authorized record-scoped, cursor-paged history and explicit error/denied/incomplete states. |
| `spacetimedb/src/workflow/{action_registry,approval_gate,approvals,receipts,recovery}.rs` | Typed action allowlist, material revision hashes, current authorization, decisions and exact receipts | Bind proposal version and payload hash to these owners; add closed typed adapters for proposal updates. Do not add a competing approval executor. |
| `api-server/src/workflow_reads/`, `frontend/web/components/work-board/` | Scoped assignments, eligible reviewers and exact outcome checks | Add proposal detail projections and CRM/Reports/Subscriptions sources without broadening the current four-module board by inference. |
| `frontend/packages/query-hooks/src/hooks/operation-effect.ts` | Canonical result refs and outcome-unknown reconciliation | Add exact proposal/decision/application readback. Never use the newest record, a matching name, timestamp proximity or a browser success response as proof. |
| `spacetimedb/src/subscriptions/subscription_wave_c.rs` | Native amendment versions and before/after evidence | Project/link existing amendment evidence rather than create another subscription version authority. |
| `spacetimedb/src/core/persistence.rs`, `spacetimedb/src/workflow/finance_persistence.rs` | Organization commits, reconstruction and covered financial effects | Extend complete persistence coverage to the new evidence/proposals and each new adapter. Ordinary audit appends alone do not prove PostgreSQL restore coverage. |

The record audit tab and proposal-document version UI are useful presentation precedents. Neither is already the general ChangeSet review feature. AI action drafts retain their own authority and may link to changes; this feature requires no AI provider or paid model calls.

## User workflow

### History and comparison

Add **Changes** to existing record sheets/workspaces, using one shared renderer. Each entry opens a stable detail URL and shows the operation, actor, company or organization scope, time, changed fields, approval/proposal reference when applicable, and exact resulting records. A module-level Changes view and an aggregate Finance view use the same read contract. Preserve filters and Back/reload behavior.

Show additions, removals and edits with text labels as well as color. Match lines by stable line identity; include units, currency, tax/rounding context and authoritative totals. Attachment changes compare document/version references, not file bytes or extracted private text. Creation and deletion have explicit semantics. Missing historical before values mean **Earlier value not recorded**, not an invented diff against today's record.

Company changes, logout or revoked access clear loaded history, previews and review state. Pagination states and date ranges describe the data actually loaded. History detail has keyboard access, focus return, mobile layout and localized dates/money.

### Propose and review

1. Open an eligible record and choose **Propose change**. Load an authorized server base and allowed editable fields.
2. Edit the proposal without changing the canonical record. Enter a reason and preview the proposed field and financial consequences.
3. Submit one immutable proposal version. The server derives scope/actor, validates the typed operation, captures the material base fingerprint and binds current review policy. The proposal is not an applied update.
4. An eligible reviewer opens it from the record, module review filter, Approvals or their Work assignment. Show **Base**, **Current**, **Proposed** and the proposed consequences separately.
5. The reviewer approves or rejects with the existing workflow rules. Requesting changes creates a successor proposal version; approvals never transfer to changed payloads.
6. The domain owner revalidates and applies the exact approved operation. Show **Applied** only when exact durable evidence identifies the committed result. A lost response offers **Check outcome**, not another execution.

When the record materially changes, mark the proposal stale and require refresh plus explicit resubmission/review. Alpha does not automatically merge fields, even if edits appear independent. Posted invoices, payments and journal entries use explicit correction/reversal operations and their approvals; there is no generic Restore or Reset for posted state.

## Server and contract design

### Storage per organization

**Recommended alpha topology:** reuse the existing managed PostgreSQL durable store for append-only history, sharing physical infrastructure across organizations assigned to that store. SpacetimeDB remains the transactional owner of business writes and active proposal/review state. Organization placement selects the durable store; clients cannot choose a database or supply trusted organization scope. A separate PostgreSQL instance for every organization is not the alpha default.

| Data | Transactional owner | Durable storage and read role |
| --- | --- | --- |
| Current business records, active ChangeSets, approval tasks and application receipts | Existing canonical SpacetimeDB domain/workflow owners | Existing generated PostgreSQL projection and reconstruction coverage; current authorization/application reads remain owner-controlled |
| Immutable committed changes, proposal versions and decision/application evidence | Private capture in the same SpacetimeDB transaction as the associated operation | Generated append-history relations in the organization's PostgreSQL durable store; bounded authorized history API |
| Receipt images, PDFs and other source files | Existing document/blob owner and version identity | Existing private object storage; history retains authorized version refs and integrity digests, not file bytes |

The write path is:

```text
canonical reducer transaction
  business mutation + private evidence + organization commit
                           ↓
existing ordered projector
  one PostgreSQL transaction: history rows + exact commit + watermark
                           ↓
authorized record/module/Finance history reads
```

`OrganizationCommit` already carries a monotonic per-organization sequence and checksum; `OrganizationRowChange` carries exact ordered outcomes. `api-server/src/cold_tier/commit_projection/` validates and applies these atomically with its PostgreSQL watermark and supports generated `AppendHistory` projection mode. Extend that pipeline; do not add a best-effort browser audit request or dual-write PostgreSQL from the business command. Full-row projection changes are reconstruction evidence, not automatically sufficient business before/after review evidence: the reducer still captures material deltas explicitly.

Key all history identities and uniqueness constraints by organization plus stable event identity, tied to commit sequence/ordinal where applicable. Include organization in relation ownership/foreign-key checks. Add indexes for `(organization_id, resource, record_id, sequence)` and `(organization_id, company_id, sequence)`; represent organization-wide scope explicitly. Store searchable actor/operation/time/record metadata in typed columns and bounded schema-versioned deltas in generated JSONB or typed child relations. Preserve exact IDs and money/decimal semantics in codecs; JSON numeric conversion must not round them.

Use application-enforced source/field policy on every history read and PostgreSQL row-level isolation as defense in depth for the history reader. An RLS policy alone does not enforce company/field permissions. The reader must not own the relations or have BYPASSRLS; scope is set transaction-locally from trusted server context and tested across pooled-connection reuse. Projector/reconstruction access uses separate service roles and never the interactive reader. Implement and test this new policy explicitly; existing PostgreSQL RLS is not assumed.

Start with ordinary indexed tables. Introduce shared time partitions when measured size/retention or query plans justify them; avoid a partition, schema, connection pool or database per small organization. Keep placement and identity formats compatible with moving a large or regulated organization to a dedicated durable store later. Physical isolation becomes appropriate for contractual residency/isolation, organization-specific restore requirements, unusually large workloads or measured noisy-neighbor effects. A separate shared history cluster is a later capacity boundary only if the existing durable-store pipeline can move/project atomically at its declared watermark; it is not a second independent history authority.

Long-term history is PostgreSQL-oriented; SpacetimeDB should retain active review state and the unconfirmed/recent evidence needed for safe delivery and current UI. **There is no existing general history eviction contract.** Initially retain new capture rows until a new resource-specific retention/finalization path proves exact PostgreSQL payload/checksum, contiguous durability watermark, dependencies and reconstruction behavior. Do not change `audit_log`'s current `always_hot` policy or reuse the POS finalizer by changing a table name. Budget the alpha's hot evidence volume and extend the retention protocol before history growth exceeds it.

During projector lag, preserve the committed evidence for replay. The UI distinguishes a canonical operation result from confirmation that PostgreSQL has reached that commit. History may show an explicit syncing state or use an authorized, bounded exact hot tail merged by immutable event identity; it must not invent missing events or claim a complete timeline across gaps. A PostgreSQL outage cannot silently lose history. Define lag/backlog alarms and admission/backpressure thresholds for exhausting safe capture capacity.

Financial retention, organization export/deletion and legal holds use the existing policy owner. A shared PostgreSQL backup/PITR restores the store, not a single tenant in place: test organization recovery into an isolated destination at an exact verified watermark. Append-only application permissions and checksums detect some changes but do not make privileged database tampering impossible; independently retained immutable checkpoints or signed export bundles are a separate requirement if stronger audit integrity is selected.

### One change envelope and existing audit ownership

Evolve the existing audit owner with a **private business-change evidence record**, linked to exact existing audit IDs. The envelope identifies organization, actual company or organization-wide scope, primary record and typed operation, server event sequence/ID, actor, human/service origin, timestamp, correlation/causation, before/after material fingerprints, related effect refs and evidence completeness.

Store bounded typed field/line deltas once in private evidence. For migrated producers, the ordinary audit row contains a safe summary/reference, rather than a second full copy of sensitive old/new payloads. Use the existing subscription amendment/document version evidence by reference where it is already sufficient. Select the generated schema and migration in `FCR-01`; no handwritten parallel contract catalog.

Evidence is captured inside the canonical reducer transaction, before and after the actual mutation. Rollback rolls it back. A genuine no-op creates no fabricated field edit. Required capture failure aborts a covered mutation. Audit rule configuration cannot disable evidence required by the released feature. Existing jobs, imports, generated effects and explicit native entry points must call the same owner capture boundary.

Raw/client-authored audit entries remain distinguishable legacy or reported events. They cannot mint trusted change IDs, impersonate another actor, supply canonical values or be used as application receipts. Do not backfill fictitious historical snapshots. Record a per-operation coverage start and completeness state.

`audit_log` is currently `always_hot`; the former audit cold-tier proposal is superseded. Follow the current storage-policy manifest, not its historical drainer design. Decide retention and historical-read behavior before release; evidence required for financial history/reconstruction must not disappear through ordinary cleanup.

### Proposed ChangeSet aggregate

Use one server-side ChangeSet model compatible with the offline plan, initially constrained to one aggregate and one closed typed operation. Its immutable submitted version binds:

- ChangeSet/version ID, request/idempotency key, organization/company scope and proposer;
- typed operation and validated parameters, reason, primary record and owned child identities;
- material base fingerprint, normalized proposed payload hash and exact preview evidence;
- review policy/workflow version, task/decision references and supersession lineage;
- exact execution receipt, canonical change IDs and resulting record references.

The draft is mutable only by an authorized owner; submission freezes the reviewed version. The lifecycle distinguishes Draft, Submitted/Awaiting review, Rejected, Withdrawn, Superseded, Stale, Approved/Awaiting execution and Applied. A definite apply failure is distinct from an unknown response. These labels project existing workflow/receipt state; do not maintain contradictory approval flags in a second state machine. For synchronous adapters, final approval and application/evidence commit atomically. An adapter requiring deferred external execution needs its existing durable intent/receipt state and cannot claim atomic provider delivery.

Add closed typed proposal-update variants through the existing guarded action registry. Each calls an existing in-process domain implementation after checking the exact proposal/version/hash. Do not dispatch arbitrary reducer names, SQL, table patches or browser JSON, and do not chain HTTP calls to simulate a transaction. Preserve published operation IDs and immutable migration bytes.

The base fingerprint includes every material field and child/dependency snapshot used by the operation. Reuse existing action snapshots where valid; add domain-specific material projections elsewhere. An `updated_at` timestamp or latest audit ID is not a revision contract. Revalidate currency/tax/period, financial state and relevant document/evidence versions at apply time. Changed material inputs invalidate approval; current authority is always rechecked regardless of the fingerprint.

### Authorization and bounded reads

- History requires an explicit business-history capability plus current source and field-read authority; ordinary users do not inherit Settings audit-admin access. Reviewer authority does not grant hidden financial or employee fields.
- Every list, comparison, count, search, detail, replay and export resolves trusted session/tenant scope server-side. Recheck company membership, source-read, proposer/reviewer policy, separation of duties, delegation and the actual domain action permission before consequential decisions.
- CRM organization-wide records retain genuine organization scope. Do not relabel a nullable company as the currently selected company. Resolve child-to-parent scope at the canonical owner.
- Redact historical values, field names, record labels, related links and derived totals according to current policy before sending them to the browser. Denied or hidden evidence must not become blank/zero or leak through counts, errors or export.
- Deleted records need an explicit historical-source authorization policy using immutable ownership and current grants; absence from today's source query is not permission to expose old values.
- Use bounded server pagination with stable IDs and scope-bound cursors. Native HTTP SQL has unordered-limit constraints: reuse complete numeric windows and bounded seeking rather than assuming arbitrary LIMIT results are chronological. Unauthorized or sparse pages may have a continuation cursor even when empty.
- Compare critical fields only when the reviewer may inspect sufficient material evidence; otherwise explain that the review is unavailable and block approval. Do not silently approve a redacted diff.

### Results and recovery

The same-key/same-payload replay returns the original authorized receipt without another mutation. Changed input under the same key is rejected. Two reviewers or retries cannot execute twice. Permissions are rechecked before reading a prior receipt as well as before a new command.

Proposal, decision and application reads are cache-independent when used as proof. Preserve only the minimal reconciliation reference after an uncertain response. Do not show another user's later record state as proof of this attempt. Editing a submitted proposal creates a new version and fresh approval context; rejection/withdrawal does not undo an applied business action.

Record authoritative business changes and proposal/decision/application evidence in the same existing organization commit pipeline. Restore must preserve exact IDs, links, hashes and pending/applied distinctions without redispatching an action. No new evidence table becomes archive-eligible without the existing watermark/retention contract.

## Implementation packages

All packages start **TODO**. This plan authorizes planning scope, not deployment, approval-policy changes or external writes. Each return records integrated revision, contract pin, commands actually run, evidence gaps and the next dependency. Shared schema/codegen releases are serialized through the existing publisher workflow.

| ID | Depends on | Deliverable | Acceptance gate |
| --- | --- | --- | --- |
| FCR-00 | Current alpha baseline | Machine-readable seven-module operation/record matrix, exact field and line allowlists, read/write owners, current audit completeness, direct/native/import/job coverage and proposed-update eligibility | Every enabled alpha mutation has a disposition and test owner. Apply the confirmed normal-save/history behavior and classify selected review actions under existing rules; settle sensitive-field policy and history retention. Recheck current CI failures before attributing regressions to this feature. |
| FCR-01 | FCR-00 | Rust-owned private evidence + ChangeSet/version/receipt contracts, closed operation descriptors, permissions, material fingerprints, additive migrations, PostgreSQL append-history projection and reconstruction registration | No new sensitive public payload; cannot forge trusted evidence through raw audit logging; existing published contracts/migrations remain compatible. Verify history-reader RLS/role/pool isolation and projector retry/checksum/watermark behavior. New tables have storage/ownership/restore policies. |
| FCR-02 | FCR-01 | Accounting draft invoice/bill vertical slice: trusted create/edit history, proposed draft update, review, atomic application and exact reload/readback | Two independent users complete UI edit → compare → approve → one canonical effect. Stale, denied, self-approval where prohibited, duplicate decision and lost-response cases pass against real disposable services. |
| FCR-03 | FCR-02 | Shared record/module/Finance Changes renderer and bounded authorized API; before/after and base/current/proposed components; stable links and filters | Restricted field, deleted record, company switch, sparse pagination, empty/error/incomplete, keyboard/mobile and exact outcome tests pass. Existing ordinary save flows remain truthful. |
| FCR-04 | FCR-02, FCR-03 | Remaining Accounting history: posting/payments/allocation, bank settlement/reversal/recovery, import, close and assets; reviewed lifecycle consequence previews | Every Accounting row in FCR-00 has canonical evidence. Existing financial and Rwanda alpha suites retain their assertions; bank-owned actions cannot be bypassed. |
| FCR-05 | FCR-03 | Sales and Purchasing adapters, header/line diffs, proposal updates and existing guarded-action links | Quotation/order and RFQ/PO changes reach exact receipt/invoice links; competing edits, approval invalidation and retry do not double-create stock or ledger effects. Split Sales and Purchasing into separate reviewable slices. |
| FCR-06 | FCR-03 | Expenses history and editable-expense/report proposals, attachment-version references and approval/posting lineage | No premature reimbursement/posting, no second receipt upload on outcome checks, employee/finance field policies and self-approval rules verified. |
| FCR-07 | FCR-03 | CRM contact/lead/opportunity history, typed proposed updates and conversion links | Genuine organization/company scope and current contact-field policy hold. Approved edit and stale conversion cases are exercised through UI and native enforcement. |
| FCR-08 | FCR-03 | Reports history and typed template/schedule proposals; definition/result distinction | Saved definitions round-trip by exact ID; stale updates are atomically rejected, unauthorized recipients rejected, historical report outputs remain unchanged. Repair existing create/readback shortcuts for covered paths. |
| FCR-09 | FCR-03 | Subscriptions history and native amendment proposal/review adapter | Preview and execution agree on effective dates/proration; no duplicate billing; existing amendment version and exact resulting invoice remain authoritative. |
| FCR-10 | FCR-04..09 | Review discovery in module views, existing Approvals/My work and Finance aggregate; shared in-app notifications where supported | All seven modules have history and their declared proposal path. Reviewer filters and badge counts are scoped. No invented task adapter, parallel inbox or action hidden behind an unrelated module. |
| FCR-11 | FCR-10 | Complete acceptance matrix, populated upgrade and per-organization reconstruction drill, backward compatibility, PostgreSQL outage/lag recovery, hot-history capacity/retention bounds, exact-image deployment plan and staged alpha enablement | Same-release native/API/browser gates pass for every included module, with zero unclassified enabled operations. Projection retry creates no duplicate history; pool reuse cannot cross organization scope; no eviction before verified durability. Restore creates no additional business effects. Deployed alpha acceptance remains a separately recorded gate. |

Sequence: **FCR-00 → FCR-01 → FCR-02 → FCR-03 → module adapters → FCR-10 → FCR-11**. Stabilize the Accounting slice and shared contract before broad module adoption. Record remaining effort after FCR-00 rather than estimating from route count. Source/capture correctness, source permissions and transactional fingerprints are the critical path, not the number of diff components.

## Verification required to land

Use existing native domain reducers, API authorization tests and seeded Playwright infrastructure. Browser cases must perform the actual operator transitions; fixture calls may set up dependencies. Reuse the existing CI selectors and prove required lanes are nonempty. No synthetic financial records or migrations run against production during implementation.

For **each of the seven modules**, record:

1. A normal UI save produces the exact committed history entry and authorized before/after values; failed/no-op attempts do not claim changes.
2. A proposed update changes no canonical source before application; an independent eligible reviewer applies exactly the submitted version and can reopen the same history/result URL after reload.
3. Concurrent edits and changed material dependencies make approval stale without changing business state. Amending requires a new proposal version and review.
4. Wrong organization/company, revoked membership, lost field-read permission and expired delegation deny the relevant read/decision/replay. Direct BFF/native calls cannot bypass the owner checks or forge evidence.
5. Opposing decisions, duplicate submissions, same-key changed inputs and response loss preserve exactly one result. Outcome checks never POST again.

Cross-cutting gates include financial decimal/rounding/currency and line-identity correctness; child deletion; template markup escaping; safe attachment references; actual approval policy/quorum; retained posted-record correction rules; scoped pagination/search; desktop and 390px keyboard review; upgrade with existing data retained; projection/reconstruction completeness; and feature-disabled compatibility.

Run formatting, documentation link checks, contracts generation/drift and immutable release checks when their files change; native/API/unit/type/build/browser checks appropriate to each package. Release acceptance binds one application commit, contract release, migration catalog, image digest, tenant/company fixture and policy configuration. The baseline's failed browser shards do not waive feature or release gates.

## Rollout and later work

Enable trusted capture before exposing comparison so users receive a truthful coverage start. Enable read-only history for an isolated alpha company, then the Accounting proposal slice, then the remaining six module adapters. Complete seven-module acceptance before describing this feature as available across finance alpha. Use the existing deployment/configuration owner for explicit per-company history/proposal exposure; no new feature-flag service is required.

Rollback disables new proposal submission while retaining history and pending review/application readback. Already committed actions are not reversed. Drain or explicitly hold pending work under a documented compatibility policy; old clients cannot bypass a newly required server approval. Additive evidence/schema stays readable during an application rollback.

Later extensions are offline capture/push using this same ChangeSet contract, arbitrary multi-aggregate dependency bundles, wider ERP modules, desktop adapters and optional AI-produced proposals. These do not block the seven-module online alpha slice.

## Next implementation assignment

The [first trusted-history implementation status](../plan/finance-alpha-change-history-status.md)
records the source inventory and ordinary Accounting draft-line history candidate.
It does not complete the proposed-update review/apply boundary. Finish its coherent
contract release and integrated runtime gates, then implement the typed Accounting
proposal slice before broader module adoption. Preserve the current finance-alpha
navigation and canonical owner boundaries throughout.
