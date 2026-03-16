import MrpProductionRow from "../generated/mrp_production_table";
import MrpBomRow from "../generated/mrp_bom_table";
import MrpBomLineRow from "../generated/mrp_bom_line_table";
import MrpWorkorderRow from "../generated/mrp_workorder_table";
import MrpWorkcenterRow from "../generated/mrp_workcenter_table";
import type { Infer } from "spacetimedb";
import { getStdbConnection } from "../connection";

// ── Row types ─────────────────────────────────────────────────────────────────
export type MrpProduction = Infer<typeof MrpProductionRow>;
export type MrpBom = Infer<typeof MrpBomRow>;
export type MrpBomLine = Infer<typeof MrpBomLineRow>;
export type MrpWorkorder = Infer<typeof MrpWorkorderRow>;
export type MrpWorkcenter = Infer<typeof MrpWorkcenterRow>;

// ── Subscription SQL ──────────────────────────────────────────────────────────
export function manufacturingSubscriptions(organizationId: bigint, companyId: bigint): string[] {
  const orgId = String(organizationId);
  const cId = String(companyId);
  return [
    `SELECT * FROM mrp_production WHERE company_id = ${cId}`,
    `SELECT * FROM mrp_bom WHERE company_id = ${cId}`,
    `SELECT * FROM mrp_bom_line WHERE company_id = ${cId}`,
    `SELECT * FROM mrp_workorder WHERE company_id = ${cId}`,
    `SELECT * FROM mrp_workcenter WHERE company_id = ${cId}`,
  ];
}

// ── Query functions ───────────────────────────────────────────────────────────
export function queryMrpProductions(): MrpProduction[] {
  const conn = getStdbConnection();
  if (!conn) return [];
  return [...conn.db.mrp_production.iter()].sort(
    (a, b) => Number(b.datePlannedStart ?? 0) - Number(a.datePlannedStart ?? 0),
  );
}

export function queryMrpBoms(): MrpBom[] {
  const conn = getStdbConnection();
  if (!conn) return [];
  return [...conn.db.mrp_bom.iter()].sort(
    (a, b) => Number(a.sequence ?? 0) - Number(b.sequence ?? 0),
  );
}

export function queryMrpBomLines(): MrpBomLine[] {
  const conn = getStdbConnection();
  if (!conn) return [];
  return [...conn.db.mrp_bom_line.iter()].sort(
    (a, b) => Number(a.sequence ?? 0) - Number(b.sequence ?? 0),
  );
}

export function queryMrpWorkorders(): MrpWorkorder[] {
  const conn = getStdbConnection();
  if (!conn) return [];
  return [...conn.db.mrp_workorder.iter()].sort(
    (a, b) => Number(a.sequence ?? 0) - Number(b.sequence ?? 0),
  );
}

export function queryMrpWorkcenters(): MrpWorkcenter[] {
  const conn = getStdbConnection();
  if (!conn) return [];
  return [...conn.db.mrp_workcenter.iter()].sort((a, b) => a.name.localeCompare(b.name));
}
