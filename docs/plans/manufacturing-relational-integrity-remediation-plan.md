# Manufacturing Relational Integrity Remediation Plan

**Module:** Manufacturing only  
**Source audit:** Manufacturing relational-integrity and mutation-provenance review, 2026-07-26  
**Owner:** Unassigned  
**Target release:** Unassigned  
**Current readiness:** **Unsafe for real ERP data**  
**Target readiness:** Production ready after every applicable P0/P1 item and release gate is verified  
**Allowed pilot restrictions:** Development fixtures only until every P0 item is verified; no production manufacturing orders, BOM imports, multi-company manufacturing, stock consumption, finished-goods posting, routing execution, or productivity tracking  
**Non-goal:** Redesigning inventory, accounting, IoT, quality, messaging, or company authorization except where a manufacturing relationship requires a compatible integration contract

---

## 1. Purpose

This is the executable remediation plan for the manufacturing relational-integrity
audit. It covers all issues found in:

- `spacetimedb/src/manufacturing/`
- `spacetimedb/src/data_ops/manufacturing_imports.rs`
- Manufacturing generated Rust and TypeScript bindings
- Manufacturing BFF commands and React Query hooks
- Manufacturing form mappers, forms, row actions, tables, and dashboard reads
- Manufacturing reducer, contract, and browser tests

Compilation, generated types, a successful reducer response, a toast, or a row
appearing in a list is not completion evidence. A tracker item is complete only
when the intended relation is represented, its source is justified, the backend
validates it, persisted data proves the write, negative tests prove rejection,
and a fresh read resolves the relationship.

## 2. Audit finding inventory

| Audit ID | Priority | Finding | Primary risk |
|---|---|---|---|
| MFG-P0-01 | P0 | CSV imports bypass relationship validation | Cross-tenant, dangling, zero, and fabricated data |
| MFG-P0-02 | P0 | BOM create trusts header, line, child, and collection IDs | Invalid product, UOM, warehouse, routing, and nested BOM graphs |
| MFG-P0-03 | P0 | Manufacturing-order create validates only product organization | Incompatible inventory context and foreign BOM/warehouse/location IDs |
| MFG-P0-04 | P0 | Workorder, routing, and productivity relations are unchecked | Cross-company execution and nonexistent workcenter/workorder/loss IDs |
| MFG-P0-05 | P0 | BOM update/delete/cost/explosion do not enforce company ownership | Cross-company mutation and false audit attribution |
| MFG-P0-06 | P0 | BOM deletion can leave orphan lines and dangling inbound references | Persisted graph corruption |
| MFG-P1-01 | P1 | Frontend and broad create DTOs invent authoritative values | Fabricated dates, arbitrary state, and caller-owned projections |
| MFG-P1-02 | P1 | Browser BOM creation always submits an empty line collection | Incomplete and misleading BOM creation |
| MFG-P1-03 | P1 | Optional relation updates cannot express explicit clear | Stale relations that cannot be removed safely |
| MFG-P2-01 | P2 | Read paths expose raw IDs and lack explicit active-company behavior | Ambiguous, weakly navigable, potentially cross-company UI |
| MFG-P3-01 | P3 | Contract tests are compile-only and raw-ID forms remain | Semantic regressions pass CI |

## 3. Global definition of done

A work item may be marked **Verified** only when all applicable conditions are
met:

- [ ] The schema or command contract represents the intended relationship.
- [ ] Every submitted field has exactly one documented business source.
- [ ] Organization and company are derived from authenticated context or a
      validated parent and cannot be replaced by an editable form value.
- [ ] Every related row is loaded before its ID is persisted or used.
- [ ] Organization, company, permission, lifecycle, type, UOM, warehouse,
      location, tracking, routing, and operation compatibility are enforced
      server-side as applicable.
- [ ] Required relations never fall back to `0`, `0n`, an empty string, the
      first record, a fabricated date, or an arbitrary enum.
- [ ] State, tracking, availability, counters, totals, costs, reverse-ID arrays,
      audit identity, and timestamps are server-derived.
- [ ] Create, unchanged, clear, and replace semantics are explicit.
- [ ] Collection operations distinguish unchanged, replace, add, remove, and
      clear, and validate every ID before changing any link.
- [ ] Parent, children, stock effects, projections, and audit output commit
      atomically.
