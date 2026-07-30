# Inventory Relational Integrity Remediation Plan

**Module:** Inventory only  
**Source audit:** Inventory relational-integrity and mutation-provenance review, 2026-07-26  
**Related investigation:** [Inventory & Warehouse Management Investigation](../INVENTORY_WAREHOUSE_MANAGEMENT_INVESTIGATION.md)  
**Related feature tracker:** [Inventory Pilot-Critical Gap Fixes](inventory-pilot-gap-fixes-plan.md)  
**Owner:** Unassigned  
**Target release:** Unassigned  
**Current readiness:** **Unsafe for real ERP data**  
**Target readiness:** Production ready after every P0/P1 item and release gate is verified  
**Allowed pilot restrictions:** Development fixtures only until all P0 items are verified; no production inventory, multi-company operation, external 3PL callbacks, or inventory-close journal posting  
**Non-goal:** Adding unrelated inventory features or redesigning accounting, purchasing, sales, or manufacturing outside the inventory integration points required by this plan

---

## 1. Purpose

This is the executable fix plan for the inventory relational-integrity audit. It
converts the investigation findings into ordered implementation packages with
explicit contracts, migration work, acceptance criteria, and persisted-data
proof.

The plan covers:

- Inventory schema and relation representation
- SpacetimeDB reducers and domain helpers
- Organization and active-company provenance
- Stock quantities, reservations, transfers, pickings, and moves
- Cycle counting and inventory adjustments
- Warehouse, route, rule, location, lot, serial, and package relations
- Inventory close and accounting integration
- Replenishment and external integration idempotency
- Generated client bindings and frontend command mappers
- Read models, related labels, cache invalidation, and refreshed UI
- Existing-data audit, repair, quarantine, and rollout controls

Compilation, generated types, a successful reducer response, a button click, or
a success toast does not close an item. Only the evidence specified in this
document counts as completion.

## 2. Current decisive risks

The following findings block real ERP data:

1. Several BFF commands use the organization's default company instead of the
   selected operating company.
2. Core quant, move, picking, warehouse, route, rule, product, lot, and serial
   mutations persist raw IDs without complete server-side scope validation.
3. Location, route, rule, and supplier-info paths can update related rows from a
   different organization when given a foreign global ID.
4. Quant creation and direct quantity/reservation commands permit invalid
   balances, including negative values and `reserved_quantity > quantity`.
5. Picking lifecycle reducers mutate children selected only by `picking_id`,
   without proving each child belongs to the same organization and company.
6. Cycle-count lookup omits company ownership and can overwrite another
   company's quant.
7. Inventory period locking is not applied to every stock-changing command.
8. Inventory close accepts unvalidated journal and account IDs, hard-codes
   currency ID `1`, and reopens without reversing the posted accounting move.
9. Repeating a successful inbound integration callback posts stock repeatedly.
10. Processing an inventory adjustment changes only its status and does not
    change stock or accounting.
11. Frontend warehouse creation clones identity relations from another
    warehouse, silently substitutes zero IDs, and converts `u64` values to
    JavaScript `number`.

## 3. Global definition of done

A work item may be marked **Verified** only when every applicable condition is
met:

- [ ] Every referenced row is loaded before its ID is persisted or used.
- [ ] Organization, company, permission, lifecycle, type, warehouse, currency,
      accounting, and operation compatibility are checked server-side.
- [ ] Organization and company come from authenticated context or a validated
      parent, never from an editable field or implicit first/default record.
- [ ] Every submitted field has one documented business source.
- [ ] No relation falls back to `0`, `0n`, an empty string, the first record, an
      unsafe numeric cast, a fabricated date, or unverified metadata.
- [ ] Authoritative state, totals, costs, currencies, counters, timestamps,
      audit identities, and display projections are server-derived.
- [ ] Quantity invariants are explicit and finite-number checks are enforced.
- [ ] Create, unchanged, replace, and clear semantics are explicit.
- [ ] Collection operations distinguish unchanged, add, remove, replace, and
      clear, and validate all IDs before modifying any link.
- [ ] Multi-row writes validate first and commit atomically.
- [ ] Retry cannot duplicate stock, reservations, demand documents, packages,
      journal entries, integration effects, or audit events.
- [ ] Delete/archive behavior protects every dependent relation.
- [ ] Read paths enforce the same scope policy as writes.
- [ ] Important relations appear after a fresh query and UI reload as stable IDs
      plus useful labels.
- [ ] Existing invalid data is repaired, quarantined, or explicitly blocked
      before stronger contracts are enabled.
- [ ] Persisted-data tests use distinctive non-default records and values.
- [ ] Negative tests cover missing, cross-organization, cross-company,
      unauthorized, inactive, archived, deleted, incompatible, and malformed
      relations where applicable.
- [ ] Generated bindings, BFF contracts, form mappers, query metadata,
      subscriptions, and invalidation match the final backend behavior.

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

## 4. Closure evidence

Add this block beneath every completed tracker item:

```md
Completion evidence:
- Implementation:
- Schema/contract:
- Migration/backfill:
- Persisted positive test:
- Isolation and negative tests:
- Invariant/lifecycle test:
- Retry/rollback test:
- Fresh read/UI test:
- Generated artifacts and checks:
- Reviewer:
- Completed on:
```

The evidence must identify exact changed files, test names, distinctive submitted
values, and the persisted queries/results that prove the effect.

