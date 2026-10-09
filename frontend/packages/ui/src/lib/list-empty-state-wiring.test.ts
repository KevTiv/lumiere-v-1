import type { TFunction } from "i18next"
import { describe, expect, it } from "vitest"
import { contactsTableConfig, leadsTableConfig, opportunitiesTableConfig } from "./crm-entity-configs"
import { expensesTableConfig } from "./expenses-entity-configs"
import { helpdeskTicketsTableConfig } from "./helpdesk-entity-configs"
import { employeesTableConfig } from "./hr-entity-configs"
import { productsTableConfig, transfersTableConfig } from "./inventory-entity-configs"
import { manufacturingOrdersTableConfig } from "./manufacturing-entity-configs"
import { projectsTableConfig } from "./projects-entity-configs"
import { purchaseOrdersTableConfig } from "./purchasing-entity-configs"
import { saleOrdersTableConfig } from "./sales-entity-configs"
import { subscriptionsTableConfig } from "./subscriptions-entity-configs"
import type { EntityTableConfig, EntityViewConfig } from "./entity-view-types"

const t = ((key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key) as TFunction

function table(config: EntityViewConfig): EntityTableConfig {
  const view = config.view
  if (view.mode === "table") return view
  if (view.mode === "table-or-board") return view.table
  throw new Error("expected a table view")
}

const lists: Array<[string, EntityViewConfig, string, string | undefined]> = [
  ["sales orders", saleOrdersTableConfig(t), "sale_order", "csv-sale-orders"],
  ["purchase orders", purchaseOrdersTableConfig(t), "purchase_order", "csv-purchase-orders"],
  ["products", productsTableConfig(t), "product", "csv-product"],
  ["transfers", transfersTableConfig(t), "stock_picking", undefined],
  ["leads", leadsTableConfig(t), "lead", "csv-leads"],
  ["opportunities", opportunitiesTableConfig(t), "opportunity", undefined],
  ["contacts", contactsTableConfig(t), "contact", "csv-contacts"],
  ["tickets", helpdeskTicketsTableConfig(t), "helpdesk_ticket", undefined],
  ["projects", projectsTableConfig(t), "project_project", "csv-project"],
  ["expenses", expensesTableConfig(t), "hr_expense", "csv-expenses"],
  ["employees", employeesTableConfig(t), "hr_employee", undefined],
  ["manufacturing orders", manufacturingOrdersTableConfig(t), "mrp_production", "csv-mo"],
  ["subscriptions", subscriptionsTableConfig(t), "subscription", undefined],
]

describe("first-time empty states of the module lists", () => {
  it.each(lists)("%s names a create-gated empty state", (_name, config, resource, secondary) => {
    const state = table(config).emptyState
    expect(state?.title).toBeTruthy()
    expect(state?.description).toBeTruthy()
    expect(state?.learnHint).toBeTruthy()
    expect(state?.permission).toEqual({ resource, action: "create" })
    expect(state?.secondaryActionId).toBe(secondary)
  })
})
