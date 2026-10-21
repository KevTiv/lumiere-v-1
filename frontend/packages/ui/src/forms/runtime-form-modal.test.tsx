import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { FormModalProps } from "./form-modal"
import { RuntimeFormModal } from "./runtime-form-modal"

const runtimeState = vi.hoisted(() => ({
  error: "form configuration query failed" as string | null,
}))

vi.mock("./hooks/use-runtime-form-modal-config", () => ({
  useRuntimeFormModalConfig: ({ staticConfig }: { staticConfig: FormModalProps["config"] }) => ({
    config: staticConfig,
    isLoading: false,
    error: runtimeState.error,
    customFieldIds: [],
    runtimeFromDatabase: false,
  }),
}))

vi.mock("./form-modal", () => ({
  FormModal: (props: FormModalProps) => (
    <div>
      {props.submitError ? <p role="alert">{props.submitError}</p> : null}
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
