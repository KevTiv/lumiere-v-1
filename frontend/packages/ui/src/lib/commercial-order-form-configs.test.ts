import { describe, expect, it } from "vitest"
import type { TFunction } from "i18next"
import type { FormConfig } from "./form-types"
import type { MergedFormConfiguration, ParsedFormField } from "../forms/config/types"
import { mergeRuntimeFormConfig } from "./runtime-form-config"
import { newSaleOrderForm, addSaleOrderLineForm, createInvoiceFromSaleOrderForm } from "./sales-form-configs"
import { newPurchaseOrderForm, newPurchaseRequisitionForm, createBillFromPurchaseOrderForm } from "./purchasing-form-configs"

const t = ((_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key) as TFunction
const fields = (config: FormConfig) => config.sections.flatMap((section) => section.fields)

describe("commercial task form structure", () => {
  it("keeps quotation customer, required pricing and delivery relations visible without arbitrary defaults", () => {
    const config = newSaleOrderForm(t)
    expect(config.sections.map((section) => section.id)).toEqual(["so-customer", "so-order", "so-delivery", "so-notes", "so-commission"])
    expect(fields(config).map((field) => field.name)).toEqual(["partnerId", "clientOrderRef", "validityDate", "pricelistId", "paymentTermId", "invoicePolicy", "warehouseId", "commitmentDate", "isDropship", "note", "commissionRatePercent"])
    for (const name of ["partnerId", "pricelistId", "warehouseId"]) {
      const field = fields(config).find((candidate) => candidate.name === name)
      expect(field?.required).toBe(true)
      expect(field?.defaultValue).toBeUndefined()
      expect(field?.type === "select" && field.searchable).toBe(true)
    }
  })
  it("puts the item before discounts/taxes and preserves sequence and discount defaults", () => {
    const config = addSaleOrderLineForm(t)
    expect(config.sections.map((section) => section.id)).toEqual(["sol-order", "sol-product", "sol-pricing", "sol-details"])
    expect(fields(config).find((field) => field.name === "sequence")?.defaultValue).toBe(10)
    expect(fields(config).find((field) => field.name === "discount")?.defaultValue).toBe(0)
    expect(fields(config).find((field) => field.name === "taxIds")?.type).toBe("multiselect")
    expect(new Set(fields(config).map((field) => field.name)).size).toBe(fields(config).length)
  })
  it("keeps vendor/pricelist required and preserves the requested item through regrouping", () => {
    const order = newPurchaseOrderForm(t)
    expect(order.sections.map((section) => section.id)).toEqual(["po-vendor", "po-pricing", "po-schedule", "po-notes"])
    for (const name of ["partnerId", "pricelistId"]) expect(fields(order).find((field) => field.name === name)?.required).toBe(true)
    const request = newPurchaseRequisitionForm(t)
    expect(request.sections.map((section) => section.id)).toEqual(["req-general", "req-line", "req-dates"])
    for (const name of ["productId", "uomId", "quantity"]) expect(fields(request).find((field) => field.name === name)?.required).toBe(true)
  })
  it("retains all specialist ledger flags with their existing exact defaults", () => {
    const invoice = fields(createInvoiceFromSaleOrderForm(t))
    const bill = fields(createBillFromPurchaseOrderForm(t))
    for (const [name, value] of [["incomeExcludeFromInvoiceTab", false], ["incomeBlocked", false], ["receivableExcludeFromInvoiceTab", true], ["receivableBlocked", false]] as const) {
      expect(invoice.find((field) => field.name === name)?.defaultValue).toBe(value)
    }
    for (const [name, value] of [["expenseBlocked", false], ["payableExcludeFromInvoiceTab", true], ["payableBlocked", false]] as const) {
      expect(bill.find((field) => field.name === name)?.defaultValue).toBe(value)
    }
    expect(bill.find((field) => field.name === "discount")?.defaultValue).toBe(0)
    expect(bill.find((field) => field.name === "invoiceDate")?.required).toBe(true)
  })
  it("keeps static task sections under runtime labels, custom fields and required validation", () => {
    const field = (overrides: Partial<ParsedFormField>): ParsedFormField => ({ id: 1, fieldId: "partnerId", name: "partnerId", label: "Customer account", type: "Select", options: [], validation: { required: true }, aiSuggestions: [], order: 1, isSystem: true, isEnabled: true, showInList: false, width: "Half", ...overrides })
    const runtimeFields = [field({}), field({ id: 2, fieldId: "custom:purchaseCode", name: "custom:purchaseCode", label: "Purchase code", type: "Text", isSystem: false })]
    const runtime: MergedFormConfiguration = { config: {} as MergedFormConfiguration["config"], fields: runtimeFields, sourceFields: runtimeFields, customFields: runtimeFields.slice(1) }
    const merged = mergeRuntimeFormConfig(newSaleOrderForm(t), runtime, { preferStdbVisibility: true, runtimeFromDatabase: true })
    expect(merged.bindingErrors).toEqual([])
    expect(merged.config.sections.slice(0, 5).map((section) => section.id)).toEqual(["so-customer", "so-order", "so-delivery", "so-notes", "so-commission"])
    expect(fields(merged.config).find((candidate) => candidate.name === "partnerId")?.label).toBe("Customer account")
    expect(fields(merged.config).find((candidate) => candidate.name === "custom:purchaseCode")?.required).toBe(true)
    expect(merged.customFieldIds).toContain("custom:purchaseCode")
    expect(merged.config.customFieldCreateCapability).toBe("atomic-configured-v1")
  })
  it("admits atomic configured creation only on canonical order headers", () => {
    expect(newSaleOrderForm(t).customFieldCreateCapability).toBe("atomic-configured-v1")
    expect(newPurchaseOrderForm(t).customFieldCreateCapability).toBe("atomic-configured-v1")
    expect(addSaleOrderLineForm(t).customFieldCreateUnavailableMessage).toBeUndefined()
    expect(createInvoiceFromSaleOrderForm(t).customFieldCreateUnavailableMessage).toBeUndefined()
    expect(createBillFromPurchaseOrderForm(t).customFieldCreateUnavailableMessage).toBeUndefined()
    expect(addSaleOrderLineForm(t).customFieldCreateCapability).toBeUndefined()
    expect(createInvoiceFromSaleOrderForm(t).customFieldCreateCapability).toBeUndefined()
    expect(createBillFromPurchaseOrderForm(t).customFieldCreateCapability).toBeUndefined()
  })
})
