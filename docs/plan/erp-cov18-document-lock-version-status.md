# COV-18 — Upload/version → lock/unlock one document

**Status:** SCAFFOLDED — implementation pending  
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

Contract releases cannot be cut from CI or from the authoring session; stop at IMPLEMENTED with the registry diff prepared and hand off `make publish-contracts VERSION=x.y.z` to a maintainer with `lumiere-contracts` access.

## Prerequisites / decisions

Blob/version identity fixture.

## D/A/O/E proof checklist

| Gate | Required proof | State |
| --- | --- | --- |
| D | Native domain test: transition, replay rejection leaving the row unchanged, invariant/denial cases | TODO |
| A | Generated operation keeps permission + organization/company scope; reader persona denied (403) | TODO |
| O | Playwright drives the transition through the visible UI action (setup calls allowed only for fixtures) | TODO — `frontend/web/tests/e2e/cov18-document-lock-version.spec.ts` |
| E | Exact-effect resolver unit test (state/scope/identity/ambiguity) and browser snapshot preserved after stale (422) and denied (403) replay | TODO |

## Acceptance

Becomes IMPLEMENTED when the bounded path and proofs above exist, and ACCEPTED only
with same-head green CI (plus the contract release, when required).
