#!/usr/bin/env node
/** Hosted CI acceptance through actual Next.js, API, Gateway, STDB and PostgreSQL. */
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { randomBytes, randomUUID } from "node:crypto"
import { appendFile, mkdir, open, readFile, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { setTimeout as delay } from "node:timers/promises"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const logs = join(root, ".tmp", "assistant-history")
const web = "http://127.0.0.1:3100"
const api = "http://127.0.0.1:8082"
const gateway = "http://127.0.0.1:8080"
const stdb = "http://127.0.0.1:3000"
const moduleName = "lumiere-v1-local-e2e"
const contextPath = "/v1/ai/chat/context"
const turns = 1_000
const concurrency = 4
const repeats = 5
const maxPageBytes = 512 * 1024
const MiB = 1024 * 1024
const marker = "Confirm Products mapping SKU-ALPHA-2026 before resuming."
const question = "Which catalog unit remains unresolved?"
const recentMarker = "PRODUCTS-RECENT-CATALOG-2026"
const memoryLimits = { stdb: 1536 * MiB, api: 768 * MiB, gateway: 768 * MiB, web: 1024 * MiB }
const active = new Map()
const groups = new Map()
const expectedStop = new WeakSet()
const unexpectedStops = []
const snapshots = []
const report = { turns, concurrency, repeats, services: {}, checkpoints: [], unexpectedStops, snapshots }
const none = { none: [] }
const some = (value) => ({ some: value })

function requireIsolatedRunner(env) {
  assert.equal(env.CI, "true", "Requires hosted CI")
  assert.equal(env.GITHUB_ACTIONS, "true", "Requires hosted CI")
  assert.match(env.GITHUB_SHA ?? "", /^[0-9a-f]{40}$/)
  for (const [name, value] of Object.entries({
    STDB_HOST: stdb,
    STDB_MODULE: moduleName,
    LUMIERE_API_SERVER_URL: api,
    LUMIERE_AI_GATEWAY_URL: gateway,
    PLAYWRIGHT_BASE_URL: web,
    PG_HOST: "127.0.0.1",
    PG_DATABASE: "lumiere",
    QDRANT_URL: "http://127.0.0.1:6334",
  })) assert.equal(env[name], value, `${name} must target the isolated fixture`)
}

function childExit(child) {
  return new Promise((accept, reject) => {
    child.once("error", reject)
    child.once("close", (code, signal) => accept({ code, signal }))
  })
}

function signal(child, name) {
  if (!child.pid) return
  try {
    process.kill(-child.pid, name)
  } catch (error) {
    if (error.code !== "ESRCH") throw error
  }
}

async function command(commandName, args, env, { capture = false, cwd = root, timeout = 180_000 } = {}) {
  const child = spawn(commandName, args, { cwd, env, stdio: ["ignore", capture ? "pipe" : "inherit", "inherit"], detached: true })
  const completion = childExit(child)
  let output = ""
  if (capture) child.stdout.on("data", (chunk) => { output += chunk })
  const timer = setTimeout(() => signal(child, "SIGKILL"), timeout)
  try {
    const result = await completion
    assert.equal(result.code, 0, `${commandName} failed (${result.code ?? result.signal})`)
    return output.trim()
  } finally {
    clearTimeout(timer)
  }
}

async function configureMemoryGroups(env) {
  const available = (await readFile("/sys/fs/cgroup/cgroup.subtree_control", "utf8")).trim().split(/\s+/)
  assert.ok(available.includes("memory"), "The runner must support cgroup v2 memory accounting")
  for (const [service, limit] of Object.entries(memoryLimits)) {
    const path = `/sys/fs/cgroup/lumiere-history-${process.pid}-${service}`
    await command("sudo", ["-n", "mkdir", path], env)
    groups.set(service, path)
    await command("sudo", ["-n", "bash", "-c", 'printf "%s\n" "$1" > "$2/memory.max"; printf "0\n" > "$2/memory.swap.max"', "limit", String(limit), path], env)
    report.services[service] = { limitBytes: limit }
  }
}

async function start(name, executable, args, env, cwd = root) {
  const log = await open(join(logs, `${name}.log`), "a", 0o600)
  const path = groups.get(name)
  const child = spawn("bash", [
    "-c",
    'sudo -n bash -c \'printf "%s\n" "$1" > "$2/cgroup.procs"\' attach "$$" "$1" && shift && exec "$@"',
    "service", path, executable, ...args,
  ], { cwd, env, detached: true, stdio: ["ignore", log.fd, log.fd] })
  active.set(name, child)
  child.once("error", () => { unexpectedStops.push({ service: name, error: "spawn" }) })
  child.once("exit", (code, signal) => {
    if (!expectedStop.has(child)) unexpectedStops.push({ service: name, code, signal })
  })
  await log.close()
  return child
}

async function stop(name) {
  const child = active.get(name)
  if (!child) return
  active.delete(name)
  if (child.exitCode !== null || child.signalCode !== null) return
  expectedStop.add(child)
  const completion = childExit(child)
  signal(child, "SIGTERM")
  const timer = setTimeout(() => signal(child, "SIGKILL"), 5000)
  try { await completion } finally { clearTimeout(timer) }
}

async function ready(base, path, method = "GET") {
  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    assert.deepEqual(unexpectedStops, [], "A service exited before readiness")
    try {
      const response = await fetch(base + path, { method, signal: AbortSignal.timeout(2000) })
      await response.body?.cancel()
      if (response.ok) return
    } catch {}
    await delay(500)
  }
  throw new Error(`Service readiness timed out at ${base}${path}`)
}

