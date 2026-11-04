import { parseStrictU64 } from '@lumiere/erp-shared/u64'

/**
 * Build {@link CreateWarehouseParams} for HTTP reducer calls by cloning operational
 * IDs from an existing warehouse row (API rows may be camelCase or snake_case).
 */
export function u64FromRow(
  row: Record<string, unknown>,
  camel: string,
  snake: string,
): bigint {
  const v = row[camel] ?? row[snake]
  if (v == null || v === "") {
    throw new Error(`warehouse field '${camel}' is required but was missing`)
  }
  const parsed = parseStrictU64(v)
  if (parsed == null || parsed <= 0n) throw new Error(`warehouse field '${camel}' must be a positive u64`)
  return parsed
}

export function optU64FromRow(
  row: Record<string, unknown>,
  camel: string,
  snake: string,
): bigint | undefined {
  const v = row[camel] ?? row[snake]
  if (v == null || v === "") return undefined
  return u64FromRow(row, camel, snake)
}

export function u64ArrayFromRow(
  row: Record<string, unknown>,
  camel: string,
  snake: string,
): bigint[] {
  const v = row[camel] ?? row[snake]
  if (v == null) return []
  if (!Array.isArray(v)) throw new Error(`warehouse field '${camel}' must be an array`)
  return v.map(value => u64FromRow({ value }, 'value', 'value'))
}

export function buildCreateWarehouseParamsFromTemplate(
  template: Record<string, unknown>,
  opts: {
    name: string
    code: string
    active: boolean
    sequence: number
    /** Form field `templateWarehouseId` — not sent on the wire; ties UI to the chosen template row */
    templateWarehouseId?: string | number
  },
): Record<string, unknown> {
  void opts.templateWarehouseId
  const name = opts.name.trim()
  const code = opts.code.trim()
  if (!name || !code) {
    throw new Error("Warehouse name and code are required")
  }

  const optId = (camel: string, snake: string) => optU64FromRow(template, camel, snake)

  return {
    name,
    code,
    lotStockId: u64FromRow(template, "lotStockId", "lot_stock_id"),
    inTypeId: u64FromRow(template, "inTypeId", "in_type_id"),
    outTypeId: u64FromRow(template, "outTypeId", "out_type_id"),
    intTypeId: u64FromRow(template, "intTypeId", "int_type_id"),
    packTypeId: u64FromRow(template, "packTypeId", "pack_type_id"),
    pickTypeId: u64FromRow(template, "pickTypeId", "pick_type_id"),
    receptionSteps: String(template.receptionSteps ?? template.reception_steps ?? "one_step"),
    deliverySteps: String(template.deliverySteps ?? template.delivery_steps ?? "ship"),
    manufactureSteps: String(
      template.manufactureSteps ?? template.manufacture_steps ?? "one_step",
    ),
    active: opts.active,
    crossdock: Boolean(template.crossdock ?? false),
    buyToResupply: Boolean(template.buyToResupply ?? template.buy_to_resupply ?? false),
    manufactureToResupply: Boolean(
      template.manufactureToResupply ?? template.manufacture_to_resupply ?? false,
    ),
    resupplySubcontractorOnOrder: Boolean(
      template.resupplySubcontractorOnOrder ??
        template.resupply_subcontractor_on_order ??
        false,
    ),
    subcontractingToResupply: Boolean(
      template.subcontractingToResupply ?? template.subcontracting_to_resupply ?? false,
    ),
    sequence: opts.sequence,
    partnerId: optId("partnerId", "partner_id"),
    whInputStockLocId: optId("whInputStockLocId", "wh_input_stock_loc_id"),
    whPackStockLocId: optId("whPackStockLocId", "wh_pack_stock_loc_id"),
    whOutputStockLocId: optId("whOutputStockLocId", "wh_output_stock_loc_id"),
    whQcStockLocId: optId("whQcStockLocId", "wh_qc_stock_loc_id"),
    whScrapLocId: optId("whScrapLocId", "wh_scrap_loc_id"),
    qcTypeId: optId("qcTypeId", "qc_type_id"),
    returnTypeId: optId("returnTypeId", "return_type_id"),
    viewLocationId: optId("viewLocationId", "view_location_id"),
    mtoPullId: optId("mtoPullId", "mto_pull_id"),
    buyPullId: optId("buyPullId", "buy_pull_id"),
    resupplyWhIds: u64ArrayFromRow(template, "resupplyWhIds", "resupply_wh_ids"),
    resupplyFromIds: u64ArrayFromRow(template, "resupplyFromIds", "resupply_from_ids"),
    pbhDpmIds: u64ArrayFromRow(template, "pbhDpmIds", "pbh_dpm_ids"),
    metadata: template.metadata != null ? String(template.metadata) : undefined,
  }
}
