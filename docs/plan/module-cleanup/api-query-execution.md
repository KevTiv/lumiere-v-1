# API query execution maintainability ledger

## Scope and current status

- Status: **partial** for overall service acceptance; remaining query-helper extraction implemented.
- Inspected 2026-10-28 on `work`, base `eeb44cf50474697da2a19f28841a74e13df6cf2c`, initially clean checkout.
- Canonical destination map: [API modularization plan](../api-server-modularization-coordination-plan.md), M20/M21 and M90; D40/D60/D90 remain coordinated with it.

## Responsibility changes

All paths are under `api-server/src/query_exec/`.

| Responsibility | Owner |
| --- | --- |
| Literal dispatch, query order, handled-empty decisions, public entry points | `mod.rs` |
| Child-resource read permission boundary | Existing `access_control.rs` |
| Document/folder/version SQL and owner/actor ACLs | Existing `documents.rs` |
| Company row filtering and domain ordering | Existing `accounting.rs`, `inventory.rs`, `crm.rs`, `purchasing.rs`, `registered.rs` |
| Shared exact company-row matching | Existing `row_values.rs` |
| Original root tests/helpers | `tests.rs`, still `query_exec::tests` |

The root falls from 1,488 lines to 535; most removed lines were its original colocated tests. Production helper responsibilities also move to their existing domain owners. This is not a runtime performance claim.

## Verification and acceptance limits

Independent token/AST review confirmed all 37 original root test/helper bodies and the literal resource match were retained. Public entry points, permission enforcement and shared row matching preserve their bodies. Document reads retain exact SQL projection, organization/actor scope and early return on empty results. Added regressions cover malformed/shared/company rows and real-client loopback document dispatch, including empty-result handling.

Commands and results are in [the combined verification record](../god-file-cleanup-2026-10-28.md). Ordinary unit tests do not imply live PostgreSQL/STDB/reconstruction execution. The original September no-runtime-evidence statements describe their checkpoint; later recovery evidence is linked in the combined record.

## Next session handoff

Preserve `read_resource_query_for_company` and its literal match in `mod.rs`: codegen audits parse that file. Keep one transaction/fence owner and the existing current-session authorization path. Wider session-extractor adoption and realtime cancellation remain separate behavior-sensitive work. Complete service-backed combined-tree acceptance before promoting M90/D90; do not infer it from formatting or compilation.
