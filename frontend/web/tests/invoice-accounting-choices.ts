import { expect, type Page } from "@playwright/test"

/** Explicit user selections in test fixtures; production never chooses the first of many. */
export async function reviewInvoiceAccountingChoices(page: Page): Promise<void> {
  const modal = page.getByTestId("create-invoice-modal")
  const choose = async (testId: string) => {
    await modal.getByTestId(testId).click()
    const options = page.locator('[role="listbox"]:visible').getByRole("option", { disabled: false })
    await expect(options.first()).toBeVisible()
    await options.first().click()
  }
  await choose("create-invoice-journal")
  await choose("create-invoice-counterpart")
  const lineCount = await modal.getByTestId(/^create-invoice-line-account-/).count()
  for (let index = 0; index < lineCount; index += 1) await choose(`create-invoice-line-account-${index}`)
  const retain = modal.getByRole("button", { name: "Keep current accounting choices", exact: true })
  if (await retain.count()) await retain.click()
}
