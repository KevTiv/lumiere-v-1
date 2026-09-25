"use client"

import { decodeOperationDispatch } from "@lumiere/api-client"
import { parseStrictU64, scalarToU64, type ScalarId } from "@lumiere/erp-shared/u64"
import { stdbBffCommandPost } from "@lumiere/stdb/commands"
import type { CreateWorkcenterProductivityParams } from "@lumiere/stdb/types"
import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query"

import { apiFetch, fetchQueryList, rqBigIntKey } from "../http"
import { invalidateResourceQueries } from "../subscription-query"
import {
  executeOperationWithCanonicalReadback,
  requireResolvedOperationEffect,
  resolveUniqueEffect,
  type CanonicalRecordRef,
  type ResolvedOperationEffectOutcome,
} from "./operation-effect"

const WORKORDER_AFFECTS = ["mrp-workorders", "mrp-workcenters", "mrp-productions"] as const

export interface WorkorderExecutionProjection {
  readonly id?: unknown
  readonly companyId?: unknown
  readonly company_id?: unknown
  readonly productionId?: unknown
  readonly production_id?: unknown
  readonly workcenterId?: unknown
  readonly workcenter_id?: unknown
  readonly state?: unknown
  readonly timeIds?: unknown
  readonly time_ids?: unknown
  readonly duration?: unknown
  readonly durationExpected?: unknown
  readonly duration_expected?: unknown
  readonly progress?: unknown
  readonly isProduced?: unknown
  readonly is_produced?: unknown
}

export interface WorkorderParentProjection {
  readonly id?: unknown
  readonly companyId?: unknown
  readonly company_id?: unknown
  readonly state?: unknown
  readonly workorderIds?: unknown
  readonly workorder_ids?: unknown
}

export interface WorkcenterExecutionProjection {
  readonly id?: unknown
  readonly companyId?: unknown
  readonly company_id?: unknown
  readonly orderIds?: unknown
  readonly order_ids?: unknown
  readonly productivityIds?: unknown
  readonly productivity_ids?: unknown
  readonly productiveTime?: unknown
  readonly productive_time?: unknown
  readonly workorderCount?: unknown
  readonly workorder_count?: unknown
  readonly workorderProgressCount?: unknown
  readonly workorder_progress_count?: unknown
}

export interface WorkorderEffectRef extends CanonicalRecordRef {
  readonly resource: "mrp-workorders"
  readonly companyId: string
  readonly productionId: string
  readonly workcenterId: string
}

export interface ProductivityEffectRef extends CanonicalRecordRef {
  readonly resource: "mrp-workcenter-productivity"
  readonly companyId: string
  readonly workorderId: string
  readonly workcenterId: string
}

interface ProductivitySnapshot {
  readonly workorderTimeIds: readonly string[]
  readonly workorderDuration: number
  readonly workcenterProductivityIds: readonly string[]
  readonly workcenterProductiveTime: number
}

interface FinishSnapshot {
  readonly workorderTimeIds: readonly string[]
  readonly workorderDuration: number
  readonly workcenterCount: number
  readonly workcenterProgressCount: number
}

function numeric(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined
  if (typeof value === "bigint") return Number(value)
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function stateTag(value: unknown): string {
  if (value == null) return ""
  if (typeof value === "string") return value.toLowerCase()
  if (typeof value === "object" && !Array.isArray(value) && "tag" in value) {
    return String((value as { tag?: unknown }).tag ?? "").toLowerCase()
  }
  return String(value).toLowerCase()
}

function parseIdList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  const ids: string[] = []
  for (const item of value) {
    const id = parseStrictU64(item)
    if (id == null || id === 0n) return null
    ids.push(id.toString())
  }
  if (new Set(ids).size !== ids.length) return null
  return ids
}

function exactRow<Row>(
  rows: readonly Row[],
  matches: (row: Row) => boolean,
): Row | null {
  return resolveUniqueEffect(rows, matches, (row) => row)
}

function sameNumber(left: number, right: number): boolean {
  return Math.abs(left - right) <= 1e-9
}

function isSuperset(next: readonly string[], previous: readonly string[]): boolean {
  const set = new Set(next)
  return previous.every((id) => set.has(id))
}

function exactDelta(next: readonly string[], previous: readonly string[]): string[] {
  const before = new Set(previous)
  return next.filter((id) => !before.has(id))
}

