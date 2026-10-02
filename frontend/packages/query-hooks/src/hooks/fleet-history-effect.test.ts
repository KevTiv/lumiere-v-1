import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  resolveFleetHistoryEffect,
  type FleetHistoryEffectProjection,
} from "./fleet"
import { AmbiguousOperationEffectError, executeOperationWithCanonicalReadback } from "./operation-effect"

const absent = { none: [] } as { none: [] }
const payload = {
  servicedAt: absent,
  inspectedAt: absent,
  odometerKm: absent,
  notes: absent,
  provider: absent,
  inspectorId: absent,
}

const service: FleetHistoryEffectProjection = {
  id: "501",
  organizationId: "7",
  companyId: "8",
  vehicleId: "41",
  serviceTypeId: "12",
  servicedAt: "2026-01-01T00:00:00.000Z",
  createDate: "2026-01-01T00:00:00.000Z",
  odometerKm: null,
  provider: null,
  notes: null,
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
  inspected_at: "2026-01-01T00:00:00.000Z",
  create_date: "2026-01-01T00:00:00.000Z",
  odometer_km: null,
  inspector_id: null,
  notes: null,
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
  const expectedService: NonNullable<Parameters<typeof resolveFleetHistoryEffect>[6]> = {
    ...payload, serviceTypeId: 12n, costAmount: 275.5,
    journalId: 44n, expenseAccountId: 55n, offsetAccountId: 66n,
    accountMoves: [postedMove], accountMoveLines: postedLines,
  }
  const readService = (row: FleetHistoryEffectProjection, expected = expectedService) =>
    resolveFleetHistoryEffect([row], "fleet-service-records", 7n, 8n, 41n, "fleet-service-req", expected)

  it("rejects every changed service payload field and missing projection evidence", () => {
    for (const changed of [
      { servicedAt: "2026-01-02T00:00:00Z" }, { createDate: undefined },
      { servicedAt: "2026-01-01T00:00:00.000001Z" },
      { createDate: "2026-01-01T00:00:00.000001Z" },
      { odometerKm: 0 }, { odometerKm: undefined }, { provider: "other" },
      { provider: undefined }, { notes: "other" }, { notes: undefined },
      { costAmount: null }, { costAmount: 275.50001 },
      { accountMoveId: null }, { serviceTypeId: "99" },
    ]) assert.equal(readService({ ...service, ...changed }), null, JSON.stringify(changed))
  })

  it("compares omitted timestamps to original create date, explicit timestamps to finalized micros", () => {
    assert.ok(readService(service))
    assert.ok(readService({ ...service, createDate: undefined }, {
      ...expectedService,
      servicedAt: { some: { __timestamp_micros_since_unix_epoch__: Date.parse("2026-01-01") * 1000 } },
    }))
    assert.equal(readService(service, {
      ...expectedService,
      servicedAt: { some: { __timestamp_micros_since_unix_epoch__: Date.parse("2026-01-02") * 1000 } },
    }), null)
  })

  it("accepts canonical trim/empty text equivalence without equating absent numbers with zero", () => {
    assert.ok(readService({ ...service, provider: "  workshop  ", notes: "   " }, {
      ...expectedService, provider: { some: " workshop " },
    }))
    assert.equal(readService(service, { ...expectedService, odometerKm: { some: 0 } }), null)
    assert.ok(readService({ ...service, odometerKm: 0 }, { ...expectedService, odometerKm: { some: 0 } }))
  })

  it("requires explicit absence of both cost and accounting linkage for a non-cost request", () => {
    const expected = { ...expectedService, costAmount: undefined }
    assert.equal(readService(service, expected), null)
    assert.ok(readService({ ...service, costAmount: null, accountMoveId: null, currencyId: null }, expected))
    assert.equal(readService({ ...service, costAmount: null, accountMoveId: null, currencyId: undefined }, expected), null)
    assert.equal(readService({ ...service, costAmount: null, accountMoveId: null, currencyId: "3" }, expected), null)
    assert.equal(readService({ ...service, costAmount: 0, accountMoveId: null }, expected), null)
    assert.equal(readService({ ...service, costAmount: null, accountMoveId: undefined }, expected), null)
    assert.equal(readService({ ...service, costAmount: null, accountMoveId: "900" }, expected), null)
  })

  it("matches the complete inspection payload and rejects duplicates before payload filtering", () => {
    const expected = { ...payload, outcome: "attention_required" as const }
    const read = (rows: FleetHistoryEffectProjection[]) =>
      resolveFleetHistoryEffect(rows, "fleet-inspections", 7n, 8n, 41n, "fleet-inspection-req", expected)
    assert.ok(read([inspection]))
    assert.equal(read([]), null)
    for (const changed of [
      { inspector_id: "55" }, { inspector_id: undefined }, { notes: "changed" },
      { odometer_km: 0 }, { inspected_at: "2026-01-02T00:00:00Z" },
      { create_date: undefined }, { outcome: "passed" },
    ]) assert.equal(read([{ ...inspection, ...changed }]), null)
    assert.throws(() => read([inspection, { ...inspection, notes: "different" }]), AmbiguousOperationEffectError)
  })

  it("checks key cardinality before vehicle matching", () => {
    const otherVehicle = { ...service, vehicleId: "42" }
    assert.equal(readService(otherVehicle), null)
    assert.throws(
      () => resolveFleetHistoryEffect(
        [service, otherVehicle], "fleet-service-records", 7n, 8n, 41n,
        "fleet-service-req", expectedService,
      ),
      AmbiguousOperationEffectError,
    )
    assert.throws(
      () => resolveFleetHistoryEffect(
        [inspection, { ...inspection, vehicle_id: 42n }], "fleet-inspections",
        7n, 8n, 41n, "fleet-inspection-req", { ...payload, outcome: "attention_required" },
      ),
      AmbiguousOperationEffectError,
    )
  })

  it("resolves explicit inspection time, inspector, odometer and normalized notes", () => {
    const expected = {
      ...payload, outcome: "attention_required" as const,
      inspectedAt: { some: { __timestamp_micros_since_unix_epoch__: Date.parse("2026-01-01") * 1000 } },
      inspectorId: { some: 55 }, odometerKm: { some: 0 }, notes: { some: " checked " },
    }
    const row = { ...inspection, create_date: undefined, inspector_id: "55", odometer_km: 0, notes: "checked" }
    const read = (projection: FleetHistoryEffectProjection) =>
      resolveFleetHistoryEffect([projection], "fleet-inspections", 7n, 8n, 41n, "fleet-inspection-req", expected)
    assert.ok(read(row))
    assert.equal(read({ ...row, inspector_id: null }), null)
    assert.equal(read({ ...row, odometer_km: null }), null)
    assert.equal(read({ ...row, notes: null }), null)
  })

  it("does not infer null accounting line amounts as zero", () => {
    assert.equal(readService(service, {
      ...expectedService,
      accountMoveLines: [{ ...postedLines[0], credit: null }, postedLines[1]!],
    }), null)
    assert.equal(readService(service, {
      ...expectedService,
      accountMoveLines: [{ ...postedLines[0], debit: 275.51 }, postedLines[1]!],
    }), null)
  })

  it("reconciles a lost response with the original default timestamp without redispatch", async () => {
    let persisted = false
    let dispatches = 0
    const result = await executeOperationWithCanonicalReadback({
      resolveEffect: async () => persisted ? readService(service) : null,
      dispatch: async () => {
        dispatches++
        persisted = true
        throw new Error("response lost")
      },
      readbackAttempts: 2,
      readbackDelayMs: 0,
    })
    assert.equal(dispatches, 1)
    assert.equal(result.kind, "converged")
    const retry = await executeOperationWithCanonicalReadback({
      resolveEffect: async () => readService(service),
      dispatch: async () => { throw new Error("must not redispatch") },
    })
    assert.equal(retry.kind, "already-applied")
  })

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
          ...payload,
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
          ...payload,
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
          ...payload,
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
          ...payload,
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
          ...payload,
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
        { ...payload, outcome: "attention_required" },
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
        { ...expectedService },
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
        { ...expectedService },
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
        { ...expectedService },
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
        { ...expectedService, serviceTypeId: 99n },
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
        { ...payload, outcome: "passed" },
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
          { ...expectedService },
        ),
      AmbiguousOperationEffectError,
    )
  })
})