- [ ] Retrying a logical operation cannot duplicate BOM lines, workorders,
      productivity logs, stock moves, quant changes, explosion rows, or audits.
- [ ] Delete/archive behavior protects every inbound and outbound relation.
- [ ] Read paths enforce the same organization/company policy as write paths.
- [ ] Fresh reads return stable IDs and useful labels for important relations.
- [ ] Existing invalid data is repaired, quarantined, or blocked before stricter
      code is enabled.
- [ ] Positive tests query distinctive non-default persisted values.
- [ ] Negative tests reject missing, cross-organization, cross-company,
      unauthorized, inactive, archived, deleted, incompatible, circular, and
      malformed references as applicable.
- [ ] Generated bindings, BFF contracts, frontend mappers, queries,
      subscriptions, and invalidation match final backend semantics.

Allowed tracker statuses:

```text
Not started
In progress
Blocked
Implemented, unverified
Verified
Deferred with restriction
```

Only **Verified** counts as done.

## 4. Completion evidence

Add this block beneath each tracker item before changing its status to
**Verified**:

```md
Completion evidence:
- Implementation:
- Schema/command contract:
- Migration/backfill:
- Distinctive submitted values:
- Persisted row query and result:
- Related-scope query and result:
- Missing/cross-scope/lifecycle rejection tests:
- Clear/unchanged/collection semantics:
- Retry and rollback proof:
- Fresh read/UI label proof:
- Generated artifacts and checks:
- Reviewer:
- Completed on:
```

## 5. Canonical implementation patterns

### 5.1 Manufacturing-scoped relation loaders

Share tenant-loading mechanics, but keep operation-specific rules visible:

```text
load related row by ID
→ reject missing
→ compare organization
→ compare company or documented organization-shared scope
→ check caller permission
→ check active/deleted/archived state
→ check manufacturing type and operation compatibility
→ return the loaded row for derivation and persistence
```

Required loader families:

- Company and authenticated/assigned user
- Product and its UOM/tracking/cost properties
- UOM and UOM category compatibility
- Warehouse, stock location, and picking type
- BOM header, BOM line, child BOM, and routing operation
- Workcenter and workorder
- Lot/serial and stock move when material or finished-product tracking applies
- Productivity loss category after an authoritative relation is introduced

Do not create one generic “ID exists” helper that hides domain rules. Helpers
must return `Result`, use `?`, avoid expected-data panics, and borrow rather than
clone unless ownership is required.

### 5.2 System-owned tenant context

```text
authenticated identity
→ authorized organization
→ selected active company
→ validated parent or command
→ reducer derives protected tenant fields
```

Rules:

- A missing active company fails closed; it never becomes `0n`.
- Child commands derive company from the validated parent.
- Audit company comes from the persisted record or validated parent, never a
  parallel caller argument.
- Company-private reads filter to authorized active-company scope.
- Any intentionally organization-shared relation documents that exception.

### 5.3 Intent-shaped manufacturing commands

Create commands accept user intent, not persisted projections.

```text
create manufacturing order:
  product, quantity, optional compatible BOM, planned dates, warehouse intent
  → server derives company, UOM, tracking, state, availability, operation type,
    locations, picking type, counters, and audit fields

create BOM:
  finished product, quantity, type, component intents, optional routing intent
  → server derives UOM/company, validates all lines, computes cost, and stores
    authoritative child relations

create workorder:
  manufacturing order, validated operation/workcenter intent, expected duration
  → server derives product, tracking, company, capacity, state, and projections

log productivity:
  selected workorder, selected loss category, duration, description
  → server derives workcenter, company, user, timestamps, and accumulated totals
```

Remove caller ownership of:

- Lifecycle state and transition flags
- Availability and reservation projections
- Produced quantities at create time
- Product template, UOM, and tracking when derivable from product
- Reverse child-ID arrays
- OEE, performance, productive/blocked time, and workorder counters
- Audit identity and timestamps

### 5.4 Explicit patch and collection semantics

Scalar optional relations:

```text
field absent / undefined → unchanged
null                     → explicit clear when allowed
value                    → validate and replace
```

Use `Option<Option<T>>`, a patch enum, or named set/clear reducers where the
transport cannot express all states.

Collections:

```text
unchanged
replace [ids]
add [ids]
remove [ids]
clear
```

Validate and deduplicate the complete input before mutating any association.
Prefer authoritative child queries or association tables over synchronized
forward and reverse ID arrays.

