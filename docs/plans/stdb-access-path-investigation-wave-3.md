# STDB access-path investigation — Wave 3

**Status:** Investigation complete — 2026-08-24  
**Tracks:** `spacetimedb`, `performance`, `reducers`, `indexes`, `authorization`, `forms`, `documents`, `hr`, `expenses`, `helpdesk`, `manufacturing`, `integrations`, `application-contract-ir`  
**Related:** [stdb-index-access-path-optimization-plan.md](./stdb-index-access-path-optimization-plan.md) · [stdb-access-path-investigation-wave-2.md](./stdb-access-path-investigation-wave-2.md) · [stdb-access-path-post-batch-pickup.md](./stdb-access-path-post-batch-pickup.md) · [subscription-query-ir-codegen-plan.md](./subscription-query-ir-codegen-plan.md)

---

## 1. Objective

Run a third access-path pass over reducer families left outside the first two investigations, with particular attention to cross-cutting helpers that amplify cost across many domain reducers.

This wave inspects:

- core membership / RBAC / policy / audit / privacy paths;
- HR leave, attendance and onboarding;
- expenses and receipt/idempotency paths;
- helpdesk;
- manufacturing and remaining inventory/replenishment flows;
- configurable forms/custom fields;
- documents and polymorphic attachment access;
- CRM conversation/provider callback paths;
- payment helper scans not fully captured in the first accounting pass;
- data import/rollback and retention maintenance;
- proposals, analytics, integrations and IoT as lower-priority/future candidates.

As with Wave 2, candidate indexes are evidence, not pre-approved schema changes.

> **Wave 3 implementation remains behind the same first-batch completion gate defined in `stdb-access-path-post-batch-pickup.md`.**

---

## 2. Executive findings

### 2.1 Authorization/membership is the highest-value omission

`check_permission` sits underneath a very large fraction of ERP reducers. Today it:

1. point-loads the profile;
2. finds an active membership from the user-only index and filters organization in Rust;
3. point-loads the role;
4. iterates organization permission rows and evaluates subject/resource/action in Rust.

Policy-snapshot rebuilding repeats similar organization-wide permission/field-permission filtering.

A small access-path improvement here has multiplicative effect across Sales, Accounting, Inventory, HR, AI, workflow, etc. It should therefore be considered before lower-frequency domain-specific optimizations once the first batch has passed.

### 2.2 Several scans are not missing-index problems — existing indexes are simply bypassed

Examples:

- expense `sheet_lines` scans all `hr_expense` rows even though `expense_by_sheet` exists;
- policy-snapshot upsert scans `policy_snapshot` despite an existing `(organization_id, user_identity)` accessor;
- some membership checks use global `.iter().any(...)` despite user/org indexes already existing.

The IR/static checker should distinguish:

```text
missing access path
existing access path not used
intentional bounded fanout
intentional maintenance scan
```

### 2.3 One normalized StockQuant identity can remove scans across multiple domains

Manufacturing completion, cycle counting, and replenishment all need a semantic quant lookup resembling:

```text
organization
company
product
location
lot
package
owner
```

The optional lot/package/owner columns make repeated handwritten scanning tempting. Instead of adding different MRP/cycle/replenishment indexes, define one normalized quant identity/access contract, using normalized keys where STDB option-index limitations require them.

### 2.4 Configurable forms are a hidden shared hot path

Custom-field definition resolution currently scans form fields and user custom fields. As organizations add modules, localized/custom fields and forms, this can become an unexpectedly expensive validation path.

Because form metadata is already contract-like, this is an especially good fit for IR-owned access metadata.

### 2.5 Batch/maintenance reducers should remain explicitly different from interactive reducers

Retention purge, import rollback, integrity audits, and bounded workflow-graph traversal should not be forced into the same optimization model as interactive point/few-row reads.

They should be classified as:

```text
bounded-fanout
batch
checkpointed-scan
version-bounded graph traversal
```

and given explicit resource/time limits instead of unnecessary projections.

---

## 3. Core authorization, membership and policy

### Current hot paths

`check_permission` resolves active organization membership through `user_org_by_user` then filters organization/active. `try_org_permission` walks every permission row for the organization and checks subject, resource and action in Rust.

