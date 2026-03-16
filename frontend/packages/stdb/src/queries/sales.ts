import SaleOrderRow from "../generated/sale_order_table";
import SaleOrderLineRow from "../generated/sale_order_line_table";
import ProductPricelistRow from "../generated/product_pricelist_table";
import StockPickingBatchRow from "../generated/stock_picking_batch_table";
import type { Infer } from "spacetimedb";
import { getStdbConnection } from "../connection";

// ── Row types ─────────────────────────────────────────────────────────────────
export type SaleOrder = Infer<typeof SaleOrderRow>;
export type SaleOrderLine = Infer<typeof SaleOrderLineRow>;
export type ProductPricelist = Infer<typeof ProductPricelistRow>;
export type StockPickingBatch = Infer<typeof StockPickingBatchRow>;

// ── Subscription SQL ──────────────────────────────────────────────────────────
export function salesSubscriptions(companyId: bigint): string[] {
  const id = String(companyId);
  return [
    `SELECT * FROM sale_order WHERE company_id = ${id}`,
    `SELECT * FROM sale_order_line WHERE company_id = ${id}`,
    `SELECT * FROM product_pricelist WHERE company_id = ${id}`,
    `SELECT * FROM product_pricelist_item WHERE company_id = ${id}`,
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
