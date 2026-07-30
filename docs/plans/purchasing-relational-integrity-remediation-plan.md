# Purchasing Relational Integrity Remediation Plan

## Plan Header

```text
Module: Purchasing
Audit report: 2026-07-26 purchasing relational-integrity audit
Owner: Unassigned
Target release: Before the next Purchasing pilot
Current readiness: Unsafe for real ERP data
Allowed pilot restrictions: No real ERP data until all P0 items are Verified
```

This plan covers the Purchasing tables, reducers, generated contracts, query
resources, frontend mappings, mutation hooks, forms, and tests. It does not
expand the module into unrelated accounting, inventory, CRM, or workflow work;
adjacent files are in scope only where Purchasing calls them or persists their
foreign keys.

Only `Verified` counts as done. Compilation, generated bindings, successful
mutation responses, UI toasts, and mock calls do not close an item without the
persisted-data and negative proof specified below.

## Remediation Tracker

| ID | Priority | Problem and risk | Affected paths | Required fix | Application pattern | Migration/backfill | Acceptance criteria | Done evidence | Status |
|---|---|---|---|---|---|---|---|---|---|
| PUR-RI-001 | P0 | Landed-cost add, compute, post, cancel, and line removal can mutate another organization's record by global ID | `spacetimedb/src/purchasing/landed_costs.rs` | Add one operation-specific loader that checks the stored organization and company before every mutation; derive child scope from the loaded parent | Scoped relation loader; selected-parent wiring | Audit existing landed costs and lines for parent/tenant mismatches; quarantine mismatches before enabling writes | Every lifecycle action rejects an Organization B request targeting Organization A; child rows always inherit parent organization/company | Positive and negative reducer tests plus persisted parent/child queries | Not started |
| PUR-RI-002 | P0 | Landed-cost create/update accepts unvalidated company, picking, currency, journal, account move, vendor bill, valuation-line, and activity/message IDs | `spacetimedb/src/purchasing/landed_costs.rs`; `frontend/web/lib/purchasing-create-params.ts`; landed-cost forms | Derive company from active context; load every selected picking and accounting relation; require same organization/company, compatible direction/state/currency, and allowed lifecycle | System-owned tenant context; scoped relation loader; intent-shaped command | Scan existing arrays and optional IDs; backfill only unambiguous valid relations, otherwise quarantine or clear with an audit record | Invalid, deleted, cross-company, outbound, or incompatible pickings and accounting IDs fail the entire command before insert/update | Distinctive create/update values, persisted row query, relation-scope query, fresh UI read, negative matrix | Not started |
| PUR-RI-003 | P0 | `apply_landed_costs` is retry-unsafe and can add the same cost to quant values repeatedly | `spacetimedb/src/purchasing/landed_costs.rs`; generated bindings; landed-cost UI/hooks | Add an explicit `Applied` state or durable application record/idempotency key; atomically allocate quants, record allocations, and transition state | Atomic idempotent command | Detect posted costs that may already have been applied; reconcile against quant/audit history before marking state | First call applies the exact allocation; identical and concurrent retries do not change quant value; partial failure rolls back every quant/allocation/state change | Before/after quant query, allocation rows, retry test, injected-failure rollback test | Not started |
| PUR-RI-004 | P0 | Supplier-intake review, approve, reject, and hold omit organization ownership checks; approval stores an unvalidated partner | `spacetimedb/src/purchasing/vendor_management.rs`; supplier-intake hooks/UI | Load intake in caller organization; on approval load the vendor and validate organization, vendor role, lifecycle, and permission; reject cross-tenant state changes | Scoped relation loader | Audit approved intake `partner_id` values and quarantine mismatches | Every state transition is tenant-safe; approval cannot reference another organization's, deleted, inactive, or non-vendor contact | State-transition tests across two organizations plus persisted intake/vendor query | Not started |
| PUR-RI-005 | P0 | Supplier intake submission accepts a caller-supplied organization without an authenticated membership/permission gate | `spacetimedb/src/purchasing/vendor_management.rs`; supplier-intake submit hook/API | Define whether intake is authenticated-internal or public. For internal intake, require organization permission. For public intake, accept an opaque invitation/token that resolves the organization server-side | Authenticated identity or validated server-derived context | No row rewrite unless historical submissions have invalid organizations; flag suspicious rows for review | Direct submission into an unrelated organization fails; the approved public/internal entry route still works as designed | Authorization test for member/non-member/token cases and persisted organization proof | Not started |
| PUR-RI-006 | P0 | Requisition submit, approve, close, and cancel can mutate another organization's requisition by global ID | `spacetimedb/src/purchasing/purchase_orders.rs` | Use a shared requisition loader that verifies organization and stored company on every lifecycle action; derive audit company from the validated row | Scoped relation loader; selected-parent wiring | Audit requisition audit logs for organization/company mismatches | Cross-organization and unauthorized-company transitions fail without changing state or audit history | Two-organization lifecycle tests and before/after persisted-state queries | Not started |
| PUR-RI-007 | P0 | Requisition create/add validates product existence incompletely and trusts UoM, vendor, department, analytic, picking type, purchase IDs, and legacy relation arrays | `spacetimedb/src/purchasing/purchase_orders.rs`; requisition mapper/form; generated contracts | Validate product and UoM together in organization/company context; validate vendor and department; remove caller-owned reverse vectors from create intent; derive child and purchase links server-side | Intent-shaped command; scoped relation loader | Check existing requisition lines and reverse arrays for cross-tenant/orphaned IDs; rebuild reverse collections from child rows | Create/add reject missing, cross-tenant, inactive, or incompatible relations; stored child scope equals parent scope | Persisted requisition/line/vendor/UoM query and negative matrix | Not started |
| PUR-RI-008 | P0 | PO create/update trusts currency, payment term, fiscal position, incoterm, assigned user, invoice/picking/message/activity IDs; caller can set `user_id` | `spacetimedb/src/purchasing/purchase_orders.rs`; `frontend/web/lib/purchasing-create-params.ts`; PO forms | Derive owner/actor from authenticated identity or validate an explicit assignee permission; load all business relations; remove lifecycle-owned vectors from create/update commands | System-owned context; scoped relation loader; intent-shaped command | Audit existing POs for invalid company/relation combinations; rebuild lifecycle vectors from authoritative child tables where possible | PO cannot impersonate another identity or attach foreign records; each relation matches organization/company and expected type | Distinctive persisted PO query, assignment authorization tests, cross-company negative tests | Not started |
| PUR-RI-009 | P0 | PO-line tax, analytic, variant, lot, and optional sales/move relations are not consistently validated; some relations exist only as copied vectors | `spacetimedb/src/purchasing/purchase_orders.rs`; PO-line forms/mappers | Validate every supplied relation against parent organization/company, product compatibility, lifecycle, and permission; derive partner/currency/company only from parent; keep authoritative child relations rather than editable reverse arrays | Selected-parent wiring; scoped relation loader | Identify invalid line relations and orphaned reverse IDs; quarantine accounting-impacting rows | Create/update reject invalid relation IDs and cannot move a line to another parent or tenant | Persisted line/parent/relation joins and negative relation tests | Not started |
| PUR-RI-010 | P0 | RFQ create/add/bid accepts a company that may belong to another organization and incompletely validates product, UoM, vendor, currency, and requisition lifecycle | `spacetimedb/src/purchasing/sourcing.rs`; RFQ hooks/UI | Validate company with organization; validate products/UoMs/currency/vendors; restrict requisition-derived RFQs to the documented lifecycle; derive line scope from RFQ parent | System-owned tenant context; scoped relation loader | Audit RFQ headers, lines, bids, and reverse arrays; repair only unambiguous links | Cross-tenant IDs fail; awarded PO preserves the validated RFQ company, vendor, currency, product and UoM | RFQ-to-PO persisted chain query and negative tests for each relation | Not started |
| PUR-RI-011 | P0 | Purchase returns allow cross-tenant vendor/product/UoM relations and do not prove returned product, quantity, UoM, and price match the source PO line | `spacetimedb/src/purchasing/purchase_returns.rs`; return hooks/UI | When sourced from a PO line, derive product/UoM/vendor/company and an allowed return quantity/price from the loaded line; validate unsourced returns through explicit policy and selectors | Typed source reference; selected-parent wiring; scoped relation loader | Audit existing return lines for disagreement with source PO lines | A sourced return cannot substitute product/UoM/vendor/price or exceed eligible received quantity; cross-tenant references fail | Persisted PO-line → return-line → picking proof and negative quantity/substitution tests | Not started |
| PUR-RI-012 | P0 | Vendor-credit creation manually inserts an account move without validating journal company/type or expense/payable account organization, company, state, and role | `spacetimedb/src/purchasing/purchase_returns.rs`; `spacetimedb/src/accounting/journal_entries.rs`; credit hooks/UI | Reuse or introduce an accounting command that validates journal and accounts before any move/line insert; derive company/currency/vendor from the validated return | Scoped relation loader; atomic idempotent command | Audit draft return credits for foreign journals/accounts; block posting until repaired | Cross-company journal/account IDs fail with no move created; valid credit balances and links to the return exactly once | Persisted move/line/account query, balance assertion, retry and rollback tests | Not started |
| PUR-RI-013 | P0 | Partner-bank create trusts partner, bank, currency, company, and journal IDs | `spacetimedb/src/purchasing/vendor_management.rs`; `frontend/web/lib/purchasing-partner-bank-params.ts` | Derive/validate company; require same-organization partner; validate currency, bank, and payment journal compatibility; validate payment authorization before `allow_out_payment` | Scoped relation loader; system-owned context | Audit bank rows for invalid or cross-tenant relations; disable outbound payment on ambiguous rows | Invalid relations fail; outbound-enabled accounts have a valid company/payment-journal chain | Persisted bank relation query and outbound-payment negative tests | Not started |
| PUR-RI-014 | P0 | Advanced procurement reducers trust caller company and most vendor/product/warehouse/PO identities | `spacetimedb/src/purchasing/procurement_advanced.rs`; advanced hooks/Ops UI | Validate company in organization for every command; load and validate vendors, products, warehouses, POs, principals, delegates, and lifecycle/type compatibility | System-owned context; scoped relation loader | Audit advanced tables for company and relation mismatches | No advanced row can be created with company `0`, a foreign company, or an invalid related record | Per-table persisted relation tests across two organizations/companies | Not started |
| PUR-RI-015 | P0 | Purchasing integration intents accept an unchecked PO relation and idempotency uniqueness is organization-wide rather than explicitly scoped to provider/type/company | `spacetimedb/src/purchasing/procurement_advanced.rs`; integration worker/API contracts | Validate PO scope; define an immutable idempotency tuple; restrict result recording to the authorized worker/service identity and explicit state transitions | Typed source reference; atomic idempotent operation | Detect duplicate keys and intents linked to foreign POs; quarantine before unique enforcement | Duplicate logical requests return the original result; foreign PO and illegal result transitions fail | Persisted intent query, concurrency/retry test, worker-authorization tests | Not started |
| PUR-RI-016 | P1 | Update contracts cannot consistently distinguish unchanged, clear, and replace | PO, PO-line, landed-cost, partner-bank, intake and advanced update params; generated TypeScript; mappers/forms | Use explicit patch semantics for nullable scalars and explicit collection operations for arrays | Explicit patch; explicit association update | No data migration unless a new association table is introduced | Omission preserves; explicit clear clears; replacement validates before mutation; invalid values fail | Positive omission/clear/replace persisted tests for every changed contract | Not started |
| PUR-RI-017 | P1 | Purchasing HTTP/WS reads are organization-scoped but do not enforce the session's allowed company set | `frontend/packages/stdb/src/queries/erp-subscriptions.ts`; `api-server/src/query_exec.rs`; session company context | Add allowed-company filters to headers and children, deriving child visibility through stored company or validated parent | Relation-aware query | None; access-policy change requires rollout review | A user authorized only for Company A1 cannot read Company A2 Purchasing rows over HTTP or WebSocket | HTTP and WS tests with two companies and field/role contexts | Not started |
| PUR-RI-018 | P1 | Missing company context falls back to `0n`; RFQ and bid currency use hard-coded `1n`; landed-cost dates silently become current time | `frontend/web/app/(modules)/purchasing/purchasing-client.tsx`; `frontend/web/lib/purchasing-create-params.ts`; Ops SoD | Block actions until real company/configuration is loaded; source currency from selected RFQ/company; require or deliberately server-default business dates | Active company context; related-record lookup; domain default only when documented | None | No business mutation sends company/currency `0/1` as a compiler fallback or invents a date | Mapper tests and captured mutation payloads using distinctive non-default IDs/dates | Not started |
| PUR-RI-019 | P1 | Blanket release creates an empty PO and increments release state without contractual lines/remaining commitment | `spacetimedb/src/purchasing/procurement_advanced.rs`; blanket schema/UI | Add blanket lines and remaining-quantity/value semantics, or disable release until required PO lines are supplied and validated | Parent-child wiring; atomic idempotent command | Add/backfill blanket-line table only where source evidence exists; mark header-only blankets non-releasable | Release creates a usable PO with exact lines and cannot exceed the remaining commitment or duplicate on retry | Persisted blanket → release → PO → line proof and limit/retry tests | Not started |
| PUR-RI-020 | P2 | Reverse ID vectors duplicate authoritative parent-child relations and can drift | PO, requisition, RFQ, return and landed-cost headers/children | Prefer indexed child queries; otherwise centralize atomic maintenance, uniqueness, delete behavior, and consistency checks | Relation-aware query; explicit association update | Rebuild vectors from child tables and report discrepancies before removing fields | Parent details resolve complete children after refresh; no duplicate/orphan IDs remain | Consistency query and migration report | Not started |
| PUR-RI-021 | P2 | Advanced tables have callable mutations but no complete query resources, selectors, labels, navigation, or refresh invalidation | Purchasing workspace/query registry/read models/hooks/UI | Register company-filtered resources; return stable IDs plus useful labels; add scoped selectors and invalidate affected resources | Relation-aware read | None | Created/updated rows appear after refresh with related labels and can be filtered/navigated | HTTP/WS/UI refresh tests | Not started |
| PUR-RI-022 | P3 | Public commands contain compiler-only reverse vectors and broad record-shaped fields; UI uses raw-ID prompts and unsafe enum casts | Purchasing params, generated contracts, mappers, prompt-driven Ops UI | Remove non-intent fields; replace raw prompts with typed scoped selectors; replace casts with validated enum mapping | Intent-shaped command; typed context | Coordinate generated-client rollout; no stored-data migration unless fields are removed | Frontend cannot submit arbitrary raw IDs for supported workflows; generated contracts expose only business intent | Generated diff, mapper tests, UI tests, typecheck | Not started |

