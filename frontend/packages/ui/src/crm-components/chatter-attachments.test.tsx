import { describe, expect, it, vi } from "vitest"

vi.mock("@lumiere/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

import {
  addAttachmentFiles,
  allAttachmentsDone,
  attachmentDocumentIds,
  itemsForFiles,
  removeAttachment,
  uploadPendingAttachments,
} from "./chatter-attachments"

const file = (name: string, size = 3) => new File(["x".repeat(size)], name, { lastModified: 1 })
const host = { resModel: "lead", resId: 5n }

describe("chatter attachment helpers", () => {
  it("adds files once and removes by key", () => {
    const a = file("a.txt")
    const items = addAttachmentFiles(addAttachmentFiles([], [a]), [a, file("b.txt")])
    expect(items.map((i) => i.file.name)).toEqual(["a.txt", "b.txt"])
    expect(removeAttachment(items, items[0].key).map((i) => i.file.name)).toEqual(["b.txt"])
  })

  it("uploads in order, keeps failures as errors and skips done items on retry", async () => {
    const upload = vi
      .fn<(f: File) => Promise<bigint>>()
      .mockResolvedValueOnce(11n)
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(13n)
      .mockResolvedValueOnce(12n)
    const seen: string[] = []
    const first = await uploadPendingAttachments(
      addAttachmentFiles([], [file("a"), file("b"), file("c")]),
      upload,
      host,
      (items) => seen.push(items.map((i) => i.status).join(",")),
    )
    expect(first.map((i) => i.status)).toEqual(["done", "error", "done"])
    expect(first[1].error).toBe("boom")
    expect(allAttachmentsDone(first)).toBe(false)
    expect(attachmentDocumentIds(first)).toEqual([11n, 13n])
    expect(seen[0]).toBe("uploading,queued,queued")

    const retry = await uploadPendingAttachments(first, upload, host, () => undefined)
    expect(upload).toHaveBeenCalledTimes(4)
    expect(attachmentDocumentIds(retry)).toEqual([11n, 12n, 13n])
  })

  it("carries uploaded results over to a retried selection", () => {
    const [done] = addAttachmentFiles([], [file("a")])
    const next = itemsForFiles([file("a"), file("b")], [{ ...done, status: "done", documentId: 9n }])
    expect(next.map((i) => i.status)).toEqual(["done", "queued"])
  })
})
