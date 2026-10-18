# COV-07i — operator-created BOM and manufacturing lifecycle

**Status:** Implemented, unverified — integrated browser acceptance pending  
**Branch:** `codex/cov07-operator-lifecycle`  
**Stack base:** PR #175, `9eb67a11` (contracts `v0.3.99`)

## Implemented scope

The existing manufacturing-order form already creates a governed MO. The BOM
form previously offered only the finished-product header, leaving component
authoring to fixture commands. It now exposes an add/remove component editor
with product selection and quantity per BOM. Each component uses the exact
selected product's projected `uomId`; ambiguous or unresolved products fail
submission. No generated contract, backend authority, inventory fixture write,
or alternate operation transport is introduced.

The existing `CreateBomParams` mapper still supplies the fields required by the
current generated contract. Component parsing now rejects malformed JSON,
non-array collections, incomplete entries, missing component UOMs and invalid
quantities as a whole. It no longer silently removes malformed lines or replaces
a missing component UOM with the finished-product UOM. Empty component
collections remain supported for existing header-only workflows.

MO and BOM form submissions also reject ambiguous product identities and mapper
failures explicitly, instead of resolving the first product or closing the form
after an early return.

`frontend/web/tests/e2e/cov07-operator-lifecycle.spec.ts` defines one continuous
visible warehouse-persona flow:

1. Create a BOM with an exact stocked, untracked component and its own UOM.
2. Create a distinctive MO through its form and resolve its company/BOM identity.
3. Confirm, start and consume through row actions; prove the exact raw move and
   source-stock delta, then prove consumption replay preserves those identities.
4. Create and start an MO-owned workorder, then require its quality check.
5. Record production and prove unresolved quality prevents workorder/MO closure.
6. Pass quality and finish the workorder through visible actions; prove reader
   denial and mismatched company scope do not close the MO.
7. Close the MO, resolve the exact finished move/destination quant effect, reject
   stale close replay and read the same canonical identities after reload.

Setup reads existing reference data only. Every positive domain mutation in
this proof is an operator interaction. Direct operation calls are reserved for
negative checks and replay checks. The run attaches its resolved company, BOM,
MO, workorder, quality-check and stock-move identities.

## Verification and remaining acceptance

- Focused mapper tests: **4 passed**, including heterogeneous component UOMs
  and all-or-nothing malformed-entry rejection.
- TypeScript syntax transpilation of the editor, client, mapper and browser
  spec: passed without diagnostics.
- `git diff --check`: passed.
- Browser execution, integrated frontend typechecking and runtime acceptance:
  **pending** at stacked integration. This document does not claim a browser
  pass or promote COV-07 readiness.

The browser lane requires fixture warehouse/reader personas, two active
untracked products, at least one untracked component quant with positive stock,
a picking context, and an in-company workcenter. It fails explicitly when those
references are absent or ambiguous. Broader manufacturing costing, tracked
outputs, routing and query denial-state remediation remain in their separate
workstreams; this slice does not certify those contracts.

The existing MO detail-page action surface from PR #154 is preserved. This
slice uses the established governed form and row-action path and closes the
component-authoring/proof gap identified in
`docs/plans/manufacturing-relational-integrity-remediation-plan.md` (MFG-P1-02).
