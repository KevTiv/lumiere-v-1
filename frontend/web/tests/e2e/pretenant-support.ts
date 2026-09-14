import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { expect, request as playwrightRequest, test, type Browser, type Page } from "@playwright/test"

import {
  AUTH_STORAGE_PATH,
  callReducerBff,
  fetchDefaultCompanyId,
  fetchSessionOrganizationId,
  scalarQueryId,
  signIn,
  smokeName,
} from "./helpers"

/**
 * Shared support for the pre-tenant adversarial certification suite.
 * See docs/plans/pre-tenant-adversarial-certification.md.
 */

export const PRETENANT = "@pretenant"
export const ADVERSARIAL = "@adversarial"
export const CAPABILITY_PENDING = "@capability-pending"

export function pretenantTags(...areas: string[]): string[] {
  return [PRETENANT, ADVERSARIAL, ...areas]
}

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..")
const REDUCER_NAMES_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../lib/reducer-names.ts")

// ── Capability gating ────────────────────────────────────────────────────────

type Probe =
  | { kind: "route"; method: "GET" | "POST"; path: string }
  | { kind: "reducer"; pattern: RegExp }
  | { kind: "source"; path: string; contains?: string }

export type Capability = {
  id: string
  prerequisite: string
  /** All probes must succeed for the capability to be considered landed. */
  probes: Probe[]
}

export const CAPABILITIES = {
  presentationPreview: {
    id: "presentation-preview",
    prerequisite:
      "Requires PR #13 frontend IR foundation (/api/presentation/preview authorized collection-detail preview).",
    probes: [{ kind: "route", method: "GET", path: "/api/presentation/preview" }],
  },
  presentationSavedDrafts: {
    id: "presentation-saved-drafts",
    prerequisite:
      "Requires PR #25 personal frontend module draft save/reopen (stacked on #13 and #19).",
    probes: [{ kind: "route", method: "GET", path: "/api/presentation/drafts" }],
  },
  presentationCompanySwitch: {
    id: "presentation-company-switch",
    prerequisite:
      "Requires PR #13 preview plus an active-company switch surface in the web BFF (none exists on main).",
    probes: [
      { kind: "route", method: "GET", path: "/api/presentation/preview" },
      { kind: "reducer", pattern: /^(set|switch)_active_company$/ },
    ],
  },
  harnessGeneratedPresentation: {
    id: "harness-generated-presentation",
    prerequisite:
      "Requires harness-generated presentation definitions: PR #25 saved drafts plus a governed presentation capability in lumiere-codegen/agent-capability-metadata.json (PR #17); no open PR provides generation yet.",
    probes: [
      { kind: "route", method: "GET", path: "/api/presentation/drafts" },
      { kind: "source", path: "lumiere-codegen/agent-capability-metadata.json", contains: "presentation" },
    ],
  },
  agentLoop: {
    id: "agent-loop",
    prerequisite: "Requires H4 bounded agent loop and event persistence (PR #23).",
    probes: [{ kind: "source", path: "ai-gateway/src/orchestrator/agent_loop.rs" }],
  },
  agentPolicy: {
    id: "agent-per-call-policy",
    prerequisite: "Requires H5a per-call policy enforcement and approval stops (PR #24).",
    probes: [{ kind: "source", path: "ai-gateway/src/orchestrator/invocation_policy.rs" }],
  },
  agentBudgetPersistence: {
    id: "agent-budget-persistence",
    prerequisite:
      "Requires H5 durable agent budget/run-draft persistence after AI harness stack merges (PR #26).",
    probes: [
      { kind: "source", path: "spacetimedb/src/ai/spend.rs" },
      { kind: "reducer", pattern: /^reserve_ai_spend$/ },
    ],
  },
  outboundProviderDispatch: {
    id: "outbound-provider-dispatch",
    prerequisite:
      "Requires outbound WhatsApp/SMS provider dispatch; main and all open PRs only record copy/queue intents.",
    probes: [{ kind: "reducer", pattern: /^(dispatch|send)_(operational_message|message_batch|crm_[a-z_]*message)/ }],
  },
  providerPayerIdentity: {
    id: "provider-payer-identity",
    prerequisite:
      "Requires a provider payer identity on PaymentTransaction with a manual-review state (not on main or open PRs).",
    probes: [{ kind: "source", path: "spacetimedb/src/accounting/payment_management.rs", contains: "payer_" }],
  },
} satisfies Record<string, Capability>

