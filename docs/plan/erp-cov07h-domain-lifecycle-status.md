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

The workcenter's explicit hourly rate is 60. Four and six productive minutes
cost 4 and 6, so the MO must own exact productivity-cost rows totaling 10.
Its exact production-cost result must reference the raw/output move sets and
productivity-cost sets, with material value 5, labor value 10, total actual
value 15, standard inventory value 8.875 and variance 6.125. Output moves carry
allocated actual unit cost 24 (primary value 12 and byproduct value 3), while
the standard-cost quants preserve their configured costs. Raw move cost
metadata must reference the exact opening quant and company currency.

The proof checks exact organization/company/product/location identities,
parent/child ID sets, terminal move flags, workcenter capacity, operation
dependencies, closed productivity rows and passing quality ownership. Scoped
effect snapshots must remain unchanged on material replay and rejected draft,
state replay, routing blocker, overproduction, pending-quality, and terminal
commands.

This scenario configures labor rates but intentionally has no accounting
valuation configuration. Its cost result must therefore contain no account
move or journal line references. It does not certify accounting journal
identities, overhead absorption, tracked output, or reservations/ATP; the
concurrent costing slice supplies the configured journal scenario.
The fractional MO and non-unit BOM base require the concurrent costing slice's
material-scaling correction: `line.product_qty * mo.product_qty / bom.product_qty`.

Validation: source inspection and `git diff --check` only at authoring time;
Cargo/rustfmt/SpacetimeDB are not initially installed in the agent environment.
The coordinator owns compilation, module publishing and reducer execution.
U5/module promotion must wait for executed domain and integrated acceptance
evidence; adding this test alone does not change the module's U2/review status.
