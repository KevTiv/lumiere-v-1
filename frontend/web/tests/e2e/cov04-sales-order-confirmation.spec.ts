import { expect, test } from "@playwright/test"
import type { Page } from "@playwright/test"
import { stdbBffCommandPost } from "@lumiere/stdb/commands"

import {
  activeTabEntityTable,
  callReducerBff,
  fetchDefaultCompanyId,
  fetchSessionOrganizationId,
  gotoApprovals,
  gotoModule,
  scalarQueryId,
  seedSaleOrderApprovalWorkflow,
  signIn,
  smokeName,
  waitForPendingApprovalRequest,
} from "./helpers"
import { addLaptopLine, confirmOrderViaUi, createDraftSaleOrder, fetchOrderPickings } from "./sales-order-fixtures"

const PERSONA_PASSWORD = process.env.E2E_FIRST_ORG_PERSONA_PASSWORD ?? "Password123$"

async function confirmRequest(page: Page, companyId: number, orderId: number) {
  const { urlPath, init } = stdbBffCommandPost("confirm_sales_order", {
    companyId,
    orderId,
  })
  return page.request.post(urlPath, {
    headers: { "Content-Type": "application/json" },
    data: JSON.parse(String(init.body)),
  })
}

async function exactActiveApprovalTaskIds(page: Page, orderId: number): Promise<number[]> {
  const response = await page.request.get("/api/query/workflow-human-tasks-inbox")
  expect(response.ok()).toBe(true)
  const rows = ((await response.json()) as { data?: Array<Record<string, unknown>> }).data ?? []
  return rows.flatMap((row) => {
    const summary = row.summary && typeof row.summary === "object" ? (row.summary as Record<string, unknown>) : {}
    const model = row.subjectModel ?? row.subject_model ?? summary.subjectModel ?? row.model
    const subjectId = scalarQueryId(row.subjectId ?? row.subject_id ?? summary.subjectId ?? row.resId ?? row.res_id)
    const state =
      typeof row.status === "string"
        ? row.status
        : row.status && typeof row.status === "object" && "tag" in row.status
          ? String(row.status.tag)
          : row.status && typeof row.status === "object"
            ? (Object.keys(row.status)[0] ?? "")
            : ""
    const id = scalarQueryId(row.id)
    return model === "sale_order" && subjectId === orderId && ["Open", "Claimed"].includes(state) && id != null
      ? [id]
      : []
  })
}

function statusTag(status: unknown): string {
  if (typeof status === "string") return status
  if (status && typeof status === "object" && "tag" in status) return String((status as { tag?: unknown }).tag ?? "")
  return status && typeof status === "object" ? (Object.keys(status)[0] ?? "") : ""
}

/**
 * Guarded-action discovery admits exactly one published workflow per action, so
 * the seeded `seed.sales-approval` (gated on the unreachable ToApprove state)
 * must be retired before this test publishes its own sale-order approval.
 */
async function retireSeedSalesApproval(page: Page, organizationId: number) {
  const workflows = await page.request.get("/api/query/workflows")
  expect(workflows.ok()).toBe(true)
  const seedIds = new Set(
    (((await workflows.json()) as { data?: Array<Record<string, unknown>> }).data ?? [])
      .filter((row) => (row.workflowKey ?? row.workflow_key) === "seed.sales-approval")
      .map((row) => scalarQueryId(row.id)),
  )
  if (seedIds.size === 0) return
  const versions = await page.request.get("/api/query/workflow-versions")
  expect(versions.ok()).toBe(true)
  for (const row of ((await versions.json()) as { data?: Array<Record<string, unknown>> }).data ?? []) {
    if (!seedIds.has(scalarQueryId(row.workflowId ?? row.workflow_id)) || statusTag(row.status) !== "Published") continue
    await callReducerBff(page, "retire_workflow_version", [
      organizationId,
      scalarQueryId(row.id),
      scalarQueryId(row.draftRevision ?? row.draft_revision),
    ])
  }
}

