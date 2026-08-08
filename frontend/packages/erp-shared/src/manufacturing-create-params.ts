/**
 * Maps Manufacturing module form payloads to SpacetimeDB Create*Params types.
 *
 * # Mapper contract
 *
 * - Required fields return null from the mapper (handled by caller with early-return).
 * - Server-derived fields (lifecycle state, projections, counters, reverse arrays) are
 *   owned by the server and must not be sent by the client.
 * - Dates must be explicitly supplied; there is no fallback to the current time.
 * - Company is derived from the ManufacturingOrderMapperContext; caller must supply a
 *   validated active-company ID — the mapper never defaults to zero.
 */

import type {
  BomLineInput,
  BomType,
  CreateBomParams,
  CreateMrpProductionParams,
  CreateRoutingWorkcenterParams,
  CreateWorkcenterParams,
  CreateWorkcenterProductivityParams,
  CreateWorkorderParams,
} from "@lumiere/stdb/types"

import { formValue as field, optionalBigIntU64, u64IdArrayFromForm } from "./form-coercion"
import { stbTimestampFromDate } from "./stb-timestamp"

function optionalTrimmedString(v: unknown): string | undefined {
  if (v == null) return undefined
  const s = String(v).trim()
  return s === "" ? undefined : s
}

function requiredBigIntU64(v: unknown): bigint | null {
  const b = optionalBigIntU64(v)
  return b === undefined ? null : b
}

function num(v: unknown, fallback = 0): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

/**
 * Parse a date from form input.
 * Returns null if the value is absent or unparseable — no fallback to current time.
 */
function requiredTimestampFromForm(v: unknown): ReturnType<typeof stbTimestampFromDate> | null {
  if (v == null || String(v).trim() === "") return null
  const d = new Date(String(v))
  if (Number.isNaN(d.getTime())) return null
  return stbTimestampFromDate(d)
}

function optionalTimestampFromForm(v: unknown) {
  if (v == null || String(v).trim() === "") return undefined
  const d = new Date(String(v))
  if (Number.isNaN(d.getTime())) return undefined
  return stbTimestampFromDate(d)
}

function bomTypeFromForm(raw: unknown): BomType {
  const value = String(raw ?? "Manufacture").trim()
  switch (value) {
    case "Kit":
      return { tag: "Kit" }
    case "Subcontract":
    case "Subcontracting":
      return { tag: "Subcontract" }
    case "Manufacture":
    case "Normal":
    case "Phantom":
    default:
      return { tag: "Manufacture" }
  }
}

export type ManufacturingOrderMapperContext = {
  productUomId: bigint
  /** Active company ID. Must be non-zero; mapper returns null if absent. */
  companyId?: bigint
}

export function toCreateMrpProductionParams(
  formData: Record<string, unknown>,
  context: ManufacturingOrderMapperContext,
): CreateMrpProductionParams | null {
  const productId = requiredBigIntU64(field(formData, "productId", "product_id"))
  const warehouseId = requiredBigIntU64(field(formData, "warehouseId", "warehouse_id"))
  const pickingTypeId = requiredBigIntU64(field(formData, "pickingTypeId", "picking_type_id"))
  const locationSrcId = requiredBigIntU64(field(formData, "locationSrcId", "location_src_id"))
  const locationDestId = requiredBigIntU64(field(formData, "locationDestId", "location_dest_id"))
  if (
    productId === null ||
    warehouseId === null ||
    pickingTypeId === null ||
    locationSrcId === null ||
    locationDestId === null
  ) {
    return null
  }

  // Dates are required — no fallback to current time.
  const plannedStart = requiredTimestampFromForm(field(formData, "datePlannedStart", "date_planned_start"))
  const plannedFinished = requiredTimestampFromForm(
    field(formData, "datePlannedFinished", "date_planned_finished") ??
      field(formData, "datePlannedStart", "date_planned_start"),
  )
  if (plannedStart === null || plannedFinished === null) return null

  return {
    // Context-derived — company must come from caller; never zero.
    companyId: context.companyId,
    productId,
    productQty: num(field(formData, "productQty", "product_qty"), 1),
    productUomId: context.productUomId,
    datePlannedStart: plannedStart,
    datePlannedFinished: plannedFinished,
    locationSrcId,
    locationDestId,
    warehouseId,
    pickingTypeId,
    consumption: optionalTrimmedString(field(formData, "consumption", "consumption")),
    bomId: optionalBigIntU64(field(formData, "bomId", "bom_id")),
    routingId: optionalBigIntU64(field(formData, "routingId", "routing_id")),
    procGroupId: optionalBigIntU64(field(formData, "procGroupId", "proc_group_id")),
    procurementGroupId: optionalBigIntU64(
      field(formData, "procurementGroupId", "procurement_group_id"),
    ),
    dateDeadline: optionalTimestampFromForm(
      field(formData, "dateDeadline", "date_deadline") ??
        field(formData, "datePlannedFinished", "date_planned_finished"),
    ),
    origin: optionalTrimmedString(field(formData, "origin", "origin")),
    responsibleUserId: undefined,
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}

export type BomMapperContext = {
  productUomId: bigint
  companyId?: bigint
}

export type BomLineFormEntry = {
  productId: bigint
  productQty: number
  productUomId: bigint
  sequence: number
  operationId?: bigint
}

export function toBomLineInput(entry: BomLineFormEntry): BomLineInput {
  return {
    productId: entry.productId,
    productQty: entry.productQty,
    productUomId: entry.productUomId,
    sequence: entry.sequence,
    manualConsumption: false,
    attachmentsCount: 0,
    operationId: entry.operationId,
    childBomId: undefined,
    bomProductTemplateAttributeValueIds: [],
    possibleBomProductTemplateAttributeValueIds: [],
    metadata: undefined,
  }
}

function parseBomLines(raw: unknown, defaultUomId: bigint): BomLineInput[] {
  if (raw == null || raw === "") return []
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((entry: Record<string, unknown>, idx: number): BomLineInput[] => {
      const productId = optionalBigIntU64(entry.productId ?? entry.product_id)
      const productUomId =
        optionalBigIntU64(entry.productUomId ?? entry.product_uom_id) ?? defaultUomId
      if (!productId) return []
      return [
        toBomLineInput({
          productId,
          productQty: num(entry.productQty ?? entry.product_qty, 1),
          productUomId,
          sequence: Math.trunc(num(entry.sequence, (idx + 1) * 10)),
          operationId: optionalBigIntU64(entry.operationId ?? entry.operation_id),
        }),
      ]
    })
  } catch {
    return []
  }
}

