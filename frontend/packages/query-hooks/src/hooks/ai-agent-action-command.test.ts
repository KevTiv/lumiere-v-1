import assert from "node:assert/strict"
import { afterEach, beforeEach, test } from "node:test"
import {
  createLumiereApiClient,
  registerLumiereApiClient,
} from "@lumiere/api-client"
import { dispatchAiAgentActionCommand } from "../operations/ai-agent-action-command"

beforeEach(() =>
  registerLumiereApiClient(
    createLumiereApiClient({
      baseUrl: "http://api.test",
      credentials: "omit",
    }),
  ),
)
afterEach(() => registerLumiereApiClient(null))

test("action toggles send only one binding, without replacing private agent configuration", async (context) => {
  const calls = context.mock.method(
    globalThis,
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      assert.equal(
        String(input),
        "http://api.test/api/operations/erp.set_ai_agent_action",
      )
      assert.equal(init?.method, "POST")
      assert.deepEqual(JSON.parse(String(init?.body)), {
        agentId: 12,
        action: "chat",
        enabled: true,
      })
      return Response.json({ ok: true })
    },
  )
  await dispatchAiAgentActionCommand({
    agentId: 12,
    action: "chat",
    enabled: true,
  })
  assert.equal(calls.mock.callCount(), 1)
})

test("a rejected toggle is surfaced without retrying the write", async (context) => {
  const calls = context.mock.method(globalThis, "fetch", async () =>
    Response.json({ error: "Permission denied" }, { status: 403 }),
  )
  await assert.rejects(
    dispatchAiAgentActionCommand({
      agentId: 12,
      action: "chat",
      enabled: false,
    }),
    /Permission denied/,
  )
  assert.equal(calls.mock.callCount(), 1)
})
