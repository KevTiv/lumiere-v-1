"use client"

import { useQueryClient } from '@tanstack/react-query'
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"
import { INVENTORY_QUERY_RESOURCES, PICKING_ORDER_RESOURCES } from "@lumiere/erp-workflows"
import { rqBigIntKey } from "../../http"
import { invalidateQueryResources } from "../workflow"

export function companyScopeParams(companyId: bigint): Record<string, unknown> {
  return stdbParamsToJson({ companyId }, 'CompanyScopeParams')
}

/** Shallow merge for reducer JSON: `overrides` entries with value `undefined` are skipped. */
export function mergeReducerParams(
  base: Record<string, unknown>,
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base }
  for (const [k, v] of Object.entries(overrides)) {
    if (v !== undefined) out[k] = v
  }
  return out
}

export const CREATE_PRODUCT_DEFAULTS: Record<string, unknown> = {
  costMethod: 'standard',
  valuation: 'manual_periodic',
}

export const CREATE_STOCK_QUANT_DEFAULTS: Record<string, unknown> = {
  inventoryQuantity: 0,
  inventoryDiffQuantity: 0,
  inventoryQuantitySet: false,
  isOutdated: false,
  accountingEntryIds: [],
}

export const CREATE_STOCK_PICKING_DEFAULTS: Record<string, unknown> = {
  moveType: 'direct',
  priority: '0',
  isLocked: false,
  immediateTransfer: false,
  isPrinted: false,
  isReturn: false,
  hasScrapMove: false,
  hasTracking: false,
  backorderIds: [],
  showOperations: true,
  showLotsText: false,
  showReserved: true,
  showCheckAvailability: true,
  showValidate: true,
  showMarkAsTodo: false,
  showSetQtyButton: false,
  showClearQtyButton: false,
  showLotsM2O: false,
  moveLineExist: false,
  hasPackages: false,
  hasMoveLines: false,
  hasPackage: false,
  hasLot: false,
  hasOwner: false,
  hasEntirePackageSrc: false,
  hasEntirePackageDest: false,
  packageLevelIds: [],
}

export const CREATE_STOCK_LOCATION_DEFAULTS: Record<string, unknown> = {
  childLeft: 0,
  childRight: 1,
  scrapLocation: false,
  returnLocation: false,
  active: true,
  posx: 0,
  posy: 0,
  posz: 0,
  cyclicInventoryFrequency: 0,
}

export function invalidateInventoryQueries(
  qc: ReturnType<typeof useQueryClient>,
  organizationId: bigint,
) {
  void invalidateQueryResources(qc, organizationId, INVENTORY_QUERY_RESOURCES)
}

/**
 * A picking transition also mutates the order that originated it (delivered/received qty,
 * invoiceable qty, linked backorders), so the owning order lists must converge with it.
 */
export function invalidateFulfillmentQueries(
  qc: ReturnType<typeof useQueryClient>,
  organizationId: bigint,
) {
  invalidateInventoryQueries(qc, organizationId)
  void invalidateQueryResources(qc, organizationId, PICKING_ORDER_RESOURCES)
}
