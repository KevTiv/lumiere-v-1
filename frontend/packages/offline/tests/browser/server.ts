import { build } from "esbuild";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { scope, snapshot, pull } from "./fixture.ts";
import { projectionSchemaHash } from "../../src/generated/product-category.ts";

const outputs = new Map<string, Uint8Array>();
for (const [url, entry] of [
  ["/client.js", "tests/browser/client.ts"],
  ["/browser-worker.js", "src/browser-worker.ts"],
  ["/probe-worker.js", "tests/browser/probe-worker.ts"],
]) {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    format: "esm",
    platform: "browser",
    write: false,
    target: "es2022",
  });
  outputs.set(url, result.outputFiles[0].contents);
}
const wasm = await readFile(
  fileURLToPath(import.meta.resolve("@sqlite.org/sqlite-wasm/sqlite3.wasm")),
);
let status = 200;
let delay = false;
const waiting = new Set<() => void>();
const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1:4179");
  response.setHeader("Cache-Control", "no-store");
  if (url.pathname === "/fixture/status") {
    status = Number(url.searchParams.get("value"));
    response.end("ok");
    return;
  }
  if (url.pathname === "/fixture/delay") {
    delay = url.searchParams.get("value") === "true";
    if (!delay) {
      for (const resolve of waiting) resolve();
      waiting.clear();
    }
    response.end("ok");
    return;
  }
  if (url.pathname.startsWith("/v1/")) {
    response.setHeader("Content-Type", "application/json");
    if (request.headers.authorization !== "Bearer current" || status !== 200) {
      response.writeHead(
        request.headers.authorization !== "Bearer current" ? 401 : status,
      );
      response.end("{}");
      return;
    }
    if (delay && !url.pathname.endsWith("/scope"))
      await new Promise<void>((resolve) => {
        waiting.add(resolve);
        response.on("close", () => {
          waiting.delete(resolve);
          resolve();
        });
      });
    response.end(
      JSON.stringify(
        url.pathname.endsWith("/scope")
          ? { scope, schemaHash: projectionSchemaHash }
          : url.pathname.endsWith("/snapshot")
            ? snapshot
            : pull,
      ),
    );
    return;
  }
  if (url.pathname === "/sqlite3.wasm") {
    response.setHeader("Content-Type", "application/wasm");
    response.end(wasm);
    return;
  }
  if (outputs.has(url.pathname)) {
    response.setHeader("Content-Type", "text/javascript");
    response.end(outputs.get(url.pathname));
    return;
  }
  if (url.pathname === "/missing.wasm") {
    response.writeHead(404);
    response.end();
    return;
  }
  response.setHeader("Content-Type", "text/html");
  response.end("<!doctype html><title>OPFS integration fixture</title>");
});
server.listen(4179, "127.0.0.1");
process.on("SIGTERM", () => {
  server.closeAllConnections();
  server.close();
});
