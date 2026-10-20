import { build } from "esbuild";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  checkedGrantTrust,
  type OfflineGrantTrust,
} from "../src/offline-grant.ts";

/** Builds public, scope-free assets; the real session is resolved at runtime through /api. */
export async function buildCategoryApp(
  output = fileURLToPath(
    new URL("../../../web/public/offline/categories/", import.meta.url),
  ),
  configuredTrust: OfflineGrantTrust | null = process.env
    .LUMIERE_OFFLINE_GRANT_TRUST
    ? checkedGrantTrust(JSON.parse(process.env.LUMIERE_OFFLINE_GRANT_TRUST))
    : null,
) {
  const trust =
    configuredTrust === null ? null : checkedGrantTrust(configuredTrust);
  const source = fileURLToPath(
    new URL("../../../web/offline-categories/", import.meta.url),
  );
  const offline = fileURLToPath(new URL("../", import.meta.url));
  const prefix = "/offline/categories/";
  const hash = (content: Uint8Array | string) =>
    createHash("sha256").update(content).digest("hex").slice(0, 20);
  const assets: Record<string, Uint8Array | string> = {};
  const emit = (name: string, content: Uint8Array | string) => {
    const extension = path.extname(name);
    const filename = `${path.basename(name, extension)}-${hash(content)}${extension}`;
    assets[filename] = content;
    return prefix + filename;
  };
  const wasm = emit(
    "sqlite3.wasm",
    await readFile(
      fileURLToPath(
        import.meta.resolve("@sqlite.org/sqlite-wasm/sqlite3.wasm"),
      ),
    ),
  );
  const bundle = async (entry: string, define?: Record<string, string>) =>
    (
      await build({
        absWorkingDir: offline,
        entryPoints: [entry],
        bundle: true,
        format: "esm",
        platform: "browser",
        write: false,
        target: "es2022",
        minify: true,
        define,
      })
    ).outputFiles[0].contents;
  const worker = emit(
    "worker.js",
    await bundle(path.join(offline, "src/browser-worker.ts")),
  );
  const client = emit(
    "client.js",
    await bundle(path.join(source, "client.ts"), {
      __WORKER_URL__: JSON.stringify(worker),
      __WASM_URL__: JSON.stringify(wasm),
      __OFFLINE_GRANT_TRUST__: JSON.stringify(trust),
    }),
  );
  const style = emit(
    "style.css",
    await readFile(path.join(source, "style.css")),
  );
  const html = (await readFile(path.join(source, "index.html"), "utf8"))
    .replace("__CLIENT__", client)
    .replace("__STYLE__", style);
  const shell = emit("shell.html", html);
  const template = await readFile(
    path.join(source, "service-worker.js"),
    "utf8",
  );
  const urls = Object.keys(assets)
    .sort()
    .map((name) => prefix + name);
  const version = hash(JSON.stringify(urls) + template);
  const sw = template
    .replace("__ASSETS__", JSON.stringify(urls))
    .replace("__CACHE__", JSON.stringify(`lumiere-category-shell-${version}`))
    .replace('"/offline/categories/index.html"', JSON.stringify(shell));
  await mkdir(output, { recursive: true });
  // Keep immutable old versions in local output; deployed assets must retain old versions too.
  await Promise.all(
    Object.entries({ ...assets, "index.html": html, "sw.js": sw }).map(
      ([name, bytes]) => writeFile(path.join(output, name), bytes),
    ),
  );
  return { output, version, urls, worker, wasm, client, shell };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const result = await buildCategoryApp();
  console.log(
    `Built category reader ${result.version} (${result.urls.length} public assets)`,
  );
}
