import { act, cleanup, renderHook, waitFor } from "@testing-library/react"
import { StrictMode, type ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useDocumentUploadReceipts } from "../../../../web/lib/use-document-upload-receipts"

const pointer = { submissionId: "a".repeat(32), fileName: "farm.csv", checksum: "b".repeat(64), requestHash: "c".repeat(64) }
const receipt = {
  ...pointer, objectKey: `org-7/default/${"d".repeat(32)}`, url: `/api/documents/blobs/object/7/default/${"d".repeat(32)}`,
  fileSize: "42", mimetype: "text/csv", fileSaved: true, bytesUploaded: true,
  registration: { name: "Farm source", tagIds: [], isFavorite: false }, registrationState: "unconfirmed", documentId: null, indexing: "pending",
}
delete (receipt as { requestHash?: string }).requestHash

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

beforeEach(() => localStorage.clear())
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe("document upload receipt scope lifetime", () => {
  it.each(["unmount", "company roundtrip", "permission roundtrip"])("does not register or index after %s", async (change) => {
    const read = deferred<Response>()
    const fetch = vi.fn().mockReturnValue(read.promise)
    vi.stubGlobal("fetch", fetch)
    const create = vi.fn().mockResolvedValue({ resource: "documents", id: "99" })
    const index = vi.fn()
    const view = renderHook(({ companyId, allowed }) => useDocumentUploadReceipts({
      scope: { organizationId: 7n, companyId, actorId: "actor" }, allowed,
      assertCurrent: () => undefined, create, index,
    }), { initialProps: { companyId: 3n, allowed: true }, wrapper: ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode> })
    let result!: Promise<unknown>
    act(() => { result = view.result.current.resume(pointer).catch((error: unknown) => error) })
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    if (change === "unmount") view.unmount()
    else if (change === "company roundtrip") {
      view.rerender({ companyId: 4n, allowed: true })
      view.rerender({ companyId: 3n, allowed: true })
    } else {
      view.rerender({ companyId: 3n, allowed: false })
      view.rerender({ companyId: 3n, allowed: true })
    }
    await act(async () => { read.resolve(Response.json(receipt)); await result })
    expect(await result).toBeInstanceOf(Error)
    expect(create).not.toHaveBeenCalled()
    expect(index).not.toHaveBeenCalled()
  })
})
