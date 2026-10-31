import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { FormModalProps } from "./form-modal"
import { RuntimeFormModal } from "./runtime-form-modal"
import type { FormField, FormValues } from "../lib/form-types"
import type { CustomFieldCreateIssue } from "./custom-field-create-admission"

const runtimeState = vi.hoisted(() => ({
  error: "form configuration query failed" as string | null,
  isLoading: false,
  config: null as FormModalProps["config"] | null,
  customFieldIds: [] as string[],
  customFieldCreateIssues: [] as CustomFieldCreateIssue[],
  submitData: { name: "test" } as FormValues,
}))

vi.mock("./hooks/use-runtime-form-modal-config", () => ({
  useRuntimeFormModalConfig: ({ staticConfig }: { staticConfig: FormModalProps["config"] }) => ({
    config: runtimeState.config ?? staticConfig,
    isLoading: runtimeState.isLoading,
    error: runtimeState.error,
    customFieldIds: runtimeState.customFieldIds,
    runtimeFromDatabase: false,
    customFieldCreateIssues: runtimeState.customFieldCreateIssues,
  }),
}))

vi.mock("./form-modal", () => ({
  FormModal: (props: FormModalProps) => (
    <div>
      {props.submitError ? <p role="alert">{props.submitError}</p> : null}
      {props.config.sections.flatMap((section) => section.fields).map((field) => <div key={field.id}><span>{field.label}</span><input aria-label={field.label ?? field.name} disabled={field.disabled} defaultValue={typeof field.defaultValue === "string" ? field.defaultValue : ""} /></div>)}
      {props.renderPreview?.({ name: "Runtime draft" })}
      <button
        type="button"
        disabled={props.submissionDisabled}
        onClick={() => void props.onSubmit?.(runtimeState.submitData)}
      >
        Submit
      </button>
    </div>
  ),
}))

const staticConfig: FormModalProps["config"] = {
  id: "critical-form",
  title: "Critical form",
  sections: [],
}

afterEach(() => {
  cleanup()
  runtimeState.error = "form configuration query failed"
  runtimeState.isLoading = false
  runtimeState.config = null
  runtimeState.customFieldIds = []
  runtimeState.customFieldCreateIssues = []
  runtimeState.submitData = { name: "test" }
})

