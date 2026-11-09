import assert from "node:assert/strict"
import test from "node:test"
import { chatAgentOptions, type ChatAgentRow } from "./chat-agent-options"

const agent: ChatAgentRow = {
  id: 12n,
  companyId: 7n,
  name: "Assistant",
  model: "approved",
  isActive: true,
  allowedActions: ["chat"],
  allowedModels: ["approved"],
}

test("default and field-restricted agent projections cannot crash the shell or imply chat access", () => {
  for (const changes of [
    { allowedActions: undefined },
    { allowedModels: undefined },
    { companyId: undefined },
    { isActive: undefined },
    { model: undefined },
  ])
    assert.deepEqual(chatAgentOptions([{ ...agent, ...changes }], 7), [])
  assert.deepEqual(
    chatAgentOptions([{ id: 12n, companyId: 7n, isActive: true }], 7),
    [],
  )
})

test("chat choices require active company-scoped or explicitly organization-wide agents", () => {
  assert.deepEqual(chatAgentOptions([agent], 7), [
    { value: "12", label: "Assistant" },
  ])
  assert.deepEqual(chatAgentOptions([{ ...agent, companyId: null }], 7), [
    { value: "12", label: "Assistant" },
  ])
  for (const changes of [
    { companyId: 8n },
    { isActive: false },
    { allowedActions: [] },
    { allowedModels: ["other"] },
    { id: 9007199254740993n },
  ])
    assert.deepEqual(chatAgentOptions([{ ...agent, ...changes }], 7), [])
  assert.deepEqual(chatAgentOptions([agent], null), [])
  assert.equal(chatAgentOptions([{ ...agent, allowedModels: [] }], 7).length, 1)
})
