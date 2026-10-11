import { cleanup, render, screen } from "@testing-library/react"
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

describe("EntityRecordSheet discussion", () => {
  it("has no Discussion tab unless the config asks for one", () => {
    open(base)
    expect(screen.queryByTestId("entity-record-sheet-tab-discussion")).toBeNull()
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
