"use client"

import { useEffect, useState } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { I18nProvider, useTranslation } from "@lumiere/i18n"
import { RBACProvider } from "../../../../../packages/ui/src/lib/rbac-context"
import { ThemeProvider, useTheme } from "../../../../../packages/ui/src/components/theme-provider"
import { Button } from "../../../../../packages/ui/src/components/button"
import { FormModal } from "../../../../../packages/ui/src/forms/form-modal"
import { newSaleOrderForm } from "../../../../../packages/ui/src/lib/sales-form-configs"
import { newProductForm } from "../../../../../packages/ui/src/lib/inventory-form-configs"
import { newFleetVehicleForm } from "../../../../../packages/ui/src/lib/fleet-form-configs"
import { mergeSelectOptionsForFields } from "../../../../../packages/ui/src/lib/form-config-merge"
import { withFormChoiceSetup } from "../../../../../packages/ui/src/lib/form-choice-setup"

function UsabilityForms() {
  const { t } = useTranslation()
  const { setTheme, resolvedTheme } = useTheme()
  const [hydrated, setHydrated] = useState(false)
  const [active, setActive] = useState<"quotation" | "product" | "vehicle" | null>(null)
  const [attempts, setAttempts] = useState(0)
  useEffect(() => setHydrated(true), [])
  const one = [{ value: "7", label: "Synthetic available choice" }]
  const forms = {
    quotation: withFormChoiceSetup(mergeSelectOptionsForFields(newSaleOrderForm(t), {
      partnerId: one, warehouseId: one,
    }), {
      pricelistId: {
        ready: true,
        message: "Create a price list in a separate tab, then return. Your quotation stays open.",
        action: { href: "/usability-forms?setup=pricelists", label: "Open price lists" },
      },
    }),
    product: mergeSelectOptionsForFields(newProductForm(t), {
      categId: one, uomId: one, uomPoId: one, pricelistId: one,
    }),
    vehicle: newFleetVehicleForm(t),
  }
  return <main className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
    <p data-testid="usability-forms-disclosure" data-hydrated={hydrated} className="text-sm text-muted-foreground">Synthetic production forms — no ERP requests or saved records</p>
    <h1 className="text-2xl font-semibold">Alpha form usability review</h1>
    <div className="flex flex-wrap gap-2">
      <Button onClick={() => setActive("quotation")}>New quotation</Button>
      <Button onClick={() => setActive("product")}>New product</Button>
      <Button onClick={() => setActive("vehicle")}>Add vehicle</Button>
      <Button variant="outline" onClick={() => setTheme("light")}>Light theme</Button>
      <Button variant="outline" onClick={() => setTheme("dark")}>Dark theme</Button>
    </div>
    <output data-testid="usability-forms-theme">{resolvedTheme}</output>
    <output data-testid="usability-forms-attempts">{attempts} synthetic save attempts</output>
    {active ? <FormModal
      open
      config={forms[active]}
      onOpenChange={(open) => { if (!open) setActive(null) }}
      draft={false}
      showSubmitSuccessToast={false}
      onSubmit={async () => { setAttempts((count) => count + 1); throw new Error("Synthetic save rejected; keep the entered values.") }}
    /> : null}
  </main>
}

export default function UsabilityFormsFixture() {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }))
  return <QueryClientProvider client={client}><I18nProvider language="en"><RBACProvider useDefaultFixtures><ThemeProvider defaultTheme="light" storageKey="usability-fixture-theme"><UsabilityForms /></ThemeProvider></RBACProvider></I18nProvider></QueryClientProvider>
}