### 5.5 Atomic and idempotent manufacturing operation

```text
resolve idempotency scope/key
→ return existing committed result if already applied
→ validate every parent and related input
→ write parent, children, stock effects, projections, and audit atomically
→ record committed operation result
```

This pattern is required for:

- BOM header plus component lines and initial cost
- Workorder plus manufacturing-order projection updates
- Productivity log plus workcenter totals
- BOM explosion cache replacement
- Material consumption and finished-goods production
- CSV import batch or documented row-isolated import semantics

## 6. Ordered implementation phases

### Phase 0 — Freeze unsafe paths and establish proof infrastructure

1. Disable or feature-gate manufacturing CSV imports outside development.
2. Block production manufacturing writes through rollout configuration until
   P0 gates pass.
3. Add reusable manufacturing fixture builders for:
   - Organization A and Organization B
   - Company A1 and Company A2
   - Active and inactive products
   - Compatible and incompatible UOMs
   - Warehouses and locations in every scope
   - BOMs, workcenters, routing operations, and workorders in every scope
4. Add persisted-row assertion helpers and negative relation assertion helpers.
5. Define active-company read policy for every manufacturing table.

Exit gate: unsafe paths are restricted and tests can prove exact persisted
foreign keys and cross-scope rejection.

### Phase 1 — Tenant and relation validation foundation

1. Add relation-specific loaders.
2. Remove caller-supplied company from child and record-owned actions.
3. Define product/UOM, BOM/product, warehouse/location/picking-type,
   workcenter/workorder, and routing compatibility rules.
4. Introduce an authoritative productivity loss-category table/relation, or
   remove `loss_id` until the domain exists.
5. Add finite positive quantity/duration/capacity validation.

Exit gate: every relation-bearing reducer can use validated loaded rows and no
required relation accepts zero or a fabricated fallback.

### Phase 2 — Fix interactive backend commands

1. Replace broad BOM, manufacturing-order, workcenter, workorder, routing, and
   productivity create DTOs with intent-shaped contracts.
2. Validate the complete graph before the first insert.
3. Derive protected fields from loaded rows and server context.
4. Enforce company ownership on all update, delete, cost, explosion, lifecycle,
   production, consumption, and completion actions.
5. Make optional and collection update semantics explicit.
6. Make stock consumption and finished-goods posting idempotent and fail closed
   on every stock-move failure.

Exit gate: all interactive P0 paths have positive persisted proof and full
cross-scope/lifecycle negative tests.

### Phase 3 — Repair imports and existing data

1. Define import DTOs containing stable external keys or validated IDs.
2. Preflight every row and relation before promotion.
3. Choose and document atomic whole-file or explicit row-isolated semantics.
4. Remove silent date, zero, product/template, quantity, and enum substitution.
5. Audit existing manufacturing rows for invalid or divergent relations.
6. Repair deterministic records; quarantine ambiguous records.
7. Rebuild authoritative BOM-line, workorder, and productivity associations.
8. Rebuild or invalidate BOM explosion caches after repair.

Exit gate: representative imports pass persisted positive/negative tests and the
data audit reports no unhandled P0 violations.

### Phase 4 — Frontend intent, selectors, and relation-aware reads

1. Require an active company instead of using `?? 0n`.
2. Remove fabricated dates, arbitrary enum fallbacks, and hidden computed
   defaults from manufacturing mappers.
3. Add BOM component-line editing with scoped selectors.
4. Replace raw routing, workorder, loss, and completion-log ID inputs with
   selected record context or scoped selectors.
5. Resolve product, BOM, warehouse, location, workcenter, production, and
   routing labels in list/detail reads.
6. Add useful navigation and company-aware filters.
7. Invalidate all affected parent, child, stock, totals, productivity, and
   explosion queries after mutations.

Exit gate: a fresh UI reload displays exact selected relations and no form
accepts a business foreign key as an arbitrary numeric value where selection or
context is available.

### Phase 5 — Generated contracts, proof suite, and rollout

1. Regenerate Rust/TypeScript bindings after final command changes.
2. Replace compile-only manufacturing contract coverage with semantic contract
   assertions.
3. Run backend persisted positive/negative suites.
4. Run frontend mapper/unit, typecheck, and manufacturing E2E suites.
5. Run retry, rollback, deletion, and migration verification.
6. Attach evidence to every tracker item.
7. Roll out behind restrictions, inspect representative data, then remove the
   write freeze only after all release gates pass.

