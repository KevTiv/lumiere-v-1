import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("@lumiere/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock("@lumiere/erp-session", () => ({ useErpSession: () => ({ identity: "abc" }) }))
vi.mock("@lumiere/erp-shared/stb-timestamp", () => ({ stbTimestampFromDate: () => 0 }))
vi.mock("@lumiere/stdb/browser-http", () => ({ stdbBrowserQuery: async () => [] }))
vi.mock("@lumiere/stdb/client-ui-bridge", () => ({
  subscribeToRecord: async () => undefined,
  unsubscribeFromRecord: async () => undefined,
}))
vi.mock("@lumiere/query-hooks/hooks/messages", () => ({
  usePostMessage: () => ({ mutateAsync: async () => undefined }),
}))
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

afterEach(cleanup)

describe("CrmRecordChatter", () => {
  it("offers notes on any record but scheduled activities only where the backend can attach them", () => {
    const { rerender } = render(<CrmRecordChatter organizationId={1} resModel="unsupported" resId={5n} />)
    expect(screen.getByTestId("record-chatter-post")).toBeTruthy()
    expect(screen.queryByTestId("record-chatter-log-activity")).toBeNull()

    rerender(<CrmRecordChatter organizationId={1} resModel="lead" resId={5n} />)
    expect(screen.getByTestId("record-chatter-log-activity")).toBeTruthy()
    for (const resModel of ["sale_order", "purchase_order", "account_move", "hr_employee", "stock_picking"]) {
      rerender(<CrmRecordChatter organizationId={1} resModel={resModel} resId={5n} />)
      expect(screen.getByTestId("record-chatter-log-activity")).toBeTruthy()
    }
  })
})
