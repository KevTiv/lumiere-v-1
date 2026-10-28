import { expect, test } from "@playwright/test"
import { chooseSelectOptionByValue } from "./e2e/helpers"

for (const width of [320, 1440]) {
  test.describe(`${width}px shared select controls`, () => {
    test.use({ viewport: { width, height: 900 }, hasTouch: width < 768 })
    test("record options are clickable above a modal and resolve exact IDs with duplicate labels", async ({ page }) => {
      await page.goto("/select-controls")
      await page.getByRole("button", { name: "Open select dialog" }).click()
      await chooseSelectOptionByValue(page, "partnerId", "customer-b")
      await expect(page.getByTestId("record-value")).toHaveText("customer-b")
      await expect(page.getByTestId("form-field-partnerId")).toContainText("Customer")
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
