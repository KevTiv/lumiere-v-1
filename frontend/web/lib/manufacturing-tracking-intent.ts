import { parseStrictU64 } from "@lumiere/erp-shared/u64"
import type { OperationInputMap } from "@lumiere/contracts/generated/operation-inputs"

export type TrackingRow = Readonly<Record<string, unknown>>
export interface ManufacturingTrackingSnapshot {
  products: readonly TrackingRow[]
  boms: readonly TrackingRow[]
  byproducts: readonly TrackingRow[]
  bomLines: readonly TrackingRow[]
  lots: readonly TrackingRow[]
  serials: readonly TrackingRow[]
  moves: readonly TrackingRow[]
  quants: readonly TrackingRow[]
  locations: readonly TrackingRow[]
}
export interface OutputTrackingRequirement {
  key: string
  product: TrackingRow
  quantity: number
  tracking: "lot" | "serial"
  bomByproductId?: bigint
}
export interface TrackingSelection { lotId?: string; serialId?: string }

export const trackingId = (value: unknown): string => parseStrictU64(value)?.toString() ?? ""
const id = (value: unknown): bigint => {
  const parsed = parseStrictU64(value)
  if (parsed == null || parsed === 0n) throw new Error("A valid record identity is required")
  return parsed
}
const field = (row: TrackingRow, camel: string, snake: string) => row[camel] ?? row[snake]
const absent = (value: unknown) => value == null || (typeof value === "object" && "none" in value)
export const trackingState = (row: TrackingRow): string => {
  const state = row.state
  if (typeof state === "string") return state.toLowerCase()
  if (typeof state === "object" && state != null) {
    return String("tag" in state ? state.tag : Object.keys(state)[0] ?? "").toLowerCase()
  }
  return ""
}
function scoped(row: TrackingRow, organizationId: bigint, companyId?: bigint): boolean {
  return trackingId(field(row, "organizationId", "organization_id")) === organizationId.toString()
    && (companyId == null || trackingId(field(row, "companyId", "company_id")) === companyId.toString())
}
function unique(rows: readonly TrackingRow[], recordId: unknown): TrackingRow {
  const matches = rows.filter((row) => trackingId(row.id) === trackingId(recordId))
  if (matches.length !== 1) throw new Error("Required reference is missing or ambiguous")
  return matches[0]!
}
function ids(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error("Ownership references are unavailable")
  return value.map((value) => id(value).toString()).sort()
}
function requireScope(row: TrackingRow, organizationId: bigint, companyId: bigint): void {
  if (!scoped(row, organizationId, companyId)) throw new Error("Record is outside the active company")
}
function productFor(snapshot: ManufacturingTrackingSnapshot, productId: unknown, organizationId: bigint): TrackingRow {
  const product = unique(snapshot.products, productId)
  if (!scoped(product, organizationId) || product.active !== true) throw new Error("Product is unavailable")
  return product
}
export function outputTrackingRequirements(order: TrackingRow, snapshot: ManufacturingTrackingSnapshot,
  organizationId: bigint, companyId: bigint): OutputTrackingRequirement[] {
  requireScope(order, organizationId, companyId)
  if (trackingState(order) !== "toclose") throw new Error("Order must be ready to close")
  const requirements: OutputTrackingRequirement[] = []
  const add = (key: string, productId: unknown, quantity: number, uomId: unknown, bomByproductId?: bigint) => {
    const product = productFor(snapshot, productId, organizationId)
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error("Output quantity is unavailable")
    if (product.tracking === "none") return
    if (product.tracking !== "lot" && product.tracking !== "serial") throw new Error("Unsupported product tracking")
    if (product.tracking === "serial" && (quantity !== 1 || trackingId(uomId) !== trackingId(field(product, "uomId", "uom_id")))) {
      throw new Error("Serial output requires one unit in the product's stock unit")
    }
    requirements.push({ key, product, quantity, tracking: product.tracking, bomByproductId })
  }
  add("primary", field(order, "productId", "product_id"), Number(field(order, "productQty", "product_qty")), field(order, "productUomId", "product_uom_id"))
  const bomId = field(order, "bomId", "bom_id")
  if (!absent(bomId)) {
    const bom = unique(snapshot.boms, bomId)
    requireScope(bom, organizationId, companyId)
    const rows = snapshot.byproducts.filter((row) => trackingId(field(row, "bomId", "bom_id")) === trackingId(bom.id))
    if (JSON.stringify(ids(field(bom, "byproductIds", "byproduct_ids"))) !== JSON.stringify(rows.map((row) => id(row.id).toString()).sort())) {
      throw new Error("BOM byproduct ownership is inconsistent")
    }
    for (const row of rows) {
      requireScope(row, organizationId, companyId)
      const quantity = Number(field(row, "productQty", "product_qty"))
        * Number(field(order, "productQty", "product_qty")) / Number(field(bom, "productQty", "product_qty"))
      add(trackingId(row.id), field(row, "productId", "product_id"), quantity,
        field(row, "productUomId", "product_uom_id"), id(row.id))
    }
  }
  return requirements
}
function plainIdentity(row: TrackingRow): boolean {
  return absent(field(row, "productVariantId", "product_variant_id"))
    && absent(field(row, "packageId", "package_id")) && absent(field(row, "ownerId", "owner_id"))
}
export function outputIdentityOptions(requirement: OutputTrackingRequirement, snapshot: ManufacturingTrackingSnapshot,
  organizationId: bigint, companyId: bigint): TrackingRow[] {
  return (requirement.tracking === "lot" ? snapshot.lots : snapshot.serials).filter((row) =>
    scoped(row, organizationId, companyId)
    && trackingId(field(row, "productId", "product_id")) === trackingId(requirement.product.id)
    && plainIdentity(row) && field(row, "isLocked", "is_locked") !== true
    && field(row, "isScrap", "is_scrap") !== true
    && (requirement.tracking !== "serial" || (row.state === "free" && absent(field(row, "locationId", "location_id")))))
}
export function buildTrackedCloseIntent(order: TrackingRow, snapshot: ManufacturingTrackingSnapshot,
  organizationId: bigint, companyId: bigint, selections: Readonly<Record<string, TrackingSelection>>): OperationInputMap["finish_manufacturing_order_with_tracking"] {
  const requirements = outputTrackingRequirements(order, snapshot, organizationId, companyId)
  const resolve = (requirement: OutputTrackingRequirement) => {
    const selection = selections[requirement.key]
    const selectedId = requirement.tracking === "serial" ? selection?.serialId : selection?.lotId
    const options = outputIdentityOptions(requirement, snapshot, organizationId, companyId)
    const selected = unique(options, id(selectedId))
    return requirement.tracking === "serial"
      ? { lotId: parseStrictU64(field(selected, "lotId", "lot_id")), serialId: id(selected.id) }
      : { lotId: id(selected.id), serialId: undefined }
  }
  const primary = requirements.find((requirement) => requirement.key === "primary")
  return { companyId, moId: id(order.id), params: {
    ...(primary ? resolve(primary) : { lotId: undefined, serialId: undefined }),
    byproducts: requirements.filter((requirement) => requirement.bomByproductId != null)
      .map((requirement) => ({ bomByproductId: requirement.bomByproductId!, ...resolve(requirement) })),
  } }
}
export function trackedOutputOptions(order: TrackingRow, snapshot: ManufacturingTrackingSnapshot,
  organizationId: bigint, companyId: bigint): TrackingRow[] {
  requireScope(order, organizationId, companyId)
  if (trackingState(order) !== "done") return []
  const owned = ids(field(order, "moveFinishedIds", "move_finished_ids"))
  return snapshot.moves.filter((move) => owned.includes(trackingId(move.id)) && scoped(move, organizationId, companyId)
    && trackingId(field(move, "productionId", "production_id")) === trackingId(order.id)
    && move.scrapped === false && move.state === "done" && field(move, "isDone", "is_done") === true
    && plainIdentity(move) && Number(field(move, "quantityDone", "quantity_done")) > 0
    && trackingId(field(move, "locationDestId", "location_dest_id")) === trackingId(field(order, "locationDestId", "location_dest_id"))
    && (!absent(field(move, "lotId", "lot_id")) || !absent(field(move, "serialId", "serial_id"))))
}
export function materialScrapOptions(order: TrackingRow, snapshot: ManufacturingTrackingSnapshot,
  organizationId: bigint, companyId: bigint): TrackingRow[] {
  requireScope(order, organizationId, companyId)
  if (trackingState(order) !== "progress" || ids(field(order, "moveRawIds", "move_raw_ids")).length !== 0) return []
  const bom = unique(snapshot.boms, field(order, "bomId", "bom_id"))
  requireScope(bom, organizationId, companyId)
  const lines = snapshot.bomLines.filter((line) => trackingId(field(line, "bomId", "bom_id")) === trackingId(bom.id))
  if (JSON.stringify(ids(field(bom, "bomLineIds", "bom_line_ids"))) !== JSON.stringify(lines.map((row) => id(row.id).toString()).sort())) {
    throw new Error("BOM component ownership is inconsistent")
  }
  lines.forEach((line) => requireScope(line, organizationId, companyId))
  return snapshot.quants.filter((quant) => scoped(quant, organizationId, companyId) && plainIdentity(quant)
    && trackingId(field(quant, "locationId", "location_id")) === trackingId(field(order, "locationSrcId", "location_src_id"))
    && Number(field(quant, "availableQuantity", "available_quantity")) > 0
    && lines.some((line) => trackingId(field(line, "productId", "product_id")) === trackingId(field(quant, "productId", "product_id")))
    && productFor(snapshot, field(quant, "productId", "product_id"), organizationId).tracking !== "serial")
}
export function scrapLocationOptions(snapshot: ManufacturingTrackingSnapshot, organizationId: bigint, companyId: bigint): TrackingRow[] {
  return snapshot.locations.filter((location) => scoped(location, organizationId)
    && (absent(field(location, "companyId", "company_id")) || scoped(location, organizationId, companyId))
    && location.active === true && field(location, "scrapLocation", "scrap_location") === true)
}
export function buildManufacturingScrapIntent(kind: "output" | "material", order: TrackingRow,
  snapshot: ManufacturingTrackingSnapshot, organizationId: bigint, companyId: bigint,
  selectedId: string, locationId: string, quantity: number, requestId: string):
  OperationInputMap["scrap_tracked_manufacturing_output"] | OperationInputMap["scrap_manufacturing_material"] {
  if (!Number.isFinite(quantity) || quantity <= 0 || !requestId.trim()) throw new Error("Positive quantity and request identity are required")
  const source = unique(kind === "output" ? trackedOutputOptions(order, snapshot, organizationId, companyId)
    : materialScrapOptions(order, snapshot, organizationId, companyId), id(selectedId))
  unique(scrapLocationOptions(snapshot, organizationId, companyId), id(locationId))
  const sourceLocation = kind === "output" ? field(order, "locationDestId", "location_dest_id") : field(order, "locationSrcId", "location_src_id")
  if (trackingId(sourceLocation) === trackingId(locationId)) throw new Error("Scrap location must differ from source")
  if (kind === "output" && !absent(field(source, "serialId", "serial_id")) && quantity !== 1) throw new Error("Serial scrap requires one exact unit")
  let upper = Number(kind === "output" ? field(source, "quantityDone", "quantity_done") : field(source, "availableQuantity", "available_quantity"))
  if (kind === "output") {
    for (const move of snapshot.moves) {
      if (!scoped(move, organizationId, companyId) || move.scrapped !== true
        || trackingId(field(move, "productionId", "production_id")) !== trackingId(order.id)) continue
      const metadata = typeof move.metadata === "string" ? JSON.parse(move.metadata) as Record<string, unknown> : {}
      if (trackingId(metadata.source_output_move_id) !== trackingId(source.id)) continue
      const disposed = Number(field(move, "quantityDone", "quantity_done"))
      if (move.state !== "done" || field(move, "isDone", "is_done") !== true || !Number.isFinite(disposed) || disposed <= 0) {
        throw new Error("Existing scrap effects are inconsistent")
      }
      upper -= disposed
    }
  }
  if (!Number.isFinite(upper)) throw new Error("Selected stock quantity is unavailable")
  if (quantity > upper) throw new Error("Quantity exceeds selected stock")
  const common = { companyId, moId: id(order.id), scrapLocationId: id(locationId), quantity, requestId: requestId.trim() }
  return kind === "output" ? { ...common, outputMoveId: id(source.id) } : { ...common, sourceQuantId: id(source.id) }
}

