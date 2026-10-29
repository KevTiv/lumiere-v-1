import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ProposalWorkspace, type ProposalWorkspaceHooks } from "./proposal-workspace"

const i18n = vi.hoisted(() => {
  const t = (key: string, o?: { defaultValue?: string }) => o?.defaultValue ?? key
  const value = { t }
  return { useTranslation: () => value }
})
vi.mock("@lumiere/i18n", async (importOriginal) => ({ ...(await importOriginal<typeof import("@lumiere/i18n")>()), ...i18n }))
vi.mock("next/link", () => ({ default: (p: { children?: React.ReactNode }) => <a>{p.children}</a> }))
const toasts = vi.hoisted(() => ({ show: vi.fn() }))
vi.mock("../lib/workflow-toast", () => ({ showWorkflowToast: toasts.show }))

const QUERY_HOOKS = new Set([
  "useProposalSections",
  "useProposalSourceDocs",
  "useProposalVersions",
  "useProposalLineItems",
  "useProposalPresence",
  "useProposalComments",
  "useProducts",
  "useProposalTemplates",
  "useProposalComplianceRequirements",
  "useProposalProcurementScores",
])

const conflictError = Object.assign(new Error("Section conflict: expected revision 2, found 4"), {
  name: "ProposalSectionConflictError",
  expectedRevision: 2,
  foundRevision: 4,
})

const baseRow = { id: 7n, proposalId: "1", title: "Scope", content: "base text", status: "Draft", sequence: 10, revision: 2 }
const theirRow = { ...baseRow, content: "their text", revision: 4 }

const EMPTY_QUERY = { data: [] as Record<string, unknown>[] }
let sections: Record<string, unknown>[]
let lineItems: Record<string, unknown>[]
let upsertMutate: ReturnType<typeof vi.fn>
let resolveAsync: ReturnType<typeof vi.fn>

function makeHooks(): ProposalWorkspaceHooks {
  return new Proxy(
    {},
    {
      get: (_target, name: string) => {
        if (name === "useProposalSections") return () => ({ data: sections })
        if (name === "useProposalLineItems") return () => ({ data: lineItems })
        if (QUERY_HOOKS.has(name)) return () => EMPTY_QUERY
        if (name === "useUpsertProposalSection") return () => ({ mutate: upsertMutate, isPending: false })
        if (name === "useResolveProposalSectionConflict") return () => ({ mutateAsync: resolveAsync, isPending: false })
        return () => ({ mutate: vi.fn(), mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false })
      },
    },
  ) as unknown as ProposalWorkspaceHooks
}

function renderWorkspace(canResolve = true, proposalId = "1") {
  return render(
    <ProposalWorkspace
      proposalId={proposalId}
      proposalTitle="Bid"
      organizationId={1n}
      companyId={1n}
      onAnalyze={vi.fn()}
      canResolveSectionConflict={canResolve}
      hooks={makeHooks()}
    />,
  )
}

