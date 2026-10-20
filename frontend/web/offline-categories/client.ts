import {
  openBrowserCategoryProjection,
  type BrowserCategoryProjection,
} from "../../packages/offline/src/browser.ts";
import {
  connectCategoryTransport,
  ProjectionResetError,
} from "../../packages/offline/src/http-transport.ts";
import type { ProductCategory } from "../../packages/offline/src/generated/product-category.ts";
import {
  watchOfflineRevocation,
  OFFLINE_REVOCATION_KEY,
} from "../lib/offline-lifecycle.ts";

declare const __WORKER_URL__: string;
declare const __WASM_URL__: string;
const status = document.querySelector<HTMLParagraphElement>("#status")!;
const cacheStatus =
  document.querySelector<HTMLParagraphElement>("#cache-status")!;
const search = document.querySelector<HTMLInputElement>("#search")!;
const refresh = document.querySelector<HTMLButtonElement>("#refresh")!;
const clear = document.querySelector<HTMLButtonElement>("#clear")!;
const table = document.querySelector<HTMLTableElement>("#table")!;
const body = document.querySelector<HTMLTableSectionElement>("#rows")!;
const count = document.querySelector<HTMLParagraphElement>("#count")!;
const scopeLabel = document.querySelector<HTMLParagraphElement>("#scope")!;
let projection: BrowserCategoryProjection | undefined;
let rows: ProductCategory[] = [];
let generation = 0;
let busy = false;
let closing = Promise.resolve();
let active: AbortController | undefined;
function marker() {
  try {
    return localStorage.getItem(OFFLINE_REVOCATION_KEY);
  } catch {
    return null;
  }
}
let admittedMarker = marker();

function render() {
  body.replaceChildren();
  const visible = rows.filter((row) =>
    row.name.toLocaleLowerCase().includes(search.value.toLocaleLowerCase()),
  );
  for (const row of visible) {
    const tr = document.createElement("tr");
    for (const value of [
      row.name,
      row.id,
      row.parent_id ?? "—",
      String(row.sequence),
    ]) {
      const td = document.createElement("td");
      td.textContent = value;
      tr.append(td);
    }
    body.append(tr);
  }
  table.hidden = !projection;
  search.disabled = clear.disabled = !projection;
  count.textContent = projection
    ? `${visible.length} shown${rows.length === 200 ? " · limited to the first 200 saved categories" : ""}`
    : "";
}

/** Hide first, cancel in-flight replies, then clear/close only the scoped projection. */
function invalidate(message: string, erase = true) {
  generation++;
  active?.abort();
  const old = projection;
  projection = undefined;
  rows = [];
  scopeLabel.textContent = "";
  render();
  status.textContent = message;
  if (old)
    closing = closing
      .then(async () => {
        try {
          if (erase) await old.clear();
        } finally {
          await old.close();
        }
      })
      .catch(() => {
        status.textContent =
          "Saved storage could not be cleared. Reconnect before reopening.";
      });
}

async function refreshRows(expected: number) {
  const current = projection;
  if (!current) return;
  const saved = await current.repository.list(200);
  if (generation !== expected || projection !== current) return;
  rows = saved;
  render();
}

