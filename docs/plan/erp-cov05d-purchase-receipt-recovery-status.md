# COV-05d Purchase receipt certainty and response-loss recovery

**Package:** `COV-05d`

**Disposition:** `REVIEW` — implemented and local operator proof passed; full COV-05 remains open

**Base:** `98b51190ccfa2c7a7238f9e80c4049550defcbbe` plus the recorded working-tree changes

**Operator proof:** [receipt recovery spec](../../frontend/web/tests/e2e/cov05d-purchase-receipt-recovery.spec.ts)

## Before / after path

Before: an absent stock target could be reported applied without quantity proof;
ambiguous dispatch refreshed caches but skipped the exact observer; gateway
statuses could expose an unsafe retry.

After:

```text
Purchasing receive row action / quantity form
→ usePurchasingWorkflow.receiveLine
→ shared runner acquires the per-line single-flight
→ fresh scoped line/product/move snapshot
→ generated erp.receive_po_line once
→ api-server trusted context/current scope and authorization
→ STDB receive_po_line / stock validation
→ exact canonical same-line quantity delta
→ captured stock move/picking completion, or canonical service classification
→ typed result / canonical receipt navigation
```

Concrete owners:

- UI: `purchasing-client.tsx`, `handleFormSubmit("receivePurchaseOrderLine")`.
- Hook: `purchasing-workflow.ts`, receive transition and action.
- Evidence: `purchasing-receipt-effect.ts`, `captureReceiptSnapshot` and
  `observeReceiptQuantity`; existing `resolveOpenReceiptTarget` and
  `observeReceivedLine` in `erp-workflows`.
- Transport/server/domain: existing named command, `post_operation_inner`,
  trusted operation context, and `receive_po_line` reducer. None was replaced.
- Completion/error/result: existing `completeTransition`, `WorkflowError`,
  `WorkflowResult`, single-flight, and canonical record refs.

## Five points delivered

1. Zero target is unresolved, one retains its identity, multiple/malformed
   matching targets throw an existing typed conflict. Done proof requires a
   strict boolean and consistent state.
2. Fresh canonical PO-line quantity is required before and after dispatch.
   Same order/product/org/company and the requested positive delta must match.
   Stock additionally requires its captured move/picking; no-target service
   requires canonical product classification and receives a same-line ref.
3. Lost responses and all 500–599 responses reconcile without redispatch.
   Definite rejection never becomes success. Missing/failed readback stays
   `outcome_unknown` without retry; cache failure cannot erase confirmed evidence.
4. Playwright submits the real operator form, lets upstream commit, verifies
   canonical commit, then drops the response. It proves one dispatch, exact
   receipt navigation, received/move/stock quantities, and persistence on reload.
5. Fresh dedicated local setup/browser gates passed for COV-05a/b/c/d. See
   [runtime evidence](erp-cov05d-runtime-evidence.md) for actual commands, results,
   source hashes, earlier failures, and scoped service/storage cleanup.

## Effect identity, outcomes, and limits

Stock: exact scoped PO-line ID plus captured move ID/picking ID and requested
quantity delta. Multiple effects are an invariant conflict, never sorted.
Result ref is `stock_picking` in Inventory with Purchasing context.

Service: exact scoped same PO line/product and requested quantity delta; result
ref is `purchase_order_line`, with no automatic navigation.

`applied` means the intended canonical effect was confirmed, not that this
invocation uniquely created it. `dispatch: acknowledged | ambiguous` records the
independent transport observation. No invocation-level idempotency key or new
outcome authority was invented.

Service readback is unit/application-tested, not newly browser-certified here.
Per-hook single-flight does not serialize other actors/tabs: service quantity
readback cannot attribute concurrent external increments to an invocation.
Partial/backorder retry identity, lot/serial journeys, approval delegation,
three-way-match recovery, and payment remain separate Purchasing/Accounting work.
Existing shared `noReadback` consumers are outside this bounded receipt path.
No U4/U5 or remote-CI claim is made.

**Contract release required:** no. No schema/signature/generated contract edit.

**Next bounded task:** partial receipt/backorder billing with exact continuation
identity, or three-way-match rejection/recovery coordinated with COV-08.
