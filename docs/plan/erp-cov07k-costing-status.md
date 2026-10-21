# COV-07k — actual manufacturing cost and valuation

Status: implemented; integrated runtime, durable projection, contract release and browser acceptance pending.

The close owner derives material value from the exact consumed source-quant cost snapshots. It normalizes manufacturing quantity to the BOM unit/base quantity, converts component quantities to their stock units, checks complete BOM ownership and aggregate on-hand availability before creating moves, and persists raw-material ownership on each move. Source quantities, costs, currency and values must be finite and consistent. Consumption remains bounded to one unowned, unpackaged, untracked source quant per component; mixed FIFO/LIFO source layers and tracked component consumption are not included.

`configure_workcenter_cost_rate` defines an explicit company-currency hourly rate for a scoped, active workcenter. Each new productivity log owns an immutable `mrp_productivity_cost` snapshot of duration in minutes, rate, currency and amount. Rate edits affect subsequent logs only. Missing rates are recorded explicitly as unconfigured with zero value; valuation-enabled close rejects unconfigured logs. Historical productivity rows without snapshots require migration or operational remediation, rather than silently acquiring today's rate.

Actual material plus workcenter value is conserved across primary output and BOM byproducts. Byproducts receive their configured percentage; the primary receives the remainder. Stock moves retain actual allocated unit prices. Existing inventory cost policy applies to output quants: standard cost retains the product standard price, average cost blends actual value, and FIFO/LIFO creates cost layers. A real zero actual value is preserved for nonstandard outputs. `mrp_production_cost` owns exact raw, output, time-snapshot, accounting move and line IDs; one MO has one result. Completed-close retries cannot duplicate stock or journal effects.

`configure_manufacturing_valuation` opts a company into real valuation posting through the normal accounting create, line and post owners. Configuration requires a general/inventory/manufacturing journal, company-currency asset accounts for material/output inventory, and expense accounts for absorbed workcenter cost/variance. Close preflights accounting permissions and open periods. The posted journal debits output inventory, credits consumed material and absorbed workcenter cost, and posts actual-versus-standard variance. The accounting owner's idempotency receipt resolves the exact journal ID; duplicate scoped references fail closed. This is close-time posting, not a work-in-progress accounting engine. The quarantined `inventory_valuation` table is not repurposed.

Validation authored:

- Three independent native arithmetic tests: remainder conservation, invalid/nonfinite/overflow rejection, and minute/hour conversion. Executed successfully with `rustc --test` on 2026-10-11.
- Persisted `costing_test::test_actual_cost_and_posted_valuation`: BOM base 2/MO quantity 0.5, source-quant snapshot, replay identity, immutable 90-minute hourly-rate snapshot, exact posted journal and four lines, standard variance, and no duplicate close effect.
- Persisted `costing_test::test_configuration_scope_and_closed_period`: invalid/nonfinite and foreign-company rates/accounts, full-row configuration commit, and closed-period rejection before output/cost writes.

The persisted tests are prepared for the integrated manufacturing suite; their runtime results must be recorded by the integration owner. No U5, complete accounting coverage, or complete tracked/FIFO source-costing claim follows from native math tests alone. Contract, migration and operation-effect publication belong to the stack integration owner.