## 7. Remediation tracker

### MFG-001 — Validate and derive BOM header relations

| Field | Value |
|---|---|
| Priority | P0 |
| Audit findings | MFG-P0-02 |
| Problem and risk | `product_id`, `product_tmpl_id`, `product_uom_id`, warehouse, locations, picking type, and routing are stored without complete validation |
| Affected paths | `spacetimedb/src/manufacturing/bill_of_materials.rs`; generated `CreateBomParams`; shared mapper and BOM form |
| Required fix | Load finished product; derive product template/UOM where authoritative; validate quantity, company, BOM type, warehouse, locations, picking type, and routing compatibility before insert |
| Application pattern | Scoped relation loader; intent-shaped command; system-owned context |
| Migration/backfill | Audit all BOM headers; repair derivable UOM/template values; quarantine missing/cross-scope references |
| Acceptance criteria | No header is inserted until every supplied relation is valid; mismatched warehouse/location/UOM/routing is rejected |
| Persisted proof | Create a BOM with distinctive product, quantity, warehouse, locations, and routing; query the exact stored row and related scopes |
| Dependencies | Phase 1 loaders |
| Rollout restriction | BOM writes disabled until verified |
| Status | Not started |

### MFG-002 — Validate BOM lines, child BOMs, and operation collections

| Field | Value |
|---|---|
| Priority | P0 |
| Audit findings | MFG-P0-02, MFG-P1-02 |
| Problem and risk | Component existence is checked without tenant/company/UOM/lifecycle compatibility; child BOM, operation, attribute, and child-line IDs are trusted |
| Affected paths | `spacetimedb/src/manufacturing/bill_of_materials.rs`; `frontend/packages/erp-shared/src/manufacturing-create-params.ts`; BOM forms |
| Required fix | Validate all component products and UOMs; validate child BOM compatibility and cycles; validate operations and collections; derive parent/company; add explicit component collection operations |
| Application pattern | Selected-parent wiring; scoped loader; explicit association update |
| Migration/backfill | Audit lines for parent/company divergence, invalid child BOMs, cycles, and unresolvable collection IDs |
| Acceptance criteria | All lines validate before any insert; duplicate and circular components are handled by documented rules |
| Persisted proof | Submit multiple distinctive components, reload the BOM, and verify exact IDs, quantities, sequence, and labels |
| Dependencies | MFG-001 |
| Rollout restriction | Component editing unavailable until verified |
| Status | Not started |

### MFG-003 — Enforce BOM company ownership on every record action

| Field | Value |
|---|---|
| Priority | P0 |
| Audit findings | MFG-P0-05 |
| Problem and risk | Update, delete, cost, and explosion compare organization only and trust caller company for audit attribution |
| Affected paths | `spacetimedb/src/manufacturing/bill_of_materials.rs`; BFF hooks for update/delete/cost/explosion |
| Required fix | Load BOM; derive company from BOM; verify caller access; remove parallel company argument where parent-owned |
| Application pattern | System-owned context; selected-parent wiring |
| Migration/backfill | Audit logs for BOM actions whose logged company differs from the BOM company |
| Acceptance criteria | Company A2 cannot mutate or attribute Company A1 BOM operations |
| Persisted proof | Attempt every action from A1 and A2 context, query BOM and audit rows |
| Dependencies | Phase 1 company loader |
| Rollout restriction | Record actions disabled until verified |
| Status | Not started |

### MFG-004 — Define safe BOM deletion and cache behavior

| Field | Value |
|---|---|
| Priority | P0 |
| Audit findings | MFG-P0-06 |
| Problem and risk | Delete uses a reverse ID array that imports do not maintain and ignores inbound MO/child-BOM references |
| Affected paths | `spacetimedb/src/manufacturing/bill_of_materials.rs`; import code; explosion cache |
| Required fix | Query authoritative children by `bom_id`; define restrict/archive/cascade rules for every inbound relation; clear all affected root explosion caches |
| Application pattern | Relation-aware delete; authoritative child query; atomic operation |
| Migration/backfill | Detect orphan lines, dangling MO/child-BOM references, divergent reverse arrays, and stale explosion rows |
| Acceptance criteria | Referenced BOM deletion is rejected or explicitly archived; permitted deletion leaves no orphan or stale cache rows |
| Persisted proof | Query all child/inbound/cache tables before and after delete |
| Dependencies | MFG-002 |
| Rollout restriction | Hard delete disabled until verified |
| Status | Not started |

