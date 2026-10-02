import assert from "node:assert/strict"
import test from "node:test"

import { AmbiguousOperationEffectError } from "./operation-effect"
import {
  resolveTimesheetBillingEffect,
  resolveTimesheetStatusEffects,
  type TimesheetEffectProjection,
} from "./project-timesheet-effects"

const sheet = (id: bigint, extra: Partial<TimesheetEffectProjection> = {}): TimesheetEffectProjection => ({
  id,
  organizationId: 1n,
  companyId: 3n,
  validationStatus: "validated",
  timesheetInvoiceId: null,
  ...extra,
})

test("a batch resolves when every id is in the expected status", () => {
  const rows = [sheet(1n), sheet(2n), sheet(3n, { validationStatus: "draft" })]
  assert.deepEqual(resolveTimesheetStatusEffects(rows, 1n, 3n, [1n, 2n], "validated"), [
    { resource: "timesheets", id: "1" },
    { resource: "timesheets", id: "2" },
  ])
  assert.deepEqual(resolveTimesheetStatusEffects(rows, 1n, null, [3n], "draft"), [{ resource: "timesheets", id: "3" }])
})

test("rejection reads back as rejected, not as a missing worklist row", () => {
  assert.deepEqual(resolveTimesheetStatusEffects([sheet(1n, { validationStatus: "rejected" })], 1n, 3n, [1n], "rejected"), [
    { resource: "timesheets", id: "1" },
  ])
})

test("accepts snake_case rows and duplicate ids in the request", () => {
  const rows = [{ id: "1", organization_id: "1", company_id: "3", validation_status: "validated" }]
  assert.equal(resolveTimesheetStatusEffects(rows, 1n, 3n, [1n, 1n], "validated")?.length, 1)
})

test("any id missing, in another status or out of scope makes the batch no effect", () => {
  const rows = [sheet(1n), sheet(2n, { validationStatus: "draft" })]
  assert.equal(resolveTimesheetStatusEffects(rows, 1n, 3n, [1n, 2n], "validated"), null)
  assert.equal(resolveTimesheetStatusEffects(rows, 1n, 3n, [1n, 9n], "validated"), null)
  assert.equal(resolveTimesheetStatusEffects(rows, 2n, 3n, [1n], "validated"), null)
  assert.equal(resolveTimesheetStatusEffects(rows, 1n, 4n, [1n], "validated"), null)
  assert.equal(resolveTimesheetStatusEffects(rows, 1n, 3n, [], "validated"), null)
})

test("throws on duplicate timesheet rows", () => {
  assert.throws(() => resolveTimesheetStatusEffects([sheet(1n), sheet(1n)], 1n, 3n, [1n], "validated"), AmbiguousOperationEffectError)
})

test("billing resolves the one invoice every timesheet points at", () => {
  const rows = [sheet(1n, { timesheetInvoiceId: 40n }), sheet(2n, { timesheet_invoice_id: { some: 40n } } as Partial<TimesheetEffectProjection>)]
  assert.equal(resolveTimesheetBillingEffect(rows, 1n, 3n, [1n, 2n]), 40n)
})

test("an unbilled, split or out-of-scope batch is no billing effect", () => {
  assert.equal(resolveTimesheetBillingEffect([sheet(1n)], 1n, 3n, [1n]), null)
  assert.equal(resolveTimesheetBillingEffect([sheet(1n, { timesheetInvoiceId: { none: [] } })], 1n, 3n, [1n]), null)
  assert.equal(resolveTimesheetBillingEffect([sheet(1n, { timesheetInvoiceId: 40n }), sheet(2n)], 1n, 3n, [1n, 2n]), null)
  assert.equal(resolveTimesheetBillingEffect([sheet(1n, { timesheetInvoiceId: 40n }), sheet(2n, { timesheetInvoiceId: 41n })], 1n, 3n, [1n, 2n]), null)
  assert.equal(resolveTimesheetBillingEffect([sheet(1n, { timesheetInvoiceId: 40n })], 2n, 3n, [1n]), null)
  assert.equal(resolveTimesheetBillingEffect([sheet(1n, { timesheetInvoiceId: 40n })], 1n, 3n, []), null)
})
