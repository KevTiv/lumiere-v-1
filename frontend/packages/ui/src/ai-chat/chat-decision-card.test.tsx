import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import type { ChatDecisionAnswer, ChatDecisionRequest } from "../lib/chat-decision-types"

vi.mock("@lumiere/i18n", () => ({ useTranslation: () => ({ t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key }) }))

import { ChatDecisionCard } from "./chat-decision-card"

afterEach(cleanup)
beforeAll(() => { vi.stubGlobal("PointerEvent", MouseEvent) })
afterAll(() => { vi.unstubAllGlobals() })

const request: ChatDecisionRequest = {
  id: "farm-import-1", revision: 1, question: "What should I do with these files?", allowOther: true,
  options: [
    { id: "prepare_import", label: "Prepare an import", description: "Inspect the files and prepare a review before creating records.", recommended: true },
    { id: "inspect_only", label: "Inspect only", description: "Show the contents without preparing records." },
  ],
}

describe("Chat decision card", () => {
  it("presents a clear unselected question with accessible option labels and descriptions", () => {
    const onSubmit = vi.fn()
    render(<ChatDecisionCard request={request} onSubmit={onSubmit} />)
    expect(screen.getByRole("radiogroup", { name: request.question })).toBeTruthy()
    const radios = screen.getAllByRole("radio")
    expect(radios).toHaveLength(3)
    for (const radio of radios) expect(radio.getAttribute("aria-checked")).toBe("false")
    const first = screen.getByRole("radio", { name: "Prepare an import" })
    expect(first.getAttribute("aria-describedby")).toBe(screen.getByText(request.options[0].description!).id)
    expect(screen.getByText("Recommended")).toBeTruthy()
    expect((screen.getByRole("button", { name: "Submit answer" }) as HTMLButtonElement).disabled).toBe(true)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it("never submits when choosing an option and sends the exact revision only on explicit submit", async () => {
    const onSubmit = vi.fn(async () => {})
    render(<ChatDecisionCard request={request} onSubmit={onSubmit} />)
    fireEvent.click(screen.getByRole("radio", { name: "Prepare an import" }))
    expect(onSubmit).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Submit answer" }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledExactlyOnceWith({ requestId: request.id, expectedRevision: 1, optionId: "prepare_import" }))
    expect(await screen.findByRole("status")).toHaveProperty("textContent", "Answer saved.")
    expect((screen.getByRole("button", { name: "Submit answer" }) as HTMLButtonElement).disabled).toBe(true)
  })

  it("offers Other with a required, bounded explanation and an explicit submit", async () => {
    const onSubmit = vi.fn(async () => {})
    render(<ChatDecisionCard request={{ ...request, otherLabel: "Something else" }} onSubmit={onSubmit} />)
    expect(screen.queryByRole("textbox")).toBeNull()
    fireEvent.click(screen.getByRole("radio", { name: "Something else" }))
    const text = screen.getByRole("textbox", { name: "Tell us what you want to do" }) as HTMLTextAreaElement
    expect(text.maxLength).toBe(2000)
    const submit = screen.getByRole("button", { name: "Submit answer" }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    fireEvent.change(text, { target: { value: "   " } })
    expect(submit.disabled).toBe(true)
    fireEvent.change(text, { target: { value: "x".repeat(2001) } })
    expect(submit.disabled).toBe(true)
    fireEvent.change(text, { target: { value: "  Group the historical snapshots by location.  " } })
    expect(onSubmit).not.toHaveBeenCalled()
    fireEvent.click(submit)
    await waitFor(() => expect(onSubmit).toHaveBeenCalledExactlyOnceWith({ requestId: request.id, expectedRevision: 1, optionId: "other", otherText: "Group the historical snapshots by location." }))
  })

  it("omits Other when unavailable and supports three regular choices", () => {
    render(<ChatDecisionCard request={{ ...request, allowOther: false, options: [...request.options, { id: "archive", label: "Keep files only" }] }} onSubmit={vi.fn()} />)
    expect(screen.queryByRole("radio", { name: "Other" })).toBeNull()
    expect(screen.getAllByRole("radio")).toHaveLength(3)
  })

  it("uses the host's action-specific label after selection without automatically approving", () => {
    const onSubmit = vi.fn()
    render(<ChatDecisionCard request={request} onSubmit={onSubmit} submitLabels={{ prepare_import: "Approve preparation", inspect_only: "Approve inspection", other: "Send instructions" }} />)
    expect(screen.getByRole("button", { name: "Submit answer" })).toBeTruthy()
    fireEvent.click(screen.getByRole("radio", { name: "Prepare an import" }))
    expect(screen.getByRole("button", { name: "Approve preparation" })).toBeTruthy()
    fireEvent.click(screen.getByRole("radio", { name: "Inspect only" }))
    expect(screen.getByRole("button", { name: "Approve inspection" })).toBeTruthy()
    fireEvent.click(screen.getByRole("radio", { name: "Other" }))
    expect(screen.getByRole("button", { name: "Send instructions" })).toBeTruthy()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it("prevents duplicate submissions and disables all input while awaiting acknowledgement", async () => {
    let resolve!: () => void
    const onSubmit = vi.fn(() => new Promise<void>(done => { resolve = done }))
    render(<ChatDecisionCard request={request} onSubmit={onSubmit} />)
    fireEvent.click(screen.getByRole("radio", { name: "Inspect only" }))
    const form = screen.getByTestId("chat-decision-card")
    fireEvent.submit(form)
    fireEvent.submit(form)
    expect(onSubmit).toHaveBeenCalledOnce()
    expect((screen.getByRole("button", { name: "Saving answer…" }) as HTMLButtonElement).disabled).toBe(true)
    for (const radio of screen.getAllByRole("radio")) expect(radio.getAttribute("aria-disabled")).toBe("true")
    await act(async () => resolve())
    fireEvent.submit(form)
    expect(onSubmit).toHaveBeenCalledOnce()
  })

  it("preserves selection and text after a transient submission failure", async () => {
    const onSubmit = vi.fn<(answer: ChatDecisionAnswer) => Promise<void>>().mockRejectedValueOnce(new Error("Reply not confirmed. Check the saved decision.")).mockResolvedValueOnce(undefined)
    render(<ChatDecisionCard request={request} onSubmit={onSubmit} />)
    fireEvent.click(screen.getByRole("radio", { name: "Other" }))
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Keep only the location summaries" } })
    fireEvent.click(screen.getByRole("button", { name: "Submit answer" }))
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Reply not confirmed. Check the saved decision.")
    expect(screen.getByRole("radio", { name: "Other" }).getAttribute("aria-checked")).toBe("true")
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Keep only the location summaries")
    fireEvent.click(screen.getByRole("button", { name: "Submit answer" }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2))
    expect(onSubmit.mock.calls[1][0]).toEqual(onSubmit.mock.calls[0][0])
  })

  it.each(["id", "revision", "scope"])("resets pending input and ignores late errors when %s changes", async (changed) => {
    let reject!: (error: Error) => void
    const onSubmit = vi.fn(() => new Promise<void>((_done, fail) => { reject = fail }))
    const { rerender } = render(<ChatDecisionCard request={request} scopeKey="actor-one:company-one" onSubmit={onSubmit} />)
    fireEvent.click(screen.getByRole("radio", { name: "Other" }))
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Private old task instruction" } })
    fireEvent.click(screen.getByRole("button", { name: "Submit answer" }))
    const next = { ...request, ...(changed === "id" ? { id: "next-task" } : {}), ...(changed === "revision" ? { revision: 2 } : {}) }
    rerender(<ChatDecisionCard request={next} scopeKey={changed === "scope" ? "actor-two:company-two" : "actor-one:company-one"} onSubmit={onSubmit} />)
    expect(screen.queryByRole("textbox")).toBeNull()
    for (const radio of screen.getAllByRole("radio")) expect(radio.getAttribute("aria-checked")).toBe("false")
    await act(async () => reject(new Error("Private old task failure")))
    expect(screen.queryByRole("alert")).toBeNull()
    expect((screen.getByRole("button", { name: "Submit answer" }) as HTMLButtonElement).disabled).toBe(true)
  })

  it("prevents dispatch when externally disabled or request options are malformed", () => {
    const onSubmit = vi.fn()
    const { rerender } = render(<ChatDecisionCard request={request} disabled onSubmit={onSubmit} />)
    fireEvent.click(screen.getByRole("radio", { name: "Prepare an import" }))
    fireEvent.submit(screen.getByTestId("chat-decision-card"))
    expect(onSubmit).not.toHaveBeenCalled()
    rerender(<ChatDecisionCard request={{ ...request, revision: 2, options: [request.options[0], request.options[0]] }} onSubmit={onSubmit} />)
    expect(screen.getByRole("alert").textContent).toContain("unavailable")
    expect(screen.queryByRole("button", { name: "Submit answer" })).toBeNull()
  })
})