### MFG-005 — Validate and derive manufacturing-order context

| Field | Value |
|---|---|
| Priority | P0 |
| Audit findings | MFG-P0-03, MFG-P1-01 |
| Problem and risk | Only product organization is checked; BOM, UOM, warehouse, locations, picking type, routing, groups, assignee, dates, states, and projections are trusted or fabricated |
| Affected paths | `spacetimedb/src/manufacturing/manufacturing_orders.rs`; generated params; shared mapper; MO form |
| Required fix | Accept product/quantity/BOM/schedule/warehouse intent; derive company, UOM, tracking, operation context, lifecycle state, availability, counters, and audit fields; validate every optional source relation |
| Application pattern | Intent-shaped command; scoped loader; system-owned context |
| Migration/backfill | Audit existing MOs for relation and derived-field divergence; quarantine impossible graphs |
| Acceptance criteria | Only compatible BOM/product/warehouse/location/picking combinations persist; missing/invalid dates fail |
| Persisted proof | Create with distinctive values and query MO plus every related row |
| Dependencies | Phase 1 loaders; inventory compatibility contract |
| Rollout restriction | MO creation disabled until verified |
| Status | Not started |

### MFG-006 — Make production, consumption, and finish stock effects safe

| Field | Value |
|---|---|
| Priority | P0 |
| Audit findings | MFG-P0-03 and transaction/retry review |
| Problem and risk | Manufacturing stock effects rely on stored unvalidated context; some stock-move errors are ignored; retry and tracking behavior lack persisted proof |
| Affected paths | `spacetimedb/src/manufacturing/manufacturing_orders.rs`; inventory stock reducers |
| Required fix | Revalidate MO graph and lifecycle at execution; enforce lot/serial rules; fail the reducer on every move failure; prevent negative/incompatible quant changes; add operation idempotency |
| Application pattern | Atomic idempotent command; scoped relation loaders |
| Migration/backfill | Reconcile existing MO move arrays, stock moves, quants, and produced/consumed quantities |
| Acceptance criteria | One logical finish produces one finished effect and one material-consumption effect; any failure rolls back all effects |
| Persisted proof | Query MO, moves, move lines, lots/serials, and quants before/after first call, retry, and injected failure |
| Dependencies | MFG-005; inventory invariant service |
| Rollout restriction | Production/consume/finish actions disabled until verified |
| Status | Not started |

### MFG-007 — Validate workorders and derive parent-owned fields

| Field | Value |
|---|---|
| Priority | P0 |
| Audit findings | MFG-P0-04 |
| Problem and risk | Missing workcenter lookup falls back to capacity `1.0`; workcenter, operation, and blocker compatibility are not enforced |
| Affected paths | `spacetimedb/src/manufacturing/manufacturing_orders.rs`; workorder mapper/form/hook |
| Required fix | Load MO and selected operation/workcenter; validate scope, lifecycle, routing, and blocker graph; derive product, company, capacity, state, tracking, and parent projections |
| Application pattern | Selected-parent wiring; scoped loader; atomic parent-child operation |
| Migration/backfill | Audit workorders for missing/cross-scope workcenters, invalid blockers, and divergent MO reverse arrays |
| Acceptance criteria | Missing or incompatible workcenter/operation/blocker fails without inserting a row |
| Persisted proof | Query workorder and parent MO after create; retry must not append a duplicate |
| Dependencies | MFG-005; workcenter loaders |
| Rollout restriction | Workorder creation disabled until verified |
| Status | Not started |

### MFG-008 — Validate routing operations and dependency graphs

| Field | Value |
|---|---|
| Priority | P0 |
| Audit findings | MFG-P0-04 |
| Problem and risk | Routing creation trusts company, workcenter, worksheet modes, and blocker IDs |
| Affected paths | `spacetimedb/src/manufacturing/bill_of_materials.rs`; row-action form/submit; generated params |
| Required fix | Derive company from validated workcenter; validate active workcenter, typed worksheet/time modes, blocker existence/scope, duplicates, and cycles |
| Application pattern | Scoped loader; explicit dependency association |
| Migration/backfill | Audit routing rows and dependency arrays; quarantine cycles and foreign IDs |
| Acceptance criteria | Cross-company, inactive, missing, self-blocking, duplicate, and circular dependencies are rejected |
| Persisted proof | Query operation and resolved workcenter/blocker labels after reload |
| Dependencies | Phase 1 loaders |
| Rollout restriction | Routing creation disabled until verified |
| Status | Not started |

