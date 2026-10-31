import type { ReviewRow } from "./import-review-model"
import { scalarToU64 } from "@lumiere/erp-shared/u64"

export type ProductReviewReference = {
  id: bigint | number | string
  organizationId?: bigint | number | string
  name?: string
  symbol?: string
  categoryId?: bigint | number | string
}
export type ProductReviewReferences = { categories: ProductReviewReference[]; uoms: ProductReviewReference[] }

function referenceId(value: bigint | number | string) {
  try { const id = scalarToU64(value); return id > 0n ? id.toString() : undefined } catch { return undefined }
}

/** Prepared reviews can declare a fixed target unit while the source unit stays uncertain. */
export function productReviewStoredUnit(item: ReviewRow | null) {
  const field = item?.source.fields.find(field => field.key === "stored_unit")
  return field?.sourceValue && field.kind === "choice" && field.options?.includes(field.sourceValue) ? field.sourceValue : undefined
}

export function productReviewReferenceOptions(references: ProductReviewReference[], organizationId: number, storedUnit?: string) {
  return references.flatMap(row => {
    const value = referenceId(row.id)
    return value && String(row.organizationId) === String(organizationId) && (!storedUnit || row.symbol === storedUnit) ? [{ value, label: row.symbol ? `${row.name ?? row.symbol} (${row.symbol})` : row.name ?? "Unnamed reference" }] : []
  })
}

/** A confirmation or handoff must use named, current-org references and one price unit. */
export function validateProductReviewReferences(item: ReviewRow, values: Record<string, string | null>, references: ProductReviewReferences, organizationId: number) {
  const find = (rows: ProductReviewReference[], key: string) => rows.find(row => String(row.organizationId) === String(organizationId) && referenceId(row.id) != null && referenceId(row.id) === values[key])
  if (!find(references.categories, "category_id")) throw new Error("Choose a product category from this organization.")
  const unit = find(references.uoms, "uom_id")
  const purchaseUnit = find(references.uoms, "uom_po_id")
  if (!unit || !purchaseUnit) throw new Error("Choose product and purchase units from this organization.")
  const storedUnit = productReviewStoredUnit(item)
  if (storedUnit && (unit.symbol !== storedUnit || purchaseUnit.symbol !== storedUnit)) throw new Error(`This review stores quantities and prices in ${storedUnit}. Keep that catalog unit and correct the source unit separately.`)
  if (unit.categoryId == null || purchaseUnit.categoryId == null || referenceId(unit.categoryId) == null || referenceId(unit.categoryId) !== referenceId(purchaseUnit.categoryId)) throw new Error("Product and purchase units must measure the same kind of quantity.")
  if (item.source.fields.some(field => field.key === "stored_unit") && values.stored_unit !== unit.symbol) throw new Error("The unit for corrected prices must match the chosen product unit. Check the quantities and prices for that unit.")
}