function resolveExecutionContext(
  workorders: readonly WorkorderExecutionProjection[],
  productions: readonly WorkorderParentProjection[],
  workcenters: readonly WorkcenterExecutionProjection[],
  workorderId: bigint,
  companyId: bigint,
): {
  workorder: WorkorderExecutionProjection
  production: WorkorderParentProjection
  workcenter: WorkcenterExecutionProjection
  productionId: bigint
  workcenterId: bigint
} | null {
  const workorder = exactRow(
    workorders,
    (row) =>
      parseStrictU64(row.id) === workorderId &&
      parseStrictU64(row.companyId ?? row.company_id) === companyId,
  )
  if (!workorder) return null

  const productionId = parseStrictU64(
    workorder.productionId ?? workorder.production_id,
  )
  const workcenterId = parseStrictU64(
    workorder.workcenterId ?? workorder.workcenter_id,
  )
  if (productionId == null || workcenterId == null) return null

  const production = exactRow(
    productions,
    (row) =>
      parseStrictU64(row.id) === productionId &&
      parseStrictU64(row.companyId ?? row.company_id) === companyId,
  )
  const workcenter = exactRow(
    workcenters,
    (row) =>
      parseStrictU64(row.id) === workcenterId &&
      parseStrictU64(row.companyId ?? row.company_id) === companyId,
  )
  if (!production || !workcenter) return null

  const parentIds = parseIdList(
    production.workorderIds ?? production.workorder_ids,
  )
  const centerOrderIds = parseIdList(workcenter.orderIds ?? workcenter.order_ids)
  if (
    parentIds == null ||
    centerOrderIds == null ||
    !parentIds.includes(workorderId.toString()) ||
    !centerOrderIds.includes(workorderId.toString())
  ) {
    return null
  }

  return { workorder, production, workcenter, productionId, workcenterId }
}

export function resolveWorkorderStateEffect(
  workorders: readonly WorkorderExecutionProjection[],
  productions: readonly WorkorderParentProjection[],
  workcenters: readonly WorkcenterExecutionProjection[],
  workorderId: bigint,
  companyId: bigint,
  expectedState: "progress" | "done",
): WorkorderEffectRef | null {
  const context = resolveExecutionContext(
    workorders,
    productions,
    workcenters,
    workorderId,
    companyId,
  )
  if (!context || stateTag(context.workorder.state) !== expectedState) return null

  return {
    resource: "mrp-workorders",
    id: workorderId.toString(),
    companyId: companyId.toString(),
    productionId: context.productionId.toString(),
    workcenterId: context.workcenterId.toString(),
  }
}

export function resolveProductivityEffect(
  workorders: readonly WorkorderExecutionProjection[],
  productions: readonly WorkorderParentProjection[],
  workcenters: readonly WorkcenterExecutionProjection[],
  workorderId: bigint,
  companyId: bigint,
  expectedWorkcenterId: bigint,
  expectedDuration: number,
  before: ProductivitySnapshot,
): ProductivityEffectRef | null {
  const context = resolveExecutionContext(
    workorders,
    productions,
    workcenters,
    workorderId,
    companyId,
  )
  if (
    !context ||
    context.workcenterId !== expectedWorkcenterId ||
    stateTag(context.workorder.state) !== "progress"
  ) {
    return null
  }

  const timeIds = parseIdList(
    context.workorder.timeIds ?? context.workorder.time_ids,
  )
  const productivityIds = parseIdList(
    context.workcenter.productivityIds ?? context.workcenter.productivity_ids,
  )
  const duration = numeric(context.workorder.duration)
  const productiveTime = numeric(
    context.workcenter.productiveTime ?? context.workcenter.productive_time,
  )
  if (
    timeIds == null ||
    productivityIds == null ||
    duration == null ||
    productiveTime == null ||
    !isSuperset(timeIds, before.workorderTimeIds) ||
    !isSuperset(productivityIds, before.workcenterProductivityIds) ||
    !sameNumber(duration, before.workorderDuration + expectedDuration) ||
    !sameNumber(
      productiveTime,
      before.workcenterProductiveTime + expectedDuration,
    )
  ) {
    return null
  }

  const newWorkorderIds = exactDelta(timeIds, before.workorderTimeIds)
  const newWorkcenterIds = exactDelta(
    productivityIds,
    before.workcenterProductivityIds,
  )
  if (
    newWorkorderIds.length !== 1 ||
    newWorkcenterIds.length !== 1 ||
    newWorkorderIds[0] !== newWorkcenterIds[0]
  ) {
    return null
  }

  return {
    resource: "mrp-workcenter-productivity",
    id: newWorkorderIds[0]!,
    companyId: companyId.toString(),
    workorderId: workorderId.toString(),
    workcenterId: expectedWorkcenterId.toString(),
  }
}

