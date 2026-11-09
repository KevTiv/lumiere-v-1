import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest"
import type { ReactNode } from "react"
import type { ChatImportTask } from "../../../../web/lib/chat-import-task"

const controls = vi.hoisted(() => ({
  list: vi.fn(), submit: vi.fn(), recover: vi.fn(), fetch: vi.fn(),
  latest: null as { onImportFiles?: (files: File[]) => Promise<void>; content: ReactNode } | null,
}))
vi.mock("@lumiere/i18n", () => ({ useTranslation: () => ({ t: (key: string, options?: Record<string, unknown> & { defaultValue?: string }) => options?.defaultValue?.replace(/\{\{(\w+)\}\}/g, (_, name) => String(options?.[name] ?? "")) ?? key }) }))
vi.mock("../../../../web/lib/api-fetch", () => ({ apiFetch: controls.fetch }))
vi.mock("../../../../web/lib/data-import-workspace", () => ({ DataImportWorkspace: () => <p>Source review</p> }))
vi.mock("../../../../web/lib/import-review-workspace", () => ({ ImportReviewWorkspace: () => <p>Source inspection</p> }))
vi.mock("@lumiere/ui", async () => ({ ChatDecisionCard: (await import("./chat-decision-card")).ChatDecisionCard }))
vi.mock("../../../../web/lib/chat-import-task", async actual => ({
  ...(await actual<typeof import("../../../../web/lib/chat-import-task")>()),
  listChatImportTasks: controls.list, submitChatImportFiles: controls.submit, recoverChatImportPointer: controls.recover,
}))
import { useChatImportTasks } from "../../../../web/lib/chat-import-tasks"
import { chatImportDecisionStorageKey } from "../../../../web/lib/chat-import-task"