async function request(base, path, { actor, body, headers, method, expected = 200 } = {}) {
  const response = await fetch(base + path, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers: {
      ...(actor ? { Cookie: actor.cookie } : {}),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(25_000),
  })
  const text = await response.text()
  const statuses = Array.isArray(expected) ? expected : [expected]
  assert.ok(statuses.includes(response.status), `${path.split("?")[0]} returned ${response.status}; expected ${statuses.join(", ")}`)
  return { status: response.status, value: text ? JSON.parse(text) : null, bytes: Buffer.byteLength(text) }
}

async function login(email, password) {
  const response = await fetch(`${web}/api/auth/signin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
    signal: AbortSignal.timeout(25_000),
  })
  assert.equal(response.status, 200, "Native fixture authentication failed")
  const cookies = response.headers.getSetCookie().map((cookie) => cookie.split(";")[0])
  const fields = new Map(cookies.map((cookie) => [cookie.slice(0, cookie.indexOf("=")), cookie.slice(cookie.indexOf("=") + 1)]))
  assert.ok(fields.get("stdb_token") && fields.get("stdb_identity"), "Fixture login must establish a real actor")
  await response.body?.cancel()
  return { cookie: cookies.join("; "), token: fields.get("stdb_token"), identity: fields.get("stdb_identity") }
}

function operation(actor, name, body, expected = 200) {
  return request(web, `/api/operations/erp.${name}`, { actor, body, expected })
}

function query(actor, resource, params, expected = 200) {
  return request(web, `/api/query/${resource}?${new URLSearchParams(params)}`, { actor, expected })
}

function rowId(row) {
  return String(row.id)
}

async function createThread(actor, companyId, sessionKey, title, module = "products") {
  await operation(actor, "create_ai_chat_session", {
    companyId,
    params: { session_key: sessionKey, title: some(title), route: some(`/${module}`), module: some(module), active_tab: none, archived: false, metadata: none },
  })
}

async function seedThread(actor, companyId, sessionKey, count, mapping) {
  for (let turn = 1; turn <= count; turn++) {
    const turnId = randomUUID()
    for (const role of ["user", "assistant"]) {
      let prefix = `${sessionKey}-${role}-${turn}`
      if (role === "user" && turn <= 2) prefix = [marker, question][turn - 1]
      if (role === "assistant" && turn === count) prefix = recentMarker
      const content = prefix === question ? question : turn % 64 === 0 && role === "assistant"
        ? `${prefix}\n${"synthetic result and persisted file reference\n".repeat(375)}`
        : `${prefix}\nReviewed catalog rows and documented the result.`
      const params = {
        session_key: sessionKey,
        role,
        content,
        sources_json: none,
        ui_context_json: none,
        model: none,
        duration_ms: none,
        status: "completed",
        metadata: some(JSON.stringify({ turnId, ...(turn === 1 && role === "user" ? { historyRefs: [mapping] } : {}) })),
      }
      await operation(actor, "append_ai_chat_message", { companyId, params })
      if (turn === count && role === "assistant") {
        await operation(actor, "append_ai_chat_message", { companyId, params })
      }
    }
  }
}

async function seedAssistantAction(actor, companyId, sessionKey, { title, module, content, action, archived = false }) {
  const session = await request(api, "/v1/session/field-access", { actor })
  const organizationId = String(session.value.organizationId)
  const metadata = {
    nativeActions: [{
      version: 1,
      ...action,
      scope: { actorId: session.value.identityHex, organizationId, companyId: String(companyId) },
    }],
  }
  await createThread(actor, companyId, sessionKey, title, module)
  await operation(actor, "append_ai_chat_message", {
    companyId,
    params: {
      session_key: sessionKey,
      role: "assistant",
      content,
      sources_json: none,
      ui_context_json: none,
      model: none,
      duration_ms: none,
      status: "completed",
      metadata: some(JSON.stringify(metadata)),
    },
  })
  if (archived) await operation(actor, "archive_ai_chat_session", { companyId, sessionKey, archived: true })
}

async function seedWarehouseOutcome(actor, companyId, sessionKey) {
  const picks = (await query(actor, "stock-pickings", { companyId })).value.data
  const transfer = picks.find((row) => row.name === "WH/IN/SEED-0001" && String(row.companyId ?? row.company_id) === String(companyId))
  assert.ok(transfer, "The Warehouse acceptance fixture must contain its seeded transfer")
  const transferId = rowId(transfer)
  await seedAssistantAction(actor, companyId, sessionKey, {
    title: "Warehouse archived outcome",
    module: "warehouse",
    content: "Open the current Warehouse receipt.",
    action: { kind: "open_record", capabilityKey: "warehouse.transfer.open", recordId: transferId },
    archived: true,
  })
  return transferId
}

async function getContext(env, actor, companyId, sessionKey, expected = 200) {
  return request(api, contextPath, {
    headers: {
      Authorization: `Bearer ${actor.token}`,
      "x-stdb-identity": actor.identity,
      "x-lumiere-gateway-secret": env.LUMIERE_AI_GATEWAY_INTERNAL_SECRET,
    },
    body: { companyId, sessionKey, contextByteBudget: 16 * 1024 },
    expected,
  })
}

async function collectHistory(actor, companyId, sessionKey) {
  let cursor
  const ids = new Set()
  let firstMessage
  do {
    const { value, bytes } = await query(actor, "ai-chat-messages", {
      companyId, sessionKey, limit: "30", ...(cursor ? { cursor } : {}),
    })
    assert.ok(Array.isArray(value.data) && value.data.length > 0 && value.data.length <= 30)
    assert.ok(bytes <= maxPageBytes, "One transcript page exceeded its response budget")
    for (const message of value.data) {
      assert.ok(!ids.has(rowId(message)), "A retry or overlapping page duplicated a saved message")
      ids.add(rowId(message))
      if (message.content.startsWith(marker)) firstMessage = message
    }
    assert.notEqual(value.nextCursor ?? null, cursor, "Transcript cursor failed to advance")
    cursor = value.nextCursor ?? null
    assert.ok(ids.size <= turns * 2, "Transcript exceeded seeded turn count")
  } while (cursor)
  assert.equal(ids.size, turns * 2, "All original turns should still be readable")
  assert.ok(firstMessage, "Original source must stay available")
  const exact = await query(actor, "ai-chat-messages", { companyId, sessionKey, messageId: rowId(firstMessage) })
  assert.ok(exact.value.data.some((row) => rowId(row) === rowId(firstMessage)), "A message anchor must reopen its source")
  return rowId(firstMessage)
}

async function verifyDecisionRevisions(actor, reader, companyId, sessionKey, messageId) {
  const decisionId = randomBytes(16).toString("hex")
  const original = { companyId, sessionKey, messageId, decisionId,
    requestId: randomBytes(16).toString("hex"), expectedRevision: 0,
    note: "Map the product name using catalog revision one." }
  const save = (body, expected = 200) => request(web, "/api/ai/chat/decisions", { actor, body, expected })
  const first = (await save(original)).value
  assert.equal(first.reference.revision, 1)
  assert.deepEqual((await save(original)).value, first)
  await save({ ...original, note: "A retry cannot change this revision." }, 409)
  const latest = (await save({ ...original, requestId: randomBytes(16).toString("hex"), expectedRevision: 1, note: "Map the product name using catalog revision two." })).value
  assert.equal(latest.reference.revision, 2)
  const resolve = (actor, expected = 200) => request(web, "/api/ai/chat/references/resolve", {
    actor, body: { companyId, references: [first.reference] }, expected,
  })
  const resolved = (await resolve(actor)).value.references[0]
  assert.deepEqual(resolved.reference, first.reference)
  assert.equal(resolved.excerpt.note, original.note)
  assert.equal(resolved.excerpt.latestRevision, 2)
  await resolve(reader, [403, 404])
  report.decisionRevision = { attached: resolved.reference.revision, latest: resolved.excerpt.latestRevision }
}

async function verifyProductsMapping(actor, reader, companyId, sessionKey) {
  const taskId = randomBytes(16).toString("hex")
  const name = "History acceptance product"
  const csv = "name,internal_reference,sale_price,cost_price,uom_id,uom_po_id,category_id,active,can_be_sold,can_be_purchased\n"
    + `${name},HISTORY-FIXTURE,12.50,8.25,1,1,1,true,true,true\n`
  const task = (await request(web, "/api/import-tasks", {
    actor,
    body: { companyId, requestId: taskId, conversationKey: sessionKey,
      files: [{ fileName: "assistant-history-products.csv", contentBase64: Buffer.from(csv).toString("base64") }] },
  })).value
  assert.equal(task.status, "awaiting_decision")
  const prepared = (await request(web, `/api/import-tasks/${taskId}/decision`, {
    actor,
    body: { companyId, decisionId: randomBytes(16).toString("hex"), expectedRevision: 1, optionId: "prepare_import" },
  })).value
  const batch = prepared.reviews.find((row) => row.targetEntity === "product")
  assert.ok(batch, "The real CSV preparation must create an admitted Products review")
  const review = (await request(web, `/api/import-reviews/${batch.id}?companyId=${companyId}`, { actor })).value
  const item = review.items.find((row) => row.values.name === name)
  assert.ok(item, "The staged catalog must include the synthetic product")
  const confirm = (revision, values) => request(web, `/api/import-reviews/${batch.id}/items/${item.id}`, {
    actor, method: "PATCH",
    body: { companyId, expectedRevision: revision, requestKey: randomUUID(), state: "confirmed",
      reason: "Verified the synthetic catalog fields", values, confirmedFields: Object.keys(values) },
  })
  const first = (await confirm(item.revision, item.values)).value.item
  const latest = (await confirm(first.revision, { ...first.values, name: "Updated history acceptance product" })).value.item
  const reference = { kind: "import_mapping", sessionKey, taskId, batchId: batch.id, itemId: item.id, revision: first.revision }
  await operation(actor, "archive_ai_chat_session", { companyId, sessionKey, archived: true })
  const resolveMapping = (actor, expected = 200) => request(web, "/api/ai/chat/references/resolve", {
    actor, body: { companyId, references: [reference] }, expected,
  })
  const saved = (await resolveMapping(actor)).value.references[0]
  assert.deepEqual(saved.reference, reference)
  assert.equal(JSON.parse(saved.excerpt.confirmedValues).name, name, "Archived context must keep the exact confirmed Products revision")
  assert.equal(saved.excerpt.latestRevision, latest.revision)
  await resolveMapping(reader, [403, 404])
  await operation(actor, "archive_ai_chat_session", { companyId, sessionKey, archived: false })
  report.productsMapping = { attached: reference.revision, latest: saved.excerpt.latestRevision }
  return reference
}

async function snapshot(label) {
  const services = {}
  for (const [name, group] of groups) {
    const [current, peak, events] = await Promise.all(
      ["memory.current", "memory.peak", "memory.events"].map((file) => readFile(join(group, file), "utf8")),
    )
    const counters = Object.fromEntries(events.trim().split("\n").map((line) => {
      const [name, count] = line.split(" ")
      return [name, Number(count)]
    }))
    services[name] = { currentBytes: Number(current), peakBytes: Number(peak), oomKills: counters.oom_kill }
  }
  snapshots.push({ label, services })
}

async function measureOverload(env, actor, companyId, sessionKey) {
  const start = performance.now()
  const results = await Promise.all(Array.from({ length: 32 }, () =>
    getContext(env, actor, companyId, sessionKey, [200, 429, 503]),
  ))
  const rejected = results.filter(({ status, value }) => status === 429 || (status === 503 && /busy/i.test(value?.error)))
  assert.ok(rejected.length > 0, "Excess concurrent contexts must fail with a retryable busy response")
  assert.ok(results.some(({ status }) => status === 200), "Admitted work must make progress under load")
  const elapsedMs = Math.round(performance.now() - start)
  assert.ok(elapsedMs < 10_000, "Overload must return within the context deadline")
  report.overload = { requested: results.length, rejected: rejected.length, elapsedMs }
}

function assertMemoryBudget() {
  assert.deepEqual(unexpectedStops, [], "A service exited unexpectedly")
  const final = snapshots.at(-1).services
  const windows = snapshots.filter(({ label }) => label.startsWith("cycle-"))
  for (const [name, limit] of Object.entries(memoryLimits)) {
    assert.equal(final[name].oomKills, 0, `${name} recorded an OOM kill`)
    assert.ok(final[name].peakBytes > 0 && final[name].peakBytes <= limit * 0.8, `${name} exceeded 80% of its cgroup limit`)
    const warm = windows[1].services[name].currentBytes
    const tail = windows.slice(-2).map((window) => window.services[name].currentBytes)
    assert.ok(Math.min(...tail) <= warm + Math.max(64 * MiB, warm * 0.15), `${name} memory continued growing after warm-up`)
  }
}

async function startApiAndGateway(env) {
  await start("api", join(root, ".ci/e2e-build/bin/api-server"), [], { ...env, PORT: "8082" })
  await ready(api, "/health/ready")
  await start("gateway", join(root, "target/debug/gateway"), [], {
    ...env, PORT: "8080", EMBEDDING_PROVIDER: "disabled", VISION_PROVIDER: "disabled", WEB_SEARCH_PROVIDER: "disabled",
  })
  await ready(gateway, "/health/ready")
}

async function startWeb(env) {
  const webDir = join(root, "frontend/web")
  await start("web", "node", ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", "3100"], env, webDir)
  await ready(web, "/sign-in")
}

async function runBrowser(env, companyId, sessionKey, originalMessage, warehouseTransfer) {
  await command("pnpm", ["exec", "playwright", "test", "--config", "playwright.assistant-history.config.ts"], {
    ...env,
    ASSISTANT_HISTORY_COMPANY: String(companyId),
    ASSISTANT_HISTORY_SESSION: sessionKey,
    ASSISTANT_HISTORY_MESSAGE: originalMessage,
    ASSISTANT_HISTORY_WAREHOUSE_TRANSFER: warehouseTransfer,
  }, { cwd: join(root, "frontend/web"), timeout: 540_000 })
}

async function main() {
  requireIsolatedRunner(process.env)
  await mkdir(logs, { recursive: true })
  const password = "Password123$"
  const env = {
    ...process.env,
    LUMIERE_E2E: "1",
    E2E_PREBUILT: "1",
    E2E_STDB_HOST: stdb,
    NEXT_PUBLIC_STDB_HOST: stdb,
    NEXT_PUBLIC_STDB_MODULE: moduleName,
    NEXT_PUBLIC_DEV_ADMIN: "false",
    NEXT_PUBLIC_API_GATEWAY_URL: "",
    DEV_MOCK_ORG_ID: "",
    CORS_ORIGINS: web,
    STDB_CREDENTIAL_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
    LUMIERE_AI_GATEWAY_INTERNAL_SECRET: randomBytes(32).toString("hex"),
    STDB_TOKEN_PREFLIGHT_VERIFIED: "1",
    E2E_FIRST_ORG_PERSONA_PASSWORD: password,
  }
  delete env.NODE_ENV
  for (const [base, path] of [[web, "/sign-in"], [api, "/health"], [gateway, "/health"], [stdb, "/v1/identity"]]) {
    let occupied = false
    try { await fetch(base + path, { signal: AbortSignal.timeout(1000) }); occupied = true } catch {}
    assert.equal(occupied, false, `Fixture listener already in use: ${base}`)
  }
  await configureMemoryGroups(env)
  await start("stdb", "spacetime", ["start", "--listen-addr", "127.0.0.1:3000"], env)
  await ready(stdb, "/v1/identity", "POST")
  await command("node", ["scripts/e2e-local-stdb-token.mjs", "--login-only"], env)
  await command("spacetime", ["publish", moduleName, "--bin-path", "spacetimedb/target/wasm32-unknown-unknown/release/lumiere_v1.wasm", "--server", "local", "--no-config", "-y"], env)
  env.STDB_SERVER_TOKEN = await command("node", ["scripts/e2e-local-stdb-token.mjs"], env, { capture: true })
  assert.ok(env.STDB_SERVER_TOKEN, "Fixture needs its own STDB owner credential")
  env.STDB_TOKEN = env.STDB_SERVER_TOKEN
  await command("node", ["frontend/web/scripts/e2e-seed-fixture.mjs"], env)
  await command(join(root, ".ci/e2e-build/bin/storage-migrate"), [], env)
  await startApiAndGateway(env)
  await command("node", ["frontend/web/scripts/seed-test-user.mjs", "--all-personas"], env)
  await startWeb(env)

  const admin = await login("test@email.com", password)
  const reader = await login("fixture.reader@example.test", password)
  assert.notEqual(admin.token, env.STDB_SERVER_TOKEN)
  assert.notEqual(admin.identity, reader.identity)
  const companies = (await query(admin, "companies", {})).value.data
  const primary = companies.find((company) => company.code === "LTI")
  assert.ok(primary, "The seeded company must be present")
  const companyId = Number(primary.id)
  const sessionKey = `alpha-history-${randomBytes(6).toString("hex")}`
  await createThread(admin, companyId, sessionKey, "Products long-thread acceptance")
  const mapping = await verifyProductsMapping(admin, reader, companyId, sessionKey)
  const seedStarted = performance.now()
  await seedThread(admin, companyId, sessionKey, turns, mapping)
  report.seedMs = Math.round(performance.now() - seedStarted)
  const originalMessage = await collectHistory(admin, companyId, sessionKey)

  const newerWarehouseKey = `${sessionKey}-warehouse-unrelated`
  await createThread(admin, companyId, newerWarehouseKey, recentMarker, "warehouse")
  const matches = { companyId, module: "products", search: recentMarker }
  const found = await query(admin, "ai-chat-sessions", matches)
  assert.ok(found.value.data.some((row) => (row.sessionKey ?? row.session_key) === sessionKey))
  assert.ok(found.value.data.every((row) => (row.sessionKey ?? row.session_key) !== newerWarehouseKey))
  const denied = await query(reader, "ai-chat-messages", { companyId, sessionKey }, [200, 403, 404])
  assert.equal(denied.value?.data?.length ?? 0, 0, "Another actor must not read this transcript")
  await operation(reader, "archive_ai_chat_session", { companyId, sessionKey, archived: true }, [403, 404, 422])
  await getContext(env, reader, companyId, sessionKey, [403, 404])

  const first = (await getContext(env, admin, companyId, sessionKey)).value
  assert.equal(first.sessionKey, sessionKey)
  assert.equal(first.schemaVersion, 1)
  assert.ok(first.revision > 0, "A long thread must publish a checkpoint")
  assert.ok(JSON.stringify(first.summary).includes("SKU-ALPHA-2026"), "The original objective must enter the checkpoint")
  assert.ok(first.summary.questions.some(({ text }) => text === question), "The original question must survive compaction")
  assert.ok(first.historyRefs.some((ref) => ref.kind === mapping.kind && ref.taskId === mapping.taskId && ref.revision === mapping.revision),
    "The compacted context must carry the exact original Products mapping revision")
  assert.ok(first.recentTurns.length > 0 && first.recentTurns.length < 30, "Recent turns must be bounded")
  report.checkpoints.push({ revision: first.revision, coveredThrough: first.coveredThrough })
  let previousRevision = first.revision
  for (const path of ["/api/ai/rag", "/api/ai/rag/stream"]) {
    const result = await request(web, path, {
      actor: admin,
      body: { query: "Which mapping did we confirm?", companyId, chat_session_key: sessionKey },
      expected: [400, 404, 409, 422, 503],
    })
    assert.ok(
      ["ai_default_agent_not_provisioned", "ai_surface_skill_not_provisioned"].includes(result.value?.code),
      `The isolated Gateway must reach its model setup boundary after building context. ${path} returned ${result.status} (${result.value?.code ?? "no error code"}).`,
    )
    const checkpoint = (await getContext(env, admin, companyId, sessionKey)).value
    assert.ok(checkpoint.revision >= previousRevision + 2, "Both the Gateway path and the direct probe must advance the checkpoint")
    previousRevision = checkpoint.revision
    report.checkpoints.push({ revision: checkpoint.revision, coveredThrough: checkpoint.coveredThrough })
  }

  for (let cycle = 0; cycle < repeats; cycle++) {
    const [search, transcript, ...contexts] = await Promise.all([
      query(admin, "ai-chat-sessions", matches),
      query(admin, "ai-chat-messages", { companyId, sessionKey, limit: "30" }),
      ...Array.from({ length: concurrency }, () => getContext(env, admin, companyId, sessionKey, [200, 429, 503])),
    ])
    assert.ok(search.bytes <= maxPageBytes && transcript.bytes <= maxPageBytes)
    assert.ok(contexts.some((result) => result.status === 200), "Compaction stopped making progress")
    for (const { value, status, bytes } of contexts) {
      if (status !== 200) continue
      assert.ok(bytes < 24 * 1024, "Context response exceeded its fixture envelope")
      assert.ok(value.revision >= first.revision)
      report.checkpoints.push({ revision: value.revision, coveredThrough: value.coveredThrough })
    }
    await delay(300)
    await snapshot(`cycle-${cycle}`)
  }
  assert.ok(report.checkpoints.some(({ revision }) => revision > first.revision), "Bounded compaction must advance")

  await verifyDecisionRevisions(admin, reader, companyId, sessionKey, originalMessage)
  await measureOverload(env, admin, companyId, sessionKey)
  for (const service of ["web", "gateway", "api"]) await stop(service)
  await startApiAndGateway(env)
  await startWeb(env)
  const restored = (await getContext(env, admin, companyId, sessionKey)).value
  assert.ok(restored.revision >= Math.max(...report.checkpoints.map(({ revision }) => revision)))
  assert.ok(JSON.stringify(restored.summary).includes("SKU-ALPHA-2026"), "The persisted checkpoint must survive service restart")
  assert.ok(restored.summary.questions.some(({ text }) => text === question), "Restart must retain the unresolved question")
  assert.ok(restored.historyRefs.some((ref) => ref.kind === mapping.kind && ref.taskId === mapping.taskId && ref.revision === mapping.revision),
    "Restart must retain the exact Products mapping revision")
  const freshKey = `${sessionKey}-fresh`
  await createThread(admin, companyId, freshKey, "Fresh thread")
  const fresh = (await getContext(env, admin, companyId, freshKey)).value
  assert.equal(fresh.revision, 0)
  assert.deepEqual(fresh.recentTurns, [])
  assert.deepEqual(fresh.historyRefs, [])
  assert.deepEqual(fresh.summary, { objective: null, questions: [], highlights: [] })
  const warehouseTransfer = await seedWarehouseOutcome(admin, companyId, `${sessionKey}-warehouse`)
  await seedAssistantAction(admin, companyId, `${sessionKey}-chart`, {
    title: "Overview chart proposal",
    module: "overview",
    content: "Review the chart before adding it to Overview.",
    action: { kind: "add_widget", capabilityKey: "overview.widget.add", pageId: "dashboard" },
  })
  await runBrowser(env, companyId, sessionKey, originalMessage, warehouseTransfer)
  await snapshot("after-restart-browser")
  assertMemoryBudget()
  report.scope = "Actual web, gateway, API, STDB and PostgreSQL with no generation provider provisioned"
  report.providerGenerationVerified = false
  console.log("Authenticated long-thread persistence, bounded compaction, and mobile history passed.")
}

try {
  await main()
} catch (error) {
  report.failure = String(error?.message ?? error)
  console.error(report.failure)
  process.exitCode = 1
} finally {
  if (groups.size) {
    try { await snapshot("cleanup") } catch {}
    await writeFile(join(logs, "acceptance.json"), JSON.stringify(report, null, 2) + "\n")
  }
  for (const service of Array.from(active.keys()).reverse()) await stop(service)
  for (const path of groups.values()) {
    await command("sudo", ["-n", "rmdir", path], process.env).catch(async () => {
      await appendFile(join(logs, "cleanup.log"), "Could not remove a fixture cgroup.\n")
    })
  }
}
