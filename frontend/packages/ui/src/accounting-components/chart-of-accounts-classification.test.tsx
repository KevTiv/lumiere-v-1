import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { ChartOfAccountsView } from "./chart-of-accounts-view"

vi.mock("@lumiere/i18n", () => ({
  useTranslation: () => ({
    t: (key: string) => key.split(".").at(-1)?.replace(/^./, c => c.toUpperCase()) ?? key,
  }),
}))
vi.mock("../lib/currency-context", () => ({
  useCurrencyFormat: () => ({ money: (value: number) => `RWF ${value}` }),
}))
afterEach(cleanup)

it.each([
  ["string", (tag: string) => tag],
  ["generated enum", (tag: string) => ({ tag })],
  ["optional generated enum", (tag: string) => ({ some: { tag } })],
] as const)("keeps %s classifications in the correct chart groups", (_shape, group) => {
  render(<ChartOfAccountsView accounts={[
    { id: 1, code: "AR", name: "Farm receivable", internalGroup: group("Asset"), openingBalance: 1200 },
    { id: 2, code: "AP", name: "Farm payable", internalGroup: group("Liability"), openingBalance: -600 },
  ]} />)
  expect(screen.getByRole("tab", { name: "Asset (1)" })).toBeTruthy()
  expect(screen.getByRole("tab", { name: "Liability (1)" })).toBeTruthy()
  expect(within(screen.getByRole("row", { name: /Farm receivable/ })).getByText("Asset")).toBeTruthy()
  expect(within(screen.getByRole("row", { name: /Farm payable/ })).getByText("Liability")).toBeTruthy()
  fireEvent.click(screen.getByRole("tab", { name: "Asset (1)" }))
  expect(screen.getByRole("row", { name: /Farm receivable/ })).toBeTruthy()
  expect(screen.queryByRole("row", { name: /Farm payable/ })).toBeNull()
})