User-management reducers also contain broad membership existence checks and role-name scans. Role-name matching performs normalized/lowercase comparison at runtime, which cannot be served by a normal raw-name index without a normalized persisted key.

Policy-snapshot construction repeats org-wide filtering for permission and field-permission rows, while snapshot upsert can use an already-existing `(organization_id, user_identity)` accessor instead of `.iter().find(...)`.

### Candidate reshapes

```text
UserOrganization
(user_identity, organization_id, is_active)
(organization_id, role_id, is_active)

Role
(organization_id, normalized_name, is_active)

OrgPermission
(organization_id, normalized_subject_kind, normalized_subject_key, resource, action)

FieldPermission
(organization_id, normalized_subject_kind, normalized_subject_key, resource, action)

UserRoleAssignment
(organization_id, role_id, is_active)

PolicySnapshot
use existing (organization_id, user_identity) path directly
```

Do not create an authorization cache that can drift independently from the canonical permission model. A `PolicySnapshot` remains a rebuildable projection only if every permission/membership mutation has deterministic invalidation/rebuild wiring.

### Immediate low-risk cleanup

- replace policy-snapshot `.iter().find(...)` with the existing composite accessor;
- replace global membership existence scans with a compatible user/org path;
- add a normalized role-name key only if role-name commands remain part of the public/onboarding contract.

**Priority after first-batch gate: P0 / cross-cutting.**

---

## 4. Core audit and privacy

### Audit

`log_audit_event` performs a global membership `.iter().any(...)` check before accepting a raw event. This should reuse the same bounded membership path as `check_permission` rather than maintain a separate broad lookup.

The audit log itself is append-only and already has a Postgres cold-tier drainer. Do not solve audit growth by adding many STDB indexes. Keep hot indexes only for operational/drainer requirements and let the cold-tier architecture remove historical pressure.

### Privacy retention

`execute_retention_purge` intentionally traverses classifications/rules and then finds operational messages older than a cutoff.

Classify this as a maintenance operation, not an interactive reducer. Candidate shape if volume requires it:

```text
OperationalMessage
(organization_id, created_at)
```

Then run purge in bounded batches/checkpoints rather than one very large transaction.

Classification-rule lookup may use:

```text
(organization_id, classification_id)
```

only if rule volume warrants it.

**Priority: P1 for membership reuse; P2/batch for retention tuning.**

---

## 5. HR leave, attendance and onboarding

### Leave allocation

Leave allocation is repeatedly resolved by employee and then filtered by leave type/year. Approval/consumption paths depend on this lookup.

Candidate:

```text
HrLeaveAllocation
(org, company, employee_id, leave_type_id, period_year)
```

Prefer uniqueness if the domain invariant is one allocation row per employee/type/year/scope.

### Attendance conflict

Attendance checks validated leave conflicts by employee and then evaluates state/deleted/date overlap.

Candidate narrowing path:

```text
HrLeave
(org, company, employee_id, state, date_from)
```

`date_to` overlap still requires a post-index predicate; the goal is to avoid traversing the employee's entire leave history.

### Onboarding

Onboarding already starts from `employee_id`, but repeatedly filters:

```text
template_item_id = 0
status != done
```

and item-progress rows by employee + template + item.

Candidate paths:

```text
HrOnboardingProgress
(org, company, employee_id, template_item_id, status)
(org, company, employee_id, template_id, template_item_id)
```

Do not create an onboarding projection; these are naturally bounded row sets once keyed correctly.

**Priority: P1.**

---

## 6. Expenses

### Existing-index bypass

`sheet_lines` currently scans `hr_expense().iter()` for `sheet_id`, despite the table already exposing `expense_by_sheet`.

This should be corrected before adding a new index.

### Receipt replay/idempotency

Receipt registration scans every receipt looking for:

```text
organization_id + client_request_id
```

Candidate:

```text
HrExpenseReceipt
(org, company, client_request_id)
```

or `(org, client_request_id)` if the idempotency contract is explicitly organization-global.

### Operational queues

Concrete expense queue consumers may justify:

