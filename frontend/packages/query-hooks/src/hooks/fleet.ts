"use client"


import { decodeOperationDispatch } from "@lumiere/api-client"
import { stdbBffCommandPost } from "@lumiere/stdb/commands"
import {
  encodeOptionalString,
  encodeOptionalTimestamp,
  encodeOptionalU64,
  stdbParamsToJson,
} from "@lumiere/stdb/stdb-params-json"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"

import { apiFetch, fetchQueryList, rqBigIntKey, type QueryRows } from "../http"
import { parseStrictU64 } from "@lumiere/erp-shared/u64"
import type { FleetVehicle } from "@lumiere/stdb/types"
import {
  AmbiguousOperationEffectError,
  executeOperationWithCanonicalReadback,
  requireResolvedOperationEffect,
  type CanonicalRecordRef,
  type ResolvedOperationEffectOutcome,
} from "./operation-effect"

// ── Reads ────────────────────────────────────────────────────────────────────

export function useFleetVehicles(
  organizationId: bigint,
  initialData?: FleetVehicle[],
) {
  return useQuery({
    queryKey: ["fleet-vehicles", rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList("/api/query/fleet-vehicles", "Failed to fetch fleet vehicles"),
    staleTime: 30_000,
    initialData,
  })
}

const fleetHistoryPath = (resource: string) => `/api/query/${resource}`

function useFleetHistory(
  resource: "fleet-service-types" | "fleet-service-records" | "fleet-inspections",
  organizationId: bigint,
) {
  return useQuery<QueryRows>({
    queryKey: [resource, rqBigIntKey(organizationId)],
    queryFn: () => fetchQueryList(fleetHistoryPath(resource), `Failed to fetch ${resource}`),
    staleTime: 30_000,
  })
}

export const useFleetServiceTypes = (organizationId: bigint) =>
  useFleetHistory("fleet-service-types", organizationId)

export const useFleetServiceRecords = (organizationId: bigint) =>
  useFleetHistory("fleet-service-records", organizationId)

export const useFleetInspections = (organizationId: bigint) =>
  useFleetHistory("fleet-inspections", organizationId)

// ── Query invalidation helper ───────────────────────────────────────────────

function invalidateFleetQueries(qc: ReturnType<typeof useQueryClient>, organizationId: bigint) {
  return qc.invalidateQueries({ queryKey: ["fleet-vehicles", rqBigIntKey(organizationId)] })
}

function invalidateFleetLifecycleQueries(
  qc: ReturnType<typeof useQueryClient>,
  organizationId: bigint,
) {
  const orgKey = rqBigIntKey(organizationId)
  return Promise.all([
    qc.invalidateQueries({ queryKey: ["fleet-vehicles", orgKey] }),
    qc.invalidateQueries({ queryKey: ["fleet-service-records", orgKey] }),
    qc.invalidateQueries({ queryKey: ["fleet-inspections", orgKey] }),
  ])
}

function requireCompany(companyId: bigint | undefined, action: string): bigint {
  if (companyId == null || companyId <= 0n) {
    throw new Error(`Operating company is required to ${action}`)
  }
  return companyId
}

function optionalTimestamp(value?: Date) {
  return encodeOptionalTimestamp(value)
}

function optionalText(value?: string) {
  return encodeOptionalString(value)
}

function optionalNumber(value?: number) {
  return value == null ? { none: [] } : { some: value }
}

// ── Mutations ────────────────────────────────────────────────────────────────

export type CreateFleetVehicleInput = {
  name: string
  vehicleType: string
  licensePlate: string | null
  driverName: string | null
}

export function useCreateFleetVehicle(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, CreateFleetVehicleInput>({
    mutationFn: async ({ name, vehicleType, licensePlate, driverName }) => {
      if (companyId == null || companyId <= 0n) {
        throw new Error("Operating company is required to create a fleet vehicle")
      }
      const { urlPath, init } = stdbBffCommandPost("create_fleet_vehicle", { companyId: companyId, params: stdbParamsToJson(
          {
            name: name.trim(),
            vehicleType: vehicleType.trim(),
            licensePlate:
              licensePlate != null && licensePlate.trim() !== "" ? licensePlate.trim() : null,
            driverName:
              driverName != null && driverName.trim() !== "" ? driverName.trim() : null,
            metadata: null,
          },
          "CreateFleetVehicleParams",
        ) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error("Failed to create fleet vehicle")
    },
    onSuccess: () => invalidateFleetQueries(qc, organizationId),
  })
}


export type UpdateVehiclePositionInput = {
  vehicleId: bigint | number | string
  latitude: number
  longitude: number
  speedKmh: number
  heading: number
  status: string
}

export function useUpdateVehiclePosition(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, UpdateVehiclePositionInput>({
    mutationFn: async ({ vehicleId, latitude, longitude, speedKmh, heading, status }) => {
      if (companyId == null || companyId <= 0n) {
        throw new Error("Operating company is required to update vehicle position")
      }
      const { urlPath, init } = stdbBffCommandPost("update_vehicle_position", { companyId: companyId, vehicleId: vehicleId, params: stdbParamsToJson(
          {
            latitude,
            longitude,
            speedKmh,
            heading,
            status,
          },
          "UpdateVehiclePositionParams",
        ) })
      const r = await apiFetch(urlPath, init)
      if (!r.ok) throw new Error("Failed to update vehicle position")
    },
    onSuccess: () => invalidateFleetQueries(qc, organizationId),
  })
}

export interface UpdateFleetVehicleDriverInput {
  vehicleId: bigint
  driverId: bigint | null
}

export function useUpdateFleetVehicleDriver(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<void, Error, UpdateFleetVehicleDriverInput>({
    mutationFn: async ({ vehicleId, driverId }) => {
      const scopedCompanyId = requireCompany(companyId, "update a fleet driver")
      const { urlPath, init } = stdbBffCommandPost("update_fleet_vehicle", {
        companyId: scopedCompanyId,
        vehicleId,
        params: stdbParamsToJson({
          // UpdateFleetVehicleParams uses Option<Option<u64>>: the outer
          // option selects the field, while the inner option assigns/clears it.
          driverId: { some: driverId == null ? { none: [] } : { some: driverId } },
          serviceTypeId: { none: [] },
        }),
      })
      const response = await apiFetch(urlPath, init)
      if (!response.ok) throw new Error("Failed to update fleet driver")
    },
    onSuccess: () => invalidateFleetLifecycleQueries(qc, organizationId),
  })
}

export interface RecordFleetServiceInput {
  vehicleId: bigint
  serviceTypeId: bigint
  servicedAt?: Date
  odometerKm?: number
  provider?: string
  notes?: string
  costAmount?: number
  journalId?: bigint
  expenseAccountId?: bigint
  offsetAccountId?: bigint
  clientRequestId?: string
}

export interface FleetHistoryEffectProjection {
  readonly id?: unknown
  readonly organizationId?: unknown
  readonly organization_id?: unknown
  readonly companyId?: unknown
  readonly company_id?: unknown
  readonly vehicleId?: unknown
  readonly vehicle_id?: unknown
  readonly serviceTypeId?: unknown
  readonly service_type_id?: unknown
  readonly outcome?: unknown
  readonly costAmount?: unknown
  readonly cost_amount?: unknown
  readonly currencyId?: unknown
  readonly currency_id?: unknown
  readonly accountMoveId?: unknown
  readonly account_move_id?: unknown
  readonly clientRequestId?: unknown
  readonly client_request_id?: unknown
}

export interface FleetHistoryEffectRef extends CanonicalRecordRef {
  readonly resource: "fleet-service-records" | "fleet-inspections"
  readonly vehicleId: string
  readonly companyId: string
  readonly clientRequestId: string
  readonly costAmount?: number
  readonly currencyId?: string
  readonly accountMoveId?: string
}

function normalizedOptionalString(value: unknown): string {
  if (typeof value === "string") return value.trim()
  if (value && typeof value === "object" && !Array.isArray(value)) {
    if ("some" in value) {
      return String((value as { some?: unknown }).some ?? "").trim()
    }
    if ("none" in value) return ""
  }
  return ""
}

function fleetOutcomeTag(value: unknown): string {
  if (typeof value === "string") return value.toLowerCase()
  if (value && typeof value === "object" && !Array.isArray(value)) {
    if ("tag" in value) {
      return String((value as { tag?: unknown }).tag ?? "").toLowerCase()
    }
    const keys = Object.keys(value)
    if (keys.length === 1) return keys[0]!.toLowerCase()
  }
  return ""
}

function requireFleetRequestId(value?: string): string {
  const normalized = value?.trim()
  if (normalized) return normalized
  return crypto.randomUUID()
}
function numericField(value: unknown): number | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    if ("some" in value) value = (value as { some?: unknown }).some
    else if ("none" in value) return null
  }
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export interface FleetAccountMoveProjection {
  readonly id?: unknown
  readonly organizationId?: unknown
  readonly organization_id?: unknown
  readonly companyId?: unknown
  readonly company_id?: unknown
  readonly currencyId?: unknown
  readonly currency_id?: unknown
  readonly state?: unknown
}

function resolveFleetServiceAccountingMove(
  moves: readonly FleetAccountMoveProjection[],
  organizationId: bigint,
  companyId: bigint,
  moveId: bigint,
  currencyId: bigint,
): boolean {
  const matches = moves.filter((row) => parseStrictU64(row.id) === moveId)
  if (matches.length > 1) {
    throw new AmbiguousOperationEffectError(
      `Expected one fleet service account move, found ${matches.length}`,
    )
  }
  const row = matches[0]
  return Boolean(
    row &&
      parseStrictU64(row.organizationId ?? row.organization_id) === organizationId &&
      parseStrictU64(row.companyId ?? row.company_id) === companyId &&
      parseStrictU64(row.currencyId ?? row.currency_id) === currencyId &&
      fleetOutcomeTag(row.state) === "posted",
  )
}


export function resolveFleetHistoryEffect(
  rows: readonly FleetHistoryEffectProjection[],
  resource: "fleet-service-records" | "fleet-inspections",
  organizationId: bigint,
  companyId: bigint,
  vehicleId: bigint,
  clientRequestId: string,
  expected?: {
    readonly serviceTypeId?: bigint
    readonly outcome?: FleetInspectionOutcome
    readonly costAmount?: number
    readonly accountMoves?: readonly FleetAccountMoveProjection[]
  },
): FleetHistoryEffectRef | null {
  const matches = rows.filter(
    (row) =>
      parseStrictU64(row.organizationId ?? row.organization_id) === organizationId &&
      parseStrictU64(row.companyId ?? row.company_id) === companyId &&
      parseStrictU64(row.vehicleId ?? row.vehicle_id) === vehicleId &&
      normalizedOptionalString(row.clientRequestId ?? row.client_request_id) === clientRequestId,
  )

  if (matches.length > 1) {
    throw new AmbiguousOperationEffectError(
      `Expected one ${resource} effect, found ${matches.length}`,
    )
  }

  const row = matches[0]
  if (!row) return null

  if (
    expected?.serviceTypeId != null &&
    parseStrictU64(row.serviceTypeId ?? row.service_type_id) !== expected.serviceTypeId
  ) {
    return null
  }
  if (
    expected?.outcome != null &&
    fleetOutcomeTag(row.outcome) !== expected.outcome.toLowerCase()
  ) {
    return null
  }

  const id = parseStrictU64(row.id)
  if (id == null) return null

  if (expected?.costAmount != null) {
    const costAmount = numericField(row.costAmount ?? row.cost_amount)
    const currencyId = parseStrictU64(row.currencyId ?? row.currency_id)
    const accountMoveId = parseStrictU64(row.accountMoveId ?? row.account_move_id)
    if (
      costAmount == null ||
      Math.abs(costAmount - expected.costAmount) > 0.0001 ||
      currencyId == null ||
      accountMoveId == null ||
      expected.accountMoves == null ||
      !resolveFleetServiceAccountingMove(
        expected.accountMoves,
        organizationId,
        companyId,
        accountMoveId,
        currencyId,
      )
    ) {
      return null
    }
    return {
      resource,
      id: id.toString(),
      vehicleId: vehicleId.toString(),
      companyId: companyId.toString(),
      clientRequestId,
      costAmount,
      currencyId: currencyId.toString(),
      accountMoveId: accountMoveId.toString(),
    }
  }

  return {
    resource,
    id: id.toString(),
    vehicleId: vehicleId.toString(),
    companyId: companyId.toString(),
    clientRequestId,
  }
}

export function useRecordFleetService(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<
    ResolvedOperationEffectOutcome<FleetHistoryEffectRef>,
    Error,
    RecordFleetServiceInput
  >({
    mutationFn: async (input) => {
      const scopedCompanyId = requireCompany(companyId, "record fleet service")
      const clientRequestId = requireFleetRequestId(input.clientRequestId)
      const outcome = await executeOperationWithCanonicalReadback({
        resolveEffect: async () =>
          resolveFleetHistoryEffect(
            await fetchQueryList(
              "/api/query/fleet-service-records",
              "Failed to read fleet service records",
            ),
            "fleet-service-records",
            organizationId,
            scopedCompanyId,
            input.vehicleId,
            clientRequestId,
            {
              serviceTypeId: input.serviceTypeId,
              ...(input.costAmount != null
                ? {
                    costAmount: input.costAmount,
                    accountMoves: await fetchQueryList(
                      "/api/query/account-moves",
                      "Failed to read fleet service accounting move",
                    ),
                  }
                : {}),
            },
          ),
        dispatch: async () => {
          const { urlPath, init } = stdbBffCommandPost("record_fleet_service", {
            companyId: scopedCompanyId,
            params: stdbParamsToJson({
              vehicleId: input.vehicleId,
              serviceTypeId: input.serviceTypeId,
              servicedAt: optionalTimestamp(input.servicedAt),
              odometerKm: optionalNumber(input.odometerKm),
              provider: optionalText(input.provider),
              notes: optionalText(input.notes),
              costAmount: optionalNumber(input.costAmount),
              journalId: encodeOptionalU64(input.journalId),
              expenseAccountId: encodeOptionalU64(input.expenseAccountId),
              offsetAccountId: encodeOptionalU64(input.offsetAccountId),
              clientRequestId: optionalText(clientRequestId),
            }),
          })
          return decodeOperationDispatch(
            await apiFetch(urlPath, init),
            "Failed to record fleet service",
          )
        },
        readbackAttempts: 6,
        readbackDelayMs: 150,
      })
      return requireResolvedOperationEffect(outcome)
    },
    onSuccess: () => invalidateFleetLifecycleQueries(qc, organizationId),
  })
}

export type FleetInspectionOutcome = "passed" | "failed" | "attention_required"

export interface RecordFleetInspectionInput {
  vehicleId: bigint
  inspectorId?: bigint
  inspectedAt?: Date
  outcome: FleetInspectionOutcome
  odometerKm?: number
  notes?: string
  clientRequestId?: string
}

export function useRecordFleetInspection(organizationId: bigint, companyId?: bigint) {
  const qc = useQueryClient()
  return useMutation<
    ResolvedOperationEffectOutcome<FleetHistoryEffectRef>,
    Error,
    RecordFleetInspectionInput
  >({
    mutationFn: async (input) => {
      const scopedCompanyId = requireCompany(companyId, "record a fleet inspection")
      const clientRequestId = requireFleetRequestId(input.clientRequestId)
      const outcome = await executeOperationWithCanonicalReadback({
        resolveEffect: async () =>
          resolveFleetHistoryEffect(
            await fetchQueryList(
              "/api/query/fleet-inspections",
              "Failed to read fleet inspections",
            ),
            "fleet-inspections",
            organizationId,
            scopedCompanyId,
            input.vehicleId,
            clientRequestId,
            { outcome: input.outcome },
          ),
        dispatch: async () => {
          const { urlPath, init } = stdbBffCommandPost("record_fleet_inspection", {
            companyId: scopedCompanyId,
            params: stdbParamsToJson({
              vehicleId: input.vehicleId,
              inspectorId: encodeOptionalU64(input.inspectorId),
              inspectedAt: optionalTimestamp(input.inspectedAt),
              outcome: input.outcome,
              odometerKm: optionalNumber(input.odometerKm),
              notes: optionalText(input.notes),
              clientRequestId: optionalText(clientRequestId),
            }),
          })
          return decodeOperationDispatch(
            await apiFetch(urlPath, init),
            "Failed to record fleet inspection",
          )
        },
        readbackAttempts: 6,
        readbackDelayMs: 150,
      })
      return requireResolvedOperationEffect(outcome)
    },
    onSuccess: () => invalidateFleetLifecycleQueries(qc, organizationId),
  })
}
