# COV-18 — Upload/version → lock/unlock one document

**Status:** IMPLEMENTED — lock/unlock slice; runtime acceptance pending  
**Module/surface:** Documents / Knowledge  
**Plan target:** upload, version, attach and archive one document  
**Scaffold source:** [`erp-cov08-27-scaffold.md`](./erp-cov08-27-scaffold.md)

## Bounded path (to implement)

Operator surface: /documents

Existing operations (already reachable from the frontend command layer):

- `lock_document` — hook: `frontend/packages/query-hooks/src/hooks/documents.ts`
- `unlock_document` — hook: `frontend/packages/query-hooks/src/hooks/documents.ts`

Canonical resources: documents

## Effect contract

Same document id reads back its lock state and holder.

Implementation pattern: wrap the mutation's readback with `resolveUniqueEffect` /
`executeOperationWithCanonicalReadback` from
`frontend/packages/query-hooks/src/hooks/operation-effect.ts` (see COV-08c and
COV-08d for the minimal form). Never correlate by newest row, name or timestamp.

## Contract disposition

**Contract release required.** `documents` projection exposes no lock columns (table has is_locked, locked_by, locked_at, locked_until)

Contract releases are automatic: pushing the registry or reducer change runs `.github/workflows/release-contracts.yml`, which publishes the next lumiere-contracts version and pins it on the branch. Pull its pin commit before continuing.

## Slice 1 — lock / unlock one document (implemented)

- **Reducer:** `unlock_document` (`spacetimedb/src/documents/documents.rs`) now rejects a
  document that is not locked (including a lease that just expired). Before this slice a
  replayed unlock returned success without a transition. `lock_document` already rejected
  a replay ("Document is already locked"). A non-holder unlock still needs `document:admin`.
- **Projection:** `documents` in `crates/stdb-auth/assets/resource_registry.json` now
  exposes `is_locked`, `locked_by`, `locked_at`, `locked_until`. This is the contract
  release trigger; pull the pin commit before runtime acceptance.
- **Hooks:** `useLockDocument` / `useUnlockDocument`
  (`frontend/packages/query-hooks/src/hooks/documents.ts`) read `/api/query/documents` back
  after dispatch and resolve the exact row through `resolveDocumentLockEffect`
  (`document-lock-effect.ts`): same id, same organization, locked + holder recorded (or
  unlocked + no holder). Duplicates raise `AmbiguousOperationEffectError`; server errors
  now surface the reducer message.
- **UI:** the `/documents` Documents tab has `Lock` / `Unlock` table actions
  (`entity-action-lock-document`, `entity-action-unlock-document`). The check-in form only
  auto-unlocks a row that reads back locked, because unlock no longer tolerates replay.
- **Not in this slice:** version upload/check-in UI, retention/legal-hold/recycle UI, blob
  lifecycle. The check-in form (`uploadVersion`) has no Documents-tab entry point yet, so
  the "version" half of the plan target stays open.

## Prerequisites / decisions

Contract release pin for the new `documents` projection columns (automatic on push).

## D/A/O/E proof checklist

| Gate | Required proof | State |
| --- | --- | --- |
| D | Native domain test: transition, replay rejection leaving the row unchanged, invariant/denial cases | WRITTEN — `test_documents_create_and_lock` in `spacetimedb/tests/platform/platform_smoke.rs` (lock holder/time, replayed lock rejected, unlock clears holder, replayed unlock rejected, rows unchanged); module compiles, in-module run pending |
| A | Generated operation keeps permission + organization/company scope; reader persona denied (403) | WRITTEN — `check_permission(document, write)` + org match; reader replays asserted 403 in the spec; not yet run |
| O | Playwright drives the transition through the visible UI action (setup calls allowed only for fixtures) | WRITTEN — Documents tab `entity-action-lock-document` / `entity-action-unlock-document` in `frontend/web/tests/e2e/cov18-document-lock-version.spec.ts`; not yet run against a stack |
| E | Exact-effect resolver unit test (state/scope/identity/ambiguity) and browser snapshot preserved after stale (422) and denied (403) replay | DONE (resolver) — `document-lock-effect.test.ts`; browser snapshot assertions written in the spec, not yet run |

## Acceptance

Becomes IMPLEMENTED when the bounded path and proofs above exist, and ACCEPTED only
with same-head green CI (plus the contract release, when required).
