import assert from "node:assert/strict"
import test from "node:test"
import { readChatAttachments, readStoredChatAttachmentNames } from "./ai-chat-attachments"

test("reads selected UTF-8 files in order without transforming their contents", async () => {
  const files = [new File(["éggs\n42"], "counts.txt"), new File(["# Notes"], "notes.md")]
  assert.deepEqual(await readChatAttachments(files), [
    { name: "counts.txt", text: "éggs\n42" }, { name: "notes.md", text: "# Notes" },
  ])
  assert.deepEqual(await readChatAttachments(), [])
})

test("rejects oversized files and excess selections before reading any file", async () => {
  let reads = 0
  const file = { name: "a.txt", size: 4097, arrayBuffer: async () => { reads++; return new ArrayBuffer(0) } } as File
  await assert.rejects(readChatAttachments([file]), /up to 4 KB/)
  await assert.rejects(readChatAttachments(Array.from({ length: 4 }, () => ({ ...file, size: 1 }) as File)), /up to 3/)
  assert.equal(reads, 0)
})

test("read errors, malformed UTF-8, whitespace and NUL contents fail instead of silently dropping files", async () => {
  for (const file of [
    new File([Uint8Array.of(0xc3, 0x28)], "bad.txt"),
    new File([" \n"], "empty.txt"),
    new File(["a\0b"], "binary.txt"),
    Object.assign(new File(["x"], "lost.txt"), { arrayBuffer: async () => { throw new Error("read failed") } }),
  ]) {
    await assert.rejects(readChatAttachments([new File(["valid"], "valid.txt"), file]), /Could not read/)
  }
})

test("history restores only bounded valid display names, never attachment bodies", () => {
  assert.deepEqual(readStoredChatAttachmentNames(JSON.stringify({
    attachmentNames: ["counts.txt", 42, "../bad.txt", "notes.md", "a.tsv", "extra.txt"],
    attachments: [{ name: "counts.txt", text: "private contents" }],
  })), ["counts.txt", "notes.md", "a.tsv"])
  for (const metadata of [null, undefined, "", "{", "null", '{"attachmentNames":"a.txt"}']) {
    assert.equal(readStoredChatAttachmentNames(metadata), undefined)
  }
})
