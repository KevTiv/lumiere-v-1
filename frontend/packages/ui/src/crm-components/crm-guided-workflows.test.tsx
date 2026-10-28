import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createInstance } from "i18next"
import en from "../../../i18n/src/locales/en.json"
import { ModularForm } from "../forms/modular-form"
import { newLeadForm, newActivityForm, convertLeadForm } from "../lib/crm-form-configs"
import { mergeFieldDefaultValues } from "../lib/form-config-merge"
import { CrmRecordActions } from "../../../../web/app/(modules)/crm/crm-record-actions"
import { CrmMyWorkPanel } from "../../../../web/app/(modules)/crm/crm-my-work-panel"
import type { CrmActionContext } from "../../../../web/app/(modules)/crm/crm-workflow"

const hooks = vi.hoisted(() => ({ complete: vi.fn(), notice: vi.fn() }))
if (typeof globalThis.PointerEvent === "undefined") {
  Object.defineProperty(globalThis, "PointerEvent", { value: MouseEvent, configurable: true })
}
const i18n = createInstance()
await i18n.init({ lng: "en", resources: { en: { translation: en } }, initImmediate: false })
vi.mock("@lumiere/i18n", () => ({ useTranslation: () => ({ t: i18n.t, i18n }) }))
vi.mock("@lumiere/erp-session", () => ({ useErpSession: () => ({ identity: "ab12" }) }))
vi.mock("@lumiere/query-hooks/hooks/ai-forms", () => ({ useAiFormSuggest: () => ({}) }))
vi.mock("@lumiere/query-hooks/hooks/crm", () => ({
  useCompleteActivity: () => ({ mutateAsync: hooks.complete, isPending: false }),
}))
vi.mock("../lib/workflow-toast", () => ({ showWorkflowToast: hooks.notice }))
vi.mock("sonner", () => ({ toast: { warning: vi.fn(), success: vi.fn(), error: vi.fn() } }))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})
const ready: CrmActionContext = {
  ready: true,
  canWrite: true,
  canCreateActivity: true,
  canConvertLead: true,
  busy: false,
  companyReady: true,
  stagesReady: true,
  wonStageReady: true,
  lostReasonsReady: true,
  orderSetupReady: true,
  activityTypesReady: true,
}