### MFG-009 — Introduce valid productivity and loss relations

| Field | Value |
|---|---|
| Priority | P0 |
| Audit findings | MFG-P0-04, MFG-P1-01 |
| Problem and risk | Workorder and workcenter may be unrelated; company is caller-supplied; `loss_id` defaults to zero and has no authoritative relation |
| Affected paths | `spacetimedb/src/manufacturing/work_centers.rs`; productivity params; row actions; query hooks |
| Required fix | Select a workorder and loss category; derive workcenter/company/user/time; validate duration and workorder lifecycle; add or reuse a typed loss-category table |
| Application pattern | Selected-parent wiring; scoped loader; intent-shaped command |
| Migration/backfill | Audit logs for zero/missing loss, mismatched workorder/workcenter/company, invalid duration, and duplicate completion |
| Acceptance criteria | Productivity can only target the selected workorder's valid workcenter and a real loss category |
| Persisted proof | Query productivity log, workorder, workcenter totals, company, user, start/end, and loss label |
| Dependencies | MFG-007; loss-category design |
| Rollout restriction | Productivity actions disabled until verified |
| Status | Not started |

### MFG-010 — Separate user intent from workcenter projections

| Field | Value |
|---|---|
| Priority | P1 |
| Audit findings | MFG-P1-01 |
| Problem and risk | Create accepts caller-owned OEE, performance, times, counters, reverse arrays, tags, capacity relations, and defaults |
| Affected paths | `spacetimedb/src/manufacturing/work_centers.rs`; generated create params; shared mapper; form |
| Required fix | Reduce create intent to name/code/capacity/schedule policy and supported selected relations; derive counters/OEE/times/reverse arrays server-side; validate remaining relation collections |
| Application pattern | Intent-shaped command; explicit collection semantics |
| Migration/backfill | Recompute workcenter projections from authoritative workorders/productivity rows |
| Acceptance criteria | API callers cannot seed computed metrics or foreign reverse IDs |
| Persisted proof | Submit attempted projection overrides and prove server-derived stored values |
| Dependencies | MFG-009 |
| Rollout restriction | Workcenter create limited to fixtures until verified |
| Status | Not started |

### MFG-011 — Add explicit scalar clear and collection update semantics

| Field | Value |
|---|---|
| Priority | P1 |
| Audit findings | MFG-P1-03 |
| Problem and risk | `.or(existing)` makes absent and clear indistinguishable; optional arrays have undocumented replace/clear behavior |
| Affected paths | BOM/workcenter update params and reducers; generated bindings; row actions |
| Required fix | Add explicit unchanged/clear/replace scalar patches and named collection operations; validate all replacement IDs first |
| Application pattern | Explicit patch; explicit association update |
| Migration/backfill | None unless invalid existing associations are discovered |
| Acceptance criteria | Tests prove omission preserves, null clears where allowed, value replaces, `[]` clears only documented collections, and invalid replacement changes nothing |
| Persisted proof | Query before and after every patch state |
| Dependencies | Relevant scoped loaders |
| Rollout restriction | Clear UI hidden until verified |
| Status | Not started |

### MFG-012 — Rebuild manufacturing CSV imports on validated services

| Field | Value |
|---|---|
| Priority | P0 |
| Audit findings | MFG-P0-01 |
| Problem and risk | Imports directly insert unvalidated IDs and silently substitute zero, current timestamp, quantities, enums, product/template IDs, and empty projections |
| Affected paths | `spacetimedb/src/data_ops/manufacturing_imports.rs`; import UI/hooks; import tracker |
| Required fix | Preflight company and every relation; use stable external keys or validated IDs; call shared domain services; reject malformed dates/quantities/enums; define batch atomicity and retry key |
| Application pattern | Scoped loaders; atomic idempotent import; intent-shaped import DTO |
| Migration/backfill | Full import-created data audit; repair or quarantine invalid records and rebuild parent projections |
| Acceptance criteria | Invalid rows never promote; retry never duplicates; documented row/file atomicity is proven |
| Persisted proof | Import distinctive valid rows plus missing/cross-scope/inactive/malformed rows and query job, errors, and domain tables |
| Dependencies | MFG-001 through MFG-010 as applicable |
| Rollout restriction | Import feature remains disabled outside development until verified |
| Status | Not started |

