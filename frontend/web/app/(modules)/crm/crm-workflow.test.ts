import assert from "node:assert/strict"
import test from "node:test"
import { contactParentChange } from "./contact-parent-change"
import { latestCompanyForecast } from "./forecast-snapshot-model"
import { maxSegmentRules, savedSegmentRules, segmentRuleReplacement } from "./segment-rule-editor"
import {
  crmActivityQueues,
  crmActivityTarget,
  crmDealsNeedingAttention,
  crmWorkflowActions,
  type CrmActionContext,
} from "./crm-workflow"
import { toCreateActivityParams, toConvertLeadParams } from "../../../lib/crm-create-params"

const ready: CrmActionContext = {
  ready: true,
  canWrite: true,
  canCreateActivity: true,
  canConvertLead: true,
  busy: false,
  companyReady: true,
  stagesReady: true,
  wonStageReady: true,
  lostReasonsReady: true,
  orderSetupReady: true,
  activityTypesReady: true,
}
const now = new Date(2026, 9, 28, 15)
const micros = (date: Date) => BigInt(date.getTime()) * 1000n

test("a new lead can be qualified before conversion becomes available; terminal leads cannot be requalified", () => {
  assert.deepEqual(
    crmWorkflowActions("lead", { state: "new" }, ready).map((a) => a.id),
    ["qualify", "followUp", "edit"],
  )
  assert.deepEqual(
    crmWorkflowActions("lead", { state: { tag: "Qualified" } }, ready).map((a) => a.id),
    ["convertLead", "followUp", "edit"],
  )
  for (const state of ["converted", "lost", "won"])
    assert.deepEqual(
      crmWorkflowActions("lead", { state }, ready).map((a) => a.id),
      ["followUp", "edit"],
    )
})

test("record actions explain missing permission, sources, setup and save-in-progress", () => {
  for (const [patch, expected] of [
    [{ ready: false }, "sourceUnavailable"],
    [{ canWrite: false }, "permissionRequired"],
    [{ busy: true }, "saving"],
    [{ companyReady: false }, "companyRequired"],
    [{ canConvertLead: false }, "conversionPermissionRequired"],
    [{ stagesReady: false }, "stagesRequired"],
  ] as const)
    assert.equal(
      crmWorkflowActions("lead", { state: "qualified" }, { ...ready, ...patch })[0]?.reason,
      expected,
    )
  const actions = crmWorkflowActions(
    "opportunity",
    {},
    { ...ready, wonStageReady: false, lostReasonsReady: false },
  )
  assert.equal(actions.find((a) => a.id === "won")?.reason, "wonStageRequired")
  assert.equal(actions.find((a) => a.id === "lost")?.reason, "lostReasonRequired")
  assert.equal(actions.find((a) => a.id === "createOrder")?.reason, "customerRequired")
  assert.equal(
    crmWorkflowActions("opportunity", { partnerId: { none: [] } }, ready).find(
      (a) => a.id === "createOrder",
    )?.reason,
    "customerRequired",
  )
  assert.equal(
    crmWorkflowActions("contact", {}, { ...ready, canWrite: false })[0]?.reason,
    undefined,
    "activity create permission is independent of editing a contact",
  )
})

test("won and lost deals offer only valid next steps", () => {
  assert.deepEqual(
    crmWorkflowActions("opportunity", { isWon: true, partnerId: 2 }, ready).map((a) => a.id),
    ["createOrder", "followUp", "edit"],
  )
  assert.deepEqual(
    crmWorkflowActions("opportunity", { isLost: true }, ready).map((a) => a.id),
    ["followUp", "edit"],
  )
})

test("personal activity queues respect ownership, CRM targets, deletion and calendar-day boundaries", () => {
  const base = { assignedTo: "ab12", resModel: "lead", resId: 7 }
  const queues = crmActivityQueues(
    [
      { ...base, id: 1, dateDeadline: micros(new Date(2026, 9, 27)) },
      { ...base, id: 2, dateDeadline: micros(new Date(2026, 9, 28)) },
      { ...base, id: 3, dateDeadline: micros(new Date(2026, 9, 29)) },
      { ...base, id: 4 },
      { ...base, id: 5, is_done: true },
      { ...base, id: 6, assignedTo: "other" },
      { ...base, id: 7, resModel: "sale_order" },
      { ...base, id: 8, deletedAt: micros(new Date(2026, 9, 26)) },
    ],
    "ab12",
    now,
  )
  assert.deepEqual(
    queues.overdue.map((r) => r.id),
    [1],
  )
  assert.deepEqual(
    queues.today.map((r) => r.id),
    [2],
  )
  assert.deepEqual(
    queues.upcoming.map((r) => r.id),
    [3, 4],
  )
  assert.deepEqual(crmActivityQueues([], undefined, now), { overdue: [], today: [], upcoming: [] })
  assert.deepEqual(crmActivityTarget({ resModel: { some: "opportunity" }, resId: { some: 22n } }), {
    kind: "opportunity",
    id: "22",
  })
})