```text
HrExpense
(org, company, employee_id, state, date)
(org, company, state, has_receipt)

HrExpenseSheet
(org, company, state, employee_id)
```

but add these only after mapping actual subscription/query consumers.

### Statutory/rate seeding

Mileage/per-diem seeding contains existence checks by org/company/name. Persisted normalized name/code keys should be preferred over repeated broad scans if seed/reconcile runs are common.

**Priority: P0 for existing-index reuse and receipt idempotency; P1 for queues.**

---

## 7. Helpdesk

### Index correctness issue

`HelpdeskTicket` declares:

```text
ticket_by_assignee -> btree(organization_id)
```

although the accessor name implies assignment lookup. Treat this first as a schema/index correctness audit, not just a performance enhancement.

Likely operational ticket shapes:

```text
(org, team_id, state, sla_deadline)
(org, user_id, state, sla_deadline)
(org, partner_id, state)
```

### Team membership

Assignment validation starts with `team_id` then filters identity. Add/remove membership uses the same pattern.

Candidate:

```text
HelpdeskTeamMember
(org, team_id, identity) UNIQUE
```

Agent existence currently scans contacts for `(org, user_id)`. If contacts remain the authoritative agent link, add/reuse a bounded contact-by-user identity path; otherwise resolve through the canonical active `UserOrganization` membership model and avoid duplicating identity authority.

Scheduled SLA jobs are per ticket, so do not introduce a global SLA-deadline scan unless a concrete worker/query requires it.

**Priority: P0/P1 because the assignee index definition should be verified/fixed.**

---

## 8. Manufacturing, cycle count and StockQuant identity

Manufacturing `upsert_stock_quant` performs a semantic quant scan for:

```text
org + company + product + location
+ lot=None + package=None + owner=None
```

Cycle count performs the same family of lookup for org/company/product/location/lot. Replenishment repeatedly sums/narrows StockQuant by product + location/company.

Do not create three separate fixes. Define one canonical quant access identity:

```text
StockQuant
(org, company, product_id, location_id, lot_key, package_key, owner_key)
```

where `*_key` normalizes nullable values only if required by STDB indexing constraints.

If valid for the inventory model, make this uniqueness-enforcing. The invariant prevents duplicate semantic quants and gives Manufacturing, cycle count, reservation/replenishment and stock updates the same fast accessor.

Additional MRP operational candidates:

```text
MrpProduction
(org, company, state, date_planned_start)
(org, company, product_id, state)

MrpWorkorder
(org, company, production_id, state)
(org, company, workcenter_id, state)
```

Only add the MRP composites for mapped planning/workcenter consumers.

**Priority: P0, but fold into the existing Wave 2 Inventory redesign rather than implement as a separate MRP index track.**

---

## 9. Replenishment and inventory auxiliary reducers

The replenishment path contains several expensive discovery/dedup patterns:

- supplier info scans filtered by org/product/company/activity then sorted by sequence;
- existing purchase order dedup by org/company/origin/open state;
- a second broad PO lookup after creation to recover the newly-created order;
- existing picking dedup by org/company/name/open state;
- another broad picking lookup after creation;
- StockQuant source/availability searches.

Candidate contracts:

```text
ProductSupplierInfo
(org, product_id, company_scope, is_active, sequence)

PurchaseOrder
(org, company, origin, state)

StockPicking
(org, company, name, state)

ReplenishmentRule
(org, company, active, next_run)
```

Prefer a stronger API/internal helper reshape where possible: internal create functions should return the created authoritative row/ref so callers do not need to query the table again immediately after creation.

For deduplication, a first-class replenishment semantic key/receipt is preferable to overloading human-readable `origin`/`name` if the operation must be retry-safe.

Inventory quality/packing/cycle-count scan candidates should reuse the canonical StockQuant access contract rather than grow their own parallel lookup rules.

**Priority: P0/P1 after base Inventory access-path proof.**

---

## 10. Accounting payment helpers

The accounting idempotency receipt implementation is already strong: deterministic receipt ID gives a primary-key replay lookup. Preserve this pattern as the model for other domain command receipts.