### MFG-013 — Implement BOM component editing and typed selectors

| Field | Value |
|---|---|
| Priority | P1 |
| Audit findings | MFG-P1-02, MFG-P3-01 |
| Problem and risk | BOM UI always sends `lines: []`; routing, workorder, loss, and log fields use raw numeric IDs |
| Affected paths | Manufacturing forms, row-action forms/dialog/submit, lookup helpers, shared mapper |
| Required fix | Add scoped product/UOM/child-BOM/operation selectors and repeatable line editor; derive known parent IDs from row/dialog context; remove raw-ID fields |
| Application pattern | Selected-parent wiring; scoped real-record selectors |
| Migration/backfill | Not applicable |
| Acceptance criteria | User selections map exactly once to typed params and no available UI path invents or manually types a relation ID |
| Persisted proof | Create/edit in browser, reload, and verify exact labels and IDs |
| Dependencies | Final backend contracts; relation-aware reads |
| Rollout restriction | UI hidden behind backend readiness |
| Status | Not started |

### MFG-014 — Make reads and invalidation relation-aware and company-cohesive

| Field | Value |
|---|---|
| Priority | P2 |
| Audit findings | MFG-P2-01 |
| Problem and risk | Queries are organization-scoped without explicit active-company policy; tables/dashboard render raw or fabricated relation labels; invalidation omits some child/totals queries |
| Affected paths | API query registry/execution; manufacturing query hooks; subscriptions; entity configs; dashboard |
| Required fix | Define company policy per table; return stable related IDs and labels; add navigation/filters; refresh parents, children, stock, productivity, totals, and explosion data after mutation |
| Application pattern | Relation-aware query |
| Migration/backfill | Not applicable |
| Acceptance criteria | Company-scoped user cannot read unauthorized rows; fresh reload shows real related labels and current derived values |
| Persisted proof | Query as authorized/unauthorized company contexts and capture fresh UI state |
| Dependencies | P0 relation repairs |
| Rollout restriction | No unrestricted multi-company pilot until verified |
| Status | Not started |

### MFG-015 — Replace compile-only coverage with semantic proof

| Field | Value |
|---|---|
| Priority | P1 |
| Audit findings | MFG-P3-01 and all unverified P0/P1 findings |
| Problem and risk | Current tests prove one positive workcenter create, list visibility, and reducer-key compilation; they do not prove relationships or rejection |
| Affected paths | `spacetimedb/tests/`; manufacturing contract tests; shared mapper tests; Playwright manufacturing suites |
| Required fix | Add persisted backend positive/negative tests, mapper semantics tests, generated contract assertions, and fresh-reload E2E coverage |
| Application pattern | Proof package for each fix |
| Migration/backfill | Test fixtures only |
| Acceptance criteria | Every tracker item cites a passing distinctive persisted test and applicable negative/retry test |
| Persisted proof | Test output plus exact database queries/results attached to tracker items |
| Dependencies | All implementation items |
| Rollout restriction | No production rollout based on compilation or smoke tests alone |
| Status | Not started |

## 8. Existing-data audit and migration plan

Before enabling strict contracts, run a read-only audit that reports:

1. BOM headers whose product, UOM, company, warehouse, location, picking type,
   or routing relation is missing or incompatible.
2. BOM lines whose parent, component, child BOM, operation, UOM, company, or
   collection relation is invalid.
3. BOM cycles and stale explosion rows.
4. Divergence between `bom_line_ids` and rows selected by `bom_id`.
5. Manufacturing orders whose product/BOM/UOM/warehouse/location/picking type,
   routing, company, tracking, or derived state is inconsistent.
6. Workorders whose MO/workcenter/operation/blocker graph is inconsistent.
7. Divergence between `workorder_ids` and rows selected by `production_id`.
8. Productivity rows with zero/missing loss, invalid workorder/workcenter links,
   company mismatch, invalid duration, or incomplete duplicate state.
