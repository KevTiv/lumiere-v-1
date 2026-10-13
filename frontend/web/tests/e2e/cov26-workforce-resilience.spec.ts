import { expect, test, type Page } from "@playwright/test"

import {
  expectFormModalVisible,
  expectNoAppError,
  gotoModule,
  scalarQueryId,
  signIn,
  waitForBffQueryMinRows,
} from "./helpers"

const PERSONA_PASSWORD = process.env.E2E_FIRST_ORG_PERSONA_PASSWORD ?? "Password123$"

const MODULES = [
  {
    label: "HR",
    href: "/hr?tab=employees",
    moduleId: "hr",
    tabId: "employees",
    resource: "employees",
    createForm: "new-employee",
  },
  {
    label: "Projects",
    href: "/projects?tab=projects",
    moduleId: "projects",
    tabId: "projects",
    resource: "projects",
    createForm: "new-project",
  },
  {
    label: "Expenses",
    href: "/expenses?tab=expenses",
    moduleId: "expenses",
    tabId: "expenses",
    resource: "expenses",
    createForm: "new-expense",
  },
] as const

async function expectNoHorizontalOverflow(page: Page, label: string) {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
    .toBeLessThanOrEqual(1)
  await expect(
    page
      .getByTestId("dashboard-sidebar")
      .or(page.getByRole("button", { name: /menu|sidebar|navigation/i }))
      .first(),
    `${label} navigation remains reachable`,
  ).toBeVisible()
}

test.describe("COV-26 workforce module resilience", { tag: ["@cov09", "@cov10", "@cov11", "@cov26", "@dev-fixture"] }, () => {
  for (const width of [320, 390] as const) {
    test(`HR, Projects and Expenses retain keyboard reachability at ${width}px`, async ({ page }) => {
      test.setTimeout(150_000)
      await page.setViewportSize({ width, height: 844 })

      for (const module of MODULES) {
        await gotoModule(page, module.href, module.moduleId)
        await page.getByTestId(`module-tab-${module.moduleId}-${module.tabId}`).click()
        await expectNoHorizontalOverflow(page, `${module.label} at ${width}px`)

        const create = page.getByTestId(`module-create-${module.moduleId}-${module.tabId}`)
        await create.focus()
        await expect(create).toBeFocused()
        await create.press("Enter")
        await expectFormModalVisible(page, module.createForm)
        await expect
          .poll(() => page.evaluate(() => document.activeElement?.closest('[role="dialog"]') != null))
          .toBe(true)
        await page.keyboard.press("Escape")
        await expect(page.getByTestId(`form-modal-${module.createForm}`)).toBeHidden()
        await expect(create).toBeFocused()
        await expectNoAppError(page)
      }
    })
  }

  test("successful empty search is distinct from unavailable data in each workforce module", async ({ page }) => {
    test.setTimeout(120_000)
    for (const module of MODULES) {
      await gotoModule(page, module.href, module.moduleId)
      await waitForBffQueryMinRows(page, `/api/query/${module.resource}`)
      await page.getByTestId(`module-tab-${module.moduleId}-${module.tabId}`).click()

      const search = page.getByRole("textbox", { name: "Search records" })
      await search.fill(`cov26-no-match-${module.moduleId}-${Date.now()}`)
      await expect(page.getByTestId("entity-empty-no-results")).toBeVisible()
      await expect(page.getByTestId("entity-empty-first-time")).toBeHidden()
      await page.getByTestId("entity-empty-clear-filters").click()
      await expect(page.getByTestId("entity-empty-no-results")).toBeHidden()
    }
  })

  test("read-only persona cannot reach workforce mutation controls", async ({ browser }) => {
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } })
    const page = await context.newPage()
    try {
      await signIn(page, "fixture.reader@example.test", PERSONA_PASSWORD)
      for (const module of MODULES) {
        await gotoModule(page, module.href, module.moduleId)
        await page.getByTestId(`module-tab-${module.moduleId}-${module.tabId}`).click()
        await expect(page.getByTestId(`module-create-${module.moduleId}-${module.tabId}`)).toBeHidden()
      }
      await expectNoAppError(page)
    } finally {
      await context.close()
    }
  })

  test("HR, Projects and Expenses reconnect and read back the same canonical rows", async ({ page, context }) => {
    test.setTimeout(150_000)
    for (const module of MODULES) {
      const beforeResponse = await page.request.get(`/api/query/${module.resource}`)
      expect(beforeResponse.ok()).toBe(true)
      const beforeRows = ((await beforeResponse.json()) as { data?: Array<{ id?: unknown }> }).data ?? []
      const canonicalId = scalarQueryId(beforeRows[0]?.id)
      if (canonicalId == null) throw new Error(`${module.resource} requires one seeded canonical row`)

      await gotoModule(page, module.href, module.moduleId)
      await context.setOffline(true)
      await page.waitForTimeout(500)
      await context.setOffline(false)

      const refetch = page.waitForResponse(
        (response) => response.url().includes(`/api/query/${module.resource}`) && response.ok(),
        { timeout: 30_000 },
      )
      await page.reload({ waitUntil: "domcontentloaded" })
      const response = await refetch
      const rows = ((await response.json()) as { data?: Array<{ id?: unknown }> }).data ?? []
      expect(rows.map((row) => scalarQueryId(row.id))).toContain(canonicalId)
      await page.getByTestId(`module-tab-${module.moduleId}-${module.tabId}`).click()
      await expect(page.getByTestId(`entity-row-${canonicalId}`)).toBeVisible()
      await expectNoAppError(page)
    }
  })
})
