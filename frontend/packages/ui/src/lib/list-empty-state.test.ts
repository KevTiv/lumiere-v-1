import { describe, expect, it, vi } from "vitest"
import type { EntityAction, EntityViewConfig } from "./entity-view-types"
import {
  countActiveFilters,
  decideListEmptyState,
  resolveEmptyCtas,
  withTabCreateCta,
} from "./list-empty-state"

describe("decideListEmptyState", () => {
  it("is first-time when the dataset is empty and nothing narrows it", () => {
    expect(decideListEmptyState({ totalRows: 0, visibleRows: 0, search: "", filters: { state: "__all__" } })).toBe(
      "first-time",
    )
  })

  it("is no-results when a search, a filter or a KPI tile is active", () => {
    expect(decideListEmptyState({ totalRows: 3, visibleRows: 0, search: "zzz" })).toBe("no-results")
    expect(decideListEmptyState({ totalRows: 3, visibleRows: 0, filters: { state: "draft" } })).toBe("no-results")
    expect(decideListEmptyState({ totalRows: 0, visibleRows: 0, search: "  x " })).toBe("no-results")
    expect(decideListEmptyState({ totalRows: 0, visibleRows: 0, externalFilterActive: true })).toBe("no-results")
  })

  it("treats rows hidden without any visible narrowing as no-results, not first-time", () => {
    expect(decideListEmptyState({ totalRows: 4, visibleRows: 0 })).toBe("no-results")
  })

  it("is none while loading or when rows are visible", () => {
    expect(decideListEmptyState({ isLoading: true, totalRows: 0, visibleRows: 0 })).toBe("none")
    expect(decideListEmptyState({ totalRows: 2, visibleRows: 2 })).toBe("none")
  })

  it("ignores blank search and all-values when counting filters", () => {
    expect(countActiveFilters({ a: "", b: "__all__", c: undefined, d: "x" })).toBe(1)
    expect(countActiveFilters(undefined)).toBe(0)
  })
})

const action = (id: string): EntityAction => ({ id, label: `Label ${id}`, onClick: vi.fn() })
const allow = () => true
const deny = () => false

describe("resolveEmptyCtas", () => {
  it("references permitted actions by id for the primary and secondary CTA", () => {
    const r = resolveEmptyCtas({ primaryActionId: "new", secondaryActionId: "csv" }, [action("new"), action("csv")], allow)
    expect(r.primary).toEqual({ label: "Label new", actionId: "new" })
    expect(r.secondary).toEqual({ label: "Label csv", actionId: "csv" })
    expect(r.readOnly).toBe(false)
  })

  it("falls back to read-only when the primary action is not permitted (absent from the list)", () => {
    const r = resolveEmptyCtas({ primaryActionId: "new", secondaryActionId: "csv" }, [], allow)
    expect(r).toEqual({ primary: null, secondary: null, readOnly: true })
  })

  it("gates a legacy label + handler by the configured permission", () => {
    const onAction = vi.fn()
    const state = { actionLabel: "New", onAction, permission: { resource: "sale_order", action: "create" as const } }
    expect(resolveEmptyCtas(state, [], allow).primary?.label).toBe("New")
    expect(resolveEmptyCtas(state, [], deny)).toEqual({ primary: null, secondary: null, readOnly: true })
  })

  it("has no CTA and is not read-only without any configured action", () => {
    expect(resolveEmptyCtas({ title: "t" }, [], deny)).toEqual({ primary: null, secondary: null, readOnly: false })
    expect(resolveEmptyCtas(undefined, [], deny).readOnly).toBe(false)
  })
})

describe("withTabCreateCta", () => {
  const cta = { label: "New order", onClick: vi.fn(), permission: { resource: "sale_order", action: "create" as const } }
  const table = (emptyState?: object): EntityViewConfig["view"] =>
    ({ mode: "table", columns: [], emptyState }) as EntityViewConfig["view"]

  it("only touches lists that opted into an empty state", () => {
    const view = table()
    expect(withTabCreateCta(view, cta)).toBe(view)
  })

  it("adds the tab's create form as the CTA, with its permission", () => {
    const out = withTabCreateCta(table({ title: "No orders" }), cta)
    expect(out).toMatchObject({ emptyState: { actionLabel: "New order", onAction: cta.onClick, permission: cta.permission } })
  })

  it("keeps an existing handler and an action id, adding only the gate", () => {
    const onAction = vi.fn()
    const own = withTabCreateCta(table({ title: "t", actionLabel: "Own", onAction }), cta)
    expect(own).toMatchObject({ emptyState: { actionLabel: "Own", onAction, permission: cta.permission } })
    const byId = table({ title: "t", primaryActionId: "x" })
    expect(withTabCreateCta(byId, cta)).toBe(byId)
  })

  it("reaches the table of a table-or-board view", () => {
    const view = { mode: "table-or-board", table: { mode: "table", columns: [], emptyState: { title: "t" } } } as unknown as EntityViewConfig["view"]
    const out = withTabCreateCta(view, cta) as unknown as { table: { emptyState: { onAction: unknown } } }
    expect(out.table.emptyState.onAction).toBe(cta.onClick)
  })
})