## Relationship and Contract Changes

The preferred command boundary is:

```text
authenticated identity
→ active organization and allowed company
→ selected parent or scoped relation ID
→ backend loads and validates related rows
→ one atomic mutation
→ persisted relation-aware read
→ refreshed UI
```

Protected fields such as `organization_id`, `company_id`, actor identity,
parent-derived vendor/currency, audit identities, totals, lifecycle collections,
and accounting configuration must not be editable form values.

For reverse collections, use the indexed child table as the source of truth:

```text
purchase_order_line.order_id       → purchase_order.id
purchase_requisition_line.requisition_id → purchase_requisition.id
purchase_rfq_line.rfq_id           → purchase_rfq.id
purchase_rfq_bid.rfq_id            → purchase_rfq.id
purchase_return_line.purchase_return_id → purchase_return.id
stock_landed_cost_lines.landed_cost_id → stock_landed_cost.id
```

If compatibility requires retaining header vectors temporarily, update them only
inside the same reducer transaction and add a consistency check until removal.

## Implementation Sequence

### Phase 0 — Freeze and characterize

1. Disable or feature-gate landed-cost application and unsafe advanced actions
   for real tenants.
2. Add diagnostic queries/scripts for orphaned, cross-organization,
   cross-company, duplicate, and mismatched relations.