async function connect() {
  if (busy) return;
  busy = true;
  refresh.disabled = true;
  const expected = generation;
  active = new AbortController();
  const signal = active.signal;
  let synchronizing = false;
  status.textContent = "Verifying your session…";
  try {
    await closing;
    // A URL company is selection intent only. The server supplies the entire trusted scope.
    const companyId =
      new URL(location.href).searchParams.get("companyId") ?? undefined;
    const connection = await connectCategoryTransport(
      { apiUrl: new URL("/api", location.origin).href, companyId },
      signal,
    );
    if (generation !== expected) return;
    if (
      projection &&
      JSON.stringify(projection.scope) !== JSON.stringify(connection.scope)
    ) {
      invalidate("Your session or company changed. Reconnect to continue.");
      return;
    }
    if (!projection) {
      const opened = await openBrowserCategoryProjection({
        ...connection,
        wasmUrl: __WASM_URL__,
        workerUrl: new URL(__WORKER_URL__, location.origin),
      });
      if (generation !== expected) {
        try {
          await opened.clear();
        } finally {
          await opened.close();
        }
        return;
      }
      projection = opened;
      admittedMarker = marker();
      scopeLabel.textContent = `Organization ${opened.scope.organizationId} · Company ${opened.scope.companyId ?? "all authorized companies"}`;
      // Only after live admission may private cached rows be rendered.
      await refreshRows(expected);
    }
    let result;
    // Bound a refresh to 20 pages; never spin indefinitely on a busy changefeed.
    for (let page = 0; page < 20; page++) {
      if (generation !== expected || !projection) return;
      synchronizing = true;
      result = await projection.sync(signal);
      synchronizing = false;
      if (!result.hasMore) break;
    }
    await refreshRows(expected);
    if (generation === expected)
      status.textContent = result?.hasMore
        ? "More changes are available. Refresh to continue."
        : "Saved categories are up to date.";
  } catch (error) {
    if (generation !== expected) return;
    if (error instanceof ProjectionResetError) {
      // SyncEngine has already cleared its scope before returning an access reset.
      invalidate(
        "Access changed. Reconnect to verify your session.",
        !synchronizing,
      );
    } else if (projection) {
      status.textContent =
        "Connection unavailable. Showing saved categories from this verified session.";
    } else {
      status.textContent = navigator.onLine
        ? "Unable to open saved categories. Check your access and browser storage, then reconnect."
        : "Reconnect to verify your session before viewing saved categories.";
    }
  } finally {
    busy = false;
    refresh.disabled = false;
    active = undefined;
  }
}

watchOfflineRevocation(() =>
  invalidate("Session or company changed. Reconnect to verify your access."),
);
search.addEventListener("input", render);
refresh.addEventListener("click", () => void connect());
clear.addEventListener("click", () =>
  invalidate("Saved categories cleared. Reconnect to download them again."),
);
window.addEventListener("online", () => void connect());
window.addEventListener("offline", () => {
  if (projection)
    status.textContent =
      "Offline. Showing saved categories from this verified session.";
});
window.addEventListener("focus", () => {
  if (marker() !== admittedMarker)
    invalidate("Session changed. Reconnect to verify your access.");
  else if (navigator.onLine) void connect();
});
window.addEventListener("pagehide", () =>
  invalidate("Reconnect to verify your session.", false),
);
window.addEventListener("pageshow", (event) => {
  if (event.persisted) void connect();
});
setInterval(() => {
  if (navigator.onLine && !document.hidden && projection) void connect();
}, 60_000);

async function prepareOfflineShell() {
  if (!("serviceWorker" in navigator)) {
    cacheStatus.textContent = "Offline startup is unavailable in this browser.";
    return;
  }
  try {
    const registration = await navigator.serviceWorker.register(
      "/offline/categories/sw.js",
      { scope: "/offline/categories/", updateViaCache: "none" },
    );
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const ready = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Offline install timed out")),
          10_000,
        );
      }),
    ]).finally(() => clearTimeout(timeout));
    cacheStatus.textContent = ready.active
      ? "Offline startup ready. A new session needs a connection to verify access."
      : "Preparing offline startup…";
    if (registration.waiting)
      cacheStatus.textContent =
        "An update is ready. Close category tabs and reopen to install it.";
    registration.addEventListener("updatefound", () => {
      registration.installing?.addEventListener("statechange", () => {
        if (registration.waiting)
          cacheStatus.textContent =
            "An update is ready. Close category tabs and reopen to install it.";
      });
    });
  } catch {
    cacheStatus.textContent =
      "Offline startup is unavailable. Reconnect to prepare it.";
  }
}
void prepareOfflineShell();
void connect();