let reducerNamesCache: string[] | undefined

function generatedReducerNames(): string[] {
  reducerNamesCache ??= [...fs.readFileSync(REDUCER_NAMES_PATH, "utf8").matchAll(/'([a-z0-9_]+)'/g)].map(
    (match) => match[1],
  )
  return reducerNamesCache
}

async function probeSucceeds(page: Page, probe: Probe): Promise<boolean> {
  switch (probe.kind) {
    case "route": {
      const response = await page.request.fetch(probe.path, {
        method: probe.method,
        failOnStatusCode: false,
        maxRedirects: 0,
      })
      return response.status() !== 404
    }
    case "reducer":
      return generatedReducerNames().some((name) => probe.pattern.test(name))
    case "source": {
      const file = path.join(REPO_ROOT, probe.path)
      if (!fs.existsSync(file)) return false
      return probe.contains == null || fs.readFileSync(file, "utf8").includes(probe.contains)
    }
  }
}

/** Skip with the exact prerequisite unless every probe for the capability succeeds. */
export async function requireCapability(page: Page, capability: Capability): Promise<void> {
  const results = await Promise.all(capability.probes.map((probe) => probeSucceeds(page, probe)))
  const available = results.every(Boolean)
  test.info().annotations.push({
    type: "capability",
    description: `${capability.id}: ${available ? "available" : "pending"} — ${capability.prerequisite}`,
  })
  test.skip(!available, capability.prerequisite)
}

/**
 * The capability is detected but this certification has not been written against its landed
 * contract. Fails loudly so the case cannot silently pass once the stack merges.
 */
export function pendingContract(capability: Capability, caseId: string, acceptance: string): never {
  throw new Error(
    `${caseId}: capability ${capability.id} is available but the certification is not implemented. ` +
      `Implement against the landed contract (docs/plans/pre-tenant-adversarial-certification.md). ` +
      `Acceptance: ${acceptance}`,
  )
}

/**
 * Strict expected failure for a registered pre-tenant blocker. Only `assertion` (the correct
 * invariant) may fail; setup outside it fails the test normally. If the invariant now holds the
 * test fails until the registration is removed, so the fix becomes blocking.
 */
export async function expectKnownDefect(
  caseId: string,
  summary: string,
  assertion: () => Promise<void> | void,
): Promise<void> {
  try {
    await assertion()
  } catch (error) {
    const detail = error instanceof Error ? error.message.split("\n")[0] : String(error)
    test.info().annotations.push({ type: "known-defect", description: `${caseId}: ${summary} — ${detail}` })
    return
  }
  throw new Error(
    `${caseId} is registered as a known defect but its invariant now holds; remove the registration so it becomes blocking`,
  )
}

// ── Reducer and query transport ──────────────────────────────────────────────

export type QueryRow = Record<string, unknown>

export const none = { none: [] as [] }
export const some = <T>(value: T) => ({ some: value })

export function unwrap(value: unknown): unknown {
  if (value != null && typeof value === "object" && !Array.isArray(value)) {
    const record = value as QueryRow
    if ("some" in record) return unwrap(record.some)
    if ("none" in record) return null
  }
  return value
}

export function field(row: QueryRow | undefined, ...keys: string[]): unknown {
  if (!row) return undefined
  for (const key of keys) {
    if (key in row) return unwrap(row[key])
  }
  return undefined
}

export function idOf(value: unknown): number | null {
  return scalarQueryId(unwrap(value))
}

export function tagOf(value: unknown): string {
  const raw = unwrap(value)
  if (typeof raw === "string") return raw.toLowerCase()
  if (raw != null && typeof raw === "object") {
    const record = raw as QueryRow
    if (typeof record.tag === "string") return record.tag.toLowerCase()
    const [key] = Object.keys(record)
    if (key) return key.toLowerCase()
  }
  return ""
}

export type ReducerResult = { ok: boolean; status: number; error: string }

/** Raw snake_case reducer call through the authenticated compat BFF (setup / fault injection). */
export async function callRaw(page: Page, reducer: string, args: unknown[]): Promise<ReducerResult> {
  const response = await page.request.post(`/api/compat/reducer/${reducer}`, {
    data: args,
    headers: { "Content-Type": "application/json" },
    failOnStatusCode: false,
  })
  const error = response.ok() ? "" : await response.text().catch(() => "")
  return { ok: response.ok(), status: response.status(), error }
}

