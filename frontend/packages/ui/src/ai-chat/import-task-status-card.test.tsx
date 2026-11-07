import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import type {
  ChatImportNativeResult,
  ChatImportTaskStatus,
} from "../lib/import-task-status"

vi.mock("@lumiere/i18n", () => ({
  useTranslation: () => ({
    t: (
      key: string,
      options?: Record<string, unknown> & { defaultValue?: string },
    ) =>
      options?.defaultValue?.replace(/\{\{(\w+)\}\}/g, (_, field) =>
        String(options[field] ?? ""),
      ) ?? key,
  }),
}))
import { ImportTaskStatusCard } from "./import-task-status-card"

function status(): ChatImportTaskStatus {
  return {
    taskId: "a".repeat(32),
    companyId: "3",
    organizationId: "7",
    readAt: new Date().toISOString(),
    preparationStatus: "needs_review",
    sourceRows: { total: 5, ready: 3, held: 1, excluded: 1 },
    proposalCount: 1,
    proposals: [
      {
        id: "9",
        status: "verified",
        phase: "complete",
        expectedRecords: 2,
        verifiedResult: {
          recordCount: 2,
          lineCount: 4,
          totalDebit: "30.00",
          totalCredit: "30.00",
          currencyId: "1",
          postedCount: 0,
          verifiedAt: new Date().toISOString(),
        },
      },
    ],
    nativeResults: [],
    nativeResultsMore: false,
  }
}
function nativeResult(index = 0): ChatImportNativeResult {
  return {
    requestId: index.toString(16).padStart(32, "0"),
    entity: "product",
    state: "receipt_available",
    verification: "native_receipt_only",
    receipt: {
      jobId: String(20 + index),
      status: "partial",
      totalRows: 5,
      rowsImported: 3,
      errorRows: 2,
    },
  }
}
afterEach(() => cleanup())

it("renders authoritative draft totals separately from source confirmation and links the same task", () => {
  render(<ImportTaskStatusCard status={status()} companyId={3} />)
  expect(
    screen.getByText(
      "3 confirmed source rows · 1 need a decision · 1 excluded",
    ),
  ).toBeTruthy()
  expect(
    screen.getByText("2 verified draft journal entries · 4 lines"),
  ).toBeTruthy()
  expect(
    screen.getByText("Debit 30.00 · credit 30.00 · currency #1"),
  ).toBeTruthy()
  expect(
    screen.getByText(
      "Created as unposted drafts. Open Accounting to check their current posting state.",
    ),
  ).toBeTruthy()
  expect(
    screen.getByRole("link", { name: "Open saved task" }).getAttribute("href"),
  ).toContain("importTask=" + "a".repeat(32) + "&importCompany=3")
})

it("suppresses cards after a company switch and cards whose readback expired", () => {
  const saved = { ...status(), nativeResults: [nativeResult()] }
  const view = render(<ImportTaskStatusCard status={saved} companyId={4} />)
  expect(screen.queryByRole("region")).toBeNull()
  view.rerender(
    <ImportTaskStatusCard
      status={{
        ...saved,
        readAt: new Date(Date.now() - 301_000).toISOString(),
      }}
      companyId={3}
    />,
  )
  expect(screen.queryByText("Source review prepared")).toBeNull()
  expect(screen.queryByText("Native import job receipts")).toBeNull()
})

it("shows native receipts when no Accounting proposal exists and labels job counts accurately", () => {
  const imported = nativeResult()
  const awaiting: ChatImportNativeResult = {
    ...nativeResult(1),
    entity: "contact",
    state: "awaiting_receipt",
    receipt: null,
  }
  const failed: ChatImportNativeResult = {
    ...nativeResult(2),
    entity: "stock_location",
    receipt: {
      ...nativeResult(2).receipt!,
      status: "failed",
      rowsImported: 0,
      errorRows: 5,
    },
  }
  render(
    <ImportTaskStatusCard
      status={{
        ...status(),
        proposalCount: 0,
        proposals: [],
        nativeResults: [imported, awaiting, failed],
      }}
      companyId={3}
    />,
  )
  expect(
    screen.getByRole("region", { name: "Native import job receipts" }),
  ).toBeTruthy()
  expect(
    screen.getByText("No saved Accounting draft proposal yet."),
  ).toBeTruthy()
  expect(screen.queryByText("No saved ERP execution proposal yet.")).toBeNull()
  expect(screen.getByText("Job #20 · Partial")).toBeTruthy()
  expect(
    screen.getByText("Job reports 3 of 5 rows imported · 2 row errors"),
  ).toBeTruthy()
  expect(
    screen.getByText(
      "Request saved; the native job receipt is not available yet.",
    ),
  ).toBeTruthy()
  expect(screen.getByText("Job #22 · Failed")).toBeTruthy()
  expect(
    screen.getByText(
      "These counts come from native import jobs. They do not verify the current product, contact or location records.",
    ),
  ).toBeTruthy()
  expect(screen.queryByText(/verified draft journal entries/)).toBeNull()
  expect(
    screen.getByRole("link", { name: "Open saved task" }).getAttribute("href"),
  ).toContain("importView=results")
})

it("keeps rolled-back job evidence separate from verified Accounting drafts", () => {
  const result = nativeResult()
  result.receipt!.status = "rolled_back"
  render(
    <ImportTaskStatusCard
      status={{ ...status(), nativeResults: [result] }}
      companyId={3}
    />,
  )
  expect(
    screen.getByRole("heading", { name: "Accounting drafts" }),
  ).toBeTruthy()
  expect(
    screen.getByText("2 verified draft journal entries · 4 lines"),
  ).toBeTruthy()
  expect(screen.getByText("Job #20 · Rolled back")).toBeTruthy()
  expect(
    screen.getByText("Job reports 3 of 5 rows imported · 2 row errors"),
  ).toBeTruthy()
})

it("bounds chat receipts and explains both local and server-side truncation", () => {
  const results = Array.from({ length: 5 }, (_, index) => nativeResult(index))
  const saved = { ...status(), nativeResults: results }
  const view = render(<ImportTaskStatusCard status={saved} companyId={3} />)
  expect(screen.getAllByText(/Job #\d+/)).toHaveLength(3)
  expect(screen.queryByText("Job #23 · Partial")).toBeNull()
  expect(
    screen.getByText(
      "Native requests shown: 3. Open task Results for more saved receipts and row errors.",
    ),
  ).toBeTruthy()
  view.rerender(
    <ImportTaskStatusCard
      status={{
        ...saved,
        nativeResults: results.slice(0, 1),
        nativeResultsMore: true,
      }}
      companyId={3}
    />,
  )
  expect(
    screen.getByText(
      "Native requests shown: 1. Open task Results for more saved receipts and row errors.",
    ),
  ).toBeTruthy()
})
