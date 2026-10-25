import assert from "node:assert/strict"
import test from "node:test"

import {
  buildTaskAssignmentCommand,
  resolveTaskAssignmentEffect,
  taskAssigneeIds,
  taskAssigneeOptions,
  taskIdentityHex,
} from "./task-assignment"

const ada = "a".repeat(64)
const bob = "b".repeat(64)
const task = { id: "9007199254740993", organizationId: "7", companyId: "12", userIds: [ada, bob] }

test("task assignment preserves u64 identifiers and encodes actual identities", () => {
  const command = buildTaskAssignmentCommand(task.id, [`0x${ada.toUpperCase()}`, bob])
  assert.equal(command.urlPath, "/api/operations/erp.assign_task_users")
  assert.deepEqual(JSON.parse(String(command.init.body)), {
    taskId: task.id,
    userIds: [{ __identity__: `0x${ada}` }, { __identity__: `0x${bob}` }],
  })
  assert.equal(taskIdentityHex({ toHex: () => ada }), ada)
  assert.equal(taskIdentityHex({ __identity__: `0x${bob}` }), bob)
})

test("task assignment rejects invalid and duplicate recipients before dispatch", () => {
  for (const value of ["42", "not-an-identity", "a".repeat(63), 42, null, {}]) {
    assert.throws(() => taskAssigneeIds([value]), /valid task assignee/)
  }
  assert.throws(() => taskAssigneeIds([ada, `0x${ada.toUpperCase()}`]), /duplicates/)
  assert.throws(() => buildTaskAssignmentCommand(0, []), /Select a task/)
})

test("assignment readback proves the exact task, company and complete set", () => {
  const ref = { resource: "tasks", id: task.id }
  assert.deepEqual(resolveTaskAssignmentEffect([task], 7n, 12n, BigInt(task.id), [bob, ada]), ref)
  assert.deepEqual(resolveTaskAssignmentEffect([{ ...task, userIds: [{ __identity__: `0x${ada}` }, { toHex: () => bob }] }], 7n, 12n, BigInt(task.id), [ada, bob]), ref)
  assert.equal(resolveTaskAssignmentEffect([task], 8n, 12n, BigInt(task.id), [ada, bob]), null)
  assert.equal(resolveTaskAssignmentEffect([task], 7n, 13n, BigInt(task.id), [ada, bob]), null)
  assert.equal(resolveTaskAssignmentEffect([task], 7n, 12n, 1n, [ada, bob]), null)
  assert.equal(resolveTaskAssignmentEffect([task], 7n, 12n, BigInt(task.id), [ada]), null)
  assert.equal(resolveTaskAssignmentEffect([{ ...task, userIds: [ada, ada] }], 7n, 12n, BigInt(task.id), [ada, bob]), null)
  assert.throws(() => resolveTaskAssignmentEffect([task, task], 7n, 12n, BigInt(task.id), [ada, bob]), /Expected one canonical row/)
})

test("intentional clear requires authoritative empty assignment and never accepts missing fields", () => {
  assert.deepEqual(JSON.parse(String(buildTaskAssignmentCommand(task.id, []).init.body)).userIds, [])
  assert.deepEqual(resolveTaskAssignmentEffect([{ ...task, userIds: [] }], 7n, 12n, BigInt(task.id), []), { resource: "tasks", id: task.id })
  assert.equal(resolveTaskAssignmentEffect([{ id: task.id, organizationId: "7", companyId: "12" }], 7n, 12n, BigInt(task.id), []), null)
  assert.equal(resolveTaskAssignmentEffect([task], 7n, 12n, BigInt(task.id), []), null)
})

test("assignment directory decodes minimal server-authorized options and rejects corruption", () => {
  assert.deepEqual(taskAssigneeOptions([{ id: bob, name: " Bob " }, { id: ada, name: "" }]), [
    { id: ada, name: "aaaaaaaa…" }, { id: bob, name: "Bob" },
  ])
  assert.throws(() => taskAssigneeOptions([{ id: 1, name: "Invalid" }]), /Invalid task assignment directory/)
  assert.throws(() => taskAssigneeOptions([{ id: ada }, { id: `0x${ada}` }]), /Invalid task assignment directory/)
})
