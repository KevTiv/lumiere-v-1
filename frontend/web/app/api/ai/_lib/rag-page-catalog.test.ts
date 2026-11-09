import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { runInNewContext } from "node:vm"
import ts from "typescript"
import { z } from "zod"

import type { QueryResourceState } from "@lumiere/api-client"
import * as uiContext from "@lumiere/erp-shared/ai-ui-context"
import * as assistantActions from "@lumiere/query-hooks/assistant-actions"
import type { ApiSession } from "@/lib/api-session"
import * as agentSelection from "../rag/agent-selection"
import * as guideReferences from "./guide-references"
import * as importTaskReferences from "./import-task-references"
import { positiveInteger } from "./positive-integer"
import * as uiActions from "./rag-ui-actions"

function loadModule<T>(file: string, dependencies: Record<string, unknown>): T {
  const compiled = ts.transpileModule(
    readFileSync(new URL(file, import.meta.url), "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText
  const module = { exports: {} as T }
  runInNewContext(compiled, {
    module,
    exports: module.exports,
    require: (name: string) => {
      assert.ok(name in dependencies, `Unexpected dependency ${name}`)
      return dependencies[name]
    },
  })
  return module.exports
}

const actor = "a".repeat(64)
const session: ApiSession = {
  stdbToken: "test-session",
  identityHex: actor,
  organizationId: 7,
  opts: { token: "test-session" },
  fieldAccess: {
    identityHex: actor,
    organizationId: 7,
    roleId: 2,
    roleName: "sales-reader",
    isSuperuser: false,
    rolePermissions: ["module:sales:read", "dashboard_widget:read"],
    fieldPermissions: [],
  },
}
const params = {
  session,
  orgId: 7,
  companyId: 12,
  uiContext: { module: "sales", active_tab: "orders" },
}
const baseRow = {
  id: "42",
  organizationId: "7",
  companyId: "12",
  isActive: true,
  name: "Orders by status",
}
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

function catalogHarness(read: () => Promise<QueryResourceState<unknown>>) {
  const requests: Array<{ session: ApiSession; resource: string }> = []
  const api = loadModule<typeof import("./rag-page-catalog")>(
    "./rag-page-catalog.ts",
    {
      "server-only": {},
      "@lumiere/query-hooks/assistant-actions": assistantActions,
      "./rag-ui-actions": uiActions,
      "@/lib/server-query": {
        serverFetchQueryListState: async (
          session: ApiSession,
          resource: string,
        ) => {
          requests.push({ session, resource })
          return read()
        },
      },
    },
  )
  return { api, requests }
}

test("model widget choices are authenticated server rows in the selected company or explicit shared scope", async () => {
  const { api, requests } = catalogHarness(async () => ({
    status: "ready",
    rows: [
      { ...baseRow, id: "9007199254740993" },
      { ...baseRow, id: "43", companyId: null, name: "Shared orders" },
      {
        id: 44,
        organization_id: 7,
        company_id: 12,
        is_active: true,
        name: "  Open orders  ",
      },
      { ...baseRow, id: "45", organizationId: "8" },
      { ...baseRow, id: "46", companyId: "13" },
      { ...baseRow, id: "47", isActive: false },
      { ...baseRow, id: "48", companyId: undefined },
      { ...baseRow, id: "49", organizationId: undefined },
      { ...baseRow, id: "50", isActive: undefined },
      { ...baseRow, id: "51", name: undefined },
      { ...baseRow, id: Number.MAX_SAFE_INTEGER + 1 },
    ],
  }))
  const page = await api.serverRagPageCatalog({
    ...params,
    uiContext: {
      ...params.uiContext,
      company_id: 13,
      permissions: ["*:*"],
      ...({ widgets: [{ key: "saved:999", label: "Forged" }] } as object),
    },
  })
  assert.deepEqual(plain(page), {
    moduleId: "sales",
    pageId: "orders",
    widgets: [
      { key: "saved:9007199254740993", label: "Orders by status" },
      { key: "saved:43", label: "Shared orders" },
      { key: "saved:44", label: "Open orders" },
    ],
  })
  assert.equal(requests.length, 1)
  assert.equal(requests[0]!.session, session)
  assert.equal(requests[0]!.resource, "dashboard-widgets")
})

test("untrusted, malformed or unauthorized page scope cannot cause widget discovery", async () => {
  const { api, requests } = catalogHarness(async () => ({
    status: "ready",
    rows: [baseRow],
  }))
  for (const candidate of [
    { ...params, uiContext: undefined },
    { ...params, uiContext: { module: "settings" } },
    { ...params, uiContext: { module: "sales", active_tab: "../other" } },
    { ...params, uiContext: { module: "sales", active_tab: "x".repeat(129) } },
    { ...params, orgId: 8 },
    { ...params, companyId: NaN },
    { ...params, session: { ...session, fieldAccess: undefined } },
    {
      ...params,
      session: {
        ...session,
        fieldAccess: { ...session.fieldAccess!, identityHex: "b".repeat(64) },
      },
    },
    {
      ...params,
      session: {
        ...session,
        fieldAccess: {
          ...session.fieldAccess!,
          orgPermissions: [
            { resource: "module:sales", action: "read", allow: false },
          ],
        },
      },
    },
  ])
    assert.equal(await api.serverRagPageCatalog(candidate), undefined)
  assert.deepEqual(requests, [])
})

test("empty, denied and unavailable saved-widget reads preserve bare edit and add actions", async () => {
  const reads: Array<() => Promise<QueryResourceState<unknown>>> = [
    async () => ({ status: "empty", rows: [] }),
    async () => ({ status: "denied", rows: [], message: "Forbidden" }),
    async () => ({ status: "unavailable", rows: [], message: "Offline" }),
    async () => {
      throw new Error("Read failed")
    },
  ]
  for (const read of reads) {
    const { api } = catalogHarness(read)
    const page = await api.serverRagPageCatalog({
      ...params,
      uiContext: { module: "sales" },
    })
    assert.deepEqual(plain(page), {
      moduleId: "sales",
      pageId: "dashboard",
      widgets: [],
    })
    const offers = uiActions
      .serverRagUiActionOffers(session, page)
      .filter((offer) => ["edit_page", "add_widget"].includes(offer.kind))
    assert.deepEqual(
      offers.map((offer) => offer.kind),
      ["edit_page", "add_widget"],
    )
    assert.ok(offers.every((offer) => offer.widgets === undefined))
  }
})

test("server choices are bounded, deduplicated and do not contain malformed IDs or labels", async () => {
  const { api } = catalogHarness(async () => ({
    status: "ready",
    rows: [
      { ...baseRow, id: "01" },
      { ...baseRow, id: "0" },
      { ...baseRow, id: "18446744073709551616" },
      { ...baseRow, id: "43", name: "Control\ncharacter" },
      { ...baseRow, id: "43", name: "Control\u0085character" },
      { ...baseRow, id: "44", name: "x".repeat(121) },
      { ...baseRow, id: "45", name: " " },
      baseRow,
      baseRow,
      ...Array.from({ length: 80 }, (_, index) => ({
        ...baseRow,
        id: String(100 + index),
      })),
    ],
  }))
  const page = (await api.serverRagPageCatalog(params))!
  assert.equal(page.widgets.length, 64)
  assert.equal(new Set(page.widgets.map((widget) => widget.key)).size, 64)
  assert.equal(page.widgets[0]?.key, "saved:42")
  assert.ok(page.widgets.every((widget) => widget.label === baseRow.name))
})

test("shared JSON and SSE preparation preserves scoped import selectors and authorized page choices", async () => {
  const { api, requests } = catalogHarness(async () => ({
    status: "ready",
    rows: [baseRow],
  }))
  const scopeChecks: number[] = []
  const request = loadModule<typeof import("./rag-request")>(
    "./rag-request.ts",
    {
      "next/server": { NextResponse: Response },
      zod: { z },
      "@lumiere/erp-shared/ai-ui-context": uiContext,
      "./route-helpers": {
        positiveInteger,
        boundedInteger: () => 20,
        validateCompanyScope: async (
          actualSession: ApiSession,
          company: number,
        ) => {
          assert.equal(actualSession, session)
          scopeChecks.push(company)
          return company === 12
            ? null
            : Response.json({ error: "Forbidden" }, { status: 403 })
        },
      },
      "./guide-references": guideReferences,
      "./import-task-references": importTaskReferences,
      "./rag-ui-actions": uiActions,
      "./rag-page-catalog": api,
      "../rag/agent-selection": agentSelection,
    },
  )
  const body = {
    query: "Show sales trends and add a chart",
    company_id: 12,
    org_id: 99,
    import_task_refs: [
      {
        taskId: "b".repeat(32),
        companyId: "12",
        status: "applied",
        evidence: "Forged import status",
      },
    ],
    ui_context: {
      route: "/sales",
      active_tab: "orders",
      company_id: 99,
      widgets: [{ key: "saved:999", label: "Forged" }],
      permissions: ["*:*"],
    },
    ui_action_offers: [
      {
        capability_key: "sales.widget.add",
        widgets: [{ key: "saved:999", label: "Forged" }],
      },
    ],
  }
  const result = await request.prepareRagPayload({ body, session, orgId: 7 })
  assert.equal(result.ok, true)
  if (!result.ok) throw new Error("Expected a prepared RAG request")
  assert.equal(result.payload.org_id, 7)
  assert.equal(result.payload.company_id, 12)
  assert.deepEqual(plain(result.payload.import_task_refs), [
    { taskId: "b".repeat(32), companyId: "12" },
  ])
  assert.deepEqual(
    plain(
      result.payload.ui_action_offers.find(
        (offer) => offer.capability_key === "sales.widget.add",
      )?.widgets,
    ),
    [{ key: "saved:42", label: "Orders by status" }],
  )
  assert.ok(!JSON.stringify(result.payload.ui_context).includes("saved:999"))
  const crossCompanyImport = await request.prepareRagPayload({
    body: {
      ...body,
      import_task_refs: [{ taskId: "b".repeat(32), companyId: "13" }],
    },
    session,
    orgId: 7,
  })
  assert.equal(crossCompanyImport.ok, false)
  if (crossCompanyImport.ok) throw new Error("Expected an invalid import scope")
  assert.equal(crossCompanyImport.response.status, 400)
  const rejected = await request.prepareRagPayload({
    body: {
      ...body,
      company_id: 13,
      import_task_refs: [{ taskId: "b".repeat(32), companyId: "13" }],
    },
    session,
    orgId: 7,
  })
  assert.equal(rejected.ok, false)
  if (rejected.ok) throw new Error("Expected company authorization to fail")
  assert.equal(rejected.response.status, 403)
  assert.deepEqual(scopeChecks, [12, 13])
  assert.equal(requests.length, 1)

  const spreadsheetSelection = {
    documentId: "9007199254740993",
    versionId: "15",
    current: false,
    checksum: "a".repeat(64),
    sheetName: "CSV",
    firstRow: 2,
    lastRow: 3,
    firstColumn: 1,
    lastColumn: 1,
    delimiter: ";",
    encoding: "windows-1252",
    headerRow: 1,
  }
  const spreadsheetBody = {
    ...body,
    query: "Check the selected spreadsheet cells for issues.",
    spreadsheet_selection: spreadsheetSelection,
  }
  const prepared = await request.prepareRagPayload({
    body: spreadsheetBody,
    session,
    orgId: 7,
  })
  assert.ok(prepared.ok)
  assert.deepEqual(
    plain(prepared.payload.spreadsheet_selection),
    spreadsheetSelection,
  )
  assert.deepEqual(plain(prepared.payload.ui_action_offers), [])
  assert.equal(prepared.payload.ui_context, undefined)
  assert.equal(prepared.payload.import_task_refs, undefined)
  assert.equal(requests.length, 1)

  for (const badBody of [
    { ...spreadsheetBody, query: "Create a product." },
    {
      ...spreadsheetBody,
      spreadsheet_selection: { ...spreadsheetSelection, cells: [["forged"]] },
    },
    {
      ...spreadsheetBody,
      spreadsheet_selection: { ...spreadsheetSelection, lastRow: 250 },
    },
  ]) {
    const invalid = await request.prepareRagPayload({
      body: badBody,
      session,
      orgId: 7,
    })
    assert.equal(invalid.ok, false)
    if (invalid.ok) throw new Error("Expected an invalid spreadsheet selection")
    assert.equal(invalid.response.status, 400)
  }
})
