import {
  openBrowserCategoryProjection,
  type BrowserCategoryProjection,
} from "../../src/browser.ts";
import { connectCategoryTransport } from "../../src/http-transport.ts";
import type {
  ProjectionScope,
  ProjectionTransport,
} from "../../src/contracts.ts";
import { scope } from "./fixture.ts";

export let projection: BrowserCategoryProjection;
export let credential = "Bearer current";
export function expireCredential() {
  credential = "Bearer expired";
}
export let outcome: Promise<string> | undefined;
let controller: AbortController;
export function startSync() {
  controller = new AbortController();
  outcome = projection.sync(controller.signal).then(
    () => "success",
    (error: Error) => error.message,
  );
}
export function abortSync() {
  controller.abort();
}
const transport: ProjectionTransport = {
  snapshot: async (scope, signal) =>
    (await connect(signal)).transport.snapshot(scope, signal),
  pull: async (scope, cursor, signal) =>
    (await connect(signal)).transport.pull(scope, cursor, signal),
};
function connect(signal?: AbortSignal) {
  return connectCategoryTransport(
    {
      apiUrl: new URL("/v1", location.href).href,
      headers: () => ({ Authorization: credential }),
    },
    signal,
  );
}
export async function open(
  overrides: Partial<ProjectionScope> = {},
  options: { wasmUrl?: string; filename?: string } = {},
) {
  projection = await openBrowserCategoryProjection({
    scope: { ...scope, ...overrides },
    transport,
    wasmUrl: options.wasmUrl ?? "/sqlite3.wasm",
    workerUrl: new URL("/browser-worker.js", location.href),
    filename: options.filename,
  });
}
export async function probe(operation: string): Promise<unknown> {
  const worker = new Worker("/probe-worker.js", { type: "module" });
  try {
    return await new Promise((resolve, reject) => {
      worker.onmessage = ({ data }) =>
        data.ok ? resolve(data.value) : reject(new Error(data.error));
      worker.onerror = () => reject(new Error("Probe worker failed"));
      worker.postMessage({ operation });
    });
  } finally {
    worker.terminate();
  }
}
