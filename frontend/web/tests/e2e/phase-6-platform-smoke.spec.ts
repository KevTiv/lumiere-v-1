import { expect, test, type Page } from "@playwright/test"

import { assertModuleTabs, activeTabEntityTable, expectNoAppError, gotoModule } from "./helpers"

const DOCUMENTS_TAB_IDS = [
  "dashboard",
  "documents",
  "knowledge-base",
  "knowledge-categories",
  "document-folders",
  "document-processing",
  "document-insights",
] as const

const SUBSCRIPTIONS_TAB_IDS = [
  "dashboard",
  "subscriptions",
  "plans",
  "deferred-schedules",
  "deferred-lines",
  "recognition-rules",
] as const

const HELPDESK_TAB_IDS = ["dashboard", "tickets", "teams", "stages", "slas"] as const

async function assertDocumentsTab(page: Page, tabId: string) {
  switch (tabId) {
    case "dashboard":
      await expect(page.getByTestId("quick-action-upload_document")).toBeVisible()
      break
    case "documents":
      await expect(page.getByTestId("module-create-documents-documents")).toBeVisible()
      await expect(activeTabEntityTable(page)).toBeVisible()
      break
    case "knowledge-base":
      await expect(page.getByTestId("module-create-documents-knowledge-base")).toBeVisible()
      await expect(page.getByTestId("entity-action-csv-kb-category")).toBeVisible()
      break
    case "knowledge-categories":
      await expect(page.getByTestId("module-create-documents-knowledge-categories")).toBeVisible()
      await expect(page.getByTestId("entity-action-csv-kb-category-tab")).toBeVisible()
      break
    case "document-folders":
      await expect(page.getByTestId("module-create-documents-document-folders")).toBeVisible()
      await expect(activeTabEntityTable(page)).toBeVisible()
      break
    case "document-processing":
      await expect(page.getByTestId("module-create-documents-document-processing")).toBeVisible()
      await expect(activeTabEntityTable(page)).toBeVisible()
      break
    case "document-insights":
      await expect(page.getByTestId("entity-action-generate-insights")).toBeVisible()
      await expect(activeTabEntityTable(page)).toBeVisible()
      break
    default:
      break
  }
}

async function assertSubscriptionsTab(page: Page, tabId: string) {
  switch (tabId) {
    case "deferred-schedules":
      await expect(page.getByTestId("module-create-subscriptions-deferred-schedules")).toBeVisible()
      await expect(activeTabEntityTable(page)).toBeVisible()
      break
    case "deferred-lines":
      await expect(page.getByTestId("entity-action-recognize-line")).toBeVisible()
      await expect(activeTabEntityTable(page)).toBeVisible()
      break
    default:
      break
  }
}

async function assertHelpdeskTab(page: Page, tabId: string) {
  switch (tabId) {
    case "dashboard":
      await expect(page.getByTestId("quick-action-new_ticket")).toBeVisible()
      break
    case "tickets":
      await expect(page.getByTestId("module-create-helpdesk-tickets")).toBeVisible()
      await expect(page.getByTestId("entity-action-close-ticket")).toBeVisible()
      break
    case "teams":
      await expect(page.getByTestId("module-create-helpdesk-teams")).toBeVisible()
      break
    case "stages":
      await expect(page.getByTestId("module-create-helpdesk-stages")).toBeVisible()
      break
    case "slas":
      await expect(page.getByTestId("module-create-helpdesk-slas")).toBeVisible()
      break
    default:
      break
  }
}

test.describe("Phase 6 platform smoke", { tag: "@phase-6" }, () => {
  test("documents module tab sweep including knowledge categories and folders", async ({ page }) => {
    await gotoModule(page, "/documents", "documents")
    await assertModuleTabs(page, "documents", DOCUMENTS_TAB_IDS, assertDocumentsTab)
  })

  test("reports dashboard-widgets tab renders", async ({ page }) => {
    await gotoModule(page, "/reports", "reports")
    await page.getByTestId("module-tab-reports-dashboard-widgets").click()
    await expect(page.getByTestId("module-create-reports-dashboard-widgets")).toBeVisible()
    await expect(page.getByTestId("entity-table")).toBeVisible()
    await expectNoAppError(page)
  })

  test("workflows module loads without error", async ({ page }) => {
    await gotoModule(page, "/workflows", "workflows")
    await expect(page.getByTestId("module-tab-workflows-dashboard")).toBeVisible()
    await expect(page.getByTestId("quick-action-new_workflow")).toBeVisible()
    await expectNoAppError(page)
  })

  test("subscriptions deferred revenue tabs render", async ({ page }) => {
    await gotoModule(page, "/subscriptions", "subscriptions")
    await assertModuleTabs(page, "subscriptions", SUBSCRIPTIONS_TAB_IDS, assertSubscriptionsTab)
  })

  test("helpdesk tabs not covered elsewhere render without error", async ({ page }) => {
    await gotoModule(page, "/helpdesk", "helpdesk")
    await assertModuleTabs(page, "helpdesk", HELPDESK_TAB_IDS, assertHelpdeskTab)
  })
})
