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

test("uploads reserve the declared purpose and use only the returned reservation", async () => {
  const previous = globalThis.fetch
  try {
    for (const purpose of [undefined, "branding", "expense_receipt"] as const) {
      const calls: { url: string; init?: RequestInit }[] = []
      const objectKey = "org-7/default/0123456789abcdef0123456789abcdef"
      const url = "/api/documents/blobs/object/7/default/0123456789abcdef0123456789abcdef"
      const uploadUrl = url.replace("/object/", "/upload/")
      let checksum = ""
      globalThis.fetch = async (input, init) => {
        calls.push({ url: String(input), init })
        if (calls.length === 1) {
          const reservation = JSON.parse(String(init?.body))
          assert.equal(reservation.purpose, purpose ?? "document")
          assert.equal(reservation.companyId, 3)
          assert.equal(reservation.createdBy, undefined)
          checksum = reservation.checksum
          return Response.json({ objectKey, uploadUrl, publicUrl: url })
        }
        if (calls.length === 2) {
          assert.equal(String(input), uploadUrl)
          assert.equal(init?.method, "PUT")
          return new Response(null, { status: 204 })
        }
        assert.equal(String(input), "/api/documents/blobs/complete")
        assert.deepEqual(JSON.parse(String(init?.body)), { objectKey, checksum })
        return Response.json({ url, objectKey, fileSize: 7, checksum, mimetype: "image/png", fileName: "logo.png" })
      }
      const result = await uploadDocumentBlob({
        file: new File(["content"], "logo.png", { type: "image/png" }),
        companyId: 3n,
        purpose,
      })
      assert.equal(calls.length, 3)
      assert.equal(result.fileSize, 7n)
      assert.equal(result.url, url)
    }
  } finally {
    globalThis.fetch = previous
  }
})

test("a revoked upload is reported without completing or returning a document", async () => {
  const previous = globalThis.fetch
  let calls = 0
  globalThis.fetch = async () => {
    calls++
    if (calls === 1) {
      return Response.json({ objectKey: "reserved-key", uploadUrl: "/api/documents/blobs/upload/reserved", publicUrl: "/api/documents/blobs/object/reserved" })
    }
    return Response.json({ error: "permission denied for this upload purpose" }, { status: 403 })
  }
  try {
    await assert.rejects(
      uploadDocumentBlob({ file: new File(["receipt"], "receipt.pdf"), companyId: 3n, purpose: "expense_receipt" }),
      /permission denied/,
    )
    assert.equal(calls, 2)
  } finally {
    globalThis.fetch = previous
  }
})

test("a completed submission retry verifies its same blob without uploading bytes again", async () => {
  const previous = globalThis.fetch
  const calls: string[] = []
  try {
    let checksum = ""
    globalThis.fetch = async (input, init) => {
      calls.push(String(input))
      const body = JSON.parse(String(init?.body))
      if (calls.length === 1) {
        assert.equal(body.submissionId, "a".repeat(32))
        assert.deepEqual(body.registration, { name: "Farm" })
        checksum = body.checksum
        return Response.json({ objectKey: "same-blob", uploadUrl: "/do-not-upload", publicUrl: "/same-blob", completed: true })
      }
      assert.equal(String(input), "/api/documents/blobs/complete")
      return Response.json({ url: "/same-blob", objectKey: "same-blob", fileSize: 4, checksum, mimetype: "text/plain", fileName: "farm.txt" })
    }
    await uploadDocumentBlob({ file: new File(["farm"], "farm.txt", { type: "text/plain" }), companyId: 3n, submissionId: "a".repeat(32), registration: { name: "Farm" } })
    assert.equal(calls.length, 2)
  } finally { globalThis.fetch = previous }
})