function Harness({ companyId = 3 }: { companyId?: number }) {
  const imports = useChatImportTasks({ identity: "actor", organizationId: 7, companyId, conversationKey: "conversation" })
  controls.latest = imports
  return <>{imports.content}<button disabled={!imports.onImportFiles} onClick={() => void imports.onImportFiles?.([])}>Submit files</button></>
}
function task(id = "a", status: ChatImportTask["status"] = "needs_review"): ChatImportTask {
  return { requestId: id.repeat(32), companyId: "3", conversationKey: "conversation", status, createdAt: "2026-11-01T12:00:00Z", warnings: [], error: null,
    decision: { id: `${id.repeat(32)}:purpose`, revision: 2, status: "approved", question: "What should I do with these files?", options: [{ id: "prepare_import", label: "Prepare an import" }, { id: "inspect_only", label: "Inspect only" }], allowOther: true, selectedOptionId: "prepare_import", otherText: null, decisionId: "d".repeat(32) }, decisionReceipt: null, decisionHistory: [],
    files: [{ ordinal: 0, fileName: `${id}.csv`, size: 10, sha256: "f".repeat(64) }], reviews: [] }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
function pendingTask(): ChatImportTask {
  const prepared = task()
  return { ...prepared, status: "awaiting_decision", decision: { ...prepared.decision, revision: 1, status: "pending", selectedOptionId: null, otherText: null, decisionId: null } }
}
function acknowledged(body: { decisionId: string; expectedRevision: number; optionId: "prepare_import" | "inspect_only" | "other"; otherText?: string }): ChatImportTask {
  const original = pendingTask()
  const receipt = { decisionId: body.decisionId, optionId: body.optionId, otherText: body.otherText ?? null, revision: body.expectedRevision + 1, createdAt: "2026-11-01T12:01:00Z" }
  return { ...original, status: body.optionId === "other" ? "awaiting_decision" : body.optionId === "inspect_only" ? "inspection_ready" : "needs_review",
    decision: { ...original.decision, revision: receipt.revision, status: body.optionId === "other" ? "pending" : "approved", selectedOptionId: body.optionId, otherText: receipt.otherText, decisionId: receipt.decisionId }, decisionReceipt: receipt, decisionHistory: [receipt] }
}

beforeAll(() => { vi.stubGlobal("PointerEvent", MouseEvent) })
afterAll(() => { vi.unstubAllGlobals() })

beforeEach(() => {
  controls.latest = null
  controls.list.mockReset().mockResolvedValue([])
  controls.recover.mockReset().mockResolvedValue({ task: null, pointer: null })
  controls.submit.mockReset()
  controls.fetch.mockReset()
})
afterEach(cleanup)

it("ignores a delayed A submission after an A→B→A roundtrip and newer access denial", async () => {
  const waiting = deferred<ChatImportTask>()
  controls.submit.mockReturnValue(waiting.promise)
  const view = render(<Harness />)
  await waitFor(() => expect(controls.latest?.onImportFiles).toBeTypeOf("function"))
  let completion!: Promise<void>
  act(() => { completion = controls.latest!.onImportFiles!([]) })
  view.rerender(<Harness companyId={4} />)
  await waitFor(() => expect(controls.latest?.onImportFiles).toBeTypeOf("function"))
  controls.list.mockRejectedValueOnce(new Error("Access revoked"))
  view.rerender(<Harness companyId={3} />)
  await screen.findByText("Access revoked")
  await act(async () => { waiting.resolve(task()); await completion })
  expect(screen.queryByRole("link", { name: "Download a.csv" })).toBeNull()
  expect(screen.getByRole("alert").textContent).toBe("Access revoked")
  expect(controls.latest?.onImportFiles).toBeUndefined()
  expect(screen.queryByRole("status")).toBeNull()
})

it("an old submission's finally cannot clear the newer A operation's busy state", async () => {
  const old = deferred<ChatImportTask>(), current = deferred<ChatImportTask>()
  controls.submit.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
  const view = render(<Harness />)
  await waitFor(() => expect(controls.latest?.onImportFiles).toBeTypeOf("function"))
  let oldCompletion!: Promise<void>, newCompletion!: Promise<void>
  act(() => { oldCompletion = controls.latest!.onImportFiles!([]) })
  view.rerender(<Harness companyId={4} />)
  await waitFor(() => expect(controls.latest?.onImportFiles).toBeTypeOf("function"))
  view.rerender(<Harness companyId={3} />)
  await waitFor(() => expect(controls.latest?.onImportFiles).toBeTypeOf("function"))
  act(() => { newCompletion = controls.latest!.onImportFiles!([]) })
  await act(async () => { old.resolve(task("a")); await oldCompletion })
  expect(screen.queryByRole("link", { name: "Download a.csv" })).toBeNull()
  expect(screen.getByRole("status").textContent).toContain("Saving files")
  await act(async () => { current.resolve(task("b")); await newCompletion })
  expect(screen.getByRole("link", { name: "Download b.csv" })).toBeTruthy()
  expect(screen.queryByRole("status")).toBeNull()
})

it("ignores a delayed resume after returning to A with access denied", async () => {
  const waiting = deferred<Response>()
  controls.list.mockResolvedValueOnce([task("a", "saved")]).mockResolvedValue([])
  controls.fetch.mockReturnValue(waiting.promise)
  const view = render(<Harness />)
  fireEvent.click(await screen.findByRole("button", { name: "Resume preparation" }))
  view.rerender(<Harness companyId={4} />)
  await waitFor(() => expect(controls.latest?.onImportFiles).toBeTypeOf("function"))
  controls.list.mockRejectedValueOnce(new Error("Access revoked"))
  view.rerender(<Harness companyId={3} />)
  await screen.findByText("Access revoked")
  await act(async () => { waiting.resolve(new Response(JSON.stringify(task()), { headers: { "Content-Type": "application/json" } })); await waiting.promise })
  expect(screen.queryByRole("link", { name: "Download a.csv" })).toBeNull()
  expect(screen.getByRole("alert").textContent).toBe("Access revoked")
  expect(controls.latest?.onImportFiles).toBeUndefined()
})

it("restores an unselected saved question and waits for explicit approval before processing", async () => {
  controls.list.mockResolvedValue([pendingTask()])
  controls.fetch.mockImplementation(async (_url, init) => new Response(JSON.stringify(acknowledged(JSON.parse(String(init.body))))))
  render(<Harness />)
  await screen.findByRole("radiogroup", { name: "What should I do with these files?" })
  expect(screen.getByRole("button", { name: "Submit answer" })).toHaveProperty("disabled", true)
  for (const radio of screen.getAllByRole("radio")) expect(radio.getAttribute("aria-checked")).toBe("false")
  expect(controls.fetch).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole("radio", { name: "Prepare an import" }))
  expect(controls.fetch).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole("button", { name: "Approve preparation" }))
  await screen.findByText("You approved import preparation. Creating business records still requires a separate review and confirmation.")
  expect(controls.fetch).toHaveBeenCalledOnce()
  const [url, init] = controls.fetch.mock.calls[0]
  expect(url).toBe(`/api/import-tasks/${"a".repeat(32)}/decision`)
  expect(JSON.parse(init.body)).toMatchObject({ expectedRevision: 1, optionId: "prepare_import", companyId: 3 })
  expect(screen.queryByRole("radiogroup")).toBeNull()
})

