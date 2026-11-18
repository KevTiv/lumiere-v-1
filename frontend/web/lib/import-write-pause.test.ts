import assert from "node:assert/strict"
import test from "node:test"
import { ImportsPausedError, importsPausedFrom } from "./import-write-pause"

const reply = (status: number, body: unknown) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
  })

test("a paused deployment or writer mismatch is recognised from its machine code", async () => {
  for (const code of ["imports_paused", "import_writer_schema_mismatch"]) {
    const paused = await importsPausedFrom(
      reply(503, { error: "Imports are paused for an update", code }),
    )
    assert.ok(paused instanceof ImportsPausedError)
    assert.equal(paused.code, code)
    assert.equal(paused.message, "Imports are paused for an update")
  }
})

test("other failures keep their generic handling", async () => {
  assert.equal(await importsPausedFrom(reply(503, { error: "down" })), null)
  assert.equal(
    await importsPausedFrom(reply(503, { error: "x", code: "other" })),
    null,
  )
  assert.equal(
    await importsPausedFrom(reply(409, { code: "imports_paused" })),
    null,
  )
  assert.equal(await importsPausedFrom(reply(503, "<html>bad gateway")), null)
})

test("the response body stays readable for the caller", async () => {
  const response = reply(503, { code: "imports_paused" })
  await importsPausedFrom(response)
  assert.deepEqual(await response.json(), { code: "imports_paused" })
})
