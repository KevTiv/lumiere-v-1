import { field, idOf, numberOf, textOf, type ReadRow } from '@/lib/row-field';

export interface DetailedOperationRow {
  id: string;
  product: string | null;
  lot: string | null;
  fromLocation: string | null;
  toLocation: string | null;
  quantityDone: number | null;
  quantityReserved: number | null;
}

export interface MoveLineLookups {
  productNameById: ReadonlyMap<string, string>;
  locationNameById: ReadonlyMap<string, string>;
  /** Lot or serial names keyed by id. */
  lotNameById: ReadonlyMap<string, string>;
}

/** Move lines of a transfer: those pointing at the picking, plus those of its moves. */
export function moveLinesForTransfer(
  transferId: string,
  lines: ReadonlyArray<ReadRow>,
  transferMoveIds: ReadonlySet<string>,
): ReadRow[] {
  return lines.filter((line) => {
    if (idOf(line, 'pickingId') === transferId) return true;
    const moveId = idOf(line, 'moveId');
    return moveId != null && transferMoveIds.has(moveId);
  });
}

/** Done quantity falls back across the two done columns the table carries; reserved likewise. */
function firstNumber(row: ReadRow, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = numberOf(row, key);
    if (value != null) return value;
  }
  return null;
}

/**
 * Rows for the "Detailed operations" tab. Names that cannot be resolved stay empty (the embedded
 * location names on the line are used as a fallback); raw ids are never shown.
 */
export function detailedOperationRows(lines: ReadonlyArray<ReadRow>, lookups: MoveLineLookups): DetailedOperationRow[] {
  const named = (map: ReadonlyMap<string, string>, id: string | null) => (id != null ? (map.get(id) ?? null) : null);
  return lines.map((line) => ({
    id: String(field(line, 'id')),
    product: named(lookups.productNameById, idOf(line, 'productId')),
    lot: named(lookups.lotNameById, idOf(line, 'lotId') ?? idOf(line, 'displayLotId')),
    fromLocation: named(lookups.locationNameById, idOf(line, 'locationId')) ?? textOf(line, 'locationIdName'),
    toLocation: named(lookups.locationNameById, idOf(line, 'locationDestId')) ?? textOf(line, 'locationDestIdName'),
    quantityDone: firstNumber(line, ['qtyDone', 'quantityDone']),
    quantityReserved: firstNumber(line, ['reservedUomQty', 'reservedQty']),
  }));
}
