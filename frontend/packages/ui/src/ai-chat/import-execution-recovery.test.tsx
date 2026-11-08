import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { webcrypto } from "node:crypto"
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  it,
  vi,
} from "vitest"
import type {
  ImportProposal,
  ImportWorkflow,
} from "../../../../web/lib/import-workflow"
import type { ReviewDetail } from "../../../../web/lib/import-review-model"

const controls = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock("@lumiere/i18n", () => ({
  useTranslation: () => ({
    t: (
      key: string,
      options?: Record<string, unknown> & { defaultValue?: string },
    ) => {
      const pattern =
        options?.defaultValue ??
        (
          {
            "settings.importWorkflow.previewSummary":
              "{{records}} draft entries · {{lines}} lines · {{held}} held source rows",
            "settings.importWorkflow.verified":
              "Verified {{records}} draft entries and {{lines}} lines; debit and credit each total {{amount}} {{currency}}.",
          } as Record<string, string>
        )[key] ??
        key
      return pattern.replace(/\{\{(\w+)\}\}/g, (_, field) =>
        String(options?.[field] ?? ""),
      )
    },
  }),
}))
vi.mock("@lumiere/erp-session", () => ({
  useErpSession: () => ({
    identity: "actor",
    activeCompanyId: 3,
    activeCompanyReady: true,
  }),
}))
vi.mock("@lumiere/query-hooks/hooks/accounting/accounts", () => ({
  useAccountAccounts: () => ({
    data: [
      {
        id: "6",
        companyId: "3",
        code: "610",
        name: "Expense",
        deprecated: false,
      },
      {
        id: "7",
        companyId: "3",
        code: "299",
        name: "Clearing",
        deprecated: false,
      },
    ],
  }),
}))
vi.mock("@lumiere/query-hooks/hooks/accounting/journals", () => ({
  useAccountJournals: () => ({
    data: [
      {
        id: "5",
        companyId: "3",
        code: "HIST",
        name: "Historical adjustments",
        active: true,
      },
    ],
  }),
}))
vi.mock("@lumiere/query-hooks/hooks/organization-company", () => ({
  useCompanies: () => ({ data: [{ id: "3", currencyId: "8" }] }),
}))
vi.mock("@lumiere/query-hooks/hooks/settings", () => ({
  useCurrencies: () => ({ data: [{ id: "8", code: "RWF" }] }),
}))
vi.mock("../../../../web/lib/api-fetch", () => ({ apiFetch: controls.fetch }))
import { ImportTaskExecutionPanel } from "../../../../web/lib/import-task-execution-panel"

const taskId = "a".repeat(32)
function proposal(): ImportProposal {
  return {
    id: "10",
    requestKey: "e".repeat(32),
    revision: 1,
    digest: "c".repeat(64),
    kind: "historical_expense_journals",
    status: "blocked",
    createdAt: "2026-11-07T00:00:00Z",
    approvedAt: "2026-11-07T01:00:00Z",
    summary: {
      recordCount: 1,
      lineCount: 2,
      blockedCount: 0,
      totalDebit: "12",
      totalCredit: "12",
      currencyId: "8",
      dateFrom: "2026-10-01",
      dateTo: "2026-10-01",
    },
    sources: [{ itemId: "11", batchId: "71", revision: 2 }],
    entries: [
      {
        itemId: "11",
        batchId: "71",
        sourceRevision: 2,
        sourceFile: "source.csv",
        sourceRow: 2,
        sourceSha256: "d".repeat(64),
        reference: "source-11",
        date: "2026-10-01",
        description: "Electricity",
        amount: "12",
      },
    ],
    issues: [],
    configuration: {
      journalId: "5",
      debitAccountId: "6",
      creditAccountId: "7",
      currencyId: "8",
      dateField: "date",
      amountField: "amount",
      descriptionField: null,
      postingDate: null,
      reason: "Historical electricity",
    },
    execution: {
      phase: "headers",
      parentRequestId: "b".repeat(32),
      lineRequestId: null,
      parentJobId: "90",
      lineJobId: null,
    },
    result: null,
    lastError: "Native response was unavailable",
  }
}
function workflow(proposals = [proposal()]): ImportWorkflow {
  return {
    version: 1,
    requestId: taskId,
    organizationId: "7",
    companyId: "3",
    capabilities: [],
    proposals,
    nativeResults: [],
    nativeResultsMore: false,
  }
}
function mount({
  view = "results",
  reviewId,
}: { view?: "preview" | "results"; reviewId?: string } = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const element = (nextView = view) => (
    <QueryClientProvider client={client}>
      <ImportTaskExecutionPanel
        organizationId={7}
        companyId={3}
        taskId={taskId}
        reviewId={reviewId}
        view={nextView}
      />
    </QueryClientProvider>
  )
  const mounted = render(element())
  return {
    ...mounted,
    setView: (next: "preview" | "results") => mounted.rerender(element(next)),
  }
}
const originalScrollIntoView = HTMLElement.prototype.scrollIntoView
beforeAll(() => {
  vi.stubGlobal("crypto", webcrypto)
  vi.stubGlobal("PointerEvent", MouseEvent)
  HTMLElement.prototype.scrollIntoView = vi.fn()
})
afterAll(() => {
  vi.unstubAllGlobals()
  HTMLElement.prototype.scrollIntoView = originalScrollIntoView
})
beforeEach(() => {
  localStorage.clear()
  controls.fetch.mockReset()
})
afterEach(() => cleanup())