A remaining payment hot path scans all `AccountMove` rows to find a posted, residual invoice/bill for a partner before selecting a clearing account.

Fold this into the existing Accounting access-path work rather than create a payment-specific duplicate:

```text
AccountMove
(org, company, partner_id, state, payment_state/move_type)
```

with residual/open-state filtering after narrowing.

WHT tax discovery similarly suggests a reusable company/type/active tax access path if it is not already covered by Accounting/Tax work.

**Priority: P1; fold into Accounting batch.**

---

## 11. Forms and custom fields

This is a strong previously-missed shared path.

`FormConfig` has no organization/form identity index. Custom-field definition resolution can scan form fields and user custom fields before loading parent configuration.

Candidate access paths:

```text
FormConfig
(org, module_id, form_id) UNIQUE

FormConfigField
(configuration_id, field_id) UNIQUE

FormRoleConfig
(configuration_id, role_id)

UserCustomField
(org, user_id, configuration_id, field_id)

RecordCustomFieldValue
(org, company, model, record_id, field_key) UNIQUE
(org, company, model, record_id)          list path
```

The current `RecordCustomFieldValue` composite omits `model` and `field_key`, even though the logical EAV identity includes them.

IR fit:

- form/resource identity is already application-contract metadata;
- generated custom-field validation should declare a bounded definition lookup;
- custom-field writes should fail generation/CI if they require global definition scans.

Do not move validation/business semantics into codegen; IR only owns the lookup contract.

**Priority: P0/P1 because the path is cross-module.**

---

## 12. Documents

Document metadata remains in STDB while file bytes stay in Object Storage and semantic/full-text indexing belongs in Postgres.

The important missing STDB paths are relational/navigation paths, not content search.

Candidate:

```text
Document
(org, company_scope, folder_id, is_deleted)
(org, res_model, res_id, is_deleted)

DocumentFolder
(org, company_scope, parent_id)
```

The `(res_model,res_id)` path is especially useful for record attachments/chatter and should align with the same typed-polymorphic resource-reference work used by CRM activities.

`DocumentVersion` is already bounded by document ID.

`DocumentFolder.document_count` is an existing maintained operational counter and may be described as projection-like metadata, but it does not require a new projection table.

**Priority: P1.**

---

## 13. CRM inbox/provider callbacks

CRM conversation/provider paths contain replay and provider-identifier lookups that may become high volume once WhatsApp/SMS adapters are enabled.

Current provider-event replay starts from provider account then filters event ID. Provider-message uniqueness scans conversation messages globally by org/provider message ID.

Candidate:

```text
CrmProviderPrincipal
(org, provider_account_id, is_active)

CrmProviderEventReceipt
(org, provider_account_id, provider_event_id) UNIQUE

CrmConversationMessage
(org, provider_message_id) UNIQUE/equality when non-null

CrmConversation
(org, company, assigned_user_id, status, last_message_at)
(org, contact_id, channel, status)
```

Assignee validation should also reuse the cross-cutting bounded `UserOrganization(user,org,active)` access path from section 3.

Because direct provider adapters are not an initial MVP blocker, introduce these when provider traffic becomes active, except for replay-identity correctness constraints that should be fixed before enabling the adapter.

**Priority: P1 when messaging provider goes live.**

---

## 14. Sales OMS integration intents

`create_sales_integration_intent` scans all intent rows for `(organization_id, idempotency_key)`.

Candidate:

```text
SalesIntegrationIntent
(org, idempotency_key) UNIQUE
(org, company, status, create_date)
```

The first is a correctness/idempotency path and should be preferred over a generic status index for replay handling.

This is another candidate to migrate toward the same typed command/effect-receipt pattern already used by Accounting and Queue rather than proliferating ad-hoc idempotency scans.

**Priority: P1.**

---

## 15. Import, retention, analytics and other deliberate batch paths

### Imports

Import rollback already uses `import_record_by_job`; the fanout is naturally bounded by one import job. Keep it that way.

Optional operator listing may justify:

```text
ImportJob
(org, status, started_at)
```

but imports should primarily be controlled through row/batch limits, checkpointing and sandbox preprocessing rather than more STDB indexes.

### Analytics/reports

