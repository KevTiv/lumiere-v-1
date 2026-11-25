import assert from "node:assert/strict"
import { test } from "node:test"
import { registerAssistantWebMcpTools, type WebMcpModelContext } from "./assistant-webmcp"

type Tool = Parameters<WebMcpModelContext["registerTool"]>[0]

const both = { canOpenInventoryRecord: true, canOpenImportReview: true }
const taskId = "0123456789abcdef0123456789abcdef"

function browserModelContext() {
  const tools = new Map<Tool["name"], Tool>()
  const modelContext: WebMcpModelContext = {
    registerTool(tool, { signal }) {
      assert.equal(tools.has(tool.name), false)
      tools.set(tool.name, tool)
      signal.addEventListener("abort", () => tools.delete(tool.name), { once: true })
    },
  }
  return { modelContext, tools }
}

test("only registers available tools and ignores browsers without model context", () => {
  assert.equal(registerAssistantWebMcpTools(undefined, both, async () => "opened"), undefined)
  const { modelContext, tools } = browserModelContext()
  const cleanup = registerAssistantWebMcpTools(modelContext, { ...both, canOpenImportReview: false }, async () => "opened")
  assert.deepEqual([...tools.keys()], ["open_inventory_record"])
  cleanup?.()
  assert.equal(tools.size, 0)
})

test("passes validated input to shared destinations and returns only presentation status", async () => {
  const { modelContext, tools } = browserModelContext()
  const calls: unknown[] = []
  const cleanup = registerAssistantWebMcpTools(modelContext, both, async destination => {
    calls.push(destination)
    return "requested"
  })
  const product = tools.get("open_inventory_record")!
  const importer = tools.get("open_import_review")!
  for (const invalid of [null, {}, [], { productId: 42 }, { productId: "0" }, { productId: "42", companyId: 4097 }]) {
    assert.deepEqual(await product.execute(invalid), { status: "invalid_input" })
  }
  assert.deepEqual(await importer.execute({ taskId: "../../imports" }), { status: "invalid_input" })
  assert.deepEqual(await product.execute({ productId: "42" }), { status: "requested" })
  assert.deepEqual(await importer.execute({ taskId }), { status: "requested" })
  assert.deepEqual(calls, [
    { kind: "open_inventory_record", productId: "42" },
    { kind: "open_import_review", taskId },
  ])
  cleanup?.()
  assert.deepEqual(await product.execute({ productId: "42" }), { status: "scope_changed" })
  assert.equal(calls.length, 2)
})

test("cancels dispatch on browser execution cancellation and registration cleanup", async () => {
  for (const cancellation of ["execution", "scope"] as const) {
    const { modelContext, tools } = browserModelContext()
    let dispatchSignal: AbortSignal | undefined
    const cleanup = registerAssistantWebMcpTools(modelContext, both, async (_destination, options) => {
      dispatchSignal = options?.signal
      assert.ok(dispatchSignal)
      await new Promise<void>(resolve => dispatchSignal?.addEventListener("abort", () => resolve(), { once: true }))
      return "cancelled"
    })
    const execution = new AbortController()
    const call = tools.get("open_import_review")!.execute({ taskId }, { signal: execution.signal })
    assert.equal(dispatchSignal?.aborted, false)
    if (cancellation === "execution") {
      execution.abort()
      assert.deepEqual(await call, { status: "cancelled" })
    } else {
      cleanup?.()
      assert.deepEqual(await call, { status: "scope_changed" })
    }
    assert.equal(dispatchSignal?.aborted, true)
    cleanup?.()
  }
})

test("isolates registration and execution failures", async () => {
  const { modelContext, tools } = browserModelContext()
  const cleanup = registerAssistantWebMcpTools({
    registerTool(tool, options) {
      if (tool.name === "open_import_review") return Promise.reject(new Error("Registration denied"))
      return modelContext.registerTool(tool, options)
    },
  }, both, async () => { throw new Error("Underlying response details") })
  assert.deepEqual([...tools.keys()], ["open_inventory_record"])
  assert.deepEqual(await tools.get("open_inventory_record")!.execute({ productId: "42" }), { status: "unavailable" })
  cleanup?.()
})
