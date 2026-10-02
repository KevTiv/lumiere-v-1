import assert from "node:assert/strict"
import test from "node:test"

import { AmbiguousOperationEffectError } from "./operation-effect"
import {
  fleetInspectionOutcomeFromInput,
  fleetInspectionOutcomeTag,
  resolveFleetHistoryEffect,
  type FleetHistoryExpectation,
  type FleetHistoryProjection,
} from "./fleet-history"

const service = (extra: Partial<FleetHistoryProjection> = {}): FleetHistoryProjection => ({
  id: 5n,
  organizationId: 1n,
  companyId: 3n,
  vehicleId: 7n,
  serviceTypeId: 2n,
  clientRequestId: "req-1",
  ...extra,
})

const expectService: FleetHistoryExpectation = {
  resource: "fleet-service-records",
  organizationId: 1n,
  companyId: 3n,
  vehicleId: 7n,
  clientRequestId: "req-1",
  serviceTypeId: 2n,
}

test("normalises inspection outcomes", () => {
  assert.equal(fleetInspectionOutcomeTag({ attentionRequired: [] }), "AttentionRequired")
  assert.equal(fleetInspectionOutcomeTag({ tag: "Failed" }), "Failed")
  assert.equal(fleetInspectionOutcomeTag("Passed"), "Passed")
  assert.equal(fleetInspectionOutcomeFromInput("attention_required"), "AttentionRequired")
  assert.equal(fleetInspectionOutcomeFromInput(" passed "), "Passed")
})

test("resolves the exact service record by client request id", () => {
  const rows = [service({ id: 4n, clientRequestId: "req-0" }), service()]
  assert.deepEqual(resolveFleetHistoryEffect(rows, expectService), { resource: "fleet-service-records", id: "5" })
})

test("accepts snake_case rows and Option text", () => {
  const rows = [{ id: "5", organization_id: "1", company_id: "3", vehicle_id: "7", service_type_id: "2", client_request_id: { some: "req-1" } }]
  assert.deepEqual(resolveFleetHistoryEffect(rows, expectService), { resource: "fleet-service-records", id: "5" })
})

test("returns null for a missing key, other scope, other vehicle or other service type", () => {
  assert.equal(resolveFleetHistoryEffect([service({ clientRequestId: "other" })], expectService), null)
  assert.equal(resolveFleetHistoryEffect([service({ organizationId: 2n })], expectService), null)
  assert.equal(resolveFleetHistoryEffect([service({ companyId: 4n })], expectService), null)
  assert.equal(resolveFleetHistoryEffect([service({ vehicleId: 8n })], expectService), null)
  assert.equal(resolveFleetHistoryEffect([service({ serviceTypeId: 9n })], expectService), null)
  assert.equal(resolveFleetHistoryEffect([service({ clientRequestId: undefined })], expectService), null)
})

test("throws when one request id has more than one row in scope", () => {
  assert.throws(
    () => resolveFleetHistoryEffect([service(), service({ id: 6n })], expectService),
    AmbiguousOperationEffectError,
  )
  // The same key in another company is a different request.
  assert.deepEqual(
    resolveFleetHistoryEffect([service(), service({ id: 6n, companyId: 4n })], expectService),
    { resource: "fleet-service-records", id: "5" },
  )
})

test("resolves an inspection by key, vehicle and outcome", () => {
  const expected: FleetHistoryExpectation = {
    resource: "fleet-inspections",
    organizationId: 1n,
    companyId: 3n,
    vehicleId: 7n,
    clientRequestId: "req-1",
    outcome: "AttentionRequired",
  }
  const row = (outcome: unknown) => service({ serviceTypeId: undefined, outcome })
  assert.deepEqual(resolveFleetHistoryEffect([row({ attentionRequired: [] })], expected), {
    resource: "fleet-inspections",
    id: "5",
  })
  assert.equal(resolveFleetHistoryEffect([row({ passed: [] })], expected), null)
})
