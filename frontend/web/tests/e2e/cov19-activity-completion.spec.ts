import { expect, test, type Page, type Request } from "@playwright/test"

import {
  callReducerBff,
  fetchSessionOrganizationId,
  gotoModule,
  scalarQueryId,
  signIn,
  smokeName,
} from "./helpers"
import { matchesOperationResponse } from "./operation-response"

// COV-19 — see docs/plan/erp-cov19-activity-completion-status.md.
const PERSONA_PASSWORD = process.env.E2E_FIRST_ORG_PERSONA_PASSWORD ?? "Password123$"

const none = { none: [] as [] }
const some = <T,>(value: T) => ({ some: value })

type Row = Record<string, unknown>

async function ownerSql(sql: string): Promise<Row[]> {
  const host = (process.env.E2E_STDB_HOST ?? process.env.STDB_HOST ?? "http://127.0.0.1:3000").replace(/\/$/, "")
  const moduleName = process.env.STDB_MODULE?.trim()
  const token = process.env.STDB_SERVER_TOKEN?.trim()
  if (!moduleName || !token) throw new Error("owner SQL needs STDB_MODULE and STDB_SERVER_TOKEN")
  const response = await fetch(`${host}/v1/database/${moduleName}/sql`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "text/plain" },
    body: sql,
  })
  if (!response.ok) throw new Error(`owner SQL failed (${response.status}): ${await response.text()}`)
  const sets = (await response.json()) as Array<{
    schema?: { elements?: Array<{ name?: { some?: string } }> }
    rows?: unknown[][]
  }>
  const names = (sets[0]?.schema?.elements ?? []).map((element) => element.name?.some ?? "")
  return (sets[0]?.rows ?? []).map((values) =>
    Object.fromEntries(names.map((name, index) => [name, values[index]])),
  )
}

async function rows(page: Page, resource: string): Promise<Row[]> {
  const response = await page.request.get(`/api/query/${resource}`)
  if (!response.ok()) throw new Error(`${resource} query failed: ${response.status()}`)
  return ((await response.json()) as { data?: Row[] }).data ?? []
}

async function replay(page: Page, request: Request) {
  const url = new URL(request.url())
  return page.request.post(`${url.pathname}${url.search}`, {
    headers: { "Content-Type": "application/json" },
    data: request.postDataJSON(),
  })
}

async function activitySnapshot(page: Page, activityId: number) {
  const matches = (await rows(page, "activities")).filter((row) => scalarQueryId(row.id) === activityId)
  if (matches.length !== 1) throw new Error(`expected one activity ${activityId}, found ${matches.length}`)
  const row = matches[0]!
  return {
    id: activityId,
    organizationId: scalarQueryId(row.organizationId ?? row.organization_id),
    state: String(row.state ?? ""),
    isDone: (row.isDone ?? row.is_done) === true,
  }
}

test.describe("COV-19 exact activity completion", { tag: ["@p0", "@cov19"] }, () => {
  test("completes the selected activity and preserves it on stale and denied replay", async ({
    browser,
    page,
  }) => {
    test.setTimeout(180_000)
    const organizationId = await fetchSessionOrganizationId(page)
    const [activityType] = await ownerSql(
      `SELECT id FROM activity_type WHERE organization_id = ${organizationId} AND is_active = true`,
    )
    const activityTypeId = scalarQueryId(activityType?.id)
    if (activityTypeId == null) throw new Error(`organization ${organizationId} has no active activity type`)

    // Setup only: the open activity is fixture data. The completion under
    // test is driven through the CRM Activities UI below.
    const summary = smokeName("cov19-activity")
    await callReducerBff(page, "create_activity", [organizationId, {
      activity_type_id: activityTypeId,
      summary,
      priority: "normal",
      state: "planned",
      auto: false,
      is_system: false,
      is_done: false,
      note: none,
      date_deadline: none,
      date_done: none,
      assigned_to: none,
      target: none,
      duration: none,
      location: none,
      video_url: none,
      metadata: some(JSON.stringify({ fixture: "COV-19" })),
    }])
    const created = (await rows(page, "activities")).filter((row) => row.summary === summary)
    expect(created).toHaveLength(1)
    const activityId = scalarQueryId(created[0]?.id)
    if (activityId == null) throw new Error("created activity not found")
    expect(await activitySnapshot(page, activityId)).toEqual({
      id: activityId,
      organizationId,
      state: "planned",
      isDone: false,
    })

    await gotoModule(page, "/crm", "crm")
    await page.getByTestId("module-tab-crm-activities").click()
    const activityRow = page.getByTestId(`entity-row-${activityId}`)
    await expect(activityRow).toBeVisible({ timeout: 30_000 })
    await activityRow.click()
    const action = page.getByTestId("entity-action-complete-activity")
    await expect(action).toBeEnabled()
    const [accepted] = await Promise.all([
      page.waitForResponse((response) => matchesOperationResponse(response, "complete_activity"), {
        timeout: 30_000,
      }),
      action.click(),
    ])
    expect(accepted.ok()).toBe(true)

    const effect = { id: activityId, organizationId, state: "done", isDone: true }
    await expect.poll(() => activitySnapshot(page, activityId)).toEqual(effect)

    // Before COV-19 a replay re-stamped date_done/updated_at and wrote a second
    // audit entry; the reducer now rejects completing an already-done activity.
    const stale = await replay(page, accepted.request())
    expect(stale.status()).toBe(422)
    expect(await activitySnapshot(page, activityId)).toEqual(effect)

    const readerContext = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    const readerPage = await readerContext.newPage()
    try {
      await signIn(readerPage, "fixture.reader@example.test", PERSONA_PASSWORD)
      const denied = await replay(readerPage, accepted.request())
      expect(denied.status()).toBe(403)
      expect(await activitySnapshot(page, activityId)).toEqual(effect)
    } finally {
      await readerContext.close()
    }
  })
})