const review: ReviewDetail = {
  id: "71",
  title: "Historical electricity",
  targetEntity: "source_observation",
  sourceFile: "source.csv",
  history: [],
  items: ["11", "12"].map((id, index) => ({
    id,
    revision: 2,
    state: "needs_review",
    values: { date: "2026-10-01", amount: "12", observation_kind: "expense" },
    confirmedFields: index === 0 ? ["date", "amount", "observation_kind"] : [],
    reason: null,
    reviewedBy: null,
    reviewedAt: null,
    source: {
      key: `row-${id}`,
      label: `Electricity ${index + 1}`,
      issue: "Settlement is not confirmed",
      source: { file: "source.csv", row: index + 2, sha256: "d".repeat(64) },
      proposed: {},
      fields: [
        {
          key: "date",
          label: "Transaction date",
          kind: "date",
          sourceValue: "2026-10-01",
          required: true,
        },
        {
          key: "amount",
          label: "Amount",
          kind: "decimal",
          sourceValue: "12",
          required: true,
        },
      ],
    },
  })),
}

async function chooseAccountingTreatment(reason: string) {
  for (const [label, option] of [
    ["journal", "HIST · Historical adjustments"],
    ["debitAccount", "610 · Expense"],
    ["creditAccount", "299 · Clearing"],
  ]) {
    const choice = await screen.findByRole("combobox", {
      name: `settings.importWorkflow.${label}`,
    })
    fireEvent.keyDown(choice, { key: "ArrowDown" })
    fireEvent.click(await screen.findByRole("option", { name: option }))
  }
  fireEvent.change(
    screen.getByRole("textbox", { name: "settings.importWorkflow.reason" }),
    { target: { value: reason } },
  )
}

