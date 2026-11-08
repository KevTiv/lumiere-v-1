import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { runInNewContext } from "node:vm"
import ts from "typescript"
import { stdbBffCommandPost } from "@lumiere/stdb/commands"
import { toCreateAiChatSessionParams } from "@lumiere/erp-shared/ai-create-params"
import { stdbParamsToJson } from "@lumiere/erp-shared/stdb-params-json"
import type {
  useAppendAiChatMessage,
  useCreateAiChatSession,
} from "./ai-memory"

type CreateSessionInput = Parameters<
  ReturnType<typeof useCreateAiChatSession>["mutateAsync"]
>[0]
type AppendMessageInput = Parameters<
  ReturnType<typeof useAppendAiChatMessage>["mutateAsync"]
>[0]
type Mutation<T> = { mutationFn(params: T): Promise<void> }

function fixture() {
  const requests: { path: string; body: unknown }[] = []
  const dependencies = {
    "@lumiere/stdb/commands": { stdbBffCommandPost },
    "@lumiere/erp-shared/ai-create-params": { toCreateAiChatSessionParams },
    "@lumiere/erp-shared/stdb-params-json": { stdbParamsToJson },
    "@lumiere/i18n": { i18n: { t: (key: string) => key } },
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
    readFileSync(new URL("./ai-memory.ts", import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText
  const module = {
    exports: {} as {
      useCreateAiChatSession(
        organizationId: number,
        companyId: number | null,
      ): Mutation<CreateSessionInput>
      useAppendAiChatMessage(
        organizationId: number,
        companyId: number | null,
      ): Mutation<AppendMessageInput>
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
    create: module.exports.useCreateAiChatSession(7, 42).mutationFn,
    append: module.exports.useAppendAiChatMessage(7, 42).mutationFn,
  }
}

test("chat creation sends present context as SATS options through the immutable operation", async () => {
  const f = fixture()
  await f.create({
    session_key: "chat-1",
    title: "Chat check",
    route: "/ai-skills",
    module: "ai-skills",
    active_tab: "overview",
    metadata: '{"origin":"chat"}',
  })
  assert.deepEqual(f.requests, [
    {
      path: "/api/operations/erp.create_ai_chat_session",
      body: {
        companyId: 42,
        params: {
          session_key: "chat-1",
          title: { some: "Chat check" },
          route: { some: "/ai-skills" },
          module: { some: "ai-skills" },
          active_tab: { some: "overview" },
          archived: false,
          metadata: { some: '{"origin":"chat"}' },
        },
      },
    },
  ])
})

test("chat creation explicitly sends None for omitted, null and empty context", async () => {
  for (const absent of [undefined, null, " "]) {
    const f = fixture()
    await f.create({
      session_key: "chat-1",
      title: absent,
      route: absent,
      module: absent,
      active_tab: absent,
      metadata: absent,
    })
    assert.deepEqual(f.requests[0]?.body, {
      companyId: 42,
      params: {
        session_key: "chat-1",
        title: { none: [] },
        route: { none: [] },
        module: { none: [] },
        active_tab: { none: [] },
        archived: false,
        metadata: { none: [] },
      },
    })
  }
})

test("chat messages preserve present options and zero duration through the immutable operation", async () => {
  for (const duration_ms of [0, 250]) {
    const f = fixture()
    await f.append({
      session_key: "chat-1",
      role: "assistant",
      content: "Ready",
      sources_json: "[]",
      ui_context_json: '{"module":"ai-skills"}',
      model: "test-model",
      duration_ms,
      metadata: "{}",
    })
    assert.deepEqual(f.requests, [
      {
        path: "/api/operations/erp.append_ai_chat_message",
        body: {
          companyId: 42,
          params: {
            session_key: "chat-1",
            role: "assistant",
            content: "Ready",
            sources_json: { some: "[]" },
            ui_context_json: { some: '{"module":"ai-skills"}' },
            model: { some: "test-model" },
            duration_ms: { some: duration_ms },
            status: "completed",
            metadata: { some: "{}" },
          },
        },
      },
    ])
  }
})

test("chat messages explicitly send None for omitted and null optional fields", async () => {
  for (const absent of [undefined, null]) {
    const f = fixture()
    await f.append({
      session_key: "chat-1",
      role: "user",
      content: "Hello",
      sources_json: absent,
      ui_context_json: absent,
      model: absent,
      duration_ms: absent,
      metadata: absent,
    })
    assert.deepEqual(f.requests[0]?.body, {
      companyId: 42,
      params: {
        session_key: "chat-1",
        role: "user",
        content: "Hello",
        sources_json: { none: [] },
        ui_context_json: { none: [] },
        model: { none: [] },
        duration_ms: { none: [] },
        status: "completed",
        metadata: { none: [] },
      },
    })
  }
})
