import { expect, test } from "@playwright/test"

import {
  chooseFirstOption,
  expectNoAppError,
  fillField,
  gotoModule,
  openEntityCreate,
  signIn,
  smokeName,
  submitForm,
} from "./helpers"

test.describe("ERP module smoke", () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page)
  })

  test("creates a CRM lead from the Leads tab", async ({ page }) => {
    const contactName = smokeName("lead")

    await openEntityCreate(page, "/crm", "crm", "leads", "new-lead")
    await fillField(page, "contactName", contactName)
    await fillField(page, "emailFrom", `${contactName}@example.test`)
    await fillField(page, "expectedRevenue", "1000")
    await submitForm(page, "new-lead")

    await expect(page.getByText(contactName)).toBeVisible()
  })

  test("creates a Helpdesk team from the Teams tab", async ({ page }) => {
    const teamName = smokeName("helpdesk-team")

    await openEntityCreate(page, "/helpdesk", "helpdesk", "teams", "new-helpdesk-team")
    await fillField(page, "name", teamName)
    await fillField(page, "description", "Created by ERP smoke tests")
    await submitForm(page, "new-helpdesk-team")

    await expect(page.getByText(teamName)).toBeVisible()
  })

  test("creates an Inventory product category", async ({ page }) => {
    const categoryName = smokeName("category")

    await openEntityCreate(page, "/inventory", "inventory", "product-categories", "new-product-category")
    await fillField(page, "name", categoryName)
    await submitForm(page, "new-product-category")

    await expect(page.getByText(categoryName)).toBeVisible()
  })

  test("creates a Sales pricelist with minimal required data", async ({ page }) => {
    const pricelistName = smokeName("pricelist")

    await openEntityCreate(page, "/sales", "sales", "pricelists", "new-pricelist")
    await fillField(page, "name", pricelistName)
    await fillField(page, "currencyId", "1")
    await submitForm(page, "new-pricelist")

    await expect(page.getByText(pricelistName)).toBeVisible()
  })

  test("creates a Proposal and opens the proposal workspace route", async ({ page }) => {
    const proposalTitle = smokeName("proposal")

    await openEntityCreate(page, "/proposals", "proposals", "proposals", "new-proposal")
    await fillField(page, "title", proposalTitle)
    await fillField(page, "clientName", "Smoke Client")
    await chooseFirstOption(page, "type")
    await fillField(page, "value", "5000")
    await page.getByTestId("form-submit-new-proposal").click()

    await expect(page).toHaveURL(/\/proposals\/[^/]+/)
    await expect(page.getByText(proposalTitle)).toBeVisible()
    await expectNoAppError(page)
  })

  test("renders guarded workflow/action controls for CRM and Helpdesk", async ({ page }) => {
    await gotoModule(page, "/crm", "crm")
    await page.getByTestId("module-tab-crm-leads").click()
    await expect(page.getByTestId("entity-action-convert-lead")).toBeVisible()
    await expect(page.getByTestId("entity-action-convert-lead")).toBeDisabled()

    await gotoModule(page, "/helpdesk", "helpdesk")
    await expect(page.getByTestId("quick-action-new_ticket")).toBeVisible()
    await page.getByTestId("quick-action-new_ticket").click()
    await expect(page.getByTestId("form-modal-new-helpdesk-ticket")).toBeVisible()
  })
})
