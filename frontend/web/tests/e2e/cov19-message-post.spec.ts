import { expect, test, type Page, type Request } from "@playwright/test"

import {
  fetchSessionOrganizationId,
  gotoModule,
  scalarQueryId,
  signIn,
  smokeName,
} from "./helpers"
import { matchesOperationResponse } from "./operation-response"

// COV-19 slice 2 — see docs/plan/erp-cov19-activity-completion-status.md.
const PERSONA_PASSWORD = process.env.E2E_FIRST_ORG_PERSONA_PASSWORD ?? "Password123$"

type Row = Record<string, unknown>

async function rows(page: Page, resource: string): Promise<Row[]> {
  const response = await page.request.get(`/api/query/${resource}`)
  if (!response.ok()) throw new Error(`${resource} query failed: ${response.status()}`)
  return ((await response.json()) as { data?: Row[] }).data ?? []
}

async function replay(page: Page, request: Request, body: unknown = request.postDataJSON()) {
  const url = new URL(request.url())
  return page.request.post(`${url.pathname}${url.search}`, {
    headers: { "Content-Type": "application/json" },
    data: body,
  })
}

/** Copy of a JSON payload with every string equal to `from` replaced by `to`. */
function replaceString(value: unknown, from: string, to: string): unknown {
  if (value === from) return to
  if (Array.isArray(value)) return value.map((item) => replaceString(item, from, to))
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceString(item, from, to)]))
  }
  return value
}

async function messagesWithBody(page: Page, body: string) {
  return (await rows(page, "mail-messages")).filter((row) => row.body === body)
}

async function messageSnapshot(page: Page, body: string) {
  const matches = await messagesWithBody(page, body)
  if (matches.length !== 1) throw new Error(`expected one message "${body}", found ${matches.length}`)
  const row = matches[0]!
  const metadata = JSON.parse(String(row.metadata ?? "null")) as { idempotency_key?: unknown } | null
  return {
    id: scalarQueryId(row.id),
    organizationId: scalarQueryId(row.organizationId ?? row.organization_id),
    model: String(row.model),
    resId: scalarQueryId(row.resId ?? row.res_id),
    body: String(row.body),
    idempotencyKey: typeof metadata?.idempotency_key === "string" ? metadata.idempotency_key : null,
  }
}

test.describe("COV-19 exact message post", { tag: ["@p0", "@cov19"] }, () => {
  test("posts one keyed message, converges on replay and rejects key reuse and denied writers", async ({
    browser,
    page,
  }) => {
    test.setTimeout(180_000)
    const organizationId = await fetchSessionOrganizationId(page)
    const model = "cov19_record"
    const resId = 190_019
    const body = smokeName("cov19-message")

    // The post under test is driven through the Messages "new message" form.
    await gotoModule(page, "/messages", "messages")
    await page.getByTestId("quick-action-new_message").click()
    await expect(page.getByTestId("form-modal-new-mail-message")).toBeVisible()
    await page.getByTestId("form-field-model").fill(model)
    await page.getByTestId("form-field-resId").fill(String(resId))
    await page.getByTestId("form-field-body").fill(body)
    const [accepted] = await Promise.all([
      page.waitForResponse((response) => matchesOperationResponse(response, "post_message"), {
        timeout: 30_000,
      }),
      page.getByTestId("form-submit-new-mail-message").click(),
    ])
    expect(accepted.ok()).toBe(true)

    await expect.poll(async () => (await messagesWithBody(page, body)).length, { timeout: 30_000 }).toBe(1)
    const effect = await messageSnapshot(page, body)
    expect(effect).toMatchObject({ organizationId, model, resId, body })
    expect(effect.idempotencyKey).toBeTruthy()

    // Replaying the same submission converges on the same row instead of posting twice.
    const replayed = await replay(page, accepted.request())
    expect(replayed.ok()).toBe(true)
    expect(await messagesWithBody(page, body)).toHaveLength(1)
    expect(await messageSnapshot(page, body)).toEqual(effect)

    // The same key for a different message is rejected and creates nothing.
    const edited = `${body} (edited)`
    const conflict = await replay(page, accepted.request(), replaceString(accepted.request().postDataJSON(), body, edited))
    expect(conflict.status()).toBe(422)
    expect(await messagesWithBody(page, edited)).toHaveLength(0)
    expect(await messageSnapshot(page, body)).toEqual(effect)

    const readerContext = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    const readerPage = await readerContext.newPage()
    try {
      await signIn(readerPage, "fixture.reader@example.test", PERSONA_PASSWORD)
      const denied = await replay(readerPage, accepted.request(), replaceString(accepted.request().postDataJSON(), body, `${body} (reader)`))
      expect(denied.status()).toBe(403)
      expect(await messagesWithBody(page, `${body} (reader)`)).toHaveLength(0)
      expect(await messageSnapshot(page, body)).toEqual(effect)
    } finally {
      await readerContext.close()
    }
  })
})
