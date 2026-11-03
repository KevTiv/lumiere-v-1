import assert from "node:assert/strict"
import test from "node:test"
import { parseImportJsonBody } from "./_body"

test("decodes a bounded object without dropping fields before inspection", async () => {
  const result = await parseImportJsonBody(
    new Request("https://example.invalid", {
      method: "POST",
      body: '{"headers":["name"],"rows":[["Acme"]]}',
    }),
  )
  assert.equal(result.ok, true)
  if (result.ok) assert.deepEqual(result.body.rows, [["Acme"]])
})

test("rejects oversized actual bytes even with missing or dishonest content-length", async () => {
  for (const headers of [{}, { "content-length": "1" }] as Record<
    string,
    string
  >[]) {
    const result = await parseImportJsonBody(
      new Request("https://example.invalid", {
        method: "POST",
        headers,
        body: '"' + "a".repeat(5_000_000) + '"',
      }),
    )
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.response.status, 413)
  }
})

test("rejects non-object, malformed JSON and invalid UTF8", async () => {
  for (const body of ["[]", "null", "{bad", new Uint8Array([0xff])]) {
    const result = await parseImportJsonBody(
      new Request("https://example.invalid", { method: "POST", body }),
    )
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.response.status, 400)
  }
})
