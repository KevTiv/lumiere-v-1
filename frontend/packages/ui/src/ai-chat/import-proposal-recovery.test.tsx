import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
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
  PrepareImportProposal,
} from "../../../../web/lib/import-workflow"

const controls = vi.hoisted(() => ({ fetch: vi.fn(), accepted: vi.fn() }))
vi.mock("../../../../web/lib/api-fetch", () => ({ apiFetch: controls.fetch }))
import {
  importProposalAttemptStorageKey,
  useImportProposalAttempt,
} from "../../../../web/lib/use-import-proposal-attempt"

const scope = { organizationId: 7, companyId: 3, taskId: "a".repeat(32) }
const input: PrepareImportProposal = {
  rows: [{ itemId: "11", expectedRevision: 2 }],
  journalId: "5",
  debitAccountId: "6",
  creditAccountId: "7",
  currencyId: "8",
  dateField: "date",
  amountField: "amount",
  reason: "Historical electricity, retain settlement question",
}
function proposal(requestKey: string): ImportProposal {
  return {
    id: "10",
    requestKey,
    revision: 1,
    digest: "c".repeat(64),
    kind: "historical_expense_journals",
    status: "prepared",
    createdAt: "2026-11-07T00:00:00Z",
    approvedAt: null,
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
      reason: input.reason,
    },
    execution: {
      phase: "not_started",
      parentRequestId: null,
      lineRequestId: null,
      parentJobId: null,
      lineJobId: null,
    },
    result: null,
    lastError: null,
  }
}
function Harness({
  companyId = 3,
  changedInput = input,
}: {
  companyId?: number
  changedInput?: PrepareImportProposal
}) {
  const attempt = useImportProposalAttempt({
    actor: "actor",
    scope: { ...scope, companyId },
    onAccepted: controls.accepted,
  })
  return (
    <>
      <button
        disabled={!attempt.ready || attempt.busy || !!attempt.pending}
        onClick={() => void attempt.submit(changedInput)}
      >
        Prepare
      </button>
      <button
        disabled={attempt.busy || !attempt.pending}
        onClick={() => void attempt.retry()}
      >
        Retry saved preview
      </button>
      <button disabled={attempt.busy} onClick={() => void attempt.check()}>
        Check
      </button>
      {attempt.pending && <p>Pending {attempt.pending.requestKey}</p>}
      {attempt.error && <p role="alert">{attempt.error}</p>}
    </>
  )
}
const pointerKey = importProposalAttemptStorageKey("actor", scope)
beforeAll(() => vi.stubGlobal("crypto", webcrypto))
afterAll(() => vi.unstubAllGlobals())
beforeEach(() => {
  window.localStorage.clear()
  controls.fetch.mockReset()
  controls.accepted.mockReset()
})
afterEach(() => cleanup())

it("a lost prepare reply freezes exact intent across remount and retries the same request", async () => {
  const bodies: string[] = []
  controls.fetch.mockImplementation(
    async (_url: string, options?: RequestInit) => {
      if (options?.method === "POST") {
        bodies.push(String(options.body))
        if (bodies.length === 1) throw new Error("lost after acceptance")
        return Response.json(
          proposal(JSON.parse(String(options.body)).requestKey),
        )
      }
      return new Response(null, { status: 404 })
    },
  )
  const first = render(<Harness />)
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Prepare" })).toHaveProperty(
      "disabled",
      false,
    ),
  )
  fireEvent.click(screen.getByRole("button", { name: "Prepare" }))
  await screen.findByRole("alert")
  expect(window.localStorage.getItem(pointerKey)).toBeTruthy()
  expect(screen.getByRole("button", { name: "Prepare" })).toHaveProperty(
    "disabled",
    true,
  )
  first.unmount()
  render(
    <Harness
      changedInput={{
        ...input,
        previousProposalId: "99",
        reason: "Changed after list refresh",
        rows: [{ itemId: "11", expectedRevision: 9 }],
      }}
    />,
  )
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Retry saved preview" }),
    ).toHaveProperty("disabled", false),
  )
  fireEvent.click(screen.getByRole("button", { name: "Retry saved preview" }))
  await waitFor(() => expect(controls.accepted).toHaveBeenCalledOnce())
  expect(bodies).toHaveLength(2)
  expect(bodies[1]).toBe(bodies[0])
  expect(JSON.parse(bodies[1]!).rows).toEqual(input.rows)
  expect(window.localStorage.getItem(pointerKey)).toBeNull()
  expect(screen.queryByRole("alert")).toBeNull()
})

