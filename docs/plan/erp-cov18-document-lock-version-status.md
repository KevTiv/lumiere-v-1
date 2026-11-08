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
## Slice 2 — upload a new version (implemented)

- **Reducer:** `add_document_version` recovers an exact retry by the original actor
  using the immutable object URL and complete version payload. Recovery creates no
  duplicate and never makes a historical version current. Reusing an object with
  different details or a different actor is rejected. Write permission, organization
  scope, folder access and live locks are checked before recovery.
- **Hook:** `useAddDocumentVersion` snapshots `/api/query/document-versions` before
  dispatch and after it resolves the one *new* row for the exact document + organization with
  the uploaded url + checksum and `is_current` (`resolveDocumentVersionEffect`,
  `document-version-effect.ts`). More than one match raises `AmbiguousOperationEffectError`.
- **UI:** the Documents tab has `Upload version` (`entity-action-upload-document-version`) opening
  the existing check-in form (blob upload → `add_document_version` → evidence ingest), and
  `Set retention` (`entity-action-set-document-retention`) opening the existing retention form.
- **Spec:** second test in `cov18-document-lock-version.spec.ts` uploads a file through the UI,
  verifies that version 1 is no longer current and that the receipt and checksum-pinned download
  match the exact new current version. An exact retry (200), a conflicting payload (422) and a
  reader replay (403) all preserve both version rows.
- **Still not done:** legal-hold UI (no form config exists; the reducer/hook do), retention
  proof beyond the entry point, recycle-bin/purge proof, blob lifecycle, linked-record
  navigation. These remain COV-18 follow-ups.

## Prerequisites / decisions

Contract release pin for the new `documents` projection columns (automatic on push).

## D/A/O/E proof checklist

| Gate | Required proof | State |
| --- | --- | --- |
| D | Native domain test: transition, replay leaving the row unchanged, invariant/denial cases | `test_documents_create_and_lock` and the Wave D document test in `spacetimedb/tests/platform/platform_smoke.rs` cover lock/unlock, conflicting version replay, version chain and deletion guards; prior `run_documents_wave_{a,b,c,d,e}_tests` passed against a scratch local DB. `test_historical_document_version_retry` in `spacetimedb/tests/platform/document_folders_test.rs` verifies exact and historical retries preserve the version chain and still require write access. |
| A | Generated operation keeps permission + organization/company scope; reader persona denied (403) | `check_permission(document, write)` and organization/folder access checks; browser spec asserts reader replays return 403. |
| O | Playwright drives the transition through the visible UI action (setup calls allowed only for fixtures) | `cov18-document-lock-version.spec.ts` uses the Documents tab Lock, Unlock and Upload version actions. |
| E | Exact-effect resolver unit test (state/scope/identity/ambiguity) and browser snapshot preserved after exact version recovery (200), conflicting version replay and stale lock/unlock (422), and denied replay (403) | `document-lock-effect.test.ts`, `document-version-effect.test.ts` and `lib/documents-create-params.test.ts` cover exact effects; the browser spec checks unchanged snapshots and verifies receipt and blob provenance. |

## Acceptance

Becomes IMPLEMENTED when the bounded path and proofs above exist, and ACCEPTED only
with same-head green CI (plus the contract release, when required).
