# COV-05 next-slice contract dependencies

> Integration update (2026-10-12): [Purchasing stack integration](erp-cov05-purchasing-stack-integration.md) supersedes the original build/release blockers below. This document retains evidence from its original base; it does not claim current integrated acceptance.

**Investigated base:** `16f87f9ffc5be5fb18dcde6b184c344a56c52665`

These are producer → release → consumer dependencies, not implemented contracts.
The application repository alone cannot certify the blocked paths by inventing
browser metadata, selecting a newest row, or calling compatibility reducers.
Existing COV-05a/b/c/d runtime evidence remains bounded and does not establish
partial-receipt replay safety or bill-line correction.

## COV-05e: partial receipt invocation identity

Current named `erp.receive_po_line` input is exactly:

```text
organization_id (server-injected), line_id, qty, lot_id
```

See [generated contract](../../crates/stdb-client/src/generated_reducer_contract.rs#L3537)
and [receipt reducer](../../spacetimedb/src/purchasing/purchase_orders.rs#L2282).
There is no immutable operation key or expected move/picking in the request.

For ordered quantity 10, a receipt of 4 creates a residual/backorder move for 6.
Repeating the same request can receive another 4 from that residual move.
The same input is also a legitimate intentional second receipt. It cannot be
made replay-safe by treating `(line, quantity, lot)` as a unique business key.

The existing [COV-05d observer](../../frontend/packages/query-hooks/src/hooks/purchasing-receipt-effect.ts#L54)
reconciles a lost response within its captured invocation. Its exact move/picking
and quantity proof is not durable request idempotency.

### Required producer/release work

1. Extend the generated receipt command with a bounded operation key or
   equivalent immutable invocation identity.
2. Persist a uniquely scoped receipt-operation relation atomically with the
   receipt. It must retain the exact line/input and resulting move/picking,
   including backorder continuation refs where applicable.
3. Same-key/same-input replay resolves the existing result; conflicting reuse
   rejects without stock/quantity changes. Current authorization and scope must
   be checked before protected replay.
4. Expose a released canonical scoped readback by that key. Missing effects after
   ambiguous dispatch remain unknown; multiple effects are invariant failures.
5. Regenerate/release/pin contracts before wiring a consumer that preserves the
   same pending operation key across reconciliation and uses a distinct key for
   an intentional new receipt.

Acceptance must include first partial receipt, exact backorder, subsequent
receipt/bill, same-key replay, conflicting reuse, concurrent attempts,
committed-response-lost, and denied/foreign-scope attempts preserving stock.

### Independent no-release slice: COV-05e1

The later-receipt billing action has a separate derived-state defect. Bill
creation defines `Invoiced` against currently received quantities, while
`update_po_invoice_status` compares aggregate ordered quantities; receipt does
not refresh invoice status at all. A first partial bill can leave the action
hidden after new goods arrive.

Use one received-based, per-line status rule across receipt and bill creation.
`receipt_status` continues to own ordered fulfillment. This correction and a
two-receipt/two-bill operator proof do not need a new command signature and
must not be presented as P2P-06 replay certification.

The bounded browser proof uses released PO-line received/invoiced quantities,
exact receipt/backorder/bill refs, and unchanged prior bill snapshots. Native
tests are authored to verify individual bill-line quantities; execution is
pending. The current `account-move-lines`
default HTTP projection omits product and quantity fields, and the query route
has no explicit field selector. Full quantitative browser line readback remains
a canonical projection-release dependency; do not bypass field policy for tests.

## COV-05f: bill-line correction and exact source provenance

At the investigated base, the three-way validator identified the PO from
`invoice_origin` and picked the first PO line with the bill line's product.
The bounded COV-05f1 source change replaces that fallback with exact canonical
ownership and source memberships; compilation/runtime proof remains pending.

`PurchaseOrderLine.invoice_lines` already exists, but PO-generated bill creation
did not populate it at the investigated base. The COV-05f0 foundation captures the exact row
returned by `insert_draft_account_move_line` and persists its ID on that source
PO line in the same transaction. No new FK/table is required for that write.

The developer approved strict activation and dropping legacy behavior: historical unlinked
PO drafts must fail closed rather than be guessed. No product/price/name backfill
or legacy fallback is authorized. The `invoice_lines` field also is not in the
default PO-line HTTP projection, so operator-visible provenance inspection
requires a canonical projection release.

Strict activation covers both existing posting entry points, exact forward and
reverse PO/bill-line relations, and unchanged economic state on rejection.
Legitimate manual bills with no PO ownership or exact canonical `PO<id>`
assertion remain separate Accounting records, not inferred PO claims.
The producer/release lane is approved, but the actual `lumiere-contracts`
repository still needs to be attached before its files can be edited.

The released `UpdateAccountMoveLineParams` has no quantity or price-unit fields.
The current editor changes name/debit/credit; it is not a vendor invoice-line
correction workflow and does not recompute invoice prices/totals or synchronize
PO billed quantities.

### Required producer/release work for full correction

1. Establish exact source-line provenance and cardinality for PO-generated and
   admitted manually linked vendor bills; do not use free-form origin text as
   the linkage authority.
2. Release a draft-only, current-scope-checked quantity/price correction command.
   Recompute line monetary values, bill totals, and PO invoicing conservation
   atomically through existing Accounting/Purchasing owners.
3. Define stale/concurrent correction behavior and alternate-entry economic
   claim conservation before wiring the UI.
4. Regenerate/release/pin the operation and required readback fields.
5. Prove through actual UI: rejected price/quantity variance → correction of the
   exact line → same bill Posted, repeated same-product lines, alternate-entry
   duplicate claims, and rejected attempts leaving canonical state unchanged.

Direct `invoice_po_line` mutations in legacy test setup do not prove that
operator correction path.

## PO creation: exact result for custom-field attachment

The public `create_purchase_order` discards the exact ID returned by its
internal insert helper. Its generated input has no creation key, and BFF
`operationId`/`correlationId` are transport metadata, not a persisted PO relation.

The [current custom-field path](../../frontend/web/app/(modules)/purchasing/purchasing-client.tsx#L2476)
selects the newest PO for the supplier. Concurrent same-supplier creation can
attach values to the wrong order.

Required producer contract: an atomic, uniquely scoped creation-key → exact PO
relation with conflict-safe replay and canonical readback. Follow existing domain
creation-receipt patterns where appropriate; do not repurpose an unrelated
Accounting receipt or rely on arbitrary PO metadata without uniqueness.

Only after release should the application hook return the exact PO ref and the
UI persist EAV values against it. Acceptance needs same-supplier concurrency,
lost-response reconciliation, conflicting key reuse, and exact custom-field
ownership.

## Release ownership

Only `lumiere-v-1` is attached to this thread. `lumiere-contracts` must be attached
before editing its schemas, generated metadata, or release pins. The developer
has approved that producer/release scope and strict provenance with no legacy
fallback. No package publication or contract release has been performed by this
investigation.
