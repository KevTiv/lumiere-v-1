# Accounting maintainability ledger

Execution guide: [module-by-module plan](../module-by-module-maintainability-plan.md).

## Scope and current status

- Status: **partial**. This pass extracts tax administration and manual-invoice catalog selection; it does not accept the entire Accounting module.
- Inspected: 2026-10-28, branch `work`, base `eeb44cf50474697da2a19f28841a74e13df6cf2c`; working tree was clean before implementation.
- Canonical tasks: D41 frontend segmentation, D60 ownership checks, D90 integrated verification. Existing generated hooks, form adapters and server authorization retain authority.
- Excluded: schema/contracts/releases, business-rule changes, backend workflow redesign and production operations.

## Ownership map

| Responsibility | Owner |
| --- | --- |
| Module data activation, company selection, shared dialog lifetime | `frontend/web/app/(modules)/accounting/accounting-client.tsx` |
| Deadline rows, commands, actions and record sheet | `features/use-tax-deadline-administration.tsx` |
| Group, jurisdiction and schedule authoring/rows/actions | Corresponding `features/use-tax-*-administration.ts` hooks |
| Manual invoice/bill catalog and eligible posting choices | `features/manual-invoice-catalog.ts` |
| Form-to-wire validation and clear/preserve semantics | Existing `tax-*-actions.ts`, `tax-setup-wire.ts` and shared invoice owners |
| Query scope, invalidation and generated row types | Existing query-hooks Accounting directory and `ResourceQueryRowMap` |
| Consequential mutation authorization and transaction | Existing API/STDB owners; presentation permissions do not grant authority |

Representative workflow: tax action → existing shared form dialog → existing tax adapter → generated company-scoped mutation → normal query invalidation/readback. Cancellation does not dispatch; invalid/unchanged forms retain their existing messages; write errors retain the existing command wrapper.

## Stage evidence

| Stage | State | Evidence / remaining work |
| --- | --- | --- |
| M0 ownership map | accepted for this slice | Owners above; parent query activation and shared dialog remain unchanged. |
| M1 typed contracts | partial | Extracted owners use generated resource rows; no new opaque records or double assertions. Other Accounting type debt remains. |
| M2 shared decisions | partial | Existing tax and invoice adapters reused; duplicate controller bodies removed. |
| M3 UI decomposition | partial | Four tax owners and invoice catalog removed from the controller; other accounting features remain there. |
| M4 backend orchestration | not applicable to this slice | No backend accounting code changed. |
| M5 human composition proof | partial | Mounted production action hooks exercise cancellation/reopen, exact wire data, rejection, company switching and field cardinality; live backend/controller-browser proof remains separate. |
| M6 module closeout | partial | This bounded slice is recorded; broader module cleanup is not complete. |

## Validation

Combined-tree validation and environment limitations are recorded in [the October cleanup verification record](../god-file-cleanup-2026-10-28.md). Independent source review confirmed original tax initializer bodies, mutation scope/arguments and manual-invoice selection behavior were preserved. The Accounting assertion guard now covers both the original controller and its `features/` children.

Measured with the same source-line count before/after: the controller falls from
7,325 to 6,596 lines. Its tracked opaque-record occurrences fall from 148 to
140, with no new occurrences in the extracted files. These are ownership/debt
measurements, not a module completion or runtime speed claim.

## Next session handoff

1. Extract chart-of-accounts authoring or manual invoice dialog orchestration as a cohesive owner, retaining parent dialog/query lifetime and current-company semantics.
2. Exercise the real composed controller with a disposable backend for successful readback and failure/reopen behavior before accepting all of M3/M5.
3. Continue ranked debt inspection feature by feature; the remaining controller size is a review signal, not proof that every remaining block needs extraction.

Session history: 2026-10-28 — four tax administration hooks and typed invoice catalog extracted with no intended behavior change; validation scope is bounded as above.
