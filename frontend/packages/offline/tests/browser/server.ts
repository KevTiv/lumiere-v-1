import { build } from "esbuild";
import { createServer } from "node:http";
import { readFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildCategoryApp } from "../../scripts/build-category-app.ts";
import { fileURLToPath } from "node:url";
import { scope, snapshot, pull } from "./fixture.ts";
import { projectionSchemaHash } from "../../src/generated/product-category.ts";
import { grantFixture } from "../grant-fixture.ts";

const outputs = new Map<string, Uint8Array>();
const app = await buildCategoryApp(
  await mkdtemp(path.join(tmpdir(), "lumiere-category-app-")),
  null,
);
const signer = await grantFixture();
const grantedApp = await buildCategoryApp(
  await mkdtemp(path.join(tmpdir(), "lumiere-granted-app-")),
  signer.trust,
);
for (const [url, entry] of [
  ["/client.js", "tests/browser/client.ts"],
  ["/browser-worker.js", "src/browser-worker.ts"],
  ["/probe-worker.js", "tests/browser/probe-worker.ts"],
  ["/offline-lifecycle.js", "../../web/lib/offline-lifecycle.ts"],
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
let actor = "actor-a";
let swGeneration = "initial";
let missingAsset = false;
let grantsEnabled = false;
let grantTtl = 3600;
let grantStatus = 200;
const waiting = new Set<() => void>();
const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1:4179");
  response.setHeader("Cache-Control", "no-store");
  if (url.pathname === "/fixture/grants") {
    grantsEnabled = url.searchParams.get("enabled") === "true";
    grantTtl = Number(url.searchParams.get("ttl") ?? 3600);
    grantStatus = Number(url.searchParams.get("status") ?? 200);
    response.end("ok");
    return;
  }
  const activeApp = grantsEnabled ? grantedApp : app;
  if (url.pathname === "/fixture/sw-generation") {
    swGeneration = url.searchParams.get("value") ?? "initial";
    response.end("ok");
    return;
  }
  if (url.pathname === "/fixture/missing-asset") {
    missingAsset = url.searchParams.get("value") === "true";
    response.end("ok");
    return;
  }
  if (url.pathname === "/fixture/app") {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(activeApp));
    return;
  }
  if (url.pathname === "/fixture/actor") {
    actor = url.searchParams.get("value") ?? "actor-a";
    response.end("ok");
    return;
  }
  if (url.pathname.startsWith("/offline/categories/")) {
    const name =
      url.pathname.slice("/offline/categories/".length) || "index.html";
    if (name.includes("/") || name.includes("..")) {
      response.writeHead(404);
      response.end();
      return;
    }
    if (missingAsset && name.endsWith(".wasm")) {
      response.writeHead(404);
      response.end();
      return;
    }
    try {
      let bytes = await readFile(path.join(activeApp.output, name)).catch(() =>
        readFile(path.join((grantsEnabled ? app : grantedApp).output, name)),
      );
      if (name === "sw.js" && swGeneration !== "initial")
        bytes = Buffer.from(
          bytes
            .toString()
            .replace(
              `lumiere-category-shell-${activeApp.version}`,
              `lumiere-category-shell-${activeApp.version}-${swGeneration}`,
            ),
        );
      response.setHeader(
        "Content-Type",
        name.endsWith(".wasm")
          ? "application/wasm"
          : name.endsWith(".js")
            ? "text/javascript"
            : name.endsWith(".css")
              ? "text/css"
              : "text/html",
      );
      response.end(bytes);
    } catch {
      response.writeHead(404);
      response.end();
    }
    return;
  }
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
  if (
    url.pathname.startsWith("/v1/") ||
    url.pathname.startsWith("/api/offline/")
  ) {
    const isApp = url.pathname.startsWith("/api/");
    const authorized = isApp
      ? request.headers.cookie?.includes("stdb_token=current")
      : request.headers.authorization === "Bearer current";
    response.setHeader("Content-Type", "application/json");
    if (
      !authorized ||
      status !== 200 ||
      (isApp && url.searchParams.get("companyId") !== "9")
    ) {
      response.writeHead(!authorized ? 401 : status !== 200 ? status : 403);
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
    const currentScope = isApp ? { ...scope, actorId: actor } : scope;
    if (url.pathname.endsWith("/grant")) {
      if (!grantsEnabled || grantStatus !== 200) {
        response.writeHead(grantsEnabled ? grantStatus : 404);
        response.end("{}");
        return;
      }
      if (
        url.searchParams.get("authorizationVersion") !==
        currentScope.authorizationVersion
      ) {
        response.writeHead(409);
        response.end("{}");
        return;
      }
      const issuedAt = Math.floor(Date.now() / 1000);
      response.end(
        JSON.stringify(
          await signer.sign({
            ...signer.claims,
            audience: "http://127.0.0.1:4179",
            scope: currentScope,
            issuedAt,
            expiresAt: issuedAt + grantTtl,
          }),
        ),
      );
      return;
    }
    const result = url.pathname.endsWith("/scope")
      ? { scope: currentScope, schemaHash: projectionSchemaHash }
      : url.pathname.endsWith("/snapshot")
        ? { ...snapshot, scope: currentScope }
        : {
            ...pull,
            scope: currentScope,
            ...(url.searchParams.get("cursor") === "11"
              ? { fromCursor: "11", changes: [] }
              : {}),
          };
    response.end(JSON.stringify(result));
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
