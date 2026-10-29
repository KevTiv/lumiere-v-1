import { act, cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { i18n } from "@lumiere/i18n"
import { Pagination, PaginationNext, PaginationPrevious } from "./pagination"
import { accountingForms } from "../forms/config/modules/accounting.config"
import { OverdueInvoicesWidget } from "../pages/widgets/overdue-invoices-widget"

import { crmForms } from "../forms/config/modules/crm.config"
import { salesForms } from "../forms/config/modules/sales.config"
import { purchasingForms } from "../forms/config/modules/purchasing.config"
import { subscriptionsForms } from "../forms/config/modules/subscriptions.config"

let frenchResources: Record<string, unknown>

beforeEach(async () => {
  frenchResources = structuredClone(i18n.getResourceBundle("fr", "translation"))
  await i18n.changeLanguage("en")
})

afterEach(async () => {
  cleanup()
  i18n.removeResourceBundle("fr", "translation")
  i18n.addResourceBundle("fr", "translation", frenchResources, true, true)
  await i18n.changeLanguage("en")
})

function french(key: string, value: string) {
  i18n.addResource("fr", "translation", key, value)
}

describe("Alpha shared translations", () => {
  it("updates pagination default text and accessible names when the language changes", async () => {
    french("ui.components.pagination.previous", "Précédent")
    french("ui.components.pagination.next", "Suivant")
    french("ui.components.pagination.goToPreviousPage", "Page précédente")
    french("ui.components.pagination.goToNextPage", "Page suivante")
    french("ui.components.pagination.pagination", "Pagination française")
    render(<Pagination><PaginationPrevious href="#previous" /><PaginationNext href="#next" /></Pagination>)
    expect(screen.getByRole("button", { name: "Go to previous page" }).textContent).toBe("Previous")

    await act(() => i18n.changeLanguage("fr"))

    expect(screen.getByRole("navigation", { name: "Pagination française" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Page précédente" }).textContent).toBe("Précédent")
    expect(screen.getByRole("button", { name: "Page suivante" }).textContent).toBe("Suivant")
  })

  it("resolves built-in form labels without changing field identifiers or a cached default form", async () => {
    const invoice = accountingForms.find((form) => form.formId === "new-invoice")!
    const configuration = invoice.defaultConfig()
    const field = configuration.fields.find((item) => item.fieldId === "invoice_number")!
    expect(field.label).toBe("Invoice Number")
    french("forms.defaults.accounting.invoiceNumber", "Numéro de facture")
    french("forms.defaults.accounting.newInvoice", "Nouvelle facture")

    await i18n.changeLanguage("fr")

    expect(field.fieldId).toBe("invoice_number")
    expect(field.label).toBe("Numéro de facture")
    expect(invoice.name).toBe("Nouvelle facture")
    expect(configuration.name).toBe("Nouvelle facture")
  })

  it("uses whole translated phrases for invoice counts and overdue days", async () => {
    french("ui.pages.overdueInvoicesWidget.overdueInvoices_one", "facture en retard")
    french("ui.pages.overdueInvoicesWidget.overdueInvoices_other", "factures en retard")
    french("ui.pages.overdueInvoicesWidget.oldestOverdue_one", "La plus ancienne : {{count}} jour de retard")
    french("ui.pages.overdueInvoicesWidget.oldestOverdue_other", "La plus ancienne : {{count}} jours de retard")
    const { rerender } = render(<OverdueInvoicesWidget data={{ count: 1, totalAmount: 10, oldestDays: 1 }} />)
    await act(() => i18n.changeLanguage("fr"))
    expect(screen.getByText("facture en retard")).toBeTruthy()
    expect(screen.getByText("La plus ancienne : 1 jour de retard")).toBeTruthy()

    rerender(<OverdueInvoicesWidget data={{ count: 2, totalAmount: 20, oldestDays: 2 }} />)

    expect(screen.getByText("factures en retard")).toBeTruthy()
    expect(screen.getByText("La plus ancienne : 2 jours de retard")).toBeTruthy()
  })
  it("updates cached Alpha business form defaults while keeping field names stable", async () => {
    const cases = [
      { entry: crmForms[0], field: "first_name", key: "forms.defaults.crm.firstName", label: "Prénom" },
      { entry: salesForms[0], field: "order_number", key: "forms.defaults.sales.orderNumber", label: "Numéro de commande" },
      { entry: purchasingForms[0], field: "po_number", key: "forms.defaults.purchasing.poNumber", label: "Numéro d’achat" },
      { entry: subscriptionsForms[0], field: "name", key: "forms.defaults.subscriptions.subscriptionName", label: "Nom de l’abonnement" },
    ].map((item) => ({ ...item, config: item.entry.defaultConfig() }))
    for (const item of cases) french(item.key, item.label)

    await i18n.changeLanguage("fr")

    for (const item of cases) {
      const field = item.config.fields.find((field) => field.fieldId === item.field)!
      expect(field.label).toBe(item.label)
      expect(field.name).toBe(item.field)
      expect(item.config.formId).toBe(item.entry.formId)
    }
  })

})
