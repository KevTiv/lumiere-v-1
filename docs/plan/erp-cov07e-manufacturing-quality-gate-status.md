# COV-07e — manufacturing quality gate

**Status:** REVIEW — operator runtime proof added; clean-stack execution pending
**Branch:** `codex/cov07e-manufacturing-quality-gate`  
**Stack base:** COV-07d / `codex/cov07d-workorder-execution`
**Current review base:** `6855d773f93f18d84209272e8e96ed0e29c08ad7`

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

The existing manufacturing workorder browser path now drives the visible row
actions for the warehouse operator to require and pass the exact in-process
check. It verifies the canonical quality-check readback in the
Manufacturing quality tab, proves pending quality blocks finish, rejects
duplicate creation and disposition replay, and confirms a limited reader cannot
create or disposition the check. A clean-stack execution of that browser spec remains
required before marking the slice ACCEPTED.

The first-org warehouse/manufacturing persona now has the existing reducer's
required `quality_check:create`, `quality_check:read`, and
`quality_check:write` permissions. The limited reader remains denied. The
operations are already present in the pinned contract, so this fixture and
evidence change does not require a contract release.

Scrap, byproducts, routing depth, and full manufacturing costing remain later
bounded slices.