it("Other saves instructions and renders a new unselected question without starting preparation", async () => {
  controls.list.mockResolvedValue([pendingTask()])
  controls.fetch.mockImplementation(async (_url, init) => new Response(JSON.stringify(acknowledged(JSON.parse(String(init.body))))))
  render(<Harness />)
  fireEvent.click(await screen.findByRole("radio", { name: "Other" }))
  fireEvent.change(screen.getByRole("textbox", { name: "Tell us what you want to do" }), { target: { value: "Keep these as historical evidence only." } })
  expect(controls.fetch).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole("button", { name: "Send instructions" }))
  await screen.findByText("Keep these as historical evidence only.")
  expect(screen.getByText("Your instructions are saved as a note. Custom instructions are not applied automatically when you choose a supported action.")).toBeTruthy()
  expect(screen.getByRole("button", { name: "Submit answer" })).toHaveProperty("disabled", true)
  for (const radio of screen.getAllByRole("radio")) expect(radio.getAttribute("aria-checked")).toBe("false")
  expect(controls.fetch).toHaveBeenCalledOnce()
  expect(JSON.parse(controls.fetch.mock.calls[0][1].body).optionId).toBe("other")
  expect(screen.queryByRole("button", { name: "Resume preparation" })).toBeNull()
})

it("refresh recovers a lost decision receipt without automatically approving again", async () => {
  controls.list.mockResolvedValue([pendingTask()])
  let approved: ChatImportTask | null = null
  let posts = 0
  controls.fetch.mockImplementation(async (_url, init) => {
    if (init?.method === "POST") { posts++; approved = acknowledged(JSON.parse(String(init.body))); throw new Error("lost approval reply") }
    return new Response(null, { status: 404 })
  })
  const view = render(<Harness />)
  fireEvent.click(await screen.findByRole("radio", { name: "Prepare an import" }))
  fireEvent.click(screen.getByRole("button", { name: "Approve preparation" }))
  await screen.findByText(/The decision result is uncertain/)
  view.unmount()
  controls.fetch.mockImplementation(async (url, init) => {
    expect(init?.method).not.toBe("POST")
    expect(url).toContain(`decisionId=${approved!.decision.decisionId}`)
    return new Response(JSON.stringify(approved))
  })
  render(<Harness />)
  await screen.findByText("You approved import preparation. Creating business records still requires a separate review and confirmation.")
  expect(posts).toBe(1)
  expect(screen.queryByRole("radiogroup")).toBeNull()
})

it("a delayed approval cannot republish a task after a scope roundtrip and revoked access", async () => {
  controls.list.mockResolvedValueOnce([pendingTask()]).mockResolvedValue([])
  const waiting = deferred<Response>()
  let approved!: ChatImportTask
  controls.fetch.mockImplementation((_url, init) => { approved = acknowledged(JSON.parse(String(init.body))); return waiting.promise })
  const view = render(<Harness />)
  fireEvent.click(await screen.findByRole("radio", { name: "Inspect only" }))
  fireEvent.click(screen.getByRole("button", { name: "Approve inspection" }))
  view.rerender(<Harness companyId={4} />)
  await waitFor(() => expect(controls.latest?.onImportFiles).toBeTypeOf("function"))
  controls.list.mockRejectedValueOnce(new Error("Access revoked"))
  view.rerender(<Harness companyId={3} />)
  await screen.findByText("Access revoked")
  await act(async () => { waiting.resolve(new Response(JSON.stringify(approved))); await waiting.promise })
  expect(screen.queryByRole("link", { name: "Download a.csv" })).toBeNull()
  expect(screen.getByRole("alert").textContent).toBe("Access revoked")
  expect(controls.latest?.onImportFiles).toBeUndefined()
  expect(controls.fetch).toHaveBeenCalledOnce()
})

it("shows the exact saved answer and instructions before an explicit approval retry", async () => {
  const pending = pendingTask()
  const savedAnswer = { taskRequestId: pending.requestId, questionId: pending.decision.id, decisionId: "d".repeat(32), expectedRevision: 1, optionId: "other", otherText: "Keep these files as historical evidence." }
  window.localStorage.setItem(chatImportDecisionStorageKey({ identity: "actor", organizationId: 7, companyId: 3, conversationKey: "conversation" }, pending.requestId), JSON.stringify(savedAnswer))
  controls.list.mockResolvedValue([pending])
  controls.fetch.mockImplementation(async (_url, init) => init?.method === "POST"
    ? new Response(JSON.stringify(acknowledged(JSON.parse(String(init.body)))))
    : new Response(null, { status: 404 }))
  render(<Harness />)
  await screen.findByText("Saved answer: Other")
  expect(screen.getByText(savedAnswer.otherText)).toBeTruthy()
  expect(screen.queryByRole("radiogroup")).toBeNull()
  expect(controls.fetch.mock.calls.every(([, init]) => init?.method !== "POST")).toBe(true)
  fireEvent.click(screen.getByRole("button", { name: "Retry saved answer" }))
  await screen.findByRole("radiogroup")
  expect(JSON.parse(controls.fetch.mock.calls.find(([, init]) => init?.method === "POST")![1].body)).toEqual({ companyId: 3, decisionId: savedAnswer.decisionId, expectedRevision: 1, optionId: "other", otherText: savedAnswer.otherText })
})
