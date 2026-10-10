import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

const post = vi.hoisted(() => vi.fn(async (_: unknown) => undefined))

vi.mock("@lumiere/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock("@lumiere/erp-session", () => ({ useErpSession: () => ({ identity: "abc" }) }))
vi.mock("@lumiere/erp-shared/stb-timestamp", () => ({ stbTimestampFromDate: () => 0 }))
vi.mock("@lumiere/stdb/browser-http", () => ({ stdbBrowserQuery: async () => [] }))
vi.mock("@lumiere/stdb/client-ui-bridge", () => ({
  subscribeToRecord: async () => undefined,
  unsubscribeFromRecord: async () => undefined,
}))
vi.mock("@lumiere/query-hooks/hooks/messages", () => ({ usePostMessage: () => ({ mutateAsync: post }) }))
vi.mock("@lumiere/query-hooks/hooks/crm", () => ({
  useCreateActivity: () => ({ mutateAsync: async () => undefined }),
  useCompleteActivity: () => ({ mutateAsync: async () => undefined }),
}))
vi.mock("@lumiere/query-hooks/hooks/crm-params-merge", () => ({ finalizeCreateActivityParams: (p: unknown) => p }))
vi.mock("@/components/ui/button", () => ({ Button: (p: object) => <button {...p} /> }))
vi.mock("@/components/ui/dialog", () => ({
  Dialog: () => null,
  DialogContent: () => null,
  DialogHeader: () => null,
  DialogTitle: () => null,
  DialogFooter: () => null,
}))
vi.mock("@/components/ui/textarea", () => ({ Textarea: (p: object) => <textarea {...p} /> }))
vi.mock("@/components/ui/input", () => ({ Input: (p: object) => <input {...p} /> }))
vi.mock("@/components/ui/label", () => ({ Label: (p: object) => <label {...p} /> }))
vi.mock("@/components/ui/badge", () => ({ Badge: (p: object) => <span {...p} /> }))
vi.mock("@/components/ui/select", () => ({
  Select: () => null,
  SelectContent: () => null,
  SelectItem: () => null,
  SelectTrigger: () => null,
  SelectValue: () => null,
}))
vi.mock("@/lib/utils", () => ({ cn: (...a: unknown[]) => a.filter(Boolean).join(" ") }))

import { CrmRecordChatter } from "./crm-record-chatter"
import { ChatterUploaderProvider } from "./chatter-attachments"

afterEach(() => {
  cleanup()
  post.mockClear()
})

const pick = (...files: File[]) =>
  fireEvent.change(screen.getByTestId("record-chatter-attach-input"), { target: { files } })

describe("CrmRecordChatter file attachments", () => {
  it("keeps the id text box when the app supplies no uploader", () => {
    render(<CrmRecordChatter organizationId={1} resModel="lead" resId={5n} />)
    expect(screen.queryByTestId("record-chatter-attach-input")).toBeNull()
  })

  it("uploads chosen files and posts the note with their document ids", async () => {
    const upload = vi.fn(async (f: File) => (f.name === "a.txt" ? 21n : 22n))
    render(
      <ChatterUploaderProvider value={() => upload}>
        <CrmRecordChatter organizationId={1} resModel="lead" resId={5n} />
      </ChatterUploaderProvider>,
    )
    fireEvent.change(screen.getByTestId("record-chatter-note"), { target: { value: "hello" } })
    pick(new File(["a"], "a.txt"), new File(["b"], "b.txt"))
    expect(screen.getAllByTestId("record-chatter-attachment-queued")).toHaveLength(2)
    fireEvent.click(screen.getAllByTestId("record-chatter-attachment-remove")[1])
    expect(screen.getAllByTestId("record-chatter-attachment-queued")).toHaveLength(1)
    pick(new File(["c"], "c.txt"))

    fireEvent.click(screen.getByTestId("record-chatter-post"))
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1))
    expect(upload).toHaveBeenCalledTimes(2)
    expect(post.mock.calls[0][0]).toMatchObject({
      model: "lead",
      resId: 5n,
      messageType: "comment",
      attachmentIds: [21n, 22n],
    })
    await waitFor(() => expect(screen.queryByTestId("record-chatter-attachment-done")).toBeNull())
  })

  it("does not post when a file fails and shows the error until it is removed", async () => {
    const upload = vi.fn(async () => {
      throw new Error("disk full")
    })
    render(
      <ChatterUploaderProvider value={() => upload}>
        <CrmRecordChatter organizationId={1} resModel="lead" resId={5n} />
      </ChatterUploaderProvider>,
    )
    fireEvent.change(screen.getByTestId("record-chatter-note"), { target: { value: "hello" } })
    pick(new File(["a"], "a.txt"))
    fireEvent.click(screen.getByTestId("record-chatter-post"))
    await waitFor(() => expect(screen.getByTestId("record-chatter-attachment-error")).toBeTruthy())
    expect(screen.getByText("disk full")).toBeTruthy()
    expect(post).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId("record-chatter-attachment-remove"))
    expect(screen.queryByTestId("record-chatter-attachment-error")).toBeNull()
  })
})
