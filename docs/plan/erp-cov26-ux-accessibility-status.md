# COV-26 — One module quality pass per PR

**Status:** SCAFFOLDED — implementation pending  
**Module/surface:** UX / Accessibility  
**Plan target:** common UI-quality pass  
**Scaffold source:** [`erp-cov08-27-scaffold.md`](./erp-cov08-27-scaffold.md)

## Bounded path (to implement)

Operator surface: all T0 modules

Existing operations (already reachable from the frontend command layer):

- none (composition/system-wide track)

Canonical resources: n/a

## Effect contract

Loading/empty/error/denied states, keyboard/focus, viewports and reconnect evidence per module.

Implementation pattern: wrap the mutation's readback with `resolveUniqueEffect` /
`executeOperationWithCanonicalReadback` from
`frontend/packages/query-hooks/src/hooks/operation-effect.ts` (see COV-08c and
COV-08d for the minimal form). Never correlate by newest row, name or timestamp.

## Contract disposition

**No generated contract delta expected.** none

## Reports / Analytics bounded pass (2026-10-03)

**State:** REVIEW — one source-state distinction implemented; module quality pass remains open.

The self-serve query builder now renders an accessible loading status separately
from a successfully loaded source with zero rows. A focused pure-state test keeps
unselected, loading, legitimate-empty and ready states distinct.

This does not certify Reports COV-26. The shared stored-dashboard source hook does
not expose query failures, so denied, dependency/query-error and reconnect states
still collapse into the empty data source seen by the Reports view. The existing
create-and-attach widget path also rediscovers the created row by name and newest
id instead of a stable effect identity; it was not changed or accepted in this
slice. Malformed persisted filters/operators, missing timestamp/measure semantics,
keyboard/focus, responsive viewport and browser reconnect/readback proof remain
open.



## Prerequisites / decisions

COV-03..25 candidates.

## D/A/O/E proof checklist

| Gate | Required proof | State |
| --- | --- | --- |
| D | Native domain test: transition, replay rejection leaving the row unchanged, invariant/denial cases | TODO |
| A | Generated operation keeps permission + organization/company scope; reader persona denied (403) | TODO |
| O | Playwright drives the transition through the visible UI action (setup calls allowed only for fixtures) | TODO — `n/a` |
| E | Exact-effect resolver unit test (state/scope/identity/ambiguity) and browser snapshot preserved after stale (422) and denied (403) replay | TODO |

## Acceptance

Becomes IMPLEMENTED when the bounded path and proofs above exist, and ACCEPTED only
with same-head green CI (plus the contract release, when required).