describe("CRM guided workflows", () => {
  it("creates a new lead with essential fields, then offers qualification and conversion in sequence", async () => {
    const save = vi.fn()
    render(<ModularForm config={newLeadForm(i18n.t)} onSubmit={save} />)
    fireEvent.change(screen.getByTestId("form-field-contactName"), { target: { value: "Jane" } })
    expect(screen.getByText("Qualification and value").closest("details")?.open).toBe(false)
    fireEvent.click(screen.getByRole("button", { name: "Save lead" }))
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({ contactName: "Jane", state: "new" }),
      ),
    )
    cleanup()
    const action = vi.fn()
    const { rerender } = render(
      <CrmRecordActions
        kind="lead"
        record={{ id: 7, state: "new" }}
        context={ready}
        onAction={action}
      />,
    )
    expect(screen.queryByRole("button", { name: "Convert lead" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Qualify lead" }))
    expect(action).toHaveBeenCalledWith("qualify", expect.objectContaining({ id: 7 }))
    rerender(
      <CrmRecordActions
        kind="lead"
        record={{ id: 7, state: "qualified" }}
        context={ready}
        onAction={action}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Convert lead" }))
    expect(action).toHaveBeenCalledWith("convertLead", expect.objectContaining({ id: 7 }))
  })

  it("requires a stage only when an opportunity is being created", async () => {
    const save = vi.fn()
    render(
      <ModularForm
        config={convertLeadForm(i18n.t, [{ value: "9", label: "New deal" }])}
        onSubmit={save}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Convert lead" }))
    expect(save).not.toHaveBeenCalled()
    expect(screen.getAllByRole("alert").length).toBeGreaterThan(0)
    fireEvent.click(screen.getByRole("checkbox", { name: "Create opportunity" }))
    expect(screen.queryByTestId("form-field-opportunityStageId")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Convert lead" }))
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({ createContact: true, createOpportunity: false }),
      ),
    )
  })

  it("schedules with a configured activity type ID rather than a display name", async () => {
    const save = vi.fn()
    const form = mergeFieldDefaultValues(newActivityForm(i18n.t, [{ value: "4", label: "Call" }]), {
      dateDeadline: "2026-10-29",
    })
    render(<ModularForm config={form} onSubmit={save} />)
    fireEvent.change(screen.getByTestId("form-field-summary"), { target: { value: "Call Jane" } })
    fireEvent.click(screen.getByRole("button", { name: "Schedule activity" }))
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({ activityTypeId: "4", summary: "Call Jane" }),
      ),
    )
  })

  it("explains disabled record actions and prevents mutation while saving", () => {
    const action = vi.fn()
    render(
      <CrmRecordActions
        kind="opportunity"
        record={{ id: 3, partnerId: 4, stageName: "Proposal" }}
        context={{ ...ready, busy: true }}
        onAction={action}
      />,
    )
    const button = screen.getByRole("button", { name: "Move stage" }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(
      document.getElementById(button.getAttribute("aria-describedby")!)?.textContent,
    ).toContain("Saving changes")
    expect(screen.getByText("Stage: Proposal")).toBeTruthy()
    fireEvent.click(button)
    expect(action).not.toHaveBeenCalled()
  })

  it("shows unavailable sources rather than an empty-work success state", () => {
    render(
      <CrmMyWorkPanel
        organizationId={7}
        companyId={3n}
        activities={{ rows: [], state: { status: "error", onRetry: vi.fn() } }}
        opportunities={{ rows: [], state: { status: "denied" } }}
        leads={{ rows: [], state: { status: "ready" } }}
        contacts={{ rows: [], state: { status: "ready" } }}
        canComplete={false}
        canCreateLead={false}
        onCreateLead={() => {}}
        onOpenRecord={() => {}}
      />,
    )
    expect(screen.queryByText("No overdue follow-ups.")).toBeNull()
    expect(screen.getByText("This list could not load. Retry to see your work.")).toBeTruthy()
    expect(screen.getByText("You do not have access to this list.")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "New lead" })).toBeNull()
  })

  it("opens the linked record from My Work and reports completion failures without hiding the activity", async () => {
    const open = vi.fn()
    hooks.complete.mockRejectedValueOnce(new Error("Connection interrupted"))
    render(
      <CrmMyWorkPanel
        organizationId={7}
        companyId={3n}
        activities={{
          rows: [{ id: 4, assignedTo: "ab12", resModel: "lead", resId: 7, summary: "Call Jane" }],
          state: { status: "ready" },
        }}
        opportunities={{ rows: [], state: { status: "ready" } }}
        leads={{ rows: [{ id: 7, contactName: "Jane" }], state: { status: "ready" } }}
        contacts={{ rows: [], state: { status: "ready" } }}
        canComplete
        canCreateLead={false}
        onCreateLead={() => {}}
        onOpenRecord={open}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Jane" }))
    expect(open).toHaveBeenCalledWith("lead", "7")
    fireEvent.click(screen.getByRole("button", { name: i18n.t("crm.chatter.markDone") }))
    await waitFor(() =>
      expect(hooks.notice).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "error", description: "Connection interrupted" }),
      ),
    )
    expect(screen.getByText("Call Jane")).toBeTruthy()
  })

  it("retains a lead draft after a failed save", async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error("Please retry"))
    render(<ModularForm config={newLeadForm(i18n.t)} onSubmit={save} />)
    fireEvent.change(screen.getByTestId("form-field-contactName"), {
      target: { value: "Keep this enquiry" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Save lead" }))
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Please retry"))
    expect((screen.getByTestId("form-field-contactName") as HTMLInputElement).value).toBe(
      "Keep this enquiry",
    )
  })
})
