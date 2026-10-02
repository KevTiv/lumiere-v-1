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
  readonly servicedAt?: unknown
  readonly serviced_at?: unknown
  readonly inspectedAt?: unknown
  readonly inspected_at?: unknown
  readonly createDate?: unknown
  readonly create_date?: unknown
  readonly odometerKm?: unknown
  readonly odometer_km?: unknown
  readonly provider?: unknown
  readonly notes?: unknown
  readonly inspectorId?: unknown
  readonly inspector_id?: unknown
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
  if (value == null || value === "") return null
  if (value && typeof value === "object" && !Array.isArray(value)) {
    if ("some" in value) value = (value as { some?: unknown }).some
    else if ("none" in value) return null
  }
  if (value == null || value === "" || (typeof value !== "number" && typeof value !== "string")) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

// Preserve explicit absence; an omitted projection column is not evidence.
function historyField(row: FleetHistoryEffectProjection, camel: keyof FleetHistoryEffectProjection, snake = camel) {
  return Object.hasOwn(row, camel) ? row[camel] : row[snake]
}

function optionalValue(value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    if ("some" in value) return (value as { some: unknown }).some
    if ("none" in value) return null
  }
  return value
}

function optionalNumberMatches(actual: unknown, expected: unknown): boolean {
  actual = optionalValue(actual)
  expected = optionalValue(expected)
  if (actual === undefined || expected === undefined) return false
  if (actual == null || expected == null) return actual === expected
  const parsed = numericField(actual)
  return parsed != null && parsed === numericField(expected)
}

function optionalTextMatches(actual: unknown, expected: unknown): boolean {
  actual = optionalValue(actual)
  expected = optionalValue(expected)
  if (actual === undefined || expected === undefined) return false
  if (actual != null && typeof actual !== "string") return false
  if (expected != null && typeof expected !== "string") return false
  return normalizedOptionalString(actual) === normalizedOptionalString(expected)
}

function timestampMicros(value: unknown): bigint | null {
  value = optionalValue(value)
  if (value && typeof value === "object") {
    const timestamp = value as {
      readonly __timestamp_micros_since_unix_epoch__?: unknown
      readonly microsSinceUnixEpoch?: unknown
      readonly micros_since_unix_epoch?: unknown
    }
    value = timestamp.__timestamp_micros_since_unix_epoch__ ?? timestamp.microsSinceUnixEpoch ?? timestamp.micros_since_unix_epoch
  } else if (typeof value === "string" && !/^-?\d+$/.test(value)) {
    const milliseconds = Date.parse(value)
    if (!Number.isFinite(milliseconds)) return null
    // Date.parse truncates ISO fractions to milliseconds; readback identity
    // must retain SpacetimeDB's remaining microseconds.
    const fraction = /\.(\d+)(?:Z|[+-]\d{2}:?\d{2})$/i.exec(value)?.[1] ?? ""
    if (fraction.length > 6) return null
    const submillis = fraction.padEnd(6, "0").slice(3)
    return BigInt(milliseconds) * 1000n + BigInt(submillis || "0")
  }
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "bigint") return null
  try { return BigInt(value) } catch { return null }
}

export interface FleetAccountMoveProjection {
  readonly id?: unknown
  readonly organizationId?: unknown
  readonly organization_id?: unknown
  readonly companyId?: unknown
  readonly company_id?: unknown
  readonly currencyId?: unknown
  readonly currency_id?: unknown
  readonly journalId?: unknown
  readonly journal_id?: unknown
  readonly state?: unknown
}

export interface FleetAccountMoveLineProjection {
  readonly moveId?: unknown
  readonly move_id?: unknown
  readonly accountId?: unknown
  readonly account_id?: unknown
  readonly debit?: unknown
  readonly credit?: unknown
}

