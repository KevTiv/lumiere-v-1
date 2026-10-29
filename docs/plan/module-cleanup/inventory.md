# Inventory maintainability ledger

Execution guide: [module-by-module plan](../module-by-module-maintainability-plan.md).

## Scope and current status

- Status: **partial**. This pass separates tab action responsibilities; it does not accept the entire Inventory module.
- Inspected: 2026-10-28, branch `work`, base `eeb44cf50474697da2a19f28841a74e13df6cf2c`; initial working tree was clean.
- Canonical tasks: D41 feature segmentation and D90 combined verification. Existing query hooks, effect-verified workflows, form adapters and business transactions remain canonical.
- No schema, generated contract, release, database or production configuration changes.

## Ownership map

Paths below are under `frontend/web/app/(modules)/inventory/`.

| Responsibility | Owner |
| --- | --- |
| Collection availability, selection, module composition, shared dialogs | `inventory-client.tsx` |
| Stock move commands | `stock-move-tab-actions.ts` |
| Physical inventory/count actions | `inventory-count-tab-actions.ts` |
| Lots and serial reservations/use | `production-lot-tab-actions.ts`, `production-serial-tab-actions.ts` |
| Quality check, point, team and reason actions | `quality-check-tab-actions.ts` |
| Replenishment execution/scheduling | `replenishment-tab-actions.ts` |
| Picking-wave and package actions | `picking-wave-tab-actions.ts`, `stock-package-tab-actions.ts` |
| Routes/rules, barcode rules, warehouse tasks | `stock-routing-tab-actions.ts`, `barcode-tab-actions.ts`, `warehouse-task-tab-actions.ts` |
| Existing state interpretation and shared tab/ID types | `inventory-tab-actions.ts` |
| Query scope, invalidation, command outcomes, current authority | Existing Inventory query hooks/workflows, API and STDB owners |

Feature hooks own their mutations and tab-local action decisions. They mount unconditionally under the original loaded component; the parent retains shared dialog/selection lifetime and read-availability gates. No generic feature registry or replacement controller hook was added.

## Stage evidence

| Stage | State | Evidence / remaining work |
| --- | --- | --- |
| M0 ownership map | accepted for this slice | Eleven feature owners above; no competing query or business owners. |
| M1 typed contracts | partial | Extracted actions use existing generated inputs and entity action boundaries; legacy root type debt remains. |
| M2 shared decisions | partial | Existing adapters/workflow gates reused; no new normalization framework. |
| M3 UI decomposition | partial | Feature-specific action/mutation blocks extracted; product, warehouse, record-form and collection orchestration still need separate review. |
| M4 backend orchestration | not applicable to this slice | No Inventory reducer/API business behavior changed. |
| M5 human composition proof | partial | Focused mounted action tests cover selected production owners; full-controller browser and persisted effect acceptance remain separate. |
| M6 module closeout | partial | Bounded action cleanup recorded; whole module is not accepted. |

## Validation and retained behavior

See [the combined verification record](../god-file-cleanup-2026-10-28.md). Independent AST/source review preserved all 87 original action definitions, 184 named hook bindings and the 106-entry original form-pending aggregation after expanding the new feature aggregates. The selected-company argument for quality-check start remains nullable and distinct from the fallback company.

Using the same source-line measurement, the controller falls from 6,100 to 4,404
lines. Its tracked opaque-record occurrences fall from 83 to 72; extracted
owners have none. Shared form adapters receive shallow copies where their
mutable array contract requires one, retaining canonical readonly picker inputs.

Pre-existing omissions of serial reservation and stock-package mutations from the global form-pending list are retained. Changing that behavior requires its own focused review.

## Next session handoff

Extract product/warehouse record editing and their form state as one bounded feature at a time. Preserve current query activation, selection, shared modal reset behavior and exact workflow result links. Run a real composed-controller workflow against a disposable backend before accepting M3/M5 for the module.

Session history: 2026-10-28 — eleven feature action owners extracted; no intended behavior change, no mutation/transaction owner replacement.
