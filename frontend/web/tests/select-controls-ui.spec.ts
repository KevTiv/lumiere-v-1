import { expect, test } from "@playwright/test"
import { chooseSelectOptionByLabel, chooseSelectOptionByValue } from "./e2e/helpers"

for (const width of [320, 1440]) {
  test.describe(`${width}px shared select controls`, () => {
    test.use({ viewport: { width, height: 900 }, hasTouch: width < 768 })
    test("account options receive pointer clicks above a scrolling posting form", async ({ page }) => {
      await page.goto("/select-controls")
      await page.getByRole("button", { name: "Open posting form" }).click()
      await chooseSelectOptionByLabel(page, "journalId", "Account 01")
      await chooseSelectOptionByLabel(page, "defaultExpenseAccountId", "Account 13")
      await chooseSelectOptionByLabel(page, "payableAccountId", "Account 02")
      await expect(page.getByTestId("form-field-journalId")).toContainText("Account 01")
      await expect(page.getByTestId("form-field-defaultExpenseAccountId")).toContainText("Account 13")
      const field = page.getByTestId("form-field-payableAccountId")
      await expect(field).toContainText("Account 02")
      await expect(page.getByTestId("form-modal-post-expense-report")).toBeVisible()
    })
    test("record picker options receive pointer clicks above their parent dialog", async ({ page }) => {
      await page.goto("/select-controls")
      await page.getByRole("button", { name: "Open select dialog" }).click()
      const field = page.getByTestId("form-field-exactRecord")
      await field.click()
      await page.getByRole("option", { name: "Account 02", exact: true }).click()
      await expect(field).toContainText("Account 02")
      await expect(page.getByTestId("record-value")).toHaveText("02")
      await expect(page.getByRole("dialog", { name: "Account selectors" })).toBeVisible()
    })
    test("the exact-value helper selects a searchable record without a native select", async ({ page }) => {
      await page.goto("/select-controls")
      await page.getByRole("button", { name: "Open select dialog" }).click()
      await chooseSelectOptionByValue(page, "exactRecord", "9007199254740993")
      await expect(page.getByTestId("form-field-exactRecord")).toContainText("Same customer")
      await expect(page.getByTestId("record-value")).toHaveText("9007199254740993")
    })
    test("search starts at 15, retains selection and supports keyboard input inside a dialog", async ({
      page,
    }, testInfo) => {
      await page.goto("/select-controls")
      await page.getByRole("button", { name: "Open select dialog" }).click()
      const short = page.getByRole("combobox", { name: "Fourteen accounts" })
      await short.press("Enter")
      await expect(page.getByRole("searchbox")).toHaveCount(0)
      await page.keyboard.press("Escape")
      await expect(short).toBeFocused()
      const trigger = page.getByTestId("long-select")
      await trigger.press("Enter")
      const search = page.getByRole("searchbox", { name: "Search options…" })
      await expect(search).toBeFocused()
      await search.pressSequentially("account 13")
      await expect(page.getByRole("option")).toHaveCount(1)
      await page.screenshot({
        path: testInfo.outputPath(`select-search-${width}.png`),
        fullPage: true,
      })
      await expect(trigger).toContainText("Account 02")
      await page.keyboard.press("ArrowDown")
      await expect(page.getByRole("option", { name: "Account 13" })).toBeFocused()
      await page.keyboard.press("Tab")
      await expect(search).toBeFocused()
      await page.keyboard.press("ArrowDown")
      await page.keyboard.press("Enter")
      await expect(trigger).toContainText("Account 13")
      await trigger.click()
      await expect(search).toHaveValue("")
      await expect(search).toBeFocused()
      await search.fill("account 14")
      await expect(page.getByRole("option", { name: "Account 14" })).toBeDisabled()
      await search.press("Enter")
      await expect(search).toBeVisible()
      await expect(trigger).toContainText("Account 13")
      await search.fill("no such account")
      await expect(page.getByRole("status")).toHaveText("No matching options")
      await expect(page.getByRole("option")).toHaveCount(0)
      await search.press("Escape")
      await expect(trigger).toBeFocused()
      await expect(page.getByRole("dialog", { name: "Account selectors" })).toBeVisible()
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
      ).toBeLessThanOrEqual(1)
    })
    test("multiple selection displays checked boxes, toggles rows and keeps unavailable values", async ({
      page,
    }, testInfo) => {
      await page.goto("/select-controls")
      await page.getByRole("button", { name: "Open select dialog" }).click()
      await page.getByTestId("multiple-accounts").click()
      const first = page.getByRole("option", { name: /Account 01/ })
      const selected = page.getByRole("option", { name: /Account 02/ })
      await expect(first.locator('[data-slot="option-checkbox"]')).toHaveAttribute(
        "data-checked",
        "false",
      )
      await expect(selected.locator('[data-slot="option-checkbox"]')).toHaveAttribute(
        "data-checked",
        "true",
      )
      await first.locator('[data-slot="option-checkbox"]').click()
      await expect(first).toHaveAttribute("aria-checked", "true")
      await expect(page.getByRole("listbox")).toBeVisible()
      await selected.click()
      await expect(selected.locator('[data-slot="option-checkbox"]')).toHaveAttribute(
        "data-checked",
        "false",
      )
      await page.screenshot({
        path: testInfo.outputPath(`select-checkboxes-${width}.png`),
        fullPage: true,
      })
      await expect(page.getByRole("option", { name: /Account 14/ })).toBeDisabled()
      await page.keyboard.press("Escape")
      await expect(page.getByTestId("multiple-accounts-chips")).toContainText(
        "Unavailable: missing",
      )
      await expect(page.getByTestId("multiple-accounts-chips")).toContainText("Account 14")
      await page.getByRole("button", { name: "Close", exact: true }).click()
      await expect(page.getByTestId("multiple-value")).toHaveText("14,missing,01")
    })
  })
}
