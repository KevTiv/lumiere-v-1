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
  costAmount: 275.5,
  currencyId: "3",
  accountMoveId: "900",
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

const postedMove = {
  id: "900",
  organizationId: "7",
  companyId: "8",
  currencyId: "3",
  journalId: "44",
  state: { tag: "Posted" },
}

const postedLines = [
  {
    moveId: "900",
    accountId: "55",
    debit: 275.5,
    credit: 0,
  },
  {
    moveId: "900",
    accountId: "66",
    debit: 0,
    credit: 275.5,
  },
]

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
        {
          serviceTypeId: 12n,
          costAmount: 275.5,
          journalId: 44n,
          expenseAccountId: 55n,
          offsetAccountId: 66n,
          accountMoves: [postedMove],
          accountMoveLines: postedLines,
        },
      ),
      {
        resource: "fleet-service-records",
        id: "501",
        vehicleId: "41",
        companyId: "8",
        clientRequestId: "fleet-service-req",
        costAmount: 275.5,
        currencyId: "3",
        accountMoveId: "900",
      },
    )
  })

  it("requires the linked accounting move to be posted in the same scope and currency", () => {
    assert.equal(
      resolveFleetHistoryEffect(
        [service],
        "fleet-service-records",
        7n,
        8n,
        41n,
        "fleet-service-req",
        {
          serviceTypeId: 12n,
          costAmount: 275.5,
          journalId: 44n,
          expenseAccountId: 55n,
          offsetAccountId: 66n,
          accountMoves: [{ ...postedMove, state: { tag: "Draft" } }],
          accountMoveLines: postedLines,
        },
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
        {
          serviceTypeId: 12n,
          costAmount: 275.5,
          journalId: 44n,
          expenseAccountId: 55n,
          offsetAccountId: 66n,
          accountMoves: [{ ...postedMove, currencyId: "99" }],
          accountMoveLines: postedLines,
        },
      ),
      null,
    )
  })

  it("fails closed when journal or GL account semantics differ", () => {
    assert.equal(
      resolveFleetHistoryEffect(
        [service],
        "fleet-service-records",
        7n,
        8n,
        41n,
        "fleet-service-req",
        {
          serviceTypeId: 12n,
          costAmount: 275.5,
          journalId: 99n,
          expenseAccountId: 55n,
          offsetAccountId: 66n,
          accountMoves: [postedMove],
          accountMoveLines: postedLines,
        },
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
        {
          serviceTypeId: 12n,
          costAmount: 275.5,
          journalId: 44n,
          expenseAccountId: 999n,
          offsetAccountId: 66n,
          accountMoves: [postedMove],
          accountMoveLines: postedLines,
        },
      ),
      null,
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
