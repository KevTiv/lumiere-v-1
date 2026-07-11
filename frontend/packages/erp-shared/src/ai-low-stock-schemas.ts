/**
 * Typed schemas for the promoted `low_stock` green AI skill.
 *
 * Mirrored from `ai-gateway/src/harness/low_stock.rs`.
 */

import type { PolicyResult } from "./ai-policy-schemas"
import type { HarnessAuditTrail } from "./ai-report-composer-schemas"

export interface LowStockInput {
  threshold: number
  locationId?: number | null
}

export interface LowStockItem {
  organizationId: number
  companyId: number
  productId: number
  sku: string
  name: string
  quantityOnHand: number
  reorderLevel: number
}

export interface LowStockScanResult {
  decision: PolicyResult
  summary: string
  items: LowStockItem[]
  audit: HarnessAuditTrail
}

export type { PolicyResult, HarnessAuditTrail }
