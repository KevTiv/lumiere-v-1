import { cleanup, render, screen } from "@testing-library/react"
import type { TFunction } from "i18next"
import { afterEach, expect, it } from "vitest"
import { EntityBoardCard } from "../entity-views/entity-board-card"
import { CurrencyFormatProvider } from "./currency-context"
import { recordCurrencyColumn } from "./record-currency-column"
import {
  subscriptionsTableConfig,
  subscriptionsWithBoard,
} from "./subscriptions-entity-configs"

afterEach(cleanup)

it("shows the record's currency and never labels an unresolved amount with company currency", () => {
  const { render: cell } = recordCurrencyColumn("totalAmount", "Total")
  render(
    <CurrencyFormatProvider
      defaultCode="USD"
      currencies={[{ id: 7n, code: "EUR" }]}
    >
      {cell?.(0, { currencyId: 7n })}
      {cell?.(12.5, { currencyId: 8n })}
      {cell?.(undefined, { currencyId: 7n })}
    </CurrencyFormatProvider>,
  )
  expect(screen.getByText(/EUR.*0\.00/)).toBeTruthy()
  expect(screen.getByText(/12\.50.*Currency #8/)).toBeTruthy()
  expect(screen.getByText("—")).toBeTruthy()
  expect(screen.queryByText(/USD|\$/)).toBeNull()
})

it("shows the subscription board's known currency and identifies unavailable currencies", () => {
  const t = ((key: string) => key) as TFunction
  const { view } = subscriptionsWithBoard(t, subscriptionsTableConfig(t))
  if (view.mode !== "table-or-board") throw new Error("Expected a board view")
  const { card } = view.board

  render(
    <CurrencyFormatProvider
      defaultCode="USD"
      currencies={[{ id: 7n, code: "EUR" }]}
    >
      <EntityBoardCard
        card={card}
        row={{ code: "Known", recurringMonthly: 0, currencyId: 7n }}
      />
      <EntityBoardCard
        card={card}
        row={{ code: "Unresolved", recurringMonthly: 12.5, currencyId: 8n }}
      />
      <EntityBoardCard
        card={card}
        row={{ code: "Missing", recurringMonthly: 15 }}
      />
    </CurrencyFormatProvider>,
  )

  expect(screen.getByText(/EUR.*0\.00/)).toBeTruthy()
  expect(screen.getByText(/12\.50.*Currency #8/)).toBeTruthy()
  expect(screen.getByText(/15\.00.*Currency not available/)).toBeTruthy()
  expect(screen.queryByText(/USD|\$/)).toBeNull()
})