export function resolveTrackingCloseEffect(order: TrackingRow, snapshot: ManufacturingTrackingSnapshot,
  organizationId: bigint, companyId: bigint,
  input: OperationInputMap["finish_manufacturing_order_with_tracking"],
  ordersAfter: readonly TrackingRow[], movesAfter: readonly TrackingRow[]) {
  const orders = ordersAfter.filter((row) => trackingId(row.id) === trackingId(order.id) && scoped(row, organizationId, companyId))
  if (orders.length > 1) throw new Error("Manufacturing order projection is ambiguous")
  const after = orders[0]
  if (!after || trackingState(after) !== "done") return null
  const owned = ids(field(after, "moveFinishedIds", "move_finished_ids"))
  const bomId = field(order, "bomId", "bom_id")
  const byproducts = absent(bomId) ? [] : snapshot.byproducts.filter((row) => trackingId(field(row, "bomId", "bom_id")) === trackingId(bomId))
  const expected = [{ reference: `MO/${trackingId(order.id)}`, productId: field(order, "productId", "product_id"),
    lotId: input.params.lotId, serialId: input.params.serialId },
  ...byproducts.map((row) => {
    const attribution = input.params.byproducts.find((entry) => trackingId(entry.bomByproductId) === trackingId(row.id))
    return { reference: `MO/${trackingId(order.id)}/BYPRODUCT/${trackingId(row.id)}`,
      productId: field(row, "productId", "product_id"), lotId: attribution?.lotId, serialId: attribution?.serialId }
  })]
  if (owned.length !== expected.length || new Set(owned).size !== owned.length) throw new Error("Closed output ownership does not match BOM")
  for (const effect of expected) {
    const matches = movesAfter.filter((move) => owned.includes(trackingId(move.id))
      && scoped(move, organizationId, companyId) && trackingId(field(move, "productionId", "production_id")) === trackingId(order.id)
      && move.reference === effect.reference && trackingId(field(move, "productId", "product_id")) === trackingId(effect.productId))
    if (matches.length > 1) throw new Error("Output projection is ambiguous")
    const move = matches[0]
    if (!move) return null
    if (move.scrapped !== false || move.state !== "done" || field(move, "isDone", "is_done") !== true
      || trackingId(field(move, "lotId", "lot_id")) !== trackingId(effect.lotId)
      || trackingId(field(move, "serialId", "serial_id")) !== trackingId(effect.serialId)
      || trackingId(field(move, "locationDestId", "location_dest_id")) !== trackingId(field(order, "locationDestId", "location_dest_id"))) {
      throw new Error("Completed output does not match requested attribution")
    }
  }
  return { resource: "mrp-productions", id: trackingId(order.id), finishedMoveIds: owned }
}

