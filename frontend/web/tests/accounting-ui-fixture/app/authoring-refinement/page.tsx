"use client"

import { useEffect, useState } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { I18nProvider, useTranslation } from "@lumiere/i18n"
import { RBACProvider } from "../../../../../packages/ui/src/lib/rbac-context"
import { ThemeProvider } from "../../../../../packages/ui/src/components/theme-provider"
import { Button } from "../../../../../packages/ui/src/components/button"
import { CreateInvoiceModal } from "../../../../../packages/ui/src/accounting-components/create-invoice-modal"
import { FormModal } from "../../../../../packages/ui/src/forms/form-modal"
import { newExpenseForm } from "../../../../../packages/ui/src/lib/expenses-form-configs"

const options: Record<string, Array<{ value: string; label: string }>> = {
  employeeId: [{ value: "7", label: "Synthetic employee Jane Example" }],
  pricelistId: [{ value: "3", label: "Travel expenses · Euro (EUR)" }],
  projectId: [{ value: "", label: "No project" }],
  productId: [{ value: "", label: "No expense product" }],
  taxIds: [],
  mileageRateId: [{ value: "11", label: "Synthetic mileage · EUR 0.30 / km" }],
  perDiemRateId: [{ value: "12", label: "Synthetic daily allowance · EUR 25.00 / day" }],
}

function AuthoringRefinement() {
  const { t } = useTranslation()
  const [hydrated, setHydrated] = useState(false)
  const [invoiceKind, setInvoiceKind] = useState<"invoice" | "bill">("invoice")
  const [invoiceOpen, setInvoiceOpen] = useState(false)
  const [expenseOpen, setExpenseOpen] = useState(false)
  const [expenseError, setExpenseError] = useState<string | null>(null)
  const [attempts, setAttempts] = useState(0)
  const [longInvoiceError, setLongInvoiceError] = useState(false)
  useEffect(() => setHydrated(true), [])
  const baseExpense = newExpenseForm(t)
  const expenseConfig = { ...baseExpense, sections: baseExpense.sections.map((section) => ({ ...section, fields: section.fields.map((field) => {
    if (field.name === "date" && field.type === "date") return { ...field, defaultValue: "2026-10-27" }
    if ((field.type === "select" || field.type === "multiselect") && Object.hasOwn(options, field.name)) return { ...field, options: options[field.name]! }
    return field
  }) })) }
  return <main className="mx-auto max-w-6xl space-y-4 p-4 sm:p-6">
    <p data-testid="authoring-refinement-disclosure" data-hydrated={hydrated} className="text-xs text-muted-foreground">Synthetic production form components — rejected callbacks only; no ERP backend operations or saved financial effects</p>
    <h1 className="text-2xl font-semibold">Finance authoring task review</h1>
    <div className="flex flex-wrap gap-3">
      <Button onClick={() => { setInvoiceKind("invoice"); setInvoiceOpen(true) }}>New invoice</Button>
      <Button onClick={() => { setInvoiceKind("bill"); setInvoiceOpen(true) }}>New bill</Button>
      <Button onClick={() => { setExpenseError(null); setExpenseOpen(true) }}>New expense</Button>
      <Button variant="outline" onClick={() => setLongInvoiceError(true)}>Use long synthetic invoice rejection</Button>
    </div>
    <output data-testid="authoring-refinement-attempts">Synthetic rejected save attempts: {attempts}</output>
    <CreateInvoiceModal
      open={invoiceOpen}
      kind={invoiceKind}
      companyId={1n}
      onClose={() => setInvoiceOpen(false)}
      onSave={async () => { setAttempts((count) => count + 1); throw new Error(`Synthetic invoice save rejected. Keep the commercial entries and correct the problem.${longInvoiceError ? `\n${"unbroken".repeat(1000)}\nReview the original draft after correcting the error.` : ""}`) }}
      onCheckStatus={async () => null}
      journalOptions={[{ value: "1", label: invoiceKind === "invoice" ? "Sales journal" : "Purchases journal", currencyId: "1" }]}
      partnerOptions={[{ value: "2", label: invoiceKind === "invoice" ? "Synthetic customer" : "Synthetic vendor" }]}
      counterpartAccountOptions={[{ value: "3", label: invoiceKind === "invoice" ? "Trade receivables" : "Trade payables" }]}
      lineAccountOptions={[{ value: "4", label: invoiceKind === "invoice" ? "Consulting revenue" : "Office expenses" }]}
      currencyOptions={[{ value: "1", label: "Euro (EUR)", code: "EUR" }]}
    />
    <FormModal
      open={expenseOpen}
      onOpenChange={setExpenseOpen}
      config={expenseConfig}
      draft={false}
      showSubmitSuccessToast={false}
      submitError={expenseError}
      onSubmit={async () => { setAttempts((count) => count + 1); setExpenseError("Synthetic expense save rejected. The selected receipt and expense entries are still available."); throw new Error("Synthetic expense save rejected") }}
    />
  </main>
}

export default function AuthoringRefinementFixture() {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }))
  return <QueryClientProvider client={client}><I18nProvider language="en"><RBACProvider useDefaultFixtures><ThemeProvider defaultTheme="light"><AuthoringRefinement /></ThemeProvider></RBACProvider></I18nProvider></QueryClientProvider>
}
