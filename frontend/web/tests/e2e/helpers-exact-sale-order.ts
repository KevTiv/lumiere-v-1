import type { Page } from "@playwright/test"

import { scalarQueryId } from "./helpers-legacy"

type SaleOrderEffectRow = {
  id?: unknown
  opportunityId?: unknown
  opportunity_id?: unknown
  companyId?: unknown
  company_id?: unknown
}

function matchesExactEffect(
  row: SaleOrderEffectRow,
  opportunityId: number,
  companyId?: number,
): boolean {
  if (scalarQueryId(row.opportunityId ?? row.opportunity_id) !== opportunityId) return false
  if (companyId == null) return true
  return scalarQueryId(row.companyId ?? row.company_id) === companyId
}

/**
 * Read the exact sale-order effects for an opportunity. No partner/name/date
 * fallback is permitted: missing relationship metadata is a contract failure,
 * not permission to guess another record.
 */
export async function fetchSaleOrderIdsByOpportunityId(
  page: Page,
  opportunityId: number,
  companyId?: number,
): Promise<number[]> {
  const response = await page.request.get("/api/query/sale-orders")
  if (!response.ok()) {
    throw new Error(`sale-orders query failed: ${response.status()}`)
  }

  const json = (await response.json()) as { data?: SaleOrderEffectRow[] }
  return (json.data ?? [])
    .filter((row) => matchesExactEffect(row, opportunityId, companyId))
    .map((row) => scalarQueryId(row.id))
    .filter((id): id is number => id != null)
}

/**
 * Poll for the unique sale order linked to the exact CRM opportunity relation.
 * Cardinality is 0..1. Duplicate exact effects are an invariant failure and are
 * never hidden by selecting the newest/highest id.
 */
export async function fetchSaleOrderIdByOpportunityId(
  page: Page,
  opportunityId: number,
  companyId?: number,
): Promise<number> {
  const deadline = Date.now() + 30_000
  let lastCount = 0

  while (Date.now() < deadline) {
    const ids = await fetchSaleOrderIdsByOpportunityId(page, opportunityId, companyId)
    lastCount = ids.length
    if (ids.length === 1) return ids[0]!
    if (ids.length > 1) {
      throw new Error(
        `expected one sale order for opportunity ${opportunityId}${companyId == null ? "" : ` in company ${companyId}`}, found ${ids.length}: ${ids.join(", ")}`,
      )
    }
    await page.waitForTimeout(250)
  }

  throw new Error(
    `sale order not found by exact opportunity relation: opportunity=${opportunityId}${companyId == null ? "" : ` company=${companyId}`} matches=${lastCount}`,
  )
}
