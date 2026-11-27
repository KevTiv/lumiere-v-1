import { expect, type Page } from "@playwright/test"
import { chooseSelectOptionByTriggerValue } from "./e2e/helpers-legacy"
import type { OverviewQueueKey } from "../app/(modules)/accounting/accountant-overview-model"

export function mobileAccountingQueuePicker(page: Page) {
  return page.getByTestId("accountant-mobile-queue-picker")
}

export async function selectAccountingQueue(page: Page, key: OverviewQueueKey) {
  const picker = mobileAccountingQueuePicker(page)
  if (await picker.isVisible()) {
    await chooseSelectOptionByTriggerValue(page, picker, key)
  } else {
    const button = page.getByTestId(`accountant-queue-${key}`)
    await button.click()
    await expect(button).toHaveAttribute("aria-pressed", "true")
  }
}
