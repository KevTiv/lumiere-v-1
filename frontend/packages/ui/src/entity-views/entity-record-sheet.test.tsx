import {
  cleanup,
  fireEvent,
  render, screen, waitFor,
  within,
} from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

const session = vi.hoisted(() => ({ organizationId: 7 as number | undefined }))

vi.mock("@lumiere/erp-session", () => ({ useErpSession: () => session }))
vi.mock("next/link", () => ({ default: (p: { children?: React.ReactNode }) => <a>{p.children}</a> }))
vi.mock("../crm-components/crm-record-chatter", () => ({
  RecordChatter: (p: { resModel: string; resId: bigint }) => (
    <div data-testid="chatter">{`${p.resModel}:${p.resId}`}</div>
  ),
}))
vi.mock("./entity-detail", () => ({ EntityDetail: () => <div>detail</div> }))
vi.mock("./record-audit-tab", () => ({ RecordAuditTab: () => <div>audit</div> }))

import { EntityRecordSheet } from "./entity-record-sheet"
import type { EntityRecordSheetConfig } from "../lib/module-types"

afterEach(cleanup)

const base: EntityRecordSheetConfig = {
  titleKey: "name",
  detailConfig: { mode: "detail", sections: [] },
  auditTableName: "hr_leave",
}

function open(config: EntityRecordSheetConfig, record: Record<string, unknown> = { id: 12, name: "Leave" }) {
  return render(<EntityRecordSheet open onOpenChange={() => {}} config={config} record={record} />)
}

describe("EntityRecordSheet overview", () => {
  it("reuses its scoped status, actions and evidence view", async () => {
    open(
      {
        ...base,
        statusKey: "state",
        actions: <button>Review leave</button>,
        responsibility: () => ({ label: "Employee", name: "Morgan Lee" }),
      },
      { id: 12, name: "Leave", state: "pending" },
    )

    const overview = within(
      screen.getByRole("region", { name: "Record overview" }),
    )
    expect(overview.getByText("Pending")).toBeTruthy()
    expect(overview.getByText("Morgan Lee")).toBeTruthy()
    expect(
      overview.getAllByRole("button", { name: "Review leave" }),
    ).toHaveLength(1)
    expect(screen.queryByText("audit")).toBeNull()
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("heading", { name: "Leave" }),
      ),
    )
    fireEvent.click(overview.getByRole("button", { name: "History & sources" }))
    const tab = await screen.findByRole("tab", {
      name: "History & sources",
      selected: true,
    })
    expect(document.activeElement).toBe(tab)
    expect(
      within(
        screen.getByRole("tabpanel", { name: "History & sources" }),
      ).getByText("audit"),
    ).toBeTruthy()
  })

  it("has no evidence shortcut for an unconfigured table or an invalid ID", () => {
    const { rerender } = open({ ...base, auditTableName: undefined })
    expect(
      screen.queryByRole("button", { name: "History & sources" }),
    ).toBeNull()
    rerender(
      <EntityRecordSheet
        open
        onOpenChange={() => {}}
        config={base}
        record={{ id: "invalid", name: "Leave" }}
      />,
    )
    expect(
      screen.queryByRole("button", { name: "History & sources" }),
    ).toBeNull()
  })
})

describe("EntityRecordSheet discussion", () => {
  it("unwraps record labels and statuses without coercing unknown shapes", () => {
    open(
      { ...base, statusKey: "state", discussion: {} },
      {
        id: { some: "18446744073709551615" },
        name: { some: "Reviewed record" },
        state: { some: { inProgress: [] } },
      },
    )
    expect(
      screen.getByRole("heading", { name: "Reviewed record" }),
    ).toBeTruthy()
    expect(screen.getByText("In progress")).toBeTruthy()
    expect(
      screen.getByTestId("entity-record-sheet-tab-discussion"),
    ).toBeTruthy()
    expect(screen.queryByText(/\[object Object\]/)).toBeNull()
  })

  it("uses an exact record reference when its title is unavailable", () => {
    open(
      { ...base, statusKey: "state" },
      {
        id: "18446744073709551615",
        name: { unknown: "name" },
        state: { value: "paid" },
      },
    )
    expect(
      screen.getByRole("heading", { name: "#18446744073709551615" }),
    ).toBeTruthy()
    expect(screen.queryByText(/\[object Object\]/)).toBeNull()
  })

  it("opens a product record at its heading before record actions", async () => {
    const productName = "Workshop fastener set — " + "SKU".repeat(60)
    open({ ...base, actions: <button>Update quantity</button> }, { id: 12, name: productName })
    const heading = screen.getByRole("heading", { name: productName })
    await waitFor(() => expect(document.activeElement).toBe(heading))
    expect(screen.getByRole("dialog").style.width).toBe("56rem")
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy()
  })
  it("renders actions with the current record and refreshes them after a transition", () => {
    const config = { ...base, actions: (record: Record<string, unknown>) => <button>{record.state === "new" ? "Qualify lead" : "Convert lead"}</button> }
    const { rerender } = open(config, { id: 12, name: "Lead", state: "new" })
    expect(screen.getByRole("button", { name: "Qualify lead" })).toBeTruthy()
    rerender(<EntityRecordSheet open onOpenChange={() => {}} config={config} record={{ id: 12, name: "Lead", state: "qualified" }} />)
    expect(screen.queryByRole("button", { name: "Qualify lead" })).toBeNull()
    expect(screen.getByRole("button", { name: "Convert lead" })).toBeTruthy()
  })
  it("has no Discussion tab unless the config asks for one", () => {
    open(base)
    expect(screen.queryByTestId("entity-record-sheet-tab-discussion")).toBeNull()
    expect(screen.getByRole("tablist").getAttribute("data-variant")).toBe("line")
    expect(screen.getByRole("tablist").getAttribute("data-ui")).toBe("context-tabs")
  })

  it("adds a Discussion tab filed under the audit table by default", () => {
    open({ ...base, discussion: {} })
    expect(screen.getByTestId("entity-record-sheet-tab-discussion")).toBeTruthy()
  })

  it("leaves the tab out for a record without a numeric id, or with no organization", () => {
    open({ ...base, discussion: {} }, { id: "abc", name: "x" })
    expect(screen.queryByTestId("entity-record-sheet-tab-discussion")).toBeNull()
    cleanup()
    session.organizationId = undefined
    open({ ...base, discussion: {} })
    expect(screen.queryByTestId("entity-record-sheet-tab-discussion")).toBeNull()
    session.organizationId = 7
  })
})
