import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { FormModalProps } from "./form-modal"
import { RuntimeFormModal } from "./runtime-form-modal"

const runtimeState = vi.hoisted(() => ({
  error: "form configuration query failed" as string | null,
  isLoading: false,
  config: null as FormModalProps["config"] | null,
  customFieldIds: [] as string[],
}))

vi.mock("./hooks/use-runtime-form-modal-config", () => ({
  useRuntimeFormModalConfig: ({ staticConfig }: { staticConfig: FormModalProps["config"] }) => ({
    config: runtimeState.config ?? staticConfig,
    isLoading: runtimeState.isLoading,
    error: runtimeState.error,
    customFieldIds: runtimeState.customFieldIds,
    runtimeFromDatabase: false,
  }),
}))

vi.mock("./form-modal", () => ({
  FormModal: (props: FormModalProps) => (
    <div>
      {props.submitError ? <p role="alert">{props.submitError}</p> : null}
      {props.config.sections.flatMap((section) => section.fields).map((field) => <span key={field.id}>{field.label}</span>)}
      {props.renderPreview?.({ name: "Runtime draft" })}
      <button
        type="button"
        disabled={props.submissionDisabled}
        onClick={() => void props.onSubmit?.({ name: "test" })}
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
