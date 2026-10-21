# COV-05e Requisition → PO → receipt → vendor-bill handoff

**Package:** `COV-05e`  
**Disposition:** `IMPLEMENTED` — fresh-stack runtime acceptance pending  
**Branch/head:** `codex/cov-u5-closure-wave2` / current shared Wave-2 head  
**Operator proof:** [`../../frontend/web/tests/e2e/cov05e-requisition-procure-handoff.spec.ts`](../../frontend/web/tests/e2e/cov05e-requisition-procure-handoff.spec.ts)

## Bounded path

```text
requester
→ Purchasing / Requisitions / visible create form
→ exact Draft PurchaseRequisition.id with one owned product line
→ visible Submit action
→ same requisition = InProgress
→ requester approval UI disabled + direct self-approval denied
→ independent purchasing persona / visible Approve action
→ same requisition = Approved
→ visible Convert to PO action
→ exact PurchaseRequisition.purchase_ids relation
→ one canonical Draft PurchaseOrder.id
→ lost-response replay resolves to the same PO
→ visible PO Confirm
→ exact incoming receipt relation
→ visible Receive quantity
→ exact received quantity and completed receipt effect
→ visible Create bill form
→ exact PurchaseOrder.invoice_ids relation
→ one positive-amount Draft InInvoice
→ canonical Accounting record navigation
```

The test uses the admin only as the requester/operator that creates and submits
the requisition. Approval, conversion, confirmation, receipt, and billing are
performed by the distinct seeded Purchasing persona. The limited reader is used
only for denied-operation probes.

## Implementation

- `approve_purchase_requisition` rejects the immutable requisition requester,
  even when that identity otherwise has approval permission. The approval audit
  now records the actual `Approved` state rather than the incorrect `Open`
  label.
- the Purchasing requisition toolbar evaluates the current session identity and
  leaves Approve disabled for the requester; missing requester/session identity
  fails closed.
- `convert_purchase_requisition_to_po` validates the supplied company against
  the requisition's persisted company before creating any effect.
- conversion uses `requisition:<requisitionId>` as its canonical effect key. If
  one PO with that origin is already present in `purchase_ids`, a retry returns
  success without creating another PO. Multiple matches or an origin/relation
  disagreement fail closed.
- post-create discovery requires exactly one scoped PO instead of selecting the
  newest/highest id.
- the browser proof snapshots and reads back the requisition-owned
  `purchase_ids`, PO-owned receipt relation, received line quantity, and
  PO-owned `invoice_ids`; no newest-row or id-delta inference is used.
- replay and denial probes preserve the exact canonical identities: stale
  approval is 422, wrong-company conversion is 403 at the trusted operation
  boundary, reader conversion is 403, conversion replay returns the existing
  PO, bill replay is 422, and reader bill creation is 403.

## D/A/O/E evidence

The entries below describe implemented proof. They do **not** promote the slice
to `ACCEPTED`; the Playwright proof has not yet run on a fresh same-head stack.

| Gate | Evidence | State |
| --- | --- | --- |
| D — domain | `spacetimedb/tests/purchasing/wave_e_test.rs::test_requisition_convert_copies_lines` proves requester self-approval denial, independent approval/audit identity, wrong-company rejection, exact line copying, and same-request conversion replay with exactly one PO. | Implemented; `cargo check --lib` passed. Runtime reducer-suite execution pending. |
| A — authenticated API | Generated session operations retain permission and organization scope. The browser contract requires 422 for requester/stale/wrong-company probes and 403 for the reader's conversion and bill probes, with canonical relations unchanged. | Implemented; browser execution pending. |
| O — operator/UI | `cov05e-requisition-procure-handoff.spec.ts` drives create, submit, approve, convert, confirm, receive, and create-bill through visible Purchasing forms/actions using requester and independent buyer personas. It asserts canonical PO and bill navigation. | Implemented and Playwright-discovered; fresh-stack execution pending. |
| E — exact effect/recovery | Conversion is idempotent against the exact scoped origin plus owning `purchase_ids` relation. Browser readback requires one PO, one copied line, one receipt, received quantity `2`, and one positive Draft vendor bill in `invoice_ids`; replay/denial cannot change those sets. | Implemented; fresh-stack execution pending. |

## Validation run on 2026-10-13

- `node --import tsx --test "app/(modules)/purchasing/purchasing-action-gates.test.ts" lib/purchasing-coverage-create-params.test.ts`
  — **11 passed, 0 failed**.
- `playwright test --list tests/e2e/cov05e-requisition-procure-handoff.spec.ts`
  — the COV-05e test is discovered successfully.
- shared `cargo check --lib`
  — **passed** after correcting the Purchasing test iterator; no Purchasing
  diagnostics remained (unrelated warnings only).
- `git diff --check`
  — **passed**.
- a targeted TypeScript check reached an existing generated-contract failure:
  missing `MrpProductionCost`, `MrpProductivityCost`, `MrpValuationConfig`, and
  `MrpWorkcenterCostRate` exports. No COV-05e diagnostic was emitted before that
  unrelated blocker.

## Runtime acceptance required

Run against a fresh first-org stack on the exact candidate head:

```bash
PG_DATABASE=lumiere_cov05e_e2e make e2e-smoke-setup \
  E2E_STDB_MODULE=lumiere-cov05e-e2e
PG_DATABASE=lumiere_cov05e_e2e make e2e-single \
  E2E_SPEC=cov05e-requisition-procure-handoff.spec.ts \
  E2E_GREP= E2E_WORKERS=1 E2E_STDB_MODULE=lumiere-cov05e-e2e
```

Do not mark COV-05e `ACCEPTED` until this exact run passes and its artifacts are
preserved.

## Evidence limit and exact remaining blockers

This slice materially extends COV-05a/b/c into one operator-driven handoff, but
it is not whole-module U5. The remaining blockers are:

1. execute and preserve the fresh-stack COV-05e browser result on the exact
   candidate head;
2. include requisition → RFQ → multi-vendor bid → award in one continuous
   operator journey; COV-05d proves RFQ award separately only;
3. add the canonical vendor-bill → payment/reconciliation handoff without
   creating a Purchasing-owned accounting path;
4. run a real second-company persona against persisted Company A/Company B
   records; the current proof rejects a mismatched company reference but is not
   a complete cross-company read-isolation run;
5. certify partial receipt/backorder billing and three-way-match
   variance/recovery in the continuous path;
6. complete COV-26 responsive, keyboard/focus, accessibility, denied/error, and
   reconnect checks for the Purchasing surfaces; and
7. pass COV-27 current-head launch certification and first-org launch-manifest
   admission.

