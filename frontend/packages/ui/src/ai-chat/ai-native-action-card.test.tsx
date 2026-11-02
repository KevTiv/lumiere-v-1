import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { AssistantAction } from "@lumiere/query-hooks/assistant-actions"
import { AiNativeActionCard } from "./ai-native-action-card"

vi.mock("@lumiere/i18n", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
afterEach(cleanup)

const action: AssistantAction = {
  version: 1,
  kind: "open_form",
  capabilityKey: "accounting.invoice.create",
  scope: { actorId: "actor-one", organizationId: "11", companyId: "22" },
  prompt: "Prepare an invoice for review",
}

describe("native assistant action card", () => {
  it("requires an available host callback and never executes on render", () => {
    const onOpen = vi.fn()
    const view = render(
      <AiNativeActionCard action={action} label="Prepare invoice" />,
    )
    expect(
      (
        screen.getByRole("button", {
          name: "Prepare invoice",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true)
    view.rerender(
      <AiNativeActionCard
        action={action}
        label="Prepare invoice"
        onOpen={onOpen}
      />,
    )
    expect(onOpen).not.toHaveBeenCalled()
    expect(screen.getByText("aiChat.native.reviewHint")).toBeTruthy()
  })

  it("dispatches the exact scoped intention only once while the host is opening it", async () => {
    let finish!: () => void
    const onOpen = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve
        }),
    )
    render(
      <AiNativeActionCard
        action={action}
        label="Prepare invoice"
        onOpen={onOpen}
      />,
    )
    const button = screen.getByRole("button", { name: "Prepare invoice" })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(onOpen).toHaveBeenCalledExactlyOnceWith(action)
    expect((button as HTMLButtonElement).disabled).toBe(true)
    await act(async () => finish())
    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: "Prepare invoice",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    )
  })

  it("shows a bounded failure without leaking native internal errors or retrying automatically", async () => {
    const onOpen = vi.fn(async () => {
      throw new Error("Private old-company details")
    })
    render(
      <AiNativeActionCard
        action={action}
        label="Prepare invoice"
        onOpen={onOpen}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Prepare invoice" }))
    expect((await screen.findByRole("alert")).textContent).toBe(
      "aiChat.native.openFailed",
    )
    expect(screen.queryByText("Private old-company details")).toBeNull()
    expect(onOpen).toHaveBeenCalledOnce()
  })

  it("suppresses a late failure when the displayed action changes scope", async () => {
    let reject!: (error: Error) => void
    const onOpen = vi.fn(
      () =>
        new Promise<void>((_resolve, fail) => {
          reject = fail
        }),
    )
    const view = render(
      <AiNativeActionCard
        action={action}
        label="Prepare invoice"
        onOpen={onOpen}
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Prepare invoice" }))
    const nextAction = {
      ...action,
      scope: { ...action.scope, actorId: "actor-two", companyId: "33" },
    }
    view.rerender(
      <AiNativeActionCard
        action={nextAction}
        label="Prepare current invoice"
        onOpen={onOpen}
      />,
    )
    await act(async () => reject(new Error("Old company is unavailable")))
    expect(screen.queryByRole("alert")).toBeNull()
    expect(
      (
        screen.getByRole("button", {
          name: "Prepare current invoice",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false)
    expect(onOpen).toHaveBeenCalledOnce()
  })
})
