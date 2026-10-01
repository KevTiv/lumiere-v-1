# Read-only category app and offline startup

Status: implementation candidate, stacked on browser-storage PR #139.
The authenticated Rust API/STDB completion gate remains pending locally.

## Implemented

Inventory's product-category toolbar opens a read-only reader at
`/offline/categories/index.html?companyId=<selection>`. The public static shell
uses the actual browser worker, OPFS SQLite projection and Drizzle repository.
It displays exact decimal IDs, searches displayed rows and labels the 200-row
limit. Category mutations remain in inventory.

The reader discovers the current cookie-authenticated scope before displaying
saved rows. URL company selection is intent only. Refresh, reconnect, online
focus and foreground polling recheck scope before replay, with at most 20 bounded
pages per refresh. Outages preserve an admitted open view; authorization/history
resets hide and clear it. Changed actor/company/policy requires a fresh connection.

Sign-out and observed ERP identity/organization transitions broadcast revocation
and write an origin-wide metadata marker. Company-selection storage events also
revoke other-tab readers. An active reader hides rows, cancels pending work, then
clears its own scoped projection/checkpoint and closes the worker. Ordinary page
departure preserves saved data but a restored page must verify again. This is not
an all-actor OPFS wipe: inactive partitions can remain on disk and suspended or
crashed tabs cannot acknowledge cleanup. Cached metadata never grants admission.

The scoped service worker precaches only public static HTML, CSS, hashed
client/worker JS and pinned real WASM. APIs, session responses and authenticated
Next HTML are excluded. Failed installs discard their partial cache. Updates wait
for existing category clients to close and remove only old category asset caches.
Next dev/build generates the assets; Turbo restores them and tracks worker/build
source changes. Next rewrites and Kong expose `/api/offline/*` to Rust
`/v1/offline/*`.

## Evidence

Chromium 153.0.8010.0, real SQLite WASM and OPFS:

- All 29 browser tests passed together: 18 storage checks and 11 app checks.
  These cover exact IDs/search, reconnect/replay, cold offline shell startup,
  offline worker/WASM initialization, public-only caches, cross-tab company and
  sign-out invalidation, delayed snapshot cancellation, actor transition,
  scope/replay denial, clearing, waiting updates and failed install recovery.
- 48 offline Node tests and 3 Next rewrite tests passed. The production asset
  build runs in the Node suite and is checked for reproducibility.
- Offline/app TypeScript, translation keys/duplicate keys, immutable browser
  operation transport, Turbo's resolved build-cache graph and pinned pnpm
  10.31.0 frozen-lockfile validation passed.

Tests use a deterministic cookie-authenticated HTTP fixture, not live Rust/STDB.
They do not certify Next SSR integration, Kong deployment, Docker builds, browser
quota/eviction or all browser profiles. Full workspace checks remain deferred to
the local pass; private contracts prevent a complete install here. Existing CI
runs the Node build/unit check and lists browser tests; no new CI job or routine
browser download is added.

## Remaining admission work

Cold offline launch shows the shell and a reconnect prompt, **not private rows**.
Signed offline authorization lifetime, encryption/persistence and quota/eviction
recovery remain undefined. An already verified open reader can read disconnected;
new launches must reconnect. This is not a fully installed offline ERP experience
and adds no offline business-write queue.

Run the live authenticated API/STDB snapshot/replay/revocation gate through Next
and Kong, with actual inventory navigation, sign-out, company changes and
production assets. Decide signed offline grants and persistence/encryption policy.
Larger snapshots, pagination beyond 200 displayed rows, multi-tab cooperation,
Tauri, ChangeSets and review workflows remain later slices. A project-wide
percent-complete estimate is not supported.

The environment was restored after a disconnect and the final files were retested.
Docker manifest/link changes still require the local Docker build gate.