function contentBox(): HTMLTextAreaElement {
  return document.querySelector("textarea") as HTMLTextAreaElement
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
  toasts.show.mockClear()
  sections = [baseRow]
  lineItems = []
  upsertMutate = vi.fn((_params, options?: { onError?: (e: unknown) => void; onSettled?: () => void }) => {
    sections = [theirRow] // the invalidated sections query now holds the server's version
    options?.onError?.(conflictError)
    options?.onSettled?.()
  })
  resolveAsync = vi.fn().mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe("section revision conflict banner", () => {
  it("does not show without a conflict", () => {
    renderWorkspace()
    expect(screen.queryByTestId("proposal-section-conflict")).toBeNull()
  })

  it("shows both versions on a conflict and keeps the draft", () => {
    renderWorkspace()
    fireEvent.change(contentBox(), { target: { value: "my text" } })
    act(() => {
      vi.advanceTimersByTime(1600)
    })
    expect(upsertMutate).toHaveBeenCalledTimes(1)
    expect(upsertMutate.mock.calls[0][0]).toMatchObject({ sectionId: 7n, expectedRevision: 2, content: "my text" })
    const banner = screen.getByTestId("proposal-section-conflict")
    expect(banner.textContent).toContain("my text")
    expect(banner.textContent).toContain("their text")
    expect(screen.getByTestId("proposal-section-conflict-mine-revision").textContent).toContain("2")
    expect(screen.getByTestId("proposal-section-conflict-theirs-revision").textContent).toContain("4")
    expect(contentBox().value).toBe("my text")
  })

  it("does not send further stale saves while the conflict is open", () => {
    renderWorkspace()
    fireEvent.change(contentBox(), { target: { value: "my text" } })
    act(() => {
      vi.advanceTimersByTime(1600)
    })
    fireEvent.change(contentBox(), { target: { value: "my text, edited more" } })
    act(() => {
      vi.advanceTimersByTime(1600)
    })
    expect(upsertMutate).toHaveBeenCalledTimes(1)
  })

  it("Keep mine resolves with the draft and closes the banner", async () => {
    renderWorkspace()
    fireEvent.change(contentBox(), { target: { value: "my text, edited more" } })
    act(() => {
      vi.advanceTimersByTime(1600)
    })
    await act(async () => {
      fireEvent.click(screen.getByTestId("proposal-section-keep-mine"))
    })
    expect(resolveAsync).toHaveBeenCalledTimes(1)
    expect(resolveAsync).toHaveBeenCalledWith({
      proposalId: 1n,
      sectionId: "7",
      title: "Scope",
      content: "my text, edited more",
      status: "draft",
      sequence: 10,
      aiSuggestion: null,
    })
    expect(screen.queryByTestId("proposal-section-conflict")).toBeNull()
    expect(toasts.show).toHaveBeenCalledWith(expect.objectContaining({ kind: "success" }))
  })

  it("Keep mine failure keeps the banner and toasts the error", async () => {
    resolveAsync.mockRejectedValueOnce(new Error("boom"))
    renderWorkspace()
    fireEvent.change(contentBox(), { target: { value: "my text" } })
    act(() => {
      vi.advanceTimersByTime(1600)
    })
    await act(async () => {
      fireEvent.click(screen.getByTestId("proposal-section-keep-mine"))
    })
    expect(screen.getByTestId("proposal-section-conflict")).toBeTruthy()
    expect(toasts.show).toHaveBeenCalledWith(expect.objectContaining({ kind: "error", description: "boom" }))
  })

  it("Keep theirs does not call the resolve hook and restores the server version", () => {
    renderWorkspace()
    fireEvent.change(contentBox(), { target: { value: "my text" } })
    act(() => {
      vi.advanceTimersByTime(1600)
    })
    fireEvent.click(screen.getByTestId("proposal-section-keep-theirs"))
    expect(resolveAsync).not.toHaveBeenCalled()
    expect(screen.queryByTestId("proposal-section-conflict")).toBeNull()
    expect(contentBox().value).toBe("their text")
  })

  it("hides Keep mine without proposal:write but still allows Keep theirs", () => {
    renderWorkspace(false)
    fireEvent.change(contentBox(), { target: { value: "my text" } })
    act(() => {
      vi.advanceTimersByTime(1600)
    })
    expect(screen.queryByTestId("proposal-section-keep-mine")).toBeNull()
    expect(screen.getByTestId("proposal-section-keep-theirs")).toBeTruthy()
  })

  it("non-conflict save errors do not open the banner", () => {
    upsertMutate = vi.fn((_p, options?: { onError?: (e: unknown) => void }) => options?.onError?.(new Error("Failed to upsert proposal section")))
    renderWorkspace()
    fireEvent.change(contentBox(), { target: { value: "my text" } })
    act(() => {
      vi.advanceTimersByTime(1600)
    })
    expect(upsertMutate).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId("proposal-section-conflict")).toBeNull()
  })
})

describe("proposal totals", () => {
  beforeEach(() => {
    sections = [
      baseRow,
      { ...baseRow, id: 8n, title: "Delivery", sequence: 20 },
      { ...baseRow, id: 9n, proposalId: "2", title: "Other proposal" },
    ]
    // The line-item query returns organization-wide data, even when passed a proposal ID.
    lineItems = [
      { id: 11n, proposalId: 1n, sectionId: 7n, quantity: 2, priceUnit: 100, discount: 25, sequence: 10 },
      { id: 12n, proposalId: "1", sectionId: 8n, quantity: 3, priceUnit: 50, discount: 0, sequence: 20 },
      { id: 13n, proposalId: 1n, sectionId: null, quantity: 1, priceUnit: 40, discount: 50, sequence: 30 },
      { id: 21n, proposalId: 2n, sectionId: 9n, quantity: 5, priceUnit: 1000, discount: 10, sequence: 10 },
    ]
  })

  function displayedValue(): string | null {
    const label = screen.queryByText("proposalWorkspace.sectionSidebar.proposalValue")
    return label?.nextElementSibling?.textContent ?? null
  }

  it("totals only this proposal across all sections and unassigned items, including discounts", () => {
    renderWorkspace()
    // 2 × 100 × 75% + 3 × 50 + 1 × 40 × 50% = 320.
    expect(displayedValue()).toBe("$320")
  })

  it("does not show another proposal's value when this proposal has no line items", () => {
    renderWorkspace(true, "3")
    expect(displayedValue()).toBeNull()
  })

  it("recalculates the value when the selected proposal changes", () => {
    const view = renderWorkspace()
    expect(displayedValue()).toBe("$320")

    view.rerender(
      <ProposalWorkspace
        proposalId="2"
        proposalTitle="Other bid"
        organizationId={1n}
        companyId={1n}
        onAnalyze={vi.fn()}
        hooks={makeHooks()}
      />,
    )

    expect(displayedValue()).toBe("$4,500")
  })
})