describe("RuntimeFormModal runtime dependency failure", () => {
  it("forwards authoring tools without replacing runtime validation", () => {
    render(
      <RuntimeFormModal
        open
        onOpenChange={vi.fn()}
        staticConfig={staticConfig}
        moduleId="accounting"
        organizationId={1}
        renderPreview={(values) => <output>{String(values.name)}</output>}
      />,
    )
    expect(screen.getByText("Runtime draft")).toBeTruthy()
    expect((screen.getByRole("button", { name: "Submit" }) as HTMLButtonElement).disabled).toBe(
      true,
    )
  })

  it("shows the dependency error and blocks submission by default", () => {
    const onSubmit = vi.fn()
    render(
      <RuntimeFormModal
        open
        onOpenChange={vi.fn()}
        staticConfig={staticConfig}
        moduleId="accounting"
        organizationId={1}
        onSubmit={onSubmit}
      />,
    )

    expect(screen.getByRole("alert").textContent).toContain(
      "Runtime form configuration is unavailable",
    )
    const submit = screen.getByRole("button", { name: "Submit" })
    expect((submit as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(submit)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it("requires an explicit degraded-safe mode before static submission", () => {
    const onSubmit = vi.fn()
    render(
      <RuntimeFormModal
        open
        onOpenChange={vi.fn()}
        staticConfig={staticConfig}
        moduleId="optional-form"
        organizationId={1}
        runtimeConfigFailureMode="use-static"
        onSubmit={onSubmit}
      />,
    )

    const submit = screen.getByRole("button", { name: "Submit" })
    expect((submit as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(submit)
    expect(onSubmit).toHaveBeenCalledWith({ name: "test" })
  })
})

describe("RuntimeFormModal reviewed submission", () => {
  it("combines caller blocking with a healthy runtime configuration", () => {
    runtimeState.error = null
    render(
      <RuntimeFormModal
        open
        onOpenChange={vi.fn()}
        staticConfig={staticConfig}
        moduleId="accounting"
        organizationId={1}
        submissionDisabled
        onSubmit={vi.fn()}
      />,
    )
    expect((screen.getByRole("button", { name: "Submit" }) as HTMLButtonElement).disabled).toBe(
      true,
    )
  })

  it("caller permission cannot override a failed runtime dependency", () => {
    render(
      <RuntimeFormModal
        open
        onOpenChange={vi.fn()}
        staticConfig={staticConfig}
        moduleId="accounting"
        organizationId={1}
        submissionDisabled={false}
        onSubmit={vi.fn()}
      />,
    )
    expect((screen.getByRole("button", { name: "Submit" }) as HTMLButtonElement).disabled).toBe(
      true,
    )
  })
})

describe("RuntimeFormModal custom-field create readiness", () => {
  const message = "Custom fields cannot be saved during creation. Ask an administrator to use a form without custom fields."
  const createConfig = { ...staticConfig, customFieldCreateUnavailableMessage: message }

  it.each([
    { type: "text" as const, required: true },
    { type: "text" as const, required: false, defaultValue: "" },
    { type: "checkbox" as const, required: false, defaultValue: false },
    { type: "text" as const, required: true, disabled: true },
    { type: "hidden" as const, required: true, defaultValue: "approval" },
    { type: "text" as const, required: true, visibleWhen: { field: "name", equals: "Special" } },
  ])("warns before entry and preserves unsupported configured fields: %o", (field) => {
    runtimeState.error = null
    runtimeState.customFieldIds = ["custom:approval"]
    runtimeState.config = {
      ...createConfig,
      sections: [{ id: "runtime-extra-fields", fields: [{ id: "custom:approval", name: "custom:approval", label: "Approval code", ...field }] }],
    }
    const onSubmit = vi.fn()
    render(<RuntimeFormModal open onOpenChange={vi.fn()} staticConfig={createConfig} moduleId="crm" organizationId={1} onSubmit={onSubmit} />)
    expect(screen.getByRole("alert").textContent).toContain(message)
    expect(screen.getByText("Approval code")).toBeTruthy()
    const button = screen.getByRole("button", { name: "Submit" }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it("keeps ordinary creation available when the resolved form has no custom fields", () => {
    runtimeState.error = null
    const onSubmit = vi.fn()
    render(<RuntimeFormModal open onOpenChange={vi.fn()} staticConfig={createConfig} moduleId="sales" organizationId={1} onSubmit={onSubmit} />)
    expect(screen.queryByRole("alert")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Submit" }))
    expect(onSubmit).toHaveBeenCalledWith({ name: "test" })
  })

  it("does not apply a creation-owner limit to unrelated runtime edit forms", () => {
    runtimeState.error = null
    runtimeState.customFieldIds = ["custom:approval"]
    runtimeState.config = {
      ...staticConfig,
      sections: [{ id: "runtime-extra-fields", fields: [{ id: "custom:approval", name: "custom:approval", label: "Approval code", type: "text" }] }],
    }
    const onSubmit = vi.fn()
    render(<RuntimeFormModal open onOpenChange={vi.fn()} staticConfig={staticConfig} moduleId="crm" organizationId={1} onSubmit={onSubmit} />)
    expect(screen.queryByRole("alert")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Submit" }))
    expect(onSubmit).toHaveBeenCalledWith({ name: "test", metadata: undefined })
  })

  it("waits for runtime configuration instead of opening a temporary unguarded create form", () => {
    runtimeState.error = null
    runtimeState.isLoading = true
    render(<RuntimeFormModal open onOpenChange={vi.fn()} staticConfig={createConfig} moduleId="purchasing" organizationId={1} onSubmit={vi.fn()} />)
    expect(screen.getByTestId("runtime-form-modal-loading-critical-form")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Submit" })).toBeNull()
  })

  it("keeps runtime failure and caller errors explicit rather than falling through to a create", () => {
    runtimeState.error = null
    runtimeState.config = {
      ...createConfig,
      sections: [{ id: "custom", fields: [{ id: "custom:approval", name: "custom:approval", label: "Approval code", type: "text" }] }],
    }
    const { rerender } = render(<RuntimeFormModal open onOpenChange={vi.fn()} staticConfig={createConfig} moduleId="crm" organizationId={1} submitError="Source unavailable" />)
    expect(screen.getByRole("alert").textContent).toContain("Source unavailable")
    runtimeState.error = "Cannot load configuration"
    rerender(<RuntimeFormModal open onOpenChange={vi.fn()} staticConfig={createConfig} moduleId="crm" organizationId={1} />)
    expect(screen.getByRole("alert").textContent).toContain("Runtime form configuration is unavailable")
    expect((screen.getByRole("button", { name: "Submit" }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe("RuntimeFormModal atomic configured creation", () => {
  const createConfig = { ...staticConfig, customFieldCreateCapability: "atomic-configured-v1" as const }
  const reference: FormField = { id: "custom:reference", name: "custom:reference", label: "Reference", type: "text" }
  const config = (field: FormField): FormModalProps["config"] => ({ ...createConfig, sections: [{ id: "fields", fields: [reference, field] }] })

  const unsupported: FormField[] = [
    { id: "custom:extra", name: "custom:extra", label: "Attachment", type: "file" },
    { id: "custom:extra", name: "custom:extra", label: "Password", type: "password" },
    { id: "custom:extra", name: "custom:extra", label: "Internal value", type: "hidden" },
    { id: "custom:extra", name: "custom:extra", label: "Custom editor", type: "custom", component: () => null },
    { id: "custom:extra", name: "custom:extra", label: "Conditional code", type: "text", visibleWhen: { field: "name", equals: "Special" } },
    { id: "custom:extra", name: "custom:extra", label: "Pattern code", type: "text", validation: { pattern: "^INV-" } },
  ]

  it.each(unsupported)("names unsupported $label and blocks entry and dispatch", (field) => {
    runtimeState.error = null
    runtimeState.config = config(field)
    const onSubmit = vi.fn()
    render(<RuntimeFormModal open onOpenChange={vi.fn()} staticConfig={createConfig} moduleId="crm" organizationId={1} onSubmit={onSubmit} />)
    expect(screen.getByRole("alert").textContent).toContain(field.label)
    expect(screen.getByRole("alert").textContent).toContain("No record has been created")
    expect((screen.getByRole("textbox", { name: "Reference" }) as HTMLInputElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole("button", { name: "Submit" }))
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it("retains typed zero, false and exact options through the existing metadata binding", () => {
    runtimeState.error = null
    runtimeState.customFieldIds = ["custom:count", "custom:reviewed", "custom:option"]
    runtimeState.submitData = { name: "Typed record", "custom:count": 0, "custom:reviewed": false, "custom:option": "001" }
    runtimeState.config = { ...createConfig, sections: [{ id: "custom", fields: [
      { id: "custom:count", name: "custom:count", type: "number", defaultValue: 0 },
      { id: "custom:reviewed", name: "custom:reviewed", type: "checkbox", defaultValue: false },
      { id: "custom:option", name: "custom:option", type: "select", options: [{ value: "001", label: "Exact option" }], required: true },
    ] }] }
    const onSubmit = vi.fn()
    render(<RuntimeFormModal open onOpenChange={vi.fn()} staticConfig={createConfig} moduleId="sales" organizationId={1} onSubmit={onSubmit} />)
    expect(screen.queryByRole("alert")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "Submit" }))
    expect(onSubmit).toHaveBeenCalledOnce()
    expect(onSubmit.mock.calls[0]?.[0].name).toBe("Typed record")
    expect(JSON.parse(onSubmit.mock.calls[0]?.[0].metadata)).toEqual({ "custom:count": 0, "custom:reviewed": false, "custom:option": "001" })
  })

  it("cannot bypass raw stored-definition limits through hydrated options or caller transforms", () => {
    runtimeState.error = null
    runtimeState.config = config({ id: "custom:reviewer", name: "custom:reviewer", label: "Reviewer", type: "select", options: [{ value: "actor", label: "Current user" }] })
    runtimeState.customFieldCreateIssues = [{ fieldId: "custom:reviewer", label: "Reviewer", reason: "unavailableChoices" }]
    const onSubmit = vi.fn()
    render(<RuntimeFormModal open onOpenChange={vi.fn()} staticConfig={createConfig} moduleId="crm" organizationId={1} onSubmit={onSubmit} transformConfig={(current) => ({ ...current, sections: [...current.sections, { id: "transformed", fields: [unsupported[0]!] }] })} />)
    expect(screen.getByRole("alert").textContent).toContain("Reviewer")
    expect(screen.getByRole("alert").textContent).toContain("Attachment")
    fireEvent.click(screen.getByRole("button", { name: "Submit" }))
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it("keeps the mounted draft when configuration becomes unsupported and admits it again after correction", () => {
    runtimeState.error = null
    runtimeState.config = { ...createConfig, sections: [{ id: "fields", fields: [reference] }] }
    const props = { open: true, onOpenChange: vi.fn(), staticConfig: createConfig, moduleId: "crm", organizationId: 1, onSubmit: vi.fn() }
    const { rerender } = render(<RuntimeFormModal {...props} />)
    const input = screen.getByRole("textbox", { name: "Reference" }) as HTMLInputElement
    fireEvent.change(input, { target: { value: "Retained draft value" } })
    runtimeState.config = config(unsupported[0]!)
    rerender(<RuntimeFormModal {...props} />)
    expect(screen.getByRole("textbox", { name: "Reference" })).toBe(input)
    expect(input.value).toBe("Retained draft value")
    expect(input.disabled).toBe(true)
    runtimeState.config = { ...createConfig, sections: [{ id: "fields", fields: [reference] }] }
    rerender(<RuntimeFormModal {...props} />)
    expect(input.value).toBe("Retained draft value")
    expect(input.disabled).toBe(false)
  })

  it("requires the real runtime policy even when static fallback was requested", () => {
    const onSubmit = vi.fn()
    render(<RuntimeFormModal open onOpenChange={vi.fn()} staticConfig={createConfig} moduleId="purchasing" organizationId={1} onSubmit={onSubmit} runtimeConfigFailureMode="use-static" />)
    expect(screen.getByRole("alert").textContent).toContain("Runtime form configuration is unavailable")
    fireEvent.click(screen.getByRole("button", { name: "Submit" }))
    expect(onSubmit).not.toHaveBeenCalled()
  })
})
