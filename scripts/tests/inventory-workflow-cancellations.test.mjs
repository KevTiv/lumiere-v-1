import assert from "node:assert/strict"
import test from "node:test"

import {
  inventoryConfiguration,
  inventoryWorkflowCancellations,
  parseSqlJson,
} from "../inventory-workflow-cancellations.mjs"

const instanceColumns = ["id", "organization_id", "company_id", "workflow_version_id", "state", "revision"]
const taskColumns = ["id", "organization_id", "company_id", "workflow_version_id", "workflow_instance_id", "status", "revision"]
const environment = { STDB_HOST: "http://127.0.0.1:3000", STDB_MODULE: "fixture", STDB_SERVER_TOKEN: "fixture-token" }
const configuration = () => inventoryConfiguration(environment, ["1", "2"])
const instance = (id = "9007199254740993", state = "Cancelled") => [id, "1", "2", "8", state, "4"]
const task = (id, status = "Open") => [id, "1", "2", "8", "9007199254740993", status, "2"]

function response(columns, rows) {
  return new Response(JSON.stringify([{
    schema: { elements: columns.map((name) => ({ name: { some: name } })) },
    rows,
  }]), { status: 200 })
}

function observer(instances, tasks, onRead = () => {}) {
  return async (url, request) => {
    onRead(url, request)
    return request.body.includes("FROM workflow_instance ")
      ? response(instanceColumns, instances)
      : response(taskColumns, tasks)
  }
}

test("inventory preserves exact u64 values and emits only active legacy projections", async () => {
  const ids = parseSqlJson("[9007199254740993,18446744073709551615]")
  assert.deepEqual(ids, ["9007199254740993", "18446744073709551615"])
  const rows = [task(ids[0]), task(ids[1], [1, []]), task("3", "Approved"), task("4", "Cancelled")]
  const report = await inventoryWorkflowCancellations(configuration(), observer([instance()], rows))
  assert.equal(report.status, "repair_required")
  assert.deepEqual(report.findings, [
    { instanceId: ids[0], instanceRevision: "4", taskId: ids[0], taskRevision: "2", taskStatus: "Open" },
    { instanceId: ids[0], instanceRevision: "4", taskId: ids[1], taskRevision: "2", taskStatus: "Claimed" },
  ])
  assert.equal(JSON.stringify(report).includes(environment.STDB_SERVER_TOKEN), false)
})

test("all requests are fixed scoped SELECT projections with no payload or identity fields", async () => {
  let calls = 0
  const report = await inventoryWorkflowCancellations(configuration(), observer([instance()], [task("3", "Cancelled")], (url, request) => {
    calls++
    assert.equal(url, "http://127.0.0.1:3000/v1/database/fixture/sql")
    assert.equal(request.method, "POST")
    assert.equal(request.redirect, "error")
    assert.match(request.body, /^SELECT [a-z_, ]+ FROM workflow_(instance|human_task) WHERE organization_id = 1 AND company_id = 2$/)
    assert.doesNotMatch(request.body, /\*|comment|payload|identity|requested_by|LIMIT|;/i)
  }))
  assert.equal(calls, 4)
  assert.equal(report.status, "clean")
  assert.deepEqual(report.observed, { instances: 1, tasks: 1 })
})

test("migrated instances retain terminal task history from earlier versions", async () => {
  const historical = ["Approved", "Completed", "Rejected", "Invalidated", "Cancelled"].map((status, index) => {
    const row = task(String(index + 1), status)
    row[3] = "7"
    return row
  })
  const clean = await inventoryWorkflowCancellations(configuration(), observer([instance()], historical))
  assert.equal(clean.status, "clean")
  const report = await inventoryWorkflowCancellations(configuration(), observer([instance()], [...historical, task("6")]))
  assert.equal(report.status, "repair_required")
  assert.deepEqual(report.findings, [
    { instanceId: "9007199254740993", instanceRevision: "4", taskId: "6", taskRevision: "2", taskStatus: "Open" },
  ])
})

test("inventory configuration rejects unsafe origins and non-decimal identifiers", () => {
  for (const host of ["http://example.test", "https://user:password@example.test", "https://example.test/path", "https://example.test?token=secret"]) {
    assert.throws(() => inventoryConfiguration({ ...environment, STDB_HOST: host }, ["1", "2"]))
  }
  for (const id of ["1; DELETE FROM workflow_instance", "1e2", "01", "-1", "0", "18446744073709551616"]) {
    assert.throws(() => inventoryConfiguration(environment, [id, "2"]))
  }
  const config = inventoryConfiguration(environment, ["18446744073709551615", "2"])
  assert.equal(config.organizationId, "18446744073709551615")
  assert.throws(() => inventoryConfiguration({ ...environment, STDB_MODULE: "fixture/other" }, ["1", "2"]))
})

test("foreign rows, duplicate identities, missing parents, active version mismatches and unknown statuses fail closed", async () => {
  for (const [instances, tasks] of [
    [[instance()], [["3", "99", "2", "8", "9007199254740993", "Open", "1"]]],
    [[instance()], [task("3"), task("3")]],
    [[], [task("3")]],
    [[instance()], [["3", "1", "2", "99", "9007199254740993", "Open", "1"]]],
    [[instance()], [task("3", "Unknown")]],
    [[instance()], [task("3", { Cancelled: { unexpected: "Open" } })]],
    [[instance()], [task("3.5")]],
  ]) {
    await assert.rejects(inventoryWorkflowCancellations(configuration(), observer(instances, tasks)))
  }
})

test("a concurrent revision change prevents a clean result", async () => {
  let reads = 0
  const fetch_ = observer([instance()], [task("3", "Cancelled")])
  await assert.rejects(inventoryWorkflowCancellations(configuration(), async (url, request) => {
    reads++
    if (reads === 4) return response(taskColumns, [["3", "1", "2", "8", "9007199254740993", "Cancelled", "3"]])
    return fetch_(url, request)
  }), /changed during inventory/)
})

test("oversized complete reads never silently truncate or report clean", async () => {
  const tooMany = Array.from({ length: 10_001 }, (_, index) => instance(String(index + 1), "Completed"))
  await assert.rejects(inventoryWorkflowCancellations(configuration(), observer(tooMany, [])), /complete inventory exceeds/)
  await assert.rejects(inventoryWorkflowCancellations(configuration(), async () => new Response(" ".repeat(4 * 1024 * 1024 + 1))), /bounded inventory size/)
})

test("denied private SQL reads fail without echoing the response body", async () => {
  await assert.rejects(inventoryWorkflowCancellations(configuration(), async () => new Response("private-secret", { status: 403 })), (error) => {
    assert.match(error.message, /403/)
    assert.doesNotMatch(error.message, /private-secret/)
    return true
  })
  await assert.rejects(inventoryWorkflowCancellations(configuration(), async () => new Response("private-secret")), (error) => {
    assert.doesNotMatch(error.message, /private-secret/)
    return true
  })
  await assert.rejects(inventoryWorkflowCancellations(configuration(), async () => { throw new Error("private-token") }), (error) => {
    assert.doesNotMatch(error.message, /private-token/)
    return true
  })
})