## 5. Canonical implementation patterns

### 5.1 Relation-specific scoped loaders

Share basic tenant-loading mechanics, but keep operation-specific domain rules
visible.

```text
load by ID
→ reject missing
→ compare organization
→ compare company or documented shared scope
→ check caller permission
→ check active/deleted/archived state
→ check relation type and operation compatibility
→ return the loaded row
```

Required loader families include:

- Product, product variant, category, UOM, currency, and price configuration
- Warehouse, stock location, picking type, route, and stock rule
- Quant, move, picking, lot, serial, package, and owner
- Sale, purchase, manufacturing, partner, and user source records
- Journal, account, fiscal period, and company accounting configuration
- Quality, replenishment, cycle-count, integration, and close parents

Rust implementation rules:

- Return `Result`; never panic for expected user or persisted-data errors.
- Use `?` for propagation and add operation-specific context.
- Borrow rather than clone unless ownership is required.
- Keep error messages lowercase and without trailing punctuation when adding new
  error types/messages.
- Do not hide incompatible domain checks behind one generic “exists” helper.

### 5.2 System-owned organization and company

```text
authenticated session
→ authorized organization
→ selected active company
→ validated command or parent
→ reducer derives protected tenant fields
```

Rules:

- The API must pass the selected operating company explicitly or derive company
  from a validated parent.
- `withCompany=true` must not resolve the first/default company.
- A missing active company must block the command; it must never become `0n`.
- Parent-owned commands should omit company from the child DTO and derive it
  from the parent.
- Read policy must explicitly define organization-shared versus company-private
  inventory resources.

### 5.3 Intent-shaped stock commands

Create DTOs should contain user intent rather than persisted projections.

Examples:

```text
create warehouse:
  name, code, operating policy
  → server creates/derives locations, picking types, routes, and pulls

record count:
  cycle_count_id, product_id, lot_id, counted_quantity
  → server derives company, location, UOM, expected quantity, cost, variance

adjust inventory:
  product/location/lot/package, counted quantity, reason, effective date
  → server derives book quantity, difference, cost, stock move, journal effect
```

Remove caller ownership of:

- Lifecycle state and transition flags
- Reverse relation and child-ID arrays
- Available quantity, difference, value, and count projections
- Display labels, visibility flags, and tracking projections
- Audit identities and timestamps
- Posted/generated/accounting flags
- Company currency and accounting configuration

### 5.4 Central stock invariant service

Every quantity-changing operation must use one invariant boundary:

```text
validate stock is writable for company and effective date
→ validate product/location/lot/package/owner graph
→ validate finite quantity and cost inputs
→ enforce quantity >= 0
→ enforce reserved_quantity >= 0
→ enforce reserved_quantity <= quantity
→ apply movement/reservation atomically
→ recompute available quantity and value
→ write one committed audit result
```

Negative stock must be a documented opt-in company policy if the business needs
it; it must not emerge accidentally from malformed commands.

### 5.5 Parent-derived picking graph

For move creation under a picking:

1. Load and authorize the picking.
2. Derive organization, company, picking type, and default locations.
3. Validate product, UOM, lot, serial, package, owner, and source document.
4. Reject source/destination locations outside the picking's approved route.
5. Insert the move with a validated parent key.

For confirm, assign, validate, cancel, backorder, and done:

1. Load the picking and validate its transition.
2. Load every child under the same organization/company/picking key.
3. Reject any inconsistent child before changing any row.
4. Validate stock, tracking, period, and task preconditions.
5. Apply all effects atomically and idempotently.

### 5.6 Explicit patch semantics

```text
field absent / undefined → unchanged
null                     → explicit clear when allowed
value                    → validate and replace
```

Use `Option<Option<T>>`, a patch enum, or named set/clear reducers when the
transport cannot express all three states.

### 5.7 Explicit collection semantics

For routes, warehouses, product attributes, taxes, package contents, count
lines, and similar collections, expose one clear operation:

```text
unchanged
replace [ids]
add [ids]
remove [ids]
clear
```

Validate and deduplicate all IDs before modifying any association. Where
possible, use association rows with uniqueness on the relation pair instead of
two manually synchronized reverse-ID arrays.

### 5.8 Atomic idempotent command

```text
resolve idempotency scope and key
→ return existing committed result when already applied
→ validate every input and relation
→ write parent and child effects in one reducer transaction
→ recompute projections
→ write one audit result
→ mark operation applied
```

The idempotency scope must include organization, company, provider/action type,
and the business key.

### 5.9 Relation-aware reads

Important inventory reads should provide:

- Stable related ID
- Related display label/code
- Company and warehouse context
- Visible indication for missing, archived, or inaccessible relations
- Server-enforced organization/company visibility
- Refresh of every affected base and derived view after mutation

### 5.10 Safe `u64` transport

Inventory IDs remain `bigint` or decimal strings from database to reducer call.
Do not use `Number(id)` for relation IDs. Parsing must reject malformed or
out-of-range values instead of returning zero.

## 6. Remediation tracker

