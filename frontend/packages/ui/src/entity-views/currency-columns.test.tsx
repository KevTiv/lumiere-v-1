import { cleanup, render, renderHook, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("../lib/rbac-context", () => ({ useRBAC: () => ({ checkPermission: () => true }) }))
vi.mock("../components/tooltip", () => ({
  TooltipProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

import { CurrencyFormatProvider } from "../lib/currency-context"
import type { EntityDetailConfig, EntityTableConfig } from "../lib/entity-view-types"
import { EntityDetail } from "./entity-detail"
import { useScopedEntityTableConfig } from "./entity-view"

afterEach(cleanup)

const plain = (text: unknown) => String(text).replace(/ | /g, " ")
const currencies = [
  { id: 7n, code: "RWF" },
  { id: 3n, code: "EUR" },
]

const table: EntityTableConfig = {
  id: "t",
  title: "T",
  rowKey: "id",
  columns: [
    { key: "total", label: "Total", type: "currency", currencyKey: "currencyId", align: "right" },
    { key: "fee", label: "Fee", type: "currency" },
    { key: "custom", label: "Custom", type: "currency", currencyKey: "currencyId", render: () => "mine" },
  ],
} as EntityTableConfig

function scoped(wrapper: (props: { children: ReactNode }) => ReactNode) {
  return renderHook(() => useScopedEntityTableConfig(table), { wrapper }).result.current.columns
}

describe("currency columns", () => {
  it("show each row in its own currency, else the company's, in the user's locale", () => {
    const [total, fee] = scoped(({ children }) => (
      <CurrencyFormatProvider locale="de-DE" defaultCode="EUR" currencies={currencies}>
        {children}
      </CurrencyFormatProvider>
    ))
    expect(plain(total.render?.(1500, { currencyId: 7n }))).toBe("1.500 RWF")
    expect(plain(total.render?.(1500.5, { currencyId: 3n }))).toBe("1.500,50 €")
    expect(plain(total.render?.(1500.5, {}))).toBe("1.500,50 €")
    expect(plain(fee.render?.(2.5, { currencyId: 7n }))).toBe("2,50 €")
  })

  it("are right-aligned by default, in brackets and tinted when negative, and keep their own renderers", () => {
    const [total, fee, custom] = scoped(({ children }) => <>{children}</>)
    expect(total.align).toBe("right")
    expect(fee.align).toBe("right")
    expect(custom.render?.(1, {})).toBe("mine")

    const negative = render(<>{fee.render?.(-12.5, {})}</>)
    expect(negative.container.querySelector(".text-destructive")?.textContent).toBe("($12.50)")
    negative.unmount()
    const positive = render(<>{fee.render?.(12.5, {})}</>)
    expect(positive.container.querySelector(".text-destructive")).toBeNull()
    expect(positive.container.textContent).toBe("$12.50")
  })

  it("follow the provider's row currency field when a column names none, and its own key first", () => {
    const [, fee, custom] = renderHook(() => useScopedEntityTableConfig(table), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <CurrencyFormatProvider locale="de-DE" defaultCode="EUR" currencies={currencies} rowCurrencyKey="currencyId">
          {children}
        </CurrencyFormatProvider>
      ),
    }).result.current.columns
    expect(plain(fee.render?.(1500, { currencyId: 7n }))).toBe("1.500 RWF")
    expect(plain(fee.render?.(2.5, {}))).toBe("2,50 €")
    expect(custom.render?.(1, {})).toBe("mine")
    const own = renderHook(
      () => useScopedEntityTableConfig({ ...table, columns: [{ key: "x", label: "X", type: "currency", currencyKey: "companyCurrencyId" }] }),
      {
        wrapper: ({ children }: { children: ReactNode }) => (
          <CurrencyFormatProvider currencies={currencies} rowCurrencyKey="currencyId">
            {children}
          </CurrencyFormatProvider>
        ),
      },
    ).result.current.columns[0]
    expect(plain(own.render?.(1500, { currencyId: 3n, companyCurrencyId: 7n }))).toBe("RWF 1,500")
  })

  it("keep a column's own alignment", () => {
    const columns = renderHook(
      () => useScopedEntityTableConfig({ ...table, columns: [{ key: "fee", label: "Fee", type: "currency", align: "left" }] }),
    ).result.current.columns
    expect(columns[0].align).toBe("left")
  })

  it("are right-aligned and name their row's currency in the accounting tables", async () => {
    const factories = await import("../lib/accounting-entity-configs")
    // Depreciation lines carry no currency of their own: they follow the asset they belong to.
    const withoutRowCurrency = new Set(["depreciation-lines-table"])
    let checked = 0
    for (const make of Object.values(factories)) {
      if (typeof make !== "function") continue
      let config: { id?: string; view?: { mode?: string; columns?: Array<{ key: string; type?: string; currencyKey?: string; align?: string }> } }
      try {
        config = (make as (t: (key: string) => string) => typeof config)((key) => key)
      } catch {
        continue
      }
      if (config.view?.mode !== "table" || withoutRowCurrency.has(config.id ?? "")) continue
      for (const column of config.view.columns ?? []) {
        if (column.type !== "currency") continue
        checked += 1
        expect(column.currencyKey, `${config.id}.${column.key} names its currency`).toBeTruthy()
        expect(column.align, `${config.id}.${column.key} is right-aligned`).toBe("right")
      }
    }
    expect(checked).toBeGreaterThan(8)
  })
})

describe("currency fields on a record", () => {
  it("read in the record's currency", () => {
    const config: EntityDetailConfig = {
      mode: "detail",
      sections: [{ id: "s", fields: [{ key: "amount", label: "Amount", type: "currency", currencyKey: "currencyId" }] }],
    }
    render(
      <CurrencyFormatProvider locale="de-DE" defaultCode="EUR" currencies={currencies}>
        <EntityDetail config={config} data={{ amount: 1500, currencyId: 7n }} />
      </CurrencyFormatProvider>,
    )
    expect(plain(screen.getByText(/1\.500/).textContent)).toBe("1.500 RWF")
  })
})
