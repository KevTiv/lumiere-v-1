import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { ReactNode } from "react"

const hooks = vi.hoisted(() => {
  const read = () => ({ data: [] as object[], isLoading: false, isPending: false, isFetching: false, isError: false, error: undefined as unknown, refetch: vi.fn() })
  const mutation = () => ({ mutateAsync: vi.fn().mockResolvedValue(undefined), isPending: false })
  return {
    conversations: read(), messages: read(), phones: read(), templates: read(), batches: read(), evidence: read(), exclusions: read(), jobs: read(), errors: read(),
    open: mutation(), append: mutation(), update: mutation(), createBatch: mutation(), createReminder: mutation(), createTemplate: mutation(), review: mutation(), rollback: mutation(),
  }
})
vi.mock("@lumiere/i18n", () => ({ useTranslation: () => ({
  t: (key: string, options?: string | { defaultValue?: string; [key: string]: unknown }) => {
    const text = typeof options === "string" ? options : options?.defaultValue ?? key
    return text.replace(/\{\{(\w+)\}\}/g, (_all, name: string) => typeof options === "object" ? String(options[name] ?? "") : "")
  }, i18n: { language: "en" },
}) }))
vi.mock("@lumiere/erp-session", () => ({ useErpSession: () => ({ identity: "accountant", organizationId: 1 }) }))
vi.mock("@lumiere/query-hooks/hooks/ai-forms", () => ({ useAiFormSuggest: () => ({ isPending: false }) }))
vi.mock("next/link", () => ({ default: ({ children, href, ...props }: { children: ReactNode; href: string }) => <a href={href} {...props}>{children}</a> }))
vi.mock("@lumiere/ui", async () => {
  const { FormModal } = await import("../forms/form-modal")
  const { ImportJobStatusPanel } = await import("../import-assistant/import-job-status-panel")
  const configs = await import("../lib/messages-form-configs")
  const { mergeSelectOptionsForFields } = await import("../lib/form-config-merge")
  return {
    ...configs, mergeSelectOptionsForFields, FormModal, ImportJobStatusPanel,
    RuntimeFormModal: ({ staticConfig, ...props }: { staticConfig: Parameters<typeof FormModal>[0]["config"] }) => <FormModal config={staticConfig} {...props as Parameters<typeof FormModal>[0]} />,
    MissingOrganization: () => <p>Choose organization</p>,
  }
})
vi.mock("@lumiere/query-hooks/hooks/crm", () => ({
  useCrmConversations: () => hooks.conversations, useCrmConversationMessages: () => hooks.messages,
  useContactPhoneIdentities: () => hooks.phones, useOpenCrmConversation: () => hooks.open,
  useAppendCrmConversationMessage: () => hooks.append, useUpdateCrmConversation: () => hooks.update,
}))
vi.mock("@lumiere/query-hooks/hooks/messages", () => ({
  useMessageTemplates: () => hooks.templates, useMessageBatches: () => hooks.batches, useOperationalMessages: () => hooks.evidence,
  useMessageBatchExclusions: () => hooks.exclusions,
  useCreateMessageBatch: () => hooks.createBatch, useCreateInvoiceReminderBatch: () => hooks.createReminder,
  useCreateMessageTemplate: () => hooks.createTemplate, useReviewMessageBatch: () => hooks.review,
}))
vi.mock("@lumiere/query-hooks/hooks/import-jobs", async (original) => ({
  ...await original<typeof import("@lumiere/query-hooks/hooks/import-jobs")>(),
  useImportJobs: () => hooks.jobs, useImportJobErrors: () => hooks.errors, useRollbackImportJob: () => hooks.rollback,
}))
import { CrmInboxPanel } from "../../../../web/app/(modules)/crm/crm-inbox-panel"
import { MessageBatchesPanel } from "../../../../web/app/(modules)/messages/message-batches-panel"
import { ImportJobPageClient } from "../../../../web/app/(modules)/settings/import-jobs/[id]/import-job-page-client"

beforeAll(() => {
  if (typeof globalThis.PointerEvent === "undefined") Object.defineProperty(globalThis, "PointerEvent", { value: MouseEvent, configurable: true })
  Element.prototype.scrollIntoView ??= () => {}
})
beforeEach(() => {
  vi.clearAllMocks()
  for (const query of [hooks.conversations, hooks.messages, hooks.phones, hooks.templates, hooks.batches, hooks.evidence, hooks.exclusions, hooks.jobs, hooks.errors]) {
    query.data = []; query.isLoading = false; query.isPending = false; query.isFetching = false; query.isError = false; query.error = undefined
    query.refetch.mockResolvedValue({ data: [], isError: false })
  }
  for (const mutation of [hooks.open, hooks.append, hooks.update, hooks.createBatch, hooks.createReminder, hooks.createTemplate, hooks.review, hooks.rollback]) {
    mutation.isPending = false; mutation.mutateAsync.mockResolvedValue(undefined)
  }
  window.localStorage.clear()
})
afterEach(cleanup)
const batches = () => <MessageBatchesPanel organizationId={1} companyId={2n} contacts={[{ id: "7", name: "Ada", phone: "+250 123" }]} invoices={[]} />
function savedBatch() {
  hooks.batches.data = [{ id: "9007199254740993", organizationId: "1", companyId: "2", templateId: "5", recipientCount: "1", excludedCount: "2", channel: "WhatsApp", status: "PendingApproval", subjectModel: "account_move" }]
  hooks.templates.data = [{ id: "5", name: "Reminder", reviewState: "approved", active: true, locale: "en" }]
  hooks.evidence.data = [{ id: "9", organizationId: "1", companyId: "2", messageBatchId: "9007199254740993", contactId: "7", renderedBody: "Saved invoice 42 is due", status: "PendingApproval" }]
  hooks.exclusions.data = [{ id: "9007199254740993", organizationId: "1", companyId: "2", exclusions: [
    { model: "contact", recordId: "8", contactId: "8", reason: "channel_opted_out" },
    { model: "contact", recordId: "9", contactId: "9", reason: "no_eligible_primary_identity" },
  ] }]
}

