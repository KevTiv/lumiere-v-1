import { openOpfsSqlite } from "./opfs-sqlite.ts";
import { ProjectionStore } from "./projection-store.ts";
import { SyncEngine } from "./sync-engine.ts";
import { checkedScope } from "./contracts.ts";
import {
  fromWireError,
  wireError,
  type BrowserReply,
  type BrowserRequest,
  type TransportRequest,
} from "./browser-protocol.ts";

let connection: Awaited<ReturnType<typeof openOpfsSqlite>> | undefined;
let store: ProjectionStore | undefined;
let engine: SyncEngine | undefined;
let port: MessagePort | undefined;
let initialized = false;
let closed = false;
let transportId = 0;
const active = new Map<number, AbortController>();
const transports = new Map<
  number,
  { resolve(value: unknown): void; reject(error: unknown): void }
>();

function transport(
  type: "snapshot" | "pull",
  cursor?: string,
  signal?: AbortSignal,
): Promise<unknown> {
  signal?.throwIfAborted();
  const id = ++transportId;
  return new Promise((resolve, reject) => {
    const abort = () => {
      transports.delete(id);
      port?.postMessage({ id, type: "cancel" } satisfies TransportRequest);
      reject(signal?.reason ?? new Error("Synchronization cancelled"));
    };
    transports.set(id, {
      resolve: (value) => {
        signal?.removeEventListener("abort", abort);
        resolve(value);
      },
      reject: (error) => {
        signal?.removeEventListener("abort", abort);
        reject(error);
      },
    });
    signal?.addEventListener("abort", abort, { once: true });
    port!.postMessage({ id, type, cursor } satisfies TransportRequest);
  });
}
function abortSync() {
  for (const controller of active.values())
    controller.abort(new Error("Projection handle closed or cleared"));
}

async function execute(request: BrowserRequest): Promise<unknown> {
  if (request.type === "cancel") {
    active.get(request.target)?.abort(new Error("Synchronization cancelled"));
    return;
  }
  if (request.type === "init") {
    if (initialized || closed)
      throw new Error("Browser projection already initialized");
    initialized = true;
    port = request.port;
    port.onmessage = ({ data }: MessageEvent<BrowserReply>) => {
      const pending = transports.get(data.id);
      if (!pending) return;
      transports.delete(data.id);
      if (data.ok) pending.resolve(data.value);
      else pending.reject(fromWireError(data.error));
    };
    const scope = checkedScope(request.scope);
    connection = await openOpfsSqlite(request);
    try {
      store = new ProjectionStore(connection, scope);
      engine = new SyncEngine(store, {
        snapshot: (_scope, signal) => transport("snapshot", undefined, signal),
        pull: (_scope, cursor, signal) => transport("pull", cursor, signal),
      });
      return scope;
    } catch (error) {
      await connection.close();
      throw error;
    }
  }
  if (!store || !engine || !connection || closed)
    throw new Error("Browser projection is not open");
  switch (request.type) {
    case "get":
      return store.repository.get(request.key);
    case "list":
      return store.repository.list(request.limit);
    case "checkpoint":
      return store.checkpoint();
    case "sync": {
      const controller = new AbortController();
      active.set(request.id, controller);
      try {
        return await engine.sync(controller.signal);
      } finally {
        active.delete(request.id);
      }
    }
    case "clear":
      abortSync();
      store.clear();
      return;
    case "close":
      closed = true;
      abortSync();
      await connection.close();
      port?.close();
      return;
  }
}

globalThis.onmessage = async ({ data }: MessageEvent<BrowserRequest>) => {
  try {
    globalThis.postMessage({
      id: data.id,
      ok: true,
      value: await execute(data),
    } satisfies BrowserReply);
  } catch (error) {
    globalThis.postMessage({
      id: data.id,
      ok: false,
      error: wireError(error),
    } satisfies BrowserReply);
  }
};
