import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { ChartOfAccountsView } from "./chart-of-accounts-view"

vi.mock("@lumiere/i18n", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      options?.defaultValue ?? key,
  }),
}))
beforeAll(() => {
  HTMLElement.prototype.scrollIntoView ??= () => undefined
})
afterEach(cleanup)

describe("chart of accounts creation", () => {
  it("submits a receivable with reconciliation in one creation, without an edit request", async () => {
    const onCreate = vi.fn(async () => undefined)
    render(<ChartOfAccountsView accounts={[]} onCreate={onCreate} />)
    fireEvent.click(
      screen.getByRole("button", { name: "accounting.actions.newAccount" }),
    )
    fireEvent.change(
      screen.getByLabelText("accounting.forms.newAccount.fields.code"),
      { target: { value: "1100" } },
    )
    fireEvent.change(
      screen.getByLabelText("accounting.forms.newAccount.fields.name"),
      { target: { value: "Farm customers" } },
    )
    fireEvent.keyDown(
      screen.getByRole("combobox", { name: "Account purpose" }),
      { key: "ArrowDown" },
    )
    fireEvent.click(
      await screen.findByRole("option", {
        name: "Customer balances (receivable)",
      }),
    )
    fireEvent.click(
      screen.getByRole("button", {
        name: "accounting.forms.newAccount.submitLabel",
      }),
    )
    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledExactlyOnceWith({
        code: "1100",
        name: "Farm customers",
        internalGroup: "asset",
        internalType: "receivable",
        reconcile: true,
        openingDebit: 0,
        openingCredit: 0,
      }),
    )
  })
})
