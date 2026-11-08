import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { runInNewContext } from "node:vm"
import ts from "typescript"
import { stdbBffCommandPost } from "@lumiere/stdb/commands"
import { toCreateAiAgentParams } from "@lumiere/erp-shared/ai-create-params"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"
import type { useCreateAiAgent, useUpdateAiAgent } from "./ai-agents"

type CreateAgentInput = Parameters<
  ReturnType<typeof useCreateAiAgent>["mutateAsync"]
>[0]
type UpdateAgentInput = Parameters<
  ReturnType<typeof useUpdateAiAgent>["mutateAsync"]
>[0]
type Mutation<T> = { mutationFn(params: T): Promise<void> }

function fixture() {
  const requests: { path: string; body: unknown }[] = []
  const dependencies = {
    "@lumiere/stdb/commands": { stdbBffCommandPost },
    "@lumiere/erp-shared/stdb-params-json": { stdbParamsToJson },
    "@tanstack/react-query": {
      useMutation: (options: unknown) => options,
      useQueryClient: () => ({}),
    },
    "@lumiere/api-client/response-error": {},
    "../http": {
      apiFetch: async (path: string, init: RequestInit) => {
        requests.push({ path, body: JSON.parse(String(init.body)) })
        return new Response(null, { status: 200 })
      },
    },
  }
  const compiled = ts.transpileModule(
    readFileSync(new URL("./ai-agents.ts", import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText
  const module = {
    exports: {} as {
      useCreateAiAgent(organizationId: number): Mutation<CreateAgentInput>
      useUpdateAiAgent(organizationId: number): Mutation<UpdateAgentInput>
    },
  }
  runInNewContext(compiled, {
    module,
    exports: module.exports,
    require: (name: string) => {
      assert.ok(
        Object.hasOwn(dependencies, name),
        `Unexpected dependency ${name}`,
      )
      return dependencies[name as keyof typeof dependencies]
    },
  })
  return {
    requests,
    create: module.exports.useCreateAiAgent(7).mutationFn,
    update: module.exports.useUpdateAiAgent(7).mutationFn,
  }
}

const createForm = {
  name: "Chat agent",
  model: "test-model",
  provider: "test-provider",
  isDefault: true,
}

const createRequiredBody = {
  name: "Chat agent",
  model: "test-model",
  provider: "test-provider",
  temperature: 0.7,
  max_tokens: 4096,
  rate_limit_per_minute: 60,
  cost_per_1k_tokens: 0,
  context_window: 128000,
  top_p: 1,
  frequency_penalty: 0,
  presence_penalty: 0,
  is_active: true,
  is_default: true,
  allowed_models: [],
  allowed_actions: [],
}

test("agent creation sends optional settings and zero budget through the immutable operation", async () => {
  const f = fixture()
  const params = toCreateAiAgentParams({
    ...createForm,
    description: "Chat assistant",
    apiKeyReference: "test-provider-key-reference",
    systemPrompt: "Answer clearly",
    monthlyBudget: 0,
    metadata: "{}",
  })
  assert.ok(params)
  await f.create({ ...params })
  assert.deepEqual(f.requests, [
    {
      path: "/api/operations/erp.create_ai_agent",
      body: {
        companyId: null,
        params: {
          ...createRequiredBody,
          description: { some: "Chat assistant" },
          api_key_reference: { some: "test-provider-key-reference" },
          system_prompt: { some: "Answer clearly" },
          monthly_budget: { some: 0 },
          metadata: { some: "{}" },
        },
      },
    },
  ])
})

test("agent creation explicitly sends None for omitted and null settings", async () => {
  for (const absent of [undefined, null]) {
    const f = fixture()
    const params = toCreateAiAgentParams({
      ...createForm,
      description: absent,
      apiKeyReference: absent,
      systemPrompt: absent,
      monthlyBudget: absent,
      metadata: absent,
    })
    assert.ok(params)
    await f.create({ ...params })
    assert.deepEqual(f.requests[0]?.body, {
      companyId: null,
      params: {
        ...createRequiredBody,
        description: { none: [] },
        api_key_reference: { none: [] },
        system_prompt: { none: [] },
        monthly_budget: { none: [] },
        metadata: { none: [] },
      },
    })
  }
})

test("agent updates preserve optional settings, zeros and empty action lists", async () => {
  for (const allowedActions of [["analytics_read"], []]) {
    const f = fixture()
    await f.update({
      agentId: 42,
      params: {
        temperature: 0.7,
        maxTokens: 2048,
        rateLimitPerMinute: 60,
        contextWindow: 8192,
        topP: 1,
        frequencyPenalty: 0,
        presencePenalty: 0,
        systemPrompt: "Answer clearly",
        monthlyBudget: 0,
        allowedActions,
      },
    })
    assert.deepEqual(f.requests, [
      {
        path: "/api/operations/erp.update_ai_agent",
        body: {
          agentId: 42,
          params: {
            temperature: 0.7,
            max_tokens: 2048,
            rate_limit_per_minute: 60,
            context_window: { some: 8192 },
            top_p: { some: 1 },
            frequency_penalty: { some: 0 },
            presence_penalty: { some: 0 },
            system_prompt: { some: "Answer clearly" },
            monthly_budget: { some: 0 },
            allowed_actions: { some: allowedActions },
          },
        },
      },
    ])
  }
})

test("agent updates explicitly send None for omitted and null settings", async () => {
  for (const absent of [undefined, null]) {
    const f = fixture()
    await f.update({
      agentId: 42,
      params: {
        temperature: 0.7,
        maxTokens: 2048,
        rateLimitPerMinute: 60,
        contextWindow: absent,
        topP: absent,
        frequencyPenalty: absent,
        presencePenalty: absent,
        systemPrompt: absent,
        monthlyBudget: absent,
        allowedActions: absent,
      },
    })
    assert.deepEqual(f.requests[0]?.body, {
      agentId: 42,
      params: {
        temperature: 0.7,
        max_tokens: 2048,
        rate_limit_per_minute: 60,
        context_window: { none: [] },
        top_p: { none: [] },
        frequency_penalty: { none: [] },
        presence_penalty: { none: [] },
        system_prompt: { none: [] },
        monthly_budget: { none: [] },
        allowed_actions: { none: [] },
      },
    })
  }
})