Existing cached `AnalyticsMetric` state can be represented as a projection descriptor if it remains a hot KPI surface. Long-history computation belongs in Postgres.

If the report scheduler currently polls due schedules, evaluate:

```text
ScheduledReport
(is_active, next_run)
```

with required org/company scope in consumers. Do not add it without confirming the worker's actual read path.

### Workflow branch traversal

Topology helpers load nodes/edges through workflow-version indexes and then traverse an in-memory graph. This is bounded by one workflow version and is not an accidental database scan. Leave it alone unless measurement proves graph compilation/projection is needed.

### Integrations

Google Drive connection update/sync reducers are direct ID lookups. No immediate index change is justified from these reducers alone. A `(sync_enabled,next_sync_at)` path is only needed if a concrete due-sync poller exists.

### IoT

Hub-device sync loads all devices for one hub, which is a bounded fanout and acceptable for typical hub sizes. `(hub_id, identifier)` can become unique if device counts/sync frequency justify it, but IoT remains a future deployment track.

### Proposals

Proposal children are generally bounded by proposal indexes. Consider `(org,company,status,deadline)` for pipeline views only when mapped to real subscription/query consumers.

---

## 16. Recommended post-first-batch pickup order

These findings must not widen the first implementation batch. Once the existing completion gate passes, pick Wave 3 work in this order alongside Wave 2.

### Wave 3A — multiplicative/correctness fixes

1. bounded `UserOrganization` membership lookup used by `check_permission` and audit/assignee checks;
2. permission/field-permission access-path redesign and existing `PolicySnapshot` accessor reuse;
3. existing expense `expense_by_sheet` accessor adoption;
4. helpdesk `ticket_by_assignee` index-definition audit/fix;
5. form/config/custom-field identity access paths;
6. canonical semantic StockQuant identity, folded into Wave 2 Inventory.

### Wave 3B — domain hot paths

7. HR leave allocation / attendance / onboarding composites;
8. expense receipt replay and operational expense queues;
9. replenishment supplier/dedup/create-return reshape;
10. accounting partner/open-invoice payment lookup;
11. document record/folder access;
12. sales/CRM provider idempotency/replay paths.

### Wave 3C — batch/future only when activated

13. retention purge batching/index support;
14. report due-schedule path if worker proves need;
15. proposal pipeline composites;
16. integration due-sync paths;
17. IoT hub-device identity path.

---

## 17. IR/static-analysis additions from Wave 3

Extend AP-0 inventory classification with a reason code:

```ts
type AccessPathFindingKind =
  | "missing-index"
  | "existing-index-unused"
  | "wrong-index-definition"
  | "bounded-fanout"
  | "intentional-scan"
  | "batch-checkpoint-required"
  | "postgres-history"
```

Add CI/static rules for:

- `.iter()` used where a declared compatible accessor already exists;
- accessors whose name/declared purpose does not match indexed columns;
- idempotency/replay checks implemented as unbounded scans;
- cross-cutting authorization reads without a bounded tenant/user path;
- semantic uniqueness enforced only by `.iter().find/any`;
- custom-field definition lookups that cannot resolve through declared config/field identity;
- batch scans lacking an explicit bound/checkpoint annotation.

Do not auto-generate business rules, permission decisions, graph evaluation or projection formulas.

---

## 18. Acceptance criteria

Wave 3 investigation is ready for implementation pickup when:

- each P0/P1 candidate maps to a concrete reducer/helper/query/subscription consumer;
- cross-cutting authorization paths are benchmarked separately because they affect most protected reducers;
- existing indexes are reused before new indexes are added;
- the helpdesk assignee-index mismatch is verified and corrected or explicitly documented if intentional;
- StockQuant receives one shared semantic access contract rather than domain-specific duplicate indexes;
- idempotency/replay paths use unique/equality keys where appropriate;
- custom-field/form lookup becomes bounded and represented in IR;
- maintenance/import operations remain explicit bounded/checkpointed scans;
- Postgres remains history/analytics/search authority and Object Storage remains blob authority;
- all Wave 3 implementation remains gated behind the first access-path batch's green functional/benchmark/IR/regression gates.