describe("Supporting workspace source and recovery states", () => {
  it("shows CRM failure with retry instead of an empty conversation and disables stale commands", () => {
    hooks.conversations.data = [{ id: "3", contactId: "7", status: "open" }]
    hooks.conversations.isError = true; hooks.conversations.error = { status: 500 }
    render(<CrmInboxPanel organizationId={1} contactId={7n} />)
    expect(screen.getByRole("alert").textContent).toContain("could not be loaded")
    expect(screen.queryByText("No open conversation")).toBeNull()
    expect(screen.getByRole("button", { name: "Open thread" }).hasAttribute("disabled")).toBe(true)
    fireEvent.click(screen.getByRole("button", { name: "Retry" }))
    expect(hooks.conversations.refetch).toHaveBeenCalledOnce()
    expect(hooks.open.mutateAsync).not.toHaveBeenCalled()
  })
  it("keeps an outbound CRM draft after rejection and describes queueing rather than delivery", async () => {
    hooks.conversations.data = [{ id: "3", contactId: "7", status: "open", channel: "WhatsApp" }]
    hooks.append.mutateAsync.mockRejectedValue(new Error("Provider setup unavailable"))
    render(<CrmInboxPanel organizationId={1} contactId={7n} />)
    fireEvent.change(screen.getByRole("textbox", { name: "Outbound message" }), { target: { value: "Please check invoice 42" } })
    fireEvent.click(screen.getByRole("button", { name: "Queue message" }))
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Provider setup unavailable")
    expect((screen.getByRole("textbox", { name: "Outbound message" }) as HTMLInputElement).value).toBe("Please check invoice 42")
    expect(hooks.append.mutateAsync.mock.calls[0][0].params.status).toBe("queued")
  })
  it("does not call a denied batch source empty or expose cached evidence", () => {
    savedBatch(); hooks.batches.isError = true; hooks.batches.error = { status: 403 }
    render(batches())
    expect(screen.getByText("You do not have access to these records.")).toBeTruthy()
    expect(screen.queryByText("No message batches")).toBeNull()
    expect(screen.queryByText("Saved invoice 42 is due")).toBeNull()
    expect(screen.queryByRole("button", { name: "Review & approve" })).toBeNull()
  })
  it("shows the captured creation-time exclusion evidence", () => {
    savedBatch()
    render(batches())
    expect(screen.getByText("Excluded at batch creation")).toBeTruthy()
    expect(screen.getByText("The contact opted out of this channel.")).toBeTruthy()
    expect(screen.getByText("No eligible primary contact identity is available.")).toBeTruthy()
    expect(screen.queryByText(/The complete creation-time exclusion reasons are unavailable/)).toBeNull()
  })
  it("does not expose cached exclusion reasons when their evidence source is denied", () => {
    savedBatch(); hooks.exclusions.isError = true; hooks.exclusions.error = { status: 403 }
    render(batches())
    expect(screen.getByText("You do not have access to these records.")).toBeTruthy()
    expect(screen.getByText(/The complete creation-time exclusion reasons are unavailable/)).toBeTruthy()
    expect(screen.queryByText("Excluded at batch creation")).toBeNull()
    expect(screen.queryByText("The contact opted out of this channel.")).toBeNull()
    expect(screen.queryByText("No eligible primary contact identity is available.")).toBeNull()
    expect(screen.getByText("Saved invoice 42 is due")).toBeTruthy()
    expect(hooks.review.mutateAsync).not.toHaveBeenCalled()
  })
  it("hides denied recipient evidence and blocks approval despite cached content", async () => {
    savedBatch(); hooks.evidence.isError = true; hooks.evidence.error = { status: 403 }
    render(batches())
    fireEvent.click(screen.getByRole("button", { name: "Review & approve" }))
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText("You do not have access to these records.")).toBeTruthy()
    expect(screen.queryByText("Saved invoice 42 is due")).toBeNull()
    expect(within(dialog).getByRole("button", { name: "Approve" }).hasAttribute("disabled")).toBe(true)
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /I have reviewed the saved recipients/ }))
    fireEvent.click(within(dialog).getByRole("button", { name: "Approve" }))
    expect(hooks.review.mutateAsync).not.toHaveBeenCalled()
  })
  it("reviews saved content and retains a deliberate rejection reason after failure", async () => {
    savedBatch(); hooks.review.mutateAsync.mockRejectedValue(new Error("Review was rejected"))
    render(batches())
    fireEvent.click(screen.getByRole("button", { name: "Reject" }))
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText("Saved invoice 42 is due")).toBeTruthy()
    fireEvent.change(within(dialog).getByRole("textbox", { name: /Rejection reason/ }), { target: { value: "The customer already paid" } })
    fireEvent.click(within(dialog).getByRole("button", { name: "Reject" }))
    await waitFor(() => expect(hooks.review.mutateAsync).toHaveBeenCalledWith({ batchId: 9007199254740993n, params: { approved: false, reason: "The customer already paid" } }))
    expect((within(dialog).getByRole("textbox", { name: /Rejection reason/ }) as HTMLTextAreaElement).value).toBe("The customer already paid")
    expect(within(dialog).getByText("Review was rejected")).toBeTruthy()
  })
  it("blocks approval when complete recipient content is unavailable", async () => {
    savedBatch(); hooks.evidence.data = []
    render(batches())
    fireEvent.click(screen.getByRole("button", { name: "Review & approve" }))
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByRole("button", { name: "Approve" }).hasAttribute("disabled")).toBe(true)
    expect(hooks.review.mutateAsync).not.toHaveBeenCalled()
  })
  it("requires evidence acknowledgement before approving the exact saved batch", async () => {
    savedBatch()
    render(batches())
    fireEvent.click(screen.getByRole("button", { name: "Review & approve" }))
    const dialog = await screen.findByRole("dialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Approve" }))
    expect(hooks.review.mutateAsync).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /I have reviewed the saved recipients/ }))
    fireEvent.click(within(dialog).getByRole("button", { name: "Approve" }))
    await waitFor(() => expect(hooks.review.mutateAsync).toHaveBeenCalledWith({ batchId: 9007199254740993n, params: { approved: true, reason: undefined } }))
  })
  it("searches recipient choices while retaining selections hidden by the search", async () => {
    savedBatch()
    render(<MessageBatchesPanel organizationId={1} companyId={2n} contacts={[{ id: "7", name: "Ada" }, { id: "8", name: "Grace" }]} invoices={[]} />)
    fireEvent.click(screen.getByRole("button", { name: "New batch" }))
    const dialog = await screen.findByRole("dialog")
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /Ada/ }))
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Search available recipients or invoices" }), { target: { value: "Grace" } })
    expect(within(dialog).queryByRole("checkbox", { name: /Ada/ })).toBeNull()
    expect(within(dialog).getByText("1 selected")).toBeTruthy()
    fireEvent.change(within(dialog).getByRole("textbox", { name: "Search available recipients or invoices" }), { target: { value: "Ada" } })
    expect(within(dialog).getByRole("checkbox", { name: /Ada/ }).getAttribute("aria-checked")).toBe("true")
  })
  it("shows a failed import lookup as unavailable instead of not found", () => {
    hooks.jobs.isError = true; hooks.jobs.error = { status: 500 }
    render(<ImportJobPageClient organizationId={1} jobId="42" />)
    expect(screen.getByRole("alert").textContent).toContain("could not be loaded")
    expect(screen.queryByText("common.importAssistant.jobNotFound")).toBeNull()
    expect(hooks.rollback.mutateAsync).not.toHaveBeenCalled()
  })
  it("confirms the import scope and refreshes before dispatching exact rollback", async () => {
    const job = { id: "9007199254740993", tableName: "contact", fileName: "customers.csv", status: "success", importedRows: 3 }
    hooks.jobs.data = [job]; hooks.jobs.refetch.mockResolvedValue({ data: [job], isError: false })
    render(<ImportJobPageClient organizationId={1} jobId={job.id} />)
    fireEvent.click(screen.getByRole("button", { name: "common.importAssistant.rollbackImport" }))
    const dialog = await screen.findByRole("alertdialog")
    expect(dialog.textContent).toContain("customers.csv (contact)")
    expect(hooks.rollback.mutateAsync).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm rollback" }))
    await waitFor(() => expect(hooks.rollback.mutateAsync).toHaveBeenCalledWith(9007199254740993n))
    expect(hooks.jobs.refetch).toHaveBeenCalledOnce()
  })
  it("does not roll back an import that becomes ineligible during review", async () => {
    const job = { id: "42", tableName: "contact", fileName: "customers.csv", status: "success" }
    hooks.jobs.data = [job]; hooks.jobs.refetch.mockResolvedValue({ data: [{ ...job, status: "rolled_back" }], isError: false })
    render(<ImportJobPageClient organizationId={1} jobId="42" />)
    fireEvent.click(screen.getByRole("button", { name: "common.importAssistant.rollbackImport" }))
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Confirm rollback" }))
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("no longer eligible"))
    expect(hooks.rollback.mutateAsync).not.toHaveBeenCalled()
  })
})
