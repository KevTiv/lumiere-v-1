import PurchaseOrderRow from "../generated/purchase_order_table";
import PurchaseOrderLineRow from "../generated/purchase_order_line_table";
import PurchaseRequisitionRow from "../generated/purchase_requisition_table";
import type { Infer } from "spacetimedb";
import { getStdbConnection } from "../connection";

// ── Row types ─────────────────────────────────────────────────────────────────
export type PurchaseOrder = Infer<typeof PurchaseOrderRow>;
export type PurchaseOrderLine = Infer<typeof PurchaseOrderLineRow>;
export type PurchaseRequisition = Infer<typeof PurchaseRequisitionRow>;

// ── Subscription SQL ──────────────────────────────────────────────────────────
export function purchasingSubscriptions(organizationId: bigint, companyId: bigint): string[] {
  const orgId = String(organizationId);
  const cId = String(companyId);
  return [
    `SELECT * FROM purchase_order WHERE company_id = ${cId}`,
    `SELECT * FROM purchase_order_line WHERE company_id = ${cId}`,
    `SELECT * FROM purchase_requisition WHERE company_id = ${cId}`,
  ];
}

// ── Query functions ───────────────────────────────────────────────────────────
export function queryPurchaseOrders(): PurchaseOrder[] {
  const conn = getStdbConnection();
  if (!conn) return [];
  return [...conn.db.purchase_order.iter()].sort(
    (a, b) => Number(b.dateOrder ?? 0) - Number(a.dateOrder ?? 0),
  );
}

export function queryPurchaseOrderLines(): PurchaseOrderLine[] {
  const conn = getStdbConnection();
  if (!conn) return [];
  return [...conn.db.purchase_order_line.iter()].sort(
    (a, b) => Number(a.sequence ?? 0) - Number(b.sequence ?? 0),
  );
}

export function queryPurchaseRequisitions(): PurchaseRequisition[] {
  const conn = getStdbConnection();
  if (!conn) return [];
  return [...conn.db.purchase_requisition.iter()].sort(
    (a, b) => Number(b.createDate ?? 0) - Number(a.createDate ?? 0),
  );
}
