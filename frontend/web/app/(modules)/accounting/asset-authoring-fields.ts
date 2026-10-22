import type { FormField } from "@lumiere/ui/lib/form-types"
import { DEPRECIATION_METHODS } from "./asset-actions"

const disposalFields = new Set(["gainAccountId", "lossAccountId", "accountDisposalId"])

interface AssetDisclosureLabels {
  disposalAccounts: string
  disposalAccountsHint: string
}

/** Change field presentation only; hidden values stay with the existing form and explicit mapper. */
export function withAssetAuthoringVisibility(
  fields: readonly FormField[],
  labels: AssetDisclosureLabels,
): FormField[] {
  const hasDisposalSettings = fields.some((field) =>
    disposalFields.has(field.name) && String(field.defaultValue ?? "").trim() !== "",
  )
  const result: FormField[] = []
  let addedDisclosure = false

  for (const field of fields) {
    if (field.name === "methodProgressFactor") {
      result.push({
        ...field,
        visibleWhen: { field: "method", oneOf: DEPRECIATION_METHODS.filter((method) => method !== "Linear") },
      })
    } else if (disposalFields.has(field.name)) {
      if (!addedDisclosure) {
        result.push({
          id: "showDisposalAccounts",
          name: "showDisposalAccounts",
          type: "switch",
          label: labels.disposalAccounts,
          description: labels.disposalAccountsHint,
          defaultValue: hasDisposalSettings,
          width: "full",
        })
        addedDisclosure = true
      }
      result.push({ ...field, visibleWhen: { field: "showDisposalAccounts", equals: "true" } })
    } else {
      result.push(field)
    }
  }
  return result
}