export function resolveWorkorderFinishedEffect(
  workorders: readonly WorkorderExecutionProjection[],
  productions: readonly WorkorderParentProjection[],
  workcenters: readonly WorkcenterExecutionProjection[],
  workorderId: bigint,
  companyId: bigint,
  before: FinishSnapshot,
): WorkorderEffectRef | null {
  const context = resolveExecutionContext(
    workorders,
    productions,
    workcenters,
    workorderId,
    companyId,
  )
  if (!context || stateTag(context.workorder.state) !== "done") return null

  const timeIds = parseIdList(
    context.workorder.timeIds ?? context.workorder.time_ids,
  )
  const duration = numeric(context.workorder.duration)
  const progress = numeric(context.workorder.progress)
  const workcenterCount = numeric(
    context.workcenter.workorderCount ?? context.workcenter.workorder_count,
  )
  const progressCount = numeric(
    context.workcenter.workorderProgressCount ??
      context.workcenter.workorder_progress_count,
  )
  if (
    timeIds == null ||
    duration == null ||
    progress == null ||
    workcenterCount == null ||
    progressCount == null ||
    timeIds.length !== before.workorderTimeIds.length ||
    !timeIds.every((id, index) => id === before.workorderTimeIds[index]) ||
    !sameNumber(duration, before.workorderDuration) ||
    !sameNumber(progress, 100) ||
    workcenterCount !== before.workcenterCount ||
    progressCount !== Math.max(0, before.workcenterProgressCount - 1) ||
    (context.workorder.isProduced ?? context.workorder.is_produced) !== true
  ) {
    return null
  }

  return {
    resource: "mrp-workorders",
    id: workorderId.toString(),
    companyId: companyId.toString(),
    productionId: context.productionId.toString(),
    workcenterId: context.workcenterId.toString(),
  }
}

async function readExecutionRows(): Promise<{
  workorders: WorkorderExecutionProjection[]
  productions: WorkorderParentProjection[]
  workcenters: WorkcenterExecutionProjection[]
}> {
  const [workorders, productions, workcenters] = await Promise.all([
    fetchQueryList("/api/query/mrp-workorders", "Failed to read workorders"),
    fetchQueryList("/api/query/mrp-productions", "Failed to read manufacturing orders"),
    fetchQueryList("/api/query/mrp-workcenters", "Failed to read workcenters"),
  ])
  return { workorders, productions, workcenters }
}

async function refreshResources(
  qc: QueryClient,
  organizationId: bigint,
): Promise<void> {
  invalidateResourceQueries(qc, organizationId, WORKORDER_AFFECTS)
  const orgKey = rqBigIntKey(organizationId)
  await Promise.all(
    WORKORDER_AFFECTS.map((resource) =>
      qc.invalidateQueries({ queryKey: [resource, orgKey] }),
    ),
  )
}

export function useStartWorkorder(
  organizationId: bigint,
  companyId: bigint,
) {
  const qc = useQueryClient()

  return useMutation<
    ResolvedOperationEffectOutcome<WorkorderEffectRef>,
    Error,
    ScalarId
  >({
    mutationFn: async (value) => {
      if (companyId === 0n) throw new Error("Active company required")
      const workorderId = scalarToU64(value)
      const outcome = await executeOperationWithCanonicalReadback({
        resolveEffect: async () => {
          const rows = await readExecutionRows()
          return resolveWorkorderStateEffect(
            rows.workorders,
            rows.productions,
            rows.workcenters,
            workorderId,
            companyId,
            "progress",
          )
        },
        dispatch: async () => {
          const { urlPath, init } = stdbBffCommandPost("start_workorder", {
            companyId,
            workorderId,
          })
          return decodeOperationDispatch(
            await apiFetch(urlPath, init),
            "Failed to start workorder",
          )
        },
        afterDispatch: () => refreshResources(qc, organizationId),
        readbackAttempts: 6,
        readbackDelayMs: 150,
      })
      return requireResolvedOperationEffect(outcome)
    },
  })
}

