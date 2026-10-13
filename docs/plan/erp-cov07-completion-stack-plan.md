# COV-07 completion stack — intended changes and acceptance

Disposition: ACTIVE implementation; Manufacturing remains U2/review.
Integration base: PR #175, `9eb67a11744c159cac5f7cd2b4d363e0d452019a`.
The bounded persisted domain acceptance passed; full operator/runtime acceptance
remains open. See the [executed evidence](../evidence/cov07-completion-runtime-2026-10-11.md).

## Requirements and existing progress

The [module usability ledger](./erp-module-usability-parity-ledger.md) requires
one BOM-to-finished-stock lifecycle with state, cost and quality visibility,
adversarial quantity/state checks and U5 evidence for an exposed T0 module.
The [Manufacturing relational integrity plan](../plans/manufacturing-relational-integrity-remediation-plan.md)
defines relation provenance, company compatibility, authoritative children,
atomicity, replay, migration and fresh-read gates (especially MFG-002,
005–009 and 013–015). Its historical tracker labels are audit inputs, not
evidence that every item is still absent or has now been verified.
The [Manufacturing adversarial matrix](../plans/adversarial-business-invariant-certification.md#14-manufacturing-adversarial-matrix)
also requires explicit BOM/routing revision policy, stock bounds, serial
uniqueness, QC gates, finish/cancel ordering, blocked workcenters, replay,
incomplete-operation rejection and foreign-resource denial.

COV-07a–g already implement confirmation, material consumption, output/close,
workorder productivity, required quality, untracked scrap and BOM byproducts.
The [Docker evidence](../evidence/cov-runtime-docker-acceptance-2026-10-04.md)
records two 46-test browser passes and second-run durable projection convergence.
Its 2026-10-07 follow-up passed two PostgreSQL compatibility tests at contracts
v0.3.86; that fixes released-migration compatibility and adds no browser scope.
The [initial browser handoff](../evidence/cov06n-cov07fg-browser-coverage-review.md)
still identifies exact result-navigation debt and fixture-assisted setup.
These historical passes do not certify this completion stack's immutable head.

## Verified upstream stack

The new work extends the repaired [PR #154](https://github.com/KevTiv/lumiere-v-1/pull/154)
through [PR #175](https://github.com/KevTiv/lumiere-v-1/pull/175) lineage rather
than recreating it. Local ancestry contains the sequential repaired-parent
merges from PR #155 through #175, ending in merge `c886475f`, followed by the
aggregate release and existing Reports acceptance fixes. Current Cargo and
frontend lockfiles pin `lumiere-contracts` v0.3.99 (Rust revision
`8d43e11e6a7683e774c65920b97bdcf450b52fc0`), published/pinned by `3f191c7f`.
The successful release is [run 38155126649](https://github.com/KevTiv/lumiere-v-1/actions/runs/38155126649).

[PR #161](https://github.com/KevTiv/lumiere-v-1/pull/161)'s newer head
`bf610340cf81b6b9d456b31965c487c1e602ee08` is a v0.3.97 pin-only commit,
changing eight contract-pin/lock/compatibility files. That commit itself is not
an ancestor of the selected base; its source parent `b12c5756` is. The base's
aggregate v0.3.99 release supersedes the v0.3.97 pin. Do not downgrade the
aggregate pin to import a superseded release commit. Recheck remote heads and
required checks when publishing the completion PR.

## Intended changes by bounded slice

| Slice | Intended behavior and canonical identities | Required proof and dependency |
| --- | --- | --- |
| COV-07h domain lifecycle | One persisted BOM → MO → exact raw consumption → routed workorders/productivity/QC → partial output → primary/byproduct close. Use distinct stock products and fractional MO/non-unit BOM scaling. Preserve `bom_line_ids`, `byproduct_ids`, `workorder_ids`, `time_ids`, `check_ids`, `move_raw_ids`, `move_finished_ids` and cost-result effect sets. | New `run_manufacturing_bom_to_close_domain_lifecycle_test`, registered in the full Manufacturing suite. Exact scoped quantities/values, completed logs/checks, malformed state/bounds rejection and replay snapshots. Depends on k's material-scaling/cost contracts. [Detailed scenario](./erp-cov07h-domain-lifecycle-status.md). |
| COV-07i operator creation | Scoped selectors and non-empty component editing let the warehouse operator create a BOM and compatible MO using generated `erp.create_bom` / `erp.create_manufacturing_order`. Planned dates, product/UOM, company/warehouse/location and BOM relations have explicit sources. | Unit tests of mapper/wire options and request correlation; actual browser create/read/reload followed by downstream lifecycle. Exact created IDs come from durable request identity/owned relations, never newest row, name, timestamp or fixture ID deltas. Scope/reader/duplicate/conflicting replay must preserve effects. |
| COV-07j result navigation | Keep returned canonical scrap/byproduct refs through row submission, present success only after exact readback, and open the resulting record using existing module/tab/id-filter navigation. Scrap ref is request-bound `stock-moves`; byproduct ref is the exact `mrp-bom-byproducts` definition. | Unit tests for ref propagation/route mapping; browser click and reload of exact resulting record. Existing `MO/{mo}/SCRAP/{request}` and `(org, company, BOM, product)` identities remain authoritative. Unknown/ambiguous outcomes produce no success link. |
| COV-07k costing/valuation | Scale raw requirements by `mo.product_qty / bom.product_qty`; snapshot consumed quant/currency/unit cost, configured workcenter rate at productivity time, actual material/labor totals and output allocations. Preserve standard-cost inventory policy and record its variance. Optional configured journal posting uses canonical Accounting owners. | `mrp_workcenter_cost_rate`, `mrp_productivity_cost`, `mrp_valuation_config`, `mrp_production_cost` and exact move/journal-line references; tests of source-stock bounds, edited rates/prices, cost-share/quantity arithmetic, company/currency/account/period compatibility, atomic failure and replay. New generated resources/operations and durable migration require release/pin before frontend acceptance. |
| COV-07l tracking/scrap | Explicit lot/serial identities support tracked output/byproduct attribution and bounded scrap during production or after close; untracked compatibility stays explicit. Resolve source/destination quant by complete company/product/location/lot/package/owner identity. | Persisted tests and generated-operation/browser evidence for lot/serial compatibility, serial uniqueness, quantity bounds, lot locks, exact traceability, replay/request conflicts and scope denial. Report any unsupported tracking/material-consumption combination as a restriction, not completed coverage. |
| COV-07m routing/workcenters | Enforce operation/workcenter and blocker compatibility, finite positive capacities/cycles, dependency graph integrity and started-execution edit policy. Keep workcenter counts/time/relations derived from authoritative rows. | Persisted positive/negative tests of scoped operations, cross-center injection, duplicate/self/cyclic blockers, blocked/inactive center behavior, started-routing policy and repeated finish. Unit/browser checks cover the visible selectors/actions affected by these rules. Explicitly classify any versioning/race scenario not exercised. |
| COV-07n PostgreSQL IR boundary | Generate durable migrations, archive DDL and projection bootstrap only after canonical IR v2. Business layouts derive from `persistence.postgresql` and `persistence.storage`, validated against canonical tables/types; keep SpacetimeDB the business authority. | IR-only replay, fail-closed malformed-contract tests, exact frozen migration parity and PostgreSQL execution. Existing projection-only protocol templates remain compatibility implementation, not a second business schema. [Boundary status](./erp-cov07n-postgresql-ir-boundary-status.md). |

## Integration and contract gates

Each agent owns an isolated worktree and bounded files. The coordinator reviews
and integrates domain-owner changes before dependent frontend calls; overlapping
Manufacturing reducer/module registration changes are serialized. Existing
generated-command dispatch, canonical effect resolution, typed unresolved and
rejected outcomes, governed forms, company policy and navigation are reused.
No frontend helper becomes a second stock, cost or authorization authority.

New table/reducer/resource shapes must update authored exposure, operation IDs,
operation contracts, invalidation, resource/storage policy and durable migration
inputs. Generate artifacts through the established producer, review the clean
codegen diff, promote/freeze additive migrations, publish the immutable contracts
release and pin it consistently in Cargo/frontend before running contract gates.
Never hand-edit generated bindings or rewrite released migration checksums.

The [contracts extraction plan](../plans/contracts-extraction-execution-plan.md#21-refined-generator-boundary)
requires PostgreSQL DDL to derive from the v2 persistence handoff. The completion
stack now moves every generated PG DDL target write behind that boundary;
`--postgresql-ir-only` consumes the handoff without inspecting domain source or
SDK bindings. The early schema stage only plans prerequisite manifests.

The released contracts-owned typed-read emitter still has an Accounting-only
allowlist. The first prepared candidate omitted the four Manufacturing cost
row codecs even though canonical IR exposes the resources, failing full web
typecheck. The approved [companion contracts PR #18](https://github.com/KevTiv/lumiere-contracts/pull/18)
adds those IR-derived codecs. Its 32 emitter tests, 19 runtime tests, package
typecheck/build and full application web typecheck against the candidate passed.
The application has since received the v0.3.100 pin, but that tag predates the
companion fix. Review, a subsequent immutable release incorporating #18, and
final-pin checks are still required. No handwritten decoder or cast workaround
has been used; neither PR has been merged.

## Definition of done

1. D: compile the integrated SpacetimeDB module and execute focused new reducers
   plus `run_all_manufacturing_tests` on a disposable fresh database. Query the
   exact owners and stock/cost/journal rows; include rejection, replay and atomic
   rollback cases. A test file or successful compilation alone does not pass D.
2. A: run semantic contract/mapper/effect tests and required frontend/API checks
   against the final pin. Generated session operations retain organization,
   active-company and permission enforcement. Reader denial returns 403;
   stale/conflicting replay returns its typed rejection and changes no effects.
3. O: one browser path visibly creates the BOM and MO, consumes, executes
   required workorders/QC, records production and closes. Scrap/byproduct result
   links must open exact records and survive reload. Fixture reference-data
   setup is permitted; it cannot stand in for the transitions being claimed.
4. E: inspect exact parent-owned effect sets, quantities, material/labor costs,
   inventory variance and configured accounting identities. Include lost-response
   recovery, duplicate requests, stale state and denied calls. Do not substitute
   transport acceptance, query-cache invalidation or latest-row selection.
5. Record immutable application/contract/artifact identities, executed commands,
   results, personas, viewport scope, projection head convergence, migration
   compatibility and remaining restrictions in the final evidence bundle.
   Reconcile the D/A/O/E matrix and usability ledger only with executed evidence.
   Promote U5 only when all applicable gates pass; otherwise keep U2/review and
   hide/restrict unproved exposed capabilities. Historical audit migration,
   import safety and unrestricted production readiness remain separate gates.