| ID | Priority | Problem and risk | Required fix | Migration/backfill | Acceptance gate | Status |
|---|---|---|---|---|---|---|
| INV-RI-001 | P0 | BFF uses default company and reads are only organization-scoped | Carry selected company through authenticated context; define and enforce per-resource company visibility | Classify existing shared/company rows | Mutations and reads consistently use the selected company; no implicit fallback | Not started |
| INV-RI-002 | P0 | Core reducers trust raw relation IDs; some parent updates can cross tenants | Add relation-specific scoped loaders to every inventory create/update/delete/lifecycle path | Audit and quarantine dangling or cross-scope IDs | Full relation-negative matrix passes and no foreign parent is mutated | Not started |
| INV-RI-003 | P0 | Quant commands permit invalid balances and bypass some close locks | Centralize finite quantity, reservation, valuation, relation, and period-lock invariants | Recompute/quarantine invalid quants | Invalid balances cannot persist through any command | Not started |
| INV-RI-004 | P0 | Picking lifecycle selects children by parent ID without child scope validation | Validate and derive the complete picking/move/location/tracking graph before mutation | Repair inconsistent move/picking links | Cross-scope child graph is rejected atomically | Not started |
| INV-RI-005 | P0 | Cycle counts omit company in quant lookup and trust line scope/cost | Derive scope from cycle parent; company-qualify quant key; enforce line uniqueness and stock lock | Repair ambiguous sheets/counts | Count posts only the intended company quant with correct valuation | Not started |
| INV-RI-006 | P0 | Inventory close trusts accounts/journal, hard-codes currency, and reopens without reversal | Use validated accounting configuration and accounting posting/reversal service | Audit posted close moves and currency/account validity | Close/reopen produces balanced, scoped, reversible entries | Not started |
| INV-RI-007 | P0 | Repeated integration success duplicates inbound stock | Add scoped idempotency and a terminal applied transition | Detect duplicate receipts and reconcile | Repeated/concurrent callback produces one stock effect | Not started |
| INV-RI-008 | P1 | Adjustment processing changes status without stock/accounting effect | Replace with atomic adjustment-post command or remove misleading action | Classify historical “processed” adjustments | Posted adjustment changes stock and accounting exactly once | Not started |
| INV-RI-009 | P1 | Stock inventory DTOs expose system fields and accept unchecked ID collections | Replace with intent-shaped inventory/session/line commands | Normalize caller-owned projections | Server derives all state, scope, theoretical quantities, and counters | Not started |
| INV-RI-010 | P1 | Warehouse creation clones another warehouse's operational IDs and permits zeros | Implement server-owned warehouse bootstrap and validated configuration | Repair warehouses with shared/zero/orphan configuration | New warehouse owns a coherent scoped operational graph | Not started |
| INV-RI-011 | P1 | Replenishment retry can create duplicate demand | Add open-demand correlation and idempotent execution | Detect duplicate open PO/transfer demand | Repeated execution creates one active demand document | Not started |
| INV-RI-012 | P1 | Lot/serial hard delete and generic trace source can orphan or mislink data | Archive referenced tracking records; add typed trace source validation | Restore/quarantine broken trace links | Referenced lot/serial cannot disappear; source always resolves | Not started |
| INV-RI-013 | P2 | Optional updates cannot distinguish unchanged from clear; collections are ambiguous | Introduce explicit patch and association commands | None unless past accidental clearing is recoverable | Set/clear/unchanged/add/remove/replace tests pass | Not started |
| INV-RI-014 | P2 | Raw reads omit relation labels and company cohesion; valuation surface lacks producer | Add relation-aware read models; implement or remove valuation surface | Backfill projections if retained | Fresh UI resolves scoped labels and consistent totals | Not started |
| INV-RI-015 | P3 | Frontend converts `u64` to `number`, prompts raw IDs, and silently returns zero | Preserve bigint/string; use scoped selectors; reject malformed IDs | None | IDs above `2^53` round-trip exactly and zero fallback is absent | Not started |
| INV-RI-016 | P0 | Existing rows may already violate the new invariants | Build preflight audit, repair, quarantine, and rollout tooling | Required for every affected table | Production enablement reports zero unclassified invalid rows | Not started |
| INV-RI-017 | P0 | Existing tests prove happy paths but not complete persisted integrity | Add persisted positive, isolation, retry, rollback, reload, and contract tests | Seed valid representative fixtures | All release-gate suites pass against a clean runtime database | Not started |

## 7. Detailed work packages

### INV-RI-001 — Correct company provenance and read scope

**Current evidence**

- `api-server/src/http_app.rs:158` resolves `withCompany=true` through
  `default_company_id`.
- `api-server/src/query_exec.rs:153` returns the first company in the
  organization ordering.
- `frontend/packages/stdb/src/commands/inventory-http.ts:158` enables that path
  for warehouses, cycle counts, quality, replenishment, and warehouse tasks.
- `frontend/web/app/(modules)/inventory/inventory-client.tsx:351` falls back to
  `0n` when operating-company context is unavailable.
- `crates/stdb-auth/src/field_policy.rs:389` builds organization-only reads for
  the inventory resources in `crates/stdb-auth/assets/erp-org-sql.json`.

**Required work**

1. Define an inventory visibility matrix:
   - Organization-shared master data, if any
   - Company-private operational data
   - Explicitly shared configuration
2. Carry the authenticated active-company selection through the API session or
   through a validated command argument.
3. Replace default-company injection with selected-company validation.
4. Block company-required UI commands until operating-company context is ready.
5. Remove every `?? 0n` and equivalent company fallback.
6. Apply the visibility matrix to SQL reads, subscriptions, query keys, and
   cache invalidation.
