# Authenticated category snapshot and changefeed

Status: implementation candidate, stacked on PR #137. Contracts remain pinned
to published `v0.3.75`; this slice changes no canonical schema or reducer signature.
The full Rust/runtime completion gate remains assigned to the next local pass.

## Delivered behavior

The read-only API exposes three GET endpoints under `/v1/offline/product-categories`:

| Endpoint | Input | Result |
| --- | --- | --- |
| `/scope` | Optional `companyId` selection | Server-derived scope and projection schema hash |
| `/snapshot` | Discovered `authorizationVersion`, optional `companyId` | Active selected rows and a consistent organization commit watermark |
| `/pull` | Same scope selection plus canonical decimal `cursor` | Complete durable commits after the cursor, projected to the selected fields |

Organization and actor are resolved from the current authenticated session.
Company selection must match membership-derived scope; organization-wide rows
are shared within that scope. Unknown query fields are rejected. Both snapshot
and pull re-resolve session, placement, company membership and policy after the
read, before returning data. Responses produced by the handlers use `no-store`.

Admission requires resource read access and permission for all six selected
fields: `id`, `organization_id`, `company_id`, `name`, `parent_id`, `sequence`.
The current default category field registry omits `sequence`; ordinary roles
therefore need an explicit matching field grant. Superusers and `*:*` roles are
admitted. This slice does not broaden the registry or default role permissions.
Full durable rows, metadata and audit identities never appear in the response.

The authorization version fingerprints resolved actor/org/company/role policy
and selected schema. Environment identity includes STDB endpoint/module,
placement generation and completed reconstruction run ID. Active or failed
reconstruction fences deny offline reads; a completed reconstruction changes
scope even when restoring into the same module and watermark.

The server reuses existing organization commit cursor/envelope/row-change tables
and the projector's checksum, ordering, identity and full-row codec validator.
Create, update, soft delete, restore, category CSV import and dev seed now record
their category effects in the reducer transaction. The registered C2 source gate
covers these writers. Generated reconstruction writes remain behind their
existing reconstruction fence. Existing data needs no historical backfill: the
initial snapshot establishes a new baseline.

Snapshots read watermark → rows → watermark, retrying a moving watermark up to
three times. Equal watermarks bracket a consistent category read because ordinary
category effects and their commit records commit together. No success is returned
under continuous mutation or oversized snapshots. Selected SQL columns and the
shared compatibility hash are emitted from the same reviewed IR policy as the
client; `deleted_at` is source-only soft-delete metadata.

Pulls use organization commit sequences as exact u64 decimal cursors. Each page
contains at most 20 whole commits and 1,000 visible changes. Multiple row effects
in one commit share its sequence and retain validated ordinal order. The client
applies the entire page and its checkpoint in one SQLite transaction. Filtered
commits still advance progress. A page never splits a commit; missing retained
records, future cursors or commits exceeding the visible bound require a fresh
snapshot. Source commits exceeding 10,000 changes or 4 MiB are also refused.
Soft deletion emits a scoped identity-only tombstone; restore emits an upsert.
Bare physical deletion cannot prove historic company visibility and requires
reset. This slice adds gap detection, not a retention/pruning policy.

`connectCategoryTransport` discovers trusted server scope and resolves current
auth headers for every request. Cookies are included, redirects refused and
UTF-8 responses bounded to 4 MiB before envelope decoding. HTTP 401/403/409/410
cause the sync engine to clear its scoped rows/checkpoint and invalidate open
handles. Outages preserve offline reads. Hosts still clear before logout/scope
changes and must discard handles if local cleanup fails. A disconnected client
cannot observe remote revocation; grant expiry and encryption remain separate
runtime admission requirements.

## Evidence and outstanding gate

Passed locally:

- 46 Node tests using real SQLite, including a local authenticated HTTP fixture
  for discovery/snapshot/replay, same-commit ordering, fresh credentials,
  authorization/history reset, outage recovery and UTF-8 response bounds.
- 14 tests against the actual Rust snapshot/replay core and selected-row projector,
  compiled in an isolated harness: moving rows/watermarks, retry refusal, whole
  commit paging, filtered progress, retained gaps, maximum u64 and scoped tombstones.
- 12 Python emitter tests plus 4 C2 gate tests, TypeScript, Prettier, Rustfmt,
  generated drift against immutable `v0.3.75`, C2 source coverage and trusted-route lint.

The isolated Rust harness does not compile Axum, session authority, the STDB
source or reducer integration. `cargo test -p api-server offline --locked
--no-default-features` was blocked before compilation while fetching the private
contracts Git dependency. Three policy tests, two route tests and persisted
category lifecycle/CSV assertions are authored but await that full build/runtime.
The HTTP fixture is not the Rust API or a live STDB deployment.

Next local pass, with private dependency access:

```sh
make contracts-staging-from-pinned
make check-offline-projection
make check-c2-commit-coverage lint-trusted-route-boundaries
cargo test -p api-server offline --locked --no-default-features
pnpm --dir frontend/packages/offline typecheck
pnpm --dir frontend/packages/offline test
```

Publish the test-enabled STDB module and run `run_inventory_product_category_test`
with the existing superuser harness. It now asserts exact persisted category
rows for create/update/delete/restore, no commits for rejected/idempotent calls,
and one ordered commit for a multi-row partial CSV import. Then exercise the
actual API against that module: denied/missing field grants; forged org/company;
policy/session changes during reads; concurrent mutation during snapshot;
delete/restore and CSV replay through file-backed client restart; retained gaps;
and active/completed reconstruction epochs. Verify response fields and checksum
failure handling before claiming live feed acceptance.

No percent-complete claim is justified by this bounded evidence. Browser storage
is implemented in the next stacked slice; see
[`offline-browser-storage-status.md`](offline-browser-storage-status.md).
Tauri storage, read-only app adoption, snapshots beyond 1,000 rows, offline grant
expiry/encryption, ChangeSets and admin review remain later slices.