test("deal attention includes only my live deals in the selected company, without trusting completed follow-ups", () => {
  const base = { userId: "ab12", companyId: 3 }
  const deals = crmDealsNeedingAttention(
    [
      { ...base, id: 1 },
      { ...base, id: 2 },
      { ...base, id: 3, isWon: true },
      { ...base, id: 4, userId: "other" },
      { ...base, id: 5, companyId: 4 },
      { ...base, id: 6, dateDeadline: micros(new Date(2026, 9, 27)) },
    ],
    [
      { resModel: "opportunity", resId: 1, isDone: true },
      { resModel: "opportunity", resId: 2 },
      { resModel: "opportunity", resId: 6 },
    ],
    "ab12",
    now,
    3n,
  )
  assert.deepEqual(
    deals.map((r) => r.id),
    [6, 1],
  )
  assert.deepEqual(crmDealsNeedingAttention([{ ...base, id: 1 }], [], undefined, now, 3n), [])
})

test("follow-up submission uses the configured activity type and typed CRM target", () => {
  const params = toCreateActivityParams({
    summary: "Call Jane",
    activityTypeId: "4",
    dateDeadline: "2026-10-29",
    resModel: "lead",
    resId: "7",
  })
  assert.equal(params?.activityTypeId, 4n)
  assert.deepEqual(params?.target, { tag: "Lead", value: 7n })
  assert.equal(
    toCreateActivityParams({
      summary: "Call Jane",
      activityType: "call",
      dateDeadline: "2026-10-29",
    }),
    null,
  )
  assert.equal(toConvertLeadParams({ createContact: false, createOpportunity: false }), null)
  assert.equal(toConvertLeadParams({ createOpportunity: true, opportunityStageId: "0" }), null)
  assert.equal(
    toConvertLeadParams({ createContact: true, createOpportunity: false })?.opportunityStageId,
    undefined,
  )
})

test("the contact parent changes only on an explicit different selection", () => {
  assert.equal(contactParentChange(7n), undefined)
  assert.equal(contactParentChange(7n, "7"), undefined)
  assert.equal(contactParentChange(null, "none"), undefined)
  assert.equal(contactParentChange(7n, "none"), null)
  assert.equal(contactParentChange(7n, "9007199254740993"), 9007199254740993n)
  assert.equal(contactParentChange(7n, "18446744073709551616"), undefined)
  assert.equal(contactParentChange(7n, ""), undefined)
})

test("segment editor uses current rules in saved order and writes the exact reviewed replacement", () => {
  const rows = [
    { id: "19", segmentId: "5", sequence: 2, field: "TagId", op: "Neq", valueId: { some: "9007199254740993" }, metadata: "reuse" },
    { id: "18", segmentId: "5", sequence: 1, field: { tag: "City" }, op: { tag: "Eq" }, valueText: "Kigali", metadata: "reuse" },
    { id: "20", segment_id: "7", sequence: 0, field: "CountryCode", op: "Eq", value_text: "NZ" },
  ]
  const current = savedSegmentRules(rows, 5n)
  assert.equal(current.canEdit, true)
  assert.equal(current.rules[0]?.value, "Kigali")
  assert.equal(savedSegmentRules([...rows].reverse(), 5n).fingerprint, current.fingerprint)
  assert.notEqual(savedSegmentRules(rows.filter(({ id }) => id !== "18"), 5n).fingerprint, current.fingerprint)
  assert.deepEqual(segmentRuleReplacement([...current.rules, { field: "IsCustomer", operator: "IsFalse", value: "" }], current.metadata), {
    replaceAll: true,
    metadata: "reuse",
    rules: [
      { field: { tag: "City" }, op: { tag: "Eq" }, valueText: "Kigali", valueId: undefined },
      { field: { tag: "TagId" }, op: { tag: "Neq" }, valueText: undefined, valueId: 9007199254740993n },
      { field: { tag: "IsCustomer" }, op: { tag: "IsFalse" }, valueText: undefined, valueId: undefined },
    ],
  })
})

test("segment rules with unavailable ownership or unsupported data cannot be safely replaced", () => {
  assert.equal(savedSegmentRules([{ id: 8, field: "City", op: "Eq" }], 5n).canEdit, false)
  assert.equal(savedSegmentRules([{ id: 8, segmentId: 5, field: "City", op: "IsTrue" }], 5n).canEdit, false)
  assert.equal(segmentRuleReplacement([{ field: "City", operator: "Eq", value: " " }]), null)
  assert.equal(segmentRuleReplacement([{ field: "TagId", operator: "Contains", value: "7" }]), null)
  assert.equal(segmentRuleReplacement(Array(maxSegmentRules + 1).fill({ field: "City", operator: "Eq", value: "Kigali" })), null)
})

test("forecast readback uses the latest saved snapshot in the current company", () => {
  const row = (id: bigint, companyId: bigint, createdAt: string) => ({ id, companyId, createdAt }) as unknown as Parameters<typeof latestCompanyForecast>[0][number]
  const rows = [
    row(90n, 2n, "2026-11-16T10:00:00Z"),
    row(81n, 1n, "2026-11-15T12:00:00Z"),
    row(83n, 1n, "2026-11-15T12:00:00Z"),
    row(82n, 1n, "2026-11-14T12:00:00Z"),
  ]
  assert.equal(latestCompanyForecast(rows, 1n)?.id, 83n)
  assert.equal(latestCompanyForecast(rows, 2n)?.id, 90n)
  assert.equal(latestCompanyForecast(rows, 3n), undefined)
})
