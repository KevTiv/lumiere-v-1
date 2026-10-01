# Browser SQLite storage

Status: implementation candidate, stacked on authenticated server-feed PR #138.
The full API/STDB runtime completion gate from that PR remains pending locally.

## Implemented

`@lumiere/offline/browser` opens a dedicated module worker owning the existing
generated SQLite projection, Drizzle repository and `SyncEngine`. The UI receives
asynchronous read methods and explicit sync/clear/close capabilities. The worker
does not expose arbitrary SQL or a second mutation/cache layer.

`@lumiere/offline/opfs-sqlite` implements the existing synchronous connection port
with official `@sqlite.org/sqlite-wasm` pinned to `3.53.4-build1`, backed by the
OPFS SyncAccessHandle pool. The Node and browser adapters share the same
transaction helper. Async transaction results are refused; category rows and
checkpoints still commit or roll back together. IDs remain exact decimal TEXT.
The schema and selected field fingerprint are unchanged.

An exclusive Web Lock admits one storage owner per origin. A second tab fails
immediately; closing the owner closes SQLite, pauses the pool, releases its file
handles and lock, and permits handoff. Scope tuples still partition cached rows
by environment/actor/org/company/policy inside the database. This is deliberate
single-owner admission, not transparent multi-tab coordination.

Transport callbacks stay in the authenticated host and cross a private
MessagePort as canonical response data. Credentials never enter the worker or
SQLite. Cancellation crosses both directions. Clearing invalidates the UI handle
before waiting for worker cleanup and aborts in-flight sync. Closing cancels
pending work while preserving cached data. HTTP authorization/history reset
errors retain their type/status across the worker boundary and clear the scoped
projection; outages retain offline reads.

Unsupported storage, malformed filenames, foreign-origin assets, failed WASM
loading and incompatible local schema all refuse activation. Initialization
failure releases ownership. The adapter never deletes an incompatible database
or substitutes ephemeral storage.

## Evidence

Passed locally on Chromium **153.0.8010.0**, with real worker/WASM SQLite/OPFS:

- 18 browser tests: page reload persistence, disconnected reads after startup,
  restart/replay at the durable checkpoint, exact maximum u64 identity, SQL fault
  rollback and retry, same-worker pool reopening, async transaction refusal,
  schema-drift preservation, tab contention/handoff, scoped cache isolation,
  delayed clear/close/cancellation, authorization reset, fresh credentials,
  outage reads, missing assets and unavailable OPFS.
- 47 Node/SQLite tests passed, including the shared synchronous transaction guard.
- TypeScript includes production code, worker code, browser fixtures, tests and
  Playwright configuration. Typecheck, Prettier, diff whitespace and workspace
  frozen-lockfile validation passed with pinned pnpm **10.31.0**.

The standard Playwright browser download failed in this environment. Tests ran
with a packaged Chromium executable via `LUMIERE_CHROMIUM_PATH`; no browser binary
is committed. The authenticated HTTP fixture is not a live Rust API or STDB.
Firefox, Safari, actual OPFS quota exhaustion, eviction and installed offline
boot are not certified by this suite. SQLite write failure is tested through a
real failing checkpoint trigger, not simulated browser quota exhaustion.

Whole-workspace dependency re-resolution attempted to fetch private contracts
and was blocked. The new dependency's immutable registry resolution was generated
in isolation and incorporated without changing existing private pins; the full
workspace frozen-lockfile check passed. Playwright and esbuild reuse existing
workspace versions. CI lists the browser tests in its existing frontend job;
the browser runtime suite is an explicit local gate, without a new CI job or
browser download in routine CI.

## Next admission work

Follow [`frontend/packages/offline/README.md`](../../frontend/packages/offline/README.md)
to serve the pinned WASM and bundle the worker in the host app. Adopt the repository
on one read-only category surface and wire query invalidation, connectivity and
logout/scope changes. Cache app/worker/WASM assets for offline boot. Define the
offline grant lifetime and encryption/persistence policy before admitting an
installed experience. Then run the actual authenticated API/STDB reconnect and
revocation gate alongside browser/profile/device coverage. Tauri, larger staged
snapshots, multi-tab cooperation, ChangeSets and review workflows remain later
slices. No project-wide percent-complete estimate is supported by this evidence.
