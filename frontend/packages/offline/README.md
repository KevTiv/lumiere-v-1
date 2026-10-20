# Offline category storage

The sync owner holds the SQLite connection and `SyncEngine`. Application views
receive the read-only `CategoryRepository`. See the package exports for Node
and browser runtime entry points.

## Browser

```ts
import { connectCategoryTransport } from "@lumiere/offline";
import { openBrowserCategoryProjection } from "@lumiere/offline/browser";

const { scope, transport } = await connectCategoryTransport({
  apiUrl: new URL("/v1", location.origin).href,
  // For bearer auth, provide a callback reading the current credential here.
  // Cookie sessions use credentials: "include" automatically.
});
const projection = await openBrowserCategoryProjection({
  scope,
  transport,
  wasmUrl: "/assets/sqlite3.wasm",
  onApplied: (resource) => invalidateQuery(resource),
});

await projection.sync(); // One bounded snapshot or pull page.
const rows = await projection.repository.list(); // Also works while disconnected.
// Before logout, revocation or switching actor/company:
await projection.clear();
await projection.close();
```

Serve `@sqlite.org/sqlite-wasm/sqlite3.wasm` from this exact installed package
version as the configured same-origin asset. Bundle the default module worker
through the application's `new Worker(new URL(..., import.meta.url))` support;
alternatively emit `src/browser-worker.ts` as a separate module asset and provide
its same-origin `workerUrl`. Missing assets refuse activation.

The browser adapter uses a worker-owned OPFS SQLite pool and an exclusive Web
Lock. One tab/worker owns this package's storage per origin; another owner fails
promptly. `close()` cancels sync, closes SQLite, releases file handles and the
lock, and terminates the worker. Closing preserves data; clearing removes only
the current scope's projection/checkpoint and invalidates its handles.

All SQL and writes stay in the worker. Its UI command surface consists of
repository reads, checkpoint inspection, sync, clear, close and cancellation.
Authentication and transport callbacks remain in the host; credentials are not
transferred to the worker or written to SQLite. Outages retain cached reads;
observed authorization/history resets clear them through the existing engine.
After reset or clear, close the handle and authenticate a new scope before
opening another handle. If cleanup fails, discard the handle.

Secure context, OPFS and Web Locks are required. There is no in-memory or
IndexedDB fallback. OPFS storage is subject to browser quota, eviction and
private-mode restrictions. The host owns persistence-grant policy, connectivity,
retry scheduling and cancellation. A disconnected restart also needs cached app,
worker and WASM assets plus an admitted offline authentication policy; this
package does not install a service worker. Its `./offline-grant` export verifies
the app's optional signed read lease; it does not provide at-rest encryption.

## Checks

```sh
pnpm --dir frontend/packages/offline typecheck
pnpm --dir frontend/packages/offline test
pnpm --dir frontend/packages/offline exec playwright install chromium
pnpm --dir frontend/packages/offline test:browser
```

The browser suite bundles the actual adapter, worker and client bridge with
esbuild, serves the pinned WASM locally and runs against real OPFS. The network
server is a deterministic authenticated fixture, not the Rust API/STDB runtime.
An installed Chromium can be selected with `LUMIERE_CHROMIUM_PATH`.

## Read-only app integration

Inventory's category toolbar opens `/offline/categories/index.html?companyId=...`.
Run `pnpm --dir frontend/web build:offline` to emit the static client, module
worker, pinned WASM and scoped service worker. Web dev/build runs this first;
generated `public/offline/categories/` assets are ignored by git and are
included in app build-cache outputs. Deploy immutable hashed assets together and
retain old generations while their clients can still be open.

The reader uses `/api/offline/product-categories/*` through Next's configured
Rust rewrite or production Kong ingress. By default, every new reader must
discover a live server scope before opening private saved rows; a cold offline
launch asks for reconnection. Operators can explicitly enable signed, expiring
read leases with server signing configuration and build-pinned public keys.
Then a network outage can admit a cold reader to its existing scoped OPFS rows
until expiry. The grant never authenticates API requests or permits writes.
Sign-out/company transitions revoke active readers; actor/policy changes and
server denials override the lease on reconnect. Local browser time/storage are
not tamper resistant; encryption and an all-actor storage wipe remain separate.

See [app status and local gates](../../../docs/plan/offline-category-app-status.md).
See [grant configuration and limits](../../../docs/plan/offline-access-grant-status.md)
before enabling offline admission.