function resolveFleetServiceAccountingMove(
  moves: readonly FleetAccountMoveProjection[],
  lines: readonly FleetAccountMoveLineProjection[],
  organizationId: bigint,
  companyId: bigint,
  moveId: bigint,
  currencyId: bigint,
  journalId: bigint,
  expenseAccountId: bigint,
  offsetAccountId: bigint,
  costAmount: number,
): boolean {
  const matches = moves.filter((row) => parseStrictU64(row.id) === moveId)
  if (matches.length > 1) {
    throw new AmbiguousOperationEffectError(
      `Expected one fleet service account move, found ${matches.length}`,
    )
  }
  const row = matches[0]
  if (
    !row ||
    parseStrictU64(row.organizationId ?? row.organization_id) !== organizationId ||
    parseStrictU64(row.companyId ?? row.company_id) !== companyId ||
    parseStrictU64(row.currencyId ?? row.currency_id) !== currencyId ||
    parseStrictU64(row.journalId ?? row.journal_id) !== journalId ||
    fleetOutcomeTag(row.state) !== "posted"
  ) {
    return false
  }

  const moveLines = lines.filter(
    (line) => parseStrictU64(line.moveId ?? line.move_id) === moveId,
  )
  if (moveLines.length !== 2) return false

  const amount = (value: unknown) => {
    return numericField(value) ?? Number.NaN
  }
  const expenseLine = moveLines.find(
    (line) =>
      parseStrictU64(line.accountId ?? line.account_id) === expenseAccountId &&
      Math.abs(amount(line.debit) - costAmount) <= 0.0001 &&
      Math.abs(amount(line.credit)) <= 0.0001,
  )
  const offsetLine = moveLines.find(
    (line) =>
      parseStrictU64(line.accountId ?? line.account_id) === offsetAccountId &&
      Math.abs(amount(line.credit) - costAmount) <= 0.0001 &&
      Math.abs(amount(line.debit)) <= 0.0001,
  )
  return Boolean(expenseLine && offsetLine)
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
    readonly servicedAt?: ReturnType<typeof optionalTimestamp>
    readonly inspectedAt?: ReturnType<typeof optionalTimestamp>
    readonly odometerKm?: ReturnType<typeof optionalNumber>
    readonly provider?: ReturnType<typeof optionalText>
    readonly notes?: ReturnType<typeof optionalText>
    readonly inspectorId?: ReturnType<typeof encodeOptionalU64>
    readonly outcome?: FleetInspectionOutcome
    readonly costAmount?: number
    readonly journalId?: bigint
    readonly expenseAccountId?: bigint
    readonly offsetAccountId?: bigint
    readonly accountMoves?: readonly FleetAccountMoveProjection[]
    readonly accountMoveLines?: readonly FleetAccountMoveLineProjection[]
  },
): FleetHistoryEffectRef | null {
  const matches = rows.filter(
    (row) =>
      parseStrictU64(row.organizationId ?? row.organization_id) === organizationId &&
      parseStrictU64(row.companyId ?? row.company_id) === companyId &&
      normalizedOptionalString(row.clientRequestId ?? row.client_request_id) === clientRequestId,
  )

  if (matches.length > 1) {
    throw new AmbiguousOperationEffectError(
      `Expected one ${resource} effect, found ${matches.length}`,
    )
  }

  const row = matches[0]
  if (!row || parseStrictU64(row.vehicleId ?? row.vehicle_id) !== vehicleId) return null

  if (!expected) return null
  const service = resource === "fleet-service-records"
  const submittedTime = service ? expected.servicedAt : expected.inspectedAt
  const time = timestampMicros(historyField(row, service ? "servicedAt" : "inspectedAt", service ? "serviced_at" : "inspected_at"))
  const expectedTime = submittedTime && "none" in submittedTime
    ? timestampMicros(historyField(row, "createDate", "create_date"))
    : timestampMicros(submittedTime)
  const odometer = historyField(row, "odometerKm", "odometer_km")
  const notes = historyField(row, "notes")
  if (
    time == null || expectedTime == null || time !== expectedTime ||
    odometer === undefined || expected.odometerKm === undefined ||
    !optionalNumberMatches(odometer, expected.odometerKm) ||
    notes === undefined || expected.notes === undefined ||
    !optionalTextMatches(notes, expected.notes)
  ) return null
  if (service) {
    const provider = historyField(row, "provider")
    if (expected.serviceTypeId == null || provider === undefined || expected.provider === undefined ||
      !optionalTextMatches(provider, expected.provider)) return null
    if (expected.costAmount == null &&
      (expected.journalId != null || expected.expenseAccountId != null || expected.offsetAccountId != null ||
       historyField(row, "costAmount", "cost_amount") === undefined ||
       optionalValue(historyField(row, "costAmount", "cost_amount")) != null ||
       historyField(row, "accountMoveId", "account_move_id") === undefined ||
       optionalValue(historyField(row, "accountMoveId", "account_move_id")) != null ||
       historyField(row, "currencyId", "currency_id") === undefined ||
       optionalValue(historyField(row, "currencyId", "currency_id")) != null)) return null
  } else {
    const inspector = historyField(row, "inspectorId", "inspector_id")
    if (expected.outcome == null || inspector === undefined || expected.inspectorId === undefined ||
      (optionalValue(inspector) == null) !== (optionalValue(expected.inspectorId) == null) ||
      (optionalValue(inspector) != null && parseStrictU64(optionalValue(inspector)) == null) ||
      parseStrictU64(optionalValue(inspector)) !== parseStrictU64(optionalValue(expected.inspectorId))) return null
  }

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
      costAmount !== expected.costAmount ||
      currencyId == null ||
      accountMoveId == null ||
      expected.journalId == null ||
      expected.expenseAccountId == null ||
      expected.offsetAccountId == null ||
      expected.accountMoves == null ||
      expected.accountMoveLines == null ||
      !resolveFleetServiceAccountingMove(
        expected.accountMoves,
        expected.accountMoveLines,
        organizationId,
        companyId,
        accountMoveId,
        currencyId,
        expected.journalId,
        expected.expenseAccountId,
        expected.offsetAccountId,
        costAmount,
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
      input = { ...input }
      const clientRequestId = requireFleetRequestId(input.clientRequestId)
      const params = {
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
      }
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
              servicedAt: params.servicedAt,
              odometerKm: params.odometerKm,
              provider: params.provider,
              notes: params.notes,
              serviceTypeId: input.serviceTypeId,
              journalId: input.journalId,
              expenseAccountId: input.expenseAccountId,
              offsetAccountId: input.offsetAccountId,
              ...(input.costAmount != null
                ? {
                    costAmount: input.costAmount,
                    accountMoves: await fetchQueryList(
                      "/api/query/account-moves",
                      "Failed to read fleet service accounting move",
                    ),
                    accountMoveLines: await fetchQueryList(
                      "/api/query/account-move-lines",
                      "Failed to read fleet service accounting lines",
                    ),
                  }
                : {}),
            },
          ),
        dispatch: async () => {
          const { urlPath, init } = stdbBffCommandPost("record_fleet_service", {
            companyId: scopedCompanyId,
            params: stdbParamsToJson(params),
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
      input = { ...input }
      const clientRequestId = requireFleetRequestId(input.clientRequestId)
      const params = {
        vehicleId: input.vehicleId,
        inspectorId: encodeOptionalU64(input.inspectorId),
        inspectedAt: optionalTimestamp(input.inspectedAt),
        outcome: input.outcome,
        odometerKm: optionalNumber(input.odometerKm),
        notes: optionalText(input.notes),
        clientRequestId: optionalText(clientRequestId),
      }
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
            params,
          ),
        dispatch: async () => {
          const { urlPath, init } = stdbBffCommandPost("record_fleet_inspection", {
            companyId: scopedCompanyId,
            params: stdbParamsToJson(params),
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
