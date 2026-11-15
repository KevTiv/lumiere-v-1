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
  test("reopens the exact picker when the form replaces its trigger during the click", async ({ page }) => {
    await page.setContent(`
      <button data-testid="form-field-projectId" type="button" role="combobox" aria-expanded="false" aria-controls="old-project-options">Select a project</button>
      <div id="old-project-options" role="listbox" hidden></div>
      <div id="current-project-options" role="listbox" hidden>
        <div role="option" data-value="217">Current project</div>
      </div>
      <div id="other-project-options" role="listbox">
        <div role="option" data-value="217">Another picker</div>
      </div>
    `)

    const field = page.getByTestId("form-field-projectId")
    await field.evaluate((oldTrigger) => {
      const oldPopup = document.getElementById("old-project-options")!
      const currentPopup = document.getElementById("current-project-options")!
      const currentTrigger = oldTrigger.cloneNode(true) as HTMLButtonElement
      currentTrigger.setAttribute("aria-controls", currentPopup.id)
      oldTrigger.addEventListener("click", () => {
        oldTrigger.replaceWith(currentTrigger)
        oldPopup.remove()
      }, { once: true })
      currentTrigger.addEventListener("click", () => {
        currentTrigger.setAttribute("aria-expanded", "true")
        currentPopup.hidden = false
      })
      currentPopup.querySelector('[role="option"]')!.addEventListener("click", (event) => {
        currentTrigger.textContent = (event.currentTarget as HTMLElement).textContent
        currentTrigger.setAttribute("aria-expanded", "false")
        currentPopup.hidden = true
      })
    })

    await chooseSelectOptionByValue(page, "projectId", 217)
    await expect(field).toHaveText("Current project")
    await expect(page.locator("#other-project-options")).toBeVisible()
  })

  test("selects a visible Radix option through its hidden native value", async ({ page }) => {
    await page.setContent(`
      <div>
        <button data-testid="form-field-partnerId" type="button" role="combobox" aria-expanded="false" aria-controls="legacy-options">Select...</button>
        <select aria-hidden="true" tabindex="-1">
          <option value="217">Acme Corporation</option>
          <option value="223">Converted Customer</option>
        </select>
      </div>
      <div id="legacy-options" role="listbox" hidden>
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
        trigger.setAttribute("aria-expanded", "true")
        document.querySelector('[role="listbox"]')?.removeAttribute("hidden")
      })
    })
    await convertedCustomer.evaluate((option) => {
      option.addEventListener("click", () => {
        const trigger = document.querySelector('[data-testid="form-field-partnerId"]')
        if (trigger) trigger.textContent = option.textContent
        trigger?.setAttribute("aria-expanded", "false")
        document.querySelector('[role="listbox"]')?.setAttribute("hidden", "")
      })
    })

    await chooseSelectOptionByValue(page, "partnerId", 223)

    await expect(field).toHaveText("Converted Customer")
  })
})
