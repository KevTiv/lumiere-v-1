import assert from "node:assert/strict"
import test from "node:test"

import {
  allocationOptionalColumns,
  allocationRemainingDays,
  mapAllocationRows,
  mapStatutoryIdRow,
  maskStatutoryValue,
  offboardingForEmployee,
  statutoryIdsForEmployee,
} from "./hr-allocations"

test("remaining days subtracts used and rounds", () => {
  assert.equal(allocationRemainingDays(20, 4.5), 15.5)
  assert.equal(allocationRemainingDays("10", undefined), 10)
  assert.equal(allocationRemainingDays(1.1, 0.2), 0.9)
  assert.equal(allocationRemainingDays(5, 7), -2)
  assert.equal(allocationRemainingDays(undefined, 2), undefined)
  assert.equal(allocationRemainingDays("abc", 2), undefined)
})

test("maps allocations with names, snake_case, and no placeholder ids", () => {
  const rows = mapAllocationRows(
    [
      { id: 1n, employee_id: 7n, leave_type_id: 3n, period_year: 2026, allocated_days: 20, used_days: 5 },
      { id: 2, employeeId: 99, leaveTypeId: 98, allocatedDays: 10 },
    ],
    [{ id: 7, name: "Ada" }],
    [{ id: 3, name: "Annual" }],
  )
  assert.equal(rows[0].employeeName, "Ada")
  assert.equal(rows[0].leaveTypeName, "Annual")
  assert.equal(rows[0].remainingDays, 15)
  assert.equal(rows[1].employeeName, undefined)
  assert.equal(rows[1].leaveTypeName, undefined)
  assert.equal(rows[1].remainingDays, 10)
  const cols = allocationOptionalColumns(rows)
  assert.deepEqual(cols, { validity: false, state: false, period: true })
})

test("mask keeps last 4 and never reveals short values", () => {
  assert.equal(maskStatutoryValue("123-45-6789"), "••••6789")
  assert.equal(maskStatutoryValue("AB 12 34 56 C"), "••••456C")
  assert.equal(maskStatutoryValue("1234"), "••••")
  assert.equal(maskStatutoryValue(""), undefined)
  assert.equal(maskStatutoryValue(undefined), undefined)
  assert.equal(maskStatutoryValue(null), undefined)
  assert.equal(maskStatutoryValue({ a: 1 }), undefined)
})

test("statutory row never carries the raw value and reads metadata", () => {
  const raw = "S1234567D"
  const mapped = mapStatutoryIdRow({
    id: 1,
    employee_id: 4,
    id_kind: "NRIC",
    value: raw,
    metadata: JSON.stringify({ country: "SG", issue_date: "2020-01-02", expiry_date: "2030-01-02", secret: "x" }),
  })
  assert.equal(mapped.maskedValue, "••••567D")
  assert.equal(mapped.country, "SG")
  assert.equal(mapped.expiryDate, "2030-01-02")
  assert.ok(!JSON.stringify(mapped).includes(raw))
  assert.ok(!JSON.stringify(mapped).includes("secret"))
})

test("absent value yields no masked value; filters by employee", () => {
  const out = statutoryIdsForEmployee(
    [
      { id: 1, employeeId: 4, idKind: "TFN" },
      { id: 2, employeeId: 5, idKind: "CPF", value: "999999" },
    ],
    4,
  )
  assert.equal(out.length, 1)
  assert.equal(out[0].maskedValue, undefined)
})

test("offboarding progress", () => {
  assert.equal(offboardingForEmployee([], 1), undefined)
  const v = offboardingForEmployee(
    [{ id: 1, employee_id: 1, status: "in_progress", assets_returned: true, access_revoked: false, docs_collected: false, assets_notes: "laptop" }],
    1,
  )
  assert.ok(v)
  assert.equal(v.doneCount, 1)
  assert.equal(v.complete, false)
  assert.equal(v.items[0].notes, "laptop")
})
