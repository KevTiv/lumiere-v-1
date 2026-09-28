# COV-07a — exact BOM-backed manufacturing-order confirmation

**Status:** IMPLEMENTED — runtime acceptance pending  
**Branch:** `codex/cov07a-mo-confirmation`  
**Stack base:** `codex/cov06n-replenishment-scheduler`

## Scope

This is the first bounded COV-07 Manufacturing slice.

It certifies one existing operator-reachable transition only:

```text
BOM-backed Draft manufacturing order
→ warehouse operator opens the exact MO
→ Confirm
→ same MO id reads back Confirmed
→ original BOM relation remains unchanged
```

Material reservation/availability, start, component consumption, work orders,
production output, quality, scrap/byproducts, costing, and close are deliberately
outside this slice.

## Implementation

### Exact confirmation effect

`frontend/packages/query-hooks/src/hooks/manufacturing-order-confirmation.ts`
moves the existing Manufacturing UI confirmation action onto the COV canonical
effect protocol:

- pre-read the exact `mrp_production.id + company_id + Confirmed` effect;
- dispatch the generated `confirm_manufacturing_order` operation at most once;
- treat transport acknowledgement as receipt only;
- perform bounded cache-independent readback of the same MO id;
- return `already-applied` when the exact Confirmed effect already exists;
- reconcile ambiguous transport through readback without redispatch;
- surface unresolved readback as a typed unresolved-operation error;
- invalidate only the Manufacturing order/work-order resources touched by the
  transition.

There is no product/newest-row fallback.

`frontend/packages/query-hooks/src/hooks/manufacturing.ts` keeps the existing
public `useConfirmManufacturingOrder` API but delegates to that exact-readback
owner, so the current row-action UI needs no duplicate workflow path.

### Focused unit proof

`manufacturing-order-confirmation.test.ts` proves:

- exact id/company/state resolution;
- BOM identity is carried through the canonical record ref;
- wrong id/company/state does not resolve;
- duplicate canonical rows fail closed instead of selecting one.

### Operator/browser certification

`frontend/web/tests/e2e/cov07-manufacturing-confirm.spec.ts`:

1. creates one setup BOM and resolves it by an exact before/after id-set delta;
2. creates one Draft MO with a unique origin and that exact BOM id;
3. signs in as `fixture.warehouse@example.test`;
4. finds the exact MO through the Manufacturing orders UI;
5. drives the existing **Confirm** row action;
6. requires the same MO id to read back `Confirmed` with the same BOM id;
7. sends a stale direct confirmation and requires rejection with no state/link mutation;
8. signs in as the limited reader and requires the named operation to deny with
   no state/link mutation.

Setup may use generated typed operations; the transition claimed as operator
proof is UI-driven.

## Evidence boundary

This slice proves only Draft → Confirmed and stable BOM linkage. The current
`confirm_manufacturing_order` reducer does not generate component moves or work
orders, so COV-07a does not claim those effects.

Runtime acceptance remains pending until the stacked query-hooks tests,
typecheck, and focused Playwright spec execute against the live stack.

## Next bounded COV-07 slice

**COV-07b — start + exact BOM material-consumption effects**

Use the same confirmed MO and certify:

```text
Confirmed → Progress
→ consume BOM materials
→ exact source-owned move_raw_ids set
→ exact stock-move product/qty/location linkage
→ idempotent repeat does not add moves
→ stale/denied attempts preserve the effect set
```

Do not include production output, quality, costing, or close in COV-07b.
