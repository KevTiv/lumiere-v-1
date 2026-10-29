import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import ts from "typescript"

import { emitBrowserOperationIds, updateBrowserOperationIds } from "./generate-browser-operation-ids.mjs"

const descriptor = (name, contractOperationId = `erp.${name}`) => ({
  name,
  contractOperationId,
  exposure: "session",
  serverContext: [{ source: "authenticated_session.organization_id" }],
})

test("generation sorts entries, retains immutable IDs, and excludes rich metadata", () => {
  const descriptors = {
    zebra: descriptor("zebra", "erp.original_zebra"),
    alpha: descriptor("alpha"),
  }
  const output = emitBrowserOperationIds(["zebra", "alpha"], descriptors)
  assert.equal(output, emitBrowserOperationIds(["alpha", "zebra"], descriptors))
  assert.match(output, /"zebra": "erp\.original_zebra"/)
  assert.ok(output.indexOf('"alpha":') < output.indexOf('"zebra":'))
  assert.doesNotMatch(output, /serverContext|authenticated_session|exposure/)
})

test("generation rejects mismatched allowlists and descriptors", () => {
  assert.throws(() => emitBrowserOperationIds(["alpha", "alpha"], {}), /unique/)
  assert.throws(() => emitBrowserOperationIds(["alpha"], {}), /match descriptor keys/)
  assert.throws(
    () => emitBrowserOperationIds([], { alpha: descriptor("alpha") }),
    /match descriptor keys/,
  )
  assert.throws(
    () => emitBrowserOperationIds(["alpha"], { alpha: { ...descriptor("alpha"), exposure: "denied" } }),
    /invalid session operation/,
  )
  assert.throws(
    () => emitBrowserOperationIds(["alpha"], { alpha: descriptor("other_name") }),
    /invalid session operation/,
  )
  assert.throws(
    () => emitBrowserOperationIds(["alpha", "beta"], {
      alpha: descriptor("alpha"), beta: descriptor("beta", "erp.alpha"),
    }),
    /duplicate contract operation ID/,
  )
})

test("unchanged generation preserves mtime and check mode never repairs drift", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "lumiere-browser-ids-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, "ids.ts")
  await writeFile(path, "current")
  const timestamp = new Date("2000-01-01T00:00:00Z")
  await utimes(path, timestamp, timestamp)
  const originalMtime = (await stat(path)).mtimeMs

  assert.equal(await updateBrowserOperationIds(path, "current"), false)
  assert.equal((await stat(path)).mtimeMs, originalMtime)
  assert.equal(await updateBrowserOperationIds(path, "current", { check: true }), false)
  await assert.rejects(updateBrowserOperationIds(path, "changed", { check: true }), /out of date/)
  assert.equal(await readFile(path, "utf8"), "current")
  assert.equal((await stat(path)).mtimeMs, originalMtime)
  assert.equal(await updateBrowserOperationIds(path, "changed"), true)
  assert.equal(await readFile(path, "utf8"), "changed")
  await assert.rejects(updateBrowserOperationIds(join(directory, "missing.ts"), "new", { check: true }), /out of date/)
})

test("generation propagates filesystem errors instead of treating them as missing output", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "lumiere-browser-ids-"))
  t.after(() => rm(directory, { recursive: true, force: true }))
  await assert.rejects(updateBrowserOperationIds(directory, "contents"), { code: "EISDIR" })
})

test("browser command JavaScript uses the compact map without importing rich descriptors", async () => {
  const commandSource = await readFile(
    new URL("../packages/stdb/src/commands/stdb-http.ts", import.meta.url),
    "utf8",
  )
  const emitJavaScript = (source) => ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const commandJavaScript = emitJavaScript(commandSource)
  assert.match(commandJavaScript, /from ["']\.\.\/generated\/browser-operation-ids["']/)
  assert.doesNotMatch(commandJavaScript, /operation-descriptors|SESSION_OPERATION_DESCRIPTORS/)
  const mapJavaScript = emitJavaScript(emitBrowserOperationIds(["alpha"], { alpha: descriptor("alpha") }))
  assert.doesNotMatch(mapJavaScript, /operation-descriptors|SESSION_OPERATION_DESCRIPTORS/)
})