7. For parent commands, derive company from the validated parent rather than
   accepting a redundant company argument.

**Acceptance criteria**

- Selecting A1 then invoking each inventory command stores A1, even if A2 is the
  parent/default company.
- An unauthorized or non-member company is rejected.
- Missing active company blocks the command before submission.
- Company A1 cannot read A2 operational rows unless the visibility matrix marks
  the resource shared.
- Query caches for two companies cannot reuse each other's rows.

### INV-RI-002 — Validate every relation and parent mutation

**Affected paths**

- `spacetimedb/src/inventory/product.rs`
- `spacetimedb/src/inventory/product_category.rs`
- `spacetimedb/src/inventory/warehouse.rs`
- `spacetimedb/src/inventory/stock.rs`
- `spacetimedb/src/inventory/tracking.rs`
- `spacetimedb/src/inventory/quality.rs`
- `spacetimedb/src/inventory/replenishment.rs`
- `spacetimedb/src/inventory/warehouse_operations.rs`
- `spacetimedb/src/inventory/packing.rs`

**Required work**

1. Produce a checked relation matrix for every create/update/delete parameter.
2. Implement operation-specific loaders for every related table.
3. Validate organization before company, then lifecycle/type compatibility.
4. Derive authoritative fields from loaded relations.
5. Validate all IDs in collections before updating any link.
6. Prevent a create/update/delete from mutating a parent or reverse list outside
   the owning tenant.
7. Reject duplicate child/reverse IDs.
8. Introduce dependency checks or archival behavior before master-data delete.

**Initial high-risk paths**

- Location parent and child-list updates
- Route/rule reverse-list updates
- Product category, UOM, currency, taxes, routes, locations, warehouses, and
  accounting fields
- Supplier info product/partner/currency links
- Picking and move product/location/document links
- Lot, serial, package, owner, UOM, and trace links

**Acceptance criteria**

- Missing, cross-org, cross-company, inactive, archived, deleted, and
  incompatible IDs fail before any write.
- Forced invalid child number N leaves all earlier validated children unchanged.
- Parent reverse lists contain unique children and agree with child parent IDs.

### INV-RI-003 — Enforce stock invariants and period locks

**Current evidence**

- `spacetimedb/src/inventory/stock.rs:1711` inserts unchecked quant relations and
  computes availability from unchecked quantities.
- `spacetimedb/src/inventory/stock.rs:1778` can set quantity below reservations.
- `spacetimedb/src/inventory/stock.rs:1829` does not reject negative reservation
  deltas.
- `spacetimedb/src/inventory/stock.rs:1957` moves stock to an unchecked
  destination location.
- `spacetimedb/src/inventory/inventory_close.rs:98` provides a lock helper, but
  not every stock-changing path invokes it.

**Required work**

1. Inventory every reducer/helper that changes quantity, reservation,
   availability, cost, value, ownership, lot/package, or location.
2. Route each through the central stock invariant service.
3. Enforce finite `f64` inputs; reject NaN and infinities.
4. Define the company policy for negative on-hand stock.
5. Enforce reservation invariants for direct and helper paths.
6. Validate source and destination locations and allowed location usage.
7. Include effective/accounting date in period-lock decisions where required.
8. Recompute derived quantity/value projections server-side.
9. Preserve lot/serial/package/owner/cost identity when merging destination
   quants.
10. Add a stable quant identity strategy or duplicate detection for the full
    company/product/location/tracking/ownership key.

**Migration/backfill**

- Report negative quantities and reservations.
- Report `reserved_quantity > quantity`.
- Report incorrect `available_quantity` and `value`.
- Report duplicate logical quant keys.
- Report orphaned product/location/lot/package/owner/currency IDs.
- Repair deterministic projections; quarantine ambiguous ownership or duplicate
  rows for manual reconciliation.

**Acceptance criteria**

- Every stock-changing command is blocked during a closed period.
- Invalid numeric inputs persist nothing.
- Reservation and availability invariants hold after each command and retry.
- A move to a foreign, missing, archived, or incompatible location fails
  atomically.

### INV-RI-004 — Make picking and move graphs scope-safe

**Current evidence**

- `spacetimedb/src/inventory/stock.rs:2144` stores unchecked move relations.
- `spacetimedb/src/inventory/stock.rs:2510` stores unchecked picking relations
  and caller-owned display flags.
- `spacetimedb/src/inventory/stock.rs:2640` and `:2702` mutate child moves
  selected by `picking_id` without verifying each child's tenant scope.

**Required work**

1. Split standalone move creation from picking-child creation if their
   invariants differ.
2. Derive picking company, type, and locations from validated configuration.
3. Validate source documents and their company.
4. Validate product/UOM compatibility and tracking requirements.
5. Before lifecycle mutation, collect and validate the complete child graph.
6. Reject inconsistent organization/company/picking keys before reserving or
   updating anything.
7. Make confirm, assign, validate, cancel, done, and backorder retry-safe.
8. Derive lifecycle UI flags from state instead of accepting them at create.

**Acceptance criteria**

- A move cannot point to a picking, location, product, lot, serial, package, or
  source document in another tenant/company.
- A deliberately corrupted child causes lifecycle mutation to roll back.
- Repeating validation cannot consume/reserve/move stock twice.
- Backorder links remain scoped, acyclic, and unique.

### INV-RI-005 — Correct cycle-count scope and valuation

**Current evidence**