it("can explicitly prepare the same rows after an approved blocked attempt is cleaned up without approving or executing again", async () => {
  const blocked = { ...proposal(), lastError: "The previous request failed." }
  let next: ImportProposal | null = null
  const writes: string[] = []
  controls.fetch.mockImplementation(
    async (url: string, options?: RequestInit) => {
      if (url.includes("/import-reviews/"))
        return Response.json({ ...review, items: review.items.slice(0, 1) })
      if (options?.method !== "POST")
        return Response.json(workflow(next ? [next, blocked] : [blocked]))
      writes.push(url)
      expect(url).toMatch(/\/workflow\/proposals$/)
      const body = JSON.parse(String(options.body))
      expect(body.rows).toEqual([{ itemId: "11", expectedRevision: 2 }])
      // The simulated server has verified the earlier attempt left no ERP rows.
      // The new prepare response, not a client interpretation of lastError, admits them.
      next = {
        ...blocked,
        id: "20",
        requestKey: body.requestKey,
        status: "prepared",
        approvedAt: null,
        configuration: { ...blocked.configuration, reason: body.reason },
        lastError: null,
        execution: {
          phase: "not_started",
          parentRequestId: null,
          lineRequestId: null,
          parentJobId: null,
          lineJobId: null,
        },
      }
      return Response.json(next)
    },
  )
  mount({ view: "preview", reviewId: "71" })
  await screen.findByText("The previous request failed.")
  await chooseAccountingTreatment(
    "Recheck accounting choices after empty failed attempt",
  )
  const prepare = screen.getByRole("button", {
    name: "settings.importWorkflow.prepare",
  })
  await waitFor(() => expect(prepare).toHaveProperty("disabled", false))
  expect(writes).toHaveLength(0)
  fireEvent.click(prepare)
  await screen.findByText("settings.importWorkflow.status.prepared")
  expect(writes).toHaveLength(1)
  expect(
    screen.getByRole("button", { name: "settings.importWorkflow.approve" }),
  ).toBeTruthy()
  expect(
    screen.queryByRole("button", { name: "settings.importWorkflow.execute" }),
  ).toBeNull()
  expect(
    screen.queryByText("settings.importWorkflow.status.verified"),
  ).toBeNull()
})

it.each([false, true])(
  "keeps source review, exact approval and verified ERP receipts separate (lost execution response: %s)",
  async (lostExecutionReply) => {
    let saved: ImportProposal | null = null
    const actions: string[] = []
    controls.fetch.mockImplementation(
      async (url: string, options?: RequestInit) => {
        if (url.includes("/import-reviews/")) return Response.json(review)
        if (options?.method !== "POST")
          return Response.json(workflow(saved ? [saved] : []))
        const body = JSON.parse(String(options.body))
        if (url.endsWith("/proposals")) {
          actions.push("prepare")
          expect(body.rows).toEqual([
            { itemId: "11", expectedRevision: 2 },
            { itemId: "12", expectedRevision: 2 },
          ])
          expect(body.reason).toBe(
            "Historical electricity; settlement remains unknown",
          )
          saved = {
            ...proposal(),
            requestKey: body.requestKey,
            status: "prepared",
            approvedAt: null,
            summary: { ...proposal().summary, blockedCount: 1 },
            sources: [
              ...proposal().sources,
              { itemId: "12", batchId: "71", revision: 2 },
            ],
            issues: [
              {
                itemId: "12",
                code: "amount_unconfirmed",
                message: "Confirm the second row amount.",
              },
            ],
            configuration: { ...proposal().configuration, reason: body.reason },
            execution: {
              phase: "not_started",
              parentRequestId: null,
              lineRequestId: null,
              parentJobId: null,
              lineJobId: null,
            },
            lastError: null,
          }
        } else {
          expect(saved).not.toBeNull()
          expect(body).toEqual({
            companyId: 3,
            expectedRevision: 1,
            expectedDigest: saved!.digest,
          })
          if (url.endsWith("/approve")) {
            actions.push("approve")
            saved = {
              ...saved!,
              status: "approved",
              approvedAt: "2026-11-07T01:00:00Z",
            }
          } else if (url.endsWith("/execute")) {
            actions.push("execute")
            saved = {
              ...saved!,
              status: "verified",
              execution: {
                phase: "complete",
                parentRequestId: "b".repeat(32),
                lineRequestId: "f".repeat(32),
                parentJobId: "90",
                lineJobId: "91",
              },
              result: {
                verifiedAt: "2026-11-07T01:01:00Z",
                recordCount: 1,
                lineCount: 2,
                totalDebit: "12",
                totalCredit: "12",
                currencyId: "8",
                companyId: "3",
                recordIds: ["100"],
                lineIds: ["101", "102"],
                postedCount: 0,
              },
            }
            if (lostExecutionReply)
              throw new Error("The response was lost after acceptance")
          } else throw new Error(`Unexpected mutation: ${url}`)
        }
        return Response.json(saved)
      },
    )
    const mounted = mount({ view: "preview", reviewId: "71" })
    await chooseAccountingTreatment(
      "Historical electricity; settlement remains unknown",
    )
    const prepare = screen.getByRole("button", {
      name: "settings.importWorkflow.prepare",
    })
    await waitFor(() => expect(prepare).toHaveProperty("disabled", false))
    fireEvent.click(prepare)
    expect(
      await screen.findByText("1 draft entries · 2 lines · 1 held source rows"),
    ).toBeTruthy()
    expect(screen.getByText("Confirm the second row amount.")).toBeTruthy()
    expect(actions).toEqual(["prepare"])
    expect(
      screen.queryByText("settings.importWorkflow.status.verified"),
    ).toBeNull()
    mounted.setView("results")
    fireEvent.click(
      screen.getByRole("button", { name: "settings.importWorkflow.approve" }),
    )
    fireEvent.click(
      await screen.findByRole("button", {
        name: "settings.importWorkflow.execute",
      }),
    )
    expect(
      await screen.findByText(
        "Verified 1 draft entries and 2 lines; debit and credit each total 12 RWF.",
      ),
    ).toBeTruthy()
    fireEvent.click(screen.getByText("settings.importWorkflow.openRecords"))
    expect(
      screen.getByRole("link", { name: "source-11" }).getAttribute("href"),
    ).toBe("/accounting/invoices/100?companyId=3")
    expect(actions).toEqual(["prepare", "approve", "execute"])
  },
)

