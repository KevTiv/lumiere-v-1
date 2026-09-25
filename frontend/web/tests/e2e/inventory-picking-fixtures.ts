import { expect } from "@playwright/test"
import type { Page } from "@playwright/test"

import {
  activeTabEntityTable,
  gotoModule,
  scalarQueryId,
  selectEntityRowById,
} from "./helpers"
import { clickEntityActionAndWaitForReducer } from "./helpers"

export interface PickingMoveState {
  id: number
  state: string
  isDone: boolean
}

function variantTag(value: unknown): string {
  if (value != null && typeof value === "object" && "tag" in value) {
    return String((value as { tag: string }).tag).toLowerCase()
  }
  return String(value ?? "").toLowerCase()
}

export async function fetchPickingState(
  page: Page,
  pickingId: number,
): Promise<string | undefined> {
  const response = await page.request.get("/api/query/stock-pickings")
  if (!response.ok()) return undefined

  const payload = (await response.json()) as {
    data?: Array<Record<string, unknown>>
  }
  const picking = (payload.data ?? []).find(
    (row) => scalarQueryId(row.id) === pickingId,
  )
  return picking ? variantTag(picking.state) : undefined
}

export async function fetchPickingMoveStates(
  page: Page,
  pickingId: number,
): Promise<PickingMoveState[]> {
  const response = await page.request.get("/api/query/stock-moves")
  if (!response.ok()) return []

  const payload = (await response.json()) as {
    data?: Array<Record<string, unknown>>
  }
  return (payload.data ?? [])
    .filter(
      (row) => scalarQueryId(row.pickingId ?? row.picking_id) === pickingId,
    )
    .flatMap((row) => {
      const id = scalarQueryId(row.id)
      return id == null
        ? []
        : [
            {
              id,
              state: variantTag(row.state),
              isDone: Boolean(row.isDone ?? row.is_done),
            },
          ]
    })
    .sort((a, b) => a.id - b.id)
}

export async function runPickingActionViaInventoryUi(
  page: Page,
  pickingId: number,
  action: "confirm" | "assign" | "validate",
): Promise<void> {
  const reducer = {
    confirm: "confirm_stock_picking",
    assign: "assign_stock_picking",
    validate: "validate_stock_picking",
  } as const

  await gotoModule(page, "/inventory", "inventory")
  await page.getByTestId("module-tab-inventory-transfers").click()
  await selectEntityRowById(page, pickingId)
  await clickEntityActionAndWaitForReducer(
    page,
    `entity-action-${action}-picking`,
    reducer[action],
  )
}

export async function expectCanonicalPickingFocus(
  page: Page,
  pickingId: number,
): Promise<void> {
  await expect(page).toHaveURL((url) => {
    return (
      url.pathname === "/inventory" &&
      url.searchParams.get("tab") === "transfers" &&
      url.searchParams.getAll("filter").length === 1 &&
      url.searchParams.get("filter") === `id:${pickingId}`
    )
  })
  await expect(
    page.getByTestId("module-tab-inventory-transfers"),
  ).toHaveAttribute("aria-selected", "true")

  const table = activeTabEntityTable(page)
  await expect(table.getByTestId(`entity-row-${pickingId}`)).toBeVisible()
  await expect(table.locator('[data-testid^="entity-row-"]')).toHaveCount(1)
  await expect(table.getByTestId("entity-active-filter-id")).toContainText(
    `id: ${pickingId}`,
  )
}
