import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest"
import { AiActionDraftOutcomeUnknown } from "@lumiere/query-hooks/hooks/ai-action-draft-result"
import type { ChatActionDraftPayload } from "../lib/ai-chat-types"
import { AiActionDraftCard } from "./ai-action-draft-card"

afterEach(() => {
  cleanup()
  sessionStorage.clear()
})
beforeAll(() => {
  vi.stubGlobal("PointerEvent", MouseEvent)
})
afterAll(() => {
  vi.unstubAllGlobals()
})

const draft: ChatActionDraftPayload = {
  draftId: 41,
  companyId: 7,
  reducerName: "create_sale_order",
  summary: "Create reviewed quotation",
  paramsJson: { partner_id: 9 },
  confidence: 1,
  warnings: [],
  elevated: false,
  status: "pending",
}
const approveButton = () =>
  screen.getByTestId("ai-action-draft-approve") as HTMLButtonElement

describe("AI action draft readback", () => {
  it("does not allow review history to approve before its saved draft is checked", async () => {
    let complete!: (value: ChatActionDraftPayload) => void
    const onRefresh = vi.fn(
      () =>
        new Promise<ChatActionDraftPayload>((resolve) => {
          complete = resolve
        }),
    )
    const onApprove = vi.fn(async () => {})
    render(
      <AiActionDraftCard
        draft={draft}
        onApprove={onApprove}
        onRefresh={onRefresh}
      />,
    )
    fireEvent.click(screen.getByTestId("ai-action-draft-reviewed"))
    expect(approveButton().disabled).toBe(true)
    await act(async () => complete(draft))
    await waitFor(() => expect(approveButton().disabled).toBe(false))
    expect(onRefresh).toHaveBeenCalledTimes(1)
    expect(onApprove).not.toHaveBeenCalled()
  })

  it("keeps unknown approval locked while Check outcome only reads", async () => {
    const onRefresh = vi.fn(async () => draft)
    const onApprove = vi.fn(async () => {
      throw new AiActionDraftOutcomeUnknown()
    })
    const onReject = vi.fn(async () => {})
    render(
      <AiActionDraftCard
        draft={draft}
        onApprove={onApprove}
        onReject={onReject}
        onRefresh={onRefresh}
      />,
    )
    await waitFor(() =>
      expect(
        screen.getByTestId("ai-action-draft-check-outcome").textContent,
      ).toBe("Check outcome"),
    )
    fireEvent.click(screen.getByTestId("ai-action-draft-reviewed"))
    fireEvent.click(approveButton())
    await screen.findByRole("alert")
    expect(approveButton().disabled).toBe(true)
    expect(
      (screen.getByTestId("ai-action-draft-reject") as HTMLButtonElement)
        .disabled,
    ).toBe(true)
    fireEvent.click(screen.getByTestId("ai-action-draft-check-outcome"))
    await screen.findByText(
      "The outcome is still unconfirmed. No action has been retried.",
    )
    fireEvent.click(approveButton())
    expect(onApprove).toHaveBeenCalledTimes(1)
    expect(onReject).not.toHaveBeenCalled()
    expect(onRefresh).toHaveBeenCalledTimes(2)
  })

  it("retains an unresolved attempt across remount while a pending read never redispatches", async () => {
    const scopeKey = "reload-actor:org:company"
    const onRefresh = vi.fn(async () => draft)
    const onApprove = vi.fn(async () => {
      throw new AiActionDraftOutcomeUnknown()
    })
    const first = render(
      <AiActionDraftCard
        draft={draft}
        scopeKey={scopeKey}
        onApprove={onApprove}
        onRefresh={onRefresh}
      />,
    )
    await waitFor(() =>
      expect(
        screen.getByTestId("ai-action-draft-check-outcome").textContent,
      ).toBe("Check outcome"),
    )
    fireEvent.click(screen.getByTestId("ai-action-draft-reviewed"))
    fireEvent.click(approveButton())
    await screen.findByRole("alert")
    expect(sessionStorage.length).toBe(1)
    first.unmount()
    render(
      <AiActionDraftCard
        draft={draft}
        scopeKey={scopeKey}
        onApprove={onApprove}
        onRefresh={onRefresh}
      />,
    )
    await screen.findByText(
      "The outcome is still unconfirmed. No action has been retried.",
    )
    fireEvent.click(screen.getByTestId("ai-action-draft-reviewed"))
    fireEvent.click(approveButton())
    expect(approveButton().disabled).toBe(true)
    expect(onApprove).toHaveBeenCalledTimes(1)
    expect(onRefresh).toHaveBeenCalledTimes(2)
  })

  it("recovers a persisted marker with no live component or in-memory attempt", async () => {
    const scopeKey = "persisted-only-actor:org:company"
    sessionStorage.setItem(
      `lumiere:ai-draft-attempt:v1:${JSON.stringify([scopeKey, draft.companyId, draft.draftId])}`,
      "pending",
    )
    const onApprove = vi.fn(async () => {})
    render(
      <AiActionDraftCard
        draft={draft}
        scopeKey={scopeKey}
        onApprove={onApprove}
        onRefresh={async () => draft}
      />,
    )
    await screen.findByText(
      "The outcome is still unconfirmed. No action has been retried.",
    )
    fireEvent.click(screen.getByTestId("ai-action-draft-reviewed"))
    fireEvent.click(approveButton())
    expect(approveButton().disabled).toBe(true)
    expect(onApprove).not.toHaveBeenCalled()
  })

  it("sends only one mutation while a double click is awaiting its reply", async () => {
    let complete!: () => void
    const onApprove = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve
        }),
    )
    render(
      <AiActionDraftCard
        draft={draft}
        scopeKey="double-click-actor:org:company"
        onApprove={onApprove}
      />,
    )
    fireEvent.click(screen.getByTestId("ai-action-draft-reviewed"))
    act(() => {
      fireEvent.click(approveButton())
      fireEvent.click(approveButton())
    })
    expect(onApprove).toHaveBeenCalledTimes(1)
    await act(async () => complete())
    expect(sessionStorage.length).toBe(0)
  })

  it("renders an exact authoritative result with a full-width record identity", () => {
    render(
      <AiActionDraftCard
        draft={{
          ...draft,
          status: "approved",
          executionRecordId: "9007199254740993",
          executionRecordHref: "/sales?tab=orders&filter=id%3A9007199254740993",
        }}
      />,
    )
    expect(screen.getByRole("status").textContent).toBe("Applied")
    expect(screen.getByText("Created record #9007199254740993")).toBeTruthy()
    expect(screen.getByText("Proposed changes")).toBeTruthy()
    expect(screen.getByText("Proposed value")).toBeTruthy()
    expect(screen.queryByTestId("ai-action-draft-reviewed")).toBeNull()
    expect(
      screen
        .getByRole("link", { name: "Open created record" })
        .getAttribute("href"),
    ).toBe("/sales?tab=orders&filter=id%3A9007199254740993")
    expect(screen.queryByTestId("ai-action-draft-approve")).toBeNull()
  })

  it("uses current readback for decisions and timestamps", async () => {
    const staleDraft = {
      ...draft,
      status: "approved",
      executionRecordId: "9007199254740993",
      executionRecordHref: "/sales?tab=orders&filter=id%3A9007199254740993",
      executedAt: "2026-09-03T11:12:13.456789Z",
    } as const
    const approved = {
      ...draft,
      status: "approved",
      proposedAt: "2026-09-01T11:12:13.456789Z",
      reviewedAt: "2026-09-02T11:12:13.456789Z",
    } as const
    const onRefresh = vi.fn(async () => approved)
    const { container } = render(
      <AiActionDraftCard draft={staleDraft} onRefresh={onRefresh} />,
    )

    expect(screen.getByRole("status").textContent).toBe("Checking saved draft…")
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe("Approved"),
    )
    expect(
      screen.queryByRole("link", { name: "Open created record" }),
    ).toBeNull()
    expect(
      [...container.querySelectorAll("time")].map(
        (element) => element.dateTime,
      ),
    ).toEqual([approved.proposedAt, approved.reviewedAt])
  })

  it("renders the applied result from the exact approval response", async () => {
    const executedAt = "2026-09-02T11:12:13.456789Z"
    const onApprove = vi.fn(async () => ({
      ...draft,
      status: "approved" as const,
      executionRecordId: 202,
      executedAt,
    }))
    const { container } = render(
      <AiActionDraftCard
        draft={draft}
        onApprove={onApprove}
        onRefresh={async () => draft}
      />,
    )
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toBe("Awaiting review"),
    )
    fireEvent.click(screen.getByTestId("ai-action-draft-reviewed"))
    fireEvent.click(approveButton())
    await screen.findByText("Created record #202")
    expect(screen.getByRole("status").textContent).toBe("Applied")
    expect(container.querySelector("time")?.dateTime).toBe(executedAt)
    expect(screen.queryByTestId("ai-action-draft-approve")).toBeNull()
  })

  it("preserves source values and renders reversal inputs without inventing a prior value", () => {
    render(
      <AiActionDraftCard
        draft={{
          ...draft,
          reducerName: "reverse_payment_transaction",
          paramsJson: {
            transactionId: "9007199254740993",
            reason: "  Duplicate charge  ",
          },
        }}
      />,
    )
    const diff = screen.getByTestId("history-field-diff")
    const priorValues = diff.querySelectorAll('[data-value-kind="unavailable"]')
    expect(priorValues).toHaveLength(2)
    expect(diff.querySelector("[data-diff-mark]")).toBeNull()
    expect(within(diff).getByText("Payment transaction")).toBeTruthy()
    expect(within(diff).getByText("9007199254740993")).toBeTruthy()
    expect(within(diff).getByText("Duplicate charge").textContent).toBe(
      "  Duplicate charge  ",
    )
  })

  it("shows the supplied creation parameters as additions without filling omitted fields", () => {
    render(
      <AiActionDraftCard
        draft={{
          ...draft,
          paramsJson: {
            partnerId: 9,
            note: "",
            clientOrderRef: null,
            orderLines: [{ priceUnit: "12.3400" }],
          },
        }}
      />,
    )
    const diff = screen.getByTestId("history-field-diff")
    expect(diff.querySelectorAll('[data-value-kind="absent"]')).toHaveLength(4)
    expect(diff.querySelectorAll('[data-diff-mark="added"]')).toHaveLength(4)
    expect(within(diff).getByText("Customer (partner)")).toBeTruthy()
    expect(within(diff).getByText(/12.3400/)).toBeTruthy()
    expect(within(diff).getByText("Empty text")).toBeTruthy()
    expect(within(diff).getByText("No value")).toBeTruthy()
    expect(within(diff).queryByText("Currency")).toBeNull()
  })

  it("names the proposed effect from the supported action rather than the model summary", () => {
    render(
      <AiActionDraftCard draft={{ ...draft, summary: "Request from chat" }} />,
    )
    expect(
      screen.getByRole("heading", { name: "Create sales order" }),
    ).toBeTruthy()
    expect(screen.getByRole("status").textContent).toBe("Awaiting review")
    expect(
      screen.queryByRole("link", { name: "Open created record" }),
    ).toBeNull()
  })

  it("cannot act after current read permission is unavailable", async () => {
    const onRefresh = vi.fn(async (): Promise<ChatActionDraftPayload> => {
      throw new Error("denied")
    })
    const onApprove = vi.fn(async () => {})
    render(
      <AiActionDraftCard
        draft={draft}
        onApprove={onApprove}
        onRefresh={onRefresh}
      />,
    )
    await screen.findByRole("alert")
    fireEvent.click(screen.getByTestId("ai-action-draft-reviewed"))
    expect(approveButton().disabled).toBe(true)
    expect(onApprove).not.toHaveBeenCalled()
  })
})
