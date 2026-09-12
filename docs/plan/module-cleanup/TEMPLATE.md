# <module> maintainability ledger

Copy to `<module>.md` in this directory. Replace placeholders with inspected
facts; keep unmeasured fields explicitly unmeasured. Do not edit the template
as the module's execution record.

Execution guide: [module-by-module plan](../module-by-module-maintainability-plan.md).

## Scope and current status

- Module / owned features:
- Status: **unassessed** (`unassessed`, `in progress`, `partial`, `accepted`).
- Last inspected date / branch / HEAD:
- Working-tree changes present before this session:
- Latest accepted slice / validation identity (commit if available):
- Canonical owner-plan tasks referenced, including existing partial work:
- Explicit exclusions and their owner:

## Ownership map

| Responsibility | Current path/symbol | Canonical owner / intended boundary |
| --- | --- | --- |
| Module composition / routes | | |
| Feature state / forms / dialogs | | |
| Query hooks / row types / invalidation | | |
| Input adapters / patch and codec semantics | | |
| API / trusted operation context | | |
| Reducer / business transaction | | |
| Projection / cooling / recovery, if relevant | | |
| Tests / registered runtime fixtures | | |

Representative workflow: `<user action → UI → adapter/query → API → reducer → refresh/persistence>`.
Name the read and mutation operations, source of authority, and failure behavior.

## Stage evidence

Allowed stage states: `not started`, `partial`, `accepted`, `not applicable`.
Accepted entries require evidence; not-applicable entries require a reason.

| Stage | State | Scope, evidence, remaining work |
| --- | --- | --- |
| M0 ownership map | not started | |
| M1 typed contracts | not started | |
| M2 shared decisions | not started | |
| M3 UI decomposition | not started | |
| M4 backend orchestration | not started | |
| M5 human composition proof | not started | |
| M6 module closeout | not started | |

## Ranked findings and slices

Each finding needs current path/symbol evidence and a maintenance consequence.
Use stable module-local IDs, for example `ACC-01`. Separate behavior defects,
performance candidates, and maintainability findings.

| ID | Finding / evidence | Proposed bounded slice | Dependencies / owner | Status |
| --- | --- | --- | --- | --- |
| | | | | |

## Active session

- Selected finding / reason:
- Owned files and callers to migrate:
- Invariants and behavior to preserve:
- Expected behavior changes, if any (otherwise `none intended`):
- Existing shared owner searched / selected:
- Planned checks and runtime prerequisites:

### Focused baseline and result

Use the same measurement method before/after. Distinguish runtime code from
generated files, configuration, fixtures, and inline tests. Add only useful rows.

| Signal | Method / scope | Before | After | Interpretation |
| --- | --- | --- | --- | --- |
| Orchestration responsibilities / span | | | | |
| State ownership / cross-feature dependencies | | | | |
| Duplicate implementations / migrated callers | | | | |
| Existing opaque-record ratchet | | | | |

### Validation evidence

| Command or workflow | Revision / dirty-state scope | Result | What it proves / does not prove |
| --- | --- | --- | --- |
| | | not run | |

Record skipped or conditionally bypassed runtime tests, existing baseline
failures, unavailable prerequisites, and user-visible behavior checked.

## Exceptions and remaining dependencies

| Item | Why retained / exact blocker | Owner / next action | Revisit trigger |
| --- | --- | --- | --- |
| | | | |

## Session history

Append one short entry per session; link existing evidence instead of copying
large tool logs. Capture code changes, caller adoption, checks, remaining debt,
and any commit/contract release actually performed.

- `<date; base HEAD; slice ID>`: `<result and evidence; limitations>`.

## Next session handoff

- Exact next slice and current source paths:
- Why it is next / prerequisites:
- What is already done and must not be reimplemented:
- Known unrelated working-tree changes or validation failures:
- Required verification before marking the next slice accepted:
- Module completion status remains distinct from C0–C11 and generated-UI activation.

