import assert from "node:assert/strict"
import test from "node:test"
import { createLumiereApiClient, registerLumiereApiClient } from "@lumiere/api-client"
import { HttpResponseError } from "@lumiere/api-client/response-error"
import { agentRunCanBeCancelled, aiAgentRunsQueryOptions } from "./ai-agent-runs"

test("agent run reads use the selected company in the request and cache", async (context) => {
  registerLumiereApiClient(createLumiereApiClient({ baseUrl: "http://erp.test" }))
  context.after(() => registerLumiereApiClient(null))
  const fetch = context.mock.method(globalThis, "fetch", async (_input: string | URL | Request) => Response.json({
    data: [
      { id: "9007199254740993", companyId: 13, runKey: "reconcile", status: "running", stepCount: 2 },
      { id: 2, company_id: "13", run_key: "report", status: "completed", step_count: 1 },
    ],
  }))
  const query = aiAgentRunsQueryOptions(8, 13, "alice")
  assert.equal(query.enabled, true)
  assert.notDeepEqual(query.queryKey, aiAgentRunsQueryOptions(8, 12, "alice").queryKey)
  assert.notDeepEqual(query.queryKey, aiAgentRunsQueryOptions(8, 13, "bob").queryKey)
  assert.deepEqual((await query.queryFn()).map(run => [run.id, run.companyId, run.runKey, run.stepCount]), [
    ["9007199254740993", 13, "reconcile", 2],
    ["2", 13, "report", 1],
  ])
  assert.equal(fetch.mock.calls[0].arguments[0], "http://erp.test/api/query/ai-agent-runs?companyId=13")
  assert.equal(aiAgentRunsQueryOptions(8, null, "alice").enabled, false)
})

test("denied, mismatched and malformed run responses cannot become empty lists", async (context) => {
  registerLumiereApiClient(createLumiereApiClient({ baseUrl: "http://erp.test" }))
  context.after(() => registerLumiereApiClient(null))
  const fetch = context.mock.method(globalThis, "fetch", async () => Response.json({ error: "Denied" }, { status: 403 }))
  const { queryFn } = aiAgentRunsQueryOptions(8, 13, "alice")
  await assert.rejects(queryFn(), (error) => error instanceof HttpResponseError && error.status === 403)
  fetch.mock.mockImplementation(async () => Response.json({ data: [{ id: 2, companyId: 12, runKey: "other", status: "running" }] }))
  await assert.rejects(queryFn(), /could not be verified/)
  fetch.mock.mockImplementation(async () => Response.json({ results: [] }))
  await assert.rejects(queryFn(), /must contain only data/)
  fetch.mock.mockImplementation(async () => Response.json({ data: [] }))
  assert.deepEqual(await queryFn(), [])
})

test("only states accepted by the cancellation reducer offer a cancel action", () => {
  for (const status of ["pending", "running", "awaiting_approval", "waiting_input", "interrupted", "agent_settled"]) {
    assert.equal(agentRunCanBeCancelled(status), true, status)
  }
  for (const status of ["cancelled", "completed", "failed", "budget_parked", "unknown"]) {
    assert.equal(agentRunCanBeCancelled(status), false, status)
  }
})
