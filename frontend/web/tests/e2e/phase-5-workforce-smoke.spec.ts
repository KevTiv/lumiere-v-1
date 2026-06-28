import { expect, test, type Page } from "@playwright/test"

import {
  chooseFirstOption,
  expectNoAppError,
  fillField,
  gotoModule,
  openEntityCreate,
  smokeName,
  submitForm,
} from "./helpers"

async function openHrTab(page: Page, tabId: string) {
  await page.getByTestId(`module-tab-hr-${tabId}`).click()
}

async function openProjectsTab(page: Page, tabId: string) {
  await page.getByTestId(`module-tab-projects-${tabId}`).click()
}

async function openExpensesTab(page: Page, tabId: string) {
  await page.getByTestId(`module-tab-expenses-${tabId}`).click()
}

async function openCalendarTab(page: Page, tabId: string) {
  await page.getByTestId(`module-tab-calendar-${tabId}`).click()
}

test.describe("Workforce modules e2e @phase-5", () => {
  test.describe("HR", () => {
    test("renders org chart, leave types, and payroll structures tabs", async ({ page }) => {
      await gotoModule(page, "/hr", "hr")

      await openHrTab(page, "org-chart")
      await expect(page.getByText("Organization Chart")).toBeVisible()
      await expectNoAppError(page)

      await openHrTab(page, "leave-types")
      await expect(page.getByTestId("module-create-hr-leave-types")).toBeVisible()
      await expect(page.getByTestId("entity-table")).toBeVisible()
      await expectNoAppError(page)

      await openHrTab(page, "payroll-structures")
      await expect(page.getByTestId("module-create-hr-payroll-structures")).toBeVisible()
      await expect(page.getByTestId("entity-table")).toBeVisible()
      await expectNoAppError(page)
    })

    test("creates leave type with minimal fields", async ({ page }) => {
      const name = smokeName("leave-type")
      await openEntityCreate(page, "/hr", "hr", "leave-types", "new-leave-type")

      await fillField(page, "name", name)
      await chooseFirstOption(page, "allocationType")
      await fillField(page, "maxLeaves", "10")
      await submitForm(page, "new-leave-type")

      await openHrTab(page, "leave-types")
      await expect(page.getByText(name)).toBeVisible()
      await expectNoAppError(page)
    })
  })

  test.describe("Projects", () => {
    test("renders gantt and resources tabs", async ({ page }) => {
      await gotoModule(page, "/projects", "projects")

      await openProjectsTab(page, "gantt")
      await expect(page.getByText("Gantt View").first()).toBeVisible()
      await expect(page.getByText("Task timeline by project and deadline")).toBeVisible()
      await expectNoAppError(page)

      await openProjectsTab(page, "resources")
      await expect(page.getByTestId("entity-table")).toBeVisible()
      await expectNoAppError(page)
    })
  })

  test.describe("Expenses", () => {
    test("renders module and CSV import toolbar actions", async ({ page }) => {
      await gotoModule(page, "/expenses", "expenses")

      await openExpensesTab(page, "expenses")
      await expect(page.getByTestId("entity-action-csv-expenses")).toBeVisible()
      await expect(page.getByText("Import expenses (CSV)")).toBeVisible()
      await expectNoAppError(page)

      await openExpensesTab(page, "expense-sheets")
      await expect(page.getByTestId("entity-action-csv-sheets")).toBeVisible()
      await expect(page.getByText("Import reports (CSV)")).toBeVisible()
      await expectNoAppError(page)
    })
  })

  test.describe("Calendar", () => {
    test("renders activities tab", async ({ page }) => {
      await gotoModule(page, "/calendar", "calendar")

      await openCalendarTab(page, "activities")
      await expect(page.getByTestId("module-create-calendar-activities")).toBeVisible()
      await expect(page.getByTestId("entity-table")).toBeVisible()
      await expectNoAppError(page)
    })
  })
})