function isCanonicalOrderUrl(url: URL, orderId: number): boolean {
  return (
    url.pathname === "/sales" &&
    url.searchParams.get("tab") === "orders" &&
    url.searchParams.getAll("filter").length === 1 &&
    url.searchParams.get("filter") === `id:${orderId}`
  )
}

async function expectCanonicalOrderFocus(page: Page, orderId: number) {
  await expect(page).toHaveURL((url) => isCanonicalOrderUrl(url, orderId))
  await expect(page.getByTestId("module-tab-sales-orders")).toHaveAttribute("aria-selected", "true")

  const table = activeTabEntityTable(page)
  await expect(table.getByTestId(`entity-row-${orderId}`)).toBeVisible()
  await expect(table.locator('[data-testid^="entity-row-"]')).toHaveCount(1)
  await expect(table.getByTestId("entity-active-filter-id")).toContainText(`id: ${orderId}`)
}

test.describe("COV-04 sale-order confirmation", { tag: ["@p0", "@cov04", "@unauthenticated"] }, () => {
  test("approval and concurrent confirmation converge; requester task discovery fails closed", async ({
    browser,
    page,
  }) => {
    test.setTimeout(300_000)
    await signIn(page, "test@email.com", PERSONA_PASSWORD)
    await retireSeedSalesApproval(page, await fetchSessionOrganizationId(page))
    const workflow = await seedSaleOrderApprovalWorkflow(page, {
      workflowKey: smokeName("cov04_sales_approval").toLowerCase().replace(/-/g, "_"),
      name: smokeName("COV04 sales approval"),
    })
    const companyId = await fetchDefaultCompanyId(page)
    const orderId = await createDraftSaleOrder(page, smokeName("cov04-approval-race"))
    await addLaptopLine(page, orderId, "1")

    const requesterContext = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    })
    const requester = await requesterContext.newPage()
    try {
      await signIn(requester, "fixture.sales@example.test", PERSONA_PASSWORD)
      const requested = await confirmRequest(requester, companyId, orderId)
      expect(requested.ok()).toBe(true)

      const taskId = await waitForPendingApprovalRequest(page, "sale_order", orderId)
      await expect.poll(() => exactActiveApprovalTaskIds(page, orderId)).toEqual([taskId])
      // The candidate-scoped inbox does not expose an admin-only task to its
      // requester. The Sales client must keep the outcome unknown rather than
      // infer a task by order state, name, or time.
      // Fail closed means denied outright or an empty inbox, never the admin task.
      const requesterInbox = await requester.request.get("/api/query/workflow-human-tasks-inbox")
      expect([200, 403]).toContain(requesterInbox.status())
      if (requesterInbox.ok()) expect(await exactActiveApprovalTaskIds(requester, orderId)).toEqual([])
      expect(await fetchOrderPickings(page, orderId)).toEqual([])

      await gotoApprovals(page)
      await expect(page.getByTestId(`approval-card-${taskId}`)).toBeVisible({
        timeout: 30_000,
      })
      const decision = page.waitForResponse(
        (response) => response.url().includes("decide_workflow_human_task") && response.ok(),
        { timeout: 60_000 },
      )
      const [replayed] = await Promise.all([
        confirmRequest(requester, companyId, orderId),
        page.getByTestId(`approval-approve-${taskId}`).click(),
      ])
      expect([200, 422]).toContain(replayed.status())
      await decision

      await expect.poll(() => fetchOrderPickings(page, orderId), { timeout: 30_000 }).toHaveLength(1)
      expect(await exactActiveApprovalTaskIds(page, orderId)).toEqual([])
      const stale = await confirmRequest(requester, companyId, orderId)
      expect(stale.status()).toBe(422)
      expect(await fetchOrderPickings(page, orderId)).toHaveLength(1)
    } finally {
      await requesterContext.close()
      await callReducerBff(page, "retire_workflow_version", [
        workflow.organizationId,
        workflow.versionId,
        workflow.revision,
      ])
    }
  })

  test("concurrent sales confirmations converge on one canonical fulfillment effect", async ({ browser, page }) => {
    test.setTimeout(180_000)

    await signIn(page, "test@email.com", PERSONA_PASSWORD)
    const companyId = await fetchDefaultCompanyId(page)
    const orderId = await createDraftSaleOrder(page, smokeName("cov04-concurrent"))
    await addLaptopLine(page, orderId, "1")

    const contexts = await Promise.all([
      browser.newContext({ storageState: { cookies: [], origins: [] } }),
      browser.newContext({ storageState: { cookies: [], origins: [] } }),
    ])
    const pages = await Promise.all(contexts.map((context) => context.newPage()))
    try {
      await Promise.all(pages.map((actor) => signIn(actor, "fixture.sales@example.test", PERSONA_PASSWORD)))
      const responses = await Promise.all(pages.map((actor) => confirmRequest(actor, companyId, orderId)))
      expect(responses.filter((response) => response.ok())).toHaveLength(1)
      expect(responses.filter((response) => response.status() === 422)).toHaveLength(1)

      await expect.poll(() => fetchOrderPickings(page, orderId), { timeout: 30_000 }).toHaveLength(1)
      const canonicalPickings = await fetchOrderPickings(page, orderId)

      const replay = await confirmRequest(pages[0]!, companyId, orderId)
      expect(replay.status()).toBe(422)
      expect(await fetchOrderPickings(page, orderId)).toEqual(canonicalPickings)
    } finally {
      await Promise.all(contexts.map((context) => context.close()))
    }
  })

  test("sales persona confirms the canonical order once and reader is denied", async ({ browser, page }) => {
    test.setTimeout(180_000)

    await signIn(page, "test@email.com", PERSONA_PASSWORD)
    const companyId = await fetchDefaultCompanyId(page)
    const orderId = await createDraftSaleOrder(page, smokeName("cov04-confirm"))
    await addLaptopLine(page, orderId, "1")
    expect(await fetchOrderPickings(page, orderId)).toEqual([])

    const salesContext = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    })
    const salesPage = await salesContext.newPage()
    const readerContext = await browser.newContext({
      storageState: { cookies: [], origins: [] },
    })
    const readerPage = await readerContext.newPage()

    try {
      await signIn(salesPage, "fixture.sales@example.test", PERSONA_PASSWORD)
      // confirmOrderViaUi opens the exact-order URL directly; the unfiltered
      // Orders list must precede it in history for the Back assertion below.
      await gotoModule(salesPage, "/sales?tab=orders", "sales")
      await confirmOrderViaUi(salesPage, orderId)
      await expectCanonicalOrderFocus(salesPage, orderId)

      await salesPage.reload({ waitUntil: "domcontentloaded" })
      await expectCanonicalOrderFocus(salesPage, orderId)

      await salesPage.goBack()
      await expect(salesPage).toHaveURL((url) => {
        return (
          url.pathname === "/sales" &&
          url.searchParams.get("tab") === "orders" &&
          url.searchParams.getAll("filter").length === 0
        )
      })
      await expect(salesPage.getByTestId("module-tab-sales-orders")).toHaveAttribute("aria-selected", "true")
      await expect(activeTabEntityTable(salesPage).getByTestId("entity-active-filter-id")).toHaveCount(0)

      const confirmedPickings = await fetchOrderPickings(page, orderId)
      expect(confirmedPickings).toHaveLength(1)

      const staleReplay = await confirmRequest(salesPage, companyId, orderId)
      expect(staleReplay.status()).toBe(422)
      expect(await fetchOrderPickings(page, orderId)).toEqual(confirmedPickings)

      await signIn(readerPage, "fixture.reader@example.test", PERSONA_PASSWORD)
      const denial = await confirmRequest(readerPage, companyId, orderId)
      expect(denial.status()).toBe(403)
      expect(await fetchOrderPickings(page, orderId)).toEqual(confirmedPickings)
    } finally {
      await readerContext.close()
      await salesContext.close()
    }
  })
})
