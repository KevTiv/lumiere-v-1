import type { FormConfig, ModuleTab } from "@lumiere/ui"

type ManufacturingCreateForms = {
  orders: FormConfig
  boms: FormConfig
  workcenters: FormConfig
}

/** Keep selector options loaded at runtime when decorating manufacturing tabs. */
export function withManufacturingLiveCreateForm(
  tab: ModuleTab,
  forms: ManufacturingCreateForms,
): ModuleTab {
  if (tab.id === "orders") return { ...tab, createForm: forms.orders }
  if (tab.id === "boms") return { ...tab, createForm: forms.boms }
  if (tab.id === "workcenters") return { ...tab, createForm: forms.workcenters }
  return tab
}
