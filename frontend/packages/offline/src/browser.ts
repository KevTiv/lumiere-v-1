import {
  checkedScope,
  type ProjectionScope,
  type ProjectionTransport,
} from "./contracts.ts";
import type { CategoryRepository } from "./projection-store.ts";
import type { SyncResult } from "./sync-engine.ts";
import {
  fromWireError,
  wireError,
  type BrowserCommand,
  type BrowserReply,
  type TransportRequest,
} from "./browser-protocol.ts";

export interface BrowserProjectionOptions {
  scope: ProjectionScope;
  transport: ProjectionTransport;
  /** Same-origin asset copied from @sqlite.org/sqlite-wasm/sqlite3.wasm. */
  wasmUrl: string | URL;
  filename?: string;
  /** Override when the application emits the worker as a separate asset. */
  workerUrl?: URL;
  onApplied?: (resource: string) => void;
}
export interface BrowserCategoryProjection {
  readonly scope: Readonly<ProjectionScope>;
  readonly repository: CategoryRepository;
  checkpoint(): Promise<string | null>;
  sync(signal?: AbortSignal): Promise<SyncResult>;
  clear(): Promise<void>;
  close(): Promise<void>;
}

/** The UI receives repository reads; the worker exclusively owns storage and sync writes. */
export async function openBrowserCategoryProjection(
  options: BrowserProjectionOptions,
): Promise<BrowserCategoryProjection> {
  if (
    !globalThis.isSecureContext ||
    !navigator.storage?.getDirectory ||
    !navigator.locks ||
    typeof Worker === "undefined"
  )
    throw new Error("Persistent browser projection is unavailable");
  const scope = checkedScope(options.scope);
  const wasmUrl = new URL(options.wasmUrl, location.href);
  const workerUrl =
    options.workerUrl ?? new URL("./browser-worker.ts", import.meta.url);
  if (
    wasmUrl.origin !== location.origin ||
    workerUrl.origin !== location.origin
  )
    throw new Error("Browser projection assets must be hosted on this origin");
  const worker = options.workerUrl
    ? new Worker(options.workerUrl, { type: "module" })
    : new Worker(new URL("./browser-worker.ts", import.meta.url), {
        type: "module",
      });
  const channel = new MessageChannel();
  const pending = new Map<
    number,
    { resolve(value: unknown): void; reject(error: unknown): void }
  >();
  const requests = new Map<number, AbortController>();
  let nextId = 0;
  let invalidated = false;
  let closing = false;
  let stopped = false;
  let activeSync: Promise<SyncResult> | undefined;
  let closePromise: Promise<void> | undefined;
  function usable() {
    if (invalidated || closing || stopped)
      throw new Error(
        "Browser projection handle was closed or cleared; reauthenticate before reopening",
      );
  }
  function stop(error = new Error("Browser projection closed")) {
    if (stopped) return;
    stopped = true;
    for (const controller of requests.values()) controller.abort(error);
    requests.clear();
    for (const callback of pending.values()) callback.reject(error);
    pending.clear();
    channel.port1.close();
    worker.terminate();
  }
  function call<T>(
    command: BrowserCommand,
    transfer: Transferable[] = [],
    signal?: AbortSignal,
  ): Promise<T> {
    if (stopped) return Promise.reject(new Error("Browser projection closed"));
    signal?.throwIfAborted();
    const id = ++nextId;
    return new Promise<T>((resolve, reject) => {
      const abort = () =>
        worker.postMessage({ id: ++nextId, type: "cancel", target: id });
      signal?.addEventListener("abort", abort, { once: true });
      pending.set(id, {
        resolve: (value) => {
          signal?.removeEventListener("abort", abort);
          resolve(value as T);
        },
        reject: (error) => {
          signal?.removeEventListener("abort", abort);
          reject(error);
        },
      });
      try {
        worker.postMessage({ ...command, id }, transfer);
      } catch (error) {
        pending.delete(id);
        signal?.removeEventListener("abort", abort);
        reject(error);
      }
    });
  }
  worker.onmessage = ({ data }: MessageEvent<BrowserReply>) => {
    const callback = pending.get(data.id);
    if (!callback) return;
    pending.delete(data.id);
    if (data.ok) callback.resolve(data.value);
    else {
      if ([401, 403, 409, 410].includes(data.error.status ?? 0))
        invalidated = true;
      callback.reject(fromWireError(data.error));
    }
  };
  worker.onerror = () => stop(new Error("Browser projection worker failed"));
  worker.onmessageerror = () =>
    stop(new Error("Browser projection worker message failed"));
  channel.port1.onmessage = (async ({
    data,
  }: MessageEvent<TransportRequest>) => {
    if (data.type === "cancel") {
      requests.get(data.id)?.abort(new Error("Synchronization cancelled"));
      return;
    }
    const controller = new AbortController();
    requests.set(data.id, controller);
    try {
      const value = await (data.type === "snapshot"
        ? options.transport.snapshot(scope, controller.signal)
        : options.transport.pull(scope, data.cursor!, controller.signal));
      channel.port1.postMessage({
        id: data.id,
        ok: true,
        value,
      } satisfies BrowserReply);
    } catch (error) {
      channel.port1.postMessage({
        id: data.id,
        ok: false,
        error: wireError(error),
      } satisfies BrowserReply);
    } finally {
      requests.delete(data.id);
    }
  }) as (event: MessageEvent<TransportRequest>) => void;
  const timeout = setTimeout(
    () => stop(new Error("Browser projection initialization timed out")),
    15_000,
  );
  try {
    await call(
      {
        type: "init",
        scope,
        wasmUrl: wasmUrl.href,
        filename: options.filename,
        port: channel.port2,
      },
      [channel.port2],
    );
  } catch (error) {
    stop();
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  const repository: CategoryRepository = Object.freeze({
    get: async (key: string) => {
      usable();
      const row = await call<Awaited<ReturnType<CategoryRepository["get"]>>>({
        type: "get",
        key,
      });
      usable();
      return row;
    },
    list: async (limit?: number) => {
      usable();
      const rows = await call<Awaited<ReturnType<CategoryRepository["list"]>>>({
        type: "list",
        limit,
      });
      usable();
      return rows;
    },
  });
  return {
    scope,
    repository,
    checkpoint: async () => {
      usable();
      const cursor = await call<string | null>({ type: "checkpoint" });
      usable();
      return cursor;
    },
    sync: (signal) => {
      usable();
      if (!activeSync)
        activeSync = call<SyncResult>({ type: "sync" }, [], signal)
          .then((result) => {
            usable();
            try {
              options.onApplied?.("product-categories");
              return result;
            } catch (notificationError) {
              return { ...result, notificationError };
            }
          })
          .finally(() => {
            activeSync = undefined;
          });
      return activeSync;
    },
    clear: async () => {
      usable();
      invalidated = true;
      await call({ type: "clear" });
    },
    close: () => {
      if (!closePromise) {
        closing = true;
        closePromise = call<void>({ type: "close" }).finally(() => stop());
      }
      return closePromise;
    },
  };
}