export function resolveTrackingScrapEffect(kind: "output" | "material", order: TrackingRow,
  organizationId: bigint, companyId: bigint,
  input: OperationInputMap["scrap_tracked_manufacturing_output"] | OperationInputMap["scrap_manufacturing_material"],
  movesAfter: readonly TrackingRow[]) {
  const matches = movesAfter.filter((move) => scoped(move, organizationId, companyId)
    && trackingId(field(move, "productionId", "production_id")) === trackingId(order.id)
    && move.reference === `MO/${trackingId(order.id)}/SCRAP/${input.requestId}`)
  if (matches.length > 1) throw new Error("Scrap projection is ambiguous")
  const move = matches[0]
  if (!move) return null
  const metadata = typeof move.metadata === "string" ? JSON.parse(move.metadata) as Record<string, unknown> : {}
  const exactSource = kind === "output" && "outputMoveId" in input
    ? trackingId(metadata.source_output_move_id) === trackingId(input.outputMoveId)
    : "sourceQuantId" in input && trackingId(metadata.source_quant_id) === trackingId(input.sourceQuantId)
      && trackingId(field(move, "rawMaterialProductionId", "raw_material_production_id")) === trackingId(order.id)
  if (!exactSource || move.scrapped !== true || move.state !== "done" || field(move, "isDone", "is_done") !== true
    || Number(field(move, "quantityDone", "quantity_done")) !== input.quantity
    || trackingId(field(move, "locationDestId", "location_dest_id")) !== trackingId(input.scrapLocationId)) {
    throw new Error("Completed scrap does not match the exact requested effect")
  }
  return { resource: "stock-moves", id: trackingId(move.id) }
}
