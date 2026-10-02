import { parseStrictU64 } from "@lumiere/erp-shared/u64"

import { AmbiguousOperationEffectError, type CanonicalRecordRef } from "./operation-effect"

export type FleetHistoryResource = "fleet-service-records" | "fleet-inspections"

export type FleetHistoryProjection = {
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
  readonly clientRequestId?: unknown
  readonly client_request_id?: unknown
}

export type FleetHistoryExpectation = {
  readonly resource: FleetHistoryResource
  readonly organizationId: bigint
  readonly companyId: bigint
  readonly vehicleId: bigint
  readonly clientRequestId: string
  /** Service records: the recorded service type. */
  readonly serviceTypeId?: bigint
  /** Inspections: the recorded outcome tag (`Passed`, `Failed`, `AttentionRequired`). */
  readonly outcome?: string
}

function text(value: unknown): string {
  if (typeof value === "string") return value.trim()
  if (value && typeof value === "object" && "some" in value) return text((value as { some: unknown }).some)
  return ""
}

/** Normalise a SATS enum cell (`"Passed"`, `{ tag: "Passed" }`, `{ passed: [] }`). */
export function fleetInspectionOutcomeTag(outcome: unknown): string {
  if (typeof outcome === "string") return outcome
  if (outcome && typeof outcome === "object" && !Array.isArray(outcome)) {
    if ("tag" in outcome && typeof outcome.tag === "string") return outcome.tag
    const keys = Object.keys(outcome)
    if (keys.length === 1) return keys[0]!.charAt(0).toUpperCase() + keys[0]!.slice(1)
  }
  return ""
}

/** The reducer's typed outcome for the `passed` / `failed` / `attention_required` input. */
export function fleetInspectionOutcomeFromInput(outcome: string): string {
  return outcome
    .trim()
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("")
}

/**
 * COV-15: resolve the one history row recorded for a client request id in the
 * same organization and company, for the same vehicle (and service type or
 * outcome). The id is unique per organization and company, so a second match is
 * an invariant failure — never "the newest row for the vehicle".
 */
export function resolveFleetHistoryEffect(
  rows: readonly FleetHistoryProjection[],
  expected: FleetHistoryExpectation,
): CanonicalRecordRef | null {
  const matches = rows.filter(
    (row) =>
      text(row.clientRequestId ?? row.client_request_id) === expected.clientRequestId
      && parseStrictU64(row.organizationId ?? row.organization_id) === expected.organizationId
      && parseStrictU64(row.companyId ?? row.company_id) === expected.companyId,
  )
  if (matches.length > 1) {
    throw new AmbiguousOperationEffectError(`Expected one ${expected.resource} row, found ${matches.length}`)
  }
  const row = matches[0]
  const id = row ? parseStrictU64(row.id) : undefined
  if (!row || id == null) return null
  if (parseStrictU64(row.vehicleId ?? row.vehicle_id) !== expected.vehicleId) return null
  if (
    expected.serviceTypeId !== undefined
    && parseStrictU64(row.serviceTypeId ?? row.service_type_id) !== expected.serviceTypeId
  ) return null
  if (expected.outcome !== undefined && fleetInspectionOutcomeTag(row.outcome) !== expected.outcome) return null
  return { resource: expected.resource, id: id.toString() }
}