- `spacetimedb/src/inventory/cycle_count.rs:116` omits company from quant lookup.
- `spacetimedb/src/inventory/cycle_count.rs:262` accepts line location, product,
  lot, UOM, and quantity without complete parent-scope validation.
- `spacetimedb/src/inventory/cycle_count.rs:438` can update the wrong-company
  quant and creates new quants with zero cost and no currency.

**Required work**

1. Derive company and count location from the cycle parent.
2. Validate selected product/category scope and lot/UOM compatibility.
3. Enforce nonnegative finite counted quantity.
4. Define a unique sheet key for cycle/product/location/lot/package/owner.
5. Include company in every quant lookup.
6. Load cost method, unit cost, and currency from authoritative product/company
   valuation configuration.
7. Define how posting handles existing reservations and negative variances.
8. Apply period lock before validating/posting stock effects.
9. Add idempotent posting state and a clear audit link to generated stock and
   accounting effects.

**Acceptance criteria**

- Count A1 cannot read or update an equivalent A2 quant.
- Product and location outside the plan are rejected.
- Duplicate count lines follow one explicit replace/recount policy.
- New and updated quants retain correct cost/currency.
- Repeated post creates one committed adjustment effect.

### INV-RI-006 — Repair inventory close accounting

**Current evidence**

- `spacetimedb/src/inventory/inventory_close.rs:205` directly inserts a posted
  `AccountMove`.
- Currency is hard-coded as `1`.
- Journal, inventory account, and valuation account relations are not loaded and
  validated before posting.
- `spacetimedb/src/inventory/inventory_close.rs:554` unlocks a close without
  reversing its accounting move.

**Required work**

1. Define the authoritative inventory-close accounting configuration per
   company.
2. Load and validate journal active state/type/company/currency.
3. Load and validate inventory/valuation account company, currency, active
   state, and role.
4. Resolve company currency from company configuration.
5. Post through the accounting module's standard validated posting service.
6. Enforce fiscal/accounting period rules and immutable posted entries.
7. Define reopen policy:
   - Disallow after journal posting, or
   - Create and link an explicit reversal before unlocking.
8. Add close sequence, idempotency, and unique accounting-effect linkage.
9. Keep valuation snapshot and journal entry in one atomic close command.

**Migration/backfill**

- Inspect every inventory close and linked account move.
- Validate company, journal, accounts, currency, balance, date, and line count.
- Quarantine or reverse invalid close moves through an approved accounting
  process; never silently rewrite posted entries.

**Acceptance criteria**

- Invalid or cross-company accounting configuration persists nothing.
- Posted move uses the company's currency and balances exactly.
- Retry returns the existing move.
- Reopen either fails with an actionable reason or creates one verified
  reversal and then unlocks.

### INV-RI-007 — Make external inventory integration idempotent

**Current evidence**

- `spacetimedb/src/inventory/integration.rs:97` scopes the idempotency lookup only
  by organization.
- `spacetimedb/src/inventory/integration.rs:155` posts stock on every repeated
  successful inbound callback.

**Required work**

1. Define idempotency scope as organization, company, provider, intent type, and
   key.
2. Validate warehouse and picking relations when creating the intent.
3. Validate callback product, location, quantity, and cost against intent
   scope/payload.
4. Introduce an explicit terminal/applied marker and effect linkage.
5. Permit only documented monotonic state transitions.
6. Return the existing committed result for identical retry.
7. Reject conflicting retry payloads for an already applied key.
8. Apply callback state and stock effect atomically.

**Acceptance criteria**

- Repeating and concurrently submitting a success callback changes stock once.
- The same text key may be used safely in a different scoped company/provider.
- Cross-company callback relations fail with no intent or stock mutation.
- A failed callback cannot regress an applied success to pending.

### INV-RI-008 — Implement real inventory adjustments

**Current evidence**

- `spacetimedb/src/inventory/inventory_adjustments.rs:113` lacks company ownership
  on `InventoryAdjustment`.
- `:330` trusts caller-supplied book quantity, unit cost, state, and relations.
- `:615` marks the row processed without changing quant, move, or accounting.
- `frontend/web/lib/inventory-ext-params.ts:247` defaults missing book quantity to
  counted quantity and stores business date only in metadata.

**Required work**

1. Add or derive company ownership.
2. Replace free-form reason code with a scoped reason relation while preserving
   an optional historical description snapshot.
3. Add typed effective/accounting date.
4. Accept counted quantity and reason as user intent.
5. Derive current book quantity and valuation cost at posting time.
6. Validate product, location, lot, package, owner, UOM, and period.
7. Atomically create the stock effect, audit trace, and accounting effect when
   required.
8. Link the adjustment to generated move/journal records.
9. Make posting idempotent and immutable after completion.
10. Remove or rename the UI action until the effect is real.

**Migration/backfill**

- Classify historical processed rows as:
  - Proven stock/accounting effect
  - Status-only legacy record
  - Ambiguous
- Do not infer missing stock changes automatically; reconcile ambiguous rows
  through an explicit operational process.

**Acceptance criteria**

- Book quantity and cost cannot be forged by the client.
- Process/post changes the exact target quant once.
- Stored difference/value match authoritative inputs.
- Fresh reads show reason, company, source quant/move, and accounting linkage.

### INV-RI-009 — Simplify stock inventory contracts

**Current evidence**

