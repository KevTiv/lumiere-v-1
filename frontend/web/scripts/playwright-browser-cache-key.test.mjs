import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { cacheKey } from "./playwright-browser-cache-key.mjs"

function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "browser-cache-"))
  const write = (file, value) => {
    const target = path.join(root, file)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, JSON.stringify(value))
  }
  write("package.json", {})
  for (const name of ["@playwright/test", "playwright", "playwright-core"]) {
    write(`node_modules/${name}/package.json`, { name, version: "1.58.0" })
  }
  write("node_modules/playwright-core/browsers.json", {
    browsers: [{ name: "chromium", revision: "1200" }],
  })
  try { run(root, write) } finally { fs.rmSync(root, { recursive: true, force: true }) }
}

test("contract and unrelated dependency updates retain the browser cache", () => fixture((root, write) => {
  const key = cacheKey(root, "linux", "x64")
  write("pnpm-lock.yaml", { contracts: "new-version" })
  assert.equal(cacheKey(root, "linux", "x64"), key)
  assert.notEqual(cacheKey(root, "linux", "arm64"), key)
  assert.notEqual(cacheKey(root, "darwin", "x64"), key)
}))

test("browser revision and core package changes invalidate the cache", () => fixture((root, write) => {
  const original = cacheKey(root)
  write("node_modules/playwright-core/browsers.json", {
    browsers: [{ name: "chromium", revision: "1201" }],
  })
  const revised = cacheKey(root)
  assert.notEqual(revised, original)
  write("node_modules/playwright-core/package.json", { name: "playwright-core", version: "1.59.0" })
  assert.notEqual(cacheKey(root), revised)
}))

test("a missing Chromium revision cannot create a reusable key", () => fixture((root, write) => {
  write("node_modules/playwright-core/browsers.json", { browsers: [] })
  assert.throws(() => cacheKey(root), /revision is missing/)
}))