3. Capture representative fixtures with non-default company, currency, journal,
   account, vendor, product, UoM, warehouse, and picking IDs.

Exit gate: the suspected data population is measured and every affected tenant
has a quarantine/backfill decision.

### Phase 1 — Tenant and accounting safety

Implement PUR-RI-001 through PUR-RI-015. Start with the shared loading mechanics,
but retain operation-specific lifecycle, type, accounting-role, and compatibility
checks.

Exit gate: all P0 tests pass against persisted data, retries are safe, and no P0
item remains below `Verified`.

### Phase 2 — Contract and read cohesion

Implement PUR-RI-016 through PUR-RI-019, regenerate Rust/TypeScript bindings,
update mappers/hooks/forms, and apply company-aware read policies.

Exit gate: create/update/clear semantics are explicit and fresh HTTP/WS/UI reads
show the same scoped relationships.

### Phase 3 — Normalize and productize

Implement PUR-RI-020 through PUR-RI-022. Remove duplicate vectors only after
compatibility readers and migrations are proven.

Exit gate: relation-aware UI replaces raw-ID prompts and no compiler-only
business fields remain in production commands.

## Required Persisted-Data Test Plan

### Fixture

Create:

- Organization A with Companies A1 and A2.
- Organization B with Company B1.
- A user authorized for Organization A and Company A1 only.
- Distinct vendors, currencies, UoMs, products, warehouses, pickings, journals,
  expense accounts, payable accounts, payment terms, and departments in each
  company.