- `spacetimedb/src/inventory/inventory_adjustments.rs:168` exposes lifecycle,
  counters, reverse IDs, and display state in create params.
- `frontend/web/app/(modules)/inventory/inventory-client.tsx:2065` submits fixed
  compiler-shaped values.
- The add-line action prompts for raw parent/product/UOM/location IDs and sends
  zero/default projections.

**Required work**

1. Define separate commands for create session, select scope, start, record
   count, validate, and post.
2. Derive state, counters, theoretical quantities, tracking, product type,
   names, flags, and reverse IDs.
3. Launch child-line commands from a selected inventory parent.
4. Replace raw-ID prompts with scoped selectors.
5. Validate and deduplicate scope collections.
6. Remove obsolete fields from generated/frontend contracts.

**Acceptance criteria**

- Create payload contains only name, validated scope, mode, and business date.
- The server owns lifecycle and projections.
- The UI cannot submit a line without a selected parent and scoped relations.
- Refresh shows server-derived counts and relation labels.

### INV-RI-010 — Bootstrap coherent warehouses

**Current evidence**

- `spacetimedb/src/inventory/warehouse.rs:364` accepts operational location,
  picking type, route, pull, and warehouse IDs without validation.
- `frontend/web/lib/warehouse-create-params.ts:5` returns zero on malformed or
  missing IDs.
- The mapper clones operational IDs from another warehouse and converts `u64`
  values to JavaScript `number`.

**Required work**

1. Define the minimal warehouse-create intent.
2. Server-create or derive the warehouse's view, stock, input, output, packing,
   QC, and scrap locations as required by selected operating policy.
3. Create or validate company-scoped picking types and routes.
4. Do not reuse identity relations owned by a template warehouse.
5. If templates remain supported, treat them as policy templates, not sources
   of relation IDs.
6. Apply uniqueness rules to warehouse code within its scope.
7. Commit the complete warehouse graph atomically.

**Migration/backfill**

- Detect zero/orphan IDs.
- Detect operational locations/picking types shared unexpectedly by multiple
  warehouses.
- Detect cross-company configuration and cycles in resupply relations.
- Repair deterministic cases; quarantine ambiguous warehouses.

**Acceptance criteria**

- A new warehouse owns or validly shares every configured relation according to
  documented policy.
- Failure creating any child rolls back the whole graph.
- No identity ID is copied from a template.
- Large IDs round-trip without precision loss.

### INV-RI-011 — Make replenishment demand retry-safe

**Required work**

1. Validate rule product, UOM, source/destination location, warehouse, route,
   vendor, and reorder group.
2. Derive company from validated rule/warehouse configuration.
3. Check schedule and rule state server-side.
4. Introduce a correlation key and link to the generated purchase order or
   internal transfer.
5. Reuse or update the one active demand instead of creating duplicates.
6. Define behavior when stock recovers or demand is cancelled.

**Acceptance criteria**

- Repeated/concurrent execution creates one open demand effect.
- The generated document has matching company, product, UOM, locations, and
  rule correlation.
- Invalid or archived configuration fails without partial demand.

### INV-RI-012 — Protect tracking and traceability

**Current evidence**

- Lot/serial create paths accept several unchecked relations.
- `spacetimedb/src/inventory/tracking.rs:416` and `:765` hard-delete records
  without dependency checks.
- `:811` accepts an arbitrary document type plus unvalidated document ID.

**Required work**

1. Validate product/variant/company/location/package/owner compatibility.
2. Enforce product tracking policy for lots and serials.
3. Reject hard delete while referenced; prefer archived state.
4. Add a typed trace source enum or relation-specific trace commands.
5. Resolve and authorize the source record before inserting trace history.
6. Preserve legitimate immutable source labels only alongside the real source
   relation.
7. Apply explicit patch semantics to nullable dates, notes, and locations.

**Acceptance criteria**

- Referenced lot/serial cannot be deleted.
- Cross-company tracking relations fail.
- Unsupported or missing source records cannot create trace rows.
- Archived relations remain visible as historical references after reload.

### INV-RI-013 — Make update and collection semantics explicit

**Required work**

1. Inventory every optional update field using `.or(existing)` or equivalent.
2. Classify each nullable field as set-only, clearable, or immutable.
3. Introduce explicit patch encoding end to end.
4. Classify every optional vector and relation collection.
5. Add explicit add/remove/replace/clear operations where needed.
6. Validate all replacement IDs before changing stored state.
7. Update generated types and form mappers.

**Acceptance criteria**

- Omitted fields preserve the stored value.
- Explicit clear works only for documented nullable fields.
- Empty arrays cannot erase associations unless the operation is explicitly
  replace/clear.
- Failed validation leaves the complete previous collection unchanged.

### INV-RI-014 — Add relation-aware reads and coherent UI refresh

**Required work**

1. Define list/detail projections for products, quants, pickings, moves,
   adjustments, cycle counts, warehouses, lots, serials, quality, replenishment,
   packages, and closes.
2. Resolve important related codes/labels under the same scope policy.
3. Show missing/archived relations explicitly.
4. Add company, warehouse, product, location, lot/serial, state, and source
   filters where operationally useful.
5. Verify mutation invalidation for base rows, projections, counts, ATP,
   valuation, exceptions, and accounting effects.
6. Decide whether `InventoryValuation` is:
   - An authoritative maintained projection, or
   - Removed from schema/read/UI contracts.

