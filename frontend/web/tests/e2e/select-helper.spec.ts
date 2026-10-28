import { expect, test } from "@playwright/test"

import { chooseSelectOptionByValue } from "./helpers"

test.describe("select helper DOM contract", { tag: ["@unauthenticated", "@p0"] }, () => {
  test("selects a visible option by its exact stored value", async ({ page }) => {
    await page.setContent(`
      <div>
        <button data-testid="form-field-partnerId" type="button" role="combobox" aria-expanded="false" aria-controls="customer-options">Select...</button>
      </div>
      <div id="customer-options" role="listbox" hidden>
        <div role="option" data-value="217">Converted Customer</div>
        <div role="option" data-value="223">Converted Customer</div>
      </div>
    `)

    const field = page.getByTestId("form-field-partnerId")
    const convertedCustomer = page.locator('[role="option"][data-value="223"]')
    await field.evaluate((trigger) => {
      trigger.addEventListener("click", () => {
        trigger.setAttribute("aria-expanded", "true")
        document.querySelector('[role="listbox"]')?.removeAttribute("hidden")
      })
    })
    await convertedCustomer.evaluate((option) => {
      option.addEventListener("click", () => {
        const trigger = document.querySelector('[data-testid="form-field-partnerId"]')
        if (trigger) trigger.textContent = option.textContent
        trigger?.setAttribute("aria-expanded", "false")
        trigger?.setAttribute("data-selected-value", option.getAttribute("data-value") ?? "")
        option.closest('[role="listbox"]')?.setAttribute("hidden", "")
      })
    })

    await chooseSelectOptionByValue(page, "partnerId", 223)

    await expect(field).toHaveText("Converted Customer")
    await expect(field).toHaveAttribute("data-selected-value", "223")
  })
})