- Inactive, archived/deleted, and incompatible examples of each applicable
  relation.

Use deliberately distinctive IDs and values; do not use ID `0`, currency `1`,
the first available option, an empty string, or the current date as test proof.

### Positive flows

1. Requisition with line → submit → approve → RFQ/convert → PO with line.
2. PO → confirm → partial receipt → vendor bill → three-way match.
3. Landed cost → validated pickings/lines → post → apply once.
4. Supplier intake → review → approval linked to a real scoped vendor.
5. Purchase return → outgoing picking → balanced vendor credit.
6. Partner bank linked to a scoped vendor/company/currency/payment journal.
7. Advanced records linked to real company/vendor/product/warehouse/PO rows.
8. Integration intent created and completed exactly once.

For each flow, query the stored parent, children, every related row, audit rows,
and derived inventory/accounting records. Reload the client and verify related
labels, state, totals, and navigation.

### Negative matrix

Every applicable relation must reject:

- Missing ID.
- Organization B ID under Organization A.
- Company A2 ID for a Company A1-only user.
- Unauthorized but otherwise valid ID.
- Inactive, archived, deleted, or incompatible row.
- Wrong vendor/product/UoM/journal/account/warehouse/picking type.
- Parent-child mismatch.
- Quantity beyond ordered/received/returnable limits.
- Duplicate collection member.
- Illegal lifecycle transition.
- Replayed idempotency key or repeated application.

