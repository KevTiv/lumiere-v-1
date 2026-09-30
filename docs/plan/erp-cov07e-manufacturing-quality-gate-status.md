# COV-07e — manufacturing quality gate

**Status:** IMPLEMENTED — runtime acceptance pending
**Branch:** `codex/cov07e-manufacturing-quality-gate`  
**Stack base:** COV-07d / `codex/cov07d-workorder-execution`

## Bounded path

An operator can require one in-process check on a Progress workorder through
`create_workorder_quality_check`. The reducer validates the exact MO/workorder
ownership, writes the same check ID to `workorder.check_ids`, and ties the check
to the MO, workorder, and product. A duplicate creation fails before mutation.

`pass_quality_check` updates the workorder quality projection. The new
`fail_workorder_quality_check` records an exception and blocks completion
without quarantining unproduced finished stock. The existing stock quality
failure path remains for on-hand stock; it rejects in-process checks.

`finish_workorder` compares the authoritative linked check ID set with the
workorder's `check_ids` and requires every check to be completed and passing.
`finish_manufacturing_order` requires any owned workorders to be Done and
without pending or failed quality. Orders with no workorders retain their
existing COV-07c path; workorders without required checks retain their COV-07d
path. This gate is explicitly opted into by requiring a check.

The persisted domain test exercises pending rejection, exact linkage, pass,
failure exception, blocked completion, and creation/disposition replay.

## Frontend/readback

The workorder row action now creates, passes, or fails its one owned quality
check. Each command resolves the exact `(organization, company, workorder)`
check from `quality-checks`; duplicate matches fail closed and completion is
only reported after the canonical disposition is visible.

Runtime browser acceptance and the contract-release pin remain required before
marking the slice ACCEPTED.

Scrap, byproducts, routing depth, and full manufacturing costing remain later
bounded slices.