it("approved blocked execution can check and resume the exact saved proposal", async () => {
  const saved = proposal()
  controls.fetch.mockImplementation(
    async (url: string, options?: RequestInit) => {
      if (options?.method === "POST") {
        expect(url).toMatch(/\/proposals\/10\/(verify|execute)$/)
        expect(JSON.parse(String(options.body))).toEqual({
          companyId: 3,
          expectedRevision: 1,
          expectedDigest: saved.digest,
        })
        return Response.json(saved)
      }
      return Response.json(workflow())
    },
  )
  mount()
  const verify = await screen.findByRole("button", {
    name: "settings.importWorkflow.verify",
  })
  await waitFor(() => expect(verify).toHaveProperty("disabled", false))
  fireEvent.click(verify)
  await waitFor(() =>
    expect(
      controls.fetch.mock.calls.some(
        ([url, options]) =>
          String(url).endsWith("/verify") && options?.method === "POST",
      ),
    ).toBe(true),
  )
  const resume = screen.getByRole("button", {
    name: "settings.importWorkflow.resume",
  })
  await waitFor(() => expect(resume).toHaveProperty("disabled", false))
  fireEvent.click(resume)
  await waitFor(() =>
    expect(
      controls.fetch.mock.calls.filter(
        ([, options]) => options?.method === "POST",
      ),
    ).toHaveLength(2),
  )
})

function overlapProposal(
  reason:
    | "overlapping_period_amount"
    | "same_source" = "overlapping_period_amount",
): ImportProposal {
  const saved = proposal()
  return {
    ...saved,
    status: "prepared",
    approvedAt: null,
    summary: {
      ...saved.summary,
      recordCount: 0,
      lineCount: 0,
      blockedCount: 1,
      totalDebit: "0",
      totalCredit: "0",
      dateFrom: null,
      dateTo: null,
    },
    entries: [],
    lastError: null,
    execution: {
      phase: "not_started",
      parentRequestId: null,
      lineRequestId: null,
      parentJobId: null,
      lineJobId: null,
    },
    issues: [
      {
        itemId: "11",
        code: "possible_prior_expense",
        message: "Review the possible expense match.",
        resolution: {
          kind: "distinct_expenses",
          candidateDigest: "f".repeat(64),
        },
        candidates: [
          {
            origin: "saved_proposal",
            proposalId: "4",
            proposalDigest: "a".repeat(64),
            itemId: "3",
            sourceRevision: 1,
            reason,
            dateFrom: "2026-10-01",
            dateToExclusive: "2026-11-01",
            postingDate: "2026-10-01",
            amount: "12",
            currencyId: "8",
            externalReference: "BILL-42",
            category: "Electricity",
          },
        ],
      },
    ],
  }
}

