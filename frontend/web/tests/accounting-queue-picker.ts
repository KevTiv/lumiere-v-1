import { expect, type Page } from "@playwright/test"
import type { OverviewQueueKey } from "../app/(modules)/accounting/accountant-overview-model"

export function mobileAccountingQueuePicker(page: Page) {
  return page.getByRole("combobox", { name: "Needs attention", exact: true })
}

export async function selectAccountingQueue(page: Page, key: OverviewQueueKey) {
  const picker = mobileAccountingQueuePicker(page)
  if (await picker.isVisible()) {
    await picker.selectOption(key)
    await expect(picker).toHaveValue(key)
  } else {
    const button = page.getByTestId(`accountant-queue-${key}`)
    await button.click()
    await expect(button).toHaveAttribute("aria-pressed", "true")
  }
}