export async function callRawOk(page: Page, reducer: string, args: unknown[]): Promise<void> {
  const result = await callRaw(page, reducer, args)
  if (!result.ok) throw new Error(`Reducer ${reducer} failed (${result.status}): ${result.error}`)
}

export async function queryRows(page: Page, resource: string): Promise<QueryRow[]> {
  const response = await page.request.get(`/api/query/${resource}`)
  expect(response.ok(), `${resource} query failed with ${response.status()}`).toBe(true)
  const json = (await response.json()) as { data?: unknown[] }
  return (json.data ?? []).filter(
    (row): row is QueryRow => row != null && typeof row === "object" && !Array.isArray(row),
  )
}

export async function pollRow(
  page: Page,
  resource: string,
  matches: (row: QueryRow) => boolean,
  description: string,
): Promise<QueryRow> {
  let found: QueryRow | undefined
  await expect
    .poll(
      async () => {
        found = (await queryRows(page, resource)).find(matches)
        return found !== undefined
      },
      { timeout: 30_000, message: `waiting for ${description}` },
    )
    .toBe(true)
  if (!found) throw new Error(`${description} not found in /api/query/${resource}`)
  return found
}

export async function auditCount(
  page: Page,
  table: string,
  recordId: number,
  action: string,
): Promise<number> {
  return (await queryRows(page, "audit-log")).filter(
    (row) =>
      String(field(row, "tableName", "table_name")) === table &&
      idOf(field(row, "recordId", "record_id")) === recordId &&
      String(field(row, "action")) === action,
  ).length
}

// ── Actors and sessions ──────────────────────────────────────────────────────

export type Actor = { email: string; password: string; identityHex: string; roleId: number }

async function signupIdentityHex(email: string, password: string): Promise<string> {
  const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100"
  const isolated = await playwrightRequest.newContext({ baseURL })
  try {
    const signup = await isolated.post("/api/auth/signup", { data: { email, password } })
    if (!signup.ok()) throw new Error(`signup failed (${signup.status()}): ${await signup.text()}`)
    const identity = (await isolated.storageState()).cookies.find((c) => c.name === "stdb_identity")
    if (!identity?.value) throw new Error("signup did not set stdb_identity cookie")
    return identity.value.replace(/^0x/i, "")
  } finally {
    await isolated.dispose()
  }
}

/**
 * Provision a non-superuser organization member holding exactly `permissions`
 * (pattern from auth-permission-enforcement.spec.ts). `ownerPage` is the seeded admin session.
 */
export async function provisionActor(ownerPage: Page, label: string, permissions: string[]): Promise<Actor> {
  const organizationId = await fetchSessionOrganizationId(ownerPage)
  const companyId = await fetchDefaultCompanyId(ownerPage)
  const roleName = smokeName(`pretenant-${label}`)
  await callReducerBff(ownerPage, "create_role", [
    organizationId,
    {
      name: roleName,
      description: `Pre-tenant certification actor: ${label}`,
      parent_id: null,
      permissions: ["organization:read", ...permissions],
      is_active: true,
      metadata: null,
    },
  ])
  const role = await pollRow(ownerPage, "roles", (row) => String(field(row, "name")) === roleName, `role ${roleName}`)
  const roleId = idOf(field(role, "id"))
  if (roleId == null) throw new Error(`role ${roleName} has no id`)

  const email = `${smokeName(`pretenant-${label}`)}@example.test`
  const password = "Password123$"
  const identityHex = await signupIdentityHex(email, password)
  await callReducerBff(ownerPage, "add_org_member", [
    identityHex,
    organizationId,
    {
      role_name: roleName,
      company_id: companyId,
      job_title: null,
      department_id: null,
      employee_id: null,
      is_active: true,
      is_default: true,
      metadata: null,
    },
  ])
  await callReducerBff(ownerPage, "assign_role", [
    identityHex,
    roleId,
    organizationId,
    { expires_at_micros: null, metadata: null },
  ])
  return { email, password, identityHex, roleId }
}

export async function withActor<T>(browser: Browser, actor: Actor, run: (page: Page) => Promise<T>): Promise<T> {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } })
  try {
    const page = await context.newPage()
    await signIn(page, actor.email, actor.password)
    return await run(page)
  } finally {
    await context.close()
  }
}

/** A second independent session for the seeded owner (concurrency without role differences). */
export async function withOwnerSession<T>(browser: Browser, run: (page: Page) => Promise<T>): Promise<T> {
  const context = await browser.newContext({ storageState: AUTH_STORAGE_PATH })
  try {
    return await run(await context.newPage())
  } finally {
    await context.close()
  }
}

