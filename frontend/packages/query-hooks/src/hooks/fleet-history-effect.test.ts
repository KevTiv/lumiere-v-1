import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  resolveFleetHistoryEffect,
  type FleetHistoryEffectProjection,
} from "./fleet"
import { AmbiguousOperationEffectError } from "./operation-effect"

const service: FleetHistoryEffectProjection = {
  id: "501",
  organizationId: "7",
  companyId: "8",
  vehicleId: "41",
  serviceTypeId: "12",
  clientRequestId: "fleet-service-req",
}

const inspection: FleetHistoryEffectProjection = {
  id: "777",
  organization_id: 7n,
  company_id: 8n,
  vehicle_id: 41n,
  outcome: { attention_required: [] },
  client_request_id: { some: "fleet-inspection-req" },
}

describe("COV-15 fleet history exact effects", () => {
  it("resolves a service by stable request identity and service type", () => {
    assert.deepEqual(
      resolveFleetHistoryEffect(
        [service],
        "fleet-service-records",
        7n,
        8n,
        41n,
        "fleet-service-req",
        { serviceTypeId: 12n },
      ),
      {
        resource: "fleet-service-records",
        id: "501",
        vehicleId: "41",
        companyId: "8",
        clientRequestId: "fleet-service-req",
      },
    )
  })

  it("resolves an inspection by stable request identity and typed outcome", () => {
    assert.deepEqual(
      resolveFleetHistoryEffect(
        [inspection],
        "fleet-inspections",
        7n,
        8n,
        41n,
        "fleet-inspection-req",
        { outcome: "attention_required" },
      ),
      {
        resource: "fleet-inspections",
        id: "777",
        vehicleId: "41",
        companyId: "8",
        clientRequestId: "fleet-inspection-req",
      },
    )
  })

  it("fails closed for scope, vehicle, request, service type, or outcome mismatch", () => {
    assert.equal(
      resolveFleetHistoryEffect(
        [service],
        "fleet-service-records",
        7n,
        9n,
        41n,
        "fleet-service-req",
        { serviceTypeId: 12n },
      ),
      null,
    )
    assert.equal(
      resolveFleetHistoryEffect(
        [service],
        "fleet-service-records",
        7n,
        8n,
        42n,
        "fleet-service-req",
        { serviceTypeId: 12n },
      ),
      null,
    )
    assert.equal(
      resolveFleetHistoryEffect(
        [service],
        "fleet-service-records",
        7n,
        8n,
        41n,
        "other-request",
        { serviceTypeId: 12n },
      ),
      null,
    )
    assert.equal(
      resolveFleetHistoryEffect(
        [service],
        "fleet-service-records",
        7n,
        8n,
        41n,
        "fleet-service-req",
        { serviceTypeId: 99n },
      ),
      null,
    )
    assert.equal(
      resolveFleetHistoryEffect(
        [inspection],
        "fleet-inspections",
        7n,
        8n,
        41n,
        "fleet-inspection-req",
        { outcome: "passed" },
      ),
      null,
    )
  })

  it("rejects duplicate exact request identities within one scope", () => {
    assert.throws(
      () =>
        resolveFleetHistoryEffect(
          [service, { ...service }],
          "fleet-service-records",
          7n,
          8n,
          41n,
          "fleet-service-req",
          { serviceTypeId: 12n },
        ),
      AmbiguousOperationEffectError,
    )
  })
})
