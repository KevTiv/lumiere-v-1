import type SaleOrderRow from "../generated/sale_order_table";
import type SaleOrderLineRow from "../generated/sale_order_line_table";
import type ProductPricelistRow from "../generated/product_pricelist_table";
import type ProductPricelistItemRow from "../generated/product_pricelist_item_table";
import type StockPickingBatchRow from "../generated/stock_picking_batch_table";
import type { Infer } from "spacetimedb";
import { getStdbConnection } from "../connection";

// ── Row types ─────────────────────────────────────────────────────────────────
export type SaleOrder = Infer<typeof SaleOrderRow>;
export type SaleOrderLine = Infer<typeof SaleOrderLineRow>;
export type ProductPricelist = Infer<typeof ProductPricelistRow>;
export type ProductPricelistItem = Infer<typeof ProductPricelistItemRow>;
export type StockPickingBatch = Infer<typeof StockPickingBatchRow>;

// ── Subscription SQL ──────────────────────────────────────────────────────────
/** @param scopeId Tenant scope: same numeric id used for `company_id` on sale tables and `organization_id` on org-scoped tables (e.g. pricelist). */
export function salesSubscriptions(scopeId: bigint): string[] {
  const id = String(scopeId);
  return [
    `SELECT * FROM sale_order WHERE company_id = ${id}`,
    `SELECT * FROM sale_order_line WHERE company_id = ${id}`,
    `SELECT * FROM product_pricelist WHERE organization_id = ${id}`,
    `SELECT * FROM product_pricelist_item WHERE organization_id = ${id}`,
    `SELECT * FROM stock_picking_batch WHERE company_id = ${id}`,
  ];
}

// ── Query functions ───────────────────────────────────────────────────────────
export function querySaleOrders(): SaleOrder[] {
  const conn = getStdbConnection();
  if (!conn) return [];
  return [...conn.db.sale_order.iter()].sort(
    (a, b) => Number(b.dateOrder) - Number(a.dateOrder),
  );
}

export function querySaleOrderLines(): SaleOrderLine[] {
  const conn = getStdbConnection();
  if (!conn) return [];
  return [...conn.db.sale_order_line.iter()];
}

export function queryPricelists(): ProductPricelist[] {
  const conn = getStdbConnection();
  if (!conn) return [];
  return [...conn.db.product_pricelist.iter()].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}

export function queryPickingBatches(): StockPickingBatch[] {
  const conn = getStdbConnection();
  if (!conn) return [];
  return [...conn.db.stock_picking_batch.iter()].sort(
    (a, b) => Number(b.scheduledDate ?? 0) - Number(a.scheduledDate ?? 0),
  );
}