it("an exact accepted request is acknowledged after loss without redispatch", async () => {
  let saved: ImportProposal | null = null
  let posts = 0
  controls.fetch.mockImplementation(
    async (url: string, options?: RequestInit) => {
      if (options?.method === "POST") {
        posts++
        saved = proposal(JSON.parse(String(options.body)).requestKey)
        throw new Error("response lost")
      }
      expect(url).toContain("/workflow/requests/" + saved!.requestKey)
      return Response.json(saved)
    },
  )
  render(<Harness />)
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Prepare" })).toHaveProperty(
      "disabled",
      false,
    ),
  )
  fireEvent.click(screen.getByRole("button", { name: "Prepare" }))
  await waitFor(() => expect(controls.accepted).toHaveBeenCalledOnce())
  expect(posts).toBe(1)
  expect(window.localStorage.getItem(pointerKey)).toBeNull()
})

it.each([400, 409, 422, 408, 503])(
  "retires a rejected preview only with definitive status %s and exact absence",
  async (status) => {
    controls.fetch.mockImplementation(
      async (_url: string, options?: RequestInit) =>
        options?.method === "POST"
          ? Response.json({ error: "not accepted" }, { status })
          : new Response(null, { status: 404 }),
    )
    render(<Harness />)
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Prepare" })).toHaveProperty(
        "disabled",
        false,
      ),
    )
    fireEvent.click(screen.getByRole("button", { name: "Prepare" }))
    await screen.findByRole("alert")
    const definitive = [400, 409, 422].includes(status)
    expect(window.localStorage.getItem(pointerKey) !== null).toBe(!definitive)
    expect(screen.getByRole("button", { name: "Prepare" })).toHaveProperty(
      "disabled",
      !definitive,
    )
    expect(controls.accepted).not.toHaveBeenCalled()
  },
)

it("a rejected request stays retained until its exact absence can be read", async () => {
  let unavailable = true
  controls.fetch.mockImplementation(
    async (_url: string, options?: RequestInit) =>
      options?.method === "POST"
        ? Response.json({ error: "invalid inputs" }, { status: 422 })
        : unavailable
          ? Response.json({ error: "temporarily unavailable" }, { status: 503 })
          : new Response(null, { status: 404 }),
  )
  render(<Harness />)
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Prepare" })).toHaveProperty(
      "disabled",
      false,
    ),
  )
  fireEvent.click(screen.getByRole("button", { name: "Prepare" }))
  await screen.findByRole("alert")
  expect(window.localStorage.getItem(pointerKey)).toBeTruthy()
  unavailable = false
  fireEvent.click(screen.getByRole("button", { name: "Check" }))
  await waitFor(() =>
    expect(window.localStorage.getItem(pointerKey)).toBeNull(),
  )
  expect(
    controls.fetch.mock.calls.filter(
      ([, options]) => options?.method === "POST",
    ),
  ).toHaveLength(1)
})

it("a late A response cannot acknowledge the retained request after A to B to A", async () => {
  let finish!: (response: Response) => void
  let requestKey = ""
  controls.fetch.mockImplementation(
    async (_url: string, options?: RequestInit) => {
      if (options?.method === "POST") {
        requestKey = JSON.parse(String(options.body)).requestKey
        return new Promise<Response>((resolve) => {
          finish = resolve
        })
      }
      return new Response(null, { status: 404 })
    },
  )
  const view = render(<Harness />)
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Prepare" })).toHaveProperty(
      "disabled",
      false,
    ),
  )
  fireEvent.click(screen.getByRole("button", { name: "Prepare" }))
  await waitFor(() => expect(requestKey).toHaveLength(32))
  view.rerender(<Harness companyId={4} />)
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Prepare" })).toHaveProperty(
      "disabled",
      false,
    ),
  )
  view.rerender(<Harness companyId={3} />)
  await screen.findByRole("alert")
  await act(async () => {
    finish(Response.json(proposal(requestKey)))
  })
  expect(controls.accepted).not.toHaveBeenCalled()
  expect(window.localStorage.getItem(pointerKey)).toBeTruthy()
  expect(screen.getByRole("button", { name: "Prepare" })).toHaveProperty(
    "disabled",
    true,
  )
})
