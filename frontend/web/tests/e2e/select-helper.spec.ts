import { expect, test } from "@playwright/test"

import { chooseSelectOptionByValue } from "./helpers"

test.describe("select helper DOM contract", { tag: ["@unauthenticated", "@p0"] }, () => {
  test("selects a visible Radix option through its hidden native value", async ({ page }) => {
    await page.setContent(`
      <div>
        <button data-testid="form-field-partnerId" type="button">Select...</button>
        <select aria-hidden="true" tabindex="-1">
          <option value="217">Acme Corporation</option>
          <option value="223">Converted Customer</option>
        </select>
      </div>
      <div role="listbox" hidden>
        <div role="option">Acme Corporation</div>
        <div role="option">Converted Customer</div>
      </div>
    `)

    const field = page.getByTestId("form-field-partnerId")
    const convertedCustomer = page.locator('[role="option"]', {
      hasText: "Converted Customer",
    })
    await field.evaluate((trigger) => {
      trigger.addEventListener("click", () => {
        document.querySelector('[role="listbox"]')?.removeAttribute("hidden")
      })
    })
    await convertedCustomer.evaluate((option) => {
      option.addEventListener("click", () => {
        const trigger = document.querySelector('[data-testid="form-field-partnerId"]')
        if (trigger) trigger.textContent = option.textContent
      })
    })

    await chooseSelectOptionByValue(page, "partnerId", 223)

    await expect(field).toHaveText("Converted Customer")
  })
})
