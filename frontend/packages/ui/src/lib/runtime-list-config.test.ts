import { describe, expect, it } from "vitest"
import type { TFunction } from "i18next"
import type { MergedFormConfiguration, ParsedFormField } from "../forms/config/types"
import { salesForms } from "../forms/config/modules/sales.config"
import { mergeRuntimeListConfig, runtimeListFiltersFromFields } from "./runtime-list-config"
import { saleOrderListFieldAliases, saleOrdersTableConfig } from "./sales-entity-configs"
import { crmForms } from "../forms/config/modules/crm.config"
import { crmContactListFieldAliases, crmLeadListFieldAliases, crmOpportunityListFieldAliases, contactsTableConfig, leadsTableConfig, opportunitiesTableConfig } from "./crm-entity-configs"
import { purchasingForms } from "../forms/config/modules/purchasing.config"
import { purchaseOrderListFieldAliases, purchaseOrdersTableConfig } from "./purchasing-entity-configs"

const t = ((key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key) as TFunction

describe("Sales runtime list projection", () => {
  it("merges the real legacy form without duplicate columns or incompatible status filters", () => {
    const defaults = salesForms.find((form) => form.formId === "new-sale-order")!.defaultConfig()
    const fields: ParsedFormField[] = defaults.fields.map((field, id) => ({
      ...field, id, type: field.fieldType, options: field.options ?? [], validation: field.validation ?? { required: false },
    }))
    const custom: ParsedFormField = { ...fields[0]!, fieldId: "custom:status", name: "status", label: "Review note", type: "Text" }
    const runtime: MergedFormConfiguration = { config: {} as MergedFormConfiguration["config"], fields: [...fields, custom], sourceFields: fields, customFields: [custom] }
    const base = saleOrdersTableConfig(t).view
    if (base.mode !== "table") throw new Error("Expected Sales table")
    const merged = mergeRuntimeListConfig(base, runtime, saleOrderListFieldAliases)
    const keys = merged.columns.map((column) => column.key)
    expect(keys.filter((key) => key === "reference")).toHaveLength(1)
    expect(keys.filter((key) => key === "state")).toHaveLength(1)
    expect(keys.filter((key) => key === "dateOrder")).toHaveLength(1)
    expect(keys).toContain("partnerName")
    expect(keys).toContain("expectedDate")
    expect(keys).toContain("metadata:custom:status")
    for (const phantom of ["order_number", "customer", "order_date", "delivery_date", "status", "tags"]) expect(keys).not.toContain(phantom)
    expect(runtimeListFiltersFromFields(runtime, saleOrderListFieldAliases).some((filter) => filter.key === "status" || filter.key === "customer")).toBe(false)
    // Custom field data remains bound to metadata, even when its name is an alias.
    const customColumn = merged.columns.find((column) => column.key === "metadata:custom:status")!
    expect(customColumn.render?.(undefined, { metadata: '{"custom:status":"Needs review"}' })).toBe("Needs review")
  })
})

describe("CRM legacy form fields", () => {
  it.each([
    ["new-lead", leadsTableConfig(t), crmLeadListFieldAliases],
    ["new-contact", contactsTableConfig(t), crmContactListFieldAliases],
    ["new-opportunity", opportunitiesTableConfig(t), crmOpportunityListFieldAliases],
  ] as const)("%s uses canonical keys without duplicate legacy columns", (formId, config, aliases) => {
    const defaults = crmForms.find((form) => form.formId === formId)!.defaultConfig()
    const fields: ParsedFormField[] = defaults.fields.map((field, id) => ({ ...field, id, type: field.fieldType, options: field.options ?? [], validation: field.validation ?? { required: false } }))
    const runtime: MergedFormConfiguration = { config: {} as MergedFormConfiguration["config"], fields, sourceFields: fields, customFields: [] }
    const base = config.view.mode === "table-or-board" ? config.view.table : config.view
    if (base.mode !== "table") throw new Error("Expected CRM table")
    const columns = mergeRuntimeListConfig(base, runtime, aliases).columns
    const keys = columns.map((column) => column.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const key of ["company", "lead_status", "lead_source", "opportunity_name", "expected_close_date", "amount", "tags"]) expect(keys).not.toContain(key)
  })
})

describe("Purchasing legacy form fields", () => {
  it("uses one canonical column for each order value and the real state filter", () => {
    const defaults = purchasingForms.find((form) => form.formId === "new-purchase-order")!.defaultConfig()
    const fields: ParsedFormField[] = defaults.fields.map((field, id) => ({ ...field, id, type: field.fieldType, options: field.options ?? [], validation: field.validation ?? { required: false } }))
    const runtime: MergedFormConfiguration = { config: {} as MergedFormConfiguration["config"], fields, sourceFields: fields, customFields: [] }
    const base = purchaseOrdersTableConfig(t).view
    if (base.mode !== "table") throw new Error("Expected Purchasing table")
    const keys = mergeRuntimeListConfig(base, runtime, purchaseOrderListFieldAliases).columns.map((column) => column.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const key of ["name", "partnerId", "dateOrder", "datePlanned", "state"]) expect(keys.filter((column) => column === key)).toHaveLength(1)
    for (const key of ["po_number", "vendor", "order_date", "expected_date", "status"]) expect(keys).not.toContain(key)
    expect(runtimeListFiltersFromFields(runtime, purchaseOrderListFieldAliases)).toEqual([])
  })
})
