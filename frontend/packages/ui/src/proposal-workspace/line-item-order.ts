export type LineItemMoveDirection = "up" | "down"

interface OrderableRow {
  id: string
  sequence: number
}

function toOrderable(row: Record<string, unknown>): OrderableRow {
  const sequence = Number(row.sequence ?? 0)
  return { id: String(row.id), sequence: Number.isFinite(sequence) ? sequence : 0 }
}

function byOrder(a: OrderableRow, b: OrderableRow): number {
  if (a.sequence !== b.sequence) return a.sequence - b.sequence
  const left = BigInt(a.id)
  const right = BigInt(b.id)
  return left < right ? -1 : left > right ? 1 : 0
}

/** This proposal's line items in display order (sequence, then id). */
export function proposalLineItemsInOrder<T extends Record<string, unknown>>(
  rows: readonly T[],
  proposalId: bigint | number | string,
): T[] {
  const wanted = String(proposalId)
  return rows
    .filter((row) => String(row.proposalId ?? row.proposal_id ?? "") === wanted)
    .sort((a, b) => byOrder(toOrderable(a), toOrderable(b)))
}

/**
 * `reorder_proposal_line_items` rewrites every listed item's sequence as (index + 1) * 10 and
 * skips ids it does not know, so the list must be the proposal's COMPLETE set of line item ids.
 * Moving swaps the item with its neighbour among `visibleIds` (the items shown together, such as
 * one section), leaving every other item where it was. Returns null when there is nothing to move.
 */
export function moveLineItemOrder(
  proposalItems: readonly Record<string, unknown>[],
  visibleIds: readonly string[],
  movedId: string,
  direction: LineItemMoveDirection,
): string[] | null {
  const full = proposalItems.map(toOrderable).sort(byOrder).map((row) => row.id)
  const visible = full.filter((id) => visibleIds.includes(id))
  const at = visible.indexOf(movedId)
  if (at === -1) return null
  const neighbour = visible[direction === "up" ? at - 1 : at + 1]
  if (neighbour === undefined) return null
  const result = [...full]
  const from = result.indexOf(movedId)
  const to = result.indexOf(neighbour)
  result[from] = neighbour
  result[to] = movedId
  return result
}