After every rejection, query all involved tables to prove there was no partial
parent, child, allocation, quant, move, move line, audit row, or state change.

### Update semantics

For every patchable scalar and collection:

```text
omitted       → existing value unchanged
explicit clear → value cleared when domain permits
replacement   → all new relations validated, then replaced atomically
invalid value → entire command rejected
```

Test `undefined`, transport `null`, empty string, empty array, and invalid IDs
separately. Do not infer semantics from TypeScript compilation.

### Retry and concurrency

- Call landed-cost apply twice sequentially and concurrently.
- Retry RFQ award, requisition conversion, blanket release, vendor-credit
  creation, and integration-intent creation.
- Inject a failure after the first child/accounting/inventory write.

The expected result is one logical operation, no duplicates, and complete
rollback on failure.

## Release Gates

| Gate | Requirement | Result | Evidence required |
|---|---|---|---|
| Schema | Important relations are represented, indexed, and have explicit delete/archive behavior | Fail | Migration/schema diff, orphan report, consistency query |
| Provenance | Every mutation field has one justified business source and no fallback path | Fail | Command matrix, mapper payload tests, server derivation evidence |
| Scope | Backend enforces organization, company, permission, lifecycle, and compatibility | Fail | Cross-organization/company negative suite |
| Semantics | Create, unchanged, clear, replace, and collection behavior are explicit | Fail | Persisted patch-semantics suite |
| Read path | Relations resolve with labels under company-aware HTTP/WS policies after refresh | Fail | HTTP/WS/UI reload results |
| Atomicity | Multi-record writes roll back and retries do not duplicate | Fail | Failure-injection and concurrency results |
| Tests | Positive and negative persisted-data cases pass | Fail | Deployed test run and stored-row query output |
| Contracts | Generated bindings and frontend mappings match the server command intent | Fail | Regenerated clients, frontend typecheck and mapper tests |

All gates begin as `Fail` because the audit found material P0 defects and no
deployed persisted-data proof was available. A gate may change to `Pass` only
when its evidence is attached to the relevant tracker items.

## Verification Commands and Evidence Package

The final verification package should include:

```text
Backend:
- cargo fmt --check
- cargo clippy for the SpacetimeDB crate
- cargo check for the SpacetimeDB crate
- generated Rust SDK check

Frontend:
- generated TypeScript SDK check
- pnpm typecheck from frontend/
- purchasing mapper/unit tests
- purchasing contract tests
- Purchasing Playwright workflows

Runtime:
- publish the candidate module to an isolated test database
- run all Purchasing domain reducers
- run the new relational-integrity negative suite
- execute persisted parent/relation/accounting/inventory queries
- attach retry and rollback results
```

For each tracker item, attach:

- Exact changed files and lines.
- Schema/contract and migration identifiers.
- Distinctive submitted payload.
- Persisted row and related-row query output.
- Fresh read/UI label evidence.
- Negative-scope and lifecycle results.
- Retry/rollback evidence where applicable.

## Rollout Restrictions

- Do not enable Purchasing for real ERP data while any P0 item is not
  `Verified`.
- Do not backfill ambiguous foreign keys by choosing the first available record,
  ID `0`, a copied label, or metadata.
- Quarantine rows whose intended relation cannot be proven.
- Roll out tenant guards before exposing new read/UI surfaces.
- Regenerate clients and deploy backend/frontend contract changes together.
- Run consistency diagnostics before and after every relation migration.

## Final Readiness Decision

Current decisive evidence includes cross-organization mutation paths,
unvalidated accounting and operational relations, and retry-unsafe landed-cost
valuation. No runtime persisted-data proof closes those gates.

Unsafe for real ERP data
