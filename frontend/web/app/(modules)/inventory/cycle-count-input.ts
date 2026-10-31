import { parseStrictU64 } from "@lumiere/erp-shared/u64";
import type { EntitySurfacePermission } from "@lumiere/ui/lib/entity-view-types";

export const CYCLE_COUNT_PERMISSIONS = {
  plan: { resource: "stock_cycle_count", action: "create" },
  start: { resource: "stock_cycle_count", action: "write" },
  line: { resource: "stock_count_sheet", action: "create" },
  validate: { resource: "stock_cycle_count", action: "write" },
  post: { resource: "stock_cycle_count", action: "write" },
} as const satisfies Record<string, EntitySurfacePermission>;

export type CycleCountAction = keyof typeof CYCLE_COUNT_PERMISSIONS;

export function cycleCountId(value: unknown, message: string): bigint {
  const id = parseStrictU64(value);
  if (id === undefined || id === 0n) throw new Error(message);
  return id;
}

export function cycleCountQuantity(value: unknown, message: string): number {
  if (typeof value !== "string" && typeof value !== "number") throw new Error(message);
  if (typeof value === "string" && !/^\+?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())) {
    throw new Error(message);
  }
  const quantity = Number(value);
  if (!Number.isFinite(quantity) || quantity < 0) throw new Error(message);
  return quantity;
}

/** Counts are posted in the product's stock unit; the existing native owner does not convert. */
export function prepareCycleCountLine(
  input: {
    cycleCountId: unknown;
    productId: unknown;
    locationId: unknown;
    uomId: unknown;
    stockUomId: unknown;
    quantity: unknown;
  },
  message: string,
) {
  const uomId = cycleCountId(input.uomId, message);
  if (uomId !== cycleCountId(input.stockUomId, message)) throw new Error(message);
  return {
    cycleCountId: cycleCountId(input.cycleCountId, message),
    params: {
      productId: cycleCountId(input.productId, message),
      locationId: cycleCountId(input.locationId, message),
      lotId: undefined,
      qtyCounted: cycleCountQuantity(input.quantity, message),
      uomId,
      notes: undefined,
      metadata: undefined,
    },
  };
}

export interface CycleCountScope {
  organizationId: string;
  companyId: string;
  actorId: string;
}

export function assertCycleCountScope(
  expected: CycleCountScope,
  current: CycleCountScope & { mounted: boolean; allowed: boolean },
  message: string,
): void {
  if (!current.mounted || !current.allowed || !current.actorId ||
    !current.companyId || current.companyId === "0" ||
    expected.organizationId !== current.organizationId ||
    expected.companyId !== current.companyId || expected.actorId !== current.actorId) {
    throw new Error(message);
  }
}