**Acceptance criteria**

- Fresh reload displays selected relation labels and correct derived totals.
- Company switching cannot reuse stale rows.
- Every corrected mutation refreshes all affected operational and accounting
  views.
- No unused valuation resource remains exposed as if authoritative.

### INV-RI-015 — Remove unsafe ID transport and raw-ID UX

**Required work**

1. Replace inventory relation `number` types with `bigint` or decimal strings.
2. Remove `Number(bigint)` and `Number(rawId)` conversions from inventory
   mappers/hooks/UI.
3. Replace raw-ID prompts with scoped record selectors.
4. Make parse failures explicit validation errors.
5. Remove zero and first-record fallbacks.
6. Add serialization tests at `2^53`, `2^53 + 1`, and near `u64::MAX`.

**Acceptance criteria**

- Distinct IDs above `2^53` remain distinct through query, selection, mapper,
  reducer call, persistence, and refresh.
- Malformed or missing IDs prevent submission.
- No user-facing inventory action asks for an opaque raw database ID when a
  scoped selector is possible.

### INV-RI-016 — Audit and repair existing inventory data

**Required reports**

- Orphan relation IDs by table and field
- Cross-organization and cross-company links
- Missing company ownership
- Zero IDs and unsafe sentinel use in business relations
- Duplicate logical quant keys
- Invalid quantity/reservation/value projections
- Picking/move parent mismatches
- Cycle sheets targeting the wrong scope
- Warehouse location/type/route sharing anomalies
- Referenced lots/serials that were deleted
- Duplicate integration/replenishment effects
- Processed adjustments without effects
- Close/accounting currency, account, journal, and reversal anomalies

**Repair policy**

1. Deterministic derived projections may be recomputed.
2. A relation may be backfilled only when one authoritative source proves it.
3. Ambiguous rows must be quarantined for manual reconciliation.
4. Posted accounting entries must be corrected through accounting reversal and
   repost procedures, not silent mutation.
5. Keep an immutable repair report and audit linkage.
6. Run the preflight before deployment and again after migration.

**Acceptance criteria**

- Every invalid row is repaired, quarantined, or covered by an enforceable
  restriction.
- The preflight reports zero unclassified violations.
- Migrated representative rows pass fresh relation-aware reads.

### INV-RI-017 — Build the persisted integrity proof suite

**Current evidence**

- `spacetimedb/tests/inventory/tests/mod.rs` exposes runtime test reducers rather
  than ordinary isolated unit tests.
- Company isolation is tested for direct reserve only.
- Integration tests exercise one success callback but not retry.
- Adjustment tests deliberately use a warehouse ID as a location stub.
- `frontend/packages/stdb/src/contract-tests/inventory.contract.ts` checks
  reducer-name compilation only.

**Required work**

1. Seed valid organizations A/B, companies A1/A2, users, products, UOMs,
   locations, warehouses, journals, accounts, lots, serials, packages, and
   source documents.
2. Use real relation rows in every test fixture.
3. Add a persisted positive and full negative matrix for each corrected command.
4. Add retry and concurrent-retry tests.
5. Add forced mid-command failure and rollback tests.
6. Query persisted rows and related rows after every mutation.
7. Add frontend contract tests for exact field provenance and absence of
   compiler-only fields.
8. Add browser tests for selected-company behavior and related labels after
   reload.
9. Run the runtime inventory suite against a clean published test database.

**Acceptance criteria**

- All required proof suites pass from a clean database.
- Tests fail when tenant checks, stock invariants, idempotency, or period locks
  are deliberately removed.
- Generated bindings and frontend/backend type checks are clean.
- No fixture relies on invalid relation stubs or magic ID `1`.

## 8. Sequencing and dependencies

### Phase 0 — Freeze and preflight

1. Restrict inventory to development fixtures.
2. Disable external inbound stock application and inventory-close journal
   posting outside controlled test environments.
3. Implement the read-only portion of INV-RI-016.
4. Record the visibility policy required by INV-RI-001.
5. Establish representative test fixtures for INV-RI-017.

### Phase 1 — Tenant and relation foundation

1. INV-RI-001 — Active-company provenance and read policy
2. INV-RI-002 — Scoped relation loaders
3. INV-RI-015 — Safe ID transport needed by corrected commands
4. Initial contract generation and compile checks

Phase 1 is a dependency for every later mutation package.

### Phase 2 — Core stock correctness

1. INV-RI-003 — Quant invariants and universal lock
2. INV-RI-004 — Picking/move graph
3. INV-RI-005 — Cycle count
4. INV-RI-012 — Tracking protection

Do not enable real stock operations until Phase 2 is verified.

### Phase 3 — Accounting and retry safety

1. INV-RI-006 — Inventory close accounting
2. INV-RI-007 — Integration idempotency
3. INV-RI-008 — Real adjustments
4. INV-RI-011 — Replenishment idempotency

### Phase 4 — Contract and UI completion

1. INV-RI-009 — Intent-shaped inventory contracts
2. INV-RI-010 — Warehouse bootstrap
3. INV-RI-013 — Patch/collection semantics
4. INV-RI-014 — Relation-aware reads

### Phase 5 — Migration, proof, and staged rollout

