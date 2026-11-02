import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, beforeAll, expect, it, vi } from "vitest"

const suggest = vi.hoisted(() => vi.fn())
vi.mock("@lumiere/query-hooks/hooks/ai-forms", () => ({
  useAiFormSuggest: () => ({ mutateAsync: suggest, isPending: false }),
}))
vi.mock("@lumiere/ui", async () => ({
  ...(await import("../components/button")),
  ...(await import("./modular-form")),
  ...(await import("../lib/subscriptions-form-configs")),
  ...(await import("../lib/form-config-merge")),
}))
import { SubscriptionCreateDialog } from "../../../../web/app/(modules)/subscriptions/subscription-create-dialog"

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
  Element.prototype.scrollIntoView ??= () => {}
})
afterEach(() => {
  cleanup()
  suggest.mockReset()
})

it("retains the assistant request across native subscription steps without creating a subscription", async () => {
  const submit = vi.fn()
  suggest.mockResolvedValue({
    suggestions: { saleOrderId: { value: "42", confidence: 1 } },
    validation_notes: [],
    sources: [],
  })
  render(
    <SubscriptionCreateDialog
      open
      onClose={() => {}}
      scope={{ organizationId: 1n, companyId: 7n }}
      orders={[
        {
          id: 42,
          organizationId: 1,
          companyId: 7,
          state: "sale",
          reference: "SO-42",
        },
      ]}
      plans={[
        { id: 9, organizationId: 1, companyId: 7, active: true, name: "Plan" },
      ]}
      sourceState={{ status: "ready" }}
      onRetry={() => {}}
      onSubmit={submit}
      assistantPrompt="Set up a subscription from SO-42"
    />,
  )
  expect(
    screen.getByDisplayValue("Set up a subscription from SO-42"),
  ).toBeTruthy()
  expect(suggest).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole("button", { name: "Suggest values" }))
  await waitFor(() =>
    expect(
      (
        screen.getByRole("button", {
          name: "Apply suggestions",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  )
  expect(suggest.mock.calls[0]![0]).toMatchObject({
    companyId: 7,
    entityType: "subscription",
    rawText: "Set up a subscription from SO-42",
  })
  fireEvent.click(screen.getByRole("button", { name: "Apply suggestions" }))
  fireEvent.click(screen.getByTestId("form-submit-subscription-create-order"))
  await screen.findByTestId("form-submit-subscription-create-plan")
  expect(
    screen.getByDisplayValue("Set up a subscription from SO-42"),
  ).toBeTruthy()
  expect(submit).not.toHaveBeenCalled()
})