/** Open `count` independent owner sessions up front so requests can be fired simultaneously. */
export async function openOwnerPages(browser: Browser, count: number): Promise<{ pages: Page[]; close: () => Promise<void> }> {
  const contexts = await Promise.all(
    Array.from({ length: count }, () => browser.newContext({ storageState: AUTH_STORAGE_PATH })),
  )
  const pages = await Promise.all(contexts.map((context) => context.newPage()))
  return { pages, close: async () => void (await Promise.all(contexts.map((context) => context.close()))) }
}

/** Sign in several actors up front so their requests can be fired simultaneously. */
export async function openActorPages(browser: Browser, actors: Actor[]): Promise<{ pages: Page[]; close: () => Promise<void> }> {
  const contexts = await Promise.all(actors.map(() => browser.newContext({ storageState: { cookies: [], origins: [] } })))
  const pages = await Promise.all(contexts.map((context) => context.newPage()))
  await Promise.all(pages.map((page, index) => signIn(page, actors[index].email, actors[index].password)))
  return { pages, close: async () => void (await Promise.all(contexts.map((context) => context.close()))) }
}

// ── Fault injection ──────────────────────────────────────────────────────────

/** Deterministic xorshift32 generator; include `seed` in every failure message. */
export function seededRng(seed: number): () => number {
  let state = seed >>> 0 || 1
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return (state >>> 0) / 0x1_0000_0000
  }
}

/**
 * Let the request reach the server (so the mutation commits) and then drop the response,
 * modelling a mobile network losing the reply. Applies to the first matching request only.
 */
export async function loseNextResponse(page: Page, urlPart: string): Promise<{ lost: () => boolean }> {
  let lost = false
  await page.route(
    (url) => url.pathname.includes(urlPart),
    async (route) => {
      if (lost) return route.continue()
      lost = true
      await route.fetch()
      await route.abort("connectionreset")
    },
  )
  return { lost: () => lost }
}

/** Browser-originated POST (subject to page.route / offline), returning status or a network error. */
export async function browserPost(page: Page, url: string, body: unknown): Promise<{ status: number | "network-error" }> {
  return page.evaluate(
    async ({ url, body }) => {
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
        return { status: response.status }
      } catch {
        return { status: "network-error" as const }
      }
    },
    { url, body },
  )
}

// ── Personas ─────────────────────────────────────────────────────────────────

export type Persona = {
  key: string
  summary: string
  customer: { name: string; phone: string; momoPhone: string }
  invoiceMinor: number
  partialPaymentMinor: number
}

/** Deterministic synthetic business personas (names/amounts are stable; markers add uniqueness). */
export const PERSONAS: Record<string, Persona> = {
  distributor: {
    key: "distributor",
    summary: "Distributor/wholesaler selling on credit to retailers, collecting by mobile money",
    customer: { name: "Pretenant Kiosk Retailer", phone: "+12025550301", momoPhone: "+12025550302" },
    invoiceMinor: 150_000,
    partialPaymentMinor: 90_000,
  },
  cashShop: {
    key: "cash-shop",
    summary: "Cash-heavy shop with daily walk-in sales and end-of-day mobile-money float",
    customer: { name: "Pretenant Walk-in Customer", phone: "+12025550311", momoPhone: "+12025550311" },
    invoiceMinor: 2_500,
    partialPaymentMinor: 2_500,
  },
  serviceRepair: {
    key: "service-repair",
    summary: "Service/repair SME with deposits, parts and completion invoices",
    customer: { name: "Pretenant Repair Client", phone: "+12025550321", momoPhone: "+12025550322" },
    invoiceMinor: 48_000,
    partialPaymentMinor: 20_000,
  },
  cooperative: {
    key: "cooperative",
    summary: "Cooperative collecting member contributions and paying member payouts",
    customer: { name: "Pretenant Coop Member", phone: "+12025550331", momoPhone: "+12025550331" },
    invoiceMinor: 10_000,
    partialPaymentMinor: 10_000,
  },
  multiBranch: {
    key: "multi-branch",
    summary: "Multi-branch wholesaler with branch companies sharing one organization",
    customer: { name: "Pretenant Branch Retailer", phone: "+12025550341", momoPhone: "+12025550342" },
    invoiceMinor: 320_000,
    partialPaymentMinor: 120_000,
  },
}
