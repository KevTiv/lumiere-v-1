# Offline product-category projection — first bounded slice

Status: first-slice evidence from PR #137, stacked on AI reconstruction prerequisite
PR #136. The next slice is documented in
[`offline-category-server-feed-status.md`](offline-category-server-feed-status.md).

## Delivered boundary

`@lumiere/offline` adds one read-only client projection for `product-categories`.
The existing Rust-derived `lumiere-schema-manifest.json` is the schema input;
`lumiere-codegen/offline-projection-policy.json` only selects the reviewed resource
and field subset. It does not introduce handwritten business types or validation.
The Python target emitter generates the SQLite DDL, Drizzle table, compatibility
fingerprint, typed row and strict decoder from that same input. Unknown types,
missing identity/scope fields and invalid SQL identifiers fail closed.

Only `id`, `organization_id`, `company_id`, `name`, `parent_id` and `sequence` are
materialized. The server transport must require authorization for every
selected field; it must not return restricted metadata, actor identities or raw
full-table rows. Product-category soft deletes must become deletion events, and
initial snapshots must exclude deleted rows. The client does not infer deletion
from missing fields.

SQLite is the only durable local store. Drizzle provides typed, read-only
repository access to the same connection; the sync owner applies writes through
synchronous SQLite transactions. IDs and cursors use canonical decimal strings
without JavaScript precision loss. SQLite `INTEGER` holds the IR's bounded u32
sequence; u64 IDs use `TEXT`.

The Node SQLite adapter supports file-backed restart and offline reads on Node
22.13+/24. Browser OPFS, Tauri and native adapters are not implemented here.
No app route or existing React Query hook is switched to the new repository.

## Snapshot/pull contract

`ProjectionTransport` is a port. It returns unknown
wire input, and `SyncEngine` validates closed envelopes, projection fingerprint,
trusted-host scope and bounded rows before application. Tests use a deterministic
transport fixture backed by real SQLite. The next slice adds an authenticated
HTTP connector and API implementation; live-server acceptance remains pending.

The authenticated host supplies environment, actor, organization, selected
company and authorization version. The full tuple partitions rows/checkpoints.
Org-wide rows may appear in a granted company view; another company's rows may
not. Organization/company identifiers are not authority merely because they are
present in the request. The server must resolve the actual session and current
permissions independently on every snapshot/pull.

Each call applies one complete snapshot (at most 1,000 rows) or one pull page
(at most 1,000 changes). Oversized snapshots refuse activation; paged snapshot
staging is a later slice. The snapshot cursor must identify an atomic consistent
snapshot watermark. Pull `fromCursor` must match the durable checkpoint;
ordered visible changes must lie strictly after it and at/before `nextCursor`.
Filtered gaps are allowed, but a `hasMore` page must advance. These cursors are
not synthesized from timestamps or realtime invalidation messages. The next
slice pages whole commits: changes within a commit share its sequence, retain
canonical ordinal order, and commit together locally. A page never checkpoints
partway through a business commit.

Rows and checkpoint advance in one transaction. Failed application rolls both
back. A checkpoint compare-and-swap rejects stale replies/competing engines;
repeated calls on one engine share a request. Cancellation after transport
completion cannot apply rows. `hasMore` is returned to the host, which owns
connectivity/backoff scheduling. The post-commit callback can invalidate the
host's React Query key; React Query remains disposable memory state.

The host must call `store.clear()` before logout or observed scope/policy
revocation. Clearing removes this projection's rows/checkpoint and advances a
durable scope generation, invalidating already-open handles and in-flight replies.
Only a freshly authenticated host may open a new handle. Offline clients cannot
discover a server-side revocation while disconnected; offline grant expiry and
encrypted runtime storage remain future admission requirements. The low-level
connection/store belongs to the sync owner; application views receive only the
`CategoryRepository` read interface.

Incompatible local schema fingerprints fail closed with a migration-required
error and preserve data. There is no destructive automatic migration or second
mutation/cache layer. No ChangeSet, reducer replay or review UI is implemented
in this slice.

## Validation

Generation was exercised against both immutable `v0.3.60` and `v0.3.75` schema
manifests. Their reviewed product-category fields produce identical output.
This branch incorporates PR #136's published `v0.3.75` consumer pin. Generated
output is checked by the existing source and pinned
codegen gates; no additional contracts release is needed for this client emitter.

Commands:

```sh
make contracts-staging-from-pinned
make check-offline-projection
pnpm --dir frontend/packages/offline typecheck
pnpm --dir frontend/packages/offline test
```

Local validation: 37 Node/SQLite tests and 10 Python emitter tests pass;
TypeScript, Prettier, generated drift checks and the workspace's frozen-lockfile
check with its pinned pnpm 10.31.0 pass. The Rust/full-stack completion gate was
not run in this environment.

Local tests cover real SQLite rollback after row writes/before checkpoint commit,
retry, maximum u64 identity, file-backed restart, ordered upsert/delete, scope
partitioning, schema drift, unknown/oversized payloads, network failure,
cancellation, concurrent callers and stale replies. These are implementation
checks; they do not certify a live server feed or installed desktop/PWA experience.

## Next bounded slice

The server snapshot and durable replay implementation is now in the stacked
server-feed slice. Complete its live authorization/concurrent mutation/reconnect
gate before admitting an installed experience. Then add one actual browser/Tauri
adapter and read-only application adoption. Only after those gates should
ChangeSet capture and admin review begin.