1. Apply and verify INV-RI-016 repairs/quarantine.
2. Regenerate bindings and query assets.
3. Complete INV-RI-017 proof suite.
4. Run release gates.
5. Deploy to an empty or synthetic-data environment.
6. Run smoke plus persisted-data verification.
7. Permit a restricted single-company pilot only if all P0 items are Verified.
8. Permit multi-company or external integrations only after their specific P1
   items and release gates are Verified.

## 9. Required persisted-data test matrix

Each corrected mutation must use distinctive non-default values.

### Baseline fixture

```text
Organization A
  Company A1
  Company A2

Organization B
  Company B1

User A
  authorized for Organization A and Company A1 only

For each company:
  product/category/UOM/currency
  warehouse and real stock locations
  picking type, route, and rule
  lot, serial, package, owner
  journal and inventory/valuation accounts
```

### Positive proof

- Submit distinctive IDs, dates, quantities, costs, names, and codes.
- Query the stored row directly.
- Query every related row and verify organization/company/lifecycle.
- Verify derived quantities, values, state, and audit identity.
- Reload through the production read path and verify related labels.

### Negative proof

- Missing relation
- Cross-organization relation
- Cross-company relation
- Unauthorized relation
- Inactive/archived/deleted relation
- Wrong type or incompatible UOM/location/account
- Zero, malformed, and out-of-range ID
- Negative, NaN, infinite, and inconsistent quantity
- Closed inventory/accounting period
- Invalid lifecycle transition

Each case must prove that no parent, child, stock, accounting, reverse-link, or
audit effect persisted.

### Semantic proof

- Omitted update preserves prior value.
- Explicit clear removes a nullable relation.
- Collection add/remove/replace/clear behavior is exact.
- Duplicate submitted IDs do not create duplicate associations.
- Failed collection validation rolls back the full change.

### Retry and rollback proof

- Repeat identical commands.
- Repeat terminal integration callbacks.
- Execute concurrent replenishment/integration/close/post commands.
- Force failure after validation but before final effect.
- Verify one logical stock/accounting effect and no partial writes.

## 10. Generated, backend, and frontend verification

Minimum checks after each contract tranche:

```text
cargo fmt --check
cargo check
cargo clippy --all-targets
spacetime generate / repository codegen command
make check-codegen
pnpm typecheck
targeted package tests
inventory Playwright tests
spacetime call <test-db> run_all_inventory_tests
```

Use repository-supported commands and CI targets where names differ. A check is
supporting evidence only; it does not replace persisted-data proof.

## 11. Release gates

| Gate | Requirement | Current result | Evidence needed to pass |
|---|---|---|---|
| Schema | Important inventory relations and ownership are represented and indexed appropriately | Fail | Final schema plus clean preflight/backfill |
| Provenance | Every mutation field has one justified source and no fallback | Fail | Completed provenance matrix and contract tests |
| Scope | Backend enforces organization/company/permission/lifecycle compatibility | Fail | Full A/B and A1/A2 negative suite |
| Stock invariants | Every quantity path preserves stock and reservation invariants | Fail | Persisted invariant suite across all mutation paths |
| Accounting | Close and adjustment effects use validated company accounting configuration | Fail | Balanced posting/reversal tests and persisted queries |
| Semantics | Create, update, clear, collection, delete/archive, and lifecycle behavior are explicit | Fail | Positive/negative semantic tests |
| Read path | Persisted relations resolve under matching company policy after refresh | Fail | Fresh-query and browser reload proof |
| Atomicity | Multi-record writes roll back and retries are safe | Fail | Failure injection and concurrent retry proof |
| Tests | Representative persisted positive and negative cases pass | Fail | Clean runtime database test report |
| Contracts | Generated and frontend types match the corrected backend contract | Unverified | Clean codegen, typecheck, and contract results |
| Existing data | No unclassified invalid inventory data remains | Unverified | Migration report and post-migration preflight |

Any applicable failed or unverified P0 gate blocks production. Material P1
failures block unrestricted pilot use.

## 12. Rollout restrictions

### Current

- No production or financially material inventory data.
- No multi-company inventory operation.
- No external 3PL callback may apply stock.
- No inventory-close journal posting.
- No reliance on “processed” adjustments as proof of stock change.
- Existing feature-complete checkboxes in the pilot plan do not override these
  integrity restrictions.

### Eligible for restricted single-company pilot

Only after:

- INV-RI-001 through INV-RI-007, INV-RI-016, and INV-RI-017 are Verified.
- Existing data preflight reports zero unclassified violations.
- Stock invariant, period lock, retry, and rollback suites pass.
- The pilot starts on reconciled opening inventory with daily quant-to-ledger
  reconciliation.

Still restricted until related P1 work is Verified:

- External integrations
- Automatic replenishment
- Inventory-close journal posting/reopen
- Status-based adjustment posting
- New warehouse bootstrap
- Destructive lot/serial operations

### Eligible for production

Only after:

- Every P0 and P1 tracker item is Verified.
- All release gates pass.
- Migration and rollback procedures are rehearsed.
- A fresh production-like reload proves relation labels and totals.
- Operational owners sign off on stock, warehouse, and accounting
  reconciliation.

## 13. Final completion rule

Do not upgrade readiness because the code compiles, fields appear in generated
types, a reducer returns success, or the UI shows a toast. Upgrade readiness
only from verified persisted-data evidence, complete tenant/isolation coverage,
safe retries, coherent refreshed reads, and a clean migration report.

Current readiness remains:

**Unsafe for real ERP data**
