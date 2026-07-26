import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  finalizeCreateContractParams,
  finalizeCreateLeaveRequestParams,
  finalizeCreatePayslipParams,
  finalizeUpdateLeaveTypeParams,
} from "./hr-params-merge"

describe("finalizeCreateLeaveRequestParams", () => {
  it("rejects missing or zero employeeId/leaveTypeId", () => {
    assert.throws(
      () => finalizeCreateLeaveRequestParams({ leaveTypeId: 1n }),
      /employeeId is required/,
    )
    assert.throws(
      () => finalizeCreateLeaveRequestParams({ employeeId: 0n, leaveTypeId: 1n }),
      /employeeId is required/,
    )
    assert.throws(
      () => finalizeCreateLeaveRequestParams({ employeeId: 1n }),
      /leaveTypeId is required/,
    )
    assert.throws(
      () => finalizeCreateLeaveRequestParams({ employeeId: 1n, leaveTypeId: 0n }),
      /leaveTypeId is required/,
    )
  })

  it("passes through required leave ids", () => {
    const params = finalizeCreateLeaveRequestParams({
      employeeId: 4n,
      leaveTypeId: 7n,
      numberOfDays: 2,
    })
    assert.equal(params.employeeId, 4n)
    assert.equal(params.leaveTypeId, 7n)
    assert.equal(params.numberOfDays, 2)
  })
})

describe("finalizeCreateContractParams", () => {
  it("rejects missing or zero employeeId/currencyId", () => {
    assert.throws(
      () => finalizeCreateContractParams({ currencyId: 1n, name: "C" }),
      /employeeId is required/,
    )
    assert.throws(
      () => finalizeCreateContractParams({ employeeId: 1n, name: "C" }),
      /currencyId is required/,
    )
    assert.throws(
      () => finalizeCreateContractParams({ employeeId: 1n, currencyId: 0n, name: "C" }),
      /currencyId is required/,
    )
  })
})

describe("finalizeCreatePayslipParams", () => {
  it("rejects missing or zero employeeId/structId", () => {
    assert.throws(
      () => finalizeCreatePayslipParams({ structId: 1n }),
      /employeeId is required/,
    )
    assert.throws(
      () => finalizeCreatePayslipParams({ employeeId: 1n, structId: 0n }),
      /structId is required/,
    )
  })
})

describe("finalizeUpdateLeaveTypeParams", () => {
  it("includes only explicitly provided leave type fields", () => {
    const params = finalizeUpdateLeaveTypeParams({ name: "Annual Leave" })
    assert.deepEqual(params, { name: "Annual Leave" })
    assert.ok(!("maxLeaves" in params))
    assert.ok(!("isActive" in params))
  })

  it("returns an empty object for an empty partial", () => {
    assert.deepEqual(finalizeUpdateLeaveTypeParams({}), {})
  })
})
