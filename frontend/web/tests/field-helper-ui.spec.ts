import { expect, test } from "@playwright/test"

import { fillField } from "./e2e/helpers"

// Uses the production form renderer and Textarea with synthetic UI props.
// Financial mutations and permissions are verified by the full ERP suite.
test("field helper edits the visible rich-text surface and preserves its form bridge", async ({ page }) => {
  await page.goto("/style-templates")
  await expect(page.getByTestId("module-view-style-templates")).toHaveAttribute("data-hydrated", "true")
  await page.getByTestId("module-create-style-templates-records").click()
  const modal = page.getByTestId("form-modal-template-record")
  await expect(modal).toBeVisible()

  await fillField(modal, "reference", "HELPER-REFERENCE")
  await fillField(modal, "notes", "Original review")
  await fillField(modal, "notes", "Replacement review")

  await expect(modal.getByRole("textbox", { name: /^Review notes(?: rich text editor)?$/ })).toHaveText("Replacement review")
  await expect(modal.getByTestId("form-field-notes")).toHaveValue("Replacement review")
  await expect(modal.getByTestId("form-field-address")).toHaveValue("")

  await fillField(modal, "address", "Warehouse gate")
  await expect(modal.getByRole("textbox", { name: /^Business address(?: rich text editor)?$/ })).toHaveText("Warehouse gate")
  await expect(modal.getByTestId("form-field-address")).toHaveValue("Warehouse gate")
  await expect(modal.getByTestId("form-field-notes")).toHaveValue("Replacement review")
  await expect(modal.getByTestId("form-field-reference")).toHaveValue("HELPER-REFERENCE")
})
