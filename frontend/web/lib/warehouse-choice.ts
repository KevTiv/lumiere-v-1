import { buildModuleTabHref } from "@lumiere/erp-shared/ai-source-links"
import { parseStrictU64 } from "@lumiere/erp-shared/u64"
import type { Action } from "@lumiere/ui/lib/rbac-types"
import { warehouseRowsToSelectOptions } from "./form-lookup"

export const WAREHOUSE_CREATE_PERMISSION = { resource: "warehouse", action: "create" } as const

export function warehouseSetupAccess(check: (resource: string, action: Action) => { allowed: boolean }) {
  return {
    warehouse: check("module:inventory", "read").allowed &&
      check("warehouse", "read").allowed && check("stock_location", "read").allowed &&
      check(WAREHOUSE_CREATE_PERMISSION.resource, WAREHOUSE_CREATE_PERMISSION.action).allowed,
    location: check("stock_location", "read").allowed && check("stock_location", "create").allowed,
  }
}

export function warehouseSetupHref(companyId: bigint) {
  return `${buildModuleTabHref("warehouse", "warehouses")}&companyId=${companyId}`
}

export function companyWarehouseOptions(
  rows: readonly {
    id?: unknown
    organizationId?: unknown
    companyId?: unknown
    name?: unknown
    code?: unknown
    active?: unknown
  }[],
  organizationId: bigint,
  companyId: bigint,
) {
  if (rows.some(row => parseStrictU64(row.organizationId) == null ||
    parseStrictU64(row.companyId) == null || typeof row.active !== "boolean")) return null
  return warehouseRowsToSelectOptions(rows.filter(row =>
    parseStrictU64(row.organizationId) === organizationId &&
    parseStrictU64(row.companyId) === companyId && row.active === true &&
    (parseStrictU64(row.id) ?? 0n) > 0n,
  ))
}
