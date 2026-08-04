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
  try {
    return BigInt(String(v))
  } catch {
    throw new Error(
      `warehouse field '${camel}' could not be parsed as a u64: ${String(v)}`,
    )
  }
}

export function optU64FromRow(
  row: Record<string, unknown>,
  camel: string,
  snake: string,
): bigint | undefined {
  const v = row[camel] ?? row[snake]
  if (v == null || v === "") return undefined
  try {
    return BigInt(String(v))
  } catch {
    return undefined
  }
}

export function u64ArrayFromRow(
  row: Record<string, unknown>,
  camel: string,
  snake: string,
): bigint[] {
  const v = row[camel] ?? row[snake]
  if (v == null || !Array.isArray(v)) return []
  return v.map((x) => {
    try {
      return BigInt(String(x))
    } catch {
      return 0n
    }
  })
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

  const n = (b: bigint) => Number(b)
  const optNum = (camel: string, snake: string) => {
    const x = optU64FromRow(template, camel, snake)
    return x === undefined ? undefined : n(x)
  }

  return {
    name,
    code,
    lotStockId: n(u64FromRow(template, "lotStockId", "lot_stock_id")),
    inTypeId: n(u64FromRow(template, "inTypeId", "in_type_id")),
    outTypeId: n(u64FromRow(template, "outTypeId", "out_type_id")),
    intTypeId: n(u64FromRow(template, "intTypeId", "int_type_id")),
    packTypeId: n(u64FromRow(template, "packTypeId", "pack_type_id")),
    pickTypeId: n(u64FromRow(template, "pickTypeId", "pick_type_id")),
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
    partnerId: optNum("partnerId", "partner_id"),
    whInputStockLocId: optNum("whInputStockLocId", "wh_input_stock_loc_id"),
    whPackStockLocId: optNum("whPackStockLocId", "wh_pack_stock_loc_id"),
    whOutputStockLocId: optNum("whOutputStockLocId", "wh_output_stock_loc_id"),
    whQcStockLocId: optNum("whQcStockLocId", "wh_qc_stock_loc_id"),
    whScrapLocId: optNum("whScrapLocId", "wh_scrap_loc_id"),
    qcTypeId: optNum("qcTypeId", "qc_type_id"),
    returnTypeId: optNum("returnTypeId", "return_type_id"),
    viewLocationId: optNum("viewLocationId", "view_location_id"),
    mtoPullId: optNum("mtoPullId", "mto_pull_id"),
    buyPullId: optNum("buyPullId", "buy_pull_id"),
    resupplyWhIds: u64ArrayFromRow(template, "resupplyWhIds", "resupply_wh_ids").map((x) => n(x)),
    resupplyFromIds: u64ArrayFromRow(template, "resupplyFromIds", "resupply_from_ids").map((x) =>
      n(x),
    ),
    pbhDpmIds: u64ArrayFromRow(template, "pbhDpmIds", "pbh_dpm_ids").map((x) => n(x)),
    metadata: template.metadata != null ? String(template.metadata) : undefined,
  }
}