it("reviewing a soft overlap saves a new preview with pinned revisions and reason, never approval", async () => {
  let saved = overlapProposal()
  const writes: string[] = []
  controls.fetch.mockImplementation(
    async (url: string, options?: RequestInit) => {
      if (options?.method === "POST") {
        writes.push(url)
        expect(url).toMatch(/\/workflow\/proposals$/)
        const body = JSON.parse(String(options.body))
        expect(body.rows).toEqual([{ itemId: "11", expectedRevision: 2 }])
        expect(body.distinctExpenses).toEqual([
          {
            itemId: "11",
            sourceRevision: 2,
            candidateDigest: "f".repeat(64),
            reason: "Different meter and invoice",
          },
        ])
        saved = {
          ...proposal(),
          id: "20",
          requestKey: body.requestKey,
          status: "prepared",
          approvedAt: null,
          lastError: null,
          execution: {
            phase: "not_started",
            parentRequestId: null,
            lineRequestId: null,
            parentJobId: null,
            lineJobId: null,
          },
          configuration: {
            ...proposal().configuration,
            distinctExpenses: body.distinctExpenses,
          },
        }
        return Response.json(saved)
      }
      return Response.json(workflow([saved]))
    },
  )
  mount()
  expect(await screen.findByText("12 RWF")).toBeTruthy()
  expect(
    screen.getByText("Reference: BILL-42 · category: Electricity"),
  ).toBeTruthy()
  const confirm = screen.getByRole("checkbox", {
    name: "I reviewed these matches. Source row #11 is a different expense.",
  })
  await waitFor(() =>
    expect(confirm.getAttribute("aria-disabled")).not.toBe("true"),
  )
  fireEvent.click(confirm)
  fireEvent.change(
    screen.getByRole("textbox", {
      name: "Why source row #11 is a different expense",
    }),
    { target: { value: "Different meter and invoice" } },
  )
  fireEvent.click(
    screen.getByRole("button", {
      name: "Prepare new preview with these decisions",
    }),
  )
  await screen.findByText(
    "Source row #11, revision 2: Different meter and invoice",
  )
  expect(writes).toHaveLength(1)
})

it("hard source duplicates do not offer distinct-expense assertions", async () => {
  controls.fetch.mockImplementation(async () =>
    Response.json(workflow([overlapProposal("same_source")])),
  )
  mount()
  await screen.findByText("Review the possible expense match.")
  expect(screen.queryByRole("checkbox")).toBeNull()
  expect(
    screen.queryByRole("button", {
      name: "Prepare new preview with these decisions",
    }),
  ).toBeNull()
})

it("saved native receipts link their jobs without claiming full ERP verification", async () => {
  const saved = workflow([])
  saved.nativeResults = [
    {
      requestId: "f".repeat(32),
      entity: "product",
      fileName: "products.csv",
      contentSha256: "d".repeat(64),
      reviewItemCount: 2,
      reviewIds: ["71"],
      submittedAt: "2026-11-07T12:00:00Z",
      state: "receipt_available",
      verification: "native_receipt_only",
      receipt: {
        jobId: "90",
        status: "partial",
        totalRows: 2,
        rowsImported: 1,
        errorRows: 1,
      },
    },
  ]
  saved.nativeResultsMore = true
  controls.fetch.mockImplementation(async () => Response.json(saved))
  mount()
  expect(
    (
      await screen.findByRole("link", {
        name: "Open import job and row errors",
      })
    ).getAttribute("href"),
  ).toBe(`/settings/import-jobs/90?companyId=3&fromTask=${taskId}`)
  expect(
    screen.getByText(
      "Only the latest 20 native receipts for this task are shown. More saved receipts exist.",
    ),
  ).toBeTruthy()
  expect(
    screen.queryByText("settings.importWorkflow.status.verified"),
  ).toBeNull()
})
