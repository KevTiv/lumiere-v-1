/**
 * Maps Manufacturing module form payloads to SpacetimeDB Create*Params types.
 */

import type {
  BomType,
  CreateBomParams,
  CreateMrpProductionParams,
  CreateRoutingWorkcenterParams,
  CreateWorkcenterParams,
  CreateWorkcenterProductivityParams,
  CreateWorkorderParams,
  MoState,
  WorkorderState,
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

function timestampFromFormDate(v: unknown, fallback: Date) {
  if (v == null || String(v).trim() === "") return stbTimestampFromDate(fallback)
  const d = new Date(String(v))
  if (Number.isNaN(d.getTime())) return stbTimestampFromDate(fallback)
  return stbTimestampFromDate(d)
}

function optionalTimestampFromForm(v: unknown) {
  if (v == null || String(v).trim() === "") return undefined
  const d = new Date(String(v))
  if (Number.isNaN(d.getTime())) return undefined
  return stbTimestampFromDate(d)
}

const MO_STATE_DRAFT: MoState = { tag: "Draft" }

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

  const now = new Date()
  const plannedStart = timestampFromFormDate(field(formData, "datePlannedStart", "date_planned_start"), now)
  const plannedFinished = timestampFromFormDate(
    field(formData, "datePlannedFinished", "date_planned_finished") ??
      field(formData, "datePlannedStart", "date_planned_start"),
    now,
  )

  return {
    companyId: optionalBigIntU64(field(formData, "companyId", "company_id")) ?? context.companyId,
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
    state: MO_STATE_DRAFT,
    availability: String(field(formData, "availability", "availability") ?? "available"),
    reservationState: String(field(formData, "reservationState", "reservation_state") ?? "confirmed"),
    componentsAvailability: String(
      field(formData, "componentsAvailability", "components_availability") ?? "available",
    ),
    componentsAvailabilityState: String(
      field(formData, "componentsAvailabilityState", "components_availability_state") ?? "available",
    ),
    isPlanned: field(formData, "isPlanned", "is_planned") !== false,
    isLocked: Boolean(field(formData, "isLocked", "is_locked")),
    isWorkorder: field(formData, "isWorkorder", "is_workorder") !== false,
    delayAlert: Boolean(field(formData, "delayAlert", "delay_alert")),
    lotProducingCount: Math.trunc(num(field(formData, "lotProducingCount", "lot_producing_count"), 0)),
    qtyProducing: num(field(formData, "qtyProducing", "qty_producing"), 0),
    qtyProduced: num(field(formData, "qtyProduced", "qty_produced"), 0),
    productUomQtyProducing: num(field(formData, "productUomQtyProducing", "product_uom_qty_producing"), 0),
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

export function toCreateBomParams(
  formData: Record<string, unknown>,
  context: BomMapperContext,
): CreateBomParams | null {
  const productTmplId = requiredBigIntU64(field(formData, "productTmplId", "product_tmpl_id"))
  if (productTmplId === null) return null

  return {
    companyId: optionalBigIntU64(field(formData, "companyId", "company_id")) ?? context.companyId,
    type: bomTypeFromForm(field(formData, "type", "type_")),
    productId: productTmplId,
    productTmplId,
    productQty: num(field(formData, "productQty", "product_qty"), 1),
    productUomId: context.productUomId,
    readyToProduce: String(field(formData, "readyToProduce", "ready_to_produce") ?? "asap"),
    consumption: String(field(formData, "consumption", "consumption") ?? "flexible"),
    sequence: Math.trunc(num(field(formData, "sequence", "sequence"), 1)),
    estimatedCost: num(field(formData, "estimatedCost", "estimated_cost"), 0),
    lines: [],
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
    companyId: optionalBigIntU64(field(formData, "companyId", "company_id")) ?? companyId,
    name,
    active: field(formData, "active", "active") !== false,
    code: optionalTrimmedString(field(formData, "code", "code")),
    workingState: String(field(formData, "workingState", "working_state") ?? "normal"),
    oeeTarget,
    timeEfficiency,
    capacity,
    capacityIds: u64IdArrayFromForm(field(formData, "capacityIds", "capacity_ids")),
    oee: num(field(formData, "oee", "oee"), 0),
    performance: num(field(formData, "performance", "performance"), 0),
    blockedTime: num(field(formData, "blockedTime", "blocked_time"), 0),
    productiveTime: num(field(formData, "productiveTime", "productive_time"), 0),
    productivityIds: u64IdArrayFromForm(field(formData, "productivityIds", "productivity_ids")),
    orderIds: u64IdArrayFromForm(field(formData, "orderIds", "order_ids")),
    workorderCount: Math.trunc(num(field(formData, "workorderCount", "workorder_count"), 0)),
    workorderReadyCount: Math.trunc(
      num(field(formData, "workorderReadyCount", "workorder_ready_count"), 0),
    ),
    workorderProgressCount: Math.trunc(
      num(field(formData, "workorderProgressCount", "workorder_progress_count"), 0),
    ),
    workorderPendingCount: Math.trunc(
      num(field(formData, "workorderPendingCount", "workorder_pending_count"), 0),
    ),
    workorderLateCount: Math.trunc(
      num(field(formData, "workorderLateCount", "workorder_late_count"), 0),
    ),
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

const WO_STATE_READY: WorkorderState = { tag: "Ready" }

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
    state: WO_STATE_READY,
    productionAvailability: String(
      field(formData, "productionAvailability", "production_availability") ?? "available",
    ),
    isUserWorking: field(formData, "isUserWorking", "is_user_working") === true,
    isProduced: field(formData, "isProduced", "is_produced") === true,
    isLastUnfinishedWo: field(formData, "isLastUnfinishedWo", "is_last_unfinished_wo") === true,
    qualityCheckTodo: field(formData, "qualityCheckTodo", "quality_check_todo") === true,
    qualityCheckFail: field(formData, "qualityCheckFail", "quality_check_fail") === true,
    capacity: (() => {
      const v = field(formData, "capacity", "capacity")
      return v == null || v === "" ? undefined : num(v)
    })(),
    worksheet: optionalTrimmedString(field(formData, "worksheet", "worksheet")),
    worksheetUrl: optionalTrimmedString(field(formData, "worksheetUrl", "worksheet_url")),
    operationNote: optionalTrimmedString(field(formData, "operationNote", "operation_note")),
    operationId: optionalBigIntU64(field(formData, "operationId", "operation_id")),
    blockedByWorkorderId: optionalBigIntU64(field(formData, "blockedByWorkorderId", "blocked_by_workorder_id")),
    qualityState: optionalTrimmedString(field(formData, "qualityState", "quality_state")),
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
  const lossId = requiredBigIntU64(
    field(formData, "lossId", "loss_id") ?? field(formData, "logLossId", "log_loss_id"),
  )
  if (workorderId === null || lossId === null) return null
  return {
    workorderId,
    lossId,
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
