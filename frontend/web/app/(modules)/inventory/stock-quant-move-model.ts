import { inventoryQuantity } from '@lumiere/erp-shared/replenishment-stock';
import { parseStrictU64 } from '@lumiere/erp-shared/u64';

interface StockMoveLocation {
  id: unknown;
  active?: boolean;
  isActive?: boolean;
  usage?: string;
}

interface StockMoveQuant {
  id: unknown;
  locationId: unknown;
  availableQuantity?: unknown;
}

export function isStockMoveDestination(location: StockMoveLocation, sourceLocationId: unknown): boolean {
  const source = parseStrictU64(sourceLocationId);
  const destination = parseStrictU64(location.id);
  return Boolean(source && destination && source !== destination
    && location.active !== false && location.isActive !== false && location.usage === 'internal');
}

/** Validate against the currently readable rows, including availability after a refetch. */
export function stockQuantMoveInput(
  quant: StockMoveQuant | undefined,
  target: StockMoveLocation | undefined,
  input: unknown,
): { quantId: string; targetLocationId: string; quantity: number } | undefined {
  const quantity = inventoryQuantity(input);
  const quantId = parseStrictU64(quant?.id);
  if (!quant || !quantId || !target || !isStockMoveDestination(target, quant.locationId) || quantity == null || quantity <= 0) {
    return undefined;
  }
  const available = inventoryQuantity(quant.availableQuantity);
  if (available == null || quantity > available) return undefined;
  return { quantId: String(quantId), targetLocationId: String(target.id), quantity };
}
