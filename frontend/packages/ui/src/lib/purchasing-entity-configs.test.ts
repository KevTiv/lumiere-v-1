import type { TFunction } from "i18next"
import { describe, expect, it } from "vitest"
import { purchaseReturnsTableConfig, purchasingEntityConfigs } from "./purchasing-entity-configs"

const t = ((key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key) as TFunction

describe("purchase returns table config", () => {
  it("exposes the purchase return as a searchable lifecycle list", () => {
    const config = purchaseReturnsTableConfig(t)

    expect(config.id).toBe("purchase-returns-table")
    expect(config.entityType).toBe("purchase_return")
    expect(config.view.mode).toBe("table")
    if (config.view.mode !== "table") throw new Error("expected table view")

    expect(config.view.searchKeys).toEqual(["name", "returnReason"])
    expect(config.view.filters?.[0]?.options?.map(({ value }) => value)).toEqual([
      "draft",
      "confirmed",
      "refunded",
    ])
    expect(config.view.columns.map(({ key }) => key)).toEqual([
      "name", "purchaseOrderId", "partnerId", "state", "returnReason", "pickingId", "creditMoveId", "createDate",
    ])
  })

  it("registers the returns list with the purchasing entity configs", () => {
    expect(purchasingEntityConfigs(t)["purchase-returns-table"]?.entityType).toBe("purchase_return")
  })
})
