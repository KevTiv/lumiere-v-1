import assert from "node:assert/strict"
import test from "node:test"
import { uploadDocumentBlob } from "./document-blob-upload"

test("receipt uploads refuse an unsafe company scope before sending bytes", async () => {
  const previous = globalThis.fetch
  let calls = 0
  globalThis.fetch = async () => {
    calls++
    throw new Error("Unexpected fetch")
  }
  try {
    for (const companyId of [9007199254740993n, 0n, -1n]) {
      await assert.rejects(
        uploadDocumentBlob({
          file: new File(["receipt"], "receipt.pdf"),
          companyId,
        }),
        /represented safely/,
      )
    }
    assert.equal(calls, 0)
  } finally {
    globalThis.fetch = previous
  }
})
