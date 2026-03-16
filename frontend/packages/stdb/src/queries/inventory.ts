import ProductRow from "../generated/product_table";
import StockQuantRow from "../generated/stock_quant_table";
import StockPickingRow from "../generated/stock_picking_table";
import WarehouseRow from "../generated/warehouse_table";
import InventoryAdjustmentRow from "../generated/inventory_adjustment_table";
import type { Infer } from "spacetimedb";
import { getStdbConnection } from "../connection";

// ── Row types ─────────────────────────────────────────────────────────────────
export type Product = Infer<typeof ProductRow>;
export type StockQuant = Infer<typeof StockQuantRow>;
export type StockPicking = Infer<typeof StockPickingRow>;
export type Warehouse = Infer<typeof WarehouseRow>;
export type InventoryAdjustment = Infer<typeof InventoryAdjustmentRow>;

// ── Subscription SQL ──────────────────────────────────────────────────────────
export function inventorySubscriptions(organizationId: bigint, companyId: bigint): string[] {
  const orgId = String(organizationId);
  const cId = String(companyId);
  return [
    `SELECT * FROM product WHERE organization_id = ${orgId}`,
    `SELECT * FROM product_category WHERE organization_id = ${orgId}`,
    `SELECT * FROM stock_quant WHERE company_id = ${cId}`,
    `SELECT * FROM stock_picking WHERE company_id = ${cId}`,
    `SELECT * FROM warehouse WHERE company_id = ${cId}`,
    `SELECT * FROM stock_location WHERE company_id = ${cId}`,
    `SELECT * FROM inventory_adjustment WHERE organization_id = ${orgId}`,
  ];
}

// ── Query functions ───────────────────────────────────────────────────────────
export function queryProducts(): Product[] {
  const conn = getStdbConnection();
  if (!conn) return [];
  return [...conn.db.product.iter()].sort((a, b) => a.name.localeCompare(b.name));
}

export function queryStockQuants(): StockQuant[] {
  const conn = getStdbConnection();
  if (!conn) return [];
  return [...conn.db.stock_quant.iter()].sort(
    (a, b) => Number(b.availableQuantity) - Number(a.availableQuantity),
  );
}

export function queryStockPickings(): StockPicking[] {
  const conn = getStdbConnection();
  if (!conn) return [];
  return [...conn.db.stock_picking.iter()].sort(
    (a, b) => Number(b.scheduledDate ?? 0) - Number(a.scheduledDate ?? 0),
  );
}

export function queryWarehouses(): Warehouse[] {
  const conn = getStdbConnection();
  if (!conn) return [];
  return [...conn.db.warehouse.iter()].sort((a, b) => a.name.localeCompare(b.name));
}

export function queryInventoryAdjustments(): InventoryAdjustment[] {
  const conn = getStdbConnection();
  if (!conn) return [];
  return [...conn.db.inventory_adjustment.iter()].sort(
    (a, b) => Number(b.date ?? 0) - Number(a.date ?? 0),
  );
}