export function useLogWorkcenterProductivity(
  organizationId: bigint,
) {
  const qc = useQueryClient()

  return useMutation<
    ResolvedOperationEffectOutcome<ProductivityEffectRef>,
    Error,
    {
      workcenterId: ScalarId
      params: CreateWorkcenterProductivityParams
    }
  >({
    mutationFn: async ({ workcenterId: rawWorkcenterId, params }) => {
      const workcenterId = scalarToU64(rawWorkcenterId)
      const workorderId = scalarToU64(params.workorderId)
      const expectedDuration = Number(params.duration)
      if (!Number.isFinite(expectedDuration) || expectedDuration <= 0) {
        throw new Error("Productivity duration must be greater than 0")
      }

      const beforeRows = await readExecutionRows()
      const beforeContext = resolveExecutionContext(
        beforeRows.workorders,
        beforeRows.productions,
        beforeRows.workcenters,
        workorderId,
        BigInt(
          parseStrictU64(
            beforeRows.workorders.find(
              (row) => parseStrictU64(row.id) === workorderId,
            )?.companyId ??
              beforeRows.workorders.find(
                (row) => parseStrictU64(row.id) === workorderId,
              )?.company_id,
          ) ?? 0n,
        ),
      )
      if (!beforeContext || beforeContext.workcenterId !== workcenterId) {
        throw new Error("Workorder/workcenter execution context is invalid")
      }
      const companyId = parseStrictU64(
        beforeContext.workorder.companyId ?? beforeContext.workorder.company_id,
      )
      if (companyId == null || companyId === 0n) {
        throw new Error("Workorder company scope is invalid")
      }

      const beforeTimeIds = parseIdList(
        beforeContext.workorder.timeIds ?? beforeContext.workorder.time_ids,
      )
      const beforeProductivityIds = parseIdList(
        beforeContext.workcenter.productivityIds ??
          beforeContext.workcenter.productivity_ids,
      )
      const beforeDuration = numeric(beforeContext.workorder.duration)
      const beforeProductiveTime = numeric(
        beforeContext.workcenter.productiveTime ??
          beforeContext.workcenter.productive_time,
      )
      if (
        beforeTimeIds == null ||
        beforeProductivityIds == null ||
        beforeDuration == null ||
        beforeProductiveTime == null
      ) {
        throw new Error("Productivity baseline is unavailable")
      }
      const before: ProductivitySnapshot = {
        workorderTimeIds: beforeTimeIds,
        workorderDuration: beforeDuration,
        workcenterProductivityIds: beforeProductivityIds,
        workcenterProductiveTime: beforeProductiveTime,
      }

      const outcome = await executeOperationWithCanonicalReadback({
        resolveEffect: async () => {
          const rows = await readExecutionRows()
          return resolveProductivityEffect(
            rows.workorders,
            rows.productions,
            rows.workcenters,
            workorderId,
            companyId,
            workcenterId,
            expectedDuration,
            before,
          )
        },
        dispatch: async () => {
          const { urlPath, init } = stdbBffCommandPost(
            "log_workcenter_productivity",
            {
              workcenterId,
              params,
            },
          )
          return decodeOperationDispatch(
            await apiFetch(urlPath, init),
            "Failed to log workcenter productivity",
          )
        },
        afterDispatch: () => refreshResources(qc, organizationId),
        readbackAttempts: 6,
        readbackDelayMs: 150,
      })
      return requireResolvedOperationEffect(outcome)
    },
  })
}

export function useFinishWorkorder(
  organizationId: bigint,
  companyId: bigint,
) {
  const qc = useQueryClient()

  return useMutation<
    ResolvedOperationEffectOutcome<WorkorderEffectRef>,
    Error,
    ScalarId
  >({
    mutationFn: async (value) => {
      if (companyId === 0n) throw new Error("Active company required")
      const workorderId = scalarToU64(value)

      const beforeRows = await readExecutionRows()
      const context = resolveExecutionContext(
        beforeRows.workorders,
        beforeRows.productions,
        beforeRows.workcenters,
        workorderId,
        companyId,
      )
      if (!context || stateTag(context.workorder.state) !== "progress") {
        throw new Error("Workorder must be in Progress state")
      }

      const timeIds = parseIdList(
        context.workorder.timeIds ?? context.workorder.time_ids,
      )
      const duration = numeric(context.workorder.duration)
      const workcenterCount = numeric(
        context.workcenter.workorderCount ?? context.workcenter.workorder_count,
      )
      const progressCount = numeric(
        context.workcenter.workorderProgressCount ??
          context.workcenter.workorder_progress_count,
      )
      if (
        timeIds == null ||
        duration == null ||
        workcenterCount == null ||
        progressCount == null
      ) {
        throw new Error("Workorder finish baseline is unavailable")
      }
      const before: FinishSnapshot = {
        workorderTimeIds: timeIds,
        workorderDuration: duration,
        workcenterCount,
        workcenterProgressCount: progressCount,
      }

      const outcome = await executeOperationWithCanonicalReadback({
        resolveEffect: async () => {
          const rows = await readExecutionRows()
          return resolveWorkorderFinishedEffect(
            rows.workorders,
            rows.productions,
            rows.workcenters,
            workorderId,
            companyId,
            before,
          )
        },
        dispatch: async () => {
          const { urlPath, init } = stdbBffCommandPost("finish_workorder", {
            companyId,
            workorderId,
          })
          return decodeOperationDispatch(
            await apiFetch(urlPath, init),
            "Failed to finish workorder",
          )
        },
        afterDispatch: () => refreshResources(qc, organizationId),
        readbackAttempts: 6,
        readbackDelayMs: 150,
      })
      return requireResolvedOperationEffect(outcome)
    },
  })
}