9. Divergence between `productivity_ids` and authoritative productivity rows.
10. Manufacturing stock moves/quants that cannot be reconciled to an MO.
11. Audit records attributed to a company different from their manufacturing
    record.

Classify every bad row:

```text
repair deterministically
quarantine for manual review
archive
delete only under approved migration policy
block rollout until resolved
```

The migration report must include counts before and after, exact repair rules,
unresolved row IDs, rollback procedure, and post-migration invariant queries.

## 9. Required persisted-data test matrix

Use distinctive values rather than defaults:

```text
Organization A
  Company A1
  Company A2
Organization B
  Company B1

Products:
  A1-FINISHED-7421
  A1-COMPONENT-3187
  A2-COMPONENT-9913
  B1-COMPONENT-5549

BOM:
  quantity 7.421
  component quantity 3.187

Workcenter:
  WC-A1-LASER-8842
  capacity 4.625

MO:
  quantity 12.375
  explicit planned start/finish

Productivity:
  duration 9.875
  selected non-default loss category
```

For every corrected mutation, verify:

- Exact foreign keys and values in the persisted row.
- Every related row belongs to the required organization/company.
- A fresh relation-aware read returns useful labels.
- A fresh browser reload displays those labels.
- Missing IDs are rejected.
- Cross-organization and cross-company IDs are rejected.
- Unauthorized caller context is rejected.
- Inactive, archived, deleted, incompatible, circular, and malformed relations
  are rejected where applicable.
- Omission preserves existing values.
- Explicit clear works where allowed.
- Collection replace/add/remove/clear behavior is unambiguous.
- Retrying does not duplicate any logical effect.
- Injected multi-record failure rolls back all changes.
- No field silently becomes zero, empty, null, current time, or an arbitrary
  enum.

## 10. Verification commands

Use the repository-supported commands current at implementation time. At
minimum:

```bash
cd spacetimedb
cargo fmt --check
cargo check

cd ../frontend
pnpm typecheck
pnpm --filter @lumiere/erp-shared test
pnpm --filter my-project test:e2e --grep @manufacturing
```

Also run the SpacetimeDB in-runtime manufacturing proof reducers against a
fresh database and query the resulting persisted rows. Compilation alone is not
an acceptable substitute.

## 11. Release gates

| Gate | Requirement | Initial result | Required evidence |
|---|---|---|---|
| Schema | Important relations and delete behavior are represented consistently | Fail | Table/association contracts and migration report |
| Provenance | Every mutation field has a justified business source | Fail | Final command matrices and mapper tests |
| Scope | Backend enforces organization/company/permission/lifecycle compatibility | Fail | A/B organization and A1/A2 company rejection tests |
| Semantics | Create, unchanged, clear, replace, and collections are explicit | Fail | Persisted patch and association tests |
| Read path | Relations resolve as stable IDs plus labels under correct company scope | Fail | API queries and fresh UI reload proof |
| Atomicity | Multi-row writes roll back together | Unverified | Injected-failure persisted tests |
| Idempotency | Retry cannot duplicate manufacturing or stock effects | Unverified | Repeated-command persisted tests |
| Migration | Existing invalid data is repaired or quarantined | Unverified | Before/after audit and rollback report |
| Tests | Positive, negative, lifecycle, delete, retry, and reload tests pass | Fail | Test suite output and attached queries |
| Contracts | Generated/backend/frontend contracts match | Partially pass | Clean codegen diff, Rust check, frontend typecheck |

Any applicable failed or unverified P0 gate blocks production. Material P1
failures block unrestricted pilot use.

## 12. Final rollout checklist

- [ ] All MFG-P0 findings are **Verified**.
- [ ] All MFG-P1 findings are **Verified** or have an enforceable restriction
      approved by the release owner.
- [ ] Existing-data audit and repair completed.
- [ ] Import feature re-enabled only after MFG-012 verification.
- [ ] Manufacturing stock effects reconciled with inventory.
- [ ] Generated bindings regenerated and reviewed.
- [ ] Rust format/check and frontend typecheck pass.
- [ ] Persisted backend positive/negative/retry/rollback tests pass.
- [ ] Manufacturing browser tests pass against a fresh database.
- [ ] Active-company read/write policy is documented and verified.
- [ ] Rollback procedure tested.
- [ ] Release owner signs off on every release gate.

Until this checklist and every applicable release gate pass, the manufacturing
module remains unsafe for real ERP data.