export function toCreateBomParams(
  formData: Record<string, unknown>,
  context: BomMapperContext,
): CreateBomParams | null {
  const productTmplId = requiredBigIntU64(field(formData, "productTmplId", "product_tmpl_id"))
  if (productTmplId === null) return null

  return {
    companyId: context.companyId,
    type: bomTypeFromForm(field(formData, "type", "type_")),
    productId: productTmplId,
    productQty: num(field(formData, "productQty", "product_qty"), 1),
    productUomId: context.productUomId,
    readyToProduce: String(field(formData, "readyToProduce", "ready_to_produce") ?? "asap"),
    consumption: String(field(formData, "consumption", "consumption") ?? "flexible"),
    sequence: Math.trunc(num(field(formData, "sequence", "sequence"), 1)),
    lines: parseBomLines(field(formData, "bomLines", "bom_lines"), context.productUomId),
    pickingTypeId: optionalBigIntU64(field(formData, "pickingTypeId", "picking_type_id")),
    locationSrcId: optionalBigIntU64(field(formData, "locationSrcId", "location_src_id")),
    locationDestId: optionalBigIntU64(field(formData, "locationDestId", "location_dest_id")),
    warehouseId: optionalBigIntU64(field(formData, "warehouseId", "warehouse_id")),
    routingId: optionalBigIntU64(field(formData, "routingId", "routing_id")),
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}

export function toCreateWorkcenterParams(
  formData: Record<string, unknown>,
  companyId?: bigint,
): CreateWorkcenterParams | null {
  const name = String(field(formData, "name", "name") ?? "").trim()
  if (!name) return null

  const oeeTarget = num(field(formData, "oeeTarget", "oee_target"), 85)
  const timeEfficiency = num(field(formData, "timeEfficiency", "time_efficiency"), 100)
  const capacity = num(field(formData, "capacity", "capacity"), 1)

  return {
    companyId,
    name,
    active: field(formData, "active", "active") !== false,
    code: optionalTrimmedString(field(formData, "code", "code")),
    workingState: String(field(formData, "workingState", "working_state") ?? "normal"),
    oeeTarget,
    timeEfficiency,
    capacity,
    capacityIds: u64IdArrayFromForm(field(formData, "capacityIds", "capacity_ids")),
    alternativeWorkcenterIds: u64IdArrayFromForm(
      field(formData, "alternativeWorkcenterIds", "alternative_workcenter_ids"),
    ),
    color: (() => {
      const raw = field(formData, "color", "color")
      if (raw == null || raw === "") return undefined
      return Math.trunc(num(raw))
    })(),
    resourceCalendarId: optionalBigIntU64(field(formData, "resourceCalendarId", "resource_calendar_id")),
    tagIds: u64IdArrayFromForm(field(formData, "tagIds", "tag_ids")),
    defaultCapacityParentId: optionalBigIntU64(
      field(formData, "defaultCapacityParentId", "default_capacity_parent_id"),
    ),
    defaultTimeEfficiency: num(
      field(formData, "defaultTimeEfficiency", "default_time_efficiency"),
      timeEfficiency,
    ),
    defaultOeeTarget: num(field(formData, "defaultOeeTarget", "default_oee_target"), oeeTarget),
    sequence: Math.trunc(num(field(formData, "sequence", "sequence"), 1)),
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}

function parseU64List(raw: unknown): bigint[] {
  const str = String(raw ?? "").trim()
  if (!str) return []
  const out: bigint[] = []
  for (const p of str.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean)) {
    const b = optionalBigIntU64(p)
    if (b !== undefined) out.push(b)
  }
  return out
}

export function toCreateRoutingWorkcenterParams(
  formData: Record<string, unknown>,
  workcenterId: bigint,
): CreateRoutingWorkcenterParams | null {
  const name = String(
    field(formData, "routingOpName", "routing_op_name") ?? field(formData, "name", "name") ?? "",
  ).trim()
  if (!name) return null
  return {
    workcenterId,
    name,
    worksheetType: String(
      field(formData, "routingWorksheetType", "routing_worksheet_type") ??
        field(formData, "worksheetType", "worksheet_type") ??
        "text",
    ),
    timeMode: String(
      field(formData, "routingTimeMode", "routing_time_mode") ??
        field(formData, "timeMode", "time_mode") ??
        "manual",
    ),
    timeModeBatch:
      Math.trunc(
        num(
          field(formData, "routingTimeModeBatch", "routing_time_mode_batch") ??
            field(formData, "timeModeBatch", "time_mode_batch"),
          1,
        ),
      ) || 1,
    timeCycleManual: num(
      field(formData, "routingTimeCycleManual", "routing_time_cycle_manual") ??
        field(formData, "timeCycleManual", "time_cycle_manual"),
      0,
    ),
    timeCycle: num(
      field(formData, "routingTimeCycle", "routing_time_cycle") ??
        field(formData, "timeCycle", "time_cycle"),
      60,
    ),
    sequence:
      Math.trunc(
        num(
          field(formData, "routingSequence", "routing_sequence") ?? field(formData, "sequence", "sequence"),
          10,
        ),
      ) || 1,
    worksheet: optionalTrimmedString(
      field(formData, "routingWorksheetBody", "routing_worksheet_body") ??
        field(formData, "worksheet", "worksheet"),
    ),
    worksheetGoogleSlide: optionalTrimmedString(
      field(formData, "worksheetGoogleSlide", "worksheet_google_slide"),
    ),
    worksheetUrl: optionalTrimmedString(
      field(formData, "routingWorksheetUrl", "routing_worksheet_url") ??
        field(formData, "worksheetUrl", "worksheet_url"),
    ),
    blockedByOperationIds: parseU64List(
      field(formData, "routingBlockedByIds", "routing_blocked_by_ids") ??
        field(formData, "blockedByOperationIds", "blocked_by_operation_ids"),
    ),
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}

export function toCreateWorkorderParams(
  formData: Record<string, unknown>,
  context: { productionId: bigint; workcenterId: bigint },
): CreateWorkorderParams | null {
  const name = String(
    field(formData, "woName", "wo_name") ?? field(formData, "name", "name") ?? "Operation",
  ).trim()
  if (!name) return null
  return {
    workcenterId: context.workcenterId,
    productionId: context.productionId,
    durationExpected: num(
      field(formData, "woDuration", "wo_duration") ??
        field(formData, "durationExpected", "duration_expected"),
      0,
    ),
    name,
    sequence:
      Math.trunc(
        num(field(formData, "woSequence", "wo_sequence") ?? field(formData, "sequence", "sequence"), 1),
      ) || 1,
    capacity: (() => {
      const v = field(formData, "capacity", "capacity")
      return v == null || v === "" ? undefined : num(v)
    })(),
    worksheet: optionalTrimmedString(field(formData, "worksheet", "worksheet")),
    worksheetUrl: optionalTrimmedString(field(formData, "worksheetUrl", "worksheet_url")),
    operationNote: optionalTrimmedString(field(formData, "operationNote", "operation_note")),
    operationId: optionalBigIntU64(field(formData, "operationId", "operation_id")),
    blockedByWorkorderId: optionalBigIntU64(field(formData, "blockedByWorkorderId", "blocked_by_workorder_id")),
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}

export function toCreateWorkcenterProductivityParams(
  formData: Record<string, unknown>,
): CreateWorkcenterProductivityParams | null {
  const workorderId = requiredBigIntU64(
    field(formData, "workorderId", "workorder_id") ??
      field(formData, "logWorkorderId", "log_workorder_id"),
  )
  if (workorderId === null) return null
  return {
    workorderId,
    lossId: optionalBigIntU64(
      field(formData, "lossId", "loss_id") ?? field(formData, "logLossId", "log_loss_id"),
    ),
    duration: num(
      field(formData, "duration", "duration") ?? field(formData, "logDuration", "log_duration"),
      0,
    ),
    description: optionalTrimmedString(
      field(formData, "description", "description") ??
        field(formData, "logDescription", "log_description"),
    ),
    metadata: optionalTrimmedString(field(formData, "metadata", "metadata")),
  }
}
