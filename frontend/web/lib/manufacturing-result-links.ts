import { moduleTabHref } from "@lumiere/erp-shared/record-links"
import { parseStrictU64 } from "@lumiere/erp-shared/u64"
import type { CanonicalRecordRef } from "@lumiere/query-hooks/hooks/operation-effect"

export interface ManufacturingResultLink {
  readonly resource: string
  readonly id: string
  readonly href: string
  readonly label: string
}

const destinations: Record<string, { module: string; tab: string; label: string }> = {
  "mrp-productions": { module: "manufacturing", tab: "orders", label: "Manufacturing order" },
  "mrp-bom-byproducts": { module: "manufacturing", tab: "bom-byproducts", label: "BOM byproduct" },
  "stock-moves": { module: "inventory", tab: "stock-moves", label: "Stock move" },
  "stock-quants": { module: "inventory", tab: "stock", label: "Stock quantity" },
}

/** Link only resolved canonical IDs to real module tabs; never trust an arbitrary ref href. */
export function manufacturingResultLinks(ref: CanonicalRecordRef): ManufacturingResultLink[] {
  const links: ManufacturingResultLink[] = []
  const append = (resource: string, rawId: unknown) => {
    const destination = destinations[resource]
    const id = parseStrictU64(rawId)
    if (!destination || id == null || id === 0n) return
    const key = id.toString()
    if (links.some(link => link.resource === resource && link.id === key)) return
    links.push({ resource, id: key, href: moduleTabHref(destination.module, destination.tab, { id: key }), label: destination.label })
  }
  append(ref.resource, ref.id)
  if (ref.resource === "mrp-productions") {
    // Completion readback verifies every output ID against the MO-owned relation.
    if ("finishedMoveIds" in ref && Array.isArray(ref.finishedMoveIds)) {
      for (const id of ref.finishedMoveIds) append("stock-moves", id)
    } else if ("finishedMoveId" in ref) append("stock-moves", ref.finishedMoveId)
    if ("destinationQuantId" in ref) append("stock-quants", ref.destinationQuantId)
  }
  return links
}

/** Record-page actions also include legacy void results; only canonical resolution creates links. */
export function resolvedManufacturingResultLinks(outcome: unknown): ManufacturingResultLink[] {
  if (!outcome || typeof outcome !== "object" || !("kind" in outcome) || !("ref" in outcome)) return []
  if (outcome.kind !== "converged" && outcome.kind !== "already-applied") return []
  const ref = outcome.ref
  if (!ref || typeof ref !== "object" || !("resource" in ref) || !("id" in ref)) return []
  if (typeof ref.resource !== "string" || typeof ref.id !== "string") return []
  return manufacturingResultLinks(ref as CanonicalRecordRef)
}
