import { parseStrictU64 } from "@lumiere/erp-shared/u64"
import {
  WorkflowError,
  observeReceivedLine,
  recordRef,
  resolveOpenReceiptTarget,
  type ObservedTransition,
  type ReceiptTarget,
  type RowValueMap,
} from "@lumiere/erp-workflows"

export interface ReceiptScope {
  organizationId: bigint
  companyId: bigint
}

export interface ReceiptSnapshot extends ReceiptScope {
  lineId: string
  orderId: bigint
  productId: bigint
  qtyReceived: number
  qty: number
  service: boolean
  target?: ReceiptTarget
}

export interface ReceiptReads {
  lines(): Promise<RowValueMap[]>
  products(): Promise<RowValueMap[]>
  moves(): Promise<RowValueMap[]>
}

const value = (row: RowValueMap, camel: string, snake: string) => row[camel] ?? row[snake]
const inScope = (row: RowValueMap, scope: ReceiptScope) =>
  parseStrictU64(value(row, "organizationId", "organization_id")) === scope.organizationId &&
  parseStrictU64(value(row, "companyId", "company_id")) === scope.companyId

function exact(rows: readonly RowValueMap[], id: bigint, resource: string): RowValueMap | undefined {
  const matches = rows.filter((row) => parseStrictU64(row.id) === id)
  if (matches.length > 1) throw new WorkflowError("conflict", `Multiple canonical ${resource} records for ${id}`)
  return matches[0]
}

function quantity(raw: unknown): number | undefined {
  // Unsigned JSON decimal syntax permits scientific notation emitted for JSON floats,
  // but not coercions, whitespace, hex, signs on the mantissa, or leading zeroes.
  if (typeof raw !== "number" &&
      (typeof raw !== "string" || !/^(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(raw))) return undefined
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

/** Evidence only: STDB still decides whether/how this line may be received. */
export async function captureReceiptSnapshot(
  lineId: string,
  qty: number,
  scope: ReceiptScope,
  reads: ReceiptReads,
): Promise<ReceiptSnapshot> {
  const id = parseStrictU64(lineId)
  if (id == null || id === 0n || !Number.isFinite(qty) || qty <= 0) {
    throw new WorkflowError("validation", "Receipt requires an exact line and finite positive quantity")
  }
  const [lines, products, moves] = await Promise.all([reads.lines(), reads.products(), reads.moves()]).catch((cause: unknown) => {
    // No mutation has been dispatched: a failed read is never an ambiguous write.
    throw new WorkflowError("server_failure", "Canonical purchase receipt pre-read failed", { cause })
  })
  const line = exact(lines, id, "purchase line")
  const orderId = line && parseStrictU64(value(line, "orderId", "order_id"))
  const productId = line && parseStrictU64(value(line, "productId", "product_id"))
  const qtyReceived = line && quantity(value(line, "qtyReceived", "qty_received"))
  if (!line || !inScope(line, scope) || !orderId || !productId || qtyReceived == null) {
    throw new WorkflowError("validation", "Canonical scoped purchase line quantity is unavailable")
  }
  const product = exact(products, productId, "product")
  const productType = product && value(product, "type", "type_")
  if (!product || parseStrictU64(value(product, "organizationId", "organization_id")) !== scope.organizationId ||
      typeof productType !== "string" || productType === "") {
    throw new WorkflowError("validation", "Canonical purchase line product type is unavailable")
  }
  const lineMoves = moves.filter((move) => parseStrictU64(value(move, "purchaseLineId", "purchase_line_id")) === id)
  if (lineMoves.some((move) => !inScope(move, scope))) {
    throw new WorkflowError("conflict", "Purchase receipt move scope does not match the canonical line")
  }
  const target = resolveOpenReceiptTarget(id.toString(), lineMoves)
  return { ...scope, lineId: id.toString(), orderId, productId, qtyReceived, qty, service: productType === "service", target }
}

/** A stock receipt needs both exact stock identity and the same line's quantity delta. */
export async function observeReceiptQuantity(
  snapshot: ReceiptSnapshot | undefined,
  reads: ReceiptReads,
): Promise<ObservedTransition> {
  if (!snapshot) return {}
  if (quantity(snapshot.qtyReceived) == null || !Number.isFinite(snapshot.qty) || snapshot.qty <= 0) return {}
  const line = exact(await reads.lines(), BigInt(snapshot.lineId), "purchase line")
  if (!line || !inScope(line, snapshot) ||
      parseStrictU64(value(line, "orderId", "order_id")) !== snapshot.orderId ||
      parseStrictU64(value(line, "productId", "product_id")) !== snapshot.productId) return {}
  const after = quantity(value(line, "qtyReceived", "qty_received"))
  if (after == null) return {}
  const delta = after - snapshot.qtyReceived
  // Allow only floating-point representation noise, not a business quantity tolerance.
  const roundoff = Number.EPSILON * Math.max(1, Math.abs(after), Math.abs(snapshot.qtyReceived), Math.abs(snapshot.qty)) * 4
  // If the requested delta itself is below readback precision, it is not proof.
  if (roundoff >= snapshot.qty) return {}
  if (!Number.isFinite(delta) || delta <= 0 || Math.abs(delta - snapshot.qty) > roundoff) return {}
  if (snapshot.target) {
    const moves = await reads.moves()
    const move = exact(moves, BigInt(snapshot.target.moveId), "receipt move")
    if (!move || !inScope(move, snapshot)) return {}
    return observeReceivedLine(snapshot.lineId, snapshot.target, [move])
  }
  if (!snapshot.service) return {}
  return { outcome: "applied", createdRecords: [recordRef("purchase_order_line", snapshot.lineId, "purchasing")] }
}
