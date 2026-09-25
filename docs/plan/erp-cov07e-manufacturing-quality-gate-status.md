# COV-07e — manufacturing quality gate

**Status:** BACKEND IMPLEMENTED — contract/UI certification and runtime acceptance pending  
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

## Remaining before claiming COV-07e certification

- Regenerate and publish the versioned IR/contract descriptors for the two new
  reducers, then wire their BFF commands and the selected workorder's actions.
- Add canonical exact-check readback with stale and read-only denial browser
  assertions, following COV-07d's workflow pattern.
- Run native persisted tests and browser acceptance in an environment with
  Rust/SpacetimeDB and the pinned contracts. This workspace has no `cargo`.

Scrap, byproducts, routing depth, and full manufacturing costing remain later
bounded slices.
