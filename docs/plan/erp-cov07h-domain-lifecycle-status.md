# COV-07h — complete persisted manufacturing lifecycle proof

Status: IMPLEMENTED — compilation and reducer execution pending.
Branch: `codex/cov07-domain-lifecycle`; stack base: PR #175 head `9eb67a11`.

The new `run_manufacturing_bom_to_close_domain_lifecycle_test` reducer is also
registered in `run_all_manufacturing_tests`. It follows one BOM and MO through
creation, confirmation, material consumption, two routed/blocking workorders,
productivity, required quality checks, partial production, and manufacturing
close. All manufacturing changes use the existing application reducers.

The opening organization fixture supplies 100 units of raw stock at cost 10.
Separate primary and byproduct products prevent consumption and output from
cancelling one another in the same product quant. A base-two BOM has two raw
lines, 1.5 and 0.5, and a 0.5-unit byproduct with a 20 percent cost-share field.
An MO for 0.5 units must own exactly two raw moves (0.375 and 0.125), finish with
99.5 raw units/value 995, and own exactly two output moves: 0.5 primary units at
standard cost 17/value 8.5 and 0.125 byproduct units at standard cost 3/value
0.375. The BOM's existing cached component estimate must equal 20.

The proof checks exact organization/company/product/location identities,
parent/child ID sets, terminal move flags, workcenter capacity, operation
dependencies, closed productivity rows and passing quality ownership. Scoped
effect snapshots must remain unchanged on material replay and rejected draft,
state replay, routing blocker, overproduction, pending-quality, and terminal
commands.

These are assertions of the existing standard-cost and cost-share fields.
They do not certify accounting journal identities, actual manufacturing cost
allocation, labor/overhead absorption, tracked output, or reservations/ATP.
The fractional MO and non-unit BOM base require the concurrent costing slice's
material-scaling correction: `line.product_qty * mo.product_qty / bom.product_qty`.

Validation: source inspection and `git diff --check` only at authoring time;
Cargo/rustfmt/SpacetimeDB are not initially installed in the agent environment.
The coordinator owns compilation, module publishing and reducer execution.
U5/module promotion must wait for executed domain and integrated acceptance
evidence; adding this test alone does not change the module's U2/review status.
